// ==UserScript==
// @name         Pixiv イラスト・小説 ブクマ順（検索結果横断）
// @namespace    local.pixiv.bookmark-sort.cross-page
// @version      0.5.1
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @description  pixivの小説・イラスト・漫画検索を横断してブクマ順に表示。最低件数指定・中断再開・保存対応。
// @match        https://www.pixiv.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__pixivBookmarkCrossPageV05) return;
  window.__pixivBookmarkCrossPageV05 = true;

  const DB_NAME = 'pixiv-bookmark-sort-cross-page-v02';
  const DB_VERSION = 1;
  const HOST_ID = 'pixiv-bookmark-sort-cross-page-v05';
  const MIN_PREF_KEY = 'pixiv-bookmark-sort-minimum-v03';
  const REQUEST_INTERVAL_MS = 2500; // 検索・詳細とも連続アクセスしない。制限時の迂回や自動リトライは行わない。
  const MAX_PAGES_SAFETY = 1000; // 暴走防止。超過した場合、全件取得したとは表示しない。
  const fmt = new Intl.NumberFormat('ja-JP');
  let dbPromise;
  let active = null;
  let currentContext = null;
  let queryKey = '';
  let lastRequestAt = 0;
  let renderTimer = null;
  let listLimit = 100;
  let minBookmarks = loadMinBookmarks();
  let renderSequence = 0;
  let lastFailedRequest = null;

  function normalizeMinBookmarks(value) {
    const raw = String(value).trim();
    if (!/^\d+$/.test(raw)) return 0;
    return Math.min(1000000000, Math.floor(Number(raw)));
  }
  function loadMinBookmarks() {
    try { return normalizeMinBookmarks(localStorage.getItem(MIN_PREF_KEY) || '0'); }
    catch (_) { return 0; }
  }

  function contextFromUrl() {
    const url = new URL(location.href);
    // pixivのタグ検索: /tags/タグ名/novels, /tags/タグ名/artworks 等
    const m = url.pathname.match(/^\/tags\/([^/]+)(?:\/(artworks|illustrations|manga|novels))?(?:\/|$)/);
    let word, kind, sMode;
    if (m) {
      try { word = decodeURIComponent(m[1]); } catch (_) { return null; }
      kind = m[2] || 'artworks';
      sMode = url.searchParams.get('s_mode') || 's_tag_full';
    } else if (url.pathname === '/novel/search.php') {
      // 旧形式の小説検索にも対応。
      word = url.searchParams.get('word') || url.searchParams.get('q');
      kind = 'novels';
      sMode = url.searchParams.get('s_mode') || 's_tag';
    } else if (url.pathname === '/search.php' || url.pathname === '/search') {
      // /search?q=...&type=novel のような検索URL。
      word = url.searchParams.get('word') || url.searchParams.get('q');
      const searchType = url.searchParams.get('type');
      kind = searchType === 'novel' || searchType === 'novels' ? 'novels' :
        searchType === 'manga' ? 'manga' :
        searchType === 'illust' || searchType === 'illustrations' ? 'illustrations' : 'artworks';
      sMode = url.searchParams.get('s_mode') || 's_tag';
    } else return null;
    if (!word) return null;
    const params = new URLSearchParams();
    const common = ['mode', 'scd', 'ecd', 'ai_type', 'work_lang', 'lang'];
    const novelOnly = ['tlt', 'tgt', 'wlt', 'wgt', 'original_only', 'genre'];
    const artOnly = ['wlt', 'wgt', 'hlt', 'hgt', 'ratio', 'tool'];
    for (const name of [...common, ...(kind === 'novels' ? novelOnly : artOnly)]) {
      for (const value of url.searchParams.getAll(name)) params.append(name, value);
    }
    params.set('word', word);
    params.set('s_mode', sMode);
    params.set('mode', params.get('mode') || 'all');
    // 小説検索ではpixiv側に存在しない可能性のある条件を勝手に付け足さない。
    // URLにgs=0/1が指定されているときのみ引き継ぐ。
    if (kind === 'novels') {
      const gs = url.searchParams.get('gs');
      if (gs === '0' || gs === '1') params.set('gs', gs);
    } else {
      // 同じ作者の作品を束ねない（検索対象が抜け落ちるのを防止）。
      params.set('csw', '0');
      if (kind === 'artworks') params.set('type', 'all');
      if (kind === 'illustrations') {
        const type = url.searchParams.get('type');
        if (type === 'illust' || type === 'ugoira' || type === 'illust_and_ugoira') params.set('type', type);
      }
      if (kind === 'manga') params.set('type', 'manga');
    }
    params.sort();
    const key = JSON.stringify([kind, word, [...params.entries()]]);
    return { word, kind, params, key };
  }

  function openDb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const works = db.createObjectStore('works', { keyPath: 'key' });
        works.createIndex('pending', ['searchKey', 'status']);
        works.createIndex('rank', ['searchKey', 'count']);
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDBを開けません'));
    });
    return dbPromise;
  }

  function transactionPromise(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('保存に失敗しました'));
      tx.onabort = () => reject(tx.error || new Error('保存が中断されました'));
    });
  }
  function requestPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('読み込みに失敗しました'));
    });
  }
  async function getMeta(key) {
    const db = await openDb();
    const tx = db.transaction('meta', 'readonly');
    const m = await requestPromise(tx.objectStore('meta').get(key));
    return m || { key, nextPage: 1, total: null, discovered: 0, processed: 0,
      skipped: 0, pageSize: null, searchDone: false, note: '' };
  }
  async function putMeta(meta) {
    const db = await openDb();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(meta);
    await transactionPromise(tx);
  }
  async function clearSearch(key) {
    const db = await openDb();
    const tx = db.transaction(['works', 'meta'], 'readwrite');
    const store = tx.objectStore('works');
    const cursorReq = store.index('pending').openCursor(
      IDBKeyRange.bound([key, 0], [key, 2]));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    tx.objectStore('meta').delete(key);
    await transactionPromise(tx);
  }
  async function nextPending(key) {
    const db = await openDb();
    const tx = db.transaction('works', 'readonly');
    return requestPromise(tx.objectStore('works').index('pending').get([key, 0]));
  }
  async function savePage(key, meta, works, rawSize) {
    const db = await openDb();
    const tx = db.transaction(['works', 'meta'], 'readwrite');
    const store = tx.objectStore('works');
    const unique = new Map(works.map(w => [String(w.id), w]));
    let left = unique.size;
    let added = 0;
    const done = transactionPromise(tx);
    function finish() {
      meta.discovered += added;
      meta.nextPage++;
      if (!meta.pageSize && rawSize) meta.pageSize = rawSize;
      tx.objectStore('meta').put(meta);
    }
    if (!left) finish();
    for (const [id, work] of unique) {
      const rowKey = key + ':' + id;
      const req = store.get(rowKey);
      req.onsuccess = () => {
        if (!req.result) {
          added++;
          const direct = Number(work.bookmarkCount);
          const hasDirect = work.bookmarkCount != null && Number.isFinite(direct) && direct >= 0;
          store.put({ key: rowKey, searchKey: key, id, status: hasDirect ? 1 : 0,
            count: hasDirect ? direct : -1, title: work.title || work.illustTitle || '',
            userName: work.userName || '', thumb: work.url || '',
            date: work.createDate || '' });
          if (hasDirect) meta.processed++;
        }
        if (--left === 0) finish();
      };
    }
    await done;
  }
  async function saveDetail(meta, row, detail, skipped) {
    const db = await openDb();
    const tx = db.transaction(['works', 'meta'], 'readwrite');
    tx.objectStore('works').put({ ...row, status: skipped ? 2 : 1,
      count: skipped ? -1 : Number(detail.bookmarkCount),
      title: detail.title || row.title, userName: detail.userName || row.userName,
      thumb: row.thumb || detail.coverUrl || detail.url || (detail.urls && (detail.urls.thumb || detail.urls.small)) || '' });
    if (skipped) meta.skipped++;
    else meta.processed++;
    tx.objectStore('meta').put(meta);
    await transactionPromise(tx);
  }
  async function getTop(key, limit, minimum) {
    const db = await openDb();
    const tx = db.transaction('works', 'readonly');
    const index = tx.objectStore('works').index('rank');
    const range = IDBKeyRange.bound([key, minimum], [key, Number.MAX_SAFE_INTEGER]);
    return new Promise((resolve, reject) => {
      const out = [];
      const req = index.openCursor(range, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) return resolve(out);
        out.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error || new Error('順位を読み込めません'));
    });
  }
  async function getEligibleCount(key, minimum) {
    const db = await openDb();
    const tx = db.transaction('works', 'readonly');
    const range = IDBKeyRange.bound([key, minimum], [key, Number.MAX_SAFE_INTEGER]);
    return requestPromise(tx.objectStore('works').index('rank').count(range));
  }
  function abortIfNeeded(signal) {
    if (signal.aborted) throw new DOMException('中断されました', 'AbortError');
  }
  async function pacedJson(url, signal) {
    const wait = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve, reject) => {
      const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, wait);
      function onAbort() { clearTimeout(t); reject(new DOMException('中断されました', 'AbortError')); }
      signal.addEventListener('abort', onAbort, { once: true });
    });
    abortIfNeeded(signal);
    lastRequestAt = Date.now();
    const res = await fetch(url, { credentials: 'same-origin', signal, headers: { Accept: 'application/json' } });
    if (res.status === 429) throw new Error('429: pixivのアクセス制限です。自動再試行はしません。時間を置いてから再開してください。');
    if (res.status === 401 || res.status === 403) throw new Error('pixivへのアクセスが制限されています (HTTP ' + res.status + ')。');
    if (res.status === 404) { const e = new Error('404'); e.notFound = true; throw e; }
    if (!res.ok) {
      // 400はパラメータの不整合の可能性がある。pixiv側の応答を残し、再試行せず停止する。
      // HTMLのエラーページやCookie/トークンは表示しない。
      let reason = '';
      if (res.status === 400) {
        try {
          const data = await res.json();
          const message = data && (data.message || (data.body && data.body.message));
          if (typeof message === 'string') reason = message.slice(0, 180);
        } catch (_) { /* JSONでなければHTTPコードだけ表示 */ }
      }
      const e = new Error('通信エラー HTTP ' + res.status +
        (reason ? '：' + reason : '') +
        (res.status === 400 ? '。検索条件やAPIの仕様が変わっている可能性があります。' : ''));
      e.requestUrl = url;
      e.httpStatus = res.status;
      throw e;
    }
    const data = await res.json();
    if (!data || data.error) throw new Error((data && data.message) || 'pixivのAPIでエラーが発生しました');
    return data.body;
  }
  async function fetchPage(ctx, page, signal) {
    const u = new URL('/ajax/search/' + ctx.kind + '/' + encodeURIComponent(ctx.word), location.origin);
    u.search = ctx.params.toString();
    u.searchParams.set('order', 'date_d');
    u.searchParams.set('p', String(page));
    const body = await pacedJson(u.href, signal);
    const group = body && (ctx.kind === 'novels' ? body.novel : (body.illustManga || body.illust || body.manga));
    if (!group || !Array.isArray(group.data)) throw new Error('検索結果の形式が変わった可能性があります');
    return { total: Number(group.total), lastPage: Number(group.lastPage), data: group.data,
      works: group.data.filter(w => w && /^\d+$/.test(String(w.id)) && !w.isAdContainer) };
  }
  async function fetchDetail(id, kind, signal) {
    const route = kind === 'novels' ? 'novel' : 'illust';
    const body = await pacedJson('/ajax/' + route + '/' + encodeURIComponent(id), signal);
    if (!body || !Number.isFinite(Number(body.bookmarkCount))) throw new Error('ブックマーク数が取得できませんでした');
    return body;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; font-family: -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif; color-scheme:light; }
      * { box-sizing:border-box; }
      button,select,input { font:inherit; }
      .launch { position:fixed; right:12px; bottom:max(50px,env(safe-area-inset-bottom)); z-index:2147483645; border:0;
        border-radius:30px; color:#fff; background:#eb3e63; padding:13px 16px; font-size:14px; font-weight:700;
        box-shadow:0 4px 18px #0004; cursor:pointer; }
      .veil { display:none; position:fixed; z-index:2147483646; inset:0; background:#111a; }
      .veil.open { display:flex; }
      .panel { display:flex; flex-direction:column; margin:auto; width:min(1100px,100%); height:min(94dvh,100%);
        overflow:hidden; background:#f5f6fb; color:#232938; border-radius:16px; }
      .head { flex:none; padding:13px 15px; background:white; border-bottom:1px solid #e4e6ed; }
      .heading,.controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
      .heading { justify-content:space-between; } h2 { margin:0; font-size:17px; }
      .controls { margin-top:10px; } button,select,input { border-radius:8px; padding:9px 10px; border:1px solid #d4d8e1; background:white; color:#232938; font-size:13px; }
      button,select { cursor:pointer; }
      .min-filter { display:inline-flex; flex-wrap:wrap; align-items:center; gap:5px; font-size:13px; }
      .minimum { width:110px; min-width:80px; } .min-preset { max-width:132px; }
      .match-count { font-size:12px; font-weight:600; color:#bd2850; margin-top:6px; }
      button.primary { background:#eb3e63; border-color:#eb3e63; color:white; font-weight:bold; }
      button:disabled { opacity:.55; cursor:default; } .close { font-size:19px; padding:5px 10px; }
      .status { font-size:13px; line-height:1.5; margin-top:10px; white-space:pre-wrap; }
      .note { font-size:11px; color:#586277; line-height:1.5; margin:6px 0 0; }
      .debug-button[hidden] { display:none; }
      .results { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:13px;
        display:grid; grid-template-columns:repeat(auto-fill,minmax(145px,1fr)); align-content:start; gap:11px; }
      a.card { display:flex; flex-direction:column; min-width:0; border-radius:9px; overflow:hidden;
        text-decoration:none; background:white; color:#232938; box-shadow:0 1px 5px #1315231b; }
      img { width:100%; aspect-ratio:1/1; object-fit:cover; background:#e6e9ef; }
      a.novel img { aspect-ratio:3/4; object-fit:contain; }
      .info { padding:8px; } .count { font-size:14px; color:#e33159; font-weight:800; }
      .name { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
        font-size:12px; line-height:1.5; font-weight:600; }
      .author { font-size:11px; color:#657187; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
      @media (max-width:600px) { .panel { height:100dvh; border-radius:0; } .head { padding:10px; }
        .results { grid-template-columns:repeat(2,minmax(0,1fr)); padding:9px; gap:9px; } }
    </style>
    <button type="button" class="launch">♥ 全体ブクマ順</button>
    <div class="veil" role="dialog" aria-modal="true" aria-label="検索結果を横断したブックマーク数順">
      <section class="panel">
        <div class="head">
          <div class="heading"><h2>♥ 検索結果をブックマーク数順に</h2><button class="close" type="button" aria-label="閉じる">×</button></div>
          <div class="controls">
            <button type="button" class="start primary">全件の調査を開始／再開</button>
            <button type="button" class="stop" disabled>一時停止</button>
            <button type="button" class="reset">保存結果を消して再調査</button>
            <select class="limit" aria-label="一覧に表示する件数"><option value="100">上位100件</option><option value="300">上位300件</option><option value="1000">上位1000件</option></select>
            <label class="min-filter">最低ブクマ数 <input class="minimum" type="number" inputmode="numeric" min="0" max="1000000000" step="1" aria-label="最低ブックマーク数" value="0">件以上</label>
            <select class="min-preset" aria-label="最低ブックマーク数の候補"><option value="custom">件数を選ぶ</option><option value="0">指定なし</option><option value="100">100件以上</option><option value="500">500件以上</option><option value="1000">1,000件以上</option><option value="5000">5,000件以上</option><option value="10000">10,000件以上</option></select>
          </div>
          <div class="status" aria-live="polite">検索条件を確認しています…</div>
          <button type="button" class="debug-button" hidden>エラーの診断用URLを表示</button>
          <div class="match-count" aria-live="polite"></div>
          <p class="note">イラスト・漫画・小説の検索結果に対応。小説はpixivの検索条件をできるだけ引き継ぎ、取得できた作品を調査します。対象は検索結果の各ページです。調査済み作品から順位を表示し、途中で止めても保存されます。調査完了前の順位は暫定です。最低ブクマ数は表示を絞るもので、無料アカウントの検索時の取得件数は減りません。保存済みデータは下限を変更しても消えません。<br>作品数が多い場合は長時間かかり、pixivのページ・アクセス制限によって全件を取得できないことがあります。通信エラー時は停止し、制限の迂回はしません。閲覧できない作品は順位に含まれません。</p>
        </div>
        <div class="results"></div>
      </section>
    </div>`;
  document.body.appendChild(host);
  const $ = s => root.querySelector(s);
  const launch = $('.launch');
  const veil = $('.veil');
  const startBtn = $('.start');
  const stopBtn = $('.stop');
  const resetBtn = $('.reset');
  const status = $('.status');
  const results = $('.results');
  const limitSelect = $('.limit');
  const minInput = $('.minimum');
  const minPreset = $('.min-preset');
  const matchCount = $('.match-count');
  const debugButton = $('.debug-button');
  minInput.value = String(minBookmarks);
  if ([0, 100, 500, 1000, 5000, 10000].includes(minBookmarks)) minPreset.value = String(minBookmarks);

  function setStatus(text) { status.textContent = text; }
  function showRequestError(error) {
    lastFailedRequest = error && error.requestUrl || null;
    debugButton.hidden = !lastFailedRequest;
  }
  function stats(meta, suffix = '') {
    const expected = Number.isFinite(meta.total) ? fmt.format(meta.total) : '不明';
    return `${currentContext && currentContext.kind === 'novels' ? '小説' : 'イラスト・漫画'}の検索結果：約${expected}作品 ｜ 発見 ${fmt.format(meta.discovered)}件 ｜ ブクマ確認 ${fmt.format(meta.processed)}件 ｜ 閲覧不可 ${fmt.format(meta.skipped)}件\n` +
      (meta.searchDone ? '検索ページの取得終了' : `次の検索ページ：${meta.nextPage}`) +
      (suffix ? ` ｜ ${suffix}` : '') + (meta.note ? '\n' + meta.note : '');
  }
  function makeCard(row) {
    const a = document.createElement('a');
    a.className = 'card';
    const isNovel = currentContext && currentContext.kind === 'novels';
    if (isNovel) a.classList.add('novel');
    a.href = (isNovel ? '/novel/show.php?id=' : '/artworks/') + row.id;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.alt = row.title || '作品のサムネイル';
    if (/^https:\/\/(?:i|s)\.pximg\.net\//.test(row.thumb)) image.src = row.thumb;
    const info = document.createElement('div'); info.className = 'info';
    const count = document.createElement('div'); count.className = 'count';
    count.textContent = '♥ ' + fmt.format(row.count);
    const title = document.createElement('div'); title.className = 'name'; title.textContent = row.title || '無題';
    const author = document.createElement('div'); author.className = 'author'; author.textContent = row.userName || '';
    info.append(count, title, author); a.append(image, info);
    return a;
  }
  async function renderTop(key) {
    if (!key || queryKey !== key || !veil.classList.contains('open')) return;
    const sequence = ++renderSequence;
    const minimum = minBookmarks;
    const limit = listLimit;
    const [top, eligibleCount] = await Promise.all([
      getTop(key, limit, minimum), getEligibleCount(key, minimum)
    ]);
    if (queryKey !== key || sequence !== renderSequence || !veil.classList.contains('open')) return;
    results.replaceChildren(...top.map(makeCard));
    matchCount.textContent = `確認済みで ♥ ${fmt.format(minimum)}件以上：${fmt.format(eligibleCount)}作品（表示 ${fmt.format(top.length)}作品）`;
    if (!top.length) {
      const p = document.createElement('p');
      p.textContent = minimum > 0
        ? `確認済み作品にはブックマーク${fmt.format(minimum)}件以上の作品がまだありません。調査を進めるか、最低件数を下げてください。`
        : '確認済みの作品はまだありません。調査を開始してください。';
      p.style.cssText = 'font-size:13px;color:#647087;grid-column:1/-1;';
      results.appendChild(p);
    }
  }
  function scheduleRender(key, immediate = false) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      renderTop(key).catch(e => setStatus('表示エラー：' + e.message));
    }, immediate ? 0 : 600);
  }
  function stop() { if (active) active.abort(); }
  function buttons(running) { startBtn.disabled = running; stopBtn.disabled = !running; }
  async function refresh() {
    const ctx = contextFromUrl();
    launch.style.display = ctx ? '' : 'none';
    if (!ctx) { stop(); veil.classList.remove('open'); return; }
    if (queryKey !== ctx.key) {
      stop();
      queryKey = ctx.key;
      currentContext = ctx;
      showRequestError(null);
      results.replaceChildren();
      matchCount.textContent = '';
      setStatus('検索条件：' + ctx.word + '（' + (ctx.kind === 'novels' ? '小説' : 'イラスト・漫画') + '）\n保存済みの調査結果を読み込んでいます…');
    }
    if (!veil.classList.contains('open')) return;
    try {
      const m = await getMeta(ctx.key);
      if (queryKey !== ctx.key) return;
      setStatus('検索条件：' + ctx.word + '\n' + stats(m, active ? '調査中' : '開始／再開できます'));
      scheduleRender(ctx.key, true);
    } catch (e) { setStatus('保存領域が使えません：' + e.message); }
  }

  async function runScan(ctx, ctrl) {
    let meta = await getMeta(ctx.key);
    if (meta.searchDone && !await nextPending(ctx.key)) {
      setStatus(stats(meta, 'APIから取得できた範囲の調査は終了しています'));
      scheduleRender(ctx.key, true);
      return;
    }
    while (true) {
      abortIfNeeded(ctrl.signal);
      if (ctx.key !== queryKey) throw new DOMException('検索条件が変更されました', 'AbortError');
      const pending = await nextPending(ctx.key);
      if (pending) {
        setStatus(stats(meta, '作品のブクマ数を確認中'));
        try {
          const detail = await fetchDetail(pending.id, ctx.kind, ctrl.signal);
          await saveDetail(meta, pending, detail, false);
        } catch (e) {
          if (e.notFound) await saveDetail(meta, pending, {}, true);
          else throw e;
        }
        if (meta.processed % 5 === 0) scheduleRender(ctx.key);
        continue;
      }
      if (meta.searchDone) {
        meta.note = meta.skipped ? '一部の作品は削除・閲覧不可のため順位に含まれません。' : meta.note;
        await putMeta(meta);
        setStatus(stats(meta, '取得できた検索ページの調査が終了しました'));
        scheduleRender(ctx.key, true);
        return;
      }
      if (meta.nextPage > MAX_PAGES_SAFETY) {
        meta.note = `安全上、${MAX_PAGES_SAFETY}ページで停止しました。検索全件を取得したわけではありません。`;
        await putMeta(meta);
        setStatus(stats(meta, 'ページの上限で停止'));
        scheduleRender(ctx.key, true);
        return;
      }
      setStatus(stats(meta, `検索ページ ${meta.nextPage} を取得中`));
      const page = await fetchPage(ctx, meta.nextPage, ctrl.signal);
      if (Number.isFinite(page.total)) meta.total = page.total;
      if (Number.isInteger(page.lastPage) && page.lastPage > 0) meta.lastPage = page.lastPage;
      if (!page.data.length) {
        meta.searchDone = true;
        await putMeta(meta);
        continue;
      }
      const pageNumber = meta.nextPage;
      await savePage(ctx.key, meta, page.works, page.data.length);
      // 検索件数が実際に取得されたページ数と整合する場合だけ末尾を判定。
      if (Number.isFinite(meta.total) && meta.total >= 0 && meta.pageSize &&
          pageNumber * meta.pageSize >= meta.total) {
        meta.searchDone = true;
        await putMeta(meta);
      } else if (meta.lastPage && pageNumber >= meta.lastPage) {
        // 公開APIの返却可能ページ数が検索総件数より少ない場合は、全件調査と誤表示しない。
        meta.searchDone = true;
        meta.note = `pixiv側が返した最終ページ（${meta.lastPage}ページ）まで取得しました。検索総件数の全作品を取得できたとは限りません。`;
        await putMeta(meta);
      }
      scheduleRender(ctx.key);
    }
  }
  function start() {
    if (active || !currentContext) return;
    const ctx = currentContext;
    const ctrl = new AbortController();
    active = ctrl;
    showRequestError(null);
    buttons(true);
    runScan(ctx, ctrl).catch(e => {
      if (e.name === 'AbortError') setStatus('一時停止しました。結果は保存済みです。再開できます。');
      else {
        showRequestError(e);
        setStatus('調査を停止しました：' + e.message + '\n保存済みの結果は残っています。' +
          (e.httpStatus === 400 ? '\n「エラーの診断用URLを表示」から内容を確認できます。' : ''));
      }
    }).finally(() => {
      if (active === ctrl) { active = null; buttons(false); }
      scheduleRender(ctx.key, true);
    });
  }
  launch.addEventListener('click', () => { veil.classList.add('open'); refresh(); });
  $('.close').addEventListener('click', () => { stop(); veil.classList.remove('open'); });
  veil.addEventListener('click', e => { if (e.target === veil) { stop(); veil.classList.remove('open'); } });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { stop(); veil.classList.remove('open'); } });
  debugButton.addEventListener('click', () => {
    if (!lastFailedRequest) return;
    // iPhone・Macaqueでもコピーできるよう、選択可能な標準入力ダイアログを使う。
    prompt('失敗したpixivのリクエストURLです。個人の検索語を含むので、共有前に確認してください。', lastFailedRequest);
  });
  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  resetBtn.addEventListener('click', async () => {
    if (active || !queryKey) return;
    if (!confirm('この検索条件について、保存した作品とブックマーク数を削除して最初から調べ直しますか？')) return;
    resetBtn.disabled = true;
    try { await clearSearch(queryKey); await refresh(); }
    catch (e) { setStatus('保存結果を削除できませんでした：' + e.message); }
    finally { resetBtn.disabled = false; }
  });
  limitSelect.addEventListener('change', () => { listLimit = Number(limitSelect.value); scheduleRender(queryKey, true); });
  function applyMinimum(value) {
    const next = normalizeMinBookmarks(value);
    minBookmarks = next;
    minInput.value = String(next);
    minPreset.value = [0, 100, 500, 1000, 5000, 10000].includes(next) ? String(next) : 'custom';
    try { localStorage.setItem(MIN_PREF_KEY, String(next)); } catch (_) { /* 保存できない環境でも画面内の設定は有効 */ }
    scheduleRender(queryKey, true);
  }
  minInput.addEventListener('change', () => applyMinimum(minInput.value));
  minInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { applyMinimum(minInput.value); minInput.blur(); }
  });
  minPreset.addEventListener('change', () => {
    if (minPreset.value !== 'custom') applyMinimum(minPreset.value);
    else minInput.focus();
  });
  const observeLocation = () => {
    const ctx = contextFromUrl();
    if ((!ctx && queryKey) || (ctx && ctx.key !== queryKey)) refresh();
  };
  setInterval(observeLocation, 1200);
  refresh();
})();

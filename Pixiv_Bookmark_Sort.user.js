// ==UserScript==
// @name         Pixiv イラスト・小説 ブクマ順・新着順（検索結果横断）
// @namespace    local.pixiv.bookmark-sort.cross-page
// @version      0.5.5
// @description  既存の検索調査結果をブクマ順・新着順で表示。投稿日フィルターと期間を検索条件に反映。小説対応。
// @match        https://www.pixiv.net/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @require      https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/9eb97e51cedba0d081db3cc7331ecc8c01ea6685/Pixiv_Bookmark_Sort.user.js
// ==/UserScript==
(() => {
  'use strict';
  // The pinned v0.5.2 engine alone owns acquisition and the existing IndexedDB schema.
  // Replace the v0.5.3/0.5.4 display layers with ONE viewer; never clear the research DB.
  if (window.__pixivCrossViewerV055) return;
  window.__pixivCrossViewerV055 = true;
  const HOST_ID = 'pixiv-bookmark-sort-cross-page-v05';
  const RESEARCH_DB = 'pixiv-bookmark-sort-cross-page-v02';
  const EXTRA_DB = 'pixiv-bookmark-sort-extras-v01';
  const SORT_KEY = 'pixiv-bsort-view-sort-v055';
  const MAX_VIEW = 1000;
  const DETAIL_WAIT = 2600;
  const $new = (tag, klass, text) => {
    const e = document.createElement(tag);
    if (klass) e.className = klass;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const day = value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (!match) return '';
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    const timestamp = Date.parse(iso + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso ? iso : '';
  };
  const idNum = value => /^\d+$/.test(String(value)) ? Number(value) : 0;
  function better(a, b, sort) {
    // Positive means a ranks above b. Unknown dates go last for newest sorting.
    const da = day(a.date), db = day(b.date);
    if (sort === 'newest' && da !== db) return da > db ? 1 : -1;
    if (Number(a.count) !== Number(b.count)) return Number(a.count) > Number(b.count) ? 1 : -1;
    if (sort !== 'newest' && da !== db) return da > db ? 1 : -1;
    return idNum(a.id) > idNum(b.id) ? 1 : idNum(a.id) < idNum(b.id) ? -1 : 0;
  }
  function allowedDate(row, from, to) {
    if (!from && !to) return true;
    const d = day(row.date);
    return !!d && (!from || d >= from) && (!to || d <= to);
  }
  function searchContext() {
    // Identical search-key construction to the pinned v0.5.2 engine.
    const u = new URL(location.href);
    const m = u.pathname.match(/^\/tags\/([^/]+)(?:\/(artworks|illustrations|manga|novels))?(?:\/|$)/);
    let word, kind, mode;
    if (m) {
      try { word = decodeURIComponent(m[1]); } catch { return null; }
      kind = m[2] || 'artworks'; mode = u.searchParams.get('s_mode') || 's_tag_full';
    } else if (u.pathname === '/novel/search.php') {
      word = u.searchParams.get('word') || u.searchParams.get('q');
      kind = 'novels'; mode = u.searchParams.get('s_mode') || 's_tag';
    } else if (['/search', '/search.php'].includes(u.pathname)) {
      word = u.searchParams.get('word') || u.searchParams.get('q');
      const t = u.searchParams.get('type');
      kind = ['novel', 'novels'].includes(t) ? 'novels' : t === 'manga' ? 'manga' : ['illust', 'illustrations'].includes(t) ? 'illustrations' : 'artworks';
      mode = u.searchParams.get('s_mode') || 's_tag';
    } else return null;
    if (!word) return null;
    const p = new URLSearchParams(), art = kind !== 'novels';
    for (const key of ['mode', 'scd', 'ecd', 'ai_type', 'work_lang', 'lang', ...(art ? ['wlt', 'wgt', 'hlt', 'hgt', 'ratio', 'tool'] : ['tlt', 'tgt', 'wlt', 'wgt', 'original_only', 'genre'])]) {
      for (const v of u.searchParams.getAll(key)) p.append(key, v);
    }
    mode = mode === 'tag_tc' ? (art ? 's_tag_tc' : 's_tag') : mode === 'tc' ? 's_tc' : mode;
    p.set('word', word); p.set('s_mode', mode); p.set('mode', p.get('mode') || 'all');
    if (art) {
      p.set('csw', '0');
      if (kind === 'artworks') p.set('type', 'all');
      else if (kind === 'manga') p.set('type', 'manga');
      else if (kind === 'illustrations') {
        const t = u.searchParams.get('type');
        if (['illust', 'ugoira', 'illust_and_ugoira'].includes(t)) p.set('type', t);
      }
    } else {
      const gs = u.searchParams.get('gs');
      if (['0', '1'].includes(gs)) p.set('gs', gs);
    }
    p.sort();
    return {key: JSON.stringify([kind, word, [...p.entries()]]), kind, word,
      from: day(u.searchParams.get('scd')), to: day(u.searchParams.get('ecd'))};
  }
  let researchPromise, extraPromise;
  function openDb(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // Never create/upgrade the research database here: only the pinned engine may do so.
    });
  }
  const researchDb = () => researchPromise ||= openDb(RESEARCH_DB).catch(err => { researchPromise = null; throw err; });
  function extrasDb() {
    if (!extraPromise) extraPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(EXTRA_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('details')) req.result.createObjectStore('details', {keyPath:'key'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
    return extraPromise;
  }
  function fromStore(db, key) {
    return new Promise(resolve => {
      try {
        const req = db.transaction('details', 'readonly').objectStore('details').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  function saveExtra(db, item) {
    try { db.transaction('details', 'readwrite').objectStore('details').put(item); } catch { /* extra metadata is optional */ }
  }
  function topRows(key, minimum, sort, from, to, max = MAX_VIEW) {
    return researchDb().then(db => new Promise((resolve, reject) => {
      let matched = 0, unknownDates = 0;
      const heap = [];
      const worse = (a, b) => better(a, b, sort) < 0;
      function push(row) {
        heap.push(row);
        let i = heap.length - 1;
        while (i) {
          const parent = (i - 1) >> 1;
          if (!worse(heap[i], heap[parent])) break;
          [heap[i], heap[parent]] = [heap[parent], heap[i]]; i = parent;
        }
      }
      function replace(row) {
        heap[0] = row;
        for (let i = 0; ; ) {
          let child = i * 2 + 1;
          if (child >= heap.length) break;
          if (child + 1 < heap.length && worse(heap[child + 1], heap[child])) child++;
          if (!worse(heap[child], heap[i])) break;
          [heap[i], heap[child]] = [heap[child], heap[i]]; i = child;
        }
      }
      try {
        if (!db.objectStoreNames.contains('works')) throw new Error('調査DBがまだ作成されていません');
        const tx = db.transaction('works', 'readonly');
        const index = tx.objectStore('works').index('rank');
        const lower = Math.max(0, Number(minimum) || 0);
        const range = IDBKeyRange.bound([key, lower], [key, Number.MAX_SAFE_INTEGER]);
        const req = index.openCursor(range);
        req.onerror = () => reject(req.error || new Error('調査データを読み込めません'));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            heap.sort((a, b) => better(b, a, sort));
            resolve({rows: heap, matched, unknownDates}); return;
          }
          const row = cursor.value;
          if (!day(row.date)) unknownDates++;
          if (allowedDate(row, from, to)) {
            matched++;
            if (heap.length < max) push(row);
            else if (better(row, heap[0], sort) > 0) replace(row);
          }
          cursor.continue();
        };
      } catch (err) { reject(err); }
    }));
  }
  const extras = new Map(), extrasQueue = [], extrasPending = new Set();
  let extraBusy = false, extraHalted = false, lastExtraRequest = 0;
  let overlay, results, summary, extraStatus, sortSelect, fromInput, toInput, limitSelect, minInput;
  let viewContext = null, viewSeq = 0, viewTimer, open = false, observer;
  let attached = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  function extraKey(row) {
    const novel = viewContext?.kind === 'novels';
    return (novel ? 'novel:' : 'illust:') + row.id;
  }
  function excerpt(html) {
    const d = new DOMParser().parseFromString(String(html || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n'), 'text/html');
    const text = (d.body.textContent || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]*\n+/g, '\n').trim();
    const chars = Array.from(text);
    return chars.slice(0, 180).join('') + (chars.length > 180 ? '…' : '');
  }
  function drawExtra(node, extra) {
    if (!node.isConnected) return;
    node.replaceChildren();
    const tags = $new('div', 'pbs-extra-tags');
    for (const tag of extra.tags || []) tags.append($new('span', 'pbs-extra-tag', '#' + tag));
    if (!tags.childNodes.length) tags.textContent = 'タグなし';
    node.append(tags, $new('div', 'pbs-extra-caption', extra.caption ? 'キャプション：' + extra.caption : 'キャプションの記載なし'));
  }
  function queueExtra(key, node) {
    if (!key || extrasPending.has(key) || extraHalted || !open) return;
    if (extras.has(key)) { drawExtra(node, extras.get(key)); return; }
    extrasPending.add(key); extrasQueue.push({key, node}); void processExtras();
  }
  async function processExtras() {
    if (extraBusy || extraHalted || !open) return;
    extraBusy = true;
    try {
      while (open && extrasQueue.length && !extraHalted) {
        const {key, node} = extrasQueue.shift();
        if (!node.isConnected) { extrasPending.delete(key); continue; }
        let item = extras.get(key);
        if (!item) {
          const db = await extrasDb();
          if (db) item = await fromStore(db, key);
          if (!item) {
            const remaining = Math.max(0, DETAIL_WAIT - (Date.now() - lastExtraRequest));
            if (remaining) await pause(remaining);
            if (!open) { extrasPending.delete(key); break; }
            lastExtraRequest = Date.now();
            let response;
            try { response = await fetch('/ajax/' + key.replace(':', '/'), {credentials:'same-origin', headers:{Accept:'application/json'}}); }
            catch { extraHalted = true; extraStatus.textContent = '追加情報の通信に失敗しました。再読み込み後にお試しください。'; break; }
            if (!response.ok) {
              if (response.status === 404) { node.textContent = '作品情報がありません（404）'; extrasPending.delete(key); continue; }
              extraHalted = true; extraStatus.textContent = `追加情報を停止しました（HTTP ${response.status}）。時間を置いて再読み込みしてください。`; break;
            }
            const json = await response.json().catch(() => null);
            if (!json?.body || json.error) { extraHalted = true; extraStatus.textContent = '追加情報を確認できず停止しました。'; break; }
            const raw = Array.isArray(json.body.tags) ? json.body.tags : json.body.tags?.tags;
            const tags = Array.isArray(raw) ? raw.map(t => typeof t === 'string' ? t : t?.tag).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [];
            item = {key, tags:[...new Set(tags)], caption:excerpt(json.body.description || json.body.caption || '')};
            if (db) saveExtra(db, item);
          }
          extras.set(key, item);
        }
        extrasPending.delete(key);
        drawExtra(node, item);
      }
    } finally { extraBusy = false; }
  }
  function hide() {
    open = false; ++viewSeq; clearTimeout(viewTimer);
    observer?.disconnect(); observer = null;
    extrasQueue.length = 0; extrasPending.clear();
    overlay?.classList.remove('pbs-open');
  }
  function resultLink(row) {
    return (viewContext?.kind === 'novels' ? '/novel/show.php?id=' : '/artworks/') + row.id;
  }
  function renderList() {
    if (!open || !viewContext) return;
    const ctx = viewContext, token = ++viewSeq;
    const from = day(fromInput.value), to = day(toInput.value);
    if ((fromInput.value && !from) || (toInput.value && !to) || (from && to && from > to)) {
      summary.textContent = '投稿日を確認してください。開始日は終了日以前に指定してください。'; results.replaceChildren(); return;
    }
    const min = Math.max(0, Number(minInput.value) || 0);
    const max = Number(limitSelect.value) || 100;
    summary.textContent = '保存済みの調査データを並べ替え中…';
    topRows(ctx.key, min, sortSelect.value, from, to, max).then(({rows, matched, unknownDates}) => {
      if (!open || token !== viewSeq || ctx.key !== viewContext?.key) return;
      summary.textContent = `${ctx.kind === 'novels' ? '小説' : 'イラスト・漫画'}「${ctx.word}」／ ${sortSelect.value === 'newest' ? '投稿日が新しい順' : 'ブクマ数が多い順'} ／ 条件一致 ${matched.toLocaleString('ja-JP')}件・表示 ${rows.length}件${(from || to) && unknownDates ? `（投稿日不明 ${unknownDates}件は期間指定から除外）` : ''}`;
      observer?.disconnect(); observer = null;
      results.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (const w of rows) {
        const link = $new('a', 'pbs-new-row');
        link.href = resultLink(w); link.target = '_blank'; link.rel = 'noopener noreferrer';
        const image = $new('img'); image.loading = 'lazy'; image.alt = w.title || '作品';
        if (/^https:\/\/(i|s)\.pximg\.net\//.test(w.thumb || '')) image.src = w.thumb;
        const info = $new('div', 'pbs-new-info');
        info.append($new('div', 'pbs-new-bookmarks', '♥ ' + Number(w.count).toLocaleString('ja-JP')),
          $new('div', 'pbs-new-title', w.title || '無題'),
          $new('div', 'pbs-new-author', w.userName || ''),
          $new('div', 'pbs-new-date', '投稿日：' + (day(w.date) || '未取得')));
        const extra = $new('div', 'pbs-extra', 'タグ・キャプションを読み込み待ち…');
        extra.dataset.key = extraKey(w);
        info.append(extra); link.append(image, info); fragment.append(link);
      }
      if (!rows.length) fragment.append($new('p', 'pbs-new-empty', '該当する保存済み作品がありません。調査を進めるか、絞り込みを変えてください。'));
      results.append(fragment);
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(entries => {
          for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); queueExtra(entry.target.dataset.key, entry.target); }
        }, {root:overlay, rootMargin:'160px 0px'});
        for (const e of results.querySelectorAll('.pbs-extra')) {
          const cached = extras.get(e.dataset.key);
          if (cached) drawExtra(e, cached);
          else observer.observe(e);
        }
      } else {
        for (const e of [...results.querySelectorAll('.pbs-extra')].slice(0, 20)) queueExtra(e.dataset.key, e);
      }
      extraStatus.textContent = extraHalted ? extraStatus.textContent : 'タグ・キャプションは画面に見える作品から順に追加取得します。';
    }).catch(err => { if (open && token === viewSeq) summary.textContent = '保存済み結果を開けません：' + (err?.message || err); });
  }
  function scheduleRender() {
    if (!open) return;
    clearTimeout(viewTimer); viewTimer = setTimeout(renderList, 900);
  }
  function applyDatesToSearch() {
    const from = day(fromInput.value), to = day(toInput.value);
    if ((fromInput.value && !from) || (toInput.value && !to) || (from && to && from > to)) {
      summary.textContent = '日付の範囲を確認してください。'; return;
    }
    const u = new URL(location.href);
    if (from) u.searchParams.set('scd', from); else u.searchParams.delete('scd');
    if (to) u.searchParams.set('ecd', to); else u.searchParams.delete('ecd');
    u.searchParams.delete('p');
    hide();
    location.assign(u.href);
  }
  function init() {
    if (attached) return true;
    const host = document.getElementById(HOST_ID), root = host?.shadowRoot;
    const source = root?.querySelector('.results');
    const counted = root?.querySelector('.counted');
    if (!source || !counted) return false;
    attached = true;
    const css = $new('style');
    css.textContent = `
      .pbs-new-button{display:block!important;width:100%!important;margin:10px 0 0!important;padding:13px!important;background:#1976d2!important;color:#fff!important;border:0!important;border-radius:9px!important;font-weight:700!important;font-size:15px!important}
      .pbs-new-overlay{display:none!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;z-index:2147483647!important;background:#f5f6fb!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;color:#263040!important;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif!important}
      .pbs-new-overlay.pbs-open{display:block!important}.pbs-new-header{position:sticky;top:0;z-index:1;background:#fff;border-bottom:1px solid #dce1e9;padding:12px}.pbs-new-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.pbs-new-toolbar strong{font-size:17px}.pbs-new-filters{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:10px}.pbs-new-filters label{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:12px}.pbs-new-filters input[type=date]{width:145px;max-width:100%}.pbs-new-filters input[type=number]{width:95px}.pbs-new-filters select{max-width:100%}.pbs-new-summary,.pbs-extra-status{font-size:12px;color:#586277;margin-top:8px;line-height:1.5}.pbs-new-list{max-width:920px;margin:auto;padding:10px 10px 75px}.pbs-new-row{display:flex;align-items:flex-start;gap:12px;background:white;color:#263040!important;text-decoration:none!important;border:1px solid #e2e6ed;border-radius:10px;padding:10px;margin-bottom:10px}.pbs-new-row img{width:76px;height:100px;flex:none;object-fit:contain;background:#eef0f4}.pbs-new-info{min-width:0;flex:1;overflow-wrap:anywhere}.pbs-new-bookmarks{font-weight:800;color:#c52650;font-size:16px}.pbs-new-title{font-weight:700;margin-top:4px}.pbs-new-author,.pbs-new-date{font-size:12px;color:#667286;margin-top:4px}.pbs-extra{margin-top:9px;font-size:12px;color:#4b5870}.pbs-extra-tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}.pbs-extra-tag{border-radius:5px;padding:2px 5px;background:#edf5fe;color:#24689d;font-size:11px}.pbs-extra-caption{white-space:pre-line;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden}.pbs-new-empty{padding:15px;color:#586277}.pbs-new-help{color:#586277;font-size:11px;margin-top:7px}.pbs-new-overlay button,.pbs-new-overlay input,.pbs-new-overlay select{font:inherit;border:1px solid #d5d9e2;border-radius:7px;background:white;color:#263040;padding:7px;max-width:100%}.pbs-new-overlay .pbs-new-apply{background:#1976d2;color:white;border:0}
      @media(max-width:600px){.pbs-new-header{padding:10px}.pbs-new-filters{gap:7px}.pbs-new-filters label{font-size:11px}.pbs-new-filters input[type=date]{width:133px}.pbs-new-row img{width:66px;height:88px}}
    `;
    root.append(css);
    const openButton = $new('button', 'pbs-new-button', '📚 ブクマ順・新着順の結果を見る');
    openButton.type = 'button'; counted.after(openButton);
    overlay = $new('section', 'pbs-new-overlay');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    const header = $new('div', 'pbs-new-header');
    const bar = $new('div', 'pbs-new-toolbar');
    const heading = $new('strong', '', '♥ 検索結果');
    const back = $new('button', '', '← 調査画面へ戻る'); back.type = 'button';
    bar.append(heading, back);
    const filters = $new('div', 'pbs-new-filters');
    sortSelect = $new('select'); sortSelect.setAttribute('aria-label','結果の並び順');
    sortSelect.append(new Option('♥ ブクマ数が多い順', 'bookmarks'), new Option('🕒 投稿日が新しい順', 'newest'));
    try {sortSelect.value = localStorage.getItem(SORT_KEY) === 'newest' ? 'newest' : 'bookmarks';} catch {sortSelect.value = 'bookmarks';}
    limitSelect = $new('select'); limitSelect.setAttribute('aria-label','表示する作品数');
    limitSelect.append(new Option('100件表示','100'),new Option('300件表示','300'),new Option('1000件表示','1000'));
    const sortLabel = $new('label', '', '並び順'); sortLabel.append(sortSelect);
    const limitLabel = $new('label', '', '表示数'); limitLabel.append(limitSelect);
    minInput = $new('input'); minInput.type='number'; minInput.min='0'; minInput.max='1000000000'; minInput.value='0'; minInput.inputMode='numeric';
    const minLabel = $new('label', '', '最低ブクマ'); minLabel.append(minInput);
    fromInput = $new('input'); fromInput.type='date'; fromInput.setAttribute('aria-label','投稿日・開始日');
    toInput = $new('input'); toInput.type='date'; toInput.setAttribute('aria-label','投稿日・終了日');
    const fromLabel = $new('label', '', '投稿日から'); fromLabel.append(fromInput);
    const toLabel = $new('label', '', 'まで'); toLabel.append(toInput);
    const applyButton = $new('button', 'pbs-new-apply', 'この期間で検索'); applyButton.type='button';
    filters.append(sortLabel, limitLabel, minLabel, fromLabel, toLabel, applyButton);
    summary = $new('div', 'pbs-new-summary');
    const help = $new('div', 'pbs-new-help', '日付はまず保存済み作品を絞り込みます。「この期間で検索」を押すとpixivの検索条件にも適用し、対象期間の調査を別データとして開始・再開できます。未調査の作品は一覧に含まれません。');
    extraStatus = $new('div', 'pbs-extra-status');
    header.append(bar, filters, summary, help, extraStatus);
    results = $new('div', 'pbs-new-list'); overlay.append(header, results); root.append(overlay);
    openButton.addEventListener('click', () => {
      viewContext = searchContext();
      if (!viewContext) { window.alert('Pixivのタグ検索・作品検索ページから開いてください。'); return; }
      const baseMinimum = root.querySelector('.minimum');
      minInput.value = baseMinimum?.value || '0';
      fromInput.value = viewContext.from;
      toInput.value = viewContext.to;
      open = true; overlay.classList.add('pbs-open'); overlay.scrollTop = 0;
      renderList();
    });
    back.addEventListener('click', hide);
    root.querySelector('.close')?.addEventListener('click', hide);
    for (const control of [sortSelect, limitSelect, minInput, fromInput, toInput]) {
      control.addEventListener('change', () => {
        if (control === sortSelect) try {localStorage.setItem(SORT_KEY, sortSelect.value);} catch {}
        scheduleRender();
      });
    }
    applyButton.addEventListener('click', applyDatesToSearch);
    new MutationObserver(scheduleRender).observe(source, {childList:true});
    new MutationObserver(scheduleRender).observe(counted, {childList:true,characterData:true,subtree:true});
    return true;
  }
  if (!init()) {
    let tries = 0;
    const timer = setInterval(() => {if (init() || ++tries >= 120) clearInterval(timer);},250);
  }
})();

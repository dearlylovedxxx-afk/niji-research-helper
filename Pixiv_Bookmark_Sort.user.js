// ==UserScript==
// @name         Pixiv イラスト・小説 ブクマ順（検索結果横断）
// @namespace    local.pixiv.bookmark-sort.cross-page
// @version      0.5.9
// @description  既存の検索調査結果をブクマ順・新着順で表示。投稿日フィルターと期間を検索条件に反映。小説TXT編集・保存対応。
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


// ---- Novel TXT editor/exporter (integrated in v0.5.9) ----
(() => {
  'use strict';
  if (window.__pixivNovelTextExportV059) return;
  window.__pixivNovelTextExportV059 = true;

  const ROOT_ID = 'pnte-root';
  const BTN_ID = 'pnte-button';
  const STYLE_ID = 'pnte-style';

  let original = null;
  let overlay = null;
  let pageHost = null;
  let statusNode = null;
  let metaToggle = null;
  let dialogueSpacingToggle = null;

  const novelId = () => {
    const u = new URL(location.href);
    return u.pathname === '/novel/show.php' && /^\d+$/.test(u.searchParams.get('id') || '')
      ? u.searchParams.get('id')
      : null;
  };

  const sleepFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

  function normalizeNewlines(text) {
    return String(text ?? '').replace(/\r\n?/g, '\n');
  }

  function decodeEntities(text) {
    const t = document.createElement('textarea');
    t.innerHTML = String(text ?? '');
    return t.value;
  }

  function cleanupPlainText(text) {
    return normalizeNewlines(text)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function pixivMarkupToText(raw) {
    let text = normalizeNewlines(raw);

    // Preserve useful textual information while removing presentation-only pixiv tags.
    text = text.replace(/\[chapter:([^\]\n]*)\]/g, (_, title) => `\n${title.trim()}\n`);
    text = text.replace(/\[PARAGRAPH\]/g, '\n');
    text = text.replace(/\\n/g, '\n');
    text = text.replace(/\[uploadedimage:[^\]\n]*\]/g, '');
    text = text.replace(/\[pixivimage:[^\]\n]*\]/g, '');
    text = text.replace(/\[jump:\d+\]/g, '');
    text = text.replace(/\[\[jumpuri:([\s\S]*?)\s*>\s*[^\]]+\]\]/g, (_, label) => label.trim());
    text = text.replace(/\[\[rb:([\s\S]*?)\s*>\s*([^\]]*?)\]\]/g, (_, base, ruby) => {
      base = base.trim(); ruby = ruby.trim();
      return ruby ? `${base}《${ruby}》` : base;
    });
    text = text.replace(/\[\[emphasismark:([\s\S]*?)>[^\]]*\]\]/g, (_, body) => body.trim());
    text = text.replace(/\[(?:b|i):([^\]]*)\]/g, '$1');

    return cleanupPlainText(decodeEntities(text));
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    doc.querySelectorAll('script,style,noscript,img,picture,figure,svg,canvas').forEach(n => n.remove());

    // Keep ruby readable in a plain-text file.
    doc.querySelectorAll('ruby').forEach(ruby => {
      const reading = [...ruby.querySelectorAll('rt')].map(n => n.textContent || '').join('').trim();
      const clone = ruby.cloneNode(true);
      clone.querySelectorAll('rt,rp').forEach(n => n.remove());
      const base = (clone.textContent || '').trim();
      ruby.replaceWith(doc.createTextNode(reading ? `${base}《${reading}》` : base));
    });

    doc.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode('\n')));
    doc.querySelectorAll('p,div,section,article,h1,h2,h3,h4,h5,h6,li,blockquote').forEach(el => {
      el.before(doc.createTextNode('\n'));
      el.after(doc.createTextNode('\n'));
    });
    return cleanupPlainText(doc.body.textContent || '');
  }

  function parseContent(raw) {
    const source = normalizeNewlines(raw);
    const hasPixivPages = /\[newpage\]/i.test(source);
    const looksHtml = /<\/?(?:p|div|br|span|a|ruby|rt|img|section|article|h[1-6])\b/i.test(source);

    if (hasPixivPages) {
      const chunks = source.split(/\[newpage\]/i);
      return {
        format: looksHtml ? 'pixiv記法＋HTML混在' : 'pixiv小説記法',
        pages: chunks.map(chunk => looksHtml ? htmlToText(pixivMarkupToText(chunk)) : pixivMarkupToText(chunk))
      };
    }

    return {
      format: looksHtml ? 'HTML' : 'プレーン/小説記法',
      pages: [looksHtml ? htmlToText(source) : pixivMarkupToText(source)]
    };
  }

  async function fetchNovel(id) {
    const response = await fetch(`/ajax/novel/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    if (json?.error || !json?.body) throw new Error(json?.message || '本文データを取得できませんでした');
    if (typeof json.body.content !== 'string') throw new Error('本文 content が見つかりませんでした');
    return json.body;
  }

  function safeFileName(name) {
    const cleaned = String(name || 'pixiv小説')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '＿')
      .replace(/[. ]+$/g, '')
      .trim();
    return (cleaned || 'pixiv小説').slice(0, 140) + '.txt';
  }

  function cleanupOutputText(text) {
    return normalizeNewlines(text)
      .replace(/[ \\t]+\\n/g, '\\n')
      .replace(/\\n[ \\t]+/g, '\\n')
      .replace(/^\\n+|\\n+$/g, '');
  }

  function buildOutput() {
    if (!original || !pageHost) return '';
    const pages = [...pageHost.querySelectorAll('.pnte-page')]
      .filter(card => card.querySelector('.pnte-include')?.checked)
      .map(card => cleanupPlainText(card.querySelector('textarea')?.value || ''))
      .filter(Boolean);

    const parts = [];
    if (metaToggle?.checked) {
      parts.push(original.title || '無題');
      if (original.userName) parts.push(`作者：${original.userName}`);
      parts.push('');
    }
    // ページ境界は改行6個（空行5行）をそのまま保持する。
    parts.push(pages.join('\\n\\n\\n\\n\\n\\n'));
    return cleanupOutputText(parts.join('\\n')) + '\\n';
  }

  async function saveText() {
    if (!original) return;
    const text = buildOutput();
    if (!text.trim()) {
      statusNode.textContent = '保存する本文がありません。ページのチェックまたは本文を確認してください。';
      return;
    }

    const file = new File([text], safeFileName(original.title), { type: 'text/plain;charset=utf-8' });

    // iPhone/iPadでは共有シート →「ファイルに保存」が最も安定。
    try {
      const appleMobile = /iP(?:hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (appleMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: original.title || 'pixiv小説' });
        statusNode.textContent = '共有シートへ渡しました。「ファイルに保存」を選べます。';
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        statusNode.textContent = '共有をキャンセルしました。';
        return;
      }
      // Fall through to a normal Blob download.
    }

    const blobUrl = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = file.name;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    statusNode.textContent = 'TXT保存を開始しました。';
  }

  async function copyText() {
    const text = buildOutput();
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      statusNode.textContent = '編集後の本文をクリップボードへコピーしました。';
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      statusNode.textContent = ok ? '編集後の本文をコピーしました。' : 'コピーできませんでした。';
    }
  }

  function isNovelHeading(line) {
    const s = line.trim();
    if (!s || Array.from(s).length > 40) return false;
    return /^(?:第.{1,18}[章話節幕部編]|序章|終章|序幕|終幕|幕間|間章|前書き|まえがき|後書き|あとがき|プロローグ|エピローグ|Prologue|Epilogue|Chapter\\s*[0-9０-９]+|CHAPTER\\s*[0-9０-９]+|[0-9０-９]+[.．、]\s*\\S+)/i.test(s);
  }

  function isDialogueLike(line) {
    return /^[「『（【〔［〈《“‘〝〟…‥―—─・※＊*#◇◆○●◎△▲▽▼□■☆★♪♩♬]/.test(line.trimStart());
  }

  function formatNovelText(text, addDialogueSpacing) {
    const rawLines = normalizeNewlines(text).split('\n').map(line => line.replace(/[ \t　]+$/g, ''));
    const prepared = [];

    for (const raw of rawLines) {
      if (!raw.trim()) {
        prepared.push('');
        continue;
      }

      // 地の文は先頭空白の状態に関係なく、必ず全角スペース1個で字下げする。
      const visible = raw.replace(/^[ \t\u00a0　]+/g, '');
      const heading = isNovelHeading(visible);
      const special = isDialogueLike(visible);
      const line = (!heading && !special) ? '　' + visible : visible;
      prepared.push(line);
    }

    const spaced = [];
    for (let i = 0; i < prepared.length; i++) {
      const line = prepared[i];
      if (!line) {
        if (spaced.length && spaced[spaced.length - 1] !== '') spaced.push('');
        continue;
      }

      const heading = isNovelHeading(line);
      if (heading && spaced.length && spaced[spaced.length - 1] !== '') spaced.push('');

      if (addDialogueSpacing && spaced.length) {
        let j = spaced.length - 1;
        while (j >= 0 && spaced[j] === '') j--;
        if (j >= 0 && spaced[spaced.length - 1] !== '') {
          const prev = spaced[j];
          if (!isNovelHeading(prev) && !heading && isDialogueLike(prev) !== isDialogueLike(line)) {
            spaced.push('');
          }
        }
      }

      spaced.push(line);
      if (heading) spaced.push('');
    }

    return normalizeNewlines(spaced.join('\n'))
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function formatAllPages() {
    if (!pageHost) return;
    const cards = [...pageHost.querySelectorAll('.pnte-page')];
    if (!cards.length) return;

    for (const card of cards) {
      const ta = card.querySelector('textarea');
      if (!ta) continue;
      ta.value = formatNovelText(ta.value, !!dialogueSpacingToggle?.checked);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    statusNode.textContent = dialogueSpacingToggle?.checked
      ? '小説向けに整形しました。地の文を字下げし、会話と地の文の切り替わりにも空行を入れています。'
      : '小説向けに整形しました。地の文を字下げし、見出し・空行・行末空白を整理しました。';
  }

  function restorePages() {
    if (!original) return;
    drawPages(original.pages);
    statusNode.textContent = '取得時の本文に戻しました。';
  }

  function drawPages(pages) {
    pageHost.replaceChildren();
    pages.forEach((text, index) => {
      const card = document.createElement('section');
      card.className = 'pnte-page';

      const head = document.createElement('div');
      head.className = 'pnte-page-head';
      const label = document.createElement('label');
      const include = document.createElement('input');
      include.type = 'checkbox'; include.checked = true; include.className = 'pnte-include';
      label.append(include, document.createTextNode(` ページ ${index + 1} を保存`));
      const chars = document.createElement('span');
      chars.textContent = `${Array.from(text).length.toLocaleString('ja-JP')}字`;
      head.append(label, chars);

      const ta = document.createElement('textarea');
      ta.value = text;
      ta.spellcheck = false;
      ta.setAttribute('aria-label', `ページ${index + 1} 本文`);
      ta.addEventListener('input', () => {
        chars.textContent = `${Array.from(ta.value).length.toLocaleString('ja-JP')}字`;
      });

      include.addEventListener('change', () => {
        card.classList.toggle('pnte-excluded', !include.checked);
      });

      card.append(head, ta);
      pageHost.append(card);
    });
  }

  function closeOverlay() {
    overlay?.classList.remove('pnte-open');
  }

  async function openEditor() {
    const id = novelId();
    if (!id) return;
    overlay.classList.add('pnte-open');
    pageHost.replaceChildren();
    statusNode.textContent = 'pixivから本文を取得中…';

    try {
      const body = await fetchNovel(id);
      const parsed = parseContent(body.content);
      original = {
        id,
        title: body.title || document.title || '無題',
        userName: body.userName || body.user?.name || '',
        url: `https://www.pixiv.net/novel/show.php?id=${id}`,
        format: parsed.format,
        pages: parsed.pages
      };
      drawPages(original.pages);
      const total = original.pages.reduce((n, p) => n + Array.from(p).length, 0);
      statusNode.textContent = `取得成功：${original.pages.length}ページ／${total.toLocaleString('ja-JP')}字／取得形式 ${original.format}`;
    } catch (err) {
      original = null;
      statusNode.textContent = `取得失敗：${err?.message || err}`;
      const detail = document.createElement('div');
      detail.className = 'pnte-error';
      detail.textContent = 'この表示をそのまま教えてください。pixiv側の返却形式に合わせて修正します。';
      pageHost.append(detail);
    }
  }

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BTN_ID}{position:fixed;right:18px;bottom:90px;z-index:2147483000;border:0;border-radius:999px;padding:11px 15px;background:#0096fa;color:#fff;font:700 14px/1.2 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;box-shadow:0 4px 16px #0003;cursor:pointer}
      #${ROOT_ID}{display:none;position:fixed;inset:0;z-index:2147483646;background:#f4f6f8;color:#202124;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;overflow:auto;-webkit-overflow-scrolling:touch}
      #${ROOT_ID}.pnte-open{display:block}
      #${ROOT_ID} *{box-sizing:border-box}
      .pnte-header{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #dfe3e8;padding:10px 12px;box-shadow:0 2px 8px #0000000d}
      .pnte-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:980px;margin:auto}
      .pnte-bar strong{font-size:16px;margin-right:auto}
      .pnte-bar button{border:1px solid #ccd2d9;background:#fff;color:#202124;border-radius:8px;padding:8px 10px;font:inherit;font-weight:600}
      .pnte-bar .pnte-save{background:#0096fa;color:#fff;border-color:#0096fa}
      .pnte-meta{max-width:980px;margin:8px auto 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;color:#59636e}
      .pnte-status{max-width:980px;margin:7px auto 0;font-size:12px;color:#59636e;overflow-wrap:anywhere}
      .pnte-pages{max-width:980px;margin:0 auto;padding:12px 10px 80px}
      .pnte-page{background:#fff;border:1px solid #dfe3e8;border-radius:10px;margin:0 0 12px;padding:10px;transition:opacity .15s}
      .pnte-page.pnte-excluded{opacity:.46}
      .pnte-page-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:7px;font-size:13px;font-weight:700}
      .pnte-page-head span{font-size:11px;color:#727d88;font-weight:400}
      .pnte-page textarea{display:block;width:100%;min-height:46vh;resize:vertical;border:1px solid #ccd2d9;border-radius:8px;padding:12px;background:#fff;color:#202124;font:15px/1.8 ui-monospace,SFMono-Regular,Menlo,'Noto Sans Mono CJK JP','Noto Sans JP',monospace;white-space:pre-wrap}
      .pnte-error{background:#fff3f3;color:#b42318;border:1px solid #f3c3c3;border-radius:8px;padding:12px}
      @media(max-width:600px){#${BTN_ID}{right:12px;bottom:76px;padding:10px 13px}.pnte-header{padding:8px}.pnte-bar{gap:6px}.pnte-bar button{padding:7px 8px;font-size:12px}.pnte-bar strong{width:100%;font-size:15px}.pnte-meta{font-size:11px}.pnte-pages{padding:10px 7px 70px}.pnte-page{padding:8px}.pnte-page textarea{min-height:52vh;font-size:14px;line-height:1.75}}
    `;
    document.head.append(style);
  }

  function buildUi() {
    if (document.getElementById(ROOT_ID)) return;
    injectCss();

    const button = document.createElement('button');
    button.id = BTN_ID;
    button.type = 'button';
    button.textContent = '📄 TXT抽出';
    button.addEventListener('click', openEditor);
    document.body.append(button);

    overlay = document.createElement('div');
    overlay.id = ROOT_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const header = document.createElement('header');
    header.className = 'pnte-header';
    const bar = document.createElement('div');
    bar.className = 'pnte-bar';
    const title = document.createElement('strong');
    title.textContent = '📖 pixiv小説 TXT編集・保存';

    const restore = document.createElement('button');
    restore.type = 'button'; restore.textContent = '↩ 原文に戻す';
    restore.addEventListener('click', restorePages);

    const format = document.createElement('button');
    format.type = 'button'; format.textContent = '📖 小説向け整形';
    format.addEventListener('click', formatAllPages);

    const copy = document.createElement('button');
    copy.type = 'button'; copy.textContent = 'コピー';
    copy.addEventListener('click', copyText);

    const save = document.createElement('button');
    save.type = 'button'; save.className = 'pnte-save'; save.textContent = '💾 TXT保存';
    save.addEventListener('click', saveText);

    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '閉じる';
    close.addEventListener('click', closeOverlay);

    bar.append(title, restore, format, copy, save, close);

    const meta = document.createElement('div');
    meta.className = 'pnte-meta';
    const metaLabel = document.createElement('label');
    metaToggle = document.createElement('input');
    metaToggle.type = 'checkbox'; metaToggle.checked = false;
    metaLabel.append(metaToggle, document.createTextNode(' タイトル・作者名をTXT先頭に入れる'));
    const dialogueLabel = document.createElement('label');
    dialogueSpacingToggle = document.createElement('input');
    dialogueSpacingToggle.type = 'checkbox'; dialogueSpacingToggle.checked = false;
    dialogueLabel.append(dialogueSpacingToggle, document.createTextNode(' 整形時、会話と地の文の間を1行空ける'));

    const hint = document.createElement('span');
    hint.textContent = '不要なページはチェックOFF／一部分だけ消す場合は本文を直接編集';
    meta.append(metaLabel, dialogueLabel, hint);

    statusNode = document.createElement('div');
    statusNode.className = 'pnte-status';
    statusNode.textContent = 'まだ取得していません。';

    header.append(bar, meta, statusNode);
    pageHost = document.createElement('main');
    pageHost.className = 'pnte-pages';
    overlay.append(header, pageHost);
    document.body.append(overlay);
  }

  async function init() {
    // pixiv can re-render portions of the page; attach only after body exists.
    if (!document.body) await sleepFrame();
    if (novelId()) buildUi();
  }

  void init();
})();


// ==UserScript==
// @name         Pixiv イラスト・小説 ブクマ順（検索結果横断）
// @namespace    local.pixiv.bookmark-sort.cross-page
// @version      0.5.4
// @description  ブクマ順の結果カードにタグとキャプションの冒頭抜粋を表示。
// @match        https://www.pixiv.net/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @require      https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/9eb97e51cedba0d081db3cc7331ecc8c01ea6685/Pixiv_Bookmark_Sort.user.js
// @require      https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/3f0ff7bae96d515e81a9c78116b58c0b3a014f51/Pixiv_Bookmark_Sort.user.js
// ==/UserScript==
(() => {
  'use strict';
  // 既存の検索・順位・保存機能には触れず、v0.5.3の結果画面だけを拡張する。
  const cache = new Map();
  let dbPromise;
  function openDb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('pixiv-bookmark-sort-extras-v01', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('details', {keyPath: 'key'});
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
    return dbPromise;
  }
  async function load(key) {
    if (cache.has(key)) return cache.get(key);
    const db = await openDb();
    if (!db) return null;
    return new Promise(resolve => {
      const req = db.transaction('details', 'readonly').objectStore('details').get(key);
      req.onsuccess = () => {if (req.result) cache.set(key, req.result); resolve(req.result || null);};
      req.onerror = () => resolve(null);
    });
  }
  async function save(data) {
    cache.set(data.key, data);
    const db = await openDb();
    if (!db) return;
    try {db.transaction('details', 'readwrite').objectStore('details').put(data);} catch (_) {}
  }
  function excerpt(html) {
    const doc = new DOMParser().parseFromString(String(html || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n'), 'text/html');
    const text = (doc.body.textContent || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]*\n+/g, '\n').trim();
    const chars = Array.from(text);
    return chars.slice(0, 180).join('') + (chars.length > 180 ? '…' : '');
  }
  function parse(body, key) {
    const raw = Array.isArray(body.tags) ? body.tags : body.tags && body.tags.tags;
    const tags = Array.isArray(raw) ? raw.map(t => typeof t === 'string' ? t : t && t.tag)
      .filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [];
    return {key, tags: [...new Set(tags)], caption: excerpt(body.description || body.caption || '')};
  }
  function workKey(row) {
    let url;
    try {url = new URL(row.href);} catch (_) {return null;}
    const novel = url.pathname === '/novel/show.php' || /^\/novels\/\d+\/?$/.test(url.pathname);
    const id = novel ? (url.searchParams.get('id') || url.pathname.match(/\/novels\/(\d+)/)?.[1])
      : url.pathname.match(/^\/artworks\/(\d+)/)?.[1];
    return id && /^\d+$/.test(id) ? (novel ? 'novel:' : 'illust:') + id : null;
  }
  function attach() {
    const root = document.getElementById('pixiv-bookmark-sort-cross-page-v05')?.shadowRoot;
    const overlay = root?.querySelector('.pbs-overlay');
    const list = overlay?.querySelector('.pbs-list');
    if (!list || overlay.dataset.pbsExtrasAttached) return !!list;
    overlay.dataset.pbsExtrasAttached = '1';
    const css = document.createElement('style');
    css.textContent = `
      .pbs-extra {display:block!important;margin-top:10px!important;font-size:12px!important;line-height:1.5!important;color:#4b5870!important;}
      .pbs-extra-tags {display:flex!important;flex-wrap:wrap!important;gap:4px!important;margin-bottom:7px!important;}
      .pbs-extra-tag {display:inline-block!important;border-radius:5px!important;padding:2px 5px!important;background:#edf5fe!important;color:#24689d!important;font-size:11px!important;}
      .pbs-extra-caption {display:-webkit-box!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:5!important;overflow:hidden!important;white-space:pre-line!important;overflow-wrap:anywhere!important;}
      .pbs-extra-status {font-size:12px!important;line-height:1.5!important;color:#586277!important;margin-top:6px!important;}
      .pbs-extra-status.error {color:#bb244a!important;}
    `;
    root.appendChild(css);
    const status = document.createElement('div');
    status.className = 'pbs-extra-status';
    overlay.querySelector('.pbs-summary')?.after(status);
    const queue = [], queued = new Set();
    let working = false, halted = false, lastRequest = 0;
    function display(row, detail) {
      if (!row.isConnected) return;
      const extra = row.querySelector('.pbs-extra');
      if (!extra) return;
      const tags = document.createElement('div'); tags.className = 'pbs-extra-tags';
      if (detail.tags.length) for (const tag of detail.tags) {
        const chip = document.createElement('span'); chip.className = 'pbs-extra-tag';
        chip.textContent = '#' + tag; tags.append(chip);
      } else tags.textContent = 'タグなし';
      const caption = document.createElement('div'); caption.className = 'pbs-extra-caption';
      caption.textContent = detail.caption ? 'キャプション：' + detail.caption : 'キャプションの記載なし';
      extra.replaceChildren(tags, caption);
    }
    function enqueue(row) {
      const key = row.dataset.pbsExtraKey;
      if (!key || queued.has(key) || halted || cache.has(key)) return;
      queued.add(key); queue.push({key, row}); void pump();
    }
    async function pump() {
      if (working || halted || !overlay.classList.contains('pbs-open')) return;
      working = true;
      try {
        while (queue.length && !halted && overlay.classList.contains('pbs-open')) {
          const {key, row} = queue.shift(); queued.delete(key);
          if (!row.isConnected) continue;
          let detail = await load(key);
          if (!detail) {
            const wait = Math.max(0, 2600 - (Date.now() - lastRequest));
            if (wait) await new Promise(resolve => setTimeout(resolve, wait));
            if (!overlay.classList.contains('pbs-open')) {enqueue(row); break;}
            lastRequest = Date.now();
            let res;
            try {res = await fetch('/ajax/' + key.replace(':', '/'), {credentials: 'same-origin', headers: {Accept: 'application/json'}});}
            catch (_) {halted = true; status.textContent = '通信に失敗しました。再読み込み後にお試しください。'; status.classList.add('error'); break;}
            if (!res.ok) {
              if (res.status === 404) {row.querySelector('.pbs-extra').textContent = '作品情報を取得できません（404）'; continue;}
              halted = true; status.textContent = `追加情報の取得を停止しました（HTTP ${res.status}）。時間を置いて再読み込みしてください。自動再試行はしません。`;
              status.classList.add('error'); break;
            }
            const json = await res.json().catch(() => null);
            if (!json || json.error || !json.body) {halted = true; status.textContent = '作品情報を確認できないため取得を停止しました。'; status.classList.add('error'); break;}
            detail = parse(json.body, key); await save(detail);
          }
          // 表示中のカードのみ更新。調査DBや順位は変更しない。
          if (row.isConnected) display(row, detail);
          if (!halted) status.textContent = `タグ・キャプション：${cache.size}件を保存済み。画面に見えている作品から順に取得します。`;
        }
      } finally {working = false;}
    }
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      for (const item of entries) if (item.isIntersecting) enqueue(item.target);
    }, {root: overlay, rootMargin: '160px 0px'}) : null;
    function enhance() {
      for (const row of list.querySelectorAll('a.pbs-row:not([data-pbs-extra-ready])')) {
        row.dataset.pbsExtraReady = '1';
        const key = workKey(row);
        if (!key) continue;
        row.dataset.pbsExtraKey = key;
        const extra = document.createElement('div'); extra.className = 'pbs-extra';
        extra.textContent = 'タグ・キャプションを読み込み待ち…';
        (row.querySelector('.info') || row).append(extra);
        if (cache.has(key)) display(row, cache.get(key));
        else if (io) io.observe(row);
        else if (list.querySelectorAll('a.pbs-row').length <= 30) enqueue(row);
      }
      if (!halted) status.textContent = `タグ・キャプションは表示中の作品から順に追加取得します（約2.6秒に1件）。取得済み分は保存します。`;
      void pump();
    }
    new MutationObserver(enhance).observe(list, {childList: true});
    overlay.querySelector('.pbs-back')?.addEventListener('click', () => io?.disconnect());
    enhance();
    return true;
  }
  if (!attach()) {
    let tries = 0;
    const timer = setInterval(() => {if (attach() || ++tries > 120) clearInterval(timer);}, 250);
  }
})();
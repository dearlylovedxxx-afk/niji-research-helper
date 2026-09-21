// ==UserScript==
// @name         Niji OR Results Merger (standalone add-on)
// @namespace    niji-or-results-merger-standalone
// @version      0.4.0
// @description  コメントOR試験版。複数ワードを1回入力すると検索・全ページ収集・OR統合を自動実行。本体DBは変更しません。
// @match        https://comment2434.com/*
// @match        https://www.comment2434.com/*
// @include      https://comment2434.com/*
// @include      https://www.comment2434.com/*
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_OR_Results_Merger.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_OR_Results_Merger.user.js
// @grant        none
// @run-at       document-end
// @noframes
// ==/UserScript==

(async () => {
  'use strict';
  if (location.protocol !== 'https:' || !['comment2434.com','www.comment2434.com'].includes(location.hostname.toLowerCase())) return;
  try { if (window.top !== window.self) return; } catch (_) {}
  try { window.__nijiOrMergerUiCleanup?.(); } catch (_) {}
  const bootId='niji-or-boot-check';
  document.getElementById(bootId)?.remove();
  document.getElementById('niji-or-trigger')?.remove();
  const boot=document.createElement('button');
  boot.id=bootId;
  boot.type='button';
  boot.textContent='🔀 OR起動中 0.4.0';
  boot.style.cssText='position:fixed!important;top:45px!important;left:8px!important;bottom:auto!important;z-index:2147483647!important;min-width:104px!important;min-height:44px!important;background:#4d35a4!important;color:white!important;border:2px solid #fff!important;border-radius:24px!important;padding:10px!important;pointer-events:auto!important;display:block!important;font:700 13px system-ui!important;';
  (document.body||document.documentElement).append(boot);
  let restoreBootEnabled=true;
  const restoreBoot=()=>{
    if (!restoreBootEnabled) return;
    if (!boot.isConnected) (document.body||document.documentElement).append(boot);
  };
  const recoveryTimer=setInterval(restoreBoot, 1000);
  let hostRecoveryTimer;
  window.__nijiOrMergerUiCleanup=()=>{
    restoreBootEnabled=false;
    clearInterval(recoveryTimer);
    if (hostRecoveryTimer) clearInterval(hostRecoveryTimer);
    boot.remove();
    document.getElementById('niji-or-root')?.remove();
  };
  console.info('[Niji OR Merger] v0.4.0 injected', location.href);
  const previousRoot = document.getElementById('niji-or-root');
  if (previousRoot) previousRoot.remove();

  const STORAGE_KEY = 'niji_or_merger_addon_batches_v1';
  const VERSION = '0.4.0';
  const AUTO_KEY = 'niji_or_merger_addon_auto_v3';
  const MULTI_KEY = 'niji_or_merger_addon_multi_v1';
  const AUTO_LIMIT = 100;
  const AUTO_NEXT_DELAY_MS = 3000;
  const MAX_PER_CAPTURE = 1500;
  const MAX_COMMENTS_PER_CAPTURE = 600;
  const MAX_BATCHES = 250;
  const PAGE_SIZE = 40;
  let batches = [];
  let resultPage = 0;
  let filter = '';
  let busy = false;
  let autoJob = null;
  let autoRunning = false;
  let autoStop = false;
  let multiJob = null;
  let lastAutoStatus = '';
  let storageMode = (typeof GM !== 'undefined' && typeof GM.getValue === 'function' && typeof GM.setValue === 'function') ? 'modern' : 'local';
  async function storeGet(key, fallback) {
    try {
      if (storageMode === 'modern') {
        const value = await GM.getValue(key, undefined);
        if (value !== undefined) return value;
      }
      const raw = localStorage.getItem('nor_addon_' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.warn('[Niji OR Merger] 保存データの読み込み失敗', err);
      try { const raw = localStorage.getItem('nor_addon_' + key); return raw === null ? fallback : JSON.parse(raw); }
      catch { return fallback; }
    }
  }
  async function storeSet(key, value) {
    if (storageMode === 'modern') {
      try { await GM.setValue(key, value); return; }
      catch (err) { console.warn('[Niji OR Merger] GM保存失敗のためlocalStorageへ切替', err); storageMode = 'local'; }
    }
    localStorage.setItem('nor_addon_' + key, JSON.stringify(value));
  }

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'src') node.src = v;
      else if (k === 'alt') node.alt = v;
      else if (k === 'loading') node.loading = v;
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'title') node.title = v;
      else if (k === 'type') node.type = v;
      else if (k === 'href') node.href = v;
      else if (k === 'target') node.target = v;
      else if (k === 'rel') node.rel = v;
    }
    for (const child of children) node.append(child);
    return node;
  };
  const clip = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const cleanUrl = (value) => {
    try {
      const u = new URL(value, location.href);
      return /^https?:$/.test(u.protocol) ? u.href : '';
    } catch { return ''; }
  };
  const videoId = (raw) => {
    const s = String(raw || '');
    let m = s.match(/\/comment\/video\/([\w-]{11})(?:[/?#]|$)/i);
    if (m) return m[1];
    m = s.match(/[?&]v=([\w-]{11})(?:[&#]|$)/i);
    if (m) return m[1];
    m = s.match(/youtu\.be\/+([\w-]{11})(?:[/?#]|$)/i) || s.match(/youtube\.com\/(?:live|shorts|embed)\/([\w-]{11})(?:[/?#]|$)/i);
    if (m) return m[1];
    m = s.match(/(?:i\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([\w-]{11})(?:[/?#]|$)/i);
    return m ? m[1] : '';
  };
  const clockSeconds = (text) => {
    const m = String(text || '').trim().replace(/[：:]\s*$/, '').match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    if (m[3] != null) return (+m[1] * 3600) + (+m[2] * 60) + (+m[3]);
    return (+m[1] * 60) + (+m[2]);
  };
  const hhmmss = (s) => {
    const n = Math.max(0, Math.floor(Number(s) || 0));
    const h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60, sec = n % 60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  };
  const commentTime = (link) => {
    const fromText = clockSeconds(link.textContent || '');
    if (fromText !== null) return fromText;
    try {
      const u = new URL(link.href, location.href);
      for (const key of ['t','start','time_continue']) {
        const t = u.searchParams.get(key);
        if (t && /^\d+s?$/.test(t)) return Number(t.replace(/s$/,''));
      }
    } catch {}
    return null;
  };
  const withinOwnUi = (node) => Boolean(node?.closest?.('#niji-or-root, #npf-sheet-backdrop, #npf-research-panel, #npf-yt-panel'));
  const allVideoIds = (node) => {
    const ids = new Set();
    for (const a of node.querySelectorAll('a[href]')) {
      const id = videoId(a.getAttribute('href'));
      if (id) ids.add(id);
      if (ids.size > 1) break;
    }
    if (!ids.size) for (const img of node.querySelectorAll('img[src]')) {
      const id = videoId(img.getAttribute('src'));
      if (id) ids.add(id);
      if (ids.size > 1) break;
    }
    return ids;
  };
  function resultContainer(node, id) {
    let current = node;
    let best = node;
    for (let i = 0; current && i < 8; i++, current = current.parentElement) {
      if (withinOwnUi(current) || current.matches?.('body,html,main,form,nav,header,footer')) break;
      const txt = clip(current.textContent, 3000);
      if (txt.length > 3000 || current.querySelectorAll('a[href]').length > 100) break;
      const ids = allVideoIds(current);
      if (ids.size > 1 || (ids.size === 1 && !ids.has(id))) break;
      if (ids.size === 1 && txt.length >= 5) best = current;
    }
    return best;
  }
  function titleFromLink(a, card, id) {
    const picks = [
      a.getAttribute('title'), a.getAttribute('aria-label'),
      card.querySelector('h2,h3,h4,[class*="title"],[class*="Title"]')?.textContent,
      a.querySelector('img[alt]')?.getAttribute('alt'), a.textContent,
      card.querySelector('img[alt]')?.getAttribute('alt'),
    ];
    return picks.map(s => clip(s, 240)).find(s => s && s !== id && !/^(\d{1,3}:)?\d{1,3}:\d{2}$/.test(s) && !/^他視点|^再生$/.test(s)) || `動画 ${id}`;
  }
  function extractComments(root, id) {
    const out = [], found = new Set();
    for (const a of root.querySelectorAll('a[href]')) {
      if (withinOwnUi(a)) continue;
      const sec = commentTime(a);
      if (sec === null) continue;
      const hrefId = videoId(a.getAttribute('href'));
      if (hrefId && hrefId !== id) continue;
      const timeCol = a.closest('.col-md-1, .col-2');
      let row = timeCol?.parentElement;
      if (!row || !row.matches('.row') || row.querySelectorAll('a.npf-sync-ts-bound').length > 1) {
        row = a.closest('tr, li, article, .row, [class*="comment"], [class*="message"], [class*="chat"]');
      }
      if (!row || withinOwnUi(row)) row = a.parentElement;
      let txt = '';
      if (timeCol && row && timeCol.parentElement === row) {
        txt = clip([...row.children].filter(e => e !== timeCol).map(e => e.textContent).join(' '), 2000);
      }
      if (!txt && row && row !== root) {
        const raw = clip(row.textContent, 2000);
        const prefix = String(a.textContent || '').trim();
        txt = clip(raw.replace(prefix, '').replace(/^[：:\s]+/, ''), 2000);
      }
      if (!txt) continue;
      const key = `${id}|${sec}|${txt}`;
      if (found.has(key)) continue;
      found.add(key);
      out.push({ sec, text: txt, url: `https://www.youtube.com/watch?v=${id}&t=${sec}s` });
      if (out.length >= MAX_COMMENTS_PER_CAPTURE) break;
    }
    return out;
  }

  function captureDisplayed() {
    const host = document.querySelector('main') || document.body;
    const groups = new Map();
    const seenCards = new WeakMap();
    const hits = [...host.querySelectorAll('a[href], img[src]')];
    for (const node of hits) {
      if (withinOwnUi(node) || node.closest('form,nav,header,footer')) continue;
      const raw = node.tagName === 'IMG' ? node.getAttribute('src') : node.getAttribute('href');
      const id = videoId(raw);
      if (!id) continue;
      const a = node.tagName === 'A' ? node : node.closest('a[href]') || node;
      const card = resultContainer(a, id);
      const title = titleFromLink(a, card, id);
      let entry = groups.get(id);
      if (!entry) {
        entry = { id, title, sourceUrl: cleanUrl(a.href || '') || `https://comment2434.com/comment/video/${id}/`, channel: '', comments: [] };
        groups.set(id, entry);
      } else if (title.length > entry.title.length && !title.startsWith('動画 ')) entry.title = title;
      const targetUrl = cleanUrl(a.href || '');
      if (/^https:\/\/comment2434\.com\/comment\/video\//.test(targetUrl)) entry.sourceUrl = targetUrl;
      if (seenCards.get(card) !== id) {
        seenCards.set(card, id);
        const comments = new Map([...entry.comments, ...extractComments(card, id)].map(c => [`${c.sec}|${c.text}`, c]));
        entry.comments = [...comments.values()];
      }
      if (groups.size >= MAX_PER_CAPTURE) break;
    }
    const current = videoId(location.href);
    if (current && /\/comment\/video\//.test(location.pathname)) {
      const root = document.querySelector('main') || document.body;
      const old = groups.get(current) || { id: current, title: clip(document.querySelector('main h1, main h2, h1')?.textContent || document.title.replace(/\s*[-|｜].*$/, ''), 240) || `動画 ${current}`, sourceUrl: location.href, channel: '', comments: [] };
      const more = extractComments(root, current);
      if (old.title.startsWith('動画 ')) old.title = clip(document.querySelector('main h1, main h2, h1')?.textContent || document.title, 240) || old.title;
      if (!old.channel) old.channel = clip(document.querySelector('main a[href*="/channel/"], main a[href*="/@"]')?.textContent || '', 100);
      const map = new Map([...old.comments, ...more].map(c => [`${c.sec}|${c.text}`, c]));
      old.comments = [...map.values()];
      old.sourceUrl = location.href;
      groups.set(current, old);
    }
    return { rows: [...groups.values()], truncated: groups.size >= MAX_PER_CAPTURE };
  }
  function mergedVideos() {
    const byId = new Map();
    for (const b of batches) for (const v of b.rows) {
      let e = byId.get(v.id);
      if (!e) {
        e = { id: v.id, title: v.title, channel: v.channel || '', url: v.sourceUrl, labels: new Set(), comments: new Map() };
        byId.set(v.id, e);
      }
      if ((!e.title || e.title.startsWith('動画 ')) && !v.title.startsWith('動画 ')) e.title = v.title;
      if (!e.channel && v.channel) e.channel = v.channel;
      e.labels.add(b.label);
      for (const c of (v.comments || [])) {
        const key = `${c.sec}|${c.text}`;
        const existing = e.comments.get(key);
        if (existing) existing.matchLabels.add(b.label);
        else e.comments.set(key, { ...c, matchLabels: new Set([b.label]) });
      }
    }
    const current=videoId(location.href); return [...byId.values()].sort((a,b) => (a.id===current ? -1 : b.id===current ? 1 : 0) || b.labels.size - a.labels.size || a.title.localeCompare(b.title, 'ja'));
  }
  async function persist() { await storeSet(STORAGE_KEY, batches); }
  const host = el('div'); host.id = 'niji-or-root';
  const root = el('div', { class:'nor-root' }); host.append(root);
  host.style.cssText = 'position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483646!important;pointer-events:none!important;';
  const trigger = boot;
  trigger.id='niji-or-trigger';
  trigger.className='nor-fab';
  trigger.textContent='🔀 OR統合';
  trigger.style.cssText = 'position:fixed!important;top:45px!important;left:8px!important;bottom:auto!important;z-index:2147483647!important;min-width:96px!important;min-height:44px!important;background:#4d35a4!important;color:#fff!important;border:1px solid #aa9aff!important;border-radius:25px!important;padding:10px!important;font:700 14px system-ui!important;pointer-events:auto!important;display:block!important;';
  const panel = el('section', { class:'nor-panel' }); panel.hidden = true;
  const head = el('div', { class:'nor-head' }, el('strong', { text:'🔀 検索結果のOR統合' }));
  const close = el('button', { class:'nor-button', type:'button', text:'閉じる' }); head.append(close);
  const body = el('div', { class:'nor-body' }); panel.append(head, body);
  const viewer = el('section', { class:'nor-viewer' });
  viewer.hidden = true;
  root.append(panel, viewer); (document.body || document.documentElement).append(host);
  const style = el('style'); style.textContent = `
    #niji-or-root .nor-root{font-family:system-ui,-apple-system,'Noto Sans JP',sans-serif;font-size:13px;line-height:1.5;color:#e9edf3;pointer-events:none}
    #niji-or-root .nor-fab,#niji-or-root .nor-panel{pointer-events:auto}
    .nor-root *{box-sizing:border-box}.nor-fab{position:fixed;top:45px;bottom:auto;left:8px;z-index:2147483000;background:#4d35a4;color:#fff;border:1px solid #aa9aff;border-radius:25px;box-shadow:0 3px 15px #0008;padding:10px 15px;font-weight:700;cursor:pointer}
    .nor-panel{position:fixed;top:76px;bottom:auto;left:8px;z-index:2147483001;background:#1f2029;color:#e9edf3;border:1px solid #66677b;border-radius:13px;width:min(470px,calc(100vw - 24px));max-height:min(85vh,780px);box-shadow:0 12px 36px #0009;overflow:hidden;flex-direction:column}
    .nor-panel:not([hidden]){display:flex}.nor-panel[hidden]{display:none}.nor-head{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #454654}
    .nor-body{padding:12px;overflow-y:auto;overscroll-behavior:contain}.nor-row{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:9px 0}.nor-button{background:#343541;color:#fff;border:1px solid #686975;border-radius:7px;padding:6px 9px;cursor:pointer;font:inherit}
    .nor-button.primary{background:#5636af;border-color:#9a86e5}.nor-button:disabled{opacity:.5;cursor:not-allowed}.nor-input{width:100%;background:#11131b;color:white;border:1px solid #676875;padding:8px;border-radius:7px;font:inherit}
    .nor-muted{color:#bfc1cf;font-size:12px}.nor-note{background:#252638;border:1px solid #44465d;padding:9px;border-radius:8px;margin:9px 0}
    .nor-batch{display:flex;align-items:flex-start;justify-content:space-between;border-top:1px solid #41424c;padding:7px 0;gap:7px}.nor-result{border-top:1px solid #444652;padding:10px 1px}.nor-result a{color:#a8ceff;text-decoration:underline}.nor-result:after{content:'';display:block;clear:both}.nor-pill{display:inline-block;color:#deceff;border:1px solid #65518e;padding:1px 5px;border-radius:8px;margin:2px;font-size:11px}
    .nor-small{font-size:11px;color:#bfc1cf}.nor-comment{margin:4px 0 4px 10px}.nor-divider{border:0;border-top:1px solid #494a54;margin:12px 0}
    .nor-viewer{position:fixed;inset:0;z-index:2147483647;background:#171923;color:#f5f6fd;pointer-events:auto;overflow:auto;overscroll-behavior:contain;padding:calc(14px + env(safe-area-inset-top)) 15px calc(25px + env(safe-area-inset-bottom));width:100vw;height:100vh;height:100dvh;box-sizing:border-box;font:15px/1.6 system-ui,-apple-system,sans-serif}
    .nor-viewer[hidden]{display:none!important}.nor-viewer-header{position:sticky;top:0;background:#171923;padding:10px 0;z-index:1;border-bottom:1px solid #656779;display:flex;justify-content:space-between;align-items:center;gap:8px}
    .nor-viewer .nor-comment{padding:10px 0;border-bottom:1px solid #383a49;margin:0}.nor-viewer a{color:#9dc8ff}.nor-viewer .nor-button{min-height:42px}
    .nor-open{background:none;color:#a8ceff;border:0;text-decoration:underline;text-align:left;padding:0;font:inherit;cursor:pointer}.nor-no-comments{margin:7px 0;padding:9px;border:1px solid #9d8065;border-radius:7px;color:#f4d6ad}
    @media(max-width:600px),(pointer:coarse){
      #niji-or-root .nor-fab{left:8px;top:45px;bottom:auto;min-width:90px;min-height:44px}
      #niji-or-root .nor-panel{left:8px;top:76px;bottom:auto;max-height:calc(100dvh - 96px - env(safe-area-inset-bottom, 0px));width:calc(100vw - 16px)}
    }
  `;
  root.append(style);
  const message = el('div', { class:'nor-muted' });
  const labelInput = el('input', { class:'nor-input' }); labelInput.placeholder = 'OR検索語（例：不破 ふわっち ぷわ）'; labelInput.maxLength = 500;
  const filterInput = el('input', { class:'nor-input' }); filterInput.placeholder = '統合結果内を絞り込み（タイトル・検索語）';

  function button(label, fn, cls='') {
    const b = el('button',{type:'button',class:`nor-button ${cls}`,text:label});
    b.addEventListener('click', fn);
    return b;
  }
  function reportError(err) { message.textContent = `⚠ ${String(err?.message || err || '不明なエラー')}`; console.warn('[Niji OR Merger]', err); }
  function saveBlob(text, filename, type='application/json') {
    const a = el('a',{href:URL.createObjectURL(new Blob([text],{type})),text:'download'});
    a.download = filename; a.hidden = true; root.append(a); a.click();
    setTimeout(() => {URL.revokeObjectURL(a.href);a.remove();},1500);
  }
  function exportBackup() {
    saveBlob(JSON.stringify({app:'Niji OR Merger',version:VERSION,exportedAt:new Date().toISOString(),batches},null,2), 'niji-or-merged-backup.json');
    message.textContent='統合リストのバックアップを書き出しました。';
  }
  function pageIndicator(doc) {
    const active = [...doc.querySelectorAll('[aria-current="page"], .pagination .active, .pagination [class*="current"], nav [aria-current], .page-item.active')]
      .filter(x => !withinOwnUi(x) && /^\d{1,6}$/.test(clip(x.textContent, 12)))
      .map(x => clip(x.textContent, 12));
    return active[0] || '';
  }
  function domFingerprint(doc = document) {
    const content = captureDisplayed();
    return `${location.href}|${pageIndicator(doc)}|${content.rows.map(r => `${r.id}:${r.title}:${r.comments.length}:${r.comments.slice(0,2).map(c => c.sec + c.text).join(':')}`).sort().join(',')}`;
  }
  function nextPageControl() {
    const elems = [...document.querySelectorAll('a[href], button, input[type="button"], input[type="submit"], [role="button"]')]
      .filter(node => !withinOwnUi(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && node.getClientRects().length);
    const score = node => {
      const t = clip(node.getAttribute('aria-label') || node.value || node.textContent, 40).replace(/[\s　]/g, '');
      if (/^(次|次へ|次のページ|Next|NextPage|›|＞|»|→)$/i.test(t)) return 10;
      if (/^(次|次へ|Next)/i.test(t) && t.length < 11 && !/^10次/.test(t)) return 5;
      return 0;
    };
    const options = elems.map(e => ({ e, pts: score(e) })).filter(x => x.pts > 0).sort((a,b) => b.pts-a.pts);
    for (const {e} of options) {
      if (e.matches('a[href]')) {
        const href = e.getAttribute('href') || '';
        if (!href || /^(javascript:|mailto:)/i.test(href)) continue;
        try {
          const next = new URL(href, location.href);
          if (next.origin !== location.origin || !next.pathname.startsWith('/comment')) continue;
        } catch { continue; }
      }
      return e;
    }
    return null;
  }
  async function addCurrentPage(label, silent = false) {
    const {rows, truncated} = captureDisplayed();
    if (!rows.length) return { kind:'empty', count:0 };
    const page = location.href;
    const signature = `${label}|${page}|${pageIndicator(document)}|${rows.map(v=>`${v.id}:${v.title}:${v.comments.map(c=>`${c.sec}:${c.text}`).join('¦')}`).sort().join(',')}`;
    if (batches.some(b=>b.signature===signature)) return {kind:'duplicate',count:0};
    if (batches.length >= MAX_BATCHES) return {kind:'limit',count:0};
    const batch = {id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,label,page,signature,savedAt:Date.now(),rows};
    batches.push(batch);
    try { await persist(); }
    catch(e){ batches.pop(); throw e; }
    resultPage=0;
    if (!silent) render();
    return {kind:'added',count:rows.length,comments:rows.reduce((n,v)=>n+(v.comments||[]).length,0),truncated};
  }
  async function capture() {
    if (busy || autoRunning) return;
    const label = clip(labelInput.value,100);
    if (!label) {message.textContent='検索語を入力してから追加してください。';labelInput.focus();return;}
    busy=true;
    try {
      const result = await addCurrentPage(label);
      if (result.kind==='added') message.textContent=`「${label}」を${result.count}動画・${result.comments}コメント保存しました。${result.comments?'':' ※動画一覧だけではコメントOR表示はできません。'}${result.truncated?'表示件数の上限に達しました。':''}`;
      else message.textContent = result.kind==='empty'?'動画IDつきの検索結果を見つけられません。診断をコピーして共有してください。':result.kind==='duplicate'?'この検索語・ページは保存済みです。':'保存回数の上限に達しました。';
    } catch(e) { reportError(e); }
    finally { busy=false; }
  }
  function saveAutoJob() {return storeSet(AUTO_KEY, autoJob);}
  function saveMultiJob() {return storeSet(MULTI_KEY, multiJob);}
  function parseOrWords(raw='') {
    const out=[]; const seen=new Set();
    for (const part of String(raw||'').split(/[\s,、，;；|｜]+/)) {
      const w=clip(part,100);
      if (!w || seen.has(w)) continue;
      seen.add(w); out.push(w);
    }
    return out.slice(0,20);
  }
  function siteKeywordInput() {
    const candidates=[...document.querySelectorAll('input[type="text"],input:not([type]),input[type="search"]')].filter(x=>!withinOwnUi(x));
    const score=(input)=>{
      const meta=`${input.name||''} ${input.id||''} ${input.placeholder||''} ${input.getAttribute('aria-label')||''}`.toLowerCase();
      let pts=/keyword|key_word|search_word|comment|word/.test(meta)?20:0;
      try {
        if (input.id) {
          const lab=document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
          if (/キーワード/.test(lab?.textContent||'')) pts+=50;
        }
      } catch {}
      const wrap=input.closest('label,.form-group,.row,div');
      if (/キーワード/.test(wrap?.textContent||'')) pts+=30;
      return pts;
    };
    return candidates.map(x=>({x,pts:score(x)})).sort((a,b)=>b.pts-a.pts)[0]?.x || null;
  }
  async function submitSiteKeyword(word) {
    const input=siteKeywordInput();
    if (!input) {
      if (multiJob) multiJob.stage='need-search-page';
      await saveMultiJob();
      location.href='https://comment2434.com/comment/';
      return;
    }
    input.value=word;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    const form=input.form || input.closest('form');
    if (!form) throw new Error('comment2434の検索フォームを見つけられません');
    multiJob.stage='submitted';
    multiJob.currentWord=word;
    multiJob.submittedAt=Date.now();
    await saveMultiJob();
    const submit=[...form.querySelectorAll('button,input[type="submit"]')].find(b=>!b.disabled && /検索/.test(b.textContent||b.value||''));
    if (form.requestSubmit) form.requestSubmit(submit || undefined);
    else if (submit) submit.click();
    else form.submit();
  }
  async function finishMultiWord(reason='') {
    if (!multiJob?.active) return stopAuto(reason);
    const doneWord=multiJob.words[multiJob.index] || multiJob.currentWord || '';
    multiJob.completed=[...new Set([...(multiJob.completed||[]),doneWord].filter(Boolean))];
    multiJob.index+=1;
    autoJob=null;
    await saveAutoJob();
    if (multiJob.index>=multiJob.words.length) {
      const words=[...multiJob.words];
      multiJob=null;
      await saveMultiJob();
      lastAutoStatus=`✅ OR検索完了：${words.join(' / ')}`;
      render(); message.textContent=lastAutoStatus;
      return;
    }
    const nextWord=multiJob.words[multiJob.index];
    multiJob.stage='next-word';
    await saveMultiJob();
    lastAutoStatus=`「${doneWord}」完了。次は「${nextWord}」を検索します…`;
    render(); message.textContent=lastAutoStatus;
    await wait(700);
    await submitSiteKeyword(nextWord);
  }
  async function startMultiOr() {
    if (busy || autoRunning || autoJob || multiJob?.active) return;
    const words=parseOrWords(labelInput.value);
    if (!words.length) {message.textContent='OR検索する語を入力してください。';labelInput.focus();return;}
    multiJob={active:true,words,index:0,completed:[],stage:'start',startedAt:Date.now(),currentWord:words[0]};
    await saveMultiJob();
    lastAutoStatus=`OR検索開始：${words.join(' / ')}`;
    render(); message.textContent=lastAutoStatus;
    await submitSiteKeyword(words[0]);
  }
  async function cancelMultiOr() {
    autoStop=true; autoJob=null; multiJob=null;
    await Promise.all([saveAutoJob(),saveMultiJob()]);
    lastAutoStatus='OR検索を停止しました。取得済みの結果は残っています。';
    render(); message.textContent=lastAutoStatus;
  }
  async function resumeMultiOr() {
    if (!multiJob?.active || autoRunning || autoJob?.active) return;
    const word=multiJob.words?.[multiJob.index];
    if (!word) return finishMultiWord();
    const input=siteKeywordInput();
    const currentValue=clip(input?.value||'',100);
    if (!input || currentValue!==word) return submitSiteKeyword(word);
    autoJob={active:true,label:word,pages:0,videos:0,previousFingerprint:'',lastClickAt:0,startedAt:Date.now()};
    await saveAutoJob();
    void autoCollect();
  }
  async function stopAuto(reason) {
    autoStop = true;
    autoJob = null;
    await saveAutoJob();
    lastAutoStatus = reason || '連続収集を停止しました。';
    render();
    message.textContent = lastAutoStatus;
  }
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  function countAutoPages(label){ return batches.filter(b=>b.label === label).length; }
  async function autoCollect() {
    if (autoRunning || !autoJob?.active) return;
    autoRunning = true; autoStop = false;
    try {
      let prev = autoJob.previousFingerprint || '';
      let current = null;
      for (let tries=0; tries<32 && !autoStop; tries++) {
        const rows = captureDisplayed().rows;
        const fp = domFingerprint();
        if (rows.length && fp !== prev) { current = fp; break; }
        await wait(450);
      }
      if (autoStop || !autoJob) return;
      if (!current) {
        if (multiJob?.active) return await finishMultiWord(`「${autoJob.label}」は検索結果0件または結果を読めませんでした。`);
        return await stopAuto('ページが切り替わらない／検索結果を読めないため停止しました。取得済みデータは残っています。');
      }
      const label = autoJob.label;
      const saved = await addCurrentPage(label,true);
      if (saved.kind==='empty') return await stopAuto('このページから動画IDを読めなかったため停止しました。診断を共有してください。');
      if (saved.kind==='limit') return await stopAuto(`保存上限${MAX_BATCHES}回に達しました。`);
      if (saved.kind==='added') {
        autoJob.pages++;
        autoJob.videos += saved.count;
      }
      if (autoJob.pages >= AUTO_LIMIT) return await stopAuto(`安全上限${AUTO_LIMIT}ページで停止しました。続きはもう一度開始できます。`);
      const next = nextPageControl();
      if (!next) {
        const msg=`最後のページまで収集しました：${label}／${countAutoPages(label)}ページ分。`;
        if (multiJob?.active) return await finishMultiWord(msg);
        return await stopAuto(msg);
      }
      autoJob.previousFingerprint = current;
      autoJob.lastClickAt = Date.now();
      await saveAutoJob();
      render();
      message.textContent = `収集中：${label}／${autoJob.pages}ページ、延べ${autoJob.videos}本。次のページへ進みます…`;
      await wait(AUTO_NEXT_DELAY_MS);
      if (!autoJob || autoStop) return;
      next.click();
      await wait(1000);
      if (!autoStop && autoJob?.active) {
        autoRunning=false;
        void autoCollect();
      }
    } catch(e) {
      console.warn('[Niji OR Merger] 連続収集エラー', e);
      try {await stopAuto(`連続収集を停止：${String(e?.message||e)}`);}catch(inner){reportError(inner);}
    } finally { autoRunning=false; }
  }
  async function startAuto() {
    if (busy || autoRunning || autoJob) return;
    const label=clip(labelInput.value,100);
    if(!label){message.textContent='まず検索語を入力してください。';return;}
    if(!captureDisplayed().rows.length){message.textContent='検索結果が見つかりません。検索した結果の一覧ページを開いてください。';return;}
    const next=nextPageControl();
    if(!next){message.textContent='サイトの「次」ボタンが見つかりません。1ページ目が最終ページか、ページ送りの形式が未対応です。';return;}
    if(!confirm(`「${label}」の検索結果を通常の「次」ボタンで順に開き、最大${AUTO_LIMIT}ページまで保存しますか？ ※途中停止できます。`)) return;
    autoJob={active:true,label,pages:0,videos:0,previousFingerprint:'',lastClickAt:0,startedAt:Date.now()};
    try{await saveAutoJob();void autoCollect();}
    catch(e){autoJob=null;reportError(e);}
  }
  async function cancelAuto(){await stopAuto('連続収集を中断しました。保存済みの結果は残っています。');}
  async function removeBatch(id) {
    const b=batches.find(x=>x.id===id);
    if (!b || !confirm(`「${b.label}」の保存回（${b.rows.length}本）を削除しますか？ 他の検索回にある動画は残ります。`))return;
    const old=batches; batches=batches.filter(x=>x.id!==id);
    try{await persist();render();message.textContent='指定した検索回だけ削除しました。';}catch(e){batches=old;reportError(e);}
  }
  async function clearAll() {
    if (!confirm('OR統合リストのみ、すべて削除しますか？ Niji Research Helper本体のDBには触れません。'))return;
    const old=batches; batches=[];
    try{await persist();render();message.textContent='OR統合リストを初期化しました。';}catch(e){batches=old;reportError(e);}
  }
  async function copyDiag() {
    let extractCount = '取得できず';
    try {extractCount = captureDisplayed().rows.reduce((n,v)=>n+v.comments.length,0);} catch(err) {extractCount = `抽出エラー: ${String(err?.message||err)}`;}
    const anchors=[...document.querySelectorAll('main a[href],body a[href]')].filter(a=>!withinOwnUi(a));
    const imgs=[...document.querySelectorAll('main img[src],body img[src]')].filter(a=>!withinOwnUi(a));
    const report=[`Niji OR Merger v${VERSION}（個人情報・検索語本文なし）`,`保存方式 ${storageMode} / 次ボタン ${nextPageControl() ? (nextPageControl().tagName + ':' + clip(nextPageControl().textContent || nextPageControl().value,20)) : '未検出'}`,`ページ形式: ${/\/comment\/video\//.test(location.pathname)?'動画詳細':'検索・一覧'}`,`リンク数 ${anchors.length} / 画像数 ${imgs.length}`,`動画IDつきリンク ${anchors.filter(a=>videoId(a.getAttribute('href'))).length}`,`動画IDつき画像 ${imgs.filter(a=>videoId(a.getAttribute('src'))).length}`,`抽出対象動画数 ${captureDisplayed().rows.length}`,`抽出コメント数 ${extractCount}`,`時刻列 ${document.querySelectorAll('a.npf-sync-ts-bound').length}件 / 行 .row ${document.querySelectorAll('main .row').length}件`,`検索フォームの項目名（値なし）:`,...([...document.querySelectorAll('form')].filter(f=>!withinOwnUi(f)).slice(0,3).map(f=>`${f.getAttribute('method')||'GET'} ${f.getAttribute('action')||'(current)'} / ${[...f.querySelectorAll('input,select')].map(n=>n.getAttribute('name')||'(nameなし)').slice(0,15).join(',')}`)),`動画リンクの要素形式例:`,...anchors.filter(a=>videoId(a.getAttribute('href'))).slice(0,4).map(a=>`${a.tagName.toLowerCase()} class=${clip(a.className,70)} parent=${a.parentElement?.tagName.toLowerCase()}.${clip(a.parentElement?.className,70)}`)];
    try{await navigator.clipboard.writeText(report.join('\n'));message.textContent='診断をコピーしました。ここに貼り付けてください。';}
    catch {saveBlob(report.join('\n'),'niji-or-diagnostic.txt','text/plain');message.textContent='診断テキストを書き出しました。';}
  }
  function originalVideoUrl(video) {
    try {
      const url=new URL(video.url||'',location.href);
      if (/^(?:www\.)?comment2434\.com$/i.test(url.hostname) && videoId(url.href)===video.id && /\/comment\/video\//.test(url.pathname)) return url.href;
    } catch {}
    return `https://comment2434.com/comment/video/${video.id}/`;
  }
  function showMergedViewer(video) {
    viewer.replaceChildren();
    const heading = el('div',{class:'nor-viewer-header'},
      el('strong',{text:'🔀 OR統合コメント'}),
      button('閉じる',()=>{
        viewer.hidden=true;
        trigger.style.setProperty('display','none','important');
        panel.hidden=false;
        render();
      }));
    viewer.append(heading,el('h2',{text:video.title}),
      el('div',{class:'nor-small',text:`検索語: ${[...video.labels].join(' / ')} ／ 保存済みコメント ${video.comments.size}件` }));
    const original = el('a',{href:originalVideoUrl(video),target:'_blank',rel:'noopener noreferrer',text:'元サイトで開く（元サイトの検索欄はORになりません）'});
    viewer.append(original);
    const capturedWords=new Set([...video.comments.values()].flatMap(c=>[...(c.matchLabels||[])]));
    const missingWords=[...video.labels].filter(word=>!capturedWords.has(word));
    if (missingWords.length && video.comments.size) {
      viewer.append(el('div',{class:'nor-no-comments',text:`まだコメントが保存されていない検索語: ${missingWords.join(' / ')}。この語は動画一覧だけの記録です。元サイトでこの動画を該当語で検索し、コメント画面を保存してください。`}));
    }
    if (!video.comments.size) {
      viewer.append(el('div',{class:'nor-no-comments',text:'この動画のコメント本文・時刻はまだ保存されていません。以前の110動画などは動画一覧だけの保存です。元サイトで動画を開き、各キーワードを検索してコメント結果を保存してください。'}));
    } else {
      for (const c of [...video.comments.values()].sort((a,b)=>a.sec-b.sec || a.text.localeCompare(b.text,'ja'))) {
        const item=el('div',{class:'nor-comment'});
        item.append(el('a',{href:c.url||`https://www.youtube.com/watch?v=${video.id}&t=${c.sec}s`,target:'_blank',rel:'noopener noreferrer',text:hhmmss(c.sec)}),document.createTextNode(` ${clip(c.text,2000)} `));
        for(const word of c.matchLabels||[])item.append(el('span',{class:'nor-pill',text:word}));
        viewer.append(item);
      }
    }
    panel.hidden=true;
    viewer.hidden=false;
    trigger.style.setProperty('display','none','important');
    viewer.scrollTop=0;
  }
  function render() {
    const oldInput=labelInput.value, oldFilter=filterInput.value;
    body.replaceChildren();
    body.append(el('div',{class:'nor-muted',text:'複数ワードをスペース・改行・カンマ・「、」で区切って入力し、「OR検索開始」を1回押すだけで、各ワードの検索→全ページ収集→統合まで自動で進みます。'}));
    body.append(el('div',{class:'nor-row'},labelInput));
    body.append(el('div',{class:'nor-row'},button('🔀 OR検索開始',startMultiOr,'primary'),button('📄 診断をコピー',copyDiag)));
    if(multiJob?.active) {
      const now=multiJob.words?.[multiJob.index]||multiJob.currentWord||'';
      body.append(el('div',{class:'nor-note',text:`🔄 OR自動収集中：${multiJob.index+1}/${multiJob.words.length}「${now}」 ／ ${autoJob?.pages||0}ページ`}),el('div',{class:'nor-row'},button('■ OR検索を停止',cancelMultiOr)));
    } else if(autoJob?.active) body.append(el('div',{class:'nor-note',text:`🔄 連続収集中：${autoJob.label} ／ ${autoJob.pages}ページ（延べ${autoJob.videos}本）。`}),el('div',{class:'nor-row'},button('■ 収集を停止',cancelAuto)));
    else if(lastAutoStatus) body.append(el('div',{class:'nor-muted',text:lastAutoStatus}));
    const videos=mergedVideos();
    const countComments=videos.reduce((n,v)=>n+v.comments.size,0);
    body.append(el('div',{class:'nor-note',text:`保存 ${batches.length}検索回 ／ 統合 ${videos.length}動画 ／ 表示中に見つけたコメント位置 ${countComments}件`}),message);
    if (batches.length) {
      const details=el('details'); const summary=el('summary',{text:`保存した検索回を見る（${batches.length}回）`});details.append(summary);
      for (const b of batches) details.append(el('div',{class:'nor-batch'},el('div',{},el('strong',{text:b.label}),el('div',{class:'nor-small',text:`${b.rows.length}動画 · ${new Date(b.savedAt).toLocaleString('ja-JP')}`})),button('削除',()=>removeBatch(b.id))));
      body.append(details);
      body.append(el('div',{class:'nor-row'},button('💾 統合データをバックアップ',exportBackup),button('すべて削除',clearAll)));
      body.append(el('hr',{class:'nor-divider'}),el('strong',{text:`統合一覧（動画単位）`}));
      body.append(filterInput);
      filterInput.value=oldFilter;
      const q=filter.trim().toLowerCase();
      const selected=q?videos.filter(v=>`${v.title} ${[...v.labels].join(' ')}`.toLowerCase().includes(q)):videos;
      const pages=Math.max(1,Math.ceil(selected.length/PAGE_SIZE));resultPage=Math.min(resultPage,pages-1);
      body.append(el('div',{class:'nor-muted',text:`${selected.length}動画 ／ ${resultPage+1}/${pages}ページ。同じ動画は統合、異なるコメント時刻は保持します。` }));
      for(const v of selected.slice(resultPage*PAGE_SIZE,(resultPage+1)*PAGE_SIZE)){
        const card=el('div',{class:'nor-result'});
        const image=el('img',{src:`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,alt:'配信サムネイル',loading:'lazy'});
        image.style.cssText='width:96px;height:54px;object-fit:cover;float:left;margin:0 9px 6px 0;border-radius:5px;';
        card.append(image);
        card.append(button(v.title,()=>showMergedViewer(v),'nor-open'),
          el('div',{class:'nor-small',text:`${v.channel ? 'チャンネル: ' + v.channel + ' ／ ' : ''}動画ID: ${v.id} ／ 検索語 ${v.labels.size}種類 ／ 保存済みコメント ${v.comments.size}件` }));
        const pills=el('div');for(const label of v.labels)pills.append(el('span',{class:'nor-pill',text:label}));card.append(pills);
        card.append(el('div',{class:'nor-row'},button(`🔀 統合コメントを見る（${v.comments.size}件）`,()=>showMergedViewer(v),'primary'),
          el('a',{href:originalVideoUrl(v),target:'_blank',rel:'noopener noreferrer',text:'元サイトへ（単語別）'})));
        if(!v.comments.size)card.append(el('div',{class:'nor-no-comments',text:'コメント未保存：この動画には統合できるコメントがまだありません。'}));
        body.append(card);
      }
      body.append(el('div',{class:'nor-row'},button('← 前へ',()=>{resultPage=Math.max(0,resultPage-1);render();}),el('span',{class:'nor-small',text:`${resultPage+1}/${pages}`}),button('次へ →',()=>{resultPage=Math.min(pages-1,resultPage+1);render();})));
      const nav=body.lastElementChild;nav.firstElementChild.disabled=resultPage===0;nav.lastElementChild.disabled=resultPage>=pages-1;
    }
    labelInput.value=oldInput;
    body.append(el('div',{class:'nor-muted',text:'OR自動検索はcomment2434の通常の検索フォームと「次」ボタンを順に操作します。1語あたり最大100ページ・約3秒間隔。取得済みの統合データとNiji Research Helper本体DBは変更・削除しません。'}));
  }
  filterInput.addEventListener('input',()=>{
    const pos = filterInput.selectionStart;
    filter=filterInput.value; resultPage=0; render();
    filterInput.focus();
    if (pos != null) try { filterInput.setSelectionRange(pos,pos); } catch {}
  });
  const toggle=()=>{
    panel.hidden=!panel.hidden;
    trigger.style.setProperty('display',panel.hidden?'block':'none','important');
    if(!panel.hidden) try { render(); }
    catch(err) {
      console.error('[Niji OR Merger] パネル描画エラー',err);
      body.replaceChildren(el('div',{class:'nor-note',text:`⚠ 表示エラー: ${String(err?.message || err)}`}));
      body.append(button('診断をコピー',copyDiag));
    }
  };
  trigger.addEventListener('click',toggle);close.addEventListener('click',toggle);
  try {
    const saved=await storeGet(STORAGE_KEY,[]);
    if(Array.isArray(saved))batches=saved.filter(b=>b&&typeof b.label==='string'&&Array.isArray(b.rows));
    else console.warn('[Niji OR Merger] unexpected stored data');
  }catch(err){console.warn('[Niji OR Merger] load failed',err);}
  try {
    const pending=await storeGet(AUTO_KEY,null);
    if(pending?.active && typeof pending.label==='string' && Date.now()-Number(pending.startedAt||0)<12*60*1000 && location.pathname.startsWith('/comment')) autoJob=pending;
    else if(pending?.active) {lastAutoStatus='前回の連続収集は期限切れのため自動再開しません。';await storeSet(AUTO_KEY,null);}
  } catch(e){console.warn('[Niji OR Merger] resume check',e);}
  try {
    const pendingMulti=await storeGet(MULTI_KEY,null);
    if(pendingMulti?.active && Array.isArray(pendingMulti.words) && pendingMulti.words.length && Date.now()-Number(pendingMulti.startedAt||0)<30*60*1000) multiJob=pendingMulti;
    else if(pendingMulti?.active) {await storeSet(MULTI_KEY,null);}
  } catch(e){console.warn('[Niji OR Merger] multi resume check',e);}
  try {
    render();
  } catch(err) {
    console.error('[Niji OR Merger] 初期表示エラー', err);
    body.replaceChildren();
    body.append(el('div',{class:'nor-note',text:`⚠ OR統合の表示でエラー: ${String(err?.message || err)}`}));
    body.append(button('診断をコピー',copyDiag));
    panel.hidden = false;
    trigger.style.setProperty('display','none','important');
  }
  labelInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void startMultiOr();}});
  if(multiJob?.active) void resumeMultiOr();
  else if(autoJob?.active) void autoCollect();
  hostRecoveryTimer=setInterval(() => {
    if (!host.isConnected && document.body) document.body.append(host);
  }, 2000);
})().catch(err => {
  if (location.protocol !== 'https:' || !['comment2434.com','www.comment2434.com'].includes(location.hostname.toLowerCase())) return;
  console.error('[Niji OR Merger] 起動エラー', err);
  const boot=document.getElementById('niji-or-trigger') || document.getElementById('niji-or-boot-check');
  if(boot){
    boot.textContent='⚠ OR起動エラー';
    boot.style.background='#b91c1c';
    boot.onclick=()=>alert('OR統合 起動エラー: '+String(err?.message||err));
    boot.style.setProperty('display','block','important');
    return;
  }
  const b = document.createElement('button');
  b.textContent = '⚠ OR統合 起動エラー';
  b.style.cssText = 'position:fixed!important;top:45px!important;left:8px!important;bottom:auto!important;display:block!important;z-index:2147483647!important;background:#b91c1c!important;color:white!important;border-radius:10px!important;padding:12px!important;font-size:14px!important;';
  b.addEventListener('click', () => alert('OR統合 起動エラー: ' + String(err?.message || err)));
  (document.body || document.documentElement).append(b);
});
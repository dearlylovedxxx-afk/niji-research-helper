// ==UserScript==
// @name         Niji OR Results Merger (standalone add-on)
// @namespace    niji-or-results-merger-standalone
// @version      0.4.10
// @description  コメントOR試験版。動画タイトル・配信日時の補完、明示的な並び順、正しい動画IDのタイムスタンプと直接開けるコメント一覧。本体DBは変更しません。
// @match        https://comment2434.com/*
// @match        https://www.comment2434.com/*
// @include      https://comment2434.com/*
// @include      https://www.comment2434.com/*
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_OR_Results_Merger.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_OR_Results_Merger.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @connect      niji-research-backup.dearlylovedxxx.workers.dev
// @require      https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Cloud_Backup.user.js
// @connect      www.youtube.com
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
  boot.textContent='🔀 OR起動中 0.4.10';
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
  console.info('[Niji OR Merger] v0.4.10 injected', location.href);
  const previousRoot = document.getElementById('niji-or-root');
  if (previousRoot) previousRoot.remove();

  const STORAGE_KEY = 'niji_or_merger_addon_batches_v1';
  const VERSION = '0.4.10';
  const VIDEO_META_KEY = 'niji_or_merger_addon_video_metadata_v046';
  const RESULT_SORT_KEY = 'niji_or_merger_addon_result_sort_v046';
  const AUTO_KEY = 'niji_or_merger_addon_auto_v3';
  const MULTI_KEY = 'niji_or_merger_addon_multi_v1';
  const RUN_KEY = 'niji_or_merger_addon_run_v041';
  const LAST_WORDS_KEY = 'niji_or_merger_addon_last_words_v041';
  const MIN_COMMENTS_KEY = 'niji_or_merger_addon_minimum_v1';
  const MAX_RUN_VIDEOS = 150;
  const MAX_RUN_PAGES = 100;
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
  let runJob = null;
  let lastRunWords = [];
  let runDriving = false;
  let lastAutoStatus = '';
  let videoMetadata = {};
  let resultSort = 'comments';
  let metadataQueue = [];
  let metadataBusy = false;
  let metadataNextAt = 0;
  let metadataStopped = false;
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
  function usableVideoTitle(text, id='') {
    const value=clip(text,240);
    if (!value || value===id || /^動画 [\w-]{11}$/.test(value) || /^\d+\s*(?:コメント|件|回)$/.test(value)) return '';
    if (/^(?:動画詳細|コメント|他視点|再生|検索|検索結果|チャンネル|YouTube)$/i.test(value)) return '';
    if (/^(?:\d{1,3}:)?\d{1,3}:\d{2}$/.test(value)) return '';
    return value;
  }
  // Channel headers such as "不破湊 / Fuwa Minato 【にじさんじ】" are not stream titles.
  function isChannelHeading(value='') {
    const t=clip(value,240);
    return /^(?:.{1,36}\s*\/\s*[A-Za-z][A-Za-z .'-]{2,55}\s*【にじさんじ】|.{1,36}\s*【にじさんじ】)$/.test(t)
      && !/[#＃\[\]【】].*(?:APEX|VALORANT|雑談|マイクラ|にじ甲|スプラ|歌枠|配信)/i.test(t);
  }
  function validStreamTitle(value,id='') {
    const t=usableVideoTitle(value,id);
    return t && !isChannelHeading(t) ? t : '';
  }
  function metadataDateFromCard(card) {
    const date=card.querySelector('time[datetime],[itemprop="startDate"],[itemprop="datePublished"],meta[itemprop="uploadDate"]');
    const raw=date?.getAttribute('datetime')||date?.getAttribute('content')||'';
    return /^20\d\d-\d\d-\d\d(?:T|$)/.test(raw) ? raw : '';
  }
  function titleFromLink(a, card, id) {
    const headings=[...card.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="Title"]')];
    const others=[...card.querySelectorAll('img[alt],p,a[title]')].slice(0,30);
    const picks=[
      a.getAttribute('title'),a.getAttribute('aria-label'),
      ...headings.map(x=>x.textContent),
      ...others.map(x=>x.tagName==='IMG'?x.getAttribute('alt'):x.getAttribute('title')||x.textContent),
      card.querySelector('img[alt]')?.getAttribute('alt'),
      a.textContent,
    ];
    return picks.map(t=>validStreamTitle(t,id)).find(Boolean) || `動画 ${id}`;
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
        entry = { id, title, sourceUrl: cleanUrl(a.href || '') || `https://comment2434.com/comment/video/${id}/`, channel: '', publishedAt:metadataDateFromCard(card), comments: [] };
        groups.set(id, entry);
      } else if (validStreamTitle(title,id) && !validStreamTitle(entry.title,id)) entry.title = title;
      if (!entry.publishedAt) entry.publishedAt=metadataDateFromCard(card);
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
      if (!validStreamTitle(old.title,current)) old.title = validStreamTitle(document.querySelector('meta[property="og:title"]')?.content,current) || validStreamTitle(document.title.replace(/\s*[-|｜]\s*にじさんじコメント検索.*$/,''),current) || old.title;
      if (!old.publishedAt) old.publishedAt=metadataDateFromCard(root);
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
        e = { id: v.id, title: v.title, channel: v.channel || '', publishedAt:v.publishedAt||'', url: v.sourceUrl, labels: new Set(), comments: new Map() };
        byId.set(v.id, e);
      }
      if (!validStreamTitle(e.title,v.id) && validStreamTitle(v.title,v.id)) e.title = v.title;
      if (!e.publishedAt && v.publishedAt) e.publishedAt=v.publishedAt;
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
  style.textContent += `
    #niji-or-root .nor-viewer{background:#fff!important;color:#202124!important;padding:0 0 30px!important;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif!important}
    #niji-or-root .nor-viewer-header{background:#fff!important;color:#202124!important;top:0;padding:13px 15px;border-bottom:1px solid #e5e7eb;box-shadow:0 1px 3px #0001}
    #niji-or-root .nor-viewer .nor-button{background:#f4f5f7;color:#202124;border:1px solid #d7dbe2}
    #niji-or-root .nor-viewer a{color:#1769d2;text-decoration:none}
    #niji-or-root .nor-viewer a:hover{text-decoration:underline}
    #niji-or-root .nor-list{max-width:900px;margin:auto;padding:10px 14px}
    #niji-or-root .nor-video-card{display:flex;gap:12px;align-items:flex-start;border-bottom:1px solid #e9ecef;padding:14px 0;cursor:pointer}
    #niji-or-root .nor-video-card img{width:126px;height:71px;object-fit:cover;border-radius:6px;flex:none}
    #niji-or-root .nor-video-title{font-size:15px;font-weight:600;text-align:left;background:none;border:0;padding:0;color:#182230;cursor:pointer}
    #niji-or-root .nor-video-count{font-size:12px;color:#596579;margin-top:5px}
    #niji-or-root .nor-light-pill{font-size:11px;border-radius:9px;background:#f1efff;color:#5440a3;padding:2px 6px;display:inline-block;margin:2px 3px 0 0}
    #niji-or-root .nor-comment-list{max-width:940px;margin:auto;padding:8px 14px}
    #niji-or-root .nor-comment-line{display:grid;grid-template-columns:78px minmax(0,1fr);gap:9px;align-items:start;padding:5px 0;border-bottom:1px solid #f1f2f5;font-size:15px}
    #niji-or-root .nor-time{white-space:nowrap;font-variant-numeric:tabular-nums;color:#1769d2}
    #niji-or-root .nor-comment-text{white-space:pre-wrap;overflow-wrap:anywhere;color:#202124}
    #niji-or-root .nor-light-input{width:100%;border:1px solid #c8cdd7;border-radius:7px;background:#fff;color:#1c2430;padding:10px;font:inherit;margin:10px 0}
    #niji-or-root .nor-compact{padding:12px 14px;color:#596579;font-size:13px}
    @media(max-width:600px){#niji-or-root .nor-video-card img{width:100px;height:57px}#niji-or-root .nor-comment-line{grid-template-columns:68px minmax(0,1fr);gap:5px;font-size:14px}}
  `;
  style.textContent += `
    #niji-or-root .nor-sort-row{display:flex;align-items:center;gap:8px;padding:0 0 8px;font-size:13px;color:#364152}
    #niji-or-root .nor-sort-select{width:auto;max-width:100%;margin:0;padding:7px;font-size:13px}
    #niji-or-root .nor-thumb-button{padding:0;border:0;background:none;flex:none;cursor:pointer}
    #niji-or-root .nor-thumb-button img{display:block;width:126px;height:71px;object-fit:cover;border-radius:6px}
    #niji-or-root .nor-video-info{min-width:0;flex:1}
    #niji-or-root .nor-video-title{display:block;width:100%;overflow-wrap:anywhere;line-height:1.5}
    #niji-or-root .nor-video-date{color:#48556a;font-size:12px;margin:5px 0}
    #niji-or-root .nor-video-channel{color:#64748b;font-size:11px;margin:3px 0}
    #niji-or-root .nor-count-button{background:#ecf1ff;border:1px solid #b8c9fa;color:#174aa8;margin:4px 0 5px;padding:7px 11px;font-size:13px;cursor:pointer}
    @media(max-width:600px){#niji-or-root .nor-thumb-button img{width:100px;height:57px}}
  `;
  const message = el('div', { class:'nor-muted' });
  const labelInput = el('input', { class:'nor-input' }); labelInput.placeholder = 'OR検索語（例：不破 ふわっち ぷわ）'; labelInput.maxLength = 500;
  const minimumInput = el('input', {class:'nor-input', type:'number'});
  minimumInput.min='1'; minimumInput.max='9999'; minimumInput.step='1'; minimumInput.inputMode='numeric';
  minimumInput.value='10'; minimumInput.placeholder='例：10';
  minimumInput.style.cssText='max-width:115px;flex:none;';
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
  // v0.4.1: one native same-origin page at a time. Never mistake a video list for comments.
  const isDetailPage=()=>/\/comment\/video\/[\w-]{11}/.test(location.pathname);
  const currentVideoId=()=>videoId(location.href);
  const runWord=()=>runJob?.words?.[runJob.index]||'';
  const saveRun=()=>storeSet(RUN_KEY,runJob);
  function findKeywordForm(detail=false) {
    return [...document.querySelectorAll('form')].find(f=>!withinOwnUi(f) && f.querySelector('[name="keyword"]') && (detail ? isDetailPage() : !isDetailPage())) || null;
  }
  function keywordSearchUrl(form, word) {
    if (!form || String(form.method||'GET').toUpperCase()!=='GET') throw new Error('対応するGET検索フォームが見つかりません');
    const action=new URL(form.getAttribute('action')||location.pathname,location.href);
    if (action.origin!==location.origin || !action.pathname.startsWith('/comment')) throw new Error('検索先URLを確認できません');
    const data=new URLSearchParams(new FormData(form));
    data.set('keyword',word);
    if (!isDetailPage()) {
      // The site's search form provides a native minimum-hit filter; filter BEFORE collecting videos.
      if (!form.querySelector('[name="least_count"]')) throw new Error('検索サイトの最低コメント数欄が見つかりません。フィルターなしで大量取得せず停止しました');
      const minimum=Number(runJob?.minComments ?? 1); // pre-v0.4.4 paused jobs keep their original unfiltered meaning
      if (!Number.isSafeInteger(minimum) || minimum<1 || minimum>9999) throw new Error('最低コメント数の設定を確認できません');
      data.set('least_count',String(minimum));
    }
    action.search=data.toString();
    action.hash='';
    return action.href;
  }
  async function goRun(url) {
    const u=new URL(url,location.href);
    if (u.origin!==location.origin || !u.pathname.startsWith('/comment')) throw new Error('サイト外への移動はできません');
    await saveRun();
    const waitMs=Math.max(0,3000-(Date.now()-Number(runJob?.lastNavigationAt||0)));
    if (waitMs) await wait(waitMs);
    if (!runJob?.active) return;
    runJob.lastNavigationAt=Date.now();
    await saveRun();
    if (u.href===location.href) location.reload();
    else location.assign(u.href);
  }
  async function failRun(error) {
    if (!runJob) return;
    runJob.active=false;
    runJob.error=String(error?.message||error||'検索に失敗しました');
    await saveRun();
    render();
    message.textContent=`⚠ ${runJob.error}。完了扱いにしていません。取得済みデータは残っています。`;
  }
  async function startRun() {
    if (runDriving || runJob?.active) return;
    const words=parseOrWords(labelInput.value);
    if (!words.length) {message.textContent='OR検索語を入力してください。';return;}
    if (words.length>10) {message.textContent='1回の検索は10語までにしてください。';return;}
    const minComments=Number(minimumInput.value.trim());
    if(!Number.isSafeInteger(minComments)||minComments<1||minComments>9999){message.textContent='最低コメント数は1〜9999の整数で指定してください。';minimumInput.focus();return;}
    await storeSet(MIN_COMMENTS_KEY,minComments);
    runJob={active:true,words,minComments,index:0,stage:'search',list:[],seenPages:[],collectedIds:[],pendingNextUrl:'',chunkPages:0,completedVideos:0,partial:[],detailIndex:0,pages:0,startedAt:Date.now(),lastNavigationAt:0,error:''};
    lastRunWords=[...words];
    await Promise.all([saveRun(),storeSet(LAST_WORDS_KEY,lastRunWords)]);
    // An old v0.4.0 background job must not restart the obsolete video-only path.
    autoJob=null;multiJob=null;
    await Promise.all([saveAutoJob(),saveMultiJob()]);
    render();
    void driveRun();
  }
  async function stopRun() {
    if (runJob) {runJob.active=false;runJob.error='手動停止しました。';await saveRun();}
    render(); message.textContent='停止しました。保存済みの結果は残っています。';
  }
  async function resumeRun() {
    if (!runJob || runJob.active || runDriving) return;
    if (runJob.stage==='chunk-paused') {
      if (!runJob.pendingNextUrl) {message.textContent='続きの検索ページが保存されていません。完了扱いにせず停止します。';return;}
      runJob.stage='chunk-nav';
    } else if (runJob.stage==='list' && /安全上限\d+動画を超えた/.test(runJob.error||'') && runJob.list?.length>=MAX_RUN_VIDEOS) {
      // Resume v0.4.3/v0.4.4 jobs stopped with 160 videos on page 16.
      // Reopen their last SAVED list page instead of scanning from page one.
      runJob.stage='legacy-limit-prepare';
      runJob.collectedIds=[...new Set([...(runJob.collectedIds||[]),...runJob.list.map(v=>v.id)])];
    }
    runJob.active=true;runJob.error='';
    await saveRun();render();void driveRun();
  }
  async function persistRunPartial() {
    if (!runJob?.partial?.length) return;
    const word=runWord();
    if (!word) throw new Error('保存する検索語を復元できません');
    const rows=runJob.partial.filter(v=>Array.isArray(v.comments)&&v.comments.length);
    if (!rows.length) return;
    const signature=`or-v041|${runJob.startedAt}|${word}`;
    const existing=batches.find(b=>b.signature===signature);
    if(existing) {
      const previous=existing.rows;
      const byId=new Map((previous||[]).map(v=>[v.id,v]));
      for(const v of rows) {
        const old=byId.get(v.id);
        if (!old) {byId.set(v.id,v);continue;}
        const comments=new Map([...(old.comments||[]),...v.comments].map(c=>[`${c.sec}|${c.text}`,c]));
        byId.set(v.id,{...old,...v,comments:[...comments.values()]});
      }
      existing.rows=[...byId.values()];
      try {await persist();} catch(err){existing.rows=previous;throw err;}
      return;
    }
    if(batches.length>=MAX_BATCHES) throw new Error('保存回数上限に達しました');
    const batch={id:`or-${runJob.startedAt}-${runJob.index}`,label:word,page:runJob.searchUrl||location.href,signature,savedAt:Date.now(),rows:[...rows]};
    batches.push(batch);
    try {await persist();} catch(err){batches.pop();throw err;}
  }
  function nextResultPageUrl() {
    const next=nextPageControl();
    if (!next) return '';
    if (!next.matches('a[href]')) throw new Error('次の検索ページのURLを確認できません');
    const url=new URL(next.getAttribute('href'),location.href);
    const current=new URL(location.href);
    if (url.origin!==location.origin || !url.pathname.startsWith('/comment') || url.searchParams.get('keyword')!==runWord()) throw new Error('次の検索ページを安全に特定できません');
    if (current.searchParams.has('least_count') && url.searchParams.get('least_count')!==current.searchParams.get('least_count')) throw new Error('次のページで最低コメント数が維持されません。停止しました');
    if (runJob.seenPages.includes(url.href)) throw new Error('同じ検索ページが繰り返されるため停止しました');
    return url.href;
  }
  async function beginDetailsAfterList() {
    if (!runJob?.list?.length) throw new Error('コメント取得対象の動画がありません');
    runJob.stage='detail-open';runJob.detailIndex=0;
    await saveRun();
    const first=runJob.list[0];
    await goRun(normalizedDetailUrl(first));
  }
  async function pauseRunChunk() {
    if (!runJob?.active || runJob.stage==='chunk-paused') return;
    if (!runJob.pendingNextUrl) throw new Error('続きを示すページURLが見つかりません');
    await persistRunPartial();
    runJob.completedVideos=(runJob.completedVideos||0)+runJob.list.length;
    runJob.stage='chunk-paused';
    runJob.active=false;
    runJob.error='';
    runJob.note=`${runJob.pages}ページ・累計${runJob.collectedIds?.length||runJob.completedVideos}動画を確認済み。続きは「続きから収集」で再開できます。`;
    await saveRun();
    render();
    message.textContent='✅ 今回の動画のコメント取得を保存しました。次の検索ページから再開できます。';
  }
  function looksLikeAccessDenied() {
    const main=document.querySelector('main')||document.body;
    const text=String(main?.textContent||'').slice(0,9000);
    return /\b(?:429|403|503|Too Many Requests|Access Denied|Rate Limit)\b|アクセス(?:制限|が集中)|しばらく時間をおいて/i.test(`${document.title} ${text}`);
  }
  async function finishRunWord() {
    const word=runWord();
    await persistRunPartial();
    runJob.index++;
    if (runJob.index>=runJob.words.length) {
      lastRunWords=[...runJob.words];
      await storeSet(LAST_WORDS_KEY,lastRunWords);
      runJob=null;await saveRun();
      render();showResultsViewer();
      return;
    }
    runJob.stage='search';runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.seenPages=[];runJob.collectedIds=[];runJob.pendingNextUrl='';runJob.chunkPages=0;runJob.pages=0;runJob.note='';
    await saveRun();
    await goRun(new URL('/comment/',location.origin).href);
  }
  function detailedVideoTitle(fallback, id) {
    const picks=[
      ...[...document.querySelectorAll('main h1,main h2,main [class*="video-title"],main [class*="videoTitle"]')].slice(0,10).map(n=>n.textContent),
      document.querySelector('meta[property="og:title"]')?.content,
      document.title.replace(/\s*[-|｜]\s*にじさんじコメント検索.*$/,'').trim(),
    ];
    const title=picks.map(t=>validStreamTitle(t,id)).find(t=>t && !/^(?:にじさんじコメント検索|コメント検索|キーワード検索|検索結果)/.test(t));
    return title||fallback;
  }
  function normalizedDetailUrl(v) {
    // Use the actual video's path, but keep the current origin and browser session.
    const u=new URL(v.sourceUrl||`/comment/video/${v.id}/`,location.href);
    if (u.origin!==location.origin && !['comment2434.com','www.comment2434.com'].includes(u.hostname)) throw new Error('動画URLの取得に失敗しました');
    if (!u.pathname.startsWith(`/comment/video/${v.id}`)) throw new Error('動画IDとリンクが一致しません');
    return new URL(u.pathname,location.origin).href;
  }
  async function driveRun() {
    if (runDriving || !runJob?.active) return;
    runDriving=true;
    try {
      const word=runWord();
      if (!word) throw new Error('検索語を復元できません');
      if (/429|Too Many Requests|アクセスが集中しています/i.test(document.title)) throw new Error('アクセス制限が発生しています');
      if (runJob.stage==='legacy-limit-prepare') {
        const last=runJob.seenPages?.[runJob.seenPages.length-1];
        if (!last || !runJob.list?.length) throw new Error('旧版の検索進捗を確認できません。完了扱いにはしていません');
        if (location.href!==last) {await goRun(last);return;}
        runJob.pendingNextUrl=nextResultPageUrl();
        runJob.chunkPages=runJob.pages;
        await beginDetailsAfterList();return;
      }
      if (runJob.stage==='chunk-nav') {
        const target=runJob.pendingNextUrl;
        if (!target) throw new Error('続きのページURLがありません');
        const u=new URL(target,location.href);
        if (u.origin!==location.origin || !u.pathname.startsWith('/comment') || u.searchParams.get('keyword')!==word || runJob.seenPages.includes(u.href)) throw new Error('続きのページURLが検索条件と一致しません');
        if (location.href!==u.href) {await goRun(u.href);return;}
        // Clear ONLY the previous chunk, never the saved comments or visited pages.
        runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.chunkPages=0;runJob.pendingNextUrl='';runJob.note='';runJob.stage='list';
        await saveRun();
      }
      if (runJob.stage==='search') {
        if (isDetailPage() || !findKeywordForm()) {await goRun(new URL('/comment/',location.origin).href);return;}
        runJob.searchUrl=keywordSearchUrl(findKeywordForm(),word);
        runJob.stage='list';runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.seenPages=[];runJob.collectedIds=[];runJob.pendingNextUrl='';runJob.chunkPages=0;runJob.pages=0;
        await goRun(runJob.searchUrl);return;
      }
      if (runJob.stage==='list') {
        if (isDetailPage() || new URLSearchParams(location.search).get('keyword')!==word) throw new Error('検索結果ページを確認できません。サイトの検索形式が変わった可能性があります');
        if (runJob.seenPages.includes(location.href)) throw new Error('同じ検索ページが繰り返されたため停止しました');
        let found=captureDisplayed().rows;
        if (!found.length) {
          // Some result pagers link one page beyond their actual last page.
          // Wait for delayed DOM rendering before interpreting a blank page.
          for (let attempt=0;attempt<3 && !found.length;attempt++) {
            await wait(650);
            found=captureDisplayed().rows;
          }
        }
        if (!found.length) {
          if (looksLikeAccessDenied()) throw new Error('アクセス制限と思われるページです。自動収集を停止しました');
          if (runJob.pages===0 && /(?:検索結果|コメント).{0,25}(?:0件|ありません|見つかりません|該当なし)/.test(document.body.textContent||'')) {await finishRunWord();return;}
          if (runJob.pages>0 && runJob.list.length && findKeywordForm()) {
            // Keep a note: an unexpected empty page could also mean a changed site.
            runJob.note=`${runJob.pages}ページ・${runJob.list.length}動画の後に空ページがありました。取得済み動画のコメントを収集中です。`;
            await beginDetailsAfterList();return;
          }
          throw new Error('検索結果の動画を取得できません。検索ページの構造やアクセス制限を確認してください');
        }
        runJob.seenPages.push(location.href);runJob.pages++;runJob.chunkPages=(runJob.chunkPages||0)+1;
        if (!Array.isArray(runJob.collectedIds)) runJob.collectedIds=runJob.list.map(v=>v.id);
        const known=new Set(runJob.collectedIds);
        for(const item of found) if (!known.has(item.id)) {
          runJob.list.push({id:item.id,title:item.title,sourceUrl:item.sourceUrl,channel:item.channel,publishedAt:item.publishedAt||''});
          runJob.collectedIds.push(item.id);known.add(item.id);
        }
        const nextUrl=nextResultPageUrl();
        if (nextUrl && (runJob.list.length>=MAX_RUN_VIDEOS || runJob.chunkPages>=MAX_RUN_PAGES)) {
          runJob.pendingNextUrl=nextUrl;
          if (runJob.list.length) {await beginDetailsAfterList();return;}
          await pauseRunChunk();return;
        }
        if(nextUrl){await goRun(nextUrl);return;}
        if(runJob.list.length){await beginDetailsAfterList();return;}
        await finishRunWord();return;
      }
      if (runJob.stage==='detail-open') {
        const v=runJob.list[runJob.detailIndex];
        if(!v){if(runJob.pendingNextUrl) await pauseRunChunk();else await finishRunWord();return;}
        if(!isDetailPage() || currentVideoId()!==v.id){await goRun(normalizedDetailUrl(v));return;}
        const form=findKeywordForm(true);
        if(!form) throw new Error(`動画 ${v.id} にコメント検索欄が見つかりません`);
        const url=keywordSearchUrl(form,word);
        if(new URL(url).pathname!==location.pathname || new URLSearchParams(new URL(url).search).get('keyword')!==word) throw new Error('動画のキーワード検索URLが不正です');
        runJob.stage='detail-results';await goRun(url);return;
      }
      if (runJob.stage==='detail-results') {
        const v=runJob.list[runJob.detailIndex];
        if(!v || !isDetailPage() || currentVideoId()!==v.id || new URLSearchParams(location.search).get('keyword')!==word) throw new Error('動画の検索結果URLを確認できません');
        const main=document.querySelector('main')||document.body;
        const comments=extractComments(main,v.id);
        if(!comments.length && !/(?:コメント|検索結果|該当).{0,25}(?:0件|ありません|なし|見つかりません)/.test(main.textContent||'')) throw new Error(`動画 ${v.id} のコメント本文を読み取れません。0件として保存せず停止しました`);
        const map=new Map(comments.map(c=>[`${c.sec}|${c.text}`,c]));
        runJob.partial.push({id:v.id,title:detailedVideoTitle(v.title,v.id),sourceUrl:v.sourceUrl,channel:v.channel||'',publishedAt:v.publishedAt||metadataDateFromCard(main),comments:[...map.values()]});
        runJob.detailIndex++;
        runJob.stage='detail-open';
        await saveRun();
        // Make each successfully fetched video's comments visible immediately.
        // A later error must not erase already collected comment timestamps.
        await persistRunPartial();
        const nextVideo=runJob.list[runJob.detailIndex];
        if(nextVideo){await goRun(normalizedDetailUrl(nextVideo));return;}
        if(runJob.pendingNextUrl) await pauseRunChunk();
        else await finishRunWord();
        return;
      }
      throw new Error(`不明な検索状態: ${runJob.stage}`);
    } catch(err) {console.warn('[Niji OR Merger][v0.4.1]',err);await failRun(err);}
    finally {runDriving=false;}
  }
  // Persist metadata separately: old batches and Niji Research Helper IndexedDB stay unchanged.
  function videoInfo(video) {
    const extra=videoMetadata[video.id]||{};
    return {
      title:validStreamTitle(extra.title,video.id)||validStreamTitle(video.title,video.id)||`動画 ${video.id}（配信名未取得）`,
      startedAt:extra.startedAt||'',
      publishedAt:extra.publishedAt||video.publishedAt||'',
      channel:extra.channel||video.channel||'',
    };
  }
  function displayDate(info) {
    const raw=info.startedAt||info.publishedAt;
    if (!raw) return '配信日時：未取得';
    const date=new Date(raw);
    if (Number.isNaN(date.getTime())) return '配信日時：未取得';
    const label=info.startedAt?'配信開始':'公開日';
    const text=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:info.startedAt?'2-digit':undefined,minute:info.startedAt?'2-digit':undefined,hour12:false}).format(date);
    return `${label}：${text}${info.startedAt?' JST':''}`;
  }
  function decodeMetaText(str='') {
    const textarea=document.createElement('textarea');
    textarea.innerHTML=String(str);
    return clip(textarea.value,260);
  }
  function videoMetadataFromHtml(html,id) {
    const text=String(html||'');
    if (!text.includes(id)) return {};
    const og=text.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']{1,600})["']/i)
      ||text.match(/<meta\s+[^>]*content=["']([^"']{1,600})["'][^>]*property=["']og:title["']/i);
    const title=validStreamTitle(decodeMetaText(og?.[1]||''),id);
    const start=text.match(/"liveBroadcastDetails"\s*:\s*\{[^}]{0,1000}"startTimestamp"\s*:\s*"(20\d\d-[^" ]+)"/);
    const published=text.match(/"publishDate"\s*:\s*"(20\d\d-\d\d-\d\d)"/)||text.match(/"datePublished"\s*:\s*"(20\d\d-\d\d-\d\d)"/);
    return {title:title||'',startedAt:start?.[1]||'',publishedAt:published?.[1]||''};
  }
  function fetchYoutubeMetadata(id) {
    return new Promise((resolve,reject)=>{
      if (typeof GM_xmlhttpRequest!=='function') return reject(new Error('YouTubeメタデータ取得権限がありません'));
      GM_xmlhttpRequest({method:'GET',url:`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,timeout:13000,
        anonymous:true,
        onload:(r)=>{
          if(r.status===429||r.status===403) {metadataStopped=true;return reject(new Error(`YouTube側のアクセス制限 (${r.status})`));}
          if(r.status!==200) return reject(new Error(`YouTube HTTP ${r.status}`));
          const info=videoMetadataFromHtml(r.responseText,id);
          if(info.title||info.publishedAt||info.startedAt) resolve(info);
          else reject(new Error('動画のタイトル・日時を読み取れません'));
        },
        onerror:()=>reject(new Error('YouTubeへの接続に失敗しました')),
        ontimeout:()=>reject(new Error('YouTube応答がタイムアウトしました')),
      });
    });
  }
  function queueVideoMetadata(video,onDone) {
    const saved=videoMetadata[video.id];
    if(saved) {onDone();return;}
    if(metadataStopped) {onDone();return;}
    if(!metadataQueue.some(x=>x.video.id===video.id)) metadataQueue.push({video,onDone});
    void runMetadataQueue();
  }
  async function runMetadataQueue() {
    if(metadataBusy || metadataStopped) return;
    metadataBusy=true;
    try {
      while(metadataQueue.length && !metadataStopped) {
        const {video,onDone}=metadataQueue.shift();
        if(videoMetadata[video.id]) {onDone();continue;}
        const delay=Math.max(0,2600-(Date.now()-metadataNextAt));
        if(delay) await wait(delay);
        metadataNextAt=Date.now();
        try {
          const info=await fetchYoutubeMetadata(video.id);
          videoMetadata[video.id]={...info,checkedAt:Date.now()};
          await storeSet(VIDEO_META_KEY,videoMetadata);
        } catch(err) {
          console.warn('[Niji OR Merger] 動画情報の補完失敗',video.id,err);
          // Do not repeatedly request videos that cannot be resolved.
          videoMetadata[video.id]={checkedAt:Date.now(),unavailable:true};
          try {await storeSet(VIDEO_META_KEY,videoMetadata);} catch(_){}
        }
        onDone();
      }
    } finally {metadataBusy=false;}
  }
  function viewerHead(title,onBack) {
    const bar=el('div',{class:'nor-viewer-header'});
    bar.append(button('← 戻る',onBack),el('strong',{text:title}),button('閉じる',()=>{viewer.hidden=true;panel.hidden=false;trigger.style.setProperty('display','none','important');render();}));
    return bar;
  }
  function showResultsViewer() {
    viewer.replaceChildren();viewer.hidden=false;panel.hidden=true;
    trigger.style.setProperty('display','none','important');
    viewer.append(viewerHead('🔀 OR統合検索結果',()=>{viewer.hidden=true;panel.hidden=false;render();}));
    const wrap=el('div',{class:'nor-list'});
    const summary=el('div',{class:'nor-compact'});
    const search=el('input',{class:'nor-light-input'});search.placeholder='配信タイトル・検索語で絞り込み';
    const sortRow=el('div',{class:'nor-sort-row'});
    const sortLabel=el('label',{text:'並び順：'});
    const sortSelect=document.createElement('select');sortSelect.className='nor-light-input nor-sort-select';
    for(const [value,text] of [['comments','コメント数が多い順'],['newest','配信開始・公開日が新しい順'],['oldest','配信開始・公開日が古い順'],['title','配信タイトル順']]) {
      const option=document.createElement('option');option.value=value;option.textContent=text;sortSelect.append(option);
    }
    sortSelect.value=resultSort;sortRow.append(sortLabel,sortSelect);
    const results=el('div');
    wrap.append(summary,search,sortRow,results);viewer.append(wrap);
    let observer=null;
    if(typeof IntersectionObserver==='function') observer=new IntersectionObserver(entries=>{
      for(const e of entries) if(e.isIntersecting){
        observer.unobserve(e.target);
        const v=e.target.__norVideo;
        if(!v) continue;
        const missingBefore=!videoMetadata[v.id] && !metadataStopped;
        queueVideoMetadata(v,()=>{
          if(!viewer.contains(e.target)) return;
          updateCard(e.target,v);
          // A newly fetched date changes the sorting key. Do not only repaint
          // its label while leaving the card in the old position.
          if(missingBefore && (resultSort==='newest'||resultSort==='oldest')) {
            const previousScroll=viewer.scrollTop;
            redraw();viewer.scrollTop=previousScroll;
          }
        });
      }
    },{root:viewer,rootMargin:'100px'});
    function updateCard(item,v){
      const info=videoInfo(v);
      const title=item.querySelector('.nor-video-title');if(title) title.textContent=info.title;
      const date=item.querySelector('.nor-video-date');if(date) date.textContent=displayDate(info);
    }
    function redraw() {
      if(observer) observer.disconnect();
      results.replaceChildren();
      const q=clip(search.value,200).toLowerCase();
      const selected=mergedVideos().filter(v=>v.comments.size && (!lastRunWords.length || [...v.labels].some(w=>lastRunWords.includes(w))))
        .filter(v=>!q || `${videoInfo(v).title} ${v.channel||''} ${[...v.labels].join(' ')}`.toLowerCase().includes(q));
      const dateMillis=v=>{const d=new Date(videoInfo(v).startedAt||videoInfo(v).publishedAt||'');return Number.isFinite(d.getTime())?d.getTime():null;};
      selected.sort((a,b)=>{
        if(resultSort==='title') return videoInfo(a).title.localeCompare(videoInfo(b).title,'ja')||a.id.localeCompare(b.id);
        if(resultSort==='newest'||resultSort==='oldest') {
          const da=dateMillis(a),db=dateMillis(b);
          if(da===null&&db!==null)return 1;
          if(db===null&&da!==null)return -1;
          if(da!==null&&db!==null&&da!==db) return resultSort==='newest'?db-da:da-db;
        }
        return b.comments.size-a.comments.size||a.id.localeCompare(b.id);
      });
      const dateLoading=(resultSort==='newest'||resultSort==='oldest') && selected.some(v=>
        !videoMetadata[v.id] && !(videoInfo(v).startedAt||videoInfo(v).publishedAt));
      summary.textContent=`コメントのある配信 ${selected.length}件 ／ ${lastRunWords.join('・')||'保存済み検索語'} ／ 並び順：${sortSelect.selectedOptions[0]?.textContent||'コメント数が多い順'}（日時未取得は後ろ${dateLoading?'・画面をスクロールして動画情報を追加取得中は暫定順':''}）`;
      if(!selected.length) results.append(el('div',{class:'nor-compact',text:'該当するコメントはまだ保存されていません。検索処理が停止した場合は戻ってエラーを確認してください。'}));
      for(const v of selected) {
        const item=el('div',{class:'nor-video-card'});item.__norVideo=v;
        const thumb=el('button',{type:'button',class:'nor-thumb-button'});
        thumb.append(el('img',{src:`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,alt:'配信サムネイル',loading:'lazy'}));
        thumb.addEventListener('click',()=>showMergedViewer(v));item.append(thumb);
        const info=el('div',{class:'nor-video-info'});
        const title=el('button',{class:'nor-video-title',type:'button',text:videoInfo(v).title});
        title.addEventListener('click',()=>showMergedViewer(v));info.append(title);
        info.append(el('div',{class:'nor-video-date',text:displayDate(videoInfo(v))}));
        const count=button(`💬 ${v.comments.size}件のコメントを見る`,()=>showMergedViewer(v),'nor-count-button');
        info.append(count);
        if(videoInfo(v).channel) info.append(el('div',{class:'nor-video-channel',text:`チャンネル：${videoInfo(v).channel}`}));
        for(const w of v.labels) if(!lastRunWords.length||lastRunWords.includes(w)) info.append(el('span',{class:'nor-light-pill',text:w}));
        item.append(info);results.append(item);
        if(observer) observer.observe(item);
      }
    }
    search.addEventListener('input',redraw);
    sortSelect.addEventListener('change',()=>{resultSort=sortSelect.value;void storeSet(RESULT_SORT_KEY,resultSort);redraw();});
    redraw();viewer.scrollTop=0;
  }
  function showMergedViewer(video) {
    viewer.replaceChildren();viewer.hidden=false;panel.hidden=true;
    trigger.style.setProperty('display','none','important');
    viewer.append(viewerHead('コメントOR統合',showResultsViewer));
    const list=el('div',{class:'nor-comment-list'});
    list.append(el('div',{class:'nor-compact',text:videoInfo(video).title}));
    const meta=el('div',{class:'nor-compact',text:`${displayDate(videoInfo(video))} ／ ${video.comments.size}件 ／ 検索語: ${[...video.labels].join('・')}`});list.append(meta);
    queueVideoMetadata(video,()=>{if(viewer.contains(meta)){list.firstElementChild.textContent=videoInfo(video).title;meta.textContent=`${displayDate(videoInfo(video))} ／ ${video.comments.size}件 ／ 検索語: ${[...video.labels].join('・')}`;}});
    const original=el('a',{href:originalVideoUrl(video),target:'_blank',rel:'noopener noreferrer',text:'元サイトの動画ページを開く'});
    list.append(original);
    // Visible identity makes a mismatched stored title or external navigation diagnosable.
    const identity=el('div',{class:'nor-compact',text:`動画ID：${video.id} ／ YouTube： https://www.youtube.com/watch?v=${video.id}`});
    const copyIdentity=button('🔗 この動画のURLをコピー',()=>{
      const url=`https://www.youtube.com/watch?v=${video.id}`;
      if(navigator.clipboard?.writeText) void navigator.clipboard.writeText(url).catch(()=>prompt('動画URL',url));
      else prompt('動画URL',url);
    });
    identity.append(copyIdentity);list.append(identity);
    const comments=[...video.comments.values()].sort((a,b)=>a.sec-b.sec || a.text.localeCompare(b.text,'ja'));
    if(!comments.length) list.append(el('div',{class:'nor-compact',text:'コメント本文を取得できていません。'}));
    for(const c of comments) {
      const line=el('div',{class:'nor-comment-line'});
      // Never trust c.url in older saved data: it can point to another video's POV.
      const safeUrl=`https://www.youtube.com/watch?v=${video.id}&t=${Math.max(0,Math.floor(Number(c.sec)||0))}s`;
      const time=el('a',{class:'nor-time',href:safeUrl,target:'_blank',rel:'noopener noreferrer',text:hhmmss(c.sec)});
      // The main Niji helper's legacy timestamp scanner binds every clock-like
      // anchor on the page and redirects it to the BACKGROUND video's POV.
      // Mark this independent OR link before it enters the document so even an
      // older helper skips it; the helper v1.0.39 also excludes this whole UI.
      time.dataset.npfSyncBound='1';
      time.dataset.norVideoId=video.id;
      time.addEventListener('click',e=>e.stopPropagation(),true);
      line.append(time);
      const text=el('div',{class:'nor-comment-text',text:c.text});
      for(const word of c.matchLabels||[]) text.append(el('span',{class:'nor-light-pill',text:word}));
      line.append(text);list.append(line);
    }
    viewer.append(list);viewer.scrollTop=0;
  }
  function render() {
    body.replaceChildren();
    body.append(el('div',{class:'nor-muted',text:'複数の語をまとめて入力 → 検索開始を1回。動画ごとのコメント本文と時刻を収集して統合します。'}));
    body.append(labelInput);
    const minimumRow=el('div',{class:'nor-row'});
    minimumRow.append(el('label',{text:'最低コメント数（1語・1動画あたり）'}),minimumInput);
    body.append(minimumRow);
    body.append(el('div',{class:'nor-muted',text:'例：10なら、各検索語に一致するコメントが10件以上ある動画を検索します。150動画ごとに保存・一時停止し、ボタン1回で続きから収集できます。'}));
    body.append(el('div',{class:'nor-row'},button('🔍 OR検索開始',()=>void startRun(),'primary'),button('📖 結果を見る',showResultsViewer,'primary')));
    if(runJob) {
      const word=runWord();
      const checkpoint=runJob.stage==='chunk-paused';
      const recovering=runJob.stage==='list' && /安全上限\d+動画を超えた/.test(runJob.error||'');
      const progress=runJob.stage==='list'?`${runJob.pages}ページ・今回${runJob.list.length}動画`:`${runJob.detailIndex||0}/${runJob.list?.length||0}動画のコメント取得`;
      body.append(el('div',{class:'nor-note',text:`${checkpoint?'✅ 保存済み・続き待ち':runJob.active?'🔄 収集中':'⏸ 停止中'} 最低${runJob.minComments??1}件／語 ${runJob.index+1}/${runJob.words.length}「${word}」 ／ ${progress} ${runJob.note||''} ${runJob.error||''}`}));
      const resumeText=checkpoint?'▶ 続きから収集':recovering?'▶ 取得済み動画から再開':'▶ 再開';
      body.append(el('div',{class:'nor-row'},runJob.active?button('■ 停止',()=>void stopRun()):button(resumeText,()=>void resumeRun())));
      if(!runJob.active) body.append(el('div',{class:'nor-muted',text:'最低件数を変えた場合は「OR検索開始」で新しく検索してください。「再開」は前回の条件を引き継ぎます。保存済みコメントは削除しません。'}));
    }
    const all=mergedVideos(), withComments=all.filter(v=>v.comments.size);
    body.append(el('div',{class:'nor-note',text:`保存済み：${withComments.length}動画・${withComments.reduce((n,v)=>n+v.comments.size,0)}コメント。コメント0件の動画は結果一覧に出しません。`}),message);
    const advanced=el('details');advanced.append(el('summary',{text:'詳細・バックアップ・診断'}));
    advanced.append(el('div',{class:'nor-row'},button('💾 データをバックアップ',exportBackup),button('📄 診断をコピー',copyDiag),button('すべて削除',clearAll)));
    body.append(advanced);
    body.append(el('div',{class:'nor-muted',text:'サイトの通常の検索ページと動画ページを順番に開きます。1アクセスあたり約3秒間隔。約150動画ごとに進捗を保存して一時停止します。アクセス制限やサイト構造変更時は、自動再試行せず停止します。本体DBは変更しません。'}));
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
  labelInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void startRun();}});
  try {
    const savedRun=await storeGet(RUN_KEY,null);
    if(savedRun?.words && Array.isArray(savedRun.words)) runJob=savedRun;
    const last=await storeGet(LAST_WORDS_KEY,[]);
    if(Array.isArray(last)) lastRunWords=last;
    const savedMin=await storeGet(MIN_COMMENTS_KEY,null);
    if(Number.isSafeInteger(savedMin)&&savedMin>=1&&savedMin<=9999) minimumInput.value=String(savedMin);
    if(!labelInput.value && runJob?.words) labelInput.value=runJob.words.join(' ');
    const savedMeta=await storeGet(VIDEO_META_KEY,{});
    if(savedMeta && typeof savedMeta==='object' && !Array.isArray(savedMeta)) videoMetadata=savedMeta;
    const savedSort=await storeGet(RESULT_SORT_KEY,'comments');
    if(['comments','newest','oldest','title'].includes(savedSort)) resultSort=savedSort;
  } catch(err) {console.warn('[Niji OR Merger] v0.4.1 restore',err);}
  render();
  if(runJob?.active) void driveRun();
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
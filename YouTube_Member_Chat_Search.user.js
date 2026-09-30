// ==UserScript==
// @name         YouTube メン限アーカイブ チャット検索
// @namespace    marina-youtube-chat-search
// @version      0.1.8
// @description  YouTubeの視聴権限がある配信アーカイブからChat Replayを取得し、本文・投稿者を検索します。
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Member_Chat_Search.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Member_Chat_Search.user.js
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @grant        GM_xmlhttpRequest
// @connect      www.youtube.com
// ==/UserScript==

(() => {
  'use strict';

  const APP_ID = 'marina-member-chat-search';
  const BUTTON_ID = `${APP_ID}-button`;
  const PANEL_ID = `${APP_ID}-panel`;
  const VERSION = '0.1.8';

  const state = {
    videoId: null,
    messages: [],
    messageMap: new Map(),
    loadedVideoId: null,
    loading: false,
    abortController: null,
    lastUrl: location.href,
    requestCount: 0,
    workerProgress: [],
    cacheRecord: null,
    cacheCompleted: false,
    manualAbort: false,
    persistBusy: false,
    persistPending: false,
    lastPersistRequest: 0,
    lastPersistAt: 0,
    lastProgressUiAt: 0,
    rateLimitUntil: 0,
    autoResumeStartedFor: null,
  };

  const CACHE_DB_NAME = 'MarinaMemberChatSearchDB';
  const CACHE_DB_VERSION = 1;
  const CACHE_STORE = 'videoCache';
  const FAST_WORKERS = 8;
  const FAST_OVERLAP_MS = 60 * 1000;
  let cacheDbPromise = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function openCacheDb() {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'videoId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('キャッシュDBを開けませんでした。'));
    });
    return cacheDbPromise;
  }

  async function readCache(videoId) {
    if (!videoId || typeof indexedDB === 'undefined') return null;
    try {
      const db = await openCacheDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readonly');
        const req = tx.objectStore(CACHE_STORE).get(videoId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('[Member Chat Search] cache read failed', e);
      return null;
    }
  }

  async function writeCache(record) {
    if (!record?.videoId || typeof indexedDB === 'undefined') return;
    const db = await openCacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('cache write failed'));
      tx.onabort = () => reject(tx.error || new Error('cache write aborted'));
    });
  }

  async function deleteCache(videoId) {
    if (!videoId || typeof indexedDB === 'undefined') return;
    try {
      const db = await openCacheDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).delete(videoId);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[Member Chat Search] cache delete failed', e);
    }
  }

  function currentMessagesSorted() {
    return [...state.messageMap.values()].sort((a, b) => a.offsetMs - b.offsetMs);
  }

  function progressLabelFromWorkers(workers = state.workerProgress) {
    if (!Array.isArray(workers) || !workers.length) return '';
    if (workers.length === 1) {
      const w = workers[0];
      return formatTime((w.offsetMs || 0) / 1000);
    }
    const ratios = workers.map((w) => {
      const span = Math.max(1, (w.endMs || 0) - (w.startMs || 0));
      return Math.max(0, Math.min(1, ((w.offsetMs || w.startMs || 0) - (w.startMs || 0)) / span));
    });
    const pct = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100);
    return `${pct}%`;
  }

  async function persistSnapshot({ completed = false, inProgress = true, force = false } = {}) {
    const videoId = state.videoId || getVideoId();
    if (!videoId || !state.messageMap) return;

    if (state.persistBusy && !force) {
      state.persistPending = true;
      return;
    }
    state.persistBusy = true;
    try {
      const messages = currentMessagesSorted();
      const record = {
        videoId,
        version: VERSION,
        messages,
        workers: Array.isArray(state.workerProgress) ? state.workerProgress.map((w) => ({ ...w })) : [],
        completed: Boolean(completed),
        inProgress: Boolean(inProgress),
        fastMode: state.workerProgress.length > 1,
        updatedAt: Date.now(),
        requestCount: state.requestCount,
      };
      await writeCache(record);
      state.cacheRecord = record;
      state.cacheCompleted = record.completed;
      state.messages = messages;
      state.lastPersistRequest = state.requestCount;
      state.lastPersistAt = Date.now();
    } catch (e) {
      console.warn('[Member Chat Search] persist failed', e);
    } finally {
      state.persistBusy = false;
      if (state.persistPending) {
        state.persistPending = false;
        void persistSnapshot({ completed, inProgress });
      }
    }
  }

  function maybePersistSnapshot() {
    // 全チャットを毎回丸ごとIndexedDBへ書くため、頻繁に行うと
    // 件数が増えた後半・再開後ほど遅くなる。通常時は大きく間引き、
    // visibilitychange/pagehide/中止時だけ強制保存する。
    const enoughRequests = state.requestCount - state.lastPersistRequest >= 120;
    const enoughTime = Date.now() - state.lastPersistAt >= 30000;
    if (enoughRequests && enoughTime) {
      void persistSnapshot({ completed: false, inProgress: true });
    }
  }

  function reportProgressThrottled(p) {
    const now = performance.now();
    if (now - state.lastProgressUiAt < 500) return;
    state.lastProgressUiAt = now;
    status(`${p.detail}　${p.count.toLocaleString()}件 / API ${p.requests}回`);
  }


  async function restoreCacheForVideo(videoId, { allowAutoResume = true } = {}) {
    if (!videoId) return;
    const record = await readCache(videoId);
    if (getVideoId() !== videoId) return;

    state.cacheRecord = record;
    state.cacheCompleted = Boolean(record?.completed);
    state.messageMap = new Map();
    for (const msg of record?.messages || []) {
      const key = msg.id || `${msg.offsetMs}|${msg.author}|${msg.message}`;
      state.messageMap.set(key, msg);
    }
    state.messages = currentMessagesSorted();
    state.workerProgress = Array.isArray(record?.workers) ? record.workers.map((w) => ({ ...w })) : [];
    if (record?.completed) state.loadedVideoId = videoId;

    if (record?.messages?.length) {
      const progress = progressLabelFromWorkers(record.workers);
      status(
        record.completed
          ? `保存済み：${record.messages.length.toLocaleString()}件（取得完了）`
          : `保存済み：${record.messages.length.toLocaleString()}件${progress ? ` / 進捗 ${progress}` : ''}`
      );
      setLoadButton(record.completed ? '再取得' : '続きから取得', false);
      renderSearchResults();
    }

    if (
      allowAutoResume &&
      record?.inProgress &&
      !record?.completed &&
      !state.loading &&
      state.autoResumeStartedFor !== videoId
    ) {
      state.autoResumeStartedFor = videoId;
      setTimeout(() => {
        if (getVideoId() === videoId && !state.loading) {
          status('前回の続きから自動再開します…');
          void handleLoadClick(true);
        }
      }, 700);
    }
  }

  function getVideoId() {
    try {
      const u = new URL(location.href);
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || null;
      return null;
    } catch {
      return null;
    }
  }

  function textOf(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj.simpleText === 'string') return obj.simpleText;
    if (Array.isArray(obj.runs)) {
      return obj.runs.map((run) => {
        if (typeof run?.text === 'string') return run.text;
        const emoji = run?.emoji;
        if (emoji?.shortcuts?.[0]) return emoji.shortcuts[0];
        return emoji?.image?.accessibility?.accessibilityData?.label || '';
      }).join('');
    }
    return '';
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function findBalancedJson(text, startIndex) {
    const first = text.indexOf('{', startIndex);
    if (first < 0) return null;

    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let i = first; i < text.length; i++) {
      const ch = text[i];

      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return text.slice(first, i + 1);
      }
    }
    return null;
  }

  function parseJsonAfterMarker(text, marker) {
    const index = text.indexOf(marker);
    if (index < 0) return null;
    const raw = findBalancedJson(text, index + marker.length);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function parseAllYtcfgSets(html) {
    const out = {};
    let pos = 0;
    const marker = 'ytcfg.set(';
    while (true) {
      const i = html.indexOf(marker, pos);
      if (i < 0) break;
      const raw = findBalancedJson(html, i + marker.length);
      if (!raw) {
        pos = i + marker.length;
        continue;
      }
      try {
        Object.assign(out, JSON.parse(raw));
      } catch { /* ignore */ }
      pos = i + marker.length + raw.length;
    }
    return out;
  }

  function deepFindValues(root, key, limit = 200) {
    const found = [];
    const seen = new Set();
    const stack = [root];

    while (stack.length && found.length < limit) {
      const obj = stack.pop();
      if (!obj || typeof obj !== 'object' || seen.has(obj)) continue;
      seen.add(obj);

      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        found.push(obj[key]);
      }

      if (Array.isArray(obj)) {
        for (let i = obj.length - 1; i >= 0; i--) stack.push(obj[i]);
      } else {
        for (const value of Object.values(obj)) {
          if (value && typeof value === 'object') stack.push(value);
        }
      }
    }
    return found;
  }

  async function fetchPageData(signal) {
    // MacaqueのGM権限を使う版ではisolated worldになる可能性があるため、
    // ページ本体のYouTube変数はunsafeWindowが使える場合そちらを優先する。
    let initialData = null;
    let cfg = {};
    let page = window;
    try {
      if (typeof unsafeWindow !== 'undefined') page = unsafeWindow;
    } catch { /* ignore */ }

    try {
      if (page.ytInitialData && typeof page.ytInitialData === 'object') {
        initialData = page.ytInitialData;
      }
    } catch { /* ignore */ }

    try {
      if (page.ytcfg?.data_ && typeof page.ytcfg.data_ === 'object') {
        cfg = { ...page.ytcfg.data_ };
      } else if (page.ytcfg?.get) {
        const keys = [
          'INNERTUBE_API_KEY',
          'INNERTUBE_CONTEXT',
          'INNERTUBE_CONTEXT_CLIENT_NAME',
          'INNERTUBE_CONTEXT_CLIENT_VERSION',
          'SESSION_INDEX',
          'DELEGATED_SESSION_ID',
          'VISITOR_DATA',
          'DATASYNC_ID',
          'ID_TOKEN',
          'DEVICE',
          'PAGE_CL',
          'PAGE_BUILD_LABEL',
          'VARIANTS_CHECKSUM',
          'XSRF_TOKEN',
          'GOOGLE_FEEDBACK_PRODUCT_DATA',
          'HL',
        ];
        for (const key of keys) {
          const value = page.ytcfg.get(key);
          if (value !== undefined) cfg[key] = value;
        }
      }
    } catch { /* ignore */ }

    const needHtml = !initialData || !cfg.INNERTUBE_CONTEXT;
    if (!needHtml) return { initialData, cfg, source: 'page' };

    const cleanUrl = new URL(location.href);
    cleanUrl.hash = '';
    const res = await fetch(cleanUrl.href, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    if (!res.ok) throw new Error(`動画ページ取得失敗: HTTP ${res.status}`);
    const html = await res.text();

    if (!initialData) {
      initialData =
        parseJsonAfterMarker(html, 'var ytInitialData = ') ||
        parseJsonAfterMarker(html, 'ytInitialData = ') ||
        parseJsonAfterMarker(html, 'window["ytInitialData"] = ');
    }

    cfg = { ...parseAllYtcfgSets(html), ...cfg };
    return { initialData, cfg, source: 'html' };
  }

  function extractInitialContinuation(initialData) {
    const candidates = [
      initialData?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer,
      initialData?.response?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer,
      initialData?.contents?.singleColumnWatchNextResults?.conversationBar?.liveChatRenderer,
      initialData?.response?.contents?.singleColumnWatchNextResults?.conversationBar?.liveChatRenderer,
    ].filter(Boolean);

    // Mobile/desktopの構造差に備えて、reloadContinuationData全体ではなく
    // liveChatRendererそのものを再帰検索する。コメント欄等の別tokenを誤取得しない。
    for (const renderer of deepFindValues(initialData, 'liveChatRenderer')) {
      if (renderer && typeof renderer === 'object') candidates.push(renderer);
    }

    const seen = new Set();
    for (const renderer of candidates) {
      if (!renderer || seen.has(renderer)) continue;
      seen.add(renderer);

      const direct = renderer?.continuations?.[0]?.reloadContinuationData;
      if (direct?.continuation) return { ...direct, source: 'liveChatRenderer.continuations' };

      const submenu = renderer?.header?.liveChatHeaderRenderer?.viewSelector
        ?.sortFilterSubMenuRenderer?.subMenuItems;
      if (Array.isArray(submenu)) {
        // 「チャットのリプレイ」側を優先し、無ければcontinuationを持つ項目を使う。
        const replayItem = submenu.find((item) =>
          /replay|リプレイ/i.test(String(item?.title || item?.label || '')) &&
          item?.continuation?.reloadContinuationData?.continuation
        );
        const picked = replayItem || submenu.find((item) =>
          item?.continuation?.reloadContinuationData?.continuation
        );
        const data = picked?.continuation?.reloadContinuationData;
        if (data?.continuation) return { ...data, source: 'liveChatRenderer.header' };
      }
    }

    return null;
  }


  function stripJsonSecurityPrefix(text) {
    const prefix = ")]}'\n";
    return text.startsWith(prefix) ? text.slice(prefix.length) : text;
  }

  function bootstrapHeaders(cfg, auth, origin, contentType = false) {
    const tempCtx = { cfg, auth, origin };
    const h = buildHeaders(tempCtx);
    if (!contentType) delete h['content-type'];
    if (cfg.ID_TOKEN) h['x-youtube-identity-token'] = String(cfg.ID_TOKEN);
    if (cfg.DEVICE) h['x-youtube-device'] = String(cfg.DEVICE);
    if (cfg.PAGE_CL) h['x-youtube-page-cl'] = String(cfg.PAGE_CL);
    if (cfg.PAGE_BUILD_LABEL) h['x-youtube-page-label'] = String(cfg.PAGE_BUILD_LABEL);
    if (cfg.VARIANTS_CHECKSUM) h['x-youtube-variants-checksum'] = String(cfg.VARIANTS_CHECKSUM);
    h['x-youtube-time-zone'] = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    h['x-youtube-utc-offset'] = String(Math.abs(new Date().getTimezoneOffset()));
    return h;
  }

  async function fetchPbjInitialData(videoId, cfg, auth, origin, signal) {
    if (!videoId) return null;
    const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&pbj=1`;
    const headers = bootstrapHeaders(cfg, auth, origin, false);
    headers['x-spf-previous'] = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    headers['x-spf-referer'] = headers['x-spf-previous'];

    try {
      const res = await fetch(target, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers,
        referrer: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        referrerPolicy: 'origin-when-cross-origin',
        signal,
      });
      if (!res.ok) return null;
      const raw = stripJsonSecurityPrefix(await res.text());
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      console.warn('[Member Chat Search] PBJ fallback failed', e);
      return null;
    }
  }

  function gmRequest(details, signal) {
    const gmFn =
      (typeof GM !== 'undefined' && (GM.xmlHttpRequest || GM.xmlhttpRequest)) ||
      (typeof GM_xmlhttpRequest !== 'undefined' ? GM_xmlhttpRequest : null);

    if (!gmFn) {
      return Promise.reject(new Error('MacaqueのGM通信APIが利用できません。'));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let control = null;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        fn(value);
      };

      const onAbort = () => {
        try { control?.abort?.(); } catch { /* ignore */ }
        finish(reject, new DOMException('Aborted', 'AbortError'));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        control = gmFn({
          ...details,
          anonymous: false,
          onload: (response) => finish(resolve, response),
          onerror: (error) => finish(reject, new Error(error?.error || error?.message || 'GM request failed')),
          ontimeout: () => finish(reject, new Error('GM request timeout')),
        });
      } catch (e) {
        finish(reject, e);
      }
    });
  }

  function continuationFromDesktopHtml(html) {
    if (!html) return null;

    const initialData =
      parseJsonAfterMarker(html, 'var ytInitialData = ') ||
      parseJsonAfterMarker(html, 'ytInitialData = ') ||
      parseJsonAfterMarker(html, 'window["ytInitialData"] = ');

    const parsed = extractInitialContinuation(initialData);
    if (parsed?.continuation) {
      return { initialData, continuation: parsed, method: 'parsed' };
    }

    // YouTubeのHTML構造が変わってytInitialDataの抽出に失敗しても、
    // liveChatRenderer付近だけに限定してcontinuationを救済する。
    const chatIndex = html.indexOf('"liveChatRenderer"');
    if (chatIndex >= 0) {
      const region = html.slice(chatIndex, chatIndex + 250000);
      const match =
        region.match(/"reloadContinuationData"\s*:\s*\{[^{}]*?"continuation"\s*:\s*"([^"]+)"/) ||
        region.match(/"continuation"\s*:\s*"([^"]+)"/);
      if (match?.[1]) {
        let token = match[1];
        try { token = JSON.parse(`"${token.replace(/"/g, '\\"')}"`); } catch { /* keep raw */ }
        if (token) {
          return {
            initialData,
            continuation: { continuation: token, source: 'liveChatRenderer.regex' },
            method: 'regex',
          };
        }
      }
    }

    return { initialData, continuation: null, method: 'none' };
  }

  async function fetchDesktopWatchDataViaGM(videoId, signal) {
    if (!videoId) return null;
    const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&app=desktop&persist_app=1`;
    try {
      const response = await gmRequest({
        method: 'GET',
        url: target,
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        },
      }, signal);

      if (Number(response?.status) !== 200) {
        console.warn('[Member Chat Search] GM desktop HTML HTTP', response?.status);
        return null;
      }

      const html = String(response.responseText || response.response || '');
      const parsed = continuationFromDesktopHtml(html);
      return {
        initialData: parsed?.initialData || null,
        cfg: parseAllYtcfgSets(html),
        continuation: parsed?.continuation || null,
        method: parsed?.method || 'none',
      };
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      console.warn('[Member Chat Search] GM desktop fallback failed', e);
      return null;
    }
  }

  async function fetchDesktopWatchData(videoId, signal) {
    if (!videoId) return null;
    const target = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&app=desktop`;
    try {
      const res = await fetch(target, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
      if (!res.ok) return null;
      const html = await res.text();
      const initialData =
        parseJsonAfterMarker(html, 'var ytInitialData = ') ||
        parseJsonAfterMarker(html, 'ytInitialData = ') ||
        parseJsonAfterMarker(html, 'window["ytInitialData"] = ');
      const cfg = parseAllYtcfgSets(html);
      return { initialData, cfg };
    } catch (e) {
      console.warn('[Member Chat Search] desktop HTML fallback failed', e);
      return null;
    }
  }

  async function fetchNextInitialData(videoId, cfg, auth, origin, signal) {
    if (!videoId || !cfg?.INNERTUBE_CONTEXT?.client) return null;
    const qs = new URLSearchParams();
    if (cfg.INNERTUBE_API_KEY) qs.set('key', String(cfg.INNERTUBE_API_KEY));
    qs.set('prettyPrint', 'false');
    const endpoint = `https://www.youtube.com/youtubei/v1/next?${qs.toString()}`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        mode: 'cors',
        referrer: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        referrerPolicy: 'origin-when-cross-origin',
        headers: bootstrapHeaders(cfg, auth, origin, true),
        body: JSON.stringify({
          context: cfg.INNERTUBE_CONTEXT,
          videoId,
        }),
        signal,
      });
      if (!res.ok) {
        console.warn('[Member Chat Search] next fallback HTTP', res.status);
        return null;
      }
      return res.json();
    } catch (e) {
      console.warn('[Member Chat Search] next fallback failed', e);
      return null;
    }
  }

  function readCookie(name) {
    const target = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const p = part.trim();
      if (p.startsWith(target)) return p.slice(target.length);
    }
    return undefined;
  }

  async function sha1Hex(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-1', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function makeAuthToken(name, secret, origin) {
    if (!secret) return null;
    const ts = Math.floor(Date.now() / 1000);
    const hash = await sha1Hex(`${ts} ${secret} ${origin}`);
    return `${name} ${ts}_${hash}`;
  }

  async function buildAuthorization(origin) {
    let page = window;
    try {
      if (typeof unsafeWindow !== 'undefined') page = unsafeWindow;
    } catch { /* ignore */ }

    let base;
    let oneP;
    let threeP;

    try { base = page.__SAPISID; } catch { /* ignore */ }
    try { oneP = page.__1PSAPISID; } catch { /* ignore */ }
    try { threeP = page.__3PSAPISID; } catch { /* ignore */ }

    base ||= readCookie('SAPISID') || readCookie('__Secure-3PAPISID');
    oneP ||= readCookie('__Secure-1PAPISID');
    threeP ||= readCookie('__Secure-3PAPISID');

    const tokens = [];
    const t0 = await makeAuthToken('SAPISIDHASH', base, origin);
    const t1 = await makeAuthToken('SAPISID1PHASH', oneP, origin);
    const t3 = await makeAuthToken('SAPISID3PHASH', threeP, origin);
    if (t0) tokens.push(t0);
    if (t1) tokens.push(t1);
    if (t3) tokens.push(t3);

    return {
      header: tokens.length ? tokens.join(' ') : null,
      hasBaseSecret: Boolean(base),
      has1P: Boolean(oneP),
      has3P: Boolean(threeP),
    };
  }

  function normalizeCfg(cfg) {
    const client = { ...(cfg?.INNERTUBE_CONTEXT?.client || {}) };
    const clientName = cfg?.INNERTUBE_CONTEXT_CLIENT_NAME ?? client.clientName ?? '1';
    const clientVersion = cfg?.INNERTUBE_CONTEXT_CLIENT_VERSION ?? client.clientVersion;
    const visitorData = cfg?.VISITOR_DATA ?? client.visitorData ?? '';

    if (!client.clientName && typeof clientName === 'string' && !/^\d+$/.test(clientName)) {
      client.clientName = clientName;
    }
    if (!client.clientVersion && clientVersion) client.clientVersion = clientVersion;

    if (!client.visitorData && visitorData) client.visitorData = visitorData;

    return {
      ...cfg,
      INNERTUBE_CONTEXT: { ...(cfg.INNERTUBE_CONTEXT || {}), client },
      clientName,
      clientVersion,
      visitorData,
    };
  }

  async function makeRequestContext(signal) {
    const pageData = await fetchPageData(signal);
    if (!pageData.initialData) throw new Error('ytInitialDataを取得できませんでした。');

    let cfg = normalizeCfg(pageData.cfg || {});
    if (!cfg.INNERTUBE_CONTEXT?.client) {
      throw new Error('YouTubeのInnertube設定を取得できませんでした。');
    }

    // 認証対象アカウントは「今Safariで表示しているYouTubeページ」のytcfgを優先する。
    // PC版watchを裏取得した際のSESSION_INDEXで上書きすると、複数Googleアカウント時に
    // メンバーシップを持たない別アカウントとして扱われHTTP 400になる。
    const pageSessionIndex =
      pageData.cfg?.SESSION_INDEX !== undefined && pageData.cfg?.SESSION_INDEX !== null
        ? pageData.cfg.SESSION_INDEX
        : null;
    const pageDelegatedSessionId = pageData.cfg?.DELEGATED_SESSION_ID || null;

    const applyPageAuthSession = (candidate) => {
      const next = { ...(candidate || {}) };
      if (pageSessionIndex !== null) next.SESSION_INDEX = pageSessionIndex;
      if (pageDelegatedSessionId) next.DELEGATED_SESSION_ID = pageDelegatedSessionId;
      return next;
    };

    const videoId = getVideoId();
    const origin = 'https://www.youtube.com';
    let auth = await buildAuthorization(origin);
    let initialData = pageData.initialData;
    let continuation = extractInitialContinuation(initialData);
    let source = pageData.source;

    if (!continuation?.continuation && videoId) {
      const pbj = await fetchPbjInitialData(videoId, cfg, auth, origin, signal);
      const pbjContinuation = extractInitialContinuation(pbj);
      if (pbjContinuation?.continuation) {
        initialData = pbj;
        continuation = { ...pbjContinuation, source: `pbj:${pbjContinuation.source}` };
        source = 'pbj';
      }
    }

    if (!continuation?.continuation && videoId) {
      const gmDesktop = await fetchDesktopWatchDataViaGM(videoId, signal);
      if (gmDesktop) {
        cfg = normalizeCfg(applyPageAuthSession({ ...cfg, ...(gmDesktop.cfg || {}) }));
        auth = await buildAuthorization(origin);
        const gmContinuation =
          gmDesktop.continuation ||
          extractInitialContinuation(gmDesktop.initialData);
        if (gmContinuation?.continuation) {
          initialData = gmDesktop.initialData || initialData;
          continuation = {
            ...gmContinuation,
            source: `gm-desktop:${gmContinuation.source || gmDesktop.method || 'unknown'}`,
          };
          source = 'gm-desktop';
        }
      }
    }

    if (!continuation?.continuation && videoId) {
      const desktop = await fetchDesktopWatchData(videoId, signal);
      if (desktop) {
        cfg = normalizeCfg(applyPageAuthSession({ ...cfg, ...(desktop.cfg || {}) }));
        auth = await buildAuthorization(origin);
        const desktopContinuation = extractInitialContinuation(desktop.initialData);
        if (desktopContinuation?.continuation) {
          initialData = desktop.initialData;
          continuation = { ...desktopContinuation, source: `desktop:${desktopContinuation.source}` };
          source = 'desktop-html';
        }
      }
    }

    if (!continuation?.continuation && videoId) {
      const nextData = await fetchNextInitialData(videoId, cfg, auth, origin, signal);
      const nextContinuation = extractInitialContinuation(nextData);
      if (nextContinuation?.continuation) {
        initialData = nextData;
        continuation = { ...nextContinuation, source: `next:${nextContinuation.source}` };
        source = 'next';
      }
    }

    if (!continuation?.continuation) {
      throw new Error(
        'チャットリプレイの開始トークンが見つかりません。Safari表示ページ・PBJ・GM経由PC版watch・通常PC版watch・Innertube nextの5経路で確認しました。'
      );
    }

    cfg = normalizeCfg(applyPageAuthSession(cfg));

    return {
      initialData,
      cfg,
      continuation,
      origin,
      auth,
      source,
      pageSessionIndex,
    };
  }

  function buildHeaders(ctx) {
    const h = {
      'accept': '*/*',
      'accept-language': ctx.cfg?.GOOGLE_FEEDBACK_PRODUCT_DATA?.accept_language || 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'pragma': 'no-cache',
      'cache-control': 'no-store',
      'x-youtube-client-name': String(ctx.cfg.INNERTUBE_CONTEXT_CLIENT_NAME ?? ctx.cfg.clientName ?? '1'),
    };
    if (ctx.cfg.INNERTUBE_CONTEXT_CLIENT_VERSION ?? ctx.cfg.clientVersion) {
      h['x-youtube-client-version'] = String(
        ctx.cfg.INNERTUBE_CONTEXT_CLIENT_VERSION ?? ctx.cfg.clientVersion
      );
    }

    if (ctx.auth.header) {
      h['authorization'] = ctx.auth.header;
      if (ctx.cfg.SESSION_INDEX !== undefined && ctx.cfg.SESSION_INDEX !== null) {
        h['x-goog-authuser'] = String(ctx.cfg.SESSION_INDEX);
      }
      if (ctx.cfg.DELEGATED_SESSION_ID) {
        h['x-goog-pageid'] = String(ctx.cfg.DELEGATED_SESSION_ID);
      }
    }
    return h;
  }

  function getPageFetch() {
    try {
      if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function') {
        return unsafeWindow.fetch.bind(unsafeWindow);
      }
    } catch { /* ignore */ }
    return window.fetch.bind(window);
  }

  function buildBody(ctx, continuation, offsetMs = null) {
    const body = {
      context: { client: ctx.cfg.INNERTUBE_CONTEXT.client },
      continuation,
    };
    if (offsetMs !== null) {
      body.currentPlayerState = { playerOffsetMs: String(offsetMs) };
    }
    return body;
  }

  async function innertubeReplay(ctx, continuation, signal, offsetMs = null, legacyWithKey = false) {
    const baseEndpoint = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay`;
    const qs = new URLSearchParams();
    if (ctx.cfg.INNERTUBE_API_KEY) qs.set('key', String(ctx.cfg.INNERTUBE_API_KEY));
    qs.set('prettyPrint', 'false');
    const endpoint = `${baseEndpoint}?${qs.toString()}`;

    const pageFetch = getPageFetch();
    const res = await pageFetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      mode: 'cors',
      referrer: location.href,
      referrerPolicy: 'origin-when-cross-origin',
      headers: buildHeaders(ctx),
      body: JSON.stringify(buildBody(ctx, continuation, offsetMs)),
      signal,
    });

    state.requestCount++;

    if (!res.ok) {
      const tokenSource = ctx.continuation?.source || 'unknown';
      const sessionIndex = ctx.cfg.SESSION_INDEX ?? 'unknown';
      const client = ctx.cfg.INNERTUBE_CONTEXT?.client?.clientName || ctx.cfg.clientName || '?';
      const err = new Error(
        `Chat Replay API: HTTP ${res.status} ${res.statusText} [token:${tokenSource} / SafariAccount:${ctx.pageSessionIndex ?? 'unknown'} / sentAccount:${sessionIndex} / client:${client}]`
      );
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function extractRendererItem(action) {
    const replay = action?.replayChatItemAction;
    if (!replay) return [];
    const offsetMs = Number(replay.videoOffsetTimeMsec || 0);
    const nested = Array.isArray(replay.actions) ? replay.actions : [];
    const out = [];

    for (const inner of nested) {
      const item = inner?.addChatItemAction?.item;
      if (!item || typeof item !== 'object') continue;

      const rendererKey = Object.keys(item).find((k) => /^liveChat.*Renderer$/.test(k));
      if (!rendererKey) continue;
      const r = item[rendererKey];
      if (!r || typeof r !== 'object') continue;

      const author = textOf(r.authorName);
      let message = textOf(r.message);

      if (!message) message = textOf(r.headerSubtext);
      if (!message) message = textOf(r.primaryText);
      if (!message && r.sticker?.accessibility?.accessibilityData?.label) {
        message = r.sticker.accessibility.accessibilityData.label;
      }

      const amount = textOf(r.purchaseAmountText);
      if (amount && !message.includes(amount)) message = message ? `${message} (${amount})` : amount;

      if (!author && !message) continue;

      out.push({
        id: r.id || `${offsetMs}-${author}-${message}`,
        offsetMs,
        seconds: offsetMs / 1000,
        author,
        message,
        type: rendererKey,
        timestampUsec: Number(r.timestampUsec || 0),
      });
    }
    return out;
  }

  function addActions(actions, map) {
    if (!Array.isArray(actions)) return 0;
    let added = 0;
    for (const action of actions) {
      for (const msg of extractRendererItem(action)) {
        const key = msg.id || `${msg.offsetMs}|${msg.author}|${msg.message}`;
        if (!map.has(key)) {
          map.set(key, msg);
          added++;
        }
      }
    }
    return added;
  }

  function getContinuations(response) {
    return response?.continuationContents?.liveChatContinuation?.continuations || [];
  }

  function getActions(response) {
    return response?.continuationContents?.liveChatContinuation?.actions || [];
  }

  function findContinuation(response, kind) {
    const list = getContinuations(response);
    return list.find((x) => x?.[kind])?.[kind]?.continuation || null;
  }

  function maxOffsetFromActions(actions) {
    let max = null;
    for (const action of actions || []) {
      const n = Number(action?.replayChatItemAction?.videoOffsetTimeMsec);
      if (Number.isFinite(n)) max = max === null ? n : Math.max(max, n);
    }
    return max;
  }

  function getVideoDurationMs(ctx) {
    const video = document.querySelector('video');
    const d = Number(video?.duration);
    if (Number.isFinite(d) && d > 0) return Math.round(d * 1000);

    const lengths = deepFindValues(ctx?.initialData, 'lengthSeconds', 50)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (lengths.length) return Math.round(Math.max(...lengths) * 1000);
    return null;
  }

  function seedMessageMap() {
    const map = new Map();
    for (const msg of state.messages || []) {
      const key = msg.id || `${msg.offsetMs}|${msg.author}|${msg.message}`;
      map.set(key, msg);
    }
    state.messageMap = map;
    return map;
  }

  function addActionsTracked(actions, map) {
    const before = map.size;
    addActions(actions, map);
    if (map.size !== before) state.messageMap = map;
    return map.size - before;
  }

  async function freshPlayerSeek(ctx, signal) {
    const first = await innertubeReplay(ctx, ctx.continuation.continuation, signal, null, false);
    return {
      response: first,
      playerSeek: findContinuation(first, 'playerSeekContinuationData'),
      replay: findContinuation(first, 'liveChatReplayContinuationData'),
    };
  }

  function mergeCoveredIntervals(resumeWorkers = []) {
    const intervals = (resumeWorkers || [])
      .map((w) => {
        const start = Math.max(0, Number(w?.startMs) || 0);
        const rawEnd = w?.done ? Number(w?.endMs) : Number(w?.offsetMs);
        const end = Number.isFinite(rawEnd) ? Math.max(start, rawEnd) : start;
        return [start, end];
      })
      .filter((pair) => pair[1] > pair[0])
      .sort((a, b) => a[0] - b[0]);

    const merged = [];
    for (const [start, end] of intervals) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1] + FAST_OVERLAP_MS) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }
    return merged;
  }

  function resumeOffsetForRange(startMs, endMs, coveredIntervals) {
    let cursor = startMs;
    let advanced = true;
    while (advanced) {
      advanced = false;
      for (const [a, b] of coveredIntervals) {
        if (a <= cursor + FAST_OVERLAP_MS && b > cursor) {
          const next = Math.min(endMs, b);
          if (next > cursor) {
            cursor = next;
            advanced = true;
          }
        }
      }
    }
    return Math.max(startMs, cursor - (cursor > startMs ? FAST_OVERLAP_MS : 0));
  }

  function buildFastRanges(durationMs, resumeWorkers = []) {
    const workers = [];
    const covered = mergeCoveredIntervals(resumeWorkers);

    for (let i = 0; i < FAST_WORKERS; i++) {
      const nominalStart = Math.floor((durationMs * i) / FAST_WORKERS);
      const nominalEnd = Math.floor((durationMs * (i + 1)) / FAST_WORKERS);
      const startMs = Math.max(0, nominalStart - (i > 0 ? FAST_OVERLAP_MS : 0));
      const endMs = Math.min(durationMs, nominalEnd + (i < FAST_WORKERS - 1 ? FAST_OVERLAP_MS : 0));

      const exactOld = resumeWorkers.find((w) =>
        Number(w?.index) === i &&
        Math.abs((Number(w?.startMs) || 0) - startMs) < 2000 &&
        Math.abs((Number(w?.endMs) || 0) - endMs) < 2000
      );

      let offsetMs;
      let done = false;
      if (exactOld) {
        const saved = Number(exactOld.offsetMs);
        offsetMs = Number.isFinite(saved)
          ? Math.max(startMs, Math.min(endMs, saved - FAST_OVERLAP_MS))
          : startMs;
        done = Boolean(exactOld.done);
      } else {
        offsetMs = resumeOffsetForRange(startMs, endMs, covered);
        done = offsetMs >= endMs - 1000;
      }

      workers.push({ index: i, startMs, endMs, offsetMs, done });
    }
    return workers;
  }

  async function waitForRateLimit(signal) {
    const delay = state.rateLimitUntil - Date.now();
    if (delay <= 0) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function replayWithRateLimitBackoff(ctx, token, signal, offsetMs) {
    let attempt = 0;
    while (true) {
      await waitForRateLimit(signal);
      try {
        return await innertubeReplay(ctx, token, signal, offsetMs, false);
      } catch (e) {
        if (e?.status !== 429 || attempt >= 4) throw e;
        attempt++;
        const waitMs = Math.min(12000, 1200 * (2 ** attempt));
        state.rateLimitUntil = Math.max(state.rateLimitUntil, Date.now() + waitMs);
        await waitForRateLimit(signal);
      }
    }
  }


  async function runSeekWorker(ctx, worker, map, onProgress, signal, initialToken = null) {
    if (worker.done) return;

    // playerSeek tokenは位置をbodyのplayerOffsetMsで指定するため、
    // 初回tokenは各workerで共有し、余分な初期化APIを省く。
    let token = initialToken;
    if (!token) {
      const init = await freshPlayerSeek(ctx, signal);
      token = init.playerSeek;
      if (!token) throw new Error('高速取得用playerSeekトークンを取得できませんでした。');
    }

    let offsetMs = Math.max(worker.startMs, Number(worker.offsetMs) || worker.startMs);
    let previousToken = null;
    let loops = 0;

    while (token && loops < 30000) {
      loops++;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const response = await replayWithRateLimitBackoff(ctx, token, signal, offsetMs);
      const actions = getActions(response);
      addActionsTracked(actions, map);

      const lastOffset = maxOffsetFromActions(actions);
      const nextToken = findContinuation(response, 'playerSeekContinuationData');

      if (lastOffset !== null) {
        offsetMs = Math.max(offsetMs, lastOffset);
        worker.offsetMs = offsetMs;
      }
      if (offsetMs >= worker.endMs) worker.done = true;

      const doneCount = state.workerProgress.filter((w) => w.done).length;
      const ratios = state.workerProgress.map((w) => {
        const span = Math.max(1, w.endMs - w.startMs);
        return Math.max(0, Math.min(1, ((w.offsetMs || w.startMs) - w.startMs) / span));
      });
      const pct = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100);

      onProgress({
        phase: 'fast',
        count: map.size,
        requests: state.requestCount,
        detail: `超高速${FAST_WORKERS}並列 ${pct}%（完了 ${doneCount}/${FAST_WORKERS}）`,
      });
      maybePersistSnapshot();

      if (worker.done || !nextToken) break;
      if (lastOffset === null) {
        if (nextToken === token || nextToken === previousToken) break;
      } else if (lastOffset <= offsetMs && nextToken === token) {
        break;
      }

      previousToken = token;
      token = nextToken;
      if (loops % 20 === 0) await sleep(0);
    }

    if (!signal.aborted) {
      worker.done = true;
      worker.offsetMs = Math.max(worker.offsetMs || 0, Math.min(worker.endMs, offsetMs));
    }
  }


  async function loadAllChat(onProgress, signal, { fastMode = true, resumeRecord = null } = {}) {
    state.requestCount = 0;
    state.lastPersistRequest = 0;
    state.lastPersistAt = Date.now();
    state.lastProgressUiAt = 0;
    state.rateLimitUntil = 0;
    const ctx = await makeRequestContext(signal);
    const map = seedMessageMap();

    onProgress({
      phase: 'auth',
      count: map.size,
      requests: 0,
      detail: `認証:${ctx.auth.hasBaseSecret ? 'OK' : 'なし'} / Safariアカウント:${ctx.pageSessionIndex ?? '不明'} / 送信:${ctx.cfg.SESSION_INDEX ?? '不明'} / token:${ctx.continuation.source}`,
    });

    if (!ctx.auth.header) {
      throw new Error('ログイン認証用SAPISIDを取得できません。メン限アーカイブでは認証が必要です。');
    }

    let init;
    try {
      init = await freshPlayerSeek(ctx, signal);
    } catch (e) {
      if ((e?.status === 400 || e?.status === 404) && ctx.cfg.INNERTUBE_API_KEY) {
        onProgress({ phase: 'legacy', count: map.size, requests: state.requestCount, detail: '現行方式が失敗。旧方式を試します…' });
        return loadLegacyReplay(ctx, map, onProgress, signal, resumeRecord);
      }
      throw e;
    }

    const durationMs = getVideoDurationMs(ctx);
    const canFast = Boolean(fastMode && init.playerSeek && durationMs && durationMs >= 30 * 60 * 1000);

    if (canFast) {
      state.workerProgress = buildFastRanges(durationMs, resumeRecord?.workers || []);
      const active = state.workerProgress.filter((w) => !w.done);

      await Promise.all(active.map((worker) =>
        runSeekWorker(
          ctx,
          worker,
          map,
          onProgress,
          signal,
          init.playerSeek
        )
      ));
    } else if (init.playerSeek) {
      const old = resumeRecord?.workers?.[0];
      let token = init.playerSeek;
      let offsetMs = Math.max(0, Number(old?.offsetMs || 0) - FAST_OVERLAP_MS);
      let previousToken = null;
      let loops = 0;
      state.workerProgress = [{ index: 0, startMs: 0, endMs: durationMs || Number.MAX_SAFE_INTEGER, offsetMs, done: false }];

      while (token && loops < 30000) {
        loops++;
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const response = await innertubeReplay(ctx, token, signal, offsetMs, false);
        const actions = getActions(response);
        addActionsTracked(actions, map);

        const lastOffset = maxOffsetFromActions(actions);
        const nextToken = findContinuation(response, 'playerSeekContinuationData');

        if (lastOffset !== null) {
          offsetMs = Math.max(offsetMs, lastOffset);
          state.workerProgress[0].offsetMs = offsetMs;
        }

        onProgress({
          phase: 'playerSeek',
          count: map.size,
          requests: state.requestCount,
          detail: lastOffset === null ? '取得中…' : `${formatTime(lastOffset / 1000)} まで取得`,
        });
        maybePersistSnapshot();

        if (!nextToken) break;
        if (lastOffset === null) {
          if (nextToken === token || nextToken === previousToken) break;
        } else if (lastOffset <= offsetMs && nextToken === token) {
          break;
        }

        previousToken = token;
        token = nextToken;
        if (loops % 12 === 0) await sleep(0);
      }
      state.workerProgress[0].done = true;
    } else if (init.replay) {
      addActionsTracked(getActions(init.response), map);
      let token = init.replay;
      let previous = null;
      let loops = 0;
      state.workerProgress = [{ index: 0, startMs: 0, endMs: durationMs || Number.MAX_SAFE_INTEGER, offsetMs: 0, done: false }];

      while (token && loops < 30000) {
        loops++;
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = await innertubeReplay(ctx, token, signal, null, false);
        addActionsTracked(getActions(response), map);
        const lastOffset = maxOffsetFromActions(getActions(response));
        if (lastOffset !== null) state.workerProgress[0].offsetMs = lastOffset;

        onProgress({ phase: 'replay', count: map.size, requests: state.requestCount, detail: '取得中…' });
        maybePersistSnapshot();

        const next = findContinuation(response, 'liveChatReplayContinuationData');
        if (!next || next === token || next === previous) break;
        previous = token;
        token = next;
        if (loops % 12 === 0) await sleep(0);
      }
      state.workerProgress[0].done = true;
    } else {
      addActionsTracked(getActions(init.response), map);
      if (!map.size) throw new Error('Chat Replayの継続トークンが返りませんでした。');
    }

    state.messageMap = map;
    return currentMessagesSorted();
  }

  async function loadLegacyReplay(ctx, map, onProgress, signal, resumeRecord = null) {
    const fixedToken = ctx.continuation.continuation;
    const old = resumeRecord?.workers?.[0];
    let offsetMs = Math.max(0, Number(old?.offsetMs || 0) - FAST_OVERLAP_MS);
    let loops = 0;
    state.workerProgress = [{ index: 0, startMs: 0, endMs: Number.MAX_SAFE_INTEGER, offsetMs, done: false }];

    while (loops < 30000) {
      loops++;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const response = await innertubeReplay(ctx, fixedToken, signal, offsetMs, true);
      const actions = getActions(response);
      addActionsTracked(actions, map);
      const lastOffset = maxOffsetFromActions(actions);

      if (lastOffset !== null) state.workerProgress[0].offsetMs = lastOffset;
      onProgress({
        phase: 'legacy',
        count: map.size,
        requests: state.requestCount,
        detail: lastOffset === null ? '旧方式で取得中…' : `${formatTime(lastOffset / 1000)} まで取得`,
      });
      maybePersistSnapshot();

      if (lastOffset === null || lastOffset <= offsetMs) break;
      offsetMs = lastOffset;
      if (loops % 12 === 0) await sleep(0);
    }

    state.workerProgress[0].done = true;
    if (!map.size) throw new Error('旧方式でもチャットを取得できませんでした。');
    state.messageMap = map;
    return currentMessagesSorted();
  }

  function injectStyle() {
    if (document.getElementById(`${APP_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${APP_ID}-style`;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed; right: 14px; bottom: 74px; z-index: 2147483646;
        border: 0; border-radius: 999px; padding: 11px 15px;
        font: 600 14px/1.2 system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        background: #0f0f0f; color: #fff; box-shadow: 0 4px 18px rgba(0,0,0,.28);
        cursor: pointer; -webkit-tap-highlight-color: transparent;
      }
      #${PANEL_ID} {
        position: fixed; right: 12px; bottom: 126px; z-index: 2147483647;
        width: min(430px, calc(100vw - 24px)); max-height: min(76vh, 720px);
        display: none; flex-direction: column; overflow: hidden;
        background: #fff; color: #111; border: 1px solid rgba(0,0,0,.14); border-radius: 16px;
        box-shadow: 0 12px 38px rgba(0,0,0,.30);
        font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      #${PANEL_ID}.open { display: flex; }
      #${PANEL_ID} .mcs-head { display:flex; align-items:center; gap:8px; padding:12px 12px 8px; }
      #${PANEL_ID} .mcs-title { font-weight:700; flex:1; }
      #${PANEL_ID} button { font:inherit; }
      #${PANEL_ID} .mcs-close { border:0; background:#eee; border-radius:999px; width:32px; height:32px; cursor:pointer; }
      #${PANEL_ID} .mcs-controls { padding: 0 12px 10px; display:grid; gap:8px; }
      #${PANEL_ID} .mcs-load { border:0; border-radius:10px; background:#0f0f0f; color:#fff; padding:10px 12px; font-weight:650; cursor:pointer; }
      #${PANEL_ID} .mcs-load[disabled] { opacity:.55; cursor:default; }
      #${PANEL_ID} .mcs-status { font-size:12px; color:#606060; min-height:18px; overflow-wrap:anywhere; }
      #${PANEL_ID} .mcs-search { width:100%; box-sizing:border-box; border:1px solid #bbb; border-radius:10px; padding:10px 11px; font:inherit; }
      #${PANEL_ID} .mcs-help { font-size:11px; color:#777; }
      #${PANEL_ID} .mcs-fast-label { display:flex; align-items:center; gap:7px; font-size:12px; color:#555; }
      #${PANEL_ID} .mcs-fast { width:18px; height:18px; }
      #${PANEL_ID} .mcs-results { overflow:auto; border-top:1px solid #e5e5e5; min-height:90px; -webkit-overflow-scrolling:touch; }
      #${PANEL_ID} .mcs-empty { padding:18px 14px; color:#777; text-align:center; }
      #${PANEL_ID} .mcs-row { display:block; width:100%; text-align:left; border:0; border-bottom:1px solid #eee; background:#fff; padding:10px 12px; cursor:pointer; color:#111; }
      #${PANEL_ID} .mcs-row:active { background:#f3f3f3; }
      #${PANEL_ID} .mcs-meta { display:flex; gap:8px; align-items:baseline; margin-bottom:3px; }
      #${PANEL_ID} .mcs-time { color:#065fd4; font-weight:700; flex:0 0 auto; }
      #${PANEL_ID} .mcs-author { font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #${PANEL_ID} .mcs-msg { white-space:pre-wrap; overflow-wrap:anywhere; }
      #${PANEL_ID} .mcs-count { margin-left:auto; font-size:11px; color:#777; }
      @media (max-width: 600px) {
        #${BUTTON_ID} { right:10px; bottom:76px; }
        #${PANEL_ID} { left:0; right:0; bottom:0; width:100vw; max-height:82vh; border-radius:16px 16px 0 0; border-left:0; border-right:0; }
      }
      html[dark] #${PANEL_ID}, ytd-app[dark] #${PANEL_ID} { background:#181818; color:#f1f1f1; border-color:#444; }
      html[dark] #${PANEL_ID} .mcs-row, ytd-app[dark] #${PANEL_ID} .mcs-row { background:#181818; color:#f1f1f1; border-color:#333; }
      html[dark] #${PANEL_ID} .mcs-results, ytd-app[dark] #${PANEL_ID} .mcs-results { border-color:#333; }
      html[dark] #${PANEL_ID} .mcs-close, ytd-app[dark] #${PANEL_ID} .mcs-close { background:#333; color:#fff; }
    `;
    document.documentElement.appendChild(style);
  }

  function makeEl(tag, options = {}, children = []) {
    const el = document.createElement(tag);
    if (options.id) el.id = options.id;
    if (options.className) el.className = options.className;
    if (options.text !== undefined) el.textContent = String(options.text);
    if (options.type) el.type = options.type;
    if (options.placeholder) el.placeholder = options.placeholder;
    if (options.autocomplete) el.autocomplete = options.autocomplete;
    if (options.ariaLabel) el.setAttribute('aria-label', options.ariaLabel);
    if (options.style) el.style.cssText = options.style;
    for (const child of children) if (child) el.appendChild(child);
    return el;
  }

  function createUi() {
    injectStyle();
    if (document.getElementById(BUTTON_ID)) return;

    const mount = document.documentElement || document.body;
    if (!mount) return;

    const btn = makeEl('button', {
      id: BUTTON_ID,
      type: 'button',
      text: '🔎 チャット検索',
    });

    const panel = makeEl('section', { id: PANEL_ID });
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'メン限アーカイブ チャット検索');

    const head = makeEl('div', { className: 'mcs-head' });
    const title = makeEl('div', { className: 'mcs-title' });
    title.appendChild(document.createTextNode('メン限アーカイブ チャット検索 '));
    title.appendChild(makeEl('span', {
      text: `v${VERSION}`,
      style: 'font-size:11px;font-weight:500;color:#777',
    }));
    const close = makeEl('button', {
      className: 'mcs-close',
      type: 'button',
      text: '×',
      ariaLabel: '閉じる',
    });
    head.append(title, close);

    const controls = makeEl('div', { className: 'mcs-controls' });
    const load = makeEl('button', {
      className: 'mcs-load',
      type: 'button',
      text: 'チャットを取得',
    });
    const statusEl = makeEl('div', {
      className: 'mcs-status',
      text: 'アーカイブを開いて「チャットを取得」を押してください。',
    });
    const search = makeEl('input', {
      className: 'mcs-search',
      type: 'search',
      placeholder: '本文・投稿者を検索（A | B でOR）',
      autocomplete: 'off',
    });
    const fast = makeEl('input', { className: 'mcs-fast', type: 'checkbox' });
    fast.checked = true;
    const fastLabel = makeEl('label', { className: 'mcs-fast-label' });
    fastLabel.append(fast, document.createTextNode('超高速取得（8並列・長時間アーカイブ向け）'));
    const help = makeEl('div', {
      className: 'mcs-help',
      text: '検索結果をタップすると、その発言時刻へ移動します。取得途中のデータは自動保存されます。',
    });
    controls.append(load, statusEl, fastLabel, search, help);

    const results = makeEl('div', { className: 'mcs-results' });
    results.appendChild(makeEl('div', { className: 'mcs-empty', text: 'まだ取得していません。' }));

    panel.append(head, controls, results);

    // YouTube mobile / WebKit側のCSSに負けないよう、初期表示だけinlineでも固定。
    panel.style.setProperty('display', 'none', 'important');

    mount.appendChild(panel);
    mount.appendChild(btn);

    const setPanelOpen = (open) => {
      panel.classList.toggle('open', open);
      panel.style.setProperty('display', open ? 'flex' : 'none', 'important');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPanelOpen(panel.style.display === 'none');
    });
    close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setPanelOpen(false);
    });
    load.addEventListener('click', () => void handleLoadClick(false));
    search.addEventListener('input', renderSearchResults);
  }

  function status(text, isError = false) {
    const el = document.querySelector(`#${PANEL_ID} .mcs-status`);
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#d93025' : '';
  }

  function setLoadButton(text, disabled = false) {
    const el = document.querySelector(`#${PANEL_ID} .mcs-load`);
    if (!el) return;
    el.textContent = text;
    el.disabled = disabled;
  }

  async function handleLoadClick(autoResume = false) {
    const videoId = getVideoId();
    if (!videoId) {
      status('YouTubeの動画・配信アーカイブページで使ってください。', true);
      return;
    }

    if (state.loading) {
      state.manualAbort = true;
      state.abortController?.abort();
      return;
    }

    if (!autoResume && state.cacheCompleted) {
      await deleteCache(videoId);
      state.cacheRecord = null;
      state.cacheCompleted = false;
      state.messages = [];
      state.messageMap = new Map();
      state.workerProgress = [];
    }

    const cache = state.cacheRecord?.videoId === videoId ? state.cacheRecord : await readCache(videoId);
    if (cache && !state.messages.length) {
      state.messages = cache.messages || [];
      state.messageMap = new Map();
      for (const msg of state.messages) {
        const key = msg.id || `${msg.offsetMs}|${msg.author}|${msg.message}`;
        state.messageMap.set(key, msg);
      }
    }

    state.videoId = videoId;
    state.loading = true;
    state.manualAbort = false;
    state.abortController = new AbortController();
    state.loadedVideoId = null;
    setLoadButton('中止', false);
    status(autoResume || cache?.messages?.length ? '保存済みデータから続き取得を開始…' : '準備中…');
    renderSearchResults();

    const fastInput = document.querySelector(`#${PANEL_ID} .mcs-fast`);
    const fastMode = fastInput ? Boolean(fastInput.checked) : true;

    // 新規取得時だけ空の開始記録を保存。再開時に巨大な全件スナップショットを
    // もう一度書き直してから開始する無駄を避ける。
    if (!cache?.messages?.length) {
      await persistSnapshot({ completed: false, inProgress: true, force: true });
    }

    try {
      const messages = await loadAllChat((p) => {
        reportProgressThrottled(p);
      }, state.abortController.signal, {
        fastMode,
        resumeRecord: cache,
      });

      state.messages = messages;
      state.messageMap = new Map(messages.map((msg) => [
        msg.id || `${msg.offsetMs}|${msg.author}|${msg.message}`,
        msg,
      ]));
      state.loadedVideoId = videoId;
      await persistSnapshot({ completed: true, inProgress: false, force: true });
      status(`取得完了：${messages.length.toLocaleString()}件（API ${state.requestCount}回）`);
      setLoadButton('再取得', false);
      renderSearchResults();
    } catch (e) {
      if (e?.name === 'AbortError') {
        await persistSnapshot({
          completed: false,
          inProgress: !state.manualAbort,
          force: true,
        });
        status(state.manualAbort ? '取得を中止しました。続きは保存されています。' : '取得が中断されました。戻ったとき続きから再開します。');
      } else {
        console.error('[Member Chat Search]', e);
        await persistSnapshot({ completed: false, inProgress: false, force: true });
        let extra = '';
        if (/HTTP 400/.test(String(e?.message))) {
          extra = '／認証セッション不一致の可能性があります。';
        } else if (/HTTP 403/.test(String(e?.message))) {
          extra = '／このアカウントに視聴権限があるか確認してください。';
        } else if (/HTTP 429/.test(String(e?.message))) {
          extra = '／自動待機でも解除されませんでした。少し時間を置くか、高速取得をOFFにして再開できます。';
        }
        status(`${e?.message || e}${extra}`, true);
      }
      setLoadButton('続きから取得', false);
    } finally {
      state.loading = false;
      state.abortController = null;
      state.manualAbort = false;
      state.messages = currentMessagesSorted();
      renderSearchResults();
    }
  }

  function matchesQuery(msg, raw) {
    const q = raw.trim().toLocaleLowerCase();
    if (!q) return true;
    const hay = `${msg.author}\n${msg.message}`.toLocaleLowerCase();
    const ors = q.split('|').map((x) => x.trim()).filter(Boolean);
    return ors.some((term) => hay.includes(term));
  }

  function renderSearchResults() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const results = panel.querySelector('.mcs-results');
    const input = panel.querySelector('.mcs-search');
    if (!results || !input) return;

    const clearResults = () => {
      while (results.firstChild) results.removeChild(results.firstChild);
    };

    const showEmpty = (text) => {
      clearResults();
      results.appendChild(makeEl('div', { className: 'mcs-empty', text }));
    };

    if (!state.messages.length) {
      showEmpty(state.loading ? 'チャット取得中…' : 'まだ取得していません。');
      return;
    }

    const q = input.value || '';
    const filtered = state.messages.filter((m) => matchesQuery(m, q));
    const display = filtered.slice(0, 1000);

    if (!display.length) {
      showEmpty('該当するチャットはありません。');
      return;
    }

    clearResults();

    display.forEach((m, i) => {
      const row = makeEl('button', { className: 'mcs-row', type: 'button' });
      row.dataset.index = String(i);

      const meta = makeEl('div', { className: 'mcs-meta' });
      meta.appendChild(makeEl('span', { className: 'mcs-time', text: formatTime(m.seconds) }));
      meta.appendChild(makeEl('span', { className: 'mcs-author', text: m.author || '（投稿者不明）' }));

      if (i === 0) {
        meta.appendChild(makeEl('span', {
          className: 'mcs-count',
          text: `${filtered.length.toLocaleString()}件${filtered.length > 1000 ? '（先頭1000件）' : ''}`,
        }));
      }

      row.appendChild(meta);
      row.appendChild(makeEl('div', { className: 'mcs-msg', text: m.message }));
      row.addEventListener('click', () => seekTo(m.seconds));
      results.appendChild(row);
    });
  }

  function seekTo(seconds) {
    const video = document.querySelector('video');
    if (!video) {
      status('動画プレーヤーが見つかりません。', true);
      return;
    }
    try {
      video.currentTime = Math.max(0, Number(seconds) || 0);
      status(`${formatTime(seconds)} に移動しました。`);
      // URLにも時刻を残して、再読み込み時にも位置が分かるようにする。
      const u = new URL(location.href);
      u.searchParams.set('t', `${Math.floor(seconds)}s`);
      history.replaceState(history.state, '', u.href);
    } catch (e) {
      status(`時刻移動に失敗しました: ${e?.message || e}`, true);
    }
  }

  function resetForNavigation() {
    const id = getVideoId();
    if (id === state.videoId) return;
    if (state.loading) {
      void persistSnapshot({ completed: false, inProgress: true, force: true });
      state.abortController?.abort();
    }
    state.videoId = id;
    state.loadedVideoId = null;
    state.messages = [];
    state.messageMap = new Map();
    state.workerProgress = [];
    state.cacheRecord = null;
    state.cacheCompleted = false;
    state.autoResumeStartedFor = null;
    const input = document.querySelector(`#${PANEL_ID} .mcs-search`);
    if (input) input.value = '';
    status('アーカイブを開いて「チャットを取得」を押してください。');
    setLoadButton('チャットを取得', false);
    renderSearchResults();
    if (id) void restoreCacheForVideo(id, { allowAutoResume: true });
  }

  function boot() {
    if (!document.body) return;
    createUi();
    state.videoId = getVideoId();

    document.addEventListener('yt-navigate-finish', resetForNavigation, true);
    window.addEventListener('popstate', resetForNavigation);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.loading) {
        void persistSnapshot({ completed: false, inProgress: true, force: true });
      } else if (!document.hidden && state.videoId && !state.loading) {
        void restoreCacheForVideo(state.videoId, { allowAutoResume: true });
      }
    });

    window.addEventListener('pagehide', () => {
      if (state.loading) void persistSnapshot({ completed: false, inProgress: true, force: true });
    });

    if (state.videoId) void restoreCacheForVideo(state.videoId, { allowAutoResume: true });

    setInterval(() => {
      if (!document.getElementById(BUTTON_ID) || !document.getElementById(PANEL_ID)) createUi();
      if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        resetForNavigation();
      }
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
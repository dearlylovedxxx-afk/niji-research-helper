// ==UserScript==
// @name         YouTube メン限アーカイブ チャット検索
// @namespace    marina-youtube-chat-search
// @version      0.1.0
// @description  YouTubeの視聴権限がある配信アーカイブからChat Replayを取得し、本文・投稿者を検索します。
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Member_Chat_Search.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Member_Chat_Search.user.js
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const APP_ID = 'marina-member-chat-search';
  const BUTTON_ID = `${APP_ID}-button`;
  const PANEL_ID = `${APP_ID}-panel`;
  const VERSION = '0.1.0';

  const state = {
    videoId: null,
    messages: [],
    loadedVideoId: null,
    loading: false,
    abortController: null,
    lastUrl: location.href,
    requestCount: 0,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // @grant none なら通常はページ本体のグローバルをそのまま参照できます。
    // Safari系ユーザースクリプトで見えない場合に備え、HTML再取得をフォールバックにします。
    let initialData = null;
    let cfg = {};

    try {
      if (window.ytInitialData && typeof window.ytInitialData === 'object') {
        initialData = window.ytInitialData;
      }
    } catch { /* ignore */ }

    try {
      if (window.ytcfg?.data_ && typeof window.ytcfg.data_ === 'object') {
        cfg = { ...window.ytcfg.data_ };
      } else if (window.ytcfg?.get) {
        const keys = [
          'INNERTUBE_API_KEY',
          'INNERTUBE_CONTEXT',
          'INNERTUBE_CONTEXT_CLIENT_NAME',
          'INNERTUBE_CONTEXT_CLIENT_VERSION',
          'SESSION_INDEX',
          'DELEGATED_SESSION_ID',
          'HL',
        ];
        for (const key of keys) {
          const value = window.ytcfg.get(key);
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
    const direct =
      initialData?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer?.continuations?.[0]?.reloadContinuationData ||
      initialData?.response?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer?.continuations?.[0]?.reloadContinuationData;

    if (direct?.continuation) return { ...direct, source: 'direct' };

    const all = deepFindValues(initialData, 'reloadContinuationData');
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i]?.continuation) return { ...all[i], source: 'deep' };
    }
    return null;
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
    const client = cfg?.INNERTUBE_CONTEXT?.client || {};
    const clientName = cfg?.INNERTUBE_CONTEXT_CLIENT_NAME ?? client.clientName ?? '1';
    const clientVersion = cfg?.INNERTUBE_CONTEXT_CLIENT_VERSION ?? client.clientVersion;

    if (!client.clientName && typeof clientName === 'string' && !/^\d+$/.test(clientName)) {
      client.clientName = clientName;
    }
    if (!client.clientVersion && clientVersion) client.clientVersion = clientVersion;

    return { ...cfg, INNERTUBE_CONTEXT: { ...(cfg.INNERTUBE_CONTEXT || {}), client }, clientName, clientVersion };
  }

  async function makeRequestContext(signal) {
    const pageData = await fetchPageData(signal);
    if (!pageData.initialData) throw new Error('ytInitialDataを取得できませんでした。');

    const cfg = normalizeCfg(pageData.cfg || {});
    if (!cfg.INNERTUBE_CONTEXT?.client) {
      throw new Error('YouTubeのInnertube設定を取得できませんでした。');
    }

    const continuation = extractInitialContinuation(pageData.initialData);
    if (!continuation?.continuation) {
      throw new Error('チャットリプレイの開始トークンが見つかりません。チャットリプレイが無効・削除済みの可能性があります。');
    }

    const origin = location.origin;
    const auth = await buildAuthorization(origin);

    return {
      initialData: pageData.initialData,
      cfg,
      continuation,
      origin,
      auth,
      source: pageData.source,
    };
  }

  function buildHeaders(ctx) {
    const h = {
      'accept': '*/*',
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'pragma': 'no-cache',
      'x-youtube-client-name': String(ctx.cfg.clientName ?? '1'),
    };
    if (ctx.cfg.clientVersion) h['x-youtube-client-version'] = String(ctx.cfg.clientVersion);
    if (ctx.auth.header) h['authorization'] = ctx.auth.header;
    if (ctx.cfg.SESSION_INDEX !== undefined && ctx.cfg.SESSION_INDEX !== null) {
      h['x-goog-authuser'] = String(ctx.cfg.SESSION_INDEX);
    }
    if (ctx.cfg.DELEGATED_SESSION_ID) {
      h['x-goog-pageid'] = String(ctx.cfg.DELEGATED_SESSION_ID);
    }
    return h;
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
    let endpoint = `${location.origin}/youtubei/v1/live_chat/get_live_chat_replay?prettyPrint=false`;
    if (legacyWithKey && ctx.cfg.INNERTUBE_API_KEY) {
      endpoint = `${location.origin}/youtubei/v1/live_chat/get_live_chat_replay?key=${encodeURIComponent(ctx.cfg.INNERTUBE_API_KEY)}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      mode: 'cors',
      referrer: location.href,
      referrerPolicy: 'strict-origin-when-cross-origin',
      headers: buildHeaders(ctx),
      body: JSON.stringify(buildBody(ctx, continuation, offsetMs)),
      signal,
    });

    state.requestCount++;

    if (!res.ok) {
      const err = new Error(`Chat Replay API: HTTP ${res.status} ${res.statusText}`);
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

  async function loadAllChat(onProgress, signal) {
    state.requestCount = 0;
    const ctx = await makeRequestContext(signal);
    const map = new Map();

    onProgress({
      phase: 'auth',
      count: 0,
      requests: 0,
      detail: `認証:${ctx.auth.hasBaseSecret ? 'OK' : 'なし'} / アカウント:${ctx.cfg.SESSION_INDEX ?? '不明'} / 初期データ:${ctx.source}`,
    });

    if (!ctx.auth.header) {
      throw new Error('ログイン認証用SAPISIDを取得できません。メン限アーカイブでは認証が必要です。');
    }

    // Stage 1: 現行API。最初の応答からplayerSeekContinuationを取得する。
    let firstResponse;
    try {
      firstResponse = await innertubeReplay(ctx, ctx.continuation.continuation, signal, null, false);
    } catch (e) {
      // 一部の旧形式ではAPI key + offset方式が必要な場合があるためフォールバック。
      if ((e?.status === 400 || e?.status === 404) && ctx.cfg.INNERTUBE_API_KEY) {
        onProgress({ phase: 'legacy', count: 0, requests: state.requestCount, detail: '現行方式が失敗。旧方式を試します…' });
        return loadLegacyReplay(ctx, map, onProgress, signal);
      }
      throw e;
    }

    const playerSeek = findContinuation(firstResponse, 'playerSeekContinuationData');
    const replayContinuation = findContinuation(firstResponse, 'liveChatReplayContinuationData');

    if (playerSeek) {
      let token = playerSeek;
      let offsetMs = 0;
      let previousToken = null;
      let loops = 0;

      while (token && loops < 20000) {
        loops++;
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const response = await innertubeReplay(ctx, token, signal, offsetMs, false);
        const actions = getActions(response);
        addActions(actions, map);

        const lastOffset = maxOffsetFromActions(actions);
        const nextToken = findContinuation(response, 'playerSeekContinuationData');

        onProgress({
          phase: 'playerSeek',
          count: map.size,
          requests: state.requestCount,
          detail: lastOffset === null ? '取得中…' : `${formatTime(lastOffset / 1000)} まで取得`,
        });

        if (!nextToken) break;
        if (lastOffset === null) {
          // アクションなしでもtokenが更新される場合だけ継続。
          if (nextToken === token || nextToken === previousToken) break;
        } else {
          if (lastOffset <= offsetMs && nextToken === token) break;
          offsetMs = Math.max(offsetMs, lastOffset);
        }

        previousToken = token;
        token = nextToken;

        // UIを固めない。
        if (loops % 8 === 0) await sleep(0);
      }
    } else if (replayContinuation) {
      // playerSeekがない場合は最初のバッチも検索対象にする。
      addActions(getActions(firstResponse), map);
      let token = replayContinuation;
      let previous = null;
      let loops = 0;

      while (token && loops < 20000) {
        loops++;
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = await innertubeReplay(ctx, token, signal, null, false);
        addActions(getActions(response), map);

        onProgress({ phase: 'replay', count: map.size, requests: state.requestCount, detail: '取得中…' });

        const next = findContinuation(response, 'liveChatReplayContinuationData');
        if (!next || next === token || next === previous) break;
        previous = token;
        token = next;
        if (loops % 8 === 0) await sleep(0);
      }
    } else {
      // 初回応答にメッセージがあるケースだけ救済。
      addActions(getActions(firstResponse), map);
      if (!map.size) throw new Error('Chat Replayの継続トークンが返りませんでした。');
    }

    return [...map.values()].sort((a, b) => a.offsetMs - b.offsetMs);
  }

  async function loadLegacyReplay(ctx, map, onProgress, signal) {
    const fixedToken = ctx.continuation.continuation;
    let offsetMs = 0;
    let loops = 0;

    while (loops < 20000) {
      loops++;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const response = await innertubeReplay(ctx, fixedToken, signal, offsetMs, true);
      const actions = getActions(response);
      addActions(actions, map);
      const lastOffset = maxOffsetFromActions(actions);

      onProgress({
        phase: 'legacy',
        count: map.size,
        requests: state.requestCount,
        detail: lastOffset === null ? '旧方式で取得中…' : `${formatTime(lastOffset / 1000)} まで取得`,
      });

      if (lastOffset === null || lastOffset <= offsetMs) break;
      offsetMs = lastOffset;
      if (loops % 8 === 0) await sleep(0);
    }

    if (!map.size) throw new Error('旧方式でもチャットを取得できませんでした。');
    return [...map.values()].sort((a, b) => a.offsetMs - b.offsetMs);
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

  function createUi() {
    injectStyle();
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = '🔎 チャット検索';
    document.body.appendChild(btn);

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="mcs-head">
        <div class="mcs-title">メン限アーカイブ チャット検索 <span style="font-size:11px;font-weight:500;color:#777">v${VERSION}</span></div>
        <button class="mcs-close" type="button" aria-label="閉じる">×</button>
      </div>
      <div class="mcs-controls">
        <button class="mcs-load" type="button">チャットを取得</button>
        <div class="mcs-status">アーカイブを開いて「チャットを取得」を押してください。</div>
        <input class="mcs-search" type="search" placeholder="本文・投稿者を検索（A | B でOR）" autocomplete="off" />
        <div class="mcs-help">検索結果をタップすると、その発言時刻へ移動します。</div>
      </div>
      <div class="mcs-results"><div class="mcs-empty">まだ取得していません。</div></div>
    `;
    document.body.appendChild(panel);

    const close = panel.querySelector('.mcs-close');
    const load = panel.querySelector('.mcs-load');
    const search = panel.querySelector('.mcs-search');

    btn.addEventListener('click', () => panel.classList.toggle('open'));
    close.addEventListener('click', () => panel.classList.remove('open'));
    load.addEventListener('click', handleLoadClick);
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

  async function handleLoadClick() {
    const videoId = getVideoId();
    if (!videoId) {
      status('YouTubeの動画・配信アーカイブページで使ってください。', true);
      return;
    }

    if (state.loading) {
      state.abortController?.abort();
      return;
    }

    state.videoId = videoId;
    state.loading = true;
    state.abortController = new AbortController();
    state.messages = [];
    state.loadedVideoId = null;
    setLoadButton('中止', false);
    status('準備中…');
    renderSearchResults();

    try {
      const messages = await loadAllChat((p) => {
        status(`${p.detail}　${p.count.toLocaleString()}件 / API ${p.requests}回`);
      }, state.abortController.signal);

      state.messages = messages;
      state.loadedVideoId = videoId;
      status(`取得完了：${messages.length.toLocaleString()}件（API ${state.requestCount}回）`);
      setLoadButton('再取得', false);
      renderSearchResults();
    } catch (e) {
      if (e?.name === 'AbortError') {
        status('取得を中止しました。');
      } else {
        console.error('[Member Chat Search]', e);
        let extra = '';
        if (/HTTP 400/.test(String(e?.message))) {
          extra = '／認証アカウント不一致、またはOriginを書き換える拡張機能の干渉が考えられます。';
        } else if (/HTTP 403/.test(String(e?.message))) {
          extra = '／このアカウントに視聴権限があるか確認してください。';
        }
        status(`${e?.message || e}${extra}`, true);
      }
      setLoadButton('チャットを取得', false);
    } finally {
      state.loading = false;
      state.abortController = null;
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

    if (!state.messages.length) {
      results.innerHTML = `<div class="mcs-empty">${state.loading ? 'チャット取得中…' : 'まだ取得していません。'}</div>`;
      return;
    }

    const q = input.value || '';
    const filtered = state.messages.filter((m) => matchesQuery(m, q));
    const display = filtered.slice(0, 1000);

    if (!display.length) {
      results.innerHTML = '<div class="mcs-empty">該当するチャットはありません。</div>';
      return;
    }

    results.innerHTML = display.map((m, i) => `
      <button class="mcs-row" type="button" data-index="${i}">
        <div class="mcs-meta">
          <span class="mcs-time">${escapeHtml(formatTime(m.seconds))}</span>
          <span class="mcs-author">${escapeHtml(m.author || '（投稿者不明）')}</span>
          ${i === 0 ? `<span class="mcs-count">${filtered.length.toLocaleString()}件${filtered.length > 1000 ? '（先頭1000件）' : ''}</span>` : ''}
        </div>
        <div class="mcs-msg">${escapeHtml(m.message)}</div>
      </button>
    `).join('');

    results.querySelectorAll('.mcs-row').forEach((row, i) => {
      row.addEventListener('click', () => seekTo(display[i].seconds));
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
    if (state.loading) state.abortController?.abort();
    state.videoId = id;
    state.loadedVideoId = null;
    state.messages = [];
    const input = document.querySelector(`#${PANEL_ID} .mcs-search`);
    if (input) input.value = '';
    status('アーカイブを開いて「チャットを取得」を押してください。');
    setLoadButton('チャットを取得', false);
    renderSearchResults();
  }

  function boot() {
    if (!document.body) return;
    createUi();
    state.videoId = getVideoId();

    document.addEventListener('yt-navigate-finish', resetForNavigation, true);
    window.addEventListener('popstate', resetForNavigation);

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
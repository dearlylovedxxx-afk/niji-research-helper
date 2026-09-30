// ==UserScript==
// @name         YouTube メン限アーカイブ チャット検索
// @namespace    marina-youtube-chat-search
// @version      0.1.4
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
  const VERSION = '0.1.4';

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

    const videoId = getVideoId();
    const origin = 'https://www.youtube.com';
    let auth = await buildAuthorization(origin);
    let initialData = pageData.initialData;
    let continuation = extractInitialContinuation(initialData);
    let source = pageData.source;

    // 1) Safariのモバイルwatchにチャット情報が無い場合、YCSと同じPBJ経路を試す。
    if (!continuation?.continuation && videoId) {
      const pbj = await fetchPbjInitialData(videoId, cfg, auth, origin, signal);
      const pbjContinuation = extractInitialContinuation(pbj);
      if (pbjContinuation?.continuation) {
        initialData = pbj;
        continuation = { ...pbjContinuation, source: `pbj:${pbjContinuation.source}` };
        source = 'pbj';
      }
    }

    // 2) SafariのfetchではUser-AgentをPCにできないため、MacaqueのGM通信で
    //    本当にPC版User-Agentを付けてwatch HTMLを取得する。
    if (!continuation?.continuation && videoId) {
      const gmDesktop = await fetchDesktopWatchDataViaGM(videoId, signal);
      if (gmDesktop) {
        cfg = normalizeCfg({ ...cfg, ...(gmDesktop.cfg || {}) });
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

    // 3) GM通信が使えない/取れない場合だけ、通常fetchのPC版URLも試す。
    if (!continuation?.continuation && videoId) {
      const desktop = await fetchDesktopWatchData(videoId, signal);
      if (desktop) {
        cfg = normalizeCfg({ ...cfg, ...(desktop.cfg || {}) });
        auth = await buildAuthorization(origin);
        const desktopContinuation = extractInitialContinuation(desktop.initialData);
        if (desktopContinuation?.continuation) {
          initialData = desktop.initialData;
          continuation = { ...desktopContinuation, source: `desktop:${desktopContinuation.source}` };
          source = 'desktop-html';
        }
      }
    }

    // 4) HTMLに無くても /youtubei/v1/next がconversationBarを返す場合がある。
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

    return {
      initialData,
      cfg,
      continuation,
      origin,
      auth,
      source,
    };
  }

  function buildHeaders(ctx) {
    const h = {
      'accept': '*/*',
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'pragma': 'no-cache',
      'x-youtube-client-name': String(ctx.cfg.clientName ?? '1'),
      'x-origin': ctx.origin || 'https://www.youtube.com',
    };
    if (ctx.cfg.clientVersion) h['x-youtube-client-version'] = String(ctx.cfg.clientVersion);
    if (ctx.cfg.visitorData) h['x-goog-visitor-id'] = String(ctx.cfg.visitorData);

    if (ctx.auth.header) {
      h['authorization'] = ctx.auth.header;
      // 認証時は未指定より0を明示した方がSafari/MWEBで安定する。
      h['x-goog-authuser'] = String(
        ctx.cfg.SESSION_INDEX !== undefined && ctx.cfg.SESSION_INDEX !== null
          ? ctx.cfg.SESSION_INDEX
          : 0
      );
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
    const baseEndpoint = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay`;
    const qs = new URLSearchParams();
    if (ctx.cfg.INNERTUBE_API_KEY) qs.set('key', String(ctx.cfg.INNERTUBE_API_KEY));
    qs.set('prettyPrint', 'false');
    const endpoint = `${baseEndpoint}?${qs.toString()}`;

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
      const tokenSource = ctx.continuation?.source || 'unknown';
      const sessionIndex = ctx.cfg.SESSION_INDEX ?? 0;
      const client = ctx.cfg.INNERTUBE_CONTEXT?.client?.clientName || ctx.cfg.clientName || '?';
      const err = new Error(
        `Chat Replay API: HTTP ${res.status} ${res.statusText} [token:${tokenSource} / account:${sessionIndex} / client:${client} / visitor:${ctx.cfg.visitorData ? 'yes' : 'no'}]`
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

  async function loadAllChat(onProgress, signal) {
    state.requestCount = 0;
    const ctx = await makeRequestContext(signal);
    const map = new Map();

    onProgress({
      phase: 'auth',
      count: 0,
      requests: 0,
      detail: `認証:${ctx.auth.hasBaseSecret ? 'OK' : 'なし'} / アカウント:${ctx.cfg.SESSION_INDEX ?? 0} / token:${ctx.continuation.source} / client:${ctx.cfg.INNERTUBE_CONTEXT?.client?.clientName || ctx.cfg.clientName || '?'} / visitor:${ctx.cfg.visitorData ? '有' : '無'}`,
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
    const help = makeEl('div', {
      className: 'mcs-help',
      text: '検索結果をタップすると、その発言時刻へ移動します。',
    });
    controls.append(load, statusEl, search, help);

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
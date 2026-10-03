// ==UserScript==
// @name         YouTube メン限アーカイブ チャット検索
// @namespace    marina-youtube-chat-search
// @version      0.5.0
// @description  視聴権限があるYouTubeアーカイブのChat Replayを取得・pCloud保存し、動画内検索と全アーカイブ横断検索を行います。
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Member_Chat_Search.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Member_Chat_Search.user.js
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @grant        GM_xmlhttpRequest
// @connect      www.youtube.com
// @connect      niji-research-backup.dearlylovedxxx.workers.dev
// ==/UserScript==

(() => {
  'use strict';

  // PC版YouTubeのチャットリプレイiframe内では起動しない。
  if (window.top !== window.self) return;

  const APP_ID = 'marina-member-chat-search';
  const BUTTON_ID = `${APP_ID}-button`;
  const PANEL_ID = `${APP_ID}-panel`;
  const VERSION = '0.5.0';

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
    lastAppliedTimestampUrl: null,
    autoStartStartedFor: null,
    initSerial: 0,
    cloudEnabled: false,
    cloudToken: '',
    cloudBusy: false,
    cloudStatus: '未接続',
    cloudLastBackupId: '',
    cloudLastError: '',
    cloudUploadPromise: null,
    memberOnly: null,
    searchScope: 'current',
    crossSyncBusy: false,
    crossSearchSerial: 0,
    crossSearchTimer: null,

  };

  const CACHE_DB_NAME = 'MarinaMemberChatSearchDB';
  const CACHE_STORE = 'videoCache';
  const ARCHIVE_DB_NAME = 'MarinaMemberChatCrossSearchDB';
  const ARCHIVE_DB_VERSION = 1;
  const ARCHIVE_STORE = 'archiveIndex';
  const CHAT_MANIFEST_DEVICE = 'ytchat_manifest_v1';
  const CROSS_RESULT_LIMIT = 1000;
  const FAST_WORKERS = 8;
  const FAST_OVERLAP_MS = 60 * 1000;
  const CLOUD_URL = 'https://niji-research-backup.dearlylovedxxx.workers.dev';
  const CLOUD_CONFIG_KEY = 'mcs_pcloud_config_v1';
  const CLOUD_SCHEMA_VERSION = 1;
  let cacheDbPromise = null;
  let archiveDbPromise = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function withTimeout(promise, ms, label = '処理') {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}がタイムアウトしました`)), ms);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async function waitForCloudIdle(maxMs = 60000) {
    const started = Date.now();
    while (state.cloudBusy && Date.now() - started < maxMs) {
      await sleep(250);
    }
    if (state.cloudBusy) throw new Error('別のpCloud処理が終わらないため保存を開始できませんでした');
  }

  async function gmGetValue(key, fallback) {
    try {
      if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') {
        const value = await GM.getValue(key, fallback);
        return value ?? fallback;
      }
    } catch (e) {
      console.warn('[Member Chat Search] GM.getValue failed', e);
    }
    return fallback;
  }

  async function gmSetValue(key, value) {
    if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') {
      return GM.setValue(key, value);
    }
    throw new Error('MacaqueのGM.setValueが利用できません。');
  }

  function cloudDevice(videoId) {
    // WorkerのDEVICE_REは /^[a-z0-9_.:-]{1,96}$/。
    // YouTube videoIdは大文字を含み得るため、そのままではinvalid_deviceになる。
    // 大文字A-Zだけを :a ～ :z に可逆エスケープし、大小文字の区別も維持する。
    const encoded = String(videoId || '').replace(/[A-Z]/g, (ch) => `:${ch.toLowerCase()}`);
    return `ytchat_${encoded}`;
  }

  function videoIdFromCloudDevice(device) {
    const value = String(device || '');
    if (!value.startsWith('ytchat_') || value === CHAT_MANIFEST_DEVICE) return '';
    return value.slice('ytchat_'.length).replace(/:([a-z])/g, (_, ch) => ch.toUpperCase());
  }

  function isChatArchiveDevice(device) {
    return Boolean(videoIdFromCloudDevice(device));
  }

  function cloudUiStatus(text, isError = false) {
    state.cloudStatus = text;
    state.cloudLastError = isError ? text : '';
    const el = document.querySelector(`#${PANEL_ID} .mcs-cloud-status`);
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#d93025' : '';
  }

  function updateCloudUi() {
    const wrap = document.querySelector(`#${PANEL_ID} .mcs-cloud-wrap`);
    if (!wrap) return;
    const input = wrap.querySelector('.mcs-cloud-token');
    const connect = wrap.querySelector('.mcs-cloud-connect');
    const disconnect = wrap.querySelector('.mcs-cloud-disconnect');
    const restore = wrap.querySelector('.mcs-cloud-restore');
    const retry = wrap.querySelector('.mcs-cloud-retry-save');
    const crossSync = document.querySelector(`#${PANEL_ID} .mcs-cross-sync`);
    if (input) input.style.display = state.cloudEnabled ? 'none' : '';
    if (connect) connect.style.display = state.cloudEnabled ? 'none' : '';
    if (disconnect) disconnect.style.display = state.cloudEnabled ? '' : 'none';
    if (restore) restore.disabled = !state.cloudEnabled || state.cloudBusy;
    if (retry) retry.disabled = !state.cloudEnabled || state.cloudBusy || !state.messages.length;
    if (crossSync) crossSync.disabled = !state.cloudEnabled || state.crossSyncBusy;
    cloudUiStatus(
      state.cloudEnabled
        ? (state.cloudStatus || '☁️ pCloud接続済み')
        : '☁️ pCloud未接続（初回のみバックアップ専用トークンを入力）',
      Boolean(state.cloudLastError)
    );
  }

  async function cloudSha(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function cloudList(videoId, token = state.cloudToken) {
    if (!token || !videoId) return [];
    const res = await gmRequest({
      method: 'GET',
      url: `${CLOUD_URL}/v1/backups?device=${encodeURIComponent(cloudDevice(videoId))}`,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      responseType: 'text',
      timeout: 45000,
    });
    let body = {};
    try { body = JSON.parse(res.responseText || res.response || '{}'); }
    catch { throw new Error('pCloud中継Workerの応答を読み取れません。'); }
    if (res.status < 200 || res.status >= 300 || !body.ok) {
      throw new Error(`pCloud一覧 HTTP ${res.status}: ${body.error || '取得失敗'}`);
    }
    return (Array.isArray(body.backups) ? body.backups : [])
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  async function cloudFetchBackup(item, videoId, token = state.cloudToken) {
    if (!item?.id || !item?.sha256) throw new Error('pCloudバックアップ情報が不正です。');

    const res = await gmRequest({
      method: 'GET',
      url: `${CLOUD_URL}/v1/backups/${encodeURIComponent(item.id)}`,
      headers: { authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 45000,
    });
    if (res.status !== 200) throw new Error(`pCloud読込 HTTP ${res.status}`);

    const raw =
      res.response instanceof ArrayBuffer
        ? new Uint8Array(res.response)
        : ArrayBuffer.isView(res.response)
          ? new Uint8Array(res.response.buffer, res.response.byteOffset, res.response.byteLength)
          : new TextEncoder().encode(res.responseText || String(res.response || ''));

    if (Number(item.size || 0) && raw.byteLength !== Number(item.size)) {
      throw new Error('pCloudバックアップのサイズが一致しません。');
    }
    if (await cloudSha(raw) !== item.sha256) {
      throw new Error('pCloudバックアップのSHA-256が一致しません。');
    }

    let data;
    try {
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw new Error('pCloudバックアップJSONが不正です。');
    }

    const chat = data?.preferences?.chatArchive;
    if (
      data?.app !== 'Niji Research Helper' ||
      Number(data?.dbVersion) !== 1 ||
      data?.device !== cloudDevice(videoId) ||
      !data?.stores ||
      !Array.isArray(data.stores.videos) ||
      !Array.isArray(data.stores.channels) ||
      !Array.isArray(data.stores.wiki) ||
      !Array.isArray(data.stores.pairs) ||
      chat?.app !== 'YouTube Member Chat Search' ||
      Number(chat?.schemaVersion) !== CLOUD_SCHEMA_VERSION ||
      chat?.videoId !== videoId ||
      chat?.completed !== true ||
      !Array.isArray(chat?.messages)
    ) {
      throw new Error('pCloudバックアップの形式が違います。');
    }

    return {
      ...chat,
      exportedAt: data.exportedAt,
      sourceOrigin: data.sourceOrigin,
      device: data.device,
    };
  }


  async function cloudListDevice(device, token = state.cloudToken) {
    if (!token || !device) return [];
    const res = await gmRequest({
      method: 'GET',
      url: `${CLOUD_URL}/v1/backups?device=${encodeURIComponent(device)}`,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      responseType: 'text',
      timeout: 45000,
    });
    let body = {};
    try { body = JSON.parse(res.responseText || res.response || '{}'); }
    catch { throw new Error('pCloud中継Workerの応答を読み取れません。'); }
    if (res.status < 200 || res.status >= 300 || !body.ok) {
      throw new Error(`pCloud一覧 HTTP ${res.status}: ${body.error || '取得失敗'}`);
    }
    return (Array.isArray(body.backups) ? body.backups : [])
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  async function cloudListAll(token = state.cloudToken) {
    if (!token) return [];
    const res = await gmRequest({
      method: 'GET',
      url: `${CLOUD_URL}/v1/backups`,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      responseType: 'text',
      timeout: 45000,
    });
    let body = {};
    try { body = JSON.parse(res.responseText || res.response || '{}'); }
    catch { throw new Error('pCloud中継Workerの応答を読み取れません。'); }
    if (res.status < 200 || res.status >= 300 || !body.ok) {
      throw new Error(`pCloud一覧 HTTP ${res.status}: ${body.error || '取得失敗'}`);
    }
    return Array.isArray(body.backups) ? body.backups : [];
  }

  async function cloudFetchJson(item, token = state.cloudToken) {
    if (!item?.id || !item?.sha256) throw new Error('pCloudバックアップ情報が不正です。');
    const res = await gmRequest({
      method: 'GET',
      url: `${CLOUD_URL}/v1/backups/${encodeURIComponent(item.id)}`,
      headers: { authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 45000,
    });
    if (res.status !== 200) throw new Error(`pCloud読込 HTTP ${res.status}`);
    const raw =
      res.response instanceof ArrayBuffer
        ? new Uint8Array(res.response)
        : ArrayBuffer.isView(res.response)
          ? new Uint8Array(res.response.buffer, res.response.byteOffset, res.response.byteLength)
          : new TextEncoder().encode(res.responseText || String(res.response || ''));
    if (Number(item.size || 0) && raw.byteLength !== Number(item.size)) {
      throw new Error('pCloudバックアップのサイズが一致しません。');
    }
    if (await cloudSha(raw) !== item.sha256) {
      throw new Error('pCloudバックアップのSHA-256が一致しません。');
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      throw new Error('pCloudバックアップJSONが不正です。');
    }
  }

  async function cloudWriteJson(device, payload, token = state.cloudToken) {
    const textPayload = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(textPayload);
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('pCloud保存データが20MBを超えています。');
    const sha = await cloudSha(bytes);
    const res = await gmRequest({
      method: 'POST',
      url: `${CLOUD_URL}/v1/backups`,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
        'x-nrh-device': device,
        'x-nrh-origin': location.origin,
        'x-nrh-sha256': sha,
        'x-nrh-version': VERSION,
      },
      data: textPayload,
      responseType: 'text',
      timeout: 60000,
    });
    let body = {};
    try { body = JSON.parse(res.responseText || res.response || '{}'); }
    catch { throw new Error('pCloud保存応答を読み取れません。'); }
    if (res.status < 200 || res.status >= 300 || !body.ok) {
      throw new Error(`pCloud保存 HTTP ${res.status}: ${body.error || '保存失敗'}`);
    }
    return body;
  }

  async function cloudLoadArchiveManifest(token = state.cloudToken) {
    try {
      const list = await cloudListDevice(CHAT_MANIFEST_DEVICE, token);
      if (!list.length) return [];
      const data = await cloudFetchJson(list[0], token);
      const manifest = data?.preferences?.chatArchiveManifest;
      if (Number(manifest?.schemaVersion) !== 1 || !Array.isArray(manifest?.entries)) return [];
      return manifest.entries.filter((x) => x && typeof x.videoId === 'string' && x.videoId);
    } catch (e) {
      console.warn('[Member Chat Search] manifest load failed', e);
      return [];
    }
  }

  async function cloudWriteArchiveManifest(entries, token = state.cloudToken) {
    if (!token) return false;
    const clean = [];
    const seen = new Set();
    for (const row of Array.isArray(entries) ? entries : []) {
      const videoId = String(row?.videoId || '');
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);
      clean.push({
        videoId,
        title: String(row?.title || ''),
        channel: String(row?.channel || ''),
        count: Math.max(0, Number(row?.count || 0)),
        memberOnly: row?.memberOnly === true ? true : row?.memberOnly === false ? false : null,
        publishedAt: String(row?.publishedAt || ''),
        backupId: String(row?.backupId || ''),
        backupSha: String(row?.backupSha || ''),
        backupSize: Math.max(0, Number(row?.backupSize || 0)),
        backupCreatedAt: String(row?.backupCreatedAt || ''),
        updatedAt: Number(row?.updatedAt || Date.now()),
      });
    }
    const payload = {
      app: 'Niji Research Helper',
      version: VERSION,
      dbVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceOrigin: location.origin,
      device: CHAT_MANIFEST_DEVICE,
      stores: { videos: [], channels: [], wiki: [], pairs: [] },
      preferences: {
        chatArchiveManifest: {
          app: 'YouTube Member Chat Search',
          schemaVersion: 1,
          entries: clean,
        },
      },
    };
    await cloudWriteJson(CHAT_MANIFEST_DEVICE, payload, token);
    return true;
  }

  async function cloudUpsertArchiveManifest(chat, item) {
    if (!state.cloudToken || !chat?.videoId || !item?.id) return;
    try {
      const entries = await cloudLoadArchiveManifest();
      const map = new Map(entries.map((x) => [x.videoId, x]));
      map.set(chat.videoId, {
        ...(map.get(chat.videoId) || {}),
        videoId: chat.videoId,
        title: chat.title || '',
        channel: chat.channel || '',
        count: Array.isArray(chat.messages) ? chat.messages.length : Number(chat.count || 0),
        memberOnly: chat.memberOnly === true ? true : chat.memberOnly === false ? false : null,
        publishedAt: String(chat.publishedAt || ''),
        backupId: String(item.id || ''),
        backupSha: String(item.sha256 || ''),
        backupSize: Number(item.size || 0),
        backupCreatedAt: String(item.createdAt || ''),
        updatedAt: Date.now(),
      });
      await cloudWriteArchiveManifest([...map.values()]);
    } catch (e) {
      console.warn('[Member Chat Search] manifest update failed', e);
    }
  }

  function publishedAtFromPlayerResponse(player) {
    const micro = player?.microformat?.playerMicroformatRenderer || {};
    return String(
      micro?.liveBroadcastDetails?.startTimestamp ||
      micro?.publishDate ||
      micro?.uploadDate ||
      ''
    ).trim();
  }

  function currentVideoMetadata(videoId) {
    let title = '';
    let channel = '';
    let publishedAt = '';
    try {
      title =
        document.querySelector('h1 yt-formatted-string')?.textContent?.trim() ||
        document.querySelector('h1')?.textContent?.trim() ||
        document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
      channel =
        document.querySelector('ytd-channel-name a')?.textContent?.trim() ||
        document.querySelector('#owner-name a')?.textContent?.trim() ||
        '';
      let page = window;
      if (typeof unsafeWindow !== 'undefined') page = unsafeWindow;
      publishedAt = publishedAtFromPlayerResponse(page?.ytInitialPlayerResponse);
      publishedAt ||= document.querySelector('meta[itemprop="datePublished"]')?.content || '';
      publishedAt ||= document.querySelector('meta[itemprop="uploadDate"]')?.content || '';
    } catch { /* ignore */ }

    return { videoId, title, channel, publishedAt: String(publishedAt || '').trim() };
  }

  function archiveDateLabel(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '日付不明';
    const ymd = raw.match(/^(20\d{2})-(\d{2})-(\d{2})/);
    if (ymd) return `${ymd[1]}/${ymd[2]}/${ymd[3]}`;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '日付不明';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  }

  function memberOnlyFromInitialData(initialData) {
    if (!initialData || typeof initialData !== 'object') return null;
    const primaryRows = deepFindValues(initialData, 'videoPrimaryInfoRenderer', 12);
    if (!primaryRows.length) return null;

    for (const primary of primaryRows) {
      const badges = Array.isArray(primary?.badges) ? primary.badges : [];
      for (const badge of badges) {
        let raw = '';
        try { raw = JSON.stringify(badge); } catch { raw = String(badge || ''); }
        if (
          /BADGE_STYLE_TYPE_MEMBERS_ONLY/i.test(raw) ||
          /"label"\s*:\s*"Members only"/i.test(raw) ||
          /"label"\s*:\s*"メンバー限定"/i.test(raw)
        ) return true;
      }
    }
    return false;
  }

  function memberOnlyFromDom(videoId) {
    if (!videoId || getVideoId() !== videoId) return null;
    try {
      const hit = document.querySelector(
        'ytd-watch-metadata .badge-style-type-members-only,' +
        ' ytd-video-primary-info-renderer .badge-style-type-members-only,' +
        ' #above-the-fold .badge-style-type-members-only,' +
        ' ytm-slim-video-metadata-section .badge-style-type-members-only'
      );
      if (hit) return true;
    } catch { /* ignore */ }
    return null;
  }

  async function inspectVideoArchiveFacts(videoId, { allowDom = true } = {}) {
    if (!videoId) return { memberOnly: null, publishedAt: '' };

    let memberOnly = null;
    let publishedAt = '';

    if (allowDom) {
      const dom = memberOnlyFromDom(videoId);
      if (dom === true) memberOnly = true;

      try {
        let page = window;
        if (typeof unsafeWindow !== 'undefined') page = unsafeWindow;
        const pageResult = memberOnlyFromInitialData(page?.ytInitialData);
        if (pageResult === true) memberOnly = true;
        publishedAt = publishedAtFromPlayerResponse(page?.ytInitialPlayerResponse) || '';
        publishedAt ||= document.querySelector('meta[itemprop="datePublished"]')?.content || '';
        publishedAt ||= document.querySelector('meta[itemprop="uploadDate"]')?.content || '';
      } catch { /* ignore */ }
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      const desktop = await fetchDesktopWatchDataViaGM(videoId, controller.signal);
      clearTimeout(timer);
      const freshMember = memberOnlyFromInitialData(desktop?.initialData);
      if (freshMember !== null) memberOnly = freshMember;
      publishedAt ||= String(desktop?.publishedAt || '').trim();
    } catch (e) {
      if (e?.name !== 'AbortError') console.warn('[Member Chat Search] archive facts detection failed', videoId, e);
    }

    return { memberOnly, publishedAt: String(publishedAt || '').trim() };
  }

  async function detectMemberOnlyVideo(videoId, options = {}) {
    return (await inspectVideoArchiveFacts(videoId, options)).memberOnly;
  }

  function cloudPayload(videoId, messages) {
    const meta = currentVideoMetadata(videoId);
    const device = cloudDevice(videoId);
    const origin = location.origin;

    // 既存Niji backup gatewayはNiji Research Helper形式だけを受け付ける。
    // チャット本体はpreferences.chatArchiveに隔離し、NRHのDB storesは空配列で満たす。
    return {
      app: 'Niji Research Helper',
      version: VERSION,
      dbVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceOrigin: origin,
      device,
      stores: {
        videos: [],
        channels: [],
        wiki: [],
        pairs: [],
      },
      preferences: {
        chatArchive: {
          app: 'YouTube Member Chat Search',
          schemaVersion: CLOUD_SCHEMA_VERSION,
          videoId,
          title: meta.title,
          channel: meta.channel,
          chatMode: 'all-v2',
          completed: true,
          memberOnly: state.memberOnly === true ? true : state.memberOnly === false ? false : null,
          publishedAt: meta.publishedAt || '',
          count: messages.length,
          messages,
        },
      },
    };
  }

  async function cloudUploadCompleted(videoId, messages, { silent = false } = {}) {
    if (!state.cloudEnabled || !state.cloudToken || !videoId || !messages?.length) return null;

    // ページ読込時の自動保存と手動「再保存」が重なったら、同じ保存処理を共有する。
    if (state.cloudUploadPromise) {
      if (!silent) cloudUiStatus('☁️ すでに保存中です。完了を待っています…');
      try {
        return await state.cloudUploadPromise;
      } catch (e) {
        console.warn('[Member Chat Search] shared cloud upload failed', e);
        return null;
      }
    }

    // 読込・一覧確認など別のpCloud処理は保存をブロックしない。
    // 保存同士だけは上の cloudUploadPromise で一本化する。
    const task = (async () => {
      state.cloudBusy = true;
      updateCloudUi();
      if (!silent) cloudUiStatus('☁️ pCloudへ保存中…');
      try {
        const payload = cloudPayload(videoId, messages);
        const textPayload = JSON.stringify(payload);
        const bytes = new TextEncoder().encode(textPayload);
        if (bytes.byteLength > 20 * 1024 * 1024) {
          throw new Error('チャット保存データが20MBを超えています。');
        }
        const sha = await cloudSha(bytes);

        const res = await gmRequest({
          method: 'POST',
          url: `${CLOUD_URL}/v1/backups`,
          headers: {
            authorization: `Bearer ${state.cloudToken}`,
            accept: 'application/json',
            'content-type': 'application/json',
            'x-nrh-device': cloudDevice(videoId),
            'x-nrh-origin': location.origin,
            'x-nrh-sha256': sha,
            'x-nrh-version': VERSION,
          },
          data: textPayload,
          responseType: 'text',
          timeout: 90000,
        });

        let body = {};
        try { body = JSON.parse(res.responseText || res.response || '{}'); }
        catch { throw new Error('pCloud保存応答を読み取れません。'); }

        if (res.status < 200 || res.status >= 300 || !body.ok) {
          throw new Error(`pCloud保存 HTTP ${res.status}: ${body.error || '保存失敗'}`);
        }

        const list = await cloudList(videoId);
        const match =
          (body.backup?.id ? list.find((x) => x.id === body.backup.id) : null) ||
          list.find((x) => x.sha256 === sha && Number(x.size || 0) === bytes.byteLength);

        if (!match) throw new Error('pCloud保存後の世代確認に失敗しました。');

        const verify = await cloudFetchBackup(match, videoId);
        if (verify.count !== messages.length) {
          throw new Error('pCloud保存後の件数照合に失敗しました。');
        }

        state.cloudLastBackupId = String(match.id || '');
        state.cloudLastError = '';
        cloudUiStatus(`☁️ pCloud保存済み：${messages.length.toLocaleString()}件`);
        try {
          await writeArchiveIndexFromChat(verify, match);
        } catch (e) {
          console.warn('[Member Chat Search] cross index local write failed', e);
        }
        void cloudUpsertArchiveManifest(verify, match);
        return match;
      } catch (e) {
        const msg = `⚠️ pCloud保存失敗：${String(e?.message || e).slice(0, 120)} [${cloudDevice(videoId)}]`;
        cloudUiStatus(msg, true);
        console.warn('[Member Chat Search] cloud upload failed', e);
        return null;
      } finally {
        state.cloudBusy = false;
        updateCloudUi();
      }
    })();

    state.cloudUploadPromise = task;
    try {
      return await task;
    } finally {
      if (state.cloudUploadPromise === task) state.cloudUploadPromise = null;
    }
  }

  async function cloudRestoreLatest(videoId, { silent = false } = {}) {
    // true = 復元成功 / false = pCloudに保存なしを確認 / null = 確認失敗
    // 「確認失敗」を保存なし扱いにすると、既存バックアップがあるのにYouTube再取得が始まるため区別する。
    if (!state.cloudEnabled || !state.cloudToken || !videoId) return null;

    // 直前の動画をpCloudへ保存中なら、その保存が終わるのを待ってから確認する。
    // 読み込み確認を飛ばしてYouTube再取得へ進ませない。
    if (state.cloudUploadPromise) {
      if (!silent) cloudUiStatus('☁️ 保存処理の完了を待ってpCloudを確認中…');
      try {
        await withTimeout(state.cloudUploadPromise, 120000, '直前のpCloud保存待ち');
      } catch (e) {
        console.warn('[Member Chat Search] prior cloud upload wait failed', e);
      }
    }

    if (!silent) cloudUiStatus('☁️ pCloud保存済みデータを確認中…');

    try {
      let list = await cloudList(videoId);

      // 端末別一覧で見つからない場合、全体一覧からvideoIdを復元して再探索する。
      // Worker側の一覧差異や旧世代の保存を取りこぼさないためのフォールバック。
      if (!list.length) {
        try {
          const all = await cloudListAll();
          list = all
            .filter((item) => videoIdFromCloudDevice(item?.device) === videoId)
            .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
        } catch (e) {
          console.warn('[Member Chat Search] cloud all-list fallback failed', e);
        }
      }

      // v0.4.0以降のマニフェストにも登録があれば、直接バックアップIDを使って救済する。
      if (!list.length) {
        try {
          const manifest = await cloudLoadArchiveManifest();
          const entry = manifest.find((x) => x?.videoId === videoId);
          if (entry?.backupId && entry?.backupSha) {
            list = [{
              id: String(entry.backupId),
              sha256: String(entry.backupSha),
              size: Number(entry.backupSize || 0),
              createdAt: String(entry.backupCreatedAt || ''),
              device: cloudDevice(videoId),
              origin: location.origin,
            }];
          }
        } catch (e) {
          console.warn('[Member Chat Search] cloud manifest fallback failed', e);
        }
      }

      if (!list.length) {
        cloudUiStatus('☁️ この動画のpCloud保存データはありません。');
        return false;
      }

      let lastError = null;
      for (const item of list.slice(0, 8)) {
        try {
          const data = await cloudFetchBackup(item, videoId);
          let memberOnly = data?.memberOnly === true ? true : data?.memberOnly === false ? false : null;
          let publishedAt = String(data?.publishedAt || '').trim();
          if (memberOnly === null || !publishedAt) {
            const facts = await inspectVideoArchiveFacts(videoId);
            if (memberOnly === null) memberOnly = facts.memberOnly;
            publishedAt ||= facts.publishedAt;
            data.memberOnly = memberOnly;
            data.publishedAt = publishedAt;
          }
          const record = {
            videoId,
            version: VERSION,
            chatMode: 'all-v2',
            memberOnly,
            messages: data.messages,
            workers: [],
            completed: true,
            inProgress: false,
            fastMode: true,
            updatedAt: Date.parse(data.exportedAt || '') || Date.now(),
            requestCount: 0,
            cloudBackupId: String(item.id || ''),
          };

          // pCloudからの読込自体が成功した時点で、その場で検索可能にする。
          // IndexedDBへのローカル保存は重い端末・大量コメントだと数秒以上かかるため、
          // 復元成功の必須条件にはしない。
          state.cacheRecord = record;
          state.cacheCompleted = true;
          state.memberOnly = memberOnly;
          state.messageMap = new Map();
          for (const msg of record.messages) {
            const key = msg.id || `${msg.offsetMs}|${msg.author}|${msg.message}`;
            state.messageMap.set(key, msg);
          }
          state.messages = currentMessagesSorted();
          state.workerProgress = [];
          state.loadedVideoId = videoId;
          state.cloudLastBackupId = String(item.id || '');
          state.cloudLastError = '';

          status(`☁️ pCloudから読込：${state.messages.length.toLocaleString()}件（YouTube再取得なし）`);
          setLoadButton('再取得', false);
          renderSearchResults();
          cloudUiStatus(`☁️ pCloudから読込済み：${state.messages.length.toLocaleString()}件`);
          updateCloudUi();

          // ローカルキャッシュと横断検索DBへの書き込みはバックグラウンドで行う。
          // 失敗してもpCloud読込済みデータはそのまま利用できる。
          void withTimeout(writeCache(record), 60000, 'pCloud復元データのローカル保存')
            .catch((e) => console.warn('[Member Chat Search] cloud restore local cache write skipped', e));
          void withTimeout(writeArchiveIndexFromChat(data, item), 60000, '横断検索DBへの保存')
            .catch((e) => console.warn('[Member Chat Search] cross index restore write skipped', e));
          if (typeof memberOnly === 'boolean') void cloudUpsertArchiveManifest(data, item);

          return true;
        } catch (e) {
          lastError = e;
          console.warn('[Member Chat Search] cloud generation skipped', item?.id, e);
        }
      }

      // バックアップ一覧には存在するのに読み込めない場合は「保存なし」ではない。
      // 自動再取得せず、ユーザーにエラーを見せる。
      const detail = String(lastError?.message || lastError || '保存済みデータを読み込めませんでした').slice(0, 120);
      cloudUiStatus(`⚠️ pCloud保存データは見つかりましたが読込失敗：${detail}`, true);
      return null;
    } catch (e) {
      const msg = `⚠️ pCloud確認失敗：${String(e?.message || e).slice(0, 120)}`;
      cloudUiStatus(msg, true);
      console.warn('[Member Chat Search] cloud restore failed', e);
      return null;
    } finally {
      updateCloudUi();
    }
  }

  async function initializeCloudConfig() {
    const cfg = await gmGetValue(CLOUD_CONFIG_KEY, { enabled: false, token: '' });
    state.cloudEnabled = cfg?.enabled === true && typeof cfg?.token === 'string' && cfg.token.trim().length >= 24;
    state.cloudToken = state.cloudEnabled ? cfg.token.trim() : '';
    state.cloudStatus = state.cloudEnabled ? '☁️ pCloud接続済み' : '未接続';
    state.cloudLastError = '';
    updateCloudUi();
  }

  async function connectCloudFromUi() {
    const input = document.querySelector(`#${PANEL_ID} .mcs-cloud-token`);
    const token = String(input?.value || '').trim();
    if (token.length < 24) {
      cloudUiStatus('⚠️ バックアップ専用トークンを入力してください。', true);
      return;
    }

    let connected = false;
    state.cloudBusy = true;
    updateCloudUi();
    cloudUiStatus('☁️ pCloud接続を確認中…');

    try {
      const res = await gmRequest({
        method: 'GET',
        url: `${CLOUD_URL}/v1/status`,
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        responseType: 'text',
        timeout: 45000,
      });
      let body = {};
      try { body = JSON.parse(res.responseText || res.response || '{}'); } catch {}
      if (res.status < 200 || res.status >= 300 || !body.connected || !body.remoteOk) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      state.cloudEnabled = true;
      state.cloudToken = token;
      state.cloudLastError = '';
      state.cloudStatus = '☁️ pCloud接続済み';
      await gmSetValue(CLOUD_CONFIG_KEY, { enabled: true, token });
      if (input) input.value = '';
      connected = true;
    } catch (e) {
      state.cloudEnabled = false;
      state.cloudToken = '';
      cloudUiStatus(`⚠️ pCloud接続失敗：${String(e?.message || e).slice(0, 120)}`, true);
    } finally {
      state.cloudBusy = false;
      updateCloudUi();
    }

    if (!connected) return;

    // 接続確認ロックを外してから、保存/復元処理を開始する。
    const videoId = getVideoId();
    if (videoId && state.cacheCompleted && state.messages.length) {
      await cloudUploadCompleted(videoId, state.messages);
    } else if (videoId) {
      void initializeVideoStorage(videoId, { forceCloudCheck: true });
    }
  }

  async function disconnectCloud() {
    state.cloudEnabled = false;
    state.cloudToken = '';
    state.cloudLastBackupId = '';
    state.cloudLastError = '';
    state.cloudStatus = '未接続';
    await gmSetValue(CLOUD_CONFIG_KEY, { enabled: false, token: '' });
    updateCloudUi();
  }

  function openCacheDb() {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise((resolve, reject) => {
      // 既存の動画キャッシュDBはバージョンを上げない。
      // 他のYouTubeタブが旧版DBを開いたままでも取得開始をブロックしないため。
      const req = indexedDB.open(CACHE_DB_NAME);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'videoId' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => {
        cacheDbPromise = null;
        reject(req.error || new Error('キャッシュDBを開けませんでした。'));
      };
      req.onblocked = () => {
        cacheDbPromise = null;
        reject(new Error('キャッシュDBが別タブで使用中です。YouTubeの古いタブを再読み込みしてください。'));
      };
    });
    return cacheDbPromise;
  }

  function openArchiveDb() {
    if (archiveDbPromise) return archiveDbPromise;
    archiveDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ARCHIVE_STORE)) {
          db.createObjectStore(ARCHIVE_STORE, { keyPath: 'videoId' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => {
        archiveDbPromise = null;
        reject(req.error || new Error('横断検索DBを開けませんでした。'));
      };
      req.onblocked = () => {
        archiveDbPromise = null;
        reject(new Error('横断検索DBが別タブで使用中です。'));
      };
    });
    return archiveDbPromise;
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


  async function readArchiveIndex(videoId) {
    if (!videoId || typeof indexedDB === 'undefined') return null;
    const db = await openArchiveDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ARCHIVE_STORE, 'readonly');
      const req = tx.objectStore(ARCHIVE_STORE).get(videoId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('横断検索DBを読み込めませんでした。'));
    });
  }

  async function writeArchiveIndexFromChat(chat, item = null) {
    if (!chat?.videoId || !Array.isArray(chat?.messages) || typeof indexedDB === 'undefined') return;
    const db = await openArchiveDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ARCHIVE_STORE, 'readwrite');
      const store = tx.objectStore(ARCHIVE_STORE);
      const get = store.get(chat.videoId);
      get.onsuccess = () => {
        const prev = get.result || {};
        store.put({
          ...prev,
          videoId: chat.videoId,
          title: String(chat.title || prev.title || ''),
          channel: String(chat.channel || prev.channel || ''),
          count: chat.messages.length,
          messages: chat.messages,
          memberOnly: chat.memberOnly === true
            ? true
            : chat.memberOnly === false
              ? false
              : (prev.memberOnly === true ? true : prev.memberOnly === false ? false : null),
          publishedAt: String(chat.publishedAt || prev.publishedAt || ''),
          exportedAt: String(chat.exportedAt || prev.exportedAt || ''),
          backupId: item?.id ? String(item.id) : String(prev.backupId || ''),
          backupSha: item?.sha256 ? String(item.sha256) : String(prev.backupSha || ''),
          backupSize: item?.size ? Number(item.size) : Number(prev.backupSize || 0),
          backupCreatedAt: item?.createdAt ? String(item.createdAt) : String(prev.backupCreatedAt || ''),
          updatedAt: Date.now(),
        });
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('横断検索DBの保存に失敗しました。'));
      tx.onabort = () => reject(tx.error || new Error('横断検索DBの保存が中断されました。'));
    });
    void updateCrossStats();
  }

  async function archiveIndexStats() {
    if (typeof indexedDB === 'undefined') return { archives: 0, messages: 0 };
    const db = await openArchiveDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ARCHIVE_STORE, 'readonly');
      const store = tx.objectStore(ARCHIVE_STORE);
      let archives = 0;
      let messages = 0;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve({ archives, messages });
          return;
        }
        if (cursor.value?.memberOnly === true) {
          archives++;
          messages += Number(cursor.value?.count || cursor.value?.messages?.length || 0);
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error || new Error('横断検索DBの集計に失敗しました。'));
    });
  }

  async function updateCrossStats(note = '') {
    const el = document.querySelector(`#${PANEL_ID} .mcs-cross-status`);
    if (!el) return;
    try {
      const stats = await archiveIndexStats();
      el.textContent = note || `メン限横断DB：${stats.archives.toLocaleString()}本 / ${stats.messages.toLocaleString()}コメント`;
    } catch (e) {
      el.textContent = `横断DB確認失敗：${String(e?.message || e).slice(0, 100)}`;
    }
  }

  async function searchArchiveIndex(raw, limit = CROSS_RESULT_LIMIT) {
    const q = String(raw || '').trim();
    if (!q) return { matches: [], truncated: false };
    const db = await openArchiveDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ARCHIVE_STORE, 'readonly');
      const store = tx.objectStore(ARCHIVE_STORE);
      const req = store.openCursor();
      const matches = [];
      let finished = false;
      const finish = (truncated = false) => {
        if (finished) return;
        finished = true;
        resolve({ matches, truncated });
      };
      req.onsuccess = () => {
        if (finished) return;
        const cursor = req.result;
        if (!cursor) {
          finish(false);
          return;
        }
        const archive = cursor.value || {};
        if (archive.memberOnly !== true) {
          cursor.continue();
          return;
        }
        for (const msg of Array.isArray(archive.messages) ? archive.messages : []) {
          if (!matchesQuery(msg, q)) continue;
          matches.push({
            videoId: archive.videoId,
            title: archive.title || archive.videoId,
            channel: archive.channel || '',
            publishedAt: archive.publishedAt || '',
            archiveCreatedAt: archive.backupCreatedAt || archive.exportedAt || '',
            msg,
          });
          if (matches.length >= limit) {
            finish(true);
            return;
          }
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error || new Error('横断検索に失敗しました。'));
    });
  }

  function archiveTimestampUrl(videoId, seconds) {
    const u = new URL('/watch', location.origin);
    u.searchParams.set('v', videoId);
    u.searchParams.set('t', `${Math.max(0, Math.floor(Number(seconds) || 0))}s`);
    return u.href;
  }

  function openArchiveTimestamp(videoId, seconds) {
    if (getVideoId() === videoId) {
      seekTo(seconds);
      return;
    }
    location.assign(archiveTimestampUrl(videoId, seconds));
  }

  async function cloudSyncArchiveIndex() {
    if (state.crossSyncBusy) return;
    if (!state.cloudEnabled || !state.cloudToken) {
      await updateCrossStats('pCloudに接続してから横断DBを同期してください。');
      return;
    }
    state.crossSyncBusy = true;
    updateCloudUi();
    const syncBtn = document.querySelector(`#${PANEL_ID} .mcs-cross-sync`);
    if (syncBtn) syncBtn.textContent = '同期中…';
    try {
      await updateCrossStats('pCloudのアーカイブ一覧を確認中…');

      const manifestEntries = await cloudLoadArchiveManifest();
      const manifestMap = new Map(manifestEntries.map((x) => [x.videoId, { ...x }]));

      const all = await cloudListAll();
      const newestByVideo = new Map();
      for (const item of all) {
        if (!isChatArchiveDevice(item?.device)) continue;
        const videoId = videoIdFromCloudDevice(item.device);
        const prev = newestByVideo.get(videoId);
        if (!prev || Date.parse(item.createdAt || 0) > Date.parse(prev.createdAt || 0)) {
          newestByVideo.set(videoId, item);
        }
      }

      for (const [videoId, item] of newestByVideo) {
        const old = manifestMap.get(videoId) || {};
        manifestMap.set(videoId, {
          ...old,
          videoId,
          backupId: item.id || old.backupId || '',
          backupSha: item.sha256 || old.backupSha || '',
          backupSize: Number(item.size || old.backupSize || 0),
          backupCreatedAt: item.createdAt || old.backupCreatedAt || '',
          memberOnly: old.memberOnly === true ? true : old.memberOnly === false ? false : null,
          publishedAt: String(old.publishedAt || ''),
        });
      }

      const entries = [...manifestMap.values()];
      if (!entries.length) {
        await updateCrossStats('pCloudに保存済みのメン限チャットが見つかりませんでした。');
        return;
      }

      let done = 0;
      let downloaded = 0;
      let skipped = 0;
      let failed = 0;
      let memberOnlyCount = 0;
      let publicCount = 0;
      let unknownCount = 0;
      let nextIndex = 0;

      const worker = async () => {
        while (true) {
          const index = nextIndex++;
          if (index >= entries.length) return;
          const entry = entries[index];
          const videoId = entry.videoId;
          try {
            const local = await readArchiveIndex(videoId);
            let item = null;

            const direct = newestByVideo.get(videoId);
            if (direct) {
              item = direct;
            } else if (entry.backupId && entry.backupSha) {
              item = {
                id: entry.backupId,
                sha256: entry.backupSha,
                size: Number(entry.backupSize || 0),
                createdAt: entry.backupCreatedAt || '',
                device: cloudDevice(videoId),
              };
            }

            const localClass = local?.memberOnly === true ? true : local?.memberOnly === false ? false : null;
            const manifestClass = entry?.memberOnly === true ? true : entry?.memberOnly === false ? false : null;

            if (
              item?.sha256 &&
              local?.backupSha === item.sha256 &&
              Array.isArray(local.messages) &&
              local.messages.length &&
              localClass !== null
            ) {
              entry.memberOnly = localClass;
              entry.publishedAt = String(local?.publishedAt || entry?.publishedAt || '');
              if (!entry.publishedAt) {
                const facts = await inspectVideoArchiveFacts(videoId, { allowDom: false });
                entry.publishedAt = facts.publishedAt || '';
                if (entry.publishedAt) {
                  await writeArchiveIndexFromChat({
                    ...local,
                    videoId,
                    memberOnly: localClass,
                    publishedAt: entry.publishedAt,
                    messages: local.messages,
                  }, item);
                }
              }
              if (localClass) memberOnlyCount++;
              else publicCount++;
              skipped++;
            } else {
              let chat = null;
              let usedItem = item;
              if (usedItem) {
                try { chat = await cloudFetchBackup(usedItem, videoId); }
                catch { chat = null; }
              }
              if (!chat) {
                const list = await cloudList(videoId);
                usedItem = list[0] || null;
                if (!usedItem) throw new Error('pCloudバックアップが見つかりません');
                chat = await cloudFetchBackup(usedItem, videoId);
              }

              let memberOnly = chat?.memberOnly === true ? true : chat?.memberOnly === false ? false : manifestClass;
              let publishedAt = String(chat?.publishedAt || entry?.publishedAt || '').trim();
              if (memberOnly === null || !publishedAt) {
                const facts = await inspectVideoArchiveFacts(videoId, { allowDom: false });
                if (memberOnly === null) memberOnly = facts.memberOnly;
                publishedAt ||= facts.publishedAt;
              }
              chat.memberOnly = memberOnly;
              chat.publishedAt = publishedAt;

              await writeArchiveIndexFromChat(chat, usedItem);
              entry.title = chat.title || entry.title || '';
              entry.channel = chat.channel || entry.channel || '';
              entry.count = chat.messages.length;
              entry.memberOnly = memberOnly;
              entry.publishedAt = publishedAt;
              entry.backupId = String(usedItem.id || '');
              entry.backupSha = String(usedItem.sha256 || '');
              entry.backupSize = Number(usedItem.size || 0);
              entry.backupCreatedAt = String(usedItem.createdAt || '');
              entry.updatedAt = Date.now();

              if (memberOnly === true) memberOnlyCount++;
              else if (memberOnly === false) publicCount++;
              else unknownCount++;
              downloaded++;
            }
          } catch (e) {
            failed++;
            console.warn('[Member Chat Search] cross archive sync skipped', videoId, e);
          } finally {
            done++;
            await updateCrossStats(
              `メン限横断DB同期中：${done}/${entries.length}本（メン限${memberOnlyCount} / 通常${publicCount} / 判定不明${unknownCount} / 失敗${failed}）`
            );
          }
        }
      };

      await Promise.all([worker(), worker(), worker()]);

      try { await cloudWriteArchiveManifest(entries); }
      catch (e) { console.warn('[Member Chat Search] manifest backfill failed', e); }

      const stats = await archiveIndexStats();
      await updateCrossStats(
        `同期完了：メン限 ${stats.archives.toLocaleString()}本 / ${stats.messages.toLocaleString()}コメント（通常公開${publicCount}本は横断検索から除外・判定不明${unknownCount}・失敗${failed}）`
      );
      if (state.searchScope === 'global') scheduleCrossSearchRender(true);
    } catch (e) {
      await updateCrossStats(`横断DB同期失敗：${String(e?.message || e).slice(0, 120)}`);
    } finally {
      state.crossSyncBusy = false;
      if (syncBtn) syncBtn.textContent = '☁️ メン限横断DB同期';
      updateCloudUi();
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
        chatMode: 'all-v2',
        memberOnly: state.memberOnly === true ? true : state.memberOnly === false ? false : null,
        messages,
        workers: Array.isArray(state.workerProgress) ? state.workerProgress.map((w) => ({ ...w })) : [],
        completed: Boolean(completed),
        inProgress: Boolean(inProgress),
        fastMode: state.workerProgress.length > 1,
        updatedAt: Date.now(),
        requestCount: state.requestCount,
      };
      await withTimeout(writeCache(record), 4000, 'ローカルキャッシュ保存');
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
    let record = null;
    try {
      record = await withTimeout(readCache(videoId), 3000, 'ローカルキャッシュ確認');
    } catch (e) {
      console.warn('[Member Chat Search] cache restore skipped', e);
      record = null;
    }
    if (getVideoId() !== videoId) return;

    // v0.1.xまでの保存データはTop Chat由来の可能性があるため再利用しない。
    if (record && record.chatMode !== 'all-v2') {
      await deleteCache(videoId);
      record = null;
    }

    state.cacheRecord = record;
    state.cacheCompleted = Boolean(record?.completed);
    state.memberOnly = record?.memberOnly === true ? true : record?.memberOnly === false ? false : state.memberOnly;
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

  function extractAllChatContinuationFromReplayResponse(response) {
    const liveCont = response?.continuationContents?.liveChatContinuation;
    const submenu = liveCont?.header?.liveChatHeaderRenderer?.viewSelector
      ?.sortFilterSubMenuRenderer?.subMenuItems;

    if (!Array.isArray(submenu) || !submenu.length) return null;

    const labelOf = (item) =>
      [
        textOf(item?.title),
        textOf(item?.label),
        String(item?.title || ''),
        String(item?.label || ''),
      ].filter(Boolean).join(' ');

    // selected:false かつTop Chatではない項目を優先。
    const allItem =
      submenu.find((item) => {
        if (item?.selected) return false;
        const data = item?.continuation?.reloadContinuationData;
        if (!data?.continuation) return false;
        const label = labelOf(item);
        return !/top|上位/i.test(label);
      }) ||
      submenu.find((item) =>
        !item?.selected && item?.continuation?.reloadContinuationData?.continuation
      );

    const data = allItem?.continuation?.reloadContinuationData;
    return data?.continuation
      ? { ...data, source: 'replay-response.header:all' }
      : null;
  }

  function extractAllChatContinuationFromPbj(pbj) {
    const renderers = [];

    const known = [
      pbj?.response?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer,
      pbj?.response?.contents?.singleColumnWatchNextResults?.conversationBar?.liveChatRenderer,
      Array.isArray(pbj)
        ? pbj?.[3]?.response?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer
        : null,
      Array.isArray(pbj)
        ? pbj?.[3]?.response?.contents?.singleColumnWatchNextResults?.conversationBar?.liveChatRenderer
        : null,
    ].filter(Boolean);

    renderers.push(...known);

    for (const renderer of deepFindValues(pbj, 'liveChatRenderer')) {
      if (renderer && typeof renderer === 'object') renderers.push(renderer);
    }

    const seen = new Set();
    for (const renderer of renderers) {
      if (!renderer || seen.has(renderer)) continue;
      seen.add(renderer);

      const submenu = renderer?.header?.liveChatHeaderRenderer?.viewSelector
        ?.sortFilterSubMenuRenderer?.subMenuItems;

      if (!Array.isArray(submenu) || !submenu.length) continue;

      const withToken = submenu.filter((item) =>
        item?.continuation?.reloadContinuationData?.continuation
      );

      // YCSの旧API実装と同じく、全チャットは通常subMenuItems[1]。
      const indexOne = submenu?.[1]?.continuation?.reloadContinuationData;
      if (indexOne?.continuation) {
        return { ...indexOne, source: 'pbj.header:all:index1' };
      }

      const labelOf = (item) =>
        [
          textOf(item?.title),
          textOf(item?.label),
          String(item?.title || ''),
          String(item?.label || ''),
        ].filter(Boolean).join(' ');

      const allItem = withToken.find((item) => {
        const label = labelOf(item);
        return !/top|上位/i.test(label) &&
          /live chat|チャットのリプレイ|すべて|all/i.test(label);
      });

      const data = allItem?.continuation?.reloadContinuationData;
      if (data?.continuation) return { ...data, source: 'pbj.header:all:label' };
    }

    return null;
  }

  function extractInitialContinuation(initialData) {
    const candidates = [
      initialData?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer,
      initialData?.response?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer,
      initialData?.contents?.singleColumnWatchNextResults?.conversationBar?.liveChatRenderer,
      initialData?.response?.contents?.singleColumnWatchNextResults?.conversationBar?.liveChatRenderer,
    ].filter(Boolean);

    for (const renderer of deepFindValues(initialData, 'liveChatRenderer')) {
      if (renderer && typeof renderer === 'object') candidates.push(renderer);
    }

    const seen = new Set();
    for (const renderer of candidates) {
      if (!renderer || seen.has(renderer)) continue;
      seen.add(renderer);

      // まずヘッダーの表示切替から「全チャット」を明示的に選ぶ。
      // 「上位のチャットのリプレイ」はYouTube側で一部メッセージがフィルタされるため使わない。
      const submenu = renderer?.header?.liveChatHeaderRenderer?.viewSelector
        ?.sortFilterSubMenuRenderer?.subMenuItems;

      if (Array.isArray(submenu) && submenu.length) {
        const withToken = submenu.filter((item) =>
          item?.continuation?.reloadContinuationData?.continuation
        );

        const labelOf = (item) =>
          [
            textOf(item?.title),
            textOf(item?.label),
            String(item?.title || ''),
            String(item?.label || ''),
          ].filter(Boolean).join(' ');

        const allChatItem =
          withToken.find((item) => {
            const label = labelOf(item);
            return !/top|上位/i.test(label) &&
              /live chat|チャットのリプレイ|すべて|all/i.test(label);
          }) ||
          // YouTubeのwatchページでは通常 0=Top Chat, 1=Live Chat。
          (withToken.length >= 2 ? withToken[1] : null);

        if (allChatItem) {
          const data = allChatItem.continuation.reloadContinuationData;
          return { ...data, source: 'liveChatRenderer.header:all' };
        }
      }

      // ヘッダー切替が取れない環境だけ、現在表示中のcontinuationへフォールバック。
      const direct = renderer?.continuations?.[0]?.reloadContinuationData;
      if (direct?.continuation) {
        return { ...direct, source: 'liveChatRenderer.continuations:fallback' };
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
      const pageFetch = getPageFetch();
      const res = await pageFetch(target, {
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
      let hardTimer = null;
      const requestedTimeout = Math.max(1000, Number(details?.timeout || 45000));
      const hardTimeoutMs = requestedTimeout + 5000;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (hardTimer) clearTimeout(hardTimer);
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

        // Macaque側でtimeoutが効かない場合でも、JS側で必ず解除する。
        hardTimer = setTimeout(() => {
          try { control?.abort?.(); } catch { /* ignore */ }
          finish(reject, new Error(`GM request hard timeout (${Math.round(hardTimeoutMs / 1000)}s)`));
        }, hardTimeoutMs);
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
    const playerResponse =
      parseJsonAfterMarker(html, 'var ytInitialPlayerResponse = ') ||
      parseJsonAfterMarker(html, 'ytInitialPlayerResponse = ') ||
      parseJsonAfterMarker(html, 'window["ytInitialPlayerResponse"] = ');

    const parsed = extractInitialContinuation(initialData);
    if (parsed?.continuation) {
      return { initialData, playerResponse, continuation: parsed, method: 'parsed' };
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
            playerResponse,
            continuation: { continuation: token, source: 'liveChatRenderer.regex' },
            method: 'regex',
          };
        }
      }
    }

    return { initialData, playerResponse, continuation: null, method: 'none' };
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
        playerResponse: parsed?.playerResponse || null,
        publishedAt: publishedAtFromPlayerResponse(parsed?.playerResponse) ||
          (html.match(/itemprop=["']datePublished["'][^>]*content=["']([^"']+)/i)?.[1] || '') ||
          (html.match(/itemprop=["']uploadDate["'][^>]*content=["']([^"']+)/i)?.[1] || '') ||
          (html.match(/"startTimestamp"\s*:\s*"([^"]+)"/)?.[1] || '') ||
          (html.match(/"publishDate"\s*:\s*"([^"]+)"/)?.[1] || ''),
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
    let continuation = null;
    let source = pageData.source;

    // まず現在表示中のChat Replay tokenを使う。
    // これはv0.1.xで実際に200を返していた経路。
    const currentRenderers = deepFindValues(initialData, 'liveChatRenderer');
    for (const renderer of currentRenderers) {
      const data = renderer?.continuations?.[0]?.reloadContinuationData;
      if (data?.continuation) {
        continuation = { ...data, source: 'page:liveChatRenderer.continuations' };
        break;
      }
    }

    if (!continuation?.continuation && videoId) {
      const pbj = await fetchPbjInitialData(videoId, cfg, auth, origin, signal);
      const renderers = deepFindValues(pbj, 'liveChatRenderer');
      for (const renderer of renderers) {
        const data = renderer?.continuations?.[0]?.reloadContinuationData;
        if (data?.continuation) {
          initialData = pbj;
          continuation = { ...data, source: 'pbj:liveChatRenderer.continuations' };
          source = 'pbj';
          break;
        }
      }
    }

    if (!continuation?.continuation && videoId) {
      const gmDesktop = await fetchDesktopWatchDataViaGM(videoId, signal);
      if (gmDesktop) {
        cfg = normalizeCfg(applyPageAuthSession({ ...cfg, ...(gmDesktop.cfg || {}) }));
        auth = await buildAuthorization(origin);
        const renderers = deepFindValues(gmDesktop.initialData, 'liveChatRenderer');
        for (const renderer of renderers) {
          const data = renderer?.continuations?.[0]?.reloadContinuationData;
          if (data?.continuation) {
            initialData = gmDesktop.initialData || initialData;
            continuation = { ...data, source: 'gm-desktop:liveChatRenderer.continuations' };
            source = 'gm-desktop';
            break;
          }
        }
      }
    }

    if (!continuation?.continuation && videoId) {
      const desktop = await fetchDesktopWatchData(videoId, signal);
      if (desktop) {
        cfg = normalizeCfg(applyPageAuthSession({ ...cfg, ...(desktop.cfg || {}) }));
        auth = await buildAuthorization(origin);
        const renderers = deepFindValues(desktop.initialData, 'liveChatRenderer');
        for (const renderer of renderers) {
          const data = renderer?.continuations?.[0]?.reloadContinuationData;
          if (data?.continuation) {
            initialData = desktop.initialData;
            continuation = { ...data, source: 'desktop:liveChatRenderer.continuations' };
            source = 'desktop-html';
            break;
          }
        }
      }
    }

    if (!continuation?.continuation && videoId) {
      const nextData = await fetchNextInitialData(videoId, cfg, auth, origin, signal);
      const renderers = deepFindValues(nextData, 'liveChatRenderer');
      for (const renderer of renderers) {
        const data = renderer?.continuations?.[0]?.reloadContinuationData;
        if (data?.continuation) {
          initialData = nextData;
          continuation = { ...data, source: 'next:liveChatRenderer.continuations' };
          source = 'next';
          break;
        }
      }
    }

    if (!continuation?.continuation) {
      throw new Error(
        'チャットリプレイの開始トークンが見つかりません。Safari表示ページ・PBJ・GM経由PC版watch・通常PC版watch・Innertube nextで確認しました。'
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
      referrer: ctx.chatReplayUrl || location.href,
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
      const version = ctx.cfg.clientVersion || ctx.cfg.INNERTUBE_CONTEXT?.client?.clientVersion || '?';
      const err = new Error(
        `Chat Replay API: HTTP ${res.status} ${res.statusText} [token:${tokenSource} / SafariAccount:${ctx.pageSessionIndex ?? 'unknown'} / sentAccount:${sessionIndex} / client:${client} / version:${version}]`
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


  async function runSeekWorker(ctx, worker, map, onProgress, signal) {
    if (worker.done) return;

    let init = await freshPlayerSeek(ctx, signal);
    let token = init.playerSeek;
    if (!token) throw new Error('高速取得用playerSeekトークンを取得できませんでした。');

    let offsetMs = Math.max(worker.startMs, Number(worker.offsetMs) || worker.startMs);
    let previousToken = null;
    let loops = 0;
    let recoveries = 0;
    worker.done = false;
    worker.failed = false;

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

      if (offsetMs >= worker.endMs - 1000) {
        worker.done = true;
      }

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

      if (worker.done) break;

      const stalled =
        !nextToken ||
        (lastOffset === null && (nextToken === token || nextToken === previousToken));

      if (stalled) {
        // 区間末尾より前でtokenが途切れた場合は「完了」にせず、
        // 独立したplayerSeek tokenを取り直して少し巻き戻して再開する。
        if (recoveries < 3) {
          recoveries++;
          offsetMs = Math.max(worker.startMs, offsetMs - FAST_OVERLAP_MS);
          worker.offsetMs = offsetMs;
          init = await freshPlayerSeek(ctx, signal);
          token = init.playerSeek;
          previousToken = null;
          if (!token) break;
          continue;
        }
        worker.failed = true;
        break;
      }

      previousToken = token;
      token = nextToken;
      if (loops % 20 === 0) await sleep(0);
    }

    if (!worker.done) {
      worker.failed = true;
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
      // まず現在選択中（通常Top Chat）のtokenで1回だけ正常なレスポンスを得る。
      init = await freshPlayerSeek(ctx, signal);

      // そのレスポンスのヘッダーから「全チャット」tokenへ切り替える。
      const allChat = extractAllChatContinuationFromReplayResponse(init.response);
      if (allChat?.continuation) {
        onProgress({
          phase: 'switch-all-chat',
          count: map.size,
          requests: state.requestCount,
          detail: 'Top Chatから全チャットへ切り替え中…',
        });

        ctx.continuation = allChat;

        // 全チャットtokenで改めて初期playerSeek tokenを取得。
        init = await freshPlayerSeek(ctx, signal);

        onProgress({
          phase: 'switch-all-chat-done',
          count: map.size,
          requests: state.requestCount,
          detail: '全チャットへ切り替えました。',
        });
      } else {
        onProgress({
          phase: 'switch-all-chat-missing',
          count: map.size,
          requests: state.requestCount,
          detail: '全チャット切替tokenが見つからず、現在のチャット表示を取得します。',
        });
      }
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
          signal
        )
      ));

      const incomplete = state.workerProgress.filter((w) => !w.done);
      if (incomplete.length) {
        throw new Error(
          `取得区間を最後まで確認できませんでした（${incomplete.length}/${FAST_WORKERS}区間）。取得完了扱いにはしません。`
        );
      }
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
    const durationMs = getVideoDurationMs(ctx);
    const old = resumeRecord?.workers?.[0];
    let offsetMs = Math.max(0, Number(old?.offsetMs || 0) - FAST_OVERLAP_MS);
    let loops = 0;
    let lastProgressOffset = -1;

    state.workerProgress = [{
      index: 0,
      startMs: 0,
      endMs: durationMs || Number.MAX_SAFE_INTEGER,
      offsetMs,
      done: false,
    }];

    while (loops < 30000) {
      loops++;
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      // 旧方式は固定token + currentPlayerState.playerOffsetMs が必須。
      const response = await innertubeReplay(ctx, fixedToken, signal, offsetMs, true);
      const actions = getActions(response);
      addActionsTracked(actions, map);
      const lastOffset = maxOffsetFromActions(actions);

      if (lastOffset !== null) {
        state.workerProgress[0].offsetMs = lastOffset;
      }

      onProgress({
        phase: 'legacy-all',
        count: map.size,
        requests: state.requestCount,
        detail: lastOffset === null
          ? '全チャット取得中…'
          : `${formatTime(lastOffset / 1000)} まで全チャット取得`,
      });
      maybePersistSnapshot();

      if (lastOffset === null) {
        // 応答にチャットが無ければ終端。
        state.workerProgress[0].done = true;
        break;
      }

      if (durationMs && lastOffset >= durationMs - 1000) {
        state.workerProgress[0].done = true;
        offsetMs = lastOffset;
        break;
      }

      if (lastOffset <= offsetMs || lastOffset === lastProgressOffset) {
        // 進捗が止まった時点を終端とみなす。
        state.workerProgress[0].done = true;
        offsetMs = lastOffset;
        break;
      }

      lastProgressOffset = offsetMs;
      offsetMs = lastOffset;

      if (loops % 12 === 0) await sleep(0);
    }

    if (!map.size) {
      throw new Error('全チャットを取得できませんでした。');
    }

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
      #${PANEL_ID} .mcs-cloud-wrap { border:1px solid #e1e1e1; border-radius:10px; padding:8px; display:grid; gap:7px; }
      #${PANEL_ID} .mcs-cloud-title { font-size:12px; font-weight:700; }
      #${PANEL_ID} .mcs-cloud-status { font-size:11px; color:#666; overflow-wrap:anywhere; }
      #${PANEL_ID} .mcs-cloud-token { width:100%; box-sizing:border-box; border:1px solid #bbb; border-radius:8px; padding:8px 9px; font:inherit; }
      #${PANEL_ID} .mcs-cloud-actions { display:flex; gap:6px; flex-wrap:wrap; }
      #${PANEL_ID} .mcs-cloud-actions button { border:0; border-radius:8px; background:#eee; padding:7px 9px; cursor:pointer; font-size:11px; }
      #${PANEL_ID} .mcs-tabs { display:flex; gap:6px; }
      #${PANEL_ID} .mcs-tab { flex:1; border:1px solid #ccc; border-radius:9px; background:#f4f4f4; color:#222; padding:8px 9px; font-weight:700; cursor:pointer; }
      #${PANEL_ID} .mcs-tab.active { background:#0f0f0f; color:#fff; border-color:#0f0f0f; }
      #${PANEL_ID} .mcs-cross-tools { display:grid; gap:6px; border:1px solid #e1e1e1; border-radius:10px; padding:8px; }
      #${PANEL_ID} .mcs-cross-sync { border:0; border-radius:9px; background:#065fd4; color:#fff; padding:9px 10px; font-weight:700; cursor:pointer; }
      #${PANEL_ID} .mcs-cross-sync[disabled] { opacity:.55; cursor:default; }
      #${PANEL_ID} .mcs-cross-status { font-size:11px; color:#666; overflow-wrap:anywhere; }
      #${PANEL_ID} .mcs-cross-video { padding:10px 12px 6px; background:#f7f7f7; border-bottom:1px solid #e5e5e5; font-weight:750; }
      #${PANEL_ID} .mcs-cross-video small { display:block; margin-top:2px; color:#777; font-weight:500; }
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
      html[dark] #${PANEL_ID} .mcs-tab, ytd-app[dark] #${PANEL_ID} .mcs-tab { background:#292929; color:#f1f1f1; border-color:#555; }
      html[dark] #${PANEL_ID} .mcs-tab.active, ytd-app[dark] #${PANEL_ID} .mcs-tab.active { background:#f1f1f1; color:#111; border-color:#f1f1f1; }
      html[dark] #${PANEL_ID} .mcs-cross-video, ytd-app[dark] #${PANEL_ID} .mcs-cross-video { background:#222; border-color:#333; }
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
    const tabs = makeEl('div', { className: 'mcs-tabs' });
    const currentTab = makeEl('button', { className: 'mcs-tab active', type: 'button', text: 'この動画' });
    currentTab.dataset.scope = 'current';
    const globalTab = makeEl('button', { className: 'mcs-tab', type: 'button', text: 'メン限横断 ↗' });
    globalTab.dataset.scope = 'global';
    tabs.append(currentTab, globalTab);

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
    const cloudWrap = makeEl('div', { className: 'mcs-cloud-wrap' });
    const cloudTitle = makeEl('div', { className: 'mcs-cloud-title', text: '☁️ pCloud保存' });
    const cloudStatusEl = makeEl('div', { className: 'mcs-cloud-status', text: '接続状態を確認中…' });
    const cloudToken = makeEl('input', {
      className: 'mcs-cloud-token',
      type: 'password',
      placeholder: 'バックアップ専用トークン（初回のみ）',
      autocomplete: 'off',
    });
    const cloudActions = makeEl('div', { className: 'mcs-cloud-actions' });
    const cloudConnect = makeEl('button', { className: 'mcs-cloud-connect', type: 'button', text: '接続' });
    const cloudRestore = makeEl('button', { className: 'mcs-cloud-restore', type: 'button', text: 'pCloudから再読込' });
    const cloudRetrySave = makeEl('button', { className: 'mcs-cloud-retry-save', type: 'button', text: '☁️ pCloudへ再保存' });
    const cloudDisconnect = makeEl('button', { className: 'mcs-cloud-disconnect', type: 'button', text: '切断' });
    cloudActions.append(cloudConnect, cloudRestore, cloudRetrySave, cloudDisconnect);
    cloudWrap.append(cloudTitle, cloudStatusEl, cloudToken, cloudActions);

    const crossTools = makeEl('div', { className: 'mcs-cross-tools' });
    crossTools.hidden = true;
    const crossSync = makeEl('button', { className: 'mcs-cross-sync', type: 'button', text: '☁️ メン限横断DB同期' });
    const crossStatus = makeEl('div', { className: 'mcs-cross-status', text: 'メン限横断DBを確認中…' });
    crossTools.append(crossSync, crossStatus);

    const help = makeEl('div', {
      className: 'mcs-help',
      text: '自動取得はメンバー限定だけ。横断検索は上の「メン限横断 ↗」から別ページで開きます。',
    });
    controls.append(tabs, load, statusEl, fastLabel, cloudWrap, crossTools, search, help);

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
    cloudConnect.addEventListener('click', () => void connectCloudFromUi());
    cloudRestore.addEventListener('click', () => {
      const videoId = getVideoId();
      if (videoId) void cloudRestoreLatest(videoId);
    });
    cloudRetrySave.addEventListener('click', async () => {
      const videoId = getVideoId();
      if (!videoId || !state.messages.length) {
        cloudUiStatus('⚠️ 再保存できるローカルチャットがありません。', true);
        return;
      }
      const saved = await cloudUploadCompleted(videoId, state.messages);
      if (saved) {
        status(`取得済み：${state.messages.length.toLocaleString()}件／☁️ pCloud再保存済み`);
      }
    });
    cloudDisconnect.addEventListener('click', () => void disconnectCloud());
    crossSync.addEventListener('click', () => void cloudSyncArchiveIndex());
    currentTab.addEventListener('click', () => setSearchScope('current'));
    globalTab.addEventListener('click', () => {
      openCrossSearchPage(search.value || '');
      setSearchScope('current');
    });
    search.addEventListener('input', renderSearchResults);
    updateCloudUi();
    void updateCrossStats();
  }


  function openCrossSearchPage(initialQuery = '') {
    const win = window.open('about:blank', 'mcs-member-cross-search');
    if (!win) {
      status('横断検索ページを開けませんでした。ポップアップを許可してください。', true);
      return;
    }

    const doc = win.document;
    doc.title = 'メン限チャット横断検索';
    doc.documentElement.lang = 'ja';
    doc.body.replaceChildren();
    doc.body.style.margin = '0';
    doc.body.style.fontFamily = '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif';
    doc.body.style.background = '#f5f6f8';
    doc.body.style.color = '#17191d';

    const style = doc.createElement('style');
    style.textContent = `
      *{box-sizing:border-box}
      body{min-height:100vh}
      .mcsx-head{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);border-bottom:1px solid #ddd;padding:14px 18px}
      .mcsx-title{font-size:20px;font-weight:850;margin-bottom:10px}
      .mcsx-tools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;max-width:1100px}
      .mcsx-input{width:100%;font-size:16px;padding:12px 14px;border:1px solid #bbb;border-radius:10px;background:#fff}
      .mcsx-sync{border:0;border-radius:10px;padding:0 16px;font-weight:800;background:#1265d8;color:#fff;cursor:pointer}
      .mcsx-status{max-width:1100px;margin-top:8px;font-size:12px;color:#666}
      .mcsx-main{max-width:1100px;margin:0 auto;padding:18px}
      .mcsx-empty{padding:50px 16px;text-align:center;color:#777}
      .mcsx-card{background:#fff;border:1px solid #ddd;border-radius:14px;margin:0 0 16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)}
      .mcsx-cardhead{display:grid;grid-template-columns:112px minmax(0,1fr) auto;gap:12px;align-items:center;padding:13px 15px;background:#fafafa;border-bottom:1px solid #e6e6e6}
      .mcsx-date{font-size:15px;font-weight:850;color:#125cc0;font-variant-numeric:tabular-nums}
      .mcsx-video-title{font-size:15px;font-weight:800;line-height:1.45}
      .mcsx-channel{font-size:12px;color:#727272;margin-top:3px}
      .mcsx-count{font-size:12px;font-weight:750;color:#555;white-space:nowrap}
      .mcsx-row{display:grid;grid-template-columns:82px 150px minmax(0,1fr);gap:10px;align-items:start;padding:10px 14px;border-bottom:1px solid #eee;text-decoration:none;color:inherit}
      .mcsx-row:last-child{border-bottom:0}
      .mcsx-row:hover{background:#f6f9ff}
      .mcsx-time{font-weight:850;color:#0866d9;font-variant-numeric:tabular-nums}
      .mcsx-author{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mcsx-msg{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}
      @media(max-width:700px){
        .mcsx-head{padding:11px}
        .mcsx-title{font-size:17px}
        .mcsx-main{padding:10px}
        .mcsx-tools{grid-template-columns:1fr}
        .mcsx-sync{min-height:42px}
        .mcsx-cardhead{grid-template-columns:1fr auto}
        .mcsx-date{grid-column:1/-1}
        .mcsx-row{grid-template-columns:70px minmax(0,1fr)}
        .mcsx-msg{grid-column:1/-1;padding-left:0}
      }
      @media(prefers-color-scheme:dark){
        body{background:#101114;color:#f0f1f3}
        .mcsx-head{background:rgba(24,25,29,.96);border-color:#383a40}
        .mcsx-input,.mcsx-card{background:#1b1d22;color:#f0f1f3;border-color:#383a40}
        .mcsx-cardhead{background:#22252b;border-color:#383a40}
        .mcsx-row{border-color:#303238}
        .mcsx-row:hover{background:#252b36}
        .mcsx-status,.mcsx-channel{color:#aaa}
        .mcsx-count{color:#bbb}
      }
    `;
    doc.head.appendChild(style);

    const head = doc.createElement('header');
    head.className = 'mcsx-head';
    const title = doc.createElement('div');
    title.className = 'mcsx-title';
    title.textContent = '🔎 メン限チャット横断検索';
    const tools = doc.createElement('div');
    tools.className = 'mcsx-tools';
    const input = doc.createElement('input');
    input.className = 'mcsx-input';
    input.type = 'search';
    input.placeholder = '本文・投稿者を検索（A | B でOR）';
    input.value = String(initialQuery || '');
    const sync = doc.createElement('button');
    sync.className = 'mcsx-sync';
    sync.type = 'button';
    sync.textContent = '☁️ pCloud同期・日付更新';
    tools.append(input, sync);
    const info = doc.createElement('div');
    info.className = 'mcsx-status';
    info.textContent = 'メンバー限定と確認できたアーカイブだけを検索します。';
    head.append(title, tools, info);

    const main = doc.createElement('main');
    main.className = 'mcsx-main';
    doc.body.append(head, main);

    let timer = null;
    let serial = 0;
    const show = (text) => {
      main.replaceChildren();
      const el = doc.createElement('div');
      el.className = 'mcsx-empty';
      el.textContent = text;
      main.appendChild(el);
    };

    const updateInfo = async (prefix = '') => {
      try {
        const stats = await archiveIndexStats();
        if (win.closed) return;
        info.textContent = `${prefix ? prefix + ' / ' : ''}メン限 ${stats.archives.toLocaleString()}本・${stats.messages.toLocaleString()}コメント`;
      } catch {
        if (!win.closed) info.textContent = prefix || '横断DBの状態を確認できませんでした。';
      }
    };

    const run = async () => {
      const my = ++serial;
      const q = String(input.value || '').trim();
      if (!q) {
        show('検索語を入力してください。');
        await updateInfo();
        return;
      }
      show('検索中…');
      try {
        const { matches, truncated } = await searchArchiveIndex(q);
        if (win.closed || my !== serial) return;
        if (!matches.length) {
          show('該当するチャットはありません。');
          await updateInfo('0件');
          return;
        }

        const groups = new Map();
        for (const hit of matches) {
          let group = groups.get(hit.videoId);
          if (!group) {
            group = {
              videoId: hit.videoId,
              title: hit.title || hit.videoId,
              channel: hit.channel || '',
              publishedAt: hit.publishedAt || '',
              archiveCreatedAt: hit.archiveCreatedAt || '',
              rows: [],
            };
            groups.set(hit.videoId, group);
          }
          group.rows.push(hit.msg);
        }

        const ordered = [...groups.values()].sort((a, b) => {
          const ad = Date.parse(a.publishedAt || a.archiveCreatedAt || 0) || 0;
          const bd = Date.parse(b.publishedAt || b.archiveCreatedAt || 0) || 0;
          return bd - ad;
        });

        main.replaceChildren();
        for (const group of ordered) {
          const card = doc.createElement('section');
          card.className = 'mcsx-card';
          const cardHead = doc.createElement('div');
          cardHead.className = 'mcsx-cardhead';

          const date = doc.createElement('div');
          date.className = 'mcsx-date';
          date.textContent = archiveDateLabel(group.publishedAt);

          const titleWrap = doc.createElement('div');
          const vt = doc.createElement('div');
          vt.className = 'mcsx-video-title';
          vt.textContent = group.title;
          const ch = doc.createElement('div');
          ch.className = 'mcsx-channel';
          ch.textContent = group.channel || '';
          titleWrap.append(vt, ch);

          const count = doc.createElement('div');
          count.className = 'mcsx-count';
          count.textContent = `${group.rows.length.toLocaleString()}件`;
          cardHead.append(date, titleWrap, count);
          card.appendChild(cardHead);

          for (const msg of group.rows) {
            const row = doc.createElement('a');
            row.className = 'mcsx-row';
            row.href = archiveTimestampUrl(group.videoId, msg.seconds);
            row.target = '_blank';
            row.rel = 'noopener';

            const time = doc.createElement('span');
            time.className = 'mcsx-time';
            time.textContent = formatTime(msg.seconds);
            const author = doc.createElement('span');
            author.className = 'mcsx-author';
            author.textContent = msg.author || '（投稿者不明）';
            const body = doc.createElement('span');
            body.className = 'mcsx-msg';
            body.textContent = msg.message || '';
            row.append(time, author, body);
            card.appendChild(row);
          }
          main.appendChild(card);
        }

        await updateInfo(`${truncated ? CROSS_RESULT_LIMIT.toLocaleString() + '件以上' : matches.length.toLocaleString() + '件'} / ${groups.size.toLocaleString()}本`);
      } catch (e) {
        if (win.closed || my !== serial) return;
        show(`横断検索失敗：${String(e?.message || e).slice(0, 160)}`);
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 160);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timer);
        void run();
      }
    });
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      sync.textContent = '同期中…';
      info.textContent = 'pCloud同期中。古い保存分の日付もYouTubeから補完します…';
      try {
        await cloudSyncArchiveIndex();
        await updateInfo('同期完了');
        await run();
      } finally {
        if (!win.closed) {
          sync.disabled = false;
          sync.textContent = '☁️ pCloud同期・日付更新';
        }
      }
    });

    void updateInfo();
    if (input.value.trim()) void run();
    input.focus();
  }


  function setSearchScope(scope) {
    state.searchScope = scope === 'global' ? 'global' : 'current';
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    for (const tab of panel.querySelectorAll('.mcs-tab')) {
      tab.classList.toggle('active', tab.dataset.scope === state.searchScope);
    }
    const isGlobal = state.searchScope === 'global';
    const load = panel.querySelector('.mcs-load');
    const statusEl = panel.querySelector('.mcs-status');
    const fastLabel = panel.querySelector('.mcs-fast-label');
    const crossTools = panel.querySelector('.mcs-cross-tools');
    const input = panel.querySelector('.mcs-search');
    const help = panel.querySelector('.mcs-help');
    if (load) load.hidden = isGlobal;
    if (statusEl) statusEl.hidden = isGlobal;
    if (fastLabel) fastLabel.hidden = isGlobal;
    if (crossTools) crossTools.hidden = !isGlobal;
    if (input) {
      input.placeholder = isGlobal
        ? 'メン限アーカイブのみ本文・投稿者を検索（A | B でOR）'
        : '本文・投稿者を検索（A | B でOR）';
    }
    if (help) {
      help.textContent = isGlobal
        ? 'pCloudに保存したうち、メンバー限定と確認できたアーカイブだけを横断検索します。通常公開アーカイブは除外します。'
        : '自動取得はメンバー限定アーカイブだけです。通常公開は自動取得せず、必要なら手動で取得できます。';
    }
    renderSearchResults();
    if (isGlobal) void updateCrossStats();
  }

  function scheduleCrossSearchRender(immediate = false) {
    clearTimeout(state.crossSearchTimer);
    state.crossSearchTimer = setTimeout(() => void renderCrossSearchResults(), immediate ? 0 : 140);
  }

  async function renderCrossSearchResults() {
    if (state.searchScope !== 'global') return;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const results = panel.querySelector('.mcs-results');
    const input = panel.querySelector('.mcs-search');
    if (!results || !input) return;

    const serial = ++state.crossSearchSerial;
    const q = String(input.value || '').trim();

    const clearResults = () => {
      while (results.firstChild) results.removeChild(results.firstChild);
    };
    const showEmpty = (text) => {
      clearResults();
      results.appendChild(makeEl('div', { className: 'mcs-empty', text }));
    };

    if (!q) {
      showEmpty('検索語を入力すると、保存済みメン限アーカイブ全体を検索します。');
      return;
    }

    showEmpty('横断検索中…');

    try {
      const { matches, truncated } = await searchArchiveIndex(q);
      if (serial !== state.crossSearchSerial || state.searchScope !== 'global') return;
      if (!matches.length) {
        showEmpty('該当するチャットはありません。');
        return;
      }

      const groups = new Map();
      for (const hit of matches) {
        let group = groups.get(hit.videoId);
        if (!group) {
          group = {
            videoId: hit.videoId,
            title: hit.title || hit.videoId,
            channel: hit.channel || '',
            createdAt: hit.archiveCreatedAt || '',
            rows: [],
          };
          groups.set(hit.videoId, group);
        }
        group.rows.push(hit.msg);
      }

      const ordered = [...groups.values()].sort((a, b) =>
        Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)
      );

      clearResults();
      let rendered = 0;
      for (const group of ordered) {
        const heading = makeEl('div', { className: 'mcs-cross-video' });
        heading.appendChild(document.createTextNode(`${group.title}（${group.rows.length}件）`));
        if (group.channel) heading.appendChild(makeEl('small', { text: group.channel }));
        results.appendChild(heading);

        for (const m of group.rows) {
          rendered++;
          const row = makeEl('button', { className: 'mcs-row', type: 'button' });
          const meta = makeEl('div', { className: 'mcs-meta' });
          meta.appendChild(makeEl('span', { className: 'mcs-time', text: formatTime(m.seconds) }));
          meta.appendChild(makeEl('span', { className: 'mcs-author', text: m.author || '（投稿者不明）' }));
          if (rendered === 1) {
            meta.appendChild(makeEl('span', {
              className: 'mcs-count',
              text: truncated ? `${CROSS_RESULT_LIMIT.toLocaleString()}件以上` : `${matches.length.toLocaleString()}件`,
            }));
          }
          row.appendChild(meta);
          row.appendChild(makeEl('div', { className: 'mcs-msg', text: m.message }));
          row.addEventListener('click', () => openArchiveTimestamp(group.videoId, m.seconds));
          results.appendChild(row);
        }
      }
    } catch (e) {
      if (serial !== state.crossSearchSerial) return;
      showEmpty(`横断検索失敗：${String(e?.message || e).slice(0, 120)}`);
    }
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

    // クリック直後に必ずUIを反応させる。IndexedDB確認が詰まっても無反応に見せない。
    state.videoId = videoId;
    state.loading = true;
    state.manualAbort = false;
    state.abortController = new AbortController();
    state.loadedVideoId = null;
    setLoadButton('中止', false);
    status('取得準備中…');
    renderSearchResults();

    if (state.memberOnly === null) {
      const detected = await detectMemberOnlyVideo(videoId);
      if (getVideoId() !== videoId) {
        state.loading = false;
        state.abortController = null;
        return;
      }
      state.memberOnly = detected;
      if (!autoResume && detected === false) {
        status('通常公開アーカイブ：手動取得として実行します（メン限横断検索には入りません）。');
      }
    }

    let cache = null;
    try {
      if (!autoResume && state.cacheCompleted) {
        await withTimeout(deleteCache(videoId), 2500, '旧キャッシュ削除');
        state.cacheRecord = null;
        state.cacheCompleted = false;
        state.messages = [];
        state.messageMap = new Map();
        state.workerProgress = [];
      }

      cache = state.cacheRecord?.videoId === videoId
        ? state.cacheRecord
        : await withTimeout(readCache(videoId), 3000, 'ローカルキャッシュ確認');

      if (cache && cache.chatMode !== 'all-v2') {
        await withTimeout(deleteCache(videoId), 2500, '旧形式キャッシュ削除').catch(() => {});
        cache = null;
        state.cacheRecord = null;
        state.cacheCompleted = false;
        state.messages = [];
        state.messageMap = new Map();
        state.workerProgress = [];
        status('旧バージョンの保存データを無視して、全チャットを最初から取得します。');
      }
    } catch (e) {
      console.warn('[Member Chat Search] cache preflight skipped', e);
      cache = null;
      status('ローカルキャッシュ確認をスキップして取得を開始します…');
    }

    if (cache && !state.messages.length) {
      state.messages = cache.messages || [];
      state.messageMap = new Map();
      for (const msg of state.messages) {
        const key = msg.id || `${msg.offsetMs}|${msg.author}|${msg.message}`;
        state.messageMap.set(key, msg);
      }
    }

    status(autoResume || cache?.messages?.length ? '保存済みデータから続き取得を開始…' : 'Chat Replay取得を開始します…');
    renderSearchResults();

    const fastInput = document.querySelector(`#${PANEL_ID} .mcs-fast`);
    const fastMode = fastInput ? Boolean(fastInput.checked) : true;

    // 新規取得時だけ空の開始記録を保存。再開時に巨大な全件スナップショットを
    // もう一度書き直してから開始する無駄を避ける。
    if (!cache?.messages?.length) {
      void persistSnapshot({ completed: false, inProgress: true, force: true });
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
      try {
        const meta = currentVideoMetadata(videoId);
        await writeArchiveIndexFromChat({
          videoId,
          title: meta.title,
          channel: meta.channel,
          count: messages.length,
          memberOnly: state.memberOnly === true ? true : state.memberOnly === false ? false : null,
          publishedAt: currentVideoMetadata(videoId).publishedAt || '',
          messages,
          exportedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[Member Chat Search] cross index local completion write failed', e);
      }
      status(`取得完了：${messages.length.toLocaleString()}件（API ${state.requestCount}回）`);
      setLoadButton('再取得', false);
      renderSearchResults();

      if (state.cloudEnabled && state.cloudToken) {
        status(`取得完了：${messages.length.toLocaleString()}件。pCloudへ保存中…`);
        const saved = await cloudUploadCompleted(videoId, messages);
        status(
          saved
            ? `取得完了：${messages.length.toLocaleString()}件／☁️ pCloud保存済み`
            : `取得完了：${messages.length.toLocaleString()}件／pCloud保存は失敗（ローカル保存済み・「pCloudへ再保存」で再試行できます）`,
          !saved
        );
      }
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

  async function detectChatReplayAvailable(videoId) {
    if (!videoId) return false;

    try {
      let page = window;
      if (typeof unsafeWindow !== 'undefined') page = unsafeWindow;
      const player = page?.ytInitialPlayerResponse;
      if (player?.videoDetails?.isLiveContent === true) return true;

      const data = page?.ytInitialData;
      if (data && deepFindValues(data, 'liveChatRenderer', 20).length) return true;
    } catch { /* ignore */ }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const desktop = await fetchDesktopWatchDataViaGM(videoId, controller.signal);
      clearTimeout(timer);
      if (desktop?.continuation?.continuation) return true;
      if (desktop?.initialData && deepFindValues(desktop.initialData, 'liveChatRenderer', 20).length) return true;
    } catch (e) {
      if (e?.name !== 'AbortError') console.warn('[Member Chat Search] replay detection failed', e);
    }

    return false;
  }

  async function ensureCloudBackupForLocal(videoId, record) {
    if (!state.cloudEnabled || !state.cloudToken || !record?.completed || !record?.messages?.length) return;
    try {
      const list = await cloudList(videoId);
      if (list.length) {
        state.cloudLastBackupId = String(list[0]?.id || '');
        cloudUiStatus(`☁️ pCloud保存あり：${record.messages.length.toLocaleString()}件`);
        return;
      }
      await cloudUploadCompleted(videoId, record.messages, { silent: true });
    } catch (e) {
      console.warn('[Member Chat Search] cloud ensure failed', e);
    }
  }

  async function initializeVideoStorage(videoId, { forceCloudCheck = false } = {}) {
    if (!videoId) return;
    const serial = ++state.initSerial;

    // 1) ローカルを最優先。完成版なら即検索可能にしてYouTube APIは叩かない。
    await restoreCacheForVideo(videoId, { allowAutoResume: false });
    if (serial !== state.initSerial || getVideoId() !== videoId) return;

    if (state.cacheRecord?.completed && state.messages.length) {
      if (state.memberOnly === null) {
        state.memberOnly = await detectMemberOnlyVideo(videoId);
        if (typeof state.memberOnly === 'boolean') {
          state.cacheRecord.memberOnly = state.memberOnly;
          void withTimeout(writeCache(state.cacheRecord), 30000, 'メン限判定のローカル保存').catch(() => {});
        }
      }
      status(`保存済み：${state.messages.length.toLocaleString()}件（YouTube再取得なし）`);
      setLoadButton('再取得', false);
      if (state.cloudEnabled && state.memberOnly === true) {
        void ensureCloudBackupForLocal(videoId, state.cacheRecord);
      }
      return;
    }

    // 2) ローカル完成版が無ければ必ずpCloudを確認。別端末で取得済みならここで終了。
    if (state.cloudEnabled && state.cloudToken) {
      const restored = await cloudRestoreLatest(videoId, { silent: !forceCloudCheck });
      if (serial !== state.initSerial || getVideoId() !== videoId) return;
      if (restored === true) return;
      if (restored === null) {
        // pCloud確認に失敗しただけで「保存なし」とは限らない。
        // ここでYouTube再取得を始めると二重取得になるので自動開始しない。
        status('pCloudの保存有無を確認できなかったため、自動再取得は開始しません。pCloud欄のエラーを確認してください。', true);
        setLoadButton(state.cacheRecord?.messages?.length ? '続きから取得' : 'チャットを取得', false);
        return;
      }
      // restored === false のときだけ「pCloudにも保存なし」と確定して次へ進む。
    }

    // 3) 自動取得・自動再開はメン限アーカイブだけ。
    if (state.memberOnly === null) {
      status('メンバー限定アーカイブか確認中…');
      state.memberOnly = await detectMemberOnlyVideo(videoId);
      if (serial !== state.initSerial || getVideoId() !== videoId) return;
    }

    if (state.memberOnly !== true) {
      status(state.memberOnly === false
        ? '通常公開アーカイブのため自動取得しません。必要な場合だけ「チャットを取得」を押してください。'
        : 'メン限判定を確認できなかったため自動取得しません。必要な場合だけ「チャットを取得」を押してください。');
      setLoadButton('チャットを取得', false);
      return;
    }

    // 4) メン限の途中ローカルがあれば続きから自動再開。
    if (state.cacheRecord?.inProgress && state.cacheRecord?.messages?.length) {
      if (!state.loading && state.autoResumeStartedFor !== videoId) {
        state.autoResumeStartedFor = videoId;
        status('保存済みの続きから自動再開します…');
        setTimeout(() => {
          if (getVideoId() === videoId && !state.loading) void handleLoadClick(true);
        }, 500);
      }
      return;
    }

    // 5) メン限かつ保存なしならチャットリプレイを自動取得。
    if (state.autoStartStartedFor === videoId || state.loading) return;
    status('メン限アーカイブ：チャットリプレイを確認中…');

    const available = await detectChatReplayAvailable(videoId);
    if (serial !== state.initSerial || getVideoId() !== videoId) return;

    if (!available) {
      status('この動画ではチャットリプレイを検出しませんでした。');
      return;
    }

    state.autoStartStartedFor = videoId;
    status('メン限チャットリプレイを検出。自動取得を開始します…');
    setTimeout(() => {
      if (getVideoId() === videoId && !state.loading) void handleLoadClick(true);
    }, 350);
  }

  function matchesQuery(msg, raw) {
    const q = raw.trim().toLocaleLowerCase();
    if (!q) return true;
    const hay = `${msg.author}\n${msg.message}`.toLocaleLowerCase();
    const ors = q.split('|').map((x) => x.trim()).filter(Boolean);
    return ors.some((term) => hay.includes(term));
  }

  function renderSearchResults() {
    if (state.searchScope === 'global') {
      scheduleCrossSearchRender();
      return;
    }
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
      // URLのt=は書き換えない。外部サイトやYouTube標準のタイムスタンプ移動へ干渉しない。
    } catch (e) {
      status(`時刻移動に失敗しました: ${e?.message || e}`, true);
    }
  }

  function parseYouTubeTimestamp(value) {
    if (value == null) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;

    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }

    const plain = raw.match(/^(\d+(?:\.\d+)?)s$/);
    if (plain) return Number(plain[1]);

    const h = Number(raw.match(/(\d+)h/)?.[1] || 0);
    const m = Number(raw.match(/(\d+)m/)?.[1] || 0);
    const s = Number(raw.match(/(\d+(?:\.\d+)?)s/)?.[1] || 0);
    if (h || m || s) return h * 3600 + m * 60 + s;

    return null;
  }

  function getTimestampFromCurrentUrl() {
    try {
      const u = new URL(location.href);
      const raw =
        u.searchParams.get('t') ??
        u.searchParams.get('start') ??
        (u.hash.startsWith('#t=') ? u.hash.slice(3) : null);
      return parseYouTubeTimestamp(raw);
    } catch {
      return null;
    }
  }

  function applyUrlTimestampOnce() {
    const seconds = getTimestampFromCurrentUrl();
    if (seconds === null) return;

    const key = location.href;
    if (state.lastAppliedTimestampUrl === key) return;
    state.lastAppliedTimestampUrl = key;

    let tries = 0;
    const trySeek = () => {
      tries++;
      const video = document.querySelector('video');
      if (!video) {
        if (tries < 20) setTimeout(trySeek, 250);
        return;
      }

      try {
        const target = Math.max(0, Number(seconds) || 0);
        if (Math.abs(video.currentTime - target) > 1.5) {
          video.currentTime = target;
        }

        // YouTube側が直後に視聴履歴位置へ戻すことがあるため、短時間だけ再確認。
        if (tries < 6) {
          setTimeout(() => {
            if (Math.abs(video.currentTime - target) > 2) {
              trySeek();
            }
          }, 350);
        }
      } catch {
        if (tries < 20) setTimeout(trySeek, 250);
      }
    };

    setTimeout(trySeek, 80);
  }

  function resetForNavigation() {
    const id = getVideoId();

    // 同じ動画でt=だけ変わった場合も、外部リンクの指定時刻を優先する。
    if (id === state.videoId) {
      applyUrlTimestampOnce();
      return;
    }

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
    state.autoStartStartedFor = null;
    state.memberOnly = null;
    state.lastAppliedTimestampUrl = null;
    const input = document.querySelector(`#${PANEL_ID} .mcs-search`);
    if (input) input.value = '';
    status('アーカイブを開いて「チャットを取得」を押してください。');
    setLoadButton('チャットを取得', false);
    renderSearchResults();
    if (id) void initializeVideoStorage(id);
    applyUrlTimestampOnce();
  }

  function boot() {
    if (!document.body) return;
    createUi();
    state.videoId = getVideoId();
    applyUrlTimestampOnce();

    document.addEventListener('yt-navigate-finish', resetForNavigation, true);
    window.addEventListener('popstate', resetForNavigation);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.loading) {
        void persistSnapshot({ completed: false, inProgress: true, force: true });
      } else if (!document.hidden && state.videoId && !state.loading) {
        void initializeVideoStorage(state.videoId);
        applyUrlTimestampOnce();
      }
    });

    window.addEventListener('pagehide', () => {
      if (state.loading) void persistSnapshot({ completed: false, inProgress: true, force: true });
    });

    void initializeCloudConfig().then(() => {
      if (state.videoId) void initializeVideoStorage(state.videoId);
      void updateCrossStats();
    });

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
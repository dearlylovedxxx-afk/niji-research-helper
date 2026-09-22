// ==UserScript==
// @name         Niji Research Helper
// @namespace    niji-pov-helper
// @version      1.0.41
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Research_Helper.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Research_Helper.user.js
// @description  comment2434 と YouTube をつなぐ調査支援ツール。IndexedDB蓄積、Holodexの429待機制御、Wiki照合状況の見える化でアーカイブ調査を安定化します。
// @author       ChatGPT + user
// @match        https://comment2434.com/comment/*
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://youtube.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @grant        GM.openInTab
// @connect      holodex.net
// @connect      www.googleapis.com
// @connect      wikiwiki.jp
// @connect      niji-research-backup.dearlylovedxxx.workers.dev
// @run-at       document-idle
// @noframes
// ==/UserScript==

(async () => {
  'use strict';

  // YouTube のライブチャット iframe などでは動かさない。
  // @noframes が効かない環境への二重ガード。
  if (window.top !== window.self) return;

  // Mobile YouTube diagnostic: created before GM calls so a missing badge means
  // the userscript was not injected (or failed even before executing its body).
  const ytBootBadge = /(^|\.)youtube\.com$/i.test(location.hostname)
    ? (() => {
        const badge = document.createElement('div');
        badge.id = 'npf-yt-boot-badge';
        badge.textContent = 'NIJI 読み込み中';
        const props = {
          position: 'fixed', top: 'calc(8px + env(safe-area-inset-top, 0px))',
          right: '8px', padding: '5px 9px', 'z-index': '2147483647',
          display: 'block', visibility: 'visible', opacity: '1',
          background: '#5145b5', color: '#fff', 'border-radius': '8px',
          'font-size': '11px', 'font-weight': '700', 'line-height': '1.4',
          'pointer-events': 'none', 'max-width': '75vw',
        };
        for (const [key, value] of Object.entries(props)) badge.style.setProperty(key, value, 'important');
        document.documentElement.appendChild(badge);
        return badge;
      })()
    : null;

  const VERSION = '1.0.41';
  const API = 'https://holodex.net/api/v2';
  const KEY_API = 'npf_holodex_api_key';
  const KEY_FAVS = 'npf_favorites';
  const KEY_LIVER_FAVS = 'npf_liver_favorites_v1'; // 検索フォーム専用・既存のチャンネルお気に入りとは別
  const KEY_SETTINGS = 'npf_settings';
  const KEY_SYNC = 'npf_sync_points';
  const KEY_CAL = 'npf_video_sync_calibration';
  const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';
  const WIKI_BASE = 'https://wikiwiki.jp/nijisanji';
  const WIKI_CACHE_TTL = 12 * 60 * 60 * 1000;

  // ---------- persistent local research DB (IndexedDB) ----------
  // YouTube上の調査データだけをブラウザ内へ保存する。画像・動画本体は保存しない。
  const NRH_DB_NAME = 'NijiResearchHelperDB';
  const NRH_DB_VERSION = 1;
  const NRH_PAIR_TTL = 12 * 60 * 60 * 1000;
  let nrhDbPromise = null;
  // Cloud backup is off until the user explicitly connects the separate gateway.
  const cloud = { enabled:false, token:'', busy:false, dirty:false, writes:0, timer:null,
    lastSavedAt:0, nextRetryAt:0, suppressMarks:0, initialized:false, status:'未接続' };
  const CLOUD_CONFIG_KEY = 'npf_cloud_backup_config_v1';
  const CLOUD_PENDING_KEY = 'npf_cloud_backup_pending_v1';
  const CLOUD_URL = 'https://niji-research-backup.dearlylovedxxx.workers.dev';
  const CLOUD_STORES = ['videos','channels','wiki','pairs'];

  function nrhDbEnabled() {
    // Same original DB name/schema, scoped naturally to each browser origin.
    // m.youtube.com and www.youtube.com do NOT share IndexedDB; nor do devices.
    return isYoutubeHost() && typeof indexedDB !== 'undefined';
  }

  function nrhDbOpen() {
    if (!nrhDbEnabled()) return Promise.reject(new Error('IndexedDB unavailable'));
    if (nrhDbPromise) return nrhDbPromise;
    nrhDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NRH_DB_NAME, NRH_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        let videos;
        if (!db.objectStoreNames.contains('videos')) videos = db.createObjectStore('videos', { keyPath: 'id' });
        else videos = req.transaction.objectStore('videos');
        if (!videos.indexNames.contains('channelId')) videos.createIndex('channelId', 'channelId', { unique: false });
        if (!videos.indexNames.contains('availableAt')) videos.createIndex('availableAt', 'availableAt', { unique: false });

        let channels;
        if (!db.objectStoreNames.contains('channels')) channels = db.createObjectStore('channels', { keyPath: 'id' });
        else channels = req.transaction.objectStore('channels');
        if (!channels.indexNames.contains('normalizedName')) channels.createIndex('normalizedName', 'normalizedName', { unique: false });

        if (!db.objectStoreNames.contains('wiki')) db.createObjectStore('wiki', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('pairs')) db.createObjectStore('pairs', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => console.warn('[NRH][DB] upgrade blocked');
    });
    return nrhDbPromise;
  }

  async function nrhDbGet(store, key) {
    const db = await nrhDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function nrhDbGetByIndex(store, indexName, key) {
    const db = await nrhDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).index(indexName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function nrhDbPut(store, value) {
    const db = await nrhDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => { cloudMarkChanged(); resolve(value); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async function nrhDbGetAll(store) {
    const db = await nrhDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function nrhDbCount(store) {
    const db = await nrhDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => resolve(Number(req.result || 0));
      req.onerror = () => reject(req.error);
    });
  }

  async function nrhDbClear(store) {
    const db = await nrhDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function nrhDbMergeVideo(id, patch = {}) {
    if (!id || !nrhDbEnabled()) return null;
    const db = await nrhDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('videos', 'readwrite');
      const store = tx.objectStore('videos');
      const getReq = store.get(id);
      let merged = null;
      getReq.onsuccess = () => {
        merged = { ...(getReq.result || {}), ...patch, id, updatedAt: Date.now() };
        store.put(merged);
      };
      tx.oncomplete = () => { cloudMarkChanged(); resolve(merged); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function nrhMetaTtl(meta = null) {
    const now = Date.now();
    const status = String(meta?.status || '').toLowerCase();
    if (/live|upcoming/.test(status)) return 30 * 60 * 1000;
    const d = meta ? startOf(meta) : null;
    const t = d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
    const age = t ? Math.max(0, now - t) : Infinity;
    if (age < 24 * 60 * 60 * 1000) return 3 * 60 * 60 * 1000;
    if (age < 7 * 24 * 60 * 60 * 1000) return 12 * 60 * 60 * 1000;
    if (age < 30 * 24 * 60 * 60 * 1000) return 7 * 24 * 60 * 60 * 1000;
    if (age < 180 * 24 * 60 * 60 * 1000) return 30 * 24 * 60 * 60 * 1000;
    return 180 * 24 * 60 * 60 * 1000;
  }

  function nrhVideoRecordFresh(record) {
    if (!record?.meta) return false;
    const status = String(record.meta.status || '').toLowerCase();
    const started = startOf(record.meta);
    // 30日以上前の終了済みアーカイブは、ID照合のたびにHolodexへ取り直さない。
    // 新着・配信中は従来どおり短いTTLで更新対象とする。
    if (!/(?:live|upcoming)/.test(status) && started && !Number.isNaN(started.getTime())
        && Date.now() - started.getTime() >= 30 * 24 * 60 * 60 * 1000) return true;
    if (!record.holodexFetchedAt) return false;
    return Number(record.holodexFetchedAt) + nrhMetaTtl(record.meta) > Date.now();
  }

  async function nrhDbSaveChannel(channel) {
    const id = channel?.id || channel?.channel?.id || '';
    if (!id || !nrhDbEnabled()) return;
    const name = channel?.name || channel?.channel?.name || '';
    const englishName = channel?.english_name || channel?.channel?.english_name || '';
    const normalizedName = normalizeCollaboratorName(name || englishName);
    await nrhDbPut('channels', { id, name, englishName, normalizedName, data: channel, fetchedAt: Date.now() });
  }

  async function nrhDbSaveVideoMeta(id, meta) {
    if (!id || !meta || !nrhDbEnabled()) return;
    const channel = meta?.channel || null;
    await nrhDbMergeVideo(id, {
      meta,
      holodexFetchedAt: Date.now(),
      title: meta?.title || '',
      channelId: channel?.id || meta?.channel_id || '',
      channelName: channel?.name || '',
      availableAt: meta?.available_at || meta?.start_actual || meta?.start_scheduled || '',
    });
    if (channel?.id) void nrhDbSaveChannel(channel).catch(() => {});
    for (const m of (meta?.mentions || [])) {
      const c = m?.channel || m;
      if (c?.id) void nrhDbSaveChannel(c).catch(() => {});
    }
  }

  async function nrhDbSaveWikiInfo(id, info, sourceUrl = '') {
    if (!id || !nrhDbEnabled()) return;
    await nrhDbMergeVideo(id, {
      wikiInfo: info || null,
      wikiSourceUrl: sourceUrl || info?.sourceUrl || '',
      wikiFetchedAt: Date.now(),
    });
  }

  async function nrhDbReplaceWikiCache(cacheObj = {}) {
    if (!nrhDbEnabled()) return;
    const db = await nrhDbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('wiki', 'readwrite');
      const store = tx.objectStore('wiki');
      store.clear();
      for (const [key, data] of Object.entries(cacheObj || {})) store.put({ key, data, fetchedAt: Number(data?.fetchedAt || Date.now()) });
      tx.oncomplete = () => { cloudMarkChanged(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function nrhDbLoadWikiCache() {
    if (!nrhDbEnabled()) return {};
    const rows = await nrhDbGetAll('wiki');
    const out = {};
    for (const r of rows) if (r?.key && r?.data) out[r.key] = r.data;
    return out;
  }

  async function nrhHydrateEntryFromDb(entry) {
    if (!entry?.id || !nrhDbEnabled()) return { found: false, fresh: false };
    try {
      const rec = await nrhDbGet('videos', entry.id);
      if (!rec || !entry.el?.isConnected) return { found: false, fresh: false };
      if (rec.meta) {
        entry.meta = rec.meta;
        research.metaCache.set(entry.id, rec.meta);
      }
      if (rec.wikiInfo) {
        entry.wikiInfo = rec.wikiInfo;
        entry.wikiSourceUrl = rec.wikiSourceUrl || rec.wikiInfo?.sourceUrl || '';
        entry.wikiChecked = true;
      }
      if (rec.meta || rec.wikiInfo) renderResearchEntry(entry, !!rec.wikiInfo);
      return { found: !!rec.meta, fresh: nrhVideoRecordFresh(rec), record: rec };
    } catch (err) {
      console.debug('[NRH][DB hydrate]', entry.id, err?.message || err);
      return { found: false, fresh: false };
    }
  }

  async function nrhDbStats() {
    if (!nrhDbEnabled()) return { videos: 0, channels: 0, wiki: 0, pairs: 0 };
    const [videos, channels, wiki, pairs] = await Promise.all(['videos','channels','wiki','pairs'].map(nrhDbCount));
    return { videos, channels, wiki, pairs };
  }

  async function updateResearchDbStatus() {
    // YouTubeのSPA再描画で同一IDの表示が複製されることがあるため、常に1個へ整理する。
    const dbEls = $$('#npf-r-db-status');
    const el = dbEls[0] || null;
    for (const dup of dbEls.slice(1)) dup.remove();
    if (!el) return;
    el.replaceChildren();
    if (!nrhDbEnabled()) { el.textContent = '💾 ローカルDB: 利用不可'; return; }
    try {
      const s = await nrhDbStats();
      const head = document.createElement('div');
      head.className = 'npf-r-db-head';
      head.textContent = `💾 DB蓄積　動画メタ ${s.videos}本 ・ チャンネル ${s.channels}人`;
      const sub = document.createElement('div');
      sub.className = 'npf-r-db-sub';
      sub.textContent = `Wikiキャッシュ ${s.wiki}セット ・ コラボ検索 ${s.pairs}組`;
      sub.title = 'Wikiキャッシュの「セット」は年別ページ等の保存単位です。Wiki一致動画数とは別の数字です。';
      el.append(head, sub);
      el.title = 'ブラウザ内のIndexedDBに保存済みの件数です。画像・動画本体は保存していません。';
    } catch (err) {
      el.textContent = `💾 ローカルDB: 読み込みエラー (${err?.message || err})`;
    }
  }

  async function backupResearchDb() {
    try {
      const stores = {};
      for (const name of ['videos','channels','wiki','pairs']) stores[name] = await nrhDbGetAll(name);
      const payload = { app: 'Niji Research Helper', version: VERSION, dbVersion: NRH_DB_VERSION, exportedAt: new Date().toISOString(), stores };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `niji-research-helper-db-${new Date().toISOString().slice(0,10)}.json`;
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('💾 ローカルDBのバックアップを書き出しました');
    } catch (err) {
      toast(`DBバックアップ失敗: ${err?.message || err}`);
    }
  }

  async function restoreResearchDbFile(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data?.stores || typeof data.stores !== 'object') throw new Error('バックアップ形式が違います');
      const db = await nrhDbOpen();
      for (const name of ['videos','channels','wiki','pairs']) {
        const rows = Array.isArray(data.stores[name]) ? data.stores[name] : [];
        await new Promise((resolve, reject) => {
          const tx = db.transaction(name, 'readwrite');
          const store = tx.objectStore(name);
          for (const row of rows) store.put(row);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      }
      const dbWiki = await nrhDbLoadWikiCache();
      state.wikiCache = { ...(state.wikiCache || {}), ...dbWiki };
      research.metaCache.clear();
      for (const e of currentResearchEntries()) { e.meta = null; e.wikiInfo = null; e.wikiChecked = false; void nrhHydrateEntryFromDb(e); }
      await updateResearchDbStatus();
      cloudMarkChanged();
      toast('📥 ローカルDBを復元しました');
    } catch (err) {
      toast(`DB復元失敗: ${err?.message || err}`);
    }
  }

  async function clearResearchDb() {
    if (!confirm('Niji Research Helper のローカルDBを初期化しますか？\nAPIキー・お気に入り・設定は消えません。')) return;
    try {
      await Promise.all(['videos','channels','wiki','pairs'].map(nrhDbClear));
      research.metaCache.clear();
      research.channelResolveCache.clear();
      state.wikiCache = {};
      await gmSet(KEY_WIKI_CACHE, {});
      await updateResearchDbStatus();
      toast('🗑 ローカルDBを初期化しました');
    } catch (err) {
      toast(`DB初期化失敗: ${err?.message || err}`);
    }
  }

  async function initResearchDb() {
    if (!nrhDbEnabled()) return;
    try {
      await nrhDbOpen();
      const dbWiki = await nrhDbLoadWikiCache();
      // 旧GMキャッシュを初回だけIndexedDBへ移し、以後は両方を同期して互換性を保つ。
      state.wikiCache = { ...dbWiki, ...(state.wikiCache || {}) };
      if (Object.keys(state.wikiCache).length) {
        cloud.suppressMarks++; // legacy cache hydration is not a fresh user change
        try { await nrhDbReplaceWikiCache(state.wikiCache); } finally { cloud.suppressMarks--; }
      }
    } catch (err) {
      console.warn('[NRH][DB init]', err);
    }
  }

  const DEFAULT_SETTINGS = {
    favoriteFirst: true,
    eventFirst: true,
    searchWindowHours: 24,
    youtubeCopyMode: 'title-url',
    autoResearchChannels: [],
  };

  const state = {
    apiKey: '',
    favorites: [],
    liverFavorites: [],
    settings: { ...DEFAULT_SETTINGS },
    sheet: null,
    toastTimer: null,
    observerTimer: null,
    syncPoints: {},
    calibration: {},
    wikiCache: {},
  };

  // ---------- compatibility helpers ----------
  async function gmGet(key, fallback) {
    try {
      const v = await GM.getValue(key, fallback);
      return v ?? fallback;
    } catch (e) {
      console.warn('[NPF] GM.getValue failed', e);
      return fallback;
    }
  }

  async function gmSet(key, value) {
    try {
      await GM.setValue(key, value);
      if ([KEY_FAVS, KEY_LIVER_FAVS, KEY_SETTINGS, KEY_SYNC, KEY_CAL].includes(key)) cloudMarkChanged();
    } catch (e) {
      console.warn('[NPF] GM.setValue failed', e);
    }
  }

  function gmRequest(details) {
    return new Promise((resolve, reject) => {
      try {
        const xhr = GM.xmlHttpRequest || GM.xmlhttpRequest;
        if (!xhr) throw new Error('このUserScript環境はGM.xmlHttpRequestに対応していません');
        xhr({
          ...details,
          onload: resolve,
          onerror: reject,
          ontimeout: () => reject(new Error('通信がタイムアウトしました')),
          timeout: Number(details.timeout) || 20000,
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // ---------- optional pCloud backup through the dedicated, access-limited gateway ----------
  // The gateway has its own limited client token. A pCloud OAuth token and other apps'
  // shared-storage tokens never enter the userscript. No upload or remote delete
  // occurs until explicit opt-in. All cloud restoration requires confirmation.
  function cloudDevice() {
    const ua = navigator.userAgent || '';
    const platform = /iPhone|iPod/i.test(ua) ? 'iphone' : /iPad/i.test(ua) ? 'ipad'
      : /Android/i.test(ua) ? 'android' : 'desktop';
    return `${platform}-${location.hostname.replace(/[^a-z0-9.-]/gi, '-')}`.slice(0, 96);
  }

  function cloudMarkChanged() {
    if (cloud.suppressMarks || !cloud.initialized || !cloud.enabled || !nrhDbEnabled()) return;
    cloud.dirty = true;
    cloud.writes++;
    void GM.setValue(CLOUD_PENDING_KEY, true).catch(() => {});
    cloudSchedule(cloud.writes >= 50 ? 5000 : 90000);
    cloudUpdateUi();
  }

  function cloudSchedule(delay = 90000) {
    if (!cloud.enabled || !cloud.token || !nrhDbEnabled() || !cloud.dirty) return;
    clearTimeout(cloud.timer);
    const now = Date.now();
    const earliest = Math.max(now + delay, cloud.lastSavedAt + 5 * 60 * 1000, cloud.nextRetryAt);
    cloud.timer = setTimeout(() => void cloudBackup(false), Math.max(1000, earliest - now));
  }

  function cloudUpdateUi() {
    const status = document.getElementById('npf-cloud-status');
    if (status) status.textContent = cloud.status;
    const setup = document.getElementById('npf-cloud-setup');
    if (setup) setup.hidden = cloud.enabled;
    const actions = document.getElementById('npf-cloud-actions');
    if (actions) actions.hidden = !cloud.enabled;
    const upload = document.getElementById('npf-cloud-upload');
    if (upload) upload.disabled = cloud.busy || !cloud.enabled;
  }

  async function cloudRequest(method, path, data = null, extra = {}) {
    if (!cloud.token) throw new Error('バックアップ専用トークンが未設定です');
    const res = await gmRequest({ method, url: CLOUD_URL + path,
      headers: { authorization: `Bearer ${cloud.token}`, accept: 'application/json', ...extra },
      ...(data === null ? {} : { data }), timeout: 45000,
    });
    let body;
    try { body = JSON.parse(res.responseText || '{}'); }
    catch { throw new Error(`中継Workerから不正な応答 (HTTP ${res.status})`); }
    if (res.status < 200 || res.status >= 300 || !body.ok)
      throw new Error(`HTTP ${res.status}: ${String(body.error || '取得失敗').slice(0, 100)}`);
    return body;
  }

  async function cloudSnapshot() {
    const stores = {};
    for (const name of CLOUD_STORES) stores[name] = await nrhDbGetAll(name);
    return { app:'Niji Research Helper', version:VERSION, dbVersion:NRH_DB_VERSION,
      exportedAt:new Date().toISOString(), sourceOrigin:location.origin,
      device:cloudDevice(), stores,
      // The Holodex API key and cloud token are deliberately NEVER uploaded.
      preferences: { favorites:state.favorites, liverFavorites:state.liverFavorites,
        settings:state.settings, syncPoints:state.syncPoints, calibration:state.calibration } };
  }

  async function cloudBackup(force = false) {
    if (cloud.busy || !cloud.enabled || !cloud.token || !nrhDbEnabled()) return;
    if (!force && (!cloud.dirty || Date.now() < cloud.nextRetryAt)) return;
    cloud.busy = true;
    clearTimeout(cloud.timer);
    const initialWrites = cloud.writes;
    let uploadSha = '';
    let uploadSize = 0;
    cloud.status = '☁️ バックアップを作成中…'; cloudUpdateUi();
    try {
      const payload = await cloudSnapshot();
      const populated = CLOUD_STORES.some(name => payload.stores[name].length)
        || payload.preferences.favorites?.length || payload.preferences.liverFavorites?.length
        || Object.keys(payload.preferences.syncPoints || {}).length;
      if (!populated) throw new Error('DBが空のため、既存バックアップの保護を優先して保存しません');
      // Send JSON text: Macaque may alter ArrayBuffer request bodies.
      const jsonText = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(jsonText);
      if (bytes.byteLength > 20 * 1024 * 1024)
        throw new Error('バックアップが20MBを超えました。ローカルJSONを先に退避してください');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
      uploadSha = sha; uploadSize = bytes.byteLength;
      const result = await cloudRequest('POST', '/v1/backups', jsonText, {
        'content-type':'application/json', 'x-nrh-device':cloudDevice(),
        'x-nrh-origin':location.origin, 'x-nrh-sha256':sha, 'x-nrh-version':VERSION,
      });
      cloud.lastSavedAt = Date.now(); cloud.nextRetryAt = 0;
      cloud.status = `☁️ ${new Date().toLocaleString('ja-JP')} 保存済み${result.cleanupPending ? '（古い世代の削除が保留中）' : ''}`;
      if (initialWrites === cloud.writes) {
        cloud.dirty = false; cloud.writes = 0;
        await GM.setValue(CLOUD_PENDING_KEY, false);
      }
      await GM.setValue(CLOUD_CONFIG_KEY, { enabled:true, token:cloud.token, lastSavedAt:cloud.lastSavedAt });
      if (force) toast('☁️ pCloudへのバックアップが完了しました');
    } catch (e) {
  // A Macaque POST error may arrive after the Worker has stored the data.
  // Confirm the exact SHA and stored bytes before retrying or claiming failure.
  let confirmed = false;
  if (uploadSha && uploadSize && cloud.enabled && cloud.token) {
    try {
      const list = await cloudRequest('GET', '/v1/backups?device=' + encodeURIComponent(cloudDevice()));
      const match = list.backups?.find(b => b.sha256 === uploadSha
        && b.size === uploadSize && b.origin === location.origin);
      if (match) {
        const res = await gmRequest({method:'GET',
          url:CLOUD_URL + '/v1/backups/' + encodeURIComponent(match.id),
          headers:{authorization:`Bearer ${cloud.token}`}, responseType:'text', timeout:45000});
        const text = typeof res.responseText === 'string' ? res.responseText
          : typeof res.response === 'string' ? res.response : '';
        if (res.status === 200 && text) {
          const received = new TextEncoder().encode(text);
          if (received.byteLength === uploadSize) {
            const digest = await crypto.subtle.digest('SHA-256', received);
            const remoteSha = [...new Uint8Array(digest)]
              .map(x => x.toString(16).padStart(2, '0')).join('');
            confirmed = remoteSha === uploadSha;
          }
        }
      }
    } catch (verifyError) {
      console.warn('[NRH][cloud post-response verification]', verifyError);
    }
  }
  if (confirmed) {
    cloud.lastSavedAt = Date.now(); cloud.nextRetryAt = 0;
    cloud.status = `✅ ${new Date().toLocaleString('ja-JP')} 保存済みファイルを再照合しました`;
    if (initialWrites === cloud.writes) {
      cloud.dirty = false; cloud.writes = 0;
      void GM.setValue(CLOUD_PENDING_KEY, false).catch(() => {});
    }
    void GM.setValue(CLOUD_CONFIG_KEY, { enabled:true, token:cloud.token,
      lastSavedAt:cloud.lastSavedAt }).catch(() => {});
    if (force) toast('☁️ pCloudの保存済みファイルを照合しました');
  } else {
    const detail = typeof e?.message === 'string' && e.message ? e.message
      : typeof e?.error === 'string' && e.error ? e.error
      : e?.status ? `通信エラー（HTTP ${e.status}）` : '通信エラー（詳細不明）';
    cloud.status = `⚠️ バックアップ未確認：${detail.slice(0, 110)}`;
    cloud.dirty = true;
    cloud.nextRetryAt = Date.now() + 15 * 60 * 1000;
    void GM.setValue(CLOUD_PENDING_KEY, true).catch(() => {});
    if (force) toast(cloud.status);
    console.warn('[NRH][cloud]', e);
  }
    } finally {
      cloud.busy = false; cloudUpdateUi();
      if (cloud.dirty) cloudSchedule(90000);
    }
  }

  async function cloudEnable() {
    const input = document.getElementById('npf-cloud-token');
    const token = String(input?.value || '').trim();
    if (token.length < 24) { toast('Cloudflareに設定したバックアップ専用トークンを入力してください'); return; }
    const previous = cloud.token;
    cloud.token = token;
    cloud.status = '☁️ 接続を確認中…'; cloudUpdateUi();
    try {
      const status = await cloudRequest('GET', '/v1/status');
      if (!status.connected || !status.remoteOk) throw new Error('pCloudが未接続です。中継Workerの設定を確認してください');
      cloud.enabled = true;
      cloud.dirty = true;
      cloud.writes++;
      cloud.status = '☁️ 接続済み。初回バックアップを作成します';
      await GM.setValue(CLOUD_CONFIG_KEY, { enabled:true, token, lastSavedAt:0 });
      await GM.setValue(CLOUD_PENDING_KEY, true);
      if (input) input.value = '';
      cloudUpdateUi();
      await cloudBackup(true);
    } catch (e) {
      cloud.token = previous;
      cloud.status = `⚠️ 接続できません：${String(e?.message || e).slice(0, 100)}`;
      cloudUpdateUi();
    }
  }

  async function cloudDisable() {
    if (!confirm('この端末の自動バックアップを停止しますか？ pCloudのバックアップとローカルDBは削除されません。')) return;
    cloud.enabled = false; cloud.token = ''; cloud.dirty = false;
    clearTimeout(cloud.timer);
    cloud.status = '自動バックアップは停止中。クラウド上のデータは残っています';
    await GM.setValue(CLOUD_CONFIG_KEY, { enabled:false, token:'', lastSavedAt:0 });
    cloudUpdateUi();
  }

  async function cloudRestore(backup) {
    if (!confirm(`${backup.device} / ${new Date(backup.createdAt).toLocaleString('ja-JP')} のバックアップを\nこのブラウザのDBに統合しますか？\n\n既存データは削除せず、日時が新しいレコードを優先します。APIキーは復元されません。`)) return;
    cloud.status = '📥 クラウドから読み込み中…'; cloudUpdateUi();
    try {
      const res = await gmRequest({ method:'GET', url:CLOUD_URL + '/v1/backups/' + encodeURIComponent(backup.id),
        headers:{ authorization:`Bearer ${cloud.token}` }, responseType:'arraybuffer', timeout:45000 });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const raw = res.response instanceof ArrayBuffer ? new Uint8Array(res.response)
        : ArrayBuffer.isView(res.response) ? new Uint8Array(res.response.buffer, res.response.byteOffset, res.response.byteLength)
          : new TextEncoder().encode(res.responseText || String(res.response || ''));
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))]
        .map(x => x.toString(16).padStart(2,'0')).join('');
      if (sha !== backup.sha256) throw new Error('チェックサム不一致。復元を中止しました');
      const data = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(raw));
      if (data.app !== 'Niji Research Helper' || data.dbVersion !== NRH_DB_VERSION
        || CLOUD_STORES.some(name => !Array.isArray(data.stores?.[name]))) throw new Error('バックアップ形式が違います');
      const db = await nrhDbOpen();
      for (const name of CLOUD_STORES) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(name, 'readwrite');
          const store = tx.objectStore(name);
          for (const row of data.stores[name]) {
            if (!row || typeof row !== 'object') continue;
            const key = name === 'videos' || name === 'channels' ? row.id : row.key;
            if (typeof key !== 'string' || !key) continue;
            const req = store.get(key);
            req.onsuccess = () => {
              const local = req.result;
              const ts = obj => Math.max(Number(obj?.updatedAt || 0), Number(obj?.holodexFetchedAt || 0),
                Number(obj?.wikiFetchedAt || 0), Number(obj?.fetchedAt || 0));
              if (!local || ts(row) > ts(local)) store.put(row);
            };
          }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('DB復元中断'));
        });
      }
      const pref = data.preferences || {};
      const mergeFavs = (local, remote, keyFn) => {
        const out = Array.isArray(local) ? [...local] : [];
        const seen = new Set(out.map(keyFn));
        for (const x of Array.isArray(remote) ? remote : []) {
          const key = keyFn(x);
          if (key && !seen.has(key)) { out.push(x); seen.add(key); }
        }
        return out;
      };
      state.favorites = mergeFavs(state.favorites, pref.favorites, x => x?.id || x?.name);
      state.liverFavorites = mergeFavs(state.liverFavorites, pref.liverFavorites, x => x?.value || x?.name);
      await GM.setValue(KEY_FAVS, state.favorites);
      await GM.setValue(KEY_LIVER_FAVS, state.liverFavorites);
      // Add missing sync data; never overwrite edits made on this browser.
      state.syncPoints = { ...(pref.syncPoints || {}), ...(state.syncPoints || {}) };
      state.calibration = { ...(pref.calibration || {}), ...(state.calibration || {}) };
      await GM.setValue(KEY_SYNC, state.syncPoints);
      await GM.setValue(KEY_CAL, state.calibration);
      if (pref.settings && typeof pref.settings === 'object' &&
          JSON.stringify(state.settings) === JSON.stringify(DEFAULT_SETTINGS)) {
        state.settings = { ...DEFAULT_SETTINGS, ...pref.settings };
        await GM.setValue(KEY_SETTINGS, state.settings);
      }
      cloudMarkChanged();
      state.wikiCache = { ...state.wikiCache, ...await nrhDbLoadWikiCache() };
      research.metaCache.clear();
      await updateResearchDbStatus();
      cloud.status = '📥 クラウドバックアップを統合しました'; cloudUpdateUi();
      toast('📥 クラウドバックアップを統合しました');
    } catch (e) {
      cloud.status = `⚠️ 復元失敗：${String(e?.message || e).slice(0, 120)}`; cloudUpdateUi();
      toast(cloud.status);
    }
  }

  // Read-only end-to-end check: fetch the existing backup, validate bytes and JSON,
  // and never restore it or write a new backup. Token is not persisted.
  async function cloudVerifyLatest() {
    const input = document.getElementById('npf-cloud-token');
    const button = document.getElementById('npf-cloud-verify');
    const token = String(input?.value || '').trim();
    if (token.length < 24) {
      cloud.status = '検証にはバックアップ専用トークンが必要です'; cloudUpdateUi(); return;
    }
    if (button) button.disabled = true;
    cloud.status = '📥 保存済みバックアップを読み取り検証中…'; cloudUpdateUi();
    try {
      const get = async path => {
        const res = await gmRequest({ method:'GET', url:CLOUD_URL + path,
          headers:{ authorization:`Bearer ${token}`, accept:'application/json' },
          responseType:'text', timeout:45000 });
        const text = typeof res.responseText === 'string' ? res.responseText
          : typeof res.response === 'string' ? res.response : null;
        if (text === null) throw new Error('Macaqueが応答を文字列で返しませんでした');
        if (res.status !== 200) {
          let detail = '';
          try { detail = JSON.parse(text)?.error || ''; } catch {}
          throw new Error(`HTTP ${res.status}${detail ? ': ' + String(detail).slice(0, 60) : ''}`);
        }
        return text;
      };
      const listed = JSON.parse(await get('/v1/backups'));
      if (!listed.ok || !Array.isArray(listed.backups)) throw new Error('バックアップ一覧の形式が違います');
      const item = listed.backups.find(x => x.device === cloudDevice() && x.origin === location.origin);
      if (!item) throw new Error('この端末・YouTube URLのバックアップが見つかりません');
      const text = await get('/v1/backups/' + encodeURIComponent(item.id));
      const bytes = new TextEncoder().encode(text);
      if (bytes.byteLength !== item.size) throw new Error('取得ファイルのサイズが一致しません');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
      if (sha !== item.sha256) throw new Error('取得ファイルのチェックサムが一致しません');
      const data = JSON.parse(text);
      if (data.app !== 'Niji Research Helper' || data.dbVersion !== NRH_DB_VERSION
          || data.device !== item.device || data.sourceOrigin !== item.origin
          || CLOUD_STORES.some(name => !Array.isArray(data.stores?.[name])))
        throw new Error('取得ファイルのデータ形式が違います');
      cloud.status = `✅ 保存済みファイルの読み取り・整合性確認OK（${new Date(item.createdAt).toLocaleString('ja-JP')}、動画${data.stores.videos.length}件、お気に入り${data.preferences?.favorites?.length || 0}件）。DBは変更していません。`;
    } catch (e) {
      cloud.status = `⚠️ 読み取り検証失敗：${String(e?.message || e?.error?.message || e?.statusText || e?.status || '通信エラー').slice(0, 110)}`;
    } finally {
      if (input) input.value = '';
      if (button) button.disabled = false;
      cloudUpdateUi();
    }
  }

  async function cloudShowBackups() {
    const list = document.getElementById('npf-cloud-list');
    if (!list) return;
    list.textContent = 'バックアップ一覧を取得中…';
    try {
      const result = await cloudRequest('GET', '/v1/backups');
      list.replaceChildren();
      if (!result.backups?.length) { list.textContent = 'まだクラウドバックアップがありません'; return; }
      for (const item of result.backups) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'npf-r-btn';
        btn.style.cssText = 'display:block;width:100%;text-align:left;margin:6px 0;white-space:normal;';
        btn.textContent = `📥 ${item.device} / ${new Date(item.createdAt).toLocaleString('ja-JP')} (${(item.size/1024/1024).toFixed(1)} MB)`;
        btn.addEventListener('click', () => void cloudRestore(item)); list.appendChild(btn);
      }
    } catch (e) { list.textContent = `一覧取得失敗：${String(e?.message || e).slice(0, 110)}`; }
  }

  function createCloudBackupUi() {
    const wrap = document.createElement('section'); wrap.id = 'npf-cloud-backup';
    wrap.style.cssText = 'border:1px solid #63769a;border-radius:12px;padding:10px;margin:12px 0;';
    const heading = document.createElement('div'); heading.textContent = '☁️ pCloud 自動バックアップ（任意）';
    heading.style.cssText = 'font-weight:700;margin-bottom:6px;';
    const status = document.createElement('div'); status.id = 'npf-cloud-status';
    status.style.cssText = 'font-size:12px;overflow-wrap:anywhere;margin-bottom:7px;';
    const setup = document.createElement('div'); setup.id = 'npf-cloud-setup';
    const token = document.createElement('input'); token.id = 'npf-cloud-token'; token.type = 'password';
    token.className = 'npf-r-input'; token.placeholder = 'バックアップ専用トークン（pCloudのAPIキーではありません）';
    token.autocomplete = 'off'; token.style.cssText = 'display:block;width:100%;margin:5px 0;';
    const enable = document.createElement('button'); enable.type = 'button'; enable.className = 'npf-r-btn';
    enable.textContent = '🔒 接続して自動保存を有効化'; enable.addEventListener('click', () => void cloudEnable());
    const note = document.createElement('div'); note.className = 'npf-r-note';
    note.textContent = '専用Workerの導入後に有効化。Holodex APIキーは送信しません。ブラウザを閉じている間は自動実行されません。';
    const verify = document.createElement('button'); verify.type = 'button'; verify.id = 'npf-cloud-verify';
    verify.className = 'npf-r-btn'; verify.textContent = '🔎 保存済みバックアップを検証（復元なし）';
    verify.addEventListener('click', () => void cloudVerifyLatest());
    setup.append(token, enable, verify, note);
    const actions = document.createElement('div'); actions.id = 'npf-cloud-actions';
    const upload = document.createElement('button'); upload.id = 'npf-cloud-upload'; upload.type = 'button';
    upload.className = 'npf-r-btn'; upload.textContent = '☁️ 今すぐ保存';
    upload.addEventListener('click', () => void cloudBackup(true));
    const show = document.createElement('button'); show.type = 'button'; show.className = 'npf-r-btn';
    show.textContent = '📥 バックアップ一覧・復元'; show.addEventListener('click', () => void cloudShowBackups());
    const disable = document.createElement('button'); disable.type = 'button'; disable.className = 'npf-r-btn';
    disable.textContent = '⏸ 自動保存を停止'; disable.addEventListener('click', () => void cloudDisable());
    actions.append(upload, show, disable);
    const list = document.createElement('div'); list.id = 'npf-cloud-list';
    wrap.append(heading, status, setup, actions, list);
    cloudUpdateUi();
    return wrap;
  }

  async function cloudInitialize() {
    if (!nrhDbEnabled()) return;
    const saved = await gmGet(CLOUD_CONFIG_KEY, { enabled:false });
    cloud.enabled = saved?.enabled === true && typeof saved.token === 'string' && !!saved.token;
    cloud.token = cloud.enabled ? saved.token : '';
    cloud.lastSavedAt = Number(saved?.lastSavedAt || 0);
    cloud.dirty = cloud.enabled && (await gmGet(CLOUD_PENDING_KEY, false) === true || !cloud.lastSavedAt);
    cloud.initialized = true;
    cloud.status = cloud.enabled ? '☁️ 自動保存オン' : '未接続（ローカルDBはそのまま）';
    cloudUpdateUi();
    if (cloud.dirty) cloudSchedule(5000);
  }

  async function apiGet(path) {
    if (!state.apiKey) throw new Error('Holodex APIキーが未設定です');
    const res = await gmRequest({
      method: 'GET',
      url: API + path,
      headers: {
        'X-APIKEY': state.apiKey,
        'Accept': 'application/json',
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Holodex APIキーが正しくないか、利用できません');
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Holodex APIエラー (${res.status})`);
    }

    try {
      return JSON.parse(res.responseText);
    } catch {
      throw new Error('Holodex APIの応答を読み取れませんでした');
    }
  }


  async function apiPost(path, body) {
    if (!state.apiKey) throw new Error('Holodex APIキーが未設定です');
    const res = await gmRequest({
      method: 'POST',
      url: API + path,
      headers: {
        'X-APIKEY': state.apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      data: JSON.stringify(body || {}),
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Holodex APIキーが正しくないか、利用できません');
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Holodex APIエラー (${res.status})`);
    }

    try {
      return JSON.parse(res.responseText);
    } catch {
      throw new Error('Holodex APIの応答を読み取れませんでした');
    }
  }

  // ---------- styles ----------
  try {
    GM.addStyle(`
    .npf-inline-btn {
      appearance:none!important; -webkit-appearance:none!important;
      border:1px solid #5575d9!important; background:#eef3ff!important; color:#2446a8!important;
      border-radius:999px!important; padding:5px 10px!important; margin:5px 6px!important;
      font-size:12px!important; font-weight:700!important; line-height:1.3!important;
      cursor:pointer!important; white-space:nowrap!important; vertical-align:middle!important;
      box-shadow:0 1px 4px rgba(0,0,0,.08)!important;
    }
    .npf-inline-btn:hover { background:#dfe8ff!important; }
    #npf-yt-widget {
      position:static !important; width:0 !important; height:0 !important; margin:0 !important; padding:0 !important;
      overflow:visible !important; contain:none !important;
    }
    #npf-fab {
      position:fixed; right:16px; bottom:18px; z-index:2147483645;
      border:0; border-radius:999px; width:52px; height:52px;
      background:linear-gradient(135deg,#5f7cff,#835ff6); color:white;
      font-weight:900; font-size:12px; box-shadow:0 8px 28px rgba(55,65,120,.35);
      cursor:pointer; user-select:none; -webkit-user-select:none;
      display:flex; align-items:center; justify-content:center;
      list-style:none; box-sizing:border-box;
    }
    /* comment2434の主ボタンはORアドオン（左側）と重ならない右下配置 */
    #npf-fab.npf-comment-fab {
      width:auto!important; min-width:104px!important; height:48px!important;
      padding:0 15px!important; font-size:13px!important; letter-spacing:.01em;
      background:linear-gradient(135deg,#276a83,#4e68c5)!important;
      box-shadow:0 5px 20px rgba(14,61,91,.35)!important;
    }
    #npf-fab::-webkit-details-marker { display:none; }
    #npf-fab::marker { display:none; content:''; }
    #npf-yt-widget[open] > #npf-fab {
      box-shadow:0 8px 28px rgba(55,65,120,.35), 0 0 0 3px rgba(126,102,255,.2);
    }
    #npf-sheet-backdrop {
      display:none; position:fixed; inset:0; z-index:2147483646;
      background:rgba(0,0,0,.48); backdrop-filter:blur(2px);
    }
    #npf-sheet-backdrop.npf-open { display:block; }
    #npf-sheet {
      position:absolute; left:50%; bottom:0; transform:translateX(-50%);
      width:min(760px,100%); max-height:88vh; overflow:auto;
      background:#0f131b; color:#edf2f7; border-radius:22px 22px 0 0;
      border:1px solid #2b3446; box-shadow:0 -20px 60px rgba(0,0,0,.35);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif;
    }
    .npf-head {
      position:sticky; top:0; z-index:4; display:flex; align-items:center; justify-content:space-between;
      gap:10px; padding:13px 16px; background:rgba(15,19,27,.95);
      border-bottom:1px solid #2b3446; backdrop-filter:blur(12px);
    }
    .npf-title { font-size:15px; font-weight:850; }
    .npf-sub { color:#99a6b8; font-size:11px; margin-top:2px; }
    .npf-x, .npf-ghost, .npf-primary, .npf-star {
      appearance:none; border-radius:10px; cursor:pointer; font:inherit;
    }
    .npf-x { width:36px; height:36px; border:1px solid #354158; background:#171e2a; color:#e8edf5; }
    .npf-body { padding:14px 14px 28px; }
    .npf-source {
      padding:12px; border:1px solid #303a4e; border-radius:14px; background:#151b25; margin-bottom:12px;
    }
    .npf-source-title { font-size:14px; font-weight:800; line-height:1.45; }
    .npf-meta { color:#9eabba; font-size:11px; line-height:1.6; margin-top:5px; }
    .npf-toolbar { display:flex; gap:7px; flex-wrap:wrap; margin:10px 0 12px; }
    .npf-primary {
      border:0; background:linear-gradient(135deg,#6c83ff,#8c6af5); color:#fff;
      padding:9px 11px; font-size:12px; font-weight:800;
    }
    .npf-ghost {
      border:1px solid #354158; background:#171e2a; color:#dbe2ec;
      padding:8px 10px; font-size:12px; font-weight:700;
    }
    .npf-results { display:grid; gap:9px; }
    .npf-card {
      display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center;
      border:1px solid #2f394c; background:#141a24; border-radius:14px; padding:11px;
    }
    .npf-card.npf-fav { border-color:#7768dc; box-shadow:inset 3px 0 0 #8e76ff; }
    .npf-card-title { font-size:13px; font-weight:780; line-height:1.4; }
    .npf-channel { color:#c4ccd7; font-size:12px; margin-top:4px; }
    .npf-badges { display:flex; gap:5px; flex-wrap:wrap; margin-top:6px; }
    .npf-badge {
      border:1px solid #38445a; border-radius:999px; color:#aeb9c9; background:#111720;
      padding:3px 7px; font-size:10px;
    }
    .npf-badge.event { border-color:#685caa; color:#c9bfff; }
    .npf-badge.relation { border-color:#3f7d68; color:#a8e7ca; }
    .npf-sync-note {
      margin-top:7px; padding:7px 9px; border-radius:9px;
      border:1px solid #4d5f91; background:#12192a; color:#cbd6ff;
      font-size:11px; font-weight:700;
    }
    a.npf-sync-ts-selected {
      background:#e9edff!important; color:#4f5fe7!important;
      border-radius:7px!important; box-shadow:0 0 0 2px rgba(91,105,240,.18)!important;
      padding:1px 3px!important; text-decoration:none!important;
    }
    a.npf-sync-ts-bound { cursor:pointer!important; }
    #npf-ts-confirm {
      position:fixed!important; inset:0!important; z-index:2147483647!important;
      display:flex!important; align-items:center!important; justify-content:center!important;
      padding:16px!important; box-sizing:border-box!important;
      background:rgba(5,9,20,.60)!important; backdrop-filter:blur(3px)!important;
      font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif!important;
    }
    #npf-ts-confirm[hidden] { display:none!important; }
    #npf-ts-confirm .npf-ts-dialog {
      width:min(380px,100%)!important; border-radius:18px!important; padding:20px!important;
      background:#151d2c!important; color:#f1f5ff!important;
      border:1px solid #62718e!important; box-shadow:0 18px 52px #0007!important;
      box-sizing:border-box!important;
    }
    #npf-ts-confirm .npf-ts-actions { display:flex!important; flex-wrap:wrap!important; gap:9px!important; margin-top:18px!important; }
    #npf-ts-confirm .npf-ts-actions>* {
      flex:1 1 135px!important; min-height:44px!important; padding:11px 8px!important;
      border-radius:11px!important; text-align:center!important; text-decoration:none!important;
      font:700 13px -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif!important;
      box-sizing:border-box!important; cursor:pointer!important;
    }
    #npf-ts-confirm .npf-ts-actions button { border:1px solid #6f7c98!important; background:#29354b!important; color:white!important; }
    #npf-ts-confirm .npf-ts-actions a { border:1px solid #7d92ef!important; background:#6275e5!important; color:white!important; }
    .npf-pov-intro { color:#c0ccde; font-size:12px; line-height:1.65; margin:3px 0 14px; }
    .npf-pov-error { color:#ffb8c3; font-size:12px; min-height:18px; margin-top:7px; }
    .npf-pov-tools { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
    .npf-more-row { margin-top:10px; display:flex; justify-content:center; }
    .npf-cal-row {
      display:flex; gap:5px; flex-wrap:wrap; align-items:center; margin-top:8px;
    }
    .npf-cal-label {
      font-size:10px; color:#aeb9c9; margin-right:2px;
    }
    .npf-cal-btn {
      appearance:none; border:1px solid #39465d; background:#101722; color:#d9e1ed;
      border-radius:8px; padding:4px 7px; font-size:10px; font-weight:700; cursor:pointer;
    }
    .npf-cal-btn.active { border-color:#7666e8; color:#d4ccff; background:#19172a; }
    .npf-actions { display:grid; gap:6px; min-width:105px; }
    .npf-star {
      border:1px solid #4a5264; background:#1b2230; color:#f0d77f; padding:6px 8px; font-size:11px;
    }
    .npf-empty, .npf-loading, .npf-error {
      padding:20px 12px; text-align:center; border:1px dashed #354158; border-radius:14px;
      color:#9eabba; font-size:13px; line-height:1.7;
    }
    .npf-error { color:#ffadb7; border-color:#70414a; }
    .npf-settings { display:grid; gap:12px; }
    .npf-label { color:#cbd3df; font-size:12px; font-weight:700; }
    .npf-input, .npf-select {
      width:100%; box-sizing:border-box; margin-top:6px; border:1px solid #354158; border-radius:10px;
      padding:10px 11px; background:#0d1219; color:#edf2f7; font:inherit; font-size:13px;
    }
    .npf-check { display:flex; align-items:center; gap:8px; color:#d5dce6; font-size:12px; }
    .npf-fav-list { display:grid; gap:6px; }
    .npf-fav-row {
      display:flex; align-items:center; justify-content:space-between; gap:8px;
      padding:8px 10px; border-radius:10px; background:#151b25; border:1px solid #2f394c;
      font-size:12px;
    }
    .npf-channel-favs, .npf-liver-favs {
      margin:8px 0 10px; padding:9px 10px;
      border:1px solid #d9def0; border-radius:12px;
      background:#f8f9ff; color:#29324a;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif;
    }
    .npf-channel-favs-head {
      display:flex; align-items:center; justify-content:space-between;
      gap:8px; margin-bottom:7px;
    }
    .npf-channel-favs-title {
      font-size:12px; font-weight:800; color:#4d5874;
    }
    .npf-channel-favs-list {
      display:flex; flex-wrap:wrap; gap:6px;
    }
    .npf-channel-chip {
      appearance:none; -webkit-appearance:none;
      border:1px solid #c7cee4; background:white; color:#3c4968;
      border-radius:999px; padding:6px 10px;
      font-size:12px; font-weight:700; line-height:1.2; cursor:pointer;
    }
    .npf-channel-chip.selected {
      border-color:#6b72dd; background:#eceeff; color:#4d53c6;
      box-shadow:0 0 0 2px rgba(107,114,221,.12);
    }
    .npf-channel-fav-add {
      appearance:none; -webkit-appearance:none;
      border:0; background:transparent; color:#5b63cc;
      font-size:11px; font-weight:800; padding:3px 0; cursor:pointer;
      white-space:nowrap;
    }
    .npf-channel-favs-empty {
      font-size:11px; color:#7e879e;
    }
    .npf-liver-fav-item { display:inline-flex; align-items:center; gap:2px; max-width:100%; }
    .npf-liver-remove {
      appearance:none; -webkit-appearance:none; border:1px solid #c7cee4;
      background:#f0f2ff; color:#555e80; border-radius:50%;
      width:27px; height:27px; padding:0; font-size:17px; line-height:1;
      cursor:pointer; flex-shrink:0;
    }
    #npf-toast {
      display:none; position:fixed; left:50%; bottom:82px; transform:translateX(-50%);
      z-index:2147483647; max-width:min(520px,88vw);
      background:#1a2230; color:#eef2f7; border:1px solid #3b4961; border-radius:12px;
      padding:10px 13px; font-size:12px; box-shadow:0 10px 30px rgba(0,0,0,.3);
    }
    #npf-toast.show { display:block; }
    #npf-yt-panel {
      display:none; position:fixed !important; right:16px !important; bottom:82px !important; left:auto !important; top:auto !important; margin:0 !important; z-index:2147483646 !important;
      width:min(540px,calc(100vw - 24px)); min-width:min(320px,calc(100vw - 24px));
      max-width:calc(100vw - 24px) !important; box-sizing:border-box;
      border:1px solid #353b47; border-radius:16px; background:rgba(20,20,23,.97); color:#f1f1f1;
      box-shadow:0 14px 42px rgba(0,0,0,.38); overflow:auto; max-height:calc(100vh - 110px);
      font-family:Roboto,Arial,"Noto Sans JP",sans-serif;
      backdrop-filter:blur(12px);
      visibility:hidden; opacity:0; pointer-events:none;
    }
    #npf-yt-panel.npf-visible {
      display:block !important; visibility:visible !important; opacity:1 !important; pointer-events:auto !important;
    }
    .npf-yt-head {
      display:flex; align-items:center; justify-content:space-between; gap:8px;
      padding:10px 12px; border-bottom:1px solid #34343a; background:#202024;
    }
    .npf-yt-head-title { font-size:13px; font-weight:800; flex:1; min-width:0; }
    #npf-yt-resize { appearance:none; border:1px solid #50576c; border-radius:8px;
      background:#303547; color:#f2f2ff; padding:5px 9px; min-width:70px; height:33px;
      font:700 11px/1.2 system-ui; cursor:ew-resize; touch-action:none; user-select:none;
      flex:none; }
    #npf-yt-resize:hover { background:#454c68; }
    .npf-yt-close {
      appearance:none; border:0; background:transparent; color:#aaa; cursor:pointer;
      width:28px; height:28px; border-radius:999px; font-size:16px;
    }
    .npf-yt-close:hover { background:#333; color:#fff; }
    .npf-yt-body { padding:11px 12px 12px; }
    .npf-yt-video-title {
      font-size:12px; font-weight:700; line-height:1.45; color:#e8e8e8;
      overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
    }
    .npf-yt-channel { margin-top:4px; color:#aaa; font-size:11px; }
    .npf-yt-timebox {
      display:flex; align-items:baseline; justify-content:space-between; gap:10px;
      margin-top:10px; padding:9px 10px; border-radius:11px; background:#0f0f11; border:1px solid #303036;
    }
    .npf-yt-time-label { color:#9a9aa2; font-size:10px; font-weight:700; }
    #npf-yt-current-time { font-size:20px; font-weight:900; font-variant-numeric:tabular-nums; letter-spacing:.2px; }
    #npf-yt-sync-status { color:#aaa; font-size:10px; text-align:right; }
    .npf-yt-seek { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-top:8px; }
    .npf-yt-btn {
      appearance:none; border:1px solid #3d3d44; border-radius:9px; background:#27272c; color:#eee;
      min-height:32px; padding:6px 8px; cursor:pointer; font-size:11px; font-weight:750;
    }
    .npf-yt-btn:hover { background:#34343a; }
    .npf-yt-btn.primary { border-color:#635bde; background:#554bc7; color:white; }
    .npf-yt-btn.primary:hover { background:#6359dd; }
    .npf-yt-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:9px; }
    .npf-yt-actions .wide { grid-column:1 / -1; }
    .npf-yt-copy-pref {
      display:flex; align-items:center; gap:8px; margin-top:7px; padding:7px 8px;
      border:1px solid #34343a; border-radius:9px; background:#1d1d21; color:#aaa; font-size:10px;
    }
    .npf-yt-copy-pref label { white-space:nowrap; font-weight:700; }
    .npf-yt-copy-pref select {
      flex:1; min-width:0; height:28px; border:1px solid #44444c; border-radius:7px;
      background:#27272c; color:#eee; padding:3px 7px; font-size:11px; outline:none;
    }
    .npf-yt-divider { height:1px; background:#34343a; margin:10px 0 8px; }
    .npf-yt-note { color:#8f8f96; font-size:10px; line-height:1.45; }
    .npf-yt-results { margin-top:10px; display:grid; gap:7px; }
    .npf-yt-result-summary { font-size:10px; color:#aaa; font-weight:700; padding:2px 1px; }
    .npf-yt-result-empty {
      border:1px dashed #41414a; border-radius:10px; padding:12px 9px;
      color:#aaa; font-size:11px; line-height:1.5; text-align:center;
    }
    .npf-yt-result-empty.error { color:#ffb1ba; border-color:#70414a; }
    .npf-yt-result-card {
      border:1px solid #383840; border-radius:10px; padding:9px;
      background:#1c1c21;
    }
    .npf-yt-result-card.fav { border-color:#7565de; box-shadow:inset 3px 0 0 #8a76ff; }
    .npf-yt-result-title { font-size:11px; font-weight:800; line-height:1.4; color:#eee; }
    .npf-yt-result-channel { margin-top:3px; font-size:10px; color:#bdbdc5; }
    .npf-yt-result-meta { margin-top:4px; font-size:9px; color:#92929b; line-height:1.4; }
    .npf-yt-result-actions { margin-top:7px; display:flex; gap:5px; flex-wrap:wrap; }
    .npf-yt-result-actions .npf-yt-btn { min-height:27px; padding:4px 7px; }
    .npf-yt-cal-btn {
      appearance:none; border:1px solid #444450; border-radius:8px; background:#18181c; color:#ddd;
      min-width:34px; height:27px; padding:3px 6px; cursor:pointer; font-size:10px; font-weight:700;
    }
    .npf-yt-show-more { width:100%; }
    /* ---------- YouTube archive research ---------- */
    #npf-research-fab {
      position:fixed; right:78px; bottom:18px; z-index:2147483645;
      border:0; border-radius:999px; min-width:60px; height:52px; padding:0 12px;
      background:#16181d; color:#f0f0f0; box-shadow:0 8px 28px rgba(0,0,0,.28);
      font:800 11px/1 Roboto,Arial,"Noto Sans JP",sans-serif; cursor:pointer;
    }
    #npf-research-fab:hover { background:#282b32; }
    #npf-research-fab.npf-open { box-shadow:0 8px 28px rgba(0,0,0,.28),0 0 0 3px rgba(126,102,255,.22); }
    #npf-research-panel {
      display:none; position:fixed; right:16px; bottom:82px; z-index:2147483646;
      width:min(390px,calc(100vw - 24px)); max-height:min(680px,calc(100vh - 105px)); overflow:auto;
      border:1px solid #353b47; border-radius:16px; background:rgba(20,20,23,.985); color:#f1f1f1;
      box-shadow:0 14px 42px rgba(0,0,0,.46); font-family:Roboto,Arial,"Noto Sans JP",sans-serif;
    }
    #npf-research-panel.npf-open { display:block!important; }
    .npf-r-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border-bottom:1px solid #34343a; position:sticky; top:0; z-index:2; background:#202024; }
    .npf-r-title { font-size:13px; font-weight:850; }
    .npf-r-close { border:0; background:transparent; color:#aaa; width:28px; height:28px; border-radius:999px; cursor:pointer; font-size:16px; }
    .npf-r-close:hover { background:#333; color:#fff; }
    .npf-r-body { padding:11px 12px 12px; }
    .npf-r-status { color:#aaa; font-size:10px; line-height:1.45; margin-bottom:9px; display:grid; gap:4px; }
    .npf-r-status-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-height:18px; }
    .npf-r-status-label { min-width:58px; color:#c9c9d1; font-weight:900; }
    .npf-r-status-main { color:#eee; font-weight:800; }
    .npf-r-status-detail { color:#8f9099; }
    .npf-r-status-ok { color:#72c9aa; }
    .npf-r-status-warn { color:#e2b15f; }
    .npf-r-status-bad { color:#e58c73; }
    .npf-r-status-info { color:#9ca7ef; }
    .npf-r-status-filter { padding-top:2px; border-top:1px solid rgba(255,255,255,.06); }
    .npf-r-label { color:#a9a9b1; font-size:10px; font-weight:800; margin:9px 0 5px; }
    .npf-r-tags { display:flex; flex-wrap:wrap; gap:6px; }
    .npf-r-filter {
      border:1px solid #44444c; border-radius:999px; background:#29292f; color:#ddd;
      padding:6px 9px; font-size:10px; font-weight:800; cursor:pointer;
    }
    .npf-r-filter.active { border-color:#8172ea; background:#5147a6; color:#fff; }
    .npf-r-filter.excluded { border-color:#e58c96; background:#7d303b; color:#fff; }
    .npf-r-filter-hint { color:#b9b6c3; font-size:10px; line-height:1.45; margin:0 0 6px; }
    .npf-r-input {
      width:100%; box-sizing:border-box; margin-top:5px; border:1px solid #44444c; border-radius:9px;
      background:#121216; color:#eee; padding:8px 9px; font-size:11px; outline:none;
    }
    .npf-r-input:focus { border-color:#7769df; }
    .npf-r-actions { display:flex; gap:7px; flex-wrap:wrap; margin-top:10px; }
    .npf-r-btn { border:1px solid #44444c; border-radius:9px; background:#29292f; color:#eee; min-height:31px; padding:6px 9px; font-size:10px; font-weight:800; cursor:pointer; }
    .npf-r-btn.primary { border-color:#665be0; background:#554bc7; color:#fff; }
    .npf-r-wiki-diag { margin:9px 0; border:1px solid #55506b; border-radius:10px; padding:8px; background:#25232e; color:#e8e7ed; }
    .npf-r-wiki-diag summary { cursor:pointer; font-size:11px; font-weight:800; }
    .npf-r-wiki-diag p { font-size:10px; line-height:1.5; color:#b9b6c3; margin:7px 0; }
    .npf-r-wiki-diag-row { display:flex; gap:5px; flex-wrap:wrap; margin:7px 0; }
    .npf-r-wiki-diag-select { flex:1; min-width:130px; width:auto; background:#131217; color:#fff; border:1px solid #555; border-radius:7px; font-size:10px; padding:5px; }
    .npf-r-wiki-diag-report { margin:7px 0 0; background:#111116; color:#dce7e2; border:1px solid #45434e; padding:8px; border-radius:6px; white-space:pre-wrap; overflow:auto; max-height:320px; overflow-wrap:anywhere; font:10px/1.65 Consolas,monospace; user-select:text; }
    .npf-r-note { color:#85858e; font-size:9px; line-height:1.5; margin-top:8px; }
    .npf-r-db-status { margin:7px 0 2px; padding:7px 8px; border:1px solid rgba(35,145,120,.22); border-radius:9px; color:#9dbfb6; font-size:9px; line-height:1.4; background:rgba(35,145,120,.06); }
    .npf-r-db-head { color:#b7d8cf; font-weight:850; }
    .npf-r-db-sub { margin-top:2px; color:#7fa99d; }
    .npf-r-db-actions { display:flex; gap:5px; flex-wrap:wrap; margin:4px 0 9px; }
    .npf-research-meta { display:flex; flex-wrap:wrap; align-items:center; gap:5px; margin-top:7px; padding-top:6px; border-top:1px solid rgba(128,128,128,.18); font-family:Roboto,Arial,"Noto Sans JP",sans-serif; }
    /* Desktop tiles: a dedicated full-width row BELOW the native title/details. */
    @media (min-width:701px) {
      ytd-rich-grid-media:has(> .npf-research-meta),
      ytd-grid-video-renderer:has(> .npf-research-meta) {
        display:block!important;
        width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }
      ytd-rich-grid-media > .npf-research-meta,
      ytd-grid-video-renderer > .npf-research-meta {
        display:flex!important;
        flex-wrap:wrap!important;
        align-items:center!important;
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        flex:0 0 100%!important;
        grid-column:1 / -1!important;
        clear:both!important;
        box-sizing:border-box!important;
        margin:8px 0 0!important;
        padding:8px 0 0!important;
      }
      ytd-rich-grid-media:has(> .npf-research-meta) #details,
      ytd-rich-grid-media:has(> .npf-research-meta) #meta,
      ytd-grid-video-renderer:has(> .npf-research-meta) #details,
      ytd-grid-video-renderer:has(> .npf-research-meta) #meta {
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        box-sizing:border-box!important;
      }
      :is(ytd-rich-grid-media, ytd-grid-video-renderer):has(> .npf-research-meta)
        :is(h3, #video-title, #video-title-link, .yt-lockup-metadata-view-model__title) {
        -webkit-line-clamp:unset!important;
        line-clamp:unset!important;
        max-height:none!important;
        overflow:visible!important;
        text-overflow:clip!important;
        white-space:normal!important;
        overflow-wrap:anywhere!important;
      }
    }
    /* The parent tile is a column, not a shared title/badge row. */
    @media (min-width:701px) {
      ytd-rich-item-renderer.npf-r-rich-item {
        display:flex!important;
        flex-direction:column!important;
        align-items:stretch!important;
        min-width:0!important;
      }
      ytd-rich-item-renderer.npf-r-rich-item > :is(ytd-rich-grid-media, yt-lockup-view-model) {
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        flex:0 0 auto!important;
      }
      ytd-rich-item-renderer.npf-r-rich-item > .npf-research-meta {
        display:flex!important;
        flex-wrap:wrap!important;
        align-self:stretch!important;
        flex:0 0 auto!important;
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        box-sizing:border-box!important;
        clear:both!important;
        margin:8px 0 0!important;
        padding:8px 0 0!important;
      }
      ytd-rich-item-renderer.npf-r-rich-item :is(h3, #video-title, #video-title-link, .yt-lockup-metadata-view-model__title) {
        -webkit-line-clamp:unset!important;
        line-clamp:unset!important;
        max-height:none!important;
        white-space:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
        overflow-wrap:anywhere!important;
      }
    }
    .npf-r-pill { display:inline-flex; align-items:center; gap:3px; min-height:20px; padding:2px 7px; border-radius:999px; border:1px solid rgba(128,128,128,.28); background:rgba(80,80,90,.13); color:var(--yt-spec-text-secondary,#777); font-size:10px; font-weight:750; line-height:1.2; white-space:nowrap; }
    button.npf-r-pill { cursor:pointer; }
    button.npf-r-pill:hover { border-color:#6d61d2; color:#665bd1; }
    .npf-r-cat-FPS { background:rgba(65,120,220,.13); border-color:rgba(65,120,220,.36); color:#4f78c8; }
    .npf-r-cat-ソロゲー { background:rgba(45,160,105,.12); border-color:rgba(45,160,105,.36); color:#268e61; }
    .npf-r-cat-コラボ { background:rgba(130,80,210,.12); border-color:rgba(130,80,210,.36); color:#7650bb; }
    .npf-r-cat-雑談 { background:rgba(190,145,35,.12); border-color:rgba(190,145,35,.36); color:#a67819; }
    .npf-r-cat-歌 { background:rgba(210,70,130,.11); border-color:rgba(210,70,130,.34); color:#b73c75; }
    .npf-r-person { background:rgba(104,92,220,.10); border-color:rgba(104,92,220,.32); color:#6558c9; }
    .npf-r-wiki { background:rgba(35,145,120,.10); border-color:rgba(35,145,120,.34); color:#258b74; }
    .npf-r-meta-status { background:rgba(190,120,35,.10); border-color:rgba(190,120,35,.34); color:#9a6718; }
    .npf-r-collab-person {
      appearance:none; cursor:pointer; background:rgba(35,145,120,.10); border-color:rgba(35,145,120,.34); color:#258b74;
    }
    .npf-r-collab-person:hover { border-color:#287d69; background:rgba(35,145,120,.18); color:#1f7563; }
    .npf-r-collab-person.active { border-color:#8172ea; background:#5147a6; color:#fff; box-shadow:0 0 0 2px rgba(81,71,166,.16); }
    .npf-r-active-collab {
      display:inline-flex; align-items:center; margin:2px 0 7px; border:1px solid #287d69; border-radius:999px;
      background:rgba(35,145,120,.16); color:#c8fff1; padding:6px 9px; font-size:10px; font-weight:800; cursor:pointer;
    }
    .npf-r-active-collab[hidden] { display:none!important; }
    .npf-r-collab-control { margin:8px 0 5px; }
    .npf-r-collab-row { display:flex; gap:6px; align-items:center; }
    .npf-r-collab-input { flex:1; min-width:0; margin-top:0!important; }
    .npf-r-collab-apply { flex:0 0 auto; min-height:32px; }
    .npf-r-collab-suggestions { display:flex; flex-wrap:wrap; gap:5px; margin-top:6px; }
    .npf-r-collab-quick {
      appearance:none; border:1px solid rgba(35,145,120,.30); border-radius:999px; background:rgba(35,145,120,.08);
      color:#74c7b3; padding:4px 7px; font-size:9px; font-weight:800; cursor:pointer; max-width:150px;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .npf-r-collab-quick:hover { border-color:#3ca98e; background:rgba(35,145,120,.16); color:#9fe3d1; }
    .npf-r-collab-quick.active { border-color:#8172ea; background:#5147a6; color:#fff; }
    .npf-r-collab-quick.excluded, .npf-r-collab-person.excluded { border-color:#e58c96; background:#7d303b; color:#fff; }
    #npf-r-collab-selected[hidden] { display:none!important; }
    .npf-r-collab-history {
      display:none; margin:2px 0 10px; padding:9px; border:1px solid rgba(35,145,120,.30); border-radius:11px;
      background:rgba(35,145,120,.06);
    }
    .npf-r-collab-history.show { display:block; }
    .npf-r-history-head { display:flex; align-items:center; justify-content:space-between; gap:7px; margin-bottom:6px; }
    .npf-r-history-title { color:#c8fff1; font-size:10px; font-weight:900; line-height:1.35; }
    .npf-r-history-status { color:#8ea9a2; font-size:9px; line-height:1.4; margin:3px 0 7px; }
    .npf-r-history-list { display:flex; flex-direction:column; gap:5px; max-height:300px; overflow:auto; padding-right:2px; }
    .npf-r-history-row {
      display:block; padding:7px 8px; border:1px solid rgba(128,128,128,.22); border-radius:9px;
      background:rgba(40,40,46,.55); text-decoration:none!important; color:inherit!important;
    }
    .npf-r-history-row:hover { border-color:#4b9f8b; background:rgba(35,145,120,.10); }
    .npf-r-history-date { color:#65a995; font-size:9px; font-weight:900; margin-bottom:2px; }
    .npf-r-history-name { color:var(--yt-spec-text-primary,#eee); font-size:10px; font-weight:800; line-height:1.4; }
    .npf-r-history-meta { color:var(--yt-spec-text-secondary,#999); font-size:9px; line-height:1.35; margin-top:3px; }
    .npf-r-history-actions { display:flex; flex-wrap:wrap; gap:5px; margin-top:7px; }
    #npf-r-history-main {
      grid-column:1 / -1; width:100%; box-sizing:border-box; margin:4px 0 14px; padding:12px;
      border:1px solid rgba(35,145,120,.32); border-radius:14px; background:#f4fbf8; color:#202124;
      font-family:Roboto,Arial,"Noto Sans JP",sans-serif;
    }
    #npf-r-history-main[hidden] { display:none!important; }
    .npf-r-history-main-title { font-size:13px; font-weight:900; color:#202124; margin-bottom:4px; }
    .npf-r-history-main-status { font-size:10px; color:#5f6368; margin-bottom:9px; line-height:1.45; }
    .npf-r-history-main-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:7px; }
    .npf-r-history-main-row { display:block; padding:8px 9px; border:1px solid #cfd8d5; border-radius:10px; background:#eef3f1; color:#202124!important; text-decoration:none!important; }
    .npf-r-history-main-row:hover { border-color:#4b9f8b; background:rgba(35,145,120,.10); }
    .npf-r-history-main-date { font-size:9px; font-weight:900; color:#3f957f; margin-bottom:2px; }
    .npf-r-history-main-name { font-size:11px; font-weight:800; line-height:1.4; color:#202124; }
    .npf-r-history-main-meta { margin-top:4px; font-size:9px; line-height:1.35; color:#5f6368; }
    .npf-r-wiki-people { white-space:normal; max-width:min(620px,100%); line-height:1.35; }
    .npf-r-wiki-note { white-space:normal; max-width:min(620px,100%); line-height:1.35; }
    .npf-r-event-links { width:100%; display:flex; flex-wrap:wrap; gap:5px; margin-top:2px; padding:6px 7px; border-radius:9px; background:rgba(70,70,78,.08); }
    .npf-r-event-links .npf-r-pill { text-decoration:none; }
    .npf-r-hidden { display:none!important; }
    @media (max-width:600px) {
      .npf-card { grid-template-columns:1fr; }
      .npf-actions { display:flex; flex-wrap:wrap; min-width:0; }
      #npf-fab { right:12px; bottom:14px; width:48px; height:48px; }
      #npf-research-fab { right:70px; bottom:14px; height:48px; }
      #npf-sheet { max-height:91vh; }
    }
  `);
  } catch (styleError) {
    console.warn('[NPF] GM.addStyle failed; YouTube mobile button uses inline styles', styleError);
  }

  // ---------- common ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function escapeHtml(s = '') {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function toast(message, ms = 2400) {
    let el = $('#npf-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'npf-toast';
      document.documentElement.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function parseVideoIdFromUrl(raw) {
    if (!raw) return null;
    let s = String(raw);

    // WIKIWIKIの外部リンク中ではYouTube URLが percent-encode されることがある。
    // 最大3回まで安全にデコードし、youtu.be//VIDEO_ID のような古い表記も許容する。
    for (let i = 0; i < 3; i++) {
      let next = s;
      try { next = decodeURIComponent(next); } catch {}
      next = wikiDecodeEntities ? wikiDecodeEntities(next) : next.replace(/&amp;/g, '&');
      if (next === s) break;
      s = next;
    }

    let m = s.match(/\/comment\/video\/([A-Za-z0-9_-]{11})(?:\/|[?#]|$)/i);
    if (m) return m[1];

    m = s.match(/[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)/i);
    if (m) return m[1];

    m = s.match(/youtu\.be\/+([A-Za-z0-9_-]{11})(?:[/?#]|$)/i);
    if (m) return m[1];

    m = s.match(/youtube\.com\/(?:live|shorts|embed)\/+([A-Za-z0-9_-]{11})(?:[/?#]|$)/i);
    if (m) return m[1];

    m = s.match(/i\.ytimg\.com\/vi(?:_webp)?\/+([A-Za-z0-9_-]{11})\//i);
    if (m) return m[1];

    return null;
  }

  function startOf(v) {
    const value = v?.start_actual || v?.start_scheduled || v?.available_at || v?.published_at;
    return value ? new Date(value) : null;
  }

  function endOf(v) {
    if (v?.end_actual) return new Date(v.end_actual);
    const s = startOf(v);
    const dur = Number(v?.duration || 0);
    return (s && dur) ? new Date(s.getTime() + dur * 1000) : null;
  }

  function channelName(v) {
    return v?.channel?.name || v?.channel_name || v?.channel_id || '不明';
  }

  function channelId(v) {
    return v?.channel?.id || v?.channel_id || '';
  }

  function fmtDate(d) {
    if (!d || Number.isNaN(d.getTime())) return '時刻不明';
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(d);
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h ? `${h}時間${m}分` : `${m}分`;
  }

  function youtubeUrl(id, seconds = 0) {
    const t = Math.max(0, Math.floor(seconds || 0));
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${t ? `&t=${t}s` : ''}`;
  }

  function openUrl(url) {
    try {
      if (GM.openInTab) {
        GM.openInTab(url, { active: true, insert: true });
        return;
      }
    } catch (e) {
      console.warn('[NPF] GM.openInTab failed', e);
    }
    window.open(url, '_blank', 'noopener');
  }

  function calibrationKey(source, target) {
    const sid = typeof source === 'string' ? source : source?.id;
    const tid = typeof target === 'string' ? target : target?.id;
    return sid && tid ? `${sid}=>${tid}` : '';
  }

  function calibrationFor(source, target) {
    const key = calibrationKey(source, target);
    if (!key) return 0;
    const n = Number(state.calibration?.[key] || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function correctedCandidateOffset(source, match) {
    const base = Number(match?.candidateStartOffset || 0);
    if (!match?.hasSync) return Math.max(0, base);
    return Math.max(0, base + calibrationFor(source, match.v));
  }

  async function adjustCalibration(source, target, delta, absolute = false) {
    const key = calibrationKey(source, target);
    if (!key) return 0;
    const current = calibrationFor(source, target);
    const next = absolute ? Number(delta || 0) : current + Number(delta || 0);
    if (!Number.isFinite(next) || next === 0) delete state.calibration[key];
    else state.calibration[key] = Math.max(-30, Math.min(30, Math.round(next)));
    await gmSet(KEY_CAL, state.calibration);
    return calibrationFor(source, target);
  }

  function tokenize(title = '') {
    const s = title.toLowerCase()
      .replace(/[【】〖〗\[\]（）()#｜|／/・!！?？:：,，.。"'「」『』]/g, ' ')
      .replace(/\b(nijisanji|にじさんじ|vtuber|配信|live|stream)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return new Set(s.split(' ').filter(x => x.length >= 2));
  }

  function titleSimilarity(a, b) {
    const A = tokenize(a), B = tokenize(b);
    if (!A.size || !B.size) return 0;
    let intersection = 0;
    for (const x of A) if (B.has(x)) intersection++;
    return intersection / Math.max(1, Math.min(A.size, B.size));
  }


  function parseClockText(text = '') {
    const m = String(text).trim().match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?:?$/);
    if (!m) return null;
    if (m[3] != null) {
      return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function formatClock(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${m}:${String(s).padStart(2,'0')}`;
  }

  function currentCommentVideoId() {
    return parseVideoIdFromUrl(location.href);
  }

  function hashtags(title = '') {
    const set = new Set();
    const re = /#[^\s#【】\[\]（）()｜|/／]{2,40}/g;
    for (const m of String(title).matchAll(re)) {
      set.add(m[0].toLowerCase());
    }
    return set;
  }

  function sharedHashtags(a = '', b = '') {
    const A = hashtags(a), B = hashtags(b);
    return [...A].filter(x => B.has(x));
  }

  function mentionIds(video) {
    const arr = Array.isArray(video?.mentions) ? video.mentions : [];
    return new Set(arr.map(x => x?.id || x?.channel?.id).filter(Boolean));
  }

  // Conservative: sharing a time, game, event, generic hashtag or title alone
  // is not proof that two streams are different POVs of the same activity.
  function relationInfo(source, candidate, sim, event) {
    const srcChannel = channelId(source);
    const candChannel = channelId(candidate);
    const srcMentions = mentionIds(source);
    const candMentions = mentionIds(candidate);
    const directMention = !!((candChannel && srcMentions.has(candChannel)) ||
      (srcChannel && candMentions.has(srcChannel)));
    const sourceGame = researchGameFromText(source?.title || '', source?.topic_id || '');
    const candidateGame = researchGameFromText(candidate?.title || '', candidate?.topic_id || '');
    const gameCompatible = !(sourceGame && candidateGame &&
      normalizeResearchText(sourceGame) !== normalizeResearchText(candidateGame));
    const sameTopic = !!(source?.topic_id && candidate?.topic_id &&
      source.topic_id === candidate.topic_id);
    const tags = sharedHashtags(source?.title || '', candidate?.title || '');
    const specificTags = tags.filter(tag =>
      !/^#?(?:nijisanji|にじさんじ|vtuber|vcr(?:gta|rust|ark|mc)?|スト鯖|apex|valorant|gta|rust|ark|crcup|crカップ|v最協|v最|ゲーム実況)$/i.test(tag));
    const boring = /^(?:vcr|gta|rust|ark|apex|valorant|minecraft|配信|実況|初見|本日|今日|昨日|明日|コラボ|ゲーム|最終日|初日|練習|スクリム|大会|本番|にじさんじ|nijisanji|vtuber|new|town|lol|live|stream|day\d*|#?\d+)$/i;
    const srcTokens = tokenize(source?.title || '');
    const distinctive = [...tokenize(candidate?.title || '')].filter(t =>
      t.length >= 4 && srcTokens.has(t) && !boring.test(t));
    // A shared broad event like VCR RUST can last days; it is never sufficient.
    const wellMatchedEvent = !!(event && sameTopic && sim >= 0.65 && distinctive.length);
    const wellMatchedTag = !!(specificTags.length && sameTopic && sim >= 0.5 && distinctive.length);
    const sameGame = !!(sourceGame && candidateGame && gameCompatible &&
      normalizeResearchText(sourceGame) === normalizeResearchText(candidateGame));
    const related = !!(gameCompatible && (directMention || wellMatchedEvent || wellMatchedTag));
    const reasons = [];
    if (related && directMention) reasons.push('相互の参加者情報');
    if (related && wellMatchedEvent) reasons.push('同イベント＋特徴的なタイトル');
    if (related && wellMatchedTag) reasons.push(`固有タグ ${specificTags[0]}`);
    return { related, sameGame, reasons, directMention, tags:specificTags, sameTopic };
  }

  function updateInlineButtonLabels(videoId) {
    const sec = Number(state.syncPoints?.[videoId]);
    const has = Number.isFinite(sec);
    $$(`.npf-inline-btn[data-video-id="${CSS.escape(videoId)}"]`).forEach(btn => {
      btn.textContent = has ? `👥 他視点 · ${formatClock(sec)}` : '👥 他視点';
      btn.title = has
        ? `${formatClock(sec)} の実時刻に合わせて別視点を探す`
        : '同時間帯のにじさんじ別視点を探す';
    });
  }

  function updateTimestampSelection(videoId) {
    const selected = Number(state.syncPoints?.[videoId]);
    const hasSelected = Number.isFinite(selected);

    $$('a[data-npf-sync-sec]').forEach(a => {
      const sec = Number(a.dataset.npfSyncSec);
      a.classList.toggle('npf-sync-ts-selected', hasSelected && sec === selected);
      if (hasSelected && sec === selected) {
        a.setAttribute('aria-current', 'true');
        a.title = `${formatClock(sec)} を同期位置に選択中（タップで再生を確認）`;
      } else {
        a.removeAttribute('aria-current');
        a.title = `${formatClock(sec)} を別視点の同期位置にして再生するか確認`; 
      }
    });
  }

  function askOpenSyncedYoutube(videoId, sec) {
    let overlay = $('#npf-ts-confirm');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'npf-ts-confirm';
      overlay.hidden = true;
      overlay.innerHTML = `
        <div class="npf-ts-dialog" role="dialog" aria-modal="true" aria-labelledby="npf-ts-title">
          <div id="npf-ts-title" style="font-size:16px;font-weight:850">⏱ 同期位置を設定しました</div>
          <p id="npf-ts-description" style="line-height:1.6;font-size:13px;margin:12px 0 0"></p>
          <div class="npf-ts-actions">
            <button id="npf-ts-only" type="button">同期だけする</button>
            <a id="npf-ts-open" href="https://www.youtube.com/">YouTubeで開く ↗</a>
          </div>
          <div style="color:#aebdd1;font-size:11px;line-height:1.5;margin-top:12px">アプリが開かない場合はYouTubeのWeb版が開きます。</div>
        </div>`;
      (document.body || document.documentElement).appendChild(overlay);
      $('#npf-ts-only', overlay).addEventListener('click', () => { overlay.hidden = true; });
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.hidden = true; });
      // 実リンクをユーザーが直接タップすることでiOSのUniversal Linksに任せる。
      $('#npf-ts-open', overlay).addEventListener('click', () => { overlay.hidden = true; });
    }
    $('#npf-ts-description', overlay).textContent = `${formatClock(sec)} を保存しました。この時刻から動画を再生しますか？`;
    $('#npf-ts-open', overlay).href = youtubeUrl(videoId, sec);
    overlay.hidden = false;
    $('#npf-ts-only', overlay)?.focus({ preventScroll: true });
  }

  function bindCommentTimestamps() {
    const videoId = currentCommentVideoId();
    if (!videoId) return;

    // Bind ONLY comment2434's own timestamp column. Never bind links in the OR
    // merger's viewer, other extensions, menus, or copied result cards. Otherwise
    // the handler hijacks OR timestamps and opens the BACKGROUND page's video ID.
    $$('.col-md-1 a[href], .col-2 a[href]').forEach(a => {
      if (a.closest('#niji-or-root, #niji-or-trigger, #niji-or-boot-check, #npf-research-panel, #npf-yt-panel')) return;
      if (!a.closest('.col-md-1, .col-2')) return;
      if (a.dataset.npfSyncBound === '1') return;
      const sec = parseClockText(a.textContent || '');
      if (!Number.isFinite(sec)) return;

      a.dataset.npfSyncBound = '1';
      a.dataset.npfSyncSec = String(sec);
      a.classList.add('npf-sync-ts-bound');

      a.addEventListener('click', (e) => {
        // PCでCtrl/Cmd/Shift/Altクリックした時は元リンクの動作を残す。
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

        // 通常タップでは同期位置を保存して再生確認を表示。長押し・修飾クリックは元リンクのまま。
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

        state.syncPoints[videoId] = sec;
        void gmSet(KEY_SYNC, state.syncPoints);
        updateInlineButtonLabels(videoId);
        updateTimestampSelection(videoId);
        askOpenSyncedYoutube(videoId, sec);
      }, { capture: true });
    });

    updateInlineButtonLabels(videoId);
    updateTimestampSelection(videoId);
  }

  const EVENT_GROUPS = [
    ['VCR GTA', ['vcr gta', 'vcrgta', '#vcrgta']],
    ['にじGTA', ['にじgta', 'にじさんじgta']],
    ['MADTOWN', ['madtown', 'mad town']],
    ['VCR RUST', ['vcr rust', 'vcrrust']],
    ['VCR Minecraft', ['vcr minecraft', 'vcrマイクラ', 'vcr mc']],
    ['VCR ARK', ['vcr ark', 'vcrark']],
    ['ストグラ', ['ストグラ']],
    ['V最協', ['v最', 'v最協']],
    ['CR Cup', ['cr cup', 'crカップ', 'crcup']],
  ];

  function detectedEvents(title = '') {
    const s = title.toLowerCase();
    return EVENT_GROUPS
      .filter(([, aliases]) => aliases.some(a => s.includes(a.toLowerCase())))
      .map(([name]) => name);
  }

  function sameEvent(a = '', b = '') {
    const A = detectedEvents(a);
    const B = detectedEvents(b);
    return A.some(x => B.includes(x));
  }

  function isFavorite(v) {
    const id = channelId(v);
    return !!id && state.favorites.some(f => f.id === id);
  }

  // ---------- UI shell ----------
  function createShell() {
    const onYouTube = /(^|\.)youtube\.com$/i.test(location.hostname);

    // YouTube は Trusted Types が有効なため、innerHTML を使う既存シートは生成しない。
    // YouTube 用 UI はすべて DOM API だけで作る。
    if (onYouTube) {
      if ($('#npf-fab')) return;

      // Mobile YouTube: a summary within a zero-sized details may be clipped by WebKit.
      // Use a standalone floating button, independently of YouTube's changing body tree.
      if (isMobileYoutubeUi()) {
        const fab = document.createElement('button');
        fab.id = 'npf-fab';
        fab.className = 'npf-mobile-fab';
        fab.type = 'button';
        fab.textContent = 'NIJI';
        fab.title = 'Niji Research Helper を開く';
        fab.setAttribute('aria-label', 'Niji Research Helper を開く');
        fab.setAttribute('aria-expanded', 'false');
        const critical = {
          position: 'fixed', right: '14px', bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          width: '56px', height: '56px', display: 'flex', visibility: 'visible', opacity: '1',
          'pointer-events': 'auto', 'align-items': 'center', 'justify-content': 'center',
          'z-index': '2147483647', 'border-radius': '999px', border: '0',
          background: '#5f70ec', color: '#fff', 'font-size': '13px', 'font-weight': '800',
          'box-shadow': '0 5px 20px rgba(0,0,0,.45)', 'touch-action': 'manipulation',
        };
        for (const [key, value] of Object.entries(critical)) fab.style.setProperty(key, value, 'important');
        fab.addEventListener('click', toggleYoutubePanel);
        document.documentElement.appendChild(fab);
        return;
      }

      const widget = document.createElement('details');
      widget.id = 'npf-yt-widget';

      const fab = document.createElement('summary');
      fab.id = 'npf-fab';
      fab.textContent = 'NIJI';
      fab.title = 'Niji Research Helper を開く';

      widget.appendChild(fab);
      (document.body || document.documentElement).appendChild(widget);

      widget.addEventListener('toggle', () => {
        syncYoutubePanelVisibility();
        if (widget.open) setTimeout(updateYoutubePanel, 0);
      });
      return;
    }

    if ($('#npf-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'npf-fab';
    fab.type = 'button';
    fab.classList.add('npf-comment-fab');
    fab.textContent = '👥 視点検索';
    fab.title = 'URL・同期位置から別視点を探す';
    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCommentPovHome();
    });
    (document.body || document.documentElement).appendChild(fab);

    const backdrop = document.createElement('div');
    backdrop.id = 'npf-sheet-backdrop';
    backdrop.innerHTML = `
      <section id="npf-sheet" role="dialog" aria-modal="true">
        <header class="npf-head">
          <div>
            <div class="npf-title">Niji POV Helper</div>
            <div class="npf-sub">v${VERSION}</div>
          </div>
          <button class="npf-x" type="button" aria-label="閉じる">✕</button>
        </header>
        <div class="npf-body"></div>
      </section>
    `;
    (document.body || document.documentElement).appendChild(backdrop);

    $('.npf-x', backdrop).addEventListener('click', closeSheet);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeSheet();
    });

    state.sheet = backdrop;
  }

  function openSheet(html) {
    createShell();
    $('.npf-body', state.sheet).innerHTML = html;
    state.sheet.classList.add('npf-open');
    document.documentElement.style.overflow = 'hidden';
  }

  function closeSheet() {
    if (!state.sheet) return;
    state.sheet.classList.remove('npf-open');
    document.documentElement.style.overflow = '';
  }

  // Desktop YouTube panel: resize from a clearly labelled header grip. Dragging
  // left expands the right-anchored panel; tapping cycles accessible presets.
  // This UI-only preference is local to the YouTube origin; DB/schema unchanged.
  function installYoutubePanelResize(panel, head, closeBtn) {
    if (isMobileYoutubeUi() || head.querySelector('#npf-yt-resize')) return;
    const key = 'npf_yt_panel_width_v1';
    const presets = [440, 620, 820, 1000];
    function applyWidth(raw, remember = false) {
      const max = Math.max(220, Math.min(1000, window.innerWidth - 32));
      const min = Math.min(320, max);
      const requested = Number(raw);
      const width = Math.round(Math.max(min, Math.min(max,
        Number.isFinite(requested) && requested > 0 ? requested : 540)));
      panel.style.setProperty('width', width + 'px', 'important');
      if (remember) {
        try { localStorage.setItem(key, String(width)); } catch (e) {
          console.debug('[NRH][panel width] save unavailable', e);
        }
      }
      return width;
    }
    let saved = 540;
    try { saved = Number(localStorage.getItem(key)) || 540; } catch {}
    applyWidth(saved);
    const grip = document.createElement('button');
    grip.id = 'npf-yt-resize'; grip.type = 'button';
    grip.textContent = '↔ 幅調整';
    grip.title = '左右にドラッグして幅変更／クリックで幅を切替';
    grip.setAttribute('aria-label', grip.title);
    head.insertBefore(grip, closeBtn);
    let drag = null, lastDragAt = 0;
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x:e.clientX, width:panel.getBoundingClientRect().width, moved:false };
      try { grip.setPointerCapture(e.pointerId); } catch {}
    });
    grip.addEventListener('pointermove', e => {
      if (!drag) return;
      const delta = drag.x - e.clientX;
      if (Math.abs(delta) > 4) drag.moved = true;
      if (!drag.moved) return;
      e.preventDefault();
      applyWidth(drag.width + delta);
    });
    const finish = () => {
      if (!drag) return;
      if (drag.moved) {
        lastDragAt = Date.now();
        applyWidth(panel.getBoundingClientRect().width, true);
      }
      drag = null;
    };
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
    grip.addEventListener('click', () => {
      if (Date.now() - lastDragAt < 450) return;
      const current = panel.getBoundingClientRect().width;
      applyWidth(presets.find(size => size > current + 24) || presets[0], true);
    });
    window.addEventListener('resize', () => {
      if (panel.isConnected) applyWidth(panel.getBoundingClientRect().width);
    }, { passive:true });
  }

  // ---------- comment2434: URL + timestamp POV launcher ----------
  // 保存済み同期位置を利用する。新しいキーやDBは作成しない。
  function openCommentPovHome() {
    const pageId = currentCommentVideoId();
    const saved = pageId ? state.syncPoints?.[pageId] : null;
    const selected = Number.isFinite(Number(saved)) && saved !== null && saved !== undefined
      ? formatClock(Number(saved)) : '';
    openSheet(`
      <div class="npf-source">
        <div class="npf-source-title">👥 視点検索・同期</div>
        <p class="npf-pov-intro">元動画のURLを貼り付けるか、コメント検索の動画ページで時刻を選ぶと、その瞬間の別視点を探せます。</p>
        <label class="npf-label" for="npf-pov-url">元アーカイブのYouTube URL / 動画ID</label>
        <input id="npf-pov-url" class="npf-input" type="text" inputmode="url" spellcheck="false"
          value="${pageId ? escapeHtml(youtubeUrl(pageId)) : ''}"
          placeholder="https://www.youtube.com/watch?v=...">
        <label class="npf-label" for="npf-pov-time" style="display:block;margin-top:12px">
          同期位置（任意）</label>
        <input id="npf-pov-time" class="npf-input" type="text" inputmode="text"
          value="${escapeHtml(selected)}" placeholder="例：2:35:18 / 45:10">
        <div class="npf-meta">空欄なら、その動画の保存済み同期位置を使います。未保存なら配信時間の重なりで探します。</div>
        <div id="npf-pov-error" class="npf-pov-error" role="status"></div>
        <div class="npf-toolbar">
          <button class="npf-primary" id="npf-pov-search" type="button">👥 この動画の他視点を探す</button>
          <button class="npf-ghost" id="npf-pov-settings" type="button">⚙ 設定・APIキー</button>
        </div>
      </div>`);
    const urlInput = $('#npf-pov-url', state.sheet);
    const timeInput = $('#npf-pov-time', state.sheet);
    const error = $('#npf-pov-error', state.sheet);
    const button = $('#npf-pov-search', state.sheet);
    // 別動画のURLに差し替えた際、前の動画の時刻を誤って使わない。
    urlInput?.addEventListener('input', () => {
      const nextId = parsePovInputVideoId(urlInput.value);
      const linkedTime = parsePovUrlTimestamp(urlInput.value);
      // 手入力の時刻は尊重。既定値／空欄ならURL内のt=も読み取る。
      if (timeInput && (timeInput.value === selected || !timeInput.value.trim())) {
        if (Number.isFinite(linkedTime)) timeInput.value = formatClock(linkedTime);
        else if (nextId !== pageId) timeInput.value = '';
      }
    });
    const run = async () => {
      const id = parsePovInputVideoId(urlInput.value);
      if (!id) { error.textContent = '有効なYouTube URL、コメント検索URL、または11文字の動画IDを入力してください。'; return; }
      const typed = timeInput.value.trim();
      const sec = typed ? parseClockText(typed) : null;
      if (typed && !Number.isFinite(sec)) {
        error.textContent = '同期位置は 2:35:18 または 45:10 のように入力してください。';
        return;
      }
      error.textContent = '';
      if (typed) {
        state.syncPoints[id] = sec;
        await gmSet(KEY_SYNC, state.syncPoints);
        updateInlineButtonLabels(id);
        if (id === currentCommentVideoId()) updateTimestampSelection(id);
      }
      // 既存のHolodex/候補表示処理へ接続する。本文検索や新しいスクレイピングはしない。
      await showOtherPOVs(id);
    };
    button?.addEventListener('click', () => void run());
    urlInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void run(); } });
    timeInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void run(); } });
    $('#npf-pov-settings', state.sheet)?.addEventListener('click', () => void openSettings());
  }

  function parsePovUrlTimestamp(raw) {
    try {
      const url = new URL(String(raw || '').trim());
      const host = url.hostname.toLowerCase();
      if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return null;
      const token = String(url.searchParams.get('t') || url.searchParams.get('start') || '').trim().toLowerCase();
      if (!token) return null;
      if (/^\d+$/.test(token)) return Number(token);
      if (/^\d+s$/.test(token)) return Number(token.slice(0, -1));
      if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(token)) return parseClockText(token);
      const m = token.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      return m && m[0] && m[0] !== '' ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : null;
    } catch { return null; }
  }

  function parsePovInputVideoId(value) {
    const input = String(value || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
    // 不正な文字列内の動画IDを誤検出しないため、既知のURL形式だけを受け付ける。
    try {
      const url = new URL(input);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      const host = url.hostname.toLowerCase();
      if (host !== 'youtube.com' && host !== 'www.youtube.com' && host !== 'm.youtube.com'
          && host !== 'youtu.be' && host !== 'comment2434.com' && host !== 'www.comment2434.com') return null;
      const id = parseVideoIdFromUrl(url.href);
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    } catch { return null; }
  }

  async function openSettings() {
    const favRows = state.favorites.length
      ? state.favorites.map(f => `
          <div class="npf-fav-row" data-fav-id="${escapeHtml(f.id)}">
            <span>★ ${escapeHtml(f.name || f.id)}</span>
            <button class="npf-ghost npf-remove-fav" type="button" data-id="${escapeHtml(f.id)}">削除</button>
          </div>`).join('')
      : `<div class="npf-empty">お気に入りはまだありません。<br>別視点一覧の「☆」から登録できます。</div>`;

    openSheet(`
      <div class="npf-settings">
        <label class="npf-label">
          Holodex APIキー
          <input id="npf-api-key" class="npf-input" type="password" value="${escapeHtml(state.apiKey)}" placeholder="Holodex API key">
        </label>

        <label class="npf-check">
          <input id="npf-favorite-first" type="checkbox" ${state.settings.favoriteFirst ? 'checked' : ''}>
          お気に入りチャンネルを常に上へ
        </label>

        <label class="npf-check">
          <input id="npf-event-first" type="checkbox" ${state.settings.eventFirst ? 'checked' : ''}>
          同イベントっぽい視点を優先
        </label>

        <label class="npf-label">
          検索する前後幅
          <select id="npf-window" class="npf-select">
            ${[12,24,36,48].map(h => `<option value="${h}" ${Number(state.settings.searchWindowHours)===h?'selected':''}>±${h}時間</option>`).join('')}
          </select>
        </label>

        <button id="npf-save-settings" class="npf-primary" type="button">保存</button>

        <div>
          <div class="npf-label" style="margin-bottom:7px">お気に入り</div>
          <div class="npf-fav-list">${favRows}</div>
        </div>

        <div class="npf-source">
          <div class="npf-meta">
            このスクリプトは comment2434 の検索結果ページ自体をスクレイピングして外部保存しません。
            画面上からYouTube動画IDを読み、別視点検索だけHolodex APIへ問い合わせます。
          </div>
        </div>
      </div>
    `);

    $('#npf-save-settings', state.sheet).addEventListener('click', async () => {
      state.apiKey = $('#npf-api-key', state.sheet).value.trim();
      state.settings.favoriteFirst = $('#npf-favorite-first', state.sheet).checked;
      state.settings.eventFirst = $('#npf-event-first', state.sheet).checked;
      state.settings.searchWindowHours = Number($('#npf-window', state.sheet).value || 24);

      await gmSet(KEY_API, state.apiKey);
      await gmSet(KEY_SETTINGS, state.settings);
      toast('設定を保存しました');
      closeSheet();
    });

    $$('.npf-remove-fav', state.sheet).forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        state.favorites = state.favorites.filter(f => f.id !== id);
        await gmSet(KEY_FAVS, state.favorites);
        injectChannelFavorites(true);
        openSettings();
      });
    });
  }


  // ---------- comment2434 channel favorites ----------
  function normalizedName(s = '') {
    return String(s).replace(/\s+/g, '').toLowerCase();
  }

  function findChannelSelect() {
    const selects = $$('select');
    if (!selects.length) return null;

    // まずラベルや周辺テキストで「チャンネル名」を特定。
    // 「対象外チャンネル名」は除外する。
    let best = null;
    let bestScore = -999;

    for (const sel of selects) {
      let score = 0;
      const idName = `${sel.id || ''} ${sel.name || ''}`.toLowerCase();
      if (idName.includes('channel')) score += 2;

      const labels = [];
      if (sel.id) {
        const label = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
        if (label) labels.push(label.textContent || '');
      }

      let p = sel.parentElement;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        labels.push((p.textContent || '').slice(0, 250));
      }
      const around = labels.join(' ');

      if (around.includes('チャンネル名')) score += 8;
      if (around.includes('対象外チャンネル名')) score -= 12;

      // お気に入り名が選択肢に存在するならチャンネル欄らしさを加点
      const optionNames = [...sel.options].map(o => normalizedName(o.textContent || ''));
      for (const fav of state.favorites) {
        if (optionNames.includes(normalizedName(fav.name || ''))) {
          score += 2;
          break;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = sel;
      }
    }

    return bestScore >= 4 ? best : null;
  }

  function findOptionForFavorite(select, fav) {
    if (!select || !fav) return null;
    const favName = normalizedName(fav.name || '');
    const favId = String(fav.id || '');

    // valueがYouTubeチャンネルIDなら最優先
    let opt = [...select.options].find(o => favId && String(o.value) === favId);
    if (opt) return opt;

    // 次に表示名の完全一致
    opt = [...select.options].find(o => normalizedName(o.textContent || '') === favName);
    if (opt) return opt;

    // 表記ゆれ対策として部分一致（長さ3文字以上）
    if (favName.length >= 3) {
      opt = [...select.options].find(o => {
        const n = normalizedName(o.textContent || '');
        return n.includes(favName) || favName.includes(n);
      });
    }
    return opt || null;
  }

  function notifySelectChanged(select) {
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));

    // Select2系が使われている場合、jQueryのchangeも投げる
    try {
      const jq = window.jQuery;
      if (jq) jq(select).trigger('change');
    } catch {}
  }

  function favoriteFromOption(option) {
    if (!option) return null;
    const value = String(option.value || '');
    return {
      id: value || `name:${normalizedName(option.textContent || '')}`,
      name: String(option.textContent || '').trim(),
    };
  }

  async function addSelectedChannelsToFavorites(select) {
    if (!select) return;
    const selected = [...select.selectedOptions].filter(o => o.value !== '');
    if (!selected.length) {
      toast('先に「チャンネル名」で登録したいチャンネルを選んでください');
      return;
    }

    let added = 0;
    for (const option of selected) {
      const fav = favoriteFromOption(option);
      if (!fav?.name) continue;

      const exists = state.favorites.some(f =>
        (fav.id && f.id === fav.id) ||
        normalizedName(f.name || '') === normalizedName(fav.name)
      );
      if (!exists) {
        state.favorites.push(fav);
        added++;
      }
    }

    await gmSet(KEY_FAVS, state.favorites);
    injectChannelFavorites(true);
    toast(added ? `${added}チャンネルをお気に入りに追加しました` : '選択中のチャンネルは登録済みです');
  }

  function channelFavoriteMountTarget(select) {
    if (!select) return null;

    // Select2などで元selectが非表示の場合は、描画コンテナの前に置く
    const next = select.nextElementSibling;
    if (next && (
      next.classList.contains('select2') ||
      next.classList.contains('select2-container') ||
      next.matches?.('[class*="select2"]')
    )) {
      return next;
    }
    return select;
  }

  function injectChannelFavorites(force = false) {
    const select = findChannelSelect();
    if (!select) return;

    const target = channelFavoriteMountTarget(select);
    if (!target?.parentNode) return;

    let box = document.querySelector('.npf-channel-favs');
    if (box && !force && box.dataset.forSelect === (select.id || select.name || 'channel')) {
      // 選択状態だけ更新
      $$('.npf-channel-chip', box).forEach(btn => {
        const fav = state.favorites.find(f => String(f.id) === btn.dataset.favId);
        const opt = findOptionForFavorite(select, fav);
        btn.classList.toggle('selected', !!opt?.selected);
      });
      return;
    }

    if (box) box.remove();

    box = document.createElement('div');
    box.className = 'npf-channel-favs';
    box.dataset.forSelect = select.id || select.name || 'channel';

    const usableFavs = state.favorites
      .map(fav => ({ fav, option: findOptionForFavorite(select, fav) }))
      .filter(x => x.option);

    box.innerHTML = `
      <div class="npf-channel-favs-head">
        <div class="npf-channel-favs-title">★ お気に入りチャンネル</div>
        <button type="button" class="npf-channel-fav-add">☆ 選択中を登録</button>
      </div>
      <div class="npf-channel-favs-list">
        ${usableFavs.length
          ? usableFavs.map(({ fav, option }) => `
              <button
                type="button"
                class="npf-channel-chip ${option.selected ? 'selected' : ''}"
                data-fav-id="${escapeHtml(String(fav.id || ''))}"
              >${escapeHtml(fav.name || option.textContent || '')}</button>
            `).join('')
          : `<span class="npf-channel-favs-empty">登録済みのお気に入りは、このチャンネル欄ではまだ見つかりません。</span>`
        }
      </div>
    `;

    target.insertAdjacentElement('beforebegin', box);

    $('.npf-channel-fav-add', box)?.addEventListener('click', () => {
      void addSelectedChannelsToFavorites(select);
    });

    $$('.npf-channel-chip', box).forEach(btn => {
      btn.addEventListener('click', () => {
        const fav = state.favorites.find(f => String(f.id) === btn.dataset.favId);
        const option = findOptionForFavorite(select, fav);
        if (!option) return;

        // チャンネル名欄は複数選択可能なのでトグル動作
        option.selected = !option.selected;
        notifySelectChanged(select);

        // Select2などの描画更新を待ってからチップ状態も更新
        setTimeout(() => injectChannelFavorites(true), 30);
      });
    });

    if (select.dataset.npfFavoriteBound !== '1') {
      select.dataset.npfFavoriteBound = '1';
      select.addEventListener('change', () => {
        setTimeout(() => injectChannelFavorites(true), 20);
      });
    }
  }

  // ---------- comment2434: ライバー名検索のお気に入り（チャンネルとは別保存） ----------
  function findLiverSelect() {
    let best = null;
    let bestScore = -999;
    for (const sel of $$('select')) {
      // ヘルパー自身の設定欄やチャンネル名セレクトを拾わない。
      if (sel.closest('#npf-root, #npf-yt-panel, #niji-or-root')) continue;
      const idName = `${sel.id || ''} ${sel.name || ''} ${sel.getAttribute('aria-label') || ''}`;
      let score = /liver|ライバー|talent/i.test(idName) ? 12 : 0;
      if (/channel|チャンネル|exclude|対象外/i.test(idName)) score -= 30;
      if (sel.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
        if (lab && /ライバー名/.test(lab.textContent || '')) score += 12;
      }
      if (/ライバー名/.test(sel.closest('label')?.textContent || '')) score += 12;
      const previous = sel.previousElementSibling;
      if (previous && /ライバー名/.test((previous.textContent || '').slice(0, 100))) score += 9;
      // ラベルが独立しているサイトの検索フォームにも対応する。
      for (let p = sel.parentElement, depth = 0; p && depth < 2; p = p.parentElement, depth++) {
        const context = (p.textContent || '').trim().slice(0, 180);
        if (/ライバー名/.test(context)) score += depth === 0 ? 8 : 3;
        if (/対象外チャンネル名/.test(context) && !/ライバー名/.test(context)) score -= 8;
      }
      if (score > bestScore) { bestScore = score; best = sel; }
    }
    return bestScore >= 8 ? best : null;
  }

  function findOptionForLiver(select, favorite) {
    if (!select || !favorite) return null;
    const value = String(favorite.value || '');
    const name = normalizedName(favorite.name || '');
    const options = [...select.options].filter(opt => String(opt.value || '') !== '');
    // 同じvalueが別名になった場合は誤選択を避ける。
    return options.find(opt => value && String(opt.value) === value && normalizedName(opt.textContent) === name)
      || options.find(opt => normalizedName(opt.textContent) === name)
      || (name ? null : options.find(opt => value && String(opt.value) === value))
      || null;
  }

  async function addSelectedLiverFavorite(select) {
    const chosen = [...(select?.selectedOptions || [])].filter(opt => String(opt.value || '') !== '');
    if (!chosen.length) { toast('先に「ライバー名」で登録したい人を選んでください'); return; }
    let added = 0;
    for (const opt of chosen) {
      const name = String(opt.textContent || '').trim();
      if (!name || state.liverFavorites.some(f => normalizedName(f.name) === normalizedName(name))) continue;
      state.liverFavorites.push({ value:String(opt.value), name });
      added++;
    }
    if (added) await gmSet(KEY_LIVER_FAVS, state.liverFavorites);
    injectLiverFavorites(true);
    toast(added ? `${added}人をお気に入りライバーに追加しました` : '選択中のライバーは登録済みです');
  }

  function injectLiverFavorites(force = false) {
    const select = findLiverSelect();
    if (!select) return;
    const target = channelFavoriteMountTarget(select); // Select2等の表示用要素より前へ設置
    if (!target?.parentNode) return;
    let box = document.querySelector('.npf-liver-favs');
    if (box && !force && box.nextElementSibling === target && box._npfLiverSelect === select) {
      $$('.npf-liver-chip', box).forEach(btn => {
        const fav = state.liverFavorites.find(f => normalizedName(f.name) === btn.dataset.liverName);
        btn.classList.toggle('selected', !!findOptionForLiver(select, fav)?.selected);
      });
      return;
    }
    box?.remove();
    box = document.createElement('div');
    box.className = 'npf-liver-favs';
    box._npfLiverSelect = select;
    const valid = state.liverFavorites.map(f => ({ fav:f, option:findOptionForLiver(select, f) }));
    box.innerHTML = `
      <div class="npf-channel-favs-head">
        <div class="npf-channel-favs-title">★ お気に入りライバー</div>
        <button type="button" class="npf-channel-fav-add npf-liver-fav-add">☆ 選択中を登録</button>
      </div>
      <div class="npf-channel-favs-list">
        ${valid.length ? valid.map(({fav, option}) => `
          <span class="npf-liver-fav-item">
            <button type="button" class="npf-channel-chip npf-liver-chip ${option?.selected ? 'selected' : ''}"
              data-liver-name="${escapeHtml(normalizedName(fav.name))}" ${option ? '' : 'disabled'}>${escapeHtml(fav.name)}</button>
            <button type="button" class="npf-liver-remove" aria-label="${escapeHtml(fav.name)}をお気に入りから削除"
              data-liver-name="${escapeHtml(normalizedName(fav.name))}">×</button>
          </span>`).join('')
          : '<span class="npf-channel-favs-empty">ライバーを選んで「選択中を登録」すると、ここからすぐ選べます。</span>'}
      </div>`;
    target.insertAdjacentElement('beforebegin', box);
    $('.npf-liver-fav-add', box)?.addEventListener('click', () => {
      void addSelectedLiverFavorite(select).catch(err => toast(`登録失敗: ${err?.message || err}`));
    });
    $$('.npf-liver-chip', box).forEach(btn => btn.addEventListener('click', () => {
      const fav = state.liverFavorites.find(f => normalizedName(f.name) === btn.dataset.liverName);
      const opt = findOptionForLiver(select, fav);
      if (!opt) return;
      // ライバー欄が単一選択なら「切り替え」、複数選択ならトグル。
      opt.selected = select.multiple ? !opt.selected : true;
      notifySelectChanged(select);
      setTimeout(() => injectLiverFavorites(true), 40);
    }));
    $$('.npf-liver-remove', box).forEach(btn => btn.addEventListener('click', async () => {
      const name = btn.dataset.liverName;
      const previous = state.liverFavorites;
      state.liverFavorites = previous.filter(f => normalizedName(f.name) !== name);
      try { await gmSet(KEY_LIVER_FAVS, state.liverFavorites); }
      catch (err) { state.liverFavorites = previous; toast(`削除失敗: ${err?.message || err}`); }
      injectLiverFavorites(true);
    }));
    if (select.dataset.npfLiverFavoriteBound !== '1') {
      select.dataset.npfLiverFavoriteBound = '1';
      select.addEventListener('change', () => setTimeout(() => injectLiverFavorites(true), 40));
    }
  }

  // ---------- comment2434 detector ----------
  function pickInsertTarget(el) {
    if (!el) return null;
    if (el.tagName === 'A') return el;

    const a = el.closest?.('a[href]');
    if (a) return a;

    let cur = el;
    for (let i = 0; i < 4 && cur?.parentElement; i++, cur = cur.parentElement) {
      if (cur.parentElement.tagName !== 'BODY') return cur;
    }
    return el;
  }

  function scanAndInject() {
    const found = new Map();

    $$('a[href]').forEach(a => {
      const id = parseVideoIdFromUrl(a.href);
      if (id && !found.has(id)) found.set(id, a);
    });

    $$('img[src]').forEach(img => {
      const id = parseVideoIdFromUrl(img.src);
      if (id && !found.has(id)) found.set(id, img);
    });

    found.forEach((el, id) => {
      if (document.querySelector(`.npf-inline-btn[data-video-id="${CSS.escape(id)}"]`)) return;

      const target = pickInsertTarget(el);
      if (!target || !target.parentNode) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'npf-inline-btn';
      btn.dataset.videoId = id;
      btn.textContent = '👥 他視点';
      btn.title = '同時間帯のにじさんじ別視点を探す';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showOtherPOVs(id);
      });

      target.insertAdjacentElement('afterend', btn);
    });

    const fab = $('#npf-fab');
    if (fab) fab.title = `Niji POV Helper（動画 ${found.size}件検出）`;
    for (const id of found.keys()) updateInlineButtonLabels(id);
    bindCommentTimestamps();
    injectChannelFavorites();
    injectLiverFavorites();
  }

  function startObserver() {
    scanAndInject();
    const obs = new MutationObserver(() => {
      clearTimeout(state.observerTimer);
      state.observerTimer = setTimeout(() => { scanAndInject(); bindCommentTimestamps(); injectChannelFavorites(); injectLiverFavorites(); }, 180);
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // ---------- POV search ----------
  async function fetchCandidates(source) {
    const ss = startOf(source), se = endOf(source);
    if (!ss || !se || Number.isNaN(+ss) || Number.isNaN(+se))
      throw new Error('元アーカイブの開始・終了時刻を取得できませんでした');
    const h = Number(state.settings.searchWindowHours || 24);
    const searches = [
      {org:'Nijisanji',from:new Date(+ss-h*3600000),to:new Date(+se+h*3600000),max:20},
      // A separate live Holodex request, never requiring the archive DB.
      {topic:String(source.topic_id || '').trim(),from:new Date(+ss-3600000),to:new Date(+se+3600000),max:10},
    ];
    const found = new Map();
    for (const query of searches) {
      for (let offset=0, pages=0; pages<query.max; pages++,offset+=50) {
        const q = new URLSearchParams({type:'stream',status:'past',include:'live_info,mentions',
          sort:'available_at',order:'asc',limit:'50',offset:String(offset),
          from:query.from.toISOString(),to:query.to.toISOString()});
        if (query.org) q.set('org',query.org);
        if (query.topic) q.set('topic',query.topic);
        const arr = await apiGet(`/videos?${q.toString()}`);
        if (!Array.isArray(arr)) break;
        for (const v of arr) if (v?.id) found.set(v.id,v);
        if (arr.length<50) break;
      }
    }
    return [...found.values()];
  }

  function buildMatches(source, videos, syncOffset = null) {
    const ss = startOf(source), se = endOf(source);
    const sourceDuration = Math.max(1, (se - ss) / 1000);
    const hasSync = syncOffset != null && Number.isFinite(Number(syncOffset));
    const syncSec = hasSync ? Number(syncOffset) : null;
    const targetMoment = hasSync ? new Date(ss.getTime() + syncSec * 1000) : null;

    return videos
      .filter(v => v.id && v.id !== source.id)
      .map(v => {
        const cs = startOf(v), ce = endOf(v);
        if (!cs || !ce) return null;

        const overlapStart = new Date(Math.max(ss.getTime(), cs.getTime()));
        const overlapEnd = new Date(Math.min(se.getTime(), ce.getTime()));
        const overlap = (overlapEnd - overlapStart) / 1000;
        if (overlap <= 0) return null;

        // コメントのタイムスタンプが選ばれている時は、
        // 「配信のどこかが重なった」ではなく、その瞬間に実際に配信中だった視点だけ残す。
        if (targetMoment && !(targetMoment >= cs && targetMoment <= ce)) return null;

        const candDuration = Math.max(1, (ce - cs) / 1000);
        const overlapRatio = Math.min(1, overlap / Math.min(sourceDuration, candDuration));
        const sim = titleSimilarity(source.title || '', v.title || '');
        const event = sameEvent(source.title || '', v.title || '');
        const favorite = isFavorite(v);
        const relation = relationInfo(source, v, sim, event);

        let score = overlapRatio * 0.42 + sim * 0.35 + (event ? 0.50 : 0);
        if (relation.directMention) score += 0.45;
        if (relation.tags.length) score += 0.35;
        if (relation.sameTopic) score += 0.10;
        if (favorite) score += 1.0;

        const candidateSyncOffset = targetMoment
          ? Math.max(0, (targetMoment - cs) / 1000)
          : Math.max(0, (overlapStart - cs) / 1000);

        return {
          v, cs, ce, overlapStart, overlapEnd, overlap, overlapRatio, sim, event, favorite, score,
          related: relation.related,
          sameGame: relation.sameGame,
          reasons: relation.reasons,
          sameTopic: relation.sameTopic,
          directMention: relation.directMention,
          candidateStartOffset: candidateSyncOffset,
          sourceStartOffset: targetMoment
            ? syncSec
            : Math.max(0, (overlapStart - ss) / 1000),
          hasSync,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        // 関連候補を最優先。お気に入りだからという理由だけで無関係配信を上に出さない。
        if (a.related !== b.related) return a.related ? -1 : 1;
        if (state.settings.favoriteFirst && a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        if (state.settings.eventFirst && a.event !== b.event) return a.event ? -1 : 1;
        return b.score - a.score;
      });
  }

  async function toggleFavorite(video, button = null) {
    const id = channelId(video);
    const name = channelName(video);
    if (!id) return;

    const exists = state.favorites.some(f => f.id === id);
    if (exists) {
      state.favorites = state.favorites.filter(f => f.id !== id);
      toast(`${name} をお気に入りから外しました`);
    } else {
      state.favorites.push({ id, name });
      toast(`${name} をお気に入りに追加しました`);
    }
    await gmSet(KEY_FAVS, state.favorites);
    if (!isYoutubeHost()) injectChannelFavorites(true);

    if (button) button.textContent = state.favorites.some(f => f.id === id) ? '★ お気に入り' : '☆ お気に入り';
  }

  async function ensureApiKey() {
    if (state.apiKey) return true;

    openSettings();
    const input = $('#npf-api-key', state.sheet);
    if (input) {
      input.focus();
      input.scrollIntoView({ block: 'center' });
    }
    toast('先にHolodex APIキーを設定してください', 3500);
    return false;
  }


  // Manual, bounded second pass; never equate the same game with confirmed POV.
  function povDescriptionClues(source) {
    const text=String(source.description||'').slice(0,18000);
    const videoIds=new Set(),channelIds=new Set(),handles=new Set();
    const sourceChannel=channelId(source);
    for(const mention of Array.isArray(source.mentions)?source.mentions:[]) {
      const channel=mention?.channel||mention;
      if(/^UC[A-Za-z0-9_-]{22}$/.test(channel?.id||'')&&channel.id!==sourceChannel) channelIds.add(channel.id);
    }
    const urls=text.match(/(?:https?:\/\/|www\.)(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"'）)\]]+/gi)||[];
    for(const raw of urls.slice(0,80)) {
      try {
        const url=new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw);
        if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname.toLowerCase()))continue;
        const id=parseVideoIdFromUrl(url.href);
        if(id&&id!==source.id)videoIds.add(id);
        const channel=url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/);
        if(channel&&channel[1]!==sourceChannel)channelIds.add(channel[1]);
        const handle=url.pathname.match(/^\/@([A-Za-z0-9._-]{2,30})(?:\/|$)/);
        if(handle)handles.add(handle[1]);
      }catch{}
    }
    return {videoIds:[...videoIds].slice(0,12),channelIds:[...channelIds].slice(0,8),handles:[...handles].slice(0,8),descriptionFound:!!text};
  }

  function povYoutubeDuration(s) {
    const m=String(s||'').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    return m?Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0):0;
  }

  function povYoutubeVideo(item) {
    const live=item?.liveStreamingDetails||{},snippet=item?.snippet||{};
    const start=live.actualStartTime||'';
    const dur=povYoutubeDuration(item?.contentDetails?.duration);
    const end=live.actualEndTime||(start&&dur?new Date(Date.parse(start)+dur*1000).toISOString():'');
    return {id:item?.id,title:snippet.title||'',description:snippet.description||'',
      channel_id:snippet.channelId||'',channel:{id:snippet.channelId||'',name:snippet.channelTitle||''},
      start_actual:start,end_actual:end,duration:dur,
      available_at:start||snippet.publishedAt||'',topic_id:'',
      povTimeVerified:!!(start&&end&&Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end)))};
  }

  function attachPovSupplement(source,baseline,syncOffset,youtubeMode=false) {
    const area=youtubeMode?$('#npf-yt-results'):$('#npf-result-area',state.sheet);
    if(!area)return;
    // Search may be run repeatedly without reloading a YouTube watch page.
    area.parentElement?.querySelector('#npf-pov-supplement')?.remove();
    const section=document.createElement('section');
    section.id='npf-pov-supplement';
    section.style.cssText='border:1px solid #55617b;border-radius:12px;padding:12px;margin:15px 0;background:#151b25;color:#edf2f7;';
    const start=document.createElement('button');start.type='button';start.className='npf-primary';
    start.textContent='🔎 未発見の視点を追加検索';
    start.style.cssText='min-height:44px;width:100%;font-size:13px;';
    const controls=document.createElement('div');controls.hidden=true;
    const notice=document.createElement('p');notice.style.cssText='font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;';
    const query=document.createElement('input');query.className='npf-input';query.maxLength=120;
    query.placeholder='YouTubeで探す語（イベント名・ゲーム名など）';query.value=String(source.topic_id||'').slice(0,100);
    const ytKey=document.createElement('input');ytKey.className='npf-input';ytKey.type='password';
    ytKey.placeholder='YouTube Data APIキー（任意・この検索中のみ）';ytKey.autocomplete='off';
    const searchLink=document.createElement('a');searchLink.target='_blank';searchLink.rel='noopener noreferrer';
    searchLink.style.cssText='display:block;color:#b9d4ff;margin:8px 0;font-size:12px;';
    const updateLink=()=>{
      const q=query.value.trim()||[source.topic_id,source.title].filter(Boolean).join(' ').slice(0,100);
      searchLink.href='https://www.youtube.com/results?search_query='+encodeURIComponent(q);
      searchLink.textContent='↗ YouTubeで「'+q.slice(0,65)+'」を検索（APIキー不要）';
    };
    query.addEventListener('input',updateLink);updateLink();
    const results=document.createElement('div');
    const run=document.createElement('button');run.type='button';run.className='npf-primary';run.textContent='追加候補を探す';
    run.style.cssText='min-height:44px;margin-top:9px;';
    const help=document.createElement('p');help.style.cssText='font-size:11px;line-height:1.5;color:#b9c7dd;';
    help.textContent='概要欄の動画URL・参加者チャンネルをHolodexで照合。任意のYouTube APIキーを入力すると、未発見のチャンネルとキーワードをYouTubeでも検索します。検索はタップ時のみ・件数制限あり。キーは保存・バックアップしません。Twitchは対象外です。';
    controls.append(help,query,searchLink,ytKey,run,notice,results);
    section.append(start,controls);area.after(section);
    start.addEventListener('click',()=>{controls.hidden=!controls.hidden;start.textContent=controls.hidden?'🔎 未発見の視点を追加検索':'🔎 追加検索を閉じる';});
    const known=new Set([source.id,...baseline.map(m=>m.v.id)]),seen=new Map();
    let manualMatches=[];
    function display() {
      results.replaceChildren();
      const items=[...seen.values()].sort((a,b)=>Number(b.direct)-Number(a.direct)||Number(b.match?.related)-Number(a.match?.related));
      if(!items.length)results.textContent='追加候補はまだありません。検索語を変えてYouTube検索も試せます。';
      for(const row of items) {
        if(!section.isConnected)break;
        const v=row.video,match=row.match;
        const card=document.createElement('article');card.style.cssText='border-top:1px solid #46516b;padding:10px 0;font-size:12px;';
        const title=document.createElement('strong');title.textContent=v.title||'動画 '+v.id;title.style.cssText='display:block;overflow-wrap:anywhere;';
        const info=document.createElement('div');info.textContent=channelName(v)+' ／ '+row.reason+(match?' ／ 同時刻の重なり '+fmtDuration(match.overlap):' ／ 配信日時を確認できません');
        info.style.cssText='margin:5px 0;color:#b9c7dd;';
        const open=document.createElement('a');open.href=youtubeUrl(v.id,match?correctedCandidateOffset(source,match):0);
        open.target='_blank';open.rel='noopener noreferrer';open.textContent=match?'↗ 重なり時刻から開く':'↗ 動画を確認する';
        open.style.cssText='display:inline-block;color:#b9d4ff;margin:4px 12px 4px 0;';
        card.append(title,info,open);
        if(match) {
          const add=document.createElement('button');add.type='button';add.className='npf-ghost';
          add.textContent='確認して他視点一覧に追加';add.style.cssText='min-height:38px;margin:4px 0;';
          add.addEventListener('click',()=>{
            if(manualMatches.some(m=>m.v.id===v.id))return;
            match.related=true;match.reasons=[...new Set([...match.reasons,'手動確認した候補'])];
            manualMatches.push(match);
            if(youtubeMode)renderYoutubeMatches(source,[...baseline,...manualMatches],syncOffset);
            else renderMatches(source,[...baseline,...manualMatches],syncOffset);
            add.textContent='✅ この画面の一覧に追加済み';add.disabled=true;
          });card.append(add);
        }
        results.append(card);
      }
    }
    function remember(v,reason,direct=false) {
      if(!v?.id||! /^[A-Za-z0-9_-]{11}$/.test(v.id)||known.has(v.id))return;
      const match=buildMatches(source,[v],syncOffset)[0]||null;
      const prior=seen.get(v.id);
      if(prior&&!direct)return;
      seen.set(v.id,{video:v,match,reason,direct});
    }
    async function youtubeApi(path,key){
      const res=await gmRequest({method:'GET',url:'https://www.googleapis.com/youtube/v3/'+path+(path.includes('?')?'&':'?')+'key='+encodeURIComponent(key),
        headers:{Accept:'application/json'},timeout:22000,responseType:'text'});
      let data;try{data=JSON.parse(res.responseText||res.response||'{}');}catch{throw Error('YouTube APIの応答を解析できません');}
      if(res.status!==200||data.error)throw Error('YouTube API '+res.status+'：'+String(data.error?.message||'検索できません').slice(0,110));
      return data;
    }
    async function ytDetails(ids,key,reason,direct=false){
      for(let i=0;i<ids.length;i+=50){
        const data=await youtubeApi('videos?'+new URLSearchParams({part:'snippet,contentDetails,liveStreamingDetails',id:ids.slice(i,i+50).join(',')}),key);
        for(const item of data.items||[])remember(povYoutubeVideo(item),reason,direct);
      }
    }
    async function ytSearch(params,key,reason){
      const p=new URLSearchParams({part:'snippet',type:'video',maxResults:'25',order:'date',...params});
      const data=await youtubeApi('search?'+p,key);
      await ytDetails((data.items||[]).map(x=>x.id?.videoId).filter(Boolean),key,reason);
    }
    run.addEventListener('click',async()=>{
      if(run.disabled)return;
      run.disabled=true;seen.clear();manualMatches=[];results.replaceChildren();
      const key=ytKey.value.trim();ytKey.value='';
      try {
        notice.textContent='概要欄のリンクとHolodexの参加者情報を確認中…';
        let clues=povDescriptionClues(source);
        // Some Holodex video responses omit optional description/mentions.
        if(!clues.descriptionFound&&!clues.channelIds.length) {
          const detailed=await apiGet('/videos?'+new URLSearchParams({id:source.id,include:'description,mentions',limit:'1'})).catch(()=>[]);
          if(Array.isArray(detailed)&&detailed[0])clues=povDescriptionClues({...source,...detailed[0]});
        }
        const missing=[];
        for(const id of clues.videoIds){
          try{const v=await apiGet('/videos/'+encodeURIComponent(id));remember(v,'概要欄の動画URL',true);}
          catch{missing.push(id);}
        }
        const ss=startOf(source),se=endOf(source),from=new Date(+ss-7*86400000).toISOString(),to=new Date(+se+86400000).toISOString();
        for(const ch of clues.channelIds){
          try {
            const p=new URLSearchParams({channel_id:ch,type:'stream',status:'past',include:'live_info,mentions',from:new Date(+ss-86400000).toISOString(),to:new Date(+se+86400000).toISOString(),limit:'50'});
            for(const v of await apiGet('/videos?'+p))remember(v,'概要欄の参加者チャンネル');
          }catch(e){console.warn('[NPF POV complement channel]',ch,e);}
        }
        if(key){
          notice.textContent='Holodexにない動画をYouTubeで照合中…';
          if(missing.length)await ytDetails(missing,key,'概要欄の動画URL（YouTube照合）',true);
          // Upload date is not proof of co-stream: videos.list confirms live times.
          for(const ch of clues.channelIds.slice(0,4))await ytSearch({channelId:ch,publishedAfter:from,publishedBefore:to},key,'参加者チャンネルの同時刻候補');
          const q=query.value.trim().slice(0,110);
          if(q)await ytSearch({q,publishedAfter:from,publishedBefore:to},key,'キーワード検索・参加者未確認');
        }else for(const id of missing)remember({id,title:'Holodex未登録の概要欄リンク',channel:{name:'投稿者未取得'}},'概要欄の動画URL・日時未確認',true);
        notice.textContent='追加候補：'+seen.size+'件。動画を開いて本人の視点か確認してね。'+
          (key?' YouTube側も照合しました。':' YouTubeの全体検索は上のリンクから可能です（自動照合には任意のAPIキーが必要）。')+
          (clues.handles.length?' 概要欄のハンドル：'+clues.handles.join('、'):'');
        display();
      }catch(e){notice.textContent='⚠️ 追加検索を途中で停止：'+String(e?.message||e)+'。取得済み候補は表示します。';display();}
      finally{run.disabled=false;}
    });
  }

  async function showOtherPOVs(videoId) {
    if (!(await ensureApiKey())) return;

    const rawSync = state.syncPoints?.[videoId];
    const syncOffset = Number.isFinite(Number(rawSync)) ? Number(rawSync) : null;
    const syncLabel = syncOffset != null ? formatClock(syncOffset) : null;

    openSheet(`<div class="npf-loading">${
      syncLabel
        ? `${escapeHtml(syncLabel)} の瞬間に対応する別視点を探しています…`
        : '元アーカイブと同時間帯の配信を探しています…'
    }</div>`);

    try {
      // lang=ja を付けるとHolodex側の追加メタ情報も取得可能。
      const source = await apiGet(`/videos/${encodeURIComponent(videoId)}?lang=ja`);
      const ss = startOf(source), se = endOf(source);

      if (!ss || !se) {
        throw new Error('このアーカイブの配信時間をHolodexから取得できませんでした');
      }

      const syncMoment = syncOffset != null
        ? new Date(ss.getTime() + syncOffset * 1000)
        : null;

      $('.npf-body', state.sheet).innerHTML = `
        <div class="npf-source">
          <div class="npf-source-title">${escapeHtml(source.title || videoId)}</div>
          <div class="npf-channel">${escapeHtml(channelName(source))}</div>
          <div class="npf-meta">${fmtDate(ss)} ～ ${fmtDate(se)} ・ ${fmtDuration((se - ss) / 1000)}</div>
          ${syncOffset != null ? `
            <div class="npf-sync-note">
              ⏱ コメント ${escapeHtml(syncLabel)} → 実時刻 ${escapeHtml(fmtDate(syncMoment))}
              <br>相手視点もこの瞬間に合わせます
            </div>` : ''}
          <div class="npf-toolbar">
            <button id="npf-fav-source" class="npf-ghost" type="button">
              ${isFavorite(source) ? '★ このチャンネルはお気に入り' : '☆ このチャンネルをお気に入り'}
            </button>
            <button id="npf-open-source" class="npf-ghost" type="button">
              ${syncOffset != null ? `${escapeHtml(syncLabel)}から元視点を開く` : 'YouTubeで開く'}
            </button>
            ${syncOffset != null ? `
              <button id="npf-clear-sync" class="npf-ghost" type="button">同期位置を解除</button>
            ` : ''}
          </div>
        </div>
        <div id="npf-result-area" class="npf-loading">候補を取得中…</div>
      `;

      $('#npf-fav-source', state.sheet).addEventListener('click', async (e) => {
        await toggleFavorite(source, e.currentTarget);
        e.currentTarget.textContent = isFavorite(source)
          ? '★ このチャンネルはお気に入り'
          : '☆ このチャンネルをお気に入り';
      });

      $('#npf-open-source', state.sheet).addEventListener('click', () => {
        openUrl(youtubeUrl(source.id, syncOffset || 0));
      });

      $('#npf-clear-sync', state.sheet)?.addEventListener('click', async () => {
        delete state.syncPoints[videoId];
        await gmSet(KEY_SYNC, state.syncPoints);
        updateInlineButtonLabels(videoId);
        updateTimestampSelection(videoId);
        showOtherPOVs(videoId);
      });

      const candidates = await fetchCandidates(source);
      const matches = buildMatches(source, candidates, syncOffset);
      renderMatches(source, matches, syncOffset);
      attachPovSupplement(source, matches, syncOffset);
    } catch (err) {
      console.error('[NPF]', err);
      $('.npf-body', state.sheet).innerHTML = `
        <div class="npf-error">
          ${escapeHtml(err?.message || '別視点検索に失敗しました')}
          <div style="margin-top:10px">
            <button id="npf-open-settings-error" class="npf-ghost" type="button">設定を開く</button>
          </div>
        </div>`;
      $('#npf-open-settings-error', state.sheet)?.addEventListener('click', openSettings);
    }
  }

  // POV search: channel membership comes from the verified *current* fan-Wiki
  // roster, not from the Holodex search org (which can include guest streams).
  function povChannelGroup(video) {
    if (!researchRoster.ready) return 'unknown';
    const ch = video?.channel || {};
    const names = [ch.name, ch.english_name, video?.channel_name]
      .map(researchRosterKey).filter(Boolean);
    if (names.some(name => researchRoster.names.has(name))) return 'nijisanji';
    // An explicit Nijisanji org and a missing name/alias is an unresolved
    // roster match, not proof of being outside.
    if (!names.length || /^(?:nijisanji|にじさんじ)$/i.test(String(ch.org || '').trim()))
      return 'unknown';
    return 'outside';
  }

  function povGroupPass(video, filter) {
    return filter === 'all' || povChannelGroup(video) === filter;
  }

  function povAttachFilter(area, active, onSelect) {
    if (!area) return;
    const bar = document.createElement('div');
    bar.className = 'npf-pov-org-filter';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:7px 0 12px;';
    const label = document.createElement('span');
    label.textContent = '投稿者の所属';
    label.style.cssText = 'font-size:12px;font-weight:700;color:inherit;margin-right:2px;';
    bar.appendChild(label);
    for (const [mode, title] of [['all','すべて'],['nijisanji','にじさんじ'],['outside','にじさんじ以外']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = title;
      button.style.cssText = 'border:1px solid #6b7490;border-radius:9px;padding:8px 10px;min-height:36px;font-size:12px;font-weight:750;cursor:pointer;color:#fff;background:#354158;';
      if (mode === active) button.style.cssText += 'background:#5368d8;border-color:#a4b2ff;';
      button.setAttribute('aria-pressed', String(mode === active));
      button.addEventListener('click', async () => {
        if (mode === active) return;
        if (mode !== 'all' && !researchRoster.ready) {
          button.disabled = true;
          label.textContent = 'Wiki名簿を確認中…';
          try {
            if (!(await ensureResearchRoster())) {
              label.textContent = `所属名簿を取得できません：${researchRoster.error || '再試行してください'}`;
              toast('Wiki名簿を取得できません。所属フィルターは適用していません');
              return;
            }
          } catch (err) {
            label.textContent = `名簿の確認失敗：${err?.message || err}`;
            return;
          } finally { button.disabled = false; }
        }
        onSelect(mode);
      });
      bar.appendChild(button);
    }
    area.prepend(bar);
  }

  function renderMatches(source, matches, syncOffset = null, povOrgFilter = 'all') {
    const area = $('#npf-result-area', state.sheet);
    if (!area) return;

    const related = matches.filter(m => m.related && povGroupPass(m.v, povOrgFilter));
    const others = matches.filter(m => !m.related && m.sameGame && povGroupPass(m.v,povOrgFilter)).slice(0,40);
    const hasSync = syncOffset != null && Number.isFinite(Number(syncOffset));
    let showOthers = true;

    function draw() {
      const visible = showOthers ? [...related, ...others] : related;

      if (!visible.length) {
        area.className = '';
        area.innerHTML = `
          <div class="npf-empty">
            関連性の高い別視点は見つかりませんでした。<br>
            ${hasSync
              ? `ただし ${formatClock(syncOffset)} の瞬間に配信中だった他チャンネルは ${others.length}件あります。`
              : `同時間帯の他チャンネルは ${others.length}件あります。`}
          </div>
          ${others.length ? `
            <div class="npf-more-row">
              <button id="npf-show-others" class="npf-ghost" type="button">同時刻のその他 ${others.length}件を見る</button>
            </div>` : ''}
        `;
        povAttachFilter(area, povOrgFilter, mode => renderMatches(source, matches, syncOffset, mode));
      $('#npf-show-others', area)?.addEventListener('click', () => {
          showOthers = true;
          draw();
        });
        return;
      }

      const eventCount = visible.filter(m => m.event).length;
      const favCount = visible.filter(m => m.favorite).length;

      area.className = '';
      area.innerHTML = `
        <div class="npf-meta" style="margin:0 0 9px">
          ${showOthers ? `${visible.length}視点` : `関連候補 ${related.length}視点`}
          ${eventCount ? `・同イベント ${eventCount}` : ''}
          ${favCount ? `・お気に入り ${favCount}` : ''}
          ${hasSync ? `・${formatClock(syncOffset)} の瞬間に配信中` : ''}
        </div>
        <div class="npf-results">
          ${visible.map((m, idx) => `
            <article class="npf-card ${m.favorite ? 'npf-fav' : ''}" data-idx="${idx}">
              <div>
                <div class="npf-card-title">${escapeHtml(m.v.title || '')}</div>
                <div class="npf-channel">${escapeHtml(channelName(m.v))}</div>
                <div class="npf-badges">
                  <span class="npf-badge">重なり ${fmtDuration(m.overlap)}</span>
                  <span class="npf-badge">${fmtDate(m.cs)}開始</span>
                  ${m.related && m.reasons.length
                    ? `<span class="npf-badge relation">${escapeHtml(m.reasons.join(' / '))}</span>`
                    : ''}
                  ${m.event ? '<span class="npf-badge event">同イベント候補</span>' : ''}
                  ${!m.related ? '<span class="npf-badge">同時刻・同ゲーム／参加者未確認</span>' : ''}
                </div>
                ${hasSync ? `
                  <div class="npf-cal-row">
                    <span class="npf-cal-label">同期補正 ${calibrationFor(source, m.v) > 0 ? '+' : ''}${calibrationFor(source, m.v)}秒</span>
                    <button class="npf-cal-btn" type="button" data-idx="${idx}" data-delta="-30">−30秒</button>
                    <button class="npf-cal-btn" type="button" data-idx="${idx}" data-delta="-10">−10秒</button>
                    <button class="npf-cal-btn" type="button" data-idx="${idx}" data-delta="10">+10秒</button>
                    <button class="npf-cal-btn" type="button" data-idx="${idx}" data-delta="30">+30秒</button>
                    ${calibrationFor(source, m.v) ? `<button class="npf-cal-btn active" type="button" data-idx="${idx}" data-reset="1">リセット</button>` : ''}
                  </div>` : ''}
              </div>
              <div class="npf-actions">
                <button class="npf-primary npf-open-point" type="button" data-idx="${idx}">
                  ${hasSync ? `同じ瞬間 ${formatClock(correctedCandidateOffset(source, m))}` : '重なり開始から'}
                </button>
                <button class="npf-star npf-toggle-fav" type="button" data-idx="${idx}">
                  ${m.favorite ? '★ お気に入り' : '☆ お気に入り'}
                </button>
                <button class="npf-ghost npf-open-start" type="button" data-idx="${idx}">最初から</button>
              </div>
            </article>
          `).join('')}
        </div>
        ${others.length ? `
          <div class="npf-more-row">
            <button id="npf-toggle-others" class="npf-ghost" type="button">
              ${showOthers ? '関連候補だけに戻す' : `同時刻のその他 ${others.length}件も表示`}
            </button>
          </div>` : ''}
      `;

      povAttachFilter(area, povOrgFilter, mode => renderMatches(source, matches, syncOffset, mode));
      $$('.npf-open-point', area).forEach(btn => {
        btn.addEventListener('click', () => {
          const m = visible[Number(btn.dataset.idx)];
          openUrl(youtubeUrl(m.v.id, correctedCandidateOffset(source, m)));
        });
      });

      $$('.npf-open-start', area).forEach(btn => {
        btn.addEventListener('click', () => {
          const m = visible[Number(btn.dataset.idx)];
          openUrl(youtubeUrl(m.v.id));
        });
      });

      $$('.npf-toggle-fav', area).forEach(btn => {
        btn.addEventListener('click', async () => {
          const m = visible[Number(btn.dataset.idx)];
          await toggleFavorite(m.v, btn);
          m.favorite = isFavorite(m.v);

          const card = btn.closest('.npf-card');
          if (card) card.classList.toggle('npf-fav', m.favorite);
        });
      });

      $$('.npf-cal-btn', area).forEach(btn => {
        btn.addEventListener('click', async () => {
          const m = visible[Number(btn.dataset.idx)];
          if (!m) return;
          const value = btn.dataset.reset === '1'
            ? await adjustCalibration(source, m.v, 0, true)
            : await adjustCalibration(source, m.v, Number(btn.dataset.delta || 0));
          toast(`${channelName(m.v)}：このアーカイブの同期補正を ${value > 0 ? '+' : ''}${value}秒 にしました`);
          draw();
        });
      });

      $('#npf-toggle-others', area)?.addEventListener('click', () => {
        showOthers = !showOthers;
        draw();
      });
    }

    draw();
  }


  // ---------- YouTube research helper ----------
  let youtubeTimer = null;
  let youtubeLastVideoId = '';
  let mobileYoutubeTab = 'pov';

  function isYoutubeHost() {
    return /(^|\.)youtube\.com$/i.test(location.hostname);
  }

  function isMobileYoutubeUi() {
    return isYoutubeHost() && (location.hostname === 'm.youtube.com'
      || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints > 1 && window.innerWidth <= 900));
  }

  function currentYoutubeVideoId() {
    if (!isYoutubeHost()) return null;
    const fromUrl = parseVideoIdFromUrl(location.href);
    if (fromUrl) return fromUrl;
    try {
      const u = new URL(location.href);
      const v = u.searchParams.get('v');
      return /^[A-Za-z0-9_-]{11}$/.test(v || '') ? v : null;
    } catch {
      return null;
    }
  }

  function youtubeVideoElement() {
    const videos = $$('video');
    if (!videos.length) return null;
    const playing = videos.find(v => !v.paused && v.readyState >= 1);
    if (playing) return playing;
    const visible = videos.find(v => {
      const r = v.getBoundingClientRect();
      return r.width > 200 && r.height > 100;
    });
    return visible || videos[0];
  }

  function youtubeTitle() {
    const candidates = [
      'ytd-watch-metadata h1 yt-formatted-string',
      '#title h1 yt-formatted-string',
      'h1.ytd-watch-metadata yt-formatted-string',
      'meta[name="title"]',
    ];
    for (const sel of candidates) {
      const el = $(sel);
      const value = el?.content || el?.textContent;
      if (String(value || '').trim()) return String(value).trim();
    }
    return String(document.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
  }

  function youtubeChannelName() {
    const candidates = [
      'ytd-watch-metadata ytd-video-owner-renderer #channel-name a',
      'ytd-watch-metadata #owner #channel-name a',
      '#owner #channel-name a',
      'ytd-channel-name a',
    ];
    for (const sel of candidates) {
      const value = $(sel)?.textContent;
      if (String(value || '').trim()) return String(value).trim();
    }
    return '';
  }

  function youtubeCurrentSeconds() {
    const video = youtubeVideoElement();
    const n = Number(video?.currentTime || 0);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function seekYoutube(delta) {
    const video = youtubeVideoElement();
    if (!video) {
      toast('動画プレイヤーが見つかりません');
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + Number(delta || 0)));
    updateYoutubePanel();
  }

  async function saveYoutubeSync(videoId = currentYoutubeVideoId(), seconds = youtubeCurrentSeconds()) {
    if (!videoId) return null;
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    state.syncPoints[videoId] = value;
    await gmSet(KEY_SYNC, state.syncPoints);
    updateYoutubePanel();
    return value;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch {
      return false;
    }
  }

  async function copyYoutubeTimestamp() {
    const id = currentYoutubeVideoId();
    if (!id) return toast('動画IDを取得できません');
    const sec = youtubeCurrentSeconds();
    const clock = formatClock(sec);
    const url = youtubeUrl(id, sec);
    const mode = state.settings.youtubeCopyMode === 'url-only' ? 'url-only' : 'title-url';

    let text = url;
    if (mode === 'title-url') {
      const title = youtubeTitle();
      const channel = youtubeChannelName();
      text = `${clock}｜${title}${channel ? `｜${channel}` : ''}\n${url}`;
    }

    const ok = await copyText(text);
    const modeLabel = mode === 'url-only' ? 'URLのみ' : 'タイトル＋URL';
    toast(ok ? `📋 ${clock} をコピーしました（${modeLabel}）` : 'コピーに失敗しました');
  }

  function openComment2434ForCurrentVideo() {
    const id = currentYoutubeVideoId();
    if (!id) return toast('動画IDを取得できません');
    openUrl(`https://comment2434.com/comment/video/${encodeURIComponent(id)}/`);
  }


  async function ensureYoutubeApiKey() {
    if (state.apiKey) return true;
    const value = window.prompt('Holodex APIキーを入力してください。\\n（にじさんじコメント検索側と同じ保存先を使います）', '');
    if (value == null) return false;
    const key = String(value).trim();
    if (!key) {
      toast('Holodex APIキーが未設定です');
      return false;
    }
    state.apiKey = key;
    await gmSet(KEY_API, state.apiKey);
    toast('Holodex APIキーを保存しました');
    return true;
  }

  async function openYoutubeQuickSettings() {
    const value = window.prompt(
      'Holodex APIキーを変更できます。\\n空欄で保存すると未設定になります。',
      state.apiKey || ''
    );
    if (value == null) return;
    state.apiKey = String(value).trim();
    await gmSet(KEY_API, state.apiKey);
    toast(state.apiKey ? 'Holodex APIキーを保存しました' : 'Holodex APIキーを解除しました');
    updateYoutubePanel();
  }

  async function favoriteCurrentYoutubeChannel() {
    const id = currentYoutubeVideoId();
    if (!id) return toast('動画IDを取得できません');
    if (!(await ensureYoutubeApiKey())) return;
    try {
      const source = await apiGet(`/videos/${encodeURIComponent(id)}?lang=ja`);
      await toggleFavorite(source);
      updateYoutubePanel();
    } catch (err) {
      console.error('[NPF][YouTube favorite]', err);
      toast(err?.message || 'お気に入り操作に失敗しました');
    }
  }

  async function searchOtherPovsFromYoutube() {
    const id = currentYoutubeVideoId();
    if (!id) return toast('動画IDを取得できません');
    if (!(await ensureYoutubeApiKey())) return;

    const sec = youtubeCurrentSeconds();
    await saveYoutubeSync(id, sec);

    // Never display the previous video's supplement while a new POV search runs.
    document.querySelector('#npf-yt-panel #npf-pov-supplement')?.remove();
    const results = $('#npf-yt-results');
    if (results) {
      results.replaceChildren();
      const loading = document.createElement('div');
      loading.className = 'npf-yt-result-empty';
      loading.textContent = `${formatClock(sec)} の瞬間に対応する別視点を探しています…`;
      results.appendChild(loading);
    }

    try {
      const source = await apiGet(`/videos/${encodeURIComponent(id)}?lang=ja`);
      const candidates = await fetchCandidates(source);
      const matches = buildMatches(source, candidates, sec);
      renderYoutubeMatches(source, matches, sec);
      attachPovSupplement(source, matches, sec, true);
      if (isMobileYoutubeUi()) {
        const panel = $('#npf-yt-panel');
        if (panel && results) {
          const position = results.getBoundingClientRect().top - panel.getBoundingClientRect().top;
          panel.scrollTop += position - 64;
        }
      }
    } catch (err) {
      console.error('[NPF][YouTube POV]', err);
      if (results) {
        results.replaceChildren();
        const error = document.createElement('div');
        error.className = 'npf-yt-result-empty error';
        error.textContent = err?.message || '別視点検索に失敗しました';
        results.appendChild(error);
      }
      toast(err?.message || '別視点検索に失敗しました');
    }
  }

  function renderYoutubeMatches(source, matches, syncOffset, povOrgFilter = 'all') {
    const area = $('#npf-yt-results');
    if (!area) return;

    area.replaceChildren();
    povAttachFilter(area, povOrgFilter, mode => renderYoutubeMatches(source, matches, syncOffset, mode));

    const related = matches.filter(m => m.related && povGroupPass(m.v, povOrgFilter));
    const others = matches.filter(m => !m.related && m.sameGame && povGroupPass(m.v,povOrgFilter)).slice(0,40);
    const list = related;

    const summary = document.createElement('div');
    summary.className = 'npf-yt-result-summary';
    summary.textContent = related.length
      ? `関連候補 ${related.length}件${others.length ? ` ／ その他 ${others.length}件` : ''}`
      : `関連候補なし${others.length ? ` ／ 同時刻のその他 ${others.length}件` : ''}`;
    area.appendChild(summary);

    if (!list.length && !others.length) {
      const empty = document.createElement('div');
      empty.className = 'npf-yt-result-empty';
      empty.textContent = others.length
        ? '関連する別視点は見つかりませんでした。無関係な同時刻配信は下の「その他」から必要な時だけ表示できます。'
        : `${formatClock(syncOffset)} の瞬間に配信中だった別視点は見つかりませんでした。`;
      area.appendChild(empty);
    }

    const drawOne = (m) => {
      const card = document.createElement('div');
      card.className = 'npf-yt-result-card' + (m.favorite ? ' fav' : '');

      const title = document.createElement('div');
      title.className = 'npf-yt-result-title';
      title.textContent = m.v.title || '';
      card.appendChild(title);

      const channel = document.createElement('div');
      channel.className = 'npf-yt-result-channel';
      channel.textContent = channelName(m.v);
      card.appendChild(channel);

      const meta = document.createElement('div');
      meta.className = 'npf-yt-result-meta';
      const reasons = m.reasons?.length ? `・${m.reasons.join(' / ')}` : '';
      meta.textContent = `対応位置 ${formatClock(correctedCandidateOffset(source, m))}${m.related ? reasons : '・同時刻・同ゲーム／参加者未確認'}`;
      card.appendChild(meta);

      const buttons = document.createElement('div');
      buttons.className = 'npf-yt-result-actions';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'npf-yt-btn primary';
      openBtn.textContent = m.related ? '同じ瞬間を開く' : '同じ時刻で開く（未確認）';
      openBtn.addEventListener('click', () => {
        openUrl(youtubeUrl(m.v.id, correctedCandidateOffset(source, m)));
      });
      buttons.appendChild(openBtn);

      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'npf-yt-btn';
      favBtn.textContent = m.favorite ? '★' : '☆';
      favBtn.title = m.favorite ? 'お気に入りから外す' : 'お気に入りに追加';
      favBtn.addEventListener('click', async () => {
        await toggleFavorite(m.v);
        m.favorite = isFavorite(m.v);
        favBtn.textContent = m.favorite ? '★' : '☆';
        card.classList.toggle('fav', m.favorite);
      });
      buttons.appendChild(favBtn);

      for (const delta of [-30, -10, 10, 30]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'npf-yt-cal-btn';
        b.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
        b.title = `この視点の同期補正を${delta > 0 ? '+' : ''}${delta}秒`;
        b.addEventListener('click', async () => {
          const value = await adjustCalibration(source, m.v, delta);
          meta.textContent = `対応位置 ${formatClock(correctedCandidateOffset(source, m))}${m.reasons?.length ? `・${m.reasons.join(' / ')}` : ''}`;
          toast(`${channelName(m.v)}：同期補正 ${value > 0 ? '+' : ''}${value}秒`);
        });
        buttons.appendChild(b);
      }

      card.appendChild(buttons);
      return card;
    };

    list.forEach(m => area.appendChild(drawOne(m)));

    if (others.length) {
      const label = document.createElement('div');
      label.className = 'npf-yt-result-summary';
      label.textContent = `🔎 同時刻・同ゲーム／参加者未確認 ${others.length}件（別企画の可能性あり）`;
      area.appendChild(label);
      for (const m of others) {
        const card = drawOne(m);
        card.style.borderStyle = 'dashed';
        area.appendChild(card);
      }
    }
    if (isMobileYoutubeUi()) styleMobileYoutubePanel($('#npf-yt-panel'));
  }

  async function clearYoutubeSync() {
    const id = currentYoutubeVideoId();
    if (!id) return;
    delete state.syncPoints[id];
    await gmSet(KEY_SYNC, state.syncPoints);
    updateYoutubePanel();
    toast('この動画の同期位置を解除しました');
  }

  // Mobile YouTube may discard GM.addStyle's stylesheet or override its rules.
  // Keep this view usable with inline !important styles, independently of page CSS.
  // Scope this strictly to the mobile YouTube panel (comment2434 and desktop stay as-is).
  function styleMobileYoutubePanel(panel) {
    if (!panel || !isMobileYoutubeUi()) return;
    const put = (el, declarations) => {
      if (!el) return;
      for (const [property, value] of Object.entries(declarations)) {
        el.style.setProperty(property, value, 'important');
      }
    };
    const one = (selector, declarations) => put(panel.querySelector(selector), declarations);
    const all = (selector, declarations) => panel.querySelectorAll(selector)
      .forEach(element => put(element, declarations));

    put(panel, {
      position:'fixed', top:'auto', right:'0', bottom:'0', left:'0',
      margin:'0', width:'100%', 'max-width':'100%',
      height:'min(86dvh, 780px)', 'max-height':'calc(100dvh - 8px)',
      'box-sizing':'border-box', 'border-radius':'20px 20px 0 0',
      background:'#171c2a', color:'#f5f7ff',
      'font-family':'-apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif',
      'font-size':'14px', 'line-height':'1.5',
      'overflow-y':'auto', 'overflow-x':'hidden',
      '-webkit-overflow-scrolling':'touch', 'overscroll-behavior':'contain',
      border:'1px solid #4c5980',
      'box-shadow':'0 -16px 56px rgba(0,0,0,.5)',
      'z-index':'2147483646'
    });
    one('.npf-yt-head', {
      position:'sticky', top:'0', 'z-index':'3', display:'flex',
      'align-items':'center', 'justify-content':'space-between', gap:'10px',
      'min-height':'54px', padding:'10px 16px', 'box-sizing':'border-box',
      background:'#232b42', 'border-bottom':'1px solid #45516e'
    });
    one('.npf-yt-head-title', {'font-size':'17px', 'font-weight':'800', color:'#fff'});
    one('.npf-yt-tabs', {display:'grid','grid-template-columns':'repeat(2,minmax(0,1fr))',gap:'8px',
      position:'sticky',top:'54px','z-index':'3',padding:'10px 16px',background:'#171c2a',
      'border-bottom':'1px solid #45516e'});
    all('.npf-yt-tab', {appearance:'none',display:'block','min-height':'44px',
      'font-size':'13px','font-weight':'800',color:'#fff',border:'1px solid #52607e',
      'border-radius':'11px',padding:'9px 6px','line-height':'1.4',
      background:'#303b53','white-space':'normal'});
    all('.npf-yt-tab[aria-pressed="true"]', {background:'#596fe0','border-color':'#8297ff'});
    one('.npf-yt-close', {
      appearance:'none', border:'1px solid #66728d', 'border-radius':'11px',
      background:'#39445f', color:'#fff', 'font-size':'14px', 'font-weight':'700',
      'min-height':'44px', 'min-width':'80px', padding:'9px 12px', cursor:'pointer'
    });
    one('.npf-yt-body', {
      display:'block', padding:'14px 16px calc(30px + env(safe-area-inset-bottom, 0px))',
      'box-sizing':'border-box'
    });
    one('.npf-yt-video-title', {
      'font-size':'15px', 'font-weight':'800', 'line-height':'1.55', color:'#f5f7ff',
      'overflow-wrap':'anywhere'
    });
    one('.npf-yt-channel', {'font-size':'13px',color:'#c8d0e2','margin-top':'5px'});
    one('.npf-yt-timebox', {
      display:'flex', 'align-items':'center', 'justify-content':'space-between',
      gap:'10px', margin:'12px 0 10px', padding:'12px',
      background:'#101727', border:'1px solid #435276', 'border-radius':'12px'
    });
    one('.npf-yt-time-label', {'font-size':'12px',color:'#d0daf2','font-weight':'700'});
    one('#npf-yt-current-time', {'font-size':'26px','font-weight':'900',color:'#fff','font-variant-numeric':'tabular-nums'});
    one('#npf-yt-sync-status', {'font-size':'12px',color:'#cad4ec','text-align':'right'});
    one('.npf-yt-seek', {
      display:'grid', 'grid-template-columns':'repeat(4,minmax(0,1fr))',
      gap:'7px', margin:'8px 0 12px'
    });
    one('.npf-yt-howto', {
      padding:'11px 12px', margin:'0 0 12px',
      'border-radius':'11px', background:'#243352',color:'#edf1ff',
      'font-size':'13px','line-height':'1.55'
    });
    one('.npf-yt-actions', {
      display:'grid', 'grid-template-columns':'repeat(2,minmax(0,1fr))',
      gap:'9px', margin:'10px 0 12px'
    });
    all('.npf-yt-btn', {
      appearance:'none', border:'1px solid #52607e', 'border-radius':'12px',
      background:'#303b53',color:'#f5f7ff','min-height':'44px',
      padding:'9px 10px','font-size':'13px','font-weight':'750',
      'line-height':'1.4','white-space':'normal',cursor:'pointer',
      'box-sizing':'border-box','overflow-wrap':'anywhere'
    });
    all('.npf-yt-btn.primary', {
      background:'#596fe0',border:'1px solid #8297ff',color:'#fff','font-weight':'850'
    });
    one('#npf-yt-other-pov', {
      'grid-column':'1 / -1', 'min-height':'56px',
      'font-size':'17px','font-weight':'850',
      background:'#586fe0',border:'1px solid #8297ff',color:'#fff'
    });
    all('.npf-yt-btn:disabled', {opacity:'.52'});
    one('.npf-yt-copy-pref', {
      display:'flex','align-items':'center',gap:'10px',margin:'13px 0',
      padding:'10px',background:'#212b40',border:'1px solid #43506d',
      'border-radius':'11px','font-size':'12px'
    });
    one('.npf-yt-copy-pref label', {'font-size':'12px','font-weight':'700',color:'#d9e4ff'});
    one('.npf-yt-copy-pref select', {
      'min-width':'0',flex:'1',background:'#111a2b',color:'#fff',
      'min-height':'38px',border:'1px solid #586887','border-radius':'8px',
      'font-size':'13px',padding:'5px 8px'
    });
    one('.npf-yt-divider', {'height':'1px',background:'#43506d',margin:'15px 0 10px'});
    one('.npf-yt-note', {'font-size':'12px',color:'#c4cfe7','line-height':'1.6'});
    one('.npf-yt-results', {display:'grid',gap:'11px',margin:'14px 0 0'});
    one('.npf-yt-result-summary', {'font-size':'14px','font-weight':'800',color:'#e5ebff'});
    all('.npf-yt-result-empty', {
      border:'1px dashed #586887','border-radius':'11px',padding:'16px 12px',
      'font-size':'13px','line-height':'1.6',color:'#d7dff0','text-align':'center'
    });
    all('.npf-yt-result-card', {
      display:'block',border:'1px solid #495878','border-radius':'13px',
      background:'#202a40',padding:'14px','box-sizing':'border-box'
    });
    all('.npf-yt-result-title', {'font-size':'14px','font-weight':'800','line-height':'1.5',color:'#fff'});
    all('.npf-yt-result-channel', {'font-size':'13px',color:'#d2dbea','margin-top':'5px'});
    all('.npf-yt-result-meta', {'font-size':'12px',color:'#bcc9e1','margin-top':'6px'});
    all('.npf-yt-result-actions', {display:'flex',gap:'8px','flex-wrap':'wrap',margin:'12px 0 0'});
    all('.npf-yt-cal-btn', {
      appearance:'none',border:'1px solid #52607e','border-radius':'9px',
      background:'#303b53',color:'#fff','min-width':'44px',
      'min-height':'44px','font-size':'12px',padding:'8px'
    });
  }

  function ensureYoutubePanel() {
    if (!isYoutubeHost()) return null;
    let panel = $('#npf-yt-panel');
    if (panel) return panel;

    const make = (tag, { id = '', cls = '', text = '', type = '', title = '' } = {}) => {
      const el = document.createElement(tag);
      if (id) el.id = id;
      if (cls) el.className = cls;
      if (text) el.textContent = text;
      if (type) el.type = type;
      if (title) el.title = title;
      return el;
    };

    panel = make('aside', { id: 'npf-yt-panel' });
    panel.setAttribute('aria-hidden', 'true');

    const head = make('div', { cls: 'npf-yt-head' });
    head.appendChild(make('div', { cls: 'npf-yt-head-title', text: isMobileYoutubeUi() ? '👥 他視点・同期' : 'Niji Research Helper' }));
    const closeBtn = make('button', { cls: 'npf-yt-close', text: isMobileYoutubeUi() ? '閉じる ✕' : '✕', type: 'button', title: '閉じる' });
    head.appendChild(closeBtn);
    panel.appendChild(head);

    if (isMobileYoutubeUi()) {
      const tabs = make('div', { id: 'npf-yt-tabs', cls: 'npf-yt-tabs' });
      for (const [tab, label] of [['pov', '👥 他視点・同期'], ['research', '🔎 アーカイブ調査']]) {
        const button = make('button', { cls: 'npf-yt-tab', text: label, type: 'button' });
        button.dataset.npfTab = tab;
        button.setAttribute('aria-pressed', String(tab === mobileYoutubeTab));
        button.addEventListener('click', () => setMobileYoutubeTab(tab));
        tabs.appendChild(button);
      }
      panel.appendChild(tabs);
    }

    const body = make('div', { cls: 'npf-yt-body', id: 'npf-yt-pov-body' });
    body.appendChild(make('div', { id: 'npf-yt-title', cls: 'npf-yt-video-title', text: '動画を読み込み中…' }));
    body.appendChild(make('div', { id: 'npf-yt-channel', cls: 'npf-yt-channel' }));

    const timebox = make('div', { cls: 'npf-yt-timebox' });
    const timeleft = make('div');
    timeleft.appendChild(make('div', { cls: 'npf-yt-time-label', text: '現在位置' }));
    timeleft.appendChild(make('div', { id: 'npf-yt-current-time', text: '0:00' }));
    timebox.appendChild(timeleft);
    timebox.appendChild(make('div', { id: 'npf-yt-sync-status', text: '同期位置なし' }));
    body.appendChild(timebox);

    const seek = make('div', { cls: 'npf-yt-seek' });
    for (const delta of [-30, -10, 10, 30]) {
      const btn = make('button', {
        cls: 'npf-yt-btn',
        text: `${delta > 0 ? '＋' : '−'}${Math.abs(delta)}秒`,
        type: 'button'
      });
      btn.dataset.seek = String(delta);
      seek.appendChild(btn);
    }
    body.appendChild(seek);

    if (isMobileYoutubeUi()) {
      body.appendChild(make('div', { cls: 'npf-yt-howto',
        text: '動画を見たい場面で止めて、下のボタンを押すと、その瞬間の他視点を探します。' }));
    }

    const actions = make('div', { cls: 'npf-yt-actions' });
    const actionDefs = [
      ['npf-yt-other-pov', 'npf-yt-btn primary wide', isMobileYoutubeUi() ? '👥 この時刻の他視点を探す' : '👥 現在位置から他視点'],
      ['npf-yt-comment-search', 'npf-yt-btn', '💬 コメント検索'],
      ['npf-yt-copy', 'npf-yt-btn', '📋 時刻付きコピー'],
      ['npf-yt-save-sync', 'npf-yt-btn', '⏱ 同期位置を保存'],
      ['npf-yt-clear-sync', 'npf-yt-btn', '同期を解除'],
      ['npf-yt-favorite', 'npf-yt-btn', '☆ お気に入り切替'],
      ['npf-yt-settings', 'npf-yt-btn', '⚙ APIキー']
    ];
    for (const [id, cls, label] of actionDefs) {
      actions.appendChild(make('button', { id, cls, text: label, type: 'button' }));
    }
    body.appendChild(actions);

    const copyPref = make('div', { cls: 'npf-yt-copy-pref' });
    const copyLabel = make('label', { text: 'コピー形式' });
    copyLabel.htmlFor = 'npf-yt-copy-mode';
    const copySelect = make('select', { id: 'npf-yt-copy-mode' });
    const copyOptions = [
      ['url-only', 'URLのみ'],
      ['title-url', 'タイトル＋URL']
    ];
    for (const [value, label] of copyOptions) {
      const opt = make('option', { text: label });
      opt.value = value;
      copySelect.appendChild(opt);
    }
    copySelect.value = state.settings.youtubeCopyMode === 'url-only' ? 'url-only' : 'title-url';
    copyPref.appendChild(copyLabel);
    copyPref.appendChild(copySelect);
    body.appendChild(copyPref);

    body.appendChild(make('div', { cls: 'npf-yt-divider' }));
    body.appendChild(make('div', {
      cls: 'npf-yt-note',
      text: '他視点は現在位置を実時刻に換算し、同じ瞬間に配信中だった視点へ合わせます。'
    }));

    const results = make('div', { id: 'npf-yt-results', cls: 'npf-yt-results' });
    body.appendChild(results);

    panel.appendChild(body);
    if (isMobileYoutubeUi()) {
      // Keep the overlay outside YouTube's frequently replaced mobile body.
      document.documentElement.appendChild(panel);
      const critical = {
        position: 'fixed', right: '12px', bottom: 'calc(86px + env(safe-area-inset-bottom, 0px))',
        width: 'min(350px, calc(100vw - 24px))', 'max-height': 'calc(100dvh - 118px)',
        'z-index': '2147483646', background: '#181b26', color: '#f1f1f1',
        'box-sizing': 'border-box', 'border-radius': '16px', 'overflow': 'auto',
        border: '1px solid #3c4864',
      };
      for (const [key, value] of Object.entries(critical)) panel.style.setProperty(key, value, 'important');
      styleMobileYoutubePanel(panel);
    } else {
      (document.body || document.documentElement).appendChild(panel);
      installYoutubePanelResize(panel, head, closeBtn);
    }
    syncYoutubePanelVisibility();

    closeBtn.addEventListener('click', closeYoutubePanel);
    $$('[data-seek]', panel).forEach(btn => btn.addEventListener('click', () => seekYoutube(Number(btn.dataset.seek || 0))));
    $('#npf-yt-other-pov', panel)?.addEventListener('click', () => void searchOtherPovsFromYoutube());
    $('#npf-yt-comment-search', panel)?.addEventListener('click', openComment2434ForCurrentVideo);
    $('#npf-yt-copy', panel)?.addEventListener('click', () => void copyYoutubeTimestamp());
    $('#npf-yt-copy-mode', panel)?.addEventListener('change', async (e) => {
      state.settings.youtubeCopyMode = e.target.value === 'url-only' ? 'url-only' : 'title-url';
      await gmSet(KEY_SETTINGS, state.settings);
      toast(`コピー形式：${state.settings.youtubeCopyMode === 'url-only' ? 'URLのみ' : 'タイトル＋URL'}`);
    });
    $('#npf-yt-save-sync', panel)?.addEventListener('click', async () => {
      const value = await saveYoutubeSync();
      if (value != null) toast(`⏱ ${formatClock(value)} を同期位置に保存しました`);
    });
    $('#npf-yt-clear-sync', panel)?.addEventListener('click', () => void clearYoutubeSync());
    $('#npf-yt-favorite', panel)?.addEventListener('click', () => void favoriteCurrentYoutubeChannel());
    $('#npf-yt-settings', panel)?.addEventListener('click', () => void openYoutubeQuickSettings());

    updateYoutubePanel();
    if (isMobileYoutubeUi()) {
      // Research is created separately so its failure cannot take down the NIJI button.
      try { ensureMobileYoutubeResearchTab(); setMobileYoutubeTab(mobileYoutubeTab); } catch (error) {
        console.warn('[NRH] mobile research UI unavailable', error);
      }
    }
    return panel;
  }

  function mobileResearchPageHint() {
    const hint = $('#npf-r-mobile-route');
    if (!hint) return;
    const active = isYoutubeResearchPage();
    hint.hidden = active;
    // This is a deliberately local operation: never fetch a channel automatically.
    const start = $('#npf-r-collection-toggle');
    if (start) start.disabled = !active;
    const retry = $('#npf-r-rescan');
    if (retry) retry.disabled = !active;
    const origin = location.hostname === 'm.youtube.com' ? 'm.youtube.com' : 'www.youtube.com';
    const link = $('#npf-r-mobile-channel-link');
    if (link) {
      // Prefer the creator link of the current watch page, not an arbitrary recommendation.
      const creator = document.querySelector('ytm-slim-owner-renderer a[href^="/@"], ytm-slim-owner-renderer a[href^="/channel/"], ytd-video-owner-renderer a[href^="/@"], ytd-video-owner-renderer a[href^="/channel/"], #owner a[href^="/@"], #owner a[href^="/channel/"]');
      const href = creator?.getAttribute('href') || '';
      const path = href.match(/^\/(?:@[^/?#]+|channel\/UC[A-Za-z0-9_-]+|c\/[^/?#]+|user\/[^/?#]+)/)?.[0] || '';
      link.href = path ? `https://${origin}${path}/streams` : '#';
      link.hidden = !path;
    }
    const note = $('#npf-r-mobile-db-note');
    if (note) note.hidden = location.hostname !== 'm.youtube.com';
  }

  function mobileResearchOpenChannel() {
    const input = $('#npf-r-mobile-channel-input');
    const value = String(input?.value || '').trim();
    if (!value) return toast('チャンネルURLまたは @ハンドルを入力してください');
    let path = '';
    try {
      const url = new URL(value.startsWith('@') ? `https://www.youtube.com/${value}` : value);
      if (!/(^|\.)youtube\.com$/i.test(url.hostname)) throw new Error('YouTubeのURLを入力してください');
      path = url.pathname.match(/^\/(?:@[^/?#]+|channel\/UC[A-Za-z0-9_-]+|c\/[^/?#]+|user\/[^/?#]+)/)?.[0] || '';
    } catch (error) {
      toast(error?.message || 'チャンネルURLを確認してください');
      return;
    }
    if (!path) return toast('チャンネルのURLか @ハンドルを入力してください');
    location.assign(`${location.origin}${path}/streams`);
  }

  function styleMobileResearchTab() {
    if (!isMobileYoutubeUi()) return;
    const root = $('#npf-yt-panel');
    const panel = $('#npf-research-panel');
    if (!root || !panel) return;
    const set = (node, styles) => {
      if (!node) return;
      for (const [prop, value] of Object.entries(styles)) node.style.setProperty(prop, value, 'important');
    };
    set($('#npf-research-fab'), {display:'none',visibility:'hidden'});
    set(panel, {
      position:'static',top:'auto',right:'auto',bottom:'auto',left:'auto',
      width:'100%','max-width':'100%','max-height':'none',height:'auto',
      overflow:'visible',margin:'0',padding:'0','box-sizing':'border-box',
      background:'#171c2a',color:'#f5f7ff',border:'0','border-radius':'0','box-shadow':'none',
      'font-family':'-apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif',
      'font-size':'14px','line-height':'1.5',
      display:mobileYoutubeTab === 'research' ? 'block' : 'none'
    });
    set(panel.querySelector('.npf-r-head'), {display:'none'});
    set(panel.querySelector('.npf-r-body'), {padding:'14px 16px calc(30px + env(safe-area-inset-bottom, 0px))'});
    panel.querySelectorAll('button, input, select').forEach(el => {
      set(el, {'font-size':'14px','min-height':'40px','max-width':'100%','box-sizing':'border-box'});
    });
    panel.querySelectorAll('.npf-r-btn').forEach(el => {
      set(el, {background:el.classList.contains('primary')?'#586fe0':'#303b53',color:'#fff',
        border:'1px solid #52607e','border-radius':'10px',padding:'8px 10px'});
    });
    panel.querySelectorAll('.npf-r-input').forEach(el => {
      set(el, {background:'#101727',color:'#fff',border:'1px solid #52607e',
        'border-radius':'10px',width:'100%',padding:'8px 10px'});
    });
    panel.querySelectorAll('.npf-r-filter').forEach(el => {
      set(el, {background:el.classList.contains('excluded')?'#803746':el.classList.contains('active')?'#5147a6':'#303b53',
        color:'#fff','border-radius':'999px',padding:'7px 12px'});
    });
    set($('#npf-r-mobile-route'), {background:'#25324b',color:'#f5f7ff',
      padding:'12px',margin:'0 0 12px','border-radius':'12px',
      border:'1px solid #52607e'});
    const note = $('#npf-r-mobile-db-note');
    if (note) set(note, {color:'#f9d69e','font-size':'12px','line-height':'1.5',margin:'10px 0'});
    set($('#npf-r-mobile-channel-link'), {display:$('#npf-r-mobile-channel-link')?.hidden?'none':'block',
      color:'#dbe3ff',padding:'8px 0','font-weight':'700'});
    // Keep backup/restore available on both origins, but do not expose the
    // destructive DB reset control on the small mobile panel.
    set($('#npf-r-db-clear'), {display:'none'});
  }

  function ensureMobileYoutubeResearchTab() {
    if (!isMobileYoutubeUi()) return;
    const parent = $('#npf-yt-panel');
    if (!parent) return;
    const panel = ensureResearchUi();
    if (!panel) return;
    if (panel.parentElement !== parent) parent.appendChild(panel);
    const body = panel.querySelector('.npf-r-body');
    if (body && !$('#npf-r-mobile-route')) {
      const hint = document.createElement('div');
      hint.id = 'npf-r-mobile-route';
      const intro = document.createElement('div');
      intro.textContent = 'チャンネルの「ライブ」または「動画」一覧を開いて、▶ 取得開始を押してください。表示中の動画だけが対象です。';
      const openCurrent = document.createElement('a');
      openCurrent.id = 'npf-r-mobile-channel-link';
      openCurrent.textContent = '↗ この動画のチャンネルのライブ一覧へ';
      openCurrent.target = '_self';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
      const input = document.createElement('input');
      input.id = 'npf-r-mobile-channel-input';
      input.type = 'text';
      input.placeholder = '@ハンドル または YouTubeチャンネルURL';
      input.style.cssText = 'min-width:0;flex:1;background:#101727;color:#fff;border:1px solid #52607e;border-radius:9px;padding:8px;font-size:14px;';
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = '開く';
      go.style.cssText = 'background:#586fe0;color:#fff;border:0;border-radius:9px;padding:8px 12px;font-size:14px;';
      go.addEventListener('click', mobileResearchOpenChannel);
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); mobileResearchOpenChannel(); }
      });
      row.append(input, go);
      hint.append(intro, openCurrent, row);
      body.prepend(hint);
      const dbNote = document.createElement('div');
      dbNote.id = 'npf-r-mobile-db-note';
      dbNote.textContent = '💾 このページの調査結果はm.youtube.com専用のローカルDBに保存します。www.youtube.comやPCのDBとは自動共有されません。移す場合は「DBバックアップ」「DB復元」を使用してください。';
      body.insertBefore(dbNote, $('#npf-r-db-status'));
    }
    mobileResearchPageHint();
    styleMobileResearchTab();
  }

  function setMobileYoutubeTab(tab) {
    if (!isMobileYoutubeUi()) return;
    mobileYoutubeTab = tab === 'research' ? 'research' : 'pov';
    if (mobileYoutubeTab === 'research') {
      try { ensureMobileYoutubeResearchTab(); handleResearchNavigation(); scanYoutubeResearchCards(); }
      catch (error) { console.warn('[NRH] mobile research tab', error); toast('調査画面の表示に失敗しました'); }
      void updateResearchDbStatus();
    }
    const parent = $('#npf-yt-panel');
    if (!parent) return;
    const pov = $('#npf-yt-pov-body');
    if (pov) pov.style.setProperty('display', mobileYoutubeTab === 'pov' ? 'block' : 'none', 'important');
    const title = parent.querySelector('.npf-yt-head-title');
    if (title) title.textContent = mobileYoutubeTab === 'research' ? '🔎 アーカイブ調査' : '👥 他視点・同期';
    parent.querySelectorAll('[data-npf-tab]').forEach(btn => {
      const selected = btn.dataset.npfTab === mobileYoutubeTab;
      btn.setAttribute('aria-pressed', String(selected));
      btn.style.setProperty('background',selected?'#596fe0':'#303b53','important');
    });
    styleMobileResearchTab();
    parent.scrollTop = 0;
  }

  function syncYoutubePanelVisibility() {
    const widget = $('#npf-yt-widget');
    const panel = $('#npf-yt-panel');
    if (!panel) return;

    const mobileFab = isMobileYoutubeUi() ? $('#npf-fab.npf-mobile-fab') : null;
    const open = mobileFab ? mobileFab.getAttribute('aria-expanded') === 'true' : !!widget?.open;
    panel.classList.toggle('npf-visible', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');

    // YouTube 側のCSSに負けないため、表示に関する最低限だけ inline !important でも固定する。
    panel.style.setProperty('display', open ? 'block' : 'none', 'important');
    panel.style.setProperty('visibility', open ? 'visible' : 'hidden', 'important');
    panel.style.setProperty('opacity', open ? '1' : '0', 'important');
    panel.style.setProperty('pointer-events', open ? 'auto' : 'none', 'important');
    if (mobileFab) mobileFab.style.setProperty('display', open ? 'none' : 'flex', 'important');
  }

  function updateYoutubePanel() {
    const panel = ensureYoutubePanel();
    if (!panel) return;

    const id = currentYoutubeVideoId();
    const title = youtubeTitle();
    const channel = youtubeChannelName();
    const current = youtubeCurrentSeconds();
    const savedRaw = id ? state.syncPoints?.[id] : null;
    const saved = Number.isFinite(Number(savedRaw)) ? Number(savedRaw) : null;

    const titleEl = $('#npf-yt-title', panel);
    const channelEl = $('#npf-yt-channel', panel);
    const timeEl = $('#npf-yt-current-time', panel);
    const syncEl = $('#npf-yt-sync-status', panel);
    const clearBtn = $('#npf-yt-clear-sync', panel);
    const copyModeEl = $('#npf-yt-copy-mode', panel);

    if (titleEl) titleEl.textContent = id ? (title || 'タイトル取得中…') : 'YouTubeの動画ページで使えます';
    if (channelEl) channelEl.textContent = channel || '';
    if (timeEl) timeEl.textContent = formatClock(current);
    if (syncEl) syncEl.textContent = saved != null ? `保存済み ${formatClock(saved)}` : '同期位置なし';
    if (clearBtn) clearBtn.disabled = saved == null;
    if (copyModeEl) copyModeEl.value = state.settings.youtubeCopyMode === 'url-only' ? 'url-only' : 'title-url';

    const otherBtn = $('#npf-yt-other-pov', panel);
    const commentBtn = $('#npf-yt-comment-search', panel);
    const copyBtn = $('#npf-yt-copy', panel);
    const saveBtn = $('#npf-yt-save-sync', panel);
    [otherBtn, commentBtn, copyBtn, saveBtn].forEach(btn => { if (btn) btn.disabled = !id; });
  }

  function openYoutubePanel() {
    const panel = ensureYoutubePanel();
    const widget = $('#npf-yt-widget');
    const mobileFab = $('#npf-fab.npf-mobile-fab');
    if (!panel || (!widget && !mobileFab)) return;
    if (mobileFab) mobileFab.setAttribute('aria-expanded', 'true');
    else widget.open = true;
    syncYoutubePanelVisibility();
    updateYoutubePanel();
  }

  function closeYoutubePanel() {
    const widget = $('#npf-yt-widget');
    const mobileFab = $('#npf-fab.npf-mobile-fab');
    if (mobileFab) mobileFab.setAttribute('aria-expanded', 'false');
    if (widget) widget.open = false;
    syncYoutubePanelVisibility();
  }

  function toggleYoutubePanel() {
    const panel = ensureYoutubePanel();
    const widget = $('#npf-yt-widget');
    const mobileFab = $('#npf-fab.npf-mobile-fab');
    if (!panel || (!widget && !mobileFab)) return;
    const open = mobileFab ? mobileFab.getAttribute('aria-expanded') !== 'true' : !widget.open;
    if (mobileFab) mobileFab.setAttribute('aria-expanded', String(open));
    else widget.open = open;
    syncYoutubePanelVisibility();
    if (open) updateYoutubePanel();
  }


  // ---------- YouTube archive research (search / channel videos) ----------
  const RESEARCH_TAGS = ['FPS', 'スト鯖', '大会', 'ソロゲー', 'コラボ', '雑談', '歌'];
  const research = {
    // 一覧にアクセスしただけでは外部APIを叩かない。開始操作はページ遷移で解除。
    collectionActive: false,
    collectionRoute: '',
    autoChannelKeys: new Set(),
    observer: null,
    scanTimer: null,
    entries: new Set(),
    metaCache: new Map(),
    pendingMeta: new Map(),
    queue: [],
    queuedIds: new Set(),
    workers: 0,
    metaAttempts: new Map(),
    metaFailures: new Map(),
    metaRetryTimers: new Map(),
    holodexCooldownUntil: 0,
    holodexCooldownLevel: 0,
    holodexPaused: false,
    holodexCooldownTimer: null,
    holodexPumpTimer: null,
    holodexLastRequestAt: 0,
    dbLookupPending: new Set(),
    activeTags: new Set(),
    excludedTags: new Set(),
    gameIncluded: new Map(), // normalized game -> display name (OR)
    gameExcluded: new Map(), // exclude wins; loaded cards only
    includeText: '',
    excludeText: '',
    collaboratorFilter: '', // Full-history focus; local card filtering uses the Sets below.
    collaboratorIncluded: new Map(), // normalized person -> display name; multiple matches use OR
    collaboratorExcluded: new Map(), // normalized person -> display name; exclusions always win
    collaboratorGroupIncluded: new Set(), // nijisanji / outside, OR with individual includes
    collaboratorGroupExcluded: new Set(), // independently exclude both groups
    collaboratorChannel: '',
    collabHistoryRows: [],
    collabHistoryYears: [],
    collabHistoryYearStats: {},
    collabHistoryLoading: false,
    collabHistoryHolodexCount: 0,
    collabHistoryWikiCount: 0,
    collabHistoryResolveNote: '',
    channelResolveCache: new Map(),
    collabHistoryToken: 0,
    lastUrl: '',
    wikiPending: new Map(),
    wikiQueue: [],
    wikiQueued: new Set(),
    wikiWorkers: 0,
    wikiMatched: 0,
  };

  function isYoutubeResearchPage() {
    if (!isYoutubeHost()) return false;
    const p = location.pathname || '';
    if (p === '/results') return true;
    return /\/(videos|streams)\/?$/i.test(p) && (/^\/@/.test(p) || /^\/channel\//.test(p) || /^\/c\//.test(p) || /^\/user\//.test(p));
  }

  function researchChannelKey() {
    const m = String(location.pathname || '').match(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(?:videos|streams)\/?$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function splitResearchWords(raw = '') {
    return String(raw).split(/[\s,、]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  }

  function normalizeResearchText(s = '') {
    return String(s).toLowerCase().replace(/[\s　]+/g, ' ').trim();
  }

  function wikiDecodeEntities(s = '') {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
        try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; }
      })
      .replace(/&#(\d+);/g, (_, n) => {
        try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; }
      })
      .replace(/&([a-z]+);/gi, (m, k) => Object.prototype.hasOwnProperty.call(named, k.toLowerCase()) ? named[k.toLowerCase()] : m);
  }

  function wikiHtmlToText(html = '') {
    return wikiDecodeEntities(String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|div|li|ul|ol|table|thead|tbody|tfoot|tr|td|th|h[1-6]|details|summary)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '))
      .replace(/\r/g, '')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function wikiCleanPersonName(name = '') {
    return String(name)
      .replace(/[（(](?:VC|ボイチャ|通話)?\s*(?:なし|無し|不参加)[）)]/gi, '')
      .replace(/[（(](?:敬称略|途中参加|途中離脱|視点|主催)[^）)]*[）)]/g, '')
      .replace(/^[・･\s]+|[・･\s]+$/g, '')
      .trim();
  }

  function wikiParsePeople(raw = '') {
    let text = String(raw || '').trim();
    // 「ユニット名(人A、人B…)」のような記載は括弧内を優先。
    const group = text.match(/^[^（(]{1,40}[（(]([^）)]+[、,][^）)]+)[）)]\s*$/);
    if (group) text = group[1];
    const out = [];
    const seen = new Set();
    for (const bit of text.split(/[、,，]/)) {
      let name = wikiCleanPersonName(bit)
        .replace(/^(?:・|･)+/, '')
        .replace(/(?:別窓|外部リンク|新しいタブで開く).*$/i, '')
        .trim();
      if (!name || /こちら|参照|ほか|その他|他参加者/i.test(name)) continue;
      // 次の説明文まで巻き込んだ場合は切る。
      name = name.replace(/\s+(?:案件配信|提供|に出場|MC(?:を)?担当|司会|本配信視点).*$/i, '').trim();
      if (!name) continue;
      const key = normalizeResearchText(name).replace(/\s/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  // Wiki free-text: "1:03:10~からAがVC合流、1:28:00~からB、2:15:30~からCが合流".
  // A timestamp + an explicit participation word in the SAME note are required;
  // never infer participants from ordinary timestamps, titles or interviews.
  function wikiExtractJoinPeople(line = '') {
    const text = String(line || '').replace(/[\u00a0\u3000]/g, ' ').trim();
    if (!/(?:VC|ボイチャ|通話|合流|途中参加)/i.test(text)) return [];
    const stamp = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[~～〜]\s*から\s*/g;
    const hits = [...text.matchAll(stamp)];
    const out = [];
    for (let i = 0; i < hits.length; i++) {
      const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
      let segment = text.slice(hits[i].index + hits[i][0].length, end)
        .replace(/^[、，,・･\s]+|[、，,。．.!！\s]+$/g, '')
        .replace(/(?:が|と|も)?\s*(?:VC|ボイチャ|通話)?\s*(?:に)?(?:合流|途中参加)(?:した|する|予定)?\s*$/i, '')
        .replace(/[、，,。．.!！\s]+$/g, '').trim();
      // Only a short name / comma-separated names are supported. Do not turn
      // arbitrary prose, notes or the channel owner into collaborators.
      if (!segment || segment.length > 65 || /(?:https?:|[：:]|配信|コメント|時間|から|まで|実況|解説|インタビュー|不参加|なし)/i.test(segment)) continue;
      for (const raw of segment.split(/[、，,]/)) {
        const name = wikiCleanPersonName(raw).trim();
        if (!name || name.length > 32 || /[。.!！?？()（）]/.test(name)) continue;
        if (!out.some(p => p.name === name)) out.push({name, at: hits[i][1]});
      }
    }
    return out;
  }

  function wikiParsePage(html = '', sourceUrl = '') {
    const raw = String(html || '');
    const anchors = [];
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(raw))) {
      let href = wikiDecodeEntities(m[1]);
      // 外部リンクのリダイレクトURLではYouTube URLがURLエンコードされる。
      // href全体を数回デコードしてから動画IDを探す。
      for (let i = 0; i < 3; i++) {
        let next = href;
        try { next = decodeURIComponent(next); } catch {}
        next = wikiDecodeEntities(next);
        if (next === href) break;
        href = next;
      }
      const id = parseVideoIdFromUrl(href);
      if (!id) continue;
      anchors.push({ id, index: m.index, end: re.lastIndex, title: wikiHtmlToText(m[2]) });
    }

    const PERSON_LABEL = '(?:コラボ相手|共演者|共演|チームメンバー|チームメイト|(?:にじさんじ所属の)?対戦相手|他参加者|参加者|他出演者|出演者|ゲスト(?:出演)?)';
    const personLineRe = new RegExp(PERSON_LABEL + '[：:]\\s*(.*)$', 'i');
    const personAnyRe = new RegExp('(' + PERSON_LABEL + ')[：:]\\s*(.*)$', 'i');
    const noteRe = /(?:コラボに参加|他参加者|共演|ゲスト出演|出演|大会.{0,16}出場|に出場|MC(?:を)?担当|司会|PR配信|提供[：:]|案件配信|案件|本配信視点|視点はなし|同時視聴|主催)/i;

    const entries = {};
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      // 同じ動画への補助リンクが続く場合は最初の情報を軸に統合。
      let next = raw.length;
      for (let j = i + 1; j < anchors.length; j++) {
        if (anchors[j].id !== a.id) { next = anchors[j].index; break; }
      }
      const chunk = raw.slice(a.end, Math.min(next, a.end + 20000));
      const text = wikiHtmlToText(chunk);
      // 以前は先頭30行で打ち切っていたため、Wikiの装飾DOMが多いページで
      // 「コラボ相手」行まで届かないことがあった。ここでは全行を見る。
      const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
      const collaborators = [];
      const collaboratorLabels = [];
      const collaboratorJoinTimes = {};
      const notes = [];
      let hasCollabNote = false;

      const addPeople = (label, value) => {
        let v = String(value || '').trim();
        if (!v) return;
        // 1つのテキスト行に別の注記まで連結された時の安全弁。
        v = v.replace(/\s+(?:案件配信|提供|大会.{0,20}出場|MC(?:を)?担当|司会|本配信視点|視点はなし).*$/i, '').trim();
        if (!v) return;
        hasCollabNote = true;
        collaboratorLabels.push(`${label}：${v}`);
        collaborators.push(...wikiParsePeople(v));
      };

      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        for (const {name, at} of wikiExtractJoinPeople(line)) {
          collaborators.push(name);
          collaboratorJoinTimes[name] ||= at;
          hasCollabNote = true;
        }
        // 行頭固定にしない。Wikiのテーブル記号・注記・案件文の後に
        // 「コラボ相手：」が続くケースも拾う。
        const pm = line.match(personAnyRe);
        if (pm) {
          let value = String(pm[2] || '').trim();
          // ラベル直後で改行されているHTMLにも対応。
          if (!value) {
            const cont = [];
            for (let k = li + 1; k < Math.min(lines.length, li + 5); k++) {
              const nx = lines[k];
              if (personLineRe.test(nx) || noteRe.test(nx) || /^\d{1,2}[\/月]\d{1,2}/.test(nx)) break;
              cont.push(nx);
              if (/[、,，]/.test(nx)) continue;
            }
            value = cont.join(' ');
          }
          addPeople(pm[1].replace(/^(?:にじさんじ所属の)/, ''), value);
        }
        if (noteRe.test(line)) {
          notes.push(line);
          if (/コラボ|参加者|共演|ゲスト|対戦|チームメンバー|チームメイト/i.test(line)) hasCollabNote = true;
        }
      }

      // フォールバック：HTMLの都合で「コラボ相手」と名前が別行に砕けても、
      // 動画から次の動画までの塊を平坦化してもう一度拾う。
      if (!collaborators.length && /(?:コラボ相手|共演者|チームメンバー|チームメイト|参加者|出演者|ゲスト)/i.test(text)) {
        const flat = lines.join(' ').replace(/\s+/g, ' ').trim();
        const labels = ['コラボ相手','共演者','チームメンバー','チームメイト','他参加者','参加者','他出演者','出演者','ゲスト出演','ゲスト'];
        for (const label of labels) {
          const posRe = new RegExp(label + '[：:]\\s*', 'i');
          const hit = posRe.exec(flat);
          if (!hit) continue;
          let value = flat.slice(hit.index + hit[0].length, hit.index + hit[0].length + 600);
          // 次の明確な注記・ラベルの手前まで。
          value = value.split(/\s+(?=(?:コラボ相手|共演者|チームメンバー|チームメイト|他参加者|参加者|他出演者|出演者|ゲスト出演|ゲスト)[：:])/i)[0];
          value = value.replace(/\s+(?:案件配信|提供|大会.{0,20}出場|MC(?:を)?担当|司会|本配信視点|視点はなし).*$/i, '').trim();
          addPeople(label, value);
          if (collaborators.length) break;
        }
      }

      const uniquePeople = [];
      const seenPeople = new Set();
      for (const p of collaborators) {
        const key = normalizeResearchText(p).replace(/\s/g, '');
        if (!key || seenPeople.has(key)) continue;
        seenPeople.add(key); uniquePeople.push(p);
      }
      const info = entries[a.id] || {
        videoId: a.id, wikiTitle: a.title, collaborators: [], collaboratorLabels: [], collaboratorJoinTimes: {}, notes: [], hasCollabNote: false, sourceUrl
      };
      info.wikiTitle ||= a.title;
      info.hasCollabNote = info.hasCollabNote || hasCollabNote;
      info.collaborators = [...new Set([...(info.collaborators || []), ...uniquePeople])];
      info.collaboratorLabels = [...new Set([...(info.collaboratorLabels || []), ...collaboratorLabels])];
      info.collaboratorJoinTimes = {...(info.collaboratorJoinTimes || {}), ...collaboratorJoinTimes};
      info.notes = [...new Set([...(info.notes || []), ...notes])].slice(0, 8);
      info.sourceUrl = sourceUrl;
      entries[a.id] = info;
    }
    return entries;
  }


  // ---------- WIKIWIKI source parser ----------
  // 通常ページのDOMはWIKIWIKI側の装飾・外部リンク処理の影響を受けるため、
  // sourceコマンドの整形前Wiki記法を直接読む経路を優先する。
  function wikiSourceCommandUrls(pageUrl = '') {
    try {
      const u = new URL(pageUrl);
      const prefix = '/nijisanji/';
      if (!u.pathname.startsWith(prefix)) return [];
      let page = u.pathname.slice(prefix.length);
      try { page = decodeURIComponent(page); } catch {}
      if (!page || page.startsWith('::cmd/')) return [];
      const encoded = encodeURIComponent(page);
      // 現在のWIKIWIKIで案内されている ::cmd/source を先に試す。
      // ?cmd=source はPukiWiki互換のフォールバック。
      return [
        `${WIKI_BASE}/::cmd/source?page=${encoded}`,
        `${WIKI_BASE}/?cmd=source&page=${encoded}`,
      ];
    } catch {
      return [];
    }
  }

  function wikiExtractSourceText(sourceHtml = '') {
    const raw = String(sourceHtml || '');
    // sourceページには通報・コメント等の別textarea/preが混ざることがある。
    // 最初のtextareaではなく、PukiWiki記法＋YouTube URLを最も多く含む候補を採用する。
    const candidates = [];
    const blockRes = [
      /<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi,
      /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
      /<code\b[^>]*>([\s\S]*?)<\/code>/gi,
    ];
    for (const re of blockRes) {
      let m;
      while ((m = re.exec(raw))) {
        const decoded = wikiDecodeEntities(String(m[1] || '').replace(/<[^>]+>/g, ''))
          .replace(/\r/g, '')
          .trim();
        if (!decoded) continue;
        const youtubeCount = (decoded.match(/https?:\/\/(?:youtu\.be|(?:www\.)?youtube\.com)\//gi) || []).length;
        const wikiMarks = (decoded.match(/\[\[|BGCOLOR|#fold|&color|コラボ相手[：:]/g) || []).length;
        const score = youtubeCount * 20 + wikiMarks * 3 + Math.min(decoded.length / 10000, 5);
        candidates.push({ text: decoded, score, youtubeCount });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates[0]?.youtubeCount) return candidates[0].text;

    // sourceコマンドがtext/plain相当を返す実装にも対応。
    const decodedRaw = wikiDecodeEntities(raw).replace(/\r/g, '').trim();
    if (/https?:\/\/(?:youtu\.be|(?:www\.)?youtube\.com)\//i.test(decodedRaw) &&
        /\[\[|BGCOLOR|#fold|&color|コラボ相手[：:]/i.test(decodedRaw)) {
      return decodedRaw;
    }
    return '';
  }

  function wikiSourceLineToPlain(line = '') {
    let t = wikiDecodeEntities(String(line || ''));
    // PukiWikiリンク記法を表示名だけにする。
    // [[名前>URL]] / [[名前>ページ]] -> 名前, [[名前]] -> 名前
    t = t.replace(/\[\[([^\]>]+?)>[^\]]+\]\]/g, '$1');
    t = t.replace(/\[\[([^\]]+?)\]\]/g, '$1');
    // よく使われるインライン装飾を中身だけにする。
    for (let i = 0; i < 4; i++) {
      t = t.replace(/&[a-zA-Z_][\w-]*\([^)]*\)\{([^{}]*)\};/g, '$1');
    }
    t = t.replace(/&[a-zA-Z_][\w-]*\{([^{}]*)\};/g, '$1');
    t = t.replace(/\|?BGCOLOR\([^)]*\)\s*:/gi, '');
    t = t.replace(/'{2,3}/g, '');
    t = t.replace(/^\s*[-+*]+/, '');
    t = t.replace(/^\s*\|+|\|+\s*$/g, '');
    return t.replace(/[ \t\u00a0]+/g, ' ').trim();
  }

  function wikiExtractPeopleFields(plainLine = '') {
    const line = String(plainLine || '').trim();
    if (!line) return [];
    const allLabels = [
      'コラボ相手','共演者','共演','チームメンバー','チームメイト','にじさんじ所属の対戦相手','対戦相手',
      '他参加者','参加者','他出演者','出演者','ゲスト出演','ゲスト','凸者',
      // 下記は人数に含めたくない場合があるので区切り位置としても利用する
      'インタビュー相手','インタビュー','本配信','リポーター','解説','実況'
    ];
    const collabLabels = new Set([
      'コラボ相手','共演者','共演','チームメンバー','チームメイト','にじさんじ所属の対戦相手','対戦相手',
      '他参加者','参加者','他出演者','出演者','ゲスト出演','ゲスト','凸者'
    ]);
    const escaped = allLabels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const re = new RegExp(`(${escaped})[：:]`, 'g');
    const hits = [];
    let m;
    while ((m = re.exec(line))) hits.push({ label: m[1], start: m.index, end: re.lastIndex });
    const out = [];
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (!collabLabels.has(h.label)) continue;
      const end = i + 1 < hits.length ? hits[i + 1].start : line.length;
      let value = line.slice(h.end, end).trim();
      value = value.replace(/^[・･\s]+|[|｜\s]+$/g, '');
      // 「～に出場。コラボ相手：」などの後続説明を誤って人名に含めない。
      value = value.replace(/\s+(?:案件配信|提供|に出場|MC(?:を)?担当|司会|本配信視点|視点はなし).*$/i, '').trim();
      if (value) out.push({ label: h.label.replace(/^にじさんじ所属の/, ''), value });
    }
    return out;
  }

  function wikiParseSourceText(sourceText = '', sourceUrl = '') {
    const entries = {};
    let currentId = '';
    const lines = String(sourceText || '').replace(/\r/g, '').split('\n');

    const ensure = (id, title = '', wikiDate = '') => {
      if (!id) return null;
      if (!entries[id]) {
        entries[id] = {
          videoId: id,
          wikiTitle: title || '',
          wikiDate: wikiDate || '',
          collaborators: [],
          collaboratorLabels: [],
          collaboratorJoinTimes: {},
          notes: [],
          hasCollabNote: false,
          sourceUrl,
          parsedFromSource: true,
        };
      } else {
        if (title && !entries[id].wikiTitle) entries[id].wikiTitle = title;
        if (wikiDate && !entries[id].wikiDate) entries[id].wikiDate = wikiDate;
      }
      return entries[id];
    };

    for (const rawLine of lines) {
      const id = parseVideoIdFromUrl(rawLine);
      if (id) {
        currentId = id;
        const plainRaw = wikiSourceLineToPlain(rawLine);
        const dm = plainRaw.match(/(?:^|[^0-9])(\d{1,2})\/(\d{1,2})(?:[^0-9]|$)/);
        const wikiDate = dm ? `${String(Number(dm[1])).padStart(2,'0')}/${String(Number(dm[2])).padStart(2,'0')}` : '';
        const plainTitle = plainRaw
          .replace(/https?:\/\/[^\s\]]+/g, '')
          .replace(/^\d{1,2}\/\d{1,2}\s+/, '')
          .trim();
        ensure(id, plainTitle, wikiDate);
      }
      if (!currentId) continue;
      const info = ensure(currentId);
      const plain = wikiSourceLineToPlain(rawLine);
      if (!plain) continue;

      for (const {name, at} of wikiExtractJoinPeople(plain)) {
        info.hasCollabNote = true;
        info.collaborators.push(name);
        info.collaboratorJoinTimes[name] ||= at;
      }
      const fields = wikiExtractPeopleFields(plain);
      for (const { label, value } of fields) {
        const people = wikiParsePeople(value);
        if (people.length) {
          info.hasCollabNote = true;
          info.collaboratorLabels.push(`${label}：${value}`);
          info.collaborators.push(...people);
        }
      }

      if (/(?:案件配信|提供|大会.{0,20}出場|に出場|MC(?:を)?担当|司会|本配信視点|視点はなし|同時視聴|主催|3D.{0,12}出演)/i.test(plain)) {
        info.notes.push(plain);
      }
    }

    for (const info of Object.values(entries)) {
      const seen = new Set();
      info.collaborators = info.collaborators.filter(name => {
        const key = normalizeResearchText(name).replace(/\s/g, '');
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
      });
      info.collaboratorLabels = [...new Set(info.collaboratorLabels)];
      info.notes = [...new Set(info.notes)].slice(0, 8);
      info.sourceUrl = sourceUrl;
    }
    return entries;
  }

  function wikiMergeEntries(base = {}, extra = {}) {
    const out = { ...base };
    for (const [id, e] of Object.entries(extra || {})) {
      const cur = out[id] || {
        videoId: id, wikiTitle: '', wikiDate: '', wikiYear: null, collaborators: [], collaboratorLabels: [], collaboratorJoinTimes: {}, notes: [], hasCollabNote: false, sourceUrl: e?.sourceUrl || ''
      };
      cur.wikiTitle ||= e?.wikiTitle || '';
      cur.wikiDate ||= e?.wikiDate || '';
      cur.wikiYear ||= e?.wikiYear || null;
      cur.collaborators = [...new Set([...(cur.collaborators || []), ...(e?.collaborators || [])])];
      cur.collaboratorLabels = [...new Set([...(cur.collaboratorLabels || []), ...(e?.collaboratorLabels || [])])];
      cur.collaboratorJoinTimes = {...(cur.collaboratorJoinTimes || {}), ...(e?.collaboratorJoinTimes || {})};
      cur.notes = [...new Set([...(cur.notes || []), ...(e?.notes || [])])].slice(0, 8);
      cur.hasCollabNote = !!(cur.hasCollabNote || e?.hasCollabNote || cur.collaborators.length);
      cur.sourceUrl = e?.sourceUrl || cur.sourceUrl || '';
      cur.parsedFromSource = !!(cur.parsedFromSource || e?.parsedFromSource);
      out[id] = cur;
    }
    return out;
  }

  async function wikiParseUrlWithSource(pageUrl, renderedHtml = '', requireSource = false) {
    let entries = wikiParsePage(renderedHtml, pageUrl);

    const embeddedSource = wikiExtractSourceText(renderedHtml);
    if (embeddedSource) {
      entries = wikiMergeEntries(entries, wikiParseSourceText(embeddedSource, pageUrl));
    }

    // 年別HTMLから動画IDを十分に抽出できた場合は別のWikiソースURLを叩かない。
    // 2025年はHTML 256件に対しソース表示15件だった。照合そのものに追加通信は不要。
    if (!requireSource && Object.keys(entries).length >= 20 && Object.values(entries).some(info => (info.collaborators || []).length)) return entries;
    const sourceCmds = wikiSourceCommandUrls(pageUrl);
    for (const sourceCmd of sourceCmds) {
      try {
        const sourceHtml = await wikiRequest(sourceCmd);
        const sourceText = wikiExtractSourceText(sourceHtml);
        if (!sourceText) continue;
        const sourceEntries = wikiParseSourceText(sourceText, pageUrl);
        if (!Object.keys(sourceEntries).length) {
          // 通報欄等の別ブロックを拾った場合は次のsource URLも試す。
          continue;
        }
        entries = wikiMergeEntries(entries, sourceEntries);
        break;
      } catch (err) {
        console.debug('[NPF][Wiki source]', sourceCmd, err?.message || err);
      }
    }
    return entries;
  }

  function wikiSanitizeChannelName(name = '') {
    let s = String(name || '').trim();
    s = s.replace(/【[^】]*(?:にじさんじ|nijisanji)[^】]*】/gi, '').trim();
    if (s.includes('/')) s = s.split('/')[0].trim();
    if (s.includes('／')) s = s.split('／')[0].trim();
    s = s.replace(/\s+/g, '');
    return s;
  }

  function wikiChannelNameForEntry(entry, meta = null) {
    // 動画タイトルの【出演者A・出演者B / にじさんじ】は投稿者名ではない。
    // v1.0.5 はタイトルを最優先して存在しない合成Wikiページへアクセスしていた。
    // チャンネル自身の名前だけを候補にする。投稿者不明なら誤アクセスせず保留する。
    const pool = [meta?.channel?.name, entry?.domChannel, entry?.channel, meta?.channel?.english_name];
    for (const candidate of pool) {
      const name = wikiSanitizeChannelName(candidate);
      if (!name || !/[ぁ-んァ-ヶ一-龠々ー]/.test(name)) continue;
      // チャンネル名にゲーム名・出演者列が混入した場合はページ名にしない。
      if (/[|｜!！]/.test(name)) continue;
      const known = wikiKnownChannelName(name);
      if (known) return known;
      return name;
    }
    return '';
  }

  function wikiKnownChannelName(name = '') {
    // 既存DB内で確認できている本人名を優先。小柳ロウ・星導ショウなどの
    // タイトル由来の連結名を小柳ロウへ戻す（有効な中点入りの名前はそのまま残す）。
    const clean = wikiSanitizeChannelName(name);
    if (!clean) return '';
    const known = Object.entries(state.wikiCache || {})
      .filter(([, ds]) => ds?.fetchOk && Object.keys(ds.entries || {}).length)
      .map(([key, ds]) => wikiSanitizeChannelName(ds?.channel || key.split('::')[0]))
      .filter(Boolean);
    if (known.includes(clean)) return clean;
    const prefix = [...new Set(known)].filter(x => clean.startsWith(x + '・')).sort((a, b) => b.length - a.length)[0];
    return prefix || '';
  }

  function wikiFindCachedVideo(entry) {
    // 成功した本人×年のキャッシュを横断して動画IDだけで照合する。
    // IDが保存済みならチャンネル名を推測したりWikiへ通信したりしない。
    if (!entry?.id) return null;
    const year = wikiEntryYear(entry, entry.meta);
    let fallback = null;
    for (const dataset of Object.values(state.wikiCache || {})) {
      if (!dataset || dataset.fetchOk === false) continue;
      const info = dataset.entries?.[entry.id];
      if (!info) continue;
      const row = { info, dataset };
      if (Number(dataset.year) === Number(year)) return row;
      fallback ||= row;
    }
    return fallback;
  }

  function wikiLikelyNijisanji(entry, meta = null) {
    const hay = `${entry?.title || ''} ${entry?.domChannel || ''} ${entry?.channel || ''} ${meta?.channel?.org || ''} ${meta?.org || ''}`;
    return /にじさんじ|nijisanji/i.test(hay) || String(meta?.channel?.org || '').toLowerCase() === 'nijisanji';
  }

  function wikiEntryYear(entry, meta = null) {
    const d = meta ? startOf(meta) : null;
    if (d && !Number.isNaN(d.getTime())) return d.getFullYear();
    const m = String(entry?.date || '').match(/(20\d{2})/);
    return m ? Number(m[1]) : new Date().getFullYear();
  }

  function wikiCacheKey(channel, year) {
    return `${wikiSanitizeChannelName(channel)}::${year}`;
  }

  function wikiPageUrl(channel, suffixParts = []) {
    return `${WIKI_BASE}/${[channel, '動画一覧', ...suffixParts].map(x => encodeURIComponent(String(x))).join('/')}`;
  }

  // Wikiへの通信は年別データ未保存のときだけ。429時は自動再試行を止める。
  let wikiRequestChain = Promise.resolve();
  let wikiNextRequestAt = 0;
  let wikiCooldownUntil = 0;
  let wikiRequestsPaused = false;
  const WIKI_REQUEST_INTERVAL_MS = 2000;

  function wikiCooldownRemainingMs() {
    return Math.max(0, wikiCooldownUntil - Date.now());
  }

  function wikiRetryAfterMs(headers = '') {
    const match = String(headers).match(/^retry-after:\s*(.+)$/im);
    if (!match) return 0;
    const sec = Number(match[1].trim());
    if (Number.isFinite(sec) && sec >= 0) return sec * 1000;
    const when = Date.parse(match[1].trim());
    return Number.isFinite(when) ? Math.max(0, when - Date.now()) : 0;
  }

  function wikiPausedError() {
    const left = wikiCooldownRemainingMs();
    const err = new Error(left
      ? `Wiki HTTP 429（あと約${Math.ceil(left / 1000)}秒。自動通信停止中）`
      : 'Wiki HTTP 429（自動通信停止中。必要なら失敗分だけ手動再試行）');
    err.status = 429;
    err.retryAfterMs = left;
    return err;
  }

  async function wikiRequest(url) {
    // 同じ画面で待機期限後に勝手に再開しない。クリック時のみ解除する。
    if (wikiRequestsPaused) throw wikiPausedError();
    const job = wikiRequestChain.catch(() => {}).then(async () => {
      if (wikiRequestsPaused) throw wikiPausedError();
      const delay = Math.max(0, wikiNextRequestAt - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (wikiRequestsPaused) throw wikiPausedError();
      wikiNextRequestAt = Date.now() + WIKI_REQUEST_INTERVAL_MS;
      const res = await gmRequest({ method: 'GET', url, headers: { 'Accept': 'text/html,application/xhtml+xml' } });
      if (res.status === 429) {
        // 以前は60→120→300秒の自動再試行を3回繰り返していた。
        // 1回の429で止め、最低120秒待つ。Retry-Afterの指定が長ければ尊重する。
        wikiRequestsPaused = true;
        const waitMs = Math.max(120000, wikiRetryAfterMs(res.responseHeaders));
        wikiCooldownUntil = Date.now() + waitMs;
        updateResearchStatus();
        throw wikiPausedError();
      }
      if (res.status < 200 || res.status >= 400) {
        const err = new Error(`Wiki HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return String(res.responseText || '');
    });
    wikiRequestChain = job.catch(() => {});
    return job;
  }

  function trimWikiCache() {
    const obj = state.wikiCache && typeof state.wikiCache === 'object' && !Array.isArray(state.wikiCache) ? state.wikiCache : {};
    const rows = Object.entries(obj).sort((a, b) => Number(b[1]?.fetchedAt || 0) - Number(a[1]?.fetchedAt || 0));
    state.wikiCache = Object.fromEntries(rows.slice(0, 50));
  }

  async function saveWikiCache() {
    trimWikiCache();
    await gmSet(KEY_WIKI_CACHE, state.wikiCache);
    if (nrhDbEnabled()) void nrhDbReplaceWikiCache(state.wikiCache).catch(err => console.debug('[NRH][DB wiki sync]', err?.message || err));
  }

  function wikiDiscoverYearUrls(html = '', mainUrl = '', year = new Date().getFullYear()) {
    const out = [];
    const seen = new Set();
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
      const href = wikiDecodeEntities(m[1]);
      const text = wikiHtmlToText(m[2]);
      let decodedHref = href;
      try { decodedHref = decodeURIComponent(href); } catch {}
      const hay = `${text} ${decodedHref}`;
      if (!hay.includes(String(year))) continue;
      if (!/(?:動画一覧|ライブ一覧|ライブ配信|配信アーカイブ|個人配信)/.test(hay)) continue;
      try {
        const url = new URL(href, mainUrl).href;
        if (!/^https:\/\/wikiwiki\.jp\/nijisanji\//i.test(url) || seen.has(url)) continue;
        seen.add(url); out.push(url);
      } catch {}
    }
    return out;
  }

  async function fetchWikiDataset(channel, year) {
    const clean = wikiSanitizeChannelName(channel);
    const mainUrl = wikiPageUrl(clean, []);
    let merged = {};
    let mainHtml = '';
    let sourceUrl = mainUrl;
    let mainFetchOk = false;
    let mainEntryCount = 0;
    let yearPageSuccess = 0;
    let yearPageEntryCount = 0;
    const errors = [];

    // 診断で小柳2025の正規 /動画一覧/2025 がHTTP 200、256動画IDと判明。
    // まず正規年別ページだけを読み、成功したら存在しない候補URLを総当たりしない。
    const urls = [
      wikiPageUrl(clean, [String(year)]),
      wikiPageUrl(clean, [`ライブ配信${year}`]),
      wikiPageUrl(clean, ['ライブ配信', String(year)]),
    ];
    for (const url of urls) {
      try {
        const html = await wikiRequest(url);
        const entries = await wikiParseUrlWithSource(url, html, Number(year) === new Date().getFullYear());
        const count = Object.keys(entries).length;
        if (!count) { errors.push(`${url}: HTML解析0動画ID`); continue; }
        yearPageSuccess++;
        yearPageEntryCount = Math.max(yearPageEntryCount, count);
        for (const info of Object.values(entries)) if (!info.wikiYear) info.wikiYear = year;
        merged = wikiMergeEntries(merged, entries);
        sourceUrl = url;
        break;
      } catch (err) {
        if (err?.status === 429) throw err; // 429後に別URLを続けて叩かない
        errors.push(`${url}: ${err?.message || err}`);
        console.debug('[NRH][Wiki year]', url, err?.message || err);
      }
    }

    // 当年は年別ページがまだ更新されていない配信がメイン一覧にある場合もある。
    // 過去年は正規ページ成功後にメイン一覧を読み直さない（不要なアクセスを減らす）。
    if (!yearPageSuccess || Number(year) === new Date().getFullYear()) {
      try {
        mainHtml = await wikiRequest(mainUrl);
        mainFetchOk = true;
        const mainEntries = await wikiParseUrlWithSource(mainUrl, mainHtml);
        mainEntryCount = Object.keys(mainEntries).length;
        merged = wikiMergeEntries(merged, mainEntries);
      } catch (err) {
        if (err?.status === 429 && !yearPageSuccess) throw err;
        errors.push(`main: ${err?.message || err}`);
      }
    }

    // 正規URLが存在しないライバーではメイン一覧の年別リンクを最大2件試す。
    if (!yearPageSuccess && mainHtml) {
      const discovered = wikiDiscoverYearUrls(mainHtml, mainUrl, year);
      const seen = new Set([mainUrl, ...urls]);
      for (const url of discovered.filter(x => !seen.has(x)).slice(0, 2)) {
        try {
          const entries = await wikiParseUrlWithSource(url, await wikiRequest(url), Number(year) === new Date().getFullYear());
          const count = Object.keys(entries).length;
          if (!count) continue;
          yearPageSuccess++;
          yearPageEntryCount = Math.max(yearPageEntryCount, count);
          for (const info of Object.values(entries)) if (!info.wikiYear) info.wikiYear = year;
          merged = wikiMergeEntries(merged, entries);
          sourceUrl = url;
          break;
        } catch (err) {
          if (err?.status === 429) throw err;
          errors.push(`${url}: ${err?.message || err}`);
        }
      }
    }

    const fetchOk = yearPageSuccess > 0 || (Number(year) === new Date().getFullYear() && mainFetchOk && mainEntryCount > 0);
    return { entries: merged, sourceUrl, fetchedAt: Date.now(), channel: clean, year,
      fetchOk, mainFetchOk, mainEntryCount, yearPageSuccess, yearPageEntryCount, errors: errors.slice(0, 6) };
  }

  function getCachedWikiDataset(channel, year, force = false) {
    if (force) return null;
    const key = wikiCacheKey(channel, year);
    const cached = state.wikiCache?.[key];
    if (!cached) return null;
    // 旧形式でも動画IDがあれば成功済みの年別DBとして使える。
    if (typeof cached.fetchOk !== 'boolean' && Object.keys(cached.entries || {}).length) {
      return { ...cached, fetchOk: true };
    }
    // 失敗した年も「取得失敗」として再利用し、起動ごとに再試行しない。
    // 成功済みの年には12時間経過だけを理由にアクセスしない。
    return cached;
  }

  function wikiUnavailableDataset(channel, year, error = '') {
    return {
      entries: {}, channel, year, fetchedAt: Date.now(), fetchOk: false,
      sourceUrl: '', errors: [error || 'Wikiアクセスが停止中です'],
    };
  }

  function pumpWikiQueue() {
    if (wikiRequestsPaused) {
      // 429後に待機→再アクセスを自動で繰り返さない。未処理の年もまとめて停止。
      while (research.wikiQueue.length) {
        const job = research.wikiQueue.shift();
        research.wikiQueued.delete(job.key);
        research.wikiPending.delete(job.key);
        job.resolve(wikiUnavailableDataset(job.channel, job.year, wikiPausedError().message));
      }
      updateResearchStatus();
      return;
    }
    if (research.wikiWorkers >= 1 || !research.wikiQueue.length) return;
    const job = research.wikiQueue.shift();
    research.wikiQueued.delete(job.key);
    research.wikiWorkers++;
    fetchWikiDataset(job.channel, job.year)
      .then(async data => {
        // 成功済みを失敗データで上書きしない。失敗セットは保存して連続アクセスを防ぐ。
        if (data.fetchOk || !state.wikiCache[job.key]?.fetchOk) {
          state.wikiCache[job.key] = data;
          await saveWikiCache();
        }
        job.resolve(data);
      })
      .catch(async err => {
        const data = wikiUnavailableDataset(job.channel, job.year, err?.message || String(err));
        if (!state.wikiCache[job.key]?.fetchOk) {
          state.wikiCache[job.key] = data;
          try { await saveWikiCache(); } catch (e) { console.debug('[NRH][Wiki cache]', e); }
        }
        job.resolve(data);
      })
      .finally(() => {
        research.wikiPending.delete(job.key);
        research.wikiWorkers--;
        pumpWikiQueue();
        updateResearchStatus();
      });
  }

  function requestWikiDataset(channel, year, force = false, autoResearch = false) {
    const key = wikiCacheKey(channel, year);
    const cached = getCachedWikiDataset(channel, year, force);
    if (cached) return Promise.resolve(cached);
    if (research.wikiPending.has(key)) return research.wikiPending.get(key);
    if (wikiRequestsPaused) return Promise.resolve(wikiUnavailableDataset(channel, year, wikiPausedError().message));
    const p = new Promise((resolve, reject) => {
      research.wikiQueue.push({ key, channel, year, resolve, reject, autoResearch });
      research.wikiQueued.add(key);
      // pendingを登録した後でキューを動かす。年ごとのリクエストは1件に集約。
    });
    research.wikiPending.set(key, p);
    pumpWikiQueue();
    return p;
  }

  function wikiApplyToEntry(entry, info, dataset = null) {
    entry.wikiChecked = true;
    entry.wikiError = '';
    entry.wikiSkipReason = '';
    // 新しい年別ページが一時的に欠けても、DBの既存コラボ情報を消さない。
    // A successful refresh adds new participants without discarding saved ones.
    entry.wikiInfo = info && entry.wikiInfo
      ? wikiMergeEntries({[entry.id]: entry.wikiInfo}, {[entry.id]: info})[entry.id]
      : (info || entry.wikiInfo || null);
    entry.wikiSourceUrl = info?.sourceUrl || entry.wikiInfo?.sourceUrl || dataset?.sourceUrl || '';
    if (entry?.id) void nrhDbSaveWikiInfo(entry.id, entry.wikiInfo, entry.wikiSourceUrl).catch(() => {});
  }

  function queueResearchWiki(entry, force = false, preferCached = true) {
    // 「失敗分だけ再試行」「全件再照合」は明示操作なのでforce=trueで実行可能。
    if ((!research.collectionActive && !force) || !entry?.id || !entry?.meta || entry.wikiLoading) return;
    entry.wikiError = '';
    entry.wikiSkipReason = '';
    if (entry.wikiChecked && !force) return;
    // 他の正しいチャンネル/年で取得済みの動画も、ローカルID一致で先に回収する。
    // 全件手動更新だけはpreferCached=falseにしてネット上の最新版を要求可能にする。
    const saved = preferCached ? wikiFindCachedVideo(entry) : null;
    if (saved) {
      wikiApplyToEntry(entry, saved.info, saved.dataset);
      if (entry.el?.isConnected) renderResearchEntry(entry, true);
      updateResearchStatus();
      return;
    }
    if (!wikiLikelyNijisanji(entry, entry.meta)) {
      entry.wikiChecked = false;
      entry.wikiSkipReason = 'にじさんじ判定外';
      updateResearchStatus();
      return;
    }
    const channel = wikiChannelNameForEntry(entry, entry.meta);
    const year = wikiEntryYear(entry, entry.meta);
    if (!channel || !year) {
      entry.wikiChecked = false;
      entry.wikiSkipReason = '投稿者の正式名/年を特定できず（誤ったWikiへの通信はしません）';
      updateResearchStatus();
      return;
    }
    entry.wikiLoading = true;
    entry.wikiChannel = channel;
    entry.wikiYear = year;
    requestWikiDataset(channel, year, force, !force)
      .then(dataset => {
        // 停止時に未着手キューを破棄しても、既存のDB/失敗状態は書き換えない。
        if (dataset?.errors?.includes('手動停止')) return;
        if (!dataset?.fetchOk) {
          entry.wikiChecked = !!entry.wikiInfo;
          // 既存DBから復元したコラボ情報は、今回のWiki失敗で削除しない。
          entry.wikiError = `Wiki年別ページ取得失敗 (${channel}/${year})`;
          entry.wikiSourceUrl = dataset?.sourceUrl || '';
          return;
        }
        wikiApplyToEntry(entry, dataset?.entries?.[entry.id] || null, dataset);
        if (entry.el?.isConnected) renderResearchEntry(entry, true);
      })
      .catch(err => {
        entry.wikiChecked = !!entry.wikiInfo;
        entry.wikiError = String(err?.message || err || 'Wiki取得失敗');
        console.debug('[NPF][Wiki enrich]', channel, year, err?.message || err);
      })
      .finally(() => {
        entry.wikiLoading = false;
        updateResearchStatus();
      });
  }

  function wikiResumeManual() {
    const left = wikiCooldownRemainingMs();
    if (left) {
      toast(`Wikiは429制限中です。あと約${Math.ceil(left / 60_000)}分待ってから再試行してください`);
      return false;
    }
    wikiRequestsPaused = false;
    wikiCooldownUntil = 0;
    return true;
  }

  function retryFailedResearchWiki() {
    const failed = currentResearchEntries().filter(e => e.meta && e.wikiError && !e.wikiLoading);
    if (!failed.length) return toast('Wiki取得エラーの動画はありません');
    if (!wikiResumeManual()) return;
    const keys = new Set(failed.map(e => wikiCacheKey(wikiChannelNameForEntry(e, e.meta), wikiEntryYear(e, e.meta))));
    // 成功済みのWikiセットは絶対に削除しない。失敗した年のみ再取得。
    for (const key of keys) if (state.wikiCache?.[key]?.fetchOk === false) delete state.wikiCache[key];
    void saveWikiCache();
    for (const e of failed) queueResearchWiki(e, true);
    toast(`Wiki失敗 ${keys.size}年別セットのみ再取得します（対象動画${failed.length}本）`);
  }

  async function refreshResearchWiki() {
    const entries = currentResearchEntries();
    if (!entries.length) return toast('再取得するアーカイブがありません');
    if (!wikiResumeManual()) return;
    const keys = new Set();
    for (const e of entries) {
      const channel = wikiChannelNameForEntry(e, e.meta);
      const year = wikiEntryYear(e, e.meta);
      if (channel && year) keys.add(wikiCacheKey(channel, year));
      // 再取得が成功するまで表示中の情報・DBは保持する。
      e.wikiError = '';
      e.wikiSkipReason = '';
    }
    for (const e of entries) queueResearchWiki(e, true, false);
    toast(`Wiki ${keys.size}年別セットを手動更新します。既存のDBは残します`);
  }

  function researchGameFromText(title = '', topic = '') {
    const raw = `${topic || ''} ${title || ''}`;
    const t = normalizeResearchText(raw);
    const games = [
      ['VALORANT', /\bvalorant\b|\bvalo\b|ヴァロ(?:ラント)?/i],
      ['APEX Legends', /\bapex\b|エペ|エーペックス/i],
      ['League of Legends', /league of legends|\blol\b|リーグ・オブ・レジェンド/i],
      ['Overwatch 2', /overwatch|\bow2\b|オーバーウォッチ/i],
      ['Counter-Strike 2', /counter[ -]?strike|\bcs2\b/i],
      ['Rainbow Six Siege', /rainbow[\s_-]*six|\br6s\b|シージ/i],
      ['Escape from Tarkov', /tarkov|\beft\b|タルコフ/i],
      ['PUBG', /\bpubg\b/i],
      ['Fortnite', /fortnite|フォートナイト/i],
      ['Delta Force', /delta force|デルタフォース/i],
      ['Marvel Rivals', /marvel rivals|マーベルライバルズ/i],
      ['Minecraft', /minecraft|マイクラ|マインクラフト/i],
      ['Grand Theft Auto V', /grand theft auto|\bgta\b/i],
      ['Street Fighter 6', /street fighter\s*6|\bsf6\b|スト6|ストリートファイター6/i],
      ['Splatoon 3', /splatoon|スプラ(?:トゥーン)?/i],
      ['Dead by Daylight', /dead by daylight|\bdbd\b/i],
      ['Among Us', /among us|アモアス/i],
      ['Stardew Valley', /stardew valley|スターデューバレー/i],
      ['ARK', /\bark\b/i],
      ['Rust', /\brust\b/i],
      ['Pokémon', /pokemon|pokémon|ポケモン/i],
      ['FGO', /fate\/grand order|\bfgo\b/i],
    ];
    for (const [name, re] of games) if (re.test(t)) return name;
    const cleanedTopic = String(topic || '').trim();
    if (cleanedTopic && !/^talking|music|other$/i.test(cleanedTopic)) return cleanedTopic;
    return '';
  }

  function isFpsGame(game = '', title = '') {
    return /valorant|apex|overwatch|counter-strike|rainbow[\s_-]*six|\br6s\b|シージ|tarkov|pubg|fortnite|delta force|marvel rivals|battlefield|call of duty/i.test(`${game} ${title}`);
  }

  // ゲームタイトルではなく、ストリーマー向け共有サーバー企画の分類。
  // GTA/RUST/ARKをプレイしているだけではスト鯖と判定しない。
  function isStreamServerSession(game = '', title = '') {
    const t = normalizeResearchText(title).normalize('NFKC');
    if (/(?:スト(?:鯖|サバ)|ストリーマー(?:専用)?(?:サーバー|鯖)|ストグラ|\bnew\s*town\b|\bmad\s*town\b)/i.test(t)) return true;
    return /\bvcr\b/i.test(t) && /(?:grand theft auto|\bgta\b|\brust\b|\bark\b|minecraft|マイクラ|マインクラフト)/i.test(`${game} ${t}`);
  }

  // ゲームタイトルとは独立した大会関連分類。スクリムや大会の練習・振り返りも含める。
  function isTournamentRelated(title = '') {
    const t = normalizeResearchText(title).normalize('NFKC');
    if (/(?:大会|選手権|トーナメント|スクリム|scrim|対抗戦|予選|準決勝|決勝|本戦|決定戦)/i.test(t)) return true;
    // 大会名をタイトルに書き、配信自体は「顔合わせ」「練習」「振り返り」のケース。
    return /(?:v最(?:協|強)?|v\s*saikyo|にじ(?:さんじ)?甲(?:子園)?|にじさんじ(?:マリカ|麻雀|スプラ|歌謡)杯|(?:cr|crazy\s*raccoon)\s*(?:cup|カップ)|(?:えぺ|エペ|apex)まつり|\bvcc\b|\bv\s*cc\b)/i.test(t);
  }

  function researchMentionList(meta) {
    const arr = Array.isArray(meta?.mentions) ? meta.mentions : [];
    const seen = new Set();
    const out = [];
    for (const m of arr) {
      const id = m?.id || m?.channel?.id || '';
      const name = m?.name || m?.english_name || m?.channel?.name || m?.channel?.english_name || '';
      const key = id || normalizeResearchText(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ id, name: String(name || '').trim() });
    }
    return out;
  }

  function researchCategories(title = '', meta = null, game = '') {
    const t = normalizeResearchText(title);
    const mentions = researchMentionList(meta);
    const titleCollab = /(コラボ|collab|\bw\/?\s|with\s+|\bvs\.?\b|対戦会|チーム|フルパ)/i.test(title);
    const collab = mentions.length > 0 || titleCollab;
    const song = /(歌枠|歌ってみた|歌唱|karaoke|singing|\bcover\b|music live|3dライブ|3d live)/i.test(title);
    const chat = /(雑談|朝活|おはよう|振り返り|振返り|マシュマロ|近況|お話|talking|zatsudan)/i.test(title);
    const gameish = !!game || /(実況|初見プレイ|ゲーム|gameplay)/i.test(title);
    const tags = [];
    if (isFpsGame(game, title)) tags.push('FPS');
    if (isStreamServerSession(game, title)) tags.push('スト鯖');
    if (isTournamentRelated(title)) tags.push('大会');
    if (gameish && !collab) tags.push('ソロゲー');
    if (collab) tags.push('コラボ');
    if (chat) tags.push('雑談');
    if (song) tags.push('歌');
    return tags;
  }

  function researchDurationSeconds(meta) {
    // 配信時間はHolodexのメタ情報だけを使用する。
    // YouTubeサムネイル上の時間だけ拾えても、日時・参加者など他の調査情報と揃わないためDOMフォールバックはしない。
    if (!meta) return null;
    const ss = startOf(meta), se = endOf(meta);
    if (ss && se && se > ss) return Math.round((se - ss) / 1000);
    const d = Number(meta.duration);
    return Number.isFinite(d) && d > 0 ? d : null;
  }

  function researchDate(meta) {
    // 日時もHolodexから取得できた場合だけ表示する。
    const d = meta ? startOf(meta) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${day} ${hh}:${mm}`;
  }

  function researchDurationLabel(sec) {
    if (!Number.isFinite(Number(sec)) || Number(sec) <= 0) return '';
    sec = Math.round(Number(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h ? `${h}時間${String(m).padStart(2, '0')}分` : `${m}分`;
  }

  function isTournamentTitle(title = '') {
    return !!detectedEvents(title).length || /(大会|cup|カップ|杯|league|リーグ|tournament|v最|にじ甲|kzh\s*cup|くずはカップ|crカップ|cr cup|ltk|vcr|madtown)/i.test(title);
  }

  function researchCardVideo(card) {
    // Include yt-mobile / modern lockup links. Restrict to real watch URLs, not shorts.
    const links = [...card.querySelectorAll('a[href*="/watch?v="], a[href*="/watch?"]')];
    for (const a of links) {
      const id = parseVideoIdFromUrl(a.href);
      if (id) return { id, link: a };
    }
    return null;
  }

  function researchTitleElement(card) {
    return card.querySelector('a#video-title, #video-title-link, h3 a[href*="/watch?v="], a[href*="/watch?v="][title], h3, .media-item-headline, .yt-lockup-metadata-view-model__title, a[href*="/watch?v="][aria-label]');
  }

  function researchMount(card, titleEl) {
    // Rich-item is the whole tile: append badges after its native video block.
    if (!isMobileYoutubeUi() && window.matchMedia?.('(min-width:701px)').matches) {
      const item = card.matches?.('ytd-rich-item-renderer')
        ? card : card.closest?.('ytd-rich-item-renderer');
      if (item && (!titleEl || item.contains(titleEl))) {
        item.classList.add('npf-r-rich-item');
        return item;
      }
      const grid = card.matches?.('ytd-grid-video-renderer')
        ? card : card.querySelector('ytd-grid-video-renderer');
      if (grid && (!titleEl || grid.contains(titleEl))) return grid;
    }
    const preferred = card.querySelector('#meta, #metadata, #video-meta, .details, .media-item-info, .yt-lockup-metadata-view-model');
    const nearTitle = titleEl?.parentElement?.parentElement;
    // A shallow mobile card may have its title link directly under the card:
    // never append annotations outside the card (would duplicate every scan).
    return preferred || (nearTitle && card.contains(nearTitle) ? nearTitle : null)
      || (titleEl?.parentElement && card.contains(titleEl.parentElement) ? titleEl.parentElement : card);
  }

  const META_MAX_ATTEMPTS = 3;
  const META_MAX_WORKERS = 2;
  const META_MIN_REQUEST_GAP = 350;
  const META_RETRY_DELAYS = [2000, 6000, 15000];
  const META_429_PAUSE_MS = 120_000;

  function metaRetryableError(err) {
    const msg = String(err?.message || err || '');
    // APIキー不正と404は待っても直らない可能性が高いので自動再試行しない。
    return !/(APIキー|401|403|404)/i.test(msg);
  }

  function metaIs429(err) {
    return /(?:\b429\b|too many requests|rate limit)/i.test(String(err?.message || err || ''));
  }

  function holodexCooldownRemainingMs() {
    return Math.max(0, Number(research.holodexCooldownUntil || 0) - Date.now());
  }

  function scheduleHolodexPump(delay = 0) {
    if (research.holodexPumpTimer) clearTimeout(research.holodexPumpTimer);
    research.holodexPumpTimer = setTimeout(() => {
      research.holodexPumpTimer = null;
      pumpResearchQueue();
      updateResearchStatus();
    }, Math.max(20, delay));
  }

  function triggerHolodex429Cooldown() {
    // 429のたびに60→120→300秒へ伸ばして自動再開する旧処理を廃止。
    // 取得済みDBは保持し、1回429が来たら未取得キューの自動通信を止める。
    if (research.holodexPaused) return holodexCooldownRemainingMs();
    research.holodexPaused = true;
    research.holodexCooldownUntil = Date.now() + META_429_PAUSE_MS;
    if (research.holodexCooldownTimer) clearTimeout(research.holodexCooldownTimer);
    research.holodexCooldownTimer = null;
    if (research.holodexPumpTimer) clearTimeout(research.holodexPumpTimer);
    research.holodexPumpTimer = null;
    for (const item of research.queue) {
      if (!item?.id || item.meta) continue;
      research.metaFailures.set(item.id, { message: 'Holodex HTTP 429（自動通信停止）', attempt: META_MAX_ATTEMPTS, at: Date.now() });
      research.metaAttempts.set(item.id, META_MAX_ATTEMPTS);
    }
    research.queue.length = 0;
    research.queuedIds.clear();
    for (const [id, timer] of research.metaRetryTimers) {
      clearTimeout(timer);
      research.metaFailures.set(id, { message: 'Holodex HTTP 429（自動通信停止）', attempt: META_MAX_ATTEMPTS, at: Date.now() });
      research.metaAttempts.set(id, META_MAX_ATTEMPTS);
    }
    research.metaRetryTimers.clear();
    updateResearchStatus();
    return META_429_PAUSE_MS;
  }

  function clearMetaRetry(id) {
    const timer = research.metaRetryTimers.get(id);
    if (timer) clearTimeout(timer);
    research.metaRetryTimers.delete(id);
  }

  function queueResearchMeta(entry, force = false, backgroundRefresh = false) {
    if (!research.collectionActive || !entry?.id || !state.apiKey || research.holodexPaused) return;
    const id = entry.id;
    if (force) {
      clearMetaRetry(id);
      research.metaAttempts.delete(id);
      research.metaFailures.delete(id);
      entry.meta = null;
      research.metaCache.delete(id);
    }
    if ((!backgroundRefresh && (entry.meta || research.metaCache.has(id))) || research.queuedIds.has(id) || research.pendingMeta.has(id)) return;
    if (!force && (research.metaAttempts.get(id) || 0) >= META_MAX_ATTEMPTS && research.metaFailures.has(id)) return;
    research.queuedIds.add(id);
    research.queue.push(entry);
    pumpResearchQueue();
  }

  function pumpResearchQueue() {
    if (!research.collectionActive || research.holodexPaused) return; // 自動再開しない。調査パネルで手動再試行する。
    const cooldownMs = holodexCooldownRemainingMs();
    if (cooldownMs > 0) {
      scheduleHolodexPump(cooldownMs + 120);
      return;
    }

    while (research.workers < META_MAX_WORKERS && research.queue.length) {
      const gap = Math.max(0, META_MIN_REQUEST_GAP - (Date.now() - Number(research.holodexLastRequestAt || 0)));
      if (gap > 0) {
        scheduleHolodexPump(gap + 20);
        return;
      }

      const entry = research.queue.shift();
      const id = entry.id;
      research.queuedIds.delete(id);
      if (!entry.el?.isConnected) continue;
      research.workers++;
      research.holodexLastRequestAt = Date.now();
      const attempt = (research.metaAttempts.get(id) || 0) + 1;
      research.metaAttempts.set(id, attempt);
      let retryDelay = 0;

      const p = apiGet(`/videos/${encodeURIComponent(id)}?lang=ja`)
        .then(meta => {
          if (!meta || typeof meta !== 'object') throw new Error('Holodex APIの動画情報が空です');
          research.metaCache.set(id, meta);
          void nrhDbSaveVideoMeta(id, meta).then(() => updateResearchDbStatus()).catch(() => {});
          research.metaFailures.delete(id);
          research.metaAttempts.delete(id);
          clearMetaRetry(id);
          // 成功済みの動画情報は引き続きIndexedDBを優先利用する。
          for (const e of research.entries) {
            if (e.id === id && e.el?.isConnected) {
              e.meta = meta;
              renderResearchEntry(e);
            }
          }
        })
        .catch(err => {
          const message = String(err?.message || err || 'Holodex取得失敗');
          research.metaFailures.set(id, { message, attempt, at: Date.now() });
          if (metaIs429(err)) {
            triggerHolodex429Cooldown();
            // 429は自動再試行しない。成功済みの動画・他の未取得分も保護する。
            retryDelay = 0;
          } else if (metaRetryableError(err) && attempt < META_MAX_ATTEMPTS && !research.holodexPaused) {
            retryDelay = META_RETRY_DELAYS[Math.min(attempt - 1, META_RETRY_DELAYS.length - 1)];
          }
          console.debug('[NRH][research metadata]', id, `attempt ${attempt}/${META_MAX_ATTEMPTS}`, message);
          for (const e of research.entries) {
            if (e.id === id && e.el?.isConnected) renderResearchEntry(e);
          }
        })
        .finally(() => {
          research.pendingMeta.delete(id);
          research.workers--;
          if (retryDelay > 0 && research.collectionActive) {
            clearMetaRetry(id);
            const timer = setTimeout(() => {
              research.metaRetryTimers.delete(id);
              const target = [...research.entries].find(e => e.id === id && e.el?.isConnected);
              if (target) queueResearchMeta(target, false, !!target.meta || research.metaCache.has(id));
            }, retryDelay);
            research.metaRetryTimers.set(id, timer);
          }
          // pending解除後の状態（再取得待ち / 最終失敗）をカードにも反映する。
          for (const e of research.entries) {
            if (e.id === id && e.el?.isConnected && !e.meta) renderResearchEntry(e);
          }
          pumpResearchQueue();
          updateResearchStatus();
        });
      research.pendingMeta.set(id, p);
    }
  }

  function retryMissingResearchMeta() {
    if (research.holodexPaused) {
      const left = holodexCooldownRemainingMs();
      if (left) {
        toast(`Holodexは429制限中です。あと約${Math.ceil(left / 60_000)}分後に再試行してください`);
        return 0;
      }
      research.holodexPaused = false;
      research.holodexCooldownUntil = 0;
    }
    let count = 0;
    for (const e of currentResearchEntries()) {
      if (e.meta || research.metaCache.has(e.id)) continue;
      queueResearchMeta(e, true);
      count++;
    }
    return count;
  }

  function makeResearchPill(text, cls = '') {
    const el = document.createElement('span');
    el.className = `npf-r-pill${cls ? ' ' + cls : ''}`;
    el.textContent = text;
    return el;
  }

  function openResearchSearch(query) {
    const q = String(query || '').trim();
    if (!q) return;
    openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
  }

  function titleDetectedPeople(title, meta, wikiInfo = null) {
    const t = normalizeResearchText(title).replace(/\s/g, '');
    const pool = [...researchMentionList(meta)];
    for (const name of (wikiInfo?.collaborators || [])) pool.push({ id: '', name });
    for (const f of state.favorites) pool.push({ id: f.id, name: f.name || '' });
    const seen = new Set();
    const out = [];
    for (const p of pool) {
      const name = String(p.name || '').trim();
      if (!name) continue;
      const key = normalizeResearchText(name).replace(/\s/g, '');
      if (key.length < 2 || !t.includes(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }

  async function loadTournamentPovs(entry, holder, button) {
    if (!entry?.meta) {
      toast('大会視点一覧にはHolodexの動画情報が必要です');
      return;
    }
    if (!state.apiKey) {
      toast('Holodex APIキーが未設定です');
      return;
    }
    if (holder.dataset.loaded === '1') {
      holder.hidden = !holder.hidden;
      return;
    }
    const old = button.textContent;
    button.disabled = true;
    button.textContent = '取得中…';
    try {
      const candidates = await fetchCandidates(entry.meta);
      const matches = buildMatches(entry.meta, candidates, null)
        .filter(m => m.related && (m.event || m.directMention || (m.reasons || []).some(r => /共通タグ|参加者情報/.test(r))));
      const byChannel = new Map();
      for (const m of matches) {
        const cid = channelId(m.v) || m.v.id;
        if (!byChannel.has(cid)) byChannel.set(cid, m);
      }
      const list = [...byChannel.values()].slice(0, 24);
      holder.replaceChildren();
      if (!list.length) {
        holder.appendChild(makeResearchPill('対応する別視点は見つかりませんでした'));
      } else {
        for (const m of list) {
          const a = document.createElement('a');
          a.className = 'npf-r-pill';
          a.textContent = `▶ ${channelName(m.v)}`;
          a.href = youtubeUrl(m.v.id, correctedCandidateOffset(entry.meta, m));
          a.target = '_blank';
          a.rel = 'noopener';
          holder.appendChild(a);
        }
      }
      holder.dataset.loaded = '1';
      holder.hidden = false;
    } catch (err) {
      toast(err?.message || '各視点の取得に失敗しました');
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  function renderResearchEntry(entry, fromWiki = false) {
    if (!entry?.el?.isConnected) return;
    const meta = entry.meta || research.metaCache.get(entry.id) || null;
    if (meta) entry.meta = meta;
    entry.title = (researchTitleElement(entry.el)?.getAttribute('title') || researchTitleElement(entry.el)?.textContent || entry.title || '').trim();
    const domChannelNow = (entry.el.querySelector('ytd-channel-name a, #channel-name a, .ytm-badge-and-byline-item-byline, .byline, .yt-lockup-metadata-view-model__byline')?.textContent || entry.domChannel || '').trim();
    if (domChannelNow) entry.domChannel = domChannelNow;
    entry.channel = meta ? channelName(meta) : (entry.domChannel || entry.channel || '').trim();
    entry.game = researchGameFromText(entry.title, meta?.topic_id || '');
    entry.date = researchDate(meta);
    entry.durationSec = researchDurationSeconds(meta);
    entry.mentions = researchMentionList(meta);

    const wiki = entry.wikiInfo || null;
    const wikiPeople = [...(wiki?.collaborators || [])];
    const categoryTitle = [entry.title, meta?.title, wiki?.wikiTitle].filter(Boolean).join(' ');
    const baseCategories = researchCategories(categoryTitle, meta, entry.game);
    entry.categories = [...baseCategories];
    if ((wikiPeople.length || wiki?.hasCollabNote) && !entry.categories.includes('コラボ')) entry.categories.push('コラボ');
    if (entry.categories.includes('コラボ')) entry.categories = entry.categories.filter(x => x !== 'ソロゲー');

    entry.collaborators = wikiPeople.length ? wikiPeople : entry.mentions.map(x => x.name).filter(Boolean);
    if (wikiPeople.length) entry.collabCount = wikiPeople.length + 1;
    else entry.collabCount = entry.mentions.length ? entry.mentions.length + 1 : (entry.categories.includes('コラボ') ? null : 1);
    entry.url = youtubeUrl(entry.id);

    // The desktop badge row is mounted on the OUTER rich-item, which can be
    // outside entry.el (e.g. when entry.el is a nested yt-lockup-view-model).
    // Search the actual mount as well as the inner card and remove leftovers
    // from older renders; repeated scans must never create another row.
    const mount = researchMount(entry.el, researchTitleElement(entry.el));
    if (!mount) return;
    const bars = [...new Set([
      ...mount.querySelectorAll(':scope > .npf-research-meta'),
      ...entry.el.querySelectorAll('.npf-research-meta'),
    ])];
    let bar = bars.find(node => node.parentElement === mount) || bars[0];
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'npf-research-meta';
    }
    for (const duplicate of bars) if (duplicate !== bar) duplicate.remove();
    if (bar.parentElement !== mount) mount.appendChild(bar);
    bar.replaceChildren();

    if (!meta && state.apiKey) {
      const failure = research.metaFailures.get(entry.id);
      const attempt = research.metaAttempts.get(entry.id) || 0;
      const pending = research.pendingMeta.has(entry.id) || research.queuedIds.has(entry.id);
      const retryWaiting = research.metaRetryTimers.has(entry.id);
      const cooldownSec = Math.ceil(holodexCooldownRemainingMs() / 1000);
      let text = '';
      if (research.holodexPaused && !meta) text = cooldownSec > 0
        ? `⏸ Holodex 429停止 約${cooldownSec}秒` : '⏸ Holodex 429停止・手動再試行';
      else if (pending) text = `⏳ Holodex取得中${attempt ? ` ${attempt}/${META_MAX_ATTEMPTS}` : ''}`;
      else if (retryWaiting) text = `↻ Holodex再取得待ち ${Math.min(attempt + 1, META_MAX_ATTEMPTS)}/${META_MAX_ATTEMPTS}`;
      else if (failure) text = `⚠ Holodex取得失敗 ${attempt}/${META_MAX_ATTEMPTS}`;
      if (text) {
        const p = makeResearchPill(text, 'npf-r-meta-status');
        p.title = research.holodexPaused ? 'Holodexの429を検知したため自動取得を停止しました。待機後に「再解析・再取得」を押してください。' : (failure?.message || 'Holodexから動画メタ情報を取得中です');
        bar.appendChild(p);
      }
    }

    if (entry.date) bar.appendChild(makeResearchPill(`📅 ${entry.date}`));
    const dur = researchDurationLabel(entry.durationSec);
    if (dur) bar.appendChild(makeResearchPill(`⏱ ${dur}`));

    if (entry.game) {
      const gameBtn = document.createElement('button');
      gameBtn.type = 'button';
      gameBtn.className = 'npf-r-pill';
      gameBtn.textContent = `🎮 ${entry.game}`;
      gameBtn.title = '同じゲームのにじさんじアーカイブを横断検索';
      gameBtn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        openResearchSearch(`にじさんじ ${entry.game}`);
      });
      bar.appendChild(gameBtn);
    }

    if (entry.collabCount && entry.collabCount > 1) {
      const p = makeResearchPill(`👥 ${entry.collabCount}人${wikiPeople.length ? '（Wiki）' : ''}`);
      p.title = wikiPeople.length ? '非公式Wikiのコラボ相手記載から算出（配信者本人を含む）' : 'Holodexの参加者情報から推定（配信者本人を含む）';
      bar.appendChild(p);
    }

    for (const cat of entry.categories) bar.appendChild(makeResearchPill(cat, `npf-r-cat-${cat}`));

    if (entry.collaborators?.length) {
      for (const person of entry.collaborators) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `npf-r-pill npf-r-collab-person${wikiPeople.length ? ' npf-r-wiki' : ''}`;
        const joinedAt = wiki?.collaboratorJoinTimes?.[person];
        b.textContent = `🤝 ${person}${joinedAt ? ` (${joinedAt}〜)` : ''}`;
        b.dataset.collaborator = person;
        b.title = `${person}：絞り込み → 除外 → 解除`;
        b.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          cycleResearchCollaborator(person, entry);
        });
        bar.appendChild(b);
      }
    }
    if (wiki?.notes?.length) {
      const joined = wiki.notes.join(' / ');
      const short = joined.length > 110 ? `${joined.slice(0, 107)}…` : joined;
      const note = makeResearchPill(`📝 ${short}`, 'npf-r-wiki npf-r-wiki-note');
      note.title = joined;
      bar.appendChild(note);
    }
    if (wiki?.sourceUrl) {
      const a = document.createElement('a');
      a.className = 'npf-r-pill npf-r-wiki';
      a.textContent = 'Wiki ✓';
      a.href = wiki.sourceUrl;
      a.target = '_blank'; a.rel = 'noopener';
      a.title = wikiPeople.length
        ? `にじさんじ非公式Wiki照合済み・コラボ相手 ${wikiPeople.length}名取得${wiki?.parsedFromSource ? '（ソース解析）' : ''}`
        : `にじさんじ非公式Wiki照合済み（コラボ相手未取得）${wiki?.parsedFromSource ? '・ソース解析済み' : ''}`;
      bar.appendChild(a);
    }

    const context = detectedEvents(entry.title)[0] || entry.game || '';
    for (const p of titleDetectedPeople(entry.title, meta, wiki)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'npf-r-pill npf-r-person';
      b.textContent = `🔎 ${p.name}視点`;
      b.title = `${p.name} の同配信・同ゲーム視点を検索`;
      b.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        openResearchSearch(`${p.name}${context ? ' ' + context : ''}`);
      });
      bar.appendChild(b);
    }

    if (isTournamentTitle(entry.title) && meta) {
      const povBtn = document.createElement('button');
      povBtn.type = 'button';
      povBtn.className = 'npf-r-pill';
      povBtn.textContent = '🎯 各視点';
      povBtn.title = '同じ大会・イベントの各視点リンク一覧を生成';
      const holder = document.createElement('div');
      holder.className = 'npf-r-event-links';
      holder.hidden = true;
      povBtn.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        void loadTournamentPovs(entry, holder, povBtn);
      });
      bar.appendChild(povBtn);
      bar.appendChild(holder);
    }

    entry.el.dataset.npfResearchTags = entry.categories.join('|');
    applyResearchFilters();
    updateResearchStatus();
    if (meta && !entry.wikiChecked && !entry.wikiLoading && !fromWiki) queueResearchWiki(entry);
  }

  function bindResearchCard(card) {
    const info = researchCardVideo(card);
    if (!info) return;
    const id = info.id;
    const oldId = card.dataset.npfResearchVideoId || '';
    if (oldId && oldId !== id) {
      card.querySelectorAll('.npf-research-meta').forEach(n => n.remove());
      for (const e of [...research.entries]) if (e.el === card) research.entries.delete(e);
    }
    if (card.dataset.npfResearchVideoId === id) {
      const existing = [...research.entries].find(e => e.el === card && e.id === id);
      if (existing && !card.querySelector('.npf-research-meta')) renderResearchEntry(existing);
      return;
    }
    card.dataset.npfResearchVideoId = id;
    const titleEl = researchTitleElement(card);
    const mobileChannel = card.querySelector('.ytm-badge-and-byline-item-byline, .byline, .yt-lockup-metadata-view-model__byline')?.textContent || '';
    const entry = {
      id,
      el: card,
      title: (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim(),
      channel: (card.querySelector('ytd-channel-name a, #channel-name a')?.textContent || mobileChannel).trim(),
      domChannel: (card.querySelector('ytd-channel-name a, #channel-name a')?.textContent || mobileChannel).trim(),
      meta: research.metaCache.get(id) || null,
      game: '', categories: [], date: '', durationSec: null, collabCount: null, url: youtubeUrl(id), mentions: [],
      collaborators: [], wikiInfo: null, wikiSourceUrl: '', wikiChecked: false, wikiLoading: false, wikiError: '', wikiSkipReason: '',
    };
    research.entries.add(entry);
    renderResearchEntry(entry);
    if (nrhDbEnabled() && !research.dbLookupPending.has(id)) {
      research.dbLookupPending.add(id);
      void nrhHydrateEntryFromDb(entry).then(result => {
        if (!result?.fresh) queueResearchMeta(entry, false, !!result?.found);
      }).finally(() => research.dbLookupPending.delete(id));
    } else {
      queueResearchMeta(entry);
    }
  }

  function scanYoutubeResearchCards() {
    if (!isYoutubeResearchPage()) return;
    const cards = $$('ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytm-video-with-context-renderer, ytm-rich-item-renderer, ytm-compact-video-renderer, ytm-video-renderer, yt-lockup-view-model');
    for (const card of cards) bindResearchCard(card);
    for (const e of [...research.entries]) if (!e.el?.isConnected) research.entries.delete(e);
    applyResearchFilters();
    updateResearchStatus();
  }

  function scheduleResearchScan(delay = 120) {
    clearTimeout(research.scanTimer);
    research.scanTimer = setTimeout(scanYoutubeResearchCards, delay);
  }

  function updateResearchCollectionControls() {
    const button = $('#npf-r-collection-toggle');
    if (!button) return;
    if (isMobileYoutubeUi()) mobileResearchPageHint();
    button.textContent = research.collectionActive ? '⏸ 取得を停止' : '▶ この一覧の取得を開始';
    button.setAttribute('aria-pressed', String(research.collectionActive));
    button.title = research.collectionActive
      ? '未着手のHolodex/Wiki取得を停止します。すでに通信中の1件は終了する場合があります。'
      : 'この一覧の未取得動画をHolodex/Wikiで調査します。スクロールで増えた動画も対象です。';
    const auto = $('#npf-r-auto-channel-toggle');
    if (auto) {
      const key = researchChannelKey();
      auto.style.display = key ? 'block' : 'none';
      auto.textContent = research.autoChannelKeys.has(key)
        ? '☑ このチャンネルの自動取得 ON' : '□ このチャンネルの自動取得 OFF';
    }
    const hint = $('#npf-r-collection-hint');
    if (hint) hint.textContent = research.collectionActive
      ? '取得中：この一覧で追加表示された動画も調査。止めると未着手の取得は実行しません。'
      : '手動モード：ページを開くだけでは外部取得しません。保存済みのDBは表示できます。';
  }

  function stopResearchCollection() {
    research.collectionActive = false;
    // 未着手の通信のみ止める。実行中のリクエストと既存のDBは触らない。
    research.queue.length = 0;
    research.queuedIds.clear();
    if (research.holodexPumpTimer) clearTimeout(research.holodexPumpTimer);
    research.holodexPumpTimer = null;
    for (const timer of research.metaRetryTimers.values()) clearTimeout(timer);
    research.metaRetryTimers.clear();
    const keep = [];
    for (const job of research.wikiQueue) {
      if (!job.autoResearch) { keep.push(job); continue; }
      research.wikiQueued.delete(job.key);
      research.wikiPending.delete(job.key);
      job.resolve(wikiUnavailableDataset(job.channel, job.year, '手動停止'));
    }
    research.wikiQueue = keep;
    updateResearchCollectionControls();
    updateResearchStatus();
  }

  function startResearchCollection() {
    if (!isYoutubeResearchPage()) return;
    research.collectionActive = true;
    updateResearchCollectionControls();
    scanYoutubeResearchCards();
    // 開いている間にDBから読み込んだ動画も、開始後に未取得分だけ調べる。
    for (const entry of currentResearchEntries()) {
      if (entry.meta && !entry.wikiChecked && !entry.wikiLoading) queueResearchWiki(entry);
      if (!state.apiKey || research.dbLookupPending.has(entry.id)) continue;
      if (!nrhDbEnabled()) {
        if (!entry.meta) queueResearchMeta(entry);
        continue;
      }
      void nrhDbGet('videos', entry.id).then(rec => {
        if (!research.collectionActive || !entry.el?.isConnected) return;
        if (!nrhVideoRecordFresh(rec)) queueResearchMeta(entry, false, !!rec?.meta);
      }).catch(err => {
        // Private-browsing / WebKit IDB failures must not block manual research.
        console.debug('[NRH][manual start DB]', entry.id, err?.message || err);
        if (research.collectionActive && entry.el?.isConnected) queueResearchMeta(entry, false, !!entry.meta);
      });
    }
    updateResearchStatus();
  }

  function currentResearchEntries() {
    return [...research.entries].filter(e => e.el?.isConnected && e.id);
  }

  function wikiDiscoverAvailableYears(html = '') {
    const current = new Date().getFullYear();
    const years = new Set();
    const raw = String(html || '');
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(raw))) {
      const href = wikiDecodeEntities(m[1]);
      const text = wikiHtmlToText(m[2]);
      let decoded = href;
      try { decoded = decodeURIComponent(href); } catch {}
      const hay = `${text} ${decoded}`;
      for (const ym of hay.matchAll(/20\d{2}/g)) {
        const y = Number(ym[0]);
        if (y >= 2017 && y <= current + 1) years.add(y);
      }
    }
    // 年ナビが特殊なページでも、本文内の「2024年」等を救済。
    if (years.size < 2) {
      const plain = wikiHtmlToText(raw);
      for (const ym of plain.matchAll(/20\d{2}年?/g)) {
        const y = Number(ym[0].slice(0, 4));
        if (y >= 2017 && y <= current + 1) years.add(y);
      }
    }
    years.add(current);
    return [...years].sort((a, b) => b - a).slice(0, 10);
  }

  function primaryResearchChannel(entry = null) {
    if (entry) {
      const c = wikiChannelNameForEntry(entry, entry.meta);
      if (c) return c;
    }
    for (const e of currentResearchEntries()) {
      const c = wikiChannelNameForEntry(e, e.meta);
      if (c) return c;
    }
    return '';
  }

  // 分類の3状態: 未選択 → 含む（複数はOR）→ 除外 → 未選択。
  // 除外が優先されるため「FPS」かつ「コラボ」の動画もFPS除外中は非表示。
  function researchCategoryPassesFilters(categories = []) {
    const tags = categories || [];
    if (research.excludedTags.size && [...research.excludedTags].some(t => tags.includes(t))) return false;
    return !research.activeTags.size || [...research.activeTags].some(t => tags.includes(t));
  }

  function refreshResearchCategoryButton(button) {
    const tag = button.dataset.tag;
    const included = research.activeTags.has(tag);
    const excluded = research.excludedTags.has(tag);
    button.classList.toggle('active', included);
    button.classList.toggle('excluded', excluded);
    button.dataset.state = included ? 'include' : excluded ? 'exclude' : 'off';
    button.textContent = excluded ? `− ${tag}` : included ? `✓ ${tag}` : tag;
    button.setAttribute('aria-label', `${tag}：${included ? '絞り込み中。もう一度押すと除外' : excluded ? '除外中。もう一度押すと解除' : '未選択。押すと絞り込み'}`);
    button.setAttribute('aria-pressed', included || excluded ? 'true' : 'false');
    // Macaque can ignore GM.addStyle on mobile: update the three-state color inline.
    if (isMobileYoutubeUi()) {
      button.style.setProperty('background', excluded ? '#803746' : included ? '#5147a6' : '#303b53', 'important');
      button.style.setProperty('color', '#fff', 'important');
    }
  }

  function cycleResearchCategory(tag) {
    if (research.activeTags.has(tag)) {
      research.activeTags.delete(tag);
      research.excludedTags.add(tag);
    } else if (research.excludedTags.has(tag)) {
      research.excludedTags.delete(tag);
    } else {
      research.activeTags.add(tag);
    }
  }

  function collaboratorHistoryRowPassesFilters(row) {
    const includes = splitResearchWords(research.includeText);
    const excludes = splitResearchWords(research.excludeText);
    const hay = normalizeResearchText(`${row.title || ''} ${row.game || ''} ${(row.categories || []).join(' ')} ${(row.collaborators || []).join(' ')} ${(row.notes || []).join(' ')}`);
    const tagOk = researchCategoryPassesFilters(row.categories);
    const includeOk = !includes.length || includes.every(w => hay.includes(w));
    const excludeOk = !excludes.length || !excludes.some(w => hay.includes(w));
    const people = new Set((row.collaborators || []).map(normalizeCollaboratorName).filter(Boolean));
    const excludedPerson = [...research.collaboratorExcluded.keys()].some(key => people.has(key));
    const live = currentResearchEntries().find(entry => entry.id === row.id);
    const groups = researchCollaboratorOrgGroups(live || row);
    // The history loader already selects the focused collaborator; some wiki rows
    // list only the OTHER guests, so do not re-test individual names here.
    return tagOk && includeOk && excludeOk && !excludedPerson && researchGroupFilterPass(groups);
  }

  function renderResearchCollaboratorHistory() {
    renderResearchCollaboratorHistoryMain();
    const box = $('#npf-r-collab-history');
    if (!box) return;
    const person = String(research.collaboratorFilter || '').trim();
    if (!person) {
      box.classList.remove('show');
      box.replaceChildren();
      return;
    }
    box.classList.add('show');
    box.replaceChildren();

    const head = document.createElement('div');
    head.className = 'npf-r-history-head';
    const title = document.createElement('div');
    title.className = 'npf-r-history-title';
    title.textContent = `📚 ${research.collaboratorChannel || 'このチャンネル'} × ${person}　全期間`;
    head.appendChild(title);
    box.appendChild(head);

    const status = document.createElement('div');
    status.className = 'npf-r-history-status';
    const rows = (research.collabHistoryRows || []).filter(collaboratorHistoryRowPassesFilters);
    const total = (research.collabHistoryRows || []).length;
    const yearLabel = research.collabHistoryYears.length
      ? `${Math.min(...research.collabHistoryYears)}–${Math.max(...research.collabHistoryYears)}`
      : '';
    const sourceBits = [];
    if (research.collabHistoryHolodexCount) sourceBits.push(`Holodex ${research.collabHistoryHolodexCount}件`);
    if (research.collabHistoryWikiCount) sourceBits.push(`Wiki一致 ${research.collabHistoryWikiCount}件`);
    if (research.collabHistoryResolveNote && !sourceBits.length) sourceBits.push(research.collabHistoryResolveNote);
    if (research.collabHistoryLoading) {
      status.textContent = `全期間を検索中… 現在 ${total}件${yearLabel ? `（Wiki確認 ${yearLabel}）` : ''}${sourceBits.length ? ` ／ ${sourceBits.join('・')}` : ''}`;
    } else {
      status.textContent = total
        ? `全期間 ${total}件取得${rows.length !== total ? ` ／ 現在の条件では ${rows.length}件` : ''}${sourceBits.length ? ` ／ ${sourceBits.join('・')}` : ''}`
        : `${person} とのコラボは取得できませんでした${research.collabHistoryResolveNote ? `（${research.collabHistoryResolveNote}）` : ''}`;
    }
    box.appendChild(status);

    if (!rows.length) return;
    const list = document.createElement('div');
    list.className = 'npf-r-history-list';
    for (const row of rows) {
      const a = document.createElement('a');
      a.className = 'npf-r-history-row';
      a.href = youtubeUrl(row.id);
      a.target = '_blank'; a.rel = 'noopener';

      const d = document.createElement('div');
      d.className = 'npf-r-history-date';
      d.textContent = row.dateLabel || String(row.year || '');
      const n = document.createElement('div');
      n.className = 'npf-r-history-name';
      n.textContent = row.title || row.id;
      a.append(d, n);

      const others = (row.collaborators || []).filter(x => normalizeCollaboratorName(x) !== normalizeCollaboratorName(person));
      const meta = document.createElement('div');
      meta.className = 'npf-r-history-meta';
      const bits = [];
      if (row.game) bits.push(`🎮 ${row.game}`);
      if (others.length) bits.push(`他：${others.slice(0, 6).join('・')}${others.length > 6 ? '…' : ''}`);
      if (bits.length) meta.textContent = bits.join(' ／ ');
      if (meta.textContent) a.appendChild(meta);
      list.appendChild(a);
    }
    box.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'npf-r-history-actions';
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'npf-r-btn'; copy.textContent = '📋 全期間をCSVコピー';
    copy.addEventListener('click', async () => {
      const header = ['年','日付','タイトル','ゲーム','コラボ相手','URL','動画ID','Wiki URL'];
      const lines = [header.map(csvEscape).join(',')];
      for (const r of rows) {
        lines.push([
          r.year || '', r.dateLabel || '', r.title || '', r.game || '', (r.collaborators || []).join(' / '),
          youtubeUrl(r.id), r.id, r.sourceUrl || ''
        ].map(csvEscape).join(','));
      }
      const ok = await copyText(lines.join('\r\n'));
      toast(ok ? `📋 全期間 ${rows.length}件をCSV形式でコピーしました` : 'CSVコピーに失敗しました');
    });
    actions.appendChild(copy);
    box.appendChild(actions);
  }

  function wikiHistoryCacheKey(channel, year) {
    return `history::${wikiSanitizeChannelName(channel)}::${year}`;
  }

  async function requestWikiHistoryYearDataset(channel, year, force = false) {
    const clean = wikiSanitizeChannelName(channel);
    const key = wikiHistoryCacheKey(clean, year);
    const historic = state.wikiCache?.[key];
    const standard = getCachedWikiDataset(clean, year, force);
    // 既に動画一覧で取得した年別セットを全期間検索でも共有する。
    // 「全期間」ボタンを押すたびに年別Wikiの同じHTMLを読み直さない。
    if (!force && standard?.fetchOk) {
      return {
        ...standard,
        entries: wikiMergeEntries(standard.entries || {}, historic?.entries || {}),
        method: 'ローカルDB（年別Wiki共有）',
      };
    }
    if (!force && historic?.entries && Object.keys(historic.entries).length) {
      return { ...historic, fetchOk: true, method: 'ローカルDB（旧全期間キャッシュ）' };
    }
    // 未取得年のみ通常の年別取得キューで取得。429失敗済みはネットへ再試行しない。
    return await requestWikiDataset(clean, year, force);
  }

  function historyProbeYears(discovered = []) {
    const current = new Date().getFullYear();
    // 2017年までを上限10年で探索。メインの動画一覧が「今年」しかリンクしていなくても過去年を落とさない。
    const floor = Math.max(2017, current - 9);
    const probe = Array.from({ length: current - floor + 1 }, (_, i) => current - i);
    return [...new Set([...(discovered || []), ...probe])]
      .filter(y => Number.isFinite(Number(y)) && Number(y) >= floor && Number(y) <= current)
      .map(Number)
      .sort((a, b) => b - a);
  }

  function syncLoadedCardsFromHistory(rowsMap) {
    if (!rowsMap || typeof rowsMap.get !== 'function') return;
    for (const e of currentResearchEntries()) {
      const row = rowsMap.get(e.id);
      if (!row) continue;
      const prev = e.wikiInfo || {};
      const collaborators = [...new Set([...(prev.collaborators || []), ...(row.collaborators || [])])];
      e.wikiInfo = {
        ...prev,
        videoId: e.id,
        collaborators,
        hasCollabNote: !!(prev.hasCollabNote || collaborators.length),
        notes: [...new Set([...(prev.notes || []), ...(row.notes || [])])],
        sourceUrl: prev.sourceUrl || row.sourceUrl || '',
        parsedFromHistory: true,
      };
      e.wikiChecked = true;
      void nrhDbSaveWikiInfo(e.id, e.wikiInfo, e.wikiInfo?.sourceUrl || '').catch(() => {});
      if (e.el?.isConnected) renderResearchEntry(e, true);
    }
  }


  function primaryResearchChannelId() {
    const targetName = normalizeCollaboratorName(research.collaboratorChannel || '');
    const counts = new Map();
    for (const e of currentResearchEntries()) {
      const id = e?.meta?.channel?.id || e?.meta?.channel_id || '';
      if (!id) continue;
      const name = e?.meta?.channel?.name || e?.channel || e?.domChannel || '';
      const key = normalizeCollaboratorName(name);
      const score = (counts.get(id)?.score || 0) + 1 + (targetName && key === targetName ? 1000 : 0);
      counts.set(id, { id, name, score });
    }
    const best = [...counts.values()].sort((a,b) => b.score - a.score)[0];
    return best?.id || '';
  }

  async function resolveCollaboratorChannelId(person = '') {
    const key = normalizeCollaboratorName(person);
    if (!key) return '';
    if (research.channelResolveCache?.has(key)) return research.channelResolveCache.get(key) || '';
    if (nrhDbEnabled()) {
      try {
        const cachedChannel = await nrhDbGetByIndex('channels', 'normalizedName', key);
        if (cachedChannel?.id) {
          research.channelResolveCache.set(key, cachedChannel.id);
          return cachedChannel.id;
        }
      } catch {}
    }

    // まず現在読み込み済みのHolodex mentionsから探す。通常はこれで解決できる。
    for (const e of currentResearchEntries()) {
      for (const m of (e.mentions || [])) {
        if (m?.id && normalizeCollaboratorName(m.name || '') === key) {
          research.channelResolveCache.set(key, m.id);
          void nrhDbSaveChannel(m).catch(() => {});
          return m.id;
        }
      }
      for (const m of (e.meta?.mentions || [])) {
        const id = m?.id || m?.channel?.id || '';
        const name = m?.name || m?.english_name || m?.channel?.name || '';
        if (id && normalizeCollaboratorName(name) === key) {
          research.channelResolveCache.set(key, id);
          void nrhDbSaveChannel(m?.channel || m).catch(() => {});
          return id;
        }
      }
    }

    for (const f of (state.favorites || [])) {
      if (f?.id && normalizeCollaboratorName(f.name || '') === key) {
        research.channelResolveCache.set(key, f.id);
        return f.id;
      }
    }

    // 画面上でIDが分からない場合はHolodexのにじさんじチャンネル一覧から名前一致を探す。
    if (state.apiKey) {
      for (let offset = 0, page = 0; page < 12; page++, offset += 50) {
        let arr = [];
        try {
          arr = await apiGet(`/channels?type=vtuber&org=Nijisanji&limit=50&offset=${offset}`);
        } catch {
          break;
        }
        if (!Array.isArray(arr) || !arr.length) break;
        for (const c of arr) {
          if (c?.id) void nrhDbSaveChannel(c).catch(() => {});
          const candidates = [c?.name, c?.english_name].filter(Boolean);
          if (c?.id && candidates.some(n => normalizeCollaboratorName(n) === key)) {
            research.channelResolveCache.set(key, c.id);
            return c.id;
          }
        }
        if (arr.length < 50) break;
      }
    }

    research.channelResolveCache.set(key, '');
    return '';
  }

  function historyDateFromVideo(v) {
    const d = startOf(v) || (v?.available_at ? new Date(v.available_at) : null) || (v?.published_at ? new Date(v.published_at) : null);
    if (!d || Number.isNaN(d.getTime())) return { year: 0, label: '' };
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return { year: y, label: `${y}/${mo}/${da} ${hh}:${mm}` };
  }

  async function fetchHolodexPairHistory(primaryChannelId, collaboratorChannelId, person = '') {
    if (!state.apiKey || !primaryChannelId || !collaboratorChannelId) return [];
    const key = [primaryChannelId, collaboratorChannelId].sort().join('::');
    if (nrhDbEnabled()) {
      try {
        const cached = await nrhDbGet('pairs', key);
        if (Array.isArray(cached?.videos)) return cached.videos; // 保存済みペア結果の再検索は手動更新機能を作るまで行わない
      } catch {}
    }

    const out = [];
    const seen = new Set();
    for (let offset = 0, page = 0; page < 20; page++, offset += 50) {
      const res = await apiPost('/search/videoSearch', {
        sort: 'newest',
        target: ['stream'],
        vch: [primaryChannelId, collaboratorChannelId],
        paginated: true,
        offset,
        limit: 50,
      });
      const arr = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);
      if (!arr.length) break;
      for (const v of arr) {
        if (!v?.id || seen.has(v.id)) continue;
        seen.add(v.id);
        out.push(v);
        void nrhDbSaveVideoMeta(v.id, v).catch(() => {});
      }
      const total = Number(res?.total || 0);
      if (arr.length < 50 || (total && out.length >= total)) break;
    }
    if (nrhDbEnabled()) {
      void nrhDbPut('pairs', {
        key,
        channelIds: [primaryChannelId, collaboratorChannelId],
        person,
        videos: out,
        videoIds: out.map(v => v.id).filter(Boolean),
        fetchedAt: Date.now(),
      }).then(() => updateResearchDbStatus()).catch(() => {});
    }
    return out;
  }

  function holodexVideoToHistoryRow(v, person = '') {
    const { year, label } = historyDateFromVideo(v);
    const game = researchGameFromText(v?.title || '', v?.topic_id || '');
    const categories = researchCategories(v?.title || '', v, game);
    if (!categories.includes('コラボ')) categories.push('コラボ');
    const mentions = researchMentionList(v).map(x => x.name).filter(Boolean);
    const collaborators = [...mentions];
    const collaboratorOrgGroups = [...researchCollaboratorOrgGroups({ meta:v, collaborators })];
    if (person && !collaborators.some(n => normalizeCollaboratorName(n) === normalizeCollaboratorName(person))) {
      collaborators.push(person);
    }
    return {
      id: v.id,
      year,
      dateLabel: label || String(year || ''),
      title: String(v.title || '').trim() || v.id,
      game,
      categories,
      collaborators, collaboratorOrgGroups,
      notes: [],
      sourceUrl: '',
      source: 'Holodex',
    };
  }

  function wikiProfileUrl(channel = '') {
    return `${WIKI_BASE}/${encodeURIComponent(wikiSanitizeChannelName(channel))}`;
  }

  async function loadResearchCollaboratorHistory(person, channel) {
    const token = ++research.collabHistoryToken;
    research.collabHistoryRows = [];
    research.collabHistoryYears = [];
    research.collabHistoryYearStats = {};
    research.collabHistoryHolodexCount = 0;
    research.collabHistoryWikiCount = 0;
    research.collabHistoryResolveNote = '';
    research.collabHistoryLoading = true;
    renderResearchCollaboratorHistory();

    const clean = wikiSanitizeChannelName(channel || '');
    if (!clean || !person) {
      research.collabHistoryLoading = false;
      renderResearchCollaboratorHistory();
      return;
    }

    const key = normalizeCollaboratorName(person);
    const byId = new Map();

    try {
      // まずHolodexの「2チャンネルをともに含む動画」検索を使う。
      // これはYouTubeが現在DOMに読み込んでいる件数に依存せず、過去のコラボを一括取得できる。
      if (state.apiKey) {
        try {
          const primaryId = primaryResearchChannelId();
          const collaboratorId = await resolveCollaboratorChannelId(person);
          if (token !== research.collabHistoryToken) return;

          if (primaryId && collaboratorId) {
            const videos = await fetchHolodexPairHistory(primaryId, collaboratorId, person);
            if (token !== research.collabHistoryToken) return;
            for (const v of videos) {
              const row = holodexVideoToHistoryRow(v, person);
              if (row?.id) byId.set(row.id, row);
            }
            research.collabHistoryHolodexCount = byId.size;
            research.collabHistoryResolveNote = `Holodexペア検索 ${byId.size}件`;
            research.collabHistoryRows = [...byId.values()];
            renderResearchCollaboratorHistory();
            applyResearchFilters();
          } else {
            research.collabHistoryResolveNote = 'Holodex上でチャンネルIDを解決できず、Wiki中心で検索';
          }
        } catch (err) {
          research.collabHistoryResolveNote = `Holodex全期間検索は失敗（${err?.message || '不明'}）。Wikiで継続`;
          console.debug('[NRH][Holodex pair history]', err?.message || err);
        }
      } else {
        research.collabHistoryResolveNote = 'APIキー未設定のためWiki中心で検索';
      }

      // ローカルDBと既存Wikiキャッシュから対象年を確定。ページ探索のためだけの通信を避ける。
      let discovered = [];
      for (const k of Object.keys(state.wikiCache || {})) {
        const match = k.match(/^(?:history::)?(.+)::(20\d{2})$/);
        if (match && wikiSanitizeChannelName(match[1]) === clean) discovered.push(Number(match[2]));
      }
      if (nrhDbEnabled()) {
        try {
          const primaryId = primaryResearchChannelId();
          for (const rec of await nrhDbGetAll('videos')) {
            if (primaryId && rec.channelId !== primaryId) continue;
            if (!primaryId && wikiSanitizeChannelName(rec.channelName || '') !== clean) continue;
            const dateValue = rec.availableAt || rec.meta?.available_at || rec.meta?.start_actual || '';
            const d = dateValue && new Date(dateValue);
            if (d && !Number.isNaN(d.getTime())) discovered.push(d.getFullYear());
          }
        } catch (err) { console.debug('[NRH][Wiki local year discovery]', err?.message || err); }
      }
      // 新しいチャンネルでDBが空の場合に限ってWikiの目次を取得する。
      if (!discovered.length && !wikiRequestsPaused) {
        for (const url of [wikiPageUrl(clean, []), wikiProfileUrl(clean)]) {
          try {
            const html = await wikiRequest(url);
            discovered.push(...wikiDiscoverAvailableYears(html));
            if (discovered.length) break;
          } catch (err) {
            console.debug('[NRH][Wiki year discovery]', url, err?.message || err);
            if (err?.status === 429) break;
          }
        }
      }

      // Holodexで取得できた最古年までをWiki補完対象に含める。
      const hYears = [...new Set([...byId.values()].map(r => Number(r.year || 0)).filter(Boolean))];
      if (hYears.length) {
        const minY = Math.min(...hYears);
        const maxY = Math.max(new Date().getFullYear(), ...hYears);
        for (let y = maxY; y >= minY; y--) discovered.push(y);
      }
      let years = [...new Set(discovered.map(Number).filter(y => y >= 2017 && y <= new Date().getFullYear()))].sort((a,b)=>b-a);
      if (!years.length) years = historyProbeYears([]);

      for (const requestedYear of years) {
        if (token !== research.collabHistoryToken) return;
        const ds = await requestWikiHistoryYearDataset(clean, requestedYear, false).catch(err => {
          console.debug('[NRH][Wiki all-years]', requestedYear, err?.message || err);
          return null;
        });
        if (token !== research.collabHistoryToken) return;

        const entries = ds?.entries || {};
        const entryCount = Object.keys(entries).length;
        let matchCount = 0;
        research.collabHistoryYears.push(requestedYear);

        for (const [id, info] of Object.entries(entries)) {
          if (!id || !info) continue;
          const people = [...(info.collaborators || [])];
          if (!people.some(n => normalizeCollaboratorName(n) === key)) continue;
          matchCount++;
          const year = Number(info.wikiYear || requestedYear || 0) || requestedYear;
          const md = String(info.wikiDate || '').match(/(\d{1,2})\/(\d{1,2})/);
          const dateLabel = md ? `${year}/${String(Number(md[1])).padStart(2,'0')}/${String(Number(md[2])).padStart(2,'0')}` : String(year || '');
          const title = String(info.wikiTitle || '').trim() || id;
          const game = researchGameFromText(title, '');
          const categories = researchCategories(title, null, game);
          if (!categories.includes('コラボ')) categories.push('コラボ');

          const wikiRow = {
            id, year, dateLabel, title, game, categories, collaborators: people,
            notes: [...(info.notes || [])], sourceUrl: info.sourceUrl || ds?.sourceUrl || '', source: 'Wiki'
          };
          void nrhDbMergeVideo(id, {
            title: wikiRow.title,
            wikiInfo: {
              videoId: id,
              collaborators: wikiRow.collaborators,
              notes: wikiRow.notes,
              sourceUrl: wikiRow.sourceUrl,
              wikiYear: year,
              wikiDate: info.wikiDate || '',
              hasCollabNote: !!wikiRow.collaborators.length,
            },
            wikiSourceUrl: wikiRow.sourceUrl,
            wikiFetchedAt: Date.now(),
          }).catch(() => {});
          const existing = byId.get(id);
          if (existing) {
            existing.collaborators = [...new Set([...(existing.collaborators || []), ...people])];
            existing.notes = [...new Set([...(existing.notes || []), ...(wikiRow.notes || [])])];
            existing.sourceUrl ||= wikiRow.sourceUrl;
            existing.source = existing.source === 'Holodex' ? 'Holodex+Wiki' : existing.source;
            existing.dateLabel ||= wikiRow.dateLabel;
            existing.year ||= wikiRow.year;
            existing.game ||= wikiRow.game;
          } else {
            byId.set(id, wikiRow);
          }
        }

        research.collabHistoryWikiCount += matchCount;
        research.collabHistoryYearStats[requestedYear] = {
          entries: entryCount,
          matches: matchCount,
          method: ds?.method || 'none'
        };
        research.collabHistoryYears = [...new Set(research.collabHistoryYears)].sort((a,b)=>b-a);

        const dateScore = r => {
          const m = String(r.dateLabel || '').match(/(20\d{2})\/(\d{2})\/(\d{2})/);
          return m ? Number(`${m[1]}${m[2]}${m[3]}`) : Number(r.year || 0) * 10000;
        };
        research.collabHistoryRows = [...byId.values()].sort((a, b) => dateScore(b) - dateScore(a));
        syncLoadedCardsFromHistory(byId);
        applyResearchFilters();
        renderResearchCollaboratorHistory();
        updateResearchStatus();

        await new Promise(resolve => setTimeout(resolve, 220));
      }

      // 現在表示中カードの情報も最後に合流（Wiki更新待ちの直近案件などの救済）。
      for (const e of currentResearchEntries()) {
        if (!e?.id) continue;
        if (!(e.collaborators || []).some(n => normalizeCollaboratorName(n) === key)) continue;
        if (byId.has(e.id)) continue;
        const dm = String(e.date || '').match(/(20\d{2})\/(\d{2})\/(\d{2})/);
        const year = dm ? Number(dm[1]) : (wikiEntryYear(e, e.meta) || new Date().getFullYear());
        byId.set(e.id, {
          id: e.id, year, dateLabel: e.date || String(year), title: e.title || e.id,
          game: e.game || '', categories: [...(e.categories || ['コラボ'])], collaborators: [...(e.collaborators || [])],
          notes: [...(e.wikiInfo?.notes || [])], sourceUrl: e.wikiInfo?.sourceUrl || '', source: e.wikiInfo ? 'Wiki+Holodex' : 'Holodex'
        });
      }

      const dateScore = r => {
        const m = String(r.dateLabel || '').match(/(20\d{2})\/(\d{2})\/(\d{2})/);
        return m ? Number(`${m[1]}${m[2]}${m[3]}`) : Number(r.year || 0) * 10000;
      };
      research.collabHistoryRows = [...byId.values()].sort((a, b) => dateScore(b) - dateScore(a));
      syncLoadedCardsFromHistory(byId);
    } finally {
      if (token === research.collabHistoryToken) {
        research.collabHistoryLoading = false;
        renderResearchCollaboratorHistory();
        applyResearchFilters();
        updateResearchStatus();
      }
    }
  }

  function normalizeCollaboratorName(name = '') {
    let s = String(name || '').trim();
    // Holodex表記「伊波ライ / Inami Rai【にじさんじ】」とWiki表記「伊波ライ」を同一視する。
    s = s.replace(/[【\[][^】\]]*(?:にじさんじ|nijisanji)[^】\]]*[】\]]/gi, '');
    if (/[\/／]/.test(s)) s = s.split(/\s*[\/／]\s*/)[0];
    s = s.replace(/[（(](?:視点|主催|途中参加|途中離脱|vc|ボイチャ|通話|敬称略|不参加|なし|無し)[^）)]*[）)]/gi, '');
    return normalizeResearchText(s).replace(/[\s　]+/g, '');
  }

  function renderResearchCollaboratorHistoryMain() {
    // v0.8.xではWiki/Holodex由来の「擬似カード」をYouTube一覧の上にも複製していたが、
    // YouTube標準カードとの区別がつきにくいため廃止。全期間結果は右下の「🔎 調査」パネルへ一本化する。
    $('#npf-r-history-main')?.remove();
  }

  function collaboratorDisplayName(name = '') {
    let s = String(name || '').trim();
    s = s.replace(/[【\[][^】\]]*(?:にじさんじ|nijisanji)[^】\]]*[】\]]/gi, '').trim();
    if (/[\/／]/.test(s)) s = s.split(/\s*[\/／]\s*/)[0].trim();
    s = s.replace(/[（(](?:視点|主催|途中参加|途中離脱|vc|ボイチャ|通話|敬称略|不参加|なし|無し)[^）)]*[）)]/gi, '').trim();
    return s || String(name || '').trim();
  }

  function collectResearchCollaboratorSuggestions() {
    const map = new Map();
    const add = raw => {
      const display = collaboratorDisplayName(raw);
      const key = normalizeCollaboratorName(display);
      if (!display || !key) return;
      const cur = map.get(key) || { name: display, count: 0 };
      cur.count++;
      if (display.length < cur.name.length) cur.name = display;
      map.set(key, cur);
    };
    for (const e of currentResearchEntries()) {
      for (const name of (e.collaborators || [])) add(name);
      for (const name of (e.wikiInfo?.collaborators || [])) add(name);
    }
    for (const row of (research.collabHistoryRows || [])) {
      for (const name of (row.collaborators || [])) add(name);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
  }

  // Three-state collaborator selectors: off -> include (OR) -> exclude -> off.
  // Exclusions are exact normalized names from collaborator metadata, never title text.
  function researchCollaboratorKeys(entry) {
    return new Set([...(entry.collaborators || []), ...(entry.wikiInfo?.collaborators || [])]
      .map(normalizeCollaboratorName).filter(Boolean));
  }

  // The official member roster on the Nijisanji fan wiki is the ONLY box-member
  // authority. Ordinary Wiki video pages and Holodex org labels are not a roster.
  const RESEARCH_COLLAB_GROUPS = { nijisanji:'にじさんじ', outside:'にじさんじ以外' };
  const RESEARCH_ROSTER_URL = `${WIKI_BASE}/公式ライバー`;
  const RESEARCH_ROSTER_CACHE_KEY = 'npf_current_nijisanji_roster_wiki_v1';
  const RESEARCH_ROSTER_TTL = 7 * 24 * 60 * 60 * 1000;
  const researchRoster = { names:new Set(), members:0, ready:false, loading:false,
    fetchedAt:0, error:'', promise:null };

  function researchRosterKey(name = '') {
    return normalizeCollaboratorName(name).normalize('NFKC');
  }

  function parseNijisanjiRosterHtml(html = '') {
    // Do not pass remote HTML into DOMParser/innerHTML. YouTube on iOS may
    // require TrustedHTML and forbid creation of third-party TT policies.
    // Only extract text from the public roster's headings and profile links.
    const names = new Set();
    const members = new Set();
    let section = '', current = false;
    const plain = value => wikiDecodeEntities(String(value || '')
      .replace(/<[^>]*>/g, '')).replace(/\u00a0/g, ' ').trim();
    const add = (value, canonical = false) => {
      const key = researchRosterKey(value);
      if (key && (canonical || key.length >= 2) && key.length <= 100) names.add(key);
    };
    const blocks = String(html || '').matchAll(/<(h2|h3|h4|ul)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi);
    for (const block of blocks) {
      const tag = block[1].toLowerCase();
      const markup = block[2];
      if (tag === 'h2') {
        const label = plain(markup);
        section = label.includes('にじさんじ公式ライバー') ? 'jp'
          : label.includes('海外公式ライバー') ? 'other' : '';
        current = false;
      } else if (tag === 'h3') {
        const label = plain(markup);
        if (['other', 'en', 'virtual'].includes(section))
          section = label.includes('NIJISANJI EN') ? 'en'
            : label.includes('VirtuaReal') ? 'virtual' : 'other';
        current = false;
      } else if (tag === 'h4') {
        const label = plain(markup);
        current = (section === 'jp' || section === 'en')
          && /^メンバー/.test(label) && !/^元メンバー/.test(label);
      } else if (tag === 'ul' && current) {
        for (const item of markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)) {
          const li = item[1];
          let name = '';
          for (const a of li.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
            const hrefMatch = a[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
            const href = wikiDecodeEntities(hrefMatch?.[1] || hrefMatch?.[2] || '');
            if (href.startsWith('/nijisanji/') && !href.includes('::')) {
              name = plain(a[2]);
              break;
            }
          }
          const key = researchRosterKey(name);
          if (!key || members.has(key)) continue;
          members.add(key);
          add(name, true);
          const alias = plain(li).match(/[（(]([^）)]+)[）)]/);
          if (alias) for (const part of alias[1].split(/[\/／]/)) add(part.trim());
        }
      }
    }
    // A changed page layout must NOT mark every actual member as outside.
    if (members.size < 180 || members.size > 260
        || !names.has(researchRosterKey('小柳ロウ'))
        || !names.has(researchRosterKey('Elira Pendora')))
      throw new Error(`公式ライバー名簿の解析結果が不正（${members.size}名）`);
    return { names: [...names], members: members.size };
  }

  async function ensureResearchRoster() {
    if (researchRoster.ready && Date.now() - researchRoster.fetchedAt < RESEARCH_ROSTER_TTL)
      return true;
    if (researchRoster.promise) return researchRoster.promise;
    researchRoster.loading = true;
    researchRoster.error = '';
    updateResearchCollaboratorGroupButtons();
    researchRoster.promise = (async () => {
      const cached = await gmGet(RESEARCH_ROSTER_CACHE_KEY, null).catch(() => null);
      if (cached && Array.isArray(cached.names) && cached.names.length >= 180
          && Number(cached.members) >= 180 && Number(cached.members) <= 260) {
        researchRoster.names = new Set(cached.names);
        researchRoster.members = Number(cached.members);
        researchRoster.fetchedAt = Number(cached.fetchedAt || 0);
        researchRoster.ready = true;
      }
      if (researchRoster.ready && Date.now() - researchRoster.fetchedAt < RESEARCH_ROSTER_TTL)
        return true;
      try {
        // Only triggered by a user's first box/outsider filter selection.
        const html = await wikiRequest(RESEARCH_ROSTER_URL);
        const parsed = parseNijisanjiRosterHtml(html);
        researchRoster.names = new Set(parsed.names);
        researchRoster.members = parsed.members;
        researchRoster.fetchedAt = Date.now();
        researchRoster.ready = true;
        await gmSet(RESEARCH_ROSTER_CACHE_KEY, { ...parsed, fetchedAt:researchRoster.fetchedAt })
          .catch(err => console.debug('[NRH][roster save]', err?.message || err));
      } catch (err) {
        researchRoster.error = String(err?.message || err || 'Wiki名簿の取得に失敗しました');
        console.debug('[NRH][roster load]', researchRoster.error);
      }
      return researchRoster.ready;
    })().finally(() => {
      researchRoster.loading = false;
      researchRoster.promise = null;
      updateResearchCollaboratorGroupButtons();
      applyResearchFilters();
    });
    return researchRoster.promise;
  }

  function researchCollaboratorOrgGroups(entry) {
    const groups = new Set();
    // When the roster is unavailable, NEITHER group can be inferred safely.
    if (!researchRoster.ready || !entry) return groups;
    const names = new Set([
      ...(entry.collaborators || []), ...(entry.wikiInfo?.collaborators || []),
    ].map(researchRosterKey).filter(Boolean));
    const mentions = Array.isArray(entry.meta?.mentions) ? entry.meta.mentions : [];
    for (const mention of mentions) {
      const channel = mention?.channel || mention || {};
      const candidates = [mention?.name, mention?.english_name, channel?.name, channel?.english_name]
        .map(researchRosterKey).filter(Boolean);
      // These aliases refer to ONE participant: do not count a romanized
      // version of a known member as an extra outside collaborator.
      if (!candidates.length) continue;
      if (candidates.some(name => researchRoster.names.has(name))) groups.add('nijisanji');
      else groups.add('outside');
      // Remove aliases of the same mention when also included in Wiki names.
      for (const candidate of candidates) names.delete(candidate);
    }
    for (const name of names) {
      groups.add(researchRoster.names.has(name) ? 'nijisanji' : 'outside');
    }
    return groups;
  }

  function researchGroupFilterPass(groups) {
    // Never hide everything, or label members as outside, if roster fetch fails.
    if (!researchRoster.ready) return true;
    if ([...research.collaboratorGroupExcluded].some(group => groups.has(group))) return false;
    return !research.collaboratorGroupIncluded.size ||
      [...research.collaboratorGroupIncluded].some(group => groups.has(group));
  }

  function updateResearchCollaboratorGroupButtons() {
    const hint = $('#npf-r-collab-group-hint');
    if (hint) {
      hint.textContent = researchRoster.loading
        ? 'にじさんじ非公式Wikiの現所属者名簿を確認中…（確認できるまで所属フィルターは保留）'
        : researchRoster.ready
          ? `にじさんじ非公式Wiki「公式ライバー」現所属 ${researchRoster.members}名の名簿で判定。名簿にないコラボ相手は箱外。${researchRoster.error ? '更新失敗のため前回名簿を使用中。' : ''}箱内・箱外の混在動画は両方に該当し、除外を優先。`
          : researchRoster.error
            ? `Wiki名簿を確認できません：${researchRoster.error}。誤判定防止のため所属フィルターは保留。もう一度ボタンを操作すると再試行します。`
            : '初回の所属フィルター選択時に非公式Wikiの現所属者名簿を取得します。名簿にないコラボ相手は箱外。卒業者・個人勢・ストリーマーも箱外扱い。';
    }
    $$('.npf-r-collab-group').forEach(btn => {
      const group = btn.dataset.collabGroup;
      const included = research.collaboratorGroupIncluded.has(group);
      const excluded = research.collaboratorGroupExcluded.has(group);
      btn.classList.toggle('active', included);
      btn.classList.toggle('excluded', excluded);
      btn.textContent = `${excluded ? '−' : included ? '✓' : '🤝'} ${RESEARCH_COLLAB_GROUPS[group]}`;
      btn.setAttribute('aria-pressed', included || excluded ? 'true' : 'false');
      if (isMobileYoutubeUi()) {
        if (included || excluded) {
          btn.style.setProperty('background', excluded ? '#803746' : '#5147a6', 'important');
          btn.style.setProperty('color', '#fff', 'important');
          btn.style.setProperty('border-color', excluded ? '#e58c96' : '#8172ea', 'important');
        } else {
          btn.style.removeProperty('background');
          btn.style.removeProperty('color');
          btn.style.removeProperty('border-color');
        }
      }
    });
  }

  function cycleResearchCollaboratorGroup(group) {
    if (!Object.prototype.hasOwnProperty.call(RESEARCH_COLLAB_GROUPS, group)) return;
    if (research.collaboratorGroupIncluded.has(group)) {
      research.collaboratorGroupIncluded.delete(group);
      research.collaboratorGroupExcluded.add(group);
    } else if (research.collaboratorGroupExcluded.has(group)) {
      research.collaboratorGroupExcluded.delete(group);
    } else {
      research.collaboratorGroupIncluded.add(group);
    }
    updateResearchCollaboratorFilterUi();
    applyResearchFilters();
    if (research.collaboratorGroupIncluded.size || research.collaboratorGroupExcluded.size)
      void ensureResearchRoster();
  }

  function paintResearchCollaboratorButton(btn, name, isCard = false) {
    const key = normalizeCollaboratorName(name);
    const included = research.collaboratorIncluded.has(key);
    const excluded = research.collaboratorExcluded.has(key);
    btn.classList.toggle('active', included);
    btn.classList.toggle('excluded', excluded);
    btn.textContent = `${excluded ? '−' : included ? '✓' : '🤝'} ${name}`;
    btn.title = `${name}：${included ? '絞り込み中。次は除外' : excluded ? '除外中。次は解除' : 'タップで絞り込み'}（複数の絞り込みはOR、除外を優先）`;
    btn.setAttribute('aria-pressed', included || excluded ? 'true' : 'false');
    // iOS Macaque can fail to inject GM.addStyle rules.
    if (isMobileYoutubeUi()) {
      if (included || excluded) {
        btn.style.setProperty('background', excluded ? '#803746' : '#5147a6', 'important');
        btn.style.setProperty('color', '#fff', 'important');
        btn.style.setProperty('border-color', excluded ? '#e58c96' : '#8172ea', 'important');
      } else {
        btn.style.removeProperty('background');
        btn.style.removeProperty('color');
        btn.style.removeProperty('border-color');
      }
    }
  }

  function updateResearchCollaboratorSuggestions() {
    const input = $('#npf-r-collab-input');
    const datalist = $('#npf-r-collab-options');
    const quick = $('#npf-r-collab-suggestions');
    const selected = $('#npf-r-collab-selected');
    if (!input || !datalist || !quick || !selected) return;

    const rows = collectResearchCollaboratorSuggestions();
    const signature = rows.map(x => `${normalizeCollaboratorName(x.name)}:${x.count}`).join('|');
    if (datalist.dataset.signature !== signature) {
      datalist.replaceChildren();
      for (const row of rows) {
        const opt = document.createElement('option');
        opt.value = row.name;
        opt.label = `${row.name}（${row.count}件）`;
        datalist.appendChild(opt);
      }
      datalist.dataset.signature = signature;
    }

    const stateSig = `${[...research.collaboratorIncluded.keys()].join(',')}::${[...research.collaboratorExcluded.keys()].join(',')}`;
    const quickSig = `${signature}::${stateSig}`;
    if (quick.dataset.signature !== quickSig) {
      quick.replaceChildren();
      const top = rows.slice(0, 12);
      // Keep selected people visible even if they have fallen outside the top 12.
      for (const [key, name] of [...research.collaboratorIncluded, ...research.collaboratorExcluded]) {
        if (!top.some(row => normalizeCollaboratorName(row.name) === key)) top.push({name, count:0});
      }
      for (const row of top) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'npf-r-collab-quick';
        b.dataset.collaborator = row.name;
        paintResearchCollaboratorButton(b, row.name);
        b.addEventListener('click', () => cycleResearchCollaborator(row.name));
        quick.appendChild(b);
      }
      quick.dataset.signature = quickSig;
    }

    selected.replaceChildren();
    for (const [kind, names] of [['include', research.collaboratorIncluded], ['exclude', research.collaboratorExcluded]]) {
      for (const [key, name] of names) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = `npf-r-collab-quick${kind === 'exclude' ? ' excluded' : ' active'}`;
        b.textContent = `${kind === 'exclude' ? '−' : '✓'} ${name} ×解除`;
        b.title = `${name} の${kind === 'exclude' ? '除外' : '絞り込み'}を解除`;
        b.addEventListener('click', () => removeResearchCollaboratorSelection(key));
        selected.appendChild(b);
      }
    }
    selected.hidden = !selected.childElementCount;
    if (document.activeElement !== input) input.value = research.collaboratorFilter || '';
  }

  function applyResearchCollaboratorInput() {
    const input = $('#npf-r-collab-input');
    const name = collaboratorDisplayName(input?.value || '');
    const key = normalizeCollaboratorName(name);
    if (!key) { toast('コラボ相手の名前を入力してください'); return; }
    research.collaboratorExcluded.delete(key);
    research.collaboratorIncluded.set(key, name);
    focusResearchCollaborator(name);
  }

  function excludeResearchCollaboratorInput() {
    const input = $('#npf-r-collab-input');
    const name = collaboratorDisplayName(input?.value || '');
    const key = normalizeCollaboratorName(name);
    if (!key) { toast('除外するコラボ相手の名前を入力してください'); return; }
    research.collaboratorIncluded.delete(key);
    research.collaboratorExcluded.set(key, name);
    if (normalizeCollaboratorName(research.collaboratorFilter) === key)
      focusResearchCollaborator([...research.collaboratorIncluded.values()].at(-1) || '');
    else { updateResearchCollaboratorFilterUi(); applyResearchFilters(); }
    toast(`− ${name} のコラボを除外します`);
  }

  function removeResearchCollaboratorSelection(key) {
    research.collaboratorIncluded.delete(key);
    research.collaboratorExcluded.delete(key);
    if (normalizeCollaboratorName(research.collaboratorFilter) === key)
      focusResearchCollaborator([...research.collaboratorIncluded.values()].at(-1) || '');
    else { updateResearchCollaboratorFilterUi(); applyResearchFilters(); }
  }

  function cycleResearchCollaborator(rawName, entry = null) {
    const name = collaboratorDisplayName(rawName);
    const key = normalizeCollaboratorName(name);
    if (!key) return;
    if (research.collaboratorIncluded.has(key)) {
      research.collaboratorIncluded.delete(key);
      research.collaboratorExcluded.set(key, name);
      if (normalizeCollaboratorName(research.collaboratorFilter) === key)
        focusResearchCollaborator([...research.collaboratorIncluded.values()].at(-1) || '');
      else { updateResearchCollaboratorFilterUi(); applyResearchFilters(); }
      toast(`− ${name} のコラボを除外します`);
    } else if (research.collaboratorExcluded.has(key)) {
      research.collaboratorExcluded.delete(key);
      updateResearchCollaboratorFilterUi(); applyResearchFilters();
      toast(`${name} の除外を解除しました`);
    } else {
      research.collaboratorIncluded.set(key, name);
      focusResearchCollaborator(name, entry);
    }
  }

  function updateResearchCollaboratorFilterUi() {
    const activeName = String(research.collaboratorFilter || '').trim();
    const activeBtn = $('#npf-r-collab-active');
    if (activeBtn) {
      activeBtn.hidden = !activeName;
      activeBtn.textContent = activeName ? `🤝 全期間履歴：${activeName}  ×解除` : '';
      activeBtn.title = activeName ? `${activeName} の絞り込みを解除` : '';
    }
    $$('.npf-r-collab-person').forEach(btn =>
      paintResearchCollaboratorButton(btn, btn.dataset.collaborator || '', true));
    updateResearchCollaboratorSuggestions();
    updateResearchCollaboratorGroupButtons();
  }

  // Full-period Wiki/Holodex history is fetched for the last selected include.
  // Already loaded YouTube cards are filtered using ALL includes (OR) and excludes.
  function focusResearchCollaborator(name = '', entry = null) {
    research.collaboratorFilter = String(name || '').trim();
    research.collaboratorChannel = research.collaboratorFilter ? primaryResearchChannel(entry) : '';
    if (!research.collaboratorFilter) {
      research.collabHistoryToken++;
      research.collabHistoryRows = [];
      research.collabHistoryYears = [];
      research.collabHistoryYearStats = {};
      research.collabHistoryHolodexCount = 0;
      research.collabHistoryWikiCount = 0;
      research.collabHistoryResolveNote = '';
      research.collabHistoryLoading = false;
      renderResearchCollaboratorHistory();
    } else {
      const panel = ensureResearchUi();
      panel?.classList.add('npf-open');
      $('#npf-research-fab')?.classList.add('npf-open');
      void loadResearchCollaboratorHistory(research.collaboratorFilter, research.collaboratorChannel);
    }
    updateResearchCollaboratorFilterUi();
    applyResearchFilters();
    if (research.collaboratorFilter) toast(`🤝 ${research.collaboratorFilter} を含むコラボを表示。全期間履歴も検索します`);
  }

  function researchGameKey(game = '') {
    return normalizeResearchText(game).normalize('NFKC');
  }
  function cycleResearchGame(game = '') {
    const name=String(game||'').trim();
    const key=researchGameKey(name);
    if(!key) return;
    if(research.gameIncluded.has(key)) {
      research.gameIncluded.delete(key);research.gameExcluded.set(key,name);
    } else if(research.gameExcluded.has(key)) {
      research.gameExcluded.delete(key);
    } else {
      research.gameIncluded.set(key,name);
    }
    applyResearchFilters();
  }
  function updateResearchGameSuggestions() {
    const container=$('#npf-r-game-suggestions');
    if(!container) return;
    const games=new Map();
    for(const e of currentResearchEntries()) {
      const name=String(e.game||'').trim();
      const key=researchGameKey(name);
      if(!key) continue;
      const v=games.get(key)||{name,count:0};v.count++;
      if(name.length<v.name.length) v.name=name;
      games.set(key,v);
    }
    const suggestions=[...games.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ja')).slice(0,12);
    const selected=[...new Map([...research.gameIncluded,...research.gameExcluded]).entries()]
      .filter(([key])=>!games.has(key)).map(([key,name])=>({name,count:0}));
    const rows=[...suggestions,...selected];
    const signature=JSON.stringify(rows.map(x=>[x.name,x.count,research.gameIncluded.has(researchGameKey(x.name)),research.gameExcluded.has(researchGameKey(x.name))]));
    if(container.dataset.rendered===signature) return; // avoid YouTube's DOM observer redraw loop
    container.dataset.rendered=signature;
    container.replaceChildren();
    for(const {name,count} of rows) {
      const key=researchGameKey(name);
      const included=research.gameIncluded.has(key),excluded=research.gameExcluded.has(key);
      const b=document.createElement('button');b.type='button';
      b.className='npf-r-collab-quick'+(included?' active':excluded?' excluded':'');
      b.textContent=`${excluded?'− ':included?'✓ ':''}${name}${count?' ('+count+')':''}`;
      b.title=`${name}：タップで絞り込み→除外→解除。候補は表示中の動画から取得。`;
      b.addEventListener('click',()=>cycleResearchGame(name));container.append(b);
    }
    const note=$('#npf-r-game-hint');
    if(note) note.textContent=games.size
      ? `表示中の動画からゲーム${games.size}種類を検出。候補は最大12件、絞り込みはOR・除外は優先。`:
        'ゲーム名の取得待ちです。動画を取得すると候補が表示されます。';
  }

  // Preserve each YouTube card's original inline display when a filter is cleared.
  const researchCardOriginalDisplay = new WeakMap();

  function applyResearchFilters() {
    const includes = splitResearchWords(research.includeText);
    const excludes = splitResearchWords(research.excludeText);
    const collaboratorKey = normalizeCollaboratorName(research.collaboratorFilter || '');
    const historyMatchIds = collaboratorKey ? new Set((research.collabHistoryRows || []).map(r => r.id).filter(Boolean)) : new Set();
    for (const e of currentResearchEntries()) {
      const hay = normalizeResearchText(`${e.title} ${e.channel} ${e.game} ${(e.categories || []).join(' ')} ${(e.collaborators || []).join(' ')} ${(e.wikiInfo?.notes || []).join(' ')}`);
      const tagOk = researchCategoryPassesFilters(e.categories);
      const game=researchGameKey(e.game);
      const gameOk=![...research.gameExcluded.keys()].some(key=>game.includes(key))
        && (!research.gameIncluded.size || [...research.gameIncluded.keys()].some(key=>game.includes(key)));
      const includeOk = !includes.length || includes.every(w => hay.includes(w));
      const excludeOk = !excludes.length || !excludes.some(w => hay.includes(w));
      const people = researchCollaboratorKeys(e);
      const personExcluded = [...research.collaboratorExcluded.keys()].some(key => people.has(key));
      const groups = researchCollaboratorOrgGroups(e);
      const rosterReady = researchRoster.ready;
      const groupExcluded = rosterReady && [...research.collaboratorGroupExcluded].some(group => groups.has(group));
      const groupIncluded = rosterReady && research.collaboratorGroupIncluded.size > 0;
      const personIncluded = (!research.collaboratorIncluded.size && !groupIncluded) ||
        [...research.collaboratorIncluded.keys()].some(key => people.has(key)) ||
        (!!collaboratorKey && research.collaboratorIncluded.has(collaboratorKey) && historyMatchIds.has(e.id)) ||
        (groupIncluded && [...research.collaboratorGroupIncluded].some(group => groups.has(group)));
      const show = tagOk && gameOk && includeOk && excludeOk && !personExcluded && !groupExcluded && personIncluded;
      // Some mobile Macaque/YouTube pages do not apply GM.addStyle rules.
// Preserve YouTube's original inline display instead of blindly resetting it.
if (!show) {
  if (!researchCardOriginalDisplay.has(e.el)) {
    researchCardOriginalDisplay.set(e.el, {
      value: e.el.style.getPropertyValue('display'),
      priority: e.el.style.getPropertyPriority('display'),
    });
  }
  e.el.style.setProperty('display', 'none', 'important');
} else if (researchCardOriginalDisplay.has(e.el)) {
  const original = researchCardOriginalDisplay.get(e.el);
  if (original.value) e.el.style.setProperty('display', original.value, original.priority);
  else e.el.style.removeProperty('display');
  researchCardOriginalDisplay.delete(e.el);
}
e.el.classList.toggle('npf-r-hidden', !show);
    }
    updateResearchCollaboratorFilterUi();
    updateResearchGameSuggestions();
    renderResearchCollaboratorHistory();
    updateResearchStatus();
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  }

  async function copyResearchCsv() {
    const rows = currentResearchEntries().filter(e => !e.el.classList.contains('npf-r-hidden'));
    if (!rows.length) return toast('コピーできる表示中アーカイブがありません');
    const header = ['配信日','配信時間','ゲーム','分類','コラボ人数','コラボ相手','Wiki注記','情報ソース','タイトル','チャンネル','URL','動画ID','Wiki URL'];
    const lines = [header.map(csvEscape).join(',')];
    for (const e of rows) {
      const source = e.meta ? (e.wikiInfo ? 'Holodex+非公式Wiki' : 'Holodex') : (e.wikiInfo ? '非公式Wiki（Holodex未取得）' : 'タイトル推定（Holodex未取得）');
      lines.push([
        e.date || '', researchDurationLabel(e.durationSec), e.game || '', (e.categories || []).join('/'),
        e.collabCount || '', (e.collaborators || []).join(' / '), (e.wikiInfo?.notes || []).join(' / '), source,
        e.title || '', e.channel || '', e.url || youtubeUrl(e.id), e.id, e.wikiInfo?.sourceUrl || ''
      ].map(csvEscape).join(','));
    }
    const ok = await copyText(lines.join('\r\n'));
    toast(ok ? `📋 表示中 ${rows.length}件をCSV形式でコピーしました` : 'CSVコピーに失敗しました');
  }

  function updateResearchCooldownDisplay() {
    // iOS timers may be throttled in the background: derive the value from the
    // absolute deadline whenever the browser runs again, never decrement a counter.
    if (research.holodexPaused) {
      const label = $('#npf-r-status [data-npf-cooldown="Holodex"] .npf-r-status-detail');
      if (label) {
        const sec = Math.ceil(holodexCooldownRemainingMs() / 1000);
        label.textContent = sec > 0
          ? `429で自動取得停止・あと約${sec}秒（手動再試行）`
          : '429で自動取得停止・再解析・再取得で手動再試行';
      }
    }
    if (wikiRequestsPaused) {
      const label = $('#npf-r-status [data-npf-cooldown="Wiki"] .npf-r-status-detail');
      if (label) {
        const sec = Math.ceil(wikiCooldownRemainingMs() / 1000);
        // Keep the other Wiki status counters unchanged.
        label.textContent = label.textContent.replace(
          /429で自動通信停止・(?:あと約\d+秒（手動再試行）|失敗分だけ手動再試行)/,
          sec > 0 ? `429で自動通信停止・あと約${sec}秒（手動再試行）`
            : '429で自動通信停止・失敗分だけ手動再試行');
      }
    }
  }

  function updateResearchStatus() {
    const el = $('#npf-r-status');
    if (!el) return;
    const all = currentResearchEntries();
    const total = all.length;
    const visible = all.filter(e => !e.el.classList.contains('npf-r-hidden')).length;
    const enriched = all.filter(e => !!e.meta).length;
    const metaPending = all.filter(e => !e.meta && (research.pendingMeta.has(e.id) || research.queuedIds.has(e.id) || research.metaRetryTimers.has(e.id))).length;
    const metaFailed = all.filter(e => !e.meta && research.metaFailures.has(e.id) && !research.metaRetryTimers.has(e.id) && !research.pendingMeta.has(e.id)).length;
    const metaRemaining = Math.max(0, total - enriched - metaPending - metaFailed);
    const wikiChecked = all.filter(e => e.wikiChecked).length;
    const wikiMatched = all.filter(e => !!e.wikiInfo).length;
    const wikiPending = all.filter(e => e.wikiLoading).length;
    const wikiErrors = all.filter(e => !!e.wikiError && !e.wikiInfo).length;
    const wikiUpdateErrors = all.filter(e => !!e.wikiError && !!e.wikiInfo).length;
    const wikiSkipped = all.filter(e => !!e.wikiSkipReason).length;
    const wikiUnmatched = Math.max(0, wikiChecked - wikiMatched);
    const wikiTarget = enriched;
    const wikiWaiting = Math.max(0, wikiTarget - wikiChecked - wikiPending - wikiErrors - wikiSkipped);
    const cooldownSec = Math.ceil(holodexCooldownRemainingMs() / 1000);

    el.replaceChildren();
    const addRow = (label, main, detail = '', cls = '', title = '') => {
      const row = document.createElement('div');
      row.className = `npf-r-status-row${cls ? ' ' + cls : ''}`;
      if (label === 'Holodex' || label === 'Wiki') row.dataset.npfCooldown = label;
      if (title) row.title = title;
      const l = document.createElement('span'); l.className = 'npf-r-status-label'; l.textContent = label;
      const m = document.createElement('span'); m.className = 'npf-r-status-main'; m.textContent = main;
      row.append(l, m);
      if (detail) { const d = document.createElement('span'); d.className = 'npf-r-status-detail'; d.textContent = detail; row.appendChild(d); }
      el.appendChild(row);
    };

    addRow('収集', research.collectionActive ? '▶ 取得中' : '⏸ 手動開始待ち', research.collectionActive ? 'この一覧で追加表示された動画も取得' : '取得開始を押すまで外部へ自動取得しません', 'npf-r-status-info');
    addRow('YouTube', `表示 ${visible}/${total}本`, visible === total ? '読み込み済みカードはすべて表示対象' : `フィルターで ${total - visible}本非表示`, visible === total ? 'npf-r-status-ok' : 'npf-r-status-info');
    if (research.activeTags.size || research.excludedTags.size) {
      const includedTags = [...research.activeTags];
      const excludedTags = [...research.excludedTags];
      const tagOnly = all.filter(e => researchCategoryPassesFilters(e.categories)).length;
      const additional = [];
      if (splitResearchWords(research.includeText).length || splitResearchWords(research.excludeText).length) additional.push('キーワード');
      if (research.collaboratorIncluded.size || research.collaboratorExcluded.size) additional.push('個別コラボ相手');
      if (research.collaboratorGroupIncluded.size || research.collaboratorGroupExcluded.size) additional.push('所属');
      addRow('分類', [includedTags.length ? `✓ ${includedTags.join('・')}` : '', excludedTags.length ? `− ${excludedTags.join('・')}` : ''].filter(Boolean).join(' / '),
        `分類だけなら ${tagOnly}/${total}本・実際の表示 ${visible}本${additional.length ? `（ほかに${additional.join('・')}の条件も適用中）` : ''}${!tagOnly ? '。動画に分類が付いているか確認してください' : ''}`, 'npf-r-status-info');
    }


    let holodexDetail = '';
    if (research.holodexPaused) holodexDetail = cooldownSec > 0
      ? `429で自動取得停止・あと約${cooldownSec}秒（手動再試行）`
      : '429で自動取得停止・再解析・再取得で手動再試行';
    else {
      const bits = [];
      if (metaPending) bits.push(`取得中/待ち ${metaPending}`);
      if (metaFailed) bits.push(`失敗 ${metaFailed}`);
      if (metaRemaining) bits.push(`未着手 ${metaRemaining}`);
      holodexDetail = bits.join(' ・ ') || '取得完了';
    }
    const hCls = metaFailed ? 'npf-r-status-bad' : (research.holodexPaused || cooldownSec > 0 || metaPending ? 'npf-r-status-warn' : (enriched === total && total ? 'npf-r-status-ok' : 'npf-r-status-info'));
    addRow('Holodex', `成功 ${enriched}/${total}本`, holodexDetail, hCls, 'Holodexから日時・配信時間・ゲーム・mentions等の動画メタ情報を取得した件数です。');

    const wikiDetailBits = [`ID一致 ${wikiMatched}`, `ID未検出 ${wikiUnmatched}`];
    if (wikiPending) wikiDetailBits.push(`照合中 ${wikiPending}`);
    if (wikiErrors) wikiDetailBits.push(`取得エラー ${wikiErrors}`);
    if (wikiUpdateErrors) wikiDetailBits.push(`保存済み・更新エラー ${wikiUpdateErrors}`);
    const wikiCooldownSec = Math.ceil(wikiCooldownRemainingMs() / 1000);
    if (wikiRequestsPaused) wikiDetailBits.push(wikiCooldownSec
      ? `429で自動通信停止・あと約${wikiCooldownSec}秒（手動再試行）`
      : '429で自動通信停止・失敗分だけ手動再試行');
    if (wikiSkipped) wikiDetailBits.push(`対象外/判定不能 ${wikiSkipped}`);
    if (wikiWaiting) wikiDetailBits.push(`未照合 ${wikiWaiting}`);
    const wikiDone = wikiTarget > 0 && (wikiChecked + wikiErrors + wikiSkipped) >= wikiTarget && !wikiPending;
    const wikiCls = wikiErrors ? 'npf-r-status-warn' : (wikiDone ? 'npf-r-status-ok' : 'npf-r-status-info');
    const failedYearKeys = new Set(all.filter(e => e.wikiError && e.meta && wikiChannelNameForEntry(e, e.meta)).map(e => wikiCacheKey(wikiChannelNameForEntry(e, e.meta), wikiEntryYear(e, e.meta))));
    if (failedYearKeys.size) wikiDetailBits.push(`失敗年別セット ${failedYearKeys.size}件`);
    addRow('Wiki', `実照合 ${wikiChecked}/${wikiTarget || 0}本`, wikiDetailBits.join(' ・ '), wikiCls, 'ID一致はローカルDBのWiki動画ID照合を含みます。取得エラーの本数は失敗した年別ページに属する動画数です。');

    if (!state.apiKey) addRow('API', 'Holodex APIキー未設定', '日時・配信時間等は取得できません', 'npf-r-status-bad');

    if (research.collaboratorIncluded.size || research.collaboratorExcluded.size || research.collaboratorGroupIncluded.size || research.collaboratorGroupExcluded.size || research.collabHistoryLoading) {
      const included = research.collaboratorIncluded.size ? `コラボ対象 ${research.collaboratorIncluded.size}人（OR）` : '';
      const excluded = research.collaboratorExcluded.size ? `除外 ${research.collaboratorExcluded.size}人` : '';
      const groups = [...research.collaboratorGroupIncluded].map(g => RESEARCH_COLLAB_GROUPS[g]).join('・');
      const excludedGroups = [...research.collaboratorGroupExcluded].map(g => RESEARCH_COLLAB_GROUPS[g]).join('・');
      const hist = research.collaboratorFilter ?
        `${research.collaboratorFilter} の全期間 ${research.collabHistoryLoading ? '検索中…' : research.collabHistoryRows.length + '件'}` : '';
      addRow('絞り込み', [included, excluded, groups ? `所属 ${groups}` : '', excludedGroups ? `所属除外 ${excludedGroups}` : '', hist].filter(Boolean).join(' ・ '), '', 'npf-r-status-filter npf-r-status-info');
    }
  }


  // ---------- Wiki diagnosis: read-only, one channel x four years ----------
  // A card-level "Wiki取得エラー" can represent many cards sharing a single failed year dataset.
  const nrhWikiDiagState = { running: false, report: '' };

  function nrhWikiDiagGroups() {
    const groups = new Map();
    for (const e of currentResearchEntries()) {
      if (!e.meta) continue;
      const name = wikiChannelNameForEntry(e, e.meta);
      const year = wikiEntryYear(e, e.meta);
      if (!name || !year) continue;
      const key = wikiCacheKey(name, year);
      let g = groups.get(key);
      if (!g) {
        g = { name, year, count: 0, errors: 0, matches: 0, missing: 0, samples: [], ids: [] };
        groups.set(key, g);
      }
      g.count++;
      if (e.wikiError) g.errors++;
      if (e.wikiInfo) g.matches++;
      if (e.wikiChecked && !e.wikiInfo) g.missing++;
      if (g.samples.length < 3 && (e.wikiError || !e.wikiInfo)) g.samples.push(e.id);
      if (g.ids.length < 10) g.ids.push(e.id);
    }
    return [...groups.values()].sort((a,b) => b.errors-a.errors || b.count-a.count || b.year-a.year);
  }

  function nrhWikiDiagChannels() {
    const byName = new Map();
    for (const g of nrhWikiDiagGroups()) {
      const row = byName.get(g.name) || { name:g.name, count:0, errors:0 };
      row.count += g.count;
      row.errors += g.errors;
      byName.set(g.name, row);
    }
    return [...byName.values()].sort((a,b) => b.errors-a.errors || b.count-a.count);
  }

  function nrhWikiDiagFillOptions() {
    const select = $('#npf-r-wiki-diag-channel');
    const report = $('#npf-r-wiki-diag-report');
    if (!select || !report || nrhWikiDiagState.running) return;
    const old = select.value;
    const rows = nrhWikiDiagChannels();
    select.replaceChildren();
    for (const row of rows) {
      const opt = document.createElement('option');
      opt.value = row.name;
      opt.textContent = `${row.name}（エラー${row.errors} / 全${row.count}本）`;
      select.appendChild(opt);
    }
    if (rows.some(x => x.name === old)) select.value = old;
    if (!nrhWikiDiagState.report) {
      report.textContent = rows.length
        ? `動画ごとのエラーは、同じ年のWikiページの問題が複数本に波及している可能性があります。\n${rows.slice(0,8).map(x => `${x.name}: エラー${x.errors}本 / 全${x.count}本`).join('\n')}\n\n「このチャンネルの4年を診断」を押すまで追加通信しません。`
        : 'まずチャンネルの「ライブ」または「動画」一覧を開いてください。';
    }
  }

  function nrhWikiDiagHttpSummary(url, result) {
    if (result.error) return `通信失敗: ${result.error}`;
    const final = result.finalUrl && result.finalUrl !== url ? ` / 転送先 ${result.finalUrl}` : '';
    return `HTTP ${result.status} / ${result.bytes}文字${final}`;
  }

  async function nrhWikiDiagFetch(url) {
    try {
      if (wikiRequestsPaused) return { status: 0, text: '', bytes: 0, paused: true, error: 'Wiki 429自動停止中。診断の追加通信をしません' };
      const res = await gmRequest({ method:'GET', url, headers:{ 'Accept':'text/html,application/xhtml+xml' }, timeout:20000 });
      return {status:res.status, text:String(res.responseText || ''), bytes:String(res.responseText || '').length, finalUrl:String(res.finalUrl || '')};
    } catch (err) {
      return {status:0, text:'', bytes:0, error:String(err?.message || err || '通信エラー')};
    }
  }

  async function nrhWikiDiagPage(url, log, samples, readSource = true) {
    const response = await nrhWikiDiagFetch(url);
    let htmlIds = {}, srcIds = {}, sourceResult = '未取得', combined = {};
    log(`  ページ ${url.replace(WIKI_BASE + '/', '')}`);
    log(`    ${nrhWikiDiagHttpSummary(url, response)}`);
    if (response.status >= 200 && response.status < 300 && response.text) {
      try { htmlIds = wikiParsePage(response.text, url); }
      catch (err) { log(`    HTML解析例外: ${String(err?.message || err)}`); }
      log(`    HTML解析 ${Object.keys(htmlIds).length}動画ID`);
      if (readSource) {
        for (const sourceUrl of wikiSourceCommandUrls(url)) {
          const sr = await nrhWikiDiagFetch(sourceUrl);
          if (!(sr.status >= 200 && sr.status < 300)) {
            sourceResult = `source HTTP ${sr.status || sr.error}`;
            if (sr.status === 429) break;
            continue;
          }
          const source = wikiExtractSourceText(sr.text);
          if (!source) { sourceResult = 'source HTTP 200 / 本文抽出0文字'; continue; }
          try { srcIds = wikiParseSourceText(source, url); }
          catch (err) { sourceResult = `source解析例外: ${String(err?.message || err)}`; continue; }
          sourceResult = `source HTTP ${sr.status} / 本文${source.length}文字 / ${Object.keys(srcIds).length}動画ID`;
          if (Object.keys(srcIds).length) break;
        }
        log(`    ${sourceResult}`);
      }
      combined = wikiMergeEntries(htmlIds, srcIds);
      log(`    統合 ${Object.keys(combined).length}動画ID / 画面の確認例 ${samples.filter(id => combined[id]).length}/${samples.length}本`);
    }
    return { response, combined, htmlIds, srcIds, sourceResult };
  }

  async function nrhRunWikiDiagnosis() {
    if (nrhWikiDiagState.running) return;
    const select = $('#npf-r-wiki-diag-channel');
    const output = $('#npf-r-wiki-diag-report');
    const run = $('#npf-r-wiki-diag-run');
    const copy = $('#npf-r-wiki-diag-copy');
    const channel = select?.value || '';
    if (!channel || !output) return toast('先に調査するチャンネルを選んでください');
    nrhWikiDiagState.running = true;
    if (run) run.disabled = true;
    if (copy) copy.disabled = true;
    const lines = [];
    const log = text => { lines.push(String(text)); output.textContent = lines.join('\n'); nrhWikiDiagState.report = output.textContent; };
    const groups = nrhWikiDiagGroups();
    const thisGroups = groups.filter(g => g.name === channel);
    const byYear = new Map(thisGroups.map(g => [g.year, g]));
    const years = [...new Set(thisGroups.filter(g => g.count).map(g => g.year))].sort((a,b) => b-a);
    try {
      log(`Niji Research Helper v${VERSION} / Wiki原因診断`);
      log(`対象: ${channel} / 画面上 ${thisGroups.reduce((n,g)=>n+g.count,0)}本 / エラー ${thisGroups.reduce((n,g)=>n+g.errors,0)}本`);
      log('方式: 画面上に該当動画がある年だけ診断。正規ページのHTTP・HTML解析・Wikiソース解析を比較。');
      log('※ 診断中はDB・Wikiキャッシュ・Holodexを変更しません。APIキーも報告に含めません。');
      log('他のエラー集中先: ' + (groups.filter(g => g.errors).slice(0,10).map(g => `${g.name}/${g.year}:${g.errors}本`).join('、') || 'なし'));
      for (const year of years) {
        const g = byYear.get(year);
        const samples = g?.samples || [];
        const cache = state.wikiCache?.[wikiCacheKey(channel,year)];
        log(`\n【${year}年】 画面${g?.count || 0}本 / エラー${g?.errors || 0}本 / 一致${g?.matches || 0}本`);
        log(cache
          ? `  保存済みWikiセット: fetchOk=${String(cache.fetchOk)}、年別成功${cache.yearPageSuccess ?? '?'}、動画ID${Object.keys(cache.entries || {}).length}、取得${cache.fetchedAt ? new Date(cache.fetchedAt).toLocaleString('ja-JP') : '日時不明'}`
          : '  保存済みWikiセット: なし');
        if (cache?.errors?.length) log(`  保存されたエラー例: ${cache.errors.slice(0,2).join(' / ').slice(0,320)}`);
        const primaryUrl = wikiPageUrl(channel, [String(year)]);
        const primary = await nrhWikiDiagPage(primaryUrl, log, samples, true);
        const matched = samples.filter(id => primary.combined[id]).length;
        if (primary.response.paused || primary.response.status === 429 || primary.sourceResult === 'source HTTP 429') {
          log('  → Wiki側で429。追加アクセスを避けて診断を終了します。');
          break;
        }
        if (g?.count && (Object.keys(primary.combined).length === 0 || matched < samples.length)) {
          const secondaryUrl = wikiPageUrl(channel, [`ライブ配信${year}`]);
          const secondary = await nrhWikiDiagPage(secondaryUrl, log, samples, true);
          const union = wikiMergeEntries(primary.combined, secondary.combined);
          log(`  2形式合算: ${Object.keys(union).length}動画ID / 画面の確認例 ${samples.filter(id => union[id]).length}/${samples.length}本`);
          if (primary.response.status === 200 && !Object.keys(primary.combined).length && Object.keys(secondary.combined).length) log('  → 正規YYYYページの形式・URL候補が合っていない可能性');
          if (primary.response.status === 200 && Object.keys(primary.combined).length && !samples.some(id => union[id])) log('  → ページは読めるが対象動画IDがない: 年判定・別ページ掲載・パーサーを要確認');
        }
        if (primary.response.status === 200 && !Object.keys(primary.combined).length) log('  → HTTP成功でも抽出0件: 通信成功と解析成功は別問題');
        if (primary.response.status === 429) { log('  → Wiki側で429。ここで診断を終了します（連続アクセスを避けます）。'); break; }
        // 画面に動画がある年だけ。動画1本ごとのWikiアクセスは行わない。
      }
      log('\n診断終了。右の「レポートをコピー」でこの結果を共有できます。');
    } catch (err) {
      log(`\n診断処理エラー: ${String(err?.message || err)}`);
    } finally {
      nrhWikiDiagState.running = false;
      if (run) run.disabled = false;
      if (copy) copy.disabled = false;
    }
  }

  function nrhCreateWikiDiagnosisUi() {
    const details = document.createElement('details');
    details.id = 'npf-r-wiki-diagnostic';
    details.className = 'npf-r-wiki-diag';
    const summary = document.createElement('summary');
    summary.textContent = '🧪 Wiki取得エラーの原因を調べる';
    const intro = document.createElement('p');
    intro.textContent = '同じ投稿者×年の失敗をまとめ、動画がある年だけ診断します。429停止中は新たな通信を行いません。';
    const controls = document.createElement('div');
    controls.className = 'npf-r-wiki-diag-row';
    const select = document.createElement('select');
    select.id = 'npf-r-wiki-diag-channel';
    select.className = 'npf-r-wiki-diag-select';
    const run = document.createElement('button');
    run.id = 'npf-r-wiki-diag-run'; run.type = 'button'; run.className = 'npf-r-btn';
    run.textContent = '該当年だけ診断';
    run.addEventListener('click', () => void nrhRunWikiDiagnosis());
    const copy = document.createElement('button');
    copy.id = 'npf-r-wiki-diag-copy'; copy.type = 'button'; copy.className = 'npf-r-btn';
    copy.textContent = 'レポートをコピー';
    copy.addEventListener('click', () => {
      if (!nrhWikiDiagState.report) return toast('まず診断を実行してください');
      void copyText(nrhWikiDiagState.report).then(ok => toast(ok ? '📋 診断レポートをコピーしました' : 'コピーできませんでした'));
    });
    controls.append(select, run, copy);
    const report = document.createElement('pre');
    report.id = 'npf-r-wiki-diag-report';
    report.className = 'npf-r-wiki-diag-report';
    report.textContent = '開くと、エラーが集中する年とチャンネルを表示します。';
    details.append(summary, intro, controls, report);
    details.addEventListener('toggle', () => { if (details.open) nrhWikiDiagFillOptions(); });
    return details;
  }

  function closeResearchPanel() {
    $('#npf-research-panel')?.classList.remove('npf-open');
    $('#npf-research-fab')?.classList.remove('npf-open');
  }

  function ensureResearchUi() {
    let fab = $('#npf-research-fab');
    let panel = $('#npf-research-panel');
    if (fab && panel) return panel;

    fab = document.createElement('button');
    fab.id = 'npf-research-fab';
    fab.type = 'button';
    fab.textContent = '🔎 調査';
    fab.title = 'アーカイブ調査フィルター';
    (document.body || document.documentElement).appendChild(fab);

    panel = document.createElement('aside');
    panel.id = 'npf-research-panel';
    const head = document.createElement('div');
    head.className = 'npf-r-head';
    const title = document.createElement('div');
    title.className = 'npf-r-title';
    title.textContent = 'にじさんじ アーカイブ調査';
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'npf-r-close'; close.textContent = '✕'; close.title = '閉じる';
    head.append(title, close);
    panel.appendChild(head);

    const body = document.createElement('div');
    body.className = 'npf-r-body';
    const status = document.createElement('div');
    status.id = 'npf-r-status'; status.className = 'npf-r-status'; status.textContent = 'アーカイブを解析中…';
    body.appendChild(status);
    const collectionButton = document.createElement('button');
    collectionButton.id = 'npf-r-collection-toggle';
    collectionButton.type = 'button';
    collectionButton.className = 'npf-r-btn primary';
    collectionButton.style.cssText = 'display:block;width:100%;margin:8px 0 4px;padding:10px;font-weight:700;';
    collectionButton.addEventListener('click', () => {
      if (research.collectionActive) stopResearchCollection();
      else startResearchCollection();
    });
    const collectionHint = document.createElement('div');
    collectionHint.id = 'npf-r-collection-hint';
    collectionHint.className = 'npf-r-note';
    collectionHint.style.marginBottom = '10px';
    const auto = document.createElement('button');
    auto.id = 'npf-r-auto-channel-toggle'; auto.type = 'button'; auto.className = 'npf-r-btn';
    auto.style.cssText = 'display:none;width:100%;margin:6px 0;padding:10px;';
    auto.addEventListener('click', async () => {
      const key = researchChannelKey(); if (!key) return;
      if (research.autoChannelKeys.has(key)) research.autoChannelKeys.delete(key);
      else research.autoChannelKeys.add(key);
      state.settings.autoResearchChannels = [...research.autoChannelKeys];
      await gmSet(KEY_SETTINGS, state.settings);
      updateResearchCollectionControls();
      if (research.autoChannelKeys.has(key) && !research.collectionActive && !research.holodexPaused)
        startResearchCollection();
    });
    body.append(collectionButton, auto, collectionHint);

    // 旧UIの重複残骸があれば除去してからDB欄を1つだけ作る。
    $$('#npf-r-db-status').forEach(n => n.remove());
    const dbStatus = document.createElement('div');
    dbStatus.id = 'npf-r-db-status'; dbStatus.className = 'npf-r-db-status'; dbStatus.textContent = '💾 ローカルDBを確認中…';
    body.appendChild(dbStatus);
    const dbActions = document.createElement('div'); dbActions.className = 'npf-r-db-actions';
    const dbBackup = document.createElement('button'); dbBackup.type = 'button'; dbBackup.className = 'npf-r-btn'; dbBackup.textContent = '💾 DBバックアップ'; dbBackup.addEventListener('click', () => void backupResearchDb());
    const dbRestore = document.createElement('button'); dbRestore.type = 'button'; dbRestore.className = 'npf-r-btn'; dbRestore.textContent = '📥 DB復元';
    const dbFile = document.createElement('input'); dbFile.type = 'file'; dbFile.accept = 'application/json,.json'; dbFile.hidden = true;
    dbRestore.addEventListener('click', () => dbFile.click());
    dbFile.addEventListener('change', () => { const f = dbFile.files?.[0]; if (f) void restoreResearchDbFile(f); dbFile.value = ''; });
    const dbClear = document.createElement('button'); dbClear.id = 'npf-r-db-clear'; dbClear.type = 'button'; dbClear.className = 'npf-r-btn'; dbClear.textContent = '🗑 DB初期化'; dbClear.addEventListener('click', () => void clearResearchDb());
    dbActions.append(dbBackup, dbRestore, dbClear, dbFile); body.appendChild(dbActions);
    body.appendChild(createCloudBackupUi());
    void updateResearchDbStatus();
    body.appendChild(nrhCreateWikiDiagnosisUi());

    const collabControl = document.createElement('div');
    collabControl.className = 'npf-r-collab-control';
    const collabLabel = document.createElement('div');
    collabLabel.className = 'npf-r-label';
    collabLabel.textContent = 'コラボ相手で絞り込み';
    const collabRow = document.createElement('div');
    collabRow.className = 'npf-r-collab-row';
    const collabInput = document.createElement('input');
    collabInput.id = 'npf-r-collab-input';
    collabInput.className = 'npf-r-input npf-r-collab-input';
    collabInput.type = 'text';
    collabInput.placeholder = '名前を入力（例：伊波ライ）';
    collabInput.setAttribute('list', 'npf-r-collab-options');
    collabInput.autocomplete = 'off';
    collabInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); applyResearchCollaboratorInput(); }
      if (e.key === 'Escape') { collabInput.value = research.collaboratorFilter || ''; collabInput.blur(); }
    });
    const collabApply = document.createElement('button');
    collabApply.type = 'button';
    collabApply.className = 'npf-r-btn npf-r-collab-apply';
    collabApply.textContent = '絞り込む';
    collabApply.addEventListener('click', applyResearchCollaboratorInput);
    const collabOptions = document.createElement('datalist');
    collabOptions.id = 'npf-r-collab-options';
    const collabSuggestions = document.createElement('div');
    collabSuggestions.id = 'npf-r-collab-suggestions';
    collabSuggestions.className = 'npf-r-collab-suggestions';
    collabRow.append(collabInput, collabApply);
    const collabExclude = document.createElement('button');
    collabExclude.type = 'button'; collabExclude.className = 'npf-r-btn';
    collabExclude.textContent = '− 入力した相手を除外';
    collabExclude.style.cssText = 'margin-top:6px;';
    collabExclude.addEventListener('click', excludeResearchCollaboratorInput);
    const collabHint = document.createElement('div'); collabHint.className = 'npf-r-filter-hint';
    collabHint.textContent = '相手をタップ：紫 ✓ 絞り込み → 赤 − 除外 → 未選択。複数の絞り込みはOR、除外を優先。全期間履歴は最後に選んだ相手を検索します。';
    const collabSelected = document.createElement('div');
    collabSelected.id = 'npf-r-collab-selected'; collabSelected.className = 'npf-r-collab-suggestions';
    collabSelected.hidden = true;
    const groupLabel = document.createElement('div');
    groupLabel.className = 'npf-r-label';
    groupLabel.textContent = 'コラボ相手の所属で絞り込み';
    const groupHint = document.createElement('div');
    groupHint.className = 'npf-r-filter-hint';
    groupHint.id = 'npf-r-collab-group-hint';
    groupHint.textContent = '所属フィルターを選ぶとWikiの現所属者名簿を確認します。';
    const groupButtons = document.createElement('div');
    groupButtons.className = 'npf-r-collab-suggestions';
    for (const [group, label] of Object.entries(RESEARCH_COLLAB_GROUPS)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'npf-r-collab-quick npf-r-collab-group';
      b.dataset.collabGroup = group;
      b.textContent = `🤝 ${label}`;
      b.addEventListener('click', () => cycleResearchCollaboratorGroup(group));
      groupButtons.appendChild(b);
    }
    collabControl.append(collabLabel, collabHint, collabRow, collabExclude, collabOptions, collabSuggestions, collabSelected, groupLabel, groupHint, groupButtons);
    body.appendChild(collabControl);

    const activeCollab = document.createElement('button');
    activeCollab.id = 'npf-r-collab-active';
    activeCollab.type = 'button';
    activeCollab.className = 'npf-r-active-collab';
    activeCollab.hidden = true;
    activeCollab.addEventListener('click', () =>
      removeResearchCollaboratorSelection(normalizeCollaboratorName(research.collaboratorFilter)));
    body.appendChild(activeCollab);
    const collabHistory = document.createElement('div');
    collabHistory.id = 'npf-r-collab-history';
    collabHistory.className = 'npf-r-collab-history';
    body.appendChild(collabHistory);
    updateResearchCollaboratorFilterUi();
    renderResearchCollaboratorHistory();

    const label1 = document.createElement('div'); label1.className = 'npf-r-label'; label1.textContent = '分類で絞り込み（複数の絞り込みはOR・除外は優先）'; body.appendChild(label1);
    const tagHint = document.createElement('div'); tagHint.className = 'npf-r-filter-hint';
    tagHint.textContent = 'タップ：紫 ✓ 絞り込み → 赤 − 除外 → 未選択'; body.appendChild(tagHint);
    const tags = document.createElement('div'); tags.className = 'npf-r-tags';
    for (const tag of RESEARCH_TAGS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'npf-r-filter'; b.dataset.tag = tag;
      refreshResearchCategoryButton(b);
      b.addEventListener('click', () => {
        cycleResearchCategory(tag);
        refreshResearchCategoryButton(b);
        applyResearchFilters();
      });
      tags.appendChild(b);
    }
    body.appendChild(tags);

    // Local game filter: Holodex/Wiki metadata already acquired for these cards.
    const gameLabel=document.createElement('div');gameLabel.className='npf-r-label';
    gameLabel.textContent='ゲームタイトルで絞り込み（複数選択はOR）';body.append(gameLabel);
    const gameHint=document.createElement('div');gameHint.id='npf-r-game-hint';
    gameHint.className='npf-r-filter-hint';body.append(gameHint);
    const gameRow=document.createElement('div');gameRow.className='npf-r-collab-row';
    const gameInput=document.createElement('input');gameInput.id='npf-r-game-input';
    gameInput.className='npf-r-input npf-r-collab-input';gameInput.type='text';
    gameInput.placeholder='ゲーム名（例：VALORANT）';gameInput.autocomplete='off';
    const addGame=()=>{const name=gameInput.value.trim();if(name)cycleResearchGame(name);gameInput.value='';};
    gameInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addGame();}});
    const gameApply=document.createElement('button');gameApply.type='button';
    gameApply.className='npf-r-btn npf-r-collab-apply';gameApply.textContent='追加';
    gameApply.addEventListener('click',addGame);gameRow.append(gameInput,gameApply);
    body.append(gameRow);
    const gameSuggestions=document.createElement('div');gameSuggestions.id='npf-r-game-suggestions';
    gameSuggestions.className='npf-r-collab-suggestions';body.append(gameSuggestions);
    updateResearchGameSuggestions();

    const include = document.createElement('input');
    include.id = 'npf-r-include'; include.className = 'npf-r-input'; include.type = 'text'; include.placeholder = '含むキーワード（例：VALO）';
    include.addEventListener('input', () => { research.includeText = include.value; applyResearchFilters(); });
    body.appendChild(include);
    const exclude = document.createElement('input');
    exclude.id = 'npf-r-exclude'; exclude.className = 'npf-r-input'; exclude.type = 'text'; exclude.placeholder = '除外キーワード（例：VALO, APEX）';
    exclude.addEventListener('input', () => { research.excludeText = exclude.value; applyResearchFilters(); });
    body.appendChild(exclude);

    const actions = document.createElement('div'); actions.className = 'npf-r-actions';
    const csv = document.createElement('button'); csv.type = 'button'; csv.className = 'npf-r-btn primary'; csv.textContent = '📋 表示中をCSVコピー';
    csv.addEventListener('click', () => void copyResearchCsv());
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'npf-r-btn'; reset.textContent = 'リセット';
    reset.addEventListener('click', () => {
      research.activeTags.clear(); research.excludedTags.clear(); research.gameIncluded.clear(); research.gameExcluded.clear(); research.includeText = ''; research.excludeText = ''; research.collaboratorFilter = '';
      research.collaboratorIncluded.clear(); research.collaboratorExcluded.clear();
      research.collaboratorGroupIncluded.clear(); research.collaboratorGroupExcluded.clear();
      research.collaboratorChannel = ''; research.collabHistoryToken++; research.collabHistoryRows = []; research.collabHistoryYears = []; research.collabHistoryYearStats = {}; research.collabHistoryHolodexCount = 0; research.collabHistoryWikiCount = 0; research.collabHistoryResolveNote = ''; research.collabHistoryLoading = false;
      include.value = ''; exclude.value = ''; const gameInputNow=$('#npf-r-game-input'); if(gameInputNow) gameInputNow.value='';
      const collabInputNow = $('#npf-r-collab-input'); if (collabInputNow) collabInputNow.value = '';
      $$('.npf-r-filter', panel).forEach(refreshResearchCategoryButton);
      updateResearchCollaboratorFilterUi();
      renderResearchCollaboratorHistory();
      applyResearchFilters();
    });
    const rescan = document.createElement('button'); rescan.type = 'button'; rescan.className = 'npf-r-btn'; rescan.textContent = '再解析・再取得';
    rescan.title = '表示中カードを再解析し、Holodex未取得の動画は試行回数をリセットして再取得';
    rescan.id = 'npf-r-rescan';
    rescan.addEventListener('click', () => {
      // 明示的な「再取得」操作は、手動モードでも取得開始の意思表示と扱う。
      research.collectionActive = true;
      updateResearchCollectionControls();
      scanYoutubeResearchCards();
      if (research.holodexPaused && holodexCooldownRemainingMs() > 0) {
        retryMissingResearchMeta(); // 待機中は連打しても通信せず、残り時間だけ案内。
        return;
      }
      const count = retryMissingResearchMeta();
      toast(count ? `表示中を再解析し、Holodex未取得 ${count}件を再取得します` : '表示中を再解析しました（Holodex未取得なし）');
    });
    const wikiRetry = document.createElement('button'); wikiRetry.type = 'button'; wikiRetry.className = 'npf-r-btn'; wikiRetry.textContent = '↻ Wiki失敗分だけ再試行';
    wikiRetry.title = '取得エラーになった年別データだけ再取得。成功済みWikiとDBは維持します';
    wikiRetry.addEventListener('click', retryFailedResearchWiki);
    const wikiRefresh = document.createElement('button'); wikiRefresh.type = 'button'; wikiRefresh.className = 'npf-r-btn'; wikiRefresh.textContent = 'Wiki全件再照合';
    wikiRefresh.title = '手動で成功済みを含むWiki年別データを更新します。通常は押す必要はありません';
    wikiRefresh.addEventListener('click', () => void refreshResearchWiki());
    actions.append(csv, reset, rescan, wikiRetry, wikiRefresh); body.appendChild(actions);
    const note = document.createElement('div'); note.className = 'npf-r-note';
    note.textContent = 'アーカイブ一覧の外部取得は手動開始です。Wiki照合は保存済み動画IDと投稿者名を優先。既存のDBは維持し、429時は取得を停止します。';
    body.appendChild(note);
    panel.appendChild(body);
    (document.body || document.documentElement).appendChild(panel);
    updateResearchCollectionControls();

    fab.addEventListener('click', () => {
      const open = !panel.classList.contains('npf-open');
      panel.classList.toggle('npf-open', open); fab.classList.toggle('npf-open', open);
      if (open) { scanYoutubeResearchCards(); updateResearchStatus(); void updateResearchDbStatus(); }
    });
    close.addEventListener('click', () => { if (isMobileYoutubeUi()) closeYoutubePanel(); else closeResearchPanel(); });
    return panel;
  }

  function handleResearchNavigation() {
    const active = isYoutubeResearchPage();
    const route = `${location.origin}${location.pathname}${location.search}`;
    if (research.collectionRoute && research.collectionRoute !== route) stopResearchCollection();
    research.collectionRoute = route;
    ensureResearchUi();
    const fab = $('#npf-research-fab');
    const panel = $('#npf-research-panel');
    if (fab) fab.style.display = isMobileYoutubeUi() ? 'none' : active ? '' : 'none';
    if (isMobileYoutubeUi()) mobileResearchPageHint();
    if (!active && panel && !isMobileYoutubeUi()) closeResearchPanel();
    if (active) {
      scheduleResearchScan(250);
      const key = researchChannelKey();
      if (key && research.autoChannelKeys.has(key) && !research.collectionActive && !research.holodexPaused)
        startResearchCollection();
    }
  }

  function startYoutubeResearch() {
    ensureResearchUi();
    handleResearchNavigation();
    if (!research.observer) {
      research.observer = new MutationObserver(mutations => {
        if (!isYoutubeResearchPage()) return;
        if (!isMobileYoutubeUi()) { scheduleResearchScan(120); return; }
        // Only genuine newly mounted cards trigger a mobile scan. The panel and
        // annotation bars mutate during status updates, so watching them loops.
        const selector = 'ytm-video-with-context-renderer, ytm-rich-item-renderer, ytm-compact-video-renderer, ytm-video-renderer, yt-lockup-view-model, ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer';
        const addedCards = mutations.some(m => {
          if (m.target?.closest?.('#npf-yt-panel, .npf-research-meta')) return false;
          return [...m.addedNodes].some(node => node.nodeType === 1 &&
            (node.matches?.(selector) || node.querySelector?.(selector)));
        });
        if (addedCards) scheduleResearchScan(160);
      });
      research.observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    document.addEventListener('yt-navigate-finish', () => setTimeout(handleResearchNavigation, 180), true);
    window.addEventListener('popstate', () => setTimeout(handleResearchNavigation, 180), true);
  }

  function handleYoutubeNavigation() {
    if (!isYoutubeHost()) return;
    const id = currentYoutubeVideoId() || '';
    if (id !== youtubeLastVideoId) {
      youtubeLastVideoId = id;
      closeYoutubePanel();
    }
    setTimeout(() => {
      createShell();
      ensureYoutubePanel();
      syncYoutubePanelVisibility();
      updateYoutubePanel();
    }, 180);
  }

  function startYoutubeHelper() {
    try {
      createShell();
      ensureYoutubePanel();
      handleYoutubeNavigation();
      // Only one NIJI entry point on mobile. Research mounts as a tab inside it;
      // failures in archive initialization must not take down the proven mobile FAB.
      try {
        startYoutubeResearch();
        if (isMobileYoutubeUi()) ensureMobileYoutubeResearchTab();
      } catch (error) {
        console.warn('[NRH] archive research initialization failed', error);
      }

      document.addEventListener('yt-navigate-finish', handleYoutubeNavigation, true);
      window.addEventListener('popstate', handleYoutubeNavigation, true);

      clearInterval(youtubeTimer);
      youtubeTimer = setInterval(() => {
        // Mobile YouTube can replace body content during navigation: reattach only if removed.
        if (isMobileYoutubeUi() && (!$('#npf-fab') || !$('#npf-yt-panel'))) {
          createShell();
          ensureYoutubePanel();
        }
        const id = currentYoutubeVideoId() || '';
        if (id !== youtubeLastVideoId) handleYoutubeNavigation();
        if (isMobileYoutubeUi()) {
          const route = `${location.origin}${location.pathname}${location.search}`;
          if (route !== research.collectionRoute) handleResearchNavigation();
        }
        syncYoutubePanelVisibility();
        updateYoutubePanel();
        if (research.holodexPaused || wikiRequestsPaused) updateResearchCooldownDisplay();
      }, 1000);
      ytBootBadge?.remove();
    } catch (err) {
      if (ytBootBadge) ytBootBadge.textContent = `NIJI 起動エラー: ${String(err?.message || err).slice(0, 110)}`;
      console.error('[NPF][YouTube boot]', err);
      const box = document.createElement('div');
      box.textContent = `Niji Helper 起動エラー: ${err?.message || err}`;
      box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#a4001f;color:#fff;padding:8px 10px;border-radius:8px;font:12px monospace;max-width:420px;';
      (document.body || document.documentElement).appendChild(box);
    }
  }

  // ---------- boot ----------
  // スマホYouTube: GM.getValue (7回) / IndexedDB の応答を待つより先にボタンを起動。
  // 実機でここが待ち状態になると従来は「読み込み中」もボタンも出なくなりえた。
  // 起動したパネルは、保存済み設定の読込後に再描画する。
  const mobileYoutubeBoot = isMobileYoutubeUi();
  if (mobileYoutubeBoot) startYoutubeHelper();

  state.apiKey = await gmGet(KEY_API, '');
  state.favorites = await gmGet(KEY_FAVS, []);
  state.liverFavorites = await gmGet(KEY_LIVER_FAVS, []);
  state.settings = { ...DEFAULT_SETTINGS, ...(await gmGet(KEY_SETTINGS, DEFAULT_SETTINGS)) };
  research.autoChannelKeys = new Set(Array.isArray(state.settings.autoResearchChannels)
    ? state.settings.autoResearchChannels.filter(x => typeof x === 'string') : []);
  state.syncPoints = await gmGet(KEY_SYNC, {});
  state.calibration = await gmGet(KEY_CAL, {});
  state.wikiCache = await gmGet(KEY_WIKI_CACHE, {});
  if (isYoutubeHost()) void cloudInitialize().catch(err => console.warn('[NRH][cloud init]', err));

  if (!Array.isArray(state.favorites)) state.favorites = [];
  if (!Array.isArray(state.liverFavorites)) state.liverFavorites = [];
  if (!state.syncPoints || typeof state.syncPoints !== 'object' || Array.isArray(state.syncPoints)) state.syncPoints = {};
  if (!state.calibration || typeof state.calibration !== 'object' || Array.isArray(state.calibration)) state.calibration = {};
  if (!state.wikiCache || typeof state.wikiCache !== 'object' || Array.isArray(state.wikiCache)) state.wikiCache = {};

  if (isYoutubeHost()) {
    if (mobileYoutubeBoot) {
      // UIは起動済み。www.youtube.com のiPhoneでDB初期化待ちを起こさない。
      // IndexedDB のデータ・ストアは変更せず、必要な機能から既存DBへアクセスする。
      createShell();
      ensureYoutubePanel();
      updateYoutubePanel();
      if (isMobileYoutubeUi()) { void updateResearchDbStatus(); updateResearchStatus(); }
      handleResearchNavigation(); // Preferences loaded; enable opted-in channel.
    } else {
      await initResearchDb();
      startYoutubeHelper();
    }
  } else {
    createShell();
    bindCommentTimestamps();
    injectChannelFavorites();
    injectLiverFavorites();
    startObserver();
  }

  console.info(`[Niji Research Helper] v${VERSION} ready on ${location.hostname}`);
})();

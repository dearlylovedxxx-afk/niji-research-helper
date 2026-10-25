// ==UserScript==
// @name         YouTube ライブ待機所・開始時だけ自動復旧
// @namespace    local.youtube.live-waiting-recovery
// @version      1.0.1
// @description  待機所で配信開始を確認したのに映像が始まらない場合のみ、回数制限付きでページを更新します。通常の動画・再生中のライブには干渉しません。
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/youtube_live_waiting_room_fix.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/youtube_live_waiting_room_fix.user.js
// ==/UserScript==

(() => {
  'use strict';

  // 配信開始状況を確認する間隔。待機所と判定できたタブでだけ問い合わせます。
  const POLL_MS = 15000;
  const CONFIRMATIONS = 2; // 配信中の応答が連続2回あった場合のみ復旧
  const MAX_RELOADS = 2;   // 同じタブ・同じ配信の自動更新上限
  const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
  const PREFIX = 'yt-live-wait-fix:';

  let videoId = '';
  let epoch = 0;
  let monitoring = false;
  let timer = null;
  let setupTimer = null;
  let inFlight = false;
  let confirmations = 0;
  let sawPlayback = false;

  function currentId() {
    if (location.pathname !== '/watch') return '';
    return new URLSearchParams(location.search).get('v') || '';
  }

  function isPlayingOrAlreadyLoaded() {
    const v = document.querySelector('video.html5-main-video');
    if (!v) return false;
    // 実映像/広告が既に再生された場合、以後の自動更新は行いません。
    return v.readyState >= 2 && (v.currentTime > 0.5 || (!v.paused && !v.ended));
  }

  function pagePlayerResponse(id) {
    const ytPlayer = document.querySelector('ytd-player');
    const watch = document.querySelector('ytd-watch-flexy');
    const candidates = [
      ytPlayer?.playerResponse,
      ytPlayer?.playerData?.playerResponse,
      watch?.data?.playerResponse,
      window.ytInitialPlayerResponse
    ];
    // YouTube は画面遷移時にグローバル変数を使い回すことがあるため ID を検証。
    return candidates.find((p) => p?.videoDetails?.videoId === id) || null;
  }

  function ended(p) {
    return !!p?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.endTimestamp;
  }

  function isUpcoming(p) {
    if (!p || ended(p)) return false;
    return p.videoDetails?.isUpcoming === true ||
      p.playabilityStatus?.status === 'LIVE_STREAM_OFFLINE' ||
      !!p.playabilityStatus?.liveStreamability?.liveStreamabilityRenderer?.offlineSlate;
  }

  function isLiveNow(p) {
    if (!p || ended(p)) return false;
    return p.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow === true ||
      p.videoDetails?.isLive === true;
  }

  function reloadBudget(id) {
    try {
      const raw = sessionStorage.getItem(PREFIX + id);
      const data = raw ? JSON.parse(raw) : null;
      if (data && Date.now() - data.at < RESET_AFTER_MS) return data;
    } catch (_) { /* ストレージが使えない場合も監視自体は可能 */ }
    return { count: 0, at: Date.now() };
  }

  function recordReload(id) {
    const data = reloadBudget(id);
    data.count += 1;
    try { sessionStorage.setItem(PREFIX + id, JSON.stringify(data)); } catch (_) { /* noop */ }
  }

  function getCookie(name) {
    const item = document.cookie.split('; ').find((part) => part.startsWith(name + '='));
    return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
  }

  async function authHeaders() {
    // YouTube 本体の認証済み API 呼び出しと同様、必要な場合は同一サイト宛の認証ヘッダーを付けます。
    const headers = { 'Content-Type': 'application/json' };
    const t = Math.floor(Date.now() / 1000);
    const origin = location.origin;
    const auth = [];
    for (const [cookie, scheme] of [
      ['SAPISID', 'SAPISIDHASH'],
      ['__Secure-1PAPISID', 'SAPISID1PHASH'],
      ['__Secure-3PAPISID', 'SAPISID3PHASH']
    ]) {
      const value = getCookie(cookie);
      if (!value || !crypto?.subtle) continue;
      const data = new TextEncoder().encode(`${t} ${value} ${origin}`);
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
      const hash = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      auth.push(`${scheme} ${t}_${hash}`);
    }
    if (auth.length) {
      headers.Authorization = auth.join(' ');
      headers['X-Origin'] = origin;
    }
    return headers;
  }

  async function freshPlayerResponse(id) {
    const cfg = window.ytcfg;
    if (typeof cfg?.get !== 'function') return null;
    const key = cfg.get('INNERTUBE_API_KEY');
    const context = cfg.get('INNERTUBE_CONTEXT');
    if (!key || !context) return null;
    const headers = await authHeaders();
    const clientName = cfg.get('INNERTUBE_CLIENT_NAME');
    const clientVersion = cfg.get('INNERTUBE_CLIENT_VERSION');
    const visitorId = cfg.get('VISITOR_DATA');
    if (clientName != null) headers['X-Youtube-Client-Name'] = String(clientName);
    if (clientVersion) headers['X-Youtube-Client-Version'] = String(clientVersion);
    if (visitorId) headers['X-Goog-Visitor-Id'] = visitorId;

    const res = await fetch(`/youtubei/v1/player?prettyPrint=false&key=${encodeURIComponent(key)}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: JSON.stringify({ context, videoId: id })
    });
    if (!res.ok) return null;
    const data = await res.json();
    // 正常な ID を確認できる応答だけを使います。
    if (data?.videoDetails?.videoId && data.videoDetails.videoId !== id) return null;
    return data;
  }

  function stop() {
    monitoring = false;
    confirmations = 0;
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function checkLive(myEpoch) {
    if (!monitoring || inFlight || myEpoch !== epoch || currentId() !== videoId) return;
    if (isPlayingOrAlreadyLoaded()) {
      sawPlayback = true;
      stop();
      return;
    }
    if (sawPlayback || reloadBudget(videoId).count >= MAX_RELOADS) {
      stop();
      return;
    }
    inFlight = true;
    try {
      const id = videoId;
      const state = await freshPlayerResponse(id);
      if (myEpoch !== epoch || !monitoring || id !== currentId()) return;
      if (!state) { confirmations = 0; return; }
      if (isLiveNow(state)) {
        confirmations += 1;
        if (confirmations >= CONFIRMATIONS && !isPlayingOrAlreadyLoaded()) {
          recordReload(id);
          stop();
          console.info('[YouTube 待機所復旧] 配信開始を確認。待機画面のため再読み込みします。');
          location.reload();
        }
      } else {
        confirmations = 0;
        if (ended(state)) stop();
      }
    } catch (e) {
      confirmations = 0; // 通信失敗では勝手に更新しない
      console.debug('[YouTube 待機所復旧] 状況確認に失敗。次回再試行します。', e);
    } finally {
      inFlight = false;
    }
  }

  function startMonitor(myEpoch) {
    if (myEpoch !== epoch || monitoring || currentId() !== videoId) return;
    if (isPlayingOrAlreadyLoaded() || reloadBudget(videoId).count >= MAX_RELOADS) return;
    monitoring = true;
    timer = setInterval(() => void checkLive(myEpoch), POLL_MS);
    void checkLive(myEpoch);
  }

  async function setup(myEpoch) {
    const id = videoId;
    if (!id || myEpoch !== epoch || monitoring) return;
    if (isPlayingOrAlreadyLoaded()) { sawPlayback = true; return; }
    const local = pagePlayerResponse(id);
    if (isUpcoming(local)) { startMonitor(myEpoch); return; }
    if (local) return; // 通常動画や既に配信中のページは監視対象外
    // YouTube の画面内遷移で初期応答を取得できなかった場合のみ、1回問い合わせて判定。
    try {
      const remote = await freshPlayerResponse(id);
      if (myEpoch === epoch && id === currentId() && isUpcoming(remote)) startMonitor(myEpoch);
    } catch (_) { /* 次回のセットアップで再試行 */ }
  }

  function onNavigate() {
    const id = currentId();
    if (id !== videoId) {
      stop();
      if (setupTimer) clearTimeout(setupTimer);
      videoId = id;
      epoch++;
      sawPlayback = false;
      inFlight = false;
    }
    if (!id || monitoring || sawPlayback) return;
    const myEpoch = epoch;
    if (setupTimer) clearTimeout(setupTimer);
    setupTimer = setTimeout(() => void setup(myEpoch), 1200);
  }

  document.addEventListener('yt-navigate-finish', onNavigate);
  document.addEventListener('yt-page-data-updated', onNavigate);
  window.addEventListener('popstate', onNavigate);
  onNavigate();
})();

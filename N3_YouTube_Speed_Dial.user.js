// ==UserScript==
// @name         N3 YouTube Speed Dial (active tab only)
// @namespace    local.n3.m60
// @version      1.3.1
// @description  N3 speed dial for HTML5 video/YouTube/NicoVideo plus NicoLive comment toggle and seek/playback shortcuts.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/N3_YouTube_Speed_Dial.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/N3_YouTube_Speed_Dial.user.js
// ==/UserScript==
(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // NicoVideo player-state synchronization (only www.nicovideo.jp/watch/)
  //
  // Adapted from "Nicovideo speed limit unlocker" v1.1 by Eluentyw
  // https://greasyfork.org/scripts/572657-nicovideo-speed-limit-unlocker
  // Original author declares MIT License. Copyright remains with Eluentyw.
  //
  // MIT License permission notice:
  // Permission is hereby granted, free of charge, to any person obtaining
  // a copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to
  // permit persons to whom the Software is furnished to do so, subject to
  // the following conditions:
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  // IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  // CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  // TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  // SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
  // ---------------------------------------------------------------------
  if (location.hostname === 'www.nicovideo.jp' &&
      location.pathname.startsWith('/watch/')) {
    const capturedControllers = new WeakSet();
    const originalDefineProperty = Object.defineProperty;

    function captureController(controller, method, periodic) {
      if (!controller || typeof controller !== 'object' ||
          typeof method !== 'function' || capturedControllers.has(controller)) return;
      capturedControllers.add(controller);
      let syncing = false;
      const sync = () => {
        if (syncing) return;
        const video = document.querySelector('video');
        if (!video || !Number.isFinite(video.playbackRate)) return;
        if (Math.abs(controller.playbackRate - video.playbackRate) <= 0.001) return;
        syncing = true;
        try { method.call(controller, video.playbackRate); }
        catch (_) { /* Player may not yet be initialized. */ }
        finally { syncing = false; }
      };
      window.addEventListener('ratechange', sync, true);
      if (periodic) setInterval(sync, 1000);
    }

    // Capture the playback-rate state method when NicoVideo defines it.
    Object.defineProperty = function(obj, prop, descriptor) {
      if (prop === 'setPlaybackRate' && descriptor &&
          typeof descriptor.value === 'function') {
        captureController(obj, descriptor.value, true);
      }
      return Reflect.apply(originalDefineProperty, this, arguments);
    };

    // Also cover direct assignments, used by some versions of the player.
    const priorDescriptor =
      Object.getOwnPropertyDescriptor(Object.prototype, 'setPlaybackRate');
    if (!priorDescriptor || priorDescriptor.configurable) {
      originalDefineProperty(Object.prototype, 'setPlaybackRate', {
        configurable: true,
        set: function(fn) {
          if (typeof fn === 'function' && this.contents) {
            captureController(this, fn, false);
          }
          this.__setPlaybackRate = fn;
        },
        get: function() { return this.__setPlaybackRate; }
      });
    }
  }


  // Only a focused browser tab (or focused embedded player frame) receives N3 keys.
  // Runs on all HTTP(S) pages to support ordinary HTML5 video sites. It does not
  // request resources, send data, or read site contents outside <video> elements.
  const SPEEDS = [1, 1.25, 1.5, 2, 4];
  const VIDEO_REVERT_CHECK_MS = 700;
  const isNicoVideo = /(^|\.)nicovideo\.jp$/i.test(location.hostname) &&
    !/^live\./i.test(location.hostname);
  const isNicoLive = /^live\.nicovideo\.jp$/i.test(location.hostname);
  const isKnownSite = /(^|\.)(youtube\.com|nicovideo\.jp)$/i.test(location.hostname);

  let toast = null;
  let toastTimer = 0;
  let lastSpeedChange = 0;

  function visibleArea(el) {
    try {
      const rect = el.getBoundingClientRect();
      const area = Math.min(Math.max(rect.right, 0), innerWidth) -
        Math.max(rect.left, 0);
      const height = Math.min(Math.max(rect.bottom, 0), innerHeight) -
        Math.max(rect.top, 0);
      return Math.max(0, area) * Math.max(0, height);
    } catch {
      return 0;
    }
  }

  function findVideo() {
    // On most supported sites the actual HTML5 video element is in this document.
    // If an embed lives in its own frame, that frame receives F13/F14 when focused.
    const all = Array.from(document.querySelectorAll('video'))
      .filter(v => v.isConnected && v.getBoundingClientRect().width > 45);
    if (!all.length) return null;
    const full = document.fullscreenElement;
    const scoped = full ? all.filter(v => full.contains(v) || full === v) : [];
    const videos = scoped.length ? scoped : all;
    videos.sort((a, b) => {
      const score = v => (v.paused || v.ended ? 0 : 1e8) +
        visibleArea(v) + (v.readyState > 0 ? 1e7 : 0);
      return score(b) - score(a);
    });
    return videos[0];
  }

  function display(message) {
    if (toast) toast.remove();
    const host = document.fullscreenElement || document.body || document.documentElement;
    toast = document.createElement('div');
    toast.textContent = '⏩ ' + message;
    toast.setAttribute('role', 'status');
    toast.style.cssText =
      'position:fixed;top:7vh;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;background:#232832;color:#fff;' +
      'border:1px solid #3a414e;padding:12px 24px;border-radius:9px;' +
      'font:600 18px "Segoe UI",sans-serif;box-shadow:0 5px 20px #0005;' +
      'pointer-events:none;white-space:nowrap;max-width:85vw;' +
      'overflow:hidden;text-overflow:ellipsis;';
    host.appendChild(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toast) toast.remove();
      toast = null;
    }, 1450);
  }

  function fmt(n) {
    return Number(n).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function nextSpeed(current, direction) {
    const eps = 0.005;
    if (direction > 0) {
      return SPEEDS.find(s => s > current + eps) ?? SPEEDS[SPEEDS.length - 1];
    }
    for (let i = SPEEDS.length - 1; i >= 0; i--) {
      if (SPEEDS[i] < current - eps) return SPEEDS[i];
    }
    return SPEEDS[0];
  }

  window.addEventListener('keydown', e => {
    if (!['F13', 'F14'].includes(e.key) || e.repeat) return;
    const video = findVideo();
    if (!video) {
      if (isKnownSite) display('動画プレイヤーが見つかりません');
      return;
    }

    // Preserve existing Windows/N3 bridge behavior: modifiers may be held
    // when it sends F13/F14. Do not filter Ctrl/Alt/Shift or focused inputs.
    e.preventDefault();
    e.stopImmediatePropagation();

    // F13: clockwise (faster), F14: counterclockwise (slower).
    const target = nextSpeed(video.playbackRate, e.key === 'F13' ? 1 : -1);
    const token = ++lastSpeedChange;
    try {
      video.playbackRate = target;
    } catch {
      display('このプレイヤーでは速度変更できません');
      return;
    }

    const applied = video.playbackRate;
    if (Math.abs(applied - target) > 0.01) {
      display('サイト側で速度が制限されています');
      return;
    }
    display(fmt(applied) + '倍速');

    // Some sites (especially Nicovideo) immediately overwrite playbackRate
    // from their internal state. Report it; do not force an endless tug of war.
    if (isNicoVideo || isNicoLive) {
      setTimeout(() => {
        if (token !== lastSpeedChange || !video.isConnected) return;
        if (Math.abs(video.playbackRate - target) > 0.03) {
          display(isNicoVideo
            ? 'ニコニコ側が速度を戻しました'
            : 'ニコ生側が速度を戻しました');
        }
      }, VIDEO_REVERT_CHECK_MS);
    }
  }, true);
})();

// NicoLive comments and player shortcuts v1.3.0 (formerly standalone NicoLive_Comments_Toggle.user.js).
(() => {
  'use strict';
  // This module only runs on NicoLive watch pages; N3 still covers other video sites.
  if (location.hostname !== 'live.nicovideo.jp' || !/^\/watch\//.test(location.pathname)) return;

  // Each watch page starts with both the overlay and side panel hidden.
  // Deliberately do not save the current state: "show" is temporary.
  const ATTRIBUTE = 'data-nlc-comments';
  const STYLE_ID = 'nlc-comments-style';
  const BUTTON_ID = 'nlc-comments-toggle';
  const watchId = () => location.pathname.match(/^\/watch\/([^/]+)/)?.[1] ?? null;

  let currentWatchId = watchId();
  let commentsVisible = false;

  const root = document.documentElement;
  if (!root) return;
  root.setAttribute(ATTRIBUTE, 'hidden');

  const css = `
    /* CSS targets are deliberately limited to comment-related elements. */
    html[${ATTRIBUTE}="hidden"] #comment-layer-container,
    html[${ATTRIBUTE}="hidden"] [id^="comment-layer-container"],
    html[${ATTRIBUTE}="hidden"] [class*="___comment-layer___"],
    html[${ATTRIBUTE}="hidden"] [class*="___comment-renderer___"],
    html[${ATTRIBUTE}="hidden"] .comment-panel,
    html[${ATTRIBUTE}="hidden"] .ga-ns-comment-panel,
    html[${ATTRIBUTE}="hidden"] [class*="___player-status-panel___"] {
      display: none !important;
    }

    #${BUTTON_ID} {
      position: fixed !important;
      top: 76px !important;
      right: 18px !important;
      z-index: 2147483646 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      min-width: 130px !important;
      height: 35px !important;
      padding: 0 12px !important;
      border: 1px solid rgba(255,255,255,.2) !important;
      border-radius: 999px !important;
      background: rgba(35,39,47,.94) !important;
      color: #fff !important;
      box-shadow: 0 2px 9px rgba(0,0,0,.22) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      line-height: 1 !important;
      cursor: pointer !important;
      white-space: nowrap !important;
    }
    #${BUTTON_ID}:hover { background: rgba(55,62,75,.98) !important; }
    #${BUTTON_ID}:focus-visible {
      outline: 2px solid #6bb4ff !important;
      outline-offset: 3px !important;
    }
    #${BUTTON_ID}[data-visible="true"] {
      background: rgba(235,240,247,.96) !important;
      color: #23272f !important;
      border-color: rgba(0,0,0,.18) !important;
    }
  `;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function updateButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.dataset.visible = String(commentsVisible);
    button.textContent = commentsVisible ? '🙈 コメントを隠す' : '💬 コメントを表示';
    button.setAttribute('aria-label', commentsVisible
      ? '映像上のコメントとコメント欄を非表示にする'
      : '映像上のコメントとコメント欄を表示する');
    button.setAttribute('aria-pressed', String(commentsVisible));
  }

  function setCommentsVisible(visible) {
    commentsVisible = Boolean(visible);
    document.documentElement.setAttribute(ATTRIBUTE, commentsVisible ? 'visible' : 'hidden');
    updateButton();
  }

  function ensureButton() {
    if (!document.body || document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title = '映像コメント＋右のコメント欄をまとめて切り替え';
    button.addEventListener('click', () => setCommentsVisible(!commentsVisible));
    document.body.appendChild(button);
    updateButton();
  }

  function checkNavigation() {
    const nextWatchId = watchId();
    if (nextWatchId !== currentWatchId) {
      currentWatchId = nextWatchId;
      setCommentsVisible(false);
    }
  }

  // N3 dial / keyboard: Left/Right = -/+5s; J/L = -/+10s; K/Space = play/pause.
  // Do not intercept typing in chat/search fields or modified shortcuts.
  function isTyping(event) {
    const path = typeof event.composedPath === 'function'
      ? event.composedPath()
      : [event.target];
    return path.some((node) =>
      node instanceof Element &&
      Boolean(node.closest('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])'))
    );
  }

  function getPlayerVideo() {
    // Prefer the largest visible, initialized video over hidden previews.
    return [...document.querySelectorAll('video')]
      .filter((video) => video.readyState > 0 && video.getClientRects().length > 0)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  }

  function seekVideo(video, deltaSeconds) {
    const now = video.currentTime;
    if (!Number.isFinite(now)) return false;

    const target = now + deltaSeconds;
    const ranges = video.seekable;
    let next = null;

    if (ranges.length > 0) {
      // Stay inside the actual seekable ranges (important for timeshift streams).
      let nearestDistance = Infinity;
      for (let index = 0; index < ranges.length; index += 1) {
        const start = ranges.start(index);
        const end = ranges.end(index);
        const candidate = Math.max(start, Math.min(end, target));
        const distance = Math.abs(candidate - target);
        if (distance < nearestDistance) {
          next = candidate;
          nearestDistance = distance;
        }
      }
    } else if (Number.isFinite(video.duration) && video.duration > 0) {
      next = Math.max(0, Math.min(video.duration, target));
    }

    if (next === null || Math.abs(next - now) < 0.01) return false;
    try {
      video.currentTime = next;
      return true;
    } catch {
      return false;
    }
  }


  // NicoLive may restore playback after video.pause()/play(). Control
  // playback through the site's own button instead.
  const PLAYBACK_COOLDOWN_MS = 350;
  let lastToggleAt = -Infinity;

  function getPlaybackButton(video) {
    const wantPlay = video.paused;
    const expected = wantPlay
      ? /(?:^|[^一時停止])(?:再生(?:する|を再開)?|再開|play|resume)(?:$|[\s/・(（])/i
      : /(?:一時停止|pause|再生[／/・]一時停止)/i;
    const excludes = /(?:再生速度|自動再生|連続再生|プレイリスト|次の動画|おすすめ動画)/i;
    const candidates = document.querySelectorAll(
      'button, [role="button"], [class*="_play-button_"], [class*="_pause-button_"], ' +
      '[data-testid*="play"], [data-testid*="pause"]'
    );
    return [...candidates].find((button) => {
      if (button.id === BUTTON_ID || button.disabled ||
          button.getAttribute('aria-disabled') === 'true' ||
          !button.getClientRects().length) return false;
      const labels = [
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
        button.getAttribute('data-tooltip'),
        button.getAttribute('data-testid'),
        button.getAttribute('data-tip'),
        button.textContent?.trim(),
        button.className?.baseVal || button.className
      ].filter((value) => typeof value === 'string');
      return labels.some((value) => expected.test(value) && !excludes.test(value));
    }) || null;
  }

  function handlePlaybackShortcut(event) {
    if (!currentWatchId || event.isComposing ||
        event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    const isSpace = key === ' ' || key === 'spacebar' || event.code === 'Space';
    const isLeft = key === 'arrowleft' || event.code === 'ArrowLeft';
    const isRight = key === 'arrowright' || event.code === 'ArrowRight';
    if (key !== 'j' && key !== 'k' && key !== 'l' && !isSpace && !isLeft && !isRight) return;
    if (isTyping(event)) return;

    // Space and arrow keys may scroll the page if the player isn't ready.
    // Prevent browser scrolling even when no seekable video exists yet.
    if (isSpace || isLeft || isRight) event.preventDefault();

    const video = getPlayerVideo();
    if (!video) return;

    if (key === 'k' || isSpace) {
      const button = getPlaybackButton(video);
      if (!button) {
        // Unknown player layout: let NicoLive's own listeners handle the key,
        // while Space's browser-default page scrolling remains disabled.
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keyup' || event.repeat) return;
      const now = performance.now();
      if (now - lastToggleAt < PLAYBACK_COOLDOWN_MS) return;
      lastToggleAt = now;
      button.click();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'keyup') return;
    const deltaSeconds = isLeft ? -5 : isRight ? 5 : key === 'j' ? -10 : 10;
    seekVideo(video, deltaSeconds);
  }

  window.addEventListener('keydown', handlePlaybackShortcut, true);
  window.addEventListener('keyup', handlePlaybackShortcut, true);

  function maintain() {
    checkNavigation();
    ensureStyle();
    ensureButton();
  }

  ensureStyle();
  maintain();
  document.addEventListener('DOMContentLoaded', maintain, { once: true });
  window.addEventListener('pageshow', maintain);
  window.addEventListener('popstate', maintain);
  // Handles client-side navigation and DOM rebuilds without intercepting site APIs.
  setInterval(maintain, 1200);
})();

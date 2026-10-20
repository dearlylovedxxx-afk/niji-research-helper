// ==UserScript==
// @name         ニコ生 コメント初期非表示・ワンクリック切替
// @namespace    https://github.com/dearlylovedxxx-afk/niji-research-helper
// @version      1.2.1
// @description  ニコニコ生放送の映像コメントとコメント欄を初期非表示にし、右上のボタンで切り替え、J/Lで10秒送り・戻し、K/Spaceの再生・停止操作と、Spaceによるページスクロールを抑制します。
// @author       Marina
// @match        https://live.nicovideo.jp/watch/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/NicoLive_Comments_Toggle.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/NicoLive_Comments_Toggle.user.js
// ==/UserScript==

(() => {
  'use strict';

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

  // N3 dial / keyboard: J = -10s, K or Space = play/pause, L = +10s.
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
    if (key !== 'j' && key !== 'k' && key !== 'l' && !isSpace) return;
    if (isTyping(event)) return;

    // Space normally scrolls the webpage. Prevent that regardless of whether
    // the video or NicoLive's control buttons have finished mounting.
    if (isSpace) event.preventDefault();

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
    seekVideo(video, key === 'j' ? -10 : 10);
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

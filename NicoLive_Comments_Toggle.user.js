// ==UserScript==
// @name         ニコ生 コメント初期非表示・ワンクリック切替
// @namespace    https://github.com/dearlylovedxxx-afk/niji-research-helper
// @version      1.1.1
// @description  ニコニコ生放送の映像コメントとコメント欄を初期非表示にし、右上のボタンで切り替え、J/Lで10秒送り・戻し、K/Spaceで再生・一時停止できます。
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

  function handlePlaybackShortcut(event) {
    if (!currentWatchId || event.defaultPrevented || event.isComposing ||
        event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    const isSpace = key === ' ' || key === 'spacebar' || event.code === 'Space';
    if (key !== 'j' && key !== 'k' && key !== 'l' && !isSpace) return;
    if (isTyping(event)) return;

    // Leave Space available for focused links, buttons, sliders, and other UI controls.
    if (isSpace && event.target instanceof Element &&
        event.target.closest('button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="slider"], [role="menuitem"]')) return;

    const video = getPlayerVideo();
    if (!video) return;
    let handled = false;

    if (key === 'k' || isSpace) {
      if (event.repeat) return; // Prevent holding the key from toggling rapidly.
      try {
        if (video.paused) {
          const promise = video.play();
          if (promise && typeof promise.catch === 'function') promise.catch(() => {});
        } else {
          video.pause();
        }
        handled = true;
      } catch {
        handled = false;
      }
    } else {
      handled = seekVideo(video, key === 'j' ? -10 : 10);
    }

    if (!handled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  window.addEventListener('keydown', handlePlaybackShortcut, true);

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

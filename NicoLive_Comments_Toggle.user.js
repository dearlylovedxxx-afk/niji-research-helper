// ==UserScript==
// @name         ニコ生 コメント初期非表示・ワンクリック切替
// @namespace    https://github.com/dearlylovedxxx-afk/niji-research-helper
// @version      1.0.0
// @description  ニコニコ生放送の映像コメントとコメント欄を初期非表示にし、右上のボタンでまとめて切り替えます。
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

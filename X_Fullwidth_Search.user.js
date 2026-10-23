// ==UserScript==
// @name         X Full-width Timeline Search Box
// @name:ja      X 全幅タイムライン用 検索ボックス
// @namespace    local.x-ui-tweaks
// @version      1.0.1
// @description  Overlay a keyword search box without taking any layout space from the timeline.
// @description:ja X本体のレイアウトを変更せずに検索欄を固定表示します。Control Panel for Twitterの全幅表示と併用できます。
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/X_Fullwidth_Search.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/X_Fullwidth_Search.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;
  if (document.getElementById('cpft-independent-search-host')) return;

  // Avoid inserting UI into the site's <body> or changing any of X's layout CSS.
  // In particular, Control Panel for Twitter controls primaryColumn widths and
  // sidebar visibility itself; this script deliberately does not override them.
  const host = document.createElement('div');
  host.id = 'cpft-independent-search-host';
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('top', '0', 'important');
  host.style.setProperty('left', '0', 'important');
  host.style.setProperty('width', '0', 'important');
  host.style.setProperty('height', '0', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  host.style.setProperty('z-index', '2147483000', 'important');

  const root = host.attachShadow({mode: 'open'});
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .search {
      position: fixed;
      top: 10px;
      right: 18px;
      z-index: 1;
      width: min(290px, calc(100vw - 36px));
      height: 44px;
      padding: 0 9px 0 15px;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: auto;
      border: 1px solid #cfd9de;
      border-radius: 23px;
      background: #eff3f4;
      color: #536471;
      box-shadow: 0 2px 9px #0000001a;
      font: 14px/1.4 system-ui, -apple-system, sans-serif;
    }
    .search[hidden] { display: none !important; }
    .search:focus-within { border-color: #1d9bf0; background: #fff; }
    input {
      flex: 1;
      width: 0;
      min-width: 0;
      padding: 8px 0;
      border: none;
      outline: none;
      background: none;
      color: #0f1419;
      font: inherit;
    }
    input::placeholder { color: #536471; opacity: 1; }
    button {
      display: grid;
      place-items: center;
      flex: none;
      width: 30px;
      height: 30px;
      padding: 0;
      cursor: pointer;
      border: 0;
      border-radius: 50%;
      color: #536471;
      background: transparent;
    }
    button:hover { background: #00000010; }
    button:focus-visible, input:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      .search { background: #202327; border-color: #555a5e; color: #aaa; }
      .search:focus-within { background: #16181c; }
      input { color: #e7e9ea; }
      input::placeholder, button { color: #9aa0a6; }
      button:hover { background: #ffffff18; }
    }
    @media (max-width: 750px) {
      .search { right: 8px; top: 8px; width: min(220px, calc(100vw - 16px)); }
    }
  `;

  const form = document.createElement('form');
  form.className = 'search';
  form.setAttribute('role', 'search');
  form.setAttribute('aria-label', 'Xの投稿を検索');

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'キーワード検索';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'キーワード検索');

  const button = document.createElement('button');
  button.type = 'submit';
  button.setAttribute('aria-label', '検索');
  button.innerHTML = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
  form.append(input, button);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const q = input.value.trim();
    if (!q) { input.focus(); return; }
    const url = new URL('/search', location.origin);
    url.searchParams.set('q', q);
    url.searchParams.set('src', 'typed_query');
    location.assign(url.toString());
  });
  root.append(style, form);
  document.documentElement.appendChild(host);

  // The native search UI already appears on the Search and Explore pages.
  let prevPath = '';
  function updateVisibility() {
    if (location.pathname === prevPath) return;
    prevPath = location.pathname;
    form.hidden = /^\\/(search|explore)(?:\\/|$)/.test(prevPath);
  }
  updateVisibility();
  const timer = setInterval(updateVisibility, 1200);
  window.addEventListener('pagehide', () => clearInterval(timer), {once: true});
})();

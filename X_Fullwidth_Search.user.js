// ==UserScript==
// @name         X Full-width Timeline Search Box
// @name:ja      X 全幅タイムライン用 検索ボックス
// @namespace    local.x-ui-tweaks
// @version      1.0.0
// @description  Adds a floating keyword search box without changing the timeline width.
// @description:ja タイムライン幅を変更せずに右上に検索ボックスを追加します。
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
  if (document.getElementById('cpft-floating-search')) return;

  const style = document.createElement('style');
  style.textContent = `
    #cpft-floating-search {
      position: fixed;
      top: 9px;
      right: 24px;
      z-index: 20;
      width: 310px;
      height: 43px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      border: 1px solid transparent;
      border-radius: 999px;
      background: rgb(239, 243, 244);
      color: rgb(83, 100, 113);
      font-family: system-ui, -apple-system, sans-serif;
    }
    #cpft-floating-search:focus-within {
      border-color: rgb(29, 155, 240);
      background: white;
    }
    #cpft-floating-search input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: rgb(15, 20, 25);
      font: 14px system-ui, -apple-system, sans-serif;
    }
    #cpft-floating-search input::placeholder { color: rgb(83, 100, 113); }
    #cpft-floating-search button {
      border: 0;
      padding: 3px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    body:is(.Dim, .LightsOut) #cpft-floating-search {
      background: rgb(32, 35, 39);
      color: rgb(113, 118, 123);
    }
    body:is(.Dim, .LightsOut) #cpft-floating-search:focus-within {
      background: rgb(22, 24, 28);
    }
    body:is(.Dim, .LightsOut) #cpft-floating-search input {
      color: white;
    }
    body:is(.Search, .Explore) #cpft-floating-search { display: none; }
    @media (max-width: 1200px) {
      #cpft-floating-search { width: 240px; right: 12px; }
    }
  `;

  const form = document.createElement('form');
  form.id = 'cpft-floating-search';
  form.setAttribute('role', 'search');
  form.setAttribute('aria-label', 'Xの投稿を検索');

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'キーワード検索';
  input.setAttribute('aria-label', 'キーワード検索');
  input.autocomplete = 'off';

  const button = document.createElement('button');
  button.type = 'submit';
  button.innerHTML = '<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
  button.setAttribute('aria-label', '検索');

  form.append(input, button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return input.focus();
    const url = new URL('/search', location.origin);
    url.searchParams.set('q', query);
    url.searchParams.set('src', 'typed_query');
    location.assign(url.toString());
  });

  document.head.appendChild(style);
  document.body.appendChild(form);
})();

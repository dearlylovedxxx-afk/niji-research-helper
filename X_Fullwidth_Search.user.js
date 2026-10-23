// ==UserScript==
// @name         X Full-width Timeline Search Box
// @name:ja      X 全幅タイムライン用 検索ボックス
// @namespace    local.x-ui-tweaks
// @version      1.3.1
// @description  Display only X's own native search bar over the full-width timeline; no custom or fallback search boxes.
// @description:ja 全幅タイムライン上にX純正の検索欄のみ表示。自作・代替検索欄は一切表示しません。
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
  if (window.__cpftNativeOnlySearchActive) return;
  window.__cpftNativeOnlySearchActive = true;

  // Remove DOM left by earlier versions if a script is reloaded in-place.
  // These IDs belonged exclusively to our self-made search boxes.
  for (const id of [
    'cpft-fullwidth-search-fallback',
    'cpft-native-search-fallback',
    'cpft-independent-search-host',
    'cpft-floating-search',
  ]) document.getElementById(id)?.remove();

  // Eliminate all previous layout overrides before applying the native-only ones.
  document.getElementById('cpft-native-search-styles')?.remove();
  document.getElementById('cpft-fullwidth-native-search-css')?.remove();
  document.getElementById('cpft-native-only-search-css')?.remove();

  // Never create an input, button, form, or fake history list.
  // Keep X's React search form in its original DOM, preserving native history
  // and suggestions. Only lift the existing UI above the hidden sidebar.
  const css = document.createElement('style');
  css.id = 'cpft-native-only-search-css';
  css.textContent = `
    body.cpft-native-search-on.cpft-native-search-on:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] {
      display: block !important;
      position: fixed !important;
      inset: 0 0 auto auto !important;
      width: 0 !important;
      min-width: 0 !important;
      max-width: 0 !important;
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      flex: none !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
      pointer-events: none !important;
      z-index: 2147483000 !important;
    }
    body.cpft-native-search-on.cpft-native-search-on:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] * {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    body.cpft-native-search-on.cpft-native-search-on:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] .cpft-native-search-ancestor {
      visibility: visible !important;
      overflow: visible !important;
    }
    body.cpft-native-search-on.cpft-native-search-on:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] .cpft-native-search-hidden-ancestor {
      display: block !important;
    }
    body.cpft-native-search-on.cpft-native-search-on:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] form.cpft-native-search-form {
      position: fixed !important;
      top: 8px !important;
      right: 14px !important;
      bottom: auto !important;
      left: auto !important;
      width: min(340px, calc(100vw - 28px)) !important;
      max-width: min(340px, calc(100vw - 28px)) !important;
      min-width: 0 !important;
      margin: 0 !important;
      transform: none !important;
      overflow: visible !important;
      visibility: visible !important;
      pointer-events: auto !important;
      z-index: 2147483001 !important;
    }
    body.cpft-native-search-on.cpft-native-search-on:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] form.cpft-native-search-form,
    body.cpft-native-search-on.cpft-native-search-on:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] form.cpft-native-search-form * {
      visibility: visible !important;
      pointer-events: auto !important;
    }
    @media (max-width: 1050px) {
      body.cpft-native-search-on.cpft-native-search-on:is(.HomeTimeline,.List,.Community)
        div[data-testid="sidebarColumn"] form.cpft-native-search-form {
        right: 6px !important;
        width: min(265px, calc(100vw - 12px)) !important;
        max-width: min(265px, calc(100vw - 12px)) !important;
      }
    }
  `;
  document.head.appendChild(css);

  let marked = [];
  let activeForm = null;

  const onEligiblePage = () =>
    Boolean(document.body?.matches('.HomeTimeline,.List,.Community')) &&
    !/^\/(?:search|explore)(?:\/|$)/.test(location.pathname);

  function reset() {
    document.body?.classList.remove('cpft-native-search-on');
    for (const el of marked) {
      el.classList.remove('cpft-native-search-form',
        'cpft-native-search-ancestor', 'cpft-native-search-hidden-ancestor');
    }
    marked = [];
    activeForm = null;
  }

  function findNativeForm(sidebar) {
    const node = sidebar.querySelector('input[data-testid="SearchBox_Search_Input"]') ||
      sidebar.querySelector('form[role="search"] input') ||
      sidebar.querySelector('[role="search"] input');
    return node?.closest('form[role="search"]') || node?.closest('form') || null;
  }

  function markForm(form, sidebar) {
    if (form === activeForm && form.isConnected) return;
    reset();
    activeForm = form;
    form.classList.add('cpft-native-search-form');
    marked.push(form);
    for (let el = form.parentElement; el && el !== sidebar; el = el.parentElement) {
      el.classList.add('cpft-native-search-ancestor');
      if (getComputedStyle(el).display === 'none') {
        el.classList.add('cpft-native-search-hidden-ancestor');
      }
      marked.push(el);
    }
  }

  function refresh() {
    if (!onEligiblePage()) { reset(); return; }
    const sidebar = document.querySelector('div[data-testid="sidebarColumn"]');
    const body = document.body;
    if (!sidebar || !body.classList.contains('Sidebar')) {
      reset();
      return;
    }
    // Only restore native search when Control Panel for Twitter hides its sidebar.
    // Do not disturb the ordinary, visible right sidebar.
    const alreadyActive = body.classList.contains('cpft-native-search-on');
    const hidden = getComputedStyle(sidebar).display === 'none';
    if (!hidden && !alreadyActive) { reset(); return; }

    const nativeForm = findNativeForm(sidebar);
    if (!nativeForm) { reset(); return; }
    if (nativeForm !== activeForm || !nativeForm.isConnected) {
      markForm(nativeForm, sidebar);
    }
    body.classList.add('cpft-native-search-on');
  }

  refresh();
  const timer = setInterval(refresh, 1200);
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    reset();
  }, {once: true});
})();

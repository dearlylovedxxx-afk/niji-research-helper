// ==UserScript==
// @name         X Full-width Timeline Search Box
// @name:ja      X 全幅タイムライン用 検索ボックス
// @namespace    local.x-ui-tweaks
// @version      1.1.1
// @description  Restores X's native search box (history and suggestions) as an overlay when Control Panel for Twitter uses full-width timelines.
// @description:ja Control Panel for Twitterの全幅表示を保ちながら、履歴・候補付きのX純正検索欄を右上に表示。
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
  if (window.__cpftNativeSearchBooted) return;
  window.__cpftNativeSearchBooted = true;

  // The extension sets display:none!important on the entire sidebar and
  // max-width:990px on the main timeline. Move *the native sidebar* out of
  // normal flex layout with position:fixed, while revealing only its search UI.
  // This keeps the actual React search component (history/suggestions) alive.
  const overlayStyle = document.createElement('style');
  overlayStyle.id = 'cpft-native-search-styles';
  overlayStyle.textContent = `
    body.cpft-native-search-overlay:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] {
      display: flex !important;
      flex-direction: column !important;
      align-items: stretch !important;
      position: fixed !important;
      top: 0 !important;
      right: 14px !important;
      bottom: auto !important;
      left: auto !important;
      width: 350px !important;
      max-width: min(350px, calc(100vw - 28px)) !important;
      height: 65px !important;
      min-height: 0 !important;
      max-height: 65px !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
      flex: none !important;
      z-index: 2147483000 !important;
      pointer-events: none !important;
    }
    body.cpft-native-search-overlay:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] * {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    body.cpft-native-search-overlay:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] .cpft-search-path {
      visibility: visible !important;
    }
    body.cpft-native-search-overlay:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] .cpft-search-scope,
    body.cpft-native-search-overlay:is(.HomeTimeline,.List,.Community)
      div[data-testid="sidebarColumn"] .cpft-search-scope * {
      visibility: visible !important;
      pointer-events: auto !important;
    }
    @media (max-width: 1200px) {
      body.cpft-native-search-overlay:is(.HomeTimeline,.List,.Community)
        div[data-testid="sidebarColumn"] {
        width: 295px !important;
        right: 6px !important;
      }
    }
  `;
  document.head.appendChild(overlayStyle);

  // Previous versions created a separate fake form. Remove it if a tab has
  // retained the old DOM after an in-place userscript reload.
  document.getElementById('cpft-independent-search-host')?.remove();
  document.getElementById('cpft-floating-search')?.remove();

  const fallbackHost = document.createElement('div');
  fallbackHost.id = 'cpft-native-search-fallback';
  fallbackHost.style.cssText = 'position:fixed!important;top:8px!important;right:14px!important;z-index:2147482999!important;pointer-events:none!important;width:0!important;height:0!important';
  const shadow = fallbackHost.attachShadow({mode:'open'});
  const fallbackCss = document.createElement('style');
  fallbackCss.textContent = `
    * { box-sizing: border-box; }
    form { position:fixed; top:9px; right:14px; display:flex; align-items:center; gap:8px;
           height:44px; width:280px; padding:0 12px; border:1px solid #8899a6;
           border-radius:25px; background:#eff3f4; color:#536471;
           font:13px system-ui; pointer-events:auto; }
    form[hidden] { display:none!important; }
    input { width:100%; flex:1; min-width:0; outline:none; border:none;
            background:transparent; font:inherit; color:#0f1419; }
    button { border:0; background:transparent; color:inherit; cursor:pointer; font:inherit; }
    @media(prefers-color-scheme:dark) {
      form { background:#202327; color:#b7bec3; }
      input { color:#fff; }
    }
  `;
  const fallback = document.createElement('form');
  fallback.hidden = true;
  fallback.setAttribute('role','search');
  fallback.setAttribute('aria-label','簡易検索（Xの純正検索欄が見つかりません）');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = '簡易検索';
  input.setAttribute('aria-label','キーワード');
  const button = document.createElement('button');
  button.type='submit';
  button.textContent='検索';
  fallback.append(input,button);
  fallback.addEventListener('submit', e => {
    e.preventDefault();
    const q=input.value.trim();
    if(!q)return;
    const u=new URL('/search',location.origin);
    u.searchParams.set('q',q);
    u.searchParams.set('src','typed_query');
    location.assign(u.href);
  });
  shadow.append(fallbackCss,fallback);
  document.documentElement.appendChild(fallbackHost);

  let markedScope = null;
  let marked = [];
  let scanCount = 0;
  const fullscreenPage = () => document.body?.matches('.HomeTimeline,.List,.Community');

  function clearMarks() {
    for (const element of marked) {
      element.classList.remove('cpft-search-path', 'cpft-search-scope');
    }
    marked=[];
    markedScope=null;
  }

  function markNativeSearch(inputElement, sidebar) {
    const nativeForm =
      inputElement.closest('[role="search"]') ||
      inputElement.closest('form') ||
      inputElement.parentElement;
    if (!nativeForm) return false;
    // Include the adjacent search dropdown, if it lives beside the form.
    const scope = nativeForm.parentElement !== sidebar && nativeForm.parentElement
      ? nativeForm.parentElement : nativeForm;
    if (scope === markedScope && scope.isConnected) return true;
    clearMarks();
    markedScope=scope;
    scope.classList.add('cpft-search-scope');
    marked.push(scope);
    for (let ancestor=scope.parentElement; ancestor && ancestor!==sidebar; ancestor=ancestor.parentElement) {
      ancestor.classList.add('cpft-search-path');
      marked.push(ancestor);
    }
    return true;
  }

  function refresh() {
    const body=document.body;
    if (!body || !fullscreenPage()) {
      body?.classList.remove('cpft-native-search-overlay');
      fallback.hidden=true;
      clearMarks();
      return;
    }
    const sidebar=document.querySelector('div[data-testid="sidebarColumn"]');
    const primary=document.querySelector('div[data-testid="primaryColumn"]');
    if (!sidebar || !primary || !body.classList.contains('Sidebar')) {
      body.classList.remove('cpft-native-search-overlay');
      fallback.hidden=true;
      clearMarks();
      return;
    }

    // The Control Panel for Twitter "full width content" option sets 990px.
    // Detect it, so toggling that setting OFF returns to the native layout.
    const maxWidth=parseFloat(getComputedStyle(primary).maxWidth);
    const wideMode=Number.isFinite(maxWidth) && maxWidth>=900;
    if (!wideMode) {
      body.classList.remove('cpft-native-search-overlay');
      fallback.hidden=true;
      clearMarks();
      return;
    }
    const searchInput =
      sidebar.querySelector('input[data-testid="SearchBox_Search_Input"]') ||
      sidebar.querySelector('[role="search"] input') ||
      sidebar.querySelector('form[role="search"] input');

    if (searchInput && markNativeSearch(searchInput,sidebar)) {
      body.classList.add('cpft-native-search-overlay');
      fallback.hidden=true;
    } else {
      body.classList.remove('cpft-native-search-overlay');
      clearMarks();
      // No fake history: fallback is explicitly labeled as simple search.
      // A click on X's Explore section still exposes its original search UI.
      fallback.hidden=++scanCount < 4;
    }
  }
  refresh();
  const interval=setInterval(refresh, 1100);
  window.addEventListener('pagehide', () => clearInterval(interval), {once:true});
})();

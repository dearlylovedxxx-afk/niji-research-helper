// ==UserScript==
// @name         X Full-width Timeline Search Box
// @name:ja      X 全幅タイムライン用 検索ボックス
// @namespace    local.x-ui-tweaks
// @version      1.2.0
// @description  Shows X's native search bar and suggestions over full-width timelines; never leaves the search box missing.
// @description:ja 全幅タイムラインの右上にX純正の検索欄を表示。純正が利用できない場合は簡易検索を残す。
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
  if (window.__cpftFullwidthSearchActive) return;
  window.__cpftFullwidthSearchActive = true;

  // The native React search form must stay mounted: cloning the HTML loses
  // X's own search history, suggestion dropdown, and event handlers.
  // The sidebar is out of flow (width:0, fixed), so no timeline width is taken.
  const css = document.createElement('style');
  css.id = 'cpft-fullwidth-native-search-css';
  css.textContent = `
    html body.cpft-native-search-on.cpft-native-search-on
      div[data-testid="sidebarColumn"] {
      display: block !important;
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      left: auto !important;
      width: 0 !important;
      min-width: 0 !important;
      max-width: 0 !important;
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
      flex: none !important;
      pointer-events: none !important;
      z-index: 2147483000 !important;
    }
    html body.cpft-native-search-on.cpft-native-search-on
      div[data-testid="sidebarColumn"] * {
      visibility: hidden !important;
      pointer-events: none !important;
    }
    html body.cpft-native-search-on.cpft-native-search-on
      div[data-testid="sidebarColumn"] .cpft-native-search-ancestor {
      visibility: visible !important;
      overflow: visible !important;
    }
    html body.cpft-native-search-on.cpft-native-search-on
      div[data-testid="sidebarColumn"] .cpft-native-search-hidden-ancestor {
      display: block !important;
    }
    html body.cpft-native-search-on.cpft-native-search-on
      div[data-testid="sidebarColumn"] form.cpft-native-search-form {
      position: fixed !important;
      top: 8px !important;
      right: 14px !important;
      bottom: auto !important;
      left: auto !important;
      width: min(340px, calc(100vw - 28px)) !important;
      max-width: min(340px, calc(100vw - 28px)) !important;
      margin: 0 !important;
      transform: none !important;
      overflow: visible !important;
      visibility: visible !important;
      pointer-events: auto !important;
      z-index: 2147483001 !important;
    }
    html body.cpft-native-search-on.cpft-native-search-on
      div[data-testid="sidebarColumn"] form.cpft-native-search-form,
    html body.cpft-native-search-on.cpft-native-search-on
      div[data-testid="sidebarColumn"] form.cpft-native-search-form * {
      visibility: visible !important;
      pointer-events: auto !important;
    }
    @media (max-width: 1050px) {
      html body.cpft-native-search-on.cpft-native-search-on
        div[data-testid="sidebarColumn"] form.cpft-native-search-form {
        right: 6px !important;
        width: min(265px, calc(100vw - 12px)) !important;
        max-width: min(265px, calc(100vw - 12px)) !important;
      }
    }
  `;
  document.head.append(css);

  // A guaranteed fallback with an explicit distinction from X-native search.
  // The fallback has a shortcut to X's own Explore search/history UI.
  const host = document.createElement('div');
  host.id = 'cpft-fullwidth-search-fallback';
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0 auto auto 0', 'important');
  host.style.setProperty('height', '0', 'important');
  host.style.setProperty('width', '0', 'important');
  host.style.setProperty('z-index', '2147483002', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  const shadow = host.attachShadow({mode:'open'});
  const style = document.createElement('style');
  style.textContent = `
    *{box-sizing:border-box}
    form{position:fixed;right:14px;top:8px;display:flex;gap:5px;align-items:center;
      width:min(340px,calc(100vw - 28px));height:44px;padding:0 8px 0 14px;
      border:1px solid #b8c4cd;border-radius:24px;background:#eff3f4;color:#536471;
      font:14px system-ui,-apple-system,sans-serif;pointer-events:auto;
      box-shadow:0 2px 10px #0002}
    form[hidden]{display:none!important}
    input{flex:1;min-width:0;width:0;border:0;outline:0;color:#0f1419;background:none;font:inherit}
    button,a{flex:none;border:0;background:none;color:inherit;cursor:pointer;font:inherit;
      padding:6px 7px;text-decoration:none;border-radius:15px}
    button:hover,a:hover{background:#0001}
    a{font-size:12px;white-space:nowrap}
    @media(prefers-color-scheme:dark){form{background:#202327;border-color:#43484c;color:#a4b3bb}input{color:#fff}}
    @media(max-width:1050px){form{right:6px;width:min(265px,calc(100vw - 12px))}a{font-size:11px}}
  `;
  const form = document.createElement('form');
  form.setAttribute('role', 'search');
  form.setAttribute('aria-label', '簡易検索（X純正の検索履歴を開くには「履歴」）');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'キーワード検索';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'キーワード検索');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = '⌕';
  submit.setAttribute('aria-label', '検索する');
  const history = document.createElement('a');
  history.href = '/explore';
  history.textContent = '履歴 ↗';
  history.title = 'X純正の検索画面で検索履歴を確認';
  form.append(input, submit, history);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return input.focus();
    const u = new URL('/search',location.origin);
    u.searchParams.set('q',q);
    u.searchParams.set('src','typed_query');
    location.assign(u.href);
  });
  shadow.append(style, form);
  document.documentElement.append(host);

  let marked=[];
  let activeNative=null;
  const hidePage=() => /^\/(?:search|explore)(?:\/|$)/.test(location.pathname);

  function reset() {
    document.body?.classList.remove('cpft-native-search-on');
    marked.forEach(el => el.classList.remove(
      'cpft-native-search-form','cpft-native-search-ancestor','cpft-native-search-hidden-ancestor'
    ));
    marked=[];
    activeNative=null;
  }
  function findNativeForm(sidebar) {
    const node =
      sidebar.querySelector('input[data-testid="SearchBox_Search_Input"]') ||
      sidebar.querySelector('form[role="search"] input') ||
      sidebar.querySelector('[role="search"] input');
    return node?.closest('form[role="search"]') || node?.closest('form') || null;
  }
  function mark(formEl, sidebar) {
    if (formEl === activeNative && formEl.isConnected) return;
    reset();
    activeNative=formEl;
    formEl.classList.add('cpft-native-search-form');
    marked.push(formEl);
    for(let el=formEl.parentElement; el && el!==sidebar; el=el.parentElement) {
      el.classList.add('cpft-native-search-ancestor');
      // CPFT hides all but the first sidebar item on several pages.
      if(getComputedStyle(el).display === 'none') el.classList.add('cpft-native-search-hidden-ancestor');
      marked.push(el);
    }
  }
  function nativeActuallyVisible(formEl) {
    if (!formEl?.isConnected) return false;
    const rect = formEl.getBoundingClientRect();
    return rect.width >= 100 && rect.height >= 20
      && rect.right > 0 && rect.left < innerWidth
      && getComputedStyle(formEl).visibility !== 'hidden';
  }
  function refresh() {
    if (!document.body || hidePage()) {
      reset();
      form.hidden = true;
      return;
    }
    const sidebar=document.querySelector('div[data-testid="sidebarColumn"]');
    const hasSearchElsewhere = [...document.querySelectorAll('form[role="search"]')]
      .some(el => !sidebar?.contains(el) && el.getBoundingClientRect().width >= 100);
    if (hasSearchElsewhere) {
      reset();
      form.hidden = true;
      return;
    }
    if (!sidebar) {
      reset();
      form.hidden = false;
      return;
    }

    // Use the native form only when the right sidebar is already hidden by X/CPFT
    // or when this script has already lifted it out of the document flow.
    const ours = document.body.classList.contains('cpft-native-search-on');
    const hiddenSidebar = getComputedStyle(sidebar).display === 'none';
    if (!hiddenSidebar && !ours) {
      reset();
      form.hidden = true;
      return;
    }
    const native = findNativeForm(sidebar);
    if (!native) {
      reset();
      form.hidden = false;
      return;
    }
    if (native !== activeNative || !native.isConnected) mark(native, sidebar);
    document.body.classList.add('cpft-native-search-on');
    // If X changes the markup or hides the native form, never leave a blank area.
    form.hidden = nativeActuallyVisible(native);
  }
  refresh();
  const timer=setInterval(refresh, 1200);
  window.addEventListener('pagehide', () => clearInterval(timer), {once:true});
})();

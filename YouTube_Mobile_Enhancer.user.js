// ==UserScript==
// @name         YouTube Safari アプリ風 + 流れるチャット
// @namespace    marina-youtube-mobile-enhancer
// @version      0.1.0
// @description  iPhone SafariのYouTube視聴ページを縦画面ではアプリ寄りに整理し、横向き全画面ではチャットリプレイを動画上へ流します。
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Mobile_Enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Mobile_Enhancer.user.js
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.0';
  const ROOT = document.documentElement;
  const CLASS_PHONE = 'ytme-phone';
  const CLASS_PORTRAIT = 'ytme-portrait';
  const CLASS_LANDSCAPE = 'ytme-landscape';
  const CLASS_FULLSCREEN = 'ytme-pseudo-fullscreen';
  const CLASS_PLAYER = 'ytme-pseudo-player';
  const STYLE_ID = 'ytme-style';
  const OVERLAY_ID = 'ytme-danmaku-overlay';
  const NOTE_ID = 'ytme-danmaku-note';
  const MESSAGE_TYPE = 'ytme-chat-message';
  const FRAME_READY_TYPE = 'ytme-chat-frame-ready';
  const LANES = 8;

  const topState = {
    enabled: false,
    pseudoFullscreen: false,
    player: null,
    overlay: null,
    laneUntil: Array(LANES).fill(0),
    seen: new Map(),
    frameSeenAt: 0,
    lastCommentAt: 0,
    refreshTimer: 0,
  };

  function isYouTubeOrigin(origin) {
    try {
      const host = new URL(origin).hostname;
      return host === 'youtube.com' || host.endsWith('.youtube.com');
    } catch {
      return false;
    }
  }

  function isWatchPage() {
    try {
      return location.pathname === '/watch' && Boolean(new URL(location.href).searchParams.get('v'));
    } catch {
      return false;
    }
  }

  function isPhoneViewport() {
    const shortSide = Math.min(window.innerWidth || 0, window.innerHeight || 0);
    let coarse = true;
    try {
      coarse = matchMedia('(pointer: coarse)').matches;
    } catch {}
    return coarse && shortSide > 0 && shortSide <= 700;
  }

  function isLandscapePhone() {
    return isPhoneViewport() && window.innerWidth > window.innerHeight;
  }

  function textWithEmoji(root) {
    if (!root) return '';
    let out = '';
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue || '';
        return;
      }
      if (!(node instanceof Element)) return;
      if (node.tagName === 'IMG') {
        out += node.getAttribute('alt') || node.getAttribute('aria-label') || '';
        return;
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(root);
    return out.replace(/\s+/g, ' ').trim();
  }

  // ---------- live chat / replay iframe ----------
  function bootChatFrame() {
    if (window.top === window.self) return false;

    const send = (payload) => {
      try {
        window.parent.postMessage(payload, '*');
      } catch {}
    };

    const seen = new Set();
    const rendererSelector = [
      'yt-live-chat-text-message-renderer',
      'yt-live-chat-paid-message-renderer',
      'yt-live-chat-paid-sticker-renderer',
      'yt-live-chat-membership-item-renderer',
      'yt-live-chat-viewer-engagement-message-renderer',
    ].join(',');

    function makePayload(renderer) {
      if (!(renderer instanceof Element)) return null;

      const authorEl =
        renderer.querySelector('#author-name') ||
        renderer.querySelector('.author-name');

      const messageEl =
        renderer.querySelector('#message') ||
        renderer.querySelector('#content-text') ||
        renderer.querySelector('#header-subtext') ||
        renderer.querySelector('#primary-text');

      let message = textWithEmoji(messageEl);

      if (!message) {
        const sticker = renderer.querySelector('img[alt], img[aria-label]');
        message = sticker?.getAttribute('alt') || sticker?.getAttribute('aria-label') || '';
      }

      const amount =
        textWithEmoji(renderer.querySelector('#purchase-amount')) ||
        textWithEmoji(renderer.querySelector('#purchase-amount-chip'));

      if (amount && !message.includes(amount)) {
        message = message ? `${message} ${amount}` : amount;
      }

      message = String(message || '').trim();
      if (!message) return null;

      const author = textWithEmoji(authorEl);
      const rawId =
        renderer.getAttribute('id') ||
        renderer.getAttribute('data-id') ||
        renderer.dataset?.id ||
        '';

      const kind = renderer.tagName.toLowerCase();
      const fallbackId = `${kind}|${author}|${message}`;
      const id = rawId || fallbackId;

      return {
        type: MESSAGE_TYPE,
        version: VERSION,
        id,
        author,
        message,
        kind,
        at: Date.now(),
      };
    }

    function sendRenderer(renderer) {
      const payload = makePayload(renderer);
      if (!payload) return;
      if (seen.has(payload.id)) return;
      seen.add(payload.id);
      if (seen.size > 3000) {
        const first = seen.values().next().value;
        if (first) seen.delete(first);
      }
      send(payload);
    }

    function markExisting() {
      for (const renderer of document.querySelectorAll(rendererSelector)) {
        const payload = makePayload(renderer);
        if (payload) seen.add(payload.id);
      }
    }

    function observe() {
      if (!document.body) {
        setTimeout(observe, 80);
        return;
      }

      markExisting();
      send({ type: FRAME_READY_TYPE, version: VERSION, at: Date.now() });

      const mo = new MutationObserver((mutations) => {
        const candidates = new Set();

        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches?.(rendererSelector)) candidates.add(node);
            for (const child of node.querySelectorAll?.(rendererSelector) || []) {
              candidates.add(child);
            }
          }
        }

        if (!candidates.size) return;
        requestAnimationFrame(() => {
          for (const renderer of candidates) sendRenderer(renderer);
        });
      });

      mo.observe(document.body, { childList: true, subtree: true });
    }

    observe();
    return true;
  }

  if (bootChatFrame()) return;

  // ---------- top watch page ----------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} [data-ytme-app-promo="1"],
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytm-app-promo,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytm-open-app-button,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytd-app-promo-renderer,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytm-mobile-topbar-renderer,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytd-masthead#masthead,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} #masthead-container {
        display: none !important;
      }

      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytd-app {
        --ytd-masthead-height: 0px !important;
      }

      html.${CLASS_PHONE}.${CLASS_PORTRAIT} #page-manager,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytd-watch-flexy,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytm-watch {
        margin-top: 0 !important;
        padding-top: 0 !important;
      }

      html.${CLASS_PHONE}.${CLASS_PORTRAIT} #player-container-outer,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} #player-container-id,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytm-player {
        margin-top: 0 !important;
        top: 0 !important;
        background: #000 !important;
      }

      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytd-live-chat-frame#chat,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} #chat-container,
      html.${CLASS_PHONE}.${CLASS_PORTRAIT} ytm-live-chat-frame {
        min-height: 44dvh !important;
        max-height: none !important;
      }

      html.${CLASS_FULLSCREEN},
      html.${CLASS_FULLSCREEN} body {
        overflow: hidden !important;
        overscroll-behavior: none !important;
        background: #000 !important;
      }

      html.${CLASS_FULLSCREEN} body > *:not(.ytme-keep) {
        overscroll-behavior: none !important;
      }

      .${CLASS_PLAYER} {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100dvh !important;
        min-width: 100vw !important;
        min-height: 100dvh !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        z-index: 2147483646 !important;
        background: #000 !important;
      }

      .${CLASS_PLAYER} video {
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
      }

      #${OVERLAY_ID} {
        position: absolute !important;
        inset: 0 !important;
        overflow: hidden !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        contain: layout paint;
      }

      #${OVERLAY_ID} .ytme-danmaku {
        position: absolute !important;
        left: 100% !important;
        max-width: none !important;
        white-space: nowrap !important;
        color: #fff !important;
        font: 800 clamp(18px, 3.1vw, 28px)/1.15 system-ui, -apple-system, BlinkMacSystemFont, sans-serif !important;
        text-shadow:
          -1px -1px 0 #000,
           1px -1px 0 #000,
          -1px  1px 0 #000,
           1px  1px 0 #000,
           0 2px 4px rgba(0,0,0,.9);
        animation: ytme-scroll var(--ytme-duration, 6s) linear forwards !important;
        will-change: transform;
      }

      #${NOTE_ID} {
        position: absolute !important;
        left: 50% !important;
        top: calc(12px + env(safe-area-inset-top, 0px)) !important;
        transform: translateX(-50%) !important;
        padding: 7px 11px !important;
        border-radius: 999px !important;
        background: rgba(0,0,0,.58) !important;
        color: #fff !important;
        font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, sans-serif !important;
        white-space: nowrap !important;
        opacity: .92;
      }

      @keyframes ytme-scroll {
        from { transform: translateX(0); }
        to { transform: translateX(calc(-100vw - 100%)); }
      }
    `;
    (document.head || ROOT).appendChild(style);
  }

  function getPlayer() {
    return document.querySelector('#movie_player.html5-video-player')
      || document.querySelector('#movie_player')
      || document.querySelector('.html5-video-player');
  }

  function markAppPromo() {
    if (!isPhoneViewport() || !isWatchPage()) return;
    for (const el of document.querySelectorAll('a, button')) {
      const text = String(el.textContent || '').replace(/\s+/g, '');
      if (!/YouTube.*アプリ.*開く|アプリで開く/.test(text)) continue;
      const rect = el.getBoundingClientRect?.();
      if (!rect || rect.top > 180) continue;

      let node = el;
      let best = el;
      for (let i = 0; i < 5 && node.parentElement; i++) {
        node = node.parentElement;
        const r = node.getBoundingClientRect?.();
        if (!r) continue;
        if (r.top < 180 && r.height >= 28 && r.height <= 130 && r.width >= window.innerWidth * .70) {
          best = node;
        }
      }
      best.setAttribute('data-ytme-app-promo', '1');
    }
  }

  function ensureOverlay() {
    const player = topState.player?.isConnected ? topState.player : getPlayer();
    if (!player) return null;

    let overlay = player.querySelector(`#${OVERLAY_ID}`);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('aria-hidden', 'true');
      player.appendChild(overlay);
    }
    topState.overlay = overlay;
    return overlay;
  }

  function showNote(text) {
    const overlay = ensureOverlay();
    if (!overlay) return;
    let note = overlay.querySelector(`#${NOTE_ID}`);
    if (!note) {
      note = document.createElement('div');
      note.id = NOTE_ID;
      overlay.appendChild(note);
    }
    note.textContent = text;
  }

  function hideNote() {
    document.getElementById(NOTE_ID)?.remove();
  }

  function pruneSeen(now = Date.now()) {
    for (const [id, at] of topState.seen) {
      if (now - at > 120000) topState.seen.delete(id);
    }
    if (topState.seen.size > 2500) {
      const remove = topState.seen.size - 1800;
      let i = 0;
      for (const key of topState.seen.keys()) {
        topState.seen.delete(key);
        if (++i >= remove) break;
      }
    }
  }

  function chooseLane(text) {
    const now = performance.now();
    let best = 0;
    for (let i = 1; i < LANES; i++) {
      if (topState.laneUntil[i] < topState.laneUntil[best]) best = i;
    }
    const gap = Math.min(1700, 620 + Math.max(0, text.length - 4) * 16);
    topState.laneUntil[best] = Math.max(now, topState.laneUntil[best]) + gap;
    return best;
  }

  function spawnComment(payload) {
    if (!topState.pseudoFullscreen) return;
    const text = String(payload?.message || '').trim();
    if (!text) return;

    const now = Date.now();
    const id = String(payload.id || `${payload.author || ''}|${text}|${Math.floor(now / 1000)}`);
    if (topState.seen.has(id)) return;
    topState.seen.set(id, now);
    pruneSeen(now);

    const overlay = ensureOverlay();
    if (!overlay) return;
    hideNote();

    const lane = chooseLane(text);
    const item = document.createElement('div');
    item.className = 'ytme-danmaku';
    item.textContent = text;
    item.style.top = `${4.5 + lane * 10.7}%`;

    const duration = Math.min(9.2, 5.6 + Math.max(0, text.length - 8) * 0.035);
    item.style.setProperty('--ytme-duration', `${duration.toFixed(2)}s`);
    item.addEventListener('animationend', () => item.remove(), { once: true });
    overlay.appendChild(item);

    topState.lastCommentAt = now;
  }

  function enterPseudoFullscreen() {
    if (!isWatchPage() || !isLandscapePhone()) return false;
    const player = getPlayer();
    if (!player) return false;

    topState.pseudoFullscreen = true;
    topState.player = player;
    topState.laneUntil = Array(LANES).fill(0);

    ROOT.classList.add(CLASS_FULLSCREEN);
    document.body?.classList.add(CLASS_FULLSCREEN);
    player.classList.add(CLASS_PLAYER);

    ensureOverlay();
    if (Date.now() - topState.frameSeenAt > 5000) {
      showNote('チャットリプレイを開いておくとコメントが流れます');
    } else {
      showNote('コメント待機中…');
    }
    return true;
  }

  function exitPseudoFullscreen() {
    topState.pseudoFullscreen = false;
    ROOT.classList.remove(CLASS_FULLSCREEN);
    document.body?.classList.remove(CLASS_FULLSCREEN);

    topState.player?.classList?.remove(CLASS_PLAYER);
    document.querySelectorAll(`.${CLASS_PLAYER}`).forEach((el) => el.classList.remove(CLASS_PLAYER));

    document.getElementById(OVERLAY_ID)?.remove();
    topState.player = null;
    topState.overlay = null;
    topState.laneUntil = Array(LANES).fill(0);
  }

  function refreshMode() {
    injectStyle();

    const active = isWatchPage() && isPhoneViewport();
    const landscape = active && window.innerWidth > window.innerHeight;

    ROOT.classList.toggle(CLASS_PHONE, active);
    ROOT.classList.toggle(CLASS_PORTRAIT, active && !landscape);
    ROOT.classList.toggle(CLASS_LANDSCAPE, landscape);

    if (active && !landscape) markAppPromo();
    if (topState.pseudoFullscreen && !landscape) exitPseudoFullscreen();
    topState.enabled = active;
  }

  function scheduleRefresh() {
    clearTimeout(topState.refreshTimer);
    requestAnimationFrame(refreshMode);
    topState.refreshTimer = setTimeout(refreshMode, 180);
  }

  window.addEventListener('message', (event) => {
    if (!isYouTubeOrigin(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === FRAME_READY_TYPE) {
      topState.frameSeenAt = Date.now();
      if (topState.pseudoFullscreen) showNote('コメント待機中…');
      return;
    }

    if (data.type === MESSAGE_TYPE) {
      topState.frameSeenAt = Date.now();
      spawnComment(data);
    }
  });

  // 横向き時だけYouTube標準の全画面ボタンを疑似全画面へ置き換える。
  // 縦向きではYouTube本来の挙動を邪魔しない。
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest?.('.ytp-fullscreen-button');
    if (!button) return;
    if (!topState.pseudoFullscreen && !isLandscapePhone()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (topState.pseudoFullscreen) exitPseudoFullscreen();
    else enterPseudoFullscreen();
  }, true);

  window.addEventListener('resize', scheduleRefresh, { passive: true });
  window.addEventListener('orientationchange', scheduleRefresh, { passive: true });
  window.addEventListener('popstate', scheduleRefresh, { passive: true });
  document.addEventListener('yt-navigate-finish', scheduleRefresh, true);
  document.addEventListener('DOMContentLoaded', scheduleRefresh, { once: true });

  const boot = () => {
    injectStyle();
    refreshMode();

    const mo = new MutationObserver(() => {
      if (!topState.enabled && !isWatchPage()) return;
      scheduleRefresh();
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else setTimeout(boot, 80);
  };

  boot();
})();

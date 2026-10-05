// ==UserScript==
// @name         YouTube Safari アプリ風 + 流れるチャット
// @namespace    marina-youtube-mobile-enhancer
// @version      0.5.0
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

  const VERSION = '0.5.0';
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
    fullscreenTarget: null,
    overlay: null,
    laneUntil: Array(LANES).fill(0),
    seen: new Map(),
    frameSeenAt: 0,
    lastCommentAt: 0,
    refreshTimer: 0,
    browserFullscreen: false,
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
        window.top.postMessage(payload, '*');
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

    function richParts(root) {
      if (!root) return [];
      const parts = [];

      const pushText = (value) => {
        const text = String(value || '').replace(/\s+/g, ' ');
        if (!text) return;
        const last = parts[parts.length - 1];
        if (last?.type === 'text') last.text += text;
        else parts.push({ type: 'text', text });
      };

      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          pushText(node.nodeValue || '');
          return;
        }
        if (!(node instanceof Element)) return;

        if (node.tagName === 'IMG') {
          const src =
            node.currentSrc ||
            node.getAttribute('src') ||
            node.getAttribute('data-src') ||
            '';
          const alt =
            node.getAttribute('alt') ||
            node.getAttribute('aria-label') ||
            '';
          if (src) parts.push({ type: 'image', src, alt });
          else if (alt) pushText(alt);
          return;
        }

        for (const child of node.childNodes) walk(child);
      };

      walk(root);
      for (const part of parts) {
        if (part.type === 'text') part.text = part.text.trim();
      }
      return parts.filter((part) => part.type !== 'text' || part.text);
    }

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

      let parts = richParts(messageEl);

      if (!parts.length) {
        const sticker = renderer.querySelector('img[alt], img[aria-label], img[src]');
        const src = sticker?.currentSrc || sticker?.getAttribute('src') || '';
        const alt = sticker?.getAttribute('alt') || sticker?.getAttribute('aria-label') || '';
        if (src) parts = [{ type: 'image', src, alt }];
        else if (alt) parts = [{ type: 'text', text: alt }];
      }

      const amount =
        textWithEmoji(renderer.querySelector('#purchase-amount')) ||
        textWithEmoji(renderer.querySelector('#purchase-amount-chip'));

      if (amount) parts.push({ type: 'text', text: ` ${amount}` });

      const message = parts
        .map((part) => part.type === 'image' ? (part.alt || '[スタンプ]') : part.text)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      if (!message && !parts.some((part) => part.type === 'image')) return null;

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
        parts,
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

      // YouTube側が既存rendererを使い回す場合もあるため、短い周期で現在行を再確認する。
      setInterval(() => {
        for (const renderer of document.querySelectorAll(rendererSelector)) {
          sendRenderer(renderer);
        }
      }, 240);
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
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        overscroll-behavior: none !important;
        background: #000 !important;
      }

      /* iPhone Safariでは動画の祖先を fixed にすると映像レイヤーだけ黒くなることがある。
         そのためページ側を1画面に畳み、プレイヤー自身は通常フローのまま全面化する。 */
      html.${CLASS_FULLSCREEN} ytd-masthead,
      html.${CLASS_FULLSCREEN} #masthead-container,
      html.${CLASS_FULLSCREEN} ytm-mobile-topbar-renderer,
      html.${CLASS_FULLSCREEN} ytd-app-promo-renderer,
      html.${CLASS_FULLSCREEN} ytm-app-promo,
      html.${CLASS_FULLSCREEN} [data-ytme-app-promo="1"],
      html.${CLASS_FULLSCREEN} #marina-member-chat-search-button,
      html.${CLASS_FULLSCREEN} #marina-member-chat-search-panel,
      html.${CLASS_FULLSCREEN} [id^="npf-yt-"],
      html.${CLASS_FULLSCREEN} [id^="npf-floating"] {
        display: none !important;
      }

      html.${CLASS_FULLSCREEN} ytd-app,
      html.${CLASS_FULLSCREEN} #content,
      html.${CLASS_FULLSCREEN} #page-manager,
      html.${CLASS_FULLSCREEN} ytd-watch-flexy,
      html.${CLASS_FULLSCREEN} #columns,
      html.${CLASS_FULLSCREEN} #primary,
      html.${CLASS_FULLSCREEN} #primary-inner,
      html.${CLASS_FULLSCREEN} #player,
      html.${CLASS_FULLSCREEN} #player-container,
      html.${CLASS_FULLSCREEN} #player-container-inner,
      html.${CLASS_FULLSCREEN} #player-container-outer {
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        max-width: none !important;
      }

      html.${CLASS_FULLSCREEN} #secondary,
      html.${CLASS_FULLSCREEN} #below,
      html.${CLASS_FULLSCREEN} ytd-watch-metadata,
      html.${CLASS_FULLSCREEN} #comments,
      html.${CLASS_FULLSCREEN} #related {
        visibility: hidden !important;
        pointer-events: none !important;
      }

      .${CLASS_PLAYER} {
        position: relative !important;
        inset: auto !important;
        width: 100vw !important;
        height: var(--ytme-stage-height, 100dvh) !important;
        min-width: 100vw !important;
        min-height: var(--ytme-stage-height, 100dvh) !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        z-index: 2147483646 !important;
        background: #000 !important;
        transform: none !important;
        contain: none !important;
      }

      .${CLASS_PLAYER} #movie_player,
      .${CLASS_PLAYER} .html5-video-player,
      .${CLASS_PLAYER} ytd-player,
      .${CLASS_PLAYER} ytm-player {
        width: 100% !important;
        height: 100% !important;
        min-width: 100% !important;
        min-height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      /* video要素そのもののposition/transformはYouTube/WebKitに任せる。
         ここを強制するとiPhone Safariで映像だけ黒くなることがある。 */

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
        font: 800 clamp(14px, 1.75vw, 20px)/1.15 system-ui, -apple-system, BlinkMacSystemFont, sans-serif !important;
        text-shadow:
          -1px -1px 0 #000,
           1px -1px 0 #000,
          -1px  1px 0 #000,
           1px  1px 0 #000,
           0 2px 4px rgba(0,0,0,.9);
        animation: ytme-scroll var(--ytme-duration, 6s) linear forwards !important;
        will-change: transform;
        display: inline-flex !important;
        align-items: center !important;
        gap: .12em !important;
      }

      #${OVERLAY_ID} .ytme-danmaku img {
        width: 1.55em !important;
        height: 1.55em !important;
        object-fit: contain !important;
        vertical-align: middle !important;
        flex: 0 0 auto !important;
        filter: drop-shadow(0 1px 1px rgba(0,0,0,.65));
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
      || document.querySelector('.html5-video-player')
      || document.querySelector('video')?.parentElement
      || null;
  }

  function getFullscreenTarget(player = getPlayer()) {
    // 一番外側のプレイヤー枠を優先。movie_player自体をfixed/移動すると
    // iPhone Safariのハードウェア動画レイヤーが黒くなることがある。
    return (
      document.querySelector('#player-container-outer') ||
      document.querySelector('#player-container-id') ||
      document.querySelector('#player-container') ||
      document.querySelector('ytm-player') ||
      document.querySelector('ytd-player') ||
      player
    );
  }

  function hasChatFrame() {
    return Boolean(
      document.querySelector(
        'iframe[src*="live_chat"], iframe[src*="live_chat_replay"], ytd-live-chat-frame iframe, ytm-live-chat-frame iframe, #chatframe'
      )
    );
  }

  function primeChatReplay() {
    if (!isWatchPage() || hasChatFrame()) return true;

    const candidates = [
      ...document.querySelectorAll(
        'button, [role="button"], tp-yt-paper-button, yt-button-shape, ytd-button-renderer, ytm-button-renderer'
      ),
    ];

    const ranked = candidates
      .map((el) => {
        const text = [
          el.getAttribute?.('aria-label') || '',
          el.getAttribute?.('title') || '',
          el.textContent || '',
        ].join(' ').replace(/\s+/g, ' ').trim();

        let score = 0;
        if (/チャットのリプレイ/.test(text)) score += 10;
        if (/上位のチャット/.test(text)) score += 8;
        if (/ライブチャット/.test(text)) score += 7;
        if (/チャット/.test(text)) score += 3;
        if (/検索/.test(text)) score -= 20;
        if (/設定/.test(text)) score -= 5;
        return { el, text, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const target = ranked[0]?.el;
    if (!target) return false;

    try {
      target.click();
      return true;
    } catch {
      return false;
    }
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

  function appendRichComment(item, payload) {
    const parts = Array.isArray(payload?.parts) && payload.parts.length
      ? payload.parts
      : [{ type: 'text', text: String(payload?.message || '') }];

    for (const part of parts) {
      if (part?.type === 'image' && part.src) {
        const img = document.createElement('img');
        img.src = String(part.src);
        img.alt = String(part.alt || '');
        img.referrerPolicy = 'no-referrer';
        item.appendChild(img);
        continue;
      }

      const text = String(part?.text || '');
      if (text) item.appendChild(document.createTextNode(text));
    }
  }

  function spawnComment(payload) {
    if (!topState.pseudoFullscreen) return;
    const text = String(payload?.message || '').trim();
    const hasImage = Array.isArray(payload?.parts) && payload.parts.some((part) => part?.type === 'image' && part.src);
    if (!text && !hasImage) return;

    const now = Date.now();
    const id = String(payload.id || `${payload.author || ''}|${text}|${Math.floor(now / 1000)}`);
    if (topState.seen.has(id)) return;
    topState.seen.set(id, now);
    pruneSeen(now);

    const overlay = ensureOverlay();
    if (!overlay) return;
    hideNote();

    const densityText = text || 'stamp';
    const lane = chooseLane(densityText);
    const item = document.createElement('div');
    item.className = 'ytme-danmaku';
    appendRichComment(item, payload);
    item.style.top = `${5 + lane * 10.4}%`;

    const duration = Math.min(8.3, 5.2 + Math.max(0, densityText.length - 8) * 0.03);
    item.style.setProperty('--ytme-duration', `${duration.toFixed(2)}s`);
    item.addEventListener('animationend', () => item.remove(), { once: true });
    overlay.appendChild(item);

    topState.lastCommentAt = now;
  }


  function bootTopChatObserver() {
    const rendererSelector = [
      'yt-live-chat-text-message-renderer',
      'yt-live-chat-paid-message-renderer',
      'yt-live-chat-paid-sticker-renderer',
      'yt-live-chat-membership-item-renderer',
      'yt-live-chat-viewer-engagement-message-renderer',
    ].join(',');

    const seen = new Set();

    const richParts = (root) => {
      if (!root) return [];
      const parts = [];

      const pushText = (value) => {
        const text = String(value || '').replace(/\s+/g, ' ');
        if (!text) return;
        const last = parts[parts.length - 1];
        if (last?.type === 'text') last.text += text;
        else parts.push({ type: 'text', text });
      };

      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          pushText(node.nodeValue || '');
          return;
        }
        if (!(node instanceof Element)) return;
        if (node.tagName === 'IMG') {
          const src = node.currentSrc || node.getAttribute('src') || node.getAttribute('data-src') || '';
          const alt = node.getAttribute('alt') || node.getAttribute('aria-label') || '';
          if (src) parts.push({ type: 'image', src, alt });
          else if (alt) pushText(alt);
          return;
        }
        for (const child of node.childNodes) walk(child);
      };

      walk(root);
      return parts.filter((part) => part.type !== 'text' || String(part.text || '').trim());
    };

    const makePayload = (renderer) => {
      if (!(renderer instanceof Element)) return null;
      const authorEl = renderer.querySelector('#author-name') || renderer.querySelector('.author-name');
      const messageEl =
        renderer.querySelector('#message') ||
        renderer.querySelector('#content-text') ||
        renderer.querySelector('#header-subtext') ||
        renderer.querySelector('#primary-text');

      let parts = richParts(messageEl);
      if (!parts.length) {
        const sticker = renderer.querySelector('img[alt], img[aria-label], img[src]');
        const src = sticker?.currentSrc || sticker?.getAttribute('src') || '';
        const alt = sticker?.getAttribute('alt') || sticker?.getAttribute('aria-label') || '';
        if (src) parts = [{ type: 'image', src, alt }];
        else if (alt) parts = [{ type: 'text', text: alt }];
      }

      const amount =
        textWithEmoji(renderer.querySelector('#purchase-amount')) ||
        textWithEmoji(renderer.querySelector('#purchase-amount-chip'));
      if (amount) parts.push({ type: 'text', text: ` ${amount}` });

      const message = parts
        .map((part) => part.type === 'image' ? (part.alt || '[スタンプ]') : part.text)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      if (!message && !parts.some((part) => part.type === 'image')) return null;

      const author = textWithEmoji(authorEl);
      const id =
        renderer.getAttribute('id') ||
        renderer.getAttribute('data-id') ||
        renderer.dataset?.id ||
        `${renderer.tagName.toLowerCase()}|${author}|${message}`;

      return { type: MESSAGE_TYPE, version: VERSION, id, author, message, parts, at: Date.now() };
    };

    const rememberExisting = () => {
      for (const renderer of document.querySelectorAll(rendererSelector)) {
        const payload = makePayload(renderer);
        if (payload) seen.add(payload.id);
      }
    };

    const observe = () => {
      if (!document.body) {
        setTimeout(observe, 100);
        return;
      }

      rememberExisting();

      const mo = new MutationObserver((mutations) => {
        const candidates = new Set();
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches?.(rendererSelector)) candidates.add(node);
            for (const child of node.querySelectorAll?.(rendererSelector) || []) candidates.add(child);
          }
        }

        for (const renderer of candidates) {
          const payload = makePayload(renderer);
          if (!payload || seen.has(payload.id)) continue;
          seen.add(payload.id);
          topState.frameSeenAt = Date.now();
          spawnComment(payload);
        }

        if (seen.size > 3000) {
          let count = 0;
          for (const id of seen) {
            seen.delete(id);
            if (++count >= 800) break;
          }
        }
      });

      mo.observe(document.body, { childList: true, subtree: true });

      setInterval(() => {
        for (const renderer of document.querySelectorAll(rendererSelector)) {
          const payload = makePayload(renderer);
          if (!payload || seen.has(payload.id)) continue;
          seen.add(payload.id);
          topState.frameSeenAt = Date.now();
          spawnComment(payload);
        }
      }, 260);
    };

    observe();
  }

  function requestBrowserFullscreen(target) {
    if (!target) return false;
    const request =
      target.requestFullscreen ||
      target.webkitRequestFullscreen ||
      target.webkitRequestFullScreen;

    if (typeof request !== 'function') return false;

    try {
      const result = request.call(target, { navigationUI: 'hide' });
      topState.browserFullscreen = true;
      Promise.resolve(result).catch(() => {
        topState.browserFullscreen = false;
      });
      return true;
    } catch {
      topState.browserFullscreen = false;
      return false;
    }
  }

  function exitBrowserFullscreen() {
    try {
      const fn =
        document.exitFullscreen ||
        document.webkitExitFullscreen ||
        document.webkitCancelFullScreen;
      if (typeof fn === 'function') fn.call(document);
    } catch {}
    topState.browserFullscreen = false;
  }

  function enterPseudoFullscreen() {
    if (!isWatchPage() || !isLandscapePhone()) return false;

    // 先にチャットを開く。全画面化してからではUIが動画の下に隠れるため。
    primeChatReplay();

    const player = getPlayer();
    const target = getFullscreenTarget(player);
    if (!player || !target) return false;

    topState.pseudoFullscreen = true;
    topState.player = player;
    topState.fullscreenTarget = target;
    topState.laneUntil = Array(LANES).fill(0);

    ROOT.classList.add(CLASS_FULLSCREEN);
    document.body?.classList.add(CLASS_FULLSCREEN);
    target.classList.add(CLASS_PLAYER);

    const vv = window.visualViewport;
    ROOT.style.setProperty('--ytme-stage-height', `${Math.round(vv?.height || window.innerHeight)}px`);

    // fixedにはしない。外側レイアウトだけを1画面に畳む。
    for (const [prop, value] of [
      ['position', 'relative'],
      ['width', '100vw'],
      ['height', 'var(--ytme-stage-height)'],
      ['max-width', 'none'],
      ['max-height', 'none'],
      ['margin', '0'],
      ['z-index', '2147483646'],
      ['background', '#000'],
    ]) {
      target.style.setProperty(prop, value, 'important');
    }

    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch { window.scrollTo(0, 0); }

    ensureOverlay();
    showNote(hasChatFrame() || Date.now() - topState.frameSeenAt < 5000 ? 'コメント待機中…' : 'チャットを準備中…');

    setTimeout(() => {
      primeChatReplay();
      if (topState.pseudoFullscreen && !hasChatFrame() && Date.now() - topState.frameSeenAt > 5000) {
        showNote('チャットリプレイを読み込み中…');
      }
    }, 350);

    for (const delay of [900, 1600, 2600]) {
      setTimeout(() => {
        if (!topState.pseudoFullscreen) return;
        if (!hasChatFrame() && Date.now() - topState.frameSeenAt > 1800) primeChatReplay();
      }, delay);
    }

    return true;
  }

  function exitPseudoFullscreen() {
    topState.pseudoFullscreen = false;
    if (topState.browserFullscreen) exitBrowserFullscreen();
    ROOT.classList.remove(CLASS_FULLSCREEN);
    document.body?.classList.remove(CLASS_FULLSCREEN);

    const target = topState.fullscreenTarget;
    target?.classList?.remove(CLASS_PLAYER);
    document.querySelectorAll(`.${CLASS_PLAYER}`).forEach((el) => el.classList.remove(CLASS_PLAYER));

    if (target) {
      for (const prop of ['position','inset','width','height','max-width','max-height','margin','z-index','background','transform']) {
        target.style.removeProperty(prop);
      }
    }
    ROOT.style.removeProperty('--ytme-stage-height');

    document.getElementById(OVERLAY_ID)?.remove();
    topState.player = null;
    topState.fullscreenTarget = null;
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

    // 横向き + 全画面ボタンで専用モードへ。
    // ブラウザのURL/タブUIを消すにはユーザー操作からFullscreen APIを呼ぶ必要がある。
    if (topState.pseudoFullscreen && !landscape) {
      exitBrowserFullscreen();
      exitPseudoFullscreen();
    }

    if (topState.pseudoFullscreen) {
      const vv = window.visualViewport;
      ROOT.style.setProperty('--ytme-stage-height', `${Math.round(vv?.height || window.innerHeight)}px`);
    }

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

  // 横向きではWebKitのネイティブ動画全画面へ渡すとDOMコメントを重ねられないため、
  // YouTube標準の全画面操作は専用モード側で受け止める。
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const control =
      target?.closest?.('.ytp-fullscreen-button') ||
      target?.closest?.('button');

    if (!control || !isLandscapePhone()) return;

    const label = [
      control.getAttribute?.('aria-label') || '',
      control.getAttribute?.('title') || '',
      control.getAttribute?.('data-title-no-tooltip') || '',
      control.className || '',
    ].join(' ');

    if (!/full.?screen|fullscreen|全画面|ytp-fullscreen/i.test(String(label))) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (!topState.pseudoFullscreen) enterPseudoFullscreen();

    // Safari上部のURL欄・タブ列はWebページのCSSでは消せないため、
    // ユーザーが全画面を押したこの瞬間だけブラウザFullscreen APIを試す。
    const fullscreenTarget = topState.fullscreenTarget || getFullscreenTarget(topState.player || getPlayer());
    requestBrowserFullscreen(fullscreenTarget);
  }, true);

  document.addEventListener('fullscreenchange', () => {
    topState.browserFullscreen = Boolean(document.fullscreenElement);
    scheduleRefresh();
  });
  document.addEventListener('webkitfullscreenchange', () => {
    topState.browserFullscreen = Boolean(document.webkitFullscreenElement);
    scheduleRefresh();
  });

  window.addEventListener('resize', scheduleRefresh, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleRefresh, { passive: true });
  window.addEventListener('orientationchange', scheduleRefresh, { passive: true });
  window.addEventListener('popstate', scheduleRefresh, { passive: true });
  document.addEventListener('yt-navigate-finish', scheduleRefresh, true);
  document.addEventListener('DOMContentLoaded', scheduleRefresh, { once: true });

  const boot = () => {
    injectStyle();
    bootTopChatObserver();
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

// ==UserScript==
// @name         N3 YouTube Speed Dial (active tab only)
// @namespace    local.n3.m60
// @version      1.2.0
// @description  N3 rotary dial: YouTube, Nicovideo, NicoLive timeshift and other HTML5 videos. F13/F14: 1 / 1.25 / 1.5 / 2 / 4x.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/N3_YouTube_Speed_Dial.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/N3_YouTube_Speed_Dial.user.js
// ==/UserScript==
(() => {
  'use strict';

  // Only a focused browser tab (or focused embedded player frame) receives N3 keys.
  // Runs on all HTTP(S) pages to support ordinary HTML5 video sites. It does not
  // request resources, send data, or read site contents outside <video> elements.
  const SPEEDS = [1, 1.25, 1.5, 2, 4];
  const VIDEO_REVERT_CHECK_MS = 700;
  const isNicoVideo = /(^|\.)nicovideo\.jp$/i.test(location.hostname) &&
    !/^live\./i.test(location.hostname);
  const isNicoLive = /^live\.nicovideo\.jp$/i.test(location.hostname);
  const isKnownSite = /(^|\.)(youtube\.com|nicovideo\.jp)$/i.test(location.hostname);

  let toast = null;
  let toastTimer = 0;
  let lastSpeedChange = 0;

  function visibleArea(el) {
    try {
      const rect = el.getBoundingClientRect();
      const area = Math.min(Math.max(rect.right, 0), innerWidth) -
        Math.max(rect.left, 0);
      const height = Math.min(Math.max(rect.bottom, 0), innerHeight) -
        Math.max(rect.top, 0);
      return Math.max(0, area) * Math.max(0, height);
    } catch {
      return 0;
    }
  }

  function findVideo() {
    // On most supported sites the actual HTML5 video element is in this document.
    // If an embed lives in its own frame, that frame receives F13/F14 when focused.
    const all = Array.from(document.querySelectorAll('video'))
      .filter(v => v.isConnected && v.getBoundingClientRect().width > 45);
    if (!all.length) return null;
    const full = document.fullscreenElement;
    const scoped = full ? all.filter(v => full.contains(v) || full === v) : [];
    const videos = scoped.length ? scoped : all;
    videos.sort((a, b) => {
      const score = v => (v.paused || v.ended ? 0 : 1e8) +
        visibleArea(v) + (v.readyState > 0 ? 1e7 : 0);
      return score(b) - score(a);
    });
    return videos[0];
  }

  function display(message) {
    if (toast) toast.remove();
    const host = document.fullscreenElement || document.body || document.documentElement;
    toast = document.createElement('div');
    toast.textContent = '⏩ ' + message;
    toast.setAttribute('role', 'status');
    toast.style.cssText =
      'position:fixed;top:7vh;left:50%;transform:translateX(-50%);' +
      'z-index:2147483647;background:#232832;color:#fff;' +
      'border:1px solid #3a414e;padding:12px 24px;border-radius:9px;' +
      'font:600 18px "Segoe UI",sans-serif;box-shadow:0 5px 20px #0005;' +
      'pointer-events:none;white-space:nowrap;max-width:85vw;' +
      'overflow:hidden;text-overflow:ellipsis;';
    host.appendChild(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toast) toast.remove();
      toast = null;
    }, 1450);
  }

  function fmt(n) {
    return Number(n).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function nextSpeed(current, direction) {
    const eps = 0.005;
    if (direction > 0) {
      return SPEEDS.find(s => s > current + eps) ?? SPEEDS[SPEEDS.length - 1];
    }
    for (let i = SPEEDS.length - 1; i >= 0; i--) {
      if (SPEEDS[i] < current - eps) return SPEEDS[i];
    }
    return SPEEDS[0];
  }

  window.addEventListener('keydown', e => {
    if (!['F13', 'F14'].includes(e.key) || e.repeat) return;
    const video = findVideo();
    if (!video) {
      if (isKnownSite) display('動画プレイヤーが見つかりません');
      return;
    }

    // Preserve existing Windows/N3 bridge behavior: modifiers may be held
    // when it sends F13/F14. Do not filter Ctrl/Alt/Shift or focused inputs.
    e.preventDefault();
    e.stopImmediatePropagation();

    // F13: clockwise (faster), F14: counterclockwise (slower).
    const target = nextSpeed(video.playbackRate, e.key === 'F13' ? 1 : -1);
    const token = ++lastSpeedChange;
    try {
      video.playbackRate = target;
    } catch {
      display('このプレイヤーでは速度変更できません');
      return;
    }

    const applied = video.playbackRate;
    if (Math.abs(applied - target) > 0.01) {
      display('サイト側で速度が制限されています');
      return;
    }
    display(fmt(applied) + '倍速');

    // Some sites (especially Nicovideo) immediately overwrite playbackRate
    // from their internal state. Report it; do not force an endless tug of war.
    if (isNicoVideo || isNicoLive) {
      setTimeout(() => {
        if (token !== lastSpeedChange || !video.isConnected) return;
        if (Math.abs(video.playbackRate - target) > 0.03) {
          display(isNicoVideo
            ? 'ニコニコ側が速度を戻しました'
            : 'ニコ生側が速度を戻しました');
        }
      }, VIDEO_REVERT_CHECK_MS);
    }
  }, true);
})();
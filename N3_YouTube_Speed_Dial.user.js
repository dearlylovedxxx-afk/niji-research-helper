// ==UserScript==
// @name         N3 YouTube Speed Dial (active tab only)
// @namespace    local.n3.m60
// @version      1.3.0
// @description  N3 speed dial: YouTube, NicoVideo (sync playback state), NicoLive timeshift, and HTML5 videos. 1/1.25/1.5/2/4x.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/N3_YouTube_Speed_Dial.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/N3_YouTube_Speed_Dial.user.js
// ==/UserScript==
(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // NicoVideo player-state synchronization (only www.nicovideo.jp/watch/)
  //
  // Adapted from "Nicovideo speed limit unlocker" v1.1 by Eluentyw
  // https://greasyfork.org/scripts/572657-nicovideo-speed-limit-unlocker
  // Original author declares MIT License. Copyright remains with Eluentyw.
  //
  // MIT License permission notice:
  // Permission is hereby granted, free of charge, to any person obtaining
  // a copy of this software and associated documentation files (the
  // "Software"), to deal in the Software without restriction, including
  // without limitation the rights to use, copy, modify, merge, publish,
  // distribute, sublicense, and/or sell copies of the Software, and to
  // permit persons to whom the Software is furnished to do so, subject to
  // the following conditions:
  // The above copyright notice and this permission notice shall be included
  // in all copies or substantial portions of the Software.
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  // IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  // CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  // TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  // SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
  // ---------------------------------------------------------------------
  if (location.hostname === 'www.nicovideo.jp' &&
      location.pathname.startsWith('/watch/')) {
    const capturedControllers = new WeakSet();
    const originalDefineProperty = Object.defineProperty;

    function captureController(controller, method, periodic) {
      if (!controller || typeof controller !== 'object' ||
          typeof method !== 'function' || capturedControllers.has(controller)) return;
      capturedControllers.add(controller);
      let syncing = false;
      const sync = () => {
        if (syncing) return;
        const video = document.querySelector('video');
        if (!video || !Number.isFinite(video.playbackRate)) return;
        if (Math.abs(controller.playbackRate - video.playbackRate) <= 0.001) return;
        syncing = true;
        try { method.call(controller, video.playbackRate); }
        catch (_) { /* Player may not yet be initialized. */ }
        finally { syncing = false; }
      };
      window.addEventListener('ratechange', sync, true);
      if (periodic) setInterval(sync, 1000);
    }

    // Capture the playback-rate state method when NicoVideo defines it.
    Object.defineProperty = function(obj, prop, descriptor) {
      if (prop === 'setPlaybackRate' && descriptor &&
          typeof descriptor.value === 'function') {
        captureController(obj, descriptor.value, true);
      }
      return Reflect.apply(originalDefineProperty, this, arguments);
    };

    // Also cover direct assignments, used by some versions of the player.
    const priorDescriptor =
      Object.getOwnPropertyDescriptor(Object.prototype, 'setPlaybackRate');
    if (!priorDescriptor || priorDescriptor.configurable) {
      originalDefineProperty(Object.prototype, 'setPlaybackRate', {
        configurable: true,
        set: function(fn) {
          if (typeof fn === 'function' && this.contents) {
            captureController(this, fn, false);
          }
          this.__setPlaybackRate = fn;
        },
        get: function() { return this.__setPlaybackRate; }
      });
    }
  }


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
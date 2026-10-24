// ==UserScript==
// @name         N3 YouTube Speed Dial (active tab only)
// @namespace    local.n3.m60
// @version      1.1.0
// @description  Adjust only the foreground YouTube video's speed with N3 F13/F14 knob signals. Steps: 1.0 / 1.25 / 1.5 / 2.0 / 4.0.
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/N3_YouTube_Speed_Dial.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/N3_YouTube_Speed_Dial.user.js
// ==/UserScript==
(() => {
  'use strict';
  const SPEEDS = [1.0, 1.25, 1.5, 2.0, 4.0];
  let toast = null;
  let timer = 0;
  const playable = () => [...document.querySelectorAll('video')]
    .filter(v => v.isConnected && v.readyState > 0 && v.getBoundingClientRect().width > 60);
  function video() {
    const list = playable();
    return list.find(v => !v.paused && !v.ended) || list[0] || null;
  }
  function notify(message) {
    if (toast) toast.remove();
    const host = document.fullscreenElement || document.body || document.documentElement;
    toast = document.createElement('div');
    toast.textContent = '⏩ ' + message;
    toast.style.cssText = 'position:fixed;top:7vh;left:50%;transform:translateX(-50%);'+
      'z-index:2147483647;background:#232832;color:#fff;border:1px solid #3a414e;'+
      'padding:12px 25px;border-radius:8px;font:600 19px Segoe UI, sans-serif;'+
      'box-shadow:0 5px 20px #0005;pointer-events:none;white-space:nowrap;';
    host.appendChild(toast);
    clearTimeout(timer);
    timer = setTimeout(() => { if (toast) toast.remove(); toast=null; }, 1400);
  }
  window.addEventListener('keydown', event => {
    if (!['F13','F14'].includes(event.key) || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(active.tagName))) return;
    const v = video();
    if (!v) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = v.playbackRate;
    const eps = 0.005;
    let idx;
    if (event.key === 'F13') {
      idx = SPEEDS.findIndex(s => s > current + eps);
      if (idx < 0) idx = SPEEDS.length - 1;
    } else {
      idx = -1;
      for (let i=SPEEDS.length-1;i>=0;i--) if (SPEEDS[i] < current-eps) {idx=i;break;}
      if (idx<0) idx=0;
    }
    const next = SPEEDS[idx];
    if (Math.abs(next-current)>eps) v.playbackRate = next;
    const applied = v.playbackRate;
    notify(`${applied.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}倍速`);
  }, true);
})();
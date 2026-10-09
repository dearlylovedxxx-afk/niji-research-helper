// ==UserScript==
// @name         Niji Research Helper
// @namespace    niji-pov-helper
// @version      1.0.104
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Research_Helper.meta.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Research_Helper.user.js
// @description  comment2434 と YouTube をつなぐ調査支援ツール。IndexedDB蓄積、Holodexの429待機制御、Wiki照合状況の見える化でアーカイブ調査を安定化します。
// @author       ChatGPT + user
// @match        https://comment2434.com/comment/*
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://youtube.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.addStyle
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @grant        GM.openInTab
// @connect      holodex.net
// @connect      www.googleapis.com
// @connect      wikiwiki.jp
// @connect      niji-research-backup.dearlylovedxxx.workers.dev
// @run-at       document-idle
// @noframes
// ==/UserScript==
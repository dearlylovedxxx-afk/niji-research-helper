// ==UserScript==
// @name         Pixiv イラスト・小説 ブクマ順（検索結果横断）
// @namespace    local.pixiv.bookmark-sort.cross-page
// @version      0.5.3
// @description  ブックマーク順の検索結果を、スマホでも見える独立した一覧に表示。
// @match        https://www.pixiv.net/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @require      https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/9eb97e51cedba0d081db3cc7331ecc8c01ea6685/Pixiv_Bookmark_Sort.user.js
// ==/UserScript==
(() => {
  'use strict';
  // v0.5.2 を同じリポジトリの固定コミットから読み込む。DB・調査結果はそのまま。
  const oldHostId = 'pixiv-bookmark-sort-cross-page-v05';
  let attached = false;
  function attachViewer() {
    if (attached) return true;
    const host = document.getElementById(oldHostId), root = host && host.shadowRoot;
    const source = root && root.querySelector('.results');
    const counted = root && root.querySelector('.counted');
    if (!source || !counted) return false;
    attached = true;
    const css = document.createElement('style');
    css.textContent = `
      .pbs-view-button { display:block!important; width:100%!important; padding:13px!important;
        margin:10px 0 0!important; border:0!important; border-radius:9px!important;
        background:#1976d2!important; color:#fff!important; font-size:16px!important;
        font-weight:700!important; cursor:pointer!important; }
      .pbs-overlay { display:none!important; position:fixed!important; inset:0!important;
        width:100vw!important; height:100vh!important; height:100dvh!important;
        background:#f5f6fb!important; z-index:2147483647!important;
        overflow-y:scroll!important; -webkit-overflow-scrolling:touch; }
      .pbs-overlay.pbs-open { display:block!important; }
      .pbs-header { position:sticky; top:0; z-index:1; background:white;
        border-bottom:1px solid #ddd; padding:12px; color:#263040; }
      .pbs-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .pbs-toolbar strong { font-size:17px; }
      .pbs-back { color:#263040!important; font-size:14px!important; }
      .pbs-summary { font-size:12px; color:#586277; margin-top:7px; line-height:1.5; }
      .pbs-list { display:block!important; padding:10px 10px 70px!important; }
      .pbs-row { display:flex!important; align-items:flex-start!important; gap:12px!important;
        margin:0 0 10px!important; padding:10px!important; min-height:65px!important;
        background:#fff!important; border:1px solid #e2e6ed!important;
        border-radius:10px!important; text-decoration:none!important; color:#263040!important; }
      .pbs-row img { display:block!important; flex:none!important; width:76px!important;
        height:100px!important; max-width:76px!important; object-fit:contain!important;
        background:#eef0f4!important; }
      .pbs-row .info { display:block!important; min-width:0!important; flex:1!important;
        padding:0!important; font-size:13px!important; overflow-wrap:anywhere!important; }
      .pbs-row .num,.pbs-row .count { color:#c52650!important; font-size:16px!important;
        font-weight:800!important; margin-bottom:5px!important; }
      .pbs-row .title,.pbs-row .name { font-size:13px!important; font-weight:600!important; }
      .pbs-row .author { font-size:12px!important; color:#667286!important; margin-top:5px!important; }
    `;
    root.appendChild(css);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'pbs-view-button';
    button.textContent = '📚 ブクマ順の結果を見る';
    counted.after(button);
    const overlay = document.createElement('section');
    overlay.className = 'pbs-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<div class='pbs-header'>
      <div class='pbs-toolbar'><strong>♥ ブックマーク数順</strong>
      <button type='button' class='pbs-back'>← 調査画面へ戻る</button></div>
      <div class='pbs-summary'></div></div><div class='pbs-list'></div>`;
    root.appendChild(overlay);
    const list = overlay.querySelector('.pbs-list');
    function showResults() {
      const cards = Array.from(source.querySelectorAll('a.card'));
      const fragment = document.createDocumentFragment();
      for (const card of cards) {
        const copy = card.cloneNode(true);
        copy.className = 'pbs-row';
        fragment.appendChild(copy);
      }
      if (!cards.length) {
        const p = document.createElement('p');
        p.textContent = 'まだ表示できる作品がありません。調査結果が表示されるまで少し待つか、最低ブクマ数を下げてください。';
        p.style.cssText = 'padding:15px;color:#586277;font-size:13px;';
        fragment.appendChild(p);
      }
      list.replaceChildren(fragment);
      overlay.querySelector('.pbs-summary').textContent =
        counted.textContent + ' ／ 一覧を表示中：' + cards.length + '作品';
    }
    button.addEventListener('click', () => {
      showResults(); overlay.classList.add('pbs-open'); overlay.scrollTop = 0;
    });
    overlay.querySelector('.pbs-back').addEventListener('click', () => overlay.classList.remove('pbs-open'));
    // 取得が続く場合にも、表示中の一覧を自動で更新する。
    new MutationObserver(() => {
      if (overlay.classList.contains('pbs-open')) showResults();
    }).observe(source, { childList: true });
    const oldClose = root.querySelector('.close');
    if (oldClose) oldClose.addEventListener('click', () => overlay.classList.remove('pbs-open'));
    return true;
  }
  if (!attachViewer()) {
    let count = 0;
    const t = setInterval(() => { if (attachViewer() || ++count > 120) clearInterval(t); }, 250);
  }
})();
// ==UserScript==
// @name         YouTube にじさんじ サイドバー
// @namespace    marina.youtube.nijisanji.sidebar
// @version      0.1.3
// @description  登録チャンネルの上に、にじさんじライバーをデビュー年・デビュー日順に表示（卒業・活動終了も区別）。
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @connect      wikiwiki.jp
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Nijisanji_Sidebar.meta.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/YouTube_Nijisanji_Sidebar.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.__marinaNijisanjiSidebarV1) return;
  window.__marinaNijisanjiSidebarV1 = true;

  const ROOT_ID = 'marina-niji-yt-guide';
  const CSS_ID = 'marina-niji-yt-css';
  const STATE_KEY = 'marina-niji-yt-open-v1';
  const CACHE_KEY = 'marina-niji-yt-roster-v1';
  const CACHE_MS = 24 * 60 * 60 * 1000;
  const WIKI = 'https://wikiwiki.jp/nijisanji/';
  const CHANNEL_PAGE = WIKI + encodeURIComponent('活動場所') + '/YouTube';
  const ROSTER_PAGE = WIKI + encodeURIComponent('公式ライバー');
  const normalize = s => String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/Ⅲ/g, 'III')
    .replace(/[・･·]/g, '・').trim();
  const text = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  const defaultState = {open:false, years:{}};
  let state = loadState();
  let roster = readCache();
  let loading = false;
  let lastError = '';
  let cloudStatus = '☁️ Niji Cloud同期を確認中';
  let host = null;
  let pendingMount = false;
  window.addEventListener('nijisanji-sidebar:cloud-applied',()=>{
    state=loadState();
    const fresh=readCache();
    if(fresh) roster=fresh;
    render();
  });
  window.addEventListener('nijisanji-sidebar:cloud-status',event=>{
    cloudStatus=String(event.detail?.message||'☁️ Niji Cloud状態不明');
    render();
  });

  function loadState() {
    try {
      const data = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      return {open:data.open === true, years:data.years && typeof data.years === 'object' ? data.years : {}};
    } catch { return {...defaultState}; }
  }
  function tellCloud() {
    try { window.dispatchEvent(new CustomEvent('nijisanji-sidebar:changed',{detail:{schema:1}})); } catch {}
  }
  function persistState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
    tellCloud();
  }
  function readCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!value || !Array.isArray(value.items) || value.items.length < 10) return null;
      return value;
    } catch { return null; }
  }
  function saveCache(items) {
    const value = {at:Date.now(),items};
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch {}
    roster = value;
    tellCloud();
  }
  function validYouTubeUrl(raw) {
    try {
      const url = new URL(raw, WIKI);
      if (!['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)) return '';
      if (!(/^\/@[^/]+/.test(url.pathname) || /^\/channel\/UC[a-zA-Z0-9_-]{22}(?:\/|$)/.test(url.pathname))) return '';
      return 'https://www.youtube.com' + url.pathname.replace(/\/$/,'');
    } catch { return ''; }
  }

  function requestWiki(url) {
    return new Promise((resolve,reject) => {
      const modern = typeof GM !== 'undefined'
        ? (GM.xmlHttpRequest || GM.xmlhttpRequest) : null;
      const legacy = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;
      const fn = typeof modern === 'function' ? modern.bind(GM) : legacy;
      if (!fn) {
        reject(new Error('Wiki取得権限がありません。TampermonkeyでWikiへの接続を許可してください。'));
        return;
      }
      try {
        const req = fn({
          method:'GET', url, timeout:20000, responseType:'text',
          onload:res => {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error('Wiki HTTP ' + res.status)); return;
            }
            const documentResponse=res.response?.nodeType===9 ? res.response : null;
            const html = String(res.responseText ?? (typeof res.response==='string'?res.response:''));
            if (!documentResponse && !html.trim()) {reject(new Error('Wikiから空の応答がありました'));return;}
            resolve(documentResponse || html);
          },
          onerror:() => reject(new Error('Wikiに接続できませんでした')),
          ontimeout:() => reject(new Error('Wikiの応答がタイムアウトしました'))
        });
        if (req && typeof req.then === 'function') {
          req.then(r => resolve(String(r?.responseText ?? r?.response ?? ''))).catch(reject);
        }
      } catch (err) { reject(err); }
    });
  }

  // Convert both Wiki-rendered HTML and raw Wiki-style text into a
  // line-oriented representation. This intentionally ignores nav/sidebar lists.
  function parseWikiDocument(html) {
    // YouTube requires TrustedHTML for DOMParser on Chromium/Edge.
    if (html?.nodeType === 9 && html.documentElement) return html;
    const raw = String(html || '');
    let trusted = raw;
    const tt = globalThis.trustedTypes;
    if (tt?.createPolicy) {
      try {
        const name = 'marina-niji-wiki-parser';
        const policy = tt.getPolicy?.(name) || tt.createPolicy(name,{createHTML:value=>value});
        trusted = policy.createHTML(raw);
      } catch (error) {
        throw new Error('YouTubeのTrusted Types制限でWikiを解析できません：'+String(error?.message||error));
      }
    }
    return new DOMParser().parseFromString(trusted, 'text/html');
  }
  function wikiLines(html, type) {
    const doc = parseWikiDocument(html);
    const rawSources = [
      doc.querySelector('#content')?.textContent || '',
      doc.querySelector('main')?.textContent || '',
      doc.body?.textContent || ''
    ];
    for (const raw of rawSources) {
      if ((raw.match(/^\s*[-*]{1,2}[^\n]{2,100}/gm) || []).length >= 60
        && (raw.includes('[[',0) || raw.includes('&icon(',0))) {
        return {lines:raw.split(/\r?\n/),icons:{}};
      }
    }

    const scopes = [
      doc.querySelector('.wiki-content'),
      doc.querySelector('#content'),
      doc.querySelector('#body'),
      doc.querySelector('main'),
      doc.querySelector('article'),
      doc.body
    ].filter(Boolean);
    let scope = scopes[0];
    for (const root of scopes) {
      const count = root.querySelectorAll('a[href*="youtube.com"],a[href*="youtu.be"]').length;
      if (type === 'channels' ? count >= 80 : root.querySelectorAll('li').length >= 100) {
        scope = root; break;
      }
    }
    if (!scope) return {lines:[],icons:{}};
    const lines = [];
    const icons = {};
    const nodes = [...scope.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li')];

    // Wiki headings sometimes have date text in bare div/text nodes, not p.
    // Capture those text nodes in their original DOM order so debut dates
    // cannot silently disappear while channel links still parse correctly.
    if (type === 'official') {
      const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest('li,p,h1,h2,h3,h4,h5,h6,nav,header,footer,aside,script,style')) continue;
        const t = text(node.nodeValue);
        if (t.length > 500 || !/20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(t)) continue;
        if (!/デビュー|公式デビュー日/.test(t)) continue;
        nodes.push(node);
      }
      nodes.sort((a,b) => {
        if (a === b) return 0;
        return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
      });
    }
    for (const el of nodes) {
      if (el.nodeType === Node.TEXT_NODE) {
        lines.push(text(el.nodeValue));
        continue;
      }
      if (el.closest('nav,header,footer,aside')) continue;
      if (el.tagName === 'P' && el.closest('li')) continue;
      if (el.tagName === 'LI' && el.querySelector('li')) continue;
      if (/^H[1-6]$/.test(el.tagName)) {
        const title = text(el.textContent);
        if (/^(?:元メンバー|メンバー)$/.test(title)) {
          lines.push('#shadowheader(3,' + title + ')');
        } else {
          lines.push('**' + title);
        }
        continue;
      }
      if (el.tagName === 'P') {
        const t = text(el.textContent);
        if (t && t.length < 800) lines.push(t);
        continue;
      }
      if (type === 'channels') {
        const yt = [...el.querySelectorAll('a[href]')].map(a => validYouTubeUrl(a.getAttribute('href'))).find(Boolean);
        if (!yt) continue;
        const label = text(el.textContent).split(/[：:]/)[0];
        if (!label || label.length > 90) continue;
        const retired = /background(?:-color)?\s*:\s*(?:#ddd\b|#dddddd\b|rgb\(\s*221\s*,\s*221\s*,\s*221\s*\))/i.test(el.outerHTML);
        lines.push('-' + (retired ? '&color(,#ddd){' : '') + label + '：[[' + label + '>' + yt + ']]');
      } else {
        const t = text(el.textContent);
        if (!t || t.length > 350) continue;
        let name = '';
        const img = el.querySelector('img[alt]');
        if (img && img.getAttribute('alt')) name = text(img.getAttribute('alt'));
        if (!name) {
          const a = [...el.querySelectorAll('a[href]')].find(a =>
            /\/nijisanji\//.test(a.getAttribute('href') || '') && text(a.textContent).length <= 32);
          if (a) name = text(a.textContent);
        }
        if (!name) name = t.split(/[（(]/)[0].replace(/\s*\[[^\]]+\].*$/, '').trim();
        if (!name || name.length > 40) continue;
        lines.push('-&icon(25,' + name + ');[[' + name + ']]');
        const picture = el.querySelector('img[src]');
        if (picture) {
          try {
            const url = new URL(picture.getAttribute('src'), WIKI).href;
            if (url.startsWith('https://')) icons[normalize(name)] = url;
          } catch {}
        }
      }
    }
    return {lines,icons};
  }

  function parseChannelLines(lines) {
    let year = 2018, enabled = false, ordinal = 0;
    const records = [];
    const found = new Set();
    for (let raw of lines) {
      raw = String(raw || '').trim();
      if (!raw || raw.startsWith('//')) continue;
      const header = raw.match(/^\*\*?\s*([^[]+)/);
      if (header) {
        const title = text(header[1]);
        const y = title.match(/(20(?:1[8-9]|2\d))年デビュー/);
        if (y) {year=Number(y[1]);enabled=true;}
        else if (/^(?:1期生出身|2期生出身|ゲーマーズ出身|SEEDs[12１２]期生出身)/i.test(title)) {
          year=2018;enabled=true;
        } else if (/NIJISANJI\s*(?:ID|KR|EN|IN)|VirtuaReal|海外|公式チャンネル/i.test(title)) {
          enabled=false;
        }
      }
      if (!enabled || !raw.startsWith('-')) continue;
      const urlMatch = raw.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[^\s\],>};]+|channel\/UC[a-zA-Z0-9_-]{22})/i);
      if (!urlMatch) continue;
      const url = validYouTubeUrl(urlMatch[0]);
      if (!url) continue;
      const graduated = /&color\(,\s*#d{3,6}\)/i.test(raw);
      let label = raw.split(/[：:]/)[0]
        .replace(/^-\s*/, '')
        .replace(/&color\([^)]*\)\{/g,'')
        .replace(/&ref\([^)]*\);/g,'')
        .replace(/&icon\([^)]*\);/g,'')
        .replace(/[{}]/g,'').trim();
      label = label.replace(/&[^;]+;/g,'').trim();
      if (!label || label.length > 45) continue;
      const key = normalize(label);
      if (found.has(key)) continue;
      found.add(key);
      records.push({name:label, year, url, graduated, order:ordinal++, date:'', avatar:''});
    }
    return records;
  }

  function parseOfficialLines(lines) {
    let enabled = false, former = false;
    let date = '', cohortDate = '', order = 0;
    const map = new Map();
    for (let raw of lines) {
      raw = String(raw || '').trim();
      if (!raw || raw.startsWith('//')) continue;
      const header = raw.match(/^\*\*?\s*([^[]+)/);
      if (header) {
        const title = text(header[1]);
        if (/NIJISANJI\s*(?:ID|KR|EN|IN)|VirtuaReal/i.test(title)) enabled=false;
        else if (/^(?:1期生出身|2期生出身|ゲーマーズ出身|SEEDs[12１２]期生出身)|20(?:1[8-9]|2\d)年.*デビュー/.test(title)) {
          enabled=true;former=false;date='';cohortDate='';
        }
      }
      if (!enabled) continue;
      if (/^(?:#shadowheader\(3,)?元メンバー/.test(raw)) {
        former = true; date=cohortDate;continue;
      }
      if (/^(?:#shadowheader\(3,)?メンバー/.test(raw)) {
        former = false;date=cohortDate;continue;
      }
      if (!raw.startsWith('-')) {
        const official = raw.match(/公式デビュー日は\s*(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
        const announced = raw.match(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\s*デビュー/);
        const value = official || announced;
        if (value) {
          date=value[1]+'-'+value[2].padStart(2,'0')+'-'+value[3].padStart(2,'0');
          if (!former && !cohortDate) cohortDate=date;
        }
        continue;
      }
      const icon = raw.match(/&icon\(\s*25\s*,\s*([^)]+)\)/);
      const inner = raw.match(/\[\[([^\]>]+)(?:>[^\]]+)?\]\]/);
      const name = (icon?.[1] || inner?.[1] || '').replace(/&[^;]+;/g,'').trim();
      if (!name || name.length > 42) continue;
      const key=normalize(name);
      const isFormer=former || (/(?:卒業|活動終了|契約解除)/.test(raw) && !/復帰/.test(raw));
      map.set(key,{date,graduated:isFormer,order:order++});
    }
    return map;
  }

  function mergeRoster(channels,official,icons) {
    const merged=channels.map(row => {
      const match=official.get(normalize(row.name));
      const date=match?.date || '';
      const y=date ? Number(date.slice(0,4)) : row.year;
      return {...row,year:y,date,graduated:match?.graduated ?? row.graduated,avatar:icons[normalize(row.name)] || ''};
    }).filter(row => row.year>=2018 && row.year<=2099 && !!row.url);
    merged.sort((a,b)=> a.year-b.year ||
      (a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : 0) ||
      a.order-b.order);
    return merged;
  }

  async function updateRoster(force=false) {
    if (loading) return;
    if (!force && roster && Date.now()-roster.at < CACHE_MS) return;
    loading=true;lastError='';render();
    const fetched=await Promise.allSettled([requestWiki(CHANNEL_PAGE),requestWiki(ROSTER_PAGE)]);
    try {
      if (fetched[0].status!=='fulfilled') throw fetched[0].reason;
      const c=wikiLines(fetched[0].value,'channels');
      const channels=parseChannelLines(c.lines);
      if (channels.length < 90) throw new Error('チャンネル一覧の解析件数が少なすぎます（'+channels.length+'件）。旧データを保持します。');
      let official=new Map(),icons={};
      if (fetched[1].status==='fulfilled') {
        const r=wikiLines(fetched[1].value,'official');
        official=parseOfficialLines(r.lines);
        icons=r.icons;
      }
      const items=mergeRoster(channels,official,icons);
      if (items.length < 90) throw new Error('保存できるライバー情報が不足しています');
      saveCache(items);
    } catch(e) {
      lastError=String(e?.message || e);
    } finally { loading=false;render(); }
  }

  function styles() {
    if (document.getElementById(CSS_ID)) return;
    const st=document.createElement('style');
    st.id=CSS_ID;
    st.textContent=[
      '#'+ROOT_ID+'{color:var(--yt-spec-text-primary,#0f0f0f);font-family:Roboto,Arial,sans-serif;padding:4px 0 12px;border-bottom:1px solid var(--yt-spec-10-percent-layer,#ddd);margin-bottom:8px}',
      '#'+ROOT_ID+' *{box-sizing:border-box}',
      '#'+ROOT_ID+' button{border:0;background:none;color:inherit;cursor:pointer;font:inherit;text-align:left}',
      '#'+ROOT_ID+' .nj-head{display:flex;align-items:center;gap:12px;width:calc(100% - 12px);padding:9px 12px;margin:0 6px;border-radius:10px;font-size:14px;font-weight:600;min-height:40px}',
      '#'+ROOT_ID+' .nj-head:hover,#'+ROOT_ID+' .nj-year:hover,#'+ROOT_ID+' .nj-person:hover{background:var(--yt-spec-10-percent-layer,rgba(127,127,127,.1))}',
      '#'+ROOT_ID+' .nj-symbol{display:flex;justify-content:center;align-items:center;width:24px;height:24px;font-size:19px;flex-shrink:0}',
      '#'+ROOT_ID+' .nj-chevron{margin-left:auto;font-size:12px;color:var(--yt-spec-text-secondary,#777)}',
      '#'+ROOT_ID+' .nj-year{width:calc(100% - 12px);margin:0 6px;border-radius:10px;padding:8px 12px 8px 28px;min-height:36px;font-size:13px;display:flex;align-items:center;gap:10px}',
      '#'+ROOT_ID+' .nj-year .nj-chevron{margin-left:0;width:11px}',
      '#'+ROOT_ID+' .nj-rows{padding:0 4px 0 19px}',
      '#'+ROOT_ID+' .nj-person{min-height:40px;margin:1px 4px;padding:5px 7px;border-radius:10px;display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none;font-size:13px;white-space:nowrap;overflow:hidden}',
      '#'+ROOT_ID+' .nj-person.nj-former{background:rgba(128,128,128,.15);color:var(--yt-spec-text-secondary,#777)}',
      '#'+ROOT_ID+' .nj-person.nj-former:hover{background:rgba(128,128,128,.26)}',
      '#'+ROOT_ID+' .nj-face{width:27px;height:27px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--yt-spec-10-percent-layer,#eee)}',
      '#'+ROOT_ID+' .nj-fallback{display:grid;place-items:center;font-size:12px;font-weight:700}',
      '#'+ROOT_ID+' .nj-name{overflow:hidden;text-overflow:ellipsis;flex:1}',
      '#'+ROOT_ID+' .nj-tag{flex-shrink:0;font-size:9px;opacity:.78}',
      '#'+ROOT_ID+' .nj-message{font-size:11px;line-height:1.45;color:var(--yt-spec-text-secondary,#777);padding:8px 18px;white-space:normal}',
      '#'+ROOT_ID+' .nj-refresh{font-size:11px;text-align:center;color:var(--yt-spec-text-secondary,#777);padding:7px 12px;display:block;margin:auto;border-radius:8px}',
      '#'+ROOT_ID+' .nj-refresh:hover{background:var(--yt-spec-10-percent-layer,rgba(127,127,127,.1))}'
    ].join('\n');
    document.head.append(st);
  }

  function el(tag, cls, content) {
    const node=document.createElement(tag);
    if (cls) node.className=cls;
    if (content!==undefined) node.textContent=content;
    return node;
  }
  function render() {
    if (!host) return;
    host.replaceChildren();
    const head=el('button','nj-head');
    head.type='button';head.setAttribute('aria-expanded',String(state.open));
    head.append(el('span','nj-symbol','🌈'),el('span','','にじさんじ'),el('span','nj-chevron',state.open?'▾':'▸'));
    head.addEventListener('click',()=>{state.open=!state.open;persistState();render();});
    host.append(head);
    if (!state.open) return;
    if (loading && !roster) host.append(el('div','nj-message','ライバー一覧を読み込んでいます…'));
    if (lastError) host.append(el('div','nj-message','データ取得：'+lastError));
    host.append(el('div','nj-message',cloudStatus));
    if (!roster) {
      const retry=el('button','nj-refresh','🔄 一覧を読み込む');
      retry.addEventListener('click',()=>void updateRoster(true));
      host.append(retry);return;
    }
    const groups=new Map();
    for (const item of roster.items) {
      if (!groups.has(item.year)) groups.set(item.year,[]);
      groups.get(item.year).push(item);
    }
    for (const [year,rows] of [...groups].sort((a,b)=>a[0]-b[0])) {
      const shown=!!state.years[year];
      const button=el('button','nj-year');
      button.type='button';button.setAttribute('aria-expanded',String(shown));
      button.append(el('span','nj-chevron',shown?'▾':'▸'),el('span','',year+'年'),el('span','nj-chevron',String(rows.length)));
      button.addEventListener('click',()=>{
        state.years[year]=!shown;persistState();render();
      });
      host.append(button);
      if (!shown) continue;
      const list=el('div','nj-rows');
      for (const row of rows) {
        const a=el('a','nj-person'+(row.graduated?' nj-former':''));
        a.href=row.url;a.title=row.name+(row.date?'（'+row.date+'デビュー）':'')+(row.graduated?'・卒業／活動終了':'');
        const avatar=row.avatar;
        if (avatar) {
          const img=el('img','nj-face');
          img.loading='lazy';img.referrerPolicy='no-referrer';img.alt='';
          img.src=avatar;img.addEventListener('error',()=>{
            const fallback=el('span','nj-face nj-fallback',row.name.slice(0,1));
            img.replaceWith(fallback);
          },{once:true});
          a.append(img);
        } else a.append(el('span','nj-face nj-fallback',row.name.slice(0,1)));
        a.append(el('span','nj-name',row.name));
        if(row.graduated)a.append(el('span','nj-tag','卒業'));
        list.append(a);
      }
      host.append(list);
    }
    const timestamp=roster.at?new Date(roster.at).toLocaleDateString('ja-JP'):'';
    const refresh=el('button','nj-refresh',(loading?'読み込み中…':'🔄 一覧を更新')+' ・ '+roster.items.length+'名'+(timestamp?' ・ '+timestamp:''));
    refresh.disabled=loading;
    refresh.addEventListener('click',()=>void updateRoster(true));
    host.append(refresh);
  }

  function findSubscriptions() {
    const guide=document.querySelector('ytd-guide-renderer #sections, #guide-content #sections');
    if (!guide) return null;
    const sections=[...guide.querySelectorAll(':scope > ytd-guide-section-renderer')];
    return sections.find(section => {
      const headers=[...section.querySelectorAll('#guide-section-title,#title,ytd-guide-collapsible-section-entry-renderer')];
      return headers.some(h=>/登録チャンネル|Subscriptions/i.test(text(h.textContent)));
    }) || sections.find(section => !!section.querySelector('a[href="/feed/channels"],a[href^="/feed/channels?"]')) || null;
  }
  function mount() {
    pendingMount=false;
    const target=findSubscriptions();
    if (!target || !target.parentElement) return;
    const container=target.parentElement;
    if (!host) {
      styles();
      host=el('section');
      host.id=ROOT_ID;
      host.setAttribute('aria-label','にじさんじライバー');
      render();
    }
    // Keep both sections directly after Home/Shorts, before the "You" section.
    // Some YouTube layouts place Subscriptions below Explore or Settings.
    const sections=[...container.children]
      .filter(node => node.matches?.('ytd-guide-section-renderer') && node!==target);
    const home=sections.find(node =>
      node.querySelector('a[href="/"],a[href="/feed/subscriptions"]') &&
      /ホーム|Home|ショート|Shorts/.test(text(node.textContent))) || sections[0];
    const homeIndex=sections.indexOf(home);
    const anchor=homeIndex>=0 ? sections[homeIndex+1] || null : sections[0] || null;

    // DOM moves fire MutationObserver; only change the order when needed.
    if (anchor ? target.nextElementSibling!==anchor : target!==container.lastElementChild) {
      container.insertBefore(target,anchor);
    }
    if (host.parentElement!==container || host.nextElementSibling!==target) {
      container.insertBefore(host,target);
    }
  }
  function scheduleMount() {
    if(pendingMount)return;
    pendingMount=true;
    queueMicrotask(mount);
  }
  const observer=new MutationObserver(scheduleMount);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('yt-navigate-finish',scheduleMount);
  document.addEventListener('yt-page-data-updated',scheduleMount);
  scheduleMount();
  void updateRoster();
})();

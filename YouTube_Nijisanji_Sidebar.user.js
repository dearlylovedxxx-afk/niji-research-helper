// ==UserScript==
// @name         YouTube にじさんじ サイドバー
// @namespace    marina.youtube.nijisanji.sidebar
// @version      0.2.1
// @description  にじさんじをデビュー期別に表示。公開配信中は赤リングとLIVE印、卒業済はアーカイブ確認後に表示。
// @match        https://www.youtube.com/*
// @match        https://youtube.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @connect      wikiwiki.jp
// @connect      www.youtube.com
// @connect      youtube.com
// @connect      vtuber-map.com
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


  const GROUPS = [
    '1期生出身','2期生出身','ゲーマーズ出身','SEEDs1期生出身','SEEDs2期生出身',
    '2019年1～3月デビュー','2019年4～6月デビュー',
    '2019年7～9月デビュー','2019年10～12月デビュー',
    ...Array.from({length:7},(_,i)=>(2020+i)+'年デビュー')
  ];
  const GROUP_ORDER=new Map(GROUPS.map((name,index)=>[name,index]));

  // The Wiki's YouTube page marks former JP members with a gray background.
  // Some rendered skins discard this background in HTML text extraction.
  // Keep this source-verified snapshot as a fallback, then honor newer
  // status markers/official roster when available. Do not mark returning
  // members such as 鈴原るる as graduates merely because of old reports.
  const WIKI_FORMER_JP_FALLBACK=new Set([
    '勇気ちひろ','鈴谷アキ','鈴鹿詩子','闇夜乃モルル','雪汝',
    '海夜叉神','名伽尾アズマ','出雲霞','安土桃','八朔ゆず',
    '鳴門こがね','月見しずく','遠北千南','成瀬鳴',
    '童田明治','久遠千歳','郡道美玲','小野町春香','瀬戸美夜子',
    '御伽原江良','黛灰','相羽ういは','グウェル・オス・ガール',
    '奈羅花','メリッサ・キンレンカ','金魚坂めいろ','朝日南アカネ',
    'アクシア・クローネ'
  ].map(normalize));

  function headerGroup(title) {
    const value=text(title).replace(/[〜～~]/g,'～');
    for(const key of GROUPS.slice(0,5)) {
      if(value.toLowerCase().startsWith(key.toLowerCase()))return key;
    }
    const y=value.match(/^(20(?:1[89]|2\d))年(?:デビュー|(\d{1,2})～(\d{1,2})月デビュー)/);
    if(y)return Number(y[1])===2019?'2019年デビュー':(y[1]+'年デビュー');
    return '';
  }
  function periodGroupFor2019(date,sourceOrder) {
    const month=Number(String(date||'').slice(5,7));
    if(month>=1&&month<=12) {
      const q=Math.floor((month-1)/3);
      return ['2019年1～3月デビュー','2019年4～6月デビュー',
        '2019年7～9月デビュー','2019年10～12月デビュー'][q];
    }
    // Unverified dates must not be assigned a fabricated quarter.
    // Keep them in an explicit unclassified section until Wiki has the date.
    return '2019年（デビュー月未確認）';
  }

  const defaultState = {open:false, years:{}};
  // Reload defaults to closed; only roster data is restored from the cloud.
  let state = {open:false,years:{}};
  let roster = readCache();
  let loading = false;
  let lastError = '';
  let cloudStatus = '☁️ Niji Cloud同期を確認中';
  let host = null;
  let pendingMount = false;
  window.addEventListener('nijisanji-sidebar:cloud-applied',()=>{
    // Cloud roster refresh must not reopen old accordion states.
    const fresh=readCache();
    if(fresh) roster=fresh;
    render();
    renderLiveHub();
    if(liveHubActive()&&roster?.items?.length&&!liveHubLoading&&!liveHubLastAt)
      void liveHubFetch();
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
      if (!value || value.schema!==4 || !Array.isArray(value.items) || value.items.length < 10) return null;
      return value;
    } catch { return null; }
  }
  function saveCache(items) {
    const value = {schema:4,at:Date.now(),items};
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


  // Fallback for strict YouTube Trusted Types CSP: let the privileged
  // userscript network layer produce an already-parsed Document.
  function requestWikiDocument(url) {
    return new Promise((resolve,reject)=>{
      const modern=typeof GM!=='undefined'?(GM.xmlHttpRequest||GM.xmlhttpRequest):null;
      const legacy=typeof GM_xmlhttpRequest==='function'?GM_xmlhttpRequest:null;
      const fn=typeof modern==='function'?modern.bind(GM):legacy;
      if(!fn){reject(new Error('WikiのDocument取得権限がありません'));return;}
      const completed=r=>{
        if(Number(r?.status||0)<200||Number(r?.status||0)>=300) {
          reject(new Error('Wiki Document HTTP '+String(r?.status||0)));return;
        }
        const doc=r?.response?.nodeType===9?r.response:r?.responseXML?.nodeType===9?r.responseXML:null;
        if(doc) resolve(doc);
        else reject(new Error('ユーザースクリプトがHTML Documentを返しませんでした'));
      };
      try {
        const req=fn({method:'GET',url,timeout:20000,responseType:'document',
          onload:completed,onerror:()=>reject(new Error('Wiki Document通信エラー')),
          ontimeout:()=>reject(new Error('Wiki Documentタイムアウト'))});
        if(req&&typeof req.then==='function')req.then(completed).catch(reject);
      }catch(e){reject(e);}
    });
  }

  async function loadWikiLines(url,type) {
    const received=await requestWiki(url);
    try {return wikiLines(received,type);}
    catch(error) {
      if(!/TrustedHTML|Trusted Types|trustedTypes/i.test(String(error?.message||error)))throw error;
      const documentResponse=await requestWikiDocument(url);
      return wikiLines(documentResponse,type);
    }
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
    let year=2018, group='', enabled=false, ordinal=0;
    const records=[],found=new Set();
    for(let raw of lines) {
      raw=String(raw||'').trim();
      if(!raw||raw.startsWith('//'))continue;
      const header=raw.match(/^\*\*?\s*([^[]+)/);
      if(header) {
        const title=text(header[1]);
        const g=headerGroup(title);
        // Treat the Wiki's headings as whitelist boundaries. The group/units
        // section comes right after the 2026 livers; never inherit 2026.
        enabled=!!g;
        group=g||'';
        if(g)year=g.includes('2019')?2019:GROUP_ORDER.has(g)?(GROUP_ORDER.get(g)<5?2018:Number(g.slice(0,4))):2018;
      }
      if(!enabled||!raw.startsWith('-'))continue;
      const links=[...raw.matchAll(/https?:\/\/(?:www\.)?youtube\.com\/(?:@[^\s\],>};]+|channel\/UC[a-zA-Z0-9_-]{22})/gi)]
        .map(m=>validYouTubeUrl(m[0])).filter(Boolean);
      const urls=[...new Set(links)];
      if(!urls.length)continue;
      const url=urls[0];
      if(!url)continue;
      let label=raw.split(/[：:]/)[0].replace(/^-\s*/,'')
        .replace(/&color\([^)]*\)\{/g,'').replace(/&ref\([^)]*\);/g,'')
        .replace(/&icon\([^)]*\);/g,'').replace(/[{}]/g,'').trim()
        .replace(/&[^;]+;/g,'').trim();
      if(!label||label.length>45)continue;
      const key=normalize(label);
      if(found.has(key))continue;
      found.add(key);
      const graduated=/&color\(,\s*#(?:ddd|dddddd)\)/i.test(raw) ||
        WIKI_FORMER_JP_FALLBACK.has(normalize(label));
      records.push({name:label,year,group,url,alternates:urls.slice(1),graduated,order:ordinal++,date:'',avatar:'',
        archived:null,archiveCheckedAt:0});
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
        } else if(/^元メンバー/.test(title)) {
          former=true;date=cohortDate;
        } else if(/^メンバー/.test(title)) {
          former=false;date=cohortDate;
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

  function mergeRoster(channels,official) {
    const previous=new Map((roster?.items||[]).map(row=>[row.url,row]));
    const merged=channels.map(row=>{
      const aliases={'ましろ':'ましろ爻'};
      const matched=official.get(normalize(aliases[row.name]||row.name));
      const date=matched?.date || '';
      const year=date?Number(date.slice(0,4)):row.year;
      const group=year===2019?periodGroupFor2019(date,row.order):
        (year===2018?row.group:year+'年デビュー');
      const old=previous.get(row.url);
      return {...row,year,date,group,
        graduated:row.graduated===true || matched?.graduated===true,
        alternates:[...new Set([...(row.alternates||[]),...(old?.alternates||[])])].filter(u=>u!==row.url),
        avatar:old?.avatar||'',archived:old?.archived===true?true:old?.archived===false?false:null,
        archiveCheckedAt:Number(old?.archiveCheckedAt||0),
        officialOrder:matched?.order??row.order};
    }).filter(row=>row.year>=2018 && row.year<=2026 && !!row.url
      && (GROUP_ORDER.has(row.group)||row.group==='2019年（デビュー月未確認）'));
    // Channel list is chronological. If Wiki's official-name spelling
    // prevents a date match, place it with the nearest dated 2019 entry,
    // while leaving the exact debut date blank rather than inventing one.
    for(const row of merged) {
      if(row.group!=='2019年（デビュー月未確認）')continue;
      const known=merged.filter(other=>other.year===2019 && other.date &&
        GROUP_ORDER.has(other.group));
      known.sort((a,b)=>Math.abs(a.order-row.order)-Math.abs(b.order-row.order));
      row.group=known[0]?.group||'2019年1～3月デビュー';
    }
    merged.sort((a,b)=>(GROUP_ORDER.get(a.group)??16)-(GROUP_ORDER.get(b.group)??16) ||
      (a.date&&b.date?a.date.localeCompare(b.date):a.date?-1:b.date?1:0)||
      a.officialOrder-b.officialOrder||a.order-b.order);
    return merged;
  }

  async function updateRoster(force=false) {
    if (loading) return;
    if (!force && roster && Date.now()-roster.at < CACHE_MS) return;
    loading=true;lastError='';render();
    const fetched=await Promise.allSettled([loadWikiLines(CHANNEL_PAGE,'channels'),loadWikiLines(ROSTER_PAGE,'official')]);
    try {
      if (fetched[0].status!=='fulfilled') throw fetched[0].reason;
      const c=fetched[0].value;
      const channels=parseChannelLines(c.lines);
      if (channels.length < 90) throw new Error('チャンネル一覧の解析件数が少なすぎます（'+channels.length+'件）。旧データを保持します。');
      let official=new Map();
      if (fetched[1].status==='fulfilled') {
        const r=fetched[1].value;
        official=parseOfficialLines(r.lines);
      }
      const items=mergeRoster(channels,official);
      if (items.length < 90) throw new Error('保存できるライバー情報が不足しています');
      saveCache(items);
    } catch(e) {
      lastError=String(e?.message || e);
    } finally {
      loading=false;render();renderLiveHub();
      if(liveHubActive()&&roster?.items?.length&&!liveHubLoading&&!liveHubLastAt)
        void liveHubFetch();
    }
  }


  // Channel avatars and surviving archives are verified against YouTube itself.
  // Do not reuse Wiki's generic &icon thumbnail for every member.
  const MEDIA_RECHECK_MS=14*24*60*60*1000;
  const MEDIA_FAILURE_BACKOFF_MS=15*60*1000;
  const mediaFailedAt=new Map();
  const mediaFailureReasons=new Map();
  const mediaJobs=[],mediaQueued=new Set();
  let mediaRunning=0,mediaPersistTimer=null,mediaLastRequest=0;
  let mediaFailures=0;

  function mediaAvatarFromHtml(html) {
    const og=[...String(html||'').matchAll(/<meta\b[^>]{0,900}>/gi)]
      .map(match=>match[0])
      .find(tag=>/\b(?:property|name)=["']og:image["']/i.test(tag));
    if(og) {
      const src=og.match(/\bcontent=["']([^"']+)["']/i)?.[1]||'';
      const clean=src.replace(/&amp;/g,'&').replace(/\\u0026/g,'&');
      if(/^https:\/\/(?:yt3\.googleusercontent\.com|yt3\.ggpht\.com)\//i.test(clean))return clean;
    }
    const avatar=String(html||'').match(/"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"(https?:[^"]+)"/i)?.[1]
      || String(html||'').match(/"avatarViewModel"[\s\S]{0,1400}?"url":"(https?:[^"]+)"/i)?.[1] || '';
    const clean=avatar.replace(/\\u0026/g,'&').replace(/\\\//g,'/');
    return /^https:\/\/(?:yt3\.googleusercontent\.com|yt3\.ggpht\.com)\//i.test(clean)?clean:'';
  }

  function mediaHasPublicArchive(html) {
    // Inspect YouTube's channel Videos/Live tab metadata, not the channel
    // homepage. Channel video cards can use old videoRenderer or the newer
    // lockupViewModel shape. Do not count Shorts-only or playlists.
    const raw=String(html||'');
    return /"(?:videoRenderer|gridVideoRenderer)"\s*:\s*\{\s*"videoId"\s*:\s*"[A-Za-z0-9_-]{11}"/.test(raw)
      || /"lockupViewModel"\s*:\s*\{\s*"contentId"\s*:\s*"[A-Za-z0-9_-]{11}"/.test(raw)
      || /"videoRenderer"\s*:\s*\{[^{}]{0,500}"videoId"\s*:\s*"[A-Za-z0-9_-]{11}"/.test(raw);
  }

  function mediaConfirmsEmptyTab(html) {
    // If YouTube does not supply a parsable video list, absence of a renderer
    // is NOT proof the channel is empty. Never cache it as archive=false.
    const raw=String(html||'');
    return /"(?:emptyTabRenderer|messageRenderer)"\s*:\s*\{/.test(raw)
      && /(?:このチャンネルには動画がありません|has no (?:videos|content)|no videos|動画はありません|コンテンツはありません)/i.test(raw);
  }


  function mediaChannelId(html) {
    return String(html||'').match(/"(?:externalId|channelId)"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/)?.[1]||'';
  }

  function mediaGMRequest(url) {
    return new Promise((resolve,reject)=>{
      const modern=typeof GM!=='undefined'?(GM.xmlHttpRequest||GM.xmlhttpRequest):null;
      const old=typeof GM_xmlhttpRequest==='function'?GM_xmlhttpRequest:null;
      const fn=typeof modern==='function'?modern.bind(GM):old;
      if(!fn){reject(new Error('ユーザースクリプト通信不可'));return;}
      let settled=false;
      const finish=(error,value)=>{
        if(settled)return;settled=true;
        if(error)reject(error);else resolve(value);
      };
      const success=res=>{
        if(res.status<200||res.status>=300)return finish(new Error('HTTP '+res.status));
        const raw=String(res.responseText??res.response??'');
        if(raw.length<80)return finish(new Error('通信応答が空です'));
        finish(null,raw);
      };
      try{
        const task=fn({method:'GET',url,timeout:20000,responseType:'text',onload:success,
          onerror:()=>finish(new Error('接続できませんでした')),
          ontimeout:()=>finish(new Error('20秒で通信タイムアウト'))});
        if(task&&typeof task.then==='function')task.then(success).catch(finish);
      }catch(error){finish(error);}
    });
  }

  async function mediaGet(url,minLength=1000) {
    let primaryError='';
    try{
      const res=await fetch(url,{credentials:'include',redirect:'follow',cache:'no-store'});
      if(!res.ok)throw new Error('HTTP '+res.status);
      const raw=await res.text();
      if(raw.length<minLength)throw new Error('HTMLが空か不完全です');
      if(/consent\.youtube\.com|<title>.*(?:404|not found)/i.test(raw.slice(0,5000)))
        throw new Error('公開チャンネルが見つかりません');
      return raw;
    }catch(error){primaryError=String(error?.message||error);}
    try{
      const raw=await mediaGMRequest(url);
      if(raw.length<minLength)throw new Error('代替通信の応答が不完全');
      return raw;
    }catch(error){
      throw new Error('ブラウザ通信：'+primaryError+'／代替通信：'+String(error?.message||error));
    }
  }

  async function mediaFetchChannel(url,tab) {
    return mediaGet(url.replace(/\/+$/,'')+'/'+tab);
  }

  async function mediaRssArchive(channelId) {
    if(!/^UC[a-zA-Z0-9_-]{22}$/.test(channelId))return false;
    try{
      const raw=await mediaGet('https://www.youtube.com/feeds/videos.xml?channel_id='+channelId,80);
      return /<entry(?:\s|>)[\s\S]*?<yt:videoId>[A-Za-z0-9_-]{11}<\/yt:videoId>/.test(raw);
    }catch{return false;}
  }

  async function inspectMediaCandidate(url,verifyArchives) {
    const videos=await mediaFetchChannel(url,'videos');
    let avatar=mediaAvatarFromHtml(videos);
    if(!verifyArchives)return {avatar,hasArchive:null,confirmed:false};
    let hasArchive=mediaHasPublicArchive(videos);
    const videosEmpty=mediaConfirmsEmptyTab(videos);
    let streams='',streamsEmpty=false,streamError='';
    if(!hasArchive){
      try{
        streams=await mediaFetchChannel(url,'streams');
        hasArchive=mediaHasPublicArchive(streams);
        streamsEmpty=mediaConfirmsEmptyTab(streams);
      }catch(error){streamError=String(error?.message||error);}
    }
    if(!avatar&&streams)avatar=mediaAvatarFromHtml(streams);
    if(!hasArchive){
      const id=url.match(/\/channel\/(UC[a-zA-Z0-9_-]{22})/)?.[1] ||
        mediaChannelId(videos)||mediaChannelId(streams);
      if(id)hasArchive=await mediaRssArchive(id);
    }
    if(hasArchive)return {avatar,hasArchive:true,confirmed:true};
    if(videosEmpty&&streamsEmpty)return {avatar,hasArchive:false,confirmed:true};
    throw new Error(streamError?('ライブ欄：'+streamError):'動画一覧の確認不可');
  }

  function mediaSaveSoon() {
    if(mediaPersistTimer)clearTimeout(mediaPersistTimer);
    mediaPersistTimer=setTimeout(()=>{
      mediaPersistTimer=null;
      if(!roster)return;
      saveCache(roster.items);
    },2500);
  }

  function mediaRefresh() {
    render();
    mediaSaveSoon();
  }

  function mediaEnqueue(row,verifyArchive=false) {
    if(!row?.url)return;
    const isDue=Date.now()-Number(row.archiveCheckedAt||0)>MEDIA_RECHECK_MS;
    if(verifyArchive && row.graduated && !isDue && row.archived!==null)return;
    if(!verifyArchive && row.avatar && row.avatar.startsWith('https://yt3.'))return;
    const key=row.url;
    if(Date.now()-Number(mediaFailedAt.get(key)||0)<MEDIA_FAILURE_BACKOFF_MS)return;
    if(mediaQueued.has(key))return;
    mediaQueued.add(key);
    mediaJobs.push({row,verifyArchive,key});
    void mediaDrain();
  }

  async function mediaDrain() {
    if(mediaRunning>=2)return;
    while(mediaRunning<2&&mediaJobs.length){
      const job=mediaJobs.shift();
      mediaRunning++;
      void (async()=>{
        const row=job.row;
        try{
          const spacing=Math.max(0,mediaLastRequest+500-Date.now());
          if(spacing)await new Promise(resolve=>setTimeout(resolve,spacing));
          mediaLastRequest=Date.now();
          const candidates=[...new Set([row.url,...(row.alternates||[])].filter(Boolean))];
          let verified=false,allEmpty=true,details=[];
          for(const candidate of candidates){
            try{
              const result=await inspectMediaCandidate(candidate,job.verifyArchive&&row.graduated);
              if(result.avatar&&!row.avatar)row.avatar=result.avatar;
              if(job.verifyArchive&&row.graduated) {
                if(result.hasArchive===true){
                  row.url=candidate;
                  row.archived=true;
                  row.archiveCheckedAt=Date.now();
                  verified=true;break;
                }
                if(result.hasArchive!==false)allEmpty=false;
              } else if(result.avatar){
                row.avatar=result.avatar;
                break;
              }
            }catch(error){
              allEmpty=false;
              details.push(String(error?.message||error));
            }
          }
          if(job.verifyArchive&&row.graduated&&!verified){
            if(allEmpty){row.archived=false;row.archiveCheckedAt=Date.now();}
            else throw new Error(details.join(' / ')||'アーカイブを確認できません');
          }
          mediaFailedAt.delete(job.key);
          mediaFailureReasons.delete(job.key);
          mediaRefresh();
        }catch(error){
          mediaFailures++;
          mediaFailedAt.set(job.key,Date.now());
          mediaFailureReasons.set(job.key,String(error?.message||error).slice(0,150));
          console.warn('[Nijisanji sidebar][archive]',row.name,String(error?.message||error));
        }finally{
          mediaQueued.delete(job.key);
          mediaRunning--;
          render();
          void mediaDrain();
        }
      })();
    }
  }

  function loadGroupMedia(group,includeFormer=false) {
    for(const row of roster?.items||[]) {
      if(row.group!==group)continue;
      if(!row.graduated)mediaEnqueue(row,false);
      else if(includeFormer)mediaEnqueue(row,true);
    }
  }


  // Live badges use short-lived memory only. They must never become roster
  // data or be uploaded to Niji Cloud. Only expanded current-member groups
  // are checked to avoid hundreds of YouTube requests in the background.
  const LIVE_CHECK_INTERVAL_MS = 3*60*1000;
  const LIVE_DISPLAY_TTL_MS = 7*60*1000;
  const LIVE_RETRY_MS = 90*1000;
  const LIVE_MAX_PARALLEL = 2;
  const LIVE_TIMEOUT_MS = 12000;
  const liveChecks = new Map();
  const liveErrors = new Map();
  const liveQueued = new Set();
  const liveJobs = [];
  let liveRunning = 0;
  let lastLiveNetworkAt = 0;

  function youtubeEmbeddedData(html,token) {
    const raw=String(html||'');
    const patterns=token==='ytInitialData'
      ? [/(?:var\s+)?ytInitialData\s*=\s*/,/window\[['"]ytInitialData['"]\]\s*=\s*/]
      : [/(?:var\s+)?ytInitialPlayerResponse\s*=\s*/,/window\[['"]ytInitialPlayerResponse['"]\]\s*=\s*/];
    for(const pattern of patterns){
      const match=pattern.exec(raw);
      if(!match)continue;
      const begin=raw.indexOf('{',match.index+match[0].length);
      if(begin<0||begin>match.index+match[0].length+6)continue;
      let depth=0,inString=false,escaped=false;
      for(let i=begin;i<raw.length&&i<begin+4000000;i++){
        const c=raw[i];
        if(inString){
          if(escaped)escaped=false;
          else if(c==='\\')escaped=true;
          else if(c==='"')inString=false;
        }else if(c==='"')inString=true;
        else if(c==='{')depth++;
        else if(c==='}' && --depth===0){
          try{return JSON.parse(raw.slice(begin,i+1));}catch{break;}
        }
      }
    }
    return null;
  }

  function liveStatusFromWatchHtml(html,finalUrl) {
    let url;
    try{url=new URL(finalUrl,location.origin);}catch{return {live:false,known:false};}
    if(!/(?:^|\.)youtube\.com$/.test(url.hostname)||
      url.pathname!=='/watch'||!url.searchParams.get('v'))
      return {live:false,known:false};
    const data=youtubeEmbeddedData(html,'ytInitialPlayerResponse');
    if(!data)return {live:false,known:false};
    const d=data.videoDetails||{};
    const b=data.microformat?.playerMicroformatRenderer?.liveBroadcastDetails||{};
    const offline=data.playabilityStatus?.status==='LIVE_STREAM_OFFLINE';
    const ended=!!b.endTimestamp,upcoming=d.isUpcoming===true;
    const explicit=b.isLiveNow===true||d.isLive===true;
    const inactive=b.isLiveNow===false;
    return {live:!offline&&!ended&&!upcoming&&!inactive&&explicit,known:true};
  }

  function liveStatusFromStreamsData(data) {
    // Select only the requested channel's own Live tab. Scanning all
    // ytInitialData also picks up unrelated currently live recommendations.
    const tabs=data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if(!Array.isArray(tabs))return {live:false,known:false};
    const selected=tabs.find(t=>t.tabRenderer?.selected===true ||
      t.expandableTabRenderer?.selected===true);
    const matching=tabs.find(t=>{
      const r=t.tabRenderer||t.expandableTabRenderer;
      return /\/streams(?:[/?]|$)/.test(
        String(r?.endpoint?.commandMetadata?.webCommandMetadata?.url||''));
    });
    const tab=matching?.tabRenderer?.selected===true?matching:selected||matching;
    const content=(tab?.tabRenderer||tab?.expandableTabRenderer)?.content;
    if(!content)return {live:false,known:false};
    const cards=[];
    let traversed=0;
    function visit(node,depth=0){
      if(!node||typeof node!=='object'||depth>24||traversed++>2400)return;
      if(Array.isArray(node)){
        for(const item of node.slice(0,150))visit(item,depth+1);
        return;
      }
      for(const key of ['videoRenderer','gridVideoRenderer','lockupViewModel','videoWithContextRenderer']){
        if(node[key]&&typeof node[key]==='object'){
          const item=node[key];
          if(key==='lockupViewModel'){
            const id=item.contentId;
            if(!/^[A-Za-z0-9_-]{11}$/.test(String(id||'')))continue;
            if(item.contentType&&String(item.contentType)!=='VIDEO')continue;
          }
          cards.push(item);
          return;
        }
      }
      for(const [key,value] of Object.entries(node)){
        if(/reel|shorts|playlist|continuationItem|channelRenderer/i.test(key))continue;
        visit(value,depth+1);
      }
    }
    visit(content);
    if(!cards.length)return {live:false,known:false};
    const current=cards.some(card=>{
      const json=JSON.stringify(card);
      if(/"style"\s*:\s*"UPCOMING"|"style"\s*:\s*"BADGE_STYLE_TYPE_UPCOMING"/.test(json))
        return false;
      return /"(?:style|badgeStyle)"\s*:\s*"BADGE_STYLE_TYPE_LIVE_NOW"/.test(json)
        || /"thumbnailOverlayTimeStatusRenderer"\s*:\s*\{\s*"style"\s*:\s*"LIVE"/.test(json)
        || /"style"\s*:\s*"LIVE"/.test(json)
        || /"iconType"\s*:\s*"LIVE"/.test(json)
        || /"isLiveNow"\s*:\s*true/.test(json);
    });
    return {live:current,known:true,cardCount:cards.length};
  }

  function liveStatusFromStreamsHtml(html) {
    const data=youtubeEmbeddedData(html,'ytInitialData');
    return data?liveStatusFromStreamsData(data):{live:false,known:false};
  }

  async function probeChannelLive(channelUrl) {
    // Important: a normal video card on /streams is NOT enough to claim a
    // channel is offline. Probe /live even when the tab reports no red badge.
    const base=channelUrl.replace(/\/+$/,'');
    let status={live:false,known:false},firstError='';
    try{
      const streamsHtml=await mediaGet(base+'/streams',1000);
      status=liveStatusFromStreamsHtml(streamsHtml);
      if(status.known && status.live)return true;
      if(!status.known)firstError='ライブタブのHTML構造が未対応';
    }catch(error){firstError=String(error?.message||error);}
    const target=base+'/live';
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),LIVE_TIMEOUT_MS);
    try{
      const response=await fetch(target,{credentials:'include',
        redirect:'follow',cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('YouTube HTTP '+response.status);
      const html=await response.text();
      const watch=liveStatusFromWatchHtml(html,response.url||target);
      if(watch.known)return watch.live;
      const embedded=youtubeEmbeddedData(html,'ytInitialPlayerResponse');
      if(embedded?.videoDetails?.isLive===true &&
         embedded?.videoDetails?.isUpcoming!==true &&
         embedded?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow===true &&
         !embedded?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.endTimestamp)return true;
      const page=liveStatusFromStreamsHtml(html);
      if(page.known)return page.live;
      if(status.known)return status.live;
      throw new Error('配信状況を判定できません：'+(firstError||'YouTubeが必要な情報を返していません'));
    }catch(error){
      // A failed /live probe must not overturn a positive streams result.
      if(status.known)return status.live;
      throw new Error('ライブページ確認失敗：'+String(error?.message||error)+
        (firstError?' ／ ライブ欄：'+firstError:''));
    }finally{clearTimeout(timeout);}
  }

  // First use the very same live badge that YouTube paints next to a
  // subscribed channel in its native sidebar. This can reflect live status
  // without scraping a second page, and works when /live redirects differ.
  const nativeLiveChannels=new Set();
  const nativeLiveNames=new Set();
  let nativeRefreshPending=false;

  function nativeChannelPath(raw) {
    try {
      const u=new URL(raw,location.origin);
      if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname))return '';
      const path=decodeURIComponent(u.pathname).replace(/\/+$/,'').toLowerCase();
      return /^(?:\/@[^/]+|\/channel\/uc[a-z0-9_-]{22})$/.test(path)?path:'';
    }catch{return '';}
  }

  function nativeLiveEntry(entry) {
    if(!entry)return false;
    if(entry.matches?.('[is-live],[live]'))return true;
    const markers=entry.querySelectorAll(
      '.ytSpecAvatarShapeLiveBadgeText,.yt-spec-avatar-shape__live-badge-text,'+
      '.ytSpecAvatarShapeLiveBadge,.yt-spec-avatar-shape--live,'+
      '.badge-style-type-live-now-alternate,'+
      '[class*="AvatarShapeLive"],[class*="badge-style-type-live-now"],'+
      '[icon="LIVE"],[icon="yt-icons:live"],'+
      '[aria-label*="ライブ配信中"],[aria-label*="配信中"],'+
      '[aria-label*="Live now"]'
    );
    for(const mark of markers){
      if(mark.getAttribute('aria-hidden')==='true')continue;
      if(mark.matches?.('.ytSpecAvatarShapeLiveBadgeText') && mark.textContent?.trim().toUpperCase()!=='LIVE')continue;
      return true;
    }
    // Some YouTube sidebar variants indicate live status on the entry
    // itself instead of drawing an avatar ring in DOM.
    return entry.getAttribute('line-end-style')==='badge'
      && !!entry.querySelector('[class*="badge"],[class*="Badge"],yt-icon');
  }

  function nativeName(entry) {
    const label=entry.querySelector('#text,yt-formatted-string,#title')?.textContent||
      entry.querySelector('a[title]')?.getAttribute('title')||'';
    return normalize(String(label).split(/[\/｜|]/)[0]);
  }

  function refreshNativeLiveSignals() {
    const section=findSubscriptions();
    if(!section)return false;
    const nextChannels=new Set(),nextNames=new Set();
    for(const entry of section.querySelectorAll('ytd-guide-entry-renderer,ytd-guide-collapsible-entry-renderer')){
      if(!nativeLiveEntry(entry))continue;
      const link=entry.querySelector('a[href]');
      const path=link?nativeChannelPath(link.getAttribute('href')):'';
      const name=nativeName(entry);
      if(path)nextChannels.add(path);
      if(name)nextNames.add(name);
    }
    const oldKey=[...nativeLiveChannels].sort().join('|')+'/'+[...nativeLiveNames].sort().join('|');
    const newKey=[...nextChannels].sort().join('|')+'/'+[...nextNames].sort().join('|');
    if(newKey===oldKey)return false;
    nativeLiveChannels.clear();nativeLiveNames.clear();
    for(const key of nextChannels)nativeLiveChannels.add(key);
    for(const name of nextNames)nativeLiveNames.add(name);
    return true;
  }

  function scheduleNativeLiveRefresh() {
    if(nativeRefreshPending)return;
    nativeRefreshPending=true;
    setTimeout(()=>{
      nativeRefreshPending=false;
      if(refreshNativeLiveSignals() && state.open)render();
    },500);
  }

  function nativeIsLive(row) {
    if(!row)return false;
    const paths=[row.url,...(row.alternates||[])].map(nativeChannelPath).filter(Boolean);
    if(paths.some(path=>nativeLiveChannels.has(path)))return true;
    return nativeLiveNames.has(normalize(row.name));
  }

  function isLiveNow(channelUrl,row=null) {
    if(row && nativeIsLive(row))return true;
    const result=liveChecks.get(channelUrl);
    return !!(result?.live===true && Date.now()-result.checkedAt<LIVE_DISPLAY_TTL_MS);
  }

  function enqueueLive(row) {
    if(!row?.url || row.graduated || !state.open || document.visibilityState==='hidden')return;
    const key=row.url,entry=liveChecks.get(key);
    const now=Date.now();
    const lastAttempt=entry?.failed?entry.attemptAt:entry?.checkedAt;
    if(entry && now-Number(lastAttempt||0)<(entry.failed?LIVE_RETRY_MS:LIVE_CHECK_INTERVAL_MS))return;
    if(liveQueued.has(key))return;
    liveQueued.add(key);
    liveJobs.push({key});
    void drainLive();
  }

  function queueVisibleLiveChecks() {
    if(!roster || !state.open || document.visibilityState==='hidden')return;
    scheduleNativeLiveRefresh();
    for(const row of roster.items){
      if(!row.graduated && state.years[row.group]===true)enqueueLive(row);
    }
  }

  async function drainLive() {
    while(liveRunning<LIVE_MAX_PARALLEL && liveJobs.length){
      const job=liveJobs.shift();
      liveRunning++;
      void (async()=>{
        try{
          const gap=Math.max(0,lastLiveNetworkAt+650-Date.now());
          if(gap)await new Promise(resolve=>setTimeout(resolve,gap));
          lastLiveNetworkAt=Date.now();
          const wasLive=isLiveNow(job.key);
          const currentlyLive=await probeChannelLive(job.key);
          liveChecks.set(job.key,{live:currentlyLive,checkedAt:Date.now(),failed:false});
          liveErrors.delete(job.key);
          // Update the visible diagnostic counters even when status is offline.
          render();
        }catch(error){
          // Failure is unknown, not evidence that a livestream ended.
          // Hide stale badges after the display TTL rather than guessing.
          const previous=liveChecks.get(job.key);
          liveChecks.set(job.key,{live:previous?.live===true,
            checkedAt:previous?.checkedAt||0,failed:true,attemptAt:Date.now()});
          liveErrors.set(job.key,String(error?.message||error).slice(0,200));
          console.warn('[Nijisanji sidebar][LIVE]',job.key,String(error?.message||error));
          render();
        }finally{
          liveQueued.delete(job.key);
          liveRunning--;
          void drainLive();
        }
      })();
    }
  }


  // ---------- dedicated Nijisanji LIVE hub ----------
  // #niji-live is a local YouTube route: YouTube's page, account, sidebar
  // and playback links remain intact. This does not create a 404-prone path.
  // Source is a public live listing and is read-only. Never store dynamic
  // viewer counts/live state in Niji Cloud, which owns only roster settings.
  const LIVE_HUB_HASH='#niji-live';
  const LIVE_HUB_ID='marina-niji-live-hub';
  const LIVE_HUB_STYLE_ID='marina-niji-live-hub-css';
  const LIVE_HUB_SOURCE='https://vtuber-map.com/live?group=Nijisanji&membership=public&status=live';
  const LIVE_HUB_REFRESH_MS=3*60*1000;
  let liveHub=null,liveHubLoading=false,liveHubLastAt=0;
  let liveHubCards=[],liveHubError='',liveHubMatched=0,liveHubSourceCount=0;
  let liveHubHoverTimer=null,liveHubActivePreview=null;
  let liveHubPreviewGeneration=0;
  const liveHubPreviewCache=new Map();
  const LIVE_HUB_PREVIEW_CACHE_MS=60*60*1000;

  function liveHubActive() {
    return location.pathname==='/' && location.hash===LIVE_HUB_HASH;
  }
  function openLiveHub() {
    if(!liveHubActive())location.assign('https://www.youtube.com/'+LIVE_HUB_HASH);
    else syncLiveHub();
  }
  function liveHubVideoId(raw) {
    try {
      const u=new URL(raw,location.origin);
      if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname))return '';
      const id=u.hostname==='youtu.be'?u.pathname.split('/')[1]:
        u.pathname==='/watch'?u.searchParams.get('v'):
        u.pathname.match(/^\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{11})/)?.[1];
      return /^[A-Za-z0-9_-]{11}$/.test(String(id||''))?id:'';
    }catch{return '';}
  }
  function liveHubScopedText(node) {
    return String(node?.textContent||'').replace(/\s+/g,' ').trim();
  }
  function liveHubViewerCount(value) {
    const m=String(value||'').match(/(?:現在同接|同時接続数|同時視聴者数|Concurrent viewers)\s*[：:]?\s*([0-9,]+)/i);
    return m?Number(m[1].replace(/,/g,'')):null;
  }
  function liveHubFindCard(link) {
    let node=link;
    for(let i=0;i<12&&node?.parentElement;i++){
      node=node.parentElement;
      const copy=liveHubScopedText(node);
      if(copy.length>6500)break;
      if(!/(?:現在同接|同時接続数|同時視聴者数|Concurrent viewers)/i.test(copy))continue;
      if(!/\bLIVE\b|配信中/.test(copy))continue;
      // Stop at the smallest meaningful card. Container pages may include
      // unrelated streams, which would produce wrong viewers/channels.
      const videoCount=[...node.querySelectorAll('a[href]')]
        .filter(a=>liveHubVideoId(a.getAttribute('href')||'')).length;
      if(videoCount>5)continue;
      return node;
    }
    return null;
  }
  function liveHubMatchLiver(scope) {
    if(!roster?.items?.length)return null;
    const active=roster.items.filter(row=>!row.graduated);
    // Prefer a matching channel URL (including alternate official URLs).
    const links=[...scope.querySelectorAll('a[href]')].map(a=>
      nativeChannelPath(a.getAttribute('href')||'')).filter(Boolean);
    if(links.length){
      const match=active.find(row=>[row.url,...(row.alternates||[])]
        .some(url=>links.includes(nativeChannelPath(url))));
      if(match)return match;
    }
    const copy=liveHubScopedText(scope);
    const clean=normalize(copy);
    const matches=active.filter(row=>{
      const name=normalize(row.name);
      if(!name)return false;
      // Very short names ("叶", "える") must have a channel-name boundary.
      if(name.length<=2)
        return new RegExp('(?:^|[／/　\\s])'+name+'(?:[／/〖【|　\\s]|$)').test(copy);
      return clean.includes(name);
    }).sort((a,b)=>normalize(b.name).length-normalize(a.name).length);
    return matches[0]||null;
  }
  function liveHubParseSource(html) {
    const doc=parseWikiDocument(html);
    const result=[],seen=new Set();
    const all=[...doc.querySelectorAll('a[href]')]
      .map(a=>({anchor:a,id:liveHubVideoId(a.getAttribute('href')||'')}));
    for(const {anchor,id} of all){
      if(!id||seen.has(id))continue;
      const scope=liveHubFindCard(anchor);
      if(!scope)continue;
      seen.add(id);
      const copy=liveHubScopedText(scope);
      const viewers=liveHubViewerCount(copy);
      const images=[...scope.querySelectorAll('img[alt]')];
      const poster=images.find(img=>/youtu|thumbnail|hqdefault|mqdefault/i.test(
        img.getAttribute('src')||''))||images.find(img=>(img.getAttribute('alt')||'').length>12);
      const candidates=[
        poster?.getAttribute('alt')||'',
        scope.querySelector('h2,h3,h4')?.textContent||'',
        anchor.getAttribute('title')||''
      ].map(text).filter(value=>value.length>=6&&value.length<=260);
      const title=candidates[0]||'配信中のライブ';
      // Membership/organisation filtering is done using our existing JP
      // liver roster, not the source's broad "Nijisanji" grouping.
      const liver=liveHubMatchLiver(scope);
      result.push({id,title,viewers,liver,
        channel:liver?.name||'',url:'https://www.youtube.com/watch?v='+id});
    }
    return result;
  }
  async function liveHubFetch() {
    if(liveHubLoading||!liveHubActive())return;
    liveHubLoading=true;liveHubError='';renderLiveHub();
    try{
      // One lightweight request for all active streams, not 150+ queries to
      // each individual channel. Reuse the existing privileged transport.
      const html=await mediaGMRequest(LIVE_HUB_SOURCE);
      if(!/現在同接|同時接続数|Concurrent viewers/.test(html))
        throw new Error('取得元から配信データを受信できませんでした');
      const result=liveHubParseSource(html);
      liveHubSourceCount=result.length;
      if(!result.length && /\bLIVE\b/.test(html))
        throw new Error('配信一覧のHTML形式が変わりました（カードを解析できません）');
      if(!roster?.items?.length)
        throw new Error('JPライバー一覧を取得中です。ライバー一覧の読み込み後に更新してください。');
      const jp=result.filter(x=>x.liver);
      if(result.length && !jp.length)
        throw new Error('配信候補は取得しましたが、JPライバーの照合に失敗しました（'+result.length+'件）');
      liveHubCards=jp.sort((a,b)=>(b.viewers??-1)-(a.viewers??-1));
      liveHubMatched=jp.length;
      liveHubLastAt=Date.now();
    }catch(err){
      liveHubError=String(err?.message||err);
      // Avoid displaying stale streams as if they were presently live.
      liveHubCards=[];
    }finally{
      liveHubLoading=false;
      renderLiveHub();
    }
  }
  function liveHubStyle() {
    if(document.getElementById(LIVE_HUB_STYLE_ID))return;
    const st=document.createElement('style');
    st.id=LIVE_HUB_STYLE_ID;
    st.textContent=[
      '#'+LIVE_HUB_ID+'{position:fixed;top:56px;right:0;bottom:0;left:220px;z-index:2100;overflow-y:auto;overscroll-behavior:contain;background:var(--yt-spec-base-background,#fff);color:var(--yt-spec-text-primary,#0f0f0f);font:14px Roboto,Arial,sans-serif}',
      '#'+LIVE_HUB_ID+' *{box-sizing:border-box}',
      '#'+LIVE_HUB_ID+' .nh-wrap{max-width:1800px;margin:0 auto;padding:24px 30px 80px}',
      '#'+LIVE_HUB_ID+' .nh-top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:10px}',
      '#'+LIVE_HUB_ID+' h1{font-size:24px;margin:0;font-weight:750;flex:1;min-width:220px}',
      '#'+LIVE_HUB_ID+' .nh-pill{font-size:12px;color:#f3f3f3;background:#d71d32;border-radius:7px;padding:5px 9px;font-weight:700}',
      '#'+LIVE_HUB_ID+' button{font:inherit;cursor:pointer;border:0;border-radius:18px;background:var(--yt-spec-badge-chip-background,#eee);color:inherit;padding:9px 15px}',
      '#'+LIVE_HUB_ID+' button:disabled{opacity:.5;cursor:default}',
      '#'+LIVE_HUB_ID+' .nh-meta{font-size:12px;color:var(--yt-spec-text-secondary,#666);margin:8px 0 25px}',
      '#'+LIVE_HUB_ID+' .nh-meta a{color:inherit;text-decoration:underline}',
      '#'+LIVE_HUB_ID+' .nh-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px 18px}',
      '#'+LIVE_HUB_ID+' .nh-card{min-width:0}',
      '#'+LIVE_HUB_ID+' .nh-thumb{position:relative;display:block;width:100%;aspect-ratio:16/9;background:#111;overflow:hidden;border-radius:12px;text-decoration:none;color:#fff}',
      '#'+LIVE_HUB_ID+' .nh-thumb>img{display:block;width:100%;height:100%;object-fit:cover}',
      '#'+LIVE_HUB_ID+' .nh-moving-preview{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;pointer-events:none}',
      '#'+LIVE_HUB_ID+' .nh-badge{position:absolute;left:10px;top:10px;z-index:2;background:#e21b38;color:#fff;font-size:12px;font-weight:700;border-radius:4px;padding:4px 6px}',
      '#'+LIVE_HUB_ID+' .nh-viewers{position:absolute;right:8px;bottom:8px;z-index:2;background:rgba(0,0,0,.8);font-size:12px;border-radius:4px;padding:4px 7px}',
      '#'+LIVE_HUB_ID+' .nh-info{display:flex;gap:10px;padding:12px 2px 0}',
      '#'+LIVE_HUB_ID+' .nh-avatar{width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover;background:#ddd}',
      '#'+LIVE_HUB_ID+' .nh-fallback{display:grid;place-items:center;background:#ddd;color:#333;font-weight:bold}',
      '#'+LIVE_HUB_ID+' .nh-details{min-width:0;flex:1}',
      '#'+LIVE_HUB_ID+' .nh-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4;font-weight:600;font-size:14px;color:inherit;text-decoration:none}',
      '#'+LIVE_HUB_ID+' .nh-channel{color:var(--yt-spec-text-secondary,#666);margin-top:5px;font-size:12px}',
      '#'+LIVE_HUB_ID+' .nh-note{padding:26px 18px;border-radius:12px;background:var(--yt-spec-10-percent-layer,rgba(127,127,127,.08));color:var(--yt-spec-text-secondary,#666);line-height:1.8}',
      '@media(max-width:1250px){#'+LIVE_HUB_ID+' .nh-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '@media(max-width:760px){#'+LIVE_HUB_ID+' .nh-wrap{padding:16px 12px 40px}#'+LIVE_HUB_ID+' .nh-grid{grid-template-columns:1fr}#'+LIVE_HUB_ID+' h1{font-size:20px}}'
    ].join('\n');
    (document.head||document.documentElement).append(st);
  }
  function liveHubBounds() {
    if(!liveHub)return;
    const guide=document.querySelector('ytd-app #guide, ytd-guide-renderer');
    let left=0;
    if(guide){
      const r=guide.getBoundingClientRect();
      const cs=getComputedStyle(guide);
      if(r.right>=48&&r.left<40&&r.right<window.innerWidth*.55 &&
        r.height>150&&cs.display!=='none'&&cs.visibility!=='hidden')
        left=Math.ceil(r.right);
    }
    liveHub.style.left=left+'px';
  }
  // YouTube's home page uses signed animated thumbnails, not the embedded
  // player. An embedded iframe may be blocked by the uploader (error 152).
  // Only use YouTube-issued preview URLs for the exact video.
  function liveHubAnimatedUrl(value,videoId) {
    try {
      const raw=String(value||'').replace(/\\u0026/gi,'&').replace(/&amp;/g,'&').replace(/\\\//g,'/');
      const url=new URL(raw,location.origin);
      if(url.protocol!=='https:'||!/^(?:i|i\d+)\.ytimg\.com$/i.test(url.hostname))return '';
      if(!url.pathname.startsWith('/an_webp/'+videoId+'/'))return '';
      if(!/\.webp$/i.test(url.pathname))return '';
      return url.href;
    }catch{return '';}
  }

  function liveHubVideoRendererPreview(html,videoId) {
    const parsed=youtubeEmbeddedData(html,'ytInitialData');
    if(!parsed)return '';
    const queue=[parsed];
    let visited=0;
    while(queue.length && visited++<12000) {
      const node=queue.pop();
      if(!node||typeof node!=='object')continue;
      if(Array.isArray(node)) {
        for(let i=node.length-1;i>=0;i--)queue.push(node[i]);
        continue;
      }
      const card=node.videoRenderer||node.gridVideoRenderer||node;
      const matched=card.videoId===videoId||
        (card.contentId===videoId&&card.contentType==='VIDEO');
      if(matched) {
        const thumbs=card.richThumbnail?.movingThumbnailRenderer
          ?.movingThumbnailDetails?.thumbnails
          || card.movingThumbnailRenderer?.movingThumbnailDetails?.thumbnails
          || card.richThumbnail?.movingThumbnailDetails?.thumbnails
          || [];
        for(let i=thumbs.length-1;i>=0;i--){
          const url=liveHubAnimatedUrl(thumbs[i]?.url,videoId);
          if(url)return url;
        }
      }
      for(const [key,value] of Object.entries(node)) {
        if(key==='responseContext'||key==='frameworkUpdates'||key==='playerOverlays')continue;
        if(value&&typeof value==='object')queue.push(value);
      }
    }
    return '';
  }

  function liveHubRawPreviewUrl(html,videoId) {
    // Some responses contain an_webp as an escaped JSON string without
    // the movingThumbnailRenderer wrapper.
    const raw=String(html||'');
    const regex=new RegExp('https?:\\\\/\\\\/(?:i|i\\\\d+)\\\\.ytimg\\\\.com\\\\/an_webp\\\\/'+videoId+'\\\\/[^"\\\\s<>]+?\\\\.webp(?:\\\\?[^"\\\\s<>]*)?','g');
    for(const match of raw.matchAll(regex)) {
      const url=liveHubAnimatedUrl(match[0],videoId);
      if(url)return url;
    }
    return '';
  }

  async function liveHubFindAnimatedPreview(videoId) {
    const existing=liveHubPreviewCache.get(videoId);
    if(existing && Date.now()-existing.at<LIVE_HUB_PREVIEW_CACHE_MS)return existing.url;
    // Search returns the signed URL YouTube issues for eligible videos.
    const target='https://www.youtube.com/results?search_query='+encodeURIComponent(videoId);
    try {
      const html=await mediaGet(target,1000);
      const url=liveHubVideoRendererPreview(html,videoId)
        || liveHubRawPreviewUrl(html,videoId);
      liveHubPreviewCache.set(videoId,{url,at:Date.now()});
      return url;
    }catch(error) {
      console.debug('[Nijisanji live hub][preview]',videoId,String(error?.message||error));
      return '';
    }
  }

  function liveHubStopPreview() {
    liveHubPreviewGeneration++;
    if(liveHubHoverTimer){clearTimeout(liveHubHoverTimer);liveHubHoverTimer=null;}
    if(liveHubActivePreview){
      liveHubActivePreview.querySelector('.nh-moving-preview')?.remove();
      liveHubActivePreview=null;
    }
  }

  function liveHubCard(item) {
    const card=el('article','nh-card');
    const thumb=el('a','nh-thumb');
    thumb.href=item.url;thumb.title=item.title;
    const img=el('img');
    img.src='https://i.ytimg.com/vi/'+item.id+'/hqdefault.jpg';
    img.loading='lazy';img.alt=item.title;
    thumb.append(img);
    thumb.append(el('span','nh-badge','● LIVE'));
    thumb.append(el('span','nh-viewers',
      item.viewers===null?'同接 —':item.viewers.toLocaleString('ja-JP')+' 人が視聴中'));
    const start=()=>{
      liveHubStopPreview();
      const generation=liveHubPreviewGeneration;
      liveHubHoverTimer=setTimeout(async()=>{
        liveHubHoverTimer=null;
        if(!thumb.isConnected||!liveHubActive()||document.visibilityState==='hidden')return;
        const url=await liveHubFindAnimatedPreview(item.id);
        if(!url || generation!==liveHubPreviewGeneration ||
          !thumb.matches(':hover') || !thumb.isConnected || !liveHubActive())return;
        // Preload the animation; failures keep the original static image.
        const moving=el('img','nh-moving-preview');
        moving.alt='';
        moving.decoding='async';
        moving.referrerPolicy='strict-origin-when-cross-origin';
        moving.onload=()=>{
          if(generation!==liveHubPreviewGeneration||!thumb.isConnected||
            !thumb.matches(':hover'))return;
          thumb.append(moving);
          liveHubActivePreview=thumb;
        };
        moving.onerror=()=>{
          const cache=liveHubPreviewCache.get(item.id);
          if(cache?.url===url)liveHubPreviewCache.delete(item.id);
        };
        moving.src=url;
      },420);
    };
    thumb.addEventListener('mouseenter',start);
    thumb.addEventListener('mouseleave',liveHubStopPreview);
    thumb.addEventListener('focus',()=>{});
    card.append(thumb);
    const details=el('div','nh-info');
    if(item.liver.avatar){
      const avatar=el('img','nh-avatar');
      avatar.src=item.liver.avatar;avatar.alt='';
      avatar.addEventListener('error',()=>{
        if(avatar.isConnected)avatar.replaceWith(el('span','nh-avatar nh-fallback',item.liver.name.slice(0,1)));
      },{once:true});
      details.append(avatar);
    }else details.append(el('span','nh-avatar nh-fallback',item.liver.name.slice(0,1)));
    const words=el('div','nh-details');
    const title=el('a','nh-title',item.title);
    title.href=item.url;
    words.append(title,el('div','nh-channel',item.liver.name));
    details.append(words);card.append(details);
    return card;
  }
  function renderLiveHub() {
    if(!liveHub||!liveHubActive())return;
    liveHubStopPreview();
    liveHub.replaceChildren();
    const wrap=el('div','nh-wrap');
    const top=el('div','nh-top');
    const heading=el('h1','','にじさんじ 配信中');
    top.append(heading,el('span','nh-pill','● LIVE '+liveHubCards.length));
    const refresh=el('button','',liveHubLoading?'取得中…':'↻ 更新');
    refresh.disabled=liveHubLoading;refresh.addEventListener('click',()=>void liveHubFetch());
    const close=el('button','','YouTubeトップへ');
    close.addEventListener('click',()=>location.assign('https://www.youtube.com/'));
    top.append(refresh,close);wrap.append(top);
    const meta=el('div','nh-meta',
      '同時視聴者数の多い順 ・ 約3分ごとに自動更新'+
      (liveHubLastAt?' ・ 取得候補 '+liveHubSourceCount+'件／JP一致 '+liveHubMatched+'件':'')+
      (liveHubLastAt?' ・ 取得 '+new Date(liveHubLastAt).toLocaleTimeString('ja-JP'):'')+
      ' ・ 取得元：');
    const link=el('a','','VTuberマップ');
    link.href=LIVE_HUB_SOURCE;link.target='_blank';link.rel='noopener noreferrer';
    meta.append(link);wrap.append(meta);
    if(liveHubError)wrap.append(el('div','nh-note','⚠️ '+liveHubError));
    if(!liveHubError && !liveHubCards.length){
      wrap.append(el('div','nh-note',liveHubLoading?
        '配信中ライバーを取得しています…':
        '現在、取得元でJPライバーの配信を確認できません。更新して再確認できます。'));
    }
    if(liveHubCards.length){
      const grid=el('div','nh-grid');
      for(const item of liveHubCards)grid.append(liveHubCard(item));
      wrap.append(grid);
    }
    liveHub.append(wrap);
    liveHubBounds();
  }
  function syncLiveHub() {
    if(!liveHubActive()){
      liveHubStopPreview();
      if(liveHub)liveHub.hidden=true;
      return;
    }
    liveHubStyle();
    if(!liveHub){
      liveHub=el('main');
      liveHub.id=LIVE_HUB_ID;
      liveHub.setAttribute('aria-label','にじさんじ配信中一覧');
      (document.querySelector('ytd-app')||document.body||document.documentElement).append(liveHub);
    }
    liveHub.hidden=false;
    liveHubBounds();
    renderLiveHub();
    if(!liveHubLastAt||Date.now()-liveHubLastAt>LIVE_HUB_REFRESH_MS)
      void liveHubFetch();
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
      '#'+ROOT_ID+' .nj-year{width:calc(100% - 12px)!important;max-width:calc(100% - 12px)!important;margin:0 6px;border-radius:10px;padding:8px 12px 8px 28px;min-height:36px;font-size:13px;display:flex!important;align-items:center;gap:10px;cursor:pointer;position:relative}',
      '#'+ROOT_ID+' .nj-year>*,#'+ROOT_ID+' .nj-former-group>*{pointer-events:none}',
      '#'+ROOT_ID+' .nj-year .nj-chevron{margin-left:0;width:11px}',
      '#'+ROOT_ID+' .nj-rows{padding:0 4px 0 19px}',
      '#'+ROOT_ID+' .nj-person{min-height:40px;margin:1px 4px;padding:5px 7px;border-radius:10px;display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none;font-size:13px;white-space:nowrap;overflow:hidden}',
      '#'+ROOT_ID+' .nj-person.nj-former{background:rgba(128,128,128,.15);color:var(--yt-spec-text-secondary,#777)}',
      '#'+ROOT_ID+' .nj-person.nj-former:hover{background:rgba(128,128,128,.26)}',
      '#'+ROOT_ID+' .nj-person.nj-live .nj-face{outline:2px solid #f02838;outline-offset:2px}',
      '#'+ROOT_ID+' .nj-live-badge{font-size:10px;line-height:1;color:#e31937;white-space:nowrap;font-weight:700;letter-spacing:.1px;flex-shrink:0}',
      '#'+ROOT_ID+' .nj-face{width:27px;height:27px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--yt-spec-10-percent-layer,#eee)}',
      '#'+ROOT_ID+' .nj-fallback{display:grid;place-items:center;font-size:12px;font-weight:700}',
      '#'+ROOT_ID+' .nj-name{overflow:hidden;text-overflow:ellipsis;flex:1}',
      '#'+ROOT_ID+' .nj-tag{flex-shrink:0;font-size:9px;opacity:.78}',
      '#'+ROOT_ID+' .nj-former-group{display:flex!important;align-items:center;gap:8px;padding:7px 8px;margin:5px 8px 5px 20px;width:calc(100% - 28px)!important;border-radius:9px;font-size:12px;font-weight:500;cursor:pointer;background:var(--yt-spec-10-percent-layer,rgba(128,128,128,.11))}',
      '#'+ROOT_ID+' .nj-former-group .nj-chevron{margin-left:auto}',
      '#'+ROOT_ID+' .nj-empty{padding:8px 12px 8px 27px;font-size:11px;line-height:1.6;color:var(--yt-spec-text-secondary,#777)}',
      '#'+ROOT_ID+' .nj-live-hub-link{display:block!important;width:calc(100% - 12px)!important;text-align:left;padding:10px 12px 10px 33px;margin:2px 6px 8px;border-radius:10px;font-size:13px;font-weight:600;color:inherit}',
      '#'+ROOT_ID+' .nj-live-hub-link:hover{background:var(--yt-spec-10-percent-layer,rgba(127,127,127,.1))}',
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
  function personLink(row) {
    const activeLive=!row.graduated && isLiveNow(row.url,row);
    const a=el('a','nj-person'+(row.graduated?' nj-former':'')+(activeLive?' nj-live':''));
    a.href=row.url;
    a.title=row.name+(row.date?'（'+row.date+'デビュー）':'')+
      (row.graduated?'・卒業／活動終了（公開アーカイブ確認済み）':'');
    if(row.avatar) {
      const img=el('img','nj-face');
      img.loading='lazy';img.alt='';
      img.src=row.avatar;
      img.addEventListener('error',()=>{
        if(!img.isConnected)return;
        img.replaceWith(el('span','nj-face nj-fallback',row.name.slice(0,1)));
      },{once:true});
      a.append(img);
    } else a.append(el('span','nj-face nj-fallback',row.name.slice(0,1)));
    a.append(el('span','nj-name',row.name));
    if(activeLive){
      a.title+='・現在配信中';
      a.append(el('span','nj-live-badge','● LIVE'));
    }
    if(row.graduated)a.append(el('span','nj-tag','卒業'));
    return a;
  }

  function render() {
    if(!host)return;
    host.replaceChildren();
    const head=el('button','nj-head');
    head.type='button';head.setAttribute('aria-expanded',String(state.open));
    head.append(el('span','nj-symbol','🌈'),el('span','','にじさんじ'),
      el('span','nj-chevron',state.open?'▾':'▸'));
    head.addEventListener('click',()=>{state.open=!state.open;persistState();render();});
    host.append(head);
    const hubLink=el('button','nj-live-hub-link','🔴 配信中一覧');
    hubLink.type='button';
    hubLink.title='配信中のにじさんじJPライバーをサムネイル一覧で開く';
    hubLink.addEventListener('click',openLiveHub);
    host.append(hubLink);
    if(!state.open)return;
    if(loading&&!roster)host.append(el('div','nj-message','ライバー一覧を読み込んでいます…'));
    if(lastError)host.append(el('div','nj-message','データ取得：'+lastError));
    host.append(el('div','nj-message',cloudStatus));
    const visibleLiveErrors=[...liveErrors.entries()].filter(([url])=>
      roster?.items?.some(row=>row.url===url&&!row.graduated&&state.years[row.group]===true));
    if(visibleLiveErrors.length){
      const note=el('div','nj-message','⚠️ LIVE確認できないチャンネル '+visibleLiveErrors.length+'件');
      note.title=visibleLiveErrors.slice(0,8).map(([url,reason])=>url+'：'+reason).join('\n');
      host.append(note);
    }
    if(roster){
      const visible=roster.items.filter(row=>!row.graduated && state.years[row.group]===true);
      if(visible.length){
        const current=visible.filter(row=>nativeIsLive(row) || isLiveNow(row.url));
        const checked=visible.filter(row=>liveChecks.has(row.url) &&
          !liveChecks.get(row.url)?.failed).length;
        const working=visible.filter(row=>liveQueued.has(row.url)).length;
        const errors=visible.filter(row=>liveErrors.has(row.url)).length;
        const progress=el('div','nj-message',
          '🔴 LIVE確認：'+checked+'/'+visible.length+'件'+
          ' ・配信中 '+current.length+'件'+
          (working?' ・確認中 '+working+'件':'')+
          (errors?' ・エラー '+errors+'件':''));
        progress.title='YouTube標準の登録チャンネル欄と、各チャンネルのライブ情報を照合しています';
        host.append(progress);
        const diag=el('button','nj-refresh','📋 LIVE診断をコピー');
        diag.type='button';
        diag.addEventListener('click',()=>{
          const details=[
            'にじさんじサイドバー LIVE 診断',
            '版：0.1.13',
            '確認対象：'+visible.length+'件',
            'YouTube標準LIVE：'+visible.filter(nativeIsLive).map(x=>x.name).join('、'),
            '確認中：'+working+'件',
            ...visible.map(row=>{
              const r=liveChecks.get(row.url),err=liveErrors.get(row.url)||'';
              return [row.name,row.url,
                nativeIsLive(row)?'ネイティブLIVE':'',
                r ? (r.failed?'チェック失敗':r.live?'配信中':'非配信'):'未実行',
                r?.checkedAt?new Date(r.checkedAt).toLocaleString('ja-JP'):'',
                err].filter(Boolean).join(' | ');
            })
          ].join('\n');
          try{
            const result=navigator.clipboard.writeText(details);
            Promise.resolve(result).then(()=>{diag.textContent='✅ 診断をコピーしました';})
              .catch(()=>{window.prompt('診断情報をコピーしてください',details);});
          }catch{window.prompt('診断情報をコピーしてください',details);}
        });
        host.append(diag);
      }
    }

    if(!roster) {
      const retry=el('button','nj-refresh','🔄 一覧を読み込む');
      retry.addEventListener('click',()=>void updateRoster(true));
      host.append(retry);return;
    }
    const groups=new Map();
    for(const item of roster.items) {
      if(!groups.has(item.group))groups.set(item.group,[]);
      groups.get(item.group).push(item);
    }
    for(const group of GROUPS) {
      const rows=groups.get(group)||[];
      if(!rows.length)continue;
      const open=state.years[group]===true;
      const button=el('button','nj-year');
      button.type='button';button.setAttribute('aria-expanded',String(open));
      button.append(el('span','nj-chevron',open?'▾':'▸'),
        el('span','',group),el('span','nj-chevron',String(rows.length)));
      button.addEventListener('click',()=>{
        state.years[group]=!open;
        persistState();
        if(!open){
          loadGroupMedia(group,false);
          queueVisibleLiveChecks();
        }
        render();
      });
      host.append(button);
      if(!open)continue;
      // On reload, restore avatars/archive checks for already-open groups.
      loadGroupMedia(group,state.years['former:'+group]===true);
      const active=rows.filter(row=>!row.graduated);
      const retired=rows.filter(row=>row.graduated);
      const currentList=el('div','nj-rows');
      for(const item of active)currentList.append(personLink(item));
      host.append(currentList);
      if(!retired.length)continue;
      const formerKey='former:'+group;
      const showFormer=state.years[formerKey]===true;
      const saved=retired.filter(row=>row.archived===true &&
        Date.now()-Number(row.archiveCheckedAt||0)<MEDIA_RECHECK_MS);
      const waiting=retired.filter(row=>(row.archived===null ||
        Date.now()-Number(row.archiveCheckedAt||0)>=MEDIA_RECHECK_MS) &&
        !(Date.now()-Number(mediaFailedAt.get(row.url)||0)<MEDIA_FAILURE_BACKOFF_MS));
      const toggle=el('button','nj-former-group');
      toggle.type='button';toggle.setAttribute('aria-expanded',String(showFormer));
      toggle.append(el('span','', '卒業済'),el('span','nj-chevron',
        (showFormer?'▾':'▸')+' '+saved.length+'/'+retired.length+'名'));
      toggle.addEventListener('click',()=>{
        state.years[formerKey]=!showFormer;
        persistState();
        if(!showFormer)loadGroupMedia(group,true);
        render();
      });
      host.append(toggle);
      if(showFormer){
        const formerList=el('div','nj-rows');
        for(const row of saved)formerList.append(personLink(row));
        host.append(formerList);
        if(waiting.length) {
          host.append(el('div','nj-empty','公開アーカイブの有無をYouTubeで確認しています。確認できたチャンネルだけを表示します。'));
          loadGroupMedia(group,true);
        }
        const failedRows=retired.filter(row=>mediaFailedAt.has(row.url));
        const failureCount=failedRows.length;
        if(failureCount) {
          const again=el('button','nj-refresh','⚠️ 確認できない '+failureCount+'件・再確認');
          again.title=failedRows.map(row=>row.name+'：'+(mediaFailureReasons.get(row.url)||'詳細不明')).join('\n');
          again.addEventListener('click',()=>{
            for(const row of retired){mediaFailedAt.delete(row.url);mediaFailureReasons.delete(row.url);}
            loadGroupMedia(group,true);render();
          });
          host.append(again);
          host.append(el('div','nj-empty',failedRows.slice(0,2).map(row=>row.name+'：'+(mediaFailureReasons.get(row.url)||'未確認')).join(' ／ ')));
        }else if(!saved.length&&!waiting.length){
          host.append(el('div','nj-empty','公開アーカイブを確認できた卒業済チャンネルはありません。'));
        }
      }
    }
    const timestamp=roster.at?new Date(roster.at).toLocaleDateString('ja-JP'):'';
    const refresh=el('button','nj-refresh',
      (loading?'読み込み中…':'🔄 一覧を更新')+' ・ '+roster.items.length+'名'+(timestamp?' ・ '+timestamp:''));
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
  const observer=new MutationObserver(()=>{
    scheduleMount();
    if(state.open)scheduleNativeLiveRefresh();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('yt-navigate-finish',()=>{scheduleMount();syncLiveHub();});
  window.addEventListener('hashchange',syncLiveHub);
  document.addEventListener('yt-page-data-updated',()=>{
    scheduleMount();
    queueVisibleLiveChecks();
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){
      if(liveHubActive())syncLiveHub();
      scheduleNativeLiveRefresh();
      queueVisibleLiveChecks();
    }
  });
  setInterval(()=>{
    queueVisibleLiveChecks();
    if(state.open && [...liveChecks.values()].some(x=>x.live && Date.now()-x.checkedAt>=LIVE_DISPLAY_TTL_MS))render();
  },60*1000);
  setInterval(()=>{
    if(liveHubActive()&&document.visibilityState==='visible'&&
      !liveHubLoading&&Date.now()-liveHubLastAt>=LIVE_HUB_REFRESH_MS)
      void liveHubFetch();
  },30*1000);
  window.addEventListener('resize',liveHubBounds);
  scheduleMount();
  syncLiveHub();
  scheduleNativeLiveRefresh();
  void updateRoster();
})();

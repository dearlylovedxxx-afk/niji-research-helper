// ==UserScript==
// @name         X Search Favorites
// @namespace    x-search-favorites-userscript
// @version      1.2.9
// @description  X高度検索・保存検索・履歴・いいね順。全幅タイムライン・個別ポストと画面整理の切替設定を追加。Niji Cloud対応。
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/X_Search_Favorites.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/X_Search_Favorites.user.js
// ==/UserScript==

// The early stylesheet runs before X's first paint. It uses only structural
// ancestors of the real feed, never image/video elements or player components.
(function xsfEarlyLayout() {
  'use strict';
  if (window.top !== window.self) return;
  const root=document.documentElement;
  if(!root)return;
  const settingsKey='xsf_display_settings_v1';
  const profilePattern=/^\/[a-zA-Z0-9_]{1,15}(?:\/(?:with_replies|media|likes|highlights|articles))?\/?$/;
  const excluded=new Set(['home','explore','search','notifications','i',
    'settings','messages','bookmarks','compose','jobs','lists','communities','login','logout']);
  function update(){
    const path=location.pathname;
    const first=path.split('/')[1];
    const profile=profilePattern.test(path)&&!excluded.has(first);
    const history=/^\/(?:i\/history|bookmarks|i\/bookmarks)(?:\/|$)/.test(path);
    const tweet=/\/status\/\d+(?:\/|$)/.test(path);
    const supported=profile||history||tweet||path==='/home'||
      /^\/(?:search|explore|notifications)(?:\/|$)/.test(path)||
      path.startsWith('/i/lists/')||path.startsWith('/i/communities/');
    let opts={};
    try{opts=JSON.parse(localStorage.getItem(settingsKey)||'{}')||{}}catch{}
    const guarded=tweet && opts.videoGuard!==false;
    const wide=opts.enabled===true && supported && !guarded &&
      (tweet?(opts.wideTweet!==false && opts.videoSafeTweet===false):opts.wideTimeline!==false);
    // This class deliberately does NOT activate the main XSF UI, native
    // search relocation, hide rules or DOM watchers on a video post.
    const guardedWide=opts.enabled===true && guarded &&
      opts.guardWidePost!==false && opts.wideTweet!==false;
    root.classList.toggle('xsf-guard-wide',guardedWide);
    if(guarded)document.body?.classList.remove(
      'xsf-layout-full','xsf-layout-profile','xsf-sidebar-hidden','xsf-hide-side-items',
      'xsf-native-search-on','xsf-display-active','xsf-monochrome-buttons','xsf-hide-for-you'
    );
    root.classList.toggle('xsf-pre-full',wide);
    root.classList.toggle('xsf-pre-history',wide&&history);
    root.classList.toggle('xsf-pre-profile',wide&&profile);
  }
  window.__xsfUpdateEarly=update;
  const style=document.createElement('style');
  style.id='xsf-layout-early-css';
  style.textContent=`
    html.xsf-pre-full header[role="banner"] {
      flex-grow:0!important;
      margin-inline-start:max(0px,calc((100vw - 1230px)/2))!important;
    }
    html.xsf-pre-full main[role="main"] > div {
      width:100%!important;max-width:none!important;
    }
    html.xsf-pre-full [data-testid="primaryColumn"] {
      flex:1 1 auto!important;width:100%!important;min-width:0!important;
      max-width:990px!important;translate:none!important;
    }
    html.xsf-pre-full [data-testid="sidebarColumn"] {display:none!important}
    /*
      Guarded post experiment: only native layout's flex columns are changed.
      Nothing inside the post, player, media elements, or React tree is touched.
      If the player still goes white, disabling this option restores the
      confirmed-working guarded default without uninstalling XSF.
    */
    html.xsf-guard-wide header[role="banner"] {
      flex-grow:0!important;
      margin-inline-start:max(0px,calc((100vw - 1230px)/2))!important;
    }
    html.xsf-guard-wide main[role="main"] > div {
      width:100%!important;
      max-width:none!important;
    }
    html.xsf-guard-wide [data-testid="primaryColumn"] {
      flex:1 1 auto!important;
      width:100%!important;
      max-width:990px!important;
      min-width:0!important;
    }
    html.xsf-guard-wide [data-testid="sidebarColumn"] {
      display:none!important;
    }
    /*
      Resize only the CONTAINERS of bookmark/profile items.
      :has() targets ancestors; descendants such as quoted cards,
      photos, video and player canvases never match these selectors.
      Avoid altering elements within an article entirely.
    */
    html.xsf-pre-history [data-testid="primaryColumn"] :is(div,section):not(article):not([data-testid="tweet"]):has([data-testid="cellInnerDiv"]),
    html.xsf-pre-history [data-testid="primaryColumn"] :is(div,section):not(article):not([data-testid="tweet"]):has(> article[data-testid="tweet"]),
    html.xsf-pre-history [data-testid="primaryColumn"] [data-testid="cellInnerDiv"],
    html.xsf-pre-history [data-testid="primaryColumn"] [role="tablist"],
    html.xsf-pre-profile [data-testid="primaryColumn"] :is(div,section):not(article):not([data-testid="tweet"]):has([data-testid="UserProfileHeader_Items"]),
    html.xsf-pre-profile [data-testid="primaryColumn"] :is(div,section):not(article):not([data-testid="tweet"]):has([data-testid="UserProfileHeader"]),
    html.xsf-pre-profile [data-testid="primaryColumn"] :is(div,section):not(article):not([data-testid="tweet"]):has([role="tablist"]),
    html.xsf-pre-profile [data-testid="primaryColumn"] :is(div,section):not(article):not([data-testid="tweet"]):has([data-testid="cellInnerDiv"]),
    html.xsf-pre-profile [data-testid="primaryColumn"] :is(div,section):not(article):not([data-testid="tweet"]):has(> article[data-testid="tweet"]),
    html.xsf-pre-profile [data-testid="primaryColumn"] [data-testid="cellInnerDiv"],
    html.xsf-pre-profile [data-testid="primaryColumn"] [role="tablist"] {
      width:100%!important;
      max-width:100%!important;
      min-width:0!important;
      box-sizing:border-box!important;
      align-self:stretch!important;
    }
  `;
  function mount(){
    if(!document.head)return false;
    document.head.prepend(style);
    return true;
  }
  if(!mount()){
    const mo=new MutationObserver(()=>{if(mount())mo.disconnect()});
    mo.observe(document,{childList:true,subtree:true});
  }
  update();
  // A DOM-wide MutationObserver can run for every video-frame/UI mutation.
  // Route polling only checks the URL and never inspects player descendants.
  let lastPath=location.pathname;
  const routePoll=setInterval(()=>{
    if(location.pathname===lastPath)return;
    lastPath=location.pathname;update();
  },200);
  addEventListener('popstate',update);
  addEventListener('pageshow',update);
  addEventListener('pagehide',()=>clearInterval(routePoll),{once:true});
})();

// Start the search panel after the document exists. The early CSS above
// already prevents the previous narrow initial layout.
function xsfStartWhenDomReady() {
(() => {
'use strict';
if (!/^(?:x|twitter)\.com$/i.test(location.hostname) || window.top!==window.self) return;
const VERSION='1.2.9', KEY='xsf_userscript_v1';
const isGuardedPost=()=>{
  if(!/\/status\/\d+(?:\/|$)/.test(location.pathname))return false;
  try{const saved=JSON.parse(localStorage.getItem('xsf_display_settings_v1')||'{}');return saved?.videoGuard!==false}
  catch{return true}
};
if(window.__xsfUserscriptCleanup) window.__xsfUserscriptCleanup();
let data={folders:['未分類'],savedSearches:[],history:[]}, route=location.href, filterOn=false, filterQuery='', sortOn=false, sortRows=new Map(), timer=0, lastDataRaw='';
const hidden=new Map();
let scanRunning=false, scanStop=false, scanStep=0, scanLimit=150, scanNotice='', scanOriginalY=0, manualCapture=false;

function load(){
 const raw=localStorage.getItem(KEY)||'';
 try{const obj=JSON.parse(raw||'{}');if(obj&&typeof obj==='object'){
  for(const k of ['folders','savedSearches','history'])if(Array.isArray(obj[k]))data[k]=obj[k];
 }}catch(e){console.warn('[XSF] saved data cannot be read',e);}
 if(!data.folders.includes('未分類'))data.folders.unshift('未分類');
 lastDataRaw=raw;
}
function save(){const raw=JSON.stringify(data);localStorage.setItem(KEY,raw);lastDataRaw=raw;}
function refreshSharedData(){
 const raw=localStorage.getItem(KEY)||'';
 if(raw===lastDataRaw)return;
 data={folders:['未分類'],savedSearches:[],history:[]};
 load();
 try{if(!panel.hidden)renderPanel();}catch{}
 console.info('[XSF] Niji Cloud shared data reflected');
}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function E(tag,cls='',text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function urlSearch(){return new URL(location.href).searchParams.get('q')||'';}
function activeSearch(){return location.pathname.startsWith('/search');}
function searchUrl(q,mode='live'){const p=new URLSearchParams({q,src:'typed_query'});if(['live','top','media'].includes(mode))p.set('f',mode);return 'https://x.com/search?'+p;}
function dateShift(s,days){if(!/^\d{4}-\d\d-\d\d$/.test(s||''))return '';const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function words(s){return String(s||'').trim().split(/[\s,、]+/).filter(Boolean);}
function quote(s){return '"'+String(s).replace(/"/g,'\\"')+'"';}
const fields=[['allWords','すべて含む','text'],['exactPhrase','完全一致（1行に1つ）','textarea'],['anyWords','いずれかの単語（OR）','text'],['anyPhrases','いずれかのフレーズ（OR・1行に1つ）','textarea'],['excludeWords','除外（1行に1つ）','textarea'],['fromUser','投稿者 from:','text'],['toUser','返信先 to:','text'],['mentionUser','メンション @','text'],['language','言語','select'],['excludeRetweets','RTを除外','checkbox'],['excludeReplies','返信を除外','checkbox'],['hasLinks','リンクあり','checkbox'],['mediaType','メディア','select'],['minFaves','最低いいね','number'],['minRetweets','最低RT','number'],['minReplies','最低返信','number'],['sinceDate','開始日','date'],['untilDate','終了日（含む）','date']];
let currentFields={},previewEdited=false,editingId='';
function blank(){return Object.fromEntries(fields.map(([k,,kind])=>[k,kind==='checkbox'?false:'']));}
function buildQuery(f){const o=[];
if(f.allWords?.trim())o.push(f.allWords.trim());
for(const t of String(f.exactPhrase||'').split('\n').map(v=>v.trim()).filter(Boolean))o.push(quote(t));
const any=words(f.anyWords);if(any.length)o.push(any.length>1?'('+any.join(' OR ')+')':any[0]);
const anyP=String(f.anyPhrases||'').split('\n').map(v=>v.trim()).filter(Boolean).map(quote);if(anyP.length)o.push(anyP.length>1?'('+anyP.join(' OR ')+')':anyP[0]);
for(const t of String(f.excludeWords||'').split('\n').map(v=>v.trim()).filter(Boolean))o.push('-'+(t.includes(' ')?quote(t):t));
for(const [k,prefix] of [['fromUser','from:'],['toUser','to:'],['mentionUser','@']])if(f[k]?.trim())o.push(prefix+f[k].trim().replace(/^@/,''));
if(f.language)o.push('lang:'+f.language);
if(f.excludeRetweets)o.push('-filter:retweets');if(f.excludeReplies)o.push('-filter:replies');if(f.hasLinks)o.push('filter:links');
if(f.mediaType)o.push('filter:'+f.mediaType);
for(const [k,op] of [['minFaves','min_faves:'],['minRetweets','min_retweets:'],['minReplies','min_replies:']])if(Number(f[k])>0)o.push(op+Math.floor(Number(f[k])));
if(f.sinceDate)o.push('since:'+f.sinceDate);if(f.untilDate&&dateShift(f.untilDate,1))o.push('until:'+dateShift(f.untilDate,1));
return o.join(' ');}
function splitTerms(src){const out=[];let buf='',depth=0,q=false;for(const c of String(src||'')){if(c==='"')q=!q;if(!q){if(c==='(')depth++;if(c===')')depth=Math.max(0,depth-1);if(/\s/.test(c)&&!depth){if(buf)out.push(buf);buf='';continue;}}buf+=c;}if(buf)out.push(buf);return out;}
function parseQuery(src){const f=blank(),all=[],exact=[],any=[],phrases=[],excluded=[];const raw=splitTerms(src),terms=[];
for(let i=0;i<raw.length;i++){if(i+2<raw.length&&raw[i+1].toUpperCase()==='OR'){const t=[raw[i]];while(i+2<raw.length&&raw[i+1].toUpperCase()==='OR'){t.push(raw[i+2]);i+=2;}terms.push('('+t.join(' OR ')+')');}else terms.push(raw[i]);}
for(const t of terms){let m;if(t==='-filter:retweets'){f.excludeRetweets=true;continue;}if(t==='-filter:replies'){f.excludeReplies=true;continue;}if(t==='filter:links'){f.hasLinks=true;continue;}if((m=t.match(/^filter:(images|videos|media)$/i))){f.mediaType=m[1];continue;}
if((m=t.match(/^(from:|to:)(\S+)$/i))){f[m[1].toLowerCase()==='from:'?'fromUser':'toUser']='@'+m[2].replace(/^@/,'');continue;}
if((m=t.match(/^lang:(\w+)$/i))){f.language=m[1];continue;}
if((m=t.match(/^min_(faves|retweets|replies):(\d+)$/i))){f[{faves:'minFaves',retweets:'minRetweets',replies:'minReplies'}[m[1]]]=m[2];continue;}
if((m=t.match(/^since:(\d{4}-\d\d-\d\d)$/i))){f.sinceDate=m[1];continue;}
if((m=t.match(/^until:(\d{4}-\d\d-\d\d)$/i))){f.untilDate=dateShift(m[1],-1);continue;}
if((m=t.match(/^@([\w]+)$/))){f.mentionUser=t;continue;}
if(t.startsWith('-')&&!t.includes(':')){excluded.push(t.slice(1).replace(/^"|"$/g,''));continue;}
if(/^".*"$/.test(t)){exact.push(t.slice(1,-1));continue;}
if(t.startsWith('(')&&t.endsWith(')')){const vals=splitTerms(t.slice(1,-1)).filter(v=>v!=='OR');if(vals.length>1&&vals.every(v=>/^".*"$/.test(v))){phrases.push(...vals.map(v=>v.slice(1,-1)));continue;}if(vals.length>1&&vals.every(v=>!/\s|"|:/.test(v))){any.push(...vals);continue;}}
all.push(t);}
f.allWords=all.join(' ');f.exactPhrase=exact.join('\n');f.anyWords=any.join(' ');f.anyPhrases=phrases.join('\n');f.excludeWords=excluded.join('\n');return f;}
function navigate(q,mode='live'){if(!q.trim())return;data.history=data.history.filter(x=>!(x.query===q&&x.mode===mode));data.history.unshift({id:uid(),query:q,mode,usedAt:Date.now()});data.history=data.history.slice(0,100);save();location.assign(searchUrl(q,mode));}
const host=E('div');host.id='xsf-userscript-root';host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important';
if(!isGuardedPost())(document.body||document.documentElement).append(host);const sh=host.attachShadow({mode:'open'});
const css=E('style');css.textContent=`:host{all:initial}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}#bar{position:fixed;right:12px;bottom:14px;z-index:3;display:flex;gap:5px;pointer-events:auto;font:700 12px system-ui}#bar button{border:1px solid #b3d9f2;background:#1d9bf0;color:white;border-radius:22px;padding:10px 11px;box-shadow:0 4px 15px #0004;min-height:43px}#panel,#sorted{position:fixed;right:8px;bottom:68px;z-index:2;width:min(460px,calc(100vw - 16px));height:min(760px,calc(100dvh - 82px));overflow:auto;pointer-events:auto;border:1px solid #73818b;border-radius:14px;box-shadow:0 12px 40px #0007;background:var(--bg);color:var(--fg);padding:12px;font:13px/1.5 system-ui;--bg:#fff;--fg:#0f1419;--muted:#536471;--edge:#cfd9de}#panel[hidden],#sorted[hidden]{display:none!important}h2{font-size:17px;margin:0 0 9px}h3{font-size:13px;margin:12px 0 5px}.tabs,.actions,.flex{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.tabs button,.actions button,.flex button,.small{background:#eef5fb;border:1px solid #cfd9de;border-radius:9px;color:#163d58;padding:7px 9px}.primary{background:#1d9bf0!important;color:white!important}input:not([type=checkbox]),select,textarea{width:100%;padding:8px;border:1px solid var(--edge);border-radius:8px;background:var(--bg);color:var(--fg)}label{display:block;margin:8px 0 3px;font-size:11px;font-weight:bold;color:var(--muted)}textarea{min-height:56px;resize:vertical}.tab[hidden]{display:none!important}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.check{display:flex;align-items:center;gap:5px}.check input{width:auto}.saved{border:1px solid var(--edge);border-radius:9px;padding:9px;margin:8px 0}.muted{font-size:11px;color:var(--muted)}.post{padding:11px 0;border-bottom:1px solid var(--edge)}.post a{color:#1d9bf0;overflow-wrap:anywhere}.post .body{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}.status{margin:6px 0;font-size:12px;color:var(--muted)}@media(prefers-color-scheme:dark){#panel,#sorted{--bg:#111;--fg:#e7e9ea;--muted:#9da7ae;--edge:#42494e}.tabs button,.actions button,.flex button,.small{background:#222;color:#e7e9ea}}@media(max-width:600px){#bar{right:7px;bottom:calc(155px + env(safe-area-inset-bottom, 0px));max-width:calc(100vw - 14px);flex-wrap:wrap;justify-content:flex-end}#bar button{padding:9px}#panel,#sorted{bottom:61px;height:calc(100dvh - 68px)}}`;
// The like results are a proper full-screen workspace, not a 460px sidebar.
css.textContent+=`#sorted{inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-height:none!important;bottom:auto!important;right:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;padding:20px max(18px,calc((100vw - 1060px)/2)) 60px!important;font:15px/1.6 system-ui!important;z-index:5!important;overscroll-behavior:contain!important}#sorted h2{font-size:23px!important;margin:4px 0 12px!important}#sorted .result-head{position:sticky;top:-20px;z-index:2;background:var(--bg);border-bottom:1px solid var(--edge);padding:12px 0;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}#sorted .result-head button{font-size:14px;min-height:42px}#sorted .result-count{font-size:13px;color:var(--muted);margin:12px 0}#sorted .result-card{display:flex;gap:16px;align-items:flex-start;padding:20px 10px;border-bottom:1px solid var(--edge)}#sorted .result-rank{font:750 18px system-ui;min-width:46px;color:var(--muted)}#sorted .result-content{flex:1;min-width:0}#sorted .result-byline{font-weight:700;font-size:14px;overflow-wrap:anywhere}#sorted .result-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.7;margin:8px 0}#sorted .result-link{display:inline-block;padding:8px 0;color:#1d9bf0;font-size:13px}#sorted .result-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#sorted select{width:auto;max-width:100px}#sorted .scan-state{font-size:13px;color:var(--muted);margin:9px 0}#sorted .result-empty{padding:40px 12px;font-size:15px;color:var(--muted)}@media(max-width:600px){#sorted{padding:12px 13px 80px!important}#sorted h2{font-size:19px!important}#sorted .result-card{gap:8px;padding:14px 0}#sorted .result-rank{min-width:35px;font-size:15px}#sorted .result-text{font-size:15px}}`;
// Rich post cards: recognize a post from the author, attached image/video and text.
css.textContent+=`#sorted .result-feed{max-width:780px;margin:0 auto}#sorted .result-card{display:block!important;margin:0 0 14px!important;padding:18px!important;border:1px solid var(--edge)!important;border-radius:18px!important;background:var(--bg)}#sorted .result-card-top{display:flex;gap:12px;align-items:center;margin-bottom:10px}#sorted .result-avatar{width:46px;height:46px;border-radius:50%;object-fit:cover;flex-shrink:0}#sorted .result-user{font-weight:750;font-size:16px;line-height:1.25}#sorted .result-handle{font-size:13px;color:var(--muted);overflow-wrap:anywhere}#sorted .result-rank{margin-left:auto;min-width:auto;border-radius:18px;background:#e7f4ff;color:#175d91;font:700 13px system-ui;padding:6px 10px;white-space:nowrap}#sorted .result-body{font-size:16px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 12px}#sorted .result-media{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;border-radius:14px;overflow:hidden;margin:12px 0;max-height:540px}#sorted .result-media>a{display:block;position:relative;min-height:120px;max-height:360px;background:#15202b}#sorted .result-media img{width:100%;height:100%;max-height:360px;min-height:120px;object-fit:cover;display:block}#sorted .result-media>a:only-child{grid-column:1/-1;min-height:180px}#sorted .result-media>a:only-child img{max-height:440px;object-fit:contain}#sorted .result-video-tag{position:absolute;left:10px;bottom:10px;background:#000c;color:#fff;border-radius:20px;padding:5px 12px;font:700 14px system-ui}#sorted .result-quote{border:1px solid var(--edge);border-radius:12px;margin:10px 0;padding:10px 12px;white-space:pre-wrap;font-size:14px}#sorted .result-card-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px}#sorted .result-likes{font-weight:750;color:#e0245e}#sorted .result-open{display:inline-block;padding:8px 13px!important;background:#1d9bf0!important;color:#fff!important;border-radius:22px;text-decoration:none!important;font-weight:700!important}#sorted .result-no-media{color:var(--muted);font-size:13px;background:#eef5fb;border-radius:10px;padding:12px;margin-top:10px}#sorted .result-quote a{color:#1d9bf0}#sorted .result-media-hint{color:var(--muted);font-size:11px;margin-top:-6px}@media(prefers-color-scheme:dark){#sorted .result-rank{background:#123147;color:#87cfff}#sorted .result-no-media{background:#222}}@media(max-width:600px){#sorted .result-card{padding:12px!important;margin-bottom:10px!important;border-radius:14px!important}#sorted .result-avatar{width:38px;height:38px}#sorted .result-user{font-size:14px}#sorted .result-body{font-size:15px}#sorted .result-media{max-height:420px}#sorted .result-media>a{min-height:90px}}`;
css.textContent+=`#xsf-scan-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:2147483647;background:#17212b;color:#fff;border:1px solid #6a879a;border-radius:14px;box-shadow:0 6px 24px #0007;padding:10px 12px;display:flex;gap:12px;align-items:center;max-width:calc(100vw - 20px);pointer-events:auto;font:13px/1.5 system-ui}#xsf-scan-bar[hidden]{display:none!important}#xsf-scan-bar span{max-width:min(570px,calc(100vw - 160px));overflow-wrap:anywhere}#xsf-scan-bar button{background:#1d9bf0;color:#fff;border:1px solid #84c8f1;border-radius:9px;padding:9px;min-height:42px;white-space:nowrap}@media(max-width:600px){#xsf-scan-bar{left:8px;right:8px;transform:none;bottom:8px;flex-wrap:wrap}#xsf-scan-bar span{max-width:100%}}`;
sh.append(css);const bar=E('div');bar.id='bar';const launch=E('button','', '🔎 検索');const filterBtn=E('button','', '本文一致のみ');const sortBtn=E('button','', '♥ いいね順');bar.append(launch);sh.append(bar);
// While collecting, show the real X timeline rather than covering it with a
// full-screen viewer. The small floating control stays accessible to stop.
const scanBar=E('div');scanBar.id='xsf-scan-bar';scanBar.hidden=true;
const scanBarText=E('span');scanBarText.id='xsf-scan-bar-text';
const scanBarDone=E('button','','■ 停止して結果を見る');
scanBarDone.onclick=()=>{
  scanStop=true;manualCapture=false;
  if(!scanRunning){scanBar.hidden=true;sorted.hidden=false;drawSorted();}
};
scanBar.append(scanBarText,scanBarDone);sh.append(scanBar);
const panel=E('section');panel.id='panel';panel.hidden=true;const sorted=E('section');sorted.id='sorted';sorted.hidden=true;sh.append(panel,sorted);
function closeAll(){panel.hidden=true;sorted.hidden=true;}
launch.onclick=()=>{const open=panel.hidden;closeAll();if(open){panel.hidden=false;renderPanel();}};
const status=()=>sh.querySelector('#xsf-status');function message(t){if(status())status().textContent=t;}
function renderPanel(){panel.replaceChildren();panel.append(E('h2','',`🔎 X Search Favorites v${VERSION}`));const tabs=E('div','tabs');const views=E('div');panel.append(tabs,views);for(const [id,label] of [['builder','検索'],['saved','⭐ 保存'],['history','履歴'],['layout','🖥️ 表示']]){const b=E('button','',label);b.onclick=()=>{[...views.children].forEach(v=>v.hidden=v.dataset.tab!==id);};tabs.append(b);}
const builder=E('div','tab');builder.dataset.tab='builder';const saved=E('div','tab');saved.dataset.tab='saved';saved.hidden=true;const history=E('div','tab');history.dataset.tab='history';history.hidden=true;views.append(builder,saved,history);
const layout=E('div','tab');layout.dataset.tab='layout';layout.hidden=true;views.append(layout);
(function renderDisplaySettings(){
  const api=window.__xsfLayoutAPI;
  if(!api){layout.append(E('div','muted','表示設定の初期化を確認できません。Xを再読み込みしてください。'));return;}
  const msg=E('div','muted','Control Panel for Twitterを無効にしてから、代替機能をオンにしてください。元の拡張機能を削除する前に各画面で確認を。設定はこのブラウザ内に保存されます。');
  layout.append(msg);
  const sections=[
    ['切り替え',[['enabled','表示変更機能を有効にする']]],
    ['横幅',[['wideTimeline','ホーム・リスト・コミュニティを全幅表示'],['wideTweet','ポスト個別ページ・返信も全幅表示'],['videoSafeTweet','旧方式：詳細を通常幅（完全保護オフの場合のみ）'],['videoGuard','動画完全保護：ポスト詳細ではXSFの画面変更と監視を一時停止'],['guardWidePost','動画保護を保ったまま詳細の幅だけ広げる（試験的）'],['nativeSearch','右上にX純正の検索欄を表示（実験的）']]],
    ['表示を整理',[['hideSidebarContent','おすすめ・トレンドなど右サイドバー内の余分な項目を非表示'],['hideForYou','ホームの「おすすめ」タブを非表示'],['hidePromoted','広告（プロモーション投稿）を非表示'],['hideGrok','Grok関連のメニュー・ボタンを非表示'],['hidePremium','Premium購入誘導を非表示'],['hideSubscriptions','サブスクリプション関連を非表示'],['hideMoney','Moneyメニューを非表示'],['hideJobs','求人関連の項目を非表示'],['hideAnalytics','投稿アナリティクスのリンクを非表示'],['hideMessageDrawer','右下のチャットドロワーを非表示'],['hideWhoToFollow','おすすめユーザー表示を抑制'],['hideCalls','左の「通話」を非表示'],['hideCreatorStudio','左の「クリエイタースタジオ」を非表示']]],
    ['見た目',[['monochromeButtons','投稿アクションの見た目を落ち着かせる（試験的）']]],
  ];
  for(const [heading,items] of sections){
    layout.append(E('h3','',heading));
    for(const [key,label] of items){
      const row=E('label','check');
      row.style.cssText='display:flex;gap:9px;align-items:flex-start;margin:7px 0;font-size:12px';
      const control=E('input');control.type='checkbox';control.checked=!!api.get()[key];
      control.style.cssText='margin-top:3px;flex:none';
      control.onchange=()=>api.set(key,control.checked);
      row.append(control,E('span','',label));layout.append(row);
    }
  }
  layout.append(E('div','muted','補足：時系列への強制切り替え、引用・リポストの独自処理、旧認証バッジやツイート元の復元、テーマの強制変更などは移植していません。'));
})();
function inp(parent,id,label,kind){const l=E('label','',label),v=E(kind==='textarea'?'textarea':kind==='select'?'select':'input');v.id='xsf-'+id;if(kind==='checkbox'){v.type='checkbox';l.className='check';l.prepend(v);parent.append(l);}else{if(kind==='select'){const opts=id==='language'?[['','指定なし'],['ja','日本語'],['en','英語'],['ko','韓国語'],['zh','中国語']]:[['','指定なし'],['images','画像'],['videos','動画'],['media','画像または動画']];for(const [val,text] of opts){const o=E('option','',text);o.value=val;v.append(o);}}else if(kind!=='textarea')v.type=kind;parent.append(l,v);}v.value=currentFields[id]||'';if(kind==='checkbox')v.checked=!!currentFields[id];v.oninput=()=>{currentFields[id]=kind==='checkbox'?v.checked:v.value;queryArea.value=buildQuery(currentFields);previewEdited=false;};return v;}
const tools=E('div','actions');tools.dataset.ncbSlot='x';const importCurrent=E('button','', '現在のX検索を取り込む');tools.append(importCurrent,filterBtn,sortBtn);builder.append(tools);builder.append(E('div','muted','本文一致といいね順はXの検索結果で使えます。☁️バックアップもこの欄から開けます。'));
const queryArea=E('textarea');queryArea.placeholder='検索式（直接編集可）';for(const [id,label,kind] of fields)inp(builder,id,label,kind);builder.append(E('label','','検索式（直接編集可能）'),queryArea);queryArea.value=buildQuery(currentFields);queryArea.oninput=()=>{previewEdited=true;};
const searchRow=E('div','grid'),mode=E('select');for(const [v,t] of [['live','最新'],['top','話題'],['media','メディア']]){const o=E('option','',t);o.value=v;mode.append(o);}const run=E('button','primary','🔎 検索する');searchRow.append(mode,run);builder.append(searchRow);run.onclick=()=>navigate(queryArea.value,mode.value);
const saveName=E('input');saveName.placeholder='保存名';const saveFolder=E('select'),saveBtn=E('button','primary','⭐ この条件を保存');builder.append(E('label','','検索条件を保存'),saveName,saveFolder,saveBtn);const stateMsg=E('div','status');stateMsg.id='xsf-status';builder.append(stateMsg);
function folders(){saveFolder.replaceChildren();for(const f of data.folders){const o=E('option','',f);o.value=f;saveFolder.append(o);}}folders();
function importQuery(q,chosenMode='live'){currentFields=parseQuery(q);renderPanel();const b=sh.querySelector('#xsf-allWords');if(b)b.focus();const m=sh.querySelector('#xsf-mode');if(m)m.value=chosenMode;}
importCurrent.onclick=()=>{if(!activeSearch()||!urlSearch())return message('Xの検索結果を開いてから取り込んでください。');currentFields=parseQuery(urlSearch());renderPanel();message('検索条件を取り込みました。');};
saveBtn.onclick=()=>{const name=saveName.value.trim(),query=queryArea.value.trim();if(!name||!query)return message('名前と検索式を入力してください。');const record={id:editingId||uid(),name,query,folder:saveFolder.value,mode:mode.value,updatedAt:Date.now()};data.savedSearches=editingId?data.savedSearches.map(x=>x.id===editingId?{...x,...record}:x):[record,...data.savedSearches];editingId='';save();saveName.value='';message('保存しました。');drawSaved();};
const utilities=E('div','actions'),addFolder=E('input'),addBtn=E('button','','フォルダ追加'),exportBtn=E('button','','JSON書き出し'),importFile=E('input');addFolder.placeholder='新しいフォルダ名';importFile.type='file';importFile.accept='.json,application/json';utilities.append(addBtn,exportBtn,importFile);saved.append(addFolder,utilities);const savedList=E('div');saved.append(savedList);
addBtn.onclick=()=>{const f=addFolder.value.trim();if(f&&!data.folders.includes(f)){data.folders.push(f);save();folders();drawSaved();addFolder.value='';}};
exportBtn.onclick=()=>{const txt=JSON.stringify({version:1,exportedAt:new Date().toISOString(),savedSearches:data.savedSearches,folders:data.folders},null,2);const u=URL.createObjectURL(new Blob([txt],{type:'application/json'}));const a=E('a');a.href=u;a.download='x-search-favorites-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);};
importFile.onchange=async()=>{try{const obj=JSON.parse(await importFile.files[0].text());if(!Array.isArray(obj.savedSearches)||!Array.isArray(obj.folders))throw Error('バックアップの形式が違います');data.savedSearches=obj.savedSearches.filter(x=>x&&typeof x.query==='string'&&typeof x.name==='string');data.folders=[...new Set(['未分類',...obj.folders.filter(x=>typeof x==='string')])];save();folders();drawSaved();message('JSONを読み込みました。');}catch(e){alert('読み込み失敗: '+e.message);}};
function drawSaved(){savedList.replaceChildren();for(const f of data.folders){const rows=data.savedSearches.filter(x=>(x.folder||'未分類')===f);if(!rows.length)continue;savedList.append(E('h3','',`📁 ${f}`));for(const x of rows){const row=E('div','saved');row.append(E('strong','',x.name),E('div','muted',x.query));const actions=E('div','actions');for(const [text,fn] of [['最新',()=>navigate(x.query,'live')],['話題',()=>navigate(x.query,'top')],['メディア',()=>navigate(x.query,'media')],['編集',()=>{currentFields=parseQuery(x.query);editingId=x.id;renderPanel();sh.querySelector('#xsf-saveFolder').value=x.folder||'未分類';sh.querySelector('#xsf-saveName').value=x.name;sh.querySelector('#xsf-queryArea').value=x.query;}],['削除',()=>{if(confirm('この条件を削除しますか？')){data.savedSearches=data.savedSearches.filter(v=>v.id!==x.id);save();drawSaved();}}]]){const b=E('button','',text);b.onclick=fn;actions.append(b);}row.append(actions);savedList.append(row);}}}
queryArea.id='xsf-queryArea';saveName.id='xsf-saveName';saveFolder.id='xsf-saveFolder';mode.id='xsf-mode';drawSaved();
const clear=E('button','','履歴を全削除');history.append(clear);const histList=E('div');history.append(histList);clear.onclick=()=>{if(confirm('検索履歴を消しますか？')){data.history=[];save();drawHistory();}};
function drawHistory(){histList.replaceChildren();for(const x of data.history){const row=E('div','saved');row.append(E('div','muted',x.query));const actions=E('div','actions');for(const [text,fn] of [['検索',()=>navigate(x.query,x.mode)],['保存',()=>{currentFields=parseQuery(x.query);renderPanel();sh.querySelector('#xsf-queryArea').value=x.query;sh.querySelector('#xsf-saveName').focus();}],['削除',()=>{data.history=data.history.filter(v=>v.id!==x.id);save();drawHistory();}]]){const b=E('button','',text);b.onclick=fn;actions.append(b);}row.append(actions);histList.append(row);}}drawHistory();}
function textOfTweet(article){const text=article.querySelector('[data-testid="tweetText"]');if(!text)return '';const items=[];const walk=document.createTreeWalker(text,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let n;while((n=walk.nextNode())){if(n.nodeType===3)items.push(n.nodeValue||'');else if(n.nodeType===1&&n.tagName==='IMG')items.push(n.getAttribute('alt')||'');}return items.join('');}
function normalize(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\ufe0e\ufe0f]/g,'').replace(/\s+/g,' ').trim();}
function matchText(text,q){const src=normalize(text),compact=src.replace(/\s/g,''),tokens=splitTerms(q),req=[];for(let i=0;i<tokens.length;i++){const t=tokens[i];if(!t||t.startsWith('-')||/^(?:from:|to:|lang:|filter:|since:|until:|min_)/i.test(t)||/^@\w+$/.test(t))continue;if(t==='OR')continue;let opts=[];if(t.startsWith('(')&&t.endsWith(')'))opts=splitTerms(t.slice(1,-1)).filter(x=>x!=='OR');else if(tokens[i+1]==='OR'){opts=[t];while(tokens[i+1]==='OR'&&tokens[i+2]){opts.push(tokens[i+2]);i+=2;}}else opts=[t];opts=opts.map(v=>normalize(v.replace(/^"|"$/g,''))).filter(Boolean);if(opts.length)req.push(opts);}if(!req.length)return null;return req.every(group=>group.some(w=>src.includes(w)||(!/[\p{L}\p{N}]/u.test(w)&&compact.includes(w.replace(/\s/g,'')))));}
function restore(){for(const [node,original] of hidden){if(original.value)node.style.setProperty('display',original.value,original.priority);else node.style.removeProperty('display');}hidden.clear();}
function applyFilter(){if(!filterOn||!activeSearch())return;let count=0,miss=0;for(const article of document.querySelectorAll('article[data-testid="tweet"]')){const txt=textOfTweet(article);if(!txt)continue;count++;const cell=article.closest('[data-testid="cellInnerDiv"]')||article;const matched=matchText(txt,filterQuery);if(matched===false){if(!hidden.has(cell))hidden.set(cell,{value:cell.style.getPropertyValue('display'),priority:cell.style.getPropertyPriority('display')});cell.style.setProperty('display','none','important');miss++;}else if(hidden.has(cell)){const v=hidden.get(cell);if(v.value)cell.style.setProperty('display',v.value,v.priority);else cell.style.removeProperty('display');hidden.delete(cell);}}filterBtn.textContent=`本文一致 ${filterOn?'ON':'OFF'} (${count-miss}/${count})`;}
filterBtn.onclick=()=>{if(!activeSearch()){alert('Xの検索結果ページで使ってください。');return;}if(filterOn){filterOn=false;restore();filterBtn.textContent='本文一致のみ';return;}filterQuery=urlSearch();if(matchText('検査',filterQuery)===null){alert('本文一致判定に使える検索語がありません。');return;}filterOn=true;applyFilter();};
function parseLike(value){const s=String(value||'').replace(/,/g,'').trim(),m=s.match(/([\d]+(?:\.\d+)?)\s*(万|億|千|[KkMmBb])?/);if(!m)return null;const mult={'万':1e4,'億':1e8,'千':1e3,k:1e3,m:1e6,b:1e9};return Math.round(Number(m[1])*(mult[m[2]?.toLowerCase()]||1));}
function tweetLikes(article){const btn=article.querySelector('[data-testid="like"], [data-testid="unlike"]');if(!btn)return null;const labels=[btn.getAttribute('aria-label'),btn.closest('[role="group"]')?.getAttribute('aria-label'),btn.textContent,btn.parentElement?.textContent].filter(Boolean);for(const label of labels){const m=label.match(/(?:いいね|likes?|like)\s*[:：]?\s*([\d,.]+\s*(?:万|億|千|[KkMmBb])?)/i)||label.match(/([\d,.]+\s*(?:万|億|千|[KkMmBb])?)\s*(?:件のいいね|いいね|likes?)/i);if(m)return parseLike(m[1]);}
// X often labels the button only as 'Like' and displays the number in a
// separate span. Read ONLY the known like button, never the whole action row.
const countText=String(btn.textContent||'').trim();
if(/^([\d,.]+\s*(?:万|億|千|[KkMmBb])?)$/.test(countText))return parseLike(countText);
return null;}
function httpsImage(raw) {
  try {
    const url=new URL(raw,location.origin);
    return url.protocol==='https:' ? url.href : '';
  } catch{return '';}
}
// Store the picture/video preview while X's virtualized tweet is actually in the DOM.
// Never mistake a profile image or an emoji for a tweet attachment.
function tweetMedia(article) {
  const images=[];const seen=new Set();
  const add=raw=>{
    const url=httpsImage(raw);
    if(!/^https:\/\/pbs\.twimg\.com\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|video_thumb)\//i.test(url))return;
    if(seen.has(url)||images.length>=4)return;
    seen.add(url);images.push(url);
  };
  const imgs=article.querySelectorAll('[data-testid="tweetPhoto"] img,[data-testid="videoPlayer"] img,img[src*="pbs.twimg.com/media/"],img[src*="pbs.twimg.com/ext_tw_video_thumb/"],img[src*="pbs.twimg.com/amplify_video_thumb/"],img[src*="pbs.twimg.com/tweet_video_thumb/"]');
  for(const image of imgs)add(image.currentSrc||image.getAttribute('src')||image.src);
  for(const video of article.querySelectorAll('video[poster]'))add(video.getAttribute('poster'));
  // Some X video thumbnails are CSS background images rather than <img> tags.
  for(const node of article.querySelectorAll('[data-testid="videoPlayer"] [style*="background-image"],[data-testid="videoPlayer"][style*="background-image"]')){
    const raw=node.style?.backgroundImage||'';
    const found=raw.match(/url\(["']?(https:\/\/pbs\.twimg\.com\/[^"')]+)/i);
    if(found)add(found[1]);
  }
  return {images,hasVideo:!!article.querySelector('[data-testid="videoPlayer"],video,[data-testid="videoComponent"]')};
}
function captureLikes(){
  if(!activeSearch())return;
  for(const article of document.querySelectorAll('article[data-testid="tweet"]')){
    const anchor=article.querySelector('time')?.closest('a[href*="/status/"]')||article.querySelector('a[href*="/status/"]');
    if(!anchor)continue;
    let url;
    try{url=new URL(anchor.getAttribute('href'),location.origin);if(!/^(?:x|twitter)\.com$/.test(url.hostname)||!/\/status\/\d+/.test(url.pathname))continue;}catch{continue;}
    const id=url.pathname.match(/\/status\/(\d+)/)?.[1];if(!id)continue;
    const existing=sortRows.get(id)||{};
    const text=textOfTweet(article);
    // A body-only filter should also apply to the collected results, not just
    // hide unrelated tweets behind the full-screen results view.
    if(filterOn&&matchText(text,filterQuery)===false)continue;
    const user=article.querySelector('[data-testid="User-Name"]');
    const handle=user?.textContent?.match(/@[A-Za-z0-9_]+/)?.[0]||existing.handle||('@'+url.pathname.split('/')[1]);
    const name=user?.querySelector('span')?.textContent?.trim()||existing.name||handle;
    const photo=httpsImage(article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.currentSrc||article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.getAttribute('src')||'');
    const media=tweetMedia(article);
    const texts=[...article.querySelectorAll('[data-testid="tweetText"]')];
    const quoted=texts.length>1?(texts[1].innerText||texts[1].textContent||'').trim():'';
    const statusLinks=[...article.querySelectorAll('a[href*="/status/"]')];
    const quoteAnchor=statusLinks.find(a=>{const m=a.getAttribute('href')?.match(/\/status\/(\d+)/);return m&&m[1]!==id;});
    const quotedUrl=quoteAnchor?httpsImage(quoteAnchor.getAttribute('href')):'';
    const count=tweetLikes(article);
    sortRows.set(id,{
      id,url:'https://x.com'+url.pathname,text:text||existing.text||'',likes:count??existing.likes??null,
      name,handle,avatar:photo||existing.avatar||'',
      when:article.querySelector('time[datetime]')?.getAttribute('datetime')||existing.when||'',
      images:media.images.length?media.images:existing.images||[],hasVideo:media.hasVideo||existing.hasVideo||false,
      quote:quoted||existing.quote||'',quoteUrl:quotedUrl||existing.quoteUrl||''
    });
  }
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function updateScanState(){
  const text=scanNotice||`読み込み済み ${sortRows.size}件。Xの未読み込み投稿は含まれません。`;
  const label=sh.querySelector('#xsf-scan-state');if(label)label.textContent=text;
  if(scanBarText)scanBarText.textContent=text;
}
// X may scroll the document or a nested column. Never scroll our own overlay.
function findSearchScroller(){
  let node=document.querySelector('[data-testid="primaryColumn"]');
  while(node){
    if(node.scrollHeight>node.clientHeight+80 && /(auto|scroll)/i.test(getComputedStyle(node).overflowY))return node;
    node=node.parentElement;
  }
  return document.scrollingElement||document.documentElement;
}
function scrollPosition(target){
  return Number(target?.scrollTop)||0;
}
function scrollSearch(target,offset){
  if(!target)return;
  if(target===document.scrollingElement||target===document.documentElement||target===document.body){
    if(offset===-Infinity)window.scrollTo(0,0);else window.scrollBy(0,offset);
  }else if(offset===-Infinity)target.scrollTop=0;
  else target.scrollTop+=offset;
}
function manualScan(){
  if(scanRunning)return;
  if(!activeSearch()){alert('Xの検索結果ページで使ってください。');return;}
  manualCapture=true;scanStop=false;
  scanNotice=`手動収集モード：Xの検索画面を上下にスクロールしてね。表示された投稿を蓄積中（${sortRows.size}件）。`;
  sorted.hidden=true;scanBar.hidden=false;captureLikes();updateScanState();
}
async function scanMore(){
  if(scanRunning||!activeSearch())return;
  manualCapture=false;scanRunning=true;scanStop=false;scanStep=0;
  captureLikes();
  const search=urlSearch(),goal=scanLimit,initial=sortRows.size;
  let target=findSearchScroller(),noGrowth=0,noMove=0;
  scanOriginalY=scrollPosition(target);
  scanNotice=`先頭から再走査：${sortRows.size}/${goal}件。Xの画面を表示しながら読み込みます。`;
  sorted.hidden=true;scanBar.hidden=false;updateScanState();
  try{
    // Begin at the actual top: a previously viewed high-liked post might have
    // been removed from X's virtualized DOM before the old collector started.
    scrollSearch(target,-Infinity);await delay(1000);captureLikes();
    for(let i=0;i<240&&!scanStop&&sortRows.size<goal;i++){
      if(!activeSearch()||urlSearch()!==search){scanNotice='検索条件が変わったため中断しました。';break;}
      captureLikes();const before=sortRows.size,oldY=scrollPosition(target);
      scrollSearch(target,Math.max(420,Math.round(window.innerHeight*.68)));
      await delay(1800);captureLikes();scanStep=i+1;
      let moved=Math.abs(scrollPosition(target)-oldY)>3;
      // A nested scroller can change when X rerenders its timeline.
      if(!moved){const candidate=findSearchScroller();if(candidate!==target){target=candidate;scrollSearch(target,Math.max(420,Math.round(window.innerHeight*.68)));await delay(900);captureLikes();moved=true;}}
      noGrowth=sortRows.size===before?noGrowth+1:0;
      noMove=moved?0:noMove+1;
      scanNotice=`先頭から収集中：${sortRows.size}/${goal}件／移動${scanStep}回（追加 ${sortRows.size-initial}件）。`;
      updateScanState();
      if(noGrowth>=12||noMove>=7){
        scanNotice=`Xの検索画面から新しい投稿を読み込めず、一時停止しました（${sortRows.size}件）。全件取得ではありません。手動収集も試せます。`;
        break;
      }
    }
    if(scanStop)scanNotice=`停止しました。取得済み ${sortRows.size}件は保持しています。`;
    else if(sortRows.size>=goal)scanNotice=`設定上限 ${goal}件を取得。未取得の投稿はまだある可能性があります。`;
    else if(!scanNotice.includes('一時停止')&&!scanNotice.includes('中断'))scanNotice=`収集処理を終了（${sortRows.size}件）。検索結果全件の保証はありません。`;
  }catch(err){scanNotice=`収集中にエラー：${String(err?.message||err)}。${sortRows.size}件を保持。`;console.warn('[XSF] scan error',err);}
  finally{
    scanRunning=false;scanBar.hidden=true;
    if(!manualCapture){sorted.hidden=false;drawSorted();}
  }
}
function drawSorted(){
  if(sorted.hidden)return;
  const previousScroll=sorted.scrollTop;
  sorted.replaceChildren();
  const heading=E('div','result-head');
  const name=E('div');name.append(E('h2','','♥ X検索・いいね順'),E('div','muted',`検索語：${urlSearch()||'未指定'}`));
  const actions=E('div','result-actions');
  const close=E('button','','✕ 検索画面に戻る');close.onclick=()=>{scanStop=true;sorted.hidden=true;};
  const max=E('select');max.setAttribute('aria-label','収集上限');
  for(const n of [50,150,300,500]){const opt=E('option','',`最大${n}件`);opt.value=String(n);max.append(opt);}max.value=String(scanLimit);max.disabled=scanRunning;
  max.onchange=()=>{scanLimit=Number(max.value);drawSorted();};
  const collect=E('button','primary',scanRunning?'■ 収集を停止':'⬇ さらに収集する');
  collect.onclick=()=>{if(scanRunning){scanStop=true;scanNotice='停止処理中…';updateScanState();}else void scanMore();};
  const refresh=E('button','','今の画面を追加');refresh.onclick=()=>{captureLikes();drawSorted();};
  const manual=E('button','','🖐 X画面を手動で収集');manual.onclick=manualScan;
  actions.append(max,collect,manual,refresh,close);heading.append(name,actions);sorted.append(heading);
  const state=E('div','scan-state');state.id='xsf-scan-state';sorted.append(state);updateScanState();
  const rows=[...sortRows.values()].sort((a,b)=>(b.likes??-1)-(a.likes??-1)||b.id.localeCompare(a.id));
  const unknown=rows.filter(r=>r.likes===null).length;
  sorted.append(E('div','result-count',`読み込み済みの投稿 ${rows.length}件 ／ いいね数不明 ${unknown}件。検索結果全体の順位ではありません。スクロールで新しく表示された投稿のみ追加できます。`));
// X's documented min_faves operator is more useful than pretending
// that this partial client-side list contains every popular post.
const highRow=E('div','flex');
const highMin=E('input');highMin.type='number';highMin.min='1';highMin.step='1';highMin.value='5000';
highMin.setAttribute('aria-label','Xで再検索する最低いいね数');highMin.style.width='104px';
const highBtn=E('button','','🔎 指定いいね以上をXで探す');
highBtn.onclick=()=>{
  const min=Math.floor(Number(highMin.value));
  if(!Number.isFinite(min)||min<1||min>100000000)return alert('最低いいね数を1以上で入力してください。');
  const base=urlSearch().replace(/(?:^|\s)min_faves:\d+(?=\s|$)/gi,' ').replace(/\s+/g,' ').trim();
  navigate(`${base} min_faves:${min}`,'top');
};
highRow.append(E('span','muted','X側で最低いいね数を絞って再検索（全件・順位は保証されません）：'),highMin,highBtn);
sorted.append(highRow);

  if(!rows.length)sorted.append(E('div','result-empty','検索結果をまだ取得できていません。「さらに収集する」で画面をスクロールして取得します。'));
  const list=E('div','result-feed');
  for(let i=0;i<rows.length;i++){
    const r=rows[i],card=E('article','result-card');
    let date='';try{if(r.when)date=new Date(r.when).toLocaleString('ja-JP');}catch{}
    const top=E('div','result-card-top');
    if(r.avatar){const avatar=E('img','result-avatar');avatar.src=r.avatar;avatar.alt='';avatar.loading='lazy';top.append(avatar);}
    const identity=E('div');identity.append(E('div','result-user',r.name||r.handle||'投稿者不明'),E('div','result-handle',`${r.handle||''}${date?' · '+date:''}`));
    top.append(identity,E('div','result-rank',`#${i+1}`));card.append(top);
    card.append(E('div','result-body',r.text||'（本文を読み取れませんでした。画像・動画と元のポストを確認してください）'));
    if(r.images?.length){
      const gallery=E('div','result-media');
      for(let j=0;j<Math.min(4,r.images.length);j++){
        const mediaLink=E('a');mediaLink.href=r.url;mediaLink.target='_blank';mediaLink.rel='noopener noreferrer';mediaLink.title='Xで元の投稿を開く';
        const img=E('img');img.src=r.images[j];img.alt=`投稿の添付メディア ${j+1}`;img.loading='lazy';
        mediaLink.append(img);
        if(r.hasVideo&&j===0)mediaLink.append(E('span','result-video-tag','▶ 動画を開く'));
        gallery.append(mediaLink);
      }
      card.append(gallery,E('div','result-media-hint','画像・動画をタップするとXの元の投稿を開きます。'));
    } else if(r.hasVideo){
      card.append(E('div','result-no-media','▶ 動画付きの投稿です。サムネイルを取得できなかったため、元の投稿から再生してください。'));
    }
    if(r.quote){const quote=E('div','result-quote','引用された投稿：\n'+r.quote.slice(0,700));
      if(r.quoteUrl){const a=E('a','',' 引用元を開く ↗');a.href=r.quoteUrl;a.target='_blank';a.rel='noopener noreferrer';quote.append(a);}
      card.append(quote);
    }
    const footer=E('div','result-card-footer');
    footer.append(E('span','result-likes',`♥ ${r.likes===null?'いいね数不明':r.likes.toLocaleString('ja-JP')}`));
    const open=E('a','result-open','Xでこの投稿を開く ↗');open.href=r.url;open.target='_blank';open.rel='noopener noreferrer';footer.append(open);
    card.append(footer);list.append(card);
  }
  sorted.append(list);sorted.scrollTop=previousScroll;
}
sortBtn.onclick=()=>{if(!activeSearch()){alert('Xの検索結果ページで使ってください。');return;}const open=sorted.hidden;closeAll();if(open){captureLikes();sorted.hidden=false;scanNotice=`現在読み込み済み ${sortRows.size}件。先頭から追加収集するか、X画面を手動スクロールしてね。`;drawSorted();}};
let scheduled=0,observerActive=false;
const observer=new MutationObserver(()=>{
  if(isGuardedPost()){
    observer.disconnect();observerActive=false;
    clearTimeout(scheduled);scheduled=0;
    host.remove();return;
  }
  if(scheduled)return;
  scheduled=setTimeout(()=>{
    scheduled=0;
    if(isGuardedPost())return;
    if(!host.isConnected)(document.body||document.documentElement).append(host);
    if(filterOn)applyFilter();
    if(scanRunning||manualCapture||!sorted.hidden)captureLikes();
  },350);
});
function syncCoreObserver(){
  if(isGuardedPost()){
    if(observerActive){observer.disconnect();observerActive=false;}
    if(host.isConnected)host.remove();
    scanStop=true;manualCapture=false;
    if(!scanBar.hidden)scanBar.hidden=true;
    if(!sorted.hidden)sorted.hidden=true;
    if(filterOn){filterOn=false;restore();}
    return false;
  }
  if(!observerActive){observer.observe(document.documentElement,{childList:true,subtree:true});observerActive=true;}
  if(!host.isConnected)(document.body||document.documentElement).append(host);
  return true;
}
syncCoreObserver();
timer=setInterval(()=>{
  if(!syncCoreObserver())return;
  refreshSharedData();
  if(location.href!==route){
    route=location.href;filterOn=false;filterQuery='';
    scanStop=true;manualCapture=false;scanBar.hidden=true;restore();
    filterBtn.textContent='本文一致のみ';sortRows.clear();sorted.hidden=true;
  }
  if(filterOn)applyFilter();
  if(scanRunning||manualCapture||!sorted.hidden){
    captureLikes();
    if(manualCapture){
      scanNotice=`手動収集中：${sortRows.size}件。Xの投稿をスクロールし、終了時に「停止して結果を見る」を押してね。`;
      updateScanState();
    }
  }
},1100);
const onNijiCloudApplied=()=>refreshSharedData();
window.addEventListener('niji-cloud-sync-applied',onNijiCloudApplied);
window.__xsfUserscriptCleanup=()=>{scanStop=true;manualCapture=false;observer.disconnect();clearInterval(timer);clearTimeout(scheduled);window.removeEventListener('niji-cloud-sync-applied',onNijiCloudApplied);restore();host.remove();};
load();currentFields=blank();
})();


/**
 * UI appearance migration from Control Panel for Twitter.
 * This is NOT an identical replacement: network rewriting, premium checkmark
 * conversion, tweet source restoration, and tweet feed algorithms are NOT copied.
 * All UI behavior is opt-in, preserving the existing X Search Favorites data.
 */
(() => {
  'use strict';
  if (window.top !== window.self) return;
  window.__xsfLayoutCleanup?.();
  // Remove DOM nodes from the old standalone fake-search implementations.
  for (const id of [
    'cpft-floating-search','cpft-independent-search-host',
    'cpft-native-search-fallback','cpft-fullwidth-search-fallback',
  ]) document.getElementById(id)?.remove();
  for (const id of ['cpft-native-search-styles','cpft-fullwidth-native-search-css','cpft-native-only-search-css']) {
    document.getElementById(id)?.remove();
  }
  document.body?.classList.remove('cpft-native-search-on');

  const KEY='xsf_display_settings_v1';
  const defaults={
    enabled:false,
    wideTimeline:true,wideTweet:true,videoSafeTweet:true,videoGuard:true,guardWidePost:true,nativeSearch:true,
    hideSidebarContent:true,hideForYou:false,hidePromoted:false,
    hideGrok:true,hidePremium:true,hideSubscriptions:true,
    hideMoney:true,hideJobs:true,hideAnalytics:true,
    hideMessageDrawer:true,hideWhoToFollow:true,hideCalls:true,hideCreatorStudio:true,
    monochromeButtons:false,
  };
  let options={...defaults};
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(saved && typeof saved==='object') for(const k of Object.keys(defaults)) {
      if(typeof saved[k]==='boolean') options[k]=saved[k];
    }
  }catch(e){console.warn('[XSF display] settings could not be loaded',e);}

  let style=document.getElementById('xsf-layout-style');
  if(!style){style=document.createElement('style');style.id='xsf-layout-style';document.head.append(style);}
  const hiddenSelectors={
    hideGrok:[
      'header nav a[href="/i/grok"]','[role="menuitem"] a[href="/i/grok"]',
      'a[href="/i/grok"]','button[data-testid="grokImgGen"]',
      '[data-testid="grokButton"]','[data-testid^="followups_"]',
      // X's bottom-right floating Grok launcher; independent of the XSF search button.
      '[data-testid="GrokDrawer"]','[data-testid="GrokDrawerHeader"]',
      'button[aria-label="Grok actions"]','button[aria-label="Grokに質問する"]',
      'button[aria-label="Grokのアクション"]'
    ],
    hidePremium:[
      'header nav a[href^="/i/premium"]','header nav a[href^="/i/verified"]',
      '[role="menuitem"] a[href^="/i/premium_sign_up"]',
      '[role="menuitem"] a[href="/i/account_analytics"]',
      '[data-testid="editWithPremium"]','[data-testid="highlightUpsell"]',
      '[data-testid="super-upsell-UpsellCardRenderProperties"]'
    ],
    hideSubscriptions:[
      'header nav a[href*="creator-subscriptions"]',
      'a[href$="/creator-subscriptions/subscriptions"]',
      '[data-testid$="-subscribe"]'
    ],
    hideMoney:[
      'header nav a[href="/i/money"]','a[href="/i/money"]',
      '[data-testid="ownProfilePaymentsButton"]',
      '[data-testid="ownProfilePaymentsButtonWithBalance"]'
    ],
    hideCalls:['header nav a[href="/i/calls"]','[role="menuitem"] a[href="/i/calls"]'],
    hideCreatorStudio:['header nav a[href$="/creators/studio"]','[role="menuitem"] a[href$="/creators/studio"]'],
    hideJobs:[
      'header nav a[href="/jobs"]','[role="menuitem"] a[href="/jobs"]',
      '[data-testid="jobs"]'
    ],
    hideAnalytics:[
      '[data-testid="tweet"] [role="group"] > div:has(> a[href$="/analytics"])',
      'header nav a[href="/i/account_analytics"]'
    ],
    hideMessageDrawer:['[data-testid="chat-drawer-root"]'],
    hidePromoted:['[data-testid="placementTracking"]'],
    hideWhoToFollow:[
      'aside[role="complementary"]:has(a[href^="/i/connect_people"])',
      '[data-testid="UserCell"]:has(a[href^="/i/connect_people"])'
    ]
  };
  const bodyClasses=[
    'xsf-layout-full','xsf-layout-profile','xsf-hide-side-items','xsf-sidebar-hidden','xsf-native-search-on','xsf-display-active','xsf-hide-for-you',
    'xsf-monochrome-buttons'
  ];
  let marked=[],activeSearchForm=null;
  function resetSearch(){
    document.body?.classList.remove('xsf-native-search-on');
    for(const node of marked){
      node.classList.remove('xsf-native-search-form','xsf-native-search-ancestor','xsf-native-search-hidden-ancestor');
    }
    marked=[];activeSearchForm=null;
  }
  function applyCSS(){
    const rules=[];
    rules.push(`
      /* Keep the feed in normal flex layout instead of translating
         its GPU/video subtree. Move nav and feed together via margin. */
      body.xsf-layout-full header[role="banner"] {
        flex-grow:0!important;
        margin-inline-start:max(0px, calc((100vw - 1230px) / 2))!important;
        translate:none!important;
      }
      body.xsf-layout-full [data-testid="primaryColumn"] {
        translate:none!important;
      }
      body.xsf-layout-full main[role="main"] > div {width:100%!important;max-width:none!important}
      body.xsf-layout-full [data-testid="primaryColumn"] {
        flex:1 1 auto!important;min-width:0!important;width:100%!important;max-width:990px!important
      }
      body.xsf-layout-full [data-testid="primaryColumn"] > div:first-child > div:last-child {
        max-width:990px!important
      }
      body.xsf-layout-full [data-testid="sidebarColumn"],
      body.xsf-sidebar-hidden [data-testid="sidebarColumn"] {display:none!important}
      body.xsf-hide-for-you [data-testid="primaryColumn"] nav[role="navigation"] [role="tablist"] > div:first-child {display:none!important}
      body.xsf-monochrome-buttons article[data-testid="tweet"] [role="group"] button:not(:hover) {
        filter:grayscale(1)
      }
      body.xsf-native-search-on.xsf-native-search-on [data-testid="sidebarColumn"] {
        display:block!important;position:fixed!important;inset:0 0 auto auto!important;
        width:0!important;min-width:0!important;max-width:0!important;
        height:0!important;min-height:0!important;max-height:0!important;
        padding:0!important;margin:0!important;flex:none!important;
        overflow:visible!important;pointer-events:none!important;z-index:2147483000!important
      }
      body.xsf-native-search-on.xsf-native-search-on [data-testid="sidebarColumn"] * {
        visibility:hidden!important;pointer-events:none!important
      }
      body.xsf-native-search-on.xsf-native-search-on [data-testid="sidebarColumn"] .xsf-native-search-ancestor {
        visibility:visible!important;overflow:visible!important
      }
      body.xsf-native-search-on.xsf-native-search-on [data-testid="sidebarColumn"] .xsf-native-search-hidden-ancestor {
        display:block!important
      }
      body.xsf-native-search-on.xsf-native-search-on [data-testid="sidebarColumn"] form.xsf-native-search-form {
        position:fixed!important;top:8px!important;right:14px!important;bottom:auto!important;left:auto!important;
        width:min(340px,calc(100vw - 28px))!important;max-width:min(340px,calc(100vw - 28px))!important;
        margin:0!important;transform:none!important;overflow:visible!important;
        visibility:visible!important;pointer-events:auto!important;z-index:2147483001!important
      }
      body.xsf-native-search-on.xsf-native-search-on [data-testid="sidebarColumn"] form.xsf-native-search-form,
      body.xsf-native-search-on.xsf-native-search-on [data-testid="sidebarColumn"] form.xsf-native-search-form * {
        visibility:visible!important;pointer-events:auto!important
      }
      @media(max-width:1080px){
        body.xsf-native-search-on.xsf-native-search-on [data-testid="sidebarColumn"] form.xsf-native-search-form {
          right:6px!important;width:min(240px,calc(100vw - 12px))!important;
        }
      }
    `);
    if(options.enabled) for (const [key, selectors] of Object.entries(hiddenSelectors)) {
      if(!options[key])continue;
      rules.push(selectors.map(s=>'body.xsf-display-active '+s).join(',\n')+' {display:none!important}');
    }
    style.textContent=rules.join('\n');
  }
  function markSearch(form,sidebar){
    if(form===activeSearchForm && form.isConnected)return;
    resetSearch();activeSearchForm=form;
    form.classList.add('xsf-native-search-form');marked.push(form);
    for(let parent=form.parentElement; parent && parent!==sidebar;parent=parent.parentElement){
      parent.classList.add('xsf-native-search-ancestor');
      if(getComputedStyle(parent).display==='none')parent.classList.add('xsf-native-search-hidden-ancestor');
      marked.push(parent);
    }
  }
  function syncSearch(){
    const body=document.body;
    const sidebar=document.querySelector('[data-testid="sidebarColumn"]');
    if(!body || !sidebar){resetSearch();return;}
    const newMode=options.enabled && options.nativeSearch &&
      (body.classList.contains('xsf-layout-full') || body.classList.contains('xsf-sidebar-hidden'));
    // A search field already exists in the main column on Search/Explore.
    if ((location.pathname.startsWith('/search') || location.pathname.startsWith('/explore')) &&
        document.querySelector('[data-testid="primaryColumn"] form[role="search"]')) {
      resetSearch();return;
    }
    // When Control Panel for Twitter is still enabled, maintain the previous
    // native-search restoration until the user deliberately opts into migration.
    const primary=document.querySelector('[data-testid="primaryColumn"]');
    const maxWidth=primary ? parseFloat(getComputedStyle(primary).maxWidth) : 0;
    const hiddenByExtension=getComputedStyle(sidebar).display==='none';
    const legacyMode=!options.enabled && body.matches('.HomeTimeline,.List,.Community') &&
      body.classList.contains('Sidebar') && maxWidth>=900 &&
      (hiddenByExtension || body.classList.contains('xsf-native-search-on'));
    if(!newMode && !legacyMode){resetSearch();return;}
    const input=sidebar.querySelector('input[data-testid="SearchBox_Search_Input"]')||
      sidebar.querySelector('form[role="search"] input')||
      sidebar.querySelector('[role="search"] input');
    const form=input?.closest('form[role="search"]')||input?.closest('form');
    if(!form){resetSearch();return;}
    if(form!==activeSearchForm || !form.isConnected)markSearch(form,sidebar);
    body.classList.add('xsf-native-search-on');
  }

  function syncLayout(){
    const body=document.body;
    if(!body)return;
    const path=location.pathname;
    const isTweet=path.includes('/status/') && /\/status\/\d+(?:\/|$)/.test(path);
    const firstSegment=path.split('/')[1];
    const excludedPaths=new Set([
      'home','explore','search','notifications','i','settings','messages',
      'bookmarks','compose','jobs','lists','communities','login','logout'
    ]);
    const isProfile=!isTweet && !excludedPaths.has(firstSegment) &&
      /^\/[a-zA-Z0-9_]{1,15}(?:\/(?:with_replies|media|likes|highlights|articles))?\/?$/.test(path);
    const isTimeline=path==='/home' || path.startsWith('/search') ||
      path.startsWith('/explore') || path.startsWith('/notifications') ||
      path.startsWith('/i/history') || path.startsWith('/i/bookmarks') ||
      path.startsWith('/bookmarks') || path.startsWith('/i/lists/') ||
      path.startsWith('/i/communities/') ||
      body.matches('.HomeTimeline,.List,.Community,.History,.Profile,.Search,.Bookmarks') ||
      /^\/[a-zA-Z0-9_]{1,15}(?:\/|$)/.test(path);
    const guardedPost=isTweet && options.videoGuard;
    const videoSafePage=options.enabled && options.videoSafeTweet && isTweet;
    const full=options.enabled && !guardedPost && !videoSafePage && (isTweet ? options.wideTweet : (options.wideTimeline && isTimeline));
    body.classList.toggle('xsf-layout-full',full);
    body.classList.toggle('xsf-layout-profile',full&&isProfile);
    body.classList.toggle('xsf-sidebar-hidden',options.enabled&&options.hideSidebarContent&&!guardedPost&&!videoSafePage);
    body.classList.toggle('xsf-display-active',options.enabled&&!guardedPost);
    body.classList.toggle('xsf-hide-side-items',false);
    body.classList.toggle('xsf-hide-for-you',options.enabled&&options.hideForYou&&!guardedPost);
    body.classList.toggle('xsf-monochrome-buttons',options.enabled&&options.monochromeButtons&&!guardedPost);
    if(guardedPost)resetSearch();else syncSearch();
    window.__xsfUpdateEarly?.();
  }
  let interval=setInterval(syncLayout,1200);
  const api={
    get(){return {...options}},
    set(key,val){
      if(!Object.hasOwn(defaults,key)||typeof val!=='boolean')return;
      options[key]=val;
      try{localStorage.setItem(KEY,JSON.stringify(options));}catch(e){console.warn('[XSF display] cannot save',e);}
      window.__xsfUpdateEarly?.();applyCSS();syncLayout();
    },
  };
  window.__xsfLayoutAPI=api;
  applyCSS();syncLayout();
  const cleanup=()=>{
    clearInterval(interval);
    resetSearch();
    for(const name of bodyClasses)document.body?.classList.remove(name);
    style.remove();
    if(window.__xsfLayoutAPI===api)delete window.__xsfLayoutAPI;
    if(window.__xsfLayoutCleanup===cleanup)delete window.__xsfLayoutCleanup;
  };
  window.__xsfLayoutCleanup=cleanup;
  window.addEventListener('pagehide',cleanup,{once:true});
})();

}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',xsfStartWhenDomReady,{once:true});
}else{xsfStartWhenDomReady()}

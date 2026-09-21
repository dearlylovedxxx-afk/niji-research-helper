// ==UserScript==
// @name         X Search Favorites
// @namespace    x-search-favorites-userscript
// @version      1.1.2
// @description  X高度検索・保存検索・履歴・本文一致のみ・読み込み済み検索結果のいいね順。保存先はこのスクリプト専用のローカル領域。
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/X_Search_Favorites.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/X_Search_Favorites.user.js
// ==/UserScript==
(() => {
'use strict';
if (!/^(?:x|twitter)\.com$/i.test(location.hostname) || window.top!==window.self) return;
const VERSION='1.1.2', KEY='xsf_userscript_v1';
if(window.__xsfUserscriptCleanup) window.__xsfUserscriptCleanup();
let data={folders:['未分類'],savedSearches:[],history:[]}, route=location.href, filterOn=false, filterQuery='', sortOn=false, sortRows=new Map(), timer=0;
const hidden=new Map();
let scanRunning=false, scanStop=false, scanStep=0, scanLimit=150, scanNotice='', scanOriginalY=0;

function load(){try{const obj=JSON.parse(localStorage.getItem(KEY)||'{}');if(obj&&typeof obj==='object'){
for(const k of ['folders','savedSearches','history'])if(Array.isArray(obj[k]))data[k]=obj[k];
}}catch(e){console.warn('[XSF] saved data cannot be read',e);} if(!data.folders.includes('未分類'))data.folders.unshift('未分類');}
function save(){localStorage.setItem(KEY,JSON.stringify(data));}
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
const host=E('div');host.id='xsf-userscript-root';host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483646!important;pointer-events:none!important';
(document.body||document.documentElement).append(host);const sh=host.attachShadow({mode:'open'});
const css=E('style');css.textContent=`:host{all:initial}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}#bar{position:fixed;right:12px;bottom:14px;z-index:3;display:flex;gap:5px;pointer-events:auto;font:700 12px system-ui}#bar button{border:1px solid #b3d9f2;background:#1d9bf0;color:white;border-radius:22px;padding:10px 11px;box-shadow:0 4px 15px #0004;min-height:43px}#panel,#sorted{position:fixed;right:8px;bottom:68px;z-index:2;width:min(460px,calc(100vw - 16px));height:min(760px,calc(100dvh - 82px));overflow:auto;pointer-events:auto;border:1px solid #73818b;border-radius:14px;box-shadow:0 12px 40px #0007;background:var(--bg);color:var(--fg);padding:12px;font:13px/1.5 system-ui;--bg:#fff;--fg:#0f1419;--muted:#536471;--edge:#cfd9de}#panel[hidden],#sorted[hidden]{display:none!important}h2{font-size:17px;margin:0 0 9px}h3{font-size:13px;margin:12px 0 5px}.tabs,.actions,.flex{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.tabs button,.actions button,.flex button,.small{background:#eef5fb;border:1px solid #cfd9de;border-radius:9px;color:#163d58;padding:7px 9px}.primary{background:#1d9bf0!important;color:white!important}input:not([type=checkbox]),select,textarea{width:100%;padding:8px;border:1px solid var(--edge);border-radius:8px;background:var(--bg);color:var(--fg)}label{display:block;margin:8px 0 3px;font-size:11px;font-weight:bold;color:var(--muted)}textarea{min-height:56px;resize:vertical}.tab[hidden]{display:none!important}.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.check{display:flex;align-items:center;gap:5px}.check input{width:auto}.saved{border:1px solid var(--edge);border-radius:9px;padding:9px;margin:8px 0}.muted{font-size:11px;color:var(--muted)}.post{padding:11px 0;border-bottom:1px solid var(--edge)}.post a{color:#1d9bf0;overflow-wrap:anywhere}.post .body{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}.status{margin:6px 0;font-size:12px;color:var(--muted)}@media(prefers-color-scheme:dark){#panel,#sorted{--bg:#111;--fg:#e7e9ea;--muted:#9da7ae;--edge:#42494e}.tabs button,.actions button,.flex button,.small{background:#222;color:#e7e9ea}}@media(max-width:600px){#bar{right:7px;bottom:9px}#bar button{padding:9px}#panel,#sorted{bottom:61px;height:calc(100dvh - 68px)}}`;
// The like results are a proper full-screen workspace, not a 460px sidebar.
css.textContent+=`#sorted{inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-height:none!important;bottom:auto!important;right:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;padding:20px max(18px,calc((100vw - 1060px)/2)) 60px!important;font:15px/1.6 system-ui!important;z-index:5!important;overscroll-behavior:contain!important}#sorted h2{font-size:23px!important;margin:4px 0 12px!important}#sorted .result-head{position:sticky;top:-20px;z-index:2;background:var(--bg);border-bottom:1px solid var(--edge);padding:12px 0;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}#sorted .result-head button{font-size:14px;min-height:42px}#sorted .result-count{font-size:13px;color:var(--muted);margin:12px 0}#sorted .result-card{display:flex;gap:16px;align-items:flex-start;padding:20px 10px;border-bottom:1px solid var(--edge)}#sorted .result-rank{font:750 18px system-ui;min-width:46px;color:var(--muted)}#sorted .result-content{flex:1;min-width:0}#sorted .result-byline{font-weight:700;font-size:14px;overflow-wrap:anywhere}#sorted .result-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.7;margin:8px 0}#sorted .result-link{display:inline-block;padding:8px 0;color:#1d9bf0;font-size:13px}#sorted .result-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#sorted select{width:auto;max-width:100px}#sorted .scan-state{font-size:13px;color:var(--muted);margin:9px 0}#sorted .result-empty{padding:40px 12px;font-size:15px;color:var(--muted)}@media(max-width:600px){#sorted{padding:12px 13px 80px!important}#sorted h2{font-size:19px!important}#sorted .result-card{gap:8px;padding:14px 0}#sorted .result-rank{min-width:35px;font-size:15px}#sorted .result-text{font-size:15px}}`;
sh.append(css);const bar=E('div');bar.id='bar';const launch=E('button','', '🔎 検索＋');const filterBtn=E('button','', '本文一致のみ');const sortBtn=E('button','', '♥ いいね順');bar.append(launch,filterBtn,sortBtn);sh.append(bar);
const panel=E('section');panel.id='panel';panel.hidden=true;const sorted=E('section');sorted.id='sorted';sorted.hidden=true;sh.append(panel,sorted);
function closeAll(){panel.hidden=true;sorted.hidden=true;}
launch.onclick=()=>{const open=panel.hidden;closeAll();if(open){panel.hidden=false;renderPanel();}};
const status=()=>sh.querySelector('#xsf-status');function message(t){if(status())status().textContent=t;}
function renderPanel(){panel.replaceChildren();panel.append(E('h2','',`🔎 X Search Favorites v${VERSION}`));const tabs=E('div','tabs');const views=E('div');panel.append(tabs,views);for(const [id,label] of [['builder','検索'],['saved','⭐ 保存'],['history','履歴']]){const b=E('button','',label);b.onclick=()=>{[...views.children].forEach(v=>v.hidden=v.dataset.tab!==id);};tabs.append(b);}
const builder=E('div','tab');builder.dataset.tab='builder';const saved=E('div','tab');saved.dataset.tab='saved';saved.hidden=true;const history=E('div','tab');history.dataset.tab='history';history.hidden=true;views.append(builder,saved,history);
function inp(parent,id,label,kind){const l=E('label','',label),v=E(kind==='textarea'?'textarea':kind==='select'?'select':'input');v.id='xsf-'+id;if(kind==='checkbox'){v.type='checkbox';l.className='check';l.prepend(v);parent.append(l);}else{if(kind==='select'){const opts=id==='language'?[['','指定なし'],['ja','日本語'],['en','英語'],['ko','韓国語'],['zh','中国語']]:[['','指定なし'],['images','画像'],['videos','動画'],['media','画像または動画']];for(const [val,text] of opts){const o=E('option','',text);o.value=val;v.append(o);}}else if(kind!=='textarea')v.type=kind;parent.append(l,v);}v.value=currentFields[id]||'';if(kind==='checkbox')v.checked=!!currentFields[id];v.oninput=()=>{currentFields[id]=kind==='checkbox'?v.checked:v.value;queryArea.value=buildQuery(currentFields);previewEdited=false;};return v;}
const tools=E('div','actions');const importCurrent=E('button','', '現在のX検索を取り込む');tools.append(importCurrent);builder.append(tools);
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
function captureLikes(){if(!activeSearch())return;for(const article of document.querySelectorAll('article[data-testid="tweet"]')){const anchor=article.querySelector('time')?.closest('a[href*="/status/"]')||article.querySelector('a[href*="/status/"]');if(!anchor)continue;let url;try{url=new URL(anchor.getAttribute('href'),location.origin);if(!/^(?:x|twitter)\.com$/.test(url.hostname)||!/\/status\/\d+/.test(url.pathname))continue;}catch{continue;}const id=url.pathname.match(/\/status\/(\d+)/)?.[1];if(!id)continue;const existing=sortRows.get(id)||{};const count=tweetLikes(article),text=textOfTweet(article);sortRows.set(id,{id,url:'https://x.com'+url.pathname,text:text||existing.text||'',likes:count??existing.likes??null,author:article.querySelector('[data-testid="User-Name"]')?.textContent||existing.author||('@'+url.pathname.split('/')[1]),when:article.querySelector('time[datetime]')?.getAttribute('datetime')||existing.when||''});}}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function updateScanState(){const el=sh.querySelector('#xsf-scan-state');if(el)el.textContent=scanNotice||`読み込み済み ${sortRows.size}件。Xの未読み込み投稿は含まれません。`;}
async function scanMore(){
  if(scanRunning||!activeSearch())return;
  captureLikes();scanRunning=true;scanStop=false;scanStep=0;scanOriginalY=window.scrollY;
  const search=urlSearch();const goal=scanLimit;
  const initial=sortRows.size;let noGrowth=0,noMove=0;
  scanNotice=`収集中：${sortRows.size}/${goal}件。背後のX検索画面を順にスクロールしています。`;
  drawSorted();
  try{
    for(let i=0;i<180&&!scanStop&&sortRows.size<goal;i++){
      if(!activeSearch()||urlSearch()!==search){scanNotice='検索ページが切り替わったので収集を停止しました。';break;}
      captureLikes();const oldSize=sortRows.size,oldY=window.scrollY;
      window.scrollBy(0,Math.max(620,Math.round(window.innerHeight*.82)));
      await delay(1700);
      captureLikes();scanStep=i+1;
      noGrowth=sortRows.size===oldSize?noGrowth+1:0;
      noMove=Math.abs(window.scrollY-oldY)<4?noMove+1:0;
      scanNotice=`収集中：${sortRows.size}/${goal}件 ／ スクロール${scanStep}回（今回追加 ${sortRows.size-initial}件）。`;
      if(i%3===0||sortRows.size>=goal){const oldScroll=sorted.scrollTop;drawSorted();sorted.scrollTop=oldScroll;}
      else updateScanState();
      if(noGrowth>=12||noMove>=9){scanNotice=`新しい投稿を取得できなくなったため停止しました（${sortRows.size}件）。X側で結果の続きが表示されない場合があります。`;break;}
    }
    if(scanStop)scanNotice=`手動停止：${sortRows.size}件を保持しています。`;
    else if(sortRows.size>=goal)scanNotice=`設定件数 ${goal}件まで収集しました。必要なら上限を増やして「さらに収集」できます。`;
    else if(!scanNotice.includes('停止'))scanNotice=`収集終了：${sortRows.size}件。Xが読み込ませた投稿の範囲内でのいいね順です。`;
  }catch(err){scanNotice=`収集中にエラーが発生：${String(err?.message||err)}。取得済み ${sortRows.size}件は保持しました。`;console.warn('[XSF] scan error',err);}
  finally{scanRunning=false;if(!sorted.hidden)drawSorted();}
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
  actions.append(max,collect,refresh,close);heading.append(name,actions);sorted.append(heading);
  const state=E('div','scan-state');state.id='xsf-scan-state';sorted.append(state);updateScanState();
  const rows=[...sortRows.values()].sort((a,b)=>(b.likes??-1)-(a.likes??-1)||b.id.localeCompare(a.id));
  const unknown=rows.filter(r=>r.likes===null).length;
  sorted.append(E('div','result-count',`読み込み済みの投稿 ${rows.length}件 ／ いいね数不明 ${unknown}件。検索結果全体の順位ではありません。スクロールで新しく表示された投稿のみ追加できます。`));
  if(!rows.length)sorted.append(E('div','result-empty','検索結果をまだ取得できていません。「さらに収集する」で画面をスクロールして取得します。'));
  const list=E('div');
  for(let i=0;i<rows.length;i++){
    const r=rows[i],card=E('article','result-card'),rank=E('div','result-rank',String(i+1)),body=E('div','result-content');
    let date='';try{if(r.when)date=new Date(r.when).toLocaleString('ja-JP');}catch{}
    body.append(E('div','result-byline',`${r.author||'投稿者不明'}${date?' · '+date:''}`),E('div','result-text',r.text||'（本文を取得できませんでした）'));
    const link=E('a','result-link',`♥ ${r.likes===null?'いいね数不明':r.likes.toLocaleString('ja-JP')}　元のポストを開く ↗`);
    link.href=r.url;link.target='_blank';link.rel='noopener noreferrer';body.append(link);
    card.append(rank,body);list.append(card);
  }
  sorted.append(list);sorted.scrollTop=previousScroll;
}
sortBtn.onclick=()=>{if(!activeSearch()){alert('Xの検索結果ページで使ってください。');return;}const open=sorted.hidden;closeAll();if(open){captureLikes();sorted.hidden=false;scanNotice=`現在読み込み済み ${sortRows.size}件。もっと取得するには「さらに収集する」を押してください。`;drawSorted();}};
let scheduled=0;const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=setTimeout(()=>{scheduled=0;if(!host.isConnected)(document.body||document.documentElement).append(host);if(filterOn)applyFilter();if(sortOn||!sorted.hidden)captureLikes();},350);});observer.observe(document.documentElement,{childList:true,subtree:true});
timer=setInterval(()=>{if(!host.isConnected)(document.body||document.documentElement).append(host);if(location.href!==route){route=location.href;filterOn=false;filterQuery='';restore();filterBtn.textContent='本文一致のみ';sortRows.clear();sorted.hidden=true;}if(filterOn)applyFilter();if(!sorted.hidden)captureLikes();},1100);
window.__xsfUserscriptCleanup=()=>{scanStop=true;observer.disconnect();clearInterval(timer);clearTimeout(scheduled);restore();host.remove();};
load();currentFields=blank();
})();

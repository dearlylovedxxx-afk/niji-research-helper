// ==UserScript==
// @name         Niji Cloud Backup (OR / X / Pixiv)
// @namespace    niji-cloud-backup-three-apps
// @version      0.1.5
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Cloud_Backup.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Cloud_Backup.user.js
// @description  OR検索・X保存検索・Pixiv調査DBをアプリ別にpCloudへ保存・検証・安全に統合復元。Xの一時的ないいね順投稿は含めません。
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://www.pixiv.net/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        GM.xmlhttpRequest
// @connect      niji-research-backup.dearlylovedxxx.workers.dev
// @run-at       document-idle
// @noframes
// ==/UserScript==
(async () => {
'use strict';
try { if (window.top !== window.self) return; } catch { return; }
const APPS={
 'comment2434.com':{id:'or',label:'OR検索',name:'Niji OR Results Merger'},
 'www.comment2434.com':{id:'or',label:'OR検索',name:'Niji OR Results Merger'},
 'x.com':{id:'x',label:'X Search Favorites',name:'X Search Favorites'},
 'twitter.com':{id:'x',label:'X Search Favorites',name:'X Search Favorites'},
 'www.pixiv.net':{id:'pixiv',label:'Pixivブクマ順',name:'Pixiv Bookmark Sort'},
};
const app=APPS[location.hostname.toLowerCase()];if (!app) return;
const GATEWAY='https://niji-research-backup.dearlylovedxxx.workers.dev';
const CONFIG='ncb_app_cloud_v1_'+app.id;
const CHUNK=3*1024*1024, MAX_PARTS=80;
const enc=new TextEncoder(), dec=new TextDecoder('utf-8',{fatal:true});
let settings={enabled:false,token:'',lastSavedAt:0,lastSha:''},working=false,nextScan=0,notice='未接続';
try {settings={...settings,...await GM.getValue(CONFIG,{})};}catch(e){console.warn('[NCB] config read',e);}
const device=()=>`${/iPhone|iPod/i.test(navigator.userAgent)?'iphone':/iPad/i.test(navigator.userAgent)?'ipad':/Android/i.test(navigator.userAgent)?'android':'desktop'}-${location.hostname}`.slice(0,96);
const el=(tag,klass='',value)=>{const n=document.createElement(tag);if(klass)n.className=klass;if(value!==undefined)n.textContent=value;return n;};
const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
function fromB64(s){const t=atob(s);return Uint8Array.from(t,c=>c.charCodeAt(0));}
async function saveSettings(){await GM.setValue(CONFIG,{enabled:settings.enabled,token:settings.token,lastSavedAt:settings.lastSavedAt,lastSha:settings.lastSha});}
function xhr(method,path,body=null,token=settings.token){
 return new Promise((resolve,reject)=>{
  const api=GM.xmlHttpRequest||GM.xmlhttpRequest;
  if (!api) return reject(Error('MacaqueのGM.xmlHttpRequestが使用できません'));
  try{api({method,url:GATEWAY+'/v1/app-backups/'+app.id+path,
   headers:{authorization:'Bearer '+token,'x-source-origin':location.origin,accept:'application/json',...(body===null?{}:{'content-type':'application/json'})},
   ...(body===null?{}:{data:JSON.stringify(body)}),responseType:'text',timeout:90000,
   onload:resp=>{
    let result;try{result=JSON.parse(resp.responseText||resp.response||'{}');}catch{return reject(Error('WorkerからJSON以外の応答が返りました (HTTP '+resp.status+')'));}
    if(resp.status<200||resp.status>=300||!result.ok)return reject(Error(`HTTP ${resp.status}: ${String(result.error||'通信失敗')}`));
    resolve(result);
   },onerror:e=>reject(Error('Workerとの通信に失敗しました: '+String(e?.error||e?.message||''))),
   ontimeout:()=>reject(Error('Workerとの通信がタイムアウトしました'))});}
  catch(e){reject(e);}
 });
}
// @required inside OR's isolated userscript context; never use page-visible events.
const OR_KEYS=['niji_or_merger_addon_batches_v1','niji_or_merger_addon_video_metadata_v046',
 'niji_or_merger_addon_result_sort_v046','niji_or_merger_addon_auto_v3',
 'niji_or_merger_addon_multi_v1','niji_or_merger_addon_run_v041',
 'niji_or_merger_addon_last_words_v041','niji_or_merger_addon_minimum_v1'];
async function orGet(key,fallback){
 try{if(typeof GM?.getValue==='function'){
   const value=await GM.getValue(key,undefined);if(value!==undefined)return value;
 }}catch(e){console.warn('[NCB OR GM read]',e);}
 try{const raw=localStorage.getItem('nor_addon_'+key);return raw===null?fallback:JSON.parse(raw);}
 catch{return fallback;}
}
async function orSet(key,value){
 if(typeof GM?.setValue==='function'){await GM.setValue(key,value);return;}
 localStorage.setItem('nor_addon_'+key,JSON.stringify(value));
}
async function requestOr(action,payload){
 if(action==='read'){
  const values={};for(const k of OR_KEYS)values[k]=await orGet(k,null);
  if(!Array.isArray(values[OR_KEYS[0]]))throw Error('OR検索の保存済みリストを読み込めません');
  return values;
 }
 if(action!=='merge'||!payload||typeof payload!=='object'||!Array.isArray(payload[OR_KEYS[0]]))throw Error('ORのバックアップ形式が違います');
 const current=await orGet(OR_KEYS[0],[]);
 if(!Array.isArray(current))throw Error('現在のOR保存形式が違います');
 const seen=new Set(),merged=[];
 for(const row of [...current,...payload[OR_KEYS[0]]]){
  if(!row||typeof row.label!=='string'||!Array.isArray(row.rows))continue;
  const key=String(row.signature||row.id||'');
  if(!key||seen.has(key))continue;
  seen.add(key);merged.push(row);
 }
 if(merged.length>250)throw Error('OR保存上限250件を超えるため、既存データを変更せず中止しました');
 const oldMeta=await orGet(OR_KEYS[1],{}),newMeta=payload[OR_KEYS[1]];
 const mergedMeta={...(newMeta&&!Array.isArray(newMeta)?newMeta:{}),...(oldMeta&&!Array.isArray(oldMeta)?oldMeta:{})};
 await orSet(OR_KEYS[0],merged);
 await orSet(OR_KEYS[1],mergedMeta);
 for(const key of OR_KEYS.slice(3,6)){
  const old=await orGet(key,null),incoming=payload[key];
  if(!old&&incoming&&typeof incoming==='object')await orSet(key,{...incoming,active:false});
 }
 const oldWords=await orGet(OR_KEYS[6],[]),newWords=payload[OR_KEYS[6]];
 if(Array.isArray(newWords))await orSet(OR_KEYS[6],[...new Set([...(Array.isArray(oldWords)?oldWords:[]),...newWords].filter(x=>typeof x==='string'))]);
 const sort=await orGet(OR_KEYS[2],null);
 if(!sort&&['comments','newest','oldest','title'].includes(payload[OR_KEYS[2]]))await orSet(OR_KEYS[2],payload[OR_KEYS[2]]);
 const minimum=await orGet(OR_KEYS[7],null);
 if(minimum===null&&Number.isSafeInteger(payload[OR_KEYS[7]]))await orSet(OR_KEYS[7],payload[OR_KEYS[7]]);
 return `ORリスト${merged.length}件を統合しました。comment2434を再読み込みしてください。`;
}
async function existingDb(name,create=false){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);let missing=false;
  req.onupgradeneeded=()=>{
   if(!create){missing=true;req.transaction.abort();return;}
   const db=req.result;
   if(name==='pixiv-bookmark-sort-cross-page-v02'){
    if(!db.objectStoreNames.contains('works')){const w=db.createObjectStore('works',{keyPath:'key'});w.createIndex('pending',['searchKey','status']);w.createIndex('rank',['searchKey','count']);}
    if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
   }else if(name==='pixiv-bookmark-sort-extras-v01'){
    if(!db.objectStoreNames.contains('details'))db.createObjectStore('details',{keyPath:'key'});
   }
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>missing?resolve(null):reject(req.error||Error('DBを開けません: '+name));
  req.onblocked=()=>reject(Error('DBが別タブで使用中です。Pixivの他のタブを閉じてください'));
 });
}
async function allRows(db,name){return new Promise((resolve,reject)=>{
 try{const r=db.transaction(name,'readonly').objectStore(name).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);}catch(e){reject(e);}
});}
async function pixivSnapshot(){
 const databases=[];
 for(const [name,stores] of [['pixiv-bookmark-sort-cross-page-v02',['works','meta']],['pixiv-bookmark-sort-extras-v01',['details']]]){
  const db=await existingDb(name);if(!db)continue;
  try{const data={};for(const store of stores)if(db.objectStoreNames.contains(store))data[store]=await allRows(db,store);
   if(Object.keys(data).length)databases.push({name,stores:data});
  }finally{db.close();}
 }
 const preferences={minimum:localStorage.getItem('pixiv-bookmark-sort-minimum-v03'),sort:localStorage.getItem('pixiv-bsort-view-sort-v055')};
 if (!databases.some(d=>Object.values(d.stores).some(a=>a.length)))throw Error('Pixivの調査DBに保存済みデータがありません。空のバックアップは作成しません');
 return {databases,preferences};
}
async function snapshot(){
 let payload;
 if(app.id==='or')payload={values:await requestOr('read')};
 else if(app.id==='x'){
  const saved=JSON.parse(localStorage.getItem('xsf_userscript_v1')||'{}');
  payload={savedSearches:Array.isArray(saved.savedSearches)?saved.savedSearches:[],
   folders:Array.isArray(saved.folders)?saved.folders:[],history:Array.isArray(saved.history)?saved.history:[]};
  if(!payload.savedSearches.length&&!payload.history.length)throw Error('保存検索と履歴が空のため、既存のバックアップを保護して保存しません');
 }else payload=await pixivSnapshot();
 if(app.id==='or'&&!Array.isArray(payload.values?.niji_or_merger_addon_batches_v1))
  throw Error('ORの保存データを取得できませんでした');
 if(app.id==='or'&&!payload.values.niji_or_merger_addon_batches_v1.length
    &&!payload.values.niji_or_merger_addon_run_v041?.words?.length)
  throw Error('ORの保存データが空のため、既存バックアップを保護して保存しません');
 return {format:1,app:app.name,origin:location.origin,device:device(),payload};
}
async function mergePixivDatabases(databases){
 let inserted=0;
 const allowed={'pixiv-bookmark-sort-cross-page-v02':['works','meta'],'pixiv-bookmark-sort-extras-v01':['details']};
 for(const item of databases){
  if(!allowed[item.name]||!item.stores||typeof item.stores!=='object')throw Error('PixivバックアップのDB形式が違います');
  const db=await existingDb(item.name,true);
  try{
   for(const store of allowed[item.name]){
    const rows=item.stores[store];if(!rows)continue;
    if(!Array.isArray(rows)||!db.objectStoreNames.contains(store))throw Error('Pixiv DBストアが一致しません: '+store);
    for(let offset=0;offset<rows.length;offset+=250){
     const group=rows.slice(offset,offset+250);
     inserted+=await new Promise((resolve,reject)=>{
      let added=0;const tx=db.transaction(store,'readwrite'),st=tx.objectStore(store);
      tx.oncomplete=()=>resolve(added);tx.onerror=()=>reject(tx.error||Error('DB書き込み失敗'));tx.onabort=()=>reject(tx.error||Error('DB復元中断'));
      for(const row of group){
       if(!row||typeof row.key!=='string'||!row.key)continue;
       const get=st.get(row.key);
       get.onsuccess=()=>{if(get.result===undefined){st.put(row);added++;}};
      }
     });
     stateText(`Pixivを統合中：${item.name} / ${store} ${Math.min(offset+250,rows.length)}/${rows.length}`);
    }
   }
  }finally{db.close();}
 }
 return inserted;
}
async function restore(snapshot){
 if(snapshot?.format!==1||snapshot?.app!==app.name||!snapshot.payload||typeof snapshot.payload!=='object')throw Error('バックアップ形式または対象アプリが一致しません');
 if(app.id==='or')return requestOr('merge',snapshot.payload.values);
 if(app.id==='x'){
  const prev=JSON.parse(localStorage.getItem('xsf_userscript_v1')||'{}'),old=snapshot.payload;
  if(!Array.isArray(old.savedSearches)||!Array.isArray(old.folders)||!Array.isArray(old.history))throw Error('Xの保存検索形式が違います');
  const saved=new Map();for(const row of old.savedSearches)if(row&&typeof row.query==='string'&&typeof row.name==='string')saved.set(String(row.id||row.name+'|'+row.query),row);
  for(const row of prev.savedSearches||[])if(row&&typeof row.query==='string'&&typeof row.name==='string')saved.set(String(row.id||row.name+'|'+row.query),row);
  const history=new Map();for(const row of [...old.history,...(prev.history||[])])if(row&&typeof row.query==='string')history.set(row.query+'|'+row.mode+'|'+row.usedAt,row);
  const folders=[...new Set(['未分類',...old.folders,...(prev.folders||[])].filter(x=>typeof x==='string'))];
  const result={...prev,folders,savedSearches:[...saved.values()],history:[...history.values()].sort((a,b)=>(b.usedAt||0)-(a.usedAt||0))};
  localStorage.setItem('xsf_userscript_v1',JSON.stringify(result));
  return `保存検索${result.savedSearches.length}件・履歴${result.history.length}件を統合しました。Xを再読み込みしてください。`;
 }
 const count=await mergePixivDatabases(snapshot.payload.databases||[]);
 const pref=snapshot.payload.preferences||{};
 for(const [key,v] of [['pixiv-bookmark-sort-minimum-v03',pref.minimum],['pixiv-bsort-view-sort-v055',pref.sort]])
  if(localStorage.getItem(key)===null&&typeof v==='string')localStorage.setItem(key,v);
 return `Pixivの未登録レコード${count}件を追加しました。Pixivを再読み込みしてください。`;
}
async function getBackups(token=settings.token){const r=await xhr('GET','',null,token);return r.backups||[];}
async function fetchBackup(item,token=settings.token){
 if(!item||!Number.isInteger(item.partCount)||item.partCount<1||item.partCount>MAX_PARTS)throw Error('バックアップの分割情報が不正です');
 const output=new Uint8Array(item.size);let offset=0;
 for(let i=0;i<item.partCount;i++){
  stateText(`クラウドから読み取り検証中：${i+1}/${item.partCount}`);
  const r=await xhr('GET',`/${encodeURIComponent(item.id)}/parts/${i}`,null,token);
  const bytes=fromB64(r.base64||'');
  if(await sha(bytes)!==r.sha256||offset+bytes.length>output.length)throw Error('保存済みファイルの整合性が一致しません（分割'+i+'）');
  output.set(bytes,offset);offset+=bytes.length;
 }
 if(offset!==output.length||await sha(output)!==item.sha256)throw Error('保存済みバックアップ全体のSHA-256が一致しません');
 const parsed=JSON.parse(dec.decode(output));
 if(parsed.app!==app.name||parsed.format!==1||parsed.origin!==item.origin||parsed.device!==item.device)throw Error('保存内容のアプリ・端末情報が一致しません');
 return parsed;
}
async function performBackup(force=false){
 if(working||!settings.token||!settings.enabled)return;
 working=true;update();
 try{
  stateText('端末の保存データを読み込み中…');const obj=await snapshot();
  const bytes=enc.encode(JSON.stringify(obj)),count=Math.ceil(bytes.length/CHUNK);
  if(count>MAX_PARTS)throw Error('調査DBが約240MBを超えました。データを消さずに中止しました');
  const digest=await sha(bytes);
  const current=await getBackups();
  const existing=current.find(x=>x.device===device()&&x.origin===location.origin&&x.sha256===digest);
  if(existing){
   try{
    stateText('同じ内容のバックアップを読み取り検証中…');
    await fetchBackup(existing);
    settings.lastSha=digest;settings.lastSavedAt=Date.parse(existing.createdAt)||Date.now();await saveSettings();
    stateText('✅ pCloudの同一データを読み取り検証しました（変更なし）');return;
   }catch(e){stateText('既存ファイルの検証に失敗したため、新しいバックアップを作成します：'+String(e.message||e));}
  }
  const id=crypto.randomUUID();
  for(let i=0;i<count;i++){
   const part=bytes.subarray(i*CHUNK,Math.min(bytes.length,(i+1)*CHUNK));
   stateText(`pCloudへ送信中：${i+1}/${count}（${(bytes.length/1048576).toFixed(1)}MB）`);
   const partBody={id,index:i,count,device:device(),origin:location.origin,totalSha:digest,partSha:await sha(part),base64:b64(part)};
   for(let attempt=0;attempt<3;attempt++){
    try{await xhr('POST','/parts',partBody);break;}
    catch(e){if(attempt===2||/HTTP (?:400|401|403|413|415|409)/.test(String(e.message||e)))throw e;}
   }
  }
  stateText('アップロード完了。バックアップの登録を確認中…');
  try{await xhr('POST','/commit',{id,count,device:device(),origin:location.origin,totalSha:digest});}
  catch(e){
   const verify=await getBackups().catch(()=>[]);
   if(!verify.some(b=>b.id===id))throw e;
  }
  const listed=await getBackups(),item=listed.find(b=>b.id===id);
  if(!item)throw Error('Workerでバックアップが登録されたことを確認できませんでした');
  const downloaded=await fetchBackup(item);
  if(await sha(enc.encode(JSON.stringify(downloaded)))!==digest)throw Error('保存済み内容の再照合に失敗しました');
  settings.lastSha=digest;settings.lastSavedAt=Date.now();await saveSettings();
  stateText(`✅ pCloudに保存・読み取り検証済み：${new Date(settings.lastSavedAt).toLocaleString('ja-JP')}（${count}分割）`);
 }catch(e){stateText('⚠️ バックアップ未確認：'+String(e.message||e));console.warn('[NCB]',e);}
 finally{working=false;update();}
}
async function showBackups(){
 if(working||!settings.token)return;
 working=true;update();backupList.replaceChildren();
 try{
  const backups=await getBackups();
  if(!backups.length)backupList.append(el('p','','まだバックアップはありません。'));
  for(const b of backups){
   const line=el('div','entry'),label=el('span','',`${new Date(b.createdAt).toLocaleString('ja-JP')} ／ ${b.device} ／ ${(b.size/1048576).toFixed(1)}MB`);
   const restoreBtn=el('button','','読み取り検証して統合復元');
   restoreBtn.onclick=async()=>{
    if(working)return;
    if(!confirm(`${app.label}：${b.createdAt}\n${b.origin}・${b.device} のバックアップを、既存データを残して統合しますか？`))return;
    working=true;update();
    try{const obj=await fetchBackup(b);const msg=await restore(obj);stateText('✅ '+msg);}
    catch(e){stateText('⚠️ 復元失敗：'+String(e.message||e));console.warn('[NCB restore]',e);}
    finally{working=false;update();}
   };
   line.append(label,restoreBtn);backupList.append(line);
  }
  stateText('バックアップ一覧を取得しました。復元時は全分割を読み取り、SHA-256を確認します。');
 }catch(e){stateText('⚠️ 一覧取得失敗：'+String(e.message||e));}
 finally{working=false;update();}
}
const host=el('div');host.id='ncb-backup-root';host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important';
(document.body||document.documentElement).append(host);const shadow=host.attachShadow({mode:'open'});
const css=el('style');css.textContent=`:host{all:initial}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}#launch{position:fixed;left:10px;bottom:70px;z-index:3;min-height:45px;padding:10px 13px;border:0;border-radius:24px;color:#fff;background:#156a89;box-shadow:0 4px 14px #0005;pointer-events:auto;font:700 13px system-ui}#panel{position:fixed;inset:0;z-index:4;width:100vw;height:100dvh;overflow:auto;background:#f6f8fc;color:#172337;pointer-events:auto;padding:24px max(14px,calc((100vw - 690px)/2));font:15px/1.5 system-ui}#panel[hidden]{display:none!important}h2{font-size:21px;margin:0 0 12px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}button:not(#launch){padding:10px 12px;min-height:44px;border-radius:9px;border:1px solid #95a7bf;background:white;color:#14304c;font-weight:600}button:disabled{opacity:.5}input{width:100%;min-height:42px;padding:8px;border:1px solid #9eb0c5;border-radius:8px}.status{border:1px solid #ced9e7;border-radius:9px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:white;margin:13px 0}.entry{padding:12px;border-bottom:1px solid #ccd6e2;display:flex;gap:9px;align-items:center;justify-content:space-between;flex-wrap:wrap}.note{font-size:12px;color:#526178;margin:10px 0}label{display:block;font-weight:600;margin:12px 0 6px}@media(max-width:600px){#panel{padding:15px 13px 70px}h2{font-size:18px}}`;
shadow.append(css);const launch=el('button','',`☁️ ${app.label}`);launch.id='launch';launch.style.setProperty('display','none','important');const panel=el('section');panel.id='panel';panel.hidden=true;shadow.append(launch,panel);if(app.id==='x')launch.style.setProperty('display','none','important');
const header=el('h2','',`☁️ ${app.label}：pCloudバックアップ`);
const note=el('p','note','既存のにじヘルパー用バックアップは変更しません。保存済みデータのみ対象です。Xの一時的ないいね順一覧は保存しません。自動保存はこのサイトを開いている間だけ実行されます。');
const tokenLabel=el('label','','このアプリ専用のバックアップトークン');const tokenInput=el('input');tokenInput.type='password';tokenInput.placeholder='Cloudflareに設定した専用トークン（チャットには送らない）';tokenInput.autocomplete='off';
const actions=el('div','actions'),connect=el('button','','接続・初回バックアップ'),backup=el('button','','今すぐ保存・検証'),listButton=el('button','','保存履歴・復元'),disconnect=el('button','','自動保存を停止'),close=el('button','','閉じる');
actions.append(connect,backup,listButton,disconnect,close);const info=el('div','status');const backupList=el('div');panel.append(header,note,tokenLabel,tokenInput,actions,info,backupList);
function stateText(s){notice=s;info.textContent=s;}
function update(){connect.disabled=working;backup.disabled=working||!settings.enabled;listButton.disabled=working||!settings.token;disconnect.disabled=working||!settings.enabled;}
launch.onclick=()=>{panel.hidden=!panel.hidden;update();};close.onclick=()=>{panel.hidden=true;};
connect.onclick=async()=>{
 const token=tokenInput.value.trim();if(token.length<24){stateText('24文字以上の専用トークンを入力してください');return;}
 if(working)return;working=true;update();
 try{
  stateText('WorkerとpCloudの接続を確認中…');const status=await xhr('GET','/status',null,token);
  if(!status.connected||!status.remoteOk)throw Error('pCloudが接続されていません');
  settings.token=token;settings.enabled=true;await saveSettings();tokenInput.value='';
  stateText('接続を確認しました。最初のバックアップを作成します。');
 }catch(e){stateText('⚠️ 接続できません：'+String(e.message||e));}
 finally{working=false;update();}
 if(settings.enabled)void performBackup(true);
};
backup.onclick=()=>void performBackup(true);
listButton.onclick=()=>void showBackups();
disconnect.onclick=async()=>{
 if(!confirm('この端末の自動保存を停止しますか？ pCloudに保存済みのファイルとローカルデータは削除しません。'))return;
 settings.enabled=false;settings.token='';settings.lastSha='';await saveSettings();stateText('自動保存を停止しました。保存済みバックアップは残っています。');update();
};
stateText(settings.enabled?`☁️ 自動保存は有効です。最終検証：${settings.lastSavedAt?new Date(settings.lastSavedAt).toLocaleString('ja-JP'):'まだありません'}`:'未接続：専用トークンを入力してください');update();
// Keep a single launcher per site: expose backup inside each existing tool's panel.
// Cloud credentials and data stay in this userscript; native buttons only open its panel.
function integrateNativeBackup() {
 try {
  let slot=null, nativeReady=false;
  if(app.id==='or') {
   const root=document.getElementById('niji-or-root');
   slot=root?.querySelector('.nor-body > details');
   nativeReady=!!slot;
  } else if(app.id==='x') {
   const root=document.getElementById('xsf-userscript-root')?.shadowRoot;
   nativeReady=!!root?.querySelector('#bar button');
   slot=root?.querySelector('#panel [data-ncb-slot="x"]');
  } else if(app.id==='pixiv') {
   const root=document.getElementById('pixiv-bookmark-sort-cross-page-v05')?.shadowRoot;
   const counted=root?.querySelector('.counted');
   if(counted?.parentNode) {
    slot=counted.parentNode;
    nativeReady=true;
   }
  }
  if(slot && !slot.querySelector('[data-ncb-native-backup="'+app.id+'"]')) {
   const button=document.createElement('button');
   button.type='button';
   button.dataset.ncbNativeBackup=app.id;
   button.textContent='☁️ pCloudバックアップ';
   if(app.id==='or')button.className='nor-button';
   if(app.id==='pixiv') {
    button.style.cssText='display:block!important;width:100%!important;margin:9px 0!important;min-height:44px!important;padding:10px!important;border-radius:9px!important;background:#156a89!important;color:#fff!important;border:0!important;font:700 14px system-ui!important;cursor:pointer!important';
   } else if(app.id==='x') {
    button.style.cssText='min-height:43px!important;padding:8px 10px!important;border-radius:9px!important;border:1px solid #9baeca!important;background:#e9f5fc!important;color:#173b54!important;font:700 12px system-ui!important;cursor:pointer!important';
   }
   button.addEventListener('click',()=>{panel.hidden=false;update();});
   if(app.id==='pixiv') {
    const counted=slot.querySelector('.counted');
    if(counted)counted.after(button);
    else slot.append(button);
   } else slot.append(button);
  }
  if(app.id==='x'||nativeReady) launch.style.setProperty('display','none','important');
  else launch.style.removeProperty('display');
 } catch(e) { console.warn('[NCB] native menu attachment failed',e); }
}
integrateNativeBackup();
setInterval(integrateNativeBackup,1200);
// iOS background tabs may be suspended. Use manual save before migrating phones.
setInterval(()=>{
 if(!settings.enabled||working||document.hidden||Date.now()<nextScan)return;
 nextScan=Date.now()+(app.id==='pixiv'?15:5)*60*1000;
 void performBackup(false);
},60000);
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&settings.enabled&&!working&&Date.now()>nextScan){nextScan=Date.now()+120000;void performBackup(false);}
});
})();
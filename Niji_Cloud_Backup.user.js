// ==UserScript==
// @name         Niji Cloud Backup (OR / X / Pixiv)
// @namespace    niji-cloud-backup-three-apps
// @version      0.2.4
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Cloud_Backup.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Cloud_Backup.user.js
// @description  OR・X・Pixiv・pictBLandの保存データをNiji Cloudで全端末共通化。起動時・復帰時・定期的に双方向同期し、世代バックアップも保持。
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://www.pixiv.net/*
// @match        https://pictbland.net/*
// @match        https://www.pictbland.net/*
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
 'pictbland.net':{id:'pictbland',label:'pictBLand',name:'pictBLand Tools'},
 'www.pictbland.net':{id:'pictbland',label:'pictBLand',name:'pictBLand Tools'},
};
const app=APPS[location.hostname.toLowerCase()];if (!app) return;
const GATEWAY='https://niji-research-backup.dearlylovedxxx.workers.dev';
const CONFIG='ncb_app_cloud_v1_'+app.id;
const GLOBAL_TOKEN_KEY='ncb_client_token_v1';
const CHUNK=3*1024*1024, MAX_PARTS=80;
const enc=new TextEncoder(), dec=new TextDecoder('utf-8',{fatal:true});
let settings={enabled:false,token:'',lastSavedAt:0,lastSha:'',syncInitialized:false,lastContentSha:'',lastRemoteId:'',lastSyncAt:0},working=false,nextScan=0,notice='未接続';
try {
 const savedConfig=await GM.getValue(CONFIG,null);
 if(savedConfig&&typeof savedConfig==='object')settings={...settings,...savedConfig};
 const globalToken=String(await GM.getValue(GLOBAL_TOKEN_KEY,'')||'').trim();
 if(!settings.token&&globalToken&&savedConfig===null){
  settings.token=globalToken;settings.enabled=true;
 }
}catch(e){console.warn('[NCB] config read',e);}
const device=()=>`shared-${app.id}`;
const el=(tag,klass='',value)=>{const n=document.createElement(tag);if(klass)n.className=klass;if(value!==undefined)n.textContent=value;return n;};
const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
function fromB64(s){const t=atob(s);return Uint8Array.from(t,c=>c.charCodeAt(0));}
async function saveSettings(){await GM.setValue(CONFIG,{enabled:settings.enabled,token:settings.token,lastSavedAt:settings.lastSavedAt,lastSha:settings.lastSha,syncInitialized:!!settings.syncInitialized,lastContentSha:settings.lastContentSha||'',lastRemoteId:settings.lastRemoteId||'',lastSyncAt:Number(settings.lastSyncAt||0)});}
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
 if(action==='replace'){
  if(!payload||typeof payload!=='object'||!Array.isArray(payload[OR_KEYS[0]]))throw Error('ORの共有データ形式が違います');
  for(const key of OR_KEYS){
   let value=payload[key];
   if([OR_KEYS[3],OR_KEYS[4],OR_KEYS[5]].includes(key) && value && typeof value==='object') value={...value,active:false};
   await orSet(key,value??null);
  }
  try{window.dispatchEvent(new Event('niji-cloud-or-applied'));}catch{}
  return `OR共有データを反映しました（保存結果${payload[OR_KEYS[0]].length}件）`;
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
 try{window.dispatchEvent(new Event('niji-cloud-or-applied'));}catch{}
 return `ORリスト${merged.length}件を統合しました。`;
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
async function pixivSnapshot(allowEmpty=false){
 const databases=[];
 for(const [name,stores] of [['pixiv-bookmark-sort-cross-page-v02',['works','meta']],['pixiv-bookmark-sort-extras-v01',['details']]]){
  const db=await existingDb(name);if(!db)continue;
  try{const data={};for(const store of stores)if(db.objectStoreNames.contains(store))data[store]=await allRows(db,store);
   if(Object.keys(data).length)databases.push({name,stores:data});
  }finally{db.close();}
 }
 const preferences={minimum:localStorage.getItem('pixiv-bookmark-sort-minimum-v03'),sort:localStorage.getItem('pixiv-bsort-view-sort-v055')};
 let savedSearches=[];
 try{
  const parsed=JSON.parse(localStorage.getItem('pixiv-saved-searches-v1')||'[]');
  if(Array.isArray(parsed))savedSearches=parsed.filter(row=>row&&typeof row.name==='string'&&typeof row.href==='string'&&row.href.startsWith('/')).slice(0,200);
 }catch{}
 if(!allowEmpty&&!databases.some(d=>Object.values(d.stores).some(a=>a.length))&&!savedSearches.length)throw Error('Pixivの調査DBと保存検索が空です');
 return {databases,preferences,savedSearches};
}
async function snapshot({allowEmpty=false}={}){
 let payload;
 if(app.id==='or')payload={values:await requestOr('read')};
 else if(app.id==='x'){
  let saved={};try{saved=JSON.parse(localStorage.getItem('xsf_userscript_v1')||'{}')||{};}catch{}
  payload={savedSearches:Array.isArray(saved.savedSearches)?saved.savedSearches:[],
   folders:Array.isArray(saved.folders)?saved.folders:[],history:Array.isArray(saved.history)?saved.history:[]};
  if(!allowEmpty&&!payload.savedSearches.length&&!payload.history.length)throw Error('Xの保存検索と履歴が空です');
 }else if(app.id==='pictbland'){
  let savedSearches=[];
  try{
   const parsed=JSON.parse(localStorage.getItem('pictbland-saved-search-words-v1')||'[]');
   if(Array.isArray(parsed))savedSearches=parsed.filter(row=>row&&typeof row.word==='string'&&row.word.trim()).slice(0,200);
  }catch{}
  if(!allowEmpty&&!savedSearches.length)throw Error('pictBLandの保存検索が空です');
  payload={savedSearches};
 }else payload=await pixivSnapshot(allowEmpty);
 if(app.id==='or'&&!Array.isArray(payload.values?.niji_or_merger_addon_batches_v1))
  throw Error('ORの保存データを取得できませんでした');
 if(!allowEmpty&&app.id==='or'&&!payload.values.niji_or_merger_addon_batches_v1.length
    &&!payload.values.niji_or_merger_addon_run_v041?.words?.length)
  throw Error('ORの保存データが空です');
 return {format:2,app:app.name,origin:location.origin,device:device(),payload};
}
async function payloadSha(obj){
 return sha(enc.encode(JSON.stringify(obj?.payload||{})));
}
function hasMeaningfulPayload(obj){
 const p=obj?.payload||{};
 if(app.id==='or')return !!(p.values?.[OR_KEYS[0]]?.length||p.values?.[OR_KEYS[6]]?.length||p.values?.[OR_KEYS[5]]?.words?.length);
 if(app.id==='x')return !!(p.savedSearches?.length||p.history?.length||p.folders?.length);
 if(app.id==='pictbland')return !!p.savedSearches?.length;
 return !!(p.savedSearches?.length||(p.databases||[]).some(d=>Object.values(d.stores||{}).some(rows=>Array.isArray(rows)&&rows.length))||
   p.preferences?.minimum!=null||p.preferences?.sort!=null);
}
async function mergePixivDatabases(databases,{replace=false}={}){
 let changed=0;
 const allowed={'pixiv-bookmark-sort-cross-page-v02':['works','meta'],'pixiv-bookmark-sort-extras-v01':['details']};
 const incomingByName=new Map((Array.isArray(databases)?databases:[]).map(x=>[x?.name,x]));
 for(const [name,stores] of Object.entries(allowed)){
  const item=incomingByName.get(name);
  if(!item){
   // A missing database can also mean that device never opened this feature.
   // Do not erase an entire local DB solely because the snapshot omitted it.
   continue;
  }
  if(!item.stores||typeof item.stores!=='object')throw Error('PixivバックアップのDB形式が違います');
  const db=await existingDb(name,true);
  try{
   for(const store of stores){
    const rows=item.stores[store];
    if(!Array.isArray(rows)||!db.objectStoreNames.contains(store))continue;

    if(replace){
     changed+=await new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite'),st=tx.objectStore(store);
      st.clear();
      for(const row of rows){
       if(!row||typeof row.key!=='string'||!row.key)continue;
       st.put(row);
      }
      tx.oncomplete=()=>resolve(rows.length);
      tx.onerror=()=>reject(tx.error||Error('DB書き込み失敗'));
      tx.onabort=()=>reject(tx.error||Error('DB反映中断'));
     });
     continue;
    }

    for(let offset=0;offset<rows.length;offset+=250){
     const group=rows.slice(offset,offset+250);
     changed+=await new Promise((resolve,reject)=>{
      let count=0;const tx=db.transaction(store,'readwrite'),st=tx.objectStore(store);
      tx.oncomplete=()=>resolve(count);tx.onerror=()=>reject(tx.error||Error('DB書き込み失敗'));tx.onabort=()=>reject(tx.error||Error('DB復元中断'));
      for(const row of group){
       if(!row||typeof row.key!=='string'||!row.key)continue;
       const get=st.get(row.key);
       get.onsuccess=()=>{
        const local=get.result;
        if(local===undefined){st.put(row);count++;return;}
        if(store==='works'){
         const localStatus=Number(local?.status||0),remoteStatus=Number(row?.status||0);
         if(localStatus===0&&remoteStatus!==0){st.put({...local,...row});count++;}
        }else if(store==='meta'){
         const merged={...row,...local};
         for(const key of ['nextPage','total','discovered','processed','skipped','pageSize','lastPage']){
          const a=Number(local?.[key]),b=Number(row?.[key]);
          if(Number.isFinite(a)||Number.isFinite(b))merged[key]=Math.max(Number.isFinite(a)?a:0,Number.isFinite(b)?b:0);
         }
         merged.searchDone=!!(local?.searchDone||row?.searchDone);
         st.put(merged);count++;
        }else if(store==='details'){
         st.put({...row,...local});count++;
        }
       };
      }
     });
    }
   }
  }finally{db.close();}
 }
 return changed;
}
function normalizePictRows(rows){
 const out=[],seen=new Set();
 for(const row of Array.isArray(rows)?rows:[]){
  if(!row||typeof row.word!=='string'||!row.word.trim())continue;
  const key=row.word.trim();if(seen.has(key))continue;seen.add(key);
  out.push({...row,id:typeof row.id==='string'&&row.id?row.id:crypto.randomUUID(),
   name:typeof row.name==='string'&&row.name.trim()?row.name.trim():key,
   word:key,href:typeof row.href==='string'&&row.href.startsWith('/')?row.href:''});
  if(out.length>=200)break;
 }
 return out;
}
async function restore(snap,{mode='merge'}={}){
 if(!snap||![1,2].includes(Number(snap.format))||snap.app!==app.name||!snap.payload||typeof snap.payload!=='object')throw Error('バックアップ形式または対象アプリが一致しません');
 if(app.id==='or')return requestOr(mode==='replace'?'replace':'merge',snap.payload.values);
 if(app.id==='x'){
  const prev=JSON.parse(localStorage.getItem('xsf_userscript_v1')||'{}'),old=snap.payload;
  if(!Array.isArray(old.savedSearches)||!Array.isArray(old.folders)||!Array.isArray(old.history))throw Error('Xの保存検索形式が違います');
  let result;
  if(mode==='replace'){
   result={...prev,folders:[...old.folders],savedSearches:[...old.savedSearches],history:[...old.history]};
  }else{
   const saved=new Map();for(const row of old.savedSearches)if(row&&typeof row.query==='string'&&typeof row.name==='string')saved.set(String(row.id||row.name+'|'+row.query),row);
   for(const row of prev.savedSearches||[])if(row&&typeof row.query==='string'&&typeof row.name==='string')saved.set(String(row.id||row.name+'|'+row.query),row);
   const history=new Map();for(const row of [...old.history,...(prev.history||[])])if(row&&typeof row.query==='string')history.set(row.query+'|'+row.mode+'|'+row.usedAt,row);
   const folders=[...new Set(['未分類',...old.folders,...(prev.folders||[])].filter(x=>typeof x==='string'))];
   result={...prev,folders,savedSearches:[...saved.values()],history:[...history.values()].sort((a,b)=>(b.usedAt||0)-(a.usedAt||0))};
  }
  localStorage.setItem('xsf_userscript_v1',JSON.stringify(result));
  try{window.dispatchEvent(new Event('xsf-cloud-sync-applied'));}catch{}
  try{window.dispatchEvent(new CustomEvent('niji-cloud-sync-applied',{detail:{app:'x'}}));}catch{}
  return `X共有データを反映しました（保存検索${result.savedSearches.length}件・履歴${result.history.length}件）`;
 }
 if(app.id==='pictbland'){
  const incoming=Array.isArray(snap.payload.savedSearches)?snap.payload.savedSearches:null;
  if(!incoming)throw Error('pictBLandの保存検索形式が違います');
  let rows;
  if(mode==='replace') rows=normalizePictRows(incoming);
  else{
   let current=[];try{const parsed=JSON.parse(localStorage.getItem('pictbland-saved-search-words-v1')||'[]');if(Array.isArray(parsed))current=parsed;}catch{}
   rows=normalizePictRows([...current,...incoming]);
  }
  localStorage.setItem('pictbland-saved-search-words-v1',JSON.stringify(rows));
  try{window.__pictblandSavedSearchUi?.render?.();}catch{}
  try{window.dispatchEvent(new CustomEvent('niji-cloud-sync-applied',{detail:{app:'pictbland'}}));}catch{}
  return `pictBLand共有検索${rows.length}件を反映しました`;
 }
 const count=await mergePixivDatabases(snap.payload.databases||[],{replace:mode==='replace'});
 const pref=snap.payload.preferences||{};
 if(mode==='replace'){
  if(typeof pref.minimum==='string')localStorage.setItem('pixiv-bookmark-sort-minimum-v03',pref.minimum);
  else localStorage.removeItem('pixiv-bookmark-sort-minimum-v03');
  if(typeof pref.sort==='string')localStorage.setItem('pixiv-bsort-view-sort-v055',pref.sort);
  else localStorage.removeItem('pixiv-bsort-view-sort-v055');
  const searches=(Array.isArray(snap.payload.savedSearches)?snap.payload.savedSearches:[])
    .filter(row=>row&&typeof row.name==='string'&&typeof row.href==='string'&&row.href.startsWith('/')).slice(0,200)
    .map(row=>({...row,id:typeof row.id==='string'&&row.id?row.id:crypto.randomUUID()}));
  localStorage.setItem('pixiv-saved-searches-v1',JSON.stringify(searches));
 }else{
  for(const [key,v] of [['pixiv-bookmark-sort-minimum-v03',pref.minimum],['pixiv-bsort-view-sort-v055',pref.sort]])
   if(localStorage.getItem(key)===null&&typeof v==='string')localStorage.setItem(key,v);
  let localSearches=[];try{const parsed=JSON.parse(localStorage.getItem('pixiv-saved-searches-v1')||'[]');if(Array.isArray(parsed))localSearches=parsed;}catch{}
  const incomingSearches=Array.isArray(snap.payload.savedSearches)?snap.payload.savedSearches:[];
  const merged=[],seen=new Set();
  for(const row of [...localSearches,...incomingSearches]){
   if(!row||typeof row.name!=='string'||typeof row.href!=='string'||!row.href.startsWith('/')||seen.has(row.href))continue;
   seen.add(row.href);merged.push({...row,id:typeof row.id==='string'&&row.id?row.id:crypto.randomUUID()});
   if(merged.length>=200)break;
  }
  localStorage.setItem('pixiv-saved-searches-v1',JSON.stringify(merged));
 }
 try{window.dispatchEvent(new Event('pixiv-saved-searches-changed'));}catch{}
 try{window.dispatchEvent(new CustomEvent('niji-cloud-sync-applied',{detail:{app:'pixiv'}}));}catch{}
 return `Pixiv共有データを反映しました（DB反映${count}件・保存検索${(JSON.parse(localStorage.getItem('pixiv-saved-searches-v1')||'[]')).length}件）`;
}
function genericRequest(details){
 const api=GM.xmlHttpRequest||GM.xmlhttpRequest;
 if(!api)return Promise.reject(Error('MacaqueのGM.xmlHttpRequestが使用できません'));
 return new Promise((resolve,reject)=>{
  try{api({...details,onload:resolve,onerror:e=>reject(Error('Workerとの通信に失敗しました: '+String(e?.error||e?.message||''))),ontimeout:()=>reject(Error('Workerとの通信がタイムアウトしました')),timeout:Number(details.timeout)||60000});}
  catch(e){reject(e);}
 });
}
async function genericJson(method,path,body=null,token=settings.token,responseType='text'){
 const res=await genericRequest({method,url:GATEWAY+path,headers:{authorization:'Bearer '+token,accept:'application/json',...(body===null?{}:{'content-type':'application/json'})},...(body===null?{}:{data:typeof body==='string'?body:JSON.stringify(body)}),responseType,timeout:60000});
 if(responseType!=='text')return res;
 let parsed={};try{parsed=JSON.parse(res.responseText||res.response||'{}');}catch{throw Error('WorkerからJSON以外の応答が返りました (HTTP '+res.status+')');}
 if(res.status<200||res.status>=300||!parsed.ok)throw Error(`HTTP ${res.status}: ${String(parsed.error||'通信失敗')}`);
 return parsed;
}
async function getBackups(token=settings.token){
 if(app.id==='pictbland'){
  const r=await genericJson('GET','/v1/backups?device='+encodeURIComponent(device()),null,token);
  return r.backups||[];
 }
 const r=await xhr('GET','',null,token);return r.backups||[];
}
async function fetchBackup(item,token=settings.token){
 if(app.id==='pictbland'){
  if(!item?.id||!item?.sha256)throw Error('バックアップ情報が不正です');
  const res=await genericJson('GET','/v1/backups/'+encodeURIComponent(item.id),null,token,'arraybuffer');
  if(res.status!==200)throw Error('pCloud読込 HTTP '+res.status);
  const raw=res.response instanceof ArrayBuffer?new Uint8Array(res.response):ArrayBuffer.isView(res.response)?new Uint8Array(res.response.buffer,res.response.byteOffset,res.response.byteLength):enc.encode(res.responseText||String(res.response||''));
  if(Number(item.size||0)&&raw.byteLength!==Number(item.size))throw Error('保存済みファイルのサイズが一致しません');
  if(await sha(raw)!==item.sha256)throw Error('保存済みファイルのSHA-256が一致しません');
  const wrapper=JSON.parse(dec.decode(raw));
  const snap=wrapper?.preferences?.nijiCloudSnapshot;
  if(wrapper?.app!=='Niji Research Helper'||wrapper?.device!==device()||!snap)throw Error('pictBLand共有バックアップ形式が違います');
  return snap;
 }
 if(!item||!Number.isInteger(item.partCount)||item.partCount<1||item.partCount>MAX_PARTS)throw Error('バックアップの分割情報が不正です');
 const output=new Uint8Array(item.size);let offset=0;
 for(let i=0;i<item.partCount;i++){
  const r=await xhr('GET',`/${encodeURIComponent(item.id)}/parts/${i}`,null,token);
  const bytes=fromB64(r.base64||'');
  if(await sha(bytes)!==r.sha256||offset+bytes.length>output.length)throw Error('保存済みファイルの整合性が一致しません（分割'+i+'）');
  output.set(bytes,offset);offset+=bytes.length;
 }
 if(offset!==output.length||await sha(output)!==item.sha256)throw Error('保存済みバックアップ全体のSHA-256が一致しません');
 const parsed=JSON.parse(dec.decode(output));
 if(parsed.app!==app.name||![1,2].includes(Number(parsed.format))||parsed.origin!==item.origin||parsed.device!==item.device)throw Error('保存内容のアプリ・端末情報が一致しません');
 return parsed;
}
async function uploadSnapshot(obj){
 obj={...obj,format:2,app:app.name,origin:location.origin,device:device()};
 const contentSha=await payloadSha(obj);
 if(app.id==='pictbland')return genericUploadPictSnapshot(obj);
 const bytes=enc.encode(JSON.stringify(obj)),count=Math.ceil(bytes.length/CHUNK);
 if(count>MAX_PARTS)throw Error('共有データが約240MBを超えました。データを消さずに中止しました');
 const digest=await sha(bytes);
 const current=await getBackups();
 const existing=current.find(x=>x.device===device()&&x.sha256===digest);
 if(existing){
  await fetchBackup(existing);
  return {item:existing,contentSha};
 }
 const id=crypto.randomUUID();
 for(let i=0;i<count;i++){
  const part=bytes.subarray(i*CHUNK,Math.min(bytes.length,(i+1)*CHUNK));
  stateText(`☁️ 全端末共通データを送信中：${i+1}/${count}`);
  await xhr('POST','/parts',{id,index:i,count,device:device(),origin:location.origin,totalSha:digest,partSha:await sha(part),base64:b64(part)});
 }
 try{await xhr('POST','/commit',{id,count,device:device(),origin:location.origin,totalSha:digest});}
 catch(e){const verify=await getBackups().catch(()=>[]);if(!verify.some(b=>b.id===id))throw e;}
 const listed=await getBackups(),item=listed.find(b=>b.id===id);
 if(!item)throw Error('Workerで共有バックアップの登録を確認できませんでした');
 const downloaded=await fetchBackup(item);
 if(await payloadSha(downloaded)!==contentSha)throw Error('保存済み共有データの再照合に失敗しました');
 return {item,contentSha};
}
async function genericUploadPictSnapshot(obj){
 obj={...obj,format:2,app:app.name,origin:location.origin,device:device()};
 // /v1/backups は NRH 共通ゲートウェイ用で、保存メタデータの origin は
 // NRH が許可している論理originを使う。実際の対象サイトは snapshot.origin に保持する。
 const logicalOrigin='https://www.youtube.com';
 const wrapper={app:'Niji Research Helper',version:'0.2.4',dbVersion:1,exportedAt:new Date().toISOString(),sourceOrigin:logicalOrigin,device:device(),stores:{videos:[],channels:[],wiki:[],pairs:[]},preferences:{nijiCloudSnapshot:obj}};
 const text=JSON.stringify(wrapper),bytes=enc.encode(text),digest=await sha(bytes);
 const res=await genericRequest({method:'POST',url:GATEWAY+'/v1/backups',headers:{authorization:'Bearer '+settings.token,accept:'application/json','content-type':'application/json','x-nrh-device':device(),'x-nrh-origin':logicalOrigin,'x-nrh-sha256':digest,'x-nrh-version':'0.2.4'},data:text,responseType:'text',timeout:60000});
 let body={};try{body=JSON.parse(res.responseText||res.response||'{}');}catch{}
 if(res.status<200||res.status>=300||!body.ok)throw Error(`HTTP ${res.status}: ${String(body.error||'保存失敗')}`);
 const list=await getBackups(),item=(body.backup?.id?list.find(x=>x.id===body.backup.id):null)||list.find(x=>x.sha256===digest&&Number(x.size||0)===bytes.length)||list[0];
 if(!item)throw Error('pCloud保存後の世代確認に失敗しました');
 const verify=await fetchBackup(item);
 return {item,contentSha:await payloadSha(verify)};
}
async function uploadShared(obj){
 return app.id==='pictbland'?genericUploadPictSnapshot(obj):uploadSnapshot(obj);
}
async function migrateStandaloneSavedSearch(deviceName){
 try{
  const listRes=await genericJson('GET','/v1/backups?device='+encodeURIComponent(deviceName));
  const item=(listRes.backups||[]).sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0))[0];
  if(!item)return 0;
  const res=await genericJson('GET','/v1/backups/'+encodeURIComponent(item.id),null,settings.token,'arraybuffer');
  if(res.status!==200)return 0;
  const raw=res.response instanceof ArrayBuffer?new Uint8Array(res.response):new Uint8Array(res.response||[]);
  if(await sha(raw)!==item.sha256)return 0;
  const data=JSON.parse(dec.decode(raw)),rows=data?.preferences?.savedSearchSync?.rows;
  if(!Array.isArray(rows))return 0;
  if(app.id==='pixiv')await restore({format:2,app:app.name,payload:{databases:[],preferences:{},savedSearches:rows}},{mode:'merge'});
  if(app.id==='pictbland')await restore({format:2,app:app.name,payload:{savedSearches:rows}},{mode:'merge'});
  return rows.length;
 }catch(e){console.warn('[NCB] standalone saved-search migration skipped',e);return 0;}
}
async function migrateLegacyBackups(){
 let merged=0;
 if(app.id==='pixiv')merged+=await migrateStandaloneSavedSearch('pixiv_saved_searches_v1');
 if(app.id==='pictbland'){
  merged+=await migrateStandaloneSavedSearch('pictbland_saved_searches_v1');
  return merged;
 }
 const all=await getBackups();
 const latestByDevice=new Map();
 for(const b of all){
  if(!b?.device||b.device===device())continue;
  const prev=latestByDevice.get(b.device);
  if(!prev||Date.parse(b.createdAt||0)>Date.parse(prev.createdAt||0))latestByDevice.set(b.device,b);
 }
 for(const item of [...latestByDevice.values()].slice(0,10)){
  try{await restore(await fetchBackup(item),{mode:'merge'});merged++;}
  catch(e){console.warn('[NCB] legacy backup migration skipped',item?.id,e);}
 }
 return merged;
}
async function syncShared({force=false}={}){
 if(working||!settings.enabled||!settings.token)return;
 if(!force&&Date.now()-Number(settings.lastSyncAt||0)<30000)return;
 working=true;update();
 try{
  stateText('☁️ 全端末共通データを確認中…');
  let local=await snapshot({allowEmpty:true}),localHash=await payloadSha(local);
  const list=(await getBackups()).filter(b=>b.device===device()).sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
  let latest=list[0]||null;

  if(!latest){
   stateText('☁️ 旧バックアップを共通データへ移行中…');
   await migrateLegacyBackups();
   local=await snapshot({allowEmpty:true});localHash=await payloadSha(local);
   if(!hasMeaningfulPayload(local)){
    settings.syncInitialized=true;settings.lastContentSha=localHash;settings.lastRemoteId='';settings.lastSyncAt=Date.now();await saveSettings();
    stateText('☁️ 同期対象データはまだありません');return;
   }
   const saved=await uploadShared(local);
   settings.syncInitialized=true;settings.lastContentSha=saved.contentSha;settings.lastRemoteId=String(saved.item?.id||'');settings.lastSha=saved.item?.sha256||'';settings.lastSavedAt=Date.now();settings.lastSyncAt=Date.now();await saveSettings();
   stateText('✅ 全端末共通データを作成・同期しました');return;
  }

  const remote=await fetchBackup(latest),remoteHash=await payloadSha(remote);
  const initialized=!!settings.syncInitialized;
  const localChanged=initialized?localHash!==String(settings.lastContentSha||''):hasMeaningfulPayload(local);
  const remoteChanged=initialized?String(latest.id)!==String(settings.lastRemoteId||''):true;
  let needUpload=false;

  if(!initialized){
   if(hasMeaningfulPayload(local)&&localHash!==remoteHash){
    await restore(remote,{mode:'merge'});needUpload=true;
   }else{
    await restore(remote,{mode:'replace'});
   }
  }else if(remoteChanged&&!localChanged){
   await restore(remote,{mode:'replace'});
   const after=await snapshot({allowEmpty:true}),afterHash=await payloadSha(after);
   if(afterHash!==remoteHash){local=after;localHash=afterHash;needUpload=true;}
  }else if(localChanged&&!remoteChanged){
   needUpload=true;
  }else if(localChanged&&remoteChanged){
   await restore(remote,{mode:'merge'});needUpload=true;
  }

  if(needUpload){
   const merged=await snapshot({allowEmpty:true});
   const saved=await uploadShared(merged);
   latest=saved.item;
   localHash=saved.contentSha;
  }else{
   const current=await snapshot({allowEmpty:true});
   localHash=await payloadSha(current);
  }

  settings.syncInitialized=true;settings.lastContentSha=localHash;settings.lastRemoteId=String(latest?.id||'');settings.lastSha=latest?.sha256||settings.lastSha;settings.lastSavedAt=Date.now();settings.lastSyncAt=Date.now();await saveSettings();
  stateText(`✅ 全端末共通データ同期済み：${new Date(settings.lastSyncAt).toLocaleString('ja-JP')}`);
 }catch(e){
  stateText('⚠️ Niji Cloud同期失敗：'+String(e?.message||e));console.warn('[NCB sync]',e);
 }finally{working=false;update();}
}
async function performBackup(force=false){return syncShared({force:!!force});}
async function showBackups(){
 if(working||!settings.token)return;
 working=true;update();backupList.replaceChildren();
 try{
  const backups=(await getBackups()).slice().sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
  if(!backups.length)backupList.append(el('p','','まだバックアップはありません。'));
  for(const b of backups){
   const common=b.device===device()?'全端末共通':'旧端末別';
   const line=el('div','entry'),label=el('span','',`${common} ／ ${new Date(b.createdAt).toLocaleString('ja-JP')} ／ ${b.device} ／ ${(Number(b.size||0)/1048576).toFixed(1)}MB`);
   const restoreBtn=el('button','','読み取り検証して統合復元');
   restoreBtn.onclick=async()=>{
    if(working)return;
    if(!confirm(`${app.label}：${b.createdAt}\n${common}バックアップを、現在データを残して統合しますか？`))return;
    working=true;update();
    try{const obj=await fetchBackup(b);const msg=await restore(obj,{mode:'merge'});settings.lastContentSha='';settings.lastSyncAt=0;await saveSettings();stateText('✅ '+msg+' 次回同期で共通データへ反映します。');}
    catch(e){stateText('⚠️ 復元失敗：'+String(e.message||e));console.warn('[NCB restore]',e);}
    finally{working=false;update();}
   };
   line.append(label,restoreBtn);backupList.append(line);
  }
  stateText('バックアップ履歴を取得しました。通常は自動同期だけでOKです。履歴は復旧用です。');
 }catch(e){stateText('⚠️ 一覧取得失敗：'+String(e.message||e));}
 finally{working=false;update();}
}

const host=el('div');host.id='ncb-backup-root';host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important';
(document.body||document.documentElement).append(host);const shadow=host.attachShadow({mode:'open'});
const css=el('style');css.textContent=`:host{all:initial}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}#launch{position:fixed;left:10px;bottom:70px;z-index:3;min-height:45px;padding:10px 13px;border:0;border-radius:24px;color:#fff;background:#156a89;box-shadow:0 4px 14px #0005;pointer-events:auto;font:700 13px system-ui}#panel{position:fixed;inset:0;z-index:4;width:100vw;height:100dvh;overflow:auto;background:#f6f8fc;color:#172337;pointer-events:auto;padding:24px max(14px,calc((100vw - 690px)/2));font:15px/1.5 system-ui}#panel[hidden]{display:none!important}h2{font-size:21px;margin:0 0 12px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}button:not(#launch){padding:10px 12px;min-height:44px;border-radius:9px;border:1px solid #95a7bf;background:white;color:#14304c;font-weight:600}button:disabled{opacity:.5}input{width:100%;min-height:42px;padding:8px;border:1px solid #9eb0c5;border-radius:8px}.status{border:1px solid #ced9e7;border-radius:9px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:white;margin:13px 0}.entry{padding:12px;border-bottom:1px solid #ccd6e2;display:flex;gap:9px;align-items:center;justify-content:space-between;flex-wrap:wrap}.note{font-size:12px;color:#526178;margin:10px 0}label{display:block;font-weight:600;margin:12px 0 6px}@media(max-width:600px){#panel{padding:15px 13px 70px}h2{font-size:18px}}`;
shadow.append(css);const launch=el('button','',`☁️ ${app.label}`);launch.id='launch';launch.style.setProperty('display','none','important');const panel=el('section');panel.id='panel';panel.hidden=true;shadow.append(launch,panel);if(app.id==='x')launch.style.setProperty('display','none','important');
const header=el('h2','',`☁️ ${app.label}：Niji Cloud同期`);
const note=el('p','note','このデータはPC・iPhone・iPadで共通です。ページを開いた時・復帰時・定期的にクラウドと双方向同期します。世代履歴は復旧用に残します。Xの一時的ないいね順一覧は共有しません。');
const tokenLabel=el('label','','NIJI CLIENT TOKEN');const tokenInput=el('input');tokenInput.type='password';tokenInput.placeholder='Cloudflareに設定した専用トークン（チャットには送らない）';tokenInput.autocomplete='off';
const actions=el('div','actions'),connect=el('button','','接続・初回同期'),backup=el('button','','今すぐ同期・検証'),listButton=el('button','','履歴・復元'),disconnect=el('button','','この端末の同期を停止'),close=el('button','','閉じる');
actions.append(connect,backup,listButton,disconnect,close);const info=el('div','status');const backupList=el('div');panel.append(header,note,tokenLabel,tokenInput,actions,info,backupList);
function stateText(s){notice=s;info.textContent=s;}
function update(){connect.disabled=working;backup.disabled=working||!settings.enabled;listButton.disabled=working||!settings.token;disconnect.disabled=working||!settings.enabled;}
launch.onclick=()=>{panel.hidden=!panel.hidden;update();};close.onclick=()=>{panel.hidden=true;};
connect.onclick=async()=>{
 const token=tokenInput.value.trim();if(token.length<24){stateText('24文字以上のNIJI CLIENT TOKENを入力してください');return;}
 if(working)return;working=true;update();
 try{
  stateText('Niji Cloud接続を確認中…');
  let status;
  if(app.id==='pictbland')status=await genericJson('GET','/v1/status',null,token);
  else status=await xhr('GET','/status',null,token);
  if(!status.connected||!status.remoteOk)throw Error('pCloudが接続されていません');
  settings.token=token;settings.enabled=true;settings.syncInitialized=false;settings.lastContentSha='';settings.lastRemoteId='';settings.lastSyncAt=0;
  await GM.setValue(GLOBAL_TOKEN_KEY,token);
  await saveSettings();tokenInput.value='';
  stateText('接続OK。全端末共通データを初回同期します。');
 }catch(e){stateText('⚠️ 接続できません：'+String(e.message||e));}
 finally{working=false;update();}
 if(settings.enabled)void syncShared({force:true});
};
backup.onclick=()=>void syncShared({force:true});
listButton.onclick=()=>void showBackups();
disconnect.onclick=async()=>{
 if(!confirm('この端末のNiji Cloud同期を停止しますか？ クラウドとローカルのデータは削除しません。'))return;
 settings.enabled=false;settings.token='';settings.lastSha='';await saveSettings();stateText('この端末の自動同期を停止しました。クラウド上の共通データは残っています。');update();
};
if(settings.enabled&&settings.token)void saveSettings().catch(()=>{});
stateText(settings.enabled?`☁️ 全端末共通同期ON。最終同期：${settings.lastSyncAt?new Date(settings.lastSyncAt).toLocaleString('ja-JP'):'これから同期'}`:'未接続：NIJI CLIENT TOKENを入力してください');update();
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
   // Pixivは「♥全体ブックマーク」の中ではなく、統合Pixivツール上部の
   // 保存検索 / 全体ブックマーク / 小説TXT と同列にNiji Cloudを出す。
   const bar=document.getElementById('pixiv-tools-unified-bar');
   if(bar){
    nativeReady=true;
    slot=bar;

    let button=bar.querySelector('[data-ncb-native-backup="pixiv"]');
    if(!button){
      button=document.createElement('button');
      button.type='button';
      button.dataset.ncbNativeBackup='pixiv';
      button.dataset.toolTab='niji-cloud';
      button.textContent='☁️ Niji Cloud';
      button.addEventListener('click',()=>{
        // Pixiv側の他画面を閉じるため、既存タブのactiveだけ外してCloudを選択状態にする。
        for(const b of bar.querySelectorAll('[data-tool-tab]'))b.classList.toggle('active',b===button);
        try{window.__pixivSavedSearchesUi?.close?.();}catch{}
        try{
          const root=document.getElementById('pixiv-bookmark-sort-cross-page-v05')?.shadowRoot;
          root?.querySelector('.pbs-new-overlay')?.classList.remove('pbs-open');
          root?.querySelector('.veil')?.classList.remove('open');
        }catch{}
        document.getElementById('pnte-root')?.classList.remove('pnte-open');
        document.getElementById('pixiv-tools-unified-placeholder')?.classList.remove('open');
        panel.hidden=false;
        panel.style.setProperty('top','78px','important');
        panel.style.setProperty('height','calc(100dvh - 78px)','important');
        update();
      });

      const close=bar.querySelector('.pt-close');
      if(close)bar.insertBefore(button,close);
      else bar.append(button);

      // 他のPixivツールタブへ移ったらCloud画面を閉じる。
      for(const b of bar.querySelectorAll('[data-tool-tab]:not([data-ncb-native-backup="pixiv"])')){
        b.addEventListener('click',()=>{
          panel.hidden=true;
          panel.style.removeProperty('top');
          panel.style.removeProperty('height');
        });
      }
      close?.addEventListener('click',()=>{
        panel.hidden=true;
        panel.style.removeProperty('top');
        panel.style.removeProperty('height');
      });
    }
   }
  } else if(app.id==='pictbland') {
   const bar=document.getElementById('pictbland-tools-unified-bar');
   slot=bar?.querySelector('[data-ncb-slot="pictbland"]');
   nativeReady=!!slot;
  }

  if(app.id!=='pixiv' && slot && !slot.querySelector('[data-ncb-native-backup="'+app.id+'"]')) {
   const button=document.createElement('button');
   button.type='button';
   button.dataset.ncbNativeBackup=app.id;
   button.textContent='☁️ Niji Cloud';
   if(app.id==='or')button.className='nor-button';
   if(app.id==='x') {
    button.style.cssText='min-height:43px!important;padding:8px 10px!important;border-radius:9px!important;border:1px solid #9baeca!important;background:#e9f5fc!important;color:#173b54!important;font:700 12px system-ui!important;cursor:pointer!important';
   } else if(app.id==='pictbland') {
    button.style.cssText='min-height:34px!important;padding:8px 7px!important;border-radius:9px!important;border:1px solid #cec7dc!important;background:#fff!important;color:#33294a!important;font:700 11px system-ui!important;cursor:pointer!important';
   }
   button.addEventListener('click',()=>{panel.hidden=false;update();});
   slot.append(button);
  }

  if(app.id==='x'||app.id==='pictbland'||nativeReady) launch.style.setProperty('display','none','important');
  else launch.style.removeProperty('display');
 } catch(e) { console.warn('[NCB] native menu attachment failed',e); }
}
integrateNativeBackup();
setInterval(integrateNativeBackup,1200);
// 全端末共通データ：起動時・復帰時・定期的に双方向同期。
setTimeout(()=>{if(settings.enabled&&!working)void syncShared({force:true});},500);
setInterval(()=>{
 if(!settings.enabled||working||document.hidden||Date.now()<nextScan)return;
 nextScan=Date.now()+60000;
 void syncShared({force:false});
},30000);
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden&&settings.enabled&&!working){nextScan=Date.now()+30000;void syncShared({force:true});}
});
})();
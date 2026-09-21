from pathlib import Path
cloud=Path('Niji_Cloud_Backup.user.js')
orfile=Path('Niji_OR_Results_Merger.user.js')
s=cloud.read_text(encoding='utf-8')
assert '// @version      0.1.0' in s and 'function requestOr(action,payload){' in s
s=s.replace('// @version      0.1.0','// @version      0.1.1',1)
s=s.replace('// @match        https://comment2434.com/*\n// @match        https://www.comment2434.com/*\n','',1)
start=s.index('function requestOr(action,payload){')
end=s.index('async function existingDb(',start)
new=r'''// @required inside OR's isolated userscript context; never use page-visible events.
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
'''
s=s[:start]+new+s[end:]
assert 'ncb-or-request-v1' not in s
cloud.write_text(s,encoding='utf-8')
s=orfile.read_text(encoding='utf-8')
assert '// @version      0.4.9' in s
start=s.index('  // Cross-script bridge for the separately installed Niji Cloud Backup userscript.')
end=s.index('  const el = (tag, attrs = {}, ...children) => {',start)
s=s[:start]+s[end:]
s=s.replace('// @version      0.4.9','// @version      0.4.10',1)
s=s.replace("const VERSION = '0.4.9';","const VERSION = '0.4.10';",1)
s=s.replace("boot.textContent='🔀 OR起動中 0.4.9';","boot.textContent='🔀 OR起動中 0.4.10';",1)
s=s.replace("console.info('[Niji OR Merger] v0.4.9 injected'","console.info('[Niji OR Merger] v0.4.10 injected'",1)
anchor='// @grant        GM_xmlhttpRequest\n'
assert s.count(anchor)==1
s=s.replace(anchor,anchor+'// @grant        GM.getValue\n// @grant        GM.setValue\n// @grant        GM.xmlHttpRequest\n// @grant        GM.xmlhttpRequest\n// @connect      niji-research-backup.dearlylovedxxx.workers.dev\n// @require      https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Cloud_Backup.user.js\n',1)
assert 'ncb-or-request-v1' not in s and '@require      https://raw.githubusercontent.com' in s
orfile.write_text(s,encoding='utf-8')
print('Cloud companion now runs inside OR script namespace; no DOM bridge remains')
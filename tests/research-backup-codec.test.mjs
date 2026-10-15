import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');
const begin='// BEGIN NRH CLOUD V2 CODEC';
const end='// END NRH CLOUD V2 CODEC';
const start=script.indexOf(begin),stop=script.indexOf(end,start);
assert.ok(start>=0&&stop>start,'test must execute the actual embedded codec');
const code=script.slice(start+begin.length,stop);
const makeCodec=new Function('NRH_DB_VERSION','CLOUD_STORES','VERSION','RESEARCH_CLOUD_DEVICE',
 code+'\nreturn {researchCloudEncode,researchCloudDecode,researchCloudSha,researchCloudCanUseMergedGlobal};');
const {researchCloudEncode:encode,researchCloudDecode:decode,researchCloudSha:sha,researchCloudCanUseMergedGlobal:fastMerge}
 =makeCodec(1,['videos','channels','wiki','pairs'],'1.0.110','nrh-research-global');
const payload=({count=2,large=false}={})=>({
 app:'Niji Research Helper',version:'1.0.110',dbVersion:1,
 exportedAt:'2026-10-15T12:00:00.000Z',
 sourceOrigin:'https://www.youtube.com',device:'nrh-research-global',
 stores:{
  videos:Array.from({length:count},(_,i)=>({
   id:'example-'+i,
   description:large?'cached research and wiki evidence '.repeat(8000):'confirmed Wiki evidence',
   meta:{id:'example-'+i,channel:{name:'不破湊'},updatedAt:1000},
   wikiInfo:{status:'confirmed',cohosts:['小柳ロウ','叶']}
  })),
  channels:[{id:'ch1',name:'不破湊'}],
  wiki:[{key:'2024',text:'出演情報'}],
  pairs:[{key:'a|b',status:'confirmed'}]
 },
 preferences:{
  favorites:[{id:'ch1',name:'不破湊'}],
  syncPoints:{fuwa:2026},
  settings:{hideUnconfirmed:true}
 }
});
test('legacy small JSON research backups stay byte-compatible',async()=>{
 const original=payload(),packed=await encode(original);
 assert.equal(packed.compressed,false);
 assert.equal(JSON.parse(packed.text).dbVersion,1);
 assert.deepEqual(await decode(JSON.parse(packed.text)),original);
});
test('large raw research DB compresses below 20MiB without losing any local records',async()=>{
 const original=payload({count:95,large:true});
 const packed=await encode(original);
 assert.equal(packed.compressed,true);
 assert.ok(JSON.stringify(original).length>20*1024*1024,'reproduce the reported warning');
 assert.ok(packed.bytes.length<20*1024*1024);
 const wrapper=JSON.parse(packed.text);
 assert.equal(wrapper.dbVersion,1001,'legacy clients reject the compressed wrapper');
 assert.deepEqual(wrapper.stores,{videos:[],channels:[],wiki:[],pairs:[]});
 assert.deepEqual(await decode(wrapper),original);
 assert.ok(wrapper.compressedResearch.originalSha256);
});
test('rejects corrupt compressed payload and does not accept empty compatibility stores',async()=>{
 const packed=await encode(payload({count:95,large:true})),wrapper=JSON.parse(packed.text);
 const corrupted={...wrapper,compressedResearch:{...wrapper.compressedResearch,originalSha256:'0'.repeat(64)}};
 await assert.rejects(decode(corrupted),/検証に失敗/);
 const missing={...wrapper,compressedResearch:{...wrapper.compressedResearch,payload:''}};
 await assert.rejects(decode(missing),/データ形式/);
 const empty={...wrapper,compressedResearch:null};
 await assert.rejects(decode(empty),/形式が不正/);
 assert.notEqual(wrapper.dbVersion,1);
});
test('conflicting origin and malformed legacy data cannot overwrite valid DB',async()=>{
 const packed=await encode(payload({count:95,large:true})),wrapper=JSON.parse(packed.text);
 await assert.rejects(decode({...wrapper,sourceOrigin:'https://attacker.example'}),/出所が一致/);
 await assert.rejects(decode({app:'Niji Research Helper',dbVersion:1,stores:{videos:[]}}),/復元データが不正/);
});
test('all research read, restore and verification paths share the validated decoder',()=>{
 assert.match(script,/const data=await researchCloudDecode\(envelope\)/);
 assert.match(script,/const data=await cloudFetchResearchSnapshot\(backup\)/);
 assert.match(script,/const data=await cloudFetchResearchSnapshot\(item,token\)/);
 assert.match(script,/const encoded=await researchCloudEncode\(payload\)/);
 assert.ok(!script.includes('バックアップが20MBを超えました。ローカルJSONを先に退避してください'));
 assert.match(script,/cloud\.status='☁️ 圧縮バックアップを読み戻して検証中/);
 assert.match(script,/const RESEARCH_CLOUD_COMPRESSED_VERSION = NRH_DB_VERSION \+ 1000/);
 assert.match(script,/\/v1\/backups/);
 assert.match(script,/\/\/ @version\s+1\.0\.109/);
 assert.match(meta,/\/\/ @version\s+1\.0\.109/);
});

test('safe complete-merged global backup subsumes only older device backups',()=>{
 const global={id:'global-1',device:'nrh-research-global',createdAt:'2026-10-15T09:00:00Z'};
 const pc={id:'pc',device:'desktop-old',createdAt:'2026-10-14T09:00:00Z'};
 const mobile={id:'mobile',device:'iphone-old',createdAt:'2026-10-15T08:00:00Z'};
 const entries=new Map([global,pc,mobile].map(x=>[x.device,x]));
 const complete={preferences:{backupMode:'complete-merged-v1'}};
 assert.equal(fastMerge(entries,complete),true);
 assert.equal(fastMerge(entries,{preferences:{}}),false,'non-merged global is not authoritative');
 const newer=new Map([...entries,['ipad-new',{id:'ipad',device:'ipad-new',createdAt:'2026-10-15T12:00:00Z'}]]);
 assert.equal(fastMerge(newer,complete),false,'newer legacy device must be merged as well');
 assert.equal(fastMerge(new Map([['desktop-old',pc]]),complete),false,'without global there is no shortcut');
 assert.equal(fastMerge(new Map([...entries,['invalid',{id:'x',device:'invalid',createdAt:''}]]),complete),false);
});
test('the previously silent merge now reports steps and never drops newer device states',()=>{
 assert.match(script,/端末内の研究DBを読み込み中/);
 assert.match(script,/クラウド研究DBを統合中…/);
 assert.match(script,/統合完了。バックアップを圧縮・検証中/);
 assert.match(script,/圧縮バックアップをクラウドへ保存中/);
 assert.match(script,/researchCloudCanUseMergedGlobal\(latestByDevice,cachedGlobal\)/);
 assert.match(script,/const required=useGlobalOnly\?\[globalItem\]:candidates/);
 assert.match(script,/await new Promise\(resolve=>setTimeout\(resolve,0\)\)/);
 assert.match(script,/\/\/ @version\s+1\.0\.110/);
 assert.match(meta,/\/\/ @version\s+1\.0\.110/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Cloud_Backup.user.js',import.meta.url),'utf8');
const start=script.indexOf('async function syncShared({force=false,confirmRecovery=false}={}){');
const end=script.indexOf('async function performBackup(',start);
assert.ok(start>0 && end>start);
const syncSource=script.slice(start,end);

function scenario({localNames=[],remoteNames=[],initialized=true,remoteChanged=false,hold=false,localChanged=true}={}){
  const make=names=>({format:2,payload:{
    savedSearches:names.map(name=>({name,href:'/tags/'+name})),databases:[],preferences:{minimum:'0'}
  }});
  let local=make(localNames);
  const remote=make(remoteNames);
  const hash=value=>JSON.stringify(value.payload);
  const previous=[{device:'shared-pixiv',id:remoteChanged?'remote-new':'remote-old',
    sha256:'test-hash',createdAt:'2026-11-01T00:00:00Z'}];
  const calls={reads:0,restores:[],uploads:[],messages:[]};
  const settings={
    enabled:true,token:'test-only',recoveryHold:hold,syncInitialized:initialized,
    lastContentSha:localChanged?'old-hash':hash(local),
    lastRemoteId:'remote-old',lastSyncAt:0
  };
  const dependencies={
    app:{id:'pixiv'},settings,
    stateText:text=>calls.messages.push(text),
    update:()=>{},
    snapshot:async()=>JSON.parse(JSON.stringify(local)),
    payloadSha:async value=>hash(value),
    getBackups:async()=>{calls.reads++;return previous;},
    fetchBackup:async()=>JSON.parse(JSON.stringify(remote)),
    restore:async(incoming,{mode})=>{
      calls.restores.push(mode);
      if(mode==='replace')local=incoming;
      else{
        const byHref=new Map([...local.payload.savedSearches,
          ...incoming.payload.savedSearches].map(row=>[row.href,row]));
        local.payload.savedSearches=[...byHref.values()];
      }
    },
    uploadShared:async value=>{
      calls.uploads.push(JSON.parse(JSON.stringify(value)));
      return {item:{id:'uploaded',sha256:'test-hash'},contentSha:hash(value)};
    },
    hasMeaningfulPayload:value=>value.payload.savedSearches.length>0,
    saveSettings:async()=>{},
    device:()=> 'shared-pixiv',
    console:{warn:()=>{}}
  };
  const sync=new Function(...Object.keys(dependencies),
    'let working=false;\n'+syncSource+'\nreturn syncShared;'
  )(...Object.values(dependencies));
  return {sync,settings,calls,getLocal:()=>local};
}

test('v0.2.7 parses and recovery hold is stored in the private GM config',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/@version\s+0\.2\.7/);
  assert.match(script,/recoveryHold:!!settings\.recoveryHold/);
  assert.match(script,/if\(app\.id==='pixiv'\)settings\.recoveryHold=true/);
});
test('auto sync cannot overwrite a just-restored local history',async()=>{
  const state=scenario({localNames:['saved'],hold:true});
  await state.sync({force:true});
  assert.equal(state.calls.reads,0);
  assert.equal(state.calls.uploads.length,0);
  assert.deepEqual(state.getLocal().payload.savedSearches.map(x=>x.name),['saved']);
});
test('explicitly confirmed recovery resumes sync after checking searches',async()=>{
  const state=scenario({localNames:['saved'],hold:true});
  await state.sync({force:true,confirmRecovery:true});
  assert.equal(state.calls.uploads.length,1);
  assert.equal(state.settings.recoveryHold,false);
});
test('reconnecting a cleared Safari device never replaces its locally restored searches',async()=>{
  const state=scenario({localNames:['saved'],remoteNames:[],initialized:false});
  await state.sync({force:true});
  assert.deepEqual(state.calls.restores,['merge']);
  assert.equal(state.getLocal().payload.savedSearches.length,1);
  assert.equal(state.calls.uploads.length,1);
});
test('remote change never erases local saved searches on Pixiv',async()=>{
  const state=scenario({localNames:['saved'],remoteNames:[],remoteChanged:true,localChanged:false});
  await state.sync({force:true});
  assert.deepEqual(state.calls.restores,['merge']);
  assert.equal(state.getLocal().payload.savedSearches.length,1);
});
test('empty local lists cannot create new generations and prune old backups',async()=>{
  for(const remoteNames of [[],['saved']]){
    const state=scenario({localNames:[],remoteNames});
    await state.sync({force:true});
    assert.equal(state.calls.uploads.length,0);
    assert.match(state.calls.messages.at(-1),/保留/);
  }
});
test('backup inspection is read-only and separate from restore',()=>{
  const from=script.indexOf("const inspectBtn=el('button','','内容確認のみ')");
  const to=script.indexOf("const restoreBtn=el('button','','読み取り検証して統合復元')",from);
  assert.ok(from>0&&to>from);
  const preview=script.slice(from,to);
  assert.match(preview,/await fetchBackup\(b\)/);
  assert.match(preview,/savedSearches\.length/);
  assert.doesNotMatch(preview,/restore\(|uploadShared\(|syncShared\(|localStorage\.setItem|saveSettings\(/);
});
test('Pixiv manual recovery pauses auto sync until user confirms',()=>{
  assert.match(script,/settings\.recoveryHold=true/);
  assert.match(script,/settings\.recoveryHold&&!confirmRecovery\)return/);
  assert.match(script,/backup\.onclick=\(\)=>\{/);
  assert.match(script,/syncShared\(\{force:true,confirmRecovery:true\}\)/);
});

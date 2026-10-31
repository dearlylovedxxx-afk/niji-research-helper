import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../Niji_Cloud_Backup.user.js',import.meta.url),'utf8');
const from=source.indexOf('backup.onclick=async()=>{');
const to=source.indexOf('listButton.onclick=',from);
assert.ok(from>0&&to>from);
const handlerSource=source.slice(from,to);

function scenario({count=3,hold=true,approved=true,token='secret-for-test',copyAvailable=true,appId='pixiv'}={}){
  const requests=[],messages=[],copied=[];
  const backup={},tokenCopy={};
  const settings={enabled:true,recoveryHold:hold,token};
  const app={id:appId};
  let confirmCount=0;
  const create=new Function('backup','tokenCopy','working','app','settings','snapshot',
    'stateText','confirm','syncShared','navigator',handlerSource);
  create(backup,tokenCopy,false,app,settings,
    async()=>({payload:{savedSearches:Array.from({length:count},(_,id)=>({name:'tag'+id}))}}),
    m=>messages.push(m),
    text=>{confirmCount++;return approved;},
    request=>requests.push(request),
    {clipboard:copyAvailable?{writeText:async value=>copied.push(value)}:undefined}
  );
  return {backup,tokenCopy,requests,messages,copied,settings,getConfirmCount:()=>confirmCount};
}
test('v0.2.8 source parses and keeps credentials in GM settings, not localStorage',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+0\.2\.8/);
  assert.match(source,/const savedConfig=await GM\.getValue\(CONFIG,null\)/);
  assert.match(source,/await GM\.setValue\(CONFIG,\{enabled:settings\.enabled,token:settings\.token/);
});
test('confirmed recovery resumes regular automatic backup with preserved searches',async()=>{
  const h=scenario({count:12,hold:true});
  await h.backup.onclick();
  assert.deepEqual(h.requests,[{force:true,confirmRecovery:true}]);
  assert.equal(h.getConfirmCount(),1);
});
test('empty restored searches cannot resume backup or generate empty history',async()=>{
  const h=scenario({count:0,hold:true});
  await h.backup.onclick();
  assert.equal(h.requests.length,0);
  assert.equal(h.getConfirmCount(),0);
  assert.match(h.messages.at(-1),/保存検索が0件/);
});
test('denying recovery confirmation leaves hold in place',async()=>{
  const h=scenario({count:3,hold:true,approved:false});
  await h.backup.onclick();
  assert.equal(h.requests.length,0);
});
test('normal backup button still works once hold has cleared',async()=>{
  const h=scenario({count:3,hold:false});
  await h.backup.onclick();
  assert.deepEqual(h.requests,[{force:true,confirmRecovery:true}]);
  assert.equal(h.getConfirmCount(),0);
});
test('token copy requires explicit confirmation and never prints the secret',async()=>{
  const h=scenario();
  await h.tokenCopy.onclick();
  assert.deepEqual(h.copied,['secret-for-test']);
  assert.ok(!h.messages.some(m=>m.includes('secret-for-test')));
  assert.ok(h.messages.some(m=>m.includes('パスワード')));
});
test('token is not copied without user approval',async()=>{
  const h=scenario({approved:false});
  await h.tokenCopy.onclick();
  assert.deepEqual(h.copied,[]);
});
test('clipboard failure does not change credentials',async()=>{
  const h=scenario({copyAvailable:false});
  await h.tokenCopy.onclick();
  assert.deepEqual(h.copied,[]);
  assert.equal(h.settings.token,'secret-for-test');
  assert.match(h.messages.at(-1),/コピーが許可されません/);
});
test('credential backup helper uses app-specific username',async()=>{
  const h=scenario({appId:'or'});
  await h.tokenCopy.onclick();
  assert.match(h.messages.at(-1),/or-niji-cloud/);
  assert.ok(!h.messages.at(-1).includes('pixiv-niji-cloud'));
});
test('manual resume and clipboard button are available without exposing plaintext by default',()=>{
  assert.match(source,/復元確認・自動バックアップ再開/);
  assert.match(source,/tokenCopy=el\('button','','🔐 トークンの控えをコピー'\)/);
  assert.match(source,/tokenInput\.autocomplete='off'/);
  assert.doesNotMatch(source,/tokenInput\.value=settings\.token/);
});

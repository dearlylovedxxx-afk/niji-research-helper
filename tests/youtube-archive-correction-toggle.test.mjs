import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const metadata=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');
const correctionStart=script.indexOf('  const YT_LC_CORRECTIONS_KEY=');
const correctionEnd=script.indexOf('  function youtubeLiveClockEmit(',correctionStart);
const syncStart=script.indexOf('  function youtubeLiveClockSyncFromThisTab(',correctionEnd);
const syncEnd=script.indexOf('  function youtubeLiveClockInitialize()',syncStart);
assert.ok(correctionStart>=0&&correctionEnd>correctionStart&&syncStart>0&&syncEnd>syncStart);
const correctionCode=script.slice(correctionStart,correctionEnd);
const syncCode=script.slice(syncStart,syncEnd);
const START=Date.UTC(2026,10,5,0,0,0);
const firstId='ABCDEFGHIJK',secondId='LMNOPQRSTUV';

function harness({id=firstId,position=600,storage=new Map(),enabledSync=true}={}) {
  const sent=[],statuses=[],pending=new Map();
  let timer=0,videoId=id,receiver=()=>{},refreshes=0,handOff=0;
  const document={hidden:false,dispatchEvent(){}};
  const localStorage={
    getItem:key=>storage.get(key)||null,
    setItem:(key,value)=>storage.set(key,value)
  };
  const state={tabId:id,channel:null,peers:new Map(),markedVideoId:enabledSync?id:'',
    autoSeekTimer:0,suppressedSeek:null,lastSyncToken:''};
  const clock={videoId:id,startMs:START};
  const video={
    duration:3600,paused:true,playbackRate:1,time:position,
    get currentTime(){return this.time},
    set currentTime(value){this.time=value;receiver({currentTarget:this});}
  };
  state.channel={postMessage:message=>sent.push(message)};
  const factory=new Function(
    'localStorage','document','CustomEvent','currentYoutubeVideoId','youtubeVideoElement',
    'youtubeLiveClockTabs','youtubeBroadcastClock','youtubeLiveClockSuppressSeek',
    'syncYoutubeBroadcastClockFeature','youtubeLiveClockStatus',
    'youtubeLiveClockMiniRefresh','youtubeLiveClockRefresh',
    'youtubeLiveClockEmit','youtubeLiveClockIsMarked',
    'clearTimeout','setTimeout','toast','formatClock','console',
    'let youtubeSeekHandoffRun=0;\n'+correctionCode+'\n'+syncCode+
    '\nreturn {read:youtubeLiveClockCorrection,effective:youtubeLiveClockEffectiveCorrection,'+
    'save:youtubeLiveClockSaveCorrection,adjust:youtubeLiveClockAdjustCorrection,'+
    'sync:youtubeLiveClockSyncFromThisTab,receive:youtubeLiveClockReceiveSync,'+
    'seeked:youtubeLiveClockOnSeeked,isSuppressed:youtubeLiveClockIsSuppressedSeek,'+
    'suppress:youtubeLiveClockSuppressSeek};'
  );
  const result=factory(
    localStorage,document,class CustomEvent {constructor(){}},
    ()=>videoId,()=>video,state,clock,
    (video,target)=>{state.suppressedSeek={video,target,until:Date.now()+2400};},
    ()=>{},status=>statuses.push(status),
    ()=>{refreshes++},()=>{refreshes++},
    (kind,fields)=>sent.push({kind,at:Date.now(),sender:id,app:'nrh-liveclock-v1',...fields}),
    ()=>state.markedVideoId===videoId,
    key=>pending.delete(key),fn=>{const key=++timer;pending.set(key,fn);return key},
    ()=>{},x=>String(x),{debug(){}}
  );
  receiver=result.seeked;
  return {
    ...result,id,video,clock,storage,sent,state,statuses,document,
    setId:x=>{videoId=x},
    flush:()=>{const jobs=[...pending.values()];pending.clear();jobs.forEach(fn=>fn())},
    get refreshes(){return refreshes}
  };
}
test('v1.0.128 parses, metadata matches, and UI exposes toggle plus reset',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/@version\s+1\.0\.128/);
  assert.match(metadata,/@version\s+1\.0\.128/);
  for(const label of ['npf-liveclock-mini-correction','npf-liveclock-mini-offset','npf-liveclock-mini-reset'])
    assert.ok(script.includes(label));
});
test('per-video correction survives an independent reload and defaults enabled',()=>{
  const storage=new Map();
  const a=harness({storage});
  assert.deepEqual(a.read(),{offset:0,enabled:true});
  assert.equal(a.save(firstId,{offset:5,enabled:true}),true);
  const b=harness({storage});
  assert.deepEqual(b.read(),{offset:5,enabled:true});
  const c=harness({id:secondId,storage});
  assert.deepEqual(c.read(),{offset:0,enabled:true});
});
test('offset ON persists across timestamp seeks and applies to receiver',()=>{
  const a=harness({position:605}),b=harness({id:secondId,position:0});
  a.save(firstId,{offset:5,enabled:true});
  b.save(secondId,{offset:-3,enabled:true});
  a.sync();
  b.receive(a.sent[0]);
  b.flush();
  assert.equal(a.sent[0].wallMs,START+600000);
  assert.equal(b.video.currentTime,597);
  assert.equal(b.sent.length,0);
});
test('corrected receiver as sender subtracts its own bias',()=>{
  const a=harness({position:105}),b=harness({id:secondId,position:500});
  a.save(firstId,{offset:5,enabled:true});
  b.save(secondId,{offset:-3,enabled:true});
  b.sync();
  a.receive(b.sent[0]);
  assert.equal(b.sent[0].wallMs,START+503000);
  assert.equal(a.video.currentTime,508);
});
test('turn OFF preserves saved correction and shifts only this video back',()=>{
  const a=harness({position:605});
  a.save(firstId,{offset:5,enabled:true});
  a.adjust({enable:false});
  assert.deepEqual(a.read(),{offset:5,enabled:false});
  assert.equal(a.video.currentTime,600);
  a.flush();
  assert.equal(a.sent.length,0);
  a.sync();
  assert.equal(a.sent[0].wallMs,START+600000);
  a.adjust({enable:true});
  assert.equal(a.video.currentTime,605);
  assert.deepEqual(a.read(),{offset:5,enabled:true});
  a.flush();
  assert.equal(a.sent.length,1);
});
test('disabled bias is retained, adjusted while OFF, then restored without resending',()=>{
  const a=harness({position:200});
  a.adjust({enable:false});
  a.adjust({delta:7});
  assert.deepEqual(a.read(),{offset:7,enabled:false});
  assert.equal(a.video.currentTime,200);
  a.adjust({enable:true});
  assert.equal(a.video.currentTime,207);
  a.flush();
  assert.equal(a.sent.length,0);
});
test('reset zero moves only local tab and persists zero bias',()=>{
  const a=harness({position:105});
  a.save(firstId,{offset:5,enabled:true});
  a.adjust({reset:true});
  assert.equal(a.video.currentTime,100);
  assert.deepEqual(a.read(),{offset:0,enabled:true});
  a.flush();
  assert.equal(a.sent.length,0);
});
test('OFF ignores offset for both sender and receiver',()=>{
  const a=harness({position:500}),b=harness({id:secondId,position:50});
  a.save(firstId,{offset:10,enabled:false});
  b.save(secondId,{offset:20,enabled:false});
  a.sync();
  b.receive(a.sent[0]);
  assert.equal(a.sent[0].wallMs,START+500000);
  assert.equal(b.video.currentTime,500);
});
test('only selected tabs are synced and storage is bounded per valid video ID',()=>{
  const storage=new Map(),a=harness({storage,enabledSync:false});
  a.save(firstId,{offset:5,enabled:true});
  a.sync({automatic:true});
  assert.equal(a.sent.length,0);
  assert.equal(a.save('invalid',{offset:9999,enabled:true}),false);
  for(let i=0;i<130;i++){
    const vid=('ID'+String(i).padStart(9,'0')).slice(0,11);
    a.save(vid,{offset:4000,enabled:true});
  }
  assert.ok(Object.keys(JSON.parse(storage.get('nrh-liveclock-video-corrections-v1'))).length<=120);
  assert.equal(a.read(firstId).offset,5);
});
test('correction is local-only; usual timeupdate and duration are unaffected',()=>{
  const a=harness({position:600});
  a.save(firstId,{offset:-2,enabled:true});
  a.video.time+=30;
  a.flush();
  assert.equal(a.sent.length,0);
  assert.equal(a.video.duration,3600);
});

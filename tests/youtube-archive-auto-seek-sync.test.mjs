import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const metadata=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');
function section(first,last){
  const start=script.indexOf(first),end=script.indexOf(last,start);
  assert.ok(start>=0&&end>start,first+' missing');
  return script.slice(start,end);
}
const engine=section('  const youtubeLiveClockTabs = {','  function youtubeLiveClockAnnounce() {')+
  section('  function youtubeLiveClockSyncFromThisTab(','  function youtubeLiveClockInitialize() {');
const startMs=Date.UTC(2026,9,31,0,0,0);

function instance({videoId='ABCabc12345',marked=true,ready=true,seconds=100,hidden=false}={}){
  let id=videoId,video;
  const scheduled=new Map(),sent=[],statuses=[];
  let timerId=0;
  const document={hidden,dispatchEvent(){}};
  const clock={videoId,startMs:ready?startMs:null};
  class Video {
    constructor(){this.time=seconds;this.duration=7200;this.paused=true;this.playbackRate=1;}
    get currentTime(){return this.time;}
    set currentTime(value){this.time=value;onSeeked({currentTarget:this});}
  }
  video=new Video();
  const create=new Function(
    'document','currentYoutubeVideoId','youtubeVideoElement','youtubeBroadcastClock',
    'syncYoutubeBroadcastClockFeature','youtubeLiveClockStatus','toast','formatClock',
    'setTimeout','clearTimeout','CustomEvent', 
    'let youtubeSeekHandoffRun=0;\n'+engine+
    '\nreturn {state:youtubeLiveClockTabs,isMarked:youtubeLiveClockIsMarked,'+
    'auto:youtubeLiveClockOnSeeked,receive:youtubeLiveClockReceiveSync,'+
    'sync:youtubeLiveClockSyncFromThisTab,suppress:youtubeLiveClockSuppressSeek,'+
    'isSuppressed:youtubeLiveClockIsSuppressedSeek};'
  );
  let onSeeked=()=>{};
  const out=create(document,()=>id,()=>video,clock,()=>{},
    value=>statuses.push(value),()=>{},v=>String(Math.round(v)),
    fn=>{const k=++timerId;scheduled.set(k,fn);return k;},
    key=>scheduled.delete(key),class CustomEvent{constructor(){}});
  onSeeked=out.auto;
  out.state.markedVideoId=marked?id:'';
  out.state.channel={postMessage(message){sent.push(message);}};
  return {...out,video,clock,document,sent,statuses,
    changeVideo(next){id=next;},
    flush(){const batch=[...scheduled.values()];scheduled.clear();batch.forEach(fn=>fn());},
    remaining(){return scheduled.size}
  };
}

test('v1.0.127 parses and attaches seek listener on each current video',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/@version\s+1\.0\.127/);
  assert.match(metadata,/@version\s+1\.0\.127/);
  assert.match(script,/video\?\.addEventListener\('seeked',youtubeLiveClockOnSeeked/);
  assert.match(script,/removeEventListener\('seeked',youtubeLiveClockOnSeeked\)/);
});
test('clicking a timestamp on a selected tab automatically sends its new timestamp',()=>{
  const a=instance({seconds:100});
  a.video.currentTime=720;
  assert.equal(a.sent.length,0);
  a.flush();
  assert.equal(a.sent.length,1);
  assert.equal(a.sent[0].kind,'sync');
  assert.equal(a.sent[0].wallMs,startMs+720000);
  assert.equal(a.sent[0].sourcePlaying,false);
});
test('cross-tab sync uses each archive actual start time and does not echo',()=>{
  const a=instance({seconds:10}),b=instance({seconds:0});
  b.clock.startMs=startMs+120000;
  a.video.currentTime=900;
  a.flush();
  const message=a.sent[0];
  b.receive(message);
  b.flush();
  assert.equal(Math.round(b.video.currentTime),780);
  assert.equal(b.sent.length,0,'programmatic seek must not return sync');
});
test('only explicitly marked archives send or receive',()=>{
  const a=instance({marked:false}),b=instance({marked:false});
  a.video.currentTime=500;a.flush();
  assert.equal(a.sent.length,0);
  b.receive({kind:'sync',token:'known',wallMs:startMs+600000,
    at:Date.now(),sourcePlaying:false,sourceRate:1});
  b.flush();
  assert.equal(b.video.currentTime,100);
  assert.equal(b.sent.length,0);
});
test('ordinary playback time updates do not transmit a sync',()=>{
  const a=instance();
  a.video.time=150;
  a.flush();
  assert.equal(a.sent.length,0);
});
test('multiple rapid timestamp seeks are coalesced to the final time',()=>{
  const a=instance();
  a.video.currentTime=300;
  a.video.currentTime=480;
  a.video.currentTime=720;
  a.flush();
  assert.equal(a.sent.length,1);
  assert.equal(a.sent[0].wallMs,startMs+720000);
});
test('late start metadata retries briefly without spamming other tabs',()=>{
  const a=instance({ready:false});
  a.video.currentTime=240;
  a.flush();
  assert.equal(a.sent.length,0);
  assert.ok(a.remaining()>0);
  a.clock.startMs=startMs;
  a.flush();
  assert.equal(a.sent.length,1);
});
test('manual Sync button remains available independent of seeking',()=>{
  const a=instance({seconds:555});
  assert.equal(a.sync(),true);
  assert.equal(a.sent.length,1);
  assert.equal(a.sent[0].wallMs,startMs+555000);
});
test('the separate small drift-correction control does not auto-sync',()=>{
  const a=instance({seconds:100});
  a.suppress(a.video,107);
  a.video.currentTime=107;
  a.flush();
  assert.equal(a.sent.length,0);
  assert.match(script,/youtubeLiveClockAdjustCorrection\(\{delta:sign\*youtubeLiveClockMini\.step\}\)/);
  assert.match(script,/youtubeLiveClockSuppressSeek\(video,target\)/);
});
test('remote sync suppression does not block a different manual timestamp',()=>{
  const a=instance({seconds:200});
  a.suppress(a.video,250);
  a.video.currentTime=250;
  a.flush();
  assert.equal(a.sent.length,0);
  a.video.currentTime=500;
  a.flush();
  assert.equal(a.sent.length,1);
});
test('automatic seeking stops on tab background or on a different video',()=>{
  const a=instance();
  a.document.hidden=true;
  a.video.currentTime=450;a.flush();
  assert.equal(a.sent.length,0);
  a.document.hidden=false;
  a.video.currentTime=500;
  a.changeVideo('DIFFERENT12');
  a.flush();
  assert.equal(a.sent.length,0);
});

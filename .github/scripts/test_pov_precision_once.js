const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('Niji_Research_Helper.user.js','utf8');
assert(s.includes('// @version      1.0.42'));
assert(s.includes('...holodexVideos.map(v=>v.id)'));
assert(!s.includes('if(q)await ytSearch('));
assert(s.includes('attachPovSupplement(source, matches, sec, true, candidates)'));
assert(s.includes("const NRH_DB_NAME = 'NijiResearchHelperDB';"));
assert(s.includes("const CLOUD_STORES = ['videos','channels','wiki','pairs'];"));
const videoStart=s.indexOf('  function povYoutubeDuration(s) {'),videoEnd=s.indexOf('  function attachPovSupplement(',videoStart);
assert(videoStart>0&&videoEnd>videoStart);
const cv={Date,Number,String,Object};
vm.runInNewContext(s.slice(videoStart,videoEnd),cv);
const yt=(id,duration,live={})=>({id,contentDetails:{duration},snippet:{title:'SF6 ストリートファイター6',channelId:'UC1111111111111111111111'},liveStreamingDetails:live});
assert.strictEqual(cv.povYoutubeVideo(yt('SHORT000001','PT38S')).povTimeVerified,false,'Short is not a live archive');
assert.strictEqual(cv.povYoutubeVideo(yt('UPLD0000001','PT1H')).povTimeVerified,false,'Upload time is not a live start');
assert.strictEqual(cv.povYoutubeVideo(yt('LIVE0000001','PT1H',{actualStartTime:'2026-06-14T10:00:00Z'})).povTimeVerified,false,'Ongoing live is not finished VOD');
assert.strictEqual(cv.povYoutubeVideo(yt('ARCH0000001','PT1H',{actualStartTime:'2026-06-14T10:00:00Z',actualEndTime:'2026-06-14T11:00:00Z'})).povTimeVerified,true,'Finished live archive accepted');
const begin=s.indexOf('    function remember(v,reason,direct=false) {',videoEnd),end=s.indexOf('    async function youtubeApi(',begin);
assert(begin>videoEnd&&end>begin);
const known=new Set(['SOURCE00001','EXIST000001']);
const seen=new Map();
const permitted='UC1111111111111111111111',stranger='UC2222222222222222222222';
const cx={known,seen,rejected:0,trustedChannelIds:new Set([permitted]),source:{title:'SF6 ストリートファイター6',topic_id:''},syncOffset:0,
  startOf:x=>new Date(x.start_actual),endOf:x=>new Date(x.end_actual),channelId:x=>x.channel_id,
  buildMatches:(source,v)=>[{overlap:3600,related:false,sameGame:true}],
  researchGameFromText:t=>t.includes('SF6')?'SF6':t.includes('Minecraft')?'MC':'',normalizeResearchText:x=>x};
vm.runInNewContext(s.slice(begin,end),cx);
const candidate=(id,type='stream',channel=permitted)=>({id,type,title:'SF6 対戦会',channel_id:channel,start_actual:'2026-06-14T10:00:00Z',end_actual:'2026-06-14T11:00:00Z'});
cx.remember(candidate('EXIST000001'),'already indexed');
cx.remember(candidate('SHORT000001','clip'),'clip');
cx.remember({...candidate('VSHORT00001'),title:'#shorts SF6'},'short');
cx.remember(candidate('STRANGER001','stream',stranger),'global keyword');
cx.remember({...candidate('MISSING0001'),start_actual:''},'missing start');
cx.remember({...candidate('TINY0000001'),end_actual:'2026-06-14T10:00:20Z'},'too short');
cx.remember({...candidate('OTHERGAME01'),title:'Minecraft'},'different game');
cx.remember(candidate('VALID000001'),'named participant channel');
assert.deepStrictEqual([...seen.keys()],['VALID000001']);
console.log('PASS: source guards, archive metadata, Shorts/clip exclusion, known-ID dedupe, participant filtering, duration and game checks');

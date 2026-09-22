const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('Niji_Research_Helper.user.js','utf8');
assert(s.includes('// @version      1.0.47'));
assert(s.includes("const VERSION = '1.0.47'"));
assert(s.includes("const NRH_DB_NAME = 'NijiResearchHelperDB'"));
assert(s.includes("const CLOUD_STORES = ['videos','channels','wiki','pairs']"));
assert(s.includes('if(!match||match.overlap<180)return reject();'),'non-overlapping archive is excluded');
assert(!s.includes("🎓 コーチの関連配信（時間重複なし・要確認）"),'no unrelated coach row');
assert(!s.includes('if(isCoach&&!direct&&!coachEvidence?.teamRelated)'),'do not wrongly reject overlapping Fuwa coach stream');
const fnStart=s.indexOf('    function remember(v,reason,direct=false,clue=null) {',s.indexOf('  function attachPovSupplement('));
const fnEnd=s.indexOf('\n    async function youtubeApi(',fnStart);
assert(fnStart>0&&fnEnd>fnStart);
const ctx={
 known:new Set(['SOURCE00000']),seen:new Map(),rejected:0,duplicateCount:0,checked:0,
 reviewLinks:new Map(),trustedCoachIds:new Set(['UCYAS']),trustedChannelIds:new Set(['UCYAS']),
 source:{id:'SOURCE00000',title:'スト6 #V最協第二幕',topic_id:'Street_Fighter'},syncOffset:null,
 startOf:v=>new Date(v.start_actual),endOf:v=>new Date(v.end_actual),
 buildMatches:(source,vs)=>vs[0].overlap>=180?[{v:vs[0],overlap:vs[0].overlap,related:false}]:[],
 channelId:v=>v.channel?.id||'',channelName:v=>v.channel?.name||'',
 povNameMatches:(a,b)=>a==='YasTube'&&b==='YAS',
 researchGameFromText:()=>'',normalizeResearchText:x=>x,povEventMatches:()=>false
};
vm.createContext(ctx);
vm.runInContext(s.slice(fnStart,fnEnd)+'\nthis.remember=remember;',ctx);
const base={id:'ABCDEFGHIJK',title:'V最 スクリム コーチング！ 【スト6】【リュウ】',
 channel:{id:'UCYAS',name:'YasTube'},type:'stream',povTimeVerified:true,
 start_actual:'2026-09-01T00:00:00Z',end_actual:'2026-09-01T02:00:00Z'};
ctx.remember({...base,overlap:0},'コーチ名から検索',false,{role:'coach',person:'YAS',event:'#V最協第二幕'});
assert.strictEqual(ctx.seen.size,0,'nonoverlap coach must not be displayed');
ctx.remember({...base,id:'LMNOPQRSTUV',title:'V最 ふわっちコーチング！ 【スト6】【リュウ】',overlap:12480},'コーチ名から検索',false,{role:'coach',person:'YAS',event:'#V最協第二幕'});
assert.strictEqual(ctx.seen.size,1,'overlapping Fuwa coach stream must remain a candidate');
assert(ctx.seen.has('LMNOPQRSTUV'));
console.log('PASS: nonoverlap coach hidden; overlapping Fuwa coach stays; NRH DB/cloud schema unchanged');
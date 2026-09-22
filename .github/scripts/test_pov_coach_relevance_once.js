const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('Niji_Research_Helper.user.js','utf8');
assert(s.includes('// @version      1.0.47'));
assert(s.includes("const VERSION = '1.0.47'"));
assert(s.includes("const NRH_DB_NAME = 'NijiResearchHelperDB'"));
assert(s.includes("const CLOUD_STORES = ['videos','channels','wiki','pairs']"));
assert(s.includes('if(isCoach&&!direct&&!coachEvidence?.teamRelated)return reject();'),'same-coach overlap MUST require same-team evidence');
assert(s.includes('coachEvidence.sameEvent||coachEvidence.sourceLinked'),'non-overlap recap MUST require specific-event or source-video link');
assert(!s.includes('near&&(sameGame||(event&&povEventMatches(v,event)))'),'old same-game-only coach filter removed');
const autoStart=s.indexOf('  function povAutomaticClues(source) {');
const coachStart=s.indexOf('  function povCoachClues(source) {');
const nameStart=s.indexOf('  function povNameMatches(channel,person) {');
const evidenceStart=s.indexOf('  function povCoachTeamEvidence(source,video,rosterNames,events) {');
const durStart=s.indexOf('  function povYoutubeDuration(s) {');
assert(autoStart>0&&coachStart>autoStart&&nameStart>coachStart&&evidenceStart>nameStart&&durStart>evidenceStart);
const ctx={
 channelName(v){return v.channel?.name||'';},
 detectedEvents(){return [];},
 povEventMatches(v,event){const norm=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/[#\s\u3000]/g,'');return norm(v.title+' '+(v.description||'')).includes(norm(event));},
};
vm.createContext(ctx);
vm.runInContext(s.slice(autoStart,nameStart)+s.slice(evidenceStart,durStart)+'\nthis.auto=povAutomaticClues;this.coach=povCoachClues;this.evidence=povCoachTeamEvidence;',ctx);
const source={id:'abcdefghijk',title:'#V最協第二幕 | ストリートファイター6 顔合わせその2',channel:{name:'レオス・ヴィンセント'},description:'参ります\n\nチーム\nレオス、ツルギくん、せつなさん、YASコーチ\n\n▼お借りした素敵なイラスト'};
const auto=ctx.auto(source),coach=ctx.coach(source);
assert(auto.names.includes('レオス')&&auto.names.includes('ツルギ')&&auto.names.includes('せつな'),'roster names from user screenshot');
assert(coach.names.includes('YAS'),'YAS coach from screenshot');
assert(auto.events.includes('#V最協第二幕'),'specific event hashtag detected');
const roster=ctx.auto({...source,mentions:[]}).names;
const ev=title=>ctx.evidence(source,{title,description:''},roster,auto.events);
assert.strictEqual(ev('V最 スクリムコーチング！【スト６】【リュウ】').teamRelated,false,'same coach and game but no same team');
assert.strictEqual(ev('V最 ふわっちコーチング！【スト６】【リュウ】').teamRelated,false,'other-team coach stream must be rejected');
assert.strictEqual(ev('【V最協第二幕】別チームコーチング 【スト６】').teamRelated,false,'same event alone is insufficient');
assert.strictEqual(ev('【V最協第二幕】レオスコーチング 【スト６】').teamRelated,true,'same team identified');
assert.strictEqual(ev('【V最協第二幕】レオスコーチング 【スト６】').sameEvent,true,'specific event identified');
assert.strictEqual(ev('レオスコーチング 【スト６】').sameEvent,false,'non-overlap recap without event remains excluded');
assert.strictEqual(ctx.evidence(source,{title:'コーチング',description:'元動画 https://www.youtube.com/watch?v=abcdefghijk'},roster,[]).sourceLinked,true,'specific source video link is strong evidence');
console.log('PASS: roster YAS fixture; exclude both unrelated YasTube streams; require same team/event, preserve source-link evidence and schema');
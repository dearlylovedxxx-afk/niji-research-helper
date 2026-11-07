import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');

function section(from,to){
  const start=source.indexOf(from),end=source.indexOf(to,start);
  assert.ok(start>=0&&end>start,'Missing '+from);
  return source.slice(start,end);
}
const fastCode=section('  async function fetchYoutubePovFastCandidates(', '  async function fetchYoutubeFavoritePovFallback(');
const viewerCode=section('  const youtubePovUnknownUi=', '  async function clearYoutubeSync() {');

class Node {
  constructor(tag='div'){
    this.tagName=tag;
    this.children=[];
    this.style={cssText:'',borderStyle:''};
    this.dataset={};
    this.listeners=new Map();
    this.textContent='';
    this.value='';
    this.hidden=false;
    this.open=false;
    this.classList={toggle(){}};
  }
  appendChild(n){this.children.push(n);n.parentElement=this;return n;}
  replaceChildren(...children){this.children=[];children.forEach(n=>this.appendChild(n));}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  dispatch(name){this.listeners.get(name)?.();}
  getElements(tag){return [
    ...(this.tagName===tag?[this]:[]),
    ...this.children.flatMap(c=>c.getElements(tag))
  ];}
}
const movie=(id,title)=>({
  v:{id,title,channel:{name:title.includes('rival')?'対戦相手':'別の配信者'}},
  related:false,sameGame:false,cs:new Date('2026-11-07T12:00:00Z'),
  candidateStartOffset:1200,overlapRatio:0.8,score:0.1,
  favorite:false,priorityFavorite:false,reasons:[]
});

function viewer(matches){
  const area=new Node('root');
  const document={createElement:tag=>new Node(tag)};
  const run=new Function('document','$','povAttachFilter','povGroupPass','formatClock',
    'channelName','correctedCandidateOffset','openYoutubeAtPovTime','toggleFavorite',
    'isFavorite','adjustCalibration','toast','renderYoutubePovDiagnostics',
    'isMobileYoutubeUi','styleMobileYoutubePanel',
    viewerCode + '\nreturn {renderYoutubeMatches,unknownState:youtubePovUnknownUi};'
  )(
    document,selector=>selector==='#npf-yt-results'?area:null,
    ()=>{},()=>true,sec=>String(sec),
    v=>v.channel.name,(_source,m)=>m.candidateStartOffset,
    ()=>{},async()=>{},()=>false,async()=>0,()=>{},()=>{},()=>false,()=>{}
  );
  run.renderYoutubeMatches({id:'ABCDEFGHIJK'},matches,900);
  return {area,run};
}

test('v1.0.127 source and metadata parse',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+1\.0\.127/);
  assert.match(meta,/@version\s+1\.0\.127/);
});
test('same-time opponent without recognizable game is no longer silently hidden',()=>{
  const {area}=viewer([movie('LMNOPQRSTUV','rival game title missing')]);
  assert.match(area.getElements('div')[0].textContent,/時間一致・ゲーム未判定 1件/);
  const details=area.getElements('details');
  assert.equal(details.length,1);
  assert.equal(details[0].open,true);
  assert.match(details[0].getElements('summary')[0].textContent,/同時刻の未判定アーカイブ 1件/);
  assert.equal(details[0].getElements('input').length,1);
  assert.equal(details[0].getElements('div').filter(n=>n.className==='npf-yt-result-card').length,1);
});
test('confirmed same-game and related results remain in their original groups',()=>{
  const confirmed=movie('LMNOPQRSTUV','related');confirmed.related=true;confirmed.sameGame=true;
  const same=movie('ABCDEFGHIJQ','same game');same.sameGame=true;
  const unknown=movie('ABCDEFGHIJR','rival');
  const {area}=viewer([confirmed,same,unknown]);
  assert.equal(area.getElements('div').filter(n=>n.className==='npf-yt-result-card').length,2);
  assert.equal(area.getElements('details').length,1);
  assert.equal(area.getElements('details')[0].open,false);
});
test('unverified candidates can be searched by streamer name, not just game title',()=>{
  const {area}=viewer([movie('LMNOPQRSTUV','rival stream'),movie('ABCDEFGHIJQ','other stream')]);
  const details=area.getElements('details')[0],input=details.getElements('input')[0];
  input.value='対戦相手';
  input.dispatch('input');
  assert.equal(details.getElements('div').filter(n=>n.className==='npf-yt-result-card').length,1);
});
test('unclassified candidate list is paged instead of rendering hundreds of cards',()=>{
  const matches=Array.from({length:135},(_,i)=>movie('video'+String(i).padStart(6,'0'),i+' rival'));
  const {area}=viewer(matches);
  const details=area.getElements('details')[0];
  assert.equal(details.getElements('div').filter(n=>n.className==='npf-yt-result-card').length,40);
  const more=details.getElements('button').find(b=>b.textContent==='さらに40件表示');
  assert.ok(more&&!more.hidden);
  more.dispatch('click');
  assert.equal(details.getElements('div').filter(n=>n.className==='npf-yt-result-card').length,80);
});
test('initial Holodex POV search paginates beyond the 50-item first page',async()=>{
  const requests=[];
  const getter=new Function('startOf','endOf','state','apiGet',fastCode+
    '\nreturn fetchYoutubePovFastCandidates;')(
    v=>new Date(v.start_actual),v=>new Date(v.end_actual),
    {settings:{}},
    async path=>{
      const url=new URL(path,'https://holodex.net/api/v2');
      const offset=Number(url.searchParams.get('offset'));
      requests.push({offset,org:url.searchParams.get('org'),topic:url.searchParams.get('topic')});
      return Array.from({length:offset<100?50:12},(_,i)=>({id:String(offset+i)}));
    }
  );
  const result=await getter({start_actual:'2026-11-07T10:00:00Z',
    end_actual:'2026-11-07T14:00:00Z',topic_id:'splatoon'},3600);
  assert.equal(result.length,112);
  assert.deepEqual(requests.filter(x=>x.org==='Nijisanji').map(x=>x.offset),[0,50,100]);
  assert.deepEqual(requests.filter(x=>x.topic==='splatoon').map(x=>x.offset),[0,50,100]);
});
test('auto-sync candidates still require actual time overlap in buildMatches',()=>{
  const rules=section('  function buildMatches(source, videos, syncOffset = null) {','  async function toggleFavorite(');
  assert.match(rules,/if \(overlap <= 0\) return null/);
  assert.match(rules,/if \(targetMoment && !\(targetMoment >= cs && targetMoment <= ce\)\) return null/);
  assert.match(viewerCode,/!m\.related && !m\.sameGame/);
  assert.doesNotMatch(viewerCode,/m\.related\s*=\s*true/);
});

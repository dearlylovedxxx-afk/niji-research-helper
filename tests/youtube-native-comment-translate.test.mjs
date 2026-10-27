import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');
const from=script.indexOf('  function installYoutubeNativeCommentAutoTranslate() {');
const until=script.indexOf('  // ---------- YouTube player +10s/-10s',from);
assert.ok(from>0&&until>from,'native translator module must exist');
const moduleSource=script.slice(from,until);

class CommentButton {
  constructor({state='untoggled',label='Translate to Japanese'}={}) {
    this.state=state;
    this.label=label;
    this.textContent=label;
    this.isConnected=true;
    this.localName='ytd-comment-view-model';
    this.clicked=0;
    this.inner={
      getAttribute:name=>name==='aria-label'?this.label:null,
      matches:()=>false,
      click:()=>{this.clicked++;}
    };
  }
  closest(selector) { return selector.includes('[hidden]')?null:this; }
  getAttribute(name) { return name==='state'?this.state:null; }
  matches(selector) { return selector.includes('translate-button'); }
  querySelector(selector) { return selector.includes('button')?this.inner:null; }
}
function setup(initial=[]) {
  let buttons=initial.slice();
  const io=[],mo=[],tasks=[],intervals=[];
  const location={pathname:'/watch',search:'?v=first'};
  const window={};
  const document={
    hidden:false, documentElement:{},
    querySelectorAll:()=>buttons,
    addEventListener:()=>{}
  };
  class IntersectionObserverFake {
    constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();io.push(this);}
    observe(target){this.targets.add(target);}
    unobserve(target){this.targets.delete(target);}
    disconnect(){this.targets.clear();}
    enter(target){this.callback([{target,isIntersecting:true}]);}
  }
  class MutationObserverFake {
    constructor(callback){this.callback=callback;mo.push(this);}
    observe(){}
    add(node){this.callback([{addedNodes:[node]}]);}
  }
  const install=new Function(
    'document','location','window','Element','IntersectionObserver','MutationObserver',
    'setTimeout','setInterval','isYoutubeHost','console',
    moduleSource+'\ninstallYoutubeNativeCommentAutoTranslate();'
  );
  install(document,location,window,CommentButton,IntersectionObserverFake,MutationObserverFake,
    fn=>{tasks.push(fn);return tasks.length;},
    fn=>{intervals.push(fn);return intervals.length;},
    ()=>true,{debug(){}});
  return {
    io,mo,location,window,document,intervals,
    setButtons(value){buttons=value;},
    flush(){tasks.splice(0).forEach(fn=>fn());}
  };
}

test('Niji Research Helper v1.0.124 parses and metadata matches',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/@version\s+1\.0\.124/);
  assert.match(meta,/@version\s+1\.0\.124/);
  assert.match(script,/installYoutubeNativeCommentAutoTranslate\(\)/);
});
test('visible native comment translates once and does not toggle back',()=>{
  const comment=new CommentButton();
  const h=setup([comment]);
  assert.ok(h.io[0].targets.has(comment));
  assert.equal(comment.clicked,0);
  h.io[0].enter(comment);
  h.io[0].enter(comment);
  assert.equal(comment.clicked,1);
});
test('never click Show original, already translated comments, or hidden videos',()=>{
  for(const opts of [{label:'Show original'},{label:'原文を見る'},{state:'toggled'}]){
    const comment=new CommentButton(opts);
    const h=setup([comment]);
    h.io[0].enter(comment);
    assert.equal(comment.clicked,0);
  }
  const comment=new CommentButton(),h=setup([comment]);
  h.location.pathname='/results';
  h.io[0].enter(comment);
  assert.equal(comment.clicked,0);
});
test('newly loaded comments and YouTube navigation are handled',()=>{
  const h=setup(),comment=new CommentButton();
  h.setButtons([comment]);
  h.mo[0].add(comment);
  h.flush();
  assert.ok(h.io[0].targets.has(comment));
  h.io[0].enter(comment);
  assert.equal(comment.clicked,1);
  h.location.search='?v=second';
  h.intervals[0]();
  h.io[0].enter(comment);
  assert.equal(comment.clicked,2);
});
test('uses native translation only and avoids external API calls',()=>{
  assert.match(moduleSource,/new IntersectionObserver/);
  assert.match(moduleSource,/new MutationObserver/);
  assert.match(moduleSource,/nativeTranslateTarget\(node\)/);
  assert.match(moduleSource,/target\.click\(\)/);
  assert.doesNotMatch(moduleSource,/\bfetch\s*\(|\bGM\.xmlHttpRequest\b/);
  assert.doesNotMatch(moduleSource,/expandReplies|more-replies|live-chat/);
});

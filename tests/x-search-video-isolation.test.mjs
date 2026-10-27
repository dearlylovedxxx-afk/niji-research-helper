import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../X_Search_Favorites.user.js',import.meta.url),'utf8');
const earlyStart=source.indexOf('(function xsfEarlyLayout() {');
const earlyEnd=source.indexOf('// Start the search panel after the document exists.',earlyStart);
const coreStart=source.indexOf('  function syncLayout(){');
const coreEnd=source.indexOf('  let interval=setInterval(syncLayout',coreStart);
assert.ok(earlyStart>=0&&earlyEnd>earlyStart&&coreStart>=0&&coreEnd>coreStart);
const earlySource=source.slice(earlyStart,earlyEnd);
const coreSource=source.slice(coreStart,coreEnd);

function classList(){
  const values=new Set();
  return {
    contains:key=>values.has(key),
    toggle(key,value){if(value)values.add(key);else values.delete(key);},
    add(...keys){keys.forEach(k=>values.add(k));},
    remove(...keys){keys.forEach(k=>values.delete(k));}
  };
}
function early(path,opts={enabled:true}) {
  const root={classList:classList()},body={classList:classList()},styles=[];
  const document={
    documentElement:root,body,
    head:{prepend(node){styles.push(node.textContent)}},
    createElement(){return {id:'',textContent:''};}
  };
  const location={pathname:path};
  const localStorage={getItem(){return JSON.stringify(opts);}};
  const window={};window.top=window.self=window;
  new Function('document','location','localStorage','window','setInterval','addEventListener','clearInterval','MutationObserver',earlySource)(
    document,location,localStorage,window,()=>1,()=>{},()=>{},class{}
  );
  return {root:root.classList,body:body.classList,css:styles.join('\n')};
}
function core(path,opts) {
  const body={classList:classList(),matches(){return false;}};
  const document={body};
  const location={pathname:path};
  let nativeSearchCalls=0;
  const window={__xsfUpdateEarly(){}};
  const syncLayout=new Function('document','location','options','window','syncSearch','resetSearch',
    coreSource+'\nreturn syncLayout;')(
    document,location,opts,window,()=>{nativeSearchCalls++;},()=>{}
  );
  syncLayout();
  return {classes:body.classList,nativeSearchCalls};
}
const settings={enabled:true,wideTimeline:true,wideTweet:true,videoGuard:true,
  videoSafeTweet:true,tlVideoIsolation:true,searchVideoIsolation:true,
  hideSidebarContent:true,nativeSearch:true,hideGrok:true};

test('v1.3.8 source parses and preserves original storage',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+1\.3\.8/);
  assert.match(source,/const VERSION='1\.3\.8'/);
  assert.match(source,/KEY='xsf_userscript_v1'/);
  assert.match(source,/xsf_display_settings_v1/);
});
test('search results and Explore use the protected wide feed from the first paint',()=>{
  for(const path of ['/search','/search/advanced','/explore']){
    const r=early(path,settings);
    assert.ok(r.root.contains('xsf-guard-search'),path);
    assert.ok(r.root.contains('xsf-guard-wide'),path);
    assert.ok(!r.root.contains('xsf-pre-full'),path);
    assert.ok(r.root.contains('xsf-guard-tl-grok'),path);
    assert.match(r.css,/html\.xsf-guard-search \[data-testid="primaryColumn"\]/);
  }
});
test('guard remains enabled with older saved settings missing the new key',()=>{
  const r=early('/search',{enabled:true,wideTimeline:true});
  assert.ok(r.root.contains('xsf-guard-search'));
});
test('search keeps native X feed, saved-search panel and like tools available',()=>{
  const r=core('/search',settings);
  assert.ok(!r.classes.contains('xsf-layout-full'));
  assert.ok(!r.classes.contains('xsf-display-active'));
  assert.ok(!r.classes.contains('xsf-sidebar-hidden'));
  assert.equal(r.nativeSearchCalls,1);
  assert.match(source,/function captureLikes\(\)/);
  assert.match(source,/function scanMore\(\)/);
  assert.match(source,/function applyFilter\(\)/);
  assert.match(source,/function navigate\(q,mode='live'\)/);
  assert.match(source,/if\(!isGuardedVideoPage\(\)\)\(document.body\|\|document.documentElement\)\.append\(host\)/);
  assert.doesNotMatch(source,/const isGuardedVideoPage=\(\)=>\{[\s\S]*?if\(!post&&!timeline\)[\s\S]*?searchVideoIsolation/);
});
test('search route does not attach a document-wide media mutation observer',()=>{
  assert.match(source,/const searchProtected=location\.pathname\.startsWith\('\/search'\)/);
  assert.match(source,/const needsObserver=activeSearch\(\) && !searchProtected/);
  assert.match(source,/const observer=new MutationObserver/);
  assert.match(source,/timer=setInterval\(\(\)=>\{/);
});
test('TL and post isolation are unchanged',()=>{
  const timeline=early('/home',settings);
  assert.ok(timeline.root.contains('xsf-guard-tl'));
  assert.ok(timeline.root.contains('xsf-guard-wide'));
  assert.ok(!timeline.root.contains('xsf-pre-full'));
  const post=core('/someuser/status/123',settings);
  assert.ok(!post.classes.contains('xsf-layout-full'));
});
test('video-safe search layout can be toggled off independently',()=>{
  const opts={...settings,searchVideoIsolation:false};
  assert.ok(early('/search',opts).root.contains('xsf-pre-full'));
  assert.ok(!early('/search',opts).root.contains('xsf-guard-search'));
  assert.ok(core('/search',opts).classes.contains('xsf-layout-full'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../X_Search_Favorites.user.js',import.meta.url),'utf8');
const guardStart=script.indexOf('const isGuardedVideoPage=()=>{');
const guardEnd=script.indexOf('const tlLauncherEnabled=()=>{',guardStart);
const earlyStart=script.indexOf('(function xsfEarlyLayout() {');
const earlyEnd=script.indexOf('// Start the search panel after the document exists.',earlyStart);
const coreStart=script.indexOf('  function syncLayout(){');
const coreEnd=script.indexOf('  let interval=setInterval(syncLayout',coreStart);
assert.ok(guardStart>0&&guardEnd>guardStart&&earlyStart>=0&&earlyEnd>earlyStart&&coreStart>0&&coreEnd>coreStart);
const guards=script.slice(guardStart,guardEnd);
const earlySource=script.slice(earlyStart,earlyEnd);
const coreSource=script.slice(coreStart,coreEnd);

function guard(path,settings={enabled:true}){
  const location={pathname:path};
  const localStorage={getItem:()=>JSON.stringify(settings)};
  return new Function('location','localStorage',
    guards+'return {protected:isGuardedVideoPage(),canLaunch:isProtectedLaunchRoute()};'
  )(location,localStorage);
}
function classes(){
  const values=new Set();
  return {
    toggle(key,on){if(on)values.add(key);else values.delete(key);},
    contains:key=>values.has(key),
    remove(...keys){keys.forEach(key=>values.delete(key));}
  };
}
function firstPaint(path,settings={enabled:true}){
  const html={classList:classes()};
  const body={classList:classes()};
  const document={
    documentElement:html,body,
    createElement(){return {id:'',textContent:''};},
    head:{prepend(){}}
  };
  const window={};window.self=window.top=window;
  new Function('document','window','location','localStorage','setInterval','clearInterval','addEventListener','MutationObserver',earlySource)(
    document,window,{pathname:path},{getItem:()=>JSON.stringify(settings)},()=>1,()=>{},()=>{},class{}
  );
  return html.classList;
}
function afterLoad(path,settings){
  const body={classList:classes(),matches:()=>false};
  const document={body};
  const syncLayout=new Function('document','location','options','window','resetSearch','syncSearch',
    coreSource+'return syncLayout;')(
    document,{pathname:path},settings,{__xsfUpdateEarly(){}},()=>{},()=>{}
  );
  syncLayout();
  return body.classList;
}
const defaults={enabled:true,wideTimeline:true,wideTweet:true,tlVideoIsolation:true,
  searchVideoIsolation:true,likesVideoIsolation:true,videoGuard:true,videoSafeTweet:true,
  hideSidebarContent:true,hideForYou:false,monochromeButtons:false,nativeSearch:true};

test('v1.3.12 scripts parse and preserve the same saved-data keys',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/@version\s+1\.3\.12/);
  assert.match(script,/const VERSION='1\.3\.12'/);
  assert.match(script,/KEY='xsf_userscript_v1'/);
  assert.match(script,/const KEY='xsf_display_settings_v1'/);
});
test('guarded post detail provides a launcher even with display settings disabled',()=>{
  for(const path of ['/alice/status/1234567890','/alice/status/1234567890/quotes']){
    assert.deepEqual(guard(path,{enabled:false}),{protected:true,canLaunch:true});
  }
  assert.match(script,/if\(isProtectedLaunchRoute\(\) && tlLauncherEnabled\(\)\)/);
  assert.match(script,/if\(!isProtectedLaunchRoute\(\)\|\|!tlLauncherEnabled\(\)\)return/);
  assert.match(script,/else if\(isProtectedLaunchRoute\(\)\)\{/);
  assert.match(script,/protectedButton\.onclick=\(\)=>\{/);
  assert.match(script,/launch\.click\(\)/);
  assert.match(script,/if\(!panel\.hidden && host\.isConnected\)\{protectedLauncherHost\.remove\(\);\}/);
});
test('liked tweets profiles are protected and do not receive the full-width CSS',()=>{
  for(const path of ['/alice/likes','/alice/likes/']){
    assert.deepEqual(guard(path),{protected:true,canLaunch:true});
    const initial=firstPaint(path);
    assert.ok(initial.contains('xsf-guard-likes'));
    assert.ok(!initial.contains('xsf-guard-wide'));
    assert.ok(!initial.contains('xsf-pre-full'));
    const after=afterLoad(path,defaults);
    assert.ok(!after.contains('xsf-layout-full'));
    assert.ok(!after.contains('xsf-display-active'));
    assert.ok(!after.contains('xsf-sidebar-hidden'));
  }
});
test('old settings activate the liked tweets guard without data migration',()=>{
  assert.equal(guard('/alice/likes',{enabled:true,wideTimeline:true}).protected,true);
  assert.ok(firstPaint('/alice/likes',{enabled:true,wideTimeline:true}).contains('xsf-guard-likes'));
  assert.match(script,/likesVideoIsolation:true/);
});
test('likes guard is optional and does not guard unrelated profile posts',()=>{
  assert.equal(guard('/alice/likes',{enabled:true,likesVideoIsolation:false}).protected,false);
  assert.ok(firstPaint('/alice/likes',{enabled:true,likesVideoIsolation:false}).contains('xsf-pre-full'));
  assert.equal(guard('/alice/media').protected,false);
  assert.equal(guard('/alice').protected,false);
  assert.equal(guard('/alice/likes',{enabled:false}).protected,false);
});
test('home and search keep their existing independent video logic',()=>{
  assert.equal(guard('/home').protected,true);
  assert.equal(guard('/home',{enabled:true,tlVideoIsolation:false}).protected,false);
  assert.equal(guard('/search').protected,false);
  assert.ok(firstPaint('/search').contains('xsf-guard-search'));
  assert.ok(firstPaint('/home').contains('xsf-guard-tl'));
  assert.ok(firstPaint('/home').contains('xsf-guard-wide'));
});
test('guarded launcher stays outside X article and avoids its other bottom-right controls',()=>{
  assert.match(script,/protectedLauncherHost\.style\.cssText='position:fixed!important;right:82px!important/);
  assert.match(script,/protectedLauncherHost\.attachShadow\(\{mode:'open'\}\)/);
  assert.match(script,/const needsObserver=activeSearch\(\) && !searchProtected/);
  assert.match(script,/if\(observerActive\)\{observer\.disconnect\(\);observerActive=false;\}/);
  assert.doesNotMatch(guards,/querySelector|MutationObserver/);
});

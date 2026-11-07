import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../X_Search_Favorites.user.js',import.meta.url),'utf8');
const earlyFrom=src.indexOf('(function xsfEarlyLayout() {');
const earlyTo=src.indexOf('// Start the search panel after the document exists.',earlyFrom);
const layoutFrom=src.indexOf('  function syncLayout(){');
const layoutTo=src.indexOf('  let interval=setInterval(syncLayout',layoutFrom);
const observerFrom=src.indexOf('function syncCoreObserver(){');
const observerTo=src.indexOf('syncCoreObserver();',observerFrom);
assert.ok(earlyFrom>=0 && earlyTo>earlyFrom && layoutTo>layoutFrom &&
  observerFrom>0 && observerTo>observerFrom);

function makeClasses(){
  const values=new Set();
  return {
    add(...keys){keys.forEach(x=>values.add(x));},
    remove(...keys){keys.forEach(x=>values.delete(x));},
    contains:x=>values.has(x),
    toggle(x,on){on?values.add(x):values.delete(x)}
  };
}
const config={enabled:true,likesVideoIsolation:true,wideTimeline:true,
  hideSidebarContent:true,videoGuard:true,tlVideoIsolation:true,
  searchVideoIsolation:true,hideForYou:true,nativeSearch:true};

function earlyHarness(path,opts=config){
  const html={classList:makeClasses()},body={classList:makeClasses()};
  const style={disabled:false};
  const doc={documentElement:html,body,head:{prepend(){}},
    createElement(){return style;}};
  const location={pathname:path};
  const history={
    pushState(_x,_y,url){location.pathname=String(url)},
    replaceState(_x,_y,url){location.pathname=String(url)}
  };
  const window={};window.self=window.top=window;
  new Function('window','document','location','history','localStorage','setInterval',
    'addEventListener','MutationObserver','clearInterval',
    src.slice(earlyFrom,earlyTo))(
      window,doc,location,history,
      {getItem:()=>JSON.stringify(opts)},()=>1,()=>{},class{},()=>{}
    );
  return {html:html.classList,body:body.classList,style,location,history};
}

function layoutHarness(path,opts=config){
  const body={classList:makeClasses(),matches(){return false;}};
  body.classList.add('xsf-layout-full','xsf-display-active','xsf-sidebar-hidden');
  const style={disabled:false},location={pathname:path};
  let search=0,reset=0;
  const context=new Function('document','location','options','window','style',
    'bodyClasses','resetSearch','syncSearch',
    src.slice(layoutFrom,layoutTo)+'\nreturn syncLayout;')(
      {body},location,opts,{__xsfUpdateEarly(){}},style,
      ['xsf-layout-full','xsf-display-active','xsf-sidebar-hidden'],
      ()=>reset++,()=>search++
    );
  context();
  return {style,classes:body.classList,search,reset};
}

test('Likes turns OFF XSF early CSS while retaining the native-width feed',()=>{
  const p=earlyHarness('/alice/likes');
  assert.equal(p.style.disabled,true);
  assert.ok(p.html.contains('xsf-guard-likes'));
  assert.ok(!p.html.contains('xsf-pre-full'));
  assert.ok(!p.html.contains('xsf-pre-profile'));
  assert.ok(!p.html.contains('xsf-guarded-ui'));
  assert.ok(!p.html.contains('xsf-guard-wide'));
});
test('Likes turns OFF late layout CSS, clears previous width overrides, skips UI search relocation',()=>{
  const p=layoutHarness('/alice/likes');
  assert.equal(p.style.disabled,true);
  assert.equal(p.search,0);
  assert.equal(p.reset,1);
  for(const name of ['xsf-layout-full','xsf-display-active','xsf-sidebar-hidden'])
    assert.ok(!p.classes.contains(name),name);
});
test('entering and leaving Likes in X SPA restores previous style behavior',()=>{
  const p=earlyHarness('/alice');
  assert.equal(p.style.disabled,false);
  assert.ok(p.html.contains('xsf-pre-profile'));
  p.history.pushState({},'', '/alice/likes');
  assert.equal(p.style.disabled,true);
  assert.ok(!p.html.contains('xsf-pre-profile'));
  p.history.pushState({},'', '/home');
  assert.equal(p.style.disabled,false);
  assert.ok(p.html.contains('xsf-guarded-ui'));
});
test('post details and Home keep their independent protections',()=>{
  const post=earlyHarness('/alice/status/1234567');
  assert.equal(post.style.disabled,false);
  assert.ok(post.html.contains('xsf-guarded-ui'));
  const home=layoutHarness('/home');
  assert.equal(home.style.disabled,false);
  assert.equal(home.search,1);
});
test('Likes removes both XSF overlay roots instead of creating a video-compositing layer',()=>{
  const guardSrc=src.slice(observerFrom,observerTo);
  assert.match(guardSrc,/if\(isNativeLikesRoute\(\)\)\{\s*host\.remove\(\);\s*protectedLauncherHost\.remove\(\);\s*return false/);
  assert.match(src,/const isNativeLikesRoute=\(\)=>\{/);
  assert.match(src,/likesVideoIsolation!==false/);
  assert.match(src,/protectedLauncherHost\.id='xsf-video-safe-launcher'/);
});
test('XSF user data is untouched, unlike removing and reinstalling the script',()=>{
  assert.match(src,/@version\s+1\.3\.15/);
  assert.match(src,/const VERSION='1\.3\.15'/);
  assert.match(src,/KEY='xsf_userscript_v1'/);
  assert.match(src,/const KEY='xsf_display_settings_v1'/);
  assert.doesNotMatch(src.slice(observerFrom,observerTo),/localStorage\.removeItem|localStorage\.clear/);
});

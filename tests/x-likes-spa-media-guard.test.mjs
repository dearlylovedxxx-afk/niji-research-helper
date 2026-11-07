import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../X_Search_Favorites.user.js',import.meta.url),'utf8');
const start=source.indexOf('(function xsfEarlyLayout() {');
const end=source.indexOf('// Start the search panel after the document exists.',start);
const early=source.slice(start,end);
assert.ok(start>=0&&end>start);

function classes(){
  const entries=new Set();
  return {
    contains:name=>entries.has(name),
    toggle:(name,on)=>on?entries.add(name):entries.delete(name),
    add:(...names)=>names.forEach(name=>entries.add(name)),
    remove:(...names)=>names.forEach(name=>entries.delete(name)),
  };
}

function scenario(path='/alice',settings={enabled:true,likesVideoIsolation:true,
  wideTimeline:true,hideForYou:true,tlVideoIsolation:true}){
  const root={classList:classes()};
  const body={classList:classes()};
  const location={pathname:path};
  const history={
    pushState(state,title,url){location.pathname=String(url).split('?')[0];},
    replaceState(state,title,url){location.pathname=String(url).split('?')[0];}
  };
  let syncs=0;
  const window={__xsfLayoutSync:()=>{syncs++}};
  window.self=window.top=window;
  const document={
    documentElement:root,
    body,
    head:{prepend(){}},
    createElement(){return {id:'',textContent:''};}
  };
  new Function('window','document','location','history','localStorage','setInterval',
    'addEventListener','MutationObserver','clearInterval',early)(
    window,document,location,history,{getItem:()=>JSON.stringify(settings)},
    ()=>1,()=>{},class{},()=>{}
  );
  return {root:root.classList,body:body.classList,history,location,
    get syncs(){return syncs}};
}

test('v1.3.14 is valid and preserves original stored settings and user data',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+1\.3\.14/);
  assert.match(source,/const VERSION='1\.3\.14'/);
  assert.match(source,/xsf_display_settings_v1/);
  assert.match(source,/KEY='xsf_userscript_v1'/);
});

test('SPA navigation from wide profile to Likes protects media before next polling tick',()=>{
  const s=scenario('/alice');
  assert.ok(s.root.contains('xsf-pre-full'));
  s.body.add('xsf-layout-full','xsf-display-active','xsf-sidebar-hidden');
  s.history.pushState({},'', '/alice/likes');
  assert.equal(s.location.pathname,'/alice/likes');
  assert.ok(s.root.contains('xsf-guard-likes'));
  assert.ok(s.root.contains('xsf-guarded-ui'));
  assert.ok(!s.root.contains('xsf-pre-full'));
  assert.ok(!s.root.contains('xsf-pre-profile'));
  assert.ok(!s.root.contains('xsf-guard-wide'));
  for(const rule of ['xsf-layout-full','xsf-display-active','xsf-sidebar-hidden'])
    assert.ok(!s.body.contains(rule),rule);
  assert.equal(s.syncs,1);
});

test('replaceState applies route isolation without waiting for 1.2s layout polling',()=>{
  const s=scenario('/alice');
  s.history.replaceState({},'', '/alice/likes');
  assert.ok(s.root.contains('xsf-guard-likes'));
  assert.equal(s.syncs,1);
});

test('likes stays native and does not hide the profile navigation tabs',()=>{
  const s=scenario('/alice/likes');
  assert.ok(s.root.contains('xsf-guard-likes'));
  assert.ok(!s.root.contains('xsf-guard-home'));
  assert.match(source,/html\.xsf-guard-home \[data-testid="primaryColumn"\] nav\[role="navigation"\] \[role="tablist"\] > div:first-child/);
  assert.doesNotMatch(source,/html\.xsf-guarded-ui \[data-testid="primaryColumn"\] nav\[role="navigation"\] \[role="tablist"\] > div:first-child/);
});

test('Home alone receives hidden For You tab, other profiles keep tabs intact',()=>{
  const home=scenario('/home');
  assert.ok(home.root.contains('xsf-guard-home'));
  const profile=scenario('/alice');
  assert.ok(!profile.root.contains('xsf-guard-home'));
  const likes=scenario('/alice/likes');
  assert.ok(!likes.root.contains('xsf-guard-home'));
});

test('navigating away from Likes restores normal non-guarded profile style',()=>{
  const s=scenario('/alice/likes');
  s.history.pushState({},'', '/alice');
  assert.ok(!s.root.contains('xsf-guard-likes'));
  assert.ok(!s.root.contains('xsf-guarded-ui'));
  assert.ok(s.root.contains('xsf-pre-profile'));
});

test('video post and search protection remain enabled independently',()=>{
  const post=scenario('/alice/status/1234');
  assert.ok(post.root.contains('xsf-guarded-ui'));
  assert.ok(!post.root.contains('xsf-guard-likes'));
  const search=scenario('/search');
  assert.ok(search.root.contains('xsf-guard-search'));
});

test('changing browser history does not create or touch videos/players',()=>{
  assert.doesNotMatch(early,/querySelectorAll\(['"]video/);
  assert.doesNotMatch(early,/\.load\(\)|\.play\(\)|\.pause\(\)/);
  assert.match(early,/history\[key\]=function\(\.\.\.args\)/);
});

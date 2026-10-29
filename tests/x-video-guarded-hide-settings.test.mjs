import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../X_Search_Favorites.user.js',import.meta.url),'utf8');
const earlyFrom=source.indexOf('(function xsfEarlyLayout() {');
const earlyTo=source.indexOf('// Start the search panel after the document exists.',earlyFrom);
const selectorsFrom=source.indexOf('  const hiddenSelectors={');
const selectorsTo=source.indexOf('  const bodyClasses=[',selectorsFrom);
const cssFrom=source.indexOf('  function applyCSS(){');
const cssTo=source.indexOf('  function markSearch(',cssFrom);
const layoutFrom=source.indexOf('  function syncLayout(){');
const layoutTo=source.indexOf('  let interval=setInterval(syncLayout',layoutFrom);
assert.ok(earlyFrom>=0&&earlyTo>earlyFrom&&selectorsTo>selectorsFrom&&cssTo>cssFrom&&layoutTo>layoutFrom);
const earlySource=source.slice(earlyFrom,earlyTo);
const cssSource=source.slice(selectorsFrom,selectorsTo)+source.slice(cssFrom,cssTo);
const layoutSource=source.slice(layoutFrom,layoutTo);

function classes() {
  const values=new Set();
  return {
    toggle(name,on){if(on)values.add(name);else values.delete(name);},
    contains(name){return values.has(name);},
    remove(...names){names.forEach(name=>values.delete(name));}
  };
}
function firstPaint(path,settings) {
  const root={classList:classes()},body={classList:classes()};
  const document={
    documentElement:root,body,head:{prepend(){}},
    createElement(){return {id:'',textContent:''};}
  };
  const window={}; window.self=window.top=window;
  const localStorage={getItem:()=>JSON.stringify(settings)};
  new Function('document','window','location','localStorage','setInterval',
    'clearInterval','addEventListener','MutationObserver',earlySource)(
    document,window,{pathname:path},localStorage,()=>1,()=>{},()=>{},class{}
  );
  return {html:root.classList,body:body.classList};
}
function afterLoad(path,settings){
  const body={classList:classes(),matches(){return false;}};
  const document={body};
  const syncLayout=new Function('document','location','options','window',
    'syncSearch','resetSearch',layoutSource+'return syncLayout;')(
      document,{pathname:path},settings,{__xsfUpdateEarly(){}},()=>{},()=>{}
    );
  syncLayout();
  return body.classList;
}
function buildCss(options){
  const style={textContent:''};
  new Function('options','style',cssSource+'applyCSS();')(options,style);
  return style.textContent;
}
const active={
  enabled:true,videoGuard:true,tlVideoIsolation:true,searchVideoIsolation:true,
  likesVideoIsolation:true,wideTweet:true,guardWidePost:true,wideTimeline:true,
  hideGrok:true,hidePremium:true,hideCalls:true,hideCreatorStudio:true,
  hideSubscriptions:true,hideMoney:true,hideJobs:true,hideAnalytics:true,
  hideMessageDrawer:true,hideWhoToFollow:true,hideForYou:true
};
test('XSF v1.3.13 parses, preserves data and integrates a guarded chrome layer',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+1\.3\.13/);
  assert.match(source,/const VERSION='1\.3\.13'/);
  assert.match(source,/KEY='xsf_userscript_v1'/);
  assert.match(source,/const KEY='xsf_display_settings_v1'/);
  assert.match(source,/root\.classList\.toggle\('xsf-guarded-ui', opts\.enabled===true && guarded\)/);
});
test('guarded post still hides native menus even though full display CSS is disabled',()=>{
  const first=firstPaint('/alice/status/12345',active);
  const body=afterLoad('/alice/status/12345',active);
  assert.ok(first.html.contains('xsf-guarded-ui'));
  assert.ok(first.html.contains('xsf-guard-wide'));
  assert.ok(!body.contains('xsf-display-active'));
  const css=buildCss(active);
  for(const link of [
    'header nav a[href="/i/grok"]',
    'header nav a[href^="/i/premium"]',
    'header nav a[href="/i/calls"]',
    'header nav a[href$="/creators/studio"]',
    'header nav a[href*="creator-subscriptions"]',
    'header nav a[href="/i/money"]',
    'header nav a[href="/jobs"]',
    'header nav a[href="/i/account_analytics"]'
  ]){
    assert.ok(css.includes('html.xsf-guarded-ui '+link),'Missing guarded hide for '+link);
  }
  assert.ok(css.includes('html.xsf-guarded-ui [data-testid="chat-drawer-root"]'));
});
test('safe menu hiding works on TL, search, likes and post routes',()=>{
  for(const path of ['/home','/i/lists/987','/search','/explore','/alice/likes','/alice/status/45']){
    assert.ok(firstPaint(path,active).html.contains('xsf-guarded-ui'),path);
  }
  for(const path of ['/alice','/alice/media','/settings']){
    assert.ok(!firstPaint(path,active).html.contains('xsf-guarded-ui'),path);
  }
});
test('video guard and each hide option toggle independently',()=>{
  const css=buildCss({...active,hideGrok:false,hidePremium:false,hideCalls:true});
  assert.ok(!css.includes('html.xsf-guarded-ui header nav a[href="/i/grok"]'));
  assert.ok(!css.includes('html.xsf-guarded-ui header nav a[href^="/i/premium"]'));
  assert.ok(css.includes('html.xsf-guarded-ui header nav a[href="/i/calls"]'));
  assert.ok(firstPaint('/alice/status/45',active).html.contains('xsf-guarded-ui'));
  assert.ok(!firstPaint('/alice/status/45',{...active,enabled:false}).html.contains('xsf-guarded-ui'));
  assert.ok(!firstPaint('/alice/status/45',{...active,videoGuard:false}).html.contains('xsf-guarded-ui'));
});
test('only safe navigation/side chrome is targeted within guarded CSS',()=>{
  const css=buildCss(active);
  const targets=css.split('\n').filter(line=>line.trim().startsWith('html.xsf-guarded-ui '));
  assert.ok(targets.length>12);
  for(const line of targets){
    assert.doesNotMatch(line,/\bvideo\b|videoPlayer|tweetPhoto|placementTracking|article\[|data-testid="tweet"|data-testid="videoComponent"/);
  }
  assert.ok(css.includes('body.xsf-display-active'));
  assert.match(source,/const guardedPage=guardedPost \|\| guardedTL \|\| guardedSearch \|\| guardedLikes/);
});
test('For You tab hiding is independent of the video guard',()=>{
  const yes=buildCss(active),no=buildCss({...active,hideForYou:false});
  const rule='html.xsf-guarded-ui [data-testid="primaryColumn"] nav[role="navigation"] [role="tablist"] > div:first-child';
  assert.ok(yes.includes(rule));
  assert.ok(!no.includes(rule));
});
test('all disabled produces no CSS guarded-hide actions',()=>{
  const css=buildCss({...active,enabled:false});
  assert.doesNotMatch(css,/html.xsf-guarded-ui/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../Pixiv_Bookmark_Sort.user.js',import.meta.url),'utf8');
const metadata=readFileSync(new URL('../Pixiv_Bookmark_Sort.meta.js',import.meta.url),'utf8');
const begin=source.indexOf('let bookmarkViewerOpenPending=false;');
const end=source.indexOf('function stats(',begin);
assert.ok(begin>0&&end>begin);
const bridgeSource=source.slice(begin,end);

function bridge({hasViewer=true,atKey='research-key',isOpen=true,throwOnOpen=false}={}){
  const state={opened:0,errors:[],events:new Map(),pending:[]};
  let searchKey=atKey;
  const root={
    querySelector: selector=>selector==='.open-results'
      ? {addEventListener:(event,fn)=>state.events.set(event,fn)} : null
  };
  if(hasViewer) root.__pixivOpenBookmarkResults=()=>{
    if(throwOnOpen)throw Error('viewer failure');
    state.opened++;
    return true;
  };
  const message=text=>state.errors.push(text);
  const setTimeout=(fn,ms)=>{state.pending.push({fn,ms});return state.pending.length};
  const veil={classList:{contains:name=>name==='open'&&isOpen}};
  const fun=new Function('root','message','setTimeout','veil','getSearchKey',
    'const searchKey=getSearchKey();'+bridgeSource+
    '\nreturn {showSavedBookmarkResults,showSavedBookmarkResultsAfterScan};'
  )(root,message,setTimeout,veil,()=>searchKey);
  return {root,state,fun,setKey:value=>{searchKey=value}};
}

test('v0.6.48 metadata and script are consistent',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+0\.6\.48/);
  assert.match(metadata,/@version\s+0\.6\.48/);
});
test('mobile research panel retains a scrollable header and a visible result grid',()=>{
  assert.match(source,/\.head\{flex:0 1 auto;max-height:min\(49dvh,380px\);overflow-y:auto/);
  assert.match(source,/\.results\{flex:1;overflow:auto;min-height:32dvh/);
  assert.match(source,/\.heading\{justify-content:space-between;position:sticky/);
  assert.match(source,/class="open-results" type="button">📚 結果一覧を開く/);
});
test('result button calls the real viewer opener, without proxying through another button',()=>{
  const {state}=bridge();
  assert.ok(state.events.has('click'));
  state.events.get('click')();
  assert.equal(state.opened,1);
  assert.equal(state.errors.length,0);
  assert.doesNotMatch(bridgeSource,/querySelector\('\.pbs-new-button'\)/);
});
test('viewer that attaches after a click opens the pending results immediately',()=>{
  const {root,state}=bridge({hasViewer:false});
  state.events.get('click')();
  assert.equal(state.opened,0);
  assert.match(state.errors[0],/保存済みの調査結果はそのまま/);
  root.__pixivOpenBookmarkResults=()=>{state.opened++;return true;};
  root.__pixivOnBookmarkViewerReady();
  assert.equal(state.opened,1);
  root.__pixivOnBookmarkViewerReady();
  assert.equal(state.opened,1);
});
test('viewer failure is reported instead of silently ignoring the click',()=>{
  const {state}=bridge({throwOnOpen:true});
  state.events.get('click')();
  assert.match(state.errors[0],/viewer failure/);
});
test('after research completes the detailed results are opened automatically',()=>{
  const {state,fun}=bridge();
  fun.showSavedBookmarkResultsAfterScan('research-key');
  assert.equal(state.pending.length,1);
  state.pending[0].fn();
  assert.equal(state.opened,1);
  assert.match(source,/if\(m\.searchDone\)\{[^}]*showSavedBookmarkResultsAfterScan\(c\.key\)/);
});
test('different research key or closed panel do not auto-open results',()=>{
  const one=bridge();
  one.fun.showSavedBookmarkResultsAfterScan('other-key');
  one.state.pending[0].fn();
  assert.equal(one.state.opened,0);
  const two=bridge({isOpen:false});
  two.fun.showSavedBookmarkResultsAfterScan('research-key');
  two.state.pending[0].fn();
  assert.equal(two.state.opened,0);
});
test('same direct full-screen viewer is registered for both result buttons',()=>{
  assert.match(source,/openButton\.addEventListener\('click', openResultsViewer\)/);
  assert.match(source,/root\.__pixivOpenBookmarkResults = openResultsViewer/);
  assert.match(source,/root\.__pixivOnBookmarkViewerReady\?\.\(\)/);
  assert.match(source,/overlay\.classList\.add\('pbs-open'\)/);
  assert.match(source,/\.pbs-new-overlay\.pbs-open\{display:block!important\}/);
});
test('page cap offers saved results rather than hiding them',()=>{
  assert.match(source,/if\(m\.nextPage>MAX\)\{[^}]*showSavedBookmarkResultsAfterScan\(c\.key\)/);
});
test('original research storage and filtering are unchanged',()=>{
  assert.match(source,/const DB='pixiv-bookmark-sort-cross-page-v02'/);
  assert.match(source,/const RESEARCH_DB = 'pixiv-bookmark-sort-cross-page-v02'/);
  assert.match(source,/const EXTRA_DB = 'pixiv-bookmark-sort-extras-v01'/);
  assert.match(source,/function topRows\(key, minimum, sort, from, to, max = MAX_VIEW\)/);
  assert.match(source,/function pixivNativeConvertNovel\(novel\)/);
});

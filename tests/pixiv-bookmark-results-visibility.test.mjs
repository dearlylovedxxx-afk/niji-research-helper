import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../Pixiv_Bookmark_Sort.user.js',import.meta.url),'utf8');
const metadata=readFileSync(new URL('../Pixiv_Bookmark_Sort.meta.js',import.meta.url),'utf8');
const begin=source.indexOf('function showSavedBookmarkResults(){');
const end=source.indexOf('function stats(',begin);
assert.ok(begin>0&&end>begin);
const bridgeSource=source.slice(begin,end);
const bridge=({hasViewer=true,open=true,atKey='research-key'}={})=>{
  const state={clicked:0,errors:[],scrolled:0,events:new Map(),pending:[]};
  const button=hasViewer?{click:()=>state.clicked++}:null;
  const root={querySelector:selector=>selector==='.pbs-new-button'?button:
    selector==='.open-results'?{addEventListener:(event,fn)=>state.events.set(event,fn)}:null};
  const message=text=>state.errors.push(text);
  const items={scrollIntoView:()=>state.scrolled++};
  const setTimeout=(fn,ms)=>{state.pending.push({fn,ms});return state.pending.length};
  let searchKey=atKey;
  const veil={classList:{contains:name=>name==='open'&&open}};
  const fun=new Function('root','message','items','setTimeout','veil','getSearchKey',
    'const searchKey=getSearchKey();'+bridgeSource+
    '\nreturn {showSavedBookmarkResults,showSavedBookmarkResultsAfterScan};'
  )(root,message,items,setTimeout,veil,()=>searchKey);
  return {state,fun,setKey:value=>{searchKey=value}};
};

test('v0.6.47 metadata and script are consistent',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+0\.6\.47/);
  assert.match(metadata,/@version\s+0\.6\.47/);
});
test('mobile research panel retains a scrollable header and a visible result grid',()=>{
  assert.match(source,/\.head\{flex:0 1 auto;max-height:min\(49dvh,380px\);overflow-y:auto/);
  assert.match(source,/\.results\{flex:1;overflow:auto;min-height:32dvh/);
  assert.match(source,/\.heading\{justify-content:space-between;position:sticky/);
  assert.match(source,/class="open-results" type="button">📚 結果一覧を開く/);
});
test('direct result button opens the saved ranking overlay',()=>{
  const {state}=bridge();
  assert.ok(state.events.has('click'));
  state.events.get('click')();
  assert.equal(state.clicked,1);
});
test('if viewer is not attached, original results stay available',()=>{
  const {state}=bridge({hasViewer:false});
  state.events.get('click')();
  assert.equal(state.clicked,0);
  assert.equal(state.scrolled,1);
  assert.match(state.errors[0],/保存データはそのまま/);
});
test('after research completes the results are opened automatically',()=>{
  const {state,fun}=bridge();
  fun.showSavedBookmarkResultsAfterScan('research-key');
  assert.equal(state.pending.length,1);
  state.pending[0].fn();
  assert.equal(state.clicked,1);
  assert.match(source,/if\(m\.searchDone\)\{[^}]*showSavedBookmarkResultsAfterScan\(c\.key\)/);
});
test('no automatic overlay when a different search context is selected',()=>{
  const {state,fun}=bridge();
  fun.showSavedBookmarkResultsAfterScan('other-key');
  state.pending[0].fn();
  assert.equal(state.clicked,0);
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

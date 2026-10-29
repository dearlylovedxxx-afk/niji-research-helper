import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../X_Search_Favorites.user.js',import.meta.url),'utf8');
const cssStart=src.indexOf('    @media (min-width:1320px) {');
const cssEnd=src.indexOf('    html.xsf-guard-wide main[role="main"] > div {',cssStart);
assert.ok(cssStart>0 && cssEnd>cssStart);
const navRule=src.slice(cssStart,cssEnd);

test('XSF 1.3.12 has valid JavaScript and a scoped home/list nav rule',()=>{
  assert.doesNotThrow(()=>new Function(src));
  assert.match(src,/@version\s+1\.3\.12/);
  assert.match(navRule,/html\.xsf-guard-wide\.xsf-guard-tl header\[role="banner"\]/);
  assert.match(navRule,/margin-inline-start:max\(0px,calc\(\(100vw - 1320px\)\/2\)\)!important/);
});
test('center correction reduces the old left nav margin only on wide desktops',()=>{
  const width=1648;
  const oldMargin=Math.max(0,(width-1230)/2);
  const newMargin=Math.max(0,(width-1320)/2);
  assert.equal(oldMargin,209);
  assert.equal(newMargin,164);
  assert.equal(oldMargin-newMargin,45);
  assert.match(navRule,/@media \(min-width:1320px\)/);
  assert.doesNotMatch(navRule,/\btransform:|\btranslate:|\bvideo\b|\[data-testid="primaryColumn"\]/);
});
test('home video guard and unrelated search/post safety still exist',()=>{
  assert.match(src,/root\.classList\.toggle\('xsf-guard-tl',guardedTL && opts\.wideTimeline!==false\)/);
  assert.match(src,/root\.classList\.toggle\('xsf-guard-search',guardedSearch && opts\.wideTimeline!==false\)/);
  assert.match(src,/const guarded=guardedPost \|\| guardedTL \|\| guardedSearch/);
  assert.match(src,/window\.__xsfQuoteShortcutCleanup/);
  assert.match(src,/KEY='xsf_userscript_v1'/);
});

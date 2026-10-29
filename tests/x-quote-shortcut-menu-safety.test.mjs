import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../X_Search_Favorites.user.js',import.meta.url),'utf8');
const from=source.indexOf('  function quoteShortcutPosition(');
const to=source.indexOf('  function update(){',from);
assert.ok(from>0&&to>from);
const position=new Function(source.slice(from,to)+'\nreturn quoteShortcutPosition;')();

test('X Search Favorites v1.3.11 parses',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+1\.3\.11/);
  assert.match(source,/const VERSION='1\.3\.11'/);
});
test('screenshot-sized post shows quote shortcut beside the page title, not the More menu',()=>{
  const column={left:620,right:1320,top:51,width:700};
  const q=position(column,1648);
  assert.deepEqual(q,{x:785,y:60});
  assert.ok(q.x+113<1250); // Native post menu near column's far right.
  assert.ok(q.y+31<100); // Native post actions below the page heading.
  assert.match(source,/const placement=quoteShortcutPosition\(rect,innerWidth\)/);
});
test('quote shortcut stays visible on common narrow post layouts',()=>{
  const q=position({left:0,right:390,top:0,width:390},390);
  assert.ok(q);
  assert.ok(q.x+113<=390-12);
  assert.ok(q.y>=54);
});
test('extremely narrow post leaves native controls usable',()=>{
  assert.equal(position({left:0,right:270,top:0,width:270},390),null);
  assert.match(source,/if\(!placement\)\{\s*host\.remove\(\);return;/);
});
test('quote positioning does not rely on native caret or media DOM state',()=>{
  const block=source.slice(from,to);
  assert.doesNotMatch(block,/menuRect|querySelector|media|video/);
  const call=source.slice(to,source.indexOf('  update();',to));
  assert.doesNotMatch(call,/data-testid="caret"/);
  assert.match(call,/primary\.getBoundingClientRect\(\)/);
});
test('native quote route, saved data, post protection remain unchanged',()=>{
  assert.match(source,/new URL\('\/'\+match\[1\]\+'\/status\/'\+match\[2\]\+'\/quotes'/);
  assert.match(source,/window\.__xsfQuoteShortcutCleanup/);
  assert.match(source,/KEY='xsf_userscript_v1'/);
  assert.match(source,/const guarded=guardedPost \|\| guardedTL \|\| guardedSearch/);
});

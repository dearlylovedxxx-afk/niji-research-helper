import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../X_Search_Favorites.user.js',import.meta.url),'utf8');
const from=source.indexOf('  function quoteShortcutPosition(');
const to=source.indexOf('  function update(){',from);
assert.ok(from>0&&to>from);
const position=new Function(source.slice(from,to)+'\nreturn quoteShortcutPosition;')();

test('X Search Favorites v1.3.10 parses',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+1\.3\.9/);
  assert.match(source,/const VERSION='1\.3\.9'/);
});
test('native post More remains clickable next to quote shortcut',()=>{
  const caret={left:575,top:32,width:30,height:30};
  const q=position({left:20,right:620,top:25,width:600},caret,640);
  assert.ok(q);
  assert.ok(q.x+113+10<=caret.left);
  assert.ok(q.y>=51);
  assert.match(source,/article\[data-testid="tweet"\] \[data-testid="caret"\]/);
});
test('native More has reserved space even when the caret is not in DOM yet',()=>{
  const column={left:20,right:620,top:25,width:600};
  const q=position(column,null,640);
  assert.ok(q);
  assert.ok(q.x+113<=column.right-56);
});
test('on mobile and narrow columns prioritize native block/report menu',()=>{
  assert.equal(position({left:2,right:390,top:10,width:388},
    {left:350,top:10,width:30,height:30},390),null);
  assert.equal(position({left:20,right:620,top:10,width:600},
    {left:290,top:10,width:30,height:30},640),null);
  assert.match(source,/if\(!placement\)\{\s*host\.remove\(\);return;/);
});
test('quote shortcut still navigates to the native quotes route without altering media',()=>{
  assert.match(source,/new URL\('\/'\+match\[1\]\+'\/status\/'\+match\[2\]\+'\/quotes'/);
  assert.match(source,/lastHref='';/);
  assert.match(source,/window\.__xsfQuoteShortcutCleanup/);
  assert.doesNotMatch(source.slice(from,to),/video|removeChild|replaceChildren/);
});

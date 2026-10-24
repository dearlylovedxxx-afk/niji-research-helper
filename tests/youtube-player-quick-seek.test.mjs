import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');

test('Quick Seek script parses and both metadata versions match',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script, /@version\s+1\.0\.120/);
  assert.match(meta, /@version\s+1\.0\.120/);
});

test('two seek buttons are created once and attached to the player',()=>{
  assert.match(script, /for \(const delta of \[-10, 10\]\)/);
  assert.match(script, /controls\.appendChild\(button\)/);
  assert.match(script, /host\.appendChild\(controls\)/);
  assert.match(script, /existing\?\.parentElement === host && youtubeQuickSeekUi\.host === host/);
  assert.match(script, /seekYoutube\(delta\)/);
});

test('player gestures are not triggered by clicking seek buttons',()=>{
  assert.match(script, /event\.stopImmediatePropagation\(\)/);
  assert.match(script, /event\.preventDefault\(\)/);
  assert.match(script, /'pointerdown','pointerup','mousedown','mouseup','dblclick'/);
});

test('buttons are positioned safely on real YouTube players and SPA navigation',()=>{
  assert.match(script, /location\.pathname === '\/watch'/);
  assert.match(script, /host\.classList\.contains\('html5-video-player'\)/);
  assert.match(script, /syncYoutubeQuickSeekButtons\(\)/);
  assert.match(script, /'bottom:' \+ \(mobile \? '54px' : '62px'\)/);
});

test('seek buttons start hidden and appear only near the lower player',()=>{
  assert.match(script,/YT_QUICK_SEEK_HIDE_DELAY = 3000/);
  assert.match(script,/Math\.min\(145, rect\.height \* 0\.30\)/);
  assert.match(script,/document\.addEventListener\('pointermove', ui\.onPointerMove, true\)/);
  assert.match(script,/setYoutubeQuickSeekVisible\(false\)/);
  assert.match(script,/showYoutubeQuickSeekTemporarily\(\)/);
});

test('hover protection and navigation cleanup are present',()=>{
  assert.match(script,/youtubeQuickSeekUi\.pointerOverButton = true/);
  assert.match(script,/clearTimeout\(youtubeQuickSeekUi\.hideTimer\)/);
  assert.match(script,/document\.removeEventListener\('pointermove', ui\.onPointerMove, true\)/);
  assert.match(script,/detachYoutubeQuickSeek\(\)/);
});

test('capture mouse movement above YouTube native controls instead of player host only',()=>{
  assert.match(script,/document\.addEventListener\('pointermove', ui\.onPointerMove, true\)/);
  assert.match(script,/document\.addEventListener\('mousemove', ui\.onPointerMove, true\)/);
  assert.match(script,/document\.removeEventListener\('pointermove', ui\.onPointerMove, true\)/);
  assert.match(script,/document\.removeEventListener\('mousemove', ui\.onPointerMove, true\)/);
  assert.match(script,/youtubeQuickSeekNearBar\(host, event\)/);
});

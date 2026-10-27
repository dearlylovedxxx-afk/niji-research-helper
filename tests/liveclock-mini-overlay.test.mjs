import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');

test('v1.0.124 integrates a compact video player hover overlay',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/@version\s+1\.0\.124/);
  assert.match(meta,/@version\s+1\.0\.124/);
  assert.match(script,/root\.id='npf-liveclock-mini'/);
  assert.match(script,/width:205px!important/);
  assert.match(script,/youtubeLiveClockMiniNear\(event,host\)/);
  assert.match(script,/document\.addEventListener\('pointermove',m\.onMove,true\)/);
  assert.match(script,/document\.addEventListener\('mousemove',m\.onMove,true\)/);
  assert.match(script,/youtubeLiveClockMiniShow\(near\)/);
  assert.match(script,/document\.removeEventListener\('pointermove',m\.onMove,true\)/);
  assert.match(script,/document\.removeEventListener\('mouseleave',m\.onBlur,true\)/);
});

test('power and cycle buttons reuse the existing real-time BroadcastChannel engine',()=>{
  assert.match(script,/npf-liveclock-mini-power/);
  assert.match(script,/npf-liveclock-mini-sync/);
  assert.match(script,/youtubeLiveClockMarkToggle\(\)/);
  assert.match(script,/youtubeLiveClockSyncFromThisTab\(\)/);
  assert.match(script,/new BroadcastChannel\('niji-research-helper-liveclock-v1'\)/);
  assert.match(script,/const wallMs = clock\.startMs \+ video\.currentTime \* 1000/);
  assert.match(script,/const target = \(wallMs \+ elapsedMs - clock\.startMs\) \/ 1000/);
  assert.match(script,/date\.toLocaleTimeString\('ja-JP'/);
});

test('one-to-sixty-second manual calibration adjusts only this archive',()=>{
  assert.match(script,/step\.min='1';step\.max='60'/);
  assert.match(script,/m\.step=Number\.isFinite\(v\)\?Math\.min\(60,Math\.max\(1,v\)\):1/);
  assert.match(script,/seekYoutube\(sign\*youtubeLiveClockMini\.step\)/);
  assert.match(script,/nrh-liveclock-manual-seek/);
  assert.match(script,/sync\.disabled=!youtubeLiveClockTabs\.channel\|\|!marked\|\|!readyVideo\|\|!clockReady/);
});

test('lifecycle remounts only on watch pages without a duplicate widget',()=>{
  assert.match(script,/location\.pathname==='\/watch'/);
  assert.match(script,/m\.root\?\.isConnected&&m\.host===host&&m\.videoId===id/);
  assert.match(script,/youtubeLiveClockMiniDetach\(\)/);
  assert.equal((script.match(/ensureYoutubeLiveClockMini\(\);/g)||[]).length,3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script = readFileSync(new URL('../Niji_Research_Helper.user.js', import.meta.url), 'utf8');
const meta = readFileSync(new URL('../Niji_Research_Helper.meta.js', import.meta.url), 'utf8');
const between = (start, end) => {
  const a = script.indexOf(start);
  const b = script.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing priority overlay code: ' + start);
  return script.slice(a, b);
};
const sizing = between('  function youtubePriorityOverlayHeightBounds(', '  async function loadYoutubePriorityOverlayUi() {');
const model = new Function('youtubeTimestampPlayerHost', 'window', 'document',
  sizing + '\nreturn {bounds:youtubePriorityOverlayHeightBounds,clamp:clampYoutubePriorityOverlayHeight};');
const host = h => ({getBoundingClientRect:() => ({height:h, width:640})});
const api = model(() => host(500), {innerHeight:800}, {documentElement:{clientHeight:800}});

test('current userscript and metadata advertise the new height-resize version', () => {
  assert.match(script, /\/\/ @version\s+1\.0\.136/);
  assert.match(meta, /\/\/ @version\s+1\.0\.136/);
  assert.doesNotThrow(() => new Function(script));
});

test('height changes are limited to a usable fraction of the player', () => {
  assert.deepEqual(api.bounds(host(500)), {min:90, max:450});
  assert.equal(api.clamp(30, host(500)), 90);
  assert.equal(api.clamp(220, host(500)), 220);
  assert.equal(api.clamp(9999, host(500)), 450);
  assert.equal(api.clamp(9999, host(200)), 180);
});

test('height is optional for old width-only settings and persists after a drag', () => {
  const ui = between('  const youtubePriorityOverlayUi = {','  function youtubePriorityOverlayWidthBounds(');
  const load = between('  async function loadYoutubePriorityOverlayUi() {', '  function youtubePriorityCommentFingerprint(');
  const style = between('  function styleYoutubePriorityOverlay(root) {', '  function updateYoutubePriorityOverlayActive() {');
  const ensure = between('  function ensureYoutubePriorityOverlay(force = false) {', '  function showYoutubePriorityDiagnostic() {');
  assert.match(ui, /height: null/);
  assert.match(load, /saved\.height != null/);
  assert.match(load, /height: youtubePriorityOverlayUi\.height == null \? null/);
  assert.match(style, /resizedHeight == null \? 'auto' : resizedHeight \+ 'px'/);
  assert.match(style, /mobile \? 0\.58 : 0\.72/);
  assert.match(ensure, /heightResize\.addEventListener\('pointermove'/);
  assert.match(ensure, /heightResize\.addEventListener\('pointerup'/);
  assert.match(ensure, /saveYoutubePriorityOverlaySize\(\)/);
  assert.match(ensure, /'min-height:0','flex:1 1 auto'/);
});

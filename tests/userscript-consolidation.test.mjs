import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = name => readFileSync(resolve(root, name), 'utf8');

test('all merged userscripts keep valid JavaScript syntax', () => {
  for (const name of [
    'X_Search_Favorites.user.js',
    'N3_YouTube_Speed_Dial.user.js',
    'Niji_Research_Helper.user.js',
    'YouTube_Member_Chat_Search.user.js'
  ]) {
    assert.doesNotThrow(() => new Function(file(name)), name);
  }
});

test('native X search remains native and bundled with X Search Favorites', () => {
  const script = file('X_Search_Favorites.user.js');
  assert.match(script, /@version\s+1\.3\.11/);
  assert.match(script, /cpft-native-only-search-css/);
  assert.match(script, /SearchBox_Search_Input/);
  assert.match(script, /cpft-native-search-on/);
  assert.match(script, /window\.__xsfUserscriptCleanup/);
  assert.match(script, /const VERSION='1\.3\.11'/);
});

test('N3 retains F13-F14 video dial and limits NicoLive comments module to its watch pages', () => {
  const script = file('N3_YouTube_Speed_Dial.user.js');
  assert.match(script, /@match\s+\*:\/\/\*\/\*/);
  assert.match(script, /F13/);
  assert.match(script, /F14/);
  assert.match(script, /location\.hostname !== 'live\.nicovideo\.jp'/);
  assert.match(script, /nlc-comments-toggle/);
  assert.match(script, /ArrowLeft/);
});

test('LiveClock is one-shot, tab-scoped and available from Niji Research Helper', () => {
  const script = file('Niji_Research_Helper.user.js');
  const meta = file('Niji_Research_Helper.meta.js');
  assert.match(script, /@version\s+1\.0\.124/);
  assert.match(meta, /@version\s+1\.0\.124/);
  assert.match(script, /new BroadcastChannel\('niji-research-helper-liveclock-v1'\)/);
  assert.match(script, /youtubeLiveClockReceiveSync\(message\)/);
  assert.match(script, /youtubeLiveClockMarkToggle\(\)/);
  assert.match(script, /npf-liveclock-sync/);
  assert.match(script, /video\.currentTime = target/);
  assert.match(script, /target < 0 \|\| target > video\.duration/);
});

test('manual LiveClock seeks cancel the older member-chat URL timestamp guard', () => {
  const chat = file('YouTube_Member_Chat_Search.user.js');
  assert.match(chat, /@version\s+0\.5\.8/);
  assert.match(chat, /nrh-liveclock-manual-seek/);
  assert.match(chat, /state\.timestampGuardSerial\+\+/);
});

test('LiveClock controls are accessible from their own NIJI Sync tab rather than buried in POV', () => {
  const script = file('Niji_Research_Helper.user.js');
  assert.match(script, /\['sync', '🕒 同期'\]/);
  assert.match(script, /id:'npf-yt-liveclock-body'/);
  assert.match(script, /mobileYoutubeTab === 'sync' \? 'block' : 'none'/);
  assert.match(script, /mobileYoutubeTab = \['pov','sync','research','settings'\]/);
  assert.match(script, /id: 'npf-liveclock-mark'/);
  assert.match(script, /id: 'npf-liveclock-sync'/);
  assert.equal((script.match(/id: 'npf-liveclock-mark'/g) || []).length, 1);
  assert.equal((script.match(/id: 'npf-liveclock-sync'/g) || []).length, 1);
});

from pathlib import Path

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')

def replace(old, new):
    global s
    count = s.count(old)
    if count != 1:
        raise AssertionError(f'Expected exactly one anchor, found {count}: {old[:110]!r}')
    s = s.replace(old, new, 1)

replace('// @version      1.0.29', '// @version      1.0.30')
replace("const VERSION = '1.0.29';", "const VERSION = '1.0.30';")
replace("  const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';", "  const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';\n  const KEY_AUTO_CHANNELS = 'npf_auto_research_channels_v1'; // opt-in, local to this userscript")
replace('    calibration: {},\n    wikiCache: {},\n  };', '    calibration: {},\n    wikiCache: {},\n    autoChannels: [],\n  };')
replace('[KEY_FAVS, KEY_LIVER_FAVS, KEY_SETTINGS, KEY_SYNC, KEY_CAL].includes(key)', '[KEY_FAVS, KEY_LIVER_FAVS, KEY_SETTINGS, KEY_SYNC, KEY_CAL, KEY_AUTO_CHANNELS].includes(key)')

# Channel settings are local opt-in: they deliberately do not get imported from
# cloud backups, which could otherwise enable API traffic on another device.
replace('    collectionActive: false,\n    collectionRoute:', "    collectionActive: false,\n    autoSuppressedRoute: '', // explicit manual stop wins for the current visit\n    collectionRoute:")
replace("  function splitResearchWords(raw = '') {", '''  // Only actual channel archive tabs qualify; never auto-fetch search results,
  // the home page or video watch pages. Use stable path identities, not names.
  function researchChannelKey(path = location.pathname) {
    let p = String(path || '');
    try { p = decodeURIComponent(p); } catch {}
    const parts = p.split('/').filter(Boolean);
    if (parts.length === 2 && /^@[^/]+$/.test(parts[0]) && /^(videos|streams)$/i.test(parts[1]))
      return parts[0].toLowerCase();
    if (parts.length === 3 && /^(channel|c|user)$/i.test(parts[0])
        && /^(videos|streams)$/i.test(parts[2]))
      return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
    return '';
  }

  function researchAutoEnabledHere() {
    const key = researchChannelKey();
    return !!key && Array.isArray(state.autoChannels) && state.autoChannels.includes(key);
  }

  function splitResearchWords(raw = '') {''')

replace("  function updateResearchCollectionControls() {\n    const button = $('#npf-r-collection-toggle');", '''  function updateResearchCollectionControls() {
    const autoButton = $('#npf-r-channel-auto');
    const autoHint = $('#npf-r-channel-auto-hint');
    const channelKey = researchChannelKey();
    const auto = researchAutoEnabledHere();
    if (autoButton) {
      autoButton.hidden = !channelKey;
      autoButton.textContent = auto ? '✅ このチャンネルの自動取得：ON' : '☐ このチャンネルの自動取得：OFF';
      autoButton.setAttribute('aria-pressed', String(auto));
      autoButton.style.setProperty('background', auto ? '#365c4b' : '#303b53', 'important');
      autoButton.style.setProperty('color', '#fff', 'important');
    }
    if (autoHint) {
      autoHint.hidden = !channelKey;
      autoHint.textContent = auto
        ? 'このチャンネルの動画・ライブ一覧を開いた時だけ未取得分を自動調査します。429停止中は自動再試行しません。手動で停止したページでは再開しません。'
        : 'OFFのチャンネルは従来どおり手動開始。検索結果や他チャンネルには適用しません。';
    }
    const button = $('#npf-r-collection-toggle');''')
replace('  function stopResearchCollection() {\n    research.collectionActive = false;', '''  function stopResearchCollection(manual = false) {
    if (manual) research.autoSuppressedRoute = research.collectionRoute;
    research.collectionActive = false;''')
replace("      if (research.collectionActive) stopResearchCollection();\n      else startResearchCollection();", "      if (research.collectionActive) stopResearchCollection(true);\n      else { research.autoSuppressedRoute = ''; startResearchCollection(); }")
replace('    body.append(collectionButton, collectionHint);', '''    const autoButton = document.createElement('button');
    autoButton.id = 'npf-r-channel-auto'; autoButton.type = 'button';
    autoButton.className = 'npf-r-btn';
    autoButton.style.cssText = 'display:block;width:100%;margin:8px 0 4px;padding:10px;font-weight:700;';
    autoButton.addEventListener('click', async () => {
      const key = researchChannelKey();
      if (!key) return;
      const next = !researchAutoEnabledHere();
      if (next && !(await ensureYoutubeApiKey())) return;
      const values = new Set(state.autoChannels);
      if (next) values.add(key); else values.delete(key);
      state.autoChannels = [...values];
      await gmSet(KEY_AUTO_CHANNELS, state.autoChannels);
      if (next) {
        research.autoSuppressedRoute = '';
        startResearchCollection();
      } else if (research.collectionActive) {
        stopResearchCollection();
      }
      updateResearchCollectionControls();
    });
    const autoHint = document.createElement('div');
    autoHint.id = 'npf-r-channel-auto-hint';
    autoHint.className = 'npf-r-note';
    autoHint.style.marginBottom = '10px';
    body.append(autoButton, autoHint, collectionButton, collectionHint);''')
replace("    if (research.collectionRoute && research.collectionRoute !== route) stopResearchCollection();\n    research.collectionRoute = route;", "    if (research.collectionRoute && research.collectionRoute !== route) {\n      stopResearchCollection();\n      research.autoSuppressedRoute = '';\n    }\n    research.collectionRoute = route;")
replace('    if (active) scheduleResearchScan(250);\n  }\n\n  function startYoutubeResearch()', '''    if (active) {
      scheduleResearchScan(250);
      if (!research.collectionActive && researchAutoEnabledHere() && state.apiKey
          && research.autoSuppressedRoute !== route) startResearchCollection();
    }
    updateResearchCollectionControls();
  }

  function startYoutubeResearch()''')
replace("  state.wikiCache = await gmGet(KEY_WIKI_CACHE, {});", "  state.wikiCache = await gmGet(KEY_WIKI_CACHE, {});\n  state.autoChannels = await gmGet(KEY_AUTO_CHANNELS, []);")
replace("  if (!Array.isArray(state.liverFavorites)) state.liverFavorites = [];", "  if (!Array.isArray(state.liverFavorites)) state.liverFavorites = [];\n  if (!Array.isArray(state.autoChannels)) state.autoChannels = [];\n  state.autoChannels = [...new Set(state.autoChannels.filter(x => typeof x === 'string' && /^(@[^/]+|(?:channel|c|user)\\/[^/]+)$/i.test(x)))];")
replace("      if (isMobileYoutubeUi()) { void updateResearchDbStatus(); updateResearchStatus(); }", "      if (isMobileYoutubeUi()) {\n        void updateResearchDbStatus(); updateResearchStatus();\n        handleResearchNavigation(); // re-evaluate opt-in after async GM settings load\n      }")

# POV lookup is on demand and independent of the archive collection/DB.
replace('  // ---------- POV search ----------\n  async function fetchCandidates(source) {', '''  // ---------- POV search ----------
  function povGameKey(video) {
    const game = researchGameFromText(video?.title || '', video?.topic_id || '');
    const key = String(game || '').normalize('NFKC').toLowerCase().replace(/[\\s_\\-]+/g, '');
    return /^(game|gaming|other|unknown|talking|music|none|雑談)$/.test(key) ? '' : key;
  }

  async function fetchCandidates(source, syncOffset = null) {''')
a = s.index('  async function fetchCandidates(source, syncOffset = null) {')
b = s.index('\n  function buildMatches(source, videos, syncOffset = null) {', a)
s = s[:a] + '''  async function fetchCandidates(source, syncOffset = null) {
    const ss = startOf(source), se = endOf(source);
    if (!ss || !se) throw new Error('元アーカイブの開始・終了時刻をHolodexから取得できませんでした');
    // A POV search explicitly fetches live Holodex data. It never depends on
    // the archive collection button or on IndexedDB having been populated.
    const hasSync = syncOffset != null && Number.isFinite(Number(syncOffset));
    const moment = hasSync ? new Date(ss.getTime() + Number(syncOffset) * 1000) : null;
    const h = Math.min(24, Math.max(4, Number(state.settings.searchWindowHours) || 24));
    const from = new Date((moment || ss).getTime() - Math.min(h, 16) * 3600000);
    const to = new Date(moment ? moment.getTime() + 30 * 60000 : se.getTime() + 3600000);
    const topic = String(source?.topic_id || '').trim();
    const searchModes = [];
    if (topic && povGameKey(source)) searchModes.push({ topic, pageLimit: 10 }); // all orgs
    searchModes.push({ org: 'Nijisanji', pageLimit: 8 });
    const primaryId = channelId(source);
    if (primaryId) searchModes.push({ mentioned_channel_id: primaryId, pageLimit: 3 });
    const recent = se.getTime() >= Date.now() - 6 * 3600000;
    const statuses = recent ? ['past', 'live'] : ['past'];
    const seen = new Set();
    const all = [];
    let warning = '';
    for (const status of statuses) {
      for (const mode of searchModes) {
        for (let page = 0; page < mode.pageLimit; page++) {
          const q = new URLSearchParams({
            type: 'stream', status, include: 'live_info,mentions',
            sort: 'available_at', order: 'desc', limit: '50',
            offset: String(page * 50), from: from.toISOString(), to: to.toISOString(),
          });
          if (mode.topic) q.set('topic', mode.topic);
          if (mode.org) q.set('org', mode.org);
          if (mode.mentioned_channel_id) q.set('mentioned_channel_id', mode.mentioned_channel_id);
          let arr;
          try { arr = await apiGet(`/videos?${q.toString()}`); }
          catch (err) {
            if (/429|rate limit/i.test(String(err?.message || err))) {
              warning = 'Holodexの429制限で候補取得を途中停止しました。結果は一部の可能性があります。';
              all.warning = warning;
              return all;
            }
            if (!all.length) throw err;
            warning = '一部の候補取得に失敗しました。結果は不完全な可能性があります。';
            break;
          }
          if (!Array.isArray(arr)) break;
          for (const video of arr) {
            if (video?.id && !seen.has(video.id)) { seen.add(video.id); all.push(video); }
          }
          if (arr.length < 50) break;
          if (page === mode.pageLimit - 1) warning = 'Holodexの候補取得上限に達しました。結果は一部の可能性があります。';
        }
      }
    }
    all.warning = warning;
    return all;
  }
''' + s[b:]
replace('    const hasSync = Number.isFinite(Number(syncOffset));\n    const syncSec = hasSync ? Number(syncOffset) : null;', '    const hasSync = syncOffset != null && Number.isFinite(Number(syncOffset));\n    const syncSec = hasSync ? Number(syncOffset) : null;')
replace('    const sourceDuration = Math.max(1, (se - ss) / 1000);\n    const hasSync', '    const sourceDuration = Math.max(1, (se - ss) / 1000);\n    const sourceGameKey = povGameKey(source);\n    const hasSync')
replace('        const relation = relationInfo(source, v, sim, event);', '        const relation = relationInfo(source, v, sim, event);\n        const sameGame = !!sourceGameKey && sourceGameKey === povGameKey(v);')
replace('          related: relation.related,\n          reasons: relation.reasons,', '          related: relation.related,\n          sameGame,\n          reasons: relation.reasons,')
replace('      const candidates = await fetchCandidates(source);\n      const matches = buildMatches(source, candidates, syncOffset);', '      const candidates = await fetchCandidates(source, syncOffset);\n      const matches = buildMatches(source, candidates, syncOffset);\n      matches.warning = candidates.warning || \'\';')
replace('      const candidates = await fetchCandidates(source);\n      const matches = buildMatches(source, candidates, sec);', '      const candidates = await fetchCandidates(source, sec);\n      const matches = buildMatches(source, candidates, sec);\n      matches.warning = candidates.warning || \'\';')
# Leave the unrelated archive research's tournament link logic untouched.
replace('    const others = []; // Never offer unrelated parallel streams as POVs.\n    const hasSync = Number.isFinite(Number(syncOffset));\n    let showOthers = false;', "    const others = matches.filter(m => !m.related && m.sameGame && povGroupPass(m.v, povOrgFilter));\n    const hasSync = syncOffset != null && Number.isFinite(Number(syncOffset));\n    let showOthers = true; // same-game candidates are visible, but never labelled confirmed POVs")
replace('            関連性の高い別視点は見つかりませんでした。<br>', '            参加を確認できた視点も同時刻・同ゲームの候補も見つかりませんでした。<br>')
replace("${showOthers ? `${visible.length}視点` : `関連候補 ${related.length}視点`}", "確認済み ${related.length}視点・同ゲーム未確認 ${showOthers ? others.length : 0}件")
replace("                  ${!m.related ? '<span class=\"npf-badge\">同時刻のみ</span>' : ''}", "                  ${!m.related ? '<span class=\"npf-badge\">同時刻・同ゲーム（共演未確認）</span>' : ''}")
replace('        <div class="npf-results">\n          ${visible.map((m, idx) => `', '''        ${matches.warning ? `<div class="npf-error">${escapeHtml(matches.warning)}</div>` : ''}
        <div class="npf-results">
          ${visible.map((m, idx) => `''')
replace("${showOthers ? '関連候補だけに戻す' : `同時刻のその他 ${others.length}件も表示`}", "${showOthers ? '未確認候補を隠す' : `同時刻・同ゲームの未確認候補 ${others.length}件を表示`}")
replace('    const related = matches.filter(m => m.related && povGroupPass(m.v, povOrgFilter));\n    const others = []; // Hide unrelated overlapping broadcasts completely.', "    const related = matches.filter(m => m.related && povGroupPass(m.v, povOrgFilter));\n    const others = matches.filter(m => !m.related && m.sameGame && povGroupPass(m.v, povOrgFilter));")
replace('    const list = related;\n\n    const summary', '    const list = [...related, ...others].slice(0, 80);\n\n    const summary')
replace("    summary.textContent = related.length\n      ? `関連候補 ${related.length}件${others.length ? ` ／ その他 ${others.length}件` : ''}`\n      : `関連候補なし${others.length ? ` ／ 同時刻のその他 ${others.length}件` : ''}`;", "    summary.textContent = `関連確認済み ${related.length}件 ／ 同時刻・同ゲーム（未確認）${others.length}件`;\n    if (matches.warning) summary.textContent += ` ／ ⚠️ ${matches.warning}`;")
replace("      empty.textContent = others.length\n        ? '関連する別視点は見つかりませんでした。無関係な同時刻配信は下の「その他」から必要な時だけ表示できます。'\n        : `${formatClock(syncOffset)} の瞬間に配信中だった別視点は見つかりませんでした。`;", "      empty.textContent = `${formatClock(syncOffset)} の瞬間に同ゲームの候補は見つかりませんでした。`;" )
replace("      meta.textContent = `対応位置 ${formatClock(correctedCandidateOffset(source, m))}${reasons}`;", "      meta.textContent = `対応位置 ${formatClock(correctedCandidateOffset(source, m))}${m.related ? reasons : '・⚠️ 同時刻・同ゲーム（共演未確認）'}`;")
replace('    if (others.length) {\n      const more = document.createElement(\'button\');', '    if (false && others.length) { // No generic overlapping streams are ever offered.\n      const more = document.createElement(\'button\');')

assert s.count('// @version      1.0.30') == 1
assert s.count("const VERSION = '1.0.30';") == 1
assert 'function researchChannelKey(' in s and 'function povGameKey(' in s
assert 'const others = []; // Hide unrelated overlapping broadcasts completely.' not in s
p.write_text(s, encoding='utf-8')
print('NRH patched to v1.0.30: per-channel opt-in + DB-independent POV same-game candidates')
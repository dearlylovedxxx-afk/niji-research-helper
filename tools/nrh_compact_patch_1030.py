from pathlib import Path
p=Path('Niji_Research_Helper.user.js'); s=p.read_text()
def change(a,b):
 global s
 assert s.count(a)==1,(a[:65],s.count(a))
 s=s.replace(a,b,1)
change('// @version      1.0.29','// @version      1.0.30')
change("const VERSION = '1.0.29';","const VERSION = '1.0.30';")
change("youtubeCopyMode: 'title-url',","youtubeCopyMode: 'title-url',\n    autoResearchChannels: [],")
change("collectionRoute: '',","collectionRoute: '',\n    autoChannelKeys: new Set(),")
change("  function splitResearchWords(raw = '') {","""  function researchChannelKey() {
    const m = String(location.pathname || '').match(/^\\/(@[^/]+|channel\\/[^/]+|c\\/[^/]+|user\\/[^/]+)\\/(?:videos|streams)\\/?$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function splitResearchWords(raw = '') {""")
change("    const hint = $('#npf-r-collection-hint');","""    const auto = $('#npf-r-auto-channel-toggle');
    if (auto) {
      const key = researchChannelKey();
      auto.style.display = key ? 'block' : 'none';
      auto.textContent = research.autoChannelKeys.has(key)
        ? '☑ このチャンネルの自動取得 ON' : '□ このチャンネルの自動取得 OFF';
    }
    const hint = $('#npf-r-collection-hint');""")
change('    body.append(collectionButton, collectionHint);',"""    const auto = document.createElement('button');
    auto.id = 'npf-r-auto-channel-toggle'; auto.type = 'button'; auto.className = 'npf-r-btn';
    auto.style.cssText = 'display:none;width:100%;margin:6px 0;padding:10px;';
    auto.addEventListener('click', async () => {
      const key = researchChannelKey(); if (!key) return;
      if (research.autoChannelKeys.has(key)) research.autoChannelKeys.delete(key);
      else research.autoChannelKeys.add(key);
      state.settings.autoResearchChannels = [...research.autoChannelKeys];
      await gmSet(KEY_SETTINGS, state.settings);
      updateResearchCollectionControls();
      if (research.autoChannelKeys.has(key) && !research.collectionActive && !research.holodexPaused)
        startResearchCollection();
    });
    body.append(collectionButton, auto, collectionHint);""")
change('    if (active) scheduleResearchScan(250);',"""    if (active) {
      scheduleResearchScan(250);
      const key = researchChannelKey();
      if (key && research.autoChannelKeys.has(key) && !research.collectionActive && !research.holodexPaused)
        startResearchCollection();
    }""")
change("  state.settings = { ...DEFAULT_SETTINGS, ...(await gmGet(KEY_SETTINGS, DEFAULT_SETTINGS)) };", """  state.settings = { ...DEFAULT_SETTINGS, ...(await gmGet(KEY_SETTINGS, DEFAULT_SETTINGS)) };
  research.autoChannelKeys = new Set(Array.isArray(state.settings.autoResearchChannels)
    ? state.settings.autoResearchChannels.filter(x => typeof x === 'string') : []);""")
change('      if (isMobileYoutubeUi()) { void updateResearchDbStatus(); updateResearchStatus(); }', '      if (isMobileYoutubeUi()) { void updateResearchDbStatus(); updateResearchStatus(); }\n      handleResearchNavigation(); // Preferences loaded; enable opted-in channel.')
start=s.index('  async function fetchCandidates(source) {'); end=s.index('\n  function buildMatches(source, videos, syncOffset = null) {',start)
s=s[:start]+'''  async function fetchCandidates(source) {
    const ss = startOf(source), se = endOf(source);
    if (!ss || !se || Number.isNaN(+ss) || Number.isNaN(+se))
      throw new Error('元アーカイブの開始・終了時刻を取得できませんでした');
    const h = Number(state.settings.searchWindowHours || 24);
    const searches = [
      {org:'Nijisanji',from:new Date(+ss-h*3600000),to:new Date(+se+h*3600000),max:20},
      // A separate live Holodex request, never requiring the archive DB.
      {topic:String(source.topic_id || '').trim(),from:new Date(+ss-3600000),to:new Date(+se+3600000),max:10},
    ];
    const found = new Map();
    for (const query of searches) {
      for (let offset=0, pages=0; pages<query.max; pages++,offset+=50) {
        const q = new URLSearchParams({type:'stream',status:'past',include:'live_info,mentions',
          sort:'available_at',order:'asc',limit:'50',offset:String(offset),
          from:query.from.toISOString(),to:query.to.toISOString()});
        if (query.org) q.set('org',query.org);
        if (query.topic) q.set('topic',query.topic);
        const arr = await apiGet(`/videos?${q.toString()}`);
        if (!Array.isArray(arr)) break;
        for (const v of arr) if (v?.id) found.set(v.id,v);
        if (arr.length<50) break;
      }
    }
    return [...found.values()];
  }
''' + s[end:]
change('    const hasSync = Number.isFinite(Number(syncOffset));\n    const syncSec = hasSync ? Number(syncOffset) : null;', '    const hasSync = syncOffset != null && Number.isFinite(Number(syncOffset));\n    const syncSec = hasSync ? Number(syncOffset) : null;')
change('          related: relation.related,\n          reasons: relation.reasons,','          related: relation.related,\n          sameGame: relation.sameGame,\n          reasons: relation.reasons,')
change('    const related = !!(gameCompatible && (directMention || wellMatchedEvent || wellMatchedTag));','''    const sameGame = !!(sourceGame && candidateGame && gameCompatible &&
      normalizeResearchText(sourceGame) === normalizeResearchText(candidateGame));
    const related = !!(gameCompatible && (directMention || wellMatchedEvent || wellMatchedTag));''')
change('    return { related, reasons, directMention, tags:specificTags, sameTopic };','    return { related, sameGame, reasons, directMention, tags:specificTags, sameTopic };')
change('    const others = []; // Never offer unrelated parallel streams as POVs.\n    const hasSync = Number.isFinite(Number(syncOffset));\n    let showOthers = false;', '''    const others = matches.filter(m => !m.related && m.sameGame && povGroupPass(m.v,povOrgFilter)).slice(0,40);
    const hasSync = syncOffset != null && Number.isFinite(Number(syncOffset));
    let showOthers = true;''')
change('<span class="npf-badge">同時刻のみ</span>','<span class="npf-badge">同時刻・同ゲーム／参加者未確認</span>')
change('    const others = []; // Hide unrelated overlapping broadcasts completely.\n    // お気に入りは「関連候補の中」でのみ優先する。\n    // 関連判定に入らない同時刻配信は、お気に入りでも自動表示しない。\n    const list = related;', '''    const others = matches.filter(m => !m.related && m.sameGame && povGroupPass(m.v,povOrgFilter)).slice(0,40);
    const list = related;''')
change("    if (!list.length) {\n      const empty", "    if (!list.length && !others.length) {\n      const empty")
change('      meta.textContent = `対応位置 ${formatClock(correctedCandidateOffset(source, m))}${reasons}`;', "      meta.textContent = `対応位置 ${formatClock(correctedCandidateOffset(source, m))}${m.related ? reasons : '・同時刻・同ゲーム／参加者未確認'}`;")
change("      openBtn.textContent = '同じ瞬間を開く';", "      openBtn.textContent = m.related ? '同じ瞬間を開く' : '同じ時刻で開く（未確認）';")
start=s.index("    if (others.length) {\n      const more = document.createElement('button');",s.index('  function renderYoutubeMatches('))
end=s.index('    if (isMobileYoutubeUi()) styleMobileYoutubePanel(',start)
s=s[:start]+'''    if (others.length) {
      const label = document.createElement('div');
      label.className = 'npf-yt-result-summary';
      label.textContent = `🔎 同時刻・同ゲーム／参加者未確認 ${others.length}件（別企画の可能性あり）`;
      area.appendChild(label);
      for (const m of others) {
        const card = drawOne(m);
        card.style.borderStyle = 'dashed';
        area.appendChild(card);
      }
    }
''' +s[end:]
p.write_text(s)
print('PATCH_OK',len(s))
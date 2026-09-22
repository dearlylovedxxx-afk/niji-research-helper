from pathlib import Path

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert '// @version      1.0.41' in s and "const VERSION = '1.0.41';" in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s

def replace(old, new, name):
    global s
    count = s.count(old)
    assert count == 1, f'{name}: expected 1 occurrence, found {count}'
    s = s.replace(old, new, 1)

replace('// @version      1.0.41', '// @version      1.0.42', 'metadata version')
replace("const VERSION = '1.0.41';", "const VERSION = '1.0.42';", 'runtime version')

replace(
    "        const id=parseVideoIdFromUrl(url.href);\n        if(id&&id!==source.id)videoIds.add(id);",
    "        // A /shorts/ URL is a clip, not a live archive.\n        const id=/^\\/(?:shorts|clip)\\//i.test(url.pathname)?null:parseVideoIdFromUrl(url.href);\n        if(id&&id!==source.id)videoIds.add(id);",
    'description Shorts exclusion')

start = s.index('  function povYoutubeVideo(item) {')
end = s.index('\n  function attachPovSupplement(', start)
assert 'povTimeVerified:' in s[start:end] and 'live.actualStartTime' in s[start:end]
s = s[:start] + '''  function povYoutubeVideo(item) {
    const live=item?.liveStreamingDetails||{},snippet=item?.snippet||{};
    // Published date and file duration alone must never turn a Short/clip into a stream.
    const start=live.actualStartTime||'',end=live.actualEndTime||'';
    const dur=povYoutubeDuration(item?.contentDetails?.duration);
    const actualDuration=Date.parse(end)-Date.parse(start);
    const verified=!!(start&&end&&Number.isFinite(actualDuration)&&actualDuration>=600000&&dur>=600);
    return {id:item?.id,title:snippet.title||'',description:snippet.description||'',
      type:verified?'stream':'video',
      channel_id:snippet.channelId||'',channel:{id:snippet.channelId||'',name:snippet.channelTitle||''},
      start_actual:start,end_actual:end,duration:dur,
      available_at:start||snippet.publishedAt||'',topic_id:'',
      povTimeVerified:verified};
  }
''' + s[end:]

replace(
    '  function attachPovSupplement(source,baseline,syncOffset,youtubeMode=false) {',
    '  function attachPovSupplement(source,baseline,syncOffset,youtubeMode=false,holodexVideos=[]) {',
    'supplement signature')
replace(
    "    query.placeholder='YouTubeで探す語（イベント名・ゲーム名など）';query.value=String(source.topic_id||'').slice(0,100);",
    "    query.placeholder='YouTubeで手動検索する語（イベント名・参加者名など）';query.value=String(source.topic_id||'').slice(0,100);",
    'search field label')
replace(
    "    help.textContent='概要欄の動画URL・参加者チャンネルをHolodexで照合。任意のYouTube APIキーを入力すると、未発見のチャンネルとキーワードをYouTubeでも検索します。検索はタップ時のみ・件数制限あり。キーは保存・バックアップしません。Twitchは対象外です。';",
    "    help.textContent='概要欄の動画URL・参加者チャンネルをHolodexで照合。任意のYouTube APIキーがあれば、参加者チャンネルの完了済み配信も照合します。無関係なShortsを避けるため、YouTube全体のキーワード自動検索は行いません（上の手動検索リンクを利用）。日時・配信の長さを確認できた候補のみ表示します。キーは保存しません。Twitchは対象外です。';",
    'help text')
replace(
    "    const known=new Set([source.id,...baseline.map(m=>m.v.id)]),seen=new Map();\n    let manualMatches=[];",
    "    // Include *all* first-pass Holodex video IDs, not just displayed/matched ones.\n    const known=new Set([source.id,...baseline.map(m=>m.v.id),...holodexVideos.map(v=>v.id)]),seen=new Map();\n    let trustedChannelIds=new Set(),rejected=0;\n    let manualMatches=[];",
    'known ID deduplication')
replace(
    "      if(!items.length)results.textContent='追加候補はまだありません。検索語を変えてYouTube検索も試せます。';",
    "      if(!items.length)results.textContent='日時・配信の長さ・参加者との関係を確認できた未発見の配信はありません。上のYouTube手動検索も利用できます。';",
    'empty text')

start = s.index('    function remember(v,reason,direct=false) {', s.index('  function attachPovSupplement('))
end = s.index('\n    async function youtubeApi(', start)
assert 'seen.set(v.id,{video:v,match,reason,direct});' in s[start:end]
s = s[:start] + '''    function remember(v,reason,direct=false) {
      const id=v?.id;
      if(!id||! /^[A-Za-z0-9_-]{11}$/.test(id)||known.has(id)||seen.has(id))return;
      const reject=()=>{rejected++;};
      // Holodex must explicitly mark this as a stream; YouTube must expose
      // real start/end timestamps and at least ten minutes of actual live video.
      if(Object.hasOwn(v,'povTimeVerified')) {
        if(!v.povTimeVerified)return reject();
      }else if(String(v.type||'').toLowerCase()!=='stream')return reject();
      if(/(?:#?shorts?\\b|切り抜き|クリップ|ダイジェスト|\\bclip\\b|#dance)/i.test(String(v.title||'')))return reject();
      const cs=startOf(v),ce=endOf(v);
      if(!cs||!ce||!Number.isFinite(+cs)||!Number.isFinite(+ce)||(+ce-+cs)<600000)return reject();
      const match=buildMatches(source,[v],syncOffset)[0]||null;
      if(!match||match.overlap<180)return reject();
      const srcGame=researchGameFromText(source.title||'',source.topic_id||'');
      const candGame=researchGameFromText(v.title||'',v.topic_id||'');
      if(srcGame&&candGame&&normalizeResearchText(srcGame)!==normalizeResearchText(candGame))return reject();
      // Broad keyword/game matches are not evidence of the same co-stream.
      // Non-direct hits must come from an explicitly linked/mentioned channel
      // AND have a game or participant relation to the source stream.
      if(!direct&&(!trustedChannelIds.has(channelId(v))||!(match.related||match.sameGame)))return reject();
      seen.set(id,{video:v,match,reason,direct});
    }
''' + s[end:]
replace(
    "      for(let i=0;i<ids.length;i+=50){\n        const data=await youtubeApi('videos?'+new URLSearchParams({part:'snippet,contentDetails,liveStreamingDetails',id:ids.slice(i,i+50).join(',')}),key);",
    "      const unchecked=[...new Set(ids)].filter(id=>id&&!known.has(id)&&!seen.has(id));\n      for(let i=0;i<unchecked.length;i+=50){\n        const data=await youtubeApi('videos?'+new URLSearchParams({part:'snippet,contentDetails,liveStreamingDetails',id:unchecked.slice(i,i+50).join(',')}),key);",
    'YouTube detail quota deduplication')
replace(
    "        const missing=[];\n        for(const id of clues.videoIds){",
    "        trustedChannelIds=new Set(clues.channelIds);\n        const missing=[];\n        for(const id of clues.videoIds){",
    'trusted channels')
replace(
    "          const q=query.value.trim().slice(0,110);\n          if(q)await ytSearch({q,publishedAfter:from,publishedBefore:to},key,'キーワード検索・参加者未確認');\n        }else for(const id of missing)remember({id,title:'Holodex未登録の概要欄リンク',channel:{name:'投稿者未取得'}},'概要欄の動画URL・日時未確認',true);",
    "          // Global keyword search is deliberately a *manual link* only: it\n          // retrieves unrelated SF6 Shorts, clips and streams of other groups.\n        }",
    'remove unrelated global search and placeholder records')
replace(
    "        notice.textContent='追加候補：'+seen.size+'件。動画を開いて本人の視点か確認してね。'+\n          (key?' YouTube側も照合しました。':' YouTubeの全体検索は上のリンクから可能です（自動照合には任意のAPIキーが必要）。')+",
    "        notice.textContent='条件を満たした未発見の配信：'+seen.size+'件（対象外・重複を除く）。動画を開いて本人の視点か確認してね。'+\n          (key?' 参加者チャンネルをYouTube側でも照合しました。':' YouTubeの全体検索は上のリンクから手動で利用できます。')+",
    'result summary')
replace(
    '      attachPovSupplement(source, matches, syncOffset);',
    '      attachPovSupplement(source, matches, syncOffset, false, candidates);',
    'comment search deduplication')
replace(
    '      attachPovSupplement(source, matches, sec, true);',
    '      attachPovSupplement(source, matches, sec, true, candidates);',
    'YouTube search deduplication')
assert 'if(q)await ytSearch(' not in s
assert "const NRH_DB_VERSION = 1;" in s and "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s
p.write_text(s,encoding='utf-8')
print('POV precision patch: applied, version 1.0.42, DB and cloud schema untouched')

from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text(encoding='utf-8')
assert '// @version      1.0.42' in s and "const VERSION = '1.0.42';" in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s

def repl(old,new,label):
 global s
 n=s.count(old)
 assert n==1, f'{label}: expected 1, got {n}'
 s=s.replace(old,new,1)

repl('// @version      1.0.42','// @version      1.0.43','metadata version')
repl("const VERSION = '1.0.42';","const VERSION = '1.0.43';",'runtime version')
repl("    ytKey.placeholder='YouTube Data APIキー（任意・この検索中のみ）';ytKey.autocomplete='off';",
"    ytKey.placeholder='YouTube Data APIキー（任意・この検索中のみ）';ytKey.autocomplete='off';\n    const channelInput=document.createElement('input');channelInput.className='npf-input';channelInput.maxLength=180;\n    channelInput.placeholder='参加者のチャンネルURL / @ハンドル（任意）';channelInput.autocomplete='off';\n    channelInput.setAttribute('aria-label','参加者のYouTubeチャンネルURLまたはハンドル');",
'channel input')
repl("    help.textContent='概要欄の動画URL・参加者チャンネルをHolodexで照合。任意のYouTube APIキーがあれば、参加者チャンネルの完了済み配信も照合します。無関係なShortsを避けるため、YouTube全体のキーワード自動検索は行いません（上の手動検索リンクを利用）。日時・配信の長さを確認できた候補のみ表示します。キーは保存しません。Twitchは対象外です。';",
"    help.textContent='概要欄の動画リンクと参加者チャンネルを先に調査。@ハンドルはYouTube APIキーがあればチャンネルIDに解決します。概要欄に参加者URLがない場合は下の入力欄にURLを入れて再検索してください。切り抜きや単に同じゲームをしている配信を混ぜないため、全体のキーワード自動検索はしません。APIキーは保存しません。';",
'help copy')
repl('    controls.append(help,query,searchLink,ytKey,run,notice,results);','    controls.append(help,query,searchLink,channelInput,ytKey,run,notice,results);','controls')
repl('    let trustedChannelIds=new Set(),rejected=0;\n    let manualMatches=[];',
'    let trustedChannelIds=new Set(),rejected=0,duplicateCount=0,checked=0,unresolved=0;\n    const reviewLinks=new Map();\n    let manualMatches=[];', 'counters')
repl("      if(!items.length)results.textContent='日時・配信の長さ・参加者との関係を確認できた未発見の配信はありません。上のYouTube手動検索も利用できます。';",
"      if(!items.length&&!reviewLinks.size)results.textContent='条件を満たす追加アーカイブは未発見です。参加者のチャンネルURLを入れるか、YouTubeの手動検索リンクを試してください。';",
'empty result')
repl('      for(const row of items) {','      for(const row of items) {', 'no-op marker') if False else None
repl('        results.append(card);\n      }\n    }\n    function remember(v,reason,direct=false) {',
"        results.append(card);\n      }\n      if(reviewLinks.size){\n        const heading=document.createElement('p');heading.textContent='🔎 概要欄の直接リンク（配信日時未確認・他視点とは未確定）';\n        heading.style.cssText='font-size:12px;font-weight:700;margin:14px 0 6px;';results.append(heading);\n        for(const [id,reason] of [...reviewLinks].slice(0,8)){\n          const link=document.createElement('a');link.href=youtubeUrl(id);link.target='_blank';link.rel='noopener noreferrer';\n          link.textContent='↗ 動画を確認する：'+id+'（'+reason+'）';\n          link.style.cssText='display:block;color:#b9d4ff;font-size:12px;margin:6px 0;overflow-wrap:anywhere;';results.append(link);\n        }\n      }\n    }\n    function remember(v,reason,direct=false) {",
'link review list')
a=s.index('    function remember(v,reason,direct=false) {',s.index('  function attachPovSupplement('))
b=s.index('\n    async function youtubeApi(',a)
assert "if(!direct&&(!trustedChannelIds.has(channelId(v))||!(match.related||match.sameGame)))return reject();" in s[a:b]
s=s[:a]+'''    function remember(v,reason,direct=false) {
      const id=v?.id;
      if(!id||! /^[A-Za-z0-9_-]{11}$/.test(id))return;
      if(known.has(id)||seen.has(id)){duplicateCount++;return;}
      checked++;
      const reject=()=>{rejected++;};
      if(/(?:#?shorts?\\b|切り抜き|クリップ|ダイジェスト|\\bclip\\b|#dance)/i.test(String(v.title||'')))return reject();
      // Never fabricate a live start from a publication date or a video length.
      const verified=Object.hasOwn(v,'povTimeVerified')?v.povTimeVerified:
        String(v.type||'').toLowerCase()==='stream';
      const cs=startOf(v),ce=endOf(v);
      if(!verified||!cs||!ce||!Number.isFinite(+cs)||!Number.isFinite(+ce)||(+ce-+cs)<600000){
        if(direct&&reviewLinks.size<8)reviewLinks.set(id,reason);
        return reject();
      }
      const match=buildMatches(source,[v],syncOffset)[0]||null;
      if(!match||match.overlap<180)return reject();
      const srcGame=researchGameFromText(source.title||'',source.topic_id||'');
      const candGame=researchGameFromText(v.title||'',v.topic_id||'');
      if(srcGame&&candGame&&normalizeResearchText(srcGame)!==normalizeResearchText(candGame))return reject();
      // A participant's channel + verified overlapping livestream is a lead,
      // even when generic titles yield no similarity score. It is NOT proof.
      if(!direct&&!trustedChannelIds.has(channelId(v)))return reject();
      seen.set(id,{video:v,match,reason:reason+(match.related?'':'・参加者チャンネル／関係は要確認'),direct});
    }
''' + s[b:]
# Source descriptions are not consistently populated by Holodex; fetch source
# snippet from YouTube and merge both sets of clues when a key is supplied.
repl("        trustedChannelIds=new Set(clues.channelIds);\n        const missing=[];",
'''        const input=channelInput.value.trim();
        const manualMatch=input.match(/(?:^|\\/)channel\\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/);
        const manualId=manualMatch?.[1]||(/^UC[A-Za-z0-9_-]{22}$/.test(input)?input:'');
        const manualHandle=input.match(/(?:youtube\\.com\\/)?@([A-Za-z0-9._-]{2,30})/i)?.[1]||'';
        const ids=new Set(clues.channelIds),handles=new Set(clues.handles);
        if(manualId)ids.add(manualId);
        if(manualHandle)handles.add(manualHandle);
        if(input&&!manualId&&!manualHandle)notice.textContent='チャンネルURLは youtube.com/@名前 または youtube.com/channel/UC... の形式で入力してください。';
        if(key){
          try{
            const src=await youtubeApi('videos?'+new URLSearchParams({part:'snippet',id:source.id}),key);
            const item=src.items?.[0];
            if(item?.snippet?.description){
              const extra=povDescriptionClues({...source,description:item.snippet.description});
              for(const id of extra.channelIds)ids.add(id);
              for(const id of extra.videoIds)if(!clues.videoIds.includes(id))clues.videoIds.push(id);
              for(const handle of extra.handles)handles.add(handle);
            }
          }catch(e){console.warn('[NPF POV source description]',e);}
          for(const handle of [...handles].slice(0,8)){
            try{
              const data=await youtubeApi('channels?'+new URLSearchParams({part:'id',forHandle:'@'+handle}),key);
              const id=data.items?.[0]?.id;
              if(/^UC[A-Za-z0-9_-]{22}$/.test(id))ids.add(id);else unresolved++;
            }catch(e){unresolved++;console.warn('[NPF POV handle]',handle,e);}
          }
        }else unresolved=handles.size;
        ids.delete(channelId(source));
        trustedChannelIds=new Set([...ids].slice(0,8));
        const missing=[];''', 'source/handle resolution')
repl("          try{const v=await apiGet('/videos/'+encodeURIComponent(id));remember(v,'概要欄の動画URL',true);}\n          catch{missing.push(id);}",
"          try{const v=await apiGet('/videos/'+encodeURIComponent(id));remember(v,'概要欄の動画URL',true);}\n          catch{missing.push(id);}", 'no-op') if False else None
repl("        const ss=startOf(source),se=endOf(source),from=new Date(+ss-7*86400000).toISOString(),to=new Date(+se+86400000).toISOString();",
"        const ss=startOf(source),se=endOf(source),from=new Date(+ss-30*86400000).toISOString(),to=new Date(+se+86400000).toISOString();",
'widen publication window')
repl('        for(const ch of clues.channelIds){','        for(const ch of trustedChannelIds){','resolved Holodex channels')
repl("          if(missing.length)await ytDetails(missing,key,'概要欄の動画URL（YouTube照合）',true);\n          // Upload date is not proof of co-stream: videos.list confirms live times.\n          for(const ch of clues.channelIds.slice(0,4))await ytSearch({channelId:ch,publishedAfter:from,publishedBefore:to},key,'参加者チャンネルの同時刻候補');",
"          // Holodex can return non-stream/undated metadata for a real linked VOD.\n          // Verify every direct link with YouTube, not just Holodex 404s.\n          await ytDetails([...new Set([...clues.videoIds,...missing])].slice(0,12),key,'概要欄の動画URL（YouTube照合）',true);\n          // Search participant channels only; never global game-only keywords.\n          for(const ch of [...trustedChannelIds].slice(0,4))await ytSearch({channelId:ch,publishedAfter:from,publishedBefore:to},key,'参加者チャンネルの同時刻候補');",
'YouTube direct verification and channels')
repl("      const unchecked=[...new Set(ids)].filter(id=>id&&!known.has(id)&&!seen.has(id));",
"      const unchecked=[...new Set(ids)].filter(id=>id&&!known.has(id)&&!seen.has(id));",'no-op') if False else None
repl("        notice.textContent='条件を満たした未発見の配信：'+seen.size+'件（対象外・重複を除く）。動画を開いて本人の視点か確認してね。'+\n          (key?' 参加者チャンネルをYouTube側でも照合しました。':' YouTubeの全体検索は上のリンクから手動で利用できます。')+\n          (clues.handles.length?' 概要欄のハンドル：'+clues.handles.join('、'):'');",
"        notice.textContent='追加の配信候補：'+seen.size+'件／日時未確認の直接リンク：'+reviewLinks.size+'件。参加者チャンネル：'+trustedChannelIds.size+'件、確認動画：'+checked+'件、既存・重複：'+duplicateCount+'件、条件外：'+rejected+'件。'+\n          (unresolved?' ハンドル未解決：'+unresolved+'件。':'')+\n          (!trustedChannelIds.size?' 参加者のチャンネルURLを入力すると、その人の同時間帯アーカイブを探せます。':'')+\n          (key?' YouTube側も照合しました。':' YouTube側の照合にはAPIキーを入力してください。');",
'diagnostic counts')
assert '// @version      1.0.43' in s and "const NRH_DB_VERSION = 1;" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s
assert 'if(q)await ytSearch(' not in s
p.write_text(s,encoding='utf-8')
print('POV recall patch applied v1.0.43. No DB schema/cloud config touched.')
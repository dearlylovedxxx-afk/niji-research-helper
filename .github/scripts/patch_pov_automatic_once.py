from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text(encoding='utf-8')
assert '// @version      1.0.43' in s and "const VERSION = '1.0.43';" in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s

def replace(old,new,label):
 global s
 n=s.count(old)
 assert n==1, f'{label}: expected one occurrence, found {n}'
 s=s.replace(old,new,1)

replace('// @version      1.0.43','// @version      1.0.44','metadata version')
replace("const VERSION = '1.0.43';","const VERSION = '1.0.44';",'runtime version')
replace("  const KEY_API = 'npf_holodex_api_key';", "  const KEY_API = 'npf_holodex_api_key';\n  const KEY_YT_API = 'npf_youtube_api_key_local_v1'; // GM storage only; never part of NRH DB/cloud backup",'YouTube key')
helper=r'''
  // Extract participant *names*, not merely linked channels. Only read explicit
  // participant lines/mentions; do not guess random people from arbitrary text.
  function povAutomaticClues(source) {
    const description=String(source?.description||'').slice(0,18000);
    const names=new Set(),events=new Set();
    const sourceName=String(channelName(source)||'').trim();
    const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\u3000【】\[\]()（）・_\-‐—|｜]/g,'');
    const excluded=/^(?:参加者|メンバー|出演者|ゲスト|配信|配信者|概要|リンク|動画|チャンネル|視点|コラボ|タグ|主催|敬称略|なし|未定|にじさんじ|vtuber|youtube|twitch|ストリートファイター6|スト6)$/i;
    function addName(value) {
      let name=String(value||'').replace(/https?:\/\/\S+|www\.\S+/gi,'').replace(/\[[^\]]*\]\([^)]*\)/g,'').replace(/[「」『』【】*#]/g,'').replace(/^[-・●★☆\s]+|[\s:：、,;；]+$/g,'').replace(/\s*\((?:敬称略|にじさんじ|vtuber|youtube)[^)]*\)\s*$/i,'').trim();
      if(name.length<2||name.length>38||excluded.test(name)||/^(?:https?|www|UC[A-Za-z0-9_-]{22}|@)/i.test(name)||/[<>]/.test(name))return;
      if(normalize(name)===normalize(sourceName))return;
      names.add(name);
    }
    function addNames(value) {
      String(value||'').split(/[、,，／/|｜&＆]+/).forEach(part=>{
        // 「レオス・ヴィンセント」の中黒は名前の一部なので分割しない。
        const cleaned=part.replace(/\s+(?:https?:\/\/|www\.).*$/i,'').replace(/\s+[@＠][A-Za-z0-9._-]+.*$/,'');
        addName(cleaned);
      });
    }
    for(const mention of Array.isArray(source?.mentions)?source.mentions:[]) {
      const channel=mention?.channel||mention;
      if(channel?.name)addName(channel.name);
    }
    const lines=description.split(/\r?\n/);
    let following=0;
    for(const raw of lines.slice(0,240)) {
      const line=raw.trim();
      if(!line){following=0;continue;}
      const labeled=line.match(/^(?:[【\[（(]?)\s*(?:参加者|参加メンバー|出演者|出演|ゲスト|コラボ相手|一緒に遊ぶ人|メンバー|with|w\/)(?:[】\]）)]?)\s*[：:\-－]?[\s]*(.*)$/i);
      if(labeled){following=6;if(labeled[1])addNames(labeled[1]);continue;}
      if(following>0){
        if(/^(?:#|https?:|www\.|(?:配信|ゲーム|お知らせ|注意|リンク|タグ|ハッシュタグ)[：:]|[-=]{3,})/i.test(line)){following=0;continue;}
        const content=line.replace(/^[-*・●★☆]\s*/,'').replace(/^\d+[.)．]\s*/,'');
        addNames(content);following--;
      }
    }
    const title=String(source?.title||'');
    for(const event of detectedEvents(title))events.add(event);
    for(const event of detectedEvents(description.slice(0,2400)))events.add(event);
    for(const hashtag of (title+' '+description.slice(0,1800)).match(/#[^\s#【】()（）\[\]、,|｜]{3,35}/g)||[]) {
      if(!/^#(?:nijisanji|にじさんじ|vtuber|スト6|sf6|streetfighter6|valorant|apex|gta|rust|ark|minecraft)$/i.test(hashtag))events.add(hashtag);
    }
    for(const bracket of title.match(/【([^】]{3,36})】|\[([^\]]{3,36})\]/g)||[]){
      const term=bracket.slice(1,-1).trim();
      if(/(?:大会|杯|企画|カスタム|スクリム|v最|vcr|スト鯖|にじgta|mad ?town|第二幕|第三幕)/i.test(term))events.add(term);
    }
    return {names:[...names].slice(0,10),events:[...events].slice(0,5)};
  }

  function povNameMatches(channel,person) {
    const clean=s=>String(s||'').normalize('NFKC').toLowerCase()
      .replace(/\((?:official|公式|にじさんじ)[^)]*\)|【[^】]*】|\[[^\]]*\]/gi,'')
      .replace(/[\s\u3000・_\-‐—|｜]/g,'');
    const a=clean(channel),b=clean(person);
    return !!(a&&b&&a.length>=3&&b.length>=3&&(a.includes(b)||b.includes(a)));
  }

  function povEventMatches(video,event) {
    const text=String(video?.title||'')+' '+String(video?.description||'').slice(0,2200);
    const tidy=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[#\s\u3000]/g,'');
    return !!(event&&tidy(event).length>=4&&tidy(text).includes(tidy(event)));
  }
'''
replace('  function povYoutubeDuration(s) {',helper+'\n  function povYoutubeDuration(s) {','automatic clues helpers')
replace("    ytKey.placeholder='YouTube Data APIキー（任意・この検索中のみ）';ytKey.autocomplete='off';",
"    ytKey.placeholder='YouTube Data APIキー（初回のみ入力）';ytKey.autocomplete='off';\n    const forgetKey=document.createElement('button');forgetKey.type='button';forgetKey.className='npf-ghost';\n    forgetKey.textContent='保存したYouTube APIキーを解除';forgetKey.style.cssText='font-size:11px;margin:6px 0;';\n    forgetKey.addEventListener('click',async()=>{if(!confirm('この端末に保存したYouTube APIキーを解除しますか？'))return;await gmSet(KEY_YT_API,'');ytKey.value='';ytKey.placeholder='YouTube Data APIキー（初回のみ入力）';notice.textContent='保存済みYouTube APIキーを解除しました';});\n    void gmGet(KEY_YT_API,'').then(saved=>{if(saved)ytKey.placeholder='YouTube APIキー保存済み（変更するときだけ入力）';});",
'persisted key input')
replace("    help.textContent='概要欄の動画リンクと参加者チャンネルを先に調査。@ハンドルはYouTube APIキーがあればチャンネルIDに解決します。概要欄に参加者URLがない場合は下の入力欄にURLを入れて再検索してください。切り抜きや単に同じゲームをしている配信を混ぜないため、全体のキーワード自動検索はしません。APIキーは保存しません。';",
"    help.textContent='概要欄の参加者名・@ハンドル・企画名を自動抽出し、YouTubeから同時期のライブアーカイブを追加検索します。関連の根拠が弱いものは「要確認」と表示。YouTube APIキーは初回入力後、この端末のスクリプト設定に保存します（pCloudバックアップ対象外）。';",
'help text')
replace('    controls.append(help,query,searchLink,channelInput,ytKey,run,notice,results);',
'    controls.append(help,searchLink,ytKey,forgetKey,run,notice,results);','auto UI')
replace("      if(!items.length&&!reviewLinks.size)results.textContent='条件を満たす追加アーカイブは未発見です。参加者のチャンネルURLを入れるか、YouTubeの手動検索リンクを試してください。';",
"      if(!items.length&&!reviewLinks.size)results.textContent='追加候補は未発見です。自動取得できた参加者・企画名や検索件数を上の診断で確認してください。';",
'empty state')
# Replace candidate vetting: keyword hits must have an actual participant or
# distinctive event clue, and never become a "confirmed POV" automatically.
a=s.index('    function remember(v,reason,direct=false) {',s.index('  function attachPovSupplement('))
b=s.index('\n    async function youtubeApi(',a)
assert 'trustedChannelIds.has(channelId(v))' in s[a:b]
s=s[:a]+r'''    function remember(v,reason,direct=false,clue=null) {
      const id=v?.id;
      if(!id||! /^[A-Za-z0-9_-]{11}$/.test(id))return;
      if(known.has(id)||seen.has(id)){duplicateCount++;return;}
      checked++;
      const reject=()=>{rejected++;};
      if(/(?:#?shorts?\b|切り抜き|クリップ|ダイジェスト|\bclip\b|#dance)/i.test(String(v.title||'')))return reject();
      const verified=Object.hasOwn(v,'povTimeVerified')?v.povTimeVerified:String(v.type||'').toLowerCase()==='stream';
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
      const person=clue?.person||'';
      const event=clue?.event||'';
      const named=!!person&&povNameMatches(channelName(v),person);
      const eventMatched=!!event&&povEventMatches(v,event);
      const sourceNamed=String(v.description||'').includes(channelName(source))&&channelName(source).length>=4;
      const trusted=trustedChannelIds.has(channelId(v));
      // Event-only matches require both a distinctive event AND compatible game
      // (or a source-channel mention). A generic game title is never enough.
      const eventLead=eventMatched&&(sourceNamed||!!(srcGame&&candGame&&normalizeResearchText(srcGame)===normalizeResearchText(candGame)));
      if(!direct&&!trusted&&!named&&!eventLead)return reject();
      const evidence=direct?'概要欄の直接リンク':trusted?'概要欄の参加者チャンネル':named?'概要欄の参加者名とチャンネル名一致':'企画名＋同ゲーム・同時間帯';
      seen.set(id,{video:v,match,reason:evidence+'（他視点か要確認）',direct});
    }
''' + s[b:]
replace('    async function ytDetails(ids,key,reason,direct=false){','    async function ytDetails(ids,key,reason,direct=false,clue=null){','ytDetails signature')
replace('        for(const item of data.items||[])remember(povYoutubeVideo(item),reason,direct);',
'        for(const item of data.items||[])remember(povYoutubeVideo(item),reason,direct,clue);','ytDetails forwarding')
replace('    async function ytSearch(params,key,reason){', '    async function ytSearch(params,key,reason,clue=null){','ytSearch signature')
replace("      const p=new URLSearchParams({part:'snippet',type:'video',maxResults:'25',order:'date',...params});",
"      const p=new URLSearchParams({part:'snippet',type:'video',eventType:'completed',maxResults:'20',order:'date',...params});",'completed livestream search')
replace('      await ytDetails((data.items||[]).map(x=>x.id?.videoId).filter(Boolean),key,reason);',
'      await ytDetails((data.items||[]).map(x=>x.id?.videoId).filter(Boolean),key,reason,false,clue);','ytSearch clue forwarding')
replace("      const key=ytKey.value.trim();ytKey.value='';",
"      const enteredKey=ytKey.value.trim();ytKey.value='';\n      const key=enteredKey||String(await gmGet(KEY_YT_API,'')||'').trim();\n      if(!key){notice.textContent='自動でYouTubeを検索するには、最初の一度だけYouTube APIキーを入力してください。';run.disabled=false;return;}",
'load persisted key')
# Rework run body as one cohesive bounded automated flow: metadata, mentions,
# participant names, event keyword query; no required manual fields.
a=s.index("      try {\n        notice.textContent='概要欄のリンクとHolodexの参加者情報を確認中…';",s.index('  function attachPovSupplement('))
b=s.index("      }catch(e){notice.textContent='⚠️ 追加検索を途中で停止：'",a)
assert 'channelInput.value.trim()' in s[a:b]
s=s[:a]+r'''      try {
        notice.textContent='元動画の概要欄・参加者名・企画名を自動取得中…';
        // Verify the entered key before storing it. Never write it into the DB,
        // source code, logs, URLs displayed in UI, or pCloud backup payload.
        const src=await youtubeApi('videos?'+new URLSearchParams({part:'snippet',id:source.id}),key);
        if(enteredKey){await gmSet(KEY_YT_API,enteredKey);ytKey.placeholder='YouTube APIキー保存済み（変更するときだけ入力）';}
        const freshDescription=String(src.items?.[0]?.snippet?.description||'');
        let detailed=source;
        if(!source.description||!Array.isArray(source.mentions)||!source.mentions.length){
          const hd=await apiGet('/videos?'+new URLSearchParams({id:source.id,include:'description,mentions',limit:'1'})).catch(()=>[]);
          if(Array.isArray(hd)&&hd[0])detailed={...source,...hd[0]};
        }
        const enriched={...detailed,description:freshDescription||detailed.description||''};
        const clues=povDescriptionClues(enriched);
        const auto=povAutomaticClues(enriched);
        const ids=new Set(clues.channelIds),handles=new Set(clues.handles);
        const ss=startOf(source),se=endOf(source);
        if(!ss||!se||!Number.isFinite(+ss)||!Number.isFinite(+se))throw Error('元動画の配信日時を確認できません');
        const from=new Date(+ss-30*86400000).toISOString(),to=new Date(+se+3*86400000).toISOString();
        for(const handle of [...handles].slice(0,8)){
          try{
            const data=await youtubeApi('channels?'+new URLSearchParams({part:'id',forHandle:'@'+handle}),key);
            const id=data.items?.[0]?.id;
            if(/^UC[A-Za-z0-9_-]{22}$/.test(id))ids.add(id);else unresolved++;
          }catch(e){unresolved++;console.warn('[NPF POV handle lookup]',String(e?.message||e));}
        }
        ids.delete(channelId(source));trustedChannelIds=new Set([...ids].slice(0,8));
        notice.textContent='参加者名：'+(auto.names.join('、')||'未記載')+' ／ 企画名：'+(auto.events.join('、')||'未記載')+'。関連アーカイブを照合中…';
        for(const id of clues.videoIds){
          try{remember(await apiGet('/videos/'+encodeURIComponent(id)),'概要欄の動画URL',true);}
          catch(e){console.debug('[NPF POV direct link not on Holodex]',id);}
        }
        await ytDetails(clues.videoIds.slice(0,12),key,'概要欄の動画URL（YouTube照合）',true);
        // Channels explicitly in the description are a targeted search, not a
        // site-wide query. One failed provider must not abort all other leads.
        for(const ch of trustedChannelIds){
          try{
            const p=new URLSearchParams({channel_id:ch,type:'stream',status:'past',include:'live_info,mentions',from:new Date(+ss-86400000).toISOString(),to:new Date(+se+86400000).toISOString(),limit:'50'});
            for(const v of await apiGet('/videos?'+p))remember(v,'概要欄の参加者チャンネル');
          }catch(e){console.warn('[NPF POV Holodex channel]',ch,String(e?.message||e));}
        }
        let searches=0,searchFailures=0;
        async function boundedSearch(params,reason,clue){
          if(searches>=6)return;
          searches++;
          try{await ytSearch({publishedAfter:from,publishedBefore:to,...params},key,reason,clue);}
          catch(e){searchFailures++;console.warn('[NPF POV YouTube search]',reason,String(e?.message||e));
            if(/quota|403|429|exceeded|limit/i.test(String(e?.message||e)))throw e;}
        }
        for(const ch of [...trustedChannelIds].slice(0,3))
          await boundedSearch({channelId:ch},'参加者のチャンネル','');
        const event=auto.events[0]||'';
        // A name+event query can find unregistered participants; a fallback
        // name-only query covers titles that omit the event name altogether.
        for(const person of auto.names.slice(0,3)){
          if(searches>=6)break;
          const before=seen.size;
          await boundedSearch({q:[person,event].filter(Boolean).join(' ')},'概要欄の参加者名から自動検索',{person,event});
          if(seen.size===before&&event&&searches<6)
            await boundedSearch({q:person},'参加者名で再検索',{person});
        }
        if(event&&searches<6){
          const game=String(source.topic_id||'').slice(0,45);
          await boundedSearch({q:[event,game].filter(Boolean).join(' ')},'企画名から自動検索',{event});
        }
        const linkQuery=[event,auto.names[0],source.topic_id].filter(Boolean).join(' ').trim()||source.title||'';
        searchLink.href='https://www.youtube.com/results?search_query='+encodeURIComponent(linkQuery.slice(0,120));
        searchLink.textContent='↗ YouTubeの検索結果を開く（'+linkQuery.slice(0,55)+'）';
        notice.textContent='自動検索完了：追加候補 '+seen.size+'件 ／ 要確認の直接リンク '+reviewLinks.size+'件。'+
          '概要欄の参加者 '+auto.names.length+'人、企画名 '+auto.events.length+'件、参加者チャンネル '+trustedChannelIds.size+'件。'+
          'YouTube検索 '+searches+'回、既存・重複 '+duplicateCount+'件、条件外 '+rejected+'件。'+
          (unresolved?' 未解決ハンドル '+unresolved+'件。':'')+
          (searchFailures?' 一部の検索に失敗 '+searchFailures+'件。':'')+
          (!auto.names.length&&!auto.events.length&&!trustedChannelIds.size?' 元動画に参加者や企画名の手がかりが見つからず、検索対象を特定できませんでした。':'');
        display();
''' + s[b:]
# A manual-confirmation action must not erase the attached supplement panel.
assert 'attachPovSupplement(source, matches, sec, true' in s
assert 'const NRH_DB_VERSION = 1;' in s and "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s
assert 'channelInput.value.trim()' not in s
assert 'if(q)await ytSearch(' not in s
p.write_text(s,encoding='utf-8')
print('Applied automatic POV discovery v1.0.44; retained local DB/cloud schema')
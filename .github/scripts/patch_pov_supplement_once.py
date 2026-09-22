from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text(encoding='utf-8')
def change(before,after,description):
 global s
 assert s.count(before)==1, f'{description}: expected once, got {s.count(before)}'
 s=s.replace(before,after,1)
change('// @version      1.0.39','// @version      1.0.40','metadata version')
change("const VERSION = '1.0.39';","const VERSION = '1.0.40';",'runtime version')
change('// @connect      holodex.net','// @connect      holodex.net\n// @connect      www.googleapis.com','YouTube API connect')
change('      renderMatches(source, matches, syncOffset);','      renderMatches(source, matches, syncOffset);\n      attachPovSupplement(source, matches, syncOffset);','UI hook')
feature=r'''
  // Manual, bounded second pass; never equate the same game with confirmed POV.
  function povDescriptionClues(source) {
    const text=String(source.description||'').slice(0,18000);
    const videoIds=new Set(),channelIds=new Set(),handles=new Set();
    const sourceChannel=channelId(source);
    for(const mention of Array.isArray(source.mentions)?source.mentions:[]) {
      const channel=mention?.channel||mention;
      if(/^UC[A-Za-z0-9_-]{22}$/.test(channel?.id||'')&&channel.id!==sourceChannel) channelIds.add(channel.id);
    }
    const urls=text.match(/(?:https?:\/\/|www\.)(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"'）)\]]+/gi)||[];
    for(const raw of urls.slice(0,80)) {
      try {
        const url=new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw);
        if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname.toLowerCase()))continue;
        const id=parseVideoIdFromUrl(url.href);
        if(id&&id!==source.id)videoIds.add(id);
        const channel=url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/);
        if(channel&&channel[1]!==sourceChannel)channelIds.add(channel[1]);
        const handle=url.pathname.match(/^\/@([A-Za-z0-9._-]{2,30})(?:\/|$)/);
        if(handle)handles.add(handle[1]);
      }catch{}
    }
    return {videoIds:[...videoIds].slice(0,12),channelIds:[...channelIds].slice(0,8),handles:[...handles].slice(0,8),descriptionFound:!!text};
  }

  function povYoutubeDuration(s) {
    const m=String(s||'').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    return m?Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0):0;
  }

  function povYoutubeVideo(item) {
    const live=item?.liveStreamingDetails||{},snippet=item?.snippet||{};
    const start=live.actualStartTime||'';
    const dur=povYoutubeDuration(item?.contentDetails?.duration);
    const end=live.actualEndTime||(start&&dur?new Date(Date.parse(start)+dur*1000).toISOString():'');
    return {id:item?.id,title:snippet.title||'',description:snippet.description||'',
      channel_id:snippet.channelId||'',channel:{id:snippet.channelId||'',name:snippet.channelTitle||''},
      start_actual:start,end_actual:end,duration:dur,
      available_at:start||snippet.publishedAt||'',topic_id:'',
      povTimeVerified:!!(start&&end&&Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end)))};
  }

  function attachPovSupplement(source,baseline,syncOffset) {
    const area=$('#npf-result-area',state.sheet);
    if(!area)return;
    const section=document.createElement('section');
    section.id='npf-pov-supplement';
    section.style.cssText='border:1px solid #55617b;border-radius:12px;padding:12px;margin:15px 0;background:#151b25;color:#edf2f7;';
    const start=document.createElement('button');start.type='button';start.className='npf-primary';
    start.textContent='🔎 未発見の視点を追加検索';
    start.style.cssText='min-height:44px;width:100%;font-size:13px;';
    const controls=document.createElement('div');controls.hidden=true;
    const notice=document.createElement('p');notice.style.cssText='font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;';
    const query=document.createElement('input');query.className='npf-input';query.maxLength=120;
    query.placeholder='YouTubeで探す語（イベント名・ゲーム名など）';query.value=String(source.topic_id||'').slice(0,100);
    const ytKey=document.createElement('input');ytKey.className='npf-input';ytKey.type='password';
    ytKey.placeholder='YouTube Data APIキー（任意・この検索中のみ）';ytKey.autocomplete='off';
    const searchLink=document.createElement('a');searchLink.target='_blank';searchLink.rel='noopener noreferrer';
    searchLink.style.cssText='display:block;color:#b9d4ff;margin:8px 0;font-size:12px;';
    const updateLink=()=>{
      const q=query.value.trim()||[source.topic_id,source.title].filter(Boolean).join(' ').slice(0,100);
      searchLink.href='https://www.youtube.com/results?search_query='+encodeURIComponent(q);
      searchLink.textContent='↗ YouTubeで「'+q.slice(0,65)+'」を検索（APIキー不要）';
    };
    query.addEventListener('input',updateLink);updateLink();
    const results=document.createElement('div');
    const run=document.createElement('button');run.type='button';run.className='npf-primary';run.textContent='追加候補を探す';
    run.style.cssText='min-height:44px;margin-top:9px;';
    const help=document.createElement('p');help.style.cssText='font-size:11px;line-height:1.5;color:#b9c7dd;';
    help.textContent='概要欄の動画URL・参加者チャンネルをHolodexで照合。任意のYouTube APIキーを入力すると、未発見のチャンネルとキーワードをYouTubeでも検索します。検索はタップ時のみ・件数制限あり。キーは保存・バックアップしません。Twitchは対象外です。';
    controls.append(help,query,searchLink,ytKey,run,notice,results);
    section.append(start,controls);area.after(section);
    start.addEventListener('click',()=>{controls.hidden=!controls.hidden;start.textContent=controls.hidden?'🔎 未発見の視点を追加検索':'🔎 追加検索を閉じる';});
    const known=new Set([source.id,...baseline.map(m=>m.v.id)]),seen=new Map();
    let manualMatches=[];
    function display() {
      results.replaceChildren();
      const items=[...seen.values()].sort((a,b)=>Number(b.direct)-Number(a.direct)||Number(b.match?.related)-Number(a.match?.related));
      if(!items.length)results.textContent='追加候補はまだありません。検索語を変えてYouTube検索も試せます。';
      for(const row of items) {
        if(!section.isConnected)break;
        const v=row.video,match=row.match;
        const card=document.createElement('article');card.style.cssText='border-top:1px solid #46516b;padding:10px 0;font-size:12px;';
        const title=document.createElement('strong');title.textContent=v.title||'動画 '+v.id;title.style.cssText='display:block;overflow-wrap:anywhere;';
        const info=document.createElement('div');info.textContent=channelName(v)+' ／ '+row.reason+(match?' ／ 同時刻の重なり '+fmtDuration(match.overlap):' ／ 配信日時を確認できません');
        info.style.cssText='margin:5px 0;color:#b9c7dd;';
        const open=document.createElement('a');open.href=youtubeUrl(v.id,match?correctedCandidateOffset(source,match):0);
        open.target='_blank';open.rel='noopener noreferrer';open.textContent=match?'↗ 重なり時刻から開く':'↗ 動画を確認する';
        open.style.cssText='display:inline-block;color:#b9d4ff;margin:4px 12px 4px 0;';
        card.append(title,info,open);
        if(match) {
          const add=document.createElement('button');add.type='button';add.className='npf-ghost';
          add.textContent='確認して他視点一覧に追加';add.style.cssText='min-height:38px;margin:4px 0;';
          add.addEventListener('click',()=>{
            if(manualMatches.some(m=>m.v.id===v.id))return;
            match.related=true;match.reasons=[...new Set([...match.reasons,'手動確認した候補'])];
            manualMatches.push(match);renderMatches(source,[...baseline,...manualMatches],syncOffset);
            add.textContent='✅ この画面の一覧に追加済み';add.disabled=true;
          });card.append(add);
        }
        results.append(card);
      }
    }
    function remember(v,reason,direct=false) {
      if(!v?.id||! /^[A-Za-z0-9_-]{11}$/.test(v.id)||known.has(v.id))return;
      const match=buildMatches(source,[v],syncOffset)[0]||null;
      const prior=seen.get(v.id);
      if(prior&&!direct)return;
      seen.set(v.id,{video:v,match,reason,direct});
    }
    async function youtubeApi(path,key){
      const res=await gmRequest({method:'GET',url:'https://www.googleapis.com/youtube/v3/'+path+(path.includes('?')?'&':'?')+'key='+encodeURIComponent(key),
        headers:{Accept:'application/json'},timeout:22000,responseType:'text'});
      let data;try{data=JSON.parse(res.responseText||res.response||'{}');}catch{throw Error('YouTube APIの応答を解析できません');}
      if(res.status!==200||data.error)throw Error('YouTube API '+res.status+'：'+String(data.error?.message||'検索できません').slice(0,110));
      return data;
    }
    async function ytDetails(ids,key,reason,direct=false){
      for(let i=0;i<ids.length;i+=50){
        const data=await youtubeApi('videos?'+new URLSearchParams({part:'snippet,contentDetails,liveStreamingDetails',id:ids.slice(i,i+50).join(',')}),key);
        for(const item of data.items||[])remember(povYoutubeVideo(item),reason,direct);
      }
    }
    async function ytSearch(params,key,reason){
      const p=new URLSearchParams({part:'snippet',type:'video',maxResults:'25',order:'date',...params});
      const data=await youtubeApi('search?'+p,key);
      await ytDetails((data.items||[]).map(x=>x.id?.videoId).filter(Boolean),key,reason);
    }
    run.addEventListener('click',async()=>{
      if(run.disabled)return;
      run.disabled=true;seen.clear();manualMatches=[];results.replaceChildren();
      const key=ytKey.value.trim();ytKey.value='';
      try {
        notice.textContent='概要欄のリンクとHolodexの参加者情報を確認中…';
        let clues=povDescriptionClues(source);
        // Some Holodex video responses omit optional description/mentions.
        if(!clues.descriptionFound&&!clues.channelIds.length) {
          const detailed=await apiGet('/videos?'+new URLSearchParams({id:source.id,include:'description,mentions',limit:'1'})).catch(()=>[]);
          if(Array.isArray(detailed)&&detailed[0])clues=povDescriptionClues({...source,...detailed[0]});
        }
        const missing=[];
        for(const id of clues.videoIds){
          try{const v=await apiGet('/videos/'+encodeURIComponent(id));remember(v,'概要欄の動画URL',true);}
          catch{missing.push(id);}
        }
        const ss=startOf(source),se=endOf(source),from=new Date(+ss-7*86400000).toISOString(),to=new Date(+se+86400000).toISOString();
        for(const ch of clues.channelIds){
          try {
            const p=new URLSearchParams({channel_id:ch,type:'stream',status:'past',include:'live_info,mentions',from:new Date(+ss-86400000).toISOString(),to:new Date(+se+86400000).toISOString(),limit:'50'});
            for(const v of await apiGet('/videos?'+p))remember(v,'概要欄の参加者チャンネル');
          }catch(e){console.warn('[NPF POV complement channel]',ch,e);}
        }
        if(key){
          notice.textContent='Holodexにない動画をYouTubeで照合中…';
          if(missing.length)await ytDetails(missing,key,'概要欄の動画URL（YouTube照合）',true);
          // Upload date is not proof of co-stream: videos.list confirms live times.
          for(const ch of clues.channelIds.slice(0,4))await ytSearch({channelId:ch,publishedAfter:from,publishedBefore:to},key,'参加者チャンネルの同時刻候補');
          const q=query.value.trim().slice(0,110);
          if(q)await ytSearch({q,publishedAfter:from,publishedBefore:to},key,'キーワード検索・参加者未確認');
        }else for(const id of missing)remember({id,title:'Holodex未登録の概要欄リンク',channel:{name:'投稿者未取得'}},'概要欄の動画URL・日時未確認',true);
        notice.textContent='追加候補：'+seen.size+'件。動画を開いて本人の視点か確認してね。'+
          (key?' YouTube側も照合しました。':' YouTubeの全体検索は上のリンクから可能です（自動照合には任意のAPIキーが必要）。')+
          (clues.handles.length?' 概要欄のハンドル：'+clues.handles.join('、'):'');
        display();
      }catch(e){notice.textContent='⚠️ 追加検索を途中で停止：'+String(e?.message||e)+'。取得済み候補は表示します。';display();}
      finally{run.disabled=false;}
    });
  }

'''
change('  async function showOtherPOVs(videoId) {',feature+'  async function showOtherPOVs(videoId) {','insert supplement helpers')
p.write_text(s,encoding='utf-8')
print('PATCH OK, version 1.0.40, bytes',len(s.encode()))
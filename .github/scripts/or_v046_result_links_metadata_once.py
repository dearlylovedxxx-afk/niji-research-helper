from pathlib import Path
p=Path('Niji_OR_Results_Merger.user.js')
s=p.read_text(encoding='utf-8')
def change(old,new,label):
    global s
    count=s.count(old)
    if count!=1: raise AssertionError(f'{label}: expected exactly 1 match, found {count}')
    s=s.replace(old,new,1)

change('// @version      0.4.5','// @version      0.4.6','metadata version')
change('150動画ごとに途中保存して一時停止し、続きからOR検索を再開できます。本体DBは変更しません。','動画タイトル・配信日時の補完、明示的な並び順、正しい動画IDのタイムスタンプと直接開けるコメント一覧。本体DBは変更しません。','description')
change('// @grant        none','// @grant        GM_xmlhttpRequest\n// @connect      www.youtube.com','youtube metadata permission')
change("boot.textContent='🔀 OR起動中 0.4.5';","boot.textContent='🔀 OR起動中 0.4.6';",'boot version')
change("console.info('[Niji OR Merger] v0.4.5 injected', location.href);","console.info('[Niji OR Merger] v0.4.6 injected', location.href);",'log version')
change("const VERSION = '0.4.5';","const VERSION = '0.4.6';\n  const VIDEO_META_KEY = 'niji_or_merger_addon_video_metadata_v046';\n  const RESULT_SORT_KEY = 'niji_or_merger_addon_result_sort_v046';",'constants')
change("  let lastAutoStatus = '';", "  let lastAutoStatus = '';\n  let videoMetadata = {};\n  let resultSort = 'comments';\n  let metadataQueue = [];\n  let metadataBusy = false;\n  let metadataNextAt = 0;\n  let metadataStopped = false;",'vars')

anchor="  function titleFromLink(a, card, id) {"
assert s.count(anchor)==1
extra=r'''  // Channel headers such as "不破湊 / Fuwa Minato 【にじさんじ】" are not stream titles.
  function isChannelHeading(value='') {
    const t=clip(value,240);
    return /^(?:.{1,36}\s*\/\s*[A-Za-z][A-Za-z .'-]{2,55}\s*【にじさんじ】|.{1,36}\s*【にじさんじ】)$/.test(t)
      && !/[#＃\[\]【】].*(?:APEX|VALORANT|雑談|マイクラ|にじ甲|スプラ|歌枠|配信)/i.test(t);
  }
  function validStreamTitle(value,id='') {
    const t=usableVideoTitle(value,id);
    return t && !isChannelHeading(t) ? t : '';
  }
  function metadataDateFromCard(card) {
    const date=card.querySelector('time[datetime],[itemprop="startDate"],[itemprop="datePublished"],meta[itemprop="uploadDate"]');
    const raw=date?.getAttribute('datetime')||date?.getAttribute('content')||'';
    return /^20\d\d-\d\d-\d\d(?:T|$)/.test(raw) ? raw : '';
  }
'''
s=s.replace(anchor,extra+anchor,1)
change("    return picks.map(t=>usableVideoTitle(t,id)).find(Boolean) || `動画 ${id}`;","    return picks.map(t=>validStreamTitle(t,id)).find(Boolean) || `動画 ${id}`;",'list title')
change("entry = { id, title, sourceUrl: cleanUrl(a.href || '') || `https://comment2434.com/comment/video/${id}/`, channel: '', comments: [] };","entry = { id, title, sourceUrl: cleanUrl(a.href || '') || `https://comment2434.com/comment/video/${id}/`, channel: '', publishedAt:metadataDateFromCard(card), comments: [] };",'list metadata')
change("      } else if (title.length > entry.title.length && !title.startsWith('動画 ')) entry.title = title;","      } else if (validStreamTitle(title,id) && !validStreamTitle(entry.title,id)) entry.title = title;\n      if (!entry.publishedAt) entry.publishedAt=metadataDateFromCard(card);",'list title prioritization')
change("      if (old.title.startsWith('動画 ')) old.title = clip(document.querySelector('main h1, main h2, h1')?.textContent || document.title, 240) || old.title;","      if (!validStreamTitle(old.title,current)) old.title = validStreamTitle(document.querySelector('meta[property=\"og:title\"]')?.content,current) || validStreamTitle(document.title.replace(/\\s*[-|｜]\\s*にじさんじコメント検索.*$/,''),current) || old.title;\n      if (!old.publishedAt) old.publishedAt=metadataDateFromCard(root);",'detail title')
change("e = { id: v.id, title: v.title, channel: v.channel || '', url: v.sourceUrl, labels: new Set(), comments: new Map() };","e = { id: v.id, title: v.title, channel: v.channel || '', publishedAt:v.publishedAt||'', url: v.sourceUrl, labels: new Set(), comments: new Map() };",'merge metadata')
change("      if ((!e.title || e.title.startsWith('動画 ') || /^\\d+\\s*コメント$/.test(e.title)) && usableVideoTitle(v.title,v.id)) e.title = v.title;","      if (!validStreamTitle(e.title,v.id) && validStreamTitle(v.title,v.id)) e.title = v.title;\n      if (!e.publishedAt && v.publishedAt) e.publishedAt=v.publishedAt;",'merge title')
change("    const title=picks.map(t=>usableVideoTitle(t,id)).find(t=>t && !/^(?:にじさんじコメント検索|コメント検索|キーワード検索|検索結果)/.test(t));","    const title=picks.map(t=>validStreamTitle(t,id)).find(t=>t && !/^(?:にじさんじコメント検索|コメント検索|キーワード検索|検索結果)/.test(t));",'detail title helper')
change("runJob.list.push({id:item.id,title:item.title,sourceUrl:item.sourceUrl,channel:item.channel});","runJob.list.push({id:item.id,title:item.title,sourceUrl:item.sourceUrl,channel:item.channel,publishedAt:item.publishedAt||''});",'run list metadata')
change("runJob.partial.push({id:v.id,title:detailedVideoTitle(v.title,v.id),sourceUrl:v.sourceUrl,channel:v.channel||'',comments:[...map.values()]});","runJob.partial.push({id:v.id,title:detailedVideoTitle(v.title,v.id),sourceUrl:v.sourceUrl,channel:v.channel||'',publishedAt:v.publishedAt||metadataDateFromCard(main),comments:[...map.values()]});",'run partial metadata')

start=s.index('  function viewerHead(title,onBack) {')
end=s.index('  function render() {',start)
new_ui=r'''  // Persist metadata separately: old batches and Niji Research Helper IndexedDB stay unchanged.
  function videoInfo(video) {
    const extra=videoMetadata[video.id]||{};
    return {
      title:validStreamTitle(extra.title,video.id)||validStreamTitle(video.title,video.id)||`動画 ${video.id}（配信名未取得）`,
      startedAt:extra.startedAt||'',
      publishedAt:extra.publishedAt||video.publishedAt||'',
      channel:extra.channel||video.channel||'',
    };
  }
  function displayDate(info) {
    const raw=info.startedAt||info.publishedAt;
    if (!raw) return '配信日時：未取得';
    const date=new Date(raw);
    if (Number.isNaN(date.getTime())) return '配信日時：未取得';
    const label=info.startedAt?'配信開始':'公開日';
    const text=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:info.startedAt?'2-digit':undefined,minute:info.startedAt?'2-digit':undefined,hour12:false}).format(date);
    return `${label}：${text}${info.startedAt?' JST':''}`;
  }
  function decodeMetaText(str='') {
    const textarea=document.createElement('textarea');
    textarea.innerHTML=String(str);
    return clip(textarea.value,260);
  }
  function videoMetadataFromHtml(html,id) {
    const text=String(html||'');
    if (!text.includes(id)) return {};
    const og=text.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']{1,600})["']/i)
      ||text.match(/<meta\s+[^>]*content=["']([^"']{1,600})["'][^>]*property=["']og:title["']/i);
    const title=validStreamTitle(decodeMetaText(og?.[1]||''),id);
    const start=text.match(/"liveBroadcastDetails"\s*:\s*\{[^}]{0,1000}"startTimestamp"\s*:\s*"(20\d\d-[^" ]+)"/);
    const published=text.match(/"publishDate"\s*:\s*"(20\d\d-\d\d-\d\d)"/)||text.match(/"datePublished"\s*:\s*"(20\d\d-\d\d-\d\d)"/);
    return {title:title||'',startedAt:start?.[1]||'',publishedAt:published?.[1]||''};
  }
  function fetchYoutubeMetadata(id) {
    return new Promise((resolve,reject)=>{
      if (typeof GM_xmlhttpRequest!=='function') return reject(new Error('YouTubeメタデータ取得権限がありません'));
      GM_xmlhttpRequest({method:'GET',url:`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,timeout:13000,
        anonymous:true,
        onload:(r)=>{
          if(r.status===429||r.status===403) {metadataStopped=true;return reject(new Error(`YouTube側のアクセス制限 (${r.status})`));}
          if(r.status!==200) return reject(new Error(`YouTube HTTP ${r.status}`));
          const info=videoMetadataFromHtml(r.responseText,id);
          if(info.title||info.publishedAt||info.startedAt) resolve(info);
          else reject(new Error('動画のタイトル・日時を読み取れません'));
        },
        onerror:()=>reject(new Error('YouTubeへの接続に失敗しました')),
        ontimeout:()=>reject(new Error('YouTube応答がタイムアウトしました')),
      });
    });
  }
  function queueVideoMetadata(video,onDone) {
    const saved=videoMetadata[video.id];
    if(saved) {onDone();return;}
    if(metadataStopped) {onDone();return;}
    if(!metadataQueue.some(x=>x.video.id===video.id)) metadataQueue.push({video,onDone});
    void runMetadataQueue();
  }
  async function runMetadataQueue() {
    if(metadataBusy || metadataStopped) return;
    metadataBusy=true;
    try {
      while(metadataQueue.length && !metadataStopped) {
        const {video,onDone}=metadataQueue.shift();
        if(videoMetadata[video.id]) {onDone();continue;}
        const delay=Math.max(0,2600-(Date.now()-metadataNextAt));
        if(delay) await wait(delay);
        metadataNextAt=Date.now();
        try {
          const info=await fetchYoutubeMetadata(video.id);
          videoMetadata[video.id]={...info,checkedAt:Date.now()};
          await storeSet(VIDEO_META_KEY,videoMetadata);
        } catch(err) {
          console.warn('[Niji OR Merger] 動画情報の補完失敗',video.id,err);
          // Do not repeatedly request videos that cannot be resolved.
          videoMetadata[video.id]={checkedAt:Date.now(),unavailable:true};
          try {await storeSet(VIDEO_META_KEY,videoMetadata);} catch(_){}
        }
        onDone();
      }
    } finally {metadataBusy=false;}
  }
  function viewerHead(title,onBack) {
    const bar=el('div',{class:'nor-viewer-header'});
    bar.append(button('← 戻る',onBack),el('strong',{text:title}),button('閉じる',()=>{viewer.hidden=true;panel.hidden=false;trigger.style.setProperty('display','none','important');render();}));
    return bar;
  }
  function showResultsViewer() {
    viewer.replaceChildren();viewer.hidden=false;panel.hidden=true;
    trigger.style.setProperty('display','none','important');
    viewer.append(viewerHead('🔀 OR統合検索結果',()=>{viewer.hidden=true;panel.hidden=false;render();}));
    const wrap=el('div',{class:'nor-list'});
    const summary=el('div',{class:'nor-compact'});
    const search=el('input',{class:'nor-light-input'});search.placeholder='配信タイトル・検索語で絞り込み';
    const sortRow=el('div',{class:'nor-sort-row'});
    const sortLabel=el('label',{text:'並び順：'});
    const sortSelect=document.createElement('select');sortSelect.className='nor-light-input nor-sort-select';
    for(const [value,text] of [['comments','コメント数が多い順'],['newest','配信開始・公開日が新しい順'],['oldest','配信開始・公開日が古い順'],['title','配信タイトル順']]) {
      const option=document.createElement('option');option.value=value;option.textContent=text;sortSelect.append(option);
    }
    sortSelect.value=resultSort;sortRow.append(sortLabel,sortSelect);
    const results=el('div');
    wrap.append(summary,search,sortRow,results);viewer.append(wrap);
    let observer=null;
    if(typeof IntersectionObserver==='function') observer=new IntersectionObserver(entries=>{
      for(const e of entries) if(e.isIntersecting){observer.unobserve(e.target);const v=e.target.__norVideo; if(v) queueVideoMetadata(v,()=>{if(viewer.contains(e.target))updateCard(e.target,v);});}
    },{root:viewer,rootMargin:'100px'});
    function updateCard(item,v){
      const info=videoInfo(v);
      const title=item.querySelector('.nor-video-title');if(title) title.textContent=info.title;
      const date=item.querySelector('.nor-video-date');if(date) date.textContent=displayDate(info);
    }
    function redraw() {
      if(observer) observer.disconnect();
      results.replaceChildren();
      const q=clip(search.value,200).toLowerCase();
      const selected=mergedVideos().filter(v=>v.comments.size && (!lastRunWords.length || [...v.labels].some(w=>lastRunWords.includes(w))))
        .filter(v=>!q || `${videoInfo(v).title} ${v.channel||''} ${[...v.labels].join(' ')}`.toLowerCase().includes(q));
      const dateMillis=v=>{const d=new Date(videoInfo(v).startedAt||videoInfo(v).publishedAt||'');return Number.isFinite(d.getTime())?d.getTime():null;};
      selected.sort((a,b)=>{
        if(resultSort==='title') return videoInfo(a).title.localeCompare(videoInfo(b).title,'ja')||a.id.localeCompare(b.id);
        if(resultSort==='newest'||resultSort==='oldest') {
          const da=dateMillis(a),db=dateMillis(b);
          if(da===null&&db!==null)return 1;
          if(db===null&&da!==null)return -1;
          if(da!==null&&db!==null&&da!==db) return resultSort==='newest'?db-da:da-db;
        }
        return b.comments.size-a.comments.size||a.id.localeCompare(b.id);
      });
      summary.textContent=`コメントのある配信 ${selected.length}件 ／ ${lastRunWords.join('・')||'保存済み検索語'} ／ 並び順：${sortSelect.selectedOptions[0]?.textContent||'コメント数が多い順'}（未取得の日時は日付順で後ろ）`;
      if(!selected.length) results.append(el('div',{class:'nor-compact',text:'該当するコメントはまだ保存されていません。検索処理が停止した場合は戻ってエラーを確認してください。'}));
      for(const v of selected) {
        const item=el('div',{class:'nor-video-card'});item.__norVideo=v;
        const thumb=el('button',{type:'button',class:'nor-thumb-button'});
        thumb.append(el('img',{src:`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,alt:'配信サムネイル',loading:'lazy'}));
        thumb.addEventListener('click',()=>showMergedViewer(v));item.append(thumb);
        const info=el('div',{class:'nor-video-info'});
        const title=el('button',{class:'nor-video-title',type:'button',text:videoInfo(v).title});
        title.addEventListener('click',()=>showMergedViewer(v));info.append(title);
        info.append(el('div',{class:'nor-video-date',text:displayDate(videoInfo(v))}));
        const count=button(`💬 ${v.comments.size}件のコメントを見る`,()=>showMergedViewer(v),'nor-count-button');
        info.append(count);
        if(videoInfo(v).channel) info.append(el('div',{class:'nor-video-channel',text:`チャンネル：${videoInfo(v).channel}`}));
        for(const w of v.labels) if(!lastRunWords.length||lastRunWords.includes(w)) info.append(el('span',{class:'nor-light-pill',text:w}));
        item.append(info);results.append(item);
        if(observer) observer.observe(item);
      }
    }
    search.addEventListener('input',redraw);
    sortSelect.addEventListener('change',()=>{resultSort=sortSelect.value;void storeSet(RESULT_SORT_KEY,resultSort);redraw();});
    redraw();viewer.scrollTop=0;
  }
  function showMergedViewer(video) {
    viewer.replaceChildren();viewer.hidden=false;panel.hidden=true;
    trigger.style.setProperty('display','none','important');
    viewer.append(viewerHead('コメントOR統合',showResultsViewer));
    const list=el('div',{class:'nor-comment-list'});
    list.append(el('div',{class:'nor-compact',text:videoInfo(video).title}));
    const meta=el('div',{class:'nor-compact',text:`${displayDate(videoInfo(video))} ／ ${video.comments.size}件 ／ 検索語: ${[...video.labels].join('・')}`});list.append(meta);
    queueVideoMetadata(video,()=>{if(viewer.contains(meta)){list.firstElementChild.textContent=videoInfo(video).title;meta.textContent=`${displayDate(videoInfo(video))} ／ ${video.comments.size}件 ／ 検索語: ${[...video.labels].join('・')}`;}});
    const original=el('a',{href:originalVideoUrl(video),target:'_blank',rel:'noopener noreferrer',text:'元サイトの動画ページを開く'});
    list.append(original);
    const comments=[...video.comments.values()].sort((a,b)=>a.sec-b.sec || a.text.localeCompare(b.text,'ja'));
    if(!comments.length) list.append(el('div',{class:'nor-compact',text:'コメント本文を取得できていません。'}));
    for(const c of comments) {
      const line=el('div',{class:'nor-comment-line'});
      // Never trust c.url in older saved data: it can point to another video's POV.
      const safeUrl=`https://www.youtube.com/watch?v=${video.id}&t=${Math.max(0,Math.floor(Number(c.sec)||0))}s`;
      const time=el('a',{class:'nor-time',href:safeUrl,target:'_blank',rel:'noopener noreferrer',text:hhmmss(c.sec)});
      time.addEventListener('click',e=>e.stopPropagation());
      line.append(time);
      const text=el('div',{class:'nor-comment-text',text:c.text});
      for(const word of c.matchLabels||[]) text.append(el('span',{class:'nor-light-pill',text:word}));
      line.append(text);list.append(line);
    }
    viewer.append(list);viewer.scrollTop=0;
  }
'''
s=s[:start]+new_ui+s[end:]

change("    body.append(el('div',{class:'nor-muted',text:'サイトの通常の検索ページと動画ページを順番に開きます。", "    body.append(el('div',{class:'nor-muted',text:'サイトの通常の検索ページと動画ページを順番に開きます。",'noop anchor test') if False else None
# CSS: preserve existing styles but make the new button/date/sort controls easy to use.
css=r'''  style.textContent += `
    #niji-or-root .nor-sort-row{display:flex;align-items:center;gap:8px;padding:0 0 8px;font-size:13px;color:#364152}
    #niji-or-root .nor-sort-select{width:auto;max-width:100%;margin:0;padding:7px;font-size:13px}
    #niji-or-root .nor-thumb-button{padding:0;border:0;background:none;flex:none;cursor:pointer}
    #niji-or-root .nor-thumb-button img{display:block;width:126px;height:71px;object-fit:cover;border-radius:6px}
    #niji-or-root .nor-video-info{min-width:0;flex:1}
    #niji-or-root .nor-video-title{display:block;width:100%;overflow-wrap:anywhere;line-height:1.5}
    #niji-or-root .nor-video-date{color:#48556a;font-size:12px;margin:5px 0}
    #niji-or-root .nor-video-channel{color:#64748b;font-size:11px;margin:3px 0}
    #niji-or-root .nor-count-button{background:#ecf1ff;border:1px solid #b8c9fa;color:#174aa8;margin:4px 0 5px;padding:7px 11px;font-size:13px;cursor:pointer}
    @media(max-width:600px){#niji-or-root .nor-thumb-button img{width:100px;height:57px}}
  `;
'''
anchor='  const message = el(\'div\', { class:\'nor-muted\' });'
assert s.count(anchor)==1
s=s.replace(anchor,css+anchor,1)

restore='''    if(!labelInput.value && runJob?.words) labelInput.value=runJob.words.join(' ');'''
change(restore,'''    if(!labelInput.value && runJob?.words) labelInput.value=runJob.words.join(' ');
    const savedMeta=await storeGet(VIDEO_META_KEY,{});
    if(savedMeta && typeof savedMeta==='object' && !Array.isArray(savedMeta)) videoMetadata=savedMeta;
    const savedSort=await storeGet(RESULT_SORT_KEY,'comments');
    if(['comments','newest','oldest','title'].includes(savedSort)) resultSort=savedSort;''','restore metadata and sort')

p.write_text(s,encoding='utf-8')
print('PATCH v0.4.6 metadata/link/title/sort applied')

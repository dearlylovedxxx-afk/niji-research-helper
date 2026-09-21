from pathlib import Path
p=Path('Niji_OR_Results_Merger.user.js')
s=p.read_text(encoding='utf-8')
assert '// @version      0.4.0' in s and "const VERSION = '0.4.0';" in s
s=s.replace('// @version      0.4.0','// @version      0.4.1',1)
s=s.replace('複数ワードを1回入力すると検索・全ページ収集・OR統合を自動実行。本体DBは変更しません。','各動画のコメント本文・時刻を実際に収集する複数語OR検索。白背景の動画・コメント一覧。本体DBは変更しません。',1)
s=s.replace("boot.textContent='🔀 OR起動中 0.4.0';","boot.textContent='🔀 OR起動中 0.4.1';",1)
s=s.replace("console.info('[Niji OR Merger] v0.4.0 injected', location.href);","console.info('[Niji OR Merger] v0.4.1 injected', location.href);",1)
s=s.replace("const VERSION = '0.4.0';", "const VERSION = '0.4.1';",1)
s=s.replace("  const MULTI_KEY = 'niji_or_merger_addon_multi_v1';", "  const MULTI_KEY = 'niji_or_merger_addon_multi_v1';\n  const RUN_KEY = 'niji_or_merger_addon_run_v041';\n  const LAST_WORDS_KEY = 'niji_or_merger_addon_last_words_v041';\n  const MAX_RUN_VIDEOS = 150;\n  const MAX_RUN_PAGES = 100;",1)
s=s.replace("  let multiJob = null;", "  let multiJob = null;\n  let runJob = null;\n  let lastRunWords = [];\n  let runDriving = false;",1)

# CSS intentionally overrides only the add-on viewer, not the site's own styles.
anchor="  root.append(style);\n"
addition=r'''  root.append(style);
  style.textContent += `
    #niji-or-root .nor-viewer{background:#fff!important;color:#202124!important;padding:0 0 30px!important;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif!important}
    #niji-or-root .nor-viewer-header{background:#fff!important;color:#202124!important;top:0;padding:13px 15px;border-bottom:1px solid #e5e7eb;box-shadow:0 1px 3px #0001}
    #niji-or-root .nor-viewer .nor-button{background:#f4f5f7;color:#202124;border:1px solid #d7dbe2}
    #niji-or-root .nor-viewer a{color:#1769d2;text-decoration:none}
    #niji-or-root .nor-viewer a:hover{text-decoration:underline}
    #niji-or-root .nor-list{max-width:900px;margin:auto;padding:10px 14px}
    #niji-or-root .nor-video-card{display:flex;gap:12px;align-items:flex-start;border-bottom:1px solid #e9ecef;padding:14px 0;cursor:pointer}
    #niji-or-root .nor-video-card img{width:126px;height:71px;object-fit:cover;border-radius:6px;flex:none}
    #niji-or-root .nor-video-title{font-size:15px;font-weight:600;text-align:left;background:none;border:0;padding:0;color:#182230;cursor:pointer}
    #niji-or-root .nor-video-count{font-size:12px;color:#596579;margin-top:5px}
    #niji-or-root .nor-light-pill{font-size:11px;border-radius:9px;background:#f1efff;color:#5440a3;padding:2px 6px;display:inline-block;margin:2px 3px 0 0}
    #niji-or-root .nor-comment-list{max-width:940px;margin:auto;padding:8px 14px}
    #niji-or-root .nor-comment-line{display:grid;grid-template-columns:78px minmax(0,1fr);gap:9px;align-items:start;padding:5px 0;border-bottom:1px solid #f1f2f5;font-size:15px}
    #niji-or-root .nor-time{white-space:nowrap;font-variant-numeric:tabular-nums;color:#1769d2}
    #niji-or-root .nor-comment-text{white-space:pre-wrap;overflow-wrap:anywhere;color:#202124}
    #niji-or-root .nor-light-input{width:100%;border:1px solid #c8cdd7;border-radius:7px;background:#fff;color:#1c2430;padding:10px;font:inherit;margin:10px 0}
    #niji-or-root .nor-compact{padding:12px 14px;color:#596579;font-size:13px}
    @media(max-width:600px){#niji-or-root .nor-video-card img{width:100px;height:57px}#niji-or-root .nor-comment-line{grid-template-columns:68px minmax(0,1fr);gap:5px;font-size:14px}}
  `;
'''
assert anchor in s; s=s.replace(anchor,addition,1)

start=s.index('  function showMergedViewer(video) {')
end=s.index("  filterInput.addEventListener('input'",start)
replacement=r'''  // v0.4.1: one native same-origin page at a time. Never mistake a video list for comments.
  const isDetailPage=()=>/\/comment\/video\/[\w-]{11}/.test(location.pathname);
  const currentVideoId=()=>videoId(location.href);
  const runWord=()=>runJob?.words?.[runJob.index]||'';
  const saveRun=()=>storeSet(RUN_KEY,runJob);
  function findKeywordForm(detail=false) {
    return [...document.querySelectorAll('form')].find(f=>!withinOwnUi(f) && f.querySelector('[name="keyword"]') && (detail ? isDetailPage() : !isDetailPage())) || null;
  }
  function keywordSearchUrl(form, word) {
    if (!form || String(form.method||'GET').toUpperCase()!=='GET') throw new Error('対応するGET検索フォームが見つかりません');
    const action=new URL(form.getAttribute('action')||location.pathname,location.href);
    if (action.origin!==location.origin || !action.pathname.startsWith('/comment')) throw new Error('検索先URLを確認できません');
    const data=new URLSearchParams(new FormData(form));
    data.set('keyword',word);
    action.search=data.toString();
    action.hash='';
    return action.href;
  }
  async function goRun(url) {
    const u=new URL(url,location.href);
    if (u.origin!==location.origin || !u.pathname.startsWith('/comment')) throw new Error('サイト外への移動はできません');
    await saveRun();
    const waitMs=Math.max(0,3000-(Date.now()-Number(runJob?.lastNavigationAt||0)));
    if (waitMs) await wait(waitMs);
    if (!runJob?.active) return;
    runJob.lastNavigationAt=Date.now();
    await saveRun();
    if (u.href===location.href) location.reload();
    else location.assign(u.href);
  }
  async function failRun(error) {
    if (!runJob) return;
    runJob.active=false;
    runJob.error=String(error?.message||error||'検索に失敗しました');
    await saveRun();
    render();
    message.textContent=`⚠ ${runJob.error}。完了扱いにしていません。取得済みデータは残っています。`;
  }
  async function startRun() {
    if (runDriving || runJob?.active) return;
    const words=parseOrWords(labelInput.value);
    if (!words.length) {message.textContent='OR検索語を入力してください。';return;}
    if (words.length>10) {message.textContent='1回の検索は10語までにしてください。';return;}
    runJob={active:true,words,index:0,stage:'search',list:[],seenPages:[],partial:[],detailIndex:0,pages:0,startedAt:Date.now(),lastNavigationAt:0,error:''};
    lastRunWords=[...words];
    await Promise.all([saveRun(),storeSet(LAST_WORDS_KEY,lastRunWords)]);
    // An old v0.4.0 background job must not restart the obsolete video-only path.
    autoJob=null;multiJob=null;
    await Promise.all([saveAutoJob(),saveMultiJob()]);
    render();
    void driveRun();
  }
  async function stopRun() {
    if (runJob) {runJob.active=false;runJob.error='手動停止しました。';await saveRun();}
    render(); message.textContent='停止しました。保存済みの結果は残っています。';
  }
  async function resumeRun() {
    if (!runJob || runJob.active) return;
    runJob.active=true;runJob.error='';
    await saveRun();render();void driveRun();
  }
  async function finishRunWord() {
    const word=runWord();
    if (runJob.partial.length) {
      const signature=`or-v041|${runJob.startedAt}|${word}`;
      if (!batches.some(b=>b.signature===signature)) {
        if (batches.length>=MAX_BATCHES) throw new Error('保存回数上限に達しました');
        const batch={id:`or-${runJob.startedAt}-${runJob.index}`,label:word,page:runJob.searchUrl||location.href,signature,savedAt:Date.now(),rows:runJob.partial};
        batches.push(batch);
        try {await persist();} catch(err){batches.pop();throw err;}
      }
    }
    runJob.index++;
    if (runJob.index>=runJob.words.length) {
      lastRunWords=[...runJob.words];
      await storeSet(LAST_WORDS_KEY,lastRunWords);
      runJob=null;await saveRun();
      render();showResultsViewer();
      return;
    }
    runJob.stage='search';runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.seenPages=[];runJob.pages=0;
    await saveRun();
    await goRun(new URL('/comment/',location.origin).href);
  }
  function normalizedDetailUrl(v) {
    // Use the actual video's path, but keep the current origin and browser session.
    const u=new URL(v.sourceUrl||`/comment/video/${v.id}/`,location.href);
    if (u.origin!==location.origin && !['comment2434.com','www.comment2434.com'].includes(u.hostname)) throw new Error('動画URLの取得に失敗しました');
    if (!u.pathname.startsWith(`/comment/video/${v.id}`)) throw new Error('動画IDとリンクが一致しません');
    return new URL(u.pathname,location.origin).href;
  }
  async function driveRun() {
    if (runDriving || !runJob?.active) return;
    runDriving=true;
    try {
      const word=runWord();
      if (!word) throw new Error('検索語を復元できません');
      if (/429|Too Many Requests|アクセスが集中しています/i.test(document.title)) throw new Error('アクセス制限が発生しています');
      if (runJob.stage==='search') {
        if (isDetailPage() || !findKeywordForm()) {await goRun(new URL('/comment/',location.origin).href);return;}
        runJob.searchUrl=keywordSearchUrl(findKeywordForm(),word);
        runJob.stage='list';runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.seenPages=[];runJob.pages=0;
        await goRun(runJob.searchUrl);return;
      }
      if (runJob.stage==='list') {
        if (isDetailPage() || new URLSearchParams(location.search).get('keyword')!==word) throw new Error('検索結果ページを確認できません。サイトの検索形式が変わった可能性があります');
        if (runJob.seenPages.includes(location.href)) throw new Error('同じ検索ページが繰り返されたため停止しました');
        const found=captureDisplayed().rows;
        if (!found.length) {
          if (runJob.pages===0 && /(?:検索結果|コメント).{0,20}(?:0件|ありません|見つかりません|該当なし)/.test(document.body.textContent||'')) {await finishRunWord();return;}
          throw new Error('検索結果の動画を取得できません。アクセス制限またはサイト変更の可能性があります');
        }
        runJob.seenPages.push(location.href);runJob.pages++;
        for(const item of found) if (!runJob.list.some(v=>v.id===item.id)) runJob.list.push({id:item.id,title:item.title,sourceUrl:item.sourceUrl,channel:item.channel});
        if(runJob.list.length>MAX_RUN_VIDEOS) throw new Error(`安全上限${MAX_RUN_VIDEOS}動画を超えたため停止しました（未取得の結果があります）`);
        const next=nextPageControl();
        const nextUrl=next?.matches('a[href]')?new URL(next.getAttribute('href'),location.href):null;
        if (next && !nextUrl) throw new Error('サイトのページ送り方式を確認できません');
        if (nextUrl && (nextUrl.origin!==location.origin || !nextUrl.pathname.startsWith('/comment') || runJob.seenPages.includes(nextUrl.href))) throw new Error('次の検索ページを安全に特定できません');
        if (nextUrl && runJob.pages>=MAX_RUN_PAGES) throw new Error('100ページ上限に達しました（未取得の結果があります）');
        if(nextUrl){await goRun(nextUrl.href);return;}
        runJob.stage='detail-open';runJob.detailIndex=0;
        await saveRun();
      }
      if (runJob.stage==='detail-open') {
        const v=runJob.list[runJob.detailIndex];
        if(!v){await finishRunWord();return;}
        if(!isDetailPage() || currentVideoId()!==v.id){await goRun(normalizedDetailUrl(v));return;}
        const form=findKeywordForm(true);
        if(!form) throw new Error(`動画 ${v.id} にコメント検索欄が見つかりません`);
        const url=keywordSearchUrl(form,word);
        if(new URL(url).pathname!==location.pathname || new URLSearchParams(new URL(url).search).get('keyword')!==word) throw new Error('動画のキーワード検索URLが不正です');
        runJob.stage='detail-results';await goRun(url);return;
      }
      if (runJob.stage==='detail-results') {
        const v=runJob.list[runJob.detailIndex];
        if(!v || !isDetailPage() || currentVideoId()!==v.id || new URLSearchParams(location.search).get('keyword')!==word) throw new Error('動画の検索結果URLを確認できません');
        const main=document.querySelector('main')||document.body;
        const comments=extractComments(main,v.id);
        if(!comments.length && !/(?:コメント|検索結果|該当).{0,25}(?:0件|ありません|なし|見つかりません)/.test(main.textContent||'')) throw new Error(`動画 ${v.id} のコメント本文を読み取れません。0件として保存せず停止しました`);
        const map=new Map(comments.map(c=>[`${c.sec}|${c.text}`,c]));
        runJob.partial.push({id:v.id,title:v.title,sourceUrl:v.sourceUrl,channel:v.channel||'',comments:[...map.values()]});
        runJob.detailIndex++;
        runJob.stage='detail-open';
        await saveRun();
        const nextVideo=runJob.list[runJob.detailIndex];
        if(nextVideo){await goRun(normalizedDetailUrl(nextVideo));return;}
        await finishRunWord();return;
      }
      throw new Error(`不明な検索状態: ${runJob.stage}`);
    } catch(err) {console.warn('[Niji OR Merger][v0.4.1]',err);await failRun(err);}
    finally {runDriving=false;}
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
    const results=el('div');
    wrap.append(summary,search,results);viewer.append(wrap);
    function redraw() {
      results.replaceChildren();
      const q=clip(search.value,200).toLowerCase();
      const selected=mergedVideos().filter(v=>v.comments.size && (!lastRunWords.length || [...v.labels].some(w=>lastRunWords.includes(w))))
        .filter(v=>!q || `${v.title} ${[...v.labels].join(' ')}`.toLowerCase().includes(q))
        .sort((a,b)=>b.comments.size-a.comments.size);
      summary.textContent=`コメントのある配信 ${selected.length}件 ／ ${lastRunWords.join('・')||'保存済み検索語'}（0件の動画は表示しません）`;
      if(!selected.length) results.append(el('div',{class:'nor-compact',text:'該当するコメントはまだ保存されていません。検索処理が停止した場合は戻ってエラーを確認してください。'}));
      for(const v of selected) {
        const item=el('div',{class:'nor-video-card'});
        item.append(el('img',{src:`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,alt:'サムネイル',loading:'lazy'}));
        const info=el('div');
        info.append(el('button',{class:'nor-video-title',type:'button',text:v.title}));
        info.firstElementChild.addEventListener('click',()=>showMergedViewer(v));
        info.append(el('div',{class:'nor-video-count',text:`💬 ${v.comments.size}件のコメント ／ ${v.id}`}));
        for(const w of v.labels) if(!lastRunWords.length||lastRunWords.includes(w)) info.append(el('span',{class:'nor-light-pill',text:w}));
        item.append(info);results.append(item);
      }
    }
    search.addEventListener('input',redraw);redraw();viewer.scrollTop=0;
  }
  function showMergedViewer(video) {
    viewer.replaceChildren();viewer.hidden=false;panel.hidden=true;
    trigger.style.setProperty('display','none','important');
    viewer.append(viewerHead('コメントOR統合',showResultsViewer));
    const list=el('div',{class:'nor-comment-list'});
    list.append(el('div',{style:'',class:'nor-compact',text:video.title}));
    const meta=el('div',{class:'nor-compact',text:`${video.comments.size}件 ／ 検索語: ${[...video.labels].join('・')}`});list.append(meta);
    const original=el('a',{href:originalVideoUrl(video),target:'_blank',rel:'noopener noreferrer',text:'元サイトの動画ページを開く'});
    list.append(original);
    const comments=[...video.comments.values()].sort((a,b)=>a.sec-b.sec || a.text.localeCompare(b.text,'ja'));
    if(!comments.length) list.append(el('div',{class:'nor-compact',text:'コメント本文を取得できていません。'}));
    for(const c of comments) {
      const line=el('div',{class:'nor-comment-line'});
      line.append(el('a',{class:'nor-time',href:c.url||`https://www.youtube.com/watch?v=${video.id}&t=${c.sec}s`,target:'_blank',rel:'noopener noreferrer',text:hhmmss(c.sec)}));
      const text=el('div',{class:'nor-comment-text',text:c.text});
      for(const word of c.matchLabels||[]) text.append(el('span',{class:'nor-light-pill',text:word}));
      line.append(text);list.append(line);
    }
    viewer.append(list);viewer.scrollTop=0;
  }
  function render() {
    body.replaceChildren();
    body.append(el('div',{class:'nor-muted',text:'複数の語をまとめて入力 → 検索開始を1回。動画ごとのコメント本文と時刻を収集して統合します。'}));
    body.append(labelInput);
    body.append(el('div',{class:'nor-row'},button('🔍 OR検索開始',()=>void startRun(),'primary'),button('📖 結果を見る',showResultsViewer,'primary')));
    if(runJob) {
      const word=runWord();
      body.append(el('div',{class:'nor-note',text:`${runJob.active?'🔄 収集中':'⏸ 停止中'} ${runJob.index+1}/${runJob.words.length}「${word}」 ／ ${runJob.stage==='list'?`${runJob.pages}ページ・${runJob.list.length}動画`: `${runJob.detailIndex||0}/${runJob.list?.length||0}動画のコメント取得`} ${runJob.error||''}`}));
      body.append(el('div',{class:'nor-row'},runJob.active?button('■ 停止',()=>void stopRun()):button('▶ 再開',()=>void resumeRun())));
    }
    const all=mergedVideos(), withComments=all.filter(v=>v.comments.size);
    body.append(el('div',{class:'nor-note',text:`保存済み：${withComments.length}動画・${withComments.reduce((n,v)=>n+v.comments.size,0)}コメント。コメント0件の動画は結果一覧に出しません。`}),message);
    const advanced=el('details');advanced.append(el('summary',{text:'詳細・バックアップ・診断'}));
    advanced.append(el('div',{class:'nor-row'},button('💾 データをバックアップ',exportBackup),button('📄 診断をコピー',copyDiag),button('すべて削除',clearAll)));
    body.append(advanced);
    body.append(el('div',{class:'nor-muted',text:'サイトの通常の検索ページと動画ページを順番に開きます。1アクセスあたり約3秒間隔。制限・構造変更・上限時は、未取得分を完了扱いせず停止します。本体DBは変更しません。'}));
  }
'''
s=s[:start]+replacement+s[end:]
# Disable the old v0.4.0 multiword collector. It counted video-only pages as completed.
old="  if(multiJob?.active) void resumeMultiOr();\n  else if(autoJob?.active) void autoCollect();"
new="""  try {
    const savedRun=await storeGet(RUN_KEY,null);
    if(savedRun?.words && Array.isArray(savedRun.words)) runJob=savedRun;
    const last=await storeGet(LAST_WORDS_KEY,[]);
    if(Array.isArray(last)) lastRunWords=last;
    if(!labelInput.value && runJob?.words) labelInput.value=runJob.words.join(' ');
  } catch(err) {console.warn('[Niji OR Merger] v0.4.1 restore',err);}
  render();
  if(runJob?.active) void driveRun();"""
assert old in s;s=s.replace(old,new,1)
# The old resume path was loaded into memory but never executed; retained storage keys are not deleted.
p.write_text(s,encoding='utf-8')
print('v0.4.1 staged:',len(s),'bytes')

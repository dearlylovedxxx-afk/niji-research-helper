from pathlib import Path

path = Path('Niji_OR_Results_Merger.user.js')
s = path.read_text(encoding='utf-8')

def once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected one match; found {count}')
    s = s.replace(old, new, 1)

once('// @version      0.4.4', '// @version      0.4.5', 'metadata version')
once('空の最終ページで止まる問題を修正。取得したコメントは動画単位で保存。白背景のOR結果一覧。', '150動画ごとに途中保存して一時停止し、続きからOR検索を再開できます。', 'description')
once("boot.textContent='🔀 OR起動中 0.4.4';", "boot.textContent='🔀 OR起動中 0.4.5';", 'boot version')
once("console.info('[Niji OR Merger] v0.4.4 injected', location.href);", "console.info('[Niji OR Merger] v0.4.5 injected', location.href);", 'log version')
once("const VERSION = '0.4.4';", "const VERSION = '0.4.5';", 'runtime version')

once("    runJob={active:true,words,minComments,index:0,stage:'search',list:[],seenPages:[],partial:[],detailIndex:0,pages:0,startedAt:Date.now(),lastNavigationAt:0,error:''};", "    runJob={active:true,words,minComments,index:0,stage:'search',list:[],seenPages:[],collectedIds:[],pendingNextUrl:'',chunkPages:0,completedVideos:0,partial:[],detailIndex:0,pages:0,startedAt:Date.now(),lastNavigationAt:0,error:''};", 'new run state')

old_resume = '''  async function resumeRun() {
    if (!runJob || runJob.active) return;
    runJob.active=true;runJob.error='';
    await saveRun();render();void driveRun();
  }
'''
new_resume = '''  async function resumeRun() {
    if (!runJob || runJob.active || runDriving) return;
    if (runJob.stage==='chunk-paused') {
      if (!runJob.pendingNextUrl) {message.textContent='続きの検索ページが保存されていません。完了扱いにせず停止します。';return;}
      runJob.stage='chunk-nav';
    } else if (runJob.stage==='list' && /安全上限\\d+動画を超えた/.test(runJob.error||'') && runJob.list?.length>=MAX_RUN_VIDEOS) {
      // Resume v0.4.3/v0.4.4 jobs stopped with 160 videos on page 16.
      // Reopen their last SAVED list page instead of scanning from page one.
      runJob.stage='legacy-limit-prepare';
      runJob.collectedIds=[...new Set([...(runJob.collectedIds||[]),...runJob.list.map(v=>v.id)])];
    }
    runJob.active=true;runJob.error='';
    await saveRun();render();void driveRun();
  }
'''
once(old_resume,new_resume,'resume with legacy migration')

old_begin = '''  async function beginDetailsAfterList() {
    if (!runJob?.list?.length) throw new Error('コメント取得対象の動画がありません');
    runJob.stage='detail-open';runJob.detailIndex=0;
    await saveRun();
    const first=runJob.list[0];
    await goRun(normalizedDetailUrl(first));
  }
'''
new_begin = '''  function nextResultPageUrl() {
    const next=nextPageControl();
    if (!next) return '';
    if (!next.matches('a[href]')) throw new Error('次の検索ページのURLを確認できません');
    const url=new URL(next.getAttribute('href'),location.href);
    const current=new URL(location.href);
    if (url.origin!==location.origin || !url.pathname.startsWith('/comment') || url.searchParams.get('keyword')!==runWord()) throw new Error('次の検索ページを安全に特定できません');
    if (current.searchParams.has('least_count') && url.searchParams.get('least_count')!==current.searchParams.get('least_count')) throw new Error('次のページで最低コメント数が維持されません。停止しました');
    if (runJob.seenPages.includes(url.href)) throw new Error('同じ検索ページが繰り返されるため停止しました');
    return url.href;
  }
  async function beginDetailsAfterList() {
    if (!runJob?.list?.length) throw new Error('コメント取得対象の動画がありません');
    runJob.stage='detail-open';runJob.detailIndex=0;
    await saveRun();
    const first=runJob.list[0];
    await goRun(normalizedDetailUrl(first));
  }
  async function pauseRunChunk() {
    if (!runJob?.active || runJob.stage==='chunk-paused') return;
    if (!runJob.pendingNextUrl) throw new Error('続きを示すページURLが見つかりません');
    await persistRunPartial();
    runJob.completedVideos=(runJob.completedVideos||0)+runJob.list.length;
    runJob.stage='chunk-paused';
    runJob.active=false;
    runJob.error='';
    runJob.note=`${runJob.pages}ページ・累計${runJob.collectedIds?.length||runJob.completedVideos}動画を確認済み。続きは「続きから収集」で再開できます。`;
    await saveRun();
    render();
    message.textContent='✅ 今回の動画のコメント取得を保存しました。次の検索ページから再開できます。';
  }
'''
once(old_begin,new_begin,'next page and chunk pause functions')

old_word = "    runJob.stage='search';runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.seenPages=[];runJob.pages=0;"
new_word = "    runJob.stage='search';runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.seenPages=[];runJob.collectedIds=[];runJob.pendingNextUrl='';runJob.chunkPages=0;runJob.pages=0;runJob.note='';"
once(old_word,new_word,'next word resets only per-word state')

old_drive_head = '''      if (/429|Too Many Requests|アクセスが集中しています/i.test(document.title)) throw new Error('アクセス制限が発生しています');
      if (runJob.stage==='search') {'''
new_drive_head = '''      if (/429|Too Many Requests|アクセスが集中しています/i.test(document.title)) throw new Error('アクセス制限が発生しています');
      if (runJob.stage==='legacy-limit-prepare') {
        const last=runJob.seenPages?.[runJob.seenPages.length-1];
        if (!last || !runJob.list?.length) throw new Error('旧版の検索進捗を確認できません。完了扱いにはしていません');
        if (location.href!==last) {await goRun(last);return;}
        runJob.pendingNextUrl=nextResultPageUrl();
        runJob.chunkPages=runJob.pages;
        await beginDetailsAfterList();return;
      }
      if (runJob.stage==='chunk-nav') {
        const target=runJob.pendingNextUrl;
        if (!target) throw new Error('続きのページURLがありません');
        const u=new URL(target,location.href);
        if (u.origin!==location.origin || !u.pathname.startsWith('/comment') || u.searchParams.get('keyword')!==word || runJob.seenPages.includes(u.href)) throw new Error('続きのページURLが検索条件と一致しません');
        if (location.href!==u.href) {await goRun(u.href);return;}
        // Clear ONLY the previous chunk, never the saved comments or visited pages.
        runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.chunkPages=0;runJob.pendingNextUrl='';runJob.note='';runJob.stage='list';
        await saveRun();
      }
      if (runJob.stage==='search') {'''
once(old_drive_head,new_drive_head,'resume stage routing')

old_search = "        runJob.stage='list';runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.seenPages=[];runJob.pages=0;"
new_search = "        runJob.stage='list';runJob.list=[];runJob.partial=[];runJob.detailIndex=0;runJob.seenPages=[];runJob.collectedIds=[];runJob.pendingNextUrl='';runJob.chunkPages=0;runJob.pages=0;"
once(old_search,new_search,'new word search state')

old_list = '''        runJob.seenPages.push(location.href);runJob.pages++;
        for(const item of found) if (!runJob.list.some(v=>v.id===item.id)) runJob.list.push({id:item.id,title:item.title,sourceUrl:item.sourceUrl,channel:item.channel});
        if(runJob.list.length>MAX_RUN_VIDEOS) throw new Error(`安全上限${MAX_RUN_VIDEOS}動画を超えたため停止しました（未取得の結果があります）`);
        const next=nextPageControl();
        const nextUrl=next?.matches('a[href]')?new URL(next.getAttribute('href'),location.href):null;
        if (next && !nextUrl) throw new Error('サイトのページ送り方式を確認できません');
        if (nextUrl && (nextUrl.origin!==location.origin || !nextUrl.pathname.startsWith('/comment') || runJob.seenPages.includes(nextUrl.href))) throw new Error('次の検索ページを安全に特定できません');
        if (nextUrl && runJob.pages>=MAX_RUN_PAGES) throw new Error('100ページ上限に達しました（未取得の結果があります）');
        if(nextUrl){await goRun(nextUrl.href);return;}
        await beginDetailsAfterList();return;'''
new_list = '''        runJob.seenPages.push(location.href);runJob.pages++;runJob.chunkPages=(runJob.chunkPages||0)+1;
        if (!Array.isArray(runJob.collectedIds)) runJob.collectedIds=runJob.list.map(v=>v.id);
        const known=new Set(runJob.collectedIds);
        for(const item of found) if (!known.has(item.id)) {
          runJob.list.push({id:item.id,title:item.title,sourceUrl:item.sourceUrl,channel:item.channel});
          runJob.collectedIds.push(item.id);known.add(item.id);
        }
        const nextUrl=nextResultPageUrl();
        if (nextUrl && (runJob.list.length>=MAX_RUN_VIDEOS || runJob.chunkPages>=MAX_RUN_PAGES)) {
          runJob.pendingNextUrl=nextUrl;
          if (runJob.list.length) {await beginDetailsAfterList();return;}
          await pauseRunChunk();return;
        }
        if(nextUrl){await goRun(nextUrl);return;}
        if(runJob.list.length){await beginDetailsAfterList();return;}
        await finishRunWord();return;'''
once(old_list,new_list,'bounded resumable list pages')

old_detail_0 = "        if(!v){await finishRunWord();return;}"
new_detail_0 = "        if(!v){if(runJob.pendingNextUrl) await pauseRunChunk();else await finishRunWord();return;}"
once(old_detail_0,new_detail_0,'empty detail page boundary')

old_detail_end = "        if(nextVideo){await goRun(normalizedDetailUrl(nextVideo));return;}\n        await finishRunWord();return;"
new_detail_end = "        if(nextVideo){await goRun(normalizedDetailUrl(nextVideo));return;}\n        if(runJob.pendingNextUrl) await pauseRunChunk();\n        else await finishRunWord();\n        return;"
once(old_detail_end,new_detail_end,'pause after processing full chunk')

old_ui_note = "例：10なら、各検索語に一致するコメントが10件以上ある動画だけを検索サイト側で絞り込みます。OR合計10件ではありません。150動画の上限は維持します。"
new_ui_note = "例：10なら、各検索語に一致するコメントが10件以上ある動画を検索します。150動画ごとに保存・一時停止し、ボタン1回で続きから収集できます。"
once(old_ui_note,new_ui_note,'explain chunk pause')

old_ui = '''      body.append(el('div',{class:'nor-note',text:`${runJob.active?'🔄 収集中':'⏸ 停止中'} 最低${runJob.minComments??1}件／語 ${runJob.index+1}/${runJob.words.length}「${word}」 ／ ${runJob.stage==='list'?`${runJob.pages}ページ・${runJob.list.length}動画`: `${runJob.detailIndex||0}/${runJob.list?.length||0}動画のコメント取得`} ${runJob.note||''} ${runJob.error||''}`}));
      body.append(el('div',{class:'nor-row'},runJob.active?button('■ 停止',()=>void stopRun()):button('▶ 再開',()=>void resumeRun())));'''
new_ui = '''      const checkpoint=runJob.stage==='chunk-paused';
      const recovering=runJob.stage==='list' && /安全上限\\d+動画を超えた/.test(runJob.error||'');
      const progress=runJob.stage==='list'?`${runJob.pages}ページ・今回${runJob.list.length}動画`:`${runJob.detailIndex||0}/${runJob.list?.length||0}動画のコメント取得`;
      body.append(el('div',{class:'nor-note',text:`${checkpoint?'✅ 保存済み・続き待ち':runJob.active?'🔄 収集中':'⏸ 停止中'} 最低${runJob.minComments??1}件／語 ${runJob.index+1}/${runJob.words.length}「${word}」 ／ ${progress} ${runJob.note||''} ${runJob.error||''}`}));
      const resumeText=checkpoint?'▶ 続きから収集':recovering?'▶ 取得済み動画から再開':'▶ 再開';
      body.append(el('div',{class:'nor-row'},runJob.active?button('■ 停止',()=>void stopRun()):button(resumeText,()=>void resumeRun())));'''
once(old_ui,new_ui,'status and continue button')

old_footer = '制限・構造変更・上限時は、未取得分を完了扱いせず停止します。'
new_footer = '約150動画ごとに進捗を保存して一時停止します。アクセス制限やサイト構造変更時は、自動再試行せず停止します。'
once(old_footer,new_footer,'footnote')

path.write_text(s,encoding='utf-8')
print('PATCHED v0.4.5: checkpointed 150-video chunks, legacy v0.4.4 resume, dedup and next-page validation')

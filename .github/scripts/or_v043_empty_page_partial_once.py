from pathlib import Path
p=Path('Niji_OR_Results_Merger.user.js')
s=p.read_text(encoding='utf-8')

def replace(old,new):
    global s
    count=s.count(old)
    assert count==1, f'Expected one match, found {count}: {old[:110]!r}'
    s=s.replace(old,new,1)

replace('// @version      0.4.2','// @version      0.4.3')
replace("console.info('[Niji OR Merger] v0.4.2 injected', location.href);","console.info('[Niji OR Merger] v0.4.3 injected', location.href);")
replace("const VERSION = '0.4.2';","const VERSION = '0.4.3';")
replace('各動画のコメント本文・時刻を実際に収集する複数語OR検索。白背景の動画・コメント一覧。本体DBは変更しません。','空の最終ページで止まる問題を修正。取得したコメントは動画単位で保存。白背景のOR結果一覧。本体DBは変更しません。')
replace("boot.textContent='🔀 OR起動中 0.4.2';","boot.textContent='🔀 OR起動中 0.4.3';")

# Keep existing storage keys and entire previous collection. A v0.4.2 paused job is resumable.
anchor="  async function finishRunWord() {"
insert='''  async function persistRunPartial() {
    if (!runJob?.partial?.length) return;
    const word=runWord();
    if (!word) throw new Error('保存する検索語を復元できません');
    const rows=runJob.partial.filter(v=>Array.isArray(v.comments)&&v.comments.length);
    if (!rows.length) return;
    const signature=`or-v041|${runJob.startedAt}|${word}`;
    const existing=batches.find(b=>b.signature===signature);
    if(existing) {
      const previous=existing.rows;
      const byId=new Map((previous||[]).map(v=>[v.id,v]));
      for(const v of rows) {
        const old=byId.get(v.id);
        if (!old) {byId.set(v.id,v);continue;}
        const comments=new Map([...(old.comments||[]),...v.comments].map(c=>[`${c.sec}|${c.text}`,c]));
        byId.set(v.id,{...old,...v,comments:[...comments.values()]});
      }
      existing.rows=[...byId.values()];
      try {await persist();} catch(err){existing.rows=previous;throw err;}
      return;
    }
    if(batches.length>=MAX_BATCHES) throw new Error('保存回数上限に達しました');
    const batch={id:`or-${runJob.startedAt}-${runJob.index}`,label:word,page:runJob.searchUrl||location.href,signature,savedAt:Date.now(),rows:[...rows]};
    batches.push(batch);
    try {await persist();} catch(err){batches.pop();throw err;}
  }
  async function beginDetailsAfterList() {
    if (!runJob?.list?.length) throw new Error('コメント取得対象の動画がありません');
    runJob.stage='detail-open';runJob.detailIndex=0;
    await saveRun();
    const first=runJob.list[0];
    await goRun(normalizedDetailUrl(first));
  }
  function looksLikeAccessDenied() {
    const main=document.querySelector('main')||document.body;
    const text=String(main?.textContent||'').slice(0,9000);
    return /\\b(?:429|403|503|Too Many Requests|Access Denied|Rate Limit)\\b|アクセス(?:制限|が集中)|しばらく時間をおいて/i.test(`${document.title} ${text}`);
  }
'''
replace(anchor,insert+anchor)
old='''    if (runJob.partial.length) {
      const signature=`or-v041|${runJob.startedAt}|${word}`;
      if (!batches.some(b=>b.signature===signature)) {
        if (batches.length>=MAX_BATCHES) throw new Error('保存回数上限に達しました');
        const batch={id:`or-${runJob.startedAt}-${runJob.index}`,label:word,page:runJob.searchUrl||location.href,signature,savedAt:Date.now(),rows:runJob.partial};
        batches.push(batch);
        try {await persist();} catch(err){batches.pop();throw err;}
      }
    }'''
replace(old,"    await persistRunPartial();")

old='''        const found=captureDisplayed().rows;
        if (!found.length) {
          if (runJob.pages===0 && /(?:検索結果|コメント).{0,20}(?:0件|ありません|見つかりません|該当なし)/.test(document.body.textContent||'')) {await finishRunWord();return;}
          throw new Error('検索結果の動画を取得できません。アクセス制限またはサイト変更の可能性があります');
        }'''
new='''        let found=captureDisplayed().rows;
        if (!found.length) {
          // Some result pagers link one page beyond their actual last page.
          // Wait for delayed DOM rendering before interpreting a blank page.
          for (let attempt=0;attempt<3 && !found.length;attempt++) {
            await wait(650);
            found=captureDisplayed().rows;
          }
        }
        if (!found.length) {
          if (looksLikeAccessDenied()) throw new Error('アクセス制限と思われるページです。自動収集を停止しました');
          if (runJob.pages===0 && /(?:検索結果|コメント).{0,25}(?:0件|ありません|見つかりません|該当なし)/.test(document.body.textContent||'')) {await finishRunWord();return;}
          if (runJob.pages>0 && runJob.list.length && findKeywordForm()) {
            // Keep a note: an unexpected empty page could also mean a changed site.
            runJob.note=`${runJob.pages}ページ・${runJob.list.length}動画の後に空ページがありました。取得済み動画のコメントを収集中です。`;
            await beginDetailsAfterList();return;
          }
          throw new Error('検索結果の動画を取得できません。検索ページの構造やアクセス制限を確認してください');
        }'''
replace(old,new)

old='''        runJob.stage='detail-open';runJob.detailIndex=0;
        await saveRun();
      }
      if (runJob.stage==='detail-open') {'''
new='''        await beginDetailsAfterList();return;
      }
      if (runJob.stage==='detail-open') {'''
replace(old,new)

old='''        runJob.detailIndex++;
        runJob.stage='detail-open';
        await saveRun();'''
new='''        runJob.detailIndex++;
        runJob.stage='detail-open';
        await saveRun();
        // Make each successfully fetched video's comments visible immediately.
        // A later error must not erase already collected comment timestamps.
        await persistRunPartial();'''
replace(old,new)

replace("  labelInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void startMultiOr();}});","  labelInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void startRun();}});")
old="""      body.append(el('div',{class:'nor-note',text:`${runJob.active?'🔄 収集中':'⏸ 停止中'} ${runJob.index+1}/${runJob.words.length}「${word}」 ／ ${runJob.stage==='list'?`${runJob.pages}ページ・${runJob.list.length}動画`: `${runJob.detailIndex||0}/${runJob.list?.length||0}動画のコメント取得`} ${runJob.error||''}`}));"""
new="""      body.append(el('div',{class:'nor-note',text:`${runJob.active?'🔄 収集中':'⏸ 停止中'} ${runJob.index+1}/${runJob.words.length}「${word}」 ／ ${runJob.stage==='list'?`${runJob.pages}ページ・${runJob.list.length}動画`: `${runJob.detailIndex||0}/${runJob.list?.length||0}動画のコメント取得`} ${runJob.note||''} ${runJob.error||''}`}));"""
replace(old,new)

# Regression anchors: do not change the two existing storage namespaces.
assert "const STORAGE_KEY = 'niji_or_merger_addon_batches_v1';" in s
assert "const RUN_KEY = 'niji_or_merger_addon_run_v041';" in s
assert "const MULTI_KEY = 'niji_or_merger_addon_multi_v1';" in s
assert "@namespace    niji-or-results-merger-standalone" in s
p.write_text(s,encoding='utf-8')
print('PATCH v0.4.3: empty page handling, incremental comments, original storage compatibility')

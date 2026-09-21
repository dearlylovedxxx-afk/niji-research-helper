from pathlib import Path

p=Path('Niji_OR_Results_Merger.user.js')
s=p.read_text(encoding='utf-8')

def once(old,new):
    global s
    n=s.count(old)
    assert n==1, f'Expected one anchor, found {n}: {old[:100]!r}'
    s=s.replace(old,new,1)

assert '// @version      0.4.3' in s
once('// @version      0.4.3', '// @version      0.4.4')
once("console.info('[Niji OR Merger] v0.4.3 injected'", "console.info('[Niji OR Merger] v0.4.4 injected'")
once("const VERSION = '0.4.3';", "const VERSION = '0.4.4';")
once("  const LAST_WORDS_KEY = 'niji_or_merger_addon_last_words_v041';", "  const LAST_WORDS_KEY = 'niji_or_merger_addon_last_words_v041';\n  const MIN_COMMENTS_KEY = 'niji_or_merger_addon_minimum_v1';")
once("  const filterInput = el('input', { class:'nor-input' }); filterInput.placeholder = '統合結果内を絞り込み（タイトル・検索語）';", """  const minimumInput = el('input', {class:'nor-input', type:'number'});
  minimumInput.min='1'; minimumInput.max='9999'; minimumInput.step='1'; minimumInput.inputMode='numeric';
  minimumInput.value='10'; minimumInput.placeholder='例：10';
  minimumInput.style.cssText='max-width:115px;flex:none;';
  const filterInput = el('input', { class:'nor-input' }); filterInput.placeholder = '統合結果内を絞り込み（タイトル・検索語）';""")
once("    data.set('keyword',word);\n    action.search=data.toString();", """    data.set('keyword',word);
    if (!isDetailPage()) {
      // The site's search form provides a native minimum-hit filter; filter BEFORE collecting videos.
      if (!form.querySelector('[name="least_count"]')) throw new Error('検索サイトの最低コメント数欄が見つかりません。フィルターなしで大量取得せず停止しました');
      const minimum=Number(runJob?.minComments ?? 1); // pre-v0.4.4 paused jobs keep their original unfiltered meaning
      if (!Number.isSafeInteger(minimum) || minimum<1 || minimum>9999) throw new Error('最低コメント数の設定を確認できません');
      data.set('least_count',String(minimum));
    }
    action.search=data.toString();""")
once("    if (words.length>10) {message.textContent='1回の検索は10語までにしてください。';return;}\n    runJob={active:true,words,index:0,stage:'search'", """    if (words.length>10) {message.textContent='1回の検索は10語までにしてください。';return;}
    const minComments=Number(minimumInput.value.trim());
    if(!Number.isSafeInteger(minComments)||minComments<1||minComments>9999){message.textContent='最低コメント数は1〜9999の整数で指定してください。';minimumInput.focus();return;}
    await storeSet(MIN_COMMENTS_KEY,minComments);
    runJob={active:true,words,minComments,index:0,stage:'search'""")
once("    body.append(labelInput);\n    body.append(el('div',{class:'nor-row'},button('🔍 OR検索開始'", """    body.append(labelInput);
    const minimumRow=el('div',{class:'nor-row'});
    minimumRow.append(el('label',{text:'最低コメント数（1語・1動画あたり）'}),minimumInput);
    body.append(minimumRow);
    body.append(el('div',{class:'nor-muted',text:'例：10なら、各検索語に一致するコメントが10件以上ある動画だけを検索サイト側で絞り込みます。OR合計10件ではありません。150動画の上限は維持します。'}));
    body.append(el('div',{class:'nor-row'},button('🔍 OR検索開始'""")
once("      body.append(el('div',{class:'nor-note',text:`${runJob.active?'🔄 収集中':'⏸ 停止中'} ${runJob.index+1}/${runJob.words.length}「${word}」 ／", "      body.append(el('div',{class:'nor-note',text:`${runJob.active?'🔄 収集中':'⏸ 停止中'} 最低${runJob.minComments??1}件／語 ${runJob.index+1}/${runJob.words.length}「${word}」 ／")
once("      body.append(el('div',{class:'nor-row'},runJob.active?button('■ 停止',()=>void stopRun()):button('▶ 再開',()=>void resumeRun())));", """      body.append(el('div',{class:'nor-row'},runJob.active?button('■ 停止',()=>void stopRun()):button('▶ 再開',()=>void resumeRun())));
      if(!runJob.active) body.append(el('div',{class:'nor-muted',text:'最低件数を変えた場合は「OR検索開始」で新しく検索してください。「再開」は前回の条件を引き継ぎます。保存済みコメントは削除しません。'}));""")
once("    if(Array.isArray(last)) lastRunWords=last;", """    if(Array.isArray(last)) lastRunWords=last;
    const savedMin=await storeGet(MIN_COMMENTS_KEY,null);
    if(Number.isSafeInteger(savedMin)&&savedMin>=1&&savedMin<=9999) minimumInput.value=String(savedMin);""")
p.write_text(s,encoding='utf-8')
print('Patched OR v0.4.4: native least_count before video collection, persisted numeric UI, legacy run compatibility')

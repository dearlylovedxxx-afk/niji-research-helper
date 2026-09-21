from pathlib import Path
p=Path('X_Search_Favorites.user.js')
s=p.read_text(encoding='utf-8')
def patch(old,new,label):
 global s
 n=s.count(old)
 if n != 1: raise AssertionError(f'{label}: expected once got {n}')
 s=s.replace(old,new,1)
patch('// @version      1.1.1','// @version      1.1.2','header')
patch("const VERSION='1.1.1', KEY=", "const VERSION='1.1.2', KEY=",'constant')
patch('const hidden=new Map();',"const hidden=new Map();\nlet scanRunning=false, scanStop=false, scanStep=0, scanLimit=150, scanNotice='', scanOriginalY=0;\n",'scan state')
patch('sh.append(css);const bar=',r'''// The like results are a proper full-screen workspace, not a 460px sidebar.
css.textContent+=`#sorted{inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;max-height:none!important;bottom:auto!important;right:auto!important;border:0!important;border-radius:0!important;box-shadow:none!important;padding:20px max(18px,calc((100vw - 1060px)/2)) 60px!important;font:15px/1.6 system-ui!important;z-index:5!important;overscroll-behavior:contain!important}#sorted h2{font-size:23px!important;margin:4px 0 12px!important}#sorted .result-head{position:sticky;top:-20px;z-index:2;background:var(--bg);border-bottom:1px solid var(--edge);padding:12px 0;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}#sorted .result-head button{font-size:14px;min-height:42px}#sorted .result-count{font-size:13px;color:var(--muted);margin:12px 0}#sorted .result-card{display:flex;gap:16px;align-items:flex-start;padding:20px 10px;border-bottom:1px solid var(--edge)}#sorted .result-rank{font:750 18px system-ui;min-width:46px;color:var(--muted)}#sorted .result-content{flex:1;min-width:0}#sorted .result-byline{font-weight:700;font-size:14px;overflow-wrap:anywhere}#sorted .result-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.7;margin:8px 0}#sorted .result-link{display:inline-block;padding:8px 0;color:#1d9bf0;font-size:13px}#sorted .result-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}#sorted select{width:auto;max-width:100px}#sorted .scan-state{font-size:13px;color:var(--muted);margin:9px 0}#sorted .result-empty{padding:40px 12px;font-size:15px;color:var(--muted)}@media(max-width:600px){#sorted{padding:12px 13px 80px!important}#sorted h2{font-size:19px!important}#sorted .result-card{gap:8px;padding:14px 0}#sorted .result-rank{min-width:35px;font-size:15px}#sorted .result-text{font-size:15px}}`;
sh.append(css);const bar=''', 'full-screen css')
patch("sortRows.set(id,{id,url:'https://x.com'+url.pathname,text:text||existing.text||'',likes:count??existing.likes??null});}}", "sortRows.set(id,{id,url:'https://x.com'+url.pathname,text:text||existing.text||'',likes:count??existing.likes??null,author:article.querySelector('[data-testid=\"User-Name\"]')?.textContent||existing.author||('@'+url.pathname.split('/')[1]),when:article.querySelector('time[datetime]')?.getAttribute('datetime')||existing.when||''});}}",'capture author and date')
a=s.index('function drawSorted(){')
b=s.index('sortBtn.onclick=',a)
replacement=r'''function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function updateScanState(){const el=sh.querySelector('#xsf-scan-state');if(el)el.textContent=scanNotice||`読み込み済み ${sortRows.size}件。Xの未読み込み投稿は含まれません。`;}
async function scanMore(){
  if(scanRunning||!activeSearch())return;
  captureLikes();scanRunning=true;scanStop=false;scanStep=0;scanOriginalY=window.scrollY;
  const search=urlSearch();const goal=scanLimit;
  const initial=sortRows.size;let noGrowth=0,noMove=0;
  scanNotice=`収集中：${sortRows.size}/${goal}件。背後のX検索画面を順にスクロールしています。`;
  drawSorted();
  try{
    for(let i=0;i<180&&!scanStop&&sortRows.size<goal;i++){
      if(!activeSearch()||urlSearch()!==search){scanNotice='検索ページが切り替わったので収集を停止しました。';break;}
      captureLikes();const oldSize=sortRows.size,oldY=window.scrollY;
      window.scrollBy(0,Math.max(620,Math.round(window.innerHeight*.82)));
      await delay(1700);
      captureLikes();scanStep=i+1;
      noGrowth=sortRows.size===oldSize?noGrowth+1:0;
      noMove=Math.abs(window.scrollY-oldY)<4?noMove+1:0;
      scanNotice=`収集中：${sortRows.size}/${goal}件 ／ スクロール${scanStep}回（今回追加 ${sortRows.size-initial}件）。`;
      if(i%3===0||sortRows.size>=goal){const oldScroll=sorted.scrollTop;drawSorted();sorted.scrollTop=oldScroll;}
      else updateScanState();
      if(noGrowth>=12||noMove>=9){scanNotice=`新しい投稿を取得できなくなったため停止しました（${sortRows.size}件）。X側で結果の続きが表示されない場合があります。`;break;}
    }
    if(scanStop)scanNotice=`手動停止：${sortRows.size}件を保持しています。`;
    else if(sortRows.size>=goal)scanNotice=`設定件数 ${goal}件まで収集しました。必要なら上限を増やして「さらに収集」できます。`;
    else if(!scanNotice.includes('停止'))scanNotice=`収集終了：${sortRows.size}件。Xが読み込ませた投稿の範囲内でのいいね順です。`;
  }catch(err){scanNotice=`収集中にエラーが発生：${String(err?.message||err)}。取得済み ${sortRows.size}件は保持しました。`;console.warn('[XSF] scan error',err);}
  finally{scanRunning=false;if(!sorted.hidden)drawSorted();}
}
function drawSorted(){
  if(sorted.hidden)return;
  const previousScroll=sorted.scrollTop;
  sorted.replaceChildren();
  const heading=E('div','result-head');
  const name=E('div');name.append(E('h2','','♥ X検索・いいね順'),E('div','muted',`検索語：${urlSearch()||'未指定'}`));
  const actions=E('div','result-actions');
  const close=E('button','','✕ 検索画面に戻る');close.onclick=()=>{scanStop=true;sorted.hidden=true;};
  const max=E('select');max.setAttribute('aria-label','収集上限');
  for(const n of [50,150,300,500]){const opt=E('option','',`最大${n}件`);opt.value=String(n);max.append(opt);}max.value=String(scanLimit);max.disabled=scanRunning;
  max.onchange=()=>{scanLimit=Number(max.value);drawSorted();};
  const collect=E('button','primary',scanRunning?'■ 収集を停止':'⬇ さらに収集する');
  collect.onclick=()=>{if(scanRunning){scanStop=true;scanNotice='停止処理中…';updateScanState();}else void scanMore();};
  const refresh=E('button','','今の画面を追加');refresh.onclick=()=>{captureLikes();drawSorted();};
  actions.append(max,collect,refresh,close);heading.append(name,actions);sorted.append(heading);
  const state=E('div','scan-state');state.id='xsf-scan-state';sorted.append(state);updateScanState();
  const rows=[...sortRows.values()].sort((a,b)=>(b.likes??-1)-(a.likes??-1)||b.id.localeCompare(a.id));
  const unknown=rows.filter(r=>r.likes===null).length;
  sorted.append(E('div','result-count',`読み込み済みの投稿 ${rows.length}件 ／ いいね数不明 ${unknown}件。検索結果全体の順位ではありません。スクロールで新しく表示された投稿のみ追加できます。`));
  if(!rows.length)sorted.append(E('div','result-empty','検索結果をまだ取得できていません。「さらに収集する」で画面をスクロールして取得します。'));
  const list=E('div');
  for(let i=0;i<rows.length;i++){
    const r=rows[i],card=E('article','result-card'),rank=E('div','result-rank',String(i+1)),body=E('div','result-content');
    let date='';try{if(r.when)date=new Date(r.when).toLocaleString('ja-JP');}catch{}
    body.append(E('div','result-byline',`${r.author||'投稿者不明'}${date?' · '+date:''}`),E('div','result-text',r.text||'（本文を取得できませんでした）'));
    const link=E('a','result-link',`♥ ${r.likes===null?'いいね数不明':r.likes.toLocaleString('ja-JP')}　元のポストを開く ↗`);
    link.href=r.url;link.target='_blank';link.rel='noopener noreferrer';body.append(link);
    card.append(rank,body);list.append(card);
  }
  sorted.append(list);sorted.scrollTop=previousScroll;
}
'''
s=s[:a]+replacement+s[b:]
patch("sortBtn.onclick=()=>{if(!activeSearch()){alert('Xの検索結果ページで使ってください。');return;}const open=sorted.hidden;closeAll();if(open){captureLikes();sorted.hidden=false;drawSorted();}};", "sortBtn.onclick=()=>{if(!activeSearch()){alert('Xの検索結果ページで使ってください。');return;}const open=sorted.hidden;closeAll();if(open){captureLikes();sorted.hidden=false;scanNotice=`現在読み込み済み ${sortRows.size}件。もっと取得するには「さらに収集する」を押してください。`;drawSorted();}};",'open results')
patch("window.__xsfUserscriptCleanup=()=>{observer.disconnect();", "window.__xsfUserscriptCleanup=()=>{scanStop=true;observer.disconnect();",'cleanup')
p.write_text(s,encoding='utf-8')
print('PATCH X Search Favorites v1.1.2: full screen + bounded incremental scroll collection')

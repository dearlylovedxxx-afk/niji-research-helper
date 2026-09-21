from pathlib import Path
p=Path('X_Search_Favorites.user.js')
s=p.read_text(encoding='utf-8')
def change(old,new,label):
    global s
    count=s.count(old)
    if count!=1: raise AssertionError(f'{label}: expected one anchor, got {count}')
    s=s.replace(old,new,1)
change('// @version      1.1.3','// @version      1.1.4','metadata')
change("const VERSION='1.1.3', KEY='xsf_userscript_v1';","const VERSION='1.1.4', KEY='xsf_userscript_v1';",'runtime version')
change("let scanRunning=false, scanStop=false, scanStep=0, scanLimit=150, scanNotice='', scanOriginalY=0;", "let scanRunning=false, scanStop=false, scanStep=0, scanLimit=150, scanNotice='', scanOriginalY=0, manualCapture=false;",'manual capture state')
anchor="sh.append(bar);\nconst panel=E('section');"
replacement="""sh.append(bar);
// While collecting, show the real X timeline rather than covering it with a
// full-screen viewer. The small floating control stays accessible to stop.
const scanBar=E('div');scanBar.id='xsf-scan-bar';scanBar.hidden=true;
const scanBarText=E('span');scanBarText.id='xsf-scan-bar-text';
const scanBarDone=E('button','','■ 停止して結果を見る');
scanBarDone.onclick=()=>{
  scanStop=true;manualCapture=false;
  if(!scanRunning){scanBar.hidden=true;sorted.hidden=false;drawSorted();}
};
scanBar.append(scanBarText,scanBarDone);sh.append(scanBar);
const panel=E('section');"""
change(anchor,replacement,'floating progress bar')
anchor="sh.append(css);const bar=E('div');"
replacement="""css.textContent+=`#xsf-scan-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:2147483647;background:#17212b;color:#fff;border:1px solid #6a879a;border-radius:14px;box-shadow:0 6px 24px #0007;padding:10px 12px;display:flex;gap:12px;align-items:center;max-width:calc(100vw - 20px);pointer-events:auto;font:13px/1.5 system-ui}#xsf-scan-bar[hidden]{display:none!important}#xsf-scan-bar span{max-width:min(570px,calc(100vw - 160px));overflow-wrap:anywhere}#xsf-scan-bar button{background:#1d9bf0;color:#fff;border:1px solid #84c8f1;border-radius:9px;padding:9px;min-height:42px;white-space:nowrap}@media(max-width:600px){#xsf-scan-bar{left:8px;right:8px;transform:none;bottom:8px;flex-wrap:wrap}#xsf-scan-bar span{max-width:100%}}`;
sh.append(css);const bar=E('div');"""
change(anchor,replacement,'progress style')
start=s.index('function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}')
end=s.index('function drawSorted(){',start)
old=s[start:end]
new=r'''function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function updateScanState(){
  const text=scanNotice||`読み込み済み ${sortRows.size}件。Xの未読み込み投稿は含まれません。`;
  const label=sh.querySelector('#xsf-scan-state');if(label)label.textContent=text;
  if(scanBarText)scanBarText.textContent=text;
}
// X may scroll the document or a nested column. Never scroll our own overlay.
function findSearchScroller(){
  let node=document.querySelector('[data-testid="primaryColumn"]');
  while(node){
    if(node.scrollHeight>node.clientHeight+80 && /(auto|scroll)/i.test(getComputedStyle(node).overflowY))return node;
    node=node.parentElement;
  }
  return document.scrollingElement||document.documentElement;
}
function scrollPosition(target){
  return Number(target?.scrollTop)||0;
}
function scrollSearch(target,offset){
  if(!target)return;
  if(target===document.scrollingElement||target===document.documentElement||target===document.body){
    if(offset===-Infinity)window.scrollTo(0,0);else window.scrollBy(0,offset);
  }else if(offset===-Infinity)target.scrollTop=0;
  else target.scrollTop+=offset;
}
function manualScan(){
  if(scanRunning)return;
  if(!activeSearch()){alert('Xの検索結果ページで使ってください。');return;}
  manualCapture=true;scanStop=false;
  scanNotice=`手動収集モード：Xの検索画面を上下にスクロールしてね。表示された投稿を蓄積中（${sortRows.size}件）。`;
  sorted.hidden=true;scanBar.hidden=false;captureLikes();updateScanState();
}
async function scanMore(){
  if(scanRunning||!activeSearch())return;
  manualCapture=false;scanRunning=true;scanStop=false;scanStep=0;
  captureLikes();
  const search=urlSearch(),goal=scanLimit,initial=sortRows.size;
  let target=findSearchScroller(),noGrowth=0,noMove=0;
  scanOriginalY=scrollPosition(target);
  scanNotice=`先頭から再走査：${sortRows.size}/${goal}件。Xの画面を表示しながら読み込みます。`;
  sorted.hidden=true;scanBar.hidden=false;updateScanState();
  try{
    // Begin at the actual top: a previously viewed high-liked post might have
    // been removed from X's virtualized DOM before the old collector started.
    scrollSearch(target,-Infinity);await delay(1000);captureLikes();
    for(let i=0;i<240&&!scanStop&&sortRows.size<goal;i++){
      if(!activeSearch()||urlSearch()!==search){scanNotice='検索条件が変わったため中断しました。';break;}
      captureLikes();const before=sortRows.size,oldY=scrollPosition(target);
      scrollSearch(target,Math.max(420,Math.round(window.innerHeight*.68)));
      await delay(1800);captureLikes();scanStep=i+1;
      let moved=Math.abs(scrollPosition(target)-oldY)>3;
      // A nested scroller can change when X rerenders its timeline.
      if(!moved){const candidate=findSearchScroller();if(candidate!==target){target=candidate;scrollSearch(target,Math.max(420,Math.round(window.innerHeight*.68)));await delay(900);captureLikes();moved=true;}}
      noGrowth=sortRows.size===before?noGrowth+1:0;
      noMove=moved?0:noMove+1;
      scanNotice=`先頭から収集中：${sortRows.size}/${goal}件／移動${scanStep}回（追加 ${sortRows.size-initial}件）。`;
      updateScanState();
      if(noGrowth>=12||noMove>=7){
        scanNotice=`Xの検索画面から新しい投稿を読み込めず、一時停止しました（${sortRows.size}件）。全件取得ではありません。手動収集も試せます。`;
        break;
      }
    }
    if(scanStop)scanNotice=`停止しました。取得済み ${sortRows.size}件は保持しています。`;
    else if(sortRows.size>=goal)scanNotice=`設定上限 ${goal}件を取得。未取得の投稿はまだある可能性があります。`;
    else if(!scanNotice.includes('一時停止')&&!scanNotice.includes('中断'))scanNotice=`収集処理を終了（${sortRows.size}件）。検索結果全件の保証はありません。`;
  }catch(err){scanNotice=`収集中にエラー：${String(err?.message||err)}。${sortRows.size}件を保持。`;console.warn('[XSF] scan error',err);}
  finally{
    scanRunning=false;scanBar.hidden=true;
    if(!manualCapture){sorted.hidden=false;drawSorted();}
  }
}
'''
if s.count(old)!=1:raise AssertionError('scan block not unique')
s=s.replace(old,new,1)
anchor="  const refresh=E('button','','今の画面を追加');refresh.onclick=()=>{captureLikes();drawSorted();};\n  actions.append(max,collect,refresh,close);heading.append(name,actions);sorted.append(heading);"
replacement="""  const refresh=E('button','','今の画面を追加');refresh.onclick=()=>{captureLikes();drawSorted();};
  const manual=E('button','','🖐 X画面を手動で収集');manual.onclick=manualScan;
  actions.append(max,collect,manual,refresh,close);heading.append(name,actions);sorted.append(heading);"""
change(anchor,replacement,'manual collection button')
change("scanNotice=`現在読み込み済み ${sortRows.size}件。もっと取得するには「さらに収集する」を押してください。`;", "scanNotice=`現在読み込み済み ${sortRows.size}件。先頭から追加収集するか、X画面を手動スクロールしてね。`;",'instructions')
change("if(sortOn||!sorted.hidden)captureLikes();", "if(scanRunning||manualCapture||!sorted.hidden)captureLikes();",'observer capture')
change("if(!sorted.hidden)captureLikes();},1100);", "if(scanRunning||manualCapture||!sorted.hidden){captureLikes();if(manualCapture)updateScanState();}},1100);",'periodic manual capture')
change("route=location.href;filterOn=false;filterQuery='';restore();filterBtn.textContent='本文一致のみ';sortRows.clear();sorted.hidden=true;", "route=location.href;filterOn=false;filterQuery='';scanStop=true;manualCapture=false;scanBar.hidden=true;restore();filterBtn.textContent='本文一致のみ';sortRows.clear();sorted.hidden=true;",'route change reset')
change("window.__xsfUserscriptCleanup=()=>{scanStop=true;observer.disconnect();", "window.__xsfUserscriptCleanup=()=>{scanStop=true;manualCapture=false;observer.disconnect();",'cleanup')
p.write_text(s,encoding='utf-8')
print('PATCHED XSF v1.1.4: scan timeline from top in real X view, nested scroller detection, manual fallback, clear partial-results status')

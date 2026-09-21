from pathlib import Path
p=Path('Niji_OR_Results_Merger.user.js');s=p.read_text(encoding='utf-8')
def change(a,b,label):
 global s
 n=s.count(a)
 if n!=1: raise AssertionError(f'{label}: expected 1 match found {n}')
 s=s.replace(a,b,1)
change('// @version      0.4.6','// @version      0.4.7','metadata')
change("const VERSION = '0.4.6';", "const VERSION = '0.4.7';",'version')
change("boot.textContent='🔀 OR起動中 0.4.6';", "boot.textContent='🔀 OR起動中 0.4.7';",'boot')
change("console.info('[Niji OR Merger] v0.4.6 injected'", "console.info('[Niji OR Merger] v0.4.7 injected'",'console')
change("    },{root:viewer,rootMargin:'100px'});", "    },{root:viewer,rootMargin:'100px'});",'noop anchor') if False else None
old="""      for(const e of entries) if(e.isIntersecting){observer.unobserve(e.target);const v=e.target.__norVideo; if(v) queueVideoMetadata(v,()=>{if(viewer.contains(e.target))updateCard(e.target,v);});}"""
new="""      for(const e of entries) if(e.isIntersecting){
        observer.unobserve(e.target);
        const v=e.target.__norVideo;
        if(!v) continue;
        const missingBefore=!videoMetadata[v.id] && !metadataStopped;
        queueVideoMetadata(v,()=>{
          if(!viewer.contains(e.target)) return;
          updateCard(e.target,v);
          // A newly fetched date changes the sorting key. Do not only repaint
          // its label while leaving the card in the old position.
          if(missingBefore && (resultSort==='newest'||resultSort==='oldest')) {
            const previousScroll=viewer.scrollTop;
            redraw();viewer.scrollTop=previousScroll;
          }
        });
      }"""
change(old,new,'resort on metadata')
old="""      summary.textContent=`コメントのある配信 ${selected.length}件 ／ ${lastRunWords.join('・')||'保存済み検索語'} ／ 並び順：${sortSelect.selectedOptions[0]?.textContent||'コメント数が多い順'}（未取得の日時は日付順で後ろ）`;"""
new="""      const dateLoading=(resultSort==='newest'||resultSort==='oldest') && selected.some(v=>
        !videoMetadata[v.id] && !(videoInfo(v).startedAt||videoInfo(v).publishedAt));
      summary.textContent=`コメントのある配信 ${selected.length}件 ／ ${lastRunWords.join('・')||'保存済み検索語'} ／ 並び順：${sortSelect.selectedOptions[0]?.textContent||'コメント数が多い順'}（日時未取得は後ろ${dateLoading?'・画面をスクロールして動画情報を追加取得中は暫定順':''}）`;"""
change(old,new,'provisional status')
old="""    const original=el('a',{href:originalVideoUrl(video),target:'_blank',rel:'noopener noreferrer',text:'元サイトの動画ページを開く'});
    list.append(original);"""
new="""    const original=el('a',{href:originalVideoUrl(video),target:'_blank',rel:'noopener noreferrer',text:'元サイトの動画ページを開く'});
    list.append(original);
    // Visible identity makes a mismatched stored title or external navigation diagnosable.
    const identity=el('div',{class:'nor-compact',text:`動画ID：${video.id} ／ YouTube： https://www.youtube.com/watch?v=${video.id}`});
    const copyIdentity=button('🔗 この動画のURLをコピー',()=>{
      const url=`https://www.youtube.com/watch?v=${video.id}`;
      if(navigator.clipboard?.writeText) void navigator.clipboard.writeText(url).catch(()=>prompt('動画URL',url));
      else prompt('動画URL',url);
    });
    identity.append(copyIdentity);list.append(identity);"""
change(old,new,'identity diagnostics')
p.write_text(s,encoding='utf-8');print('Patched OR v0.4.7 delayed metadata resort; added video-id link diagnostics')

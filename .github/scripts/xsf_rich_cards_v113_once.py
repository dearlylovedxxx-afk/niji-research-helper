from pathlib import Path
p=Path('X_Search_Favorites.user.js')
s=p.read_text(encoding='utf-8')
def replace_once(old,new,label):
 global s
 n=s.count(old)
 if n!=1: raise AssertionError(f'{label}: expected 1 match, got {n}')
 s=s.replace(old,new,1)
replace_once('// @version      1.1.2','// @version      1.1.3','userscript version')
replace_once("const VERSION='1.1.2', KEY=", "const VERSION='1.1.3', KEY=",'runtime version')
start=s.index('function captureLikes(){')
end=s.index('\nfunction delay(ms)',start)
rich=r'''function httpsImage(raw) {
  try {
    const url=new URL(raw,location.origin);
    return url.protocol==='https:' ? url.href : '';
  } catch{return '';}
}
// Store the picture/video preview while X's virtualized tweet is actually in the DOM.
// Never mistake a profile image or an emoji for a tweet attachment.
function tweetMedia(article) {
  const images=[];const seen=new Set();
  const add=raw=>{
    const url=httpsImage(raw);
    if(!/^https:\/\/pbs\.twimg\.com\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|video_thumb)\//i.test(url))return;
    if(seen.has(url)||images.length>=4)return;
    seen.add(url);images.push(url);
  };
  const imgs=article.querySelectorAll('[data-testid="tweetPhoto"] img,[data-testid="videoPlayer"] img,img[src*="pbs.twimg.com/media/"],img[src*="pbs.twimg.com/ext_tw_video_thumb/"],img[src*="pbs.twimg.com/amplify_video_thumb/"],img[src*="pbs.twimg.com/tweet_video_thumb/"]');
  for(const image of imgs)add(image.currentSrc||image.getAttribute('src')||image.src);
  for(const video of article.querySelectorAll('video[poster]'))add(video.getAttribute('poster'));
  // Some X video thumbnails are CSS background images rather than <img> tags.
  for(const node of article.querySelectorAll('[data-testid="videoPlayer"] [style*="background-image"],[data-testid="videoPlayer"][style*="background-image"]')){
    const raw=node.style?.backgroundImage||'';
    const found=raw.match(/url\(["']?(https:\/\/pbs\.twimg\.com\/[^"')]+)/i);
    if(found)add(found[1]);
  }
  return {images,hasVideo:!!article.querySelector('[data-testid="videoPlayer"],video,[data-testid="videoComponent"]')};
}
function captureLikes(){
  if(!activeSearch())return;
  for(const article of document.querySelectorAll('article[data-testid="tweet"]')){
    const anchor=article.querySelector('time')?.closest('a[href*="/status/"]')||article.querySelector('a[href*="/status/"]');
    if(!anchor)continue;
    let url;
    try{url=new URL(anchor.getAttribute('href'),location.origin);if(!/^(?:x|twitter)\.com$/.test(url.hostname)||!/\/status\/\d+/.test(url.pathname))continue;}catch{continue;}
    const id=url.pathname.match(/\/status\/(\d+)/)?.[1];if(!id)continue;
    const existing=sortRows.get(id)||{};
    const text=textOfTweet(article);
    // A body-only filter should also apply to the collected results, not just
    // hide unrelated tweets behind the full-screen results view.
    if(filterOn&&matchText(text,filterQuery)===false)continue;
    const user=article.querySelector('[data-testid="User-Name"]');
    const handle=user?.textContent?.match(/@[A-Za-z0-9_]+/)?.[0]||existing.handle||('@'+url.pathname.split('/')[1]);
    const name=user?.querySelector('span')?.textContent?.trim()||existing.name||handle;
    const photo=httpsImage(article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.currentSrc||article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.getAttribute('src')||'');
    const media=tweetMedia(article);
    const texts=[...article.querySelectorAll('[data-testid="tweetText"]')];
    const quoted=texts.length>1?(texts[1].innerText||texts[1].textContent||'').trim():'';
    const statusLinks=[...article.querySelectorAll('a[href*="/status/"]')];
    const quoteAnchor=statusLinks.find(a=>{const m=a.getAttribute('href')?.match(/\/status\/(\d+)/);return m&&m[1]!==id;});
    const quotedUrl=quoteAnchor?httpsImage(quoteAnchor.getAttribute('href')):'';
    const count=tweetLikes(article);
    sortRows.set(id,{
      id,url:'https://x.com'+url.pathname,text:text||existing.text||'',likes:count??existing.likes??null,
      name,handle,avatar:photo||existing.avatar||'',
      when:article.querySelector('time[datetime]')?.getAttribute('datetime')||existing.when||'',
      images:media.images.length?media.images:existing.images||[],hasVideo:media.hasVideo||existing.hasVideo||false,
      quote:quoted||existing.quote||'',quoteUrl:quotedUrl||existing.quoteUrl||''
    });
  }
}'''
s=s[:start]+rich+s[end:]
css_anchor='sh.append(css);const bar=E(\'div\');'
css_extra=r'''// Rich post cards: recognize a post from the author, attached image/video and text.
css.textContent+=`#sorted .result-feed{max-width:780px;margin:0 auto}#sorted .result-card{display:block!important;margin:0 0 14px!important;padding:18px!important;border:1px solid var(--edge)!important;border-radius:18px!important;background:var(--bg)}#sorted .result-card-top{display:flex;gap:12px;align-items:center;margin-bottom:10px}#sorted .result-avatar{width:46px;height:46px;border-radius:50%;object-fit:cover;flex-shrink:0}#sorted .result-user{font-weight:750;font-size:16px;line-height:1.25}#sorted .result-handle{font-size:13px;color:var(--muted);overflow-wrap:anywhere}#sorted .result-rank{margin-left:auto;min-width:auto;border-radius:18px;background:#e7f4ff;color:#175d91;font:700 13px system-ui;padding:6px 10px;white-space:nowrap}#sorted .result-body{font-size:16px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 12px}#sorted .result-media{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;border-radius:14px;overflow:hidden;margin:12px 0;max-height:540px}#sorted .result-media>a{display:block;position:relative;min-height:120px;max-height:360px;background:#15202b}#sorted .result-media img{width:100%;height:100%;max-height:360px;min-height:120px;object-fit:cover;display:block}#sorted .result-media>a:only-child{grid-column:1/-1;min-height:180px}#sorted .result-media>a:only-child img{max-height:440px;object-fit:contain}#sorted .result-video-tag{position:absolute;left:10px;bottom:10px;background:#000c;color:#fff;border-radius:20px;padding:5px 12px;font:700 14px system-ui}#sorted .result-quote{border:1px solid var(--edge);border-radius:12px;margin:10px 0;padding:10px 12px;white-space:pre-wrap;font-size:14px}#sorted .result-card-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px}#sorted .result-likes{font-weight:750;color:#e0245e}#sorted .result-open{display:inline-block;padding:8px 13px!important;background:#1d9bf0!important;color:#fff!important;border-radius:22px;text-decoration:none!important;font-weight:700!important}#sorted .result-no-media{color:var(--muted);font-size:13px;background:#eef5fb;border-radius:10px;padding:12px;margin-top:10px}#sorted .result-quote a{color:#1d9bf0}#sorted .result-media-hint{color:var(--muted);font-size:11px;margin-top:-6px}@media(prefers-color-scheme:dark){#sorted .result-rank{background:#123147;color:#87cfff}#sorted .result-no-media{background:#222}}@media(max-width:600px){#sorted .result-card{padding:12px!important;margin-bottom:10px!important;border-radius:14px!important}#sorted .result-avatar{width:38px;height:38px}#sorted .result-user{font-size:14px}#sorted .result-body{font-size:15px}#sorted .result-media{max-height:420px}#sorted .result-media>a{min-height:90px}}`;
sh.append(css);const bar=E('div');'''
replace_once(css_anchor,css_extra,'rich card CSS')
start=s.index('  const list=E(\'div\');\n  for(let i=0;i<rows.length;i++){',s.index('function drawSorted(){'))
end=s.index('\n  sorted.append(list);sorted.scrollTop=previousScroll;',start)
render=r'''  const list=E('div','result-feed');
  for(let i=0;i<rows.length;i++){
    const r=rows[i],card=E('article','result-card');
    let date='';try{if(r.when)date=new Date(r.when).toLocaleString('ja-JP');}catch{}
    const top=E('div','result-card-top');
    if(r.avatar){const avatar=E('img','result-avatar');avatar.src=r.avatar;avatar.alt='';avatar.loading='lazy';top.append(avatar);}
    const identity=E('div');identity.append(E('div','result-user',r.name||r.handle||'投稿者不明'),E('div','result-handle',`${r.handle||''}${date?' · '+date:''}`));
    top.append(identity,E('div','result-rank',`#${i+1}`));card.append(top);
    card.append(E('div','result-body',r.text||'（本文を読み取れませんでした。画像・動画と元のポストを確認してください）'));
    if(r.images?.length){
      const gallery=E('div','result-media');
      for(let j=0;j<Math.min(4,r.images.length);j++){
        const mediaLink=E('a');mediaLink.href=r.url;mediaLink.target='_blank';mediaLink.rel='noopener noreferrer';mediaLink.title='Xで元の投稿を開く';
        const img=E('img');img.src=r.images[j];img.alt=`投稿の添付メディア ${j+1}`;img.loading='lazy';
        mediaLink.append(img);
        if(r.hasVideo&&j===0)mediaLink.append(E('span','result-video-tag','▶ 動画を開く'));
        gallery.append(mediaLink);
      }
      card.append(gallery,E('div','result-media-hint','画像・動画をタップするとXの元の投稿を開きます。'));
    } else if(r.hasVideo){
      card.append(E('div','result-no-media','▶ 動画付きの投稿です。サムネイルを取得できなかったため、元の投稿から再生してください。'));
    }
    if(r.quote){const quote=E('div','result-quote','引用された投稿：\n'+r.quote.slice(0,700));
      if(r.quoteUrl){const a=E('a','',' 引用元を開く ↗');a.href=r.quoteUrl;a.target='_blank';a.rel='noopener noreferrer';quote.append(a);}
      card.append(quote);
    }
    const footer=E('div','result-card-footer');
    footer.append(E('span','result-likes',`♥ ${r.likes===null?'いいね数不明':r.likes.toLocaleString('ja-JP')}`));
    const open=E('a','result-open','Xでこの投稿を開く ↗');open.href=r.url;open.target='_blank';open.rel='noopener noreferrer';footer.append(open);
    card.append(footer);list.append(card);
  }'''
s=s[:start]+render+s[end:]
p.write_text(s,encoding='utf-8')
print('Patched X Search Favorites v1.1.3 with rich tweet cards and media capture')

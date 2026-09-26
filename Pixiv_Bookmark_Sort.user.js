// ==UserScript==
// @name         Pixiv イラスト・小説 ブクマ順（検索結果横断）
// @namespace    local.pixiv.bookmark-sort.cross-page
// @version      0.6.2
// @description  Pixivツールを1つのパネルに統合。全体ブックマーク調査・並び替えと、小説TXT編集・整形・保存に対応。
// @match        https://www.pixiv.net/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// ==/UserScript==


// ---- Cross-page bookmark engine (embedded; DB schema preserved) ----
(() => {
'use strict';
if (window.__pixivBookmarkCrossPageV05) return;
window.__pixivBookmarkCrossPageV05 = true;
const DB='pixiv-bookmark-sort-cross-page-v02', PREF='pixiv-bookmark-sort-minimum-v03', MAX=1000, WAIT=2500;
const fmt=n=>Number(n).toLocaleString('ja-JP');
let dbPromise, context, searchKey='', running=null, lastRequest=0, timer, seq=0, limit=100, failedUrl='';
const number=v=>/^\d+$/.test(String(v).trim()) ? Math.min(1e9,Math.floor(Number(v))) : 0;
let minimum=(()=>{try{return number(localStorage.getItem(PREF)||'0')}catch{return 0}})();
function current(){
 const u=new URL(location.href), m=u.pathname.match(/^\/tags\/([^/]+)(?:\/(artworks|illustrations|manga|novels))?(?:\/|$)/);
 let word,kind,mode;
 if(m){try{word=decodeURIComponent(m[1])}catch{return null} kind=m[2]||'artworks'; mode=u.searchParams.get('s_mode')||'s_tag_full'}
 else if(u.pathname==='/novel/search.php'){word=u.searchParams.get('word')||u.searchParams.get('q');kind='novels';mode=u.searchParams.get('s_mode')||'s_tag'}
 else if(['/search','/search.php'].includes(u.pathname)){word=u.searchParams.get('word')||u.searchParams.get('q'); const t=u.searchParams.get('type');kind=['novel','novels'].includes(t)?'novels':t==='manga'?'manga':['illust','illustrations'].includes(t)?'illustrations':'artworks';mode=u.searchParams.get('s_mode')||'s_tag'}
 else return null;
 if(!word)return null;
 const p=new URLSearchParams(), art=kind!=='novels';
 for(const key of ['mode','scd','ecd','ai_type','work_lang','lang',...(art?['wlt','wgt','hlt','hgt','ratio','tool']:['tlt','tgt','wlt','wgt','original_only','genre'])])
  for(const v of u.searchParams.getAll(key))p.append(key,v);
 // pixivの検索画面とAJAX検索APIの検索モード表記を合わせる。
 mode=mode==='tag_tc'?(art?'s_tag_tc':'s_tag'):mode==='tc'?'s_tc':mode;
 p.set('word',word);p.set('s_mode',mode);p.set('mode',p.get('mode')||'all');
 if(art){p.set('csw','0');if(kind==='artworks')p.set('type','all');else if(kind==='manga')p.set('type','manga');else if(kind==='illustrations'){const t=u.searchParams.get('type');if(['illust','ugoira','illust_and_ugoira'].includes(t))p.set('type',t)}}
 else{const gs=u.searchParams.get('gs');if(['0','1'].includes(gs))p.set('gs',gs)}
 p.sort();return {word,kind,params:p,key:JSON.stringify([kind,word,[...p.entries()]])};
}
function db(){if(!dbPromise)dbPromise=new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result,w=d.createObjectStore('works',{keyPath:'key'});w.createIndex('pending',['searchKey','status']);w.createIndex('rank',['searchKey','count']);d.createObjectStore('meta',{keyPath:'key'})};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});return dbPromise}
function req(r){return new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
function done(t){return new Promise((ok,no)=>{t.oncomplete=ok;t.onerror=()=>no(t.error);t.onabort=()=>no(t.error)})}
const fresh=k=>({key:k,nextPage:1,total:null,discovered:0,processed:0,skipped:0,pageSize:null,searchDone:false,note:''});
async function meta(k){const d=await db(),t=d.transaction('meta','readonly');return await req(t.objectStore('meta').get(k))||fresh(k)}
async function putMeta(m){const d=await db(),t=d.transaction('meta','readwrite'),wait=done(t);t.objectStore('meta').put(m);await wait}
async function pending(k){const d=await db();return req(d.transaction('works').objectStore('works').index('pending').get([k,0]))}
async function clear(k){const d=await db(),t=d.transaction(['works','meta'],'readwrite'),wait=done(t),s=t.objectStore('works');s.index('pending').openCursor(IDBKeyRange.bound([k,0],[k,2])).onsuccess=e=>{const c=e.target.result;if(c){c.delete();c.continue()}};t.objectStore('meta').delete(k);await wait}
async function savePage(k,m,works,size){const d=await db(),t=d.transaction(['works','meta'],'readwrite'),wait=done(t),s=t.objectStore('works'),unique=new Map(works.map(w=>[String(w.id),w]));let left=unique.size,added=0;
 const finish=()=>{m.discovered+=added;m.nextPage++;if(!m.pageSize&&size)m.pageSize=size;t.objectStore('meta').put(m)};
 if(!left)finish();for(const [id,w] of unique){s.get(k+':'+id).onsuccess=e=>{if(!e.target.result){added++;const c=Number(w.bookmarkCount),has=w.bookmarkCount!=null&&Number.isFinite(c)&&c>=0;s.put({key:k+':'+id,searchKey:k,id,status:has?1:0,count:has?c:-1,title:w.title||w.illustTitle||'',userName:w.userName||'',thumb:w.url||w.coverUrl||'',date:w.createDate||''});if(has)m.processed++}if(!--left)finish()}}await wait}
async function saveDetail(m,row,body,skip){const d=await db(),t=d.transaction(['works','meta'],'readwrite'),wait=done(t);t.objectStore('works').put({...row,status:skip?2:1,count:skip?-1:Number(body.bookmarkCount),title:body.title||row.title,userName:body.userName||row.userName,thumb:row.thumb||body.coverUrl||body.url||body.urls?.thumb||body.urls?.small||''});if(skip)m.skipped++;else m.processed++;t.objectStore('meta').put(m);await wait}
async function ranked(k,min,max){const d=await db(),t=d.transaction('works'),i=t.objectStore('works').index('rank'),range=IDBKeyRange.bound([k,min],[k,Number.MAX_SAFE_INTEGER]);return Promise.all([req(i.count(range)),new Promise((ok,no)=>{const out=[],r=i.openCursor(range,'prev');r.onsuccess=()=>{if(!r.result||out.length>=max)return ok(out);out.push(r.result.value);r.result.continue()};r.onerror=()=>no(r.error)})])}
function abort(signal){if(signal.aborted)throw new DOMException('中断','AbortError')}
async function json(url,signal){const remain=Math.max(0,WAIT-(Date.now()-lastRequest));if(remain)await new Promise((ok,no)=>{const t=setTimeout(()=>{signal.removeEventListener('abort',cancel);ok()},remain);function cancel(){clearTimeout(t);no(new DOMException('中断','AbortError'))}signal.addEventListener('abort',cancel,{once:true})});abort(signal);lastRequest=Date.now();const r=await fetch(url,{credentials:'same-origin',signal,headers:{Accept:'application/json'}});
 if(r.status===404){const e=new Error('404');e.notFound=true;throw e}if(r.status===429)throw new Error('429：pixivのアクセス制限です。時間を置いてから再開してください。自動再試行はしません。');if(!r.ok){const e=new Error('通信エラー HTTP '+r.status);e.requestUrl=url;e.httpStatus=r.status;throw e}const data=await r.json();if(!data||data.error)throw new Error(data?.message||'pixiv APIエラー');return data.body}
async function page(ctx,n,signal){const u=new URL('/ajax/search/'+ctx.kind+'/'+encodeURIComponent(ctx.word),location.origin);u.search=ctx.params.toString();u.searchParams.set('order','date_d');u.searchParams.set('p',String(n));const b=await json(u.href,signal),g=ctx.kind==='novels'?b?.novel:(b?.illustManga||b?.illust||b?.manga);if(!Array.isArray(g?.data))throw new Error('検索結果の形式が変わった可能性があります');return {total:Number(g.total),last:Number(g.lastPage),data:g.data,works:g.data.filter(w=>w&&/^\d+$/.test(String(w.id))&&!w.isAdContainer)}}
async function detail(id,kind,signal){const b=await json('/ajax/'+(kind==='novels'?'novel':'illust')+'/'+encodeURIComponent(id),signal);if(!Number.isFinite(Number(b?.bookmarkCount)))throw new Error('ブックマーク数が取得できません');return b}
const host=document.createElement('div');host.id='pixiv-bookmark-sort-cross-page-v05';const root=host.attachShadow({mode:'open'});root.innerHTML=`<style>:host{all:initial;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;color-scheme:light}*{box-sizing:border-box}button,select,input{font:inherit;border:1px solid #d5d9e2;background:#fff;color:#263040;padding:9px;border-radius:8px}button,select{cursor:pointer}button:disabled{opacity:.5}.launch{position:fixed;right:12px;bottom:max(50px,env(safe-area-inset-bottom));z-index:2147483645;background:#eb3e63;color:white;border:0;border-radius:30px;font-weight:700;padding:13px 16px;box-shadow:0 4px 18px #0004}.veil{display:none;position:fixed;z-index:2147483646;inset:0;background:#111a}.veil.open{display:flex}.panel{margin:auto;width:min(1100px,100%);height:min(94dvh,100%);display:flex;flex-direction:column;overflow:hidden;background:#f5f6fb;color:#263040;border-radius:16px}.head{flex:none;padding:12px;background:white;border-bottom:1px solid #ddd}.heading,.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.heading{justify-content:space-between}.heading h2{font-size:17px;margin:0}.controls{margin-top:10px}.primary{background:#eb3e63;color:white}.minimum{width:105px}.status{white-space:pre-wrap;font-size:13px;line-height:1.5;margin-top:10px}.counted{font-size:12px;color:#b4294e;margin-top:8px}.note{font-size:11px;line-height:1.5;color:#586277;margin:8px 0 0}.results{flex:1;overflow:auto;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));align-content:start;gap:10px;padding:12px}.card{display:flex;flex-direction:column;text-decoration:none;color:#263040;background:white;border-radius:9px;overflow:hidden;min-width:0}.card img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#e6e9ef}.card.novel img{aspect-ratio:3/4;object-fit:contain}.info{padding:8px}.num{color:#e33159;font-weight:700}.title{font-size:12px;overflow-wrap:anywhere}.author{font-size:11px;color:#647087}@media(max-width:600px){.panel{height:100dvh;border-radius:0}.results{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><button class="launch">♥ 全体ブクマ順</button><div class="veil" role="dialog" aria-modal="true"><section class="panel"><div class="head"><div class="heading"><h2>♥ 検索結果をブックマーク数順に</h2><button class="close" aria-label="閉じる">×</button></div><div class="controls"><button class="start primary">全件の調査を開始／再開</button><button class="stop" disabled>一時停止</button><button class="reset">保存結果を消して再調査</button><select class="limit" aria-label="表示数"><option value="100">上位100件</option><option value="300">上位300件</option><option value="1000">上位1000件</option></select><label>最低ブクマ数 <input class="minimum" type="number" inputmode="numeric" min="0" max="1000000000" step="1">件以上</label><select class="preset" aria-label="最低ブクマ数の候補"><option value="custom">件数を選ぶ</option><option value="0">指定なし</option><option value="100">100件以上</option><option value="500">500件以上</option><option value="1000">1000件以上</option><option value="5000">5000件以上</option><option value="10000">10000件以上</option></select></div><div class="status" aria-live="polite"></div><button class="debug" hidden>エラーの診断用URLを表示</button><div class="counted" aria-live="polite"></div><p class="note">検索結果の各ページから作品を調べ、確認済み作品を人気順に表示します。途中で止めても結果は保存され、全件調査が終わるまでは暫定順位です。最低ブクマ数は表示だけを絞り、取得件数を減らすものではありません。作品数やpixivの制限により全件取得できない場合があります。アクセス制限の迂回・自動再試行はしません。</p></div><div class="results"></div></section></div>`;document.body.append(host);
const $=s=>root.querySelector(s),launch=$('.launch'),veil=$('.veil'),startBtn=$('.start'),stopBtn=$('.stop'),status=$('.status'),items=$('.results'),minInput=$('.minimum'),preset=$('.preset'),counted=$('.counted'),debug=$('.debug');minInput.value=String(minimum);preset.value=[0,100,500,1000,5000,10000].includes(minimum)?String(minimum):'custom';
const message=s=>{status.textContent=s},buttons=on=>{startBtn.disabled=on;stopBtn.disabled=!on},stop=()=>running?.abort();
function stats(m,extra=''){return `${context?.kind==='novels'?'小説':'イラスト・漫画'}：検索結果 約${Number.isFinite(m.total)?fmt(m.total):'不明'}作品｜発見 ${fmt(m.discovered)}件｜確認 ${fmt(m.processed)}件｜閲覧不可 ${fmt(m.skipped)}件\n${m.searchDone?'検索ページの取得終了':'次のページ：'+m.nextPage}${extra?'｜'+extra:''}${m.note?'\n'+m.note:''}`}
async function render(k){if(!k||k!==searchKey||!veil.classList.contains('open'))return;const id=++seq,[count,rows]=await ranked(k,minimum,limit);if(k!==searchKey||id!==seq||!veil.classList.contains('open'))return;items.replaceChildren();counted.textContent=`確認済みで ♥ ${fmt(minimum)}件以上：${fmt(count)}作品（表示 ${fmt(rows.length)}作品）`;for(const w of rows){const novel=context?.kind==='novels',a=document.createElement('a');a.className='card'+(novel?' novel':'');a.href=(novel?'/novel/show.php?id=':'/artworks/')+w.id;a.target='_blank';a.rel='noopener noreferrer';const image=document.createElement('img');image.loading='lazy';image.alt=w.title||'表紙';if(/^https:\/\/(i|s)\.pximg\.net\//.test(w.thumb||''))image.src=w.thumb;const info=document.createElement('div');info.className='info';const n=document.createElement('div');n.className='num';n.textContent='♥ '+fmt(w.count);const title=document.createElement('div');title.className='title';title.textContent=w.title||'無題';const author=document.createElement('div');author.className='author';author.textContent=w.userName||'';info.append(n,title,author);a.append(image,info);items.append(a)}if(!rows.length){const p=document.createElement('p');p.textContent='条件に一致する確認済み作品はまだありません。調査を進めるか最低件数を下げてください。';items.append(p)}}
function schedule(k,instant=false){clearTimeout(timer);timer=setTimeout(()=>render(k).catch(e=>message('表示エラー：'+e.message)),instant?0:600)}
async function refresh(){const c=current();launch.style.display=c?'':'none';if(!c){stop();veil.classList.remove('open');return}if(c.key!==searchKey){stop();searchKey=c.key;context=c;failedUrl='';debug.hidden=true;items.replaceChildren();counted.textContent=''}if(!veil.classList.contains('open'))return;try{const m=await meta(c.key);if(searchKey===c.key){message('検索条件：'+c.word+'\n'+stats(m,running?'調査中':'開始／再開できます'));schedule(c.key,true)}}catch(e){message('保存領域を開けません：'+e.message)}}
async function scan(c,ctrl){const m=await meta(c.key);while(true){abort(ctrl.signal);if(c.key!==searchKey)throw new DOMException('検索条件変更','AbortError');const w=await pending(c.key);if(w){message(stats(m,'ブクマ数を確認中'));try{await saveDetail(m,w,await detail(w.id,c.kind,ctrl.signal),false)}catch(e){if(e.notFound)await saveDetail(m,w,{},true);else throw e}if(m.processed%5===0)schedule(c.key);continue}if(m.searchDone){message(stats(m,'取得可能な検索結果の調査終了'));schedule(c.key,true);return}if(m.nextPage>MAX){m.note='安全上1000ページで停止。検索全件を取得したわけではありません。';await putMeta(m);message(stats(m));return}message(stats(m,'検索ページ '+m.nextPage+' を取得中'));const p=await page(c,m.nextPage,ctrl.signal);if(Number.isFinite(p.total))m.total=p.total;if(Number.isInteger(p.last)&&p.last>0)m.lastPage=p.last;if(!p.data.length){m.searchDone=true;await putMeta(m);continue}const n=m.nextPage;await savePage(c.key,m,p.works,p.data.length);if(Number.isFinite(m.total)&&m.total>=0&&m.pageSize&&n*m.pageSize>=m.total){m.searchDone=true;await putMeta(m)}else if(m.lastPage&&n>=m.lastPage){m.searchDone=true;m.note='pixivが返した最終ページまで取得。全作品を取得できたとは限りません。';await putMeta(m)}schedule(c.key)}}
function start(){if(running||!context)return;const c=context,ctrl=new AbortController();running=ctrl;failedUrl='';debug.hidden=true;buttons(true);scan(c,ctrl).catch(e=>{if(e.name==='AbortError')message('一時停止しました。保存済みの結果から再開できます。');else{failedUrl=e.requestUrl||'';debug.hidden=!failedUrl;message('調査を停止しました：'+e.message+'\n保存済みの結果は残っています。')}}).finally(()=>{if(running===ctrl){running=null;buttons(false)}schedule(c.key,true)})}
launch.addEventListener('click',()=>{veil.classList.add('open');refresh()});$('.close').addEventListener('click',()=>{stop();veil.classList.remove('open')});veil.addEventListener('click',e=>{if(e.target===veil){stop();veil.classList.remove('open')}});startBtn.addEventListener('click',start);stopBtn.addEventListener('click',stop);debug.addEventListener('click',()=>{if(failedUrl)prompt('失敗したpixivのURLです。検索語を含むため共有前に確認してください。',failedUrl)});$('.reset').addEventListener('click',async()=>{if(running||!searchKey||!confirm('この検索条件の保存結果を削除して最初から調べ直しますか？'))return;await clear(searchKey);await refresh()});$('.limit').addEventListener('change',e=>{limit=Number(e.target.value);schedule(searchKey,true)});
function changeMin(v){minimum=number(v);minInput.value=String(minimum);preset.value=[0,100,500,1000,5000,10000].includes(minimum)?String(minimum):'custom';try{localStorage.setItem(PREF,String(minimum))}catch{}schedule(searchKey,true)}
minInput.addEventListener('change',()=>changeMin(minInput.value));minInput.addEventListener('keydown',e=>{if(e.key==='Enter'){changeMin(minInput.value);minInput.blur()}});preset.addEventListener('change',()=>{if(preset.value!=='custom')changeMin(preset.value);else minInput.focus()});setInterval(()=>{const c=current();if((!c&&searchKey)||(c&&c.key!==searchKey))refresh()},1200);refresh();
})();

(() => {
  'use strict';
  // The pinned v0.5.2 engine alone owns acquisition and the existing IndexedDB schema.
  // Replace the v0.5.3/0.5.4 display layers with ONE viewer; never clear the research DB.
  if (window.__pixivCrossViewerV055) return;
  window.__pixivCrossViewerV055 = true;
  const HOST_ID = 'pixiv-bookmark-sort-cross-page-v05';
  const RESEARCH_DB = 'pixiv-bookmark-sort-cross-page-v02';
  const EXTRA_DB = 'pixiv-bookmark-sort-extras-v01';
  const SORT_KEY = 'pixiv-bsort-view-sort-v055';
  const MAX_VIEW = 1000;
  const DETAIL_WAIT = 2600;
  const $new = (tag, klass, text) => {
    const e = document.createElement(tag);
    if (klass) e.className = klass;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const day = value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (!match) return '';
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    const timestamp = Date.parse(iso + 'T00:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso ? iso : '';
  };
  const idNum = value => /^\d+$/.test(String(value)) ? Number(value) : 0;
  function better(a, b, sort) {
    // Positive means a ranks above b. Unknown dates go last for newest sorting.
    const da = day(a.date), db = day(b.date);
    if (sort === 'newest' && da !== db) return da > db ? 1 : -1;
    if (Number(a.count) !== Number(b.count)) return Number(a.count) > Number(b.count) ? 1 : -1;
    if (sort !== 'newest' && da !== db) return da > db ? 1 : -1;
    return idNum(a.id) > idNum(b.id) ? 1 : idNum(a.id) < idNum(b.id) ? -1 : 0;
  }
  function allowedDate(row, from, to) {
    if (!from && !to) return true;
    const d = day(row.date);
    return !!d && (!from || d >= from) && (!to || d <= to);
  }
  function searchContext() {
    // Identical search-key construction to the pinned v0.5.2 engine.
    const u = new URL(location.href);
    const m = u.pathname.match(/^\/tags\/([^/]+)(?:\/(artworks|illustrations|manga|novels))?(?:\/|$)/);
    let word, kind, mode;
    if (m) {
      try { word = decodeURIComponent(m[1]); } catch { return null; }
      kind = m[2] || 'artworks'; mode = u.searchParams.get('s_mode') || 's_tag_full';
    } else if (u.pathname === '/novel/search.php') {
      word = u.searchParams.get('word') || u.searchParams.get('q');
      kind = 'novels'; mode = u.searchParams.get('s_mode') || 's_tag';
    } else if (['/search', '/search.php'].includes(u.pathname)) {
      word = u.searchParams.get('word') || u.searchParams.get('q');
      const t = u.searchParams.get('type');
      kind = ['novel', 'novels'].includes(t) ? 'novels' : t === 'manga' ? 'manga' : ['illust', 'illustrations'].includes(t) ? 'illustrations' : 'artworks';
      mode = u.searchParams.get('s_mode') || 's_tag';
    } else return null;
    if (!word) return null;
    const p = new URLSearchParams(), art = kind !== 'novels';
    for (const key of ['mode', 'scd', 'ecd', 'ai_type', 'work_lang', 'lang', ...(art ? ['wlt', 'wgt', 'hlt', 'hgt', 'ratio', 'tool'] : ['tlt', 'tgt', 'wlt', 'wgt', 'original_only', 'genre'])]) {
      for (const v of u.searchParams.getAll(key)) p.append(key, v);
    }
    mode = mode === 'tag_tc' ? (art ? 's_tag_tc' : 's_tag') : mode === 'tc' ? 's_tc' : mode;
    p.set('word', word); p.set('s_mode', mode); p.set('mode', p.get('mode') || 'all');
    if (art) {
      p.set('csw', '0');
      if (kind === 'artworks') p.set('type', 'all');
      else if (kind === 'manga') p.set('type', 'manga');
      else if (kind === 'illustrations') {
        const t = u.searchParams.get('type');
        if (['illust', 'ugoira', 'illust_and_ugoira'].includes(t)) p.set('type', t);
      }
    } else {
      const gs = u.searchParams.get('gs');
      if (['0', '1'].includes(gs)) p.set('gs', gs);
    }
    p.sort();
    return {key: JSON.stringify([kind, word, [...p.entries()]]), kind, word,
      from: day(u.searchParams.get('scd')), to: day(u.searchParams.get('ecd'))};
  }
  let researchPromise, extraPromise;
  function openDb(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // Never create/upgrade the research database here: only the pinned engine may do so.
    });
  }
  const researchDb = () => researchPromise ||= openDb(RESEARCH_DB).catch(err => { researchPromise = null; throw err; });
  function extrasDb() {
    if (!extraPromise) extraPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(EXTRA_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('details')) req.result.createObjectStore('details', {keyPath:'key'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
    return extraPromise;
  }
  function fromStore(db, key) {
    return new Promise(resolve => {
      try {
        const req = db.transaction('details', 'readonly').objectStore('details').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  function saveExtra(db, item) {
    try { db.transaction('details', 'readwrite').objectStore('details').put(item); } catch { /* extra metadata is optional */ }
  }
  function topRows(key, minimum, sort, from, to, max = MAX_VIEW) {
    return researchDb().then(db => new Promise((resolve, reject) => {
      let matched = 0, unknownDates = 0;
      const heap = [];
      const worse = (a, b) => better(a, b, sort) < 0;
      function push(row) {
        heap.push(row);
        let i = heap.length - 1;
        while (i) {
          const parent = (i - 1) >> 1;
          if (!worse(heap[i], heap[parent])) break;
          [heap[i], heap[parent]] = [heap[parent], heap[i]]; i = parent;
        }
      }
      function replace(row) {
        heap[0] = row;
        for (let i = 0; ; ) {
          let child = i * 2 + 1;
          if (child >= heap.length) break;
          if (child + 1 < heap.length && worse(heap[child + 1], heap[child])) child++;
          if (!worse(heap[child], heap[i])) break;
          [heap[i], heap[child]] = [heap[child], heap[i]]; i = child;
        }
      }
      try {
        if (!db.objectStoreNames.contains('works')) throw new Error('調査DBがまだ作成されていません');
        const tx = db.transaction('works', 'readonly');
        const index = tx.objectStore('works').index('rank');
        const lower = Math.max(0, Number(minimum) || 0);
        const range = IDBKeyRange.bound([key, lower], [key, Number.MAX_SAFE_INTEGER]);
        const req = index.openCursor(range);
        req.onerror = () => reject(req.error || new Error('調査データを読み込めません'));
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            heap.sort((a, b) => better(b, a, sort));
            resolve({rows: heap, matched, unknownDates}); return;
          }
          const row = cursor.value;
          if (!day(row.date)) unknownDates++;
          if (allowedDate(row, from, to)) {
            matched++;
            if (heap.length < max) push(row);
            else if (better(row, heap[0], sort) > 0) replace(row);
          }
          cursor.continue();
        };
      } catch (err) { reject(err); }
    }));
  }
  const extras = new Map(), extrasQueue = [], extrasPending = new Set();
  let extraBusy = false, extraHalted = false, lastExtraRequest = 0;
  let overlay, results, summary, extraStatus, sortSelect, fromInput, toInput, limitSelect, minInput;
  let viewContext = null, viewSeq = 0, viewTimer, open = false, observer;
  let attached = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  function extraKey(row) {
    const novel = viewContext?.kind === 'novels';
    return (novel ? 'novel:' : 'illust:') + row.id;
  }
  function excerpt(html) {
    const d = new DOMParser().parseFromString(String(html || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n'), 'text/html');
    const text = (d.body.textContent || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]*\n+/g, '\n').trim();
    const chars = Array.from(text);
    return chars.slice(0, 180).join('') + (chars.length > 180 ? '…' : '');
  }
  function drawExtra(node, extra) {
    if (!node.isConnected) return;
    node.replaceChildren();
    const tags = $new('div', 'pbs-extra-tags');
    for (const tag of extra.tags || []) tags.append($new('span', 'pbs-extra-tag', '#' + tag));
    if (!tags.childNodes.length) tags.textContent = 'タグなし';
    node.append(tags, $new('div', 'pbs-extra-caption', extra.caption ? 'キャプション：' + extra.caption : 'キャプションの記載なし'));
  }
  function queueExtra(key, node) {
    if (!key || extrasPending.has(key) || extraHalted || !open) return;
    if (extras.has(key)) { drawExtra(node, extras.get(key)); return; }
    extrasPending.add(key); extrasQueue.push({key, node}); void processExtras();
  }
  async function processExtras() {
    if (extraBusy || extraHalted || !open) return;
    extraBusy = true;
    try {
      while (open && extrasQueue.length && !extraHalted) {
        const {key, node} = extrasQueue.shift();
        if (!node.isConnected) { extrasPending.delete(key); continue; }
        let item = extras.get(key);
        if (!item) {
          const db = await extrasDb();
          if (db) item = await fromStore(db, key);
          if (!item) {
            const remaining = Math.max(0, DETAIL_WAIT - (Date.now() - lastExtraRequest));
            if (remaining) await pause(remaining);
            if (!open) { extrasPending.delete(key); break; }
            lastExtraRequest = Date.now();
            let response;
            try { response = await fetch('/ajax/' + key.replace(':', '/'), {credentials:'same-origin', headers:{Accept:'application/json'}}); }
            catch { extraHalted = true; extraStatus.textContent = '追加情報の通信に失敗しました。再読み込み後にお試しください。'; break; }
            if (!response.ok) {
              if (response.status === 404) { node.textContent = '作品情報がありません（404）'; extrasPending.delete(key); continue; }
              extraHalted = true; extraStatus.textContent = `追加情報を停止しました（HTTP ${response.status}）。時間を置いて再読み込みしてください。`; break;
            }
            const json = await response.json().catch(() => null);
            if (!json?.body || json.error) { extraHalted = true; extraStatus.textContent = '追加情報を確認できず停止しました。'; break; }
            const raw = Array.isArray(json.body.tags) ? json.body.tags : json.body.tags?.tags;
            const tags = Array.isArray(raw) ? raw.map(t => typeof t === 'string' ? t : t?.tag).filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()) : [];
            item = {key, tags:[...new Set(tags)], caption:excerpt(json.body.description || json.body.caption || '')};
            if (db) saveExtra(db, item);
          }
          extras.set(key, item);
        }
        extrasPending.delete(key);
        drawExtra(node, item);
      }
    } finally { extraBusy = false; }
  }
  function hide() {
    open = false; ++viewSeq; clearTimeout(viewTimer);
    observer?.disconnect(); observer = null;
    extrasQueue.length = 0; extrasPending.clear();
    overlay?.classList.remove('pbs-open');
  }
  function resultLink(row) {
    return (viewContext?.kind === 'novels' ? '/novel/show.php?id=' : '/artworks/') + row.id;
  }
  function renderList() {
    if (!open || !viewContext) return;
    const ctx = viewContext, token = ++viewSeq;
    const from = day(fromInput.value), to = day(toInput.value);
    if ((fromInput.value && !from) || (toInput.value && !to) || (from && to && from > to)) {
      summary.textContent = '投稿日を確認してください。開始日は終了日以前に指定してください。'; results.replaceChildren(); return;
    }
    const min = Math.max(0, Number(minInput.value) || 0);
    const max = Number(limitSelect.value) || 100;
    summary.textContent = '保存済みの調査データを並べ替え中…';
    topRows(ctx.key, min, sortSelect.value, from, to, max).then(({rows, matched, unknownDates}) => {
      if (!open || token !== viewSeq || ctx.key !== viewContext?.key) return;
      summary.textContent = `${ctx.kind === 'novels' ? '小説' : 'イラスト・漫画'}「${ctx.word}」／ ${sortSelect.value === 'newest' ? '投稿日が新しい順' : 'ブクマ数が多い順'} ／ 条件一致 ${matched.toLocaleString('ja-JP')}件・表示 ${rows.length}件${(from || to) && unknownDates ? `（投稿日不明 ${unknownDates}件は期間指定から除外）` : ''}`;
      observer?.disconnect(); observer = null;
      results.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (const w of rows) {
        const link = $new('a', 'pbs-new-row');
        link.href = resultLink(w); link.target = '_blank'; link.rel = 'noopener noreferrer';
        const image = $new('img'); image.loading = 'lazy'; image.alt = w.title || '作品';
        if (/^https:\/\/(i|s)\.pximg\.net\//.test(w.thumb || '')) image.src = w.thumb;
        const info = $new('div', 'pbs-new-info');
        info.append($new('div', 'pbs-new-bookmarks', '♥ ' + Number(w.count).toLocaleString('ja-JP')),
          $new('div', 'pbs-new-title', w.title || '無題'),
          $new('div', 'pbs-new-author', w.userName || ''),
          $new('div', 'pbs-new-date', '投稿日：' + (day(w.date) || '未取得')));
        const extra = $new('div', 'pbs-extra', 'タグ・キャプションを読み込み待ち…');
        extra.dataset.key = extraKey(w);
        info.append(extra); link.append(image, info); fragment.append(link);
      }
      if (!rows.length) fragment.append($new('p', 'pbs-new-empty', '該当する保存済み作品がありません。調査を進めるか、絞り込みを変えてください。'));
      results.append(fragment);
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(entries => {
          for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); queueExtra(entry.target.dataset.key, entry.target); }
        }, {root:overlay, rootMargin:'160px 0px'});
        for (const e of results.querySelectorAll('.pbs-extra')) {
          const cached = extras.get(e.dataset.key);
          if (cached) drawExtra(e, cached);
          else observer.observe(e);
        }
      } else {
        for (const e of [...results.querySelectorAll('.pbs-extra')].slice(0, 20)) queueExtra(e.dataset.key, e);
      }
      extraStatus.textContent = extraHalted ? extraStatus.textContent : 'タグ・キャプションは画面に見える作品から順に追加取得します。';
    }).catch(err => { if (open && token === viewSeq) summary.textContent = '保存済み結果を開けません：' + (err?.message || err); });
  }
  function scheduleRender() {
    if (!open) return;
    clearTimeout(viewTimer); viewTimer = setTimeout(renderList, 900);
  }
  function applyDatesToSearch() {
    const from = day(fromInput.value), to = day(toInput.value);
    if ((fromInput.value && !from) || (toInput.value && !to) || (from && to && from > to)) {
      summary.textContent = '日付の範囲を確認してください。'; return;
    }
    const u = new URL(location.href);
    if (from) u.searchParams.set('scd', from); else u.searchParams.delete('scd');
    if (to) u.searchParams.set('ecd', to); else u.searchParams.delete('ecd');
    u.searchParams.delete('p');
    hide();
    location.assign(u.href);
  }
  function init() {
    if (attached) return true;
    const host = document.getElementById(HOST_ID), root = host?.shadowRoot;
    const source = root?.querySelector('.results');
    const counted = root?.querySelector('.counted');
    if (!source || !counted) return false;
    attached = true;
    const css = $new('style');
    css.textContent = `
      .pbs-new-button{display:block!important;width:100%!important;margin:10px 0 0!important;padding:13px!important;background:#1976d2!important;color:#fff!important;border:0!important;border-radius:9px!important;font-weight:700!important;font-size:15px!important}
      .pbs-new-overlay{display:none!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;z-index:2147483647!important;background:#f5f6fb!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;color:#263040!important;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif!important}
      .pbs-new-overlay.pbs-open{display:block!important}.pbs-new-header{position:sticky;top:0;z-index:1;background:#fff;border-bottom:1px solid #dce1e9;padding:12px}.pbs-new-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.pbs-new-toolbar strong{font-size:17px}.pbs-new-filters{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:10px}.pbs-new-filters label{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:12px}.pbs-new-filters input[type=date]{width:145px;max-width:100%}.pbs-new-filters input[type=number]{width:95px}.pbs-new-filters select{max-width:100%}.pbs-new-summary,.pbs-extra-status{font-size:12px;color:#586277;margin-top:8px;line-height:1.5}.pbs-new-list{max-width:920px;margin:auto;padding:10px 10px 75px}.pbs-new-row{display:flex;align-items:flex-start;gap:12px;background:white;color:#263040!important;text-decoration:none!important;border:1px solid #e2e6ed;border-radius:10px;padding:10px;margin-bottom:10px}.pbs-new-row img{width:76px;height:100px;flex:none;object-fit:contain;background:#eef0f4}.pbs-new-info{min-width:0;flex:1;overflow-wrap:anywhere}.pbs-new-bookmarks{font-weight:800;color:#c52650;font-size:16px}.pbs-new-title{font-weight:700;margin-top:4px}.pbs-new-author,.pbs-new-date{font-size:12px;color:#667286;margin-top:4px}.pbs-extra{margin-top:9px;font-size:12px;color:#4b5870}.pbs-extra-tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}.pbs-extra-tag{border-radius:5px;padding:2px 5px;background:#edf5fe;color:#24689d;font-size:11px}.pbs-extra-caption{white-space:pre-line;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:5;overflow:hidden}.pbs-new-empty{padding:15px;color:#586277}.pbs-new-help{color:#586277;font-size:11px;margin-top:7px}.pbs-new-overlay button,.pbs-new-overlay input,.pbs-new-overlay select{font:inherit;border:1px solid #d5d9e2;border-radius:7px;background:white;color:#263040;padding:7px;max-width:100%}.pbs-new-overlay .pbs-new-apply{background:#1976d2;color:white;border:0}
      @media(max-width:600px){.pbs-new-header{padding:10px}.pbs-new-filters{gap:7px}.pbs-new-filters label{font-size:11px}.pbs-new-filters input[type=date]{width:133px}.pbs-new-row img{width:66px;height:88px}}
    `;
    root.append(css);
    const openButton = $new('button', 'pbs-new-button', '📚 ブクマ順・新着順の結果を見る');
    openButton.type = 'button'; counted.after(openButton);
    overlay = $new('section', 'pbs-new-overlay');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    const header = $new('div', 'pbs-new-header');
    const bar = $new('div', 'pbs-new-toolbar');
    const heading = $new('strong', '', '♥ 検索結果');
    const back = $new('button', '', '← 調査画面へ戻る'); back.type = 'button';
    bar.append(heading, back);
    const filters = $new('div', 'pbs-new-filters');
    sortSelect = $new('select'); sortSelect.setAttribute('aria-label','結果の並び順');
    sortSelect.append(new Option('♥ ブクマ数が多い順', 'bookmarks'), new Option('🕒 投稿日が新しい順', 'newest'));
    try {sortSelect.value = localStorage.getItem(SORT_KEY) === 'newest' ? 'newest' : 'bookmarks';} catch {sortSelect.value = 'bookmarks';}
    limitSelect = $new('select'); limitSelect.setAttribute('aria-label','表示する作品数');
    limitSelect.append(new Option('100件表示','100'),new Option('300件表示','300'),new Option('1000件表示','1000'));
    const sortLabel = $new('label', '', '並び順'); sortLabel.append(sortSelect);
    const limitLabel = $new('label', '', '表示数'); limitLabel.append(limitSelect);
    minInput = $new('input'); minInput.type='number'; minInput.min='0'; minInput.max='1000000000'; minInput.value='0'; minInput.inputMode='numeric';
    const minLabel = $new('label', '', '最低ブクマ'); minLabel.append(minInput);
    fromInput = $new('input'); fromInput.type='date'; fromInput.setAttribute('aria-label','投稿日・開始日');
    toInput = $new('input'); toInput.type='date'; toInput.setAttribute('aria-label','投稿日・終了日');
    const fromLabel = $new('label', '', '投稿日から'); fromLabel.append(fromInput);
    const toLabel = $new('label', '', 'まで'); toLabel.append(toInput);
    const applyButton = $new('button', 'pbs-new-apply', 'この期間で検索'); applyButton.type='button';
    filters.append(sortLabel, limitLabel, minLabel, fromLabel, toLabel, applyButton);
    summary = $new('div', 'pbs-new-summary');
    const help = $new('div', 'pbs-new-help', '日付はまず保存済み作品を絞り込みます。「この期間で検索」を押すとpixivの検索条件にも適用し、対象期間の調査を別データとして開始・再開できます。未調査の作品は一覧に含まれません。');
    extraStatus = $new('div', 'pbs-extra-status');
    header.append(bar, filters, summary, help, extraStatus);
    results = $new('div', 'pbs-new-list'); overlay.append(header, results); root.append(overlay);
    openButton.addEventListener('click', () => {
      viewContext = searchContext();
      if (!viewContext) { window.alert('Pixivのタグ検索・作品検索ページから開いてください。'); return; }
      const baseMinimum = root.querySelector('.minimum');
      minInput.value = baseMinimum?.value || '0';
      fromInput.value = viewContext.from;
      toInput.value = viewContext.to;
      open = true; overlay.classList.add('pbs-open'); overlay.scrollTop = 0;
      renderList();
    });
    back.addEventListener('click', hide);
    root.querySelector('.close')?.addEventListener('click', hide);
    for (const control of [sortSelect, limitSelect, minInput, fromInput, toInput]) {
      control.addEventListener('change', () => {
        if (control === sortSelect) try {localStorage.setItem(SORT_KEY, sortSelect.value);} catch {}
        scheduleRender();
      });
    }
    applyButton.addEventListener('click', applyDatesToSearch);
    new MutationObserver(scheduleRender).observe(source, {childList:true});
    new MutationObserver(scheduleRender).observe(counted, {childList:true,characterData:true,subtree:true});
    return true;
  }
  if (!init()) {
    let tries = 0;
    const timer = setInterval(() => {if (init() || ++tries >= 120) clearInterval(timer);},250);
  }
})();


// ---- Novel TXT editor/exporter (integrated in v0.6.0) ----
(() => {
  'use strict';
  if (window.__pixivNovelTextExportV060) return;
  window.__pixivNovelTextExportV060 = true;

  const ROOT_ID = 'pnte-root';
  const BTN_ID = 'pnte-button';
  const STYLE_ID = 'pnte-style';

  let original = null;
  let overlay = null;
  let pageHost = null;
  let statusNode = null;
  let metaToggle = null;
  let dialogueSpacingToggle = null;
  let indentModeSelect = null;

  const novelId = () => {
    const u = new URL(location.href);
    return u.pathname === '/novel/show.php' && /^\d+$/.test(u.searchParams.get('id') || '')
      ? u.searchParams.get('id')
      : null;
  };

  const sleepFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

  function normalizeNewlines(text) {
    // pixiv本文には通常のLF/CRLF以外のUnicode行区切りが混ざる場合がある。
    // textareaでは改行に見えても split('\n') では分割されないため、先にすべてLFへ統一する。
    return String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0085\u2028\u2029]/g, '\n');
  }

  function decodeEntities(text) {
    const t = document.createElement('textarea');
    t.innerHTML = String(text ?? '');
    return t.value;
  }

  function cleanupPlainText(text) {
    return normalizeNewlines(text)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function pixivMarkupToText(raw) {
    let text = normalizeNewlines(raw);

    // Preserve useful textual information while removing presentation-only pixiv tags.
    text = text.replace(/\[chapter:([^\]\n]*)\]/g, (_, title) => `\n${title.trim()}\n`);
    text = text.replace(/\[PARAGRAPH\]/g, '\n');
    text = text.replace(/\\n/g, '\n');
    text = text.replace(/\[uploadedimage:[^\]\n]*\]/g, '');
    text = text.replace(/\[pixivimage:[^\]\n]*\]/g, '');
    text = text.replace(/\[jump:\d+\]/g, '');
    text = text.replace(/\[\[jumpuri:([\s\S]*?)\s*>\s*[^\]]+\]\]/g, (_, label) => label.trim());
    text = text.replace(/\[\[rb:([\s\S]*?)\s*>\s*([^\]]*?)\]\]/g, (_, base, ruby) => {
      base = base.trim(); ruby = ruby.trim();
      return ruby ? `${base}《${ruby}》` : base;
    });
    text = text.replace(/\[\[emphasismark:([\s\S]*?)>[^\]]*\]\]/g, (_, body) => body.trim());
    text = text.replace(/\[(?:b|i):([^\]]*)\]/g, '$1');

    return cleanupPlainText(decodeEntities(text));
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    doc.querySelectorAll('script,style,noscript,img,picture,figure,svg,canvas').forEach(n => n.remove());

    // Keep ruby readable in a plain-text file.
    doc.querySelectorAll('ruby').forEach(ruby => {
      const reading = [...ruby.querySelectorAll('rt')].map(n => n.textContent || '').join('').trim();
      const clone = ruby.cloneNode(true);
      clone.querySelectorAll('rt,rp').forEach(n => n.remove());
      const base = (clone.textContent || '').trim();
      ruby.replaceWith(doc.createTextNode(reading ? `${base}《${reading}》` : base));
    });

    doc.querySelectorAll('br').forEach(br => br.replaceWith(doc.createTextNode('\n')));
    doc.querySelectorAll('p,div,section,article,h1,h2,h3,h4,h5,h6,li,blockquote').forEach(el => {
      el.before(doc.createTextNode('\n'));
      el.after(doc.createTextNode('\n'));
    });
    return cleanupPlainText(doc.body.textContent || '');
  }

  function parseContent(raw) {
    const source = normalizeNewlines(raw);
    const hasPixivPages = /\[newpage\]/i.test(source);
    const looksHtml = /<\/?(?:p|div|br|span|a|ruby|rt|img|section|article|h[1-6])\b/i.test(source);

    if (hasPixivPages) {
      const chunks = source.split(/\[newpage\]/i);
      return {
        format: looksHtml ? 'pixiv記法＋HTML混在' : 'pixiv小説記法',
        pages: chunks.map(chunk => looksHtml ? htmlToText(pixivMarkupToText(chunk)) : pixivMarkupToText(chunk))
      };
    }

    return {
      format: looksHtml ? 'HTML' : 'プレーン/小説記法',
      pages: [looksHtml ? htmlToText(source) : pixivMarkupToText(source)]
    };
  }

  async function fetchNovel(id) {
    const response = await fetch(`/ajax/novel/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    if (json?.error || !json?.body) throw new Error(json?.message || '本文データを取得できませんでした');
    if (typeof json.body.content !== 'string') throw new Error('本文 content が見つかりませんでした');
    return json.body;
  }

  function safeFileName(name) {
    const cleaned = String(name || 'pixiv小説')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '＿')
      .replace(/[. ]+$/g, '')
      .trim();
    return (cleaned || 'pixiv小説').slice(0, 140) + '.txt';
  }

  function cleanupOutputText(text) {
    return normalizeNewlines(text)
      .replace(/[ \\t]+\\n/g, '\\n')
      .replace(/\\n[ \\t]+/g, '\\n')
      .replace(/^\\n+|\\n+$/g, '');
  }

  function buildOutput() {
    if (!original || !pageHost) return '';
    const pages = [...pageHost.querySelectorAll('.pnte-page')]
      .filter(card => card.querySelector('.pnte-include')?.checked)
      .map(card => cleanupPlainText(card.querySelector('textarea')?.value || ''))
      .filter(Boolean);

    const parts = [];
    if (metaToggle?.checked) {
      parts.push(original.title || '無題');
      if (original.userName) parts.push(`作者：${original.userName}`);
      parts.push('');
    }
    // ページ境界は改行6個（空行5行）をそのまま保持する。
    parts.push(pages.join('\\n\\n\\n\\n\\n\\n'));
    return cleanupOutputText(parts.join('\\n')) + '\\n';
  }

  async function saveText() {
    if (!original) return;
    const text = buildOutput();
    if (!text.trim()) {
      statusNode.textContent = '保存する本文がありません。ページのチェックまたは本文を確認してください。';
      return;
    }

    const file = new File([text], safeFileName(original.title), { type: 'text/plain;charset=utf-8' });

    // iPhone/iPadでは共有シート →「ファイルに保存」が最も安定。
    try {
      const appleMobile = /iP(?:hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (appleMobile && navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: original.title || 'pixiv小説' });
        statusNode.textContent = '共有シートへ渡しました。「ファイルに保存」を選べます。';
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        statusNode.textContent = '共有をキャンセルしました。';
        return;
      }
      // Fall through to a normal Blob download.
    }

    const blobUrl = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = file.name;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    statusNode.textContent = 'TXT保存を開始しました。';
  }

  async function copyText() {
    const text = buildOutput();
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      statusNode.textContent = '編集後の本文をクリップボードへコピーしました。';
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      statusNode.textContent = ok ? '編集後の本文をコピーしました。' : 'コピーできませんでした。';
    }
  }

  function isNovelHeading(line) {
    const s = line.trim();
    if (!s || Array.from(s).length > 40) return false;
    return /^(?:第.{1,18}[章話節幕部編]|序章|終章|序幕|終幕|幕間|間章|前書き|まえがき|後書き|あとがき|プロローグ|エピローグ|Prologue|Epilogue|Chapter\\s*[0-9０-９]+|CHAPTER\\s*[0-9０-９]+|[0-9０-９]+[.．、]\s*\\S+)/i.test(s);
  }

  function isDialogueLike(line) {
    return /^[「『（【〔［〈《“‘〝〟…‥―—─・※＊*#◇◆○●◎△▲▽▼□■☆★♪♩♬]/.test(line.trimStart());
  }

  function formatNovelText(text, addDialogueSpacing, indentMode) {
    const rawLines = normalizeNewlines(text).split('\n').map(line => line.replace(/[ \t　]+$/g, ''));
    const prepared = [];

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i];
      if (!raw.trim()) {
        prepared.push('');
        continue;
      }

      const hadIndent = /^[ \t\u00a0　]+/.test(raw);
      const visible = raw.replace(/^[ \t\u00a0　]+/g, '');
      const heading = isNovelHeading(visible);
      const special = isDialogueLike(visible);

      let shouldIndent = false;
      if (!heading && !special) {
        if (indentMode === 'blank') {
          // ページ先頭・空行の直後だけを新段落として扱う。
          shouldIndent = i === 0 || !rawLines[i - 1]?.trim() || hadIndent;
        } else {
          // pixiv上の実改行をすべて段落頭として扱う。
          shouldIndent = true;
        }
      }

      prepared.push(shouldIndent ? '　' + visible : visible);
    }

    const spaced = [];
    for (let i = 0; i < prepared.length; i++) {
      const line = prepared[i];
      if (!line) {
        if (spaced.length && spaced[spaced.length - 1] !== '') spaced.push('');
        continue;
      }

      const heading = isNovelHeading(line);
      if (heading && spaced.length && spaced[spaced.length - 1] !== '') spaced.push('');

      if (addDialogueSpacing && spaced.length) {
        let j = spaced.length - 1;
        while (j >= 0 && spaced[j] === '') j--;
        if (j >= 0 && spaced[spaced.length - 1] !== '') {
          const prev = spaced[j];
          if (!isNovelHeading(prev) && !heading && isDialogueLike(prev) !== isDialogueLike(line)) {
            spaced.push('');
          }
        }
      }

      spaced.push(line);
      if (heading) spaced.push('');
    }

    return normalizeNewlines(spaced.join('\n'))
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function formatAllPages() {
    if (!pageHost) return;
    const cards = [...pageHost.querySelectorAll('.pnte-page')];
    if (!cards.length) return;

    for (const card of cards) {
      const ta = card.querySelector('textarea');
      if (!ta) continue;
      ta.value = formatNovelText(ta.value, !!dialogueSpacingToggle?.checked, indentModeSelect?.value || 'line');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const indentLabel = indentModeSelect?.value === 'blank' ? '空行の後だけ字下げ' : '改行ごとに字下げ';
    statusNode.textContent = dialogueSpacingToggle?.checked
      ? `小説向けに整形しました（${indentLabel}／会話と地の文の切り替わりに空行あり）。`
      : `小説向けに整形しました（${indentLabel}）。`;
  }

  function restorePages() {
    if (!original) return;
    drawPages(original.pages);
    statusNode.textContent = '取得時の本文に戻しました。';
  }

  function drawPages(pages) {
    pageHost.replaceChildren();
    pages.forEach((text, index) => {
      const card = document.createElement('section');
      card.className = 'pnte-page';

      const head = document.createElement('div');
      head.className = 'pnte-page-head';
      const label = document.createElement('label');
      const include = document.createElement('input');
      include.type = 'checkbox'; include.checked = true; include.className = 'pnte-include';
      label.append(include, document.createTextNode(` ページ ${index + 1} を保存`));
      const chars = document.createElement('span');
      chars.textContent = `${Array.from(text).length.toLocaleString('ja-JP')}字`;
      head.append(label, chars);

      const ta = document.createElement('textarea');
      ta.value = text;
      ta.spellcheck = false;
      ta.setAttribute('aria-label', `ページ${index + 1} 本文`);
      ta.addEventListener('input', () => {
        chars.textContent = `${Array.from(ta.value).length.toLocaleString('ja-JP')}字`;
      });

      include.addEventListener('change', () => {
        card.classList.toggle('pnte-excluded', !include.checked);
      });

      card.append(head, ta);
      pageHost.append(card);
    });
  }

  function closeOverlay() {
    overlay?.classList.remove('pnte-open');
  }

  async function openEditor() {
    const id = novelId();
    if (!id) return;
    overlay.classList.add('pnte-open');
    pageHost.replaceChildren();
    statusNode.textContent = 'pixivから本文を取得中…';

    try {
      const body = await fetchNovel(id);
      const parsed = parseContent(body.content);
      original = {
        id,
        title: body.title || document.title || '無題',
        userName: body.userName || body.user?.name || '',
        url: `https://www.pixiv.net/novel/show.php?id=${id}`,
        format: parsed.format,
        pages: parsed.pages
      };
      drawPages(original.pages);
      const total = original.pages.reduce((n, p) => n + Array.from(p).length, 0);
      statusNode.textContent = `取得成功：${original.pages.length}ページ／${total.toLocaleString('ja-JP')}字／取得形式 ${original.format}`;
    } catch (err) {
      original = null;
      statusNode.textContent = `取得失敗：${err?.message || err}`;
      const detail = document.createElement('div');
      detail.className = 'pnte-error';
      detail.textContent = 'この表示をそのまま教えてください。pixiv側の返却形式に合わせて修正します。';
      pageHost.append(detail);
    }
  }

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BTN_ID}{position:fixed;right:18px;bottom:90px;z-index:2147483000;border:0;border-radius:999px;padding:11px 15px;background:#0096fa;color:#fff;font:700 14px/1.2 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;box-shadow:0 4px 16px #0003;cursor:pointer}
      #${ROOT_ID}{display:none;position:fixed;inset:0;z-index:2147483646;background:#f4f6f8;color:#202124;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;overflow:auto;-webkit-overflow-scrolling:touch}
      #${ROOT_ID}.pnte-open{display:block}
      #${ROOT_ID} *{box-sizing:border-box}
      .pnte-header{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #dfe3e8;padding:10px 12px;box-shadow:0 2px 8px #0000000d}
      .pnte-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:980px;margin:auto}
      .pnte-bar strong{font-size:16px;margin-right:auto}
      .pnte-bar button{border:1px solid #ccd2d9;background:#fff;color:#202124;border-radius:8px;padding:8px 10px;font:inherit;font-weight:600}
      .pnte-bar .pnte-save{background:#0096fa;color:#fff;border-color:#0096fa}
      .pnte-meta{max-width:980px;margin:8px auto 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;color:#59636e}
      .pnte-status{max-width:980px;margin:7px auto 0;font-size:12px;color:#59636e;overflow-wrap:anywhere}
      .pnte-pages{max-width:980px;margin:0 auto;padding:12px 10px 80px}
      .pnte-page{background:#fff;border:1px solid #dfe3e8;border-radius:10px;margin:0 0 12px;padding:10px;transition:opacity .15s}
      .pnte-page.pnte-excluded{opacity:.46}
      .pnte-page-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:7px;font-size:13px;font-weight:700}
      .pnte-page-head span{font-size:11px;color:#727d88;font-weight:400}
      .pnte-page textarea{display:block;width:100%;min-height:46vh;resize:vertical;border:1px solid #ccd2d9;border-radius:8px;padding:12px;background:#fff;color:#202124;font:15px/1.8 ui-monospace,SFMono-Regular,Menlo,'Noto Sans Mono CJK JP','Noto Sans JP',monospace;white-space:pre-wrap}
      .pnte-error{background:#fff3f3;color:#b42318;border:1px solid #f3c3c3;border-radius:8px;padding:12px}
      @media(max-width:600px){#${BTN_ID}{right:12px;bottom:76px;padding:10px 13px}.pnte-header{padding:8px}.pnte-bar{gap:6px}.pnte-bar button{padding:7px 8px;font-size:12px}.pnte-bar strong{width:100%;font-size:15px}.pnte-meta{font-size:11px}.pnte-pages{padding:10px 7px 70px}.pnte-page{padding:8px}.pnte-page textarea{min-height:52vh;font-size:14px;line-height:1.75}}
    `;
    document.head.append(style);
  }

  function buildUi() {
    if (document.getElementById(ROOT_ID)) return;
    injectCss();

    const button = document.createElement('button');
    button.id = BTN_ID;
    button.type = 'button';
    button.textContent = '📖 小説TXT';
    button.addEventListener('click', openEditor);
    document.body.append(button);

    overlay = document.createElement('div');
    overlay.id = ROOT_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const header = document.createElement('header');
    header.className = 'pnte-header';
    const bar = document.createElement('div');
    bar.className = 'pnte-bar';
    const title = document.createElement('strong');
    title.textContent = '📖 pixiv小説 TXT編集・保存';

    const restore = document.createElement('button');
    restore.type = 'button'; restore.textContent = '↩ 原文に戻す';
    restore.addEventListener('click', restorePages);

    const format = document.createElement('button');
    format.type = 'button'; format.textContent = '📖 小説向け整形';
    format.addEventListener('click', formatAllPages);

    const copy = document.createElement('button');
    copy.type = 'button'; copy.textContent = 'コピー';
    copy.addEventListener('click', copyText);

    const save = document.createElement('button');
    save.type = 'button'; save.className = 'pnte-save'; save.textContent = '💾 TXT保存';
    save.addEventListener('click', saveText);

    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '閉じる';
    close.addEventListener('click', closeOverlay);

    bar.append(title, restore, format, copy, save);

    const meta = document.createElement('div');
    meta.className = 'pnte-meta';
    const metaLabel = document.createElement('label');
    metaToggle = document.createElement('input');
    metaToggle.type = 'checkbox'; metaToggle.checked = false;
    metaLabel.append(metaToggle, document.createTextNode(' タイトル・作者名をTXT先頭に入れる'));
    const indentLabel = document.createElement('label');
    indentLabel.append(document.createTextNode('字下げ：'));
    indentModeSelect = document.createElement('select');
    indentModeSelect.setAttribute('aria-label', '字下げ基準');
    indentModeSelect.append(
      new Option('改行ごと', 'line'),
      new Option('空行の後だけ', 'blank')
    );
    indentModeSelect.value = 'blank';
    indentLabel.append(indentModeSelect);

    const dialogueLabel = document.createElement('label');
    dialogueSpacingToggle = document.createElement('input');
    dialogueSpacingToggle.type = 'checkbox'; dialogueSpacingToggle.checked = false;
    dialogueLabel.append(dialogueSpacingToggle, document.createTextNode(' 整形時、会話と地の文の間を1行空ける'));

    const hint = document.createElement('span');
    hint.textContent = '不要なページはチェックOFF／一部分だけ消す場合は本文を直接編集';
    meta.append(metaLabel, indentLabel, dialogueLabel, hint);

    statusNode = document.createElement('div');
    statusNode.className = 'pnte-status';
    statusNode.textContent = 'まだ取得していません。';

    header.append(bar, meta, statusNode);
    pageHost = document.createElement('main');
    pageHost.className = 'pnte-pages';
    overlay.append(header, pageHost);
    document.body.append(overlay);
  }

  async function init() {
    // pixiv can re-render portions of the page; attach only after body exists.
    if (!document.body) await sleepFrame();
    if (novelId()) buildUi();
  }

  void init();
})();



// ---- Unified Pixiv tools shell (v0.6.0) ----
(() => {
  'use strict';
  if (window.__pixivUnifiedToolsV060) return;
  window.__pixivUnifiedToolsV060 = true;

  const BAR_ID = 'pixiv-tools-unified-bar';
  const LAUNCH_ID = 'pixiv-tools-unified-launch';
  const PLACEHOLDER_ID = 'pixiv-tools-unified-placeholder';
  const OFFSET = 78;
  let opened = false;
  let active = '';

  function isNovelPage() {
    const u = new URL(location.href);
    return u.pathname === '/novel/show.php' && /^\d+$/.test(u.searchParams.get('id') || '');
  }

  function isSearchPage() {
    const u = new URL(location.href);
    if (/^\/tags\/[^/]+(?:\/(?:artworks|illustrations|manga|novels))?(?:\/|$)/.test(u.pathname)) return true;
    if (u.pathname === '/novel/search.php') return !!(u.searchParams.get('word') || u.searchParams.get('q'));
    if (['/search', '/search.php'].includes(u.pathname)) return !!(u.searchParams.get('word') || u.searchParams.get('q'));
    return false;
  }

  function bookmarkUi() {
    const host = document.getElementById('pixiv-bookmark-sort-cross-page-v05');
    const root = host?.shadowRoot;
    return root ? {
      root,
      launch: root.querySelector('.launch'),
      veil: root.querySelector('.veil'),
      close: root.querySelector('.close'),
      viewer: root.querySelector('.pbs-new-overlay')
    } : null;
  }

  function novelUi() {
    return {
      button: document.getElementById('pnte-button'),
      overlay: document.getElementById('pnte-root')
    };
  }

  function ensurePageSpecificUi() {
    // The novel module may be initialized a frame after this shell.
    const n = novelUi();
    if (n.button) n.button.style.setProperty('display', 'none', 'important');

    const b = bookmarkUi();
    if (b?.launch) b.launch.style.setProperty('display', 'none', 'important');

    if (b?.root && !b.root.getElementById?.('pixiv-tools-unified-shadow-style')) {
      const style = document.createElement('style');
      style.id = 'pixiv-tools-unified-shadow-style';
      style.textContent = `
        .launch{display:none!important}
        .veil{top:${OFFSET}px!important;right:0!important;bottom:0!important;left:0!important}
        .panel{height:100%!important;max-height:100%!important;border-radius:0!important}
        .heading .close{display:none!important}
        .pbs-new-overlay{top:${OFFSET}px!important;right:0!important;bottom:0!important;left:0!important;height:auto!important}
      `;
      b.root.append(style);
    }
  }

  function hideBookmark() {
    const b = bookmarkUi();
    if (!b) return;
    b.viewer?.classList.remove('pbs-open');
    b.veil?.classList.remove('open');
  }

  function hideNovel() {
    novelUi().overlay?.classList.remove('pnte-open');
  }

  function showPlaceholder(message) {
    const node = document.getElementById(PLACEHOLDER_ID);
    if (!node) return;
    node.textContent = message;
    node.classList.add('open');
  }

  function hidePlaceholder() {
    document.getElementById(PLACEHOLDER_ID)?.classList.remove('open');
  }

  function paintTabs() {
    const bar = document.getElementById(BAR_ID);
    if (!bar) return;
    for (const btn of bar.querySelectorAll('[data-tool-tab]')) {
      btn.classList.toggle('active', btn.dataset.toolTab === active);
    }
  }

  function openBookmark() {
    active = 'bookmark';
    paintTabs();
    hidePlaceholder();
    hideNovel();

    if (!isSearchPage()) {
      hideBookmark();
      showPlaceholder('♥ 全体ブックマークは、pixivのタグ検索・作品検索ページで利用できます。');
      return;
    }

    const b = bookmarkUi();
    if (!b?.launch || !b?.veil) {
      showPlaceholder('全体ブックマーク機能を準備中です。少し待ってからもう一度お試しください。');
      return;
    }

    if (!b.veil.classList.contains('open')) b.launch.click();
  }

  function openNovel() {
    active = 'novel';
    paintTabs();
    hidePlaceholder();
    hideBookmark();

    if (!isNovelPage()) {
      hideNovel();
      showPlaceholder('📖 小説TXTは、pixivの小説作品ページで利用できます。');
      return;
    }

    const n = novelUi();
    if (!n.overlay || !n.button) {
      showPlaceholder('小説TXT機能を準備中です。少し待ってからもう一度お試しください。');
      return;
    }

    if (n.overlay.querySelector('.pnte-page')) {
      n.overlay.classList.add('pnte-open');
    } else {
      n.button.click();
    }
  }

  function switchTo(tab) {
    ensurePageSpecificUi();
    if (tab === 'novel') openNovel();
    else openBookmark();
  }

  function closeAll() {
    opened = false;
    hidePlaceholder();
    hideNovel();

    const b = bookmarkUi();
    if (b?.veil?.classList.contains('open') && b.close) b.close.click();
    else hideBookmark();

    document.getElementById(BAR_ID)?.classList.remove('open');
  }

  function openShell() {
    opened = true;
    document.getElementById(BAR_ID)?.classList.add('open');
    const preferred = isNovelPage() ? 'novel' : 'bookmark';
    switchTo(preferred);
  }

  function updateAvailability() {
    ensurePageSpecificUi();
    const launch = document.getElementById(LAUNCH_ID);
    if (!launch) return;
    const useful = isNovelPage() || isSearchPage();
    launch.style.display = useful ? 'block' : 'none';

    // Do not change tabs automatically while the panel is open.
    // A manually selected tab must stay selected, even when the current page
    // cannot use that tool; that tab will show its own availability message.
  }

  function buildShell() {
    if (document.getElementById(BAR_ID)) return;

    const style = document.createElement('style');
    style.textContent = `
      #pnte-button{display:none!important}
      #pnte-root{top:${OFFSET}px!important;right:0!important;bottom:0!important;left:0!important;height:auto!important}
      #${LAUNCH_ID}{position:fixed;right:14px;bottom:max(76px,env(safe-area-inset-bottom));z-index:2147483001;border:0;border-radius:999px;padding:12px 16px;background:#0096fa;color:#fff;font:700 14px/1.2 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;box-shadow:0 4px 18px #0004}
      #${BAR_ID}{display:none;position:fixed;top:0;left:0;right:0;height:${OFFSET}px;z-index:2147483647;background:#fff;color:#202124;border-bottom:1px solid #dfe3e8;box-shadow:0 2px 9px #0002;padding:max(7px,env(safe-area-inset-top)) 10px 7px;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${BAR_ID}.open{display:flex;align-items:flex-end;gap:8px}
      #${BAR_ID} .pt-title{font-weight:800;font-size:15px;white-space:nowrap;margin:0 4px 5px 2px}
      #${BAR_ID} [data-tool-tab]{border:1px solid #ccd2d9;background:#fff;color:#333;border-radius:9px;padding:9px 11px;font:700 13px/1 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${BAR_ID} [data-tool-tab].active{background:#0096fa;color:#fff;border-color:#0096fa}
      #${BAR_ID} .pt-close{margin-left:auto;border:1px solid #ccd2d9;background:#fff;color:#333;border-radius:9px;padding:9px 11px;font:700 13px/1 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${PLACEHOLDER_ID}{display:none;position:fixed;top:${OFFSET}px;right:0;bottom:0;left:0;z-index:2147483645;background:#f4f6f8;color:#59636e;padding:36px 20px;text-align:center;font:14px/1.8 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${PLACEHOLDER_ID}.open{display:block}
      @media(max-width:600px){
        #${BAR_ID}{padding-left:7px;padding-right:7px;gap:5px}
        #${BAR_ID} .pt-title{font-size:13px;margin-right:1px}
        #${BAR_ID} [data-tool-tab],#${BAR_ID} .pt-close{font-size:11px;padding:8px 7px}
        #${LAUNCH_ID}{right:12px;bottom:max(76px,env(safe-area-inset-bottom));padding:11px 14px}
      }
    `;
    document.head.append(style);

    const launch = document.createElement('button');
    launch.id = LAUNCH_ID;
    launch.type = 'button';
    launch.textContent = '🧰 Pixivツール';
    launch.addEventListener('click', openShell);

    const bar = document.createElement('div');
    bar.id = BAR_ID;

    const title = document.createElement('div');
    title.className = 'pt-title';
    title.textContent = 'Pixivツール';

    const bookmark = document.createElement('button');
    bookmark.type = 'button';
    bookmark.dataset.toolTab = 'bookmark';
    bookmark.textContent = '♥ 全体ブックマーク';
    bookmark.addEventListener('click', () => switchTo('bookmark'));

    const novel = document.createElement('button');
    novel.type = 'button';
    novel.dataset.toolTab = 'novel';
    novel.textContent = '📖 小説TXT';
    novel.addEventListener('click', () => switchTo('novel'));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pt-close';
    close.textContent = '閉じる';
    close.addEventListener('click', closeAll);

    bar.append(title, bookmark, novel, close);

    const placeholder = document.createElement('div');
    placeholder.id = PLACEHOLDER_ID;

    document.body.append(launch, bar, placeholder);
    updateAvailability();
  }

  function init() {
    if (!document.body) {
      requestAnimationFrame(init);
      return;
    }
    buildShell();
    ensurePageSpecificUi();
    setInterval(updateAvailability, 900);
  }

  init();
})();

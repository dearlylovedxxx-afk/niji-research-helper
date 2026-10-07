// ==UserScript==
// @name         Pixiv イラスト・小説 ブクマ順（検索結果横断）
// @namespace    local.pixiv.bookmark-sort.cross-page
// @version      0.6.29
// @description  Pixivツールを1つのパネルに統合。全体ブックマーク調査・小説TXT・検索条件の保存と呼び出しに対応。
// @match        https://www.pixiv.net/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.meta.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Pixiv_Bookmark_Sort.user.js
// ==/UserScript==


// ---- Cross-page bookmark engine (embedded; DB schema preserved) ----
(() => {
  try { if (window.top !== window.self) return; } catch { return; }
'use strict';
if (window.__pixivBookmarkCrossPageV05) return;
window.__pixivBookmarkCrossPageV05 = true;
const DB='pixiv-bookmark-sort-cross-page-v02', PREF='pixiv-bookmark-sort-minimum-v03', MAX=1000, WAIT=2500;
const fmt=n=>Number(n).toLocaleString('ja-JP');
let dbPromise, context, searchKey='', running=null, lastRequest=0, timer, seq=0, limit=100, failedUrl='';
const number=v=>/^\d+$/.test(String(v).trim()) ? Math.min(1e9,Math.floor(Number(v))) : 0;
const ageMode=v=>['safe','r18'].includes(String(v||'').toLowerCase())?String(v).toLowerCase():'all';
const ageLabel=v=>ageMode(v)==='safe'?'全年齢':ageMode(v)==='r18'?'R-18':'すべて';
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
 p.set('word',word);p.set('s_mode',mode);p.set('mode',ageMode(p.get('mode')));
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
async function json(url,signal){let serverRetries=0;while(true){const remain=Math.max(0,WAIT-(Date.now()-lastRequest));if(remain)await new Promise((ok,no)=>{const t=setTimeout(()=>{signal.removeEventListener('abort',cancel);ok()},remain);function cancel(){clearTimeout(t);no(new DOMException('中断','AbortError'))}signal.addEventListener('abort',cancel,{once:true})});abort(signal);lastRequest=Date.now();const r=await fetch(url,{credentials:'same-origin',signal,headers:{Accept:'application/json'}});
 if(r.status===404){const e=new Error('404');e.notFound=true;throw e}if(r.status===429)throw new Error('429：pixivのアクセス制限です。時間を置いてから再開してください。自動再試行はしません。');if(r.status>=500&&r.status<=599&&serverRetries<2){serverRetries++;const wait=serverRetries*5000;message('pixiv側で HTTP '+r.status+' が発生しました。'+(wait/1000)+'秒待って再試行します（'+serverRetries+'/2）…');await new Promise((ok,no)=>{const t=setTimeout(()=>{signal.removeEventListener('abort',cancel);ok()},wait);function cancel(){clearTimeout(t);no(new DOMException('中断','AbortError'))}signal.addEventListener('abort',cancel,{once:true})});continue}if(!r.ok){const e=new Error('通信エラー HTTP '+r.status+(serverRetries?'（再試行 '+serverRetries+'回後）':''));e.requestUrl=url;e.httpStatus=r.status;throw e}const data=await r.json();if(!data||data.error)throw new Error(data?.message||'pixiv APIエラー');return data.body}}
async function page(ctx,n,signal){const u=new URL('/ajax/search/'+ctx.kind+'/'+encodeURIComponent(ctx.word),location.origin);u.search=ctx.params.toString();u.searchParams.set('order','date_d');u.searchParams.set('p',String(n));const b=await json(u.href,signal),g=ctx.kind==='novels'?b?.novel:(b?.illustManga||b?.illust||b?.manga);if(!Array.isArray(g?.data))throw new Error('検索結果の形式が変わった可能性があります');return {total:Number(g.total),last:Number(g.lastPage),data:g.data,works:g.data.filter(w=>w&&/^\d+$/.test(String(w.id))&&!w.isAdContainer)}}
async function detail(id,kind,signal){const b=await json('/ajax/'+(kind==='novels'?'novel':'illust')+'/'+encodeURIComponent(id),signal);if(!Number.isFinite(Number(b?.bookmarkCount)))throw new Error('ブックマーク数が取得できません');return b}
const host=document.createElement('div');host.id='pixiv-bookmark-sort-cross-page-v05';const root=host.attachShadow({mode:'open'});root.innerHTML=`<style>:host{all:initial;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;color-scheme:light}*{box-sizing:border-box}button,select,input{font:inherit;border:1px solid #d5d9e2;background:#fff;color:#263040;padding:9px;border-radius:8px}button,select{cursor:pointer}button:disabled{opacity:.5}.launch{position:fixed;right:12px;bottom:max(50px,env(safe-area-inset-bottom));z-index:2147483645;background:#eb3e63;color:white;border:0;border-radius:30px;font-weight:700;padding:13px 16px;box-shadow:0 4px 18px #0004}.veil{display:none;position:fixed;z-index:2147483646;inset:0;background:#111a}.veil.open{display:flex}.panel{margin:auto;width:min(1100px,100%);height:min(94dvh,100%);display:flex;flex-direction:column;overflow:hidden;background:#f5f6fb;color:#263040;border-radius:16px}.head{flex:none;padding:12px;background:white;border-bottom:1px solid #ddd}.heading,.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.heading{justify-content:space-between}.heading h2{font-size:17px;margin:0}.controls{margin-top:10px}.primary{background:#eb3e63;color:white}.minimum{width:105px}.status{white-space:pre-wrap;font-size:13px;line-height:1.5;margin-top:10px}.counted{font-size:12px;color:#b4294e;margin-top:8px}.note{font-size:11px;line-height:1.5;color:#586277;margin:8px 0 0}.results{flex:1;overflow:auto;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));align-content:start;gap:10px;padding:12px}.card{display:flex;flex-direction:column;text-decoration:none;color:#263040;background:white;border-radius:9px;overflow:hidden;min-width:0}.card img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#e6e9ef}.card.novel img{aspect-ratio:3/4;object-fit:contain}.info{padding:8px}.num{color:#e33159;font-weight:700}.title{font-size:12px;overflow-wrap:anywhere}.author{font-size:11px;color:#647087}@media(max-width:600px){.panel{height:100dvh;border-radius:0}.results{grid-template-columns:repeat(2,minmax(0,1fr))}}</style><button class="launch">♥ 全体ブクマ順</button><div class="veil" role="dialog" aria-modal="true"><section class="panel"><div class="head"><div class="heading"><h2>♥ 検索結果をブックマーク数順に</h2><button class="close" aria-label="閉じる">×</button></div><div class="controls"><button class="start primary">全件の調査を開始／再開</button><button class="stop" disabled>一時停止</button><button class="reset">保存結果を消して再調査</button><select class="limit" aria-label="表示数"><option value="100">上位100件</option><option value="300">上位300件</option><option value="1000">上位1000件</option></select><label>年齢制限 <select class="age" aria-label="年齢制限"><option value="all">すべて</option><option value="safe">全年齢</option><option value="r18">R-18</option></select></label><label>最低ブクマ数 <input class="minimum" type="number" inputmode="numeric" min="0" max="1000000000" step="1">件以上</label><select class="preset" aria-label="最低ブクマ数の候補"><option value="custom">件数を選ぶ</option><option value="0">指定なし</option><option value="100">100件以上</option><option value="500">500件以上</option><option value="1000">1000件以上</option><option value="5000">5000件以上</option><option value="10000">10000件以上</option></select></div><div class="status" aria-live="polite"></div><button class="debug" hidden>エラーの診断用URLを表示</button><div class="counted" aria-live="polite"></div><p class="note">検索結果の各ページから作品を調べ、確認済み作品を人気順に表示します。途中で止めても結果は保存され、全件調査が終わるまでは暫定順位です。最低ブクマ数は表示だけを絞り、取得件数を減らすものではありません。作品数やpixivの制限により全件取得できない場合があります。アクセス制限の迂回・自動再試行はしません。</p></div><div class="results"></div></section></div>`;document.body.append(host);
const $=s=>root.querySelector(s),launch=$('.launch'),veil=$('.veil'),startBtn=$('.start'),stopBtn=$('.stop'),status=$('.status'),items=$('.results'),age=$('.age'),minInput=$('.minimum'),preset=$('.preset'),counted=$('.counted'),debug=$('.debug');minInput.value=String(minimum);preset.value=[0,100,500,1000,5000,10000].includes(minimum)?String(minimum):'custom';
const message=s=>{status.textContent=s},buttons=on=>{startBtn.disabled=on;stopBtn.disabled=!on},stop=()=>running?.abort();
function stats(m,extra=''){return `${context?.kind==='novels'?'小説':'イラスト・漫画'}：検索結果 約${Number.isFinite(m.total)?fmt(m.total):'不明'}作品｜発見 ${fmt(m.discovered)}件｜確認 ${fmt(m.processed)}件｜閲覧不可 ${fmt(m.skipped)}件\n${m.searchDone?'検索ページの取得終了':'次のページ：'+m.nextPage}${extra?'｜'+extra:''}${m.note?'\n'+m.note:''}`}
async function render(k){if(!k||k!==searchKey||!veil.classList.contains('open'))return;const id=++seq,[count,rows]=await ranked(k,minimum,limit);if(k!==searchKey||id!==seq||!veil.classList.contains('open'))return;items.replaceChildren();counted.textContent=`確認済みで ♥ ${fmt(minimum)}件以上：${fmt(count)}作品（表示 ${fmt(rows.length)}作品）`;for(const w of rows){const novel=context?.kind==='novels',a=document.createElement('a');a.className='card'+(novel?' novel':'');a.href=(novel?'/novel/show.php?id=':'/artworks/')+w.id;a.target='_blank';a.rel='noopener noreferrer';const image=document.createElement('img');image.loading='lazy';image.alt=w.title||'表紙';if(/^https:\/\/(i|s)\.pximg\.net\//.test(w.thumb||''))image.src=w.thumb;const info=document.createElement('div');info.className='info';const n=document.createElement('div');n.className='num';n.textContent='♥ '+fmt(w.count);const title=document.createElement('div');title.className='title';title.textContent=w.title||'無題';const author=document.createElement('div');author.className='author';author.textContent=w.userName||'';info.append(n,title,author);a.append(image,info);items.append(a)}if(!rows.length){const p=document.createElement('p');p.textContent='条件に一致する確認済み作品はまだありません。調査を進めるか最低件数を下げてください。';items.append(p)}}
function schedule(k,instant=false){clearTimeout(timer);timer=setTimeout(()=>render(k).catch(e=>message('表示エラー：'+e.message)),instant?0:600)}
async function refresh(){const c=current();launch.style.display=c?'':'none';if(!c){stop();veil.classList.remove('open');return}if(age)age.value=ageMode(c.params.get('mode'));if(c.key!==searchKey){stop();searchKey=c.key;context=c;failedUrl='';debug.hidden=true;items.replaceChildren();counted.textContent=''}if(!veil.classList.contains('open'))return;try{const m=await meta(c.key);if(searchKey===c.key){message('検索条件：'+c.word+' ／ 年齢制限：'+ageLabel(c.params.get('mode'))+'\n'+stats(m,running?'調査中':'開始／再開できます'));schedule(c.key,true)}}catch(e){message('保存領域を開けません：'+e.message)}}
async function scan(c,ctrl){const m=await meta(c.key);while(true){abort(ctrl.signal);if(c.key!==searchKey)throw new DOMException('検索条件変更','AbortError');const w=await pending(c.key);if(w){message(stats(m,'ブクマ数を確認中'));try{await saveDetail(m,w,await detail(w.id,c.kind,ctrl.signal),false)}catch(e){if(e.notFound)await saveDetail(m,w,{},true);else throw e}if(m.processed%5===0)schedule(c.key);continue}if(m.searchDone){message(stats(m,'取得可能な検索結果の調査終了'));schedule(c.key,true);return}if(m.nextPage>MAX){m.note='安全上1000ページで停止。検索全件を取得したわけではありません。';await putMeta(m);message(stats(m));return}message(stats(m,'検索ページ '+m.nextPage+' を取得中'));const p=await page(c,m.nextPage,ctrl.signal);if(Number.isFinite(p.total))m.total=p.total;if(Number.isInteger(p.last)&&p.last>0)m.lastPage=p.last;if(!p.data.length){m.searchDone=true;await putMeta(m);continue}const n=m.nextPage;await savePage(c.key,m,p.works,p.data.length);if(Number.isFinite(m.total)&&m.total>=0&&m.pageSize&&n*m.pageSize>=m.total){m.searchDone=true;await putMeta(m)}else if(m.lastPage&&n>=m.lastPage){m.searchDone=true;m.note='pixivが返した最終ページまで取得。全作品を取得できたとは限りません。';await putMeta(m)}schedule(c.key)}}
function start(){if(running||!context)return;const c=context,ctrl=new AbortController();running=ctrl;failedUrl='';debug.hidden=true;buttons(true);scan(c,ctrl).catch(e=>{if(e.name==='AbortError')message('一時停止しました。保存済みの結果から再開できます。');else{failedUrl=e.requestUrl||'';debug.hidden=!failedUrl;message('調査を停止しました：'+e.message+'\n保存済みの結果は残っています。')}}).finally(()=>{if(running===ctrl){running=null;buttons(false)}schedule(c.key,true)})}
launch.addEventListener('click',()=>{veil.classList.add('open');refresh()});$('.close').addEventListener('click',()=>{stop();veil.classList.remove('open')});veil.addEventListener('click',e=>{if(e.target===veil){stop();veil.classList.remove('open')}});startBtn.addEventListener('click',start);stopBtn.addEventListener('click',stop);debug.addEventListener('click',()=>{if(failedUrl)prompt('失敗したpixivのURLです。検索語を含むため共有前に確認してください。',failedUrl)});$('.reset').addEventListener('click',async()=>{if(running||!searchKey||!confirm('この検索条件の保存結果を削除して最初から調べ直しますか？'))return;await clear(searchKey);await refresh()});$('.limit').addEventListener('change',e=>{limit=Number(e.target.value);schedule(searchKey,true)});
age?.addEventListener('change',()=>{const next=ageMode(age.value);if(running&&!confirm('調査を一時停止して年齢制限を切り替えますか？')){age.value=ageMode(context?.params?.get('mode'));return}stop();const u=new URL(location.href);u.searchParams.set('mode',next);u.searchParams.delete('p');location.assign(u.href)});
function changeMin(v){minimum=number(v);minInput.value=String(minimum);preset.value=[0,100,500,1000,5000,10000].includes(minimum)?String(minimum):'custom';try{localStorage.setItem(PREF,String(minimum))}catch{}schedule(searchKey,true)}
minInput.addEventListener('change',()=>changeMin(minInput.value));minInput.addEventListener('keydown',e=>{if(e.key==='Enter'){changeMin(minInput.value);minInput.blur()}});preset.addEventListener('change',()=>{if(preset.value!=='custom')changeMin(preset.value);else minInput.focus()});setInterval(()=>{const c=current();if((!c&&searchKey)||(c&&c.key!==searchKey))refresh()},1200);refresh();
})();

(() => {
  try { if (window.top !== window.self) return; } catch { return; }
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
  try { if (window.top !== window.self) return; } catch { return; }
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

  function normalizeTxtPunctuation(text) {
    return String(text ?? '')
      .replace(/\u203C\uFE0F?/g, '！！')
      .replace(/\u2049\uFE0F?/g, '！？')
      .replace(/\u2047\uFE0F?/g, '？？')
      .replace(/\u2048\uFE0F?/g, '？！')
      .replace(/\u2757\uFE0F?/g, '！')
      .replace(/\u2753\uFE0F?/g, '？')
      .replace(/!/g, '！')
      .replace(/\?/g, '？');
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
    return normalizeTxtPunctuation(
      normalizeNewlines(text)
        .replace(/[ \\t]+\\n/g, '\\n')
        .replace(/\\n[ \\t]+/g, '\\n')
        .replace(/^\\n+|\\n+$/g, '')
    );
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
    const blobUrl = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = file.name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    statusNode.textContent = 'TXTをダウンロードしました。iPhone/iPadでは「ダウンロード」フォルダを確認してください。';
  }

  async function shareText() {
    if (!original) return;
    const text = buildOutput();
    if (!text.trim()) {
      statusNode.textContent = '共有する本文がありません。ページのチェックまたは本文を確認してください。';
      return;
    }

    const file = new File([text], safeFileName(original.title), { type: 'text/plain;charset=utf-8' });
    if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
      statusNode.textContent = 'このブラウザではファイル共有に対応していません。ダウンロードをお使いください。';
      return;
    }

    try {
      await navigator.share({ files: [file], title: original.title || 'pixiv小説' });
      statusNode.textContent = '共有シートへ渡しました。';
    } catch (err) {
      if (err?.name === 'AbortError') {
        statusNode.textContent = '共有をキャンセルしました。';
      } else {
        statusNode.textContent = `共有できませんでした：${err?.message || err}`;
      }
    }
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
    save.type = 'button'; save.className = 'pnte-save'; save.textContent = '⬇️ ダウンロード';
    save.addEventListener('click', saveText);

    const share = document.createElement('button');
    share.type = 'button'; share.textContent = '📤 共有して保存';
    share.addEventListener('click', shareText);

    const searches = document.createElement('button');
    searches.type = 'button';
    searches.dataset.toolTab = 'searches';
    searches.textContent = '🔖 保存検索';
    searches.addEventListener('click', () => switchTo('searches'));

    const close = document.createElement('button');
    close.type = 'button'; close.textContent = '閉じる';
    close.addEventListener('click', closeOverlay);

    bar.append(title, restore, format, copy, save, share);

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




// ---- Saved Pixiv searches + cross-search newest feed (v0.6.12) ----
(() => {
  try { if (window.top !== window.self) return; } catch { return; }
  'use strict';
  if (window.__pixivSavedSearchesV0612) return;
  window.__pixivSavedSearchesV0612 = true;

  const STORAGE_KEY = 'pixiv-saved-searches-v1';
  const FEED_EXCLUDE_TAGS_KEY = 'pixiv-saved-searches-feed-exclude-tags-v1';
  const ROOT_ID = 'pixiv-saved-searches-root';
  const OFFSET = 78;
  const MAX_SAVED = 200;
  const FEED_STEP = 60;
  const FEED_SEARCH_CONCURRENCY = 3;
  const FEED_DETAIL_CONCURRENCY = 4;
  let root = null;

  let feedOpen = false;
  let feedLoading = false;
  let feedGeneration = 0;
  let feedAbort = null;
  let feedStates = [];
  let feedWorks = new Map();
  let feedVisibleCount = FEED_STEP;
  let feedObserver = null;
  let detailQueue = [];
  let detailActive = 0;
  let feedExcludeTags = readExcludeTags();

  function isSearchUrl(u) {
    if (/^\/tags\/[^/]+(?:\/(?:artworks|illustrations|manga|novels))?(?:\/|$)/.test(u.pathname)) return true;
    if (u.pathname === '/novel/search.php') return !!(u.searchParams.get('word') || u.searchParams.get('q'));
    if (['/search', '/search.php'].includes(u.pathname)) return !!(u.searchParams.get('word') || u.searchParams.get('q'));
    return false;
  }

  function currentSearch() {
    const u = new URL(location.href);
    if (!isSearchUrl(u)) return null;
    u.searchParams.delete('p');
    const tag = u.pathname.match(/^\/tags\/([^/]+)(?:\/(artworks|illustrations|manga|novels))?/);
    let word = '';
    if (tag) {
      try { word = decodeURIComponent(tag[1]); } catch { word = tag[1]; }
    } else {
      word = u.searchParams.get('word') || u.searchParams.get('q') || '';
    }
    let kind = tag?.[2] || '';
    if (!kind) {
      if (u.pathname === '/novel/search.php') kind = 'novels';
      else {
        const type = u.searchParams.get('type') || '';
        kind = ['novel','novels'].includes(type) ? 'novels' : type === 'manga' ? 'manga' : ['illust','illustrations'].includes(type) ? 'illustrations' : 'artworks';
      }
    }
    const query = u.searchParams.toString();
    return {
      href: u.pathname + (query ? '?' + query : ''),
      word,
      kind
    };
  }

  function readSaved() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(value)) return [];
      return value.filter(row => row && typeof row.href === 'string' && row.href.startsWith('/') && typeof row.name === 'string');
    } catch {
      return [];
    }
  }

  function writeSaved(rows) {
    const clean = rows.slice(0, MAX_SAVED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    window.dispatchEvent(new Event('pixiv-saved-searches-changed'));
    render();
  }

  function normalizeExcludeTag(value) {
    return String(value || '').trim().replace(/^#+/, '').normalize('NFKC').toLocaleLowerCase('ja-JP');
  }

  function parseExcludeTags(value) {
    const rows = String(value || '').split(/[\n,、]+/).map(x => x.trim()).filter(Boolean);
    const unique = new Map();
    for (const raw of rows) {
      const key = normalizeExcludeTag(raw);
      if (!key || unique.has(key)) continue;
      unique.set(key, raw.replace(/^#+/, '').trim());
    }
    return [...unique.values()];
  }

  function readExcludeTags() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FEED_EXCLUDE_TAGS_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parseExcludeTags(parsed.join('\n'));
    } catch {
      return [];
    }
  }

  function saveExcludeTags(tags) {
    feedExcludeTags = parseExcludeTags((tags || []).join('\n'));
    try { localStorage.setItem(FEED_EXCLUDE_TAGS_KEY, JSON.stringify(feedExcludeTags)); } catch {}
  }

  function excludedTagSet() {
    return new Set(feedExcludeTags.map(normalizeExcludeTag).filter(Boolean));
  }

  function excludedByTag(work) {
    if (!feedExcludeTags.length || !Array.isArray(work?.tags) || !work.tags.length) return false;
    const blocked = excludedTagSet();
    return work.tags.some(tag => blocked.has(normalizeExcludeTag(tag)));
  }

  function excludedTagFor(work) {
    if (!feedExcludeTags.length || !Array.isArray(work?.tags)) return '';
    const blocked = excludedTagSet();
    return work.tags.find(tag => blocked.has(normalizeExcludeTag(tag))) || '';
  }

  function syncExcludeTagUi() {
    if (!root) return;
    const input = root.querySelector('.pss-feed-exclude-input');
    const summary = root.querySelector('.pss-feed-exclude-summary');
    if (input && document.activeElement !== input) input.value = feedExcludeTags.join(', ');
    if (summary) summary.textContent = feedExcludeTags.length
      ? `🚫 除外タグ ${feedExcludeTags.length}件`
      : '🚫 除外タグなし';
  }

  function applyExcludeTagInput() {
    if (!root) return;
    const input = root.querySelector('.pss-feed-exclude-input');
    if (!input) return;
    saveExcludeTags(parseExcludeTags(input.value));
    syncExcludeTagUi();
    feedVisibleCount = FEED_STEP;
    renderFeed();
  }

  function kindLabel(kind) {
    return kind === 'novels' ? '小説' : kind === 'manga' ? '漫画' : kind === 'illustrations' ? 'イラスト' : '作品';
  }

  function defaultName(search) {
    return `${search.word || '検索'}｜${kindLabel(search.kind)}`.slice(0, 80);
  }

  function conditionSummary(row) {
    try {
      const u = new URL(row.href, location.origin);
      const params = [...u.searchParams.keys()].filter(k => !['word','q','p'].includes(k));
      return `${kindLabel(row.kind)} ／ ${row.word || '検索条件'}${params.length ? ` ／ 条件${new Set(params).size}項目` : ''}`;
    } catch {
      return row.word || row.href;
    }
  }

  function saveCurrent() {
    const cur = currentSearch();
    if (!cur) {
      alert('Pixivの検索結果ページを開いてから保存してください。');
      return;
    }
    const rows = readSaved();
    const same = rows.find(row => row.href === cur.href);
    const name = prompt(same ? 'この検索条件は保存済みです。名前を変更しますか？' : 'この検索条件の保存名を入力してください。', same?.name || defaultName(cur));
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = Date.now();
    if (same) {
      same.name = trimmed;
      same.word = cur.word;
      same.kind = cur.kind;
      same.updatedAt = now;
    } else {
      rows.unshift({id: crypto.randomUUID(), name: trimmed, href: cur.href, word: cur.word, kind: cur.kind, createdAt: now, updatedAt: now});
    }
    writeSaved(rows);
  }

  function renameRow(id) {
    const rows = readSaved(), row = rows.find(x => x.id === id);
    if (!row) return;
    const name = prompt('保存名を変更', row.name);
    if (name === null || !name.trim()) return;
    row.name = name.trim();
    row.updatedAt = Date.now();
    writeSaved(rows);
  }

  function overwriteRow(id) {
    const cur = currentSearch();
    if (!cur) {
      alert('上書き元にするPixiv検索結果ページを開いてください。');
      return;
    }
    const rows = readSaved(), row = rows.find(x => x.id === id);
    if (!row) return;
    if (!confirm(`「${row.name}」を現在の検索条件で上書きしますか？`)) return;
    row.href = cur.href;
    row.word = cur.word;
    row.kind = cur.kind;
    row.updatedAt = Date.now();
    writeSaved(rows);
  }

  function deleteRow(id) {
    const rows = readSaved(), row = rows.find(x => x.id === id);
    if (!row || !confirm(`「${row.name}」を保存検索から削除しますか？`)) return;
    writeSaved(rows.filter(x => x.id !== id));
  }

  function moveRow(id, delta) {
    const rows = readSaved(), i = rows.findIndex(x => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    writeSaved(rows);
  }

  function openRow(row) {
    location.assign(new URL(row.href, location.origin).href);
  }

  function ageMode(v) {
    v = String(v || '').toLowerCase();
    return ['safe','r18'].includes(v) ? v : 'all';
  }

  function savedContext(row) {
    const u = new URL(row.href, location.origin);
    const tag = u.pathname.match(/^\/tags\/([^/]+)(?:\/(artworks|illustrations|manga|novels))?(?:\/|$)/);
    let word = '';
    let kind = row.kind || '';
    let mode = '';

    if (tag) {
      try { word = decodeURIComponent(tag[1]); } catch { word = tag[1]; }
      kind = tag[2] || kind || 'artworks';
      mode = u.searchParams.get('s_mode') || 's_tag_full';
    } else if (u.pathname === '/novel/search.php') {
      word = u.searchParams.get('word') || u.searchParams.get('q') || row.word || '';
      kind = 'novels';
      mode = u.searchParams.get('s_mode') || 's_tag';
    } else if (['/search', '/search.php'].includes(u.pathname)) {
      word = u.searchParams.get('word') || u.searchParams.get('q') || row.word || '';
      if (!kind) {
        const type = u.searchParams.get('type') || '';
        kind = ['novel','novels'].includes(type) ? 'novels' : type === 'manga' ? 'manga' : ['illust','illustrations'].includes(type) ? 'illustrations' : 'artworks';
      }
      mode = u.searchParams.get('s_mode') || 's_tag';
    } else {
      throw new Error('未対応の保存検索URLです');
    }

    if (!word) throw new Error('検索語を取得できません');

    const params = new URLSearchParams();
    const art = kind !== 'novels';
    const keys = ['mode','scd','ecd','ai_type','work_lang','lang',...(art ? ['wlt','wgt','hlt','hgt','ratio','tool'] : ['tlt','tgt','wlt','wgt','original_only','genre'])];
    for (const key of keys) for (const v of u.searchParams.getAll(key)) params.append(key, v);

    mode = mode === 'tag_tc' ? (art ? 's_tag_tc' : 's_tag') : mode === 'tc' ? 's_tc' : mode;
    params.set('word', word);
    params.set('s_mode', mode);
    params.set('mode', ageMode(params.get('mode')));

    if (art) {
      params.set('csw', '0');
      if (kind === 'artworks') params.set('type', 'all');
      else if (kind === 'manga') params.set('type', 'manga');
      else if (kind === 'illustrations') {
        const t = u.searchParams.get('type');
        if (['illust','ugoira','illust_and_ugoira'].includes(t)) params.set('type', t);
      }
    } else {
      const gs = u.searchParams.get('gs');
      if (['0','1'].includes(gs)) params.set('gs', gs);
    }

    return {row, word, kind, params};
  }

  async function pixivJson(url, signal) {
    const response = await fetch(url, {credentials:'same-origin', signal, headers:{Accept:'application/json'}});
    if (response.status === 429) throw new Error('429：Pixivのアクセス制限');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!data || data.error) throw new Error(data?.message || 'Pixiv APIエラー');
    return data.body;
  }

  function tagNames(value) {
    const list = Array.isArray(value) ? value : Array.isArray(value?.tags) ? value.tags : [];
    return [...new Set(list.map(x => typeof x === 'string' ? x : x?.tag || x?.name || '').filter(Boolean))];
  }

  function plainText(value) {
    const html = String(value || '').trim();
    if (!html) return '';
    const box = document.createElement('div');
    box.innerHTML = html.replace(/<br\s*\/?>/gi, '\n');
    return String(box.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function normalizeWork(raw, ctx) {
    const id = String(raw?.id || '');
    if (!/^\d+$/.test(id)) return null;
    const isNovel = ctx.kind === 'novels';
    const bookmark = Number(raw?.bookmarkCount);
    return {
      key:(isNovel ? 'novel:' : 'illust:') + id,
      id,
      type:isNovel ? 'novel' : 'illust',
      kind:ctx.kind,
      href:isNovel ? '/novel/show.php?id=' + encodeURIComponent(id) : '/artworks/' + encodeURIComponent(id),
      thumb:raw?.url || raw?.coverUrl || raw?.urls?.small || raw?.urls?.thumb || '',
      title:raw?.title || raw?.illustTitle || '無題',
      userName:raw?.userName || '',
      userId:String(raw?.userId || ''),
      createDate:raw?.createDate || raw?.uploadDate || '',
      caption:plainText(raw?.description || raw?.caption || ''),
      tags:tagNames(raw?.tags),
      bookmarkCount:Number.isFinite(bookmark) && bookmark >= 0 ? bookmark : null,
      pageCount:Number(raw?.pageCount || 0) || 0,
      matches:new Set([ctx.row.name]),
      detailLoaded:false,
      detailQueued:false,
      detailLoading:false
    };
  }

  async function fetchSearchPage(state, page, signal) {
    const ctx = state.ctx;
    const u = new URL('/ajax/search/' + ctx.kind + '/' + encodeURIComponent(ctx.word), location.origin);
    u.search = ctx.params.toString();
    u.searchParams.set('order', 'date_d');
    u.searchParams.set('p', String(page));
    const body = await pixivJson(u.href, signal);
    const group = ctx.kind === 'novels' ? body?.novel : (body?.illustManga || body?.illust || body?.manga);
    if (!Array.isArray(group?.data)) throw new Error('検索結果形式を取得できません');
    const total = Number(group.total || 0);
    const lastPage = Number(group.lastPage || 0) || Math.max(1, Math.ceil(total / Math.max(1, group.data.length || 60)));
    return {data:group.data, total, lastPage};
  }

  async function fetchDetail(work, signal) {
    const path = work.type === 'novel' ? '/ajax/novel/' : '/ajax/illust/';
    return await pixivJson(path + encodeURIComponent(work.id), signal);
  }

  function mergeWorks(rows, ctx) {
    let added = 0;
    for (const raw of rows || []) {
      const work = normalizeWork(raw, ctx);
      if (!work) continue;
      const old = feedWorks.get(work.key);
      if (old) {
        old.matches.add(ctx.row.name);
        if (!old.thumb && work.thumb) old.thumb = work.thumb;
        if (!old.caption && work.caption) old.caption = work.caption;
        if (!old.tags.length && work.tags.length) old.tags = work.tags;
        if (old.bookmarkCount == null && work.bookmarkCount != null) old.bookmarkCount = work.bookmarkCount;
      } else {
        feedWorks.set(work.key, work);
        added++;
      }
    }
    return added;
  }

  function allSortedWorks() {
    return [...feedWorks.values()].sort((a,b) => {
      const ad = Date.parse(a.createDate || 0) || 0;
      const bd = Date.parse(b.createDate || 0) || 0;
      if (bd !== ad) return bd - ad;
      return Number(b.id) - Number(a.id);
    });
  }

  function sortedWorks() {
    return allSortedWorks().filter(work => !excludedByTag(work));
  }

  async function mapLimit(items, limit, worker) {
    let index = 0;
    const runners = Array.from({length:Math.min(limit, items.length)}, async () => {
      while (index < items.length) {
        const current = items[index++];
        await worker(current);
      }
    });
    await Promise.allSettled(runners);
  }

  async function fetchStatePage(state, page, generation) {
    if (!state?.ctx || feedAbort?.signal.aborted || generation !== feedGeneration) return;
    try {
      const result = await fetchSearchPage(state, page, feedAbort.signal);
      if (generation !== feedGeneration) return;
      state.total = result.total;
      state.lastPage = result.lastPage;
      state.nextPage = page + 1;
      state.done = page >= result.lastPage;
      state.error = '';
      mergeWorks(result.data, state.ctx);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      state.error = String(e?.message || e);
    }
  }

  function feedStatusText() {
    const ok = feedStates.filter(s => s.ctx && !s.error).length;
    const bad = feedStates.filter(s => s.error).length;
    const total = feedStates.length;
    const allWorks = feedWorks.size;
    const visibleWorks = sortedWorks().length;
    const excluded = Math.max(0, allWorks - visibleWorks);
    return feedLoading
      ? `保存検索 ${total}件を更新中… 現在 ${visibleWorks.toLocaleString('ja-JP')}作品${excluded ? `（除外 ${excluded.toLocaleString('ja-JP')}）` : ''}`
      : `保存検索 ${ok}/${total}件取得 ／ 表示 ${visibleWorks.toLocaleString('ja-JP')}作品${excluded ? ` ／ 除外 ${excluded.toLocaleString('ja-JP')}作品` : ''}${bad ? ` ／ 失敗${bad}件` : ''}`;
  }

  function formatDate(value) {
    const d = new Date(value || 0);
    if (!Number.isFinite(+d) || +d <= 0) return '';
    return d.toLocaleString('ja-JP', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  function createFeedCard(work) {
    const card = document.createElement('article');
    card.className = 'pss-feed-card';
    card.dataset.workKey = work.key;

    const link = document.createElement('a');
    link.className = 'pss-feed-thumb';
    link.href = work.href;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = work.title;
    if (work.thumb) img.src = work.thumb;
    else img.classList.add('empty');
    link.append(img);

    const info = document.createElement('div');
    info.className = 'pss-feed-info';

    const top = document.createElement('div');
    top.className = 'pss-feed-top';
    const title = document.createElement('a');
    title.className = 'pss-feed-title';
    title.href = work.href;
    title.textContent = work.title;
    const count = document.createElement('span');
    count.className = 'pss-feed-bookmarks';
    count.textContent = work.bookmarkCount == null ? '♥ …' : '♥ ' + Number(work.bookmarkCount).toLocaleString('ja-JP');
    top.append(title, count);

    const author = document.createElement(work.userId ? 'a' : 'span');
    author.className = 'pss-feed-author';
    if (work.userId) author.href = '/users/' + encodeURIComponent(work.userId);
    author.textContent = work.userName || '作者不明';

    const date = document.createElement('div');
    date.className = 'pss-feed-date';
    date.textContent = formatDate(work.createDate);

    const caption = document.createElement('p');
    caption.className = 'pss-feed-caption';
    caption.textContent = work.caption || 'キャプション取得中…';

    const tags = document.createElement('div');
    tags.className = 'pss-feed-tags';
    for (const tag of work.tags.slice(0, 10)) {
      const a = document.createElement('a');
      a.href = '/tags/' + encodeURIComponent(tag) + '/artworks';
      a.textContent = '#' + tag;
      tags.append(a);
    }

    const matches = document.createElement('div');
    matches.className = 'pss-feed-matches';
    const matchNames = [...work.matches];
    for (const name of matchNames.slice(0, 4)) {
      const chip = document.createElement('span');
      chip.textContent = name;
      matches.append(chip);
    }
    if (matchNames.length > 4) {
      const more = document.createElement('span');
      more.textContent = '+' + (matchNames.length - 4);
      matches.append(more);
    }

    info.append(top, author, date, caption, tags, matches);
    card.append(link, info);
    return card;
  }

  function updateFeedCard(work) {
    if (!root) return;
    const card = [...root.querySelectorAll('.pss-feed-card')].find(x => x.dataset.workKey === work.key);
    if (!card) return;
    const count = card.querySelector('.pss-feed-bookmarks');
    if (count) count.textContent = work.bookmarkCount == null ? '♥ —' : '♥ ' + Number(work.bookmarkCount).toLocaleString('ja-JP');
    const caption = card.querySelector('.pss-feed-caption');
    if (caption) caption.textContent = work.caption || 'キャプションなし';
    const tags = card.querySelector('.pss-feed-tags');
    if (tags) {
      tags.replaceChildren();
      for (const tag of work.tags.slice(0, 10)) {
        const a = document.createElement('a');
        a.href = '/tags/' + encodeURIComponent(tag) + '/artworks';
        a.textContent = '#' + tag;
        tags.append(a);
      }
    }
  }

  function resetDetailQueue() {
    detailQueue = [];
    detailActive = 0;
  }

  function enqueueDetail(work, generation) {
    if (!work || work.detailLoaded || work.detailLoading || work.detailQueued) return;
    work.detailQueued = true;
    detailQueue.push({work, generation});
    pumpDetailQueue();
  }

  function pumpDetailQueue() {
    while (detailActive < FEED_DETAIL_CONCURRENCY && detailQueue.length) {
      const job = detailQueue.shift();
      const work = job.work;
      work.detailQueued = false;
      if (job.generation !== feedGeneration || feedAbort?.signal.aborted || work.detailLoaded || work.detailLoading) continue;
      work.detailLoading = true;
      detailActive++;
      fetchDetail(work, feedAbort.signal).then(body => {
        if (job.generation !== feedGeneration) return;
        const bookmark = Number(body?.bookmarkCount);
        if (Number.isFinite(bookmark) && bookmark >= 0) work.bookmarkCount = bookmark;
        work.caption = plainText(body?.description || body?.caption || work.caption);
        const tags = tagNames(body?.tags);
        if (tags.length) work.tags = tags;
        work.title = body?.title || work.title;
        work.userName = body?.userName || work.userName;
        work.userId = String(body?.userId || work.userId || '');
        work.detailLoaded = true;
        if (excludedByTag(work)) renderFeed();
        else updateFeedCard(work);
      }).catch(e => {
        if (e?.name !== 'AbortError') {
          work.detailLoaded = true;
          updateFeedCard(work);
        }
      }).finally(() => {
        work.detailLoading = false;
        detailActive = Math.max(0, detailActive - 1);
        pumpDetailQueue();
      });
    }
  }

  function observeFeedCards(works, generation) {
    feedObserver?.disconnect();
    if (!('IntersectionObserver' in window)) {
      for (const work of works.slice(0, 12)) enqueueDetail(work, generation);
      return;
    }
    feedObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const key = entry.target?.dataset?.workKey;
        const work = key ? feedWorks.get(key) : null;
        if (work) enqueueDetail(work, generation);
        feedObserver?.unobserve(entry.target);
      }
    }, {root, rootMargin:'500px 0px', threshold:0.01});

    for (const card of root.querySelectorAll('.pss-feed-card')) feedObserver.observe(card);
  }

  function renderFeed() {
    if (!root) return;
    syncExcludeTagUi();
    const status = root.querySelector('.pss-feed-status');
    if (status) status.textContent = feedStatusText();

    const grid = root.querySelector('.pss-feed-grid');
    const works = sortedWorks();
    const visible = works.slice(0, feedVisibleCount);
    grid.replaceChildren();

    if (!works.length && !feedLoading) {
      const empty = document.createElement('p');
      empty.className = 'pss-feed-empty';
      empty.textContent = '該当する新着作品がありません。';
      grid.append(empty);
    } else {
      for (const work of visible) grid.append(createFeedCard(work));
    }

    const showMore = root.querySelector('.pss-feed-show-more');
    const loadOlder = root.querySelector('.pss-feed-load-older');
    const refresh = root.querySelector('.pss-feed-refresh');
    const hasHidden = works.length > feedVisibleCount;
    const hasOlder = feedStates.some(s => s.ctx && !s.error && !s.done);

    showMore.hidden = !hasHidden;
    loadOlder.hidden = hasHidden || !hasOlder || feedLoading;
    refresh.disabled = feedLoading;
    loadOlder.disabled = feedLoading;
    showMore.disabled = feedLoading;

    observeFeedCards(visible, feedGeneration);
  }

  async function refreshFeed() {
    const rows = readSaved();
    feedAbort?.abort();
    feedAbort = new AbortController();
    feedGeneration++;
    const generation = feedGeneration;
    feedLoading = true;
    feedWorks = new Map();
    feedVisibleCount = FEED_STEP;
    feedStates = [];
    feedObserver?.disconnect();
    resetDetailQueue();

    for (const row of rows) {
      try {
        feedStates.push({row, ctx:savedContext(row), nextPage:1, lastPage:null, total:null, done:false, error:''});
      } catch (e) {
        feedStates.push({row, ctx:null, nextPage:1, lastPage:0, total:0, done:true, error:String(e?.message || e)});
      }
    }

    renderFeed();
    if (!feedStates.length) {
      feedLoading = false;
      renderFeed();
      return;
    }

    const valid = feedStates.filter(s => s.ctx);
    await mapLimit(valid, FEED_SEARCH_CONCURRENCY, async state => {
      await fetchStatePage(state, 1, generation);
      if (generation === feedGeneration) renderFeed();
    });

    if (generation !== feedGeneration) return;
    feedLoading = false;
    renderFeed();
  }

  async function loadOlderFeed() {
    if (feedLoading) return;
    const generation = feedGeneration;
    const targets = feedStates.filter(s => s.ctx && !s.error && !s.done && Number.isFinite(Number(s.nextPage)));
    if (!targets.length) return;
    feedLoading = true;
    renderFeed();

    await mapLimit(targets, FEED_SEARCH_CONCURRENCY, async state => {
      await fetchStatePage(state, state.nextPage, generation);
      if (generation === feedGeneration) renderFeed();
    });

    if (generation !== feedGeneration) return;
    feedLoading = false;
    feedVisibleCount = Math.max(feedVisibleCount, FEED_STEP);
    renderFeed();
  }

  function showManagePage() {
    if (!root) return;
    const manage = root.querySelector('.pss-manage-page');
    const feed = root.querySelector('.pss-feed-page');
    if (feed) {
      feed.hidden = true;
      feed.style.setProperty('display', 'none', 'important');
    }
    if (manage) {
      manage.hidden = false;
      manage.style.setProperty('display', 'block', 'important');
    }
  }

  function showFeedPage() {
    if (!root) return;
    const manage = root.querySelector('.pss-manage-page');
    const feed = root.querySelector('.pss-feed-page');
    if (manage) {
      manage.hidden = true;
      manage.style.setProperty('display', 'none', 'important');
    }
    if (feed) {
      feed.hidden = false;
      feed.style.setProperty('display', 'block', 'important');
    }
  }

  function openFeed() {
    build();
    if (!root) return;
    feedOpen = true;
    root.classList.add('open');
    showFeedPage();
    root.scrollTop = 0;
    void refreshFeed();
  }

  function closeFeed() {
    feedOpen = false;
    feedAbort?.abort();
    feedObserver?.disconnect();
    resetDetailQueue();
    if (!root) return;
    showManagePage();
    root.scrollTop = 0;
    render();
  }

  function render() {
    if (!root || feedOpen) return;
    const rows = readSaved();
    const list = root.querySelector('.pss-list');
    const current = currentSearch();
    const currentText = root.querySelector('.pss-current-text');
    const saveBtn = root.querySelector('.pss-save-current');
    const newestBtn = root.querySelector('.pss-newest-open');
    currentText.textContent = current
      ? `現在：${current.word || '検索'} ／ ${kindLabel(current.kind)}`
      : '現在のページは検索結果ページではありません。';
    saveBtn.disabled = !current;
    newestBtn.disabled = !rows.length;
    list.replaceChildren();

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'pss-empty';
      empty.textContent = '保存した検索条件はまだありません。検索結果ページで「現在の検索を保存」を押してください。';
      list.append(empty);
      return;
    }

    rows.forEach((row, index) => {
      const card = document.createElement('article');
      card.className = 'pss-card';

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'pss-open';
      main.addEventListener('click', () => openRow(row));
      const name = document.createElement('strong');
      name.textContent = row.name;
      const summary = document.createElement('span');
      summary.textContent = conditionSummary(row);
      main.append(name, summary);

      const actions = document.createElement('div');
      actions.className = 'pss-actions';
      const make = (label, fn, disabled=false) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.disabled = disabled;
        b.addEventListener('click', fn); return b;
      };
      actions.append(
        make('名前変更', () => renameRow(row.id)),
        make('現在条件で上書き', () => overwriteRow(row.id), !current),
        make('↑', () => moveRow(row.id, -1), index === 0),
        make('↓', () => moveRow(row.id, 1), index === rows.length - 1),
        make('削除', () => deleteRow(row.id))
      );
      card.append(main, actions);
      list.append(card);
    });
  }

  function build() {
    if (root || !document.body) return;
    const style = document.createElement('style');
    style.textContent = `
      #${ROOT_ID}{display:none;position:fixed;top:${OFFSET}px;right:0;bottom:0;left:0;z-index:2147483646;background:#f4f6f8;color:#202124;overflow:auto;-webkit-overflow-scrolling:touch;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${ROOT_ID}.open{display:block}
      #${ROOT_ID} *{box-sizing:border-box}
      #${ROOT_ID} a{color:inherit}
      #${ROOT_ID} .pss-wrap{max-width:1100px;margin:auto;padding:18px 14px 80px}
      #${ROOT_ID} .pss-head{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:#fff;border:1px solid #dde2e8;border-radius:12px;padding:14px;margin-bottom:12px}
      #${ROOT_ID} .pss-head h2{font-size:18px;margin:0}
      #${ROOT_ID} .pss-current-text{font-size:12px;color:#65707d;flex:1 1 100%}
      #${ROOT_ID} button{font:inherit;border:1px solid #ccd2d9;border-radius:8px;background:#fff;color:#202124;padding:9px 10px}
      #${ROOT_ID} button:disabled{opacity:.45}
      #${ROOT_ID} .pss-save-current,#${ROOT_ID} .pss-newest-open,#${ROOT_ID} .pss-feed-refresh{background:#0096fa;color:#fff;border-color:#0096fa;font-weight:700}
      #${ROOT_ID} .pss-card{background:#fff;border:1px solid #dde2e8;border-radius:12px;padding:10px;margin-bottom:10px}
      #${ROOT_ID} .pss-open{display:flex;width:100%;text-align:left;flex-direction:column;gap:4px;border:0;background:transparent;padding:5px}
      #${ROOT_ID} .pss-open strong{font-size:15px}
      #${ROOT_ID} .pss-open span{font-size:12px;color:#66717e;overflow-wrap:anywhere}
      #${ROOT_ID} .pss-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      #${ROOT_ID} .pss-actions button{font-size:12px;padding:7px 9px}
      #${ROOT_ID} .pss-empty,#${ROOT_ID} .pss-feed-empty{background:#fff;border:1px solid #dde2e8;border-radius:12px;padding:18px;color:#66717e}
      #${ROOT_ID} .pss-feed-head{position:sticky;top:0;z-index:3;display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#f4f6f8;padding:0 0 12px}
      #${ROOT_ID} .pss-feed-head h2{font-size:18px;margin:0 8px 0 0}
      #${ROOT_ID} .pss-feed-status{flex:1 1 100%;font-size:12px;color:#66717e}
      #${ROOT_ID} .pss-feed-filter{flex:1 1 100%;background:#fff;border:1px solid #dde2e8;border-radius:10px;padding:8px 10px}
      #${ROOT_ID} .pss-feed-filter summary{cursor:pointer;font-weight:700;color:#4b5663}
      #${ROOT_ID} .pss-feed-filter-row{display:flex;gap:7px;align-items:stretch;margin-top:8px}
      #${ROOT_ID} .pss-feed-exclude-input{flex:1;min-width:0;border:1px solid #cbd2da;border-radius:8px;padding:9px 10px;font:13px/1.4 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;color:#202124;background:#fff}
      #${ROOT_ID} .pss-feed-exclude-apply{white-space:nowrap;font-weight:700}
      #${ROOT_ID} .pss-feed-filter-note{margin:6px 0 0;font-size:11px;color:#7a8490}
      #${ROOT_ID} .pss-feed-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
      #${ROOT_ID} .pss-feed-card{display:grid;grid-template-columns:128px minmax(0,1fr);background:#fff;border:1px solid #dde2e8;border-radius:12px;overflow:hidden;min-width:0}
      #${ROOT_ID} .pss-feed-thumb{display:block;background:#eef1f4;min-height:128px}
      #${ROOT_ID} .pss-feed-thumb img{display:block;width:100%;height:100%;min-height:128px;object-fit:cover;background:#eef1f4}
      #${ROOT_ID} .pss-feed-thumb img.empty{visibility:hidden}
      #${ROOT_ID} .pss-feed-info{padding:10px;min-width:0}
      #${ROOT_ID} .pss-feed-top{display:flex;gap:8px;align-items:flex-start}
      #${ROOT_ID} .pss-feed-title{font-weight:800;text-decoration:none;overflow-wrap:anywhere;flex:1;line-height:1.35}
      #${ROOT_ID} .pss-feed-bookmarks{white-space:nowrap;color:#e33262;font-weight:800;font-size:12px}
      #${ROOT_ID} .pss-feed-author{display:block;margin-top:5px;color:#596575;text-decoration:none;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${ROOT_ID} .pss-feed-date{font-size:11px;color:#87909b;margin-top:2px}
      #${ROOT_ID} .pss-feed-caption{font-size:12px;line-height:1.5;color:#404955;margin:7px 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}
      #${ROOT_ID} .pss-feed-tags{display:flex;gap:5px;flex-wrap:wrap;max-height:44px;overflow:hidden}
      #${ROOT_ID} .pss-feed-tags a{font-size:11px;color:#1785ce;text-decoration:none;overflow-wrap:anywhere}
      #${ROOT_ID} .pss-feed-matches{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}
      #${ROOT_ID} .pss-feed-matches span{font-size:10px;color:#596575;background:#eef2f6;border-radius:999px;padding:3px 6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${ROOT_ID} .pss-feed-more{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding:18px 0}
      #${ROOT_ID} .pss-feed-more button{font-weight:700}
      @media(max-width:700px){
        #${ROOT_ID} .pss-wrap{padding:12px 9px 70px}
        #${ROOT_ID} .pss-head h2,#${ROOT_ID} .pss-feed-head h2{font-size:16px}
        #${ROOT_ID} .pss-actions button{font-size:11px;padding:7px}
        #${ROOT_ID} .pss-feed-grid{grid-template-columns:1fr}
        #${ROOT_ID} .pss-feed-card{grid-template-columns:116px minmax(0,1fr)}
        #${ROOT_ID} .pss-feed-thumb,#${ROOT_ID} .pss-feed-thumb img{min-height:116px}
      }
    `;
    document.head.append(style);

    root = document.createElement('section');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="pss-wrap pss-manage-page">
        <div class="pss-head">
          <h2>🔖 保存したPixiv検索</h2>
          <button type="button" class="pss-newest-open">🆕 保存検索の新着</button>
          <button type="button" class="pss-save-current">現在の検索を保存</button>
          <div class="pss-current-text"></div>
        </div>
        <div class="pss-list"></div>
      </div>
      <div class="pss-wrap pss-feed-page" hidden>
        <div class="pss-feed-head">
          <button type="button" class="pss-feed-back">← 保存検索へ</button>
          <h2>🆕 保存検索の新着</h2>
          <button type="button" class="pss-feed-refresh">更新</button>
          <div class="pss-feed-status"></div>
          <details class="pss-feed-filter">
            <summary class="pss-feed-exclude-summary">🚫 除外タグなし</summary>
            <div class="pss-feed-filter-row">
              <input type="text" class="pss-feed-exclude-input" placeholder="例：女体化, R-18, パロディ">
              <button type="button" class="pss-feed-exclude-apply">適用</button>
            </div>
            <p class="pss-feed-filter-note">カンマまたは改行区切り。作品タグと完全一致した場合に除外します。</p>
          </details>
        </div>
        <div class="pss-feed-grid"></div>
        <div class="pss-feed-more">
          <button type="button" class="pss-feed-show-more" hidden>次の60件を表示</button>
          <button type="button" class="pss-feed-load-older" hidden>さらに過去の新着を取得</button>
        </div>
      </div>
    `;

    root.querySelector('.pss-save-current').addEventListener('click', saveCurrent);
    root.querySelector('.pss-newest-open').addEventListener('click', openFeed);
    root.querySelector('.pss-feed-back').addEventListener('click', closeFeed);
    root.querySelector('.pss-feed-refresh').addEventListener('click', () => void refreshFeed());
    root.querySelector('.pss-feed-exclude-apply').addEventListener('click', applyExcludeTagInput);
    root.querySelector('.pss-feed-exclude-input').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyExcludeTagInput();
      }
    });
    root.querySelector('.pss-feed-show-more').addEventListener('click', () => {
      feedVisibleCount += FEED_STEP;
      renderFeed();
    });
    root.querySelector('.pss-feed-load-older').addEventListener('click', () => void loadOlderFeed());

    document.body.append(root);
    syncExcludeTagUi();
    render();
  }

  function open() {
    build();
    if (!root) return;

    // Every tap on the Saved Search tab is a deterministic reset to the
    // management screen. Do not rely on stale hidden/feedOpen state from a
    // previous open/close cycle (notably on iOS Safari).
    feedAbort?.abort();
    feedObserver?.disconnect();
    resetDetailQueue();
    feedOpen = false;
    root.classList.add('open');
    showManagePage();
    root.scrollTop = 0;
    render();
  }

  function close() {
    feedAbort?.abort();
    feedObserver?.disconnect();
    resetDetailQueue();
    feedOpen = false;
    if (root) {
      showManagePage();
      root.classList.remove('open');
    }
  }

  function count() {
    return readSaved().length;
  }

  window.__pixivSavedSearchesUi = {open, close, count, render, storageKey: STORAGE_KEY, openNewest: openFeed};
  window.addEventListener('pixiv-saved-searches-changed', render);
  if (document.body) build(); else addEventListener('DOMContentLoaded', build, {once:true});
})();


// ---- Pixiv home content shield (v0.6.26) ----
(() => {
  try { if (window.top !== window.self) return; } catch { return; }
  'use strict';
  if (window.__pixivHomeContentShieldV0626) return;
  window.__pixivHomeContentShieldV0626 = true;

  const KEY = 'pixiv-hide-home-recommendations-v1';
  const ROOT_ID = 'pixiv-home-display-settings-v1';
  const STYLE_ID = 'pixiv-home-content-shield-style-v0626';
  const KEEP_ATTR = 'data-pixiv-home-keep-v0626';
  const ACTIVE_ATTR = 'data-pixiv-home-hide-v0626';
  let enabled = true;
  let root = null;
  let scanTimer = null;

  const TOOL_SELECTOR_LIST = [
    '#' + ROOT_ID,
    '#pixiv-tools-unified-bar',
    '#pixiv-tools-unified-launch',
    '#pixiv-tools-unified-placeholder',
    '#pixiv-bookmark-sort-cross-page-v05',
    '#pixiv-saved-searches-root',
    '#pnte-root',
    '#ncb-backup-root'
  ];
  const TOOL_SELECTORS = TOOL_SELECTOR_LIST.join(',');

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      enabled = raw == null ? true : raw === '1';
    } catch { enabled = true; }
  }

  function save() {
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch {}
  }

  function isHome() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    return p === '/' || /^\/[a-z]{2}(?:-[a-z]{2})?$/i.test(p);
  }

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (style) return style;
    style = document.createElement('style');
    style.id = STYLE_ID;

    // Build every tool selector separately. Appending " *" to one comma-joined
    // selector string only affects the final selector, which caused tool roots
    // to stay visible while their children disappeared after a MutationObserver pass.
    const toolVisibleSelectors = TOOL_SELECTOR_LIST.flatMap(sel => [
      `html[${ACTIVE_ATTR}="1"] ${sel}`,
      `html[${ACTIVE_ATTR}="1"] ${sel} *`
    ]).join(',\n');

    style.textContent = `
      html[${ACTIVE_ATTR}="1"] body * {
        visibility:hidden!important;
      }
      html[${ACTIVE_ATTR}="1"] [${KEEP_ATTR}="1"],
      html[${ACTIVE_ATTR}="1"] [${KEEP_ATTR}="1"] * {
        visibility:visible!important;
      }
      ${toolVisibleSelectors} {
        visibility:visible!important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function clearKeepMarks() {
    document.querySelectorAll('[' + KEEP_ATTR + '="1"]').forEach(el => {
      el.removeAttribute(KEEP_ATTR);
    });
  }

  function isToolNode(el) {
    return !!el?.closest?.(TOOL_SELECTORS);
  }

  function rectOf(el) {
    if (!el?.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return null;
    return r;
  }

  function containsWorkLink(el) {
    return !!el?.querySelector?.(
      'a[href*="/artworks/"],a[href*="/novel/show.php?id="]'
    );
  }

  function markKeep(el) {
    if (!el || el === document.body || el === document.documentElement) return;
    if (containsWorkLink(el)) return;
    el.setAttribute(KEEP_ATTR, '1');
  }

  function markTopChrome() {
    clearKeepMarks();

    // Always keep this userscript's own controls.
    document.querySelectorAll(TOOL_SELECTORS).forEach(markKeep);

    const vh = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const vw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const topBand = Math.min(245, vh * 0.34);

    // Semantic Pixiv chrome, when available.
    for (const el of document.querySelectorAll('header,nav,[role="navigation"],[role="tablist"]')) {
      if (isToolNode(el) || containsWorkLink(el)) continue;
      const r = rectOf(el);
      if (!r) continue;
      if (r.top > topBand || r.bottom < -4) continue;
      if (r.height > 280 || r.width < Math.min(120, vw * 0.25)) continue;
      markKeep(el);
    }

    // Mobile Pixiv frequently renders the top chrome as ordinary links/buttons.
    // Keep only small visible controls in the top band. Large containers and
    // anything containing artwork/novel links are deliberately rejected.
    const chromeText = /^(?:ホーム|イラスト|マンガ|漫画|小説|みつける|Home|Illustrations?|Manga|Novels?|Discover)$/i;
    for (const el of document.querySelectorAll('a,button,[role="button"],[role="tab"],svg')) {
      if (isToolNode(el)) continue;
      const r = rectOf(el);
      if (!r) continue;
      if (r.top > topBand || r.bottom < -4) continue;
      if (r.width > vw * 0.75 || r.height > 110) continue;
      if (containsWorkLink(el)) continue;

      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      const href = el.closest?.('a')?.getAttribute?.('href') || el.getAttribute?.('href') || '';
      const looksLikePixivChrome =
        chromeText.test(text) ||
        /(?:pixiv)/i.test(text) ||
        /^\/(?:$|en\/?$|discovery|request|bookmark|users|tags\/)/i.test(String(href)) ||
        !!el.closest?.('header,nav,[role="navigation"],[role="tablist"]');

      if (looksLikePixivChrome) markKeep(el);
    }

    // The logo and icon buttons may be wrapped in non-semantic containers.
    // Keep compact top-band elements that have no work links and contain an
    // interactive control, without ever whitelisting a large feed container.
    for (const el of document.querySelectorAll('div,span')) {
      if (isToolNode(el) || containsWorkLink(el)) continue;
      const r = rectOf(el);
      if (!r) continue;
      if (r.top > topBand || r.bottom < -4) continue;
      if (r.width > Math.min(vw * 0.55, 360) || r.height > 120) continue;
      if (!el.querySelector?.('a,button,input,[role="button"],[role="tab"],svg')) continue;
      markKeep(el);
    }
  }

  function apply() {
    clearTimeout(scanTimer);
    scanTimer = null;
    ensureStyle();

    if (!enabled || !isHome()) {
      document.documentElement.removeAttribute(ACTIVE_ATTR);
      clearKeepMarks();
      return;
    }

    // Hide the Pixiv home DOM itself rather than covering it with an overlay.
    // visibility can be selectively restored on whitelisted descendants, so the
    // site chrome and our tools remain visible while every feed card stays hidden.
    markTopChrome();
    document.documentElement.setAttribute(ACTIVE_ATTR, '1');
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(apply, 40);
  }

  function build() {
    if (root?.isConnected) return root;
    root = document.createElement('section');
    root.id = ROOT_ID;
    root.style.cssText = 'display:none;position:fixed;top:78px;right:0;bottom:0;left:0;z-index:2147483645;background:#f4f6f8;color:#263040;overflow:auto;padding:22px 14px 80px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:720px;margin:0 auto;background:#fff;border:1px solid #dde2e8;border-radius:14px;padding:16px;';
    const title = document.createElement('h2');
    title.textContent = '👁 Pixivトップ表示';
    title.style.cssText = 'margin:0 0 12px;font-size:18px;';
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:10px;font-weight:700;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = enabled;
    input.style.cssText = 'width:20px;height:20px;';
    const span = document.createElement('span');
    span.textContent = 'トップの作品コンテンツを完全に非表示';
    label.append(input, span);
    const note = document.createElement('p');
    note.textContent = 'Pixivトップでは作品フィード自体を非表示にし、上部ナビゲーションとPixivツールだけを表示します。検索結果・タグ検索・作者ページ・作品ページ・ブックマークには影響しません。';
    note.style.cssText = 'margin:10px 0 0;color:#66717e;font-size:12px;';
    input.addEventListener('change', () => {
      enabled = !!input.checked;
      save();
      apply();
    });
    card.append(title, label, note);
    root.append(card);
    document.body.append(root);
    return root;
  }

  function open() {
    build();
    root.style.setProperty('display', 'block', 'important');
    root.setAttribute(KEEP_ATTR, '1');
    const input = root.querySelector('input[type="checkbox"]');
    if (input) input.checked = enabled;
  }

  function close() {
    root?.style.setProperty('display', 'none', 'important');
  }

  load();
  ensureStyle();
  apply();

  const observer = new MutationObserver(schedule);
  if (document.documentElement) observer.observe(document.documentElement, {childList:true, subtree:true});
  window.addEventListener('popstate', schedule, true);
  window.addEventListener('hashchange', schedule, true);
  window.addEventListener('resize', schedule, true);
  window.addEventListener('orientationchange', schedule, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

  window.__pixivHomeDisplayUi = {open, close, apply, isEnabled:() => enabled};
})();


// ---- Unified Pixiv tools shell (v0.6.10) ----
(() => {
  try { if (window.top !== window.self) return; } catch { return; }
  'use strict';
  if (window.__pixivUnifiedToolsV0610) return;
  window.__pixivUnifiedToolsV0610 = true;

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

  function savedSearchUi() {
    return window.__pixivSavedSearchesUi || null;
  }

  function displayUi() {
    return window.__pixivHomeDisplayUi || null;
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

  function hideSavedSearches() {
    savedSearchUi()?.close?.();
  }

  function hideDisplaySettings() {
    displayUi()?.close?.();
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
    hideSavedSearches();
    hideDisplaySettings();

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
    hideSavedSearches();
    hideDisplaySettings();

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

  function openSavedSearches() {
    active = 'searches';
    paintTabs();
    hidePlaceholder();
    hideBookmark();
    hideNovel();
    hideDisplaySettings();
    const s = savedSearchUi();
    if (!s?.open) {
      showPlaceholder('保存検索機能を準備中です。少し待ってからもう一度お試しください。');
      return;
    }
    s.open();
  }

  function openDisplaySettings() {
    active = 'display';
    paintTabs();
    hidePlaceholder();
    hideBookmark();
    hideNovel();
    hideSavedSearches();
    const d = displayUi();
    if (!d?.open) {
      showPlaceholder('表示設定を準備中です。少し待ってからもう一度お試しください。');
      return;
    }
    d.open();
  }

  function switchTo(tab) {
    ensurePageSpecificUi();
    if (tab === 'novel') openNovel();
    else if (tab === 'searches') openSavedSearches();
    else if (tab === 'display') openDisplaySettings();
    else openBookmark();
  }

  function closeAll() {
    opened = false;
    hidePlaceholder();
    hideNovel();
    hideSavedSearches();
    hideDisplaySettings();

    const b = bookmarkUi();
    if (b?.veil?.classList.contains('open') && b.close) b.close.click();
    else hideBookmark();

    document.getElementById(BAR_ID)?.classList.remove('open');
  }

  function openShell() {
    opened = true;
    document.getElementById(BAR_ID)?.classList.add('open');
    const preferred = isNovelPage() ? 'novel' : 'searches';
    switchTo(preferred);
  }

  function updateAvailability() {
    ensurePageSpecificUi();
    const launch = document.getElementById(LAUNCH_ID);
    if (!launch) return;
    // 3機能を1つの「Pixivツール」ボタンに統合し、Pixiv内では常に呼び出せるようにする。
    launch.style.display = 'block';

    // ページに合わない機能を選んだ場合は、そのタブ内で利用可能ページを案内する。
    // 単独の全体ブックマーク／小説TXTボタンは隠し、入口はこのボタンだけにする。
  }

  function buildShell() {
    if (document.getElementById(BAR_ID)) return;

    const style = document.createElement('style');
    style.textContent = `
      #pnte-button{display:none!important}
      #pnte-root{top:${OFFSET}px!important;right:0!important;bottom:0!important;left:0!important;height:auto!important}
      #${LAUNCH_ID}{position:fixed;right:14px;bottom:max(76px,env(safe-area-inset-bottom));z-index:2147483001;border:0;border-radius:999px;padding:12px 16px;background:#0096fa;color:#fff;font:700 14px/1.2 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;box-shadow:0 4px 18px #0004}
      #${BAR_ID}{display:none;position:fixed;top:0;left:0;right:0;height:${OFFSET}px;z-index:2147483647;background:#fff;color:#202124;border-bottom:1px solid #dfe3e8;box-shadow:0 2px 9px #0002;padding:max(7px,env(safe-area-inset-top)) 10px 7px;font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${BAR_ID}.open{display:flex;align-items:flex-end;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch}
      #${BAR_ID} .pt-title{font-weight:800;font-size:15px;white-space:nowrap;margin:0 4px 5px 2px}
      #${BAR_ID} [data-tool-tab]{border:1px solid #ccd2d9;background:#fff;color:#333;border-radius:9px;padding:9px 11px;font:700 13px/1 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${BAR_ID} [data-tool-tab].active{background:#0096fa;color:#fff;border-color:#0096fa}
      #${BAR_ID} .pt-close{margin-left:auto;border:1px solid #ccd2d9;background:#fff;color:#333;border-radius:9px;padding:9px 11px;font:700 13px/1 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${PLACEHOLDER_ID}{display:none;position:fixed;top:${OFFSET}px;right:0;bottom:0;left:0;z-index:2147483645;background:#f4f6f8;color:#59636e;padding:36px 20px;text-align:center;font:14px/1.8 -apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif}
      #${PLACEHOLDER_ID}.open{display:block}
      @media(max-width:600px){
        #${BAR_ID}{padding-left:7px;padding-right:7px;gap:5px}
        #${BAR_ID} .pt-title{display:none}
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

    const searches = document.createElement('button');
    searches.type = 'button';
    searches.dataset.toolTab = 'searches';
    searches.textContent = '🔖 保存検索';
    searches.addEventListener('click', () => switchTo('searches'));

    const display = document.createElement('button');
    display.type = 'button';
    display.dataset.toolTab = 'display';
    display.textContent = '👁 表示';
    display.addEventListener('click', () => switchTo('display'));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pt-close';
    close.textContent = '閉じる';
    close.addEventListener('click', closeAll);

    bar.append(title, searches, bookmark, novel, display, close);

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
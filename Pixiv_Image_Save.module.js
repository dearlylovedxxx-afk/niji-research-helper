// ---- Pixiv image saver (v0.3.8) ----
(() => {
  'use strict';
  if (window.__pixivImageSaverV0638) return;
  window.__pixivImageSaverV0638 = true;

  const ROOT_ID = 'pbi-root';
  const BUTTON_ID = 'pbi-button';
  const STYLE_ID = 'pbi-style';

  let root = null;
  let statusNode = null;
  let listNode = null;
  let titleInput = null;
  let found = [];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isItemPage() {return /^\/artworks\/\d+(?:\/|$)/.test(location.pathname);}
  function itemId() {return location.pathname.match(/^\/artworks\/(\d+)(?:\/|$)/)?.[1]||'';}
  function isImageWork() {return isItemPage();}

  function safeBaseName(name) {
    const cleaned = String(name || ('Pixiv_' + itemId()))
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '＿')
      .replace(/[. ]+$/g, '')
      .trim();
    return (cleaned || ('Pixiv_' + itemId())).slice(0, 120);
  }

  function extractTitle() {
    return String(document.title||'').replace(/\s*[|｜-]\s*(pixiv|ピクシブ).*$/i,'').trim()
      ||('pixiv_'+itemId());
  }

  function buildFileName(index, total) {
    const base = safeBaseName(titleInput?.value || extractTitle());
    const width = Math.max(2, String(total).length);
    const no = String(index + 1).padStart(width, '0');
    return base + '_' + no + '.png';
  }

  function buildZipName(label='') {
    const base = safeBaseName(titleInput?.value || extractTitle());
    return base + (label ? '_' + label : '') + '.zip';
  }

  function gmXhrBlob(url) {
    const fn = globalThis.GM?.xmlhttpRequest || globalThis.GM?.xmlHttpRequest;
    if (typeof fn !== 'function') return Promise.reject(new Error('GM.xmlhttpRequest が利用できません'));

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (ok, value) => {
        if (settled) return;
        settled = true;
        ok ? resolve(value) : reject(value instanceof Error ? value : new Error(String(value || '取得失敗')));
      };

      const timer = setTimeout(() => done(false, new Error('画像取得がタイムアウトしました')), 45000);

      try {
        const maybe = fn({
          method: 'GET',
          url,
          responseType: 'blob',
          anonymous: false,
          nocache: true,
          headers: {
            Referer: location.href
          },
          onload: res => {
            clearTimeout(timer);
            if (res.status >= 200 && res.status < 300 && res.response) done(true, res.response);
            else done(false, new Error('HTTP ' + res.status));
          },
          onerror: err => {
            clearTimeout(timer);
            done(false, new Error(err?.error || err?.message || '画像取得に失敗しました'));
          },
          ontimeout: () => {
            clearTimeout(timer);
            done(false, new Error('画像取得がタイムアウトしました'));
          }
        });
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(res => {
            if (settled) return;
            clearTimeout(timer);
            if (res?.status >= 200 && res?.status < 300 && res.response) done(true, res.response);
          }).catch(err => {
            if (settled) return;
            clearTimeout(timer);
            done(false, err);
          });
        }
      } catch (err) {
        clearTimeout(timer);
        done(false, err);
      }
    });
  }

  async function getBlob(url) {
    try {
      const blob = await gmXhrBlob(url);
      if (blob instanceof Blob && blob.size) return blob;
    } catch {}

    const res = await fetch(url, {
      credentials: 'include',
      referrer: location.href,
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.blob();
  }

  async function blobToPng(blob) {
    if (!(blob instanceof Blob) || !blob.size) {
      throw new Error('画像データが空です');
    }
    if (blob.type === 'image/png') return blob;

    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error('画像のデコードに失敗しました'));
        node.src = objectUrl;
      });

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) throw new Error('画像サイズを取得できませんでした');

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', {alpha:true});
      if (!ctx) throw new Error('PNG変換用Canvasを作成できませんでした');

      ctx.drawImage(img, 0, 0, width, height);

      const png = await new Promise((resolve, reject) => {
        canvas.toBlob(
          result => result ? resolve(result) : reject(new Error('PNG変換に失敗しました')),
          'image/png'
        );
      });

      return png;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function getPngBlob(url) {
    const original = await getBlob(url);
    return await blobToPng(original);
  }

  function saveBlob(blob, name) {
    return new Promise((resolve, reject) => {
      try {
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = name;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
        setTimeout(resolve, 120);
      } catch (err) {
        reject(err);
      }
    });
  }

  async function saveOne(row, index, total) {
    const name = buildFileName(index, total);

    try {
      const png = await getPngBlob(row.url);
      await saveBlob(png, name);
      return {ok:true};
    } catch (err) {
      return {ok:false, error:err};
    }
  }


  function zipStore(files) {
    const entries=Object.entries(files);
    if(entries.length>65535)throw new Error('ZIP内の枚数が多すぎます');
    const table=new Uint32Array(256);
    for(let n=0;n<256;n++){
      let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
      table[n]=c>>>0;
    }
    const crc32=bytes=>{
      let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);
      return (c^0xffffffff)>>>0;
    };
    const coder=new TextEncoder(),body=[],central=[];
    let offset=0,dirLength=0;
    for(const [filename,bytes] of entries){
      const name=coder.encode(filename),len=bytes.length;
      if(name.length>65535||offset+30+name.length+len>=0xffffffff)throw new Error('ZIPが4GBを超えます');
      const sum=crc32(bytes),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
      v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);
      v.setUint32(14,sum,true);v.setUint32(18,len,true);v.setUint32(22,len,true);
      v.setUint16(26,name.length,true);local.set(name,30);
      const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);
      d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);
      d.setUint32(16,sum,true);d.setUint32(20,len,true);d.setUint32(24,len,true);
      d.setUint16(28,name.length,true);d.setUint32(42,offset,true);dir.set(name,46);
      body.push(local,bytes);central.push(dir);offset+=local.length+len;dirLength+=dir.length;
    }
    if(offset+dirLength+22>=0xffffffff)throw new Error('ZIPが4GBを超えます');
    const footer=new Uint8Array(22),v=new DataView(footer.buffer);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);
    v.setUint32(12,dirLength,true);v.setUint32(16,offset,true);
    return new Blob([...body,...central,footer],{type:'application/zip'});
  }

  async function saveRowsAsZip(entries, zipName) {
    if (!entries.length) {
      statusNode.textContent = 'ZIPに入れる画像がありません。';
      return;
    }

    const files = {};
    let ok = 0;
    let failed = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      statusNode.textContent =
        'ZIP準備中… ' + (i + 1) + ' / ' + entries.length + '（PNG変換）';

      try {
        const png = await getPngBlob(entry.row.url);
        const bytes = new Uint8Array(await png.arrayBuffer());
        files[buildFileName(entry.index, found.length)] = bytes;
        ok++;
      } catch {
        failed++;
      }

      // iOSでUIが固まらないように一度イベントループへ返す。
      await sleep(0);
    }

    if (!ok) {
      statusNode.textContent = 'ZIPに追加できる画像がありませんでした。';
      return;
    }

    statusNode.textContent = 'ZIPを書き出し中… ' + ok + '枚';

    try {
      // PNGは既に圧縮済みなのでZIP側はlevel 0。
      // JSZipよりメモリ負荷と処理時間を抑えやすい。
      const blob = zipStore(files);
      await saveBlob(blob, zipName);

      statusNode.textContent = failed
        ? 'ZIP保存完了：' + ok + '枚／失敗 ' + failed + '枚'
        : 'ZIP保存完了：' + ok + '枚';
    } catch (err) {
      statusNode.textContent =
        'ZIP作成に失敗しました：' + (err?.message || err || '不明なエラー');
    }
  }

  async function saveSelectedZip() {
    const entries = selectedRows().map(x => ({row:x.row,index:x.index}));
    const btn = root?.querySelector('.pbi-zip-selected');
    if (btn) btn.disabled = true;
    try {
      await saveRowsAsZip(entries, buildZipName('選択'));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function saveRangeZip() {
    if (!found.length) {
      statusNode.textContent = '保存できる画像がありません。';
      return;
    }

    const {start, end} = readRange();
    const entries = found.slice(start - 1, end).map((row, offset) => ({
      row,
      index: start - 1 + offset
    }));

    const btn = root?.querySelector('.pbi-zip-range');
    if (btn) btn.disabled = true;
    try {
      await saveRowsAsZip(entries, buildZipName(start + '-' + end));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function selectedRows() {
    return [...listNode.querySelectorAll('.pbi-card')].map((card, index) => ({
      index,
      checked: !!card.querySelector('.pbi-check')?.checked,
      row: found[index]
    })).filter(x => x.checked && x.row);
  }

  function readRange() {
    const startInput = root?.querySelector('.pbi-range-start');
    const endInput = root?.querySelector('.pbi-range-end');
    const total = found.length;

    let start = Number(startInput?.value || 1);
    let end = Number(endInput?.value || total || 1);

    if (!Number.isFinite(start)) start = 1;
    if (!Number.isFinite(end)) end = total || 1;

    start = Math.max(1, Math.min(total || 1, Math.floor(start)));
    end = Math.max(1, Math.min(total || 1, Math.floor(end)));

    if (start > end) [start, end] = [end, start];

    if (startInput) startInput.value = String(start);
    if (endInput) endInput.value = String(end);

    return {start, end};
  }

  async function saveRange() {
    if (!found.length) {
      statusNode.textContent = '保存できる画像がありません。';
      return;
    }

    const {start, end} = readRange();
    const rows = found.slice(start - 1, end).map((row, offset) => ({
      row,
      index: start - 1 + offset
    }));

    const btn = root.querySelector('.pbi-save-range');
    if (btn) btn.disabled = true;

    let ok = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      const entry = rows[i];
      statusNode.textContent =
        start + '〜' + end + '枚目を保存中… ' + (i + 1) + ' / ' + rows.length;
      const result = await saveOne(entry.row, entry.index, found.length);
      if (result.ok) ok++;
      else failed++;
      await sleep(180);
    }

    if (btn) btn.disabled = false;
    statusNode.textContent = failed
      ? start + '〜' + end + '枚目：' + ok + '枚保存／失敗 ' + failed + '枚'
      : start + '〜' + end + '枚目を保存しました（' + ok + '枚）。';
  }

  async function saveSelected() {
    const selected = selectedRows();
    if (!selected.length) {
      statusNode.textContent = '保存する画像を選択してください。';
      return;
    }

    const saveBtn = root.querySelector('.pbi-save-selected');
    if (saveBtn) saveBtn.disabled = true;

    let ok = 0;
    let failed = 0;

    for (let i = 0; i < selected.length; i++) {
      const entry = selected[i];
      statusNode.textContent = '保存中… ' + (i + 1) + ' / ' + selected.length;
      const result = await saveOne(entry.row, entry.index, found.length);
      if (result.ok) ok++;
      else failed++;
      await sleep(180);
    }

    if (saveBtn) saveBtn.disabled = false;
    statusNode.textContent = failed
      ? '保存完了：' + ok + '枚／失敗 ' + failed + '枚。失敗した画像は各カードの「画像を開く」から確認できます。'
      : '保存完了：' + ok + '枚';
  }

  function render() {
    listNode.replaceChildren();

    if (!found.length) {
      const empty = document.createElement('div');
      empty.className = 'pbi-empty';
      empty.textContent = '作品画像をまだ検出できていません。';
      listNode.append(empty);
      return;
    }

    found.forEach((row, index) => {
      const card = document.createElement('article');
      card.className = 'pbi-card';

      const preview = document.createElement('img');
      preview.className = 'pbi-preview';
      preview.src = row.preview || row.url;
      preview.alt = '画像 ' + (index + 1);
      preview.loading = 'lazy';
      preview.referrerPolicy = 'strict-origin-when-cross-origin';

      const info = document.createElement('div');
      info.className = 'pbi-info';

      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = true;
      check.className = 'pbi-check';
      const strong = document.createElement('strong');
      strong.textContent = '画像 ' + (index + 1);
      label.append(check, strong);

      const file = document.createElement('div');
      file.className = 'pbi-file';
      file.textContent = buildFileName(index, found.length);

      const actions = document.createElement('div');
      actions.className = 'pbi-actions';

      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = '⬇️ この1枚を保存';
      save.addEventListener('click', async () => {
        save.disabled = true;
        statusNode.textContent = '画像 ' + (index + 1) + ' を保存中…';
        const result = await saveOne(row, index, found.length);
        save.disabled = false;
        statusNode.textContent = result.ok
          ? '画像 ' + (index + 1) + ' を保存しました。'
          : '保存失敗：' + (result.error?.message || result.error || '不明なエラー');
      });

      const open = document.createElement('a');
      open.href = row.url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = '画像を開く';

      actions.append(save, open);
      info.append(label, file, actions);
      card.append(preview, info);
      listNode.append(card);
    });
  }

  function pixivImageUrl(text) {
    try {
      const url=new URL(String(text||''));
      return url.protocol==='https:'&&url.hostname==='i.pximg.net'
        && url.pathname.includes('/img/')?url.href:'';
    }catch{return '';}
  }
  async function pixivJson(path) {
    const r=await fetch(path,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error('Pixiv API HTTP '+r.status);
    const data=await r.json();
    if(data?.error||data?.body==null)throw new Error(data?.message||'作品情報を取得できません');
    return data.body;
  }
  async function detect() {
    if(!isItemPage()||!root)return;
    const id=itemId();
    statusNode.textContent='原寸画像を取得中…';
    found=[];listNode.replaceChildren();
    try {
      const [info,pages]=await Promise.all([pixivJson('/ajax/illust/'+id),pixivJson('/ajax/illust/'+id+'/pages')]);
      if(id!==itemId())return;
      if(Number(info.illustType)===2){
        statusNode.textContent='うごイラはアニメーション用ZIP形式のため、静止画PNG保存の対象外です。';
        return;
      }
      if(!Array.isArray(pages))throw new Error('画像一覧の形式が不明です');
      found=pages.map(page=>({
        url:pixivImageUrl(page?.urls?.original),
        preview:pixivImageUrl(page?.urls?.regular)||pixivImageUrl(page?.urls?.small)
          ||pixivImageUrl(page?.urls?.original)
      })).filter(row=>row.url);
      if(!found.length)throw new Error('原寸画像を検出できません（削除・非公開・閲覧制限の可能性）');
      if(titleInput)titleInput.value=String(info.title||extractTitle()).trim();
      const start=root.querySelector('.pbi-range-start'),end=root.querySelector('.pbi-range-end');
      if(start){start.max=String(found.length);start.value='1';}
      if(end){end.max=String(found.length);end.value=String(found.length);}
      render();
      statusNode.textContent='原寸画像 '+found.length+'枚を検出しました。PNG保存できます。';
    }catch(e){statusNode.textContent='画像取得失敗：'+String(e?.message||e);}
  }

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + BUTTON_ID + '{position:fixed;right:14px;bottom:max(76px,env(safe-area-inset-bottom));z-index:2147483000;border:0;border-radius:999px;padding:11px 15px;background:#7356a8;color:#fff;font:700 14px/1.2 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif;box-shadow:0 4px 16px #0003}',
      '#' + ROOT_ID + '{display:none;position:fixed;inset:0;z-index:2147483646;background:#f4f6f8;color:#202124;overflow:auto;-webkit-overflow-scrolling:touch;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Noto Sans JP",sans-serif}',
      '#' + ROOT_ID + '.open{display:block}',
      '#' + ROOT_ID + ' *{box-sizing:border-box}',
      '#' + ROOT_ID + ' .pbi-head{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #dfe3e8;padding:10px 12px;box-shadow:0 2px 8px #0000000d}',
      '#' + ROOT_ID + ' .pbi-bar{max-width:980px;margin:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '#' + ROOT_ID + ' .pbi-bar strong{font-size:16px;margin-right:auto}',
      '#' + ROOT_ID + ' button,#' + ROOT_ID + ' input{font:inherit}',
      '#' + ROOT_ID + ' button{border:1px solid #ccd2d9;background:#fff;color:#202124;border-radius:8px;padding:8px 10px;font-weight:600}',
      '#' + ROOT_ID + ' .pbi-primary{background:#7356a8;color:#fff;border-color:#7356a8}',
      '#' + ROOT_ID + ' .pbi-meta{max-width:980px;margin:8px auto 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:#59636e}',
      '#' + ROOT_ID + ' .pbi-meta input[type=text]{min-width:220px;max-width:100%;border:1px solid #ccd2d9;border-radius:7px;padding:6px}',
      '#' + ROOT_ID + ' .pbi-range{max-width:980px;margin:8px auto 0;display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:12px;color:#59636e}',
      '#' + ROOT_ID + ' .pbi-range input[type=number]{width:72px;border:1px solid #ccd2d9;border-radius:7px;padding:6px;background:#fff;color:#202124}',
      '#' + ROOT_ID + ' .pbi-status{max-width:980px;margin:7px auto 0;font-size:12px;color:#59636e;overflow-wrap:anywhere}',
      '#' + ROOT_ID + ' .pbi-list{max-width:980px;margin:0 auto;padding:12px 10px 80px;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}',
      '#' + ROOT_ID + ' .pbi-card{background:#fff;border:1px solid #dfe3e8;border-radius:10px;padding:9px;min-width:0}',
      '#' + ROOT_ID + ' .pbi-preview{display:block;width:100%;height:260px;object-fit:contain;background:#eef0f3;border-radius:7px}',
      '#' + ROOT_ID + ' .pbi-info{padding-top:8px}',
      '#' + ROOT_ID + ' .pbi-info label{display:flex;gap:7px;align-items:center}',
      '#' + ROOT_ID + ' .pbi-file{font-size:11px;color:#747d87;overflow-wrap:anywhere;margin:5px 0 7px}',
      '#' + ROOT_ID + ' .pbi-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}',
      '#' + ROOT_ID + ' .pbi-actions a{font-size:12px;color:#5b4690;text-decoration:underline}',
      '#' + ROOT_ID + ' .pbi-empty{grid-column:1/-1;background:#fff;border:1px solid #dfe3e8;border-radius:10px;padding:18px;color:#6a727b}',
      '@media(max-width:600px){#' + ROOT_ID + ' .pbi-head{padding:8px}#' + ROOT_ID + ' .pbi-bar strong{width:100%;font-size:15px}#' + ROOT_ID + ' .pbi-bar button{font-size:12px;padding:7px 8px}#' + ROOT_ID + ' .pbi-list{grid-template-columns:1fr;padding:10px 7px 70px}#' + ROOT_ID + ' .pbi-preview{height:auto;max-height:70vh}}'
    ].join('');
    document.head.append(style);
  }

  function build() {
    if (!document.body || root) return;
    injectCss();

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '🖼️ 画像保存';
    button.addEventListener('click', openPanel);

    root = document.createElement('section');
    root.id = ROOT_ID;
    root.innerHTML =
      '<div class="pbi-head">' +
        '<div class="pbi-bar">' +
          '<strong>🖼️ Pixiv 画像保存</strong>' +
          '<button type="button" class="pbi-detect">🔄 再検出</button>' +
          '<button type="button" class="pbi-select-all">全部選択</button>' +
          '<button type="button" class="pbi-clear-all">全部解除</button>' +
          '<button type="button" class="pbi-save-selected">⬇️ 選択をPNG保存</button>' +
          '<button type="button" class="pbi-zip-selected pbi-primary">📦 選択をZIP</button>' +
          '<button type="button" class="pbi-close">閉じる</button>' +
        '</div>' +
        '<div class="pbi-meta"><label>ファイル名：<input type="text" class="pbi-title" placeholder="作品タイトル"></label><span>保存形式はPNG。01・02…の連番で保存します。</span></div>' +
        '<div class="pbi-range"><strong>保存範囲：</strong><input type="number" class="pbi-range-start" min="1" value="1"><span>〜</span><input type="number" class="pbi-range-end" min="1" value="1"><span>枚目</span><button type="button" class="pbi-save-range">⬇️ PNG保存</button><button type="button" class="pbi-zip-range pbi-primary">📦 この範囲をZIP</button></div>' +
        '<div class="pbi-status">まだ検出していません。</div>' +
      '</div>' +
      '<main class="pbi-list"></main>';

    statusNode = root.querySelector('.pbi-status');
    listNode = root.querySelector('.pbi-list');
    titleInput = root.querySelector('.pbi-title');

    root.querySelector('.pbi-detect').addEventListener('click', detect);
    root.querySelector('.pbi-save-selected').addEventListener('click', saveSelected);
    root.querySelector('.pbi-zip-selected').addEventListener('click', saveSelectedZip);
    root.querySelector('.pbi-save-range').addEventListener('click', saveRange);
    root.querySelector('.pbi-zip-range').addEventListener('click', saveRangeZip);
    root.querySelector('.pbi-select-all').addEventListener('click', () => {
      listNode.querySelectorAll('.pbi-check').forEach(x => x.checked = true);
    });
    root.querySelector('.pbi-clear-all').addEventListener('click', () => {
      listNode.querySelectorAll('.pbi-check').forEach(x => x.checked = false);
    });
    root.querySelector('.pbi-close').addEventListener('click', closePanel);

    document.body.append(button, root);
  }

  async function openPanel() {
    build();
    if (!root) return;
    root.classList.add('open');
    if (titleInput) titleInput.value = extractTitle();
    if (!found.length) await detect();
  }

  function closePanel() {
    root?.classList.remove('open');
  }

  window.__pixivImageSaveUi = {
    open: openPanel,
    close: closePanel,
    detect,
    isImageWork,
    count: () => found.length
  };

  if (isItemPage()) {
    if (document.body) build();
    else addEventListener('DOMContentLoaded', build, {once:true});
  }
})();



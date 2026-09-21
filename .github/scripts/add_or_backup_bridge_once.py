from pathlib import Path
p=Path('Niji_OR_Results_Merger.user.js')
s=p.read_text(encoding='utf-8')
assert '// @version      0.4.8' in s and "const VERSION = '0.4.8';" in s
anchor='\n  const el = (tag, attrs = {}, ...children) => {'
assert s.count(anchor)==1
bridge=r'''
  // Cross-script bridge for the separately installed Niji Cloud Backup userscript.
  // Transfer data in JSON strings in-page, without changing the existing store.
  const CLOUD_OR_KEYS = [STORAGE_KEY, VIDEO_META_KEY, RESULT_SORT_KEY, AUTO_KEY,
    MULTI_KEY, RUN_KEY, LAST_WORDS_KEY, MIN_COMMENTS_KEY];
  document.addEventListener('ncb-or-request-v1', async event => {
    let req;
    try { req=JSON.parse(event.detail); } catch { return; }
    if (!req || typeof req.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(req.id)) return;
    const respond=(ok,data,error='')=>document.dispatchEvent(new CustomEvent('ncb-or-response-v1', {
      detail:JSON.stringify({id:req.id,ok,data,error})
    }));
    try {
      if (req.action === 'read') {
        const values={};
        for (const key of CLOUD_OR_KEYS) values[key]=await storeGet(key,null);
        if (!Array.isArray(values[STORAGE_KEY])) throw Error('保存済みORリストを読み込めません');
        respond(true,values);return;
      }
      if (req.action !== 'merge' || !req.payload || typeof req.payload !== 'object')
        throw Error('不正なバックアップ操作です');
      const incoming=req.payload;
      if (!Array.isArray(incoming[STORAGE_KEY])) throw Error('ORバックアップ形式が違います');
      const current=await storeGet(STORAGE_KEY,[]);
      if (!Array.isArray(current)) throw Error('現在のOR保存形式が違います');
      const seen=new Set(), merged=[];
      for (const b of [...current,...incoming[STORAGE_KEY]]) {
        if (!b || typeof b.label !== 'string' || !Array.isArray(b.rows)) continue;
        const id=String(b.signature||b.id||'');
        if (!id || seen.has(id)) continue;
        seen.add(id);merged.push(b);
      }
      if (merged.length > MAX_BATCHES) throw Error(`OR保存件数の上限${MAX_BATCHES}件を超えるため、既存データを変更せず中止しました`);
      const savedMeta=await storeGet(VIDEO_META_KEY,{});
      const remoteMeta=incoming[VIDEO_META_KEY];
      const meta={...(remoteMeta && !Array.isArray(remoteMeta) ? remoteMeta : {}),
        ...(savedMeta && !Array.isArray(savedMeta) ? savedMeta : {})};
      await storeSet(STORAGE_KEY,merged);
      await storeSet(VIDEO_META_KEY,meta);
      for (const key of [AUTO_KEY,MULTI_KEY,RUN_KEY]) {
        const local=await storeGet(key,null),remote=incoming[key];
        if (local) continue;
        if (remote && typeof remote==='object') await storeSet(key,{...remote,active:false});
      }
      const localWords=await storeGet(LAST_WORDS_KEY,[]);
      const remoteWords=incoming[LAST_WORDS_KEY];
      if (Array.isArray(remoteWords)) await storeSet(LAST_WORDS_KEY,
        [...new Set([...(Array.isArray(localWords)?localWords:[]),...remoteWords].filter(x=>typeof x==='string'))]);
      const sort=await storeGet(RESULT_SORT_KEY,null);
      if (!sort && ['comments','newest','oldest','title'].includes(incoming[RESULT_SORT_KEY]))
        await storeSet(RESULT_SORT_KEY,incoming[RESULT_SORT_KEY]);
      const min=await storeGet(MIN_COMMENTS_KEY,null);
      if (min == null && Number.isSafeInteger(incoming[MIN_COMMENTS_KEY]))
        await storeSet(MIN_COMMENTS_KEY,incoming[MIN_COMMENTS_KEY]);
      batches=merged;videoMetadata=meta;
      respond(true,`ORリスト${merged.length}件を統合しました。comment2434を再読み込みしてください。`);
    } catch(e) { respond(false,null,String(e?.message||e)); }
  });
'''
s=s.replace(anchor,'\n'+bridge+anchor,1)
s=s.replace('// @version      0.4.8','// @version      0.4.9',1)
s=s.replace("const VERSION = '0.4.8';","const VERSION = '0.4.9';",1)
s=s.replace("boot.textContent='🔀 OR起動中 0.4.8';","boot.textContent='🔀 OR起動中 0.4.9';",1)
s=s.replace("console.info('[Niji OR Merger] v0.4.8 injected'","console.info('[Niji OR Merger] v0.4.9 injected'",1)
assert s.count('ncb-or-request-v1')==1 and "const VERSION = '0.4.9';" in s
p.write_text(s,encoding='utf-8')
print('OR cloud bridge patched; original local keys unchanged')
from pathlib import Path
p=Path('Niji_Cloud_Backup.user.js')
s=p.read_text(encoding='utf-8')
old="  if(existing&&!force){settings.lastSha=digest;settings.lastSavedAt=Date.parse(existing.createdAt)||Date.now();await saveSettings();stateText('☁️ 保存済みの同一データを確認しました（変更なし）');return;}"
new="""  if(existing){
   try{
    stateText('同じ内容のバックアップを読み取り検証中…');
    await fetchBackup(existing);
    settings.lastSha=digest;settings.lastSavedAt=Date.parse(existing.createdAt)||Date.now();await saveSettings();
    stateText('✅ pCloudの同一データを読み取り検証しました（変更なし）');return;
   }catch(e){stateText('既存ファイルの検証に失敗したため、新しいバックアップを作成します：'+String(e.message||e));}
  }"""
assert s.count(old)==1;s=s.replace(old,new)
old="   await xhr('POST','/parts',{id,index:i,count,device:device(),origin:location.origin,totalSha:digest,partSha:await sha(part),base64:b64(part)});"
new="""   const partBody={id,index:i,count,device:device(),origin:location.origin,totalSha:digest,partSha:await sha(part),base64:b64(part)};
   for(let attempt=0;attempt<3;attempt++){
    try{await xhr('POST','/parts',partBody);break;}
    catch(e){if(attempt===2||/HTTP (?:400|401|403|413|415|409)/.test(String(e.message||e)))throw e;}
   }"""
assert s.count(old)==1;s=s.replace(old,new)
old="  await xhr('POST','/commit',{id,count,device:device(),origin:location.origin,totalSha:digest});"
new="""  try{await xhr('POST','/commit',{id,count,device:device(),origin:location.origin,totalSha:digest});}
  catch(e){
   const verify=await getBackups().catch(()=>[]);
   if(!verify.some(b=>b.id===id))throw e;
  }"""
assert s.count(old)==1;s=s.replace(old,new)
p.write_text(s,encoding='utf-8')
print('Idempotent part retries and remote verification patch applied')
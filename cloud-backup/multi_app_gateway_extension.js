// Additive extension for Niji Research Helper backup gateway.
// Paste this code ABOVE `export default` in the existing Worker, then insert
// `if (url.pathname.startsWith('/v1/app-backups/')) return handleAppBackup(request, env);`
// immediately after `const url = new URL(request.url);` inside handle().
// Existing /v1/backups, niji_backups and NIJI_CLIENT_TOKEN are untouched.
const APP_BACKUP_TYPES = Object.freeze({
  or: { name:'Niji OR Results Merger', secret:'NRH_OR_BACKUP_TOKEN', origins:['https://comment2434.com','https://www.comment2434.com'] },
  x: { name:'X Search Favorites', secret:'NRH_X_BACKUP_TOKEN', origins:['https://x.com','https://twitter.com'] },
  pixiv: { name:'Pixiv Bookmark Sort', secret:'NRH_PIXIV_BACKUP_TOKEN', origins:['https://www.pixiv.net'] },
});
const APP_BACKUP_PART_MAX = 3 * 1024 * 1024;
const APP_BACKUP_PARTS_MAX = 80;
const APP_BACKUP_KEEP = 5;
const APP_BACKUP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_BACKUP_SHA = /^[0-9a-f]{64}$/;
const APP_BACKUP_DEVICE = /^[a-z0-9_.:-]{1,96}$/;
const APP_BACKUP_FILE_KEY = /^pcfs:[0-9a-f-]{36}$/i;
function appBackupResponse(payload, status, origin = '') {
  const headers = { 'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store', 'x-content-type-options':'nosniff' };
  if (origin) { headers['access-control-allow-origin'] = origin; headers.vary='Origin'; }
  return new Response(JSON.stringify(payload), {status,headers});
}
function appBackupToBase64(bytes) {
  let value = '';
  for (let i=0;i<bytes.length;i+=32768) value += String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(value);
}
function appBackupFromBase64(s) {
  if (typeof s !== 'string' || !s.length || s.length>Math.ceil(APP_BACKUP_PART_MAX/3)*4+8 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw Error('invalid_base64');
  return Uint8Array.from(atob(s), c=>c.charCodeAt(0));
}
async function appBackupSha(data) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function appBackupTables(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS multi_app_backup_sets (
    app TEXT NOT NULL, id TEXT NOT NULL, device TEXT NOT NULL, origin TEXT NOT NULL,
    part_count INTEGER NOT NULL, total_sha256 TEXT NOT NULL, total_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(app,id))`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_multi_app_sets ON multi_app_backup_sets(app,device,origin,created_at DESC)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS multi_app_backup_parts (
    app TEXT NOT NULL, backup_id TEXT NOT NULL, device TEXT NOT NULL, origin TEXT NOT NULL,
    part_index INTEGER NOT NULL, part_count INTEGER NOT NULL, total_sha256 TEXT NOT NULL,
    part_sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, file_key TEXT NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY(app,backup_id,part_index))`).run();
}
async function appBackupDeleteFile(env, fileKey) {
  if (!APP_BACKUP_FILE_KEY.test(fileKey)) return false;
  const r=await sharedRequest(env, `/v1/files/${encodeURIComponent(fileKey)}`,{method:'DELETE'});
  if (r.status===404) return true;
  if (!r.ok) return false;
  const body=await r.json().catch(()=>({}));
  return body.ok===true && body.deleted===true;
}
async function appBackupPrune(env, app, device, origin) {
  const stale=await env.DB.prepare(`SELECT id FROM multi_app_backup_sets WHERE app=? AND device=? AND origin=?
      ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET ?`).bind(app,device,origin,APP_BACKUP_KEEP).all();
  let pending=false;
  for (const set of stale.results||[]) {
    const parts=await env.DB.prepare('SELECT file_key FROM multi_app_backup_parts WHERE app=? AND backup_id=?').bind(app,set.id).all();
    let clean=true;
    for (const part of parts.results||[]) {
      try { if (!(await appBackupDeleteFile(env,part.file_key))) clean=false; }
      catch(e) { console.warn('app backup prune failed',app,set.id,String(e)); clean=false; }
    }
    if (!clean) { pending=true;continue; }
    await env.DB.prepare('DELETE FROM multi_app_backup_parts WHERE app=? AND backup_id=?').bind(app,set.id).run();
    await env.DB.prepare('DELETE FROM multi_app_backup_sets WHERE app=? AND id=?').bind(app,set.id).run();
  }
  return pending;
}
async function handleAppBackup(request, env) {
  const url=new URL(request.url);
  const m=url.pathname.match(/^\/v1\/app-backups\/(or|x|pixiv)(?:\/(.*))?$/);
  const type=m && APP_BACKUP_TYPES[m[1]];
  const suppliedOrigin=request.headers.get('origin')||'';
  const corsOrigin=type && type.origins.includes(suppliedOrigin)?suppliedOrigin:'';
  if (!type) return appBackupResponse({ok:false,error:'app_not_found'},404);
  if (request.method==='OPTIONS') {
    if (!corsOrigin) return appBackupResponse({ok:false,error:'origin_not_allowed'},403);
    return new Response(null,{status:204,headers:{
      'access-control-allow-origin':corsOrigin, 'access-control-allow-methods':'GET,POST,OPTIONS',
      'access-control-allow-headers':'Authorization,Content-Type,X-Source-Origin',
      'access-control-max-age':'600',vary:'Origin'}});
  }
  if (suppliedOrigin && !corsOrigin) return appBackupResponse({ok:false,error:'origin_not_allowed'},403);
  const expected=env[type.secret];
  if (!expected || !constantTimeEqual(request.headers.get('authorization')||'',`Bearer ${expected}`))
    return appBackupResponse({ok:false,error:'unauthorized'},401,corsOrigin);
  if (!['GET','POST'].includes(request.method)) return appBackupResponse({ok:false,error:'method_not_allowed'},405,corsOrigin);
  const app=m[1],route=m[2]||'';
  const source=request.headers.get('x-source-origin')||'';
  if (source && (!type.origins.includes(source) || (suppliedOrigin && source!==suppliedOrigin)))
    return appBackupResponse({ok:false,error:'source_origin_not_allowed'},403,corsOrigin);
  // Both Workers and the existing niji backup use these same bindings.
  config(env);
  await appBackupTables(env);
  if (route==='status' && request.method==='GET') {
    const s=await storageJson(env,'/v1/status',{method:'GET'});
    return appBackupResponse({ok:true,connected:!!s.connected,remoteOk:!!s.remoteOk},200,corsOrigin);
  }
  if (route==='' && request.method==='GET') {
    const rows=await env.DB.prepare('SELECT app,id,device,origin,part_count,total_sha256,total_bytes,created_at FROM multi_app_backup_sets WHERE app=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(app).all();
    return appBackupResponse({ok:true,backups:(rows.results||[]).map(r=>({id:r.id,device:r.device,origin:r.origin,partCount:r.part_count,sha256:r.total_sha256,size:r.total_bytes,createdAt:r.created_at}))},200,corsOrigin);
  }
  const partMatch=route.match(/^([0-9a-f-]{36})\/parts\/(\d+)$/i);
  if (partMatch && request.method==='GET') {
    const id=partMatch[1],index=Number(partMatch[2]);
    if (!APP_BACKUP_UUID.test(id)||!Number.isInteger(index)||index<0||index>=APP_BACKUP_PARTS_MAX)
      return appBackupResponse({ok:false,error:'invalid_part'},400,corsOrigin);
    const set=await env.DB.prepare('SELECT * FROM multi_app_backup_sets WHERE app=? AND id=?').bind(app,id).first();
    if (!set) return appBackupResponse({ok:false,error:'not_found'},404,corsOrigin);
    const p=await env.DB.prepare('SELECT * FROM multi_app_backup_parts WHERE app=? AND backup_id=? AND part_index=?').bind(app,id,index).first();
    if (!p || !APP_BACKUP_FILE_KEY.test(p.file_key)) return appBackupResponse({ok:false,error:'part_not_found'},404,corsOrigin);
    const resp=await sharedRequest(env,`/v1/files/${encodeURIComponent(p.file_key)}`,{method:'GET'});
    if (!resp.ok) return appBackupResponse({ok:false,error:'storage_'+resp.status},502,corsOrigin);
    const bytes=new Uint8Array(await resp.arrayBuffer());
    if (bytes.length!==p.size_bytes || await appBackupSha(bytes)!==p.part_sha256)
      return appBackupResponse({ok:false,error:'remote_part_integrity_failed'},502,corsOrigin);
    return appBackupResponse({ok:true,id,index,base64:appBackupToBase64(bytes),sha256:p.part_sha256},200,corsOrigin);
  }
  if (route==='parts' && request.method==='POST') {
    const data=await request.json().catch(()=>null);
    const id=data?.id, index=data?.index, count=data?.count, device=data?.device, origin=data?.origin,
      totalSha=data?.totalSha, partSha=data?.partSha;
    if (!APP_BACKUP_UUID.test(id||'') || !Number.isInteger(index)||index<0 || !Number.isInteger(count)||count<1||count>APP_BACKUP_PARTS_MAX||index>=count ||
        !APP_BACKUP_DEVICE.test(device||'') || !type.origins.includes(origin) || (suppliedOrigin&&origin!==suppliedOrigin) ||
        (source&&origin!==source) || !APP_BACKUP_SHA.test(totalSha||'') || !APP_BACKUP_SHA.test(partSha||''))
      return appBackupResponse({ok:false,error:'invalid_metadata'},400,corsOrigin);
    let bytes;
    try {bytes=appBackupFromBase64(data.base64);}catch{return appBackupResponse({ok:false,error:'invalid_part_data'},400,corsOrigin);}
    if (!bytes.length||bytes.length>APP_BACKUP_PART_MAX || await appBackupSha(bytes)!==partSha)
      return appBackupResponse({ok:false,error:'part_checksum_or_size'},400,corsOrigin);
    const committed=await env.DB.prepare('SELECT id FROM multi_app_backup_sets WHERE app=? AND id=?').bind(app,id).first();
    if (committed) return appBackupResponse({ok:false,error:'already_committed'},409,corsOrigin);
    const existing=await env.DB.prepare('SELECT * FROM multi_app_backup_parts WHERE app=? AND backup_id=? AND part_index=?').bind(app,id,index).first();
    if (existing) return existing.part_sha256===partSha && existing.part_count===count && existing.total_sha256===totalSha && existing.device===device && existing.origin===origin
      ? appBackupResponse({ok:true,unchanged:true},200,corsOrigin) : appBackupResponse({ok:false,error:'part_conflict'},409,corsOrigin);
    const filename=`backup-${app}-${device}-${id}-${index}.bin`;
    const form=new FormData();form.set('category','documents');form.set('filename',filename);
    form.set('file',new File([bytes],filename,{type:'application/octet-stream'}),filename);
    const uploaded=await storageJson(env,'/v1/files',{method:'POST',body:form});
    const fileKey=uploaded.file?.fileKey;
    if (!APP_BACKUP_FILE_KEY.test(fileKey||'')) throw Error('storage_file_key_missing');
    try {
      await env.DB.prepare(`INSERT INTO multi_app_backup_parts (app,backup_id,device,origin,part_index,part_count,total_sha256,part_sha256,size_bytes,file_key,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(app,id,device,origin,index,count,totalSha,partSha,bytes.length,fileKey,new Date().toISOString()).run();
    } catch(e) {try {await appBackupDeleteFile(env,fileKey);}catch{} throw e;}
    return appBackupResponse({ok:true,index},201,corsOrigin);
  }
  if (route==='commit' && request.method==='POST') {
    const d=await request.json().catch(()=>null);
    if (!APP_BACKUP_UUID.test(d?.id||'') || !APP_BACKUP_DEVICE.test(d?.device||'') ||
        !type.origins.includes(d?.origin) || (suppliedOrigin&&d.origin!==suppliedOrigin) || (source&&d.origin!==source) ||
        !Number.isInteger(d?.count)||d.count<1||d.count>APP_BACKUP_PARTS_MAX|| !APP_BACKUP_SHA.test(d?.totalSha||''))
      return appBackupResponse({ok:false,error:'invalid_metadata'},400,corsOrigin);
    const prior=await env.DB.prepare('SELECT * FROM multi_app_backup_sets WHERE app=? AND id=?').bind(app,d.id).first();
    if (prior) return appBackupResponse({ok:true,unchanged:true,backupId:d.id},200,corsOrigin);
    const parts=await env.DB.prepare('SELECT * FROM multi_app_backup_parts WHERE app=? AND backup_id=? ORDER BY part_index ASC').bind(app,d.id).all();
    const rows=parts.results||[];
    if (rows.length!==d.count || rows.some((p,i)=>p.part_index!==i || p.part_count!==d.count || p.total_sha256!==d.totalSha || p.device!==d.device || p.origin!==d.origin))
      return appBackupResponse({ok:false,error:'incomplete_backup'},409,corsOrigin);
    const size=rows.reduce((n,p)=>n+p.size_bytes,0);
    if (!size) return appBackupResponse({ok:false,error:'empty_backup'},400,corsOrigin);
    await env.DB.prepare(`INSERT INTO multi_app_backup_sets(app,id,device,origin,part_count,total_sha256,total_bytes,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(app,d.id,d.device,d.origin,d.count,d.totalSha,size,new Date().toISOString()).run();
    // Never touch niji_backups: its five-generation retention is separate.
    let cleanupPending=false;
    try {cleanupPending=await appBackupPrune(env,app,d.device,d.origin);}catch(e){console.warn('app backup prune',String(e));cleanupPending=true;}
    return appBackupResponse({ok:true,backupId:d.id,cleanupPending},201,corsOrigin);
  }
  return appBackupResponse({ok:false,error:'not_found'},404,corsOrigin);
}
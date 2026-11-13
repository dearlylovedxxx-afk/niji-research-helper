import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';

const src=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');
const start=src.indexOf('  const API_SECRET_KDF_ITERATIONS =');
const end=src.indexOf('  // ---------- optional pCloud backup',start);
assert.ok(start>0&&end>start);
const code=src.slice(start,end);
const TOKEN='niji-client-token-for-test-1234567890-unique';
const DEVICE='nrh-api-secrets-global',CFG='npf_cloud_backup_config_v1',
  LEGACY='npf_api_secrets_crypto_local_v1',REV='npf_api_secrets_revisions_local_v1',
  HOLO='npf_holodex_api_key',YT='npf_youtube_api_key_local_v1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
class FakeCloud{
  constructor(){this.rows=[];this.sequence=0;}
  put(payload){
    const bytes=new TextEncoder().encode(JSON.stringify(payload));
    const item={id:'bk'+(++this.sequence),device:DEVICE,size:bytes.byteLength,
      sha256:sha(bytes),createdAt:new Date(1760000000000+this.sequence*1000).toISOString()};
    this.rows.unshift({bytes,item});return item;
  }
  snapshot(){return JSON.parse(new TextDecoder().decode(this.rows[0].bytes));}
  async request(req){
    const url=new URL(req.url);
    if(req.method==='GET'&&url.pathname==='/v1/backups')
      return {status:200,responseText:JSON.stringify({ok:true,backups:this.rows.map(r=>r.item)})};
    if(req.method==='GET'&&url.pathname.startsWith('/v1/backups/')){
      const x=this.rows.find(r=>r.item.id===url.pathname.split('/').pop());
      return x?{status:200,response:x.bytes.slice().buffer}:{status:404,responseText:'{}'};
    }
    if(req.method==='POST'&&url.pathname==='/v1/backups'){
      const data=JSON.parse(req.data),bytes=new TextEncoder().encode(req.data);
      assert.equal(req.headers['x-nrh-sha256'],sha(bytes));
      assert.equal(req.headers['x-nrh-device'],DEVICE);
      const item=this.put(data);
      return {status:200,responseText:JSON.stringify({ok:true,backup:item})};
    }
    throw Error('Unhandled request '+req.method+' '+url.pathname);
  }
}
function client(cloud,{token=TOKEN,connected=true,keys={},legacy=null}={}){
  const store=new Map([[CFG,{enabled:connected,token:connected?token:''}],
    [HOLO,keys.holodex||''],[YT,keys.youtube||'']]);
  if(legacy)store.set(LEGACY,legacy);
  const GM={getValue:async(k,f)=>store.has(k)?store.get(k):f,
    setValue:async(k,v)=>{store.set(k,v)}};
  const state={apiSecretBusy:false,apiSecretReady:false,apiSecretStatus:'',
    apiSecretTimer:null,apiKey:keys.holodex||''};
  const noop=()=>{};
  const create=new Function(
    'crypto','TextEncoder','TextDecoder','btoa','atob',
    'API_SECRET_CLOUD_DEVICE','API_SECRET_CRYPTO_LOCAL','CLOUD_CONFIG_KEY',
    'API_SECRET_REVISIONS_LOCAL','KEY_API','KEY_YT_API','CLOUD_URL',
    'PREF_CLOUD_ORIGIN','NRH_DB_VERSION','CLOUD_STORES','VERSION',
    'state','document','gmGet','GM','gmRequest','favoriteCloudSha',
    'resetYoutubePriorityBackground','isYoutubeHost','startYoutubePriorityBackgroundSearch',
    'setTimeout','clearTimeout','console',
    code+'\nreturn {initialize:apiSecretInitialize,sync:apiSecretSync,'+
      'change:apiSecretRecordLocalChange,encrypt:apiSecretEncrypt,'+
      'decrypt:apiSecretDecrypt,read:apiSecretCurrentRows,ui:createApiSecretUi};'
  );
  const api=create(webcrypto,TextEncoder,TextDecoder,btoa,atob,
    DEVICE,LEGACY,CFG,REV,HOLO,YT,
    'https://niji-research-backup.dearlylovedxxx.workers.dev',
    'https://www.youtube.com',1,['videos','channels','wiki','pairs'],'1.0.128',
    state,{getElementById:()=>null,createElement:tag=>({tagName:tag,style:{},children:[],
      addEventListener(){},append(...children){this.children.push(...children)}})},
    GM.getValue,GM,req=>cloud.request(req),async bytes=>sha(bytes),
    noop,()=>false,noop,()=>1,noop,{warn(){}}
  );
  return {api,store,state,GM};
}
async function legacySnapshot(rows){
  const keyBytes=webcrypto.getRandomValues(new Uint8Array(32)),
    salt=webcrypto.getRandomValues(new Uint8Array(16)),
    iv=webcrypto.getRandomValues(new Uint8Array(12));
  const key=await webcrypto.subtle.importKey('raw',keyBytes,{name:'AES-GCM'},false,['encrypt']);
  const plain=new TextEncoder().encode(JSON.stringify({version:1,rows}));
  const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,
    additionalData:new TextEncoder().encode(DEVICE)},key,plain);
  const b64=x=>Buffer.from(x).toString('base64');
  const enc={version:1,alg:'AES-256-GCM',kdf:'PBKDF2-SHA256',
    iterations:310000,salt:b64(salt),iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))};
  const payload={app:'Niji Research Helper',device:DEVICE,dbVersion:1,
    stores:{videos:[],channels:[],wiki:[],pairs:[]},
    preferences:{apiSecretEncrypted:enc}};
  return {payload,cfg:{salt:b64(salt),key:b64(keyBytes)}};
}

test('v1.0.128 syntax, metadata, and no passphrase UI',()=>{
  assert.doesNotThrow(()=>new Function(src));
  assert.match(src,/@version\s+1\.0\.128/);
  assert.match(meta,/@version\s+1\.0\.128/);
  assert.match(src,/const VERSION = '1\.0\.128'/);
  assert.doesNotMatch(code,/npf-api-secret-passphrase|npf-api-secret-confirm|async function apiSecretEnable/);
});
test('connected PC automatically stores real AES-GCM ciphertext, not plaintext',async()=>{
  const cloud=new FakeCloud(),a=client(cloud,{keys:{holodex:'hd-very-private',youtube:'yt-very-private'}});
  await a.api.initialize();
  assert.equal(a.state.apiSecretReady,true);
  assert.equal(cloud.rows.length,1);
  const doc=cloud.snapshot(),envelope=doc.preferences.apiSecretEncrypted;
  assert.equal(envelope.version,2);
  assert.equal(envelope.kdf,'HKDF-SHA256-NIJI-TOKEN');
  assert.doesNotMatch(JSON.stringify(doc),/hd-very-private|yt-very-private/);
  assert.equal(a.store.get(LEGACY),undefined);
  await a.api.sync();
  assert.equal(cloud.rows.length,1,'unchanged keys do not make extra generations');
});
test('iPhone with the same Niji Cloud token gets both API keys with no extra setup',async()=>{
  const cloud=new FakeCloud();
  await client(cloud,{keys:{holodex:'pc-hd',youtube:'pc-yt'}}).api.initialize();
  const phone=client(cloud);
  await phone.api.initialize();
  assert.equal(phone.store.get(HOLO),'pc-hd');
  assert.equal(phone.store.get(YT),'pc-yt');
  assert.equal(phone.state.apiKey,'pc-hd');
  assert.equal(cloud.rows.length,1);
});
test('editing one API key syncs automatically without deleting the other',async()=>{
  const cloud=new FakeCloud();
  const pc=client(cloud,{keys:{holodex:'hd-old',youtube:'yt-old'}});
  await pc.api.initialize();
  const phone=client(cloud);
  await phone.api.initialize();
  await pc.GM.setValue(YT,'yt-new');
  await pc.api.change('youtube','yt-new');
  await pc.api.sync();
  await phone.api.sync();
  assert.equal(phone.store.get(YT),'yt-new');
  assert.equal(phone.store.get(HOLO),'hd-old');
  assert.equal(cloud.rows.length,2);
});
test('unconnected client remains local; connected client with zero keys does not upload empty data',async()=>{
  const cloud=new FakeCloud();
  const offline=client(cloud,{connected:false,keys:{youtube:'stay-local'}});
  await offline.api.initialize();
  assert.equal(offline.state.apiSecretReady,false);
  assert.equal(offline.store.get(YT),'stay-local');
  const empty=client(cloud);await empty.api.initialize();
  assert.equal(cloud.rows.length,0);
  assert.match(empty.state.apiSecretStatus,/APIキーをどれかの端末で保存/);
});
test('wrong token cannot decrypt or erase current cloud credentials',async()=>{
  const cloud=new FakeCloud();
  await client(cloud,{keys:{holodex:'real-secret'}}).api.initialize();
  const wrong=client(cloud,{token:'a-totally-different-niji-cloud-token-999',keys:{youtube:'local-only'}});
  await wrong.api.initialize();
  assert.equal(wrong.store.get(YT),'local-only');
  assert.equal(cloud.rows.length,1);
  assert.match(wrong.state.apiSecretStatus,/復号できません/);
});
test('unreadable old passphrase backup never gets replaced with empty or partial local keys',async()=>{
  const cloud=new FakeCloud(),legacy=await legacySnapshot({
    holodex:{value:'legacy-hd',updatedAt:3},
    youtube:{value:'legacy-yt',updatedAt:3}
  });
  cloud.put(legacy.payload);
  const phone=client(cloud,{keys:{holodex:'keep-hd'}});
  await phone.api.initialize();
  assert.equal(cloud.rows.length,1);
  assert.equal(cloud.snapshot().preferences.apiSecretEncrypted.version,1);
  assert.equal(phone.store.get(HOLO),'keep-hd');
  assert.match(phone.state.apiSecretStatus,/旧・合言葉方式/);
});
test('old device with saved legacy key migrates v1 to v2, then new devices can restore',async()=>{
  const cloud=new FakeCloud(),legacy=await legacySnapshot({
    holodex:{value:'legacy-hd',updatedAt:3},
    youtube:{value:'legacy-yt',updatedAt:3}
  });
  cloud.put(legacy.payload);
  const old=client(cloud,{legacy:legacy.cfg});
  await old.api.initialize();
  assert.equal(cloud.rows.length,2);
  assert.equal(cloud.snapshot().preferences.apiSecretEncrypted.version,2);
  assert.equal(old.store.get(HOLO),'legacy-hd');
  assert.equal(old.store.get(YT),'legacy-yt');
  const fresh=client(cloud);
  await fresh.api.initialize();
  assert.equal(fresh.store.get(HOLO),'legacy-hd');
  assert.equal(fresh.store.get(YT),'legacy-yt');
});

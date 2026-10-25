import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Pixiv_Bookmark_Sort.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Pixiv_Bookmark_Sort.meta.js',import.meta.url),'utf8');
const begin=script.indexOf("  // ------ Read-only diagnostics for Pixiv's OWN");
const finish=script.indexOf('  const novelId = () => {',begin);
assert.ok(begin>0&&finish>begin);
const moduleCode=script.slice(begin,finish);
class Store {
  constructor(data={}){this.data=new Map(Object.entries(data))}
  get length(){return this.data.size}
  key(i){return [...this.data.keys()][i]??null}
  getItem(k){return this.data.get(k)??null}
  setItem(k,v){this.data.set(k,String(v))}
  removeItem(k){this.data.delete(k)}
}
function harness(shared={}){
  const secret='CONFIDENTIAL_REPLACEMENT_123';
  const local=shared.local || new Store({pixivNovelWords:JSON.stringify({words:[{name:'みょうじ',value:secret}]})});
  const session=shared.session || new Store();
  const handlers=new Map(),winHandlers=new Map();
  const input={
    tagName:'INPUT',type:'text',placeholder:'変換後のテキスト',
    value:secret,parentElement:{tagName:'DIV',parentElement:{tagName:'SECTION'}},
    getAttribute:()=>null,closest:()=>null
  };
  const doc={
    body:{},querySelectorAll:()=>[input],
    addEventListener(name,fn){handlers.set(name,fn)},
    removeEventListener(name){handlers.delete(name)}
  };
  const win={
    addEventListener(name,fn){winHandlers.set(name,fn)},
    removeEventListener(name){winHandlers.delete(name)}
  };
  const init=[
    'let overlay={contains:()=>false};',
    'let closed=0;',
    'const closeOverlay=()=>{closed++};',
    'const setInterval=()=>1,clearInterval=()=>{};',
    'const setTimeout=()=>0;',
    'class MutationObserver {observe(){} disconnect(){}}'
  ].join('\n');
  const exported=[
    'return {termDiagSnapshot,termDiagDiff,termDiagValueShape,startTermDiag,termDiagResumeOnLoad,',
    'stopTermDiag,termDiagCapture,termDiagOnClick,termDiagSafeReport,',
    'termDiagReadSafeReport,termDiagStoreSafeReport,termDiagReportToText,',
    'get state(){return termDiag},get closed(){return closed}}'
  ].join('');
  const api=new Function('localStorage','sessionStorage','document','window',
    init+'\n'+moduleCode+'\n'+exported)(local,session,doc,win);
  return {local,session,api,handlers,winHandlers,secret};
}

test('script and metadata match diagnostic release',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/@version\s+0\.6\.45/);
  assert.match(meta,/@version\s+0\.6\.45/);
});

test('storage snapshots never include private names or novel content',()=>{
  const h=harness();
  assert.doesNotMatch(JSON.stringify(h.api.termDiagSnapshot()),/CONFIDENTIAL_REPLACEMENT_123/);
});

test('native conversion input structure is read without the entered value',()=>{
  const h=harness();
  h.api.startTermDiag();
  const r=h.api.termDiagSafeReport();
  assert.equal(r.nativeFieldCount,1);
  assert.deepEqual(r.placeholderHints,['変換後のテキスト']);
  assert.doesNotMatch(JSON.stringify(r),/CONFIDENTIAL_REPLACEMENT_123/);
});

test('Pixiv native Apply and changed storage are detected without revealing values',()=>{
  const h=harness();
  h.api.startTermDiag();
  h.api.termDiagOnClick({target:{closest:()=>({textContent:'適用して読む'})}});
  h.local.setItem('pixivNovelWords',JSON.stringify({
    words:[{name:'みょうじ',value:'ANOTHER_PRIVATE_NAME'}]
  }));
  const report=h.api.termDiagStoreSafeReport();
  assert.equal(report.clickedNativeApply,true);
  assert.equal(report.storageChanges.length,1);
  assert.equal(report.storageChanges[0].change,'更新');
  assert.equal(report.storageChanges[0].valueShape.type,'object');
  const output=h.api.termDiagReportToText(report);
  assert.doesNotMatch(output,/ANOTHER_PRIVATE_NAME|CONFIDENTIAL_REPLACEMENT_123|みょうじ/);
  assert.doesNotMatch(h.session.getItem('pnte-native-term-diagnostic-safe-v1'),/ANOTHER_PRIVATE_NAME/);
});

test('diagnostic listeners are removed and sanitized report persists for reload',()=>{
  const h=harness();h.api.startTermDiag();
  assert.equal(h.api.closed,1);
  assert.ok(h.winHandlers.has('pagehide'));
  h.api.stopTermDiag();
  assert.equal(h.handlers.size,0);
  assert.equal(h.winHandlers.size,0);
  assert.equal(h.api.state.active,false);
  assert.ok(h.api.termDiagReadSafeReport());
});

test('existing TXT extraction, preview, and export flow are unchanged',()=>{
  assert.match(script,/drawPages\(original\.pages\)/);
  assert.match(script,/const parsed = parseContent\(body\.content\)/);
  assert.match(script,/const text = buildOutput\(\)/);
  assert.match(script,/header\.append\(bar, meta, makeTermDiagPanel\(\), statusNode\)/);
});

test('diagnostic includes generic input counts and masked storage hints even with unchanged values',()=>{
  const h=harness();
  h.api.startTermDiag();
  const report=h.api.termDiagSafeReport();
  assert.equal(report.diagnosticVersion,3);
  assert.ok(report.inputCandidateCount>=1);
  assert.ok(report.storageKeyCounts.local>=1);
  assert.equal(report.storageChanges.length,0);
  assert.ok(report.possibleConversionStorage.length>=1);
  assert.doesNotMatch(JSON.stringify(report),/CONFIDENTIAL_REPLACEMENT_123/);
});

test('diagnostic checkpoint records non-secret baseline before user navigation',()=>{
  const h=harness();
  h.api.startTermDiag();
  const raw=h.session.getItem('pnte-native-term-diagnostic-state-v2');
  assert.ok(raw);
  const saved=JSON.parse(raw);
  assert.equal(saved.version,2);
  assert.equal(saved.active,true);
  assert.equal(saved.foundInputs,1);
  assert.doesNotMatch(raw,/CONFIDENTIAL_REPLACEMENT_123/);
  h.api.stopTermDiag();
  assert.equal(h.session.getItem('pnte-native-term-diagnostic-state-v2'),null);
});

test('a loaded page can resume diagnosis from previous session state',()=>{
  assert.match(script,/function termDiagResumeOnLoad\(\)/);
  assert.match(script,/const restored=termDiagRestoreCheckpoint\(\)/);
  assert.match(script,/termDiag=restored/);
  assert.match(script,/termDiagResumeOnLoad\(\);\s*void init\(\)/);
  assert.match(script,/sessionStorage\.setItem\(TERM_DIAG_STATE_KEY/);
  assert.match(script,/document\.addEventListener\('pointerup',termDiagCapture,true\)/);
  assert.match(script,/document\.addEventListener\('touchend',termDiagCapture,true\)/);
});

test('reload-restored diagnosis correctly compares original and new conversion state',()=>{
  const first=harness();
  first.api.startTermDiag();
  assert.ok(first.session.getItem('pnte-native-term-diagnostic-state-v2'));
  first.local.setItem('pixivNovelWords',JSON.stringify({words:[{name:'みょうじ',value:'PRIVATE_AFTER_RELOAD'}]}));
  const next=harness({local:first.local,session:first.session});
  next.api.termDiagResumeOnLoad();
  const report=next.api.termDiagSafeReport();
  assert.equal(report.resumedAcrossNavigation,true);
  assert.equal(report.storageChanges.length,1);
  assert.equal(report.storageChanges[0].change,'更新');
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_AFTER_RELOAD/);
});

test('Pixiv native words[] schema is discovered without leaking its source or replacement',()=>{
  const h=harness();
  const secretOriginal='みょうじ';
  const secretNew='SECRET_DESIRED_NAME';
  const data={
    '9283714':{words:[{id:1234,termId:992,source:secretOriginal,replacement:secretNew},{id:2,termId:993,source:'なまえ',replacement:'ALSO_SECRET'}],updatedAt:1720000000},
    '9283715':{words:[{id:3,termId:994,replacement:'OTHER_SECRET'}],updatedAt:1720000001}
  };
  h.local.setItem('opaque_storage_key','plain text unrelated');
  h.local.setItem('termConversionStore',JSON.stringify(data));
  h.api.startTermDiag();
  const report=h.api.termDiagSafeReport();
  const schema=report.nativeWordsSchema;
  assert.ok(schema.length>=1);
  const matching=schema.find(e=>e.seriesEntryCount===2&&e.wordsEntries===2);
  assert.ok(matching);
  assert.equal(matching.seriesKeyFormats[0],'numeric');
  assert.equal(matching.examples[0].wordCount,2);
  assert.deepEqual(matching.examples[0].wordItemSchema.fields.map(e=>e.valueType),['number','number','string','string']);
  const exported=JSON.stringify(report);
  assert.doesNotMatch(exported,/SECRET_DESIRED_NAME|ALSO_SECRET|OTHER_SECRET|みょうじ|なまえ|9283714/);
});

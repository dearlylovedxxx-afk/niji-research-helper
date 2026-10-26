import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../Pixiv_Bookmark_Sort.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Pixiv_Bookmark_Sort.meta.js',import.meta.url),'utf8');
const start=src.indexOf('  // Reuse Pixiv');
const end=src.indexOf('  const novelId = () => {',start);
assert.ok(start>0&&end>start);
const methods=src.slice(start,end);

class LocalStore {
  constructor(data={}){this.db=new Map(Object.entries(data));}
  get length(){return this.db.size;}
  key(i){return [...this.db.keys()][i]??null;}
  getItem(k){return this.db.get(k)??null;}
}
const example=[
  {id:'201',word:'花子'},
  {id:'202',word:'青木'},
  {id:'203',word:'新しい名前'}
];
const glossary={error:false,body:{
  replaceeItemIds:['201','202','203'],
  categories:[{items:[
    {id:'201',name:'みょうじ'},
    {id:'202',name:'なまえ'},
    {id:'203',name:'[変換名]'},
    {id:'999',name:'別の単語'}
  ]}]
}};
const saved=new LocalStore({
  novel_search:'{}',
  novel_series_glossary_111:JSON.stringify({'654321':{words:example,loadTime:12345}}),
  unrelated:'{"something":true}'
});
const fetches=[];
let fail=false;
async function fetcher(url,options){
  fetches.push(url);
  if(fail)throw Error('offline');
  return {ok:true,json:async()=>glossary};
}
const service=new Function('localStorage','fetch',methods+
  '\nreturn {pixivNativeSeriesId,pixivNativeSavedWords,pixivNativeGlossaryPairs,pixivNativeApplyNames,pixivNativeConvertNovel}')(saved,fetcher);
const novel=content=>({content,seriesNavData:{seriesId:'654321',title:'Test'}});
test('versions match and JS syntax parses',()=>{
  assert.doesNotThrow(()=>new Function(src));
  assert.match(src,/@version\s+0\.6\.47/);
  assert.match(meta,/@version\s+0\.6\.47/);
});
test('reader storage maps word values to author glossary items via matching IDs',()=>{
  const words=service.pixivNativeSavedWords('654321');
  assert.deepEqual(words,example);
  assert.deepEqual(service.pixivNativeGlossaryPairs(words,glossary),[
    {from:'[変換名]',to:'新しい名前'},
    {from:'みょうじ',to:'花子'},
    {from:'なまえ',to:'青木'}
  ]);
});
test('all replacements are from the matching series, not other novel series',()=>{
  assert.deepEqual(service.pixivNativeSavedWords('999999'),[]);
  assert.equal(service.pixivNativeSeriesId({seriesNavData:{seriesId:'654321'}}),'654321');
  assert.equal(service.pixivNativeSeriesId({seriesNavData:{seriesId:null}}),'');
  assert.equal(service.pixivNativeSeriesId({}), '');
});
test('names are replaced in prose but Pixiv formatting tags are preserved',()=>{
  const text='みょうじとなまえ。[変換名]\n[chapter:みょうじ]\n[newpage]\n[uploadedimage:1200]\n';
  const pairs=service.pixivNativeGlossaryPairs(example,glossary);
  assert.equal(service.pixivNativeApplyNames(text,pairs),
    '花子と青木。新しい名前\n[chapter:みょうじ]\n[newpage]\n[uploadedimage:1200]\n');
});
test('longer terms take precedence and output replacements are not replaced again',()=>{
  assert.equal(service.pixivNativeApplyNames('山田太郎と山田',[
    {from:'山田',to:'田中'},{from:'山田太郎',to:'美咲'}]),'美咲と田中');
  assert.equal(service.pixivNativeApplyNames('AとB',[
    {from:'A',to:'B'},{from:'B',to:'C'}]),'BとC');
});
test('special punctuation in author source terms is treated literally',()=>{
  assert.equal(service.pixivNativeApplyNames('[LN:○○] と (名).',[
    {from:'[LN:○○]',to:'花子'}, {from:'(名)',to:'さくら'}]),'花子 と さくら.');
});
test('fully automatic conversion obtains Pixiv glossary through same-origin endpoint',async()=>{
  const result=await service.pixivNativeConvertNovel(novel('みょうじとなまえ'));
  assert.equal(result.applied,true);
  assert.equal(result.content,'花子と青木');
  assert.equal(fetches.at(-1),'/ajax/novel/series/654321/glossary');
});
test('API errors keep original text unchanged',async()=>{
  fail=true;
  const text='みょうじとなまえ';
  const result=await service.pixivNativeConvertNovel(novel(text));
  fail=false;
  assert.equal(result.applied,false);
  assert.equal(result.content,text);
  assert.match(result.message,/原文表示/);
});
test('ambiguous viewer profiles with different settings fail closed',()=>{
  const ambiguous=new LocalStore({
    novel_series_glossary_111:JSON.stringify({'654321':{words:example}}),
    novel_series_glossary_222:JSON.stringify({'654321':{words:[{id:'201',word:'別の人'}]}})
  });
  assert.deepEqual(service.pixivNativeSavedWords('654321',ambiguous),[]);
});
test('empty user replacement stays original',()=>{
  assert.deepEqual(service.pixivNativeSavedWords('654321',new LocalStore({
    novel_series_glossary_111:JSON.stringify({'654321':{words:[{id:'201',word:''}]}})
  })),[]);
});
test('TXT UI defaults to converted text but provides original-only switch',()=>{
  assert.match(src,/plainPages: parsed.pages/);
  assert.match(src,/pages: safe \? converted.pages : parsed.pages/);
  assert.match(src,/nativeTermToggle\.checked = !!safe/);
  assert.match(src,/nativeTermLabel\.style\.display = safe \? '' : 'none'/);
  assert.match(src,/drawPages\(nativeTermToggle\.checked\?original.pages:original.plainPages\)/);
  assert.match(src,/const text = buildOutput\(\)/);
});

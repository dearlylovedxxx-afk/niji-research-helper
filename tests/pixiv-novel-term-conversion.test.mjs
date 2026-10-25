import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Pixiv_Bookmark_Sort.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Pixiv_Bookmark_Sort.meta.js',import.meta.url),'utf8');
const a=script.indexOf('  // Reader-selected name/term conversions for TXT export.');
const b=script.indexOf('  const novelId = () => {',a);
assert.ok(a>0&&b>a);
const moduleCode=script.slice(a,b);

const setup=()=>{
  const memory=new Map();
  const localStore={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
  const fn=new Function('localStorage',
    'let original=null,statusNode=null;function drawPages(){}\n'+moduleCode+
    '\nreturn {normalizeTermPairs,applyTermPairs,getTermScope,saveTermSettings,readTermSettings,configure(scope,rows,on){termScope=scope;termPairs=rows;termOn=on}}');
  return fn(localStore);
};

test('script and metadata versions match',()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/@version\s+0\.6\.42/);
  assert.match(meta,/@version\s+0\.6\.42/);
});

test('non-regex Japanese and punctuation terms are literal',()=>{
  const m=setup();
  assert.equal(m.applyTermPairs('花子ちゃん、花子は元気', [{from:'花子',to:'美咲'}]),'美咲ちゃん、美咲は元気');
  assert.equal(m.applyTermPairs('[名前] と (名字)', [{from:'[名前]',to:'ゆい'},{from:'(名字)',to:'高橋'}]),'ゆい と 高橋');
});

test('overlapping terms use longest-first and replacements never cascade',()=>{
  const m=setup();
  assert.equal(m.applyTermPairs('佐藤太郎と佐藤',[{from:'佐藤',to:'青木'},{from:'佐藤太郎',to:'響'}]),'響と青木');
  assert.equal(m.applyTermPairs('花子と美咲',[{from:'花子',to:'美咲'},{from:'美咲',to:'ヒナ'}]),'美咲とヒナ');
});

test('empty replacement and duplicate source names are ignored',()=>{
  const m=setup();
  assert.deepEqual(m.normalizeTermPairs([{from:'A',to:''},{from:'A',to:'B'},{from:'A',to:'C'}]),[{from:'A',to:'B'}]);
  assert.equal(m.applyTermPairs('A',[{from:'A',to:''}]),'A');
});

test('each series has its own on-device replacement settings',()=>{
  const m=setup();
  assert.equal(m.getTermScope({seriesNavData:{seriesId:888}},29472954),'series:888');
  assert.equal(m.getTermScope({},29472954),'novel:29472954');
  m.configure('series:888',[{from:'花子',to:'美咲'}],true);m.saveTermSettings();
  assert.equal(m.readTermSettings().rows[0].to,'美咲');
  assert.equal(m.readTermSettings().on,true);
  m.configure('novel:29472954',[],false);
  assert.deepEqual(m.readTermSettings().rows,[]);
});

test('existing TXT preview and original restore are preserved',()=>{
  assert.match(script,/drawPages\(previewTermPages\(\)\)/);
  assert.match(script,/termOn=false;saveTermSettings\(\)/);
  assert.match(script,/header\.append\(bar, meta, buildTermPanel\(\), statusNode\)/);
  assert.match(script,/const text = buildOutput\(\)/);
});

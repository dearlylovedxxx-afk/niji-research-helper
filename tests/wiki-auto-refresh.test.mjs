import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const start=script.indexOf('  function wikiEntryNeedsRefresh(');
const end=script.indexOf('  function queueResearchWiki(',start);
assert.ok(start>0&&end>start,'extract actual checked Wiki TTL and update implementation');
const operations=[];
const {wikiEntryNeedsRefresh,isFresh,wikiApplyToEntry}=new Function(
 'WIKI_CACHE_TTL','nrhDbSaveWikiInfo',
 script.slice(start,end)+
 '\nreturn {wikiEntryNeedsRefresh,isFresh:null,wikiApplyToEntry}'
)(12*60*60*1000,(id,info,sourceUrl,at)=>{operations.push({id,info,sourceUrl,at}); return Promise.resolve()});

test('previously checked on-screen videos become eligible after 12h, not stuck forever',()=>{
 const now=Date.now(),entry={id:'video123456',meta:{},wikiFetchedAt:now-12*3600_000+1,wikiChecked:true};
 assert.equal(wikiEntryNeedsRefresh(entry,now),false);
 assert.equal(wikiEntryNeedsRefresh(entry,now+1),true);
 assert.equal(wikiEntryNeedsRefresh({...entry,wikiFetchedAt:0},now),true);
 assert.equal(wikiEntryNeedsRefresh({...entry,wikiChecked:false},now),true);
 assert.equal(wikiEntryNeedsRefresh({...entry,meta:null},now),false);
});
test('new explicitly corrected Wiki row REPLACES old guests rather than permanently unioning them',()=>{
 const old={videoId:'abcdefghijk',collaborators:['叶','えま★おうがすと','旧誤登録'],sourceUrl:'old'};
 const fresh={videoId:'abcdefghijk',collaborators:['叶','不破湊'],sourceUrl:'https://wikiwiki.jp/nijisanji/小柳ロウ/動画一覧/2024'};
 const e={id:'abcdefghijk',wikiInfo:old,wikiChecked:true};
 wikiApplyToEntry(e,fresh,{fetchedAt:123456789,fetchOk:true});
 assert.deepEqual(e.wikiInfo,fresh);
 assert.deepEqual(e.wikiInfo.collaborators,['叶','不破湊']);
 assert.equal(e.wikiFetchedAt,123456789);
 assert.equal(operations.at(-1).at,123456789);
 assert.equal(operations.at(-1).info,fresh);
});
test('missing Wiki row retains last-known-good info and never destroys participants',()=>{
 const previous={collaborators:['叶'],sourceUrl:'https://wikiwiki.jp/nijisanji'};
 const e={id:'abcdefghijk',wikiInfo:previous,wikiChecked:false};
 wikiApplyToEntry(e,null,{fetchOk:true,fetchedAt:400000});
 assert.deepEqual(e.wikiInfo,previous);
 assert.equal(e.wikiFetchedAt,400000);
});
test('auto-refresh scans mounted cards on both visibility and minute timer, only when enabled',()=>{
 assert.match(script,/function refreshVisibleResearchWiki\(\)/);
 assert.match(script,/!research\.collectionActive\s*\|\|\s*wikiRequestsPaused/);
 assert.match(script,/if\(queued>=12\)break/);
 assert.match(script,/if\(!wikiEntryNeedsRefresh\(entry\)\)continue/);
 assert.match(script,/document\.addEventListener\('visibilitychange', \(\) => \{[\s\S]{0,100}refreshVisibleResearchWiki\(\)/);
 assert.match(script,/setInterval\(\(\) => \{[\s\S]{0,100}refreshVisibleResearchWiki\(\)/);
 assert.match(script,/if \(!force && !wikiEntryNeedsRefresh\(entry\)\) return/);
 assert.match(script,/wikiFetchedAt: Number\(fetchedAt\) > 0/);
 assert.match(script,/\/\/ @version\s+1\.0\.111/);
});

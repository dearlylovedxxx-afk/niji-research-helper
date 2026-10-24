import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
function codeBetween(start,end){
  const a=script.indexOf(start),b=script.indexOf(end,a+start.length);
  assert.ok(a>0&&b>a,'expected code range: '+start);
  return script.slice(a,b);
}
const textCode=codeBetween('  function youtubePriorityTextItems(', '  // Rank by number of distinct timestamps;');
const repliesCode=codeBetween(
  '  // Fetch replies ONLY for top-level comments selected',
  '  function youtubePriorityTargetSatisfied('
);
const parseClockText=token=>{
  const a=token.split(':').map(Number);
  return a.reduce((value,n)=>value*60+n,0);
};
const youtubePriorityTextItems=new Function(
  'parseClockText','YT_TS_MAX_ITEMS',textCode+'\nreturn youtubePriorityTextItems;'
)(parseClockText,180);

function harness(){
  const env={videoId:'ABCDEFGHIJK',calls:[],renders:0,overlays:0};
  const state={
    videoId:env.videoId,token:4,done:true,
    replyCache:new Map(),replyRevision:0
  };
  const selected={id:'parent-123',replyCount:4};
  const row=(id,text,parentId='parent-123')=>({
    id,snippet:{parentId,authorDisplayName:'返信者',textOriginal:text,textDisplay:text}
  });
  const api=async(path)=>{
    env.calls.push(path);
    return path.includes('pageToken=NEXT')
      ? {items:[row('reply3','2:34 続き'),row('reply4','返事だけ')]}
      : {items:[row('reply1','1:23 タイムスタンプ'),row('reply2','ありがとう')],nextPageToken:'NEXT'};
  };
  const stub=[
    'const youtubePriorityBackground=state,YT_TS_MAX_ITEMS=180;',
    'const youtubePriorityDataApi=api;',
    'const currentYoutubeVideoId=()=>env.videoId;',
    "const youtubePriorityOverlayEntries=()=>[{type:'api',snapshot:selected}];",
    'const renderYoutubePriorityComments=()=>{env.renders++};',
    'const ensureYoutubePriorityOverlay=()=>{env.overlays++};',
    'const Element=class {};',
    'const youtubeCommentBody=()=>null;',
    'const youtubeCommentAuthorInfo=()=>null;',
    'const renderYoutubePriorityApiRichText=()=>{};',
    'const renderYoutubePriorityDomRichText=()=>{};'
  ].join('\n');
  const loader=new Function(
    'env','state','selected','api','youtubePriorityTextItems',
    stub+'\n'+repliesCode+'\nreturn {queueYoutubePriorityReplyFetches,youtubePriorityReplySnapshot,youtubePriorityEntryReplies};'
  )(env,state,selected,api,youtubePriorityTextItems);
  return {env,state,selected,loader,row};
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('only replies with actual timestamp markers are displayed',()=>{
  const {loader,row}=harness();
  assert.equal(loader.youtubePriorityReplySnapshot(row('normal','ありがとう！')),null);
  const ts=loader.youtubePriorityReplySnapshot(row('ts','1:23 前半\n2:34 後半'));
  assert.deepEqual(ts.items.map(x=>x.seconds),[83,154]);
  assert.equal(ts.parentId,'parent-123');
});

test('API reply retrieval follows pages, excludes normal text, caches per parent',async()=>{
  const {env,state,loader}=harness();
  loader.queueYoutubePriorityReplyFetches('TEST-KEY',4);
  await settle();
  const cache=state.replyCache.get('parent-123');
  assert.equal(cache.status,'done');
  assert.deepEqual(cache.replies.map(x=>x.id),['reply1','reply3']);
  assert.equal(env.calls.length,2);
  assert.equal(state.replyRevision,1);
  loader.queueYoutubePriorityReplyFetches('TEST-KEY',4);
  await settle();
  assert.equal(env.calls.length,2,'must not refetch the same parent');
});

test('discard results from a previous video after navigation',async()=>{
  const {env,state,loader}=harness();
  loader.queueYoutubePriorityReplyFetches('TEST-KEY',4);
  state.token++;
  env.videoId='NEWVIDEO123';
  await settle();
  assert.equal(state.replyRevision,0);
});

test('comment panel can collapse without changing the video overlay state',()=>{
  assert.match(script,/let youtubePriorityCommentsCollapsed = false;/);
  assert.match(script,/collapse\.textContent = youtubePriorityCommentsCollapsed/);
  assert.match(script,/if \(youtubePriorityCommentsCollapsed\) return;/);
  assert.match(script,/appendYoutubePriorityReplies\(card, \{type:'api',snapshot\}\)/);
  assert.match(script,/appendYoutubePriorityReplies\(card, \{type:'dom',root\}\)/);
  assert.match(script,/appendYoutubePriorityReplies\(block, entry, true\)/);
  assert.match(script,/const replyRoots = root\.querySelectorAll\(/);
  assert.match(script,/@version\s+1\.0\.117/);
});

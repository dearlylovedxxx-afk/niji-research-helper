import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../Niji_Research_Helper.user.js',import.meta.url),'utf8');
const meta=readFileSync(new URL('../Niji_Research_Helper.meta.js',import.meta.url),'utf8');
const part=(a,b)=>{
  const from=source.indexOf(a),to=source.indexOf(b,from+a.length);
  assert.ok(from>=0&&to>from,'Cannot extract '+a);
  return source.slice(from,to);
};
const suspender=part('  function syncYoutubePriorityOverlayPanelVisibility(open) {','  function ensureYoutubePriorityOverlay(force = false) {');
const panelSync=part('  function syncYoutubePanelVisibility() {','  function updateYoutubePanel() {');
const ensure=part('  function ensureYoutubePriorityOverlay(force = false) {','  function showYoutubePriorityDiagnostic() {');
const styling=part('  function styleYoutubePriorityOverlay(root) {','  function updateYoutubePriorityOverlayActive() {');

function fakeRoot(){
  const properties=new Map(),events=[];
  const root={
    visible:true,
    matches:(selector)=>selector===':popover-open'&&root.visible,
    hidePopover(){events.push('hidePopover');root.visible=false;},
    showPopover(){events.push('showPopover');root.visible=true;},
    style:{
      setProperty:(name,value,priority)=>properties.set(name,{value,priority}),
      removeProperty:name=>properties.delete(name)
    }
  };
  return {root,properties,events};
}
function harness(root){
  let ensureCount=0;
  const state={panelSuspended:false};
  const $=selector=>selector==='#npf-yt-priority-overlay'?root:null;
  const factory=new Function('youtubePriorityOverlayUi','$','ensureYoutubePriorityOverlay','console',
    suspender+'\nreturn syncYoutubePriorityOverlayPanelVisibility;');
  const fn=factory(state,$,()=>{ensureCount++;if(root)root.showPopover();},
    {debug(){}});
  return {state,fn,get ensureCount(){return ensureCount;}};
}

test('release versions and script syntax match',()=>{
  assert.doesNotThrow(()=>new Function(source));
  assert.match(source,/@version\s+1\.0\.129/);
  assert.match(meta,/@version\s+1\.0\.129/);
  assert.match(source,/const VERSION = '1\.0\.129'/);
});

test('opening settings closes browser top-layer priority popover, not just CSS z-index',()=>{
  const {root,events,properties}=fakeRoot(),h=harness(root);
  h.fn(true);
  assert.equal(root.visible,false);
  assert.deepEqual(events,['hidePopover']);
  assert.equal(properties.get('display').value,'none');
  assert.equal(properties.get('display').priority,'important');
  assert.equal(properties.get('pointer-events').value,'none');
  assert.equal(h.state.panelSuspended,true);
  assert.equal(h.ensureCount,0);
});

test('closing settings restores existing popover without losing stored UI data',()=>{
  const {root,events,properties}=fakeRoot(),h=harness(root);
  h.fn(true);h.fn(true);h.fn(false);h.fn(false);
  assert.deepEqual(events,['hidePopover','showPopover']);
  assert.equal(h.state.panelSuspended,false);
  assert.equal(h.ensureCount,1);
  assert.equal(properties.has('display'),false);
  assert.equal(properties.has('pointer-events'),false);
});

test('closing after opening with no existing priority element safely rechecks it',()=>{
  const h=harness(null);
  h.fn(true);
  assert.equal(h.ensureCount,0);
  h.fn(false);
  assert.equal(h.ensureCount,1);
});

test('priority rescan cannot reopen popover while settings panel is open',()=>{
  const idx=ensure.indexOf('    if (youtubePriorityOverlayUi.panelSuspended)');
  const show=ensure.indexOf("    if (typeof root.showPopover === 'function')");
  assert.ok(idx>=0 && show>idx);
  assert.match(ensure,/if\(existing\.matches\?\.\(':popover-open'\)\) existing\.hidePopover\?\.\(\)/);
  assert.match(ensure,/existing\.style\.setProperty\('display','none','important'\)/);
  assert.match(styling,/if \(youtubePriorityOverlayUi\.panelSuspended\) \{/);
  assert.match(styling,/root\.style\.setProperty\('display', 'none', 'important'\)/);
});

test('mobile settings open/close transitions call priority suspension exactly by visibility',()=>{
  let suspended=[],state=false;
  const classes={toggle:(_name,value)=>state=value};
  const panel={classList:classes,style:{setProperty(){}},setAttribute(){}};
  const fab={
    aria:'false',
    getAttribute(name){return name==='aria-expanded'?this.aria:null;},
    style:{setProperty(){}}
  };
  const $=selector=>selector==='#npf-yt-panel'?panel:selector==='#npf-fab.npf-mobile-fab'?fab:null;
  const fn=new Function('$','isMobileYoutubeUi','syncYoutubePriorityOverlayPanelVisibility',
    panelSync+'\nreturn syncYoutubePanelVisibility;')($,()=>true,value=>suspended.push(value));
  fab.aria='true';fn();
  assert.equal(state,true);
  fab.aria='false';fn();
  assert.equal(state,false);
  assert.deepEqual(suspended,[true,false]);
});

test('normal desktop open/close transitions also control popover independently',()=>{
  let states=[],visible=false;
  const panel={classList:{toggle:(_cls,v)=>visible=v},style:{setProperty(){}},setAttribute(){}};
  const widget={open:false};
  const $=selector=>selector==='#npf-yt-panel'?panel:selector==='#npf-yt-widget'?widget:null;
  const fn=new Function('$','isMobileYoutubeUi','syncYoutubePriorityOverlayPanelVisibility',
    panelSync+'\nreturn syncYoutubePanelVisibility;')($,()=>false,x=>states.push(x));
  widget.open=true;fn();
  assert.equal(visible,true);
  widget.open=false;fn();
  assert.equal(visible,false);
  assert.deepEqual(states,[true,false]);
});

test('stored priority authors/positions and ordinary navigation are untouched',()=>{
  assert.doesNotMatch(suspender,/GM\.setValue|localStorage|scrollTop\s*=|width\s*=/);
  assert.match(ensure,/youtubePriorityOverlayStamp\(entries\)/);
  assert.match(source,/function scanYoutubePreferredComments\(force = false\)/);
});

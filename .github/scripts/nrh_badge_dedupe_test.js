const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('Niji_Research_Helper.user.js', 'utf8');
assert(source.includes('// @version      1.0.35'));
assert(source.includes("const NRH_DB_NAME = 'NijiResearchHelperDB';"));
assert(source.includes('const NRH_DB_VERSION = 1;'));
assert(source.includes("const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';"));
assert(source.includes('ytd-rich-item-renderer.npf-r-rich-item > .npf-research-meta'));
const start = source.indexOf('    // The desktop badge row is mounted on the OUTER rich-item');
const end = source.indexOf('    if (!meta && state.apiKey)', start);
assert(start > 0 && end > start);
const makeRow = new Function('entry', 'researchMount', 'researchTitleElement', 'document', source.slice(start, end) + '\nreturn bar;');
class Node {
  constructor(className = '') { this.className = className; this.parentElement = null; this.children = []; }
  appendChild(child) { if (child.parentElement) child.remove(); this.children.push(child); child.parentElement = this; return child; }
  remove() { if (!this.parentElement) return; const p = this.parentElement; p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; }
  querySelectorAll(selector) {
    assert([':scope > .npf-research-meta', '.npf-research-meta'].includes(selector), selector);
    if (selector.startsWith(':scope')) return this.children.filter(c => c.className === 'npf-research-meta');
    const out = [];
    const visit = n => { for (const c of n.children) { if (c.className === 'npf-research-meta') out.push(c); visit(c); } };
    visit(this); return out;
  }
  replaceChildren() { for (const n of this.children) n.parentElement = null; this.children = []; }
}
const document = {createElement: tag => { assert.equal(tag, 'div'); return new Node(); }};
const make = (entry, mount) => makeRow(entry, () => mount, () => ({}), document);
const outer = new Node();
const nested = new Node();
outer.appendChild(nested);
const entry = {el:nested};
const first = make(entry, outer);
for (let i = 0; i < 50; i++) assert.equal(make(entry, outer), first, 'rerender must reuse outer row');
assert.equal(outer.querySelectorAll(':scope > .npf-research-meta').length, 1, 'no repeated rows');
const stale1 = new Node('npf-research-meta');
const stale2 = new Node('npf-research-meta');
nested.appendChild(stale1); nested.appendChild(stale2);
make(entry, outer);
assert.equal(outer.querySelectorAll(':scope > .npf-research-meta').length, 1);
assert.equal(nested.querySelectorAll('.npf-research-meta').length, 0, 'old nested rows removed');
const mobile = new Node();
const mobileEntry = {el:mobile};
const mobileRow = make(mobileEntry, mobile);
for (let i = 0; i < 30; i++) assert.equal(make(mobileEntry, mobile), mobileRow);
assert.equal(mobile.querySelectorAll(':scope > .npf-research-meta').length, 1, 'mobile unchanged');
const second = new Node();
assert.notEqual(make({el:second}, second), first, 'different video cards have independent rows');
console.log('PASS: desktop nested renderer, 50 rerenders, duplicate cleanup, mobile rerenders, separate videos');

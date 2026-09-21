from pathlib import Path
import subprocess

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert '// @version      1.0.33' in s and "const VERSION = '1.0.33';" in s, 'Concurrent edit; refusing to replace it'
assert '// @namespace    niji-pov-helper' in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s and 'const NRH_DB_VERSION = 1;' in s
assert "const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';" in s

old_mount = '''    // Desktop tiles: mount badges on the OUTER video media card, after the
    // title/details block. Appending inside #meta/#details makes YouTube's
    // horizontal layout put the full title and badges in competing columns.
    if (!isMobileYoutubeUi() && window.matchMedia?.('(min-width:701px)').matches) {
      const grid = card.matches?.('ytd-rich-grid-media, ytd-grid-video-renderer')
        ? card : card.querySelector('ytd-rich-grid-media, ytd-grid-video-renderer');
      if (grid && (!titleEl || grid.contains(titleEl))) return grid;
    }
'''
new_mount = '''    // The rich-item renderer owns the whole tile: place annotations AFTER
    // its native video media/details block, not in that block's grid row.
    if (!isMobileYoutubeUi() && window.matchMedia?.('(min-width:701px)').matches) {
      const item = card.matches?.('ytd-rich-item-renderer')
        ? card : card.closest?.('ytd-rich-item-renderer');
      if (item && (!titleEl || item.contains(titleEl))) {
        item.classList.add('npf-r-rich-item');
        return item;
      }
      // Older desktop grids can lack the rich-item wrapper.
      const grid = card.matches?.('ytd-grid-video-renderer')
        ? card : card.querySelector('ytd-grid-video-renderer');
      if (grid && (!titleEl || grid.contains(titleEl))) return grid;
    }
'''
assert s.count(old_mount) == 1, 'Desktop mount anchor changed'
s = s.replace(old_mount, new_mount, 1)

old_bar = '''    let bar = entry.el.querySelector(':scope .npf-research-meta');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'npf-research-meta';
      const titleEl = researchTitleElement(entry.el);
      researchMount(entry.el, titleEl)?.appendChild(bar);
    }
    bar.replaceChildren();
'''
new_bar = '''    const titleEl = researchTitleElement(entry.el);
    const mount = researchMount(entry.el, titleEl);
    let bar = entry.el.querySelector(':scope .npf-research-meta');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'npf-research-meta';
    }
    // Relocate an existing bar too; never duplicate it or reset saved metadata.
    if (mount && bar.parentElement !== mount) mount.appendChild(bar);
    bar.replaceChildren();
'''
assert s.count(old_bar) == 1, 'Render anchor changed'
s = s.replace(old_bar, new_bar, 1)

css_anchor = '    .npf-r-pill { display:inline-flex; align-items:center; gap:3px; min-height:20px;'
assert s.count(css_anchor) == 1, 'CSS anchor changed'
css = '''    /* Dedicated desktop title/details row and full-width annotation row. */
    @media (min-width:701px) {
      ytd-rich-item-renderer.npf-r-rich-item {
        display:flex!important;
        flex-direction:column!important;
        align-items:stretch!important;
        min-width:0!important;
      }
      ytd-rich-item-renderer.npf-r-rich-item > :is(ytd-rich-grid-media, yt-lockup-view-model) {
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        flex:0 0 auto!important;
      }
      ytd-rich-item-renderer.npf-r-rich-item > .npf-research-meta {
        display:flex!important;
        flex-wrap:wrap!important;
        align-self:stretch!important;
        flex:0 0 auto!important;
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        box-sizing:border-box!important;
        clear:both!important;
        margin:8px 0 0!important;
        padding:8px 0 0!important;
      }
      ytd-rich-item-renderer.npf-r-rich-item :is(h3, #video-title, #video-title-link, .yt-lockup-metadata-view-model__title) {
        -webkit-line-clamp:unset!important;
        line-clamp:unset!important;
        max-height:none!important;
        white-space:normal!important;
        overflow:visible!important;
        text-overflow:clip!important;
        overflow-wrap:anywhere!important;
      }
    }
'''
s = s.replace(css_anchor, css + css_anchor, 1)
s = s.replace('// @version      1.0.33', '// @version      1.0.34', 1)
s = s.replace("const VERSION = '1.0.33';", "const VERSION = '1.0.34';", 1)
assert s.count('npf-r-rich-item') == 5, 'Unexpected rich-item references'
assert s.count('npf-research-meta') > 0
assert s.count("const NRH_DB_NAME = 'NijiResearchHelperDB';") == 1
p.write_text(s, encoding='utf-8')
subprocess.run(['node','--check',str(p)],check=True)
subprocess.run(['git','diff','--check'],check=True)

node_test = r'''
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('Niji_Research_Helper.user.js','utf8');
const start = source.indexOf('  function researchMount(card, titleEl) {');
const end = source.indexOf('  const META_MAX_ATTEMPTS',start);
assert(start > 0 && end > start);
const mount = new Function('isMobileYoutubeUi','window',source.slice(start,end)+'; return researchMount;');
const title = {};
const item = {classList:{added:new Set(),add(s){this.added.add(s)}},contains:el=>el===title};
const card = {matches:()=>false,closest:()=>item,querySelector:()=>null};
const desktop = mount(()=>false,{matchMedia:()=>({matches:true})});
assert.equal(desktop(card,title),item,'Desktop mount must be the parent of video details');
assert(item.classList.added.has('npf-r-rich-item'));
const preferred = {id:'meta'};
const mobileCard = {matches:()=>false,closest:()=>item,querySelector:()=>preferred,contains:()=>true};
const mobile = mount(()=>true,{matchMedia:()=>({matches:true})});
assert.equal(mobile(mobileCard,title),preferred,'Mobile placement must be unchanged');
assert(source.includes('if (mount && bar.parentElement !== mount) mount.appendChild(bar);'));
assert(/ytd-rich-item-renderer\.npf-r-rich-item\s*\{\s*display:flex!important;\s*flex-direction:column!important;/.test(source));
assert(source.includes('ytd-rich-item-renderer.npf-r-rich-item > .npf-research-meta'));
assert(source.includes("const NRH_DB_NAME = 'NijiResearchHelperDB';"));
console.log('PASS: desktop separate row, existing bar relocation, mobile fallback and DB compatibility');
'''
subprocess.run(['node','-e',node_test],check=True)
print('PASS: v1.0.34 syntax, regression tests and diff checks')

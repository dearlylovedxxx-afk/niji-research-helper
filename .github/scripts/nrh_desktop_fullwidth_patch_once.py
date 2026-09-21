from pathlib import Path
import subprocess

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert '// @version      1.0.33' in s and "const VERSION = '1.0.33';" in s, 'Concurrent edit; refusing to overwrite'
assert '// @namespace    niji-pov-helper' in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s and 'const NRH_DB_VERSION = 1;' in s
assert "const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';" in s
assert "if (mount && bar.parentElement !== mount) mount.appendChild(bar);" in s, 'Existing bar relocation changed'

old = '''    // Desktop tiles: mount badges on the OUTER video media card, after the
    // title/details block. Appending inside #meta/#details makes YouTube's
    // horizontal layout put the full title and badges in competing columns.
    if (!isMobileYoutubeUi() && window.matchMedia?.('(min-width:701px)').matches) {
      const grid = card.matches?.('ytd-rich-grid-media, ytd-grid-video-renderer')
        ? card : card.querySelector('ytd-rich-grid-media, ytd-grid-video-renderer');
      if (grid && (!titleEl || grid.contains(titleEl))) return grid;
    }
'''
new = '''    // Rich-item is the whole tile: append badges after its native video block.
    if (!isMobileYoutubeUi() && window.matchMedia?.('(min-width:701px)').matches) {
      const item = card.matches?.('ytd-rich-item-renderer')
        ? card : card.closest?.('ytd-rich-item-renderer');
      if (item && (!titleEl || item.contains(titleEl))) {
        item.classList.add('npf-r-rich-item');
        return item;
      }
      const grid = card.matches?.('ytd-grid-video-renderer')
        ? card : card.querySelector('ytd-grid-video-renderer');
      if (grid && (!titleEl || grid.contains(titleEl))) return grid;
    }
'''
assert s.count(old) == 1, 'Desktop mount anchor changed'
s = s.replace(old, new, 1)
needle = '    .npf-r-pill { display:inline-flex; align-items:center; gap:3px; min-height:20px;'
assert s.count(needle) == 1, 'Style anchor changed'
css = '''    /* The parent tile is a column, not a shared title/badge row. */
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
s = s.replace(needle, css + needle, 1)
s = s.replace('// @version      1.0.33', '// @version      1.0.34', 1)
s = s.replace("const VERSION = '1.0.33';", "const VERSION = '1.0.34';", 1)
assert s.count('npf-r-rich-item') == 5
assert s.count("const NRH_DB_NAME = 'NijiResearchHelperDB';") == 1
p.write_text(s, encoding='utf-8')
subprocess.run(['node','--check',str(p)],check=True)
subprocess.run(['git','diff','--check'],check=True)
node_test = r'''
const fs=require('node:fs'),assert=require('node:assert/strict');
const s=fs.readFileSync('Niji_Research_Helper.user.js','utf8');
const a=s.indexOf('  function researchMount(card, titleEl) {');
const b=s.indexOf('  const META_MAX_ATTEMPTS',a);
assert(a>0&&b>a);
const f=new Function('isMobileYoutubeUi','window',s.slice(a,b)+';return researchMount;');
const title={};const parent={classList:{added:new Set(),add(x){this.added.add(x)}},contains:x=>x===title};
const card={matches:()=>false,closest:()=>parent,querySelector:()=>null};
assert.equal(f(()=>false,{matchMedia:()=>({matches:true})})(card,title),parent);
assert(parent.classList.added.has('npf-r-rich-item'));
const meta={};const mobile={matches:()=>false,closest:()=>parent,querySelector:()=>meta,contains:()=>true};
assert.equal(f(()=>true,{matchMedia:()=>({matches:true})})(mobile,title),meta);
assert(s.includes('if (mount && bar.parentElement !== mount) mount.appendChild(bar);'));
assert(/ytd-rich-item-renderer\.npf-r-rich-item\s*\{\s*display:flex!important;\s*flex-direction:column!important;/.test(s));
assert(s.includes('ytd-rich-item-renderer.npf-r-rich-item > .npf-research-meta'));
console.log('PASS: desktop parent row, mobile fallback, existing badge and local DB');
'''
subprocess.run(['node','-e',node_test],check=True)
print('PASS: v1.0.34 patch and regression tests')

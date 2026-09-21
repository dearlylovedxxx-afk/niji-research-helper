from pathlib import Path
import subprocess

path = Path('Niji_Research_Helper.user.js')
s = path.read_text(encoding='utf-8')
assert '// @version      1.0.31' in s and "const VERSION = '1.0.31';" in s, 'Unexpected version'
assert '// @namespace    niji-pov-helper' in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert 'const NRH_DB_VERSION = 1;' in s
assert "const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';" in s
assert 'function wikiExtractJoinPeople(' in s
needle = '    .npf-r-pill { display:inline-flex; align-items:center; gap:3px; min-height:20px;'
assert s.count(needle) == 1, 'CSS insertion point changed'
css = '''    /* Desktop grid: keep native video titles above research annotations. */
    @media (min-width:701px) {
      :is(ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model)
        :is(#meta, #metadata, #video-meta, .details, .yt-lockup-metadata-view-model):has(> .npf-research-meta) {
        display:flex!important;
        flex-direction:column!important;
        align-items:stretch!important;
        min-width:0!important;
        max-width:100%!important;
      }
      :is(ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model)
        :is(#meta, #metadata, #video-meta, .details, .yt-lockup-metadata-view-model) > .npf-research-meta {
        flex:0 0 auto!important;
        align-self:stretch!important;
        width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }
      :is(ytd-rich-grid-media, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model):has(.npf-research-meta)
        :is(h3, #video-title, #video-title-link, .yt-lockup-metadata-view-model__title) {
        -webkit-line-clamp:unset!important;
        line-clamp:unset!important;
        max-height:none!important;
        overflow:visible!important;
        text-overflow:clip!important;
        white-space:normal!important;
        overflow-wrap:anywhere!important;
      }
    }
'''
s = s.replace(needle, css + needle, 1)
s = s.replace('// @version      1.0.31', '// @version      1.0.32', 1)
s = s.replace("const VERSION = '1.0.31';", "const VERSION = '1.0.32';", 1)
assert s.count('Desktop grid: keep native video titles above research annotations.') == 1
assert s.count("const NRH_DB_NAME = 'NijiResearchHelperDB';") == 1
path.write_text(s, encoding='utf-8')
subprocess.run(['node', '--check', str(path)], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
print('PASS: version 1.0.32, desktop CSS injected once, JavaScript syntax and diff checks passed')

from pathlib import Path
import subprocess

path = Path('Niji_Research_Helper.user.js')
s = path.read_text(encoding='utf-8')
assert '// @version      1.0.32' in s and "const VERSION = '1.0.32';" in s, 'Unexpected version; do not overwrite another update'
assert '// @namespace    niji-pov-helper' in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert 'const NRH_DB_VERSION = 1;' in s
assert "const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';" in s
assert 'function wikiExtractJoinPeople(' in s

old_mount = '''  function researchMount(card, titleEl) {
    const preferred = card.querySelector('#meta, #metadata, #video-meta, .details, .media-item-info, .yt-lockup-metadata-view-model');
    const nearTitle = titleEl?.parentElement?.parentElement;
    // A shallow mobile card may have its title link directly under the card:
    // never append annotations outside the card (would duplicate every scan).
    return preferred || (nearTitle && card.contains(nearTitle) ? nearTitle : null)
      || (titleEl?.parentElement && card.contains(titleEl.parentElement) ? titleEl.parentElement : card);
  }
'''
new_mount = '''  function researchMount(card, titleEl) {
    // Desktop tiles: mount badges on the OUTER video media card, after the
    // title/details block. Appending inside #meta/#details makes YouTube's
    // horizontal layout put the full title and badges in competing columns.
    if (!isMobileYoutubeUi() && window.matchMedia?.('(min-width:701px)').matches) {
      const grid = card.matches?.('ytd-rich-grid-media, ytd-grid-video-renderer')
        ? card : card.querySelector('ytd-rich-grid-media, ytd-grid-video-renderer');
      if (grid && (!titleEl || grid.contains(titleEl))) return grid;
    }
    const preferred = card.querySelector('#meta, #metadata, #video-meta, .details, .media-item-info, .yt-lockup-metadata-view-model');
    const nearTitle = titleEl?.parentElement?.parentElement;
    // A shallow mobile card may have its title link directly under the card:
    // never append annotations outside the card (would duplicate every scan).
    return preferred || (nearTitle && card.contains(nearTitle) ? nearTitle : null)
      || (titleEl?.parentElement && card.contains(titleEl.parentElement) ? titleEl.parentElement : card);
  }
'''
assert s.count(old_mount) == 1, 'Mount function changed unexpectedly'
s = s.replace(old_mount, new_mount, 1)

old_bar = '''    let bar = entry.el.querySelector(':scope .npf-research-meta');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'npf-research-meta';
      const titleEl = researchTitleElement(entry.el);
      researchMount(entry.el, titleEl)?.appendChild(bar);
    }
    bar.replaceChildren();'''
new_bar = '''    let bar = entry.el.querySelector(':scope .npf-research-meta');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'npf-research-meta';
    }
    // Also repair an existing badge bar mounted by an earlier render.
    const mount = researchMount(entry.el, researchTitleElement(entry.el));
    if (mount && bar.parentElement !== mount) mount.appendChild(bar);
    bar.replaceChildren();'''
assert s.count(old_bar) == 1, 'Render mounting point changed unexpectedly'
s = s.replace(old_bar, new_bar, 1)

start_marker = '    /* Desktop grid: keep native video titles above research annotations. */'
end_marker = '    .npf-r-pill { display:inline-flex; align-items:center; gap:3px; min-height:20px;'
assert s.count(start_marker) == 1 and s.count(end_marker) == 1, 'CSS landmarks changed unexpectedly'
start = s.index(start_marker)
end = s.index(end_marker, start)
css = '''    /* Desktop tiles: a dedicated full-width row BELOW the native title/details. */
    @media (min-width:701px) {
      ytd-rich-grid-media:has(> .npf-research-meta),
      ytd-grid-video-renderer:has(> .npf-research-meta) {
        display:block!important;
        width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }
      ytd-rich-grid-media > .npf-research-meta,
      ytd-grid-video-renderer > .npf-research-meta {
        display:flex!important;
        flex-wrap:wrap!important;
        align-items:center!important;
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        flex:0 0 100%!important;
        grid-column:1 / -1!important;
        clear:both!important;
        box-sizing:border-box!important;
        margin:8px 0 0!important;
        padding:8px 0 0!important;
      }
      ytd-rich-grid-media:has(> .npf-research-meta) #details,
      ytd-rich-grid-media:has(> .npf-research-meta) #meta,
      ytd-grid-video-renderer:has(> .npf-research-meta) #details,
      ytd-grid-video-renderer:has(> .npf-research-meta) #meta {
        width:100%!important;
        min-width:0!important;
        max-width:100%!important;
        box-sizing:border-box!important;
      }
      :is(ytd-rich-grid-media, ytd-grid-video-renderer):has(> .npf-research-meta)
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
s = s[:start] + css + s[end:]
s = s.replace('// @version      1.0.32', '// @version      1.0.33', 1)
s = s.replace("const VERSION = '1.0.32';", "const VERSION = '1.0.33';", 1)
assert s.count('Desktop tiles: a dedicated full-width row') == 1
assert s.count("const NRH_DB_NAME = 'NijiResearchHelperDB';") == 1
assert s.count("const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';") == 1
path.write_text(s, encoding='utf-8')
subprocess.run(['node', '--check', str(path)], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
print('PASS: v1.0.33, desktop grid badges moved out of title/details, syntax and diff checks passed')
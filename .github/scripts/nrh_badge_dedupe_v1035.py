from pathlib import Path
import subprocess

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert '// @version      1.0.34' in s and "const VERSION = '1.0.34';" in s, 'Unexpected upstream version; stop'
assert '// @namespace    niji-pov-helper' in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert 'const NRH_DB_VERSION = 1;' in s
assert "const KEY_WIKI_CACHE = 'npf_wiki_cache_v11';" in s
assert 'ytd-rich-item-renderer.npf-r-rich-item > .npf-research-meta' in s
old = '''    let bar = entry.el.querySelector(':scope .npf-research-meta');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'npf-research-meta';
    }
    // Also repair an existing badge bar mounted by an earlier render.
    const mount = researchMount(entry.el, researchTitleElement(entry.el));
    if (mount && bar.parentElement !== mount) mount.appendChild(bar);
    bar.replaceChildren();
'''
new = '''    // The desktop badge row is mounted on the OUTER rich-item, which can be
    // outside entry.el (e.g. when entry.el is a nested yt-lockup-view-model).
    // Search the actual mount as well as the inner card and remove leftovers
    // from older renders; repeated scans must never create another row.
    const mount = researchMount(entry.el, researchTitleElement(entry.el));
    if (!mount) return;
    const bars = [...new Set([
      ...mount.querySelectorAll(':scope > .npf-research-meta'),
      ...entry.el.querySelectorAll('.npf-research-meta'),
    ])];
    let bar = bars.find(node => node.parentElement === mount) || bars[0];
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'npf-research-meta';
    }
    for (const duplicate of bars) if (duplicate !== bar) duplicate.remove();
    if (bar.parentElement !== mount) mount.appendChild(bar);
    bar.replaceChildren();
'''
assert s.count(old) == 1, 'Render anchor changed; refusing unsafe patch'
s = s.replace(old, new, 1)
s = s.replace('// @version      1.0.34', '// @version      1.0.35', 1)
s = s.replace("const VERSION = '1.0.34';", "const VERSION = '1.0.35';", 1)
assert s.count('const bars = [...new Set([') == 1
assert s.count("const NRH_DB_NAME = 'NijiResearchHelperDB';") == 1
p.write_text(s, encoding='utf-8')
subprocess.run(['node', '--check', str(p)], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
print('PASS: v1.0.35 guarded patch, JS syntax and diff checks')

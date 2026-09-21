from pathlib import Path
p=Path('Niji_Research_Helper.user.js');s=p.read_text(encoding='utf-8')
def swap(a,b,label):
 global s
 assert s.count(a)==1,(label,s.count(a))
 s=s.replace(a,b,1)
swap('// @version      1.0.37','// @version      1.0.38','metadata')
swap("const VERSION = '1.0.37';","const VERSION = '1.0.38';",'version')
old="""    $$('a[href]').forEach(a => {
      if (a.dataset.npfSyncBound === '1') return;
      const sec = parseClockText(a.textContent || '');"""
new="""    // Bind ONLY comment2434's own timestamp column. Never bind links in the OR
    // merger's viewer, other extensions, menus, or copied result cards. Otherwise
    // the handler hijacks OR timestamps and opens the BACKGROUND page's video ID.
    $$('main .col-md-1 a[href], main .col-2 a[href]').forEach(a => {
      if (a.closest('#niji-or-root, #niji-or-trigger, #niji-or-boot-check, #npf-research-panel, #npf-yt-panel')) return;
      if (!a.closest('.col-md-1, .col-2')) return;
      if (a.dataset.npfSyncBound === '1') return;
      const sec = parseClockText(a.textContent || '');"""
swap(old,new,'timestamp scope')
p.write_text(s,encoding='utf-8')
print('PATCHED NRH v1.0.38: native comment timestamp links only, excludes OR viewer')

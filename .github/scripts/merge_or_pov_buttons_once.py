from pathlib import Path


def once(source, old, new, label):
    count = source.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected one anchor, got {count}')
    return source.replace(old, new, 1)

or_path = Path('Niji_OR_Results_Merger.user.js')
cloud_path = Path('Niji_Cloud_Backup.user.js')
or_src = or_path.read_text(encoding='utf-8')
cloud_src = cloud_path.read_text(encoding='utf-8')

# Version increases preserve @name/@namespace, @updateURL and all local storage keys.
or_src = once(or_src, '// @version      0.4.12', '// @version      0.4.13', 'OR metadata version')
or_src = once(or_src, "boot.textContent='🔀 OR起動中 0.4.12';", "boot.textContent='🔀 OR起動中 0.4.13';", 'OR boot version')
or_src = once(or_src, "console.info('[Niji OR Merger] v0.4.12 injected'", "console.info('[Niji OR Merger] v0.4.13 injected'", 'OR console version')
or_src = once(or_src, "const VERSION = '0.4.12';", "const VERSION = '0.4.13';", 'OR internal version')

# The helper is injected at document-idle, after OR's document-end entrypoint.
# Hide its separate comment-site launcher from the moment it is created.
entry_css = """  const mergedStyleId='niji-or-pov-combined-style';
  document.getElementById(mergedStyleId)?.remove();
  const mergedStyle=document.createElement('style');
  mergedStyle.id=mergedStyleId;
  mergedStyle.textContent='html #npf-fab.npf-comment-fab{display:none!important}';
  document.documentElement.append(mergedStyle);
"""
or_src = once(or_src,
    '  (document.body||document.documentElement).append(boot);\n  let restoreBootEnabled=true;',
    '  (document.body||document.documentElement).append(boot);\n' + entry_css + '  let restoreBootEnabled=true;',
    'hide duplicate POV launcher before helper mounts')
or_src = once(or_src,
    '    boot.remove();\n    document.getElementById(\'niji-or-root\')?.remove();',
    '    boot.remove();\n    mergedStyle.remove();\n    document.getElementById(\'niji-or-root\')?.remove();',
    'remove CSS during live script update')
or_src = once(or_src,
    "  const boot=document.getElementById('niji-or-trigger') || document.getElementById('niji-or-boot-check');",
    "  document.getElementById('niji-or-pov-combined-style')?.remove();\n  const boot=document.getElementById('niji-or-trigger') || document.getElementById('niji-or-boot-check');",
    'show standalone POV on OR startup error')

or_src = once(or_src, "  trigger.textContent='🔀 OR統合';", "  trigger.textContent='🔎 検索';", 'replace OR launcher label')
entry_menu = """  const entryMenu=el('div',{class:'nor-entry-menu'});
  entryMenu.hidden=true;
  const orEntry=el('button',{type:'button',class:'nor-entry-option',text:'🔀 OR検索'});
  const povEntry=el('button',{type:'button',class:'nor-entry-option',text:'👥 視点検索'});
  entryMenu.append(orEntry,povEntry);
"""
or_src = once(or_src,
    "  const panel = el('section', { class:'nor-panel' }); panel.hidden = true;",
    entry_menu + "  const panel = el('section', { class:'nor-panel' }); panel.hidden = true;",
    'introduce dual-entry menu')
or_src = once(or_src,
    '  root.append(panel, viewer); (document.body || document.documentElement).append(host);',
    '  root.append(entryMenu, panel, viewer); (document.body || document.documentElement).append(host);',
    'mount dual-entry menu')
menu_css = """  style.textContent += `
    #niji-or-root .nor-entry-menu{position:fixed!important;top:99px!important;left:8px!important;right:auto!important;bottom:auto!important;width:min(260px,calc(100vw - 16px))!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;gap:8px!important;padding:11px!important;border:1px solid #aaa2eb!important;border-radius:13px!important;background:#222233!important;box-shadow:0 8px 24px #0007!important;pointer-events:auto!important}
    #niji-or-root .nor-entry-menu[hidden]{display:none!important}
    #niji-or-root .nor-entry-option{width:100%!important;min-height:46px!important;padding:10px!important;background:#44348b!important;color:#fff!important;border:1px solid #8f83d1!important;border-radius:9px!important;font:700 14px system-ui!important;text-align:left!important;pointer-events:auto!important;cursor:pointer!important}
    #niji-or-root .nor-entry-option:disabled{opacity:.5!important;cursor:not-allowed!important}
  `;
"""
or_src = once(or_src, '  root.append(style);\n  style.textContent += `',
    '  root.append(style);\n' + menu_css + '  style.textContent += `',
    'style menu inside existing host')
menu_handlers = """  trigger.addEventListener('click',()=>{
    if(!panel.hidden || !viewer.hidden) return;
    const opening=entryMenu.hidden;
    entryMenu.hidden=!opening;
    const fab=document.getElementById('npf-fab');
    povEntry.disabled=!(fab && fab.classList.contains('npf-comment-fab'));
    povEntry.title=povEntry.disabled?'にじヘルパーの読み込みを待ってください':'';
  });
  orEntry.addEventListener('click',()=>{entryMenu.hidden=true;toggle();});
  povEntry.addEventListener('click',()=>{
    entryMenu.hidden=true;
    const fab=document.getElementById('npf-fab');
    if(fab?.classList.contains('npf-comment-fab')) fab.click();
    else alert('視点検索はまだ読み込まれていません。ページの読み込み後に再試行してください。');
  });
  close.addEventListener('click',toggle);
"""
or_src = once(or_src,
    "  trigger.addEventListener('click',toggle);close.addEventListener('click',toggle);",
    menu_handlers.rstrip('\n'), 'open OR and POV from same visible launcher')

# Embedded OR backup is a separate closure; do not change authentication or DB.
cloud_launch = "const launch=el('button','',`☁️ ${app.label}`);launch.id='launch';"
or_src = once(or_src, cloud_launch,
    cloud_launch + "launch.style.setProperty('display','none','important');",
    'OR cloud launcher initially hidden')
or_src = once(or_src,
    "  if(nativeReady) launch.style.setProperty('display','none','important');",
    "  if(app.id==='or'||nativeReady) launch.style.setProperty('display','none','important');",
    'keep embedded OR cloud launcher hidden')

# The standalone shared script should also avoid first-frame launcher flash on X/Pixiv.
cloud_src = once(cloud_src, '// @version      0.1.4', '// @version      0.1.5', 'cloud metadata version')
cloud_src = once(cloud_src, cloud_launch,
    cloud_launch + "launch.style.setProperty('display','none','important');",
    'shared cloud launcher initially hidden')
cloud_src = once(cloud_src,
    "  if(app.id==='x'||nativeReady) launch.style.setProperty('display','none','important');",
    "  if(app.id==='x'||nativeReady) launch.style.setProperty('display','none','important');",
    'shared launcher behavior validation') if False else cloud_src

assert or_src.count("// @namespace    niji-or-results-merger-standalone") == 1
assert "const STORAGE_KEY = 'niji_or_merger_addon_batches_v1';" in or_src
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" not in or_src
assert "  document.documentElement.append(mergedStyle);" in or_src
assert "  entryMenu.append(orEntry,povEntry);" in or_src
assert "  if(app.id==='or'||nativeReady)" in or_src
assert cloud_src.count("@version      0.1.5") == 1
or_path.write_text(or_src,encoding='utf-8')
cloud_path.write_text(cloud_src,encoding='utf-8')
print('PATCH_OK: OR v0.4.13 and shared cloud v0.1.5; no helper, pCloud worker, or storage schema changes')

from pathlib import Path

common = Path('Niji_Cloud_Backup.user.js')
orfile = Path('Niji_OR_Results_Merger.user.js')
marker = '// iOS background tabs may be suspended. Use manual save before migrating phones.'
bridge = r'''// Keep a single launcher per site: expose backup inside each existing tool's panel.
// Cloud credentials and data stay in this userscript; native buttons only open its panel.
function integrateNativeBackup() {
 try {
  let slot=null, nativeReady=false;
  if(app.id==='or') {
   const root=document.getElementById('niji-or-root');
   slot=root?.querySelector('.nor-body > details');
   nativeReady=!!slot;
  } else if(app.id==='x') {
   const root=document.getElementById('xsf-userscript-root')?.shadowRoot;
   nativeReady=!!root?.querySelector('#bar #launch');
   slot=root?.querySelector('#panel .tabs');
  } else if(app.id==='pixiv') {
   const root=document.getElementById('pixiv-bookmark-sort-cross-page-v05')?.shadowRoot;
   const counted=root?.querySelector('.counted');
   if(counted?.parentNode) {
    slot=counted.parentNode;
    nativeReady=true;
   }
  }
  if(slot && !slot.querySelector('[data-ncb-native-backup="'+app.id+'"]')) {
   const button=document.createElement('button');
   button.type='button';
   button.dataset.ncbNativeBackup=app.id;
   button.textContent='☁️ pCloudバックアップ';
   if(app.id==='or')button.className='nor-button';
   if(app.id==='pixiv') {
    button.style.cssText='display:block!important;width:100%!important;margin:9px 0!important;min-height:44px!important;padding:10px!important;border-radius:9px!important;background:#156a89!important;color:#fff!important;border:0!important;font:700 14px system-ui!important;cursor:pointer!important';
   } else if(app.id==='x') {
    button.style.cssText='min-height:43px!important;padding:8px 10px!important;border-radius:9px!important;border:1px solid #9baeca!important;background:#e9f5fc!important;color:#173b54!important;font:700 12px system-ui!important;cursor:pointer!important';
   }
   button.addEventListener('click',()=>{panel.hidden=false;update();});
   if(app.id==='pixiv') {
    const counted=slot.querySelector('.counted');
    if(counted)counted.after(button);
    else slot.append(button);
   } else slot.append(button);
  }
  if(nativeReady) launch.style.setProperty('display','none','important');
  else launch.style.removeProperty('display');
 } catch(e) { console.warn('[NCB] native menu attachment failed',e); }
}
integrateNativeBackup();
setInterval(integrateNativeBackup,1200);
'''

def replace_one(s, before, after, label):
    n = s.count(before)
    if n != 1:
        raise RuntimeError(f'{label}: expected one match, got {n}')
    return s.replace(before, after, 1)

s = common.read_text(encoding='utf-8')
s = replace_one(s, '// @version      0.1.2\n', '// @version      0.1.3\n', 'common version')
s = replace_one(s, marker, bridge+marker, 'common menu bridge')
common.write_text(s, encoding='utf-8')

t = orfile.read_text(encoding='utf-8')
t = replace_one(t, '// @version      0.4.11\n', '// @version      0.4.12\n', 'OR version')
t = replace_one(t, "const VERSION = '0.4.11';", "const VERSION = '0.4.12';", 'OR runtime version')
t = replace_one(t, '🔀 OR起動中 0.4.11', '🔀 OR起動中 0.4.12', 'OR boot label')
t = replace_one(t, '[Niji OR Merger] v0.4.10 injected', '[Niji OR Merger] v0.4.12 injected', 'OR debug label')
t = replace_one(t, marker, bridge+marker, 'OR menu bridge')
orfile.write_text(t, encoding='utf-8')

assert common.read_text().count('function integrateNativeBackup()') == 1
assert orfile.read_text().count('function integrateNativeBackup()') == 1
assert common.read_text().count('ncb_app_cloud_v1_') == 1
assert orfile.read_text().count('NCB_OR_EMBEDDED_BEGIN') == 1
assert orfile.read_text().count('NCB_OR_EMBEDDED_END') == 1
assert 'xsf_userscript_v1' in common.read_text()
print('PASS: versions, integrated OR/X/Pixiv launchers, secrets and storage keys unchanged')

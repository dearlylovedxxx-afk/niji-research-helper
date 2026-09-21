from pathlib import Path
p=Path('Niji_OR_Results_Merger.user.js');s=p.read_text(encoding='utf-8')
def change(a,b,name):
 global s
 assert s.count(a)==1,(name,s.count(a));s=s.replace(a,b,1)
change('// @version      0.4.7','// @version      0.4.8','metadata')
change("const VERSION = '0.4.7';", "const VERSION = '0.4.8';",'version')
change("boot.textContent='🔀 OR起動中 0.4.7';","boot.textContent='🔀 OR起動中 0.4.8';",'boot')
change("console.info('[Niji OR Merger] v0.4.7 injected'", "console.info('[Niji OR Merger] v0.4.8 injected'",'console')
old="""      const time=el('a',{class:'nor-time',href:safeUrl,target:'_blank',rel:'noopener noreferrer',text:hhmmss(c.sec)});
      time.addEventListener('click',e=>e.stopPropagation());"""
new="""      const time=el('a',{class:'nor-time',href:safeUrl,target:'_blank',rel:'noopener noreferrer',text:hhmmss(c.sec)});
      // The main Niji helper's legacy timestamp scanner binds every clock-like
      // anchor on the page and redirects it to the BACKGROUND video's POV.
      // Mark this independent OR link before it enters the document so even an
      // older helper skips it; the helper v1.0.39 also excludes this whole UI.
      time.dataset.npfSyncBound='1';
      time.dataset.norVideoId=video.id;
      time.addEventListener('click',e=>e.stopPropagation(),true);"""
change(old,new,'OR timestamp isolation')
p.write_text(s,encoding='utf-8')
print('PATCHED OR v0.4.8: timestamps resist legacy NRH hijacking')

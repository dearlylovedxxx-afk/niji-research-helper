from pathlib import Path
p=Path('Niji_Cloud_Backup.user.js')
s=p.read_text(encoding='utf-8')
old='// @version      0.1.1\n'
assert s.count(old)==1, 'Expected common script version 0.1.1'
url='https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Cloud_Backup.user.js'
new=('// @version      0.1.2\n'
     '// @updateURL    '+url+'\n'
     '// @downloadURL  '+url+'\n')
s=s.replace(old,new,1)
assert s.count('// @updateURL')==1 and s.count('// @downloadURL')==1
assert s.startswith('// ==UserScript==\n') and '// ==/UserScript==' in s
p.write_text(s,encoding='utf-8')
print('PASS: common script has stable update/download URLs and v0.1.2')

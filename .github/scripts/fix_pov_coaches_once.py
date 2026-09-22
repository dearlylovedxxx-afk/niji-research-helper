from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text(encoding='utf-8')
def one(old,new,label):
 global s
 n=s.count(old)
 assert n==1,f'{label}: expected once, found {n}'
 s=s.replace(old,new,1)
one("    function add(raw) {\n      const text=String(raw||'')",
"    function add(raw) {\n      for(const found of String(raw||'').matchAll(/@([A-Za-z0-9._-]{2,30})/g))handles.add(found[1]);\n      const text=String(raw||'')",
'capture linked and bare coach handles before stripping URLs')
needle="      const heading=/^(?:[【\\[（(]\\s*)?(?:コーチ(?:陣)?|coaches?|監督|指導者|講師)(?:[】\\]）)])?\\s*[:：]?$/i.test(line);"
replacement="      const wrapped=line.match(/^[【\\[（(]\\s*(?:コーチ(?:陣)?|coaches?|監督|指導者|講師)\\s*[】\\]）)]\\s*(.*)$/i);\n"+needle
one(needle,replacement,'bracketed coach label')
one("      if(label||heading){following=4;lines.push(line);if(label?.[1])add(label[1]);continue;}",
"      if(label||wrapped||heading){following=4;lines.push(line);if(label?.[1]||wrapped?.[1])add(label?.[1]||wrapped?.[1]);continue;}",
'accept coach name after bracket')
p.write_text(s,encoding='utf-8')
print('Coach URL handles and bracket labels covered')

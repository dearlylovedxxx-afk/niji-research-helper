from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text('utf-8')
a='''    const add = value => {
      const key = researchRosterKey(value);
      if (key && key.length >= 2 && key.length <= 100) names.add(key);
    };'''
b='''    const add = (value, canonical = false) => {
      const key = researchRosterKey(value);
      // 叶 is a current official member; one-character aliases remain excluded.
      if (key && (canonical || key.length >= 2) && key.length <= 100) names.add(key);
    };'''
assert s.count(a)==1
s=s.replace(a,b)
a2='          members.add(key); add(name);'
assert s.count(a2)==1
s=s.replace(a2,'          members.add(key); add(name, true);')
p.write_text(s,'utf-8')
print('one-character canonical member accepted; aliases remain length>=2')

from pathlib import Path
p=Path('Niji_Research_Helper.user.js');s=p.read_text(encoding='utf-8')
def replace(a,b):
 global s
 assert s.count(a)==1,(a,s.count(a));s=s.replace(a,b,1)
replace('// @version      1.0.38','// @version      1.0.39')
replace("const VERSION = '1.0.38';","const VERSION = '1.0.39';")
replace("$$('main .col-md-1 a[href], main .col-2 a[href]').forEach(a => {", "$$('.col-md-1 a[href], .col-2 a[href]').forEach(a => {")
p.write_text(s,encoding='utf-8');print('PASS scoped selector works with comment pages without main')

from pathlib import Path
p=Path('Niji_Cloud_Backup.user.js')
s=p.read_text(encoding='utf-8')
old="return {format:1,app:app.name,origin:location.origin,device:device(),exportedAt:new Date().toISOString(),payload};"
new="return {format:1,app:app.name,origin:location.origin,device:device(),payload};"
assert s.count(old)==1
s=s.replace(old,new)
assert 'exportedAt:' not in s
p.write_text(s,encoding='utf-8')
print('Removed volatile timestamp from snapshot to allow unchanged-data detection')
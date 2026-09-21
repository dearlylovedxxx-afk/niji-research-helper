from pathlib import Path
p=Path('X_Search_Favorites.user.js');s=p.read_text(encoding='utf-8')
def change(a,b):
 global s
 assert s.count(a)==1,(a[:100],s.count(a));s=s.replace(a,b,1)
change('// @version      1.1.0','// @version      1.1.1')
change("const VERSION='1.1.0', KEY=", "const VERSION='1.1.1', KEY=")
old="""for(const label of labels){const m=label.match(/(?:いいね|likes?|like)\\s*[:：]?\\s*([\\d,.]+\\s*(?:万|億|千|[KkMmBb])?)/i)||label.match(/([\\d,.]+\\s*(?:万|億|千|[KkMmBb])?)\\s*(?:件のいいね|いいね|likes?)/i);if(m)return parseLike(m[1]);}return labels.length?parseLike(labels[0]):null;"""
new="""for(const label of labels){const m=label.match(/(?:いいね|likes?|like)\\s*[:：]?\\s*([\\d,.]+\\s*(?:万|億|千|[KkMmBb])?)/i)||label.match(/([\\d,.]+\\s*(?:万|億|千|[KkMmBb])?)\\s*(?:件のいいね|いいね|likes?)/i);if(m)return parseLike(m[1]);}
// X often labels the button only as 'Like' and displays the number in a
// separate span. Read ONLY the known like button, never the whole action row.
const countText=String(btn.textContent||'').trim();
if(/^([\\d,.]+\\s*(?:万|億|千|[KkMmBb])?)$/.test(countText))return parseLike(countText);
return null;"""
change(old,new)
p.write_text(s,encoding='utf-8');print('PATCHED XSF v1.1.1: aria-label and compact button count')

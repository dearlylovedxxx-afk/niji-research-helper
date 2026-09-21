from pathlib import Path
p=Path('Niji_OR_Results_Merger.user.js')
s=p.read_text(encoding='utf-8')
assert '// @version      0.4.1' in s
s=s.replace('// @version      0.4.1','// @version      0.4.2',1)
s=s.replace("boot.textContent='🔀 OR起動中 0.4.1';","boot.textContent='🔀 OR起動中 0.4.2';",1)
s=s.replace("console.info('[Niji OR Merger] v0.4.1 injected', location.href);","console.info('[Niji OR Merger] v0.4.2 injected', location.href);",1)
s=s.replace("const VERSION = '0.4.1';","const VERSION = '0.4.2';",1)
start=s.index('  function titleFromLink(a, card, id) {')
end=s.index('  function extractComments(root, id) {',start)
replacement=r'''  function usableVideoTitle(text, id='') {
    const value=clip(text,240);
    if (!value || value===id || /^動画 [\w-]{11}$/.test(value) || /^\d+\s*(?:コメント|件|回)$/.test(value)) return '';
    if (/^(?:動画詳細|コメント|他視点|再生|検索|検索結果|チャンネル|YouTube)$/i.test(value)) return '';
    if (/^(?:\d{1,3}:)?\d{1,3}:\d{2}$/.test(value)) return '';
    return value;
  }
  function titleFromLink(a, card, id) {
    const headings=[...card.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="Title"]')];
    const others=[...card.querySelectorAll('img[alt],p,a[title]')].slice(0,30);
    const picks=[
      a.getAttribute('title'),a.getAttribute('aria-label'),
      ...headings.map(x=>x.textContent),
      ...others.map(x=>x.tagName==='IMG'?x.getAttribute('alt'):x.getAttribute('title')||x.textContent),
      card.querySelector('img[alt]')?.getAttribute('alt'),
      a.textContent,
    ];
    return picks.map(t=>usableVideoTitle(t,id)).find(Boolean) || `動画 ${id}`;
  }
'''
s=s[:start]+replacement+s[end:]
old="      if ((!e.title || e.title.startsWith('動画 ')) && !v.title.startsWith('動画 ')) e.title = v.title;"
new="      if ((!e.title || e.title.startsWith('動画 ') || /^\\d+\\s*コメント$/.test(e.title)) && usableVideoTitle(v.title,v.id)) e.title = v.title;"
assert old in s;s=s.replace(old,new,1)
anchor="  function normalizedDetailUrl(v) {"
insert=r'''  function detailedVideoTitle(fallback, id) {
    const picks=[
      ...[...document.querySelectorAll('main h1,main h2,main [class*="video-title"],main [class*="videoTitle"]')].slice(0,10).map(n=>n.textContent),
      document.querySelector('meta[property="og:title"]')?.content,
      document.title.replace(/\s*[-|｜]\s*にじさんじコメント検索.*$/,'').trim(),
    ];
    const title=picks.map(t=>usableVideoTitle(t,id)).find(t=>t && !/^(?:にじさんじコメント検索|コメント検索|キーワード検索|検索結果)/.test(t));
    return title||fallback;
  }
'''+anchor
assert anchor in s;s=s.replace(anchor,insert,1)
old="        runJob.partial.push({id:v.id,title:v.title,sourceUrl:v.sourceUrl,channel:v.channel||'',comments:[...map.values()]});"
new="        runJob.partial.push({id:v.id,title:detailedVideoTitle(v.title,v.id),sourceUrl:v.sourceUrl,channel:v.channel||'',comments:[...map.values()]});"
assert old in s;s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
print('updated titles and legacy empty-card replacement')

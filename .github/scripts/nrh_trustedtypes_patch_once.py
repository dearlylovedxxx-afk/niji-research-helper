from pathlib import Path
p = Path('Niji_Research_Helper.user.js')
s = p.read_text('utf-8')
assert s.count('// @version      1.0.25') == 1
assert s.count("const VERSION = '1.0.25';") == 1
start = s.index("  function parseNijisanjiRosterHtml(html = '') {")
end = s.index('\n  async function ensureResearchRoster()', start)
replacement = r'''  function parseNijisanjiRosterHtml(html = '') {
    // Do not pass remote HTML into DOMParser/innerHTML. YouTube on iOS may
    // require TrustedHTML and forbid creation of third-party TT policies.
    // Only extract text from the public roster's headings and profile links.
    const names = new Set();
    const members = new Set();
    let section = '', current = false;
    const plain = value => wikiDecodeEntities(String(value || '')
      .replace(/<[^>]*>/g, '')).replace(/\u00a0/g, ' ').trim();
    const add = (value, canonical = false) => {
      const key = researchRosterKey(value);
      if (key && (canonical || key.length >= 2) && key.length <= 100) names.add(key);
    };
    const blocks = String(html || '').matchAll(/<(h2|h3|h4|ul)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi);
    for (const block of blocks) {
      const tag = block[1].toLowerCase();
      const markup = block[2];
      if (tag === 'h2') {
        const label = plain(markup);
        section = label.includes('にじさんじ公式ライバー') ? 'jp'
          : label.includes('海外公式ライバー') ? 'other' : '';
        current = false;
      } else if (tag === 'h3') {
        const label = plain(markup);
        if (['other', 'en', 'virtual'].includes(section))
          section = label.includes('NIJISANJI EN') ? 'en'
            : label.includes('VirtuaReal') ? 'virtual' : 'other';
        current = false;
      } else if (tag === 'h4') {
        const label = plain(markup);
        current = (section === 'jp' || section === 'en')
          && /^メンバー/.test(label) && !/^元メンバー/.test(label);
      } else if (tag === 'ul' && current) {
        for (const item of markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)) {
          const li = item[1];
          let name = '';
          for (const a of li.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
            const hrefMatch = a[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
            const href = wikiDecodeEntities(hrefMatch?.[1] || hrefMatch?.[2] || '');
            if (href.startsWith('/nijisanji/') && !href.includes('::')) {
              name = plain(a[2]);
              break;
            }
          }
          const key = researchRosterKey(name);
          if (!key || members.has(key)) continue;
          members.add(key);
          add(name, true);
          const alias = plain(li).match(/[（(]([^）)]+)[）)]/);
          if (alias) for (const part of alias[1].split(/[\/／]/)) add(part.trim());
        }
      }
    }
    // A changed page layout must NOT mark every actual member as outside.
    if (members.size < 180 || members.size > 260
        || !names.has(researchRosterKey('小柳ロウ'))
        || !names.has(researchRosterKey('Elira Pendora')))
      throw new Error(`公式ライバー名簿の解析結果が不正（${members.size}名）`);
    return { names: [...names], members: members.size };
  }
'''
s = s[:start] + replacement + s[end:]
s = s.replace('// @version      1.0.25', '// @version      1.0.26')
s = s.replace("const VERSION = '1.0.25';", "const VERSION = '1.0.26';")
p.write_text(s, 'utf-8')
print('Patched to v1.0.26: roster parser contains no DOMParser or HTML injection sink')
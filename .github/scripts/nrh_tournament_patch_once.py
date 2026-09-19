from pathlib import Path

path = Path('Niji_Research_Helper.user.js')
s = path.read_text(encoding='utf-8')


def swap(old, new):
    global s
    n = s.count(old)
    if n != 1:
        raise RuntimeError(f'Expected exactly one anchor, got {n}: {old[:100]!r}')
    s = s.replace(old, new, 1)


swap('// @version      1.0.26', '// @version      1.0.27')
swap("  const VERSION = '1.0.26';", "  const VERSION = '1.0.27';")
swap("  const RESEARCH_TAGS = ['FPS', 'スト鯖', 'ソロゲー', 'コラボ', '雑談', '歌'];",
     "  const RESEARCH_TAGS = ['FPS', 'スト鯖', '大会', 'ソロゲー', 'コラボ', '雑談', '歌'];")

# A tournament is an event/type of stream, independent of its game title.
# Scrims and explicit competition-associated practice/review streams are included.
# Generic practice, ranked matches and generic GTA/Rust play are not tournaments.
tournament = r'''  // ゲームタイトルとは独立した大会関連分類。スクリムや大会の練習・振り返りも含める。
  function isTournamentRelated(title = '') {
    const t = normalizeResearchText(title).normalize('NFKC');
    if (/(?:大会|選手権|トーナメント|スクリム|scrim|対抗戦|予選|準決勝|決勝|本戦|決定戦)/i.test(t)) return true;
    // 大会名をタイトルに書き、配信自体は「顔合わせ」「練習」「振り返り」のケース。
    return /(?:v最(?:協|強)?|v\s*saikyo|にじ(?:さんじ)?甲(?:子園)?|にじさんじ(?:マリカ|麻雀|スプラ|歌謡)杯|(?:cr|crazy\s*raccoon)\s*(?:cup|カップ)|(?:えぺ|エペ|apex)まつり|\bvcc\b|\bv\s*cc\b)/i.test(t);
  }

'''
swap('  function researchMentionList(meta) {', tournament + '  function researchMentionList(meta) {')
swap("    if (isStreamServerSession(game, title)) tags.push('スト鯖');\n",
     "    if (isStreamServerSession(game, title)) tags.push('スト鯖');\n    if (isTournamentRelated(title)) tags.push('大会');\n")

# Holodex / Wiki can contain the full event title when mobile YouTube displays a
# shortened or differently formatted title. Do not classify from arbitrary card
# text because it includes previously rendered labels and would self-contaminate.
swap('    const baseCategories = researchCategories(entry.title, meta, entry.game);',
     "    const categoryTitle = [entry.title, meta?.title, wiki?.wikiTitle].filter(Boolean).join(' ');\n    const baseCategories = researchCategories(categoryTitle, meta, entry.game);")
path.write_text(s, encoding='utf-8')
print('Prepared v1.0.27: streamer metadata title fallback and tournament classification')

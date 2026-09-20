from pathlib import Path
import subprocess

path = Path('Niji_Research_Helper.user.js')
s = path.read_text(encoding='utf-8')
assert '// @version      1.0.30' in s and "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert "const NRH_DB_VERSION = 1;" in s and "// @namespace    niji-pov-helper" in s


def replace(old, new):
    global s
    n = s.count(old)
    if n != 1:
        raise AssertionError(f'Expected exactly one patch anchor; found {n}: {old[:95]!r}')
    s = s.replace(old, new, 1)

helper = r'''  // Wiki free-text: "1:03:10~からAがVC合流、1:28:00~からB、2:15:30~からCが合流".
  // A timestamp + an explicit participation word in the SAME note are required;
  // never infer participants from ordinary timestamps, titles or interviews.
  function wikiExtractJoinPeople(line = '') {
    const text = String(line || '').replace(/[\u00a0\u3000]/g, ' ').trim();
    if (!/(?:VC|ボイチャ|通話|合流|途中参加)/i.test(text)) return [];
    const stamp = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[~～〜]\s*から\s*/g;
    const hits = [...text.matchAll(stamp)];
    const out = [];
    for (let i = 0; i < hits.length; i++) {
      const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
      let segment = text.slice(hits[i].index + hits[i][0].length, end)
        .replace(/^[、，,・･\s]+|[、，,。．.!！\s]+$/g, '')
        .replace(/(?:が|と|も)?\s*(?:VC|ボイチャ|通話)?\s*(?:に)?(?:合流|途中参加)(?:した|する|予定)?\s*$/i, '')
        .replace(/[、，,。．.!！\s]+$/g, '').trim();
      // Only a short name / comma-separated names are supported. Do not turn
      // arbitrary prose, notes or the channel owner into collaborators.
      if (!segment || segment.length > 65 || /(?:https?:|[：:]|配信|コメント|時間|から|まで|実況|解説|インタビュー|不参加|なし)/i.test(segment)) continue;
      for (const raw of segment.split(/[、，,]/)) {
        const name = wikiCleanPersonName(raw).trim();
        if (!name || name.length > 32 || /[。.!！?？()（）]/.test(name)) continue;
        if (!out.some(p => p.name === name)) out.push({name, at: hits[i][1]});
      }
    }
    return out;
  }

'''
replace("  function wikiParsePage(html = '', sourceUrl = '') {", helper + "  function wikiParsePage(html = '', sourceUrl = '') {")
replace("      const collaboratorLabels = [];\n      const notes = [];\n      let hasCollabNote = false;", "      const collaboratorLabels = [];\n      const collaboratorJoinTimes = {};\n      const notes = [];\n      let hasCollabNote = false;")
replace("        const line = lines[li];\n        // 行頭固定にしない。", "        const line = lines[li];\n        for (const {name, at} of wikiExtractJoinPeople(line)) {\n          collaborators.push(name);\n          collaboratorJoinTimes[name] ||= at;\n          hasCollabNote = true;\n        }\n        // 行頭固定にしない。")
replace("        videoId: a.id, wikiTitle: a.title, collaborators: [], collaboratorLabels: [], notes: [], hasCollabNote: false, sourceUrl", "        videoId: a.id, wikiTitle: a.title, collaborators: [], collaboratorLabels: [], collaboratorJoinTimes: {}, notes: [], hasCollabNote: false, sourceUrl")
replace("      info.collaboratorLabels = [...new Set([...(info.collaboratorLabels || []), ...collaboratorLabels])];\n      info.notes", "      info.collaboratorLabels = [...new Set([...(info.collaboratorLabels || []), ...collaboratorLabels])];\n      info.collaboratorJoinTimes = {...(info.collaboratorJoinTimes || {}), ...collaboratorJoinTimes};\n      info.notes")
replace("          collaboratorLabels: [],\n          notes: [],\n          hasCollabNote: false,", "          collaboratorLabels: [],\n          collaboratorJoinTimes: {},\n          notes: [],\n          hasCollabNote: false,")
replace("      const fields = wikiExtractPeopleFields(plain);", "      for (const {name, at} of wikiExtractJoinPeople(plain)) {\n        info.hasCollabNote = true;\n        info.collaborators.push(name);\n        info.collaboratorJoinTimes[name] ||= at;\n      }\n      const fields = wikiExtractPeopleFields(plain);")
replace("videoId: id, wikiTitle: '', wikiDate: '', wikiYear: null, collaborators: [], collaboratorLabels: [], notes: [], hasCollabNote: false, sourceUrl: e?.sourceUrl || ''", "videoId: id, wikiTitle: '', wikiDate: '', wikiYear: null, collaborators: [], collaboratorLabels: [], collaboratorJoinTimes: {}, notes: [], hasCollabNote: false, sourceUrl: e?.sourceUrl || ''")
replace("      cur.collaboratorLabels = [...new Set([...(cur.collaboratorLabels || []), ...(e?.collaboratorLabels || [])])];\n      cur.notes", "      cur.collaboratorLabels = [...new Set([...(cur.collaboratorLabels || []), ...(e?.collaboratorLabels || [])])];\n      cur.collaboratorJoinTimes = {...(cur.collaboratorJoinTimes || {}), ...(e?.collaboratorJoinTimes || {})};\n      cur.notes")
replace("    entry.wikiInfo = info || entry.wikiInfo || null;", "    // A successful refresh adds new participants without discarding saved ones.\n    entry.wikiInfo = info && entry.wikiInfo\n      ? wikiMergeEntries({[entry.id]: entry.wikiInfo}, {[entry.id]: info})[entry.id]\n      : (info || entry.wikiInfo || null);")
replace("        b.textContent = `🤝 ${person}`;", "        const joinedAt = wiki?.collaboratorJoinTimes?.[person];\n        b.textContent = `🤝 ${person}${joinedAt ? ` (${joinedAt}〜)` : ''}`;")
replace("// @version      1.0.30", "// @version      1.0.31")
replace("const VERSION = '1.0.30';", "const VERSION = '1.0.31';")
assert "const NRH_DB_VERSION = 1;" in s and "// @namespace    niji-pov-helper" in s
path.write_text(s, encoding='utf-8')
subprocess.run(['node', '--check', str(path)], check=True)
print('PATCH_OK v1.0.31; preserved existing DB and namespace; JS syntax valid')

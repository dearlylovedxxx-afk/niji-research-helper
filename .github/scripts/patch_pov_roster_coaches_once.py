from pathlib import Path
p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert '// @version      1.0.45' in s and "const VERSION = '1.0.45';" in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s

def replace(old, new, label):
    global s
    count = s.count(old)
    assert count == 1, f'{label}: expected exactly one anchor, got {count}'
    s = s.replace(old, new, 1)

replace('// @version      1.0.45', '// @version      1.0.46', 'header version')
replace("const VERSION = '1.0.45';", "const VERSION = '1.0.46';", 'runtime version')

start = s.index('  function povAutomaticClues(source) {')
end = s.index('  function povCoachClues(source) {', start)
auto = s[start:end]
old = "      if(name.length<2||name.length>38||excluded.test(name)||/^(?:https?|www|UC[A-Za-z0-9_-]{22}|@)/i.test(name)||/[<>]/.test(name))return;"
new = "      // Team rosters often say 'ツルギくん、せつなさん、YASコーチ'.\n      // A coach is searched separately and honorifics are not part of a channel name.\n      if(/(?:コーチ|coach|監督|指導者|講師)\\s*$/i.test(name))return;\n      name=name.replace(/(?:くん|ちゃん|さん|様)\\s*$/,'').trim();\n      if(name.length<2||name.length>38||excluded.test(name)||/^(?:https?|www|UC[A-Za-z0-9_-]{22}|@)/i.test(name)||/[<>]/.test(name))return;"
assert auto.count(old) == 1, 'participant addName anchor'
auto = auto.replace(old, new, 1)
old = '(?:参加者|参加メンバー|出演者|出演|ゲスト|コラボ相手|一緒に遊ぶ人|メンバー|with|w\\/)'
new = '(?:参加者|参加メンバー|出演者|出演|ゲスト|コラボ相手|一緒に遊ぶ人|チーム(?:メンバー)?|メンバー|with|w\\/)'
assert auto.count(old) == 1, 'participant roster label anchor'
auto = auto.replace(old, new, 1)
s = s[:start] + auto + s[end:]

start = s.index('  function povCoachClues(source) {')
end = s.index('  function povNameMatches(', start)
coach = s[start:end]
old = "    let following=0;\n    for(const raw of text.split(/\\r?\\n/).slice(0,240)){"
new = r'''    // Coaches may be inline with a team roster rather than under a coach heading:
    // チーム\nレオス、ツルギくん、せつなさん、YASコーチ
    function addRosterCoaches(raw) {
      let found=false;
      const text=String(raw||'').replace(/(?:https?:\/\/|www\.)\S+/gi,'');
      for(const part of text.split(/[、,，／/|｜&＆]+/)){
        const token=part.replace(/^[-*・●★☆\d.)．\s]+/,'')
          .replace(/^(?:チーム(?:メンバー)?|参加者|メンバー|出演者|ゲスト)\s*[:：]?\s*/,'').trim();
        const match=token.match(/^(.{2,38}?)\s*(?:コーチ|coaches?|監督|指導者|講師)\s*(?:[（(][^）)]*[）)])?\s*$/i);
        if(!match)continue;
        add(match[1]);found=true;
      }
      // Keep the original roster line to retain adjacent coach channel links.
      if(found)lines.push(String(raw||'').trim());
      return found;
    }
    let following=0,rosterFollowing=0;
    for(const raw of text.split(/\r?\n/).slice(0,240)){'''
assert coach.count(old) == 1, 'coach roster helper anchor'
coach = coach.replace(old, new, 1)
old = "      if(!line){following=0;continue;}\n      const label=line.match("
new = r'''      if(!line){following=0;rosterFollowing=0;continue;}
      const rosterLabel=line.match(/^(?:[【\[（(]\s*)?(?:チーム(?:メンバー)?|参加者|参加メンバー|メンバー|出演者|ゲスト)(?:[】\]）)])?\s*(?:[:：\-－]\s*|\s+)(.*)$/i);
      const rosterHeading=/^(?:[【\[（(]\s*)?(?:チーム(?:メンバー)?|参加者|参加メンバー|メンバー|出演者|ゲスト)(?:[】\]）)])?\s*[:：]?$/i.test(line);
      if(rosterLabel||rosterHeading){
        following=0;rosterFollowing=4;
        if(rosterLabel?.[1])addRosterCoaches(rosterLabel[1]);
        continue;
      }
      if(rosterFollowing>0){
        if(/^(?:[【\[（(]?\s*(?:配信|ゲーム|お知らせ|注意事項|概要|ハッシュタグ|タグ|スポンサー|主催|コーチ|監督)|#{2,}|[-=]{3,})/i.test(line))rosterFollowing=0;
        else {addRosterCoaches(line);rosterFollowing--;}
      }
      // Standalone role-suffixed names are explicit too; ordinary prose is not.
      if(/^[^、,，／/|｜&＆\s:：]{2,38}\s*(?:コーチ|coaches?|監督|指導者|講師)\s*$/i.test(line))addRosterCoaches(line);
      const label=line.match('''
assert coach.count(old) == 1, 'coach roster scanning anchor'
coach = coach.replace(old, new, 1)
s = s[:start] + coach + s[end:]

old = "          await boundedSearch({q},'概要欄のコーチ名から自動検索',{person,event,role:'coach'});"
new = "          const before=seen.size;\n          await boundedSearch({q},'概要欄のコーチ名から自動検索',{person,event,role:'coach'});\n          // A coach's archive may omit the event name entirely.\n          if(seen.size===before&&event&&searches<8)\n            await boundedSearch({q:person},'コーチ名で再検索',{person,event,role:'coach'});"
replace(old, new, 'coach name-only fallback')
assert "const NRH_DB_VERSION = 1;" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s
p.write_text(s, encoding='utf-8')
print('Applied roster/coach extraction and coach name fallback v1.0.46; DB/cloud unchanged')

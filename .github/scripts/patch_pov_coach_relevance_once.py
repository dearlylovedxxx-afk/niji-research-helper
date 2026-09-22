from pathlib import Path

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert '// @version      1.0.46' in s and "const VERSION = '1.0.46';" in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s

def replace(old, new, label):
    global s
    count = s.count(old)
    assert count == 1, f'{label}: expected one match, got {count}'
    s = s.replace(old, new, 1)

replace('// @version      1.0.46','// @version      1.0.47','metadata version')
replace("const VERSION = '1.0.46';","const VERSION = '1.0.47';",'runtime version')
replace('''      if(!match||match.overlap<180){
        const event=clue?.event||'';
        const srcGame=researchGameFromText(source.title||'',source.topic_id||'');
        const candGame=researchGameFromText(v.title||'',v.topic_id||'');
        const sameGame=!!(srcGame&&candGame&&normalizeResearchText(srcGame)===normalizeResearchText(candGame));
        const near=!!(startOf(source)&&Math.abs(+cs-+startOf(source))<=36*3600000);
        // Coach recaps need not overlap live, but must have an explicitly
        // identified coach AND event/game evidence near the original stream.
        if(isCoach&&(coachNamed||coachLinked)&&near&&(sameGame||(event&&povEventMatches(v,event)))){
          seen.set(id,{video:v,match:null,reason:'🎓 コーチの関連配信（時間重複なし・要確認）',direct:false,coach:true});
          return;
        }
        return reject();
      }
''', '''      // This panel is for simultaneous POVs. Searching for a coach's archives
      // is useful, but a NON-overlapping archive must not appear in its results.
      // Preserve overlapping coach streams (including the YasTube Fuwa match).
      if(!match||match.overlap<180)return reject();
''', 'hide non-overlapping coach archives, preserve overlapping ones')
replace("    help.textContent='概要欄の参加者名・コーチ／監督名・企画名を自動抽出し、選手の他視点だけでなくコーチの配信・振り返りも探します。時間が重ならない関連配信は同期対象にしません。YouTube APIキーは初回だけ入力し、この端末に保存します（pCloud対象外）。';",
        "    help.textContent='概要欄の参加者・コーチ／監督・企画名を自動抽出し、元配信と同時刻の選手・コーチ配信を探します。時間の重ならない動画はこの他視点一覧に表示しません。YouTube APIキーは初回だけ入力し、この端末に保存します（pCloud対象外）。';",'clarify displayed candidates')
assert "if(!match||match.overlap<180)return reject();" in s
assert "🎓 コーチの関連配信（時間重複なし・要確認）" not in s
assert "if(isCoach&&!direct&&!coachEvidence?.teamRelated)" not in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s
p.write_text(s,encoding='utf-8')
print('v1.0.47: exclude non-overlapping videos; leave overlapping coach filter untouched; DB/cloud schema unchanged')
from pathlib import Path

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert '// @version      1.0.46' in s and "const VERSION = '1.0.46';" in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s

def replace(old, new, label):
    global s
    count=s.count(old)
    assert count == 1, f'{label}: expected one match; got {count}'
    s=s.replace(old,new,1)

replace('// @version      1.0.46','// @version      1.0.47','metadata version')
replace("const VERSION = '1.0.46';","const VERSION = '1.0.47';",'runtime version')
anchor='  function povYoutubeDuration(s) {'
helper='''  // A coach may broadcast unrelated matches in the same game on the same day.
  // The coach's identity, game and timestamp alone never establish this team's POV.
  function povCoachTeamEvidence(source,video,rosterNames,events) {
    const normalized=value=>String(value||'').normalize('NFKC').toLowerCase()
      .replace(/[\\s\\u3000・_\\-‐—|｜【】\\[\\]()（）#]/g,'');
    const title=normalized(video?.title||'');
    const rosterInTitle=(rosterNames||[]).some(person=>{
      const name=normalized(person);
      return name.length>=3&&title.includes(name);
    });
    // An explicit link to the *source video* in the coach's description is
    // stronger than a general game or tournament hashtag.
    const sourceLinked=/^[A-Za-z0-9_-]{11}$/.test(String(source?.id||''))&&
      String(video?.description||'').includes(source.id);
    const sameEvent=(events||[]).some(event=>{
      const name=normalized(event);
      return name.length>=5&&!/^(?:v最|vcr|スト鯖|スト6|sf6|streetfighter6|apex|valorant)$/i.test(name)
        &&povEventMatches(video,event);
    });
    return {teamRelated:rosterInTitle||sourceLinked,sameEvent,sourceLinked};
  }

'''
replace(anchor,helper+anchor,'coach evidence helper')
replace('    let trustedChannelIds=new Set(),trustedCoachIds=new Set(),rejected=0,duplicateCount=0,checked=0,unresolved=0;',
        '    let trustedChannelIds=new Set(),trustedCoachIds=new Set(),coachRosterNames=[],coachEventNames=[],rejected=0,duplicateCount=0,checked=0,unresolved=0;', 'roster evidence state')
old='''      const coachLinked=trustedCoachIds.has(channelId(v));
      if(!match||match.overlap<180){
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
'''
new='''      const coachLinked=trustedCoachIds.has(channelId(v));
      const coachEvidence=isCoach?povCoachTeamEvidence(source,v,coachRosterNames,coachEventNames):null;
      // Non-overlapping coach recaps are only shown with *both* same-team and
      // specific-event evidence (or an explicit link back to this very video).
      // Merely being YAS's SF6 stream within 36 hours caused the false positives.
      if(!match||match.overlap<180){
        const near=!!(startOf(source)&&Math.abs(+cs-+startOf(source))<=36*3600000);
        if(isCoach&&(coachNamed||coachLinked)&&near&&coachEvidence?.teamRelated&&
           (coachEvidence.sameEvent||coachEvidence.sourceLinked)){
          seen.set(id,{video:v,match:null,reason:'🎓 同チーム・同企画のコーチ配信（時間重複なし／同期対象外）',direct:false,coach:true});
          return;
        }
        return reject();
      }
      // Even an overlapping stream from the correct coach can be for ANOTHER
      // team. The original team's name or original-video link is mandatory.
      if(isCoach&&!direct&&!coachEvidence?.teamRelated)return reject();
'''
replace(old,new,'reject unrelated coach streams')
replace("    help.textContent='概要欄の参加者名・コーチ／監督名・企画名を自動抽出し、選手の他視点だけでなくコーチの配信・振り返りも探します。時間が重ならない関連配信は同期対象にしません。YouTube APIキーは初回だけ入力し、この端末に保存します（pCloud対象外）。';",
        "    help.textContent='概要欄の参加者・コーチ・企画名を自動抽出。同じコーチの別チーム配信を混ぜないよう、元チーム名や元動画へのリンクで関連を確認します。時間が重ならない振り返りは、同チームと企画の根拠がある場合のみ表示・同期対象外。APIキーはこの端末に保存します（pCloud対象外）。';",'help accuracy')
replace('''        const coach=povCoachClues(enriched);
        const coachLinks=povDescriptionClues({...enriched,description:coach.description,mentions:[]});''',
'''        const coach=povCoachClues(enriched);
        // Only names explicitly in the ORIGINAL description; Holodex mentions
        // can name people from a different team in the same tournament.
        coachRosterNames=povAutomaticClues({...enriched,mentions:[]}).names
          .filter(name=>!coach.names.some(c=>normalizeResearchText(c)===normalizeResearchText(name)));
        coachEventNames=auto.events.slice();
        const coachLinks=povDescriptionClues({...enriched,description:coach.description,mentions:[]});''', 'pass same-team data')
assert '// @version      1.0.47' in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s
assert 'if(q)await ytSearch(' not in s
p.write_text(s,encoding='utf-8')
print('Coach event and SAME-TEAM evidence patch applied v1.0.47; data and backup schema unchanged')
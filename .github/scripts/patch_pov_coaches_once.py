from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text(encoding='utf-8')
assert '// @version      1.0.44' in s and "const VERSION = '1.0.44';" in s
assert "const NRH_DB_NAME = 'NijiResearchHelperDB';" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s

def one(old,new,tag):
 global s
 n=s.count(old)
 assert n==1,f'{tag}: expected once; found {n}'
 s=s.replace(old,new,1)

one('// @version      1.0.44','// @version      1.0.45','metadata')
one("const VERSION = '1.0.44';","const VERSION = '1.0.45';",'runtime')
helper=r'''
  // Only explicitly labelled coaches: a generic mention of a streamer is not
  // proof that they coached this event. Preserve URLs to resolve their channels.
  function povCoachClues(source) {
    const text=String(source?.description||'').slice(0,18000);
    const names=new Set(),handles=new Set(),lines=[];
    const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\u3000・_-]/g,'');
    const own=normalize(channelName(source));
    function add(raw) {
      const text=String(raw||'').replace(/(?:https?:\/\/|www\.)\S+/gi,'').replace(/\[[^\]]*\]\([^)]*\)/g,'');
      for(const part of text.split(/[、,，／/|｜&＆]+/)){
        const handle=part.match(/@([A-Za-z0-9._-]{2,30})/);
        if(handle)handles.add(handle[1]);
        const name=part.replace(/@[A-Za-z0-9._-]+/g,'').replace(/[（(](?:コーチ|coach|監督|講師)[）)]/gi,'')
          .replace(/^[\s\-・●★☆]+|[\s:：;；]+$/g,'').replace(/(?:さん|様)$/,'').trim();
        if(name.length>=2&&name.length<=38&&!/^(?:コーチ|coach|監督|講師|先生|参加者|リンク|なし|未定)$/i.test(name)
          &&normalize(name)!==own&&!/^UC[A-Za-z0-9_-]{22}$/.test(name))names.add(name);
      }
    }
    let following=0;
    for(const raw of text.split(/\r?\n/).slice(0,240)){
      const line=raw.trim();
      if(!line){following=0;continue;}
      const label=line.match(/^(?:[【\[（(]\s*)?(?:コーチ(?:陣)?|coaches?|監督|指導者|講師)(?:[】\]）)])?\s*(?:[:：\-－]\s*|\s+)(.*)$/i);
      const heading=/^(?:[【\[（(]\s*)?(?:コーチ(?:陣)?|coaches?|監督|指導者|講師)(?:[】\]）)])?\s*[:：]?$/i.test(line);
      if(label||heading){following=4;lines.push(line);if(label?.[1])add(label[1]);continue;}
      if(!following)continue;
      if(/^(?:[【\[（(]?\s*(?:参加者|メンバー|出演者|ゲスト|配信|お知らせ|注意事項|概要|ハッシュタグ|タグ|スポンサー|主催)|#{2,}|[-=]{3,})/i.test(line)){
        following=0;continue;
      }
      lines.push(line);add(line.replace(/^[-*・●★☆]\s*/,'').replace(/^\d+[.)．]\s*/,''));
      following--;
    }
    return {names:[...names].slice(0,6),handles:[...handles].slice(0,6),description:lines.join('\n')};
  }

'''
one('  function povNameMatches(channel,person) {',helper+'  function povNameMatches(channel,person) {','insert coach extraction')
one("    help.textContent='概要欄の参加者名・@ハンドル・企画名を自動抽出し、YouTubeから同時期のライブアーカイブを追加検索します。関連の根拠が弱いものは「要確認」と表示。YouTube APIキーは初回入力後、この端末のスクリプト設定に保存します（pCloudバックアップ対象外）。';",
"    help.textContent='概要欄の参加者名・コーチ／監督名・企画名を自動抽出し、選手の他視点だけでなくコーチの配信・振り返りも探します。時間が重ならない関連配信は同期対象にしません。YouTube APIキーは初回だけ入力し、この端末に保存します（pCloud対象外）。';",'help')
one('    let trustedChannelIds=new Set(),rejected=0,duplicateCount=0,checked=0,unresolved=0;',
'    let trustedChannelIds=new Set(),trustedCoachIds=new Set(),rejected=0,duplicateCount=0,checked=0,unresolved=0;', 'coach channels state')
one("        const info=document.createElement('div');info.textContent=channelName(v)+' ／ '+row.reason+(match?' ／ 同時刻の重なり '+fmtDuration(match.overlap):' ／ 配信日時を確認できません');",
"        const info=document.createElement('div');info.textContent=channelName(v)+' ／ '+row.reason+(match?' ／ 同時刻の重なり '+fmtDuration(match.overlap):row.coach?' ／ 同時刻ではないため同期対象外':' ／ 配信日時を確認できません');",'related display')
one('      const match=buildMatches(source,[v],syncOffset)[0]||null;\n      if(!match||match.overlap<180)return reject();',
'''      const match=buildMatches(source,[v],syncOffset)[0]||null;
      const isCoach=clue?.role==='coach'||trustedCoachIds.has(channelId(v));
      const coachNamed=isCoach&&!!clue?.person&&povNameMatches(channelName(v),clue.person);
      const coachLinked=trustedCoachIds.has(channelId(v));
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
      }''','allow nonoverlap coach recap')
one('      if(!direct&&!trusted&&!named&&!eventLead)return reject();\n      const evidence=direct?\'概要欄の直接リンク\':trusted?\'概要欄の参加者チャンネル\':named?\'概要欄の参加者名とチャンネル名一致\':\'企画名＋同ゲーム・同時間帯\';\n      seen.set(id,{video:v,match,reason:evidence+\'（他視点か要確認）\',direct});',
"      if(!direct&&!trusted&&!named&&!eventLead&&!coachNamed&&!coachLinked)return reject();\n      const evidence=isCoach&&(coachNamed||coachLinked)?'🎓 コーチの配信':direct?'概要欄の直接リンク':trusted?'概要欄の参加者チャンネル':named?'概要欄の参加者名とチャンネル名一致':'企画名＋同ゲーム・同時間帯';\n      seen.set(id,{video:v,match,reason:evidence+'（関連は要確認）',direct,coach:isCoach});",'coach evidence')
one('        const auto=povAutomaticClues(enriched);\n        const ids=new Set(clues.channelIds),handles=new Set(clues.handles);',
'''        const auto=povAutomaticClues(enriched);
        const coach=povCoachClues(enriched);
        const coachLinks=povDescriptionClues({...enriched,description:coach.description,mentions:[]});
        const ids=new Set([...clues.channelIds,...coachLinks.channelIds]);
        const handles=new Set([...clues.handles,...coach.handles,...coachLinks.handles]);
        trustedCoachIds=new Set(coachLinks.channelIds);''', 'coach clue integration')
one('            if(/^UC[A-Za-z0-9_-]{22}$/.test(id))ids.add(id);else unresolved++;',
"            if(/^UC[A-Za-z0-9_-]{22}$/.test(id)){ids.add(id);if(coach.handles.includes(handle)||coachLinks.handles.includes(handle))trustedCoachIds.add(id);}else unresolved++;",'coach handle resolution')
one("        notice.textContent='参加者名：'+(auto.names.join('、')||'未記載')+' ／ 企画名：'+(auto.events.join('、')||'未記載')+'。関連アーカイブを照合中…';",
"        notice.textContent='参加者：'+(auto.names.join('、')||'未記載')+' ／ コーチ：'+(coach.names.join('、')||'未記載')+' ／ 企画名：'+(auto.events.join('、')||'未記載')+'。関連アーカイブを照合中…';",'status coach names')
one("            for(const v of await apiGet('/videos?'+p))remember(v,'概要欄の参加者チャンネル');",
"            for(const v of await apiGet('/videos?'+p))remember(v,'概要欄のチャンネル',false,{role:trustedCoachIds.has(ch)?'coach':'participant',event:auto.events[0]||''});",'Holodex coach channel')
one('          if(searches>=6)return;','          if(searches>=8)return;','search max')
one("        for(const ch of [...trustedChannelIds].slice(0,3))\n          await boundedSearch({channelId:ch},'参加者のチャンネル','');\n        const event=auto.events[0]||'';",
"        const event=auto.events[0]||'';\n        for(const ch of [...trustedChannelIds].slice(0,3))\n          await boundedSearch({channelId:ch},trustedCoachIds.has(ch)?'コーチのチャンネル':'参加者のチャンネル',{role:trustedCoachIds.has(ch)?'coach':'participant',event});\n        // Reserve up to two named searches for explicitly labelled coaches,\n        // including streamers absent from Holodex or without channel links.\n        for(const person of coach.names.slice(0,2)){\n          if(searches>=8)break;\n          const q=[person,event||source.topic_id||''].filter(Boolean).join(' ');\n          await boundedSearch({q},'概要欄のコーチ名から自動検索',{person,event,role:'coach'});\n        }",'coach search priority')
one('if(searches>=6)break;','if(searches>=8)break;','participant search max')
one('if(seen.size===before&&event&&searches<6)','if(seen.size===before&&event&&searches<8)','fallback max')
one('if(event&&searches<6){','if(event&&searches<8){','event max')
one("          '概要欄の参加者 '+auto.names.length+'人、企画名 '+auto.events.length+'件、参加者チャンネル '+trustedChannelIds.size+'件。'+",
"          '概要欄の参加者 '+auto.names.length+'人、コーチ '+coach.names.length+'人、企画名 '+auto.events.length+'件、関連チャンネル '+trustedChannelIds.size+'件。'+",'summary coach count')
assert '// @version      1.0.45' in s and "const NRH_DB_VERSION = 1;" in s
assert "const CLOUD_STORES = ['videos','channels','wiki','pairs'];" in s
p.write_text(s,encoding='utf-8')
print('Patched coach searches and related streams, preserved DB and cloud formats')

from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text('utf-8')
def replace(old,new,expected=1):
 global s
 n=s.count(old)
 if n!=expected: raise RuntimeError(f'Expected {expected} matches, got {n} for: {old[:140]!r}')
 s=s.replace(old,new)
replace('// @version      1.0.23','// @version      1.0.24')
replace("const VERSION = '1.0.23';", "const VERSION = '1.0.24';")
start=s.index("  // Affiliation comes from a Holodex mention's org or a successful Nijisanji Wiki")
end=s.index('  function paintResearchCollaboratorButton(btn, name, isCard = false) {',start)
new=r'''  // The official member roster on the Nijisanji fan wiki is the ONLY box-member
  // authority. Ordinary Wiki video pages and Holodex org labels are not a roster.
  const RESEARCH_COLLAB_GROUPS = { nijisanji:'にじさんじ', outside:'にじさんじ以外' };
  const RESEARCH_ROSTER_URL = `${WIKI_BASE}/公式ライバー`;
  const RESEARCH_ROSTER_CACHE_KEY = 'npf_current_nijisanji_roster_wiki_v1';
  const RESEARCH_ROSTER_TTL = 7 * 24 * 60 * 60 * 1000;
  const researchRoster = { names:new Set(), members:0, ready:false, loading:false,
    fetchedAt:0, error:'', promise:null };

  function researchRosterKey(name = '') {
    return normalizeCollaboratorName(name).normalize('NFKC');
  }

  function parseNijisanjiRosterHtml(html = '') {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    const names = new Set();
    const members = new Set();
    let section = '', current = false;
    const add = value => {
      const key = researchRosterKey(value);
      if (key && key.length >= 2 && key.length <= 100) names.add(key);
    };
    for (const el of doc.querySelectorAll('h2,h3,h4,ul')) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'h2') {
        const label = (el.textContent || '').trim();
        section = label.includes('にじさんじ公式ライバー') ? 'jp'
          : label.includes('海外公式ライバー') ? 'other' : '';
        current = false;
      } else if (tag === 'h3') {
        const label = (el.textContent || '').trim();
        if (['other','en','virtual'].includes(section))
          section = label.includes('NIJISANJI EN') ? 'en'
            : label.includes('VirtuaReal') ? 'virtual' : 'other';
        current = false;
      } else if (tag === 'h4') {
        const label = (el.textContent || '').trim();
        current = (section === 'jp' || section === 'en')
          && /^メンバー/.test(label) && !/^元メンバー/.test(label);
      } else if (tag === 'ul' && current) {
        for (const li of el.children) {
          if (li.tagName !== 'LI') continue;
          const person = [...li.querySelectorAll('a[href]')].find(a => {
            const href = a.getAttribute('href') || '';
            return href.startsWith('/nijisanji/') && !href.includes('::');
          });
          if (!person) continue;
          const name = (person.textContent || '').trim();
          const key = researchRosterKey(name);
          if (!key || members.has(key)) continue;
          members.add(key); add(name);
          // The member row sometimes gives an English/Korean/Japanese alias in
          // its FIRST parentheses: e.g. ミン スゥーハ / Min Suha.
          const alias = (li.textContent || '').match(/[（(]([^）)]+)[）)]/);
          if (alias) for (const part of alias[1].split(/[\/／]/)) add(part.trim());
        }
      }
    }
    // Catch a changed Wiki layout instead of treating every stranger as outside.
    if (members.size < 180 || members.size > 260
        || !names.has(researchRosterKey('小柳ロウ'))
        || !names.has(researchRosterKey('Elira Pendora')))
      throw new Error(`公式ライバー名簿の解析結果が不正（${members.size}名）`);
    return { names:[...names], members:members.size };
  }

  async function ensureResearchRoster() {
    if (researchRoster.ready && Date.now() - researchRoster.fetchedAt < RESEARCH_ROSTER_TTL)
      return true;
    if (researchRoster.promise) return researchRoster.promise;
    researchRoster.loading = true;
    researchRoster.error = '';
    updateResearchCollaboratorGroupButtons();
    researchRoster.promise = (async () => {
      const cached = await gmGet(RESEARCH_ROSTER_CACHE_KEY, null).catch(() => null);
      if (cached && Array.isArray(cached.names) && cached.names.length >= 180
          && Number(cached.members) >= 180 && Number(cached.members) <= 260) {
        researchRoster.names = new Set(cached.names);
        researchRoster.members = Number(cached.members);
        researchRoster.fetchedAt = Number(cached.fetchedAt || 0);
        researchRoster.ready = true;
      }
      if (researchRoster.ready && Date.now() - researchRoster.fetchedAt < RESEARCH_ROSTER_TTL)
        return true;
      try {
        // Only triggered by a user's first box/outsider filter selection.
        const html = await wikiRequest(RESEARCH_ROSTER_URL);
        const parsed = parseNijisanjiRosterHtml(html);
        researchRoster.names = new Set(parsed.names);
        researchRoster.members = parsed.members;
        researchRoster.fetchedAt = Date.now();
        researchRoster.ready = true;
        await gmSet(RESEARCH_ROSTER_CACHE_KEY, { ...parsed, fetchedAt:researchRoster.fetchedAt })
          .catch(err => console.debug('[NRH][roster save]', err?.message || err));
      } catch (err) {
        researchRoster.error = String(err?.message || err || 'Wiki名簿の取得に失敗しました');
        console.debug('[NRH][roster load]', researchRoster.error);
      }
      return researchRoster.ready;
    })().finally(() => {
      researchRoster.loading = false;
      researchRoster.promise = null;
      updateResearchCollaboratorGroupButtons();
      applyResearchFilters();
    });
    return researchRoster.promise;
  }

  function researchCollaboratorOrgGroups(entry) {
    const groups = new Set();
    // When the roster is unavailable, NEITHER group can be inferred safely.
    if (!researchRoster.ready || !entry) return groups;
    const names = new Set([
      ...(entry.collaborators || []), ...(entry.wikiInfo?.collaborators || []),
    ].map(researchRosterKey).filter(Boolean));
    const mentions = Array.isArray(entry.meta?.mentions) ? entry.meta.mentions : [];
    for (const mention of mentions) {
      const channel = mention?.channel || mention || {};
      const candidates = [mention?.name, mention?.english_name, channel?.name, channel?.english_name]
        .map(researchRosterKey).filter(Boolean);
      // These aliases refer to ONE participant: do not count a romanized
      // version of a known member as an extra outside collaborator.
      if (!candidates.length) continue;
      if (candidates.some(name => researchRoster.names.has(name))) groups.add('nijisanji');
      else groups.add('outside');
      // Remove aliases of the same mention when also included in Wiki names.
      for (const candidate of candidates) names.delete(candidate);
    }
    for (const name of names) {
      groups.add(researchRoster.names.has(name) ? 'nijisanji' : 'outside');
    }
    return groups;
  }

  function researchGroupFilterPass(groups) {
    // Never hide everything, or label members as outside, if roster fetch fails.
    if (!researchRoster.ready) return true;
    if ([...research.collaboratorGroupExcluded].some(group => groups.has(group))) return false;
    return !research.collaboratorGroupIncluded.size ||
      [...research.collaboratorGroupIncluded].some(group => groups.has(group));
  }

  function updateResearchCollaboratorGroupButtons() {
    const hint = $('#npf-r-collab-group-hint');
    if (hint) {
      hint.textContent = researchRoster.loading
        ? 'にじさんじ非公式Wikiの現所属者名簿を確認中…（確認できるまで所属フィルターは保留）'
        : researchRoster.ready
          ? `にじさんじ非公式Wiki「公式ライバー」現所属 ${researchRoster.members}名の名簿で判定。名簿にないコラボ相手は箱外。${researchRoster.error ? '更新失敗のため前回名簿を使用中。' : ''}箱内・箱外の混在動画は両方に該当し、除外を優先。`
          : researchRoster.error
            ? `Wiki名簿を確認できません：${researchRoster.error}。誤判定防止のため所属フィルターは保留。もう一度ボタンを操作すると再試行します。`
            : '初回の所属フィルター選択時に非公式Wikiの現所属者名簿を取得します。名簿にないコラボ相手は箱外。卒業者・個人勢・ストリーマーも箱外扱い。';
    }
    $$('.npf-r-collab-group').forEach(btn => {
      const group = btn.dataset.collabGroup;
      const included = research.collaboratorGroupIncluded.has(group);
      const excluded = research.collaboratorGroupExcluded.has(group);
      btn.classList.toggle('active', included);
      btn.classList.toggle('excluded', excluded);
      btn.textContent = `${excluded ? '−' : included ? '✓' : '🤝'} ${RESEARCH_COLLAB_GROUPS[group]}`;
      btn.setAttribute('aria-pressed', included || excluded ? 'true' : 'false');
      if (isMobileYoutubeUi()) {
        if (included || excluded) {
          btn.style.setProperty('background', excluded ? '#803746' : '#5147a6', 'important');
          btn.style.setProperty('color', '#fff', 'important');
          btn.style.setProperty('border-color', excluded ? '#e58c96' : '#8172ea', 'important');
        } else {
          btn.style.removeProperty('background');
          btn.style.removeProperty('color');
          btn.style.removeProperty('border-color');
        }
      }
    });
  }

  function cycleResearchCollaboratorGroup(group) {
    if (!Object.prototype.hasOwnProperty.call(RESEARCH_COLLAB_GROUPS, group)) return;
    if (research.collaboratorGroupIncluded.has(group)) {
      research.collaboratorGroupIncluded.delete(group);
      research.collaboratorGroupExcluded.add(group);
    } else if (research.collaboratorGroupExcluded.has(group)) {
      research.collaboratorGroupExcluded.delete(group);
    } else {
      research.collaboratorGroupIncluded.add(group);
    }
    updateResearchCollaboratorFilterUi();
    applyResearchFilters();
    if (research.collaboratorGroupIncluded.size || research.collaboratorGroupExcluded.size)
      void ensureResearchRoster();
  }

'''
s=s[:start]+new+s[end:]
replace("    groupHint.textContent = 'タップ：紫 ✓ 絞り込み → 赤 − 除外 → 未選択。箱内・箱外の両方がいる動画は両方に該当、除外が優先。Holodex等で所属不明の相手は勝手に箱外扱いしません。';", "    groupHint.id = 'npf-r-collab-group-hint';\n    groupHint.textContent = '所属フィルターを選ぶとWikiの現所属者名簿を確認します。';")
replace("      const groupExcluded = [...research.collaboratorGroupExcluded].some(group => groups.has(group));\n      const personIncluded = (!research.collaboratorIncluded.size && !research.collaboratorGroupIncluded.size) ||", "      const rosterReady = researchRoster.ready;\n      const groupExcluded = rosterReady && [...research.collaboratorGroupExcluded].some(group => groups.has(group));\n      const groupIncluded = rosterReady && research.collaboratorGroupIncluded.size > 0;\n      const personIncluded = (!research.collaboratorIncluded.size && !groupIncluded) ||")
replace("        [...research.collaboratorGroupIncluded].some(group => groups.has(group));\n      const show =", "        (groupIncluded && [...research.collaboratorGroupIncluded].some(group => groups.has(group)));\n      const show =")
p.write_text(s,'utf-8')
print('patched',len(s),'bytes', 'version',s.splitlines()[3], 'roster parser',s.count('function parseNijisanjiRosterHtml'))

from pathlib import Path

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')

def replace(old, new):
    global s
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f'Expected one occurrence, found {count}: {old[:110]!r}')
    s = s.replace(old, new)

replace('// @version      1.0.22', '// @version      1.0.23')
replace("const VERSION = '1.0.22';", "const VERSION = '1.0.23';")
replace('    collaboratorExcluded: new Map(), // normalized person -> display name; exclusions always win\n', '''    collaboratorExcluded: new Map(), // normalized person -> display name; exclusions always win
    collaboratorGroupIncluded: new Set(), // nijisanji / outside, OR with individual includes
    collaboratorGroupExcluded: new Set(), // independently exclude both groups
''')

helper = '''  // Affiliation comes from a Holodex mention's org or a successful Nijisanji Wiki
  // channel record. A missing org alone must not classify someone as external.
  const RESEARCH_COLLAB_GROUPS = { nijisanji:'にじさんじ', outside:'にじさんじ以外' };

  function researchKnownNijisanjiNames() {
    const known = new Set();
    for (const [cacheKey, dataset] of Object.entries(state.wikiCache || {})) {
      if (!dataset?.fetchOk || !Object.keys(dataset.entries || {}).length) continue;
      const name = dataset.channel || cacheKey.replace(/^history::/, '').split('::')[0];
      const key = normalizeCollaboratorName(name);
      if (key) known.add(key);
    }
    return known;
  }

  function researchCollaboratorOrgGroups(entry) {
    const groups = new Set();
    const known = researchKnownNijisanjiNames();
    const mentions = Array.isArray(entry?.meta?.mentions) ? entry.meta.mentions : [];
    for (const mention of mentions) {
      const channel = mention?.channel || mention || {};
      const names = [mention?.name, mention?.english_name, channel.name, channel.english_name]
        .map(normalizeCollaboratorName).filter(Boolean);
      if (names.some(name => known.has(name))) { groups.add('nijisanji'); continue; }
      const rawOrg = mention?.org ?? channel.org;
      const org = typeof rawOrg === 'string' ? rawOrg.trim() : '';
      if (/nijisanji|にじさんじ/i.test(org)) groups.add('nijisanji');
      else if (org) groups.add('outside');
    }
    // Wiki-only collaborator names are recognized only if their OWN channel has
    // a confirmed Nijisanji Wiki cache entry; other names remain unclassified.
    for (const name of [...(entry?.collaborators || []), ...(entry?.wikiInfo?.collaborators || [])]) {
      if (known.has(normalizeCollaboratorName(name))) groups.add('nijisanji');
    }
    for (const group of (entry?.collaboratorOrgGroups || [])) {
      if (Object.prototype.hasOwnProperty.call(RESEARCH_COLLAB_GROUPS, group)) groups.add(group);
    }
    return groups;
  }

  function researchGroupFilterPass(groups) {
    if ([...research.collaboratorGroupExcluded].some(group => groups.has(group))) return false;
    return !research.collaboratorGroupIncluded.size ||
      [...research.collaboratorGroupIncluded].some(group => groups.has(group));
  }

  function updateResearchCollaboratorGroupButtons() {
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
  }

'''
replace('  function paintResearchCollaboratorButton(btn, name, isCard = false) {', helper + '  function paintResearchCollaboratorButton(btn, name, isCard = false) {')

replace('''    const excludedPerson = [...research.collaboratorExcluded.keys()].some(key => people.has(key));
    // The history loader already selects the focused collaborator; some wiki rows
    // list only the OTHER guests, so do not re-test inclusion here.
    return tagOk && includeOk && excludeOk && !excludedPerson;''', '''    const excludedPerson = [...research.collaboratorExcluded.keys()].some(key => people.has(key));
    const live = currentResearchEntries().find(entry => entry.id === row.id);
    const groups = researchCollaboratorOrgGroups(live || row);
    // The history loader already selects the focused collaborator; some wiki rows
    // list only the OTHER guests, so do not re-test individual names here.
    return tagOk && includeOk && excludeOk && !excludedPerson && researchGroupFilterPass(groups);''')

replace('''    const collaborators = [...mentions];
    if (person && !collaborators.some(n => normalizeCollaboratorName(n) === normalizeCollaboratorName(person))) {''', '''    const collaborators = [...mentions];
    const collaboratorOrgGroups = [...researchCollaboratorOrgGroups({ meta:v, collaborators })];
    if (person && !collaborators.some(n => normalizeCollaboratorName(n) === normalizeCollaboratorName(person))) {''')
replace('''      collaborators,
      notes: [],
      sourceUrl: '',
      source: 'Holodex',''', '''      collaborators, collaboratorOrgGroups,
      notes: [],
      sourceUrl: '',
      source: 'Holodex',''')

replace('''    updateResearchCollaboratorSuggestions();
  }

  // Full-period Wiki/Holodex history is fetched''', '''    updateResearchCollaboratorSuggestions();
    updateResearchCollaboratorGroupButtons();
  }

  // Full-period Wiki/Holodex history is fetched''')
replace('''      const personExcluded = [...research.collaboratorExcluded.keys()].some(key => people.has(key));
      const personIncluded = !research.collaboratorIncluded.size ||
        [...research.collaboratorIncluded.keys()].some(key => people.has(key)) ||
        (!!collaboratorKey && research.collaboratorIncluded.has(collaboratorKey) && historyMatchIds.has(e.id));
      const show = tagOk && includeOk && excludeOk && !personExcluded && personIncluded;''', '''      const personExcluded = [...research.collaboratorExcluded.keys()].some(key => people.has(key));
      const groups = researchCollaboratorOrgGroups(e);
      const groupExcluded = [...research.collaboratorGroupExcluded].some(group => groups.has(group));
      const personIncluded = (!research.collaboratorIncluded.size && !research.collaboratorGroupIncluded.size) ||
        [...research.collaboratorIncluded.keys()].some(key => people.has(key)) ||
        (!!collaboratorKey && research.collaboratorIncluded.has(collaboratorKey) && historyMatchIds.has(e.id)) ||
        [...research.collaboratorGroupIncluded].some(group => groups.has(group));
      const show = tagOk && includeOk && excludeOk && !personExcluded && !groupExcluded && personIncluded;''')

replace('''    collabSelected.hidden = true;
    collabControl.append(collabLabel, collabHint, collabRow, collabExclude, collabOptions, collabSuggestions, collabSelected);''', '''    collabSelected.hidden = true;
    const groupLabel = document.createElement('div');
    groupLabel.className = 'npf-r-label';
    groupLabel.textContent = 'コラボ相手の所属で絞り込み';
    const groupHint = document.createElement('div');
    groupHint.className = 'npf-r-filter-hint';
    groupHint.textContent = 'タップ：紫 ✓ 絞り込み → 赤 − 除外 → 未選択。箱内・箱外の両方がいる動画は両方に該当、除外が優先。Holodex等で所属不明の相手は勝手に箱外扱いしません。';
    const groupButtons = document.createElement('div');
    groupButtons.className = 'npf-r-collab-suggestions';
    for (const [group, label] of Object.entries(RESEARCH_COLLAB_GROUPS)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'npf-r-collab-quick npf-r-collab-group';
      b.dataset.collabGroup = group;
      b.textContent = `🤝 ${label}`;
      b.addEventListener('click', () => cycleResearchCollaboratorGroup(group));
      groupButtons.appendChild(b);
    }
    collabControl.append(collabLabel, collabHint, collabRow, collabExclude, collabOptions, collabSuggestions, collabSelected, groupLabel, groupHint, groupButtons);''')
replace('''      research.collaboratorIncluded.clear(); research.collaboratorExcluded.clear();''', '''      research.collaboratorIncluded.clear(); research.collaboratorExcluded.clear();
      research.collaboratorGroupIncluded.clear(); research.collaboratorGroupExcluded.clear();''')
replace('''    if (research.collaboratorIncluded.size || research.collaboratorExcluded.size || research.collabHistoryLoading) {''', '''    if (research.collaboratorIncluded.size || research.collaboratorExcluded.size || research.collaboratorGroupIncluded.size || research.collaboratorGroupExcluded.size || research.collabHistoryLoading) {''')
replace('''      const hist = research.collaboratorFilter ?''', '''      const groups = [...research.collaboratorGroupIncluded].map(g => RESEARCH_COLLAB_GROUPS[g]).join('・');
      const excludedGroups = [...research.collaboratorGroupExcluded].map(g => RESEARCH_COLLAB_GROUPS[g]).join('・');
      const hist = research.collaboratorFilter ?''')
replace('''[included, excluded, hist].filter(Boolean).join(' ・ ')''', '''[included, excluded, groups ? `所属 ${groups}` : '', excludedGroups ? `所属除外 ${excludedGroups}` : '', hist].filter(Boolean).join(' ・ ')''')

p.write_text(s, encoding='utf-8')
print('Updated collaborator affiliation filters')

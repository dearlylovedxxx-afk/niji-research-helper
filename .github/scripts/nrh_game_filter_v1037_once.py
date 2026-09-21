from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text(encoding='utf-8')
def change(old,new,why):
 global s
 count=s.count(old)
 if count != 1: raise AssertionError(f'{why}: expected one anchor, found {count}')
 s=s.replace(old,new,1)
change('// @version      1.0.36','// @version      1.0.37','metadata version')
change("const VERSION = '1.0.36';","const VERSION = '1.0.37';",'internal version')
change("    excludedTags: new Set(),\n    includeText: '',", "    excludedTags: new Set(),\n    gameIncluded: new Map(), // normalized game -> display name (OR)\n    gameExcluded: new Map(), // exclude wins; loaded cards only\n    includeText: '',",'game state')
anchor='  // Preserve each YouTube card\'s original inline display when a filter is cleared.\n'
addition=r'''  function researchGameKey(game = '') {
    return normalizeResearchText(game).normalize('NFKC');
  }
  function cycleResearchGame(game = '') {
    const name=String(game||'').trim();
    const key=researchGameKey(name);
    if(!key) return;
    if(research.gameIncluded.has(key)) {
      research.gameIncluded.delete(key);research.gameExcluded.set(key,name);
    } else if(research.gameExcluded.has(key)) {
      research.gameExcluded.delete(key);
    } else {
      research.gameIncluded.set(key,name);
    }
    applyResearchFilters();
  }
  function updateResearchGameSuggestions() {
    const container=$('#npf-r-game-suggestions');
    if(!container) return;
    const games=new Map();
    for(const e of currentResearchEntries()) {
      const name=String(e.game||'').trim();
      const key=researchGameKey(name);
      if(!key) continue;
      const v=games.get(key)||{name,count:0};v.count++;
      if(name.length<v.name.length) v.name=name;
      games.set(key,v);
    }
    const suggestions=[...games.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'ja')).slice(0,12);
    const selected=[...new Map([...research.gameIncluded,...research.gameExcluded]).entries()]
      .filter(([key])=>!games.has(key)).map(([key,name])=>({name,count:0}));
    const rows=[...suggestions,...selected];
    const signature=JSON.stringify(rows.map(x=>[x.name,x.count,research.gameIncluded.has(researchGameKey(x.name)),research.gameExcluded.has(researchGameKey(x.name))]));
    if(container.dataset.rendered===signature) return; // avoid YouTube's DOM observer redraw loop
    container.dataset.rendered=signature;
    container.replaceChildren();
    for(const {name,count} of rows) {
      const key=researchGameKey(name);
      const included=research.gameIncluded.has(key),excluded=research.gameExcluded.has(key);
      const b=document.createElement('button');b.type='button';
      b.className='npf-r-collab-quick'+(included?' active':excluded?' excluded':'');
      b.textContent=`${excluded?'− ':included?'✓ ':''}${name}${count?' ('+count+')':''}`;
      b.title=`${name}：タップで絞り込み→除外→解除。候補は表示中の動画から取得。`;
      b.addEventListener('click',()=>cycleResearchGame(name));container.append(b);
    }
    const note=$('#npf-r-game-hint');
    if(note) note.textContent=games.size
      ? `表示中の動画からゲーム${games.size}種類を検出。候補は最大12件、絞り込みはOR・除外は優先。`:
        'ゲーム名の取得待ちです。動画を取得すると候補が表示されます。';
  }

'''
change(anchor,addition+anchor,'game funcs')
change("      const tagOk = researchCategoryPassesFilters(e.categories);\n      const includeOk", "      const tagOk = researchCategoryPassesFilters(e.categories);\n      const game=researchGameKey(e.game);\n      const gameOk=![...research.gameExcluded.keys()].some(key=>game.includes(key))\n        && (!research.gameIncluded.size || [...research.gameIncluded.keys()].some(key=>game.includes(key)));\n      const includeOk",'game matching')
change('      const show = tagOk && includeOk && excludeOk && !personExcluded', '      const show = tagOk && gameOk && includeOk && excludeOk && !personExcluded','visibility')
change('    updateResearchCollaboratorFilterUi();\n    renderResearchCollaboratorHistory();\n    updateResearchStatus();\n  }\n\n  function csvEscape', '    updateResearchCollaboratorFilterUi();\n    updateResearchGameSuggestions();\n    renderResearchCollaboratorHistory();\n    updateResearchStatus();\n  }\n\n  function csvEscape','refresh suggestions')
anchor="    const include = document.createElement('input');\n    include.id = 'npf-r-include';"
new=r'''    // Local game filter: Holodex/Wiki metadata already acquired for these cards.
    const gameLabel=document.createElement('div');gameLabel.className='npf-r-label';
    gameLabel.textContent='ゲームタイトルで絞り込み（複数選択はOR）';body.append(gameLabel);
    const gameHint=document.createElement('div');gameHint.id='npf-r-game-hint';
    gameHint.className='npf-r-filter-hint';body.append(gameHint);
    const gameRow=document.createElement('div');gameRow.className='npf-r-collab-row';
    const gameInput=document.createElement('input');gameInput.id='npf-r-game-input';
    gameInput.className='npf-r-input npf-r-collab-input';gameInput.type='text';
    gameInput.placeholder='ゲーム名（例：VALORANT）';gameInput.autocomplete='off';
    const addGame=()=>{const name=gameInput.value.trim();if(name)cycleResearchGame(name);gameInput.value='';};
    gameInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addGame();}});
    const gameApply=document.createElement('button');gameApply.type='button';
    gameApply.className='npf-r-btn npf-r-collab-apply';gameApply.textContent='追加';
    gameApply.addEventListener('click',addGame);gameRow.append(gameInput,gameApply);
    body.append(gameRow);
    const gameSuggestions=document.createElement('div');gameSuggestions.id='npf-r-game-suggestions';
    gameSuggestions.className='npf-r-collab-suggestions';body.append(gameSuggestions);
    updateResearchGameSuggestions();

    const include = document.createElement('input');
    include.id = 'npf-r-include';'''
change(anchor,new,'game UI')
change("      research.activeTags.clear(); research.excludedTags.clear(); research.includeText = ''; research.excludeText = ''; research.collaboratorFilter = '';", "      research.activeTags.clear(); research.excludedTags.clear(); research.gameIncluded.clear(); research.gameExcluded.clear(); research.includeText = ''; research.excludeText = ''; research.collaboratorFilter = '';",'reset game')
change("      include.value = ''; exclude.value = '';", "      include.value = ''; exclude.value = ''; const gameInputNow=$('#npf-r-game-input'); if(gameInputNow) gameInputNow.value='';",'reset input')
assert 'NijiResearchHelperDB' in s and 'nrhVideoRecordFresh' in s
p.write_text(s,encoding='utf-8')
print('PATCHED v1.0.37 game-title suggestions, include/exclude and reset without changing DB')

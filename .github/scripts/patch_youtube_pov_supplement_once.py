from pathlib import Path
p=Path('Niji_Research_Helper.user.js')
s=p.read_text(encoding='utf-8')
assert '// @version      1.0.41' in s
assert "const VERSION = '1.0.41';" in s
old="""  function attachPovSupplement(source,baseline,syncOffset) {\n    const area=$('#npf-result-area',state.sheet);\n    if(!area)return;\n"""
new="""  function attachPovSupplement(source,baseline,syncOffset,areaOverride=null) {\n    const area=areaOverride || $('#npf-result-area',state.sheet);\n    if(!area)return;\n    const youtubeMode=!!areaOverride;\n    const nearby=area.parentElement?.querySelector?.('#npf-pov-supplement');\n    if(nearby) nearby.remove();\n"""
assert old in s
s=s.replace(old,new,1)
old2="""            manualMatches.push(match);renderMatches(source,[...baseline,...manualMatches],syncOffset);\n            add.textContent='✅ この画面の一覧に追加済み';add.disabled=true;\n"""
new2="""            manualMatches.push(match);\n            if(youtubeMode) renderYoutubeMatches(source,[...baseline,...manualMatches],syncOffset);\n            else renderMatches(source,[...baseline,...manualMatches],syncOffset);\n            add.textContent='✅ この画面の一覧に追加済み';add.disabled=true;\n"""
assert old2 in s
s=s.replace(old2,new2,1)
old3="""      const matches = buildMatches(source, candidates, sec);\n      renderYoutubeMatches(source, matches, sec);\n      if (isMobileYoutubeUi()) {\n"""
new3="""      const matches = buildMatches(source, candidates, sec);\n      renderYoutubeMatches(source, matches, sec);\n      attachPovSupplement(source, matches, sec, results);\n      if (isMobileYoutubeUi()) {\n"""
assert old3 in s
s=s.replace(old3,new3,1)
s=s.replace('// @version      1.0.41','// @version      1.0.42',1)
s=s.replace("const VERSION = '1.0.41';","const VERSION = '1.0.42';",1)
p.write_text(s,encoding='utf-8')

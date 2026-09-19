from pathlib import Path
p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert s.count('// @version      1.0.28') == 1
assert s.count("const VERSION = '1.0.28';") == 1

def once(old, new):
    global s
    count = s.count(old)
    if count != 1:
        raise AssertionError(f'expected one occurrence, found {count}: {old[:90]!r}')
    s = s.replace(old, new, 1)

once('// @version      1.0.28', '// @version      1.0.29')
once("const VERSION = '1.0.28';", "const VERSION = '1.0.29';")
# The status is rebuilt on metadata changes, not every second; update only its two
# countdown labels with the existing one-second YouTube timer, avoiding scanning
# thousands of YouTube cards every second.
once("      row.className = `npf-r-status-row${cls ? ' ' + cls : ''}`;\n      if (title) row.title = title;", "      row.className = `npf-r-status-row${cls ? ' ' + cls : ''}`;\n      if (label === 'Holodex' || label === 'Wiki') row.dataset.npfCooldown = label;\n      if (title) row.title = title;")
anchor = "  function updateResearchStatus() {"
assert s.count(anchor) == 1
s = s.replace(anchor, """  function updateResearchCooldownDisplay() {
    // iOS timers may be throttled in the background: derive the value from the
    // absolute deadline whenever the browser runs again, never decrement a counter.
    if (research.holodexPaused) {
      const label = $('#npf-r-status [data-npf-cooldown="Holodex"] .npf-r-status-detail');
      if (label) {
        const sec = Math.ceil(holodexCooldownRemainingMs() / 1000);
        label.textContent = sec > 0
          ? `429で自動取得停止・あと約${sec}秒（手動再試行）`
          : '429で自動取得停止・再解析・再取得で手動再試行';
      }
    }
    if (wikiRequestsPaused) {
      const label = $('#npf-r-status [data-npf-cooldown="Wiki"] .npf-r-status-detail');
      if (label) {
        const sec = Math.ceil(wikiCooldownRemainingMs() / 1000);
        // Keep the other Wiki status counters unchanged.
        label.textContent = label.textContent.replace(
          /429で自動通信停止・(?:あと約\\d+秒（手動再試行）|失敗分だけ手動再試行)/,
          sec > 0 ? `429で自動通信停止・あと約${sec}秒（手動再試行）`
            : '429で自動通信停止・失敗分だけ手動再試行');
      }
    }
  }

""" + anchor, 1)
once("        syncYoutubePanelVisibility();\n        updateYoutubePanel();\n      }, 1000);", "        syncYoutubePanelVisibility();\n        updateYoutubePanel();\n        if (research.holodexPaused || wikiRequestsPaused) updateResearchCooldownDisplay();\n      }, 1000);")
# In addition to the existing count of visible videos, show active classification
# and other simultaneous filters explicitly. A zero-result category filter can
# otherwise appear broken even when a keyword or collaborator filter excludes all.
needle = "    addRow('YouTube', `表示 ${visible}/${total}本`, visible === total ? '読み込み済みカードはすべて表示対象' : `フィルターで ${total - visible}本非表示`, visible === total ? 'npf-r-status-ok' : 'npf-r-status-info');"
addition = """
    if (research.activeTags.size || research.excludedTags.size) {
      const includedTags = [...research.activeTags];
      const excludedTags = [...research.excludedTags];
      const tagOnly = all.filter(e => researchCategoryPassesFilters(e.categories)).length;
      const additional = [];
      if (splitResearchWords(research.includeText).length || splitResearchWords(research.excludeText).length) additional.push('キーワード');
      if (research.collaboratorIncluded.size || research.collaboratorExcluded.size) additional.push('個別コラボ相手');
      if (research.collaboratorGroupIncluded.size || research.collaboratorGroupExcluded.size) additional.push('所属');
      addRow('分類', [includedTags.length ? `✓ ${includedTags.join('・')}` : '', excludedTags.length ? `− ${excludedTags.join('・')}` : ''].filter(Boolean).join(' / '),
        `分類だけなら ${tagOnly}/${total}本・実際の表示 ${visible}本${additional.length ? `（ほかに${additional.join('・')}の条件も適用中）` : ''}${!tagOnly ? '。動画に分類が付いているか確認してください' : ''}`, 'npf-r-status-info');
    }
"""
once(needle, needle + addition)
p.write_text(s, encoding='utf-8')
print('Patched Niji Research Helper v1.0.29: elapsed-time cooldown and category-filter diagnostics')

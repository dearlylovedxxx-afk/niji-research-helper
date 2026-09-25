from pathlib import Path

p=Path("Niji_Research_Helper.user.js")
s=p.read_text(encoding="utf-8")
assert "// @version      1.0.47" in s
assert "const VERSION = '1.0.47';" in s
assert "const KEY_FAVS = 'npf_favorites';" in s

s=s.replace("// @version      1.0.47","// @version      1.0.48",1)
s=s.replace("const VERSION = '1.0.47';","const VERSION = '1.0.48';",1)

old="""    const usableFavs = state.favorites
      .map(fav => ({ fav, option: findOptionForFavorite(select, fav) }))
      .filter(x => x.option);

    box.innerHTML = `
      <div class="npf-channel-favs-head">
        <div class="npf-channel-favs-title">★ お気に入りチャンネル</div>
        <button type="button" class="npf-channel-fav-add">☆ 選択中を登録</button>
      </div>
      <div class="npf-channel-favs-list">
        ${usableFavs.length
          ? usableFavs.map(({ fav, option }) => `
              <button
                type="button"
                class="npf-channel-chip ${option.selected ? 'selected' : ''}"
                data-fav-id="${escapeHtml(String(fav.id || ''))}"
              >${escapeHtml(fav.name || option.textContent || '')}</button>
            `).join('')
          : `<span class="npf-channel-favs-empty">登録済みのお気に入りは、このチャンネル欄ではまだ見つかりません。</span>`
        }
      </div>
    `;"""

new="""    // 保存済みのお気に入りは、サイト側のselect候補がまだ読み込まれていなくても
    // 消えたように見せない。現在の選択肢に一致しないものは一時的に無効表示する。
    const favoriteRows = state.favorites
      .filter(fav => fav && (fav.id || fav.name))
      .map(fav => ({ fav, option: findOptionForFavorite(select, fav) }));
    const unresolvedCount = favoriteRows.filter(x => !x.option).length;

    box.innerHTML = `
      <div class="npf-channel-favs-head">
        <div class="npf-channel-favs-title">★ お気に入りチャンネル</div>
        <button type="button" class="npf-channel-fav-add">☆ 選択中を登録</button>
      </div>
      <div class="npf-channel-favs-list">
        ${favoriteRows.length
          ? favoriteRows.map(({ fav, option }) => `
              <button
                type="button"
                class="npf-channel-chip ${option?.selected ? 'selected' : ''} ${option ? '' : 'unavailable'}"
                data-fav-id="${escapeHtml(String(fav.id || ''))}"
                ${option ? '' : 'disabled'}
                title="${option ? 'このチャンネルを選択' : '保存済み。現在のチャンネル候補にはまだ読み込まれていません'}"
              >${escapeHtml(fav.name || option?.textContent || fav.id || '')}${option ? '' : '（候補未読込）'}</button>
            `).join('')
          : `<span class="npf-channel-favs-empty">保存済みのお気に入りチャンネルは0件です。</span>`
        }
      </div>
      ${unresolvedCount ? `<div class="npf-channel-favs-note">${unresolvedCount}件は保存済みですが、現在のチャンネル候補に未読込です。候補が読み込まれると自動で有効になります。</div>` : ''}
    `;"""

assert old in s, "favorite render block not found"
s=s.replace(old,new,1)

# ensure styling exists for note/unavailable without changing stored data
anchor="""  // ---------- comment2434: ライバー名検索のお気に入り（チャンネルとは別保存） ----------"""
style="""  // 保存済みだが現在のselect候補に未読込のチップは、存在自体を見せたまま無効化する。
  try {
    GM.addStyle?.(`
      .npf-channel-chip.unavailable{opacity:.55;filter:saturate(.55);cursor:not-allowed}
      .npf-channel-favs-note{font-size:11px;line-height:1.45;color:#aeb8ca;margin-top:7px}
    `);
  } catch {}

"""
assert anchor in s
s=s.replace(anchor,style+anchor,1)

p.write_text(s,encoding="utf-8")
print("patched v1.0.48 favorite visibility only; no favorite storage writes added")

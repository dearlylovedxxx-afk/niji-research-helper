from pathlib import Path


def replace_once(src, old, new, label):
    count = src.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {count}')
    return src.replace(old, new, 1)


x_path = Path('X_Search_Favorites.user.js')
x = x_path.read_text(encoding='utf-8')
x = replace_once(x, '// @version      1.1.5', '// @version      1.1.6', 'X metadata version')
x = replace_once(x, "const VERSION='1.1.5', KEY='xsf_userscript_v1';", "const VERSION='1.1.6', KEY='xsf_userscript_v1';", 'X runtime version')
x = replace_once(x, "const launch=E('button','', '🔎 検索＋');const filterBtn=E('button','', '本文一致のみ');const sortBtn=E('button','', '♥ いいね順');bar.append(launch,filterBtn,sortBtn);sh.append(bar);", "const launch=E('button','', '🔎 検索');const filterBtn=E('button','', '本文一致のみ');const sortBtn=E('button','', '♥ いいね順');bar.append(launch);sh.append(bar);", 'single floating search launcher')
x = replace_once(x, "const tools=E('div','actions');const importCurrent=E('button','', '現在のX検索を取り込む');tools.append(importCurrent);builder.append(tools);", "const tools=E('div','actions');tools.dataset.ncbSlot='x';const importCurrent=E('button','', '現在のX検索を取り込む');tools.append(importCurrent,filterBtn,sortBtn);builder.append(tools);builder.append(E('div','muted','本文一致といいね順はXの検索結果で使えます。☁️バックアップもこの欄から開けます。'));", 'move tools into search panel')
assert "bar.append(launch);sh.append(bar);" in x
assert "tools.append(importCurrent,filterBtn,sortBtn);" in x
assert "data-ncb-slot" not in x  # source uses dataset API, not a hardcoded HTML selector
x_path.write_text(x, encoding='utf-8')

backup_path = Path('Niji_Cloud_Backup.user.js')
backup = backup_path.read_text(encoding='utf-8')
backup = replace_once(backup, '// @version      0.1.3', '// @version      0.1.4', 'backup metadata version')
backup = replace_once(backup, "shadow.append(launch,panel);", "shadow.append(launch,panel);if(app.id==='x')launch.style.setProperty('display','none','important');", 'remove redundant X cloud launcher immediately')
backup = replace_once(backup, "nativeReady=!!root?.querySelector('#bar #launch');\n   slot=root?.querySelector('#panel .tabs');", "nativeReady=!!root?.querySelector('#bar button');\n   slot=root?.querySelector('#panel [data-ncb-slot=\"x\"]');", 'find real X search button and search panel slot')
backup = replace_once(backup, "if(nativeReady) launch.style.setProperty('display','none','important');", "if(app.id==='x'||nativeReady) launch.style.setProperty('display','none','important');", 'never show duplicate cloud launcher on X')
assert "if(app.id==='x'||nativeReady)" in backup
assert "#panel [data-ncb-slot=\"x\"]" in backup
assert "#bar #launch" not in backup
backup_path.write_text(backup, encoding='utf-8')

print('PATCH_OK: X v1.1.6 and backup v0.1.4; one floating X button, search-panel tools, cloud launcher hidden on X')

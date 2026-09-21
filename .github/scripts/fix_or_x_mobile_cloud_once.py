from pathlib import Path

or_path = Path('Niji_OR_Results_Merger.user.js')
cloud_path = Path('Niji_Cloud_Backup.user.js')
x_path = Path('X_Search_Favorites.user.js')
or_code = or_path.read_text(encoding='utf-8')
cloud_code = cloud_path.read_text(encoding='utf-8')
x_code = x_path.read_text(encoding='utf-8')

require = '// @require      https://raw.githubusercontent.com/dearlylovedxxx-afk/niji-research-helper/main/Niji_Cloud_Backup.user.js\n'
assert or_code.count(require) == 1, 'OR remote include changed'
assert or_code.count('// @version      0.4.10\n') == 1, 'unexpected OR version'
assert or_code.count("const VERSION = '0.4.10';") == 1, 'unexpected OR runtime version'
assert or_code.count('OR起動中 0.4.10') == 1, 'unexpected OR boot label'
assert cloud_code.count('// ==/UserScript==\n') == 1, 'common cloud header changed'
assert "'comment2434.com':{id:'or'" in cloud_code and 'async function requestOr(' in cloud_code
assert 'Niji Cloud Backup' in cloud_code
common_body = cloud_code.split('// ==/UserScript==\n', 1)[1].strip()
assert common_body.startswith('(async () => {') and common_body.endswith('})();')
# Run the OR-specific backup in the same userscript sandbox, where OR's GM data lives.
# This avoids relying on Macaque supporting @require and never passes data into the webpage.
or_code = or_code.replace(require, '')
or_code = or_code.replace('// @version      0.4.10\n', '// @version      0.4.11\n', 1)
or_code = or_code.replace("const VERSION = '0.4.10';", "const VERSION = '0.4.11';", 1)
or_code = or_code.replace('OR起動中 0.4.10', 'OR起動中 0.4.11', 1)
assert '/* NCB_OR_EMBEDDED_BEGIN */' not in or_code
or_code = or_code.rstrip() + '\n\n/* NCB_OR_EMBEDDED_BEGIN: same userscript namespace; do not re-add @require */\n' + common_body + '\n/* NCB_OR_EMBEDDED_END */\n'
assert or_code.count('NCB_OR_EMBEDDED_BEGIN') == 1
assert not require.strip() in or_code
or_path.write_text(or_code, encoding='utf-8')

assert x_code.count('// @version      1.1.4\n') == 1, 'unexpected X version'
assert x_code.count("const VERSION='1.1.4', KEY='xsf_userscript_v1';") == 1
assert x_code.count('#bar{right:7px;bottom:9px}') == 1, 'X mobile layout changed'
assert x_code.count('z-index:2147483646!important;pointer-events:none!important') == 1
x_code=x_code.replace('// @version      1.1.4\n','// @version      1.1.5\n',1)
x_code=x_code.replace("const VERSION='1.1.4', KEY='xsf_userscript_v1';", "const VERSION='1.1.5', KEY='xsf_userscript_v1';",1)
# Leave the existing localStorage key untouched. Position above X's mobile bottom tabs
# and above the cloud button (which occupies bottom:70px) to avoid overlapping controls.
x_code=x_code.replace('#bar{right:7px;bottom:9px}', '#bar{right:7px;bottom:calc(155px + env(safe-area-inset-bottom, 0px));max-width:calc(100vw - 14px);flex-wrap:wrap;justify-content:flex-end}',1)
x_code=x_code.replace('z-index:2147483646!important;pointer-events:none!important', 'z-index:2147483647!important;pointer-events:none!important',1)
assert "KEY='xsf_userscript_v1'" in x_code
x_path.write_text(x_code, encoding='utf-8')
print('PASS: OR cloud embedded in its own GM namespace; no @require; X mobile controls raised; storage keys unchanged')

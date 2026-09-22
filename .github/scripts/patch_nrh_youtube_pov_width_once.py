from pathlib import Path

p = Path('Niji_Research_Helper.user.js')
s = p.read_text(encoding='utf-8')
assert '// @version      1.0.40' in s and "const VERSION = '1.0.40';" in s
assert 'const CLOUD_STORES = [\'videos\',\'channels\',\'wiki\',\'pairs\'];' in s

def replace_once(old, new, name):
    global s
    count = s.count(old)
    if count != 1:
        raise AssertionError(f'{name}: expected one exact anchor, got {count}')
    s = s.replace(old, new, 1)

replace_once('// @version      1.0.40', '// @version      1.0.41', 'metadata version')
replace_once("const VERSION = '1.0.40';", "const VERSION = '1.0.41';", 'runtime version')

replace_once('''      width:min(340px,calc(100vw - 24px)); box-sizing:border-box;
''', '''      width:min(540px,calc(100vw - 24px)); min-width:min(320px,calc(100vw - 24px));
      max-width:calc(100vw - 24px) !important; box-sizing:border-box;
''', 'desktop panel width')
replace_once('''    .npf-yt-head-title { font-size:13px; font-weight:800; }
''', '''    .npf-yt-head-title { font-size:13px; font-weight:800; flex:1; min-width:0; }
    #npf-yt-resize { appearance:none; border:1px solid #50576c; border-radius:8px;
      background:#303547; color:#f2f2ff; padding:5px 9px; min-width:70px; height:33px;
      font:700 11px/1.2 system-ui; cursor:ew-resize; touch-action:none; user-select:none;
      flex:none; }
    #npf-yt-resize:hover { background:#454c68; }
''', 'resize handle stylesheet')

anchor='''  // ---------- comment2434: URL + timestamp POV launcher ----------
'''
helper='''  // Desktop YouTube panel: resize from a clearly labelled header grip. Dragging
  // left expands the right-anchored panel; tapping cycles accessible presets.
  // This UI-only preference is local to the YouTube origin; DB/schema unchanged.
  function installYoutubePanelResize(panel, head, closeBtn) {
    if (isMobileYoutubeUi() || head.querySelector('#npf-yt-resize')) return;
    const key = 'npf_yt_panel_width_v1';
    const presets = [440, 620, 820, 1000];
    function applyWidth(raw, remember = false) {
      const max = Math.max(220, Math.min(1000, window.innerWidth - 32));
      const min = Math.min(320, max);
      const requested = Number(raw);
      const width = Math.round(Math.max(min, Math.min(max,
        Number.isFinite(requested) && requested > 0 ? requested : 540)));
      panel.style.setProperty('width', width + 'px', 'important');
      if (remember) {
        try { localStorage.setItem(key, String(width)); } catch (e) {
          console.debug('[NRH][panel width] save unavailable', e);
        }
      }
      return width;
    }
    let saved = 540;
    try { saved = Number(localStorage.getItem(key)) || 540; } catch {}
    applyWidth(saved);
    const grip = document.createElement('button');
    grip.id = 'npf-yt-resize'; grip.type = 'button';
    grip.textContent = '↔ 幅調整';
    grip.title = '左右にドラッグして幅変更／クリックで幅を切替';
    grip.setAttribute('aria-label', grip.title);
    head.insertBefore(grip, closeBtn);
    let drag = null, lastDragAt = 0;
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      drag = { x:e.clientX, width:panel.getBoundingClientRect().width, moved:false };
      try { grip.setPointerCapture(e.pointerId); } catch {}
    });
    grip.addEventListener('pointermove', e => {
      if (!drag) return;
      const delta = drag.x - e.clientX;
      if (Math.abs(delta) > 4) drag.moved = true;
      if (!drag.moved) return;
      e.preventDefault();
      applyWidth(drag.width + delta);
    });
    const finish = () => {
      if (!drag) return;
      if (drag.moved) {
        lastDragAt = Date.now();
        applyWidth(panel.getBoundingClientRect().width, true);
      }
      drag = null;
    };
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
    grip.addEventListener('click', () => {
      if (Date.now() - lastDragAt < 450) return;
      const current = panel.getBoundingClientRect().width;
      applyWidth(presets.find(size => size > current + 24) || presets[0], true);
    });
    window.addEventListener('resize', () => {
      if (panel.isConnected) applyWidth(panel.getBoundingClientRect().width);
    }, { passive:true });
  }

'''
replace_once(anchor, helper + anchor, 'resize helper')

replace_once('''  function attachPovSupplement(source,baseline,syncOffset) {
    const area=$('#npf-result-area',state.sheet);
    if(!area)return;
''', '''  function attachPovSupplement(source,baseline,syncOffset,youtubeMode=false) {
    const area=youtubeMode?$('#npf-yt-results'):$('#npf-result-area',state.sheet);
    if(!area)return;
    // Search may be run repeatedly without reloading a YouTube watch page.
    area.parentElement?.querySelector('#npf-pov-supplement')?.remove();
''', 'shared supplement target')
replace_once('''            manualMatches.push(match);renderMatches(source,[...baseline,...manualMatches],syncOffset);
''', '''            manualMatches.push(match);
            if(youtubeMode)renderYoutubeMatches(source,[...baseline,...manualMatches],syncOffset);
            else renderMatches(source,[...baseline,...manualMatches],syncOffset);
''', 'shared supplement add')

replace_once('''    const results = $('#npf-yt-results');
    if (results) {
''', '''    // Never display the previous video's supplement while a new POV search runs.
    document.querySelector('#npf-yt-panel #npf-pov-supplement')?.remove();
    const results = $('#npf-yt-results');
    if (results) {
''', 'clear previous YouTube supplement')
replace_once('''      renderYoutubeMatches(source, matches, sec);
      if (isMobileYoutubeUi()) {
''', '''      renderYoutubeMatches(source, matches, sec);
      attachPovSupplement(source, matches, sec, true);
      if (isMobileYoutubeUi()) {
''', 'show supplement in YouTube')
replace_once('''    } else {
      (document.body || document.documentElement).appendChild(panel);
    }
    syncYoutubePanelVisibility();
''', '''    } else {
      (document.body || document.documentElement).appendChild(panel);
      installYoutubePanelResize(panel, head, closeBtn);
    }
    syncYoutubePanelVisibility();
''', 'enable resize on desktop')

assert s.count('function installYoutubePanelResize(') == 1
assert s.count('attachPovSupplement(source, matches, sec, true);') == 1
assert s.count('attachPovSupplement(source, matches, syncOffset);') == 1
assert s.count("const CLOUD_STORES = ['videos','channels','wiki','pairs'];") == 1
assert 'const NRH_DB_NAME = \'NijiResearchHelperDB\';' in s
p.write_text(s, encoding='utf-8')
print('PASS: guarded v1.0.41 patch; YouTube+comment complement, desktop width UI, unchanged DB/cloud anchors')

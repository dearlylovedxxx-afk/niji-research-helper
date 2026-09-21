  // One-input OR search: reuse the site's real search form and next-page controls.
  // Never call private endpoints or change the Niji Research Helper database.
  const MULTI_KEY = 'niji_or_merger_addon_multi_v1';
  const MULTI_MAX_WORDS = 8;
  const MULTI_PAGES_PER_WORD = 25;
  const MULTI_TOTAL_PAGES = 100;
  const MULTI_DOCUMENT_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let multiJob = null;
  let multiRunning = false;
  let lastMultiStatus = '';
  const multiWait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function parseOrWords(raw) {
    const words = String(raw || '').match(/"[^"]+"|'[^']+'|[^\s,、，|]+/g) || [];
    return [...new Set(words.map(w => w.replace(/^["']|["']$/g, '').trim()).filter(Boolean))];
  }

  function nativeSearchForm() {
    const matches = [];
    for (const form of document.querySelectorAll('form')) {
      if (withinOwnUi(form)) continue;
      let action;
      try { action = new URL(form.getAttribute('action') || location.href, location.href); }
      catch { continue; }
      if (action.origin !== location.origin || !action.pathname.startsWith('/comment')) continue;
      for (const field of form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]),textarea')) {
        if (field.disabled || field.type === 'checkbox' || field.type === 'radio') continue;
        const associated = field.id ? [...document.querySelectorAll('label[for]')].find(l => l.htmlFor === field.id)?.textContent || '' : '';
        const description = [field.name, field.id, field.placeholder, field.getAttribute('aria-label'), associated].join(' ');
        let score = /keyword|キーワード/i.test(description) ? 20 : /検索(?:語|ワード)|search[_-]?(?:word|term|query)/i.test(description) ? 12 : /^(?:q|query|word)$/i.test(field.name || '') ? 9 : 0;
        if (/タイトル|title|ライバー|channel|チャンネル|除外|日付|date/i.test(description)) score -= 30;
        if (score > 0) matches.push({ form, field, score });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches[0] || null;
  }

  function nativeTermEvidence(word) {
    if (nativeSearchForm()?.field.value.trim() === word) return true;
    try { return [...new URL(location.href).searchParams.values()].some(value => value === word); }
    catch { return false; }
  }

  function multiBlocked() {
    const text = `${document.title} ${(document.querySelector('main') || document.body)?.textContent?.slice(0, 1200) || ''}`;
    return /(?:Too Many Requests|HTTP\s*429|アクセス制限|しばらく時間をおいて)/i.test(text);
  }

  async function saveMultiJob() { await storeSet(MULTI_KEY, multiJob); }
  async function endMulti(reason) {
    if (!multiJob) return;
    multiJob = null;
    await saveMultiJob();
    lastMultiStatus = reason;
    panel.hidden = false;
    trigger.style.setProperty('display', 'none', 'important');
    render();
    message.textContent = reason;
  }

  async function submitMultiWord() {
    if (!multiJob?.active) return;
    const word = multiJob.words[multiJob.index];
    const found = nativeSearchForm();
    if (!found) {
      // The verified public search page is the only fallback. Do not guess an API.
      if (location.pathname !== '/comment/' && !multiJob.triedSearchHome) {
        multiJob.triedSearchHome = true;
        await saveMultiJob();
        location.assign(new URL('/comment/', location.origin).href);
        return;
      }
      return await endMulti('検索フォームを特定できません。検索画面のスクショと「診断をコピー」の内容を送ってください。保存済みデータはそのままです。');
    }
    const { form, field } = found;
    const previous = domFingerprint();
    const previousUrl = location.href;
    const previousDocument = MULTI_DOCUMENT_ID;
    const submit = [...form.querySelectorAll('button[type="submit"],input[type="submit"],button:not([type])')]
      .find(node => /検索|search/i.test(`${node.textContent || ''} ${node.value || ''} ${node.getAttribute('aria-label') || ''}`)) ||
      form.querySelector('button[type="submit"],input[type="submit"]');
    if (!submit && typeof form.requestSubmit !== 'function') return await endMulti('検索の送信ボタンを確認できません。誤ったフォームは送信せず停止しました。');
    const setter = Object.getOwnPropertyDescriptor(field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(field, word); else field.value = word;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    multiJob.phase = 'awaitSearch';
    multiJob.previous = previous;
    multiJob.previousUrl = previousUrl;
    multiJob.previousDocument = previousDocument;
    multiJob.pendingAt = Date.now();
    await saveMultiJob();
    if (submit) submit.click(); else form.requestSubmit();
  }

  async function nextMultiWord() {
    if (!multiJob?.active) return;
    multiJob.index++;
    multiJob.wordPages = 0;
    multiJob.previous = '';
    multiJob.triedSearchHome = false;
    if (multiJob.index >= multiJob.words.length) {
      const count = multiJob.totalPages;
      return await endMulti(`OR検索完了：${multiJob.words.length}語・${count}ページを統合しました。コメント本文は画面に表示された分のみ取得します。`);
    }
    multiJob.phase = 'search';
    await saveMultiJob();
  }

  async function runMulti() {
    if (multiRunning || !multiJob?.active) return;
    multiRunning = true;
    try {
      for (let step = 0; step < 4 && multiJob?.active; step++) {
        if (Date.now() - Number(multiJob.startedAt || 0) > 45 * 60 * 1000) return await endMulti('45分の安全期限に達したので停止しました。取得済み結果は残っています。');
        if (multiBlocked()) return await endMulti('アクセス制限の可能性があるため停止しました。再試行を繰り返さないでください。');
        if (multiJob.phase === 'search') {
          const word = multiJob.words[multiJob.index];
          // If the current page already shows the same term, reuse it.
          if (multiJob.index === 0 && nativeTermEvidence(word) && captureDisplayed().rows.length) {
            multiJob.phase = 'collect';
            await saveMultiJob();
            continue;
          }
          await multiWait(AUTO_NEXT_DELAY_MS);
          await submitMultiWord();
          break;
        }
        if (multiJob.phase === 'awaitSearch' || multiJob.phase === 'awaitPage') {
          const isSearch = multiJob.phase === 'awaitSearch';
          let ready = false;
          for (let attempt = 0; attempt < 28 && multiJob?.active; attempt++) {
            const changed = multiJob.previousDocument !== MULTI_DOCUMENT_ID ||
              location.href !== multiJob.previousUrl || domFingerprint() !== multiJob.previous;
            const evidence = !isSearch || nativeTermEvidence(multiJob.words[multiJob.index]);
            if (changed && evidence && captureDisplayed().rows.length) { ready = true; break; }
            await multiWait(500);
          }
          if (!multiJob?.active) break;
          if (!ready) return await endMulti('検索結果の切替・検索語を確認できず停止しました。別の語の結果として誤保存はしていません。診断を共有してください。');
          multiJob.phase = 'collect';
          await saveMultiJob();
          continue;
        }
        if (multiJob.phase !== 'collect') return await endMulti('検索状態が不正なため停止しました。保存済みデータは保持しています。');
        const word = multiJob.words[multiJob.index];
        if (!captureDisplayed().rows.length) return await endMulti('動画ID付きの検索結果を確認できず停止しました。診断を共有してください。');
        const saved = await addCurrentPage(word, true);
        if (saved.kind === 'limit') return await endMulti(`保存回数の上限${MAX_BATCHES}に達したため停止しました。`);
        if (saved.kind === 'empty') return await endMulti('動画IDを取得できず停止しました。');
        if (saved.kind === 'added') {
          multiJob.wordPages++;
          multiJob.totalPages++;
        }
        render();
        message.textContent = `🔄 ${multiJob.index + 1}/${multiJob.words.length}語「${word}」／${multiJob.totalPages}ページ取得済み`;
        if (multiJob.totalPages >= MULTI_TOTAL_PAGES) return await endMulti(`安全上限${MULTI_TOTAL_PAGES}ページで停止しました。ここまでの結果は保存済みです。`);
        const next = multiJob.wordPages < MULTI_PAGES_PER_WORD ? nextPageControl() : null;
        if (!next) {
          await nextMultiWord();
          continue;
        }
        multiJob.phase = 'awaitPage';
        multiJob.previous = domFingerprint();
        multiJob.previousUrl = location.href;
        multiJob.previousDocument = MULTI_DOCUMENT_ID;
        multiJob.pendingAt = Date.now();
        await saveMultiJob();
        await multiWait(AUTO_NEXT_DELAY_MS);
        if (!multiJob?.active) break;
        if (!next.isConnected || next.disabled) return await endMulti('次ページのボタンが無効になったため停止しました。');
        next.click();
        break;
      }
    } catch (error) {
      console.warn('[Niji OR Merger][multi]', error);
      try { await endMulti(`OR検索を停止：${String(error?.message || error)}`); } catch (inner) { reportError(inner); }
    } finally {
      multiRunning = false;
      if (multiJob?.active) setTimeout(() => { void runMulti(); }, 1100);
    }
  }

  async function startMulti() {
    if (multiJob?.active || autoJob?.active || busy || autoRunning) return;
    const words = parseOrWords(labelInput.value);
    if (!words.length) { message.textContent = '検索語を入力してください。'; labelInput.focus(); return; }
    if (words.length > MULTI_MAX_WORDS) { message.textContent = `一度に${MULTI_MAX_WORDS}語まで指定できます。`; return; }
    multiJob = { active:true, words, index:0, phase:'search', wordPages:0, totalPages:0,
      previous:'', previousUrl:'', previousDocument:'', triedSearchHome:false, startedAt:Date.now() };
    try {
      await saveMultiJob();
      render();
      void runMulti();
    } catch (error) { multiJob = null; reportError(error); }
  }

  async function cancelMulti() { await endMulti('OR検索を中止しました。取得済みの結果は保持しています。'); }

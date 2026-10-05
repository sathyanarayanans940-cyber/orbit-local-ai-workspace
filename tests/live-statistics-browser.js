/* Opt-in fresh paid replies. Uses production request/Analyze/render/export code. */
(async function () {
  while (typeof requestLocalReply !== 'function' || typeof initWidgetUi !== 'function') await new Promise(resolve => setTimeout(resolve, 50));
  const model = {key:'AICredits:deepseek/deepseek-v4.1-flash',id:'deepseek/deepseek-v4.1-flash',provider:'AICredits',name:'DeepSeek V4.1 Flash',capabilities:['completion','thinking','vision']};
  state.models = [model]; state.selectedModel = model.key; state.connectedProviders = new Set(['AICredits']);
  OrbitThinking.set(model, 'high');
  // The separate localhost origin has its own empty library. Keep test chats
  // ephemeral while retaining complete audit output through the local server.
  persistCurrentChat = function () {};
  const toolbar = document.createElement('aside');
  toolbar.style.cssText = 'position:fixed;top:8px;left:320px;right:24px;z-index:9000;background:var(--panel,#fff);color:var(--text,#222);border:1px solid #80808060;border-radius:12px;padding:10px 16px;box-shadow:0 4px 20px #0002';
  const status = document.createElement('div'); status.id = 'live-statistics-status'; status.textContent = 'Ready: fresh DeepSeek Flash · High. Source: supplied statistics paper.';
  const run = document.createElement('button'); run.textContent = 'Run fresh Word, PDF and chat'; run.id = 'run-live-statistics'; run.style.marginRight = '16px';
  toolbar.append(run, status); document.body.append(toolbar);
  document.title = 'Orbit — fresh DeepSeek worked-solutions audit';
  const results = {};
  const focusValue = new URLSearchParams(location.search).get('focus');
  const focus = focusValue !== null;
  if (focus) run.textContent = 'Retest Q4 in chat, Word and PDF';
  const replay = document.createElement('button'); replay.textContent = 'Replay saved replies with rendering fixes'; toolbar.append(replay);
  async function save(kind, value) {
    const response = await fetch('/tests/live-results/' + kind + '.json', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    if (!response.ok) throw Error('Audit results could not be saved');
  }
  async function attachments() {
    const images = [];
    for (let i = 1; i <= 2; i++) {
      const response = await fetch('/tests/live-assets/page-' + i + '.png'), blob = await response.blob();
      const dataUrl = await new Promise((resolve,reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);});
      images.push({name:'Question paper · page ' + i + '.png',type:'image/png',assetId:'img-live-paper-' + i,dataUrl});
    }
    return images;
  }
  function show(kind) {
    const result = results[kind];
    if (!result) return;
    state.messages = result.messages; state.currentChat = 'live-statistics-' + kind; state.currentTitle = 'Fresh DeepSeek — ' + kind.toUpperCase();
    renderConversationTitle(); renderMessages(true);
    document.querySelector('#messages-wrap').scrollTop = 0;
  }
  replay.onclick = async function () {
    replay.disabled = true;
    const input = await attachments();
    for (const kind of ['docx','pdf','chat']) {
      const record = await (await fetch('/tests/output/live-statistics/' + kind + '.json')).json();
      const prompt = kind === 'chat' ? 'solve step by step here in chat' : 'give me a ' + (kind === 'docx' ? 'Word document' : 'PDF');
      const user = {role:'user',text:prompt,attachments:input};
      const assistant = {role:'assistant',text:record.rawReply,generating:false};
      state.messages = [user,assistant];
      if (kind !== 'chat') await finalizeMessageWidgets(assistant, prompt, AbortSignal.timeout(180000));
      saveAnalysis(assistant,record.analysis);
      results[kind] = {messages:[user,assistant]};
      await save('replayed-' + kind,{kind,message:assistant,source:'Untouched fresh raw model reply; local rendering only, no new inference.'});
      for (const artifact of assistant.artifacts || []) {
        const blob = widgetBlobs.get(artifact.id);
        if (blob) await fetch('/tests/live-results/replayed-' + kind + '.bin', {method:'POST',body:blob});
      }
      const button = document.createElement('button'); button.textContent = 'Show replayed ' + kind.toUpperCase(); button.onclick = () => show(kind); toolbar.append(button);
    }
    show('chat');
    status.textContent = 'Local replay completed: no model calls. ' + document.querySelectorAll('#messages .katex').length + ' KaTeX equations, ' + document.querySelectorAll('#messages .katex-error,.math-display-fallback,.math-inline-fallback').length + ' math errors.';
  };
  run.onclick = async function () {
    run.disabled = true;
    const input = await attachments();
    for (const kind of focus ? [focusValue === '2' ? 'normal2' : 'normal'] : ['docx','pdf','chat']) {
      const started = Date.now();
      const prompt = focus ? 'bro solve Question 4 from this paper only, fully step by step here in chat, and make matching Word and PDF files with the same complete working please. Chat must use LaTeX; use ordinary centered formula text in the files.' : kind === 'chat' ? 'bro solve this question paper and explain all solutions step by step here in chat pls' : 'bro can u give me a ' + (kind === 'docx' ? 'Word document' : 'PDF') + ' containing solutions of this pls';
      const user = {role:'user',text:prompt,attachments:input};
      state.currentChat = 'live-statistics-' + kind; state.currentTitle = 'Fresh DeepSeek — ' + kind.toUpperCase(); state.messages = [user];
      renderConversationTitle(); renderMessages(true);
      const assistant = {role:'assistant',text:'',generating:true}; state.messages.push(assistant); renderMessages(false);
      status.textContent = kind.toUpperCase() + ': starting real Analyze and generation…';
      let raw = '';
      try {
        const reply = await requestLocalReply(prompt, [user], {
          widgets:true, signal:AbortSignal.timeout(900000),
          onStatus: label => {status.textContent = kind.toUpperCase() + ': ' + label;},
          onToken: token => {raw += token; assistant.text = raw; renderMessages(false);}
        });
        assistant.text = reply.text; assistant.generating = false;
        await finalizeMessageWidgets(assistant, prompt, AbortSignal.timeout(180000));
        saveAnalysis(assistant, reply.analysis); renderMessages(false);
        const record = {kind,model:model.id,effort:'high',seconds:(Date.now()-started)/1000,rawReply:reply.text,message:assistant,analysis:reply.analysis,diagnostics:state.runtimeDiagnostics,source:'Two supplied question-paper images; no manually authored solution injected.'};
        await save(kind, record);
        for (const artifact of assistant.artifacts || []) {
          const blob = widgetBlobs.get(artifact.id);
          if (blob) await fetch('/tests/live-results/' + (['normal','normal2'].includes(kind) ? kind + '-' + artifact.spec.kind : kind) + '.bin', {method:'POST',body:blob});
        }
        results[kind] = {messages:[user,assistant],record};
        status.textContent = kind.toUpperCase() + ': completed in ' + Math.round(record.seconds) + 's' + (assistant.widgetError ? ' — ' + assistant.widgetError : '');
      } catch (error) {
        assistant.generating = false; assistant.footer = error.message; renderMessages(false);
        await save(kind, {kind,model:model.id,seconds:(Date.now()-started)/1000,rawReply:raw,error:error.message,diagnostics:state.runtimeDiagnostics});
        status.textContent = kind.toUpperCase() + ': failed — ' + error.message;
      }
    }
    for (const kind of Object.keys(results)) {
      const button = document.createElement('button'); button.textContent = 'Show fresh ' + kind.toUpperCase(); button.onclick = () => show(kind); toolbar.append(button);
    }
    const chat = results.chat;
    if (chat) {
      show('chat');
      status.textContent = 'Finished: ' + Object.keys(results).join(', ') + '. Chat: ' + document.querySelectorAll('#messages .katex').length + ' KaTeX equations, ' + document.querySelectorAll('#messages .katex-error,.math-display-fallback,.math-inline-fallback').length + ' math errors.';
    }
  };
})();

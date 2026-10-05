(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),wait=async fn=>{const end=Date.now()+10000;while(!fn()){if(Date.now()>end)throw Error('Voice integration condition timed out');await pause(20);}};
 await wait(()=>typeof voiceInput!=='undefined'&&voiceInput);
 const controls=document.createElement('aside');controls.className='voice-audit-controls';controls.style.cssText='position:fixed;left:12px;bottom:12px;z-index:99999;padding:12px;max-width:320px;max-height:30vh;overflow:auto;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:12px;font-size:12px';
 controls.innerHTML='<button id="voice-audit-run">Run voice integration checks</button><button id="voice-audit-show">Show voice button</button><button id="voice-audit-listen">Show recording controls</button><pre id="voice-audit-result">Ready · fake microphone · no audio captured</pre>';document.body.append(controls);
 const output=document.querySelector('#voice-audit-result');let checks=[];try{checks=JSON.parse(sessionStorage.getItem('voice-audit-checks'))||[];}catch(_){}
 if(checks.length)output.textContent='PASS: '+checks.length+' browser checks\n'+checks.join('\n');
 const check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);output.textContent='Running: '+checks.length+' checks passed';};
 const button=()=>document.querySelector('#send-button'),input=()=>document.querySelector('#prompt-input'),speech=()=>qaVoice.instances.at(-1);
 const result=(rows,index=0)=>speech().onresult?.({resultIndex:index,results:rows.map(([text,final])=>Object.assign([{transcript:text}],{isFinal:final}))});
 const ready=async()=>{qaVoice.network=qaVoice.online=true;await voiceInput.refresh();input().value='';autoResize();};
 const report=async error=>{output.textContent=(error?'FAIL: '+error.stack:'PASS: '+checks.length+' browser checks')+'\n'+checks.join('\n');if(!error)sessionStorage.setItem('voice-audit-checks',JSON.stringify(checks));await fetch('/api/voice-audit/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passed:!error,checks,errors:qaErrors,error:error?.stack||''})});};
 document.querySelector('#voice-audit-run').onclick=async()=>{try{
  checks=[];setTheme('dark');OrbitMemories.save({mode:'off',about:''});OrbitWeb.setEnabled(false);document.querySelector('#new-chat').click();await ready();
  check('empty composer shows an enabled waveform button',button().getAttribute('aria-label')==='Start voice input'&&!button().disabled&&button().querySelector('use')?.getAttribute('href')==='#icon-voice');
  check('page load never requests microphone access',qaVoice.instances.length===0);
  input().value='A typed prompt';input().dispatchEvent(new Event('input'));check('typing switches waveform to the Send arrow',button().getAttribute('aria-label')==='Send message'&&button().type==='submit');
  input().value='';input().dispatchEvent(new Event('input'));state.attachments=[{name:'fixture.txt'}];updateSendButton();check('attachment-only messages still use Send',button().getAttribute('aria-label')==='Send message');state.attachments=[];updateSendButton();
  qaVoice.online=false;window.dispatchEvent(new Event('offline'));check('offline immediately disables voice input',button().disabled&&button().title.includes('internet'));
  qaVoice.online=true;qaVoice.network=false;await voiceInput.refresh();check('online LAN without confirmed internet remains disabled',button().disabled);
  await ready();button().click();check('explicit click alone starts listening',!document.querySelector('#voice-status').hidden&&document.querySelector('#voice-status-text').textContent==='Listening…'&&input().readOnly);
  check('dictation uses Indian English by default',speech().lang===OrbitVoice.language());
  result([['Explain regress',false]]);check('interim transcript appears in the input safely',input().value==='Explain regress'&&button().getAttribute('aria-label')==='Finish dictation');
  result([['Explain regression.',true],['Step by step.',true]],0);check('revised transcript does not duplicate earlier words',input().value==='Explain regression. Step by step.');
  const before=qaVoice.requests.length;button().click();check('Finish stops microphone and restores editable Send input',speech().aborted&&!input().readOnly&&document.querySelector('#voice-status').hidden&&button().getAttribute('aria-label')==='Send message');
  check('dictation never sends a message automatically',qaVoice.requests.length===before&&state.messages.length===0);
  // Exercise actual Send with a local synthetic model; no paid inference.
  state.models=[{key:'voice-fixture',id:'voice-fixture',name:'Voice audit model',provider:'Ollama',capabilities:[]}];state.selectedModel='voice-fixture';renderModelOptions();button().click();await wait(()=>!state.sending&&state.messages.some(m=>m.role==='assistant'));
  check('reviewed dictated text submits through normal chat flow',state.messages.find(m=>m.role==='user')?.text==='Explain regression. Step by step.');
  check('generation completion restores empty voice button',button().getAttribute('aria-label')==='Start voice input'&&!button().disabled);
  await ready();button().click();result([['<img src=x onerror=bad> hello',false]]);check('HTML-like recognition remains literal text',input().value.includes('<img')&&!document.querySelector('#composer img'));const late=speech().onresult;document.querySelector('#voice-cancel').click();late({resultIndex:0,results:[Object.assign([{transcript:'late old text'}],{isFinal:true})]});check('Cancel discards transcript and ignores late results',input().value===''&&!input().readOnly&&button().getAttribute('aria-label')==='Start voice input');
  button().click();result([['Keep completed words',true],['Uncertain words',false]]);qaVoice.online=false;window.dispatchEvent(new Event('offline'));check('lost connection stops recording and retains final words only',input().value==='Keep completed words'&&!input().readOnly&&speech().aborted);
  await ready();button().click();result([['Wrong conversation',true]]);document.querySelector('#new-chat').click();await pause(50);check('switching conversations aborts dictation and clears old words',!voiceInput.snapshot().active&&speech().aborted&&input().value==='');
  await ready();button().click();result([['Cancelled with keyboard',true]]);input().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check('Escape cancels dictation',input().value===''&&!voiceInput.snapshot().active);
  button().click();result([['Review before Send',true]]);const sent=qaVoice.requests.length;input().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check('Enter while recording finishes without sending',input().value==='Review before Send'&&qaVoice.requests.length===sent&&!voiceInput.snapshot().active);
  await ready();button().click();speech().onerror({error:'no-speech'});check('no-speech error restores usable voice input',!input().readOnly&&button().getAttribute('aria-label')==='Start voice input'&&!button().disabled);
  openPreferences();const language=document.querySelector('#voice-language-input');language.value='en-GB';savePreferences({preventDefault(){}});await ready();button().click();check('saved accent changes the next recognition session',speech().lang==='en-GB');voiceInput.cancel();
  state.sending=true;updateSendButton();check('generation Stop takes priority over voice controls',button().getAttribute('aria-label')==='Stop generating'&&!button().disabled);state.sending=false;updateSendButton();
  button().click();speech().onerror({error:'not-allowed'});check('denied microphone access fails safely with a clear explanation',button().disabled&&button().title.includes('blocked')&&!input().readOnly);
  check('no browser errors across voice/chat integration',qaErrors.length===0);await report();
 }catch(error){await report(error);}};
 document.querySelector('#voice-audit-show').onclick=async()=>{document.querySelector('#new-chat').click();await ready();};
 document.querySelector('#voice-audit-listen').onclick=async()=>{await ready();button().click();result([['Explain binary search step by step.',false]]);};
})();

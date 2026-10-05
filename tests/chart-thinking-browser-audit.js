/* Disposable localhost fixture: production UI/renderers, synthetic provider only. */
(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(pred)=>{const end=Date.now()+30000;while(!pred()){if(Date.now()>end)throw Error('Browser condition timed out');await pause(30);}};
 await wait(()=>typeof sendPrompt==='function'&&typeof OrbitPreview!=='undefined');
 const controls=document.createElement('aside');controls.style.cssText='position:fixed;left:12px;bottom:12px;z-index:99999;padding:12px;max-width:330px;max-height:40vh;overflow:auto;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:12px;font-size:12px';
 controls.innerHTML='<button id="qa-all">Run all new checks</button><button id="qa-charts">Run chart and export checks</button><button id="qa-think">Run long thinking check</button><button id="qa-hidden">Check hidden reasoning fallback</button><button id="qa-cancel">Check thinking cancellation</button><button id="qa-gantt">Show Gantt</button><button id="qa-heatmap">Show heatmap</button><pre id="qa-result">Ready · local synthetic provider</pre>';document.body.append(controls);
 const checks=[],timings=[],result=document.querySelector('#qa-result'),check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);result.textContent='Running: '+checks.length+' checks passed';};
 const report=async(error)=>{result.textContent=(error?'FAIL: '+error.stack:'PASS: '+checks.length+' browser checks')+'\n'+checks.join('\n');await fetch('/api/chart-thinking/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passed:!error,checks,timings,errors:qaErrors,error:error?.stack||''})});};
 document.querySelector('#qa-charts').onclick=async()=>{try{
  document.querySelector('#new-chat').click();addMessage('user','Show these additional chart types using sample data');
  state.messages.push({role:'assistant',text:'## Additional chart types\n\nIllustrative datasets for the chart audit.',artifacts:chartExpansionFixtures.map((spec,i)=>({id:'chart-expansion-'+i,spec:OrbitWidgets.normalize(spec)}))});renderMessages(false);persistCurrentChat();
  check('all thirteen new types render as charts in the production chat',document.querySelectorAll('#messages .orbit-chart').length===13&&!document.querySelector('#messages .widget-error'));
  const svg=document.querySelectorAll('#messages .chart-plot svg');check('all chart SVGs have accessible descriptions and finite paths',[...svg].every(s=>s.querySelector('desc')&&!/NaN|Infinity|undefined/.test(s.outerHTML)));
  for(let i=0;i<13;i++){
   const figure=document.querySelectorAll('#messages .orbit-chart')[i];figure.querySelector('[data-chart-options]').click();const tableButton=figure.querySelector('[data-chart-type="table"]');tableButton.click();const updated=document.querySelectorAll('#messages .orbit-chart')[i];check(chartExpansionFixtures[i].chartType+' has a working table view',!updated.querySelector('.widget-data').hidden&&!!updated.querySelector('tbody tr'));updated.querySelector('[data-chart-options]').click();updated.querySelector('[data-chart-type="'+chartExpansionFixtures[i].chartType+'"]').click();
  }
  const unitMenu=document.querySelector('.orbit-chart .chart-options-menu');check('expanded chart menu is bounded and scrollable',getComputedStyle(unitMenu).overflowY==='auto'&&parseFloat(getComputedStyle(unitMenu).maxHeight)<=360);
  const all=chartExpansionFixtures.map(visual=>({type:'visual',visual,caption:'Illustrative '+visual.chartType+' data'}));
  for(const kind of ['docx','pdf','pptx']){
   const spec=kind==='pptx'?{kind,title:'New charts export audit',slides:chartExpansionFixtures.map(visual=>({title:visual.title,visual,caption:'Sample data'}))}:{kind,title:'New charts export audit',blocks:all};
   const blob=await OrbitWidgets.generate(spec);check('all thirteen charts embed into '+kind.toUpperCase(),blob.size>3000);
   const bytes=new Uint8Array(await blob.arrayBuffer());check(kind.toUpperCase()+' has the expected file signature',kind==='pdf'?String.fromCharCode(...bytes.slice(0,4))==='%PDF':bytes[0]===80&&bytes[1]===75);
   // Store generated QA binaries locally through this isolated server.
   await fetch('/api/chart-thinking/file?kind='+kind,{method:'POST',body:blob});
  }
  await OrbitChatStore.flush();const saved=await OrbitChatStore.load(state.currentChat);check('all new charts survive persisted chat loading',saved.messages.at(-1).artifacts.length===13&&saved.messages.at(-1).artifacts.every(a=>!!OrbitWidgets.chartSvg(a.spec)));
  check('no browser errors during chart rendering and exports',qaErrors.length===0);await report();
 }catch(error){await report(error);}};
 async function thinking(hidden=false,cancel=false){try{
  await wait(()=>state.models.some(m=>m.provider==='DeepSeek'));const model=state.models.find(m=>m.provider==='DeepSeek');state.selectedModel=model.key;renderModelOptions();OrbitThinking.set(model,'high');OrbitMemories.save({mode:'off',about:''});OrbitWeb.setEnabled(false);setTheme('dark');
  document.querySelector('#new-chat').click();const prompt='Explain regression equations and how to build a project schedule'+(hidden?' hidden reasoning':'')+(cancel?' cancellation test':'');document.querySelector('#prompt-input').value=prompt;
  const started=performance.now(),running=sendPrompt();await wait(()=>document.querySelector('.typing-message .thinking-label')?.textContent==='Thinking');
  const original=document.querySelector('.typing-message .thinking-label'),originalSize=getComputedStyle(original).fontSize;check('thinking initially uses the normal shimmer',!document.querySelector('.typing-message .status-elapsed')&&parseFloat(originalSize)>10);
  await wait(()=>{const s=document.querySelector('.typing-message .thinking-label')?.textContent;return s&&s!=='Thinking'&&s!=='Planning solution checks';});
  const label=document.querySelector('.typing-message .thinking-label'),elapsed=performance.now()-started;timings.push({mode:hidden?'hidden':cancel?'cancel':'reasoning',headlineAtMs:Math.round(elapsed),label:label.textContent});
  check('long thinking shows a 3–7 word headline after about four seconds',elapsed>=3900&&elapsed<6500&&label.textContent.trim().split(/\s+/).length>=3&&label.textContent.trim().split(/\s+/).length<=7);
  check('thinking headline uses the same shimmer and has no counter',getComputedStyle(label).fontSize===originalSize&&!document.querySelector('.typing-message .status-elapsed')&&!/\d/.test(label.textContent));
  if(cancel){document.querySelector('#send-button').click();await running;await pause(2100);check('Stop cancels thinking without later status updates',!state.sending&&!document.querySelector('.typing-message'));}
  else {if(!hidden){await wait(()=>document.querySelector('.typing-message .thinking-label')?.textContent==='Planning the schedule and dependencies');check('headline updates when the reasoning activity changes',true);}await running;check('first answer removes the thinking shimmer',!document.querySelector('.typing-message')&&!state.sending&&state.messages.at(-1)?.text.includes('project schedule'));check('reasoning text is never exposed in the answer',!document.querySelector('#messages').textContent.includes('PRIVATE REASONING'));}
  check('no browser errors during thinking',qaErrors.length===0);await report();
 }catch(error){await report(error);}}
 document.querySelector('#qa-think').onclick=()=>thinking();document.querySelector('#qa-hidden').onclick=()=>thinking(true);document.querySelector('#qa-cancel').onclick=()=>thinking(false,true);
 document.querySelector('#qa-all').onclick=async()=>{for(const id of ['qa-charts','qa-think','qa-hidden','qa-cancel']){await document.querySelector('#'+id).onclick();if(result.textContent.startsWith('FAIL'))return;}};
 async function show(type){if(!state.messages.some(m=>m.artifacts?.some(a=>a.spec.chartType===type))){for(const id of Object.keys(state.savedChats)){const full=await OrbitChatStore.load(id);if(full?.messages?.some(m=>m.artifacts?.some(a=>a.spec.chartType===type))){await loadChat(id);await pause(100);break;}}}followLatest=false;const a=[...document.querySelectorAll('.orbit-chart')].find(f=>f.getAttribute('aria-label')===chartExpansionFixtures.find(s=>s.chartType===type).title);a?.scrollIntoView({block:'center'});}
 document.querySelector('#qa-gantt').onclick=()=>show('gantt');document.querySelector('#qa-heatmap').onclick=()=>show('heatmap');
})();

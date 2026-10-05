/* Fresh integration scenarios on the isolated production UI; no paid API. */
(async()=>{
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),wait=async fn=>{const end=Date.now()+30000;while(!fn()){if(Date.now()>end)throw Error('Fresh integration condition timed out');await pause(25);}};
 await wait(()=>typeof sendPrompt==='function'&&typeof OrbitPreview!=='undefined');
 const controls=document.createElement('aside');controls.style.cssText='position:fixed;left:12px;bottom:12px;z-index:99999;padding:12px;max-width:300px;max-height:35vh;overflow:auto;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:12px;font-size:12px';
 controls.innerHTML='<button id="fresh-run">Run fresh integration cases</button><button id="fresh-reload">Verify saved charts after reload</button><button id="fresh-gantt">Show short Gantt</button><button id="fresh-heatmap">Show extreme heatmap</button><pre id="fresh-result">Ready · isolated synthetic data</pre>';document.body.append(controls);
 const result=document.querySelector('#fresh-result');let checks=[];
 const check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);result.textContent='Running: '+checks.length+' fresh checks passed';};
 const report=async error=>{result.textContent=(error?'FAIL: '+error.stack:'PASS: '+checks.length+' fresh integration checks')+'\n'+checks.join('\n');await fetch('/api/chart-thinking/extreme-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passed:!error,checks,errors:qaErrors,error:error?.stack||''})});};
 let stored;try{stored=JSON.parse(sessionStorage.getItem('chart-fresh-case'));}catch(_){}
 document.querySelector('#fresh-run').onclick=async()=>{try{
  check('fixed assets load in their production order',!!OrbitCharts&&!!OrbitWidgets&&!!OrbitThinking);
  document.querySelector('#new-chat').click();addMessage('user','Show these edge chart datasets');setTheme('dark');
  const lo=46.167420502752066,hi=132.5803894782439,n=29;
  const specs=[
   {kind:'chart',chartType:'gantt',title:'One-day schedule',tasks:[{label:'Review',start:'2026-10-03',end:'2026-10-04'}]},
   {kind:'chart',chartType:'gantt',title:'Forty-task schedule',tasks:Array.from({length:40},(_,i)=>({label:'Task '+i,start:i,end:i+4,progress:i%101}))},
   {kind:'chart',chartType:'histogram',title:'Exact boundary samples',samples:[lo,hi,...Array.from({length:n-1},(_,j)=>lo+(hi-lo)*((j+1)/n))],bins:n},
   {kind:'chart',chartType:'heatmap',title:'Large signed matrix',labels:Array.from({length:30},(_,i)=>'Column '+i),rowLabels:Array.from({length:30},(_,i)=>'Row '+i),values:Array.from({length:30},(_,i)=>Array.from({length:30},(_,j)=>(i+j)%7===0?null:(i-j)*1e10))},
   {kind:'chart',chartType:'bubble',title:'Two hundred coincident bubbles',x:Array(200).fill(2),series:[{name:'Group',values:Array(200).fill(5),sizes:Array.from({length:200},(_,i)=>i%4===0?0:i+1)}]},
   {kind:'chart',chartType:'waterfall',title:'Repeated subtotal changes',labels:['Opening','Loss','Subtotal','Gain','Final'],series:[{name:'Amount',values:[100,-30,70,10,80]}],totals:[2,4]},
   {kind:'chart',chartType:'treemap',title:'Reverse hierarchy with zeros',nodes:[{id:'leaf',parent:'branch',value:2},{id:'zero',parent:'branch',value:0},{id:'branch',parent:'root'},{id:'other',value:3},{id:'root'}]},
   {kind:'chart',chartType:'stacked-bar',title:'Signed stacks <img src=x> & தமிழ் 📊',labels:Array.from({length:40},(_,i)=>'Category '+i),series:Array.from({length:5},(_,j)=>({name:'Series '+j,values:Array.from({length:40},(_,i)=>(i+j)%2?-1e12:1e12)}))},
  ];
  for(let i=0;i<specs.length;i+=4)addMessage('assistant','## Fresh chart cases\n\nSynthetic edge data.',{artifacts:specs.slice(i,i+4).map((spec,j)=>({id:'fresh-'+(i+j),spec:OrbitWidgets.normalize(spec)}))});
  renderMessages(false);await pause(100);check('eight maximum-size and unusual charts render in chat',document.querySelectorAll('#messages .orbit-chart').length===8&&!document.querySelector('#messages .widget-error'));
  const svg=[...document.querySelectorAll('#messages .chart-plot svg')];check('all unusual charts have finite valid SVG',svg.every(s=>!s.querySelector('parsererror')&&!/NaN|Infinity|undefined/.test(s.outerHTML)));
  check('short Gantt date labels are unique and include both endpoints',[...svg[0].querySelectorAll('text[y="385"]')].map(e=>e.textContent).join('|')==='2026-10-03|2026-10-04');
  check('bubble marks fit the chat SVG crop',+svg[4].getAttribute('viewBox').split(' ')[1]<73);
  check('coincident bubble X values have only one axis label',svg[4].querySelectorAll('text[y="393"]').length===1);
  check('trillion-scale axis labels fit their margins',[...svg[7].querySelectorAll('text[x="68"]')].every(t=>t.textContent.length<=10));
  check('markup-like chart title stays inert and legible',document.querySelectorAll('#messages .orbit-chart img,#messages .orbit-chart script,#messages .orbit-chart iframe').length===0&&document.querySelectorAll('#messages .orbit-chart')[7].textContent.includes('<img src=x>'));
  const histogram=OrbitWidgets.chartData(OrbitWidgets.normalize(specs[2]));check('histogram table matches exact-boundary membership',histogram.rows.every((row,i)=>row[2]===(i===28?2:1)));
  const matrix=OrbitWidgets.chartData(OrbitWidgets.normalize(specs[3]));check('matrix table keeps missing separate from zero',matrix.rows.flat().includes('Missing')&&matrix.rows.flat().includes(0));
  for(let i=0;i<specs.length;i++){
   let figure=document.querySelectorAll('#messages .orbit-chart')[i];figure.querySelector('[data-chart-options]').click();figure.querySelector('[data-chart-type="table"]').click();figure=document.querySelectorAll('#messages .orbit-chart')[i];check(specs[i].title+' table works',!!figure.querySelector('tbody tr')&&!figure.querySelector('.widget-data').hidden);
   figure.querySelector('[data-chart-options]').click();figure.querySelector('[data-chart-type="'+specs[i].chartType+'"]').click();
  }
  const special=document.querySelectorAll('#messages .orbit-chart')[5];special.querySelector('[data-chart-options]').click();check('waterfall conversion cannot reinterpret signed changes as ordinary categories',[...special.querySelectorAll('[data-chart-type]')].map(b=>b.dataset.chartType).join('|')==='table|waterfall');special.querySelector('[data-chart-options]').click();
  OrbitWidgets.setEnabled('chart',false);try{await OrbitWidgets.generate(specs[0]);throw Error('Disabled chart unexpectedly generated');}catch(error){check('disabled chart tool blocks export',/disabled/.test(error.message));}finally{OrbitWidgets.setEnabled('chart',true);}
  const artifacts=state.messages.flatMap(m=>m.artifacts||[]);
  for(const kind of ['docx','pdf','pptx']){
   const recipe={kind,title:'Fresh extreme chart exports',...(kind==='pptx'?{slides:artifacts.map(a=>({title:a.spec.title,visual:{artifactId:a.id}}))}:{blocks:artifacts.map(a=>({type:'visual',visual:{artifactId:a.id},caption:a.spec.title}))})};
   const resolved=OrbitWidgets.resolveVisuals(recipe,artifacts),original=JSON.stringify(resolved),edited=OrbitDocumentEdits.apply(resolved,[{op:'replace',path:['title'],before:recipe.title,value:'Updated extreme chart exports'}]);
   check(kind+' title edit preserves all eight chart recipes',JSON.stringify(edited.blocks||edited.slides)===JSON.stringify(resolved.blocks||resolved.slides)&&JSON.stringify(resolved)===original);
   const blob=await OrbitWidgets.generate(edited);check(kind+' export with resolved charts and narrow edit succeeds',blob.size>3000);await fetch('/api/chart-thinking/extreme-file?kind='+kind,{method:'POST',body:blob});
  }
  const typing=addTypingIndicator('Solve regression equations');setReplyStatus(typing,'Thinking');await wait(()=>typing.querySelector('.thinking-label')?.textContent==='Working through regression equations');check('long thinking headline appears in real UI with no clock',!typing.querySelector('.status-elapsed'));
  typing.thinkingActivity.activity(OrbitThinking.activity('Z transform'));setReplyStatus(typing,'Analyzing');check('Analyze alone retains its visible counter',!!typing.querySelector('.status-elapsed'));
  setReplyStatus(typing,'Writing the next section');await pause(2300);check('pending thinking update cannot overwrite a document stage',typing.querySelector('.thinking-label')?.textContent==='Writing the next section'&&!typing.querySelector('.status-elapsed'));typing.thinkingActivity.stop();typing.remove();
  const first=document.querySelector('.orbit-chart');first.querySelector('[data-chart-options]').click();first.querySelector('[data-chart-type="table"]').click();await persistCurrentChat();await OrbitChatStore.flush();
  stored={chat:state.currentChat,checks:checks.slice()};sessionStorage.setItem('chart-fresh-case',JSON.stringify(stored));check('no browser errors in fresh integration scenarios',qaErrors.length===0);await report();
 }catch(error){await report(error);}};
 document.querySelector('#fresh-reload').onclick=async()=>{try{
  if(!stored)throw Error('Run the fresh cases before reloading');checks=stored.checks.slice();await wait(()=>state.currentChat===stored.chat&&state.messages.flatMap(m=>m.artifacts||[]).length===8);
  check('eight new charts survive a full website reload',document.querySelectorAll('#messages .orbit-chart').length===8);
  check('table selection survives a full website reload',!document.querySelector('.orbit-chart .widget-data').hidden);
  check('restored histogram still retains exact counts',OrbitWidgets.chartData(state.messages.flatMap(m=>m.artifacts||[])[2].spec).rows.every((row,i)=>row[2]===(i===28?2:1)));
  check('restored charts render without browser errors',qaErrors.length===0);await report();
 }catch(error){await report(error);}};
 const show=async title=>{const first=document.querySelectorAll('.orbit-chart')[0];if(title==='One-day schedule'&&!first.querySelector('.widget-data').hidden){first.querySelector('[data-chart-options]').click();first.querySelector('[data-chart-type="gantt"]').click();}await pause(100);followLatest=false;[...document.querySelectorAll('.orbit-chart')].find(e=>e.getAttribute('aria-label')===title)?.scrollIntoView({block:'center'});};
 document.querySelector('#fresh-gantt').onclick=()=>show('One-day schedule');document.querySelector('#fresh-heatmap').onclick=()=>show('Large signed matrix');
})();

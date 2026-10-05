(async()=>{
 while(typeof OrbitPreview==='undefined')await new Promise(r=>setTimeout(r,50));
 // Disposable, deterministic tests of production rendering and preview entry points.
 // No chat writes and no model requests.
 persistCurrentChat=()=>{};state.currentChat='adversarial-browser-audit';state.currentTitle='Interrupted files and rapid interactions';
 const results=[],check=(passed,name)=>{results.push({name,passed:!!passed});if(!passed)throw Error(name);};
 const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const errors=[];addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
 const raw=s=>'```orbit-widget\n'+s;
 const statusCases=[
  [raw('{"kind":"pdf","blocks":[{"text":"Software process models","type":"heading"}'),'Adding heading Software process models'],
  [raw('{"kind":"pdf","blocks":[{"type":"heading","text":"Real chapter"},{"text":"SECRET BODY"'),'Writing Real chapter'],
  [raw('{"kind":"docx","title":"Study guide","metadata":{"type":"heading","text":"SECRET METADATA"}'),'Writing Study guide'],
  [raw('{"kind":"pdf","blocks":[{"text":[{"text":"Styled "},{"text":"heading"}],"type":"heading"}'),'Adding heading Styled heading']
 ];
 for(const [draft,expected]of statusCases){
  state.messages=[{role:'assistant',generating:true,text:'I’ll prepare the document.\n\n'+draft}];renderMessages(false);
  check(document.querySelector('.widget-status')?.textContent===expected,'Correct visible activity: '+expected);
  check(!document.querySelector('#messages').textContent.includes('"kind"'),'Hidden draft: '+expected);
  check(!document.querySelector('.widget-status [data-status-start]'),'Writing has no clock: '+expected);
 }
 const typing=addTypingIndicator();setReplyStatus(typing,'Analyzing');await new Promise(r=>setTimeout(r,1100));
 const elapsed=typing.querySelector('.status-elapsed'),label=typing.querySelector('.thinking-label');
 check(/Analyzing\s+1 sec/.test(typing.textContent),'Analyze clock advances');
 check(getComputedStyle(elapsed).fontSize===getComputedStyle(label).fontSize,'Analyze clock matches shimmer size');
 setReplyStatus(typing,'Rendering the software guide');check(!typing.querySelector('[data-status-start]'),'Clock removed on stage switch');typing.remove();
 const saved=await(await fetch('/tests/fixtures/pdf-draft-leak.json')).json();
 const spec=saved.artifacts[0].spec;
 const broken='{ "title":"Reordered guide","kind":"pdf","blocks":[{"type":"visual","visual":'+JSON.stringify(architecture)+'},BROKEN]}';
 state.messages=[{role:'assistant',text:'Before\n'+broken+'\nAfter',artifacts:[{id:'legacy-file',spec,position:broken.length+7}]}];renderMessages(false);
 check(!document.querySelector('#messages').textContent.includes('BROKEN'),'Saved reordered draft stays hidden');
 check(document.querySelectorAll('[data-preview-widget]').length===1,'Saved draft retains one file card');
 state.messages=[{role:'assistant',text:'| Month | Revenue |\n|---|---|\n| Jan | 10 |\n| Feb | 20 |'}];renderMessages(false);
 const chart=tableChartSpec(document.querySelector('#messages table'));
 for(let i=0;i<30;i++)appendTableChart(state.messages[0],chart);renderMessages(false);
 check(state.messages[0].artifacts.length===1,'Thirty repeated Chart actions create one artifact');
 const restored=JSON.parse(JSON.stringify(state.messages[0]));appendTableChart(restored,chart);
 check(restored.artifacts.length===1,'Reloaded chart stays unique');
 const open=async name=>OrbitPreview.show({attachment:{name,file:new Blob(['%PDF-1.7'])}});
 let destroyed=0;const load=deferred(),loadingStarted=deferred();
 window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>{loadingStarted.resolve();return {promise:load.promise,destroy:async()=>{destroyed++;}};}};
 await open('pending.pdf');const loading=document.querySelector('.preview-pdf-fallback').onclick();await loadingStarted.promise;document.querySelector('#preview-close').click();
 check(destroyed===1,'Close cancels loading immediately');load.resolve({numPages:1});await loading;
 check(document.querySelector('#file-preview').hidden,'Late load cannot reopen closed preview');
 const page=deferred(),pageStarted=deferred();let rendered=0,cleaned=0;
 window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:()=>{pageStarted.resolve();return page.promise;}}),destroy:async()=>{}})};
 await open('old.pdf');const stale=document.querySelector('.preview-pdf-fallback').onclick();await pageStarted.promise;await open('new.pdf');
 page.resolve({render(){rendered++;throw Error('Stale page rendered');},cleanup(){cleaned++;}});await stale;
 check(rendered===0 && cleaned===1,'Switched PDF cannot render a stale page');
 check(document.querySelector('#preview-name').textContent==='new.pdf','New preview name stays correct');
 const viewport=({scale})=>({width:600*scale,height:400*scale});
 window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getViewport:viewport,render:()=>({promise:Promise.reject(Error('Synthetic raster failure')),cancel(){}}),cleanup(){}})}),destroy:async()=>{}})};
 await open('retry.pdf');await document.querySelector('.preview-pdf-fallback').onclick();
 check(document.querySelector('.preview-pdf-fallback')?.disabled===false,'Raster failure exposes a visible retry');
 check(!document.querySelector('#preview-download').disabled,'Raster failure retains original download');OrbitPreview.close();delete window.pdfjsLib;
 const artifactSpecs=[spec,{...spec,kind:'docx',title:'Adversarial Word guide'},modernDeck,{kind:'xlsx',title:'Adversarial workbook',sheets:[{name:'Data',headers:['Row','Description','Value'],rows:Array.from({length:215},(_,i)=>[i+1,'Record '+(i+1),i%2?'0012':i*2])},{name:'Empty',headers:['Value'],rows:[]}]}];
 const artifacts=[];
 for(const input of artifactSpecs){
  const normalized=OrbitWidgets.normalize(input),blob=await OrbitWidgets.generate(normalized),id=crypto.randomUUID();
  widgetBlobs.set(id,blob);artifacts.push({id,spec:normalized,size:blob.size});
  check(blob.size>1000,'Real '+normalized.kind+' binary exists');
  check((await blob.slice(0,5).text()).startsWith(normalized.kind==='pdf'?'%PDF':'PK'),'Correct '+normalized.kind+' signature');
  const response=await fetch('/audit-save/adversarial-'+normalized.kind+'.'+normalized.kind,{method:'POST',body:blob});
  check(response.ok,'Saved '+normalized.kind+' audit binary');
 }
 state.messages=[{role:'user',text:'Make files containing the diagrams, and keep the content intact.'},{role:'assistant',text:'# Verified file recovery\n\nAll four file formats were generated locally. The previous drafts stay hidden and the preview controls remain usable.',artifacts}];renderMessages(false);renderConversationTitle();
 // Exercise actual previews, including the native readers, before manual visual QA.
 for(const artifact of artifacts){
  await OrbitPreview.show({artifact});
  check(!document.querySelector('#preview-download').disabled,'Download available in '+artifact.spec.kind+' preview');
  if(artifact.spec.kind==='pdf')check(!!document.querySelector('#preview-body iframe'),'PDF native preview opens');
  if(artifact.spec.kind==='docx')check(!!document.querySelector('iframe[data-word-preview]'),'Word isolated preview opens');
  if(artifact.spec.kind==='pptx')check(document.querySelectorAll('.presentation-frame').length===10,'PowerPoint preserves all ten slides');
  if(artifact.spec.kind==='xlsx'){
   const grid=document.querySelector('.sheet-grid');check(grid.querySelectorAll('tbody tr').length===100,'Workbook paginates its first hundred rows');
   const nav=document.querySelector('.sheet-nav');nav.lastElementChild.click();nav.lastElementChild.click();
   check(grid.querySelectorAll('tbody tr').length===15,'Workbook final fifteen rows are retained');
   document.querySelectorAll('.sheet-tabs button')[1].click();check(grid.querySelectorAll('tbody tr').length===0,'Empty sheet opens without stale rows');
  }
  document.querySelector('#preview-close').click();
  check(!document.querySelector('.app-shell').inert,'Closing '+artifact.spec.kind+' restores chat input');
 }
 check(errors.length===0,'No unhandled promises during the browser audit');
 const output=document.createElement('pre');output.id='adversarial-result';output.hidden=true;output.textContent=JSON.stringify({results,errors});document.body.append(output);
 await fetch('/audit-save/adversarial-browser-results.json',{method:'POST',body:JSON.stringify({results,errors})});
})().catch(error=>{const output=document.createElement('pre');output.id='adversarial-error';output.textContent=error.stack;document.body.append(output);console.error(error);});

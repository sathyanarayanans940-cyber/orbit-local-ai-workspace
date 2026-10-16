const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../widgets.js'),L=require('../long-documents.js');
const prose=n=>Array.from({length:n},(_,i)=>'detail'+i).join(' ');
const legacy={id:'saved-file',spec:{kind:'docx',title:'Saved report',blocks:[{type:'paragraph',text:String.raw`Ratio \frac{a+b}{c}. Qualification: c is nonzero.`}]},revision:2,documentVersions:[{id:'previous',name:'Previous version'}]};
function ui(extra={}){
 const message={role:'assistant',text:'Saved report',artifacts:[structuredClone(legacy)]};
 const ctx={OrbitWidgets:W,state:{currentChat:'chat-a',models:[{key:'test'}],selectedModel:'test',messages:[{role:'user',text:'Create the report, keeping the qualification.'},message]},crypto:require('crypto').webcrypto,renderMessages(){},persistCurrentChat:async()=>true,escapeHtml:v=>String(v).replaceAll('<','&lt;'),...extra};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('widgets-ui.js','utf8')+'\nglobalThis.cache=widgetBlobs;',ctx);
 message.artifacts=ctx.normalizedWidgetArtifacts(message.artifacts);return {ctx,message};
}
test('saved legacy recipes survive repeated storage normalization and expose repair without raw TeX in markup',()=>{
 const {ctx,message}=ui();assert.equal(message.artifacts.length,1);const a=message.artifacts[0];
 assert.equal(a.needsRepair,true);assert.equal(a.id,legacy.id);assert.equal(a.revision,2);assert.equal(a.spec.blocks[0].text,legacy.spec.blocks[0].text);assert.equal(a.documentVersions[0].id,'previous');
 const again=ctx.normalizedWidgetArtifacts(JSON.parse(JSON.stringify(message.artifacts)));assert.equal(again.length,1);assert.equal(again[0].spec.blocks[0].text,a.spec.blocks[0].text);
 const html=ctx.widgetMarkup(message,0);assert.match(html,/data-widget-repair/);assert.doesNotMatch(html,/\\frac/);
 assert.throws(()=>W.normalize(a.spec),/Raw LaTeX/);
 assert.equal(ctx.normalizedWidgetArtifacts([{spec:{kind:'shell'}}]).length,0);
});
test('saved-file repair exports actual Word bytes and preserves ID, revision history and qualification',async()=>{
 const E=await import('../widgets-engine.js'),JSZip=require('jszip');let calls=0;
 const {ctx,message}=ui({OrbitWidgets:{...W,generate:s=>E.generate(s)},requestLocalReply:async(_,messages)=>{
  calls++;assert.match(messages[1].text,/nonzero/);return {text:JSON.stringify({repairs:[{index:0,widget:{kind:'docx',title:'Saved report',blocks:[{type:'paragraph',text:'Ratio (a+b)/c. Qualification: c is nonzero.'}]}}]})};
 }});
 const updated=await ctx.repairSavedWidget(message,message.artifacts[0]);assert.equal(calls,1);assert.equal(updated.id,legacy.id);assert.equal(updated.revision,2);assert.equal(updated.needsRepair,undefined);assert.equal(updated.documentVersions[0].id,'previous');
 const zip=await JSZip.loadAsync(await ctx.cache.get(legacy.id).arrayBuffer());assert.match(await zip.file('word/document.xml').async('string'),/c is nonzero/);
});
test('failed or cancelled repairs preserve the original recipe and cannot announce success',async()=>{
 for(const mode of ['invalid','storage','cancel','switch']){
  let calls=0;const c=new AbortController();
  const h=ui({persistCurrentChat:async()=>mode!=='storage',OrbitWidgets:{...W,generate:async()=>new Blob(['file'])},requestLocalReply:async()=>{
   calls++;if(mode==='cancel')c.abort();if(mode==='switch')h.ctx.state.currentChat='chat-b';
   return {text:JSON.stringify({repairs:[{index:0,widget:mode==='invalid'?legacy.spec:{kind:'docx',blocks:[{type:'paragraph',text:'Ratio (a+b)/c. Qualification: c is nonzero.'}]}}]})};
  }});
  const before=JSON.stringify(h.message.artifacts[0]);await assert.rejects(h.ctx.repairSavedWidget(h.message,h.message.artifacts[0],c.signal));assert.equal(JSON.stringify(h.message.artifacts[0]),before,mode);assert.ok(calls<=2);assert.equal(h.ctx.cache.size,0);
 }
});
test('file cache respects recent reads, replacement accounting and oversized bypass',()=>{
 const {ctx}=ui(),cache=ctx.cache,MB=1024*1024;
 cache.set('a',{size:12*MB});cache.set('b',{size:12*MB});cache.get('a');cache.set('c',{size:12*MB});assert.equal(cache.has('a'),true);assert.equal(cache.has('b'),false);assert.equal(cache.bytes,24*MB);
 cache.set('huge',{size:40*MB});assert.equal(cache.size,2);assert.equal(cache.bytes,24*MB);
 cache.set('a',{size:5});assert.equal(cache.bytes,12*MB+5);cache.delete('c');assert.equal(cache.bytes,5);cache.clear();assert.equal(cache.bytes,0);
});
test('length estimates respond to geometry and font spacing, and allocate unequal sections without one-section-per-page',async()=>{
 const scope={kind:'docx',count:8};assert.ok(L.lengthPlan(scope,{word:{body:{size:16,lineSpacing:2}}}).targetWords<L.lengthPlan(scope,{word:{body:{size:10,lineSpacing:1}}}).targetWords);
 assert.equal(L.lengthPlan(scope,{},'Write 2,000 words').targetWords,2000);
 const seen=[];const out=await L.build('Create a Word report of maximum 8 pages',{model:{id:'test'},context:[],instruction:'',normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB:null}),plan:async messages=>{
  const t=JSON.parse(messages[1].text);if(!t.sectionNumber)return JSON.stringify({title:'Report',sections:[{title:'Introduction',brief:'Scope',targetWords:100},{title:'Analysis',brief:'Main argument',targetWords:600},{title:'Conclusion',brief:'Synthesis',targetWords:120}]});
  seen.push(t.contentBudget.targetWords);return JSON.stringify({blocks:[{type:'paragraph',text:prose(t.contentBudget.targetWords)}]});
 }});assert.deepEqual(seen,[100,600,120]);assert.equal(W.extract(out.text).artifacts[0].blocks.length,3);
});
test('section-specific sources reduce transmitted context while keeping instructions and supporting lossless expansion',async()=>{
 const context=L.sourceContext([{role:'user',text:'REQUIREMENT: retain every qualification.',source:'a'},{role:'assistant',text:'Source two'}],m=>m.source?m.text+'\n'+prose(6000):'LATE FACT: denominator must be nonzero.\n'+prose(6000));
 const store=L.createCheckpoints({indexedDB:null});let expanded=false;const sizes=[];
 await L.build('Create a Word report of maximum 8 pages',{model:{id:'test'},context,instruction:'',normalize:W.normalize,checkpointStore:store,plan:async messages=>{
  const t=JSON.parse(messages[1].text);if(!t.sectionNumber)return JSON.stringify({title:'Report',sections:[{title:'One',brief:'First source',targetWords:100,sourceContextIds:['C1']},{title:'Two',brief:'Second source',targetWords:100,sourceContextIds:['C2']}]});
  const source=JSON.stringify(t.sourceContext);assert.match(source,/REQUIREMENT/);assert.equal(t.sourceCatalog.length,2);
  if(t.sectionNumber===1&&!expanded){sizes.push(source.length);expanded=true;assert.doesNotMatch(source,/LATE FACT/);return JSON.stringify({sourceRequests:['C2']});}
  if(t.sectionNumber===1){assert.match(source,/LATE FACT/);assert.ok(source.length>sizes[0]*1.8);}
  else{assert.match(source,/LATE FACT/);assert.ok(source.length<JSON.stringify(context).length*.6);}
  return JSON.stringify({blocks:[{type:'paragraph',text:prose(100)}]});
 }});assert.equal(expanded,true);
});
test('finished drafts survive export failure and reload without any new model calls',async()=>{
 const {IDBFactory}=require('fake-indexeddb'),indexedDB=new IDBFactory(),name='export-recovery';let calls=0;
 const base={model:{id:'test'},context:[],instruction:'',normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB,name}),plan:async messages=>{calls++;const t=JSON.parse(messages[1].text);return JSON.stringify(t.sectionNumber?{blocks:[{type:'paragraph',text:prose(100)}]}:{title:'Report',sections:[{title:'A',brief:'A',targetWords:100},{title:'B',brief:'B',targetWords:100}]});}};
 const first=await L.build('Create a Word report of maximum 8 pages',base);assert.equal(calls,3);assert.ok((await base.checkpointStore.get(first.documentCheckpoint)).readySpec);
 const reloaded=L.createCheckpoints({indexedDB,name});const second=await L.build('Create a Word report of maximum 8 pages',{...base,checkpointStore:reloaded,plan:()=>assert.fail('No redrafting before export success')});assert.equal(second.text,first.text);
 await L.complete(second.documentCheckpoint,reloaded);assert.equal(await reloaded.get(second.documentCheckpoint),null);
});
test('UI releases a checkpoint only after every export and chat persistence succeeds',async()=>{
 for(const mode of ['success','export-failure','save-failure','cancel']){
  let completed=0;const c=new AbortController();const h=ui({OrbitWidgets:{...W,generate:async()=>{if(mode==='export-failure')throw Error('Export failed');if(mode==='cancel')c.abort();return new Blob(['valid']);}},OrbitLongDocuments:{complete:async key=>{assert.equal(key,'draft-key');completed++;}},persistCurrentChat:async()=>mode!=='save-failure'});
  h.message.artifacts=[];h.message.text='```orbit-widget\n'+JSON.stringify({kind:'docx',title:'Report',blocks:[{type:'paragraph',text:'Complete report'}]})+'\n```';h.message.documentCheckpoint='draft-key';
  await h.ctx.finalizeMessageWidgets(h.message,'Create a Word report',c.signal);assert.equal(completed,mode==='success'?1:0,mode);if(mode!=='success')assert.equal(h.message.documentCheckpoint,'draft-key');
 }
});
test('repair updates identical file cards together but preserves distinct revisions',async()=>{
 const {ctx,message}=ui({OrbitWidgets:{...W,generate:async()=>new Blob(['file'])},requestLocalReply:async()=>({text:JSON.stringify({repairs:[{index:0,widget:{kind:'docx',title:'Saved report',blocks:[{type:'paragraph',text:'Ratio (a+b)/c. Qualification: c is nonzero.'}]}}]})})});
 const duplicate={role:'assistant',artifacts:[structuredClone(message.artifacts[0])]},different={role:'assistant',artifacts:[{...structuredClone(message.artifacts[0]),spec:{kind:'docx',title:'Separate revision',blocks:[{type:'paragraph',text:'Earlier contents.'}]}}]};ctx.state.messages.push(duplicate,different);
 const updated=await ctx.repairSavedWidget(message,message.artifacts[0]);assert.equal(duplicate.artifacts[0],updated);assert.equal(different.artifacts[0].spec.title,'Separate revision');
});
test('invalid saved recipes remain indexed and survive real chat persistence',async()=>{
 const {IDBFactory}=require('fake-indexeddb'),bad={id:'broken-archive',spec:{kind:'zip',title:'Legacy archive',files:[{path:'report.docx',widget:legacy.spec}]}};
 const chat={title:'Archive recovery',messages:[{role:'assistant',text:'Saved archive',artifacts:[bad]}]};
 const ctx=vm.createContext({indexedDB:new IDBFactory(),localStorage:{getItem:()=>JSON.stringify({a:chat}),removeItem(){}},structuredClone,OrbitWidgets:{...W,filename(){throw Error('Invalid nested recipe');}}});
 vm.runInContext(fs.readFileSync('chat-store.js','utf8'),ctx);const s=ctx.OrbitChatStore,index=await s.ready;
 try{assert.equal(index.a.files[0].name,'Legacy archive.zip');assert.deepEqual((await s.load('a')).messages,chat.messages);s.adopt(index);index.a={...chat,title:'Updated archive'};await s.save(index);assert.deepEqual((await s.load('a')).messages,chat.messages);}finally{s.close();}
});
test('viewer blocks an invalid saved recipe even when its old binary is cached',async()=>{
 const {previewHarness}=require('./helpers/preview-harness.cjs');let exports=0;
 const h=previewHarness({}, {globals:{OrbitWidgets:{...W,generate(){exports++;throw Error('Should not generate');}},widgetBlobs:new Map([[legacy.id,new Blob(['old file'])]])}});
 await h.preview.show({artifact:{...structuredClone(legacy),needsRepair:true}});assert.match(h.body.textContent,/Use Repair file/);assert.equal(exports,0);assert.equal(h.controls['#preview-download'].disabled,true);
});
test('repeated and unknown source expansion requests terminate without committing invented content',async()=>{
 for(const unknown of [false,true]){let calls=0;const context=L.sourceContext([{role:'user',text:'Keep original facts.'}],m=>m.text);
  await assert.rejects(L.build('Create a Word report of maximum 8 pages',{model:{id:'test'},context,instruction:'',normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB:null}),plan:async messages=>{
   calls++;const t=JSON.parse(messages[1].text);return JSON.stringify(!t.sectionNumber?{title:'Report',sections:[{title:'A',brief:'A',targetWords:100,sourceContextIds:[]},{title:'B',brief:'B',targetWords:100,sourceContextIds:[]}]}:{sourceRequests:[unknown?'nonexistent':'C1']});
  }}),unknown?/existing context IDs/:/three expansions/);assert.ok(calls<=5);
 }
 assert.equal(L.lengthPlan({kind:'docx',count:8},{},'Write 90,000 words').targetWords,90000);
});
test('final export measures direct PDF recipes outside the long-document drafting path',async()=>{
 const recipe={kind:'pdf',title:'Direct report',blocks:[{type:'paragraph',text:'Complete evidence and qualifications. '.repeat(50)}]};
 const seen=[];const h=ui({OrbitLongDocuments:L,OrbitWidgets:{...W,generate:async(spec,options)=>{seen.push(options.measureOnly===true);return options.measureOnly?{pages:12}:new Blob(['PDF bytes']);}}});
 h.message.text='```orbit-widget\n'+JSON.stringify(recipe)+'\n```';h.message.artifacts=[];
 await h.ctx.finalizeMessageWidgets(h.message,'Create a 12 page PDF');
 assert.deepEqual(seen,[true,false]);assert.match(h.message.text,/12 pages \(requested 12\)/);assert.equal(h.message.artifacts[0].size,9);
});
test('final export reports unavoidable overflow honestly without losing the downloadable PDF',async()=>{
 const recipe={kind:'pdf',title:'Verbatim report',blocks:[{type:'paragraph',text:'Complete original text. '.repeat(50)}]};
 const h=ui({OrbitLongDocuments:L,OrbitWidgets:{...W,generate:async(spec,options)=>options.measureOnly?{pages:37}:new Blob(['PDF bytes'])}});
 h.message.text='```orbit-widget\n'+JSON.stringify(recipe)+'\n```';h.message.artifacts=[];
 await h.ctx.finalizeMessageWidgets(h.message,'Create a 12 page PDF, keep the text verbatim');
 assert.match(h.message.text,/37 pages \(requested 12\)/);assert.match(h.message.text,/exceeds the limit/);assert.equal(h.message.artifacts[0].error,undefined);
});
test('final export discloses unresolved underflow and retains a downloadable PDF',async()=>{
 const recipe={kind:'pdf',title:'Brief evidence',blocks:[{type:'paragraph',text:'Complete original text. '.repeat(50)}]};
 const h=ui({OrbitLongDocuments:L,OrbitWidgets:{...W,generate:async(spec,options)=>options.measureOnly?{pages:8}:new Blob(['PDF bytes'])},requestLocalReply:async()=>({text:'{"additions":[]}'})});
 h.message.text='```orbit-widget\n'+JSON.stringify(recipe)+'\n```';h.message.artifacts=[];
 await h.ctx.finalizeMessageWidgets(h.message,'Create a 12 page PDF');
 assert.match(h.message.text,/8 pages \(requested 12\)/);assert.match(h.message.text,/shorter than requested/);assert.equal(h.message.artifacts[0].error,undefined);assert.equal(h.message.artifacts[0].size,9);
});
test('contextual PDF followups retain a maximum rather than turning it into an exact count',async()=>{
 const recipe={kind:'pdf',title:'Brief evidence',blocks:[{type:'paragraph',text:'Complete original text. '.repeat(50)}]};
 const h=ui({OrbitLongDocuments:L,OrbitWidgets:{...W,generate:async(spec,options)=>options.measureOnly?{pages:8}:new Blob(['PDF bytes'])},requestLocalReply:async()=>assert.fail('No expansion for a maximum')});
 h.ctx.state.messages[0].text='Create a PDF up to 12 pages';h.message.text='```orbit-widget\n'+JSON.stringify(recipe)+'\n```';h.message.artifacts=[];
 await h.ctx.finalizeMessageWidgets(h.message,'Make it now');
 assert.match(h.message.text,/8 pages \(requested up to 12\)/);assert.doesNotMatch(h.message.text,/shorter/);assert.equal(h.message.artifacts[0].error,undefined);
});

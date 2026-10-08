const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),JSZip=require('jszip');
const W=require('../widgets.js'),L=require('../long-documents.js'),A=require('../archives.js');
const doc=(title='Report',kind='docx')=>({kind,title,blocks:[{type:'paragraph',text:'Complete content: '+title}]});
const chart={kind:'chart',title:'Counts',chartType:'bar',labels:['A','B'],series:[{name:'Count',values:[1,2]}]};
const diagram={kind:'diagram',title:'Flow',width:600,height:240,nodes:[{id:'a',label:'A',x:150,y:120},{id:'b',label:'B',x:450,y:120}],edges:[{from:'a',to:'b'}]};
const fence=s=>'```orbit-widget\n'+(typeof s==='string'?s:JSON.stringify(s))+'\n```';
function ui(text,{history=[],repair,generate,settings}={}){
 const message={role:'assistant',text},calls={repairs:0,generated:[]};
 const ctx={OrbitWidgets:{...W,...(settings?{settings}:{}),generate:async s=>{calls.generated.push(s);return generate?generate(s):new Blob(['valid']);}},crypto:require('node:crypto').webcrypto,state:{messages:[...history,message],models:[{key:'local'}],selectedModel:'local'},renderMessages(){},persistCurrentChat(){},requestLocalReply:async(_,messages)=>{calls.repairs++;return {text:await repair?.(JSON.parse(messages[1].text))||'{"repairs":[]}'};}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);return {ctx,message,calls};
}

test('repair cannot exceed four file/chart widgets when malformed slots precede valid ones',async()=>{
 const h=ui([fence('{"kind":"pdf",BAD}'),fence('{"kind":"docx",BAD}'),...Array.from({length:3},(_,i)=>fence(doc('Good '+i)))].join('\n'),{repair:r=>JSON.stringify({repairs:r.slots.map(s=>({index:s.index,widget:doc('Repaired '+s.index,s.kind)}))})});
 await h.ctx.finalizeMessageWidgets(h.message,'Create Word and PDF documents');
 assert.ok(h.calls.generated.length<=4,`Generated ${h.calls.generated.length} files`);assert.equal(h.message.artifacts.filter(a=>a.spec.title.startsWith('Good')).length,3);assert.match(h.message.widgetError,/four|limit/);
});
test('exhausted widget capacity does not trigger a missing-requested-kind repair',async()=>{
 const h=ui(Array.from({length:4},(_,i)=>fence(doc('PDF '+i,'pdf'))).join('\n'),{repair:()=>assert.fail('No capacity for another file')});
 await h.ctx.finalizeMessageWidgets(h.message,'Create a Word document');assert.equal(h.calls.repairs,0);assert.equal(h.calls.generated.length,4);assert.match(h.message.widgetError,/four|limit/);assert.doesNotMatch(h.message.text,/Done —/);
});
test('repair context retains an old user format brief despite many recent assistant messages',()=>{
 const history=[{role:'user',text:'Required: Times New Roman 11pt, single spacing. Topic: sensor security.'},...Array.from({length:18},(_,i)=>({role:'assistant',text:'Discussion '+i})),{role:'user',text:'Now make the Word document'}];
 const h=ui('Where is the topic?',{history});const c=h.ctx.fileRepairContext(h.message);assert.match(JSON.stringify(c),/Times New Roman/);assert.match(JSON.stringify(c),/sensor security/);
});
test('repair context does not let a giant recent assistant draft displace short user requirements',()=>{
 const history=[{role:'user',text:'Keep AUTHORITATIVE-BRIEF. Font 11pt.'},{role:'assistant',text:'filler '.repeat(25000)},{role:'user',text:'Make the Word document'}];
 const h=ui('Bad draft',{history});const c=h.ctx.fileRepairContext(h.message);assert.match(JSON.stringify(c),/AUTHORITATIVE-BRIEF/);assert.ok(c.reduce((n,m)=>n+m.text.length,0)<=120000);assert.ok(c.some(m=>m.truncated));
});
test('read-only source page counts and cancelled or replaced briefs cannot become new output lengths',()=>{
 const follow='Now make a detailed Word document';
 for(const history of [
  [{role:'user',text:'Read this 12 page Word document.'}],
  [{role:'user',text:'Create a 12 page Word report.'},{role:'user',text:'Cancel that report. We are done with it.'}],
  [{role:'user',text:'Create a 12 page Word report.'},{role:'user',text:'Make it three pages instead.'}],
 ])assert.equal(L.target(follow,history),null,JSON.stringify(history));
 assert.equal(L.target('Do not make a 12 page Word document'),null);
 assert.equal(L.target('How do I create a 12 page PDF?'),null);
});
test('countless incidental words do not attach a new topic to an old page brief',()=>{
 const history=[{role:'user',text:'Make a 12 page Word research report about sensors.'}];
 for(const p of ['Now create a Word document about gardening','Create a PDF explaining how to use it','Make a Word document on this JavaScript feature'])assert.equal(L.target(p,history),null,p);
});
test('successful widgets survive neighboring repair failure and renderer failure without false all-ready',async()=>{
 const h=ui([fence(doc('Good')),fence('{"kind":"pdf",BAD}'),fence(chart)].join('\n'),{repair:()=>'{"repairs":[]}',generate:s=>{if(s.kind==='chart')throw Error('Renderer unavailable');return new Blob(['real']);}});
 await h.ctx.finalizeMessageWidgets(h.message,'Create a Word document and chart');assert.equal(h.calls.repairs,1);assert.equal(h.message.artifacts[0].error,undefined);assert.equal(h.message.artifacts[1].error,'Renderer unavailable');assert.ok(h.message.widgetError);assert.doesNotMatch(h.message.text,/Done —/);
});
test('abort while first file exports never starts subsequent widgets or announces success',async()=>{
 const c=new AbortController();let release;const h=ui([doc('One'),doc('Two'),chart].map(fence).join('\n'),{generate:()=>new Promise(r=>release=r)});
 const pending=h.ctx.finalizeMessageWidgets(h.message,'Create Word documents',c.signal);assert.equal(h.calls.generated.length,1);c.abort();release(new Blob(['late']));await pending;assert.equal(h.calls.generated.length,1);assert.doesNotMatch(h.message.text,/Done —/);assert.equal(h.message.artifacts.length,0);
});
test('late repair cancellation cannot create any returned artifact',async()=>{
 const c=new AbortController();const h=ui(fence('{"kind":"docx",BAD}'),{repair:r=>{c.abort();return JSON.stringify({repairs:[{index:r.slots[0].index,widget:doc()}]});}});await h.ctx.finalizeMessageWidgets(h.message,'Create a Word document',c.signal);assert.equal(h.calls.generated.length,0);assert.equal(h.message.widgetPendingKind,undefined);
});
test('fresh export matrix preserves nested real files, exact code, empty cells and literal spreadsheet strings',async()=>{
 global.OrbitWidgetEngine=await import('../widgets-engine.js');
 const source='\ufeff# Unicode λ 😀\r\nprint("literal \\n and \\\\ path")\r\n';
 const specs=[doc('Research'),{kind:'pdf',title:'PDF',blocks:[{type:'code',language:'python',text:source}]},{kind:'pptx',title:'Slides',slides:[{layout:'cover',title:'Cover'},{title:'Data',table:{headers:['A','B'],rows:[['zero','0'],['negative','-1']]},notes:'Keep every row.'}]},{kind:'xlsx',title:'Literal values',sheets:[{name:'Data',headers:['Value'],rows:[['=1+1'],['0012'],[0],[false],[null]]}]},{kind:'ipynb',filename:'demo.ipynb',cells:[{cell_type:'markdown',source:''},{cell_type:'code',source}]},{kind:'text',filename:'main.py',content:source},chart,diagram];
 const ext={docx:'docx',pdf:'pdf',pptx:'pptx',xlsx:'xlsx',ipynb:'ipynb',text:'py',chart:'svg',diagram:'svg'};
 const recipe={kind:'zip',filename:'mixed.zip',entries:[...specs.map((s,i)=>({path:'project/files/'+i+'.'+ext[s.kind],file:s})),{path:'project/empty/',directory:true}]};
 const bytes=await (await W.generate(W.normalize(recipe))).arrayBuffer(),zip=await JSZip.loadAsync(bytes);assert.ok(zip.files['project/empty/'].dir);
 for(const i of [0,2,3]){const child=await JSZip.loadAsync(await zip.file('project/files/'+i+'.'+ext[specs[i].kind]).async('uint8array'));assert.ok(Object.keys(child.files).length>5);}
 assert.equal((await zip.file('project/files/1.pdf').async('string')).slice(0,4),'%PDF');assert.equal(await zip.file('project/files/5.py').async('string'),source);
 const notebook=JSON.parse(await zip.file('project/files/4.ipynb').async('string'));assert.equal(notebook.cells[0].source,'');assert.equal(notebook.cells[1].source,source);assert.deepEqual(notebook.cells[1].outputs,[]);
 const x=await JSZip.loadAsync(await zip.file('project/files/3.xlsx').async('uint8array')),XLSX=require('../vendor/sheetjs/xlsx.full.min.js'),book=XLSX.read(await x.generateAsync({type:'uint8array'}),{type:'array'});assert.equal(book.Sheets.Data.A2.v,'=1+1');assert.equal(book.Sheets.Data.A2.f,undefined);assert.equal(book.Sheets.Data.A3.v,'0012');assert.equal(book.Sheets.Data.A4.v,0);assert.equal(book.Sheets.Data.A5.v,false);
 const opened=await A.open(new File([bytes],'mixed.zip'));assert.ok(opened.entries.some(e=>e.path==='project/files/0.docx'));
});

test('case-normalized diagram limits hold across 40 valid recipes',()=>{
 for(const kind of ['diagram','DIAGRAM','Diagram']){const r=W.extract(Array.from({length:40},(_,i)=>fence({...diagram,kind,title:'Step '+i})).join('\n'));assert.equal(r.artifacts.length,32,kind);assert.equal(r.errors.length,8);}
});
test('recognized format aliases use the same bounded repair path',async()=>{
 for(const kind of ['DOCX','word','doc']){const h=ui(fence({kind,blocks:[]}),{repair:r=>JSON.stringify({repairs:[{index:r.slots[0].index,widget:doc('Fixed')}]})});await h.ctx.finalizeMessageWidgets(h.message,'Please fix the file');assert.equal(h.calls.repairs,1,kind);assert.equal(h.message.artifacts.length,1);assert.equal(h.message.widgetError,undefined);}
});
test('duplicate repair indexes and wrong kinds never replace a failed original',async()=>{
 for(const mode of ['duplicate','wrong-kind','unknown-index']){const h=ui(fence('{"kind":"docx",BAD}'),{repair:r=>JSON.stringify({repairs:mode==='duplicate'?[{index:0,widget:doc()},{index:0,widget:doc()}]:[{index:mode==='unknown-index'?99:0,widget:doc('Wrong','pdf')}]})});await h.ctx.finalizeMessageWidgets(h.message,'Create a Word document');assert.equal(h.calls.repairs,1);assert.equal(h.calls.generated.length,0);assert.ok(h.message.widgetError);}
});
test('40 repaired mixed slots stay within independent file and diagram budgets',async()=>{
 const raw=[...Array.from({length:34},()=>fence('{"kind":"diagram",BAD}')),...Array.from({length:6},()=>fence('{"kind":"pdf",BAD}'))].join('\n');
 const h=ui(raw,{repair:r=>{assert.equal(r.slots.length,36);return JSON.stringify({repairs:r.slots.map(s=>({index:s.index,widget:s.kind==='diagram'?diagram:doc('Report','pdf')}))});}});await h.ctx.finalizeMessageWidgets(h.message,'Draw diagrams and create PDF reports');assert.equal(h.calls.repairs,1);assert.equal(h.message.artifacts.filter(a=>a.spec.kind==='diagram').length,32);assert.equal(h.message.artifacts.filter(a=>a.spec.kind==='pdf').length,4);assert.ok(h.message.widgetError);assert.doesNotMatch(h.message.text,/Done —/);
});
test('regeneration repair context excludes future replies and preserves exact source recipes',()=>{
 const h=ui('failed',{history:[{role:'user',text:'Please preserve EXACT requirements.'},{role:'assistant',text:'Source',artifacts:[{spec:doc('Earlier source')}]}]});h.ctx.state.messages.push({role:'user',text:'FUTURE SECRET MUST NOT LEAK'});const c=JSON.stringify(h.ctx.fileRepairContext(h.message));assert.match(c,/Earlier source/);assert.match(c,/EXACT/);assert.doesNotMatch(c,/FUTURE/);
});
test('largest supported slide count and tall worksheet keep their last records after real export',async()=>{
 const {generate}=await import('../widgets-engine.js');
 const ppt={kind:'pptx',title:'Boundary deck',slides:Array.from({length:40},(_,i)=>({title:'Slide '+(i+1),bullets:['Evidence '+i],notes:'Detailed notes '+i}))};
 const deck=await JSZip.loadAsync(await (await generate(W.normalize(ppt))).arrayBuffer());assert.equal(Object.keys(deck.files).filter(k=>/^ppt\/slides\/slide\d+\.xml$/.test(k)).length,40);assert.match(await deck.file('ppt/slides/slide40.xml').async('string'),/Evidence 39/);assert.match(await deck.file('ppt/notesSlides/notesSlide40.xml').async('string'),/Detailed notes 39/);
 const sheet={kind:'xlsx',title:'Boundary workbook',sheets:[{name:'Records',headers:Array.from({length:26},(_,i)=>'C'+i),rows:Array.from({length:1000},(_,i)=>Array.from({length:26},(_,j)=>i*26+j))}]};
 const blob=await generate(W.normalize(sheet)),XLSX=require('../vendor/sheetjs/xlsx.full.min.js'),book=XLSX.read(await blob.arrayBuffer(),{type:'array'});assert.equal(book.Sheets.Records.Z1001.v,25999);assert.equal(book.Sheets.Records['!ref'],'A1:Z1001');
 assert.throws(()=>W.normalize({...ppt,slides:[...ppt.slides,ppt.slides[0]]}));assert.throws(()=>W.normalize({...sheet,sheets:[{...sheet.sheets[0],rows:[...sheet.sheets[0].rows,sheet.sheets[0].rows[0]]}]}));
});


test('document body instructions do not cancel an explicit long deliverable',()=>{
 assert.deepEqual(L.target('Create a 12 page Word document explaining how to use stacks. Do not generate charts.'),{kind:'docx',count:12});
 assert.equal(L.target('Explain how to create a 12 page Word document'),null);
});

test('anaphoric Word promise triggers repair with prior user format and topic',async()=>{
 const history=[{role:'user',text:'I need a short Word document about stacks. Times New Roman 11 pt.'},{role:'assistant',text:'Ready to prepare it.'},{role:'user',text:'Okay, now make it.'}];
 const h=ui('I will prepare the Word document.',{history,repair:r=>{assert.equal(r.slots[0].kind,'docx');assert.match(JSON.stringify(r.sourceContext),/stacks/);return JSON.stringify({repairs:[{index:0,widget:doc('Stacks')}]});}});await h.ctx.finalizeMessageWidgets(h.message,'Okay, now make it.');assert.equal(h.calls.repairs,1);assert.equal(h.message.artifacts[0].spec.kind,'docx');assert.equal(h.message.widgetError,undefined);
});
test('anaphoric recovery never inherits code/ZIP/notebook authorization or future requests',()=>{
 const h=ui('Unused');for(const text of ['Create a downloadable main.py file','Create a ZIP containing a PDF','Create a Jupyter notebook','Create a Word document and a PDF'])assert.equal(h.ctx.requestedFileKind('now make it',[{role:'user',text}]),'',text);
 assert.equal(h.ctx.requestedFileKind('now make it',[{role:'user',text:'Read this Word document.'}]),'');
 assert.equal(h.ctx.requestedFileKind('now make it',[{role:'user',text:'Create a Word document.'},{role:'user',text:'Cancel that report.'}]),'');
 assert.equal(h.ctx.requestedFileKind('Explain it',[{role:'user',text:'Create a Word document.'}]),'');
});

test('one targeted schema retry repairs only the failed file and receives the exact error',async()=>{
 let attempt=0;
 const h=ui([fence(doc('Original')),fence('{"kind":"pdf",BAD}')].join('\n'),{repair:r=>{
  attempt++;assert.equal(r.slots.length,1);assert.equal(r.slots[0].kind,'pdf');
  if(attempt===1)return JSON.stringify({repairs:[{index:r.slots[0].index,widget:{kind:'pdf',title:'Requested report',blocks:[]}}]});
  assert.match(r.slots[0].validationError,/at least|empty|item/i);assert.equal(JSON.parse(r.slots[0].draft).title,'Requested report');
  return JSON.stringify({repairs:[{index:r.slots[0].index,widget:doc('Requested report','pdf')}]});
 }});
 await h.ctx.finalizeMessageWidgets(h.message,'Create a Word and PDF document');assert.equal(attempt,2);assert.equal(h.calls.generated.length,2);assert.equal(h.message.widgetError,undefined);assert.equal(h.message.artifacts[0].spec.title,'Original');
});
test('targeted repair stops after two schema failures and does not invent an output',async()=>{
 const h=ui(fence('{"kind":"docx",BAD}'),{repair:r=>JSON.stringify({repairs:[{index:r.slots[0].index,widget:{kind:'docx',blocks:[]}}]})});
 await h.ctx.finalizeMessageWidgets(h.message,'Make a Word document');assert.equal(h.calls.repairs,2);assert.equal(h.calls.generated.length,0);assert.ok(h.message.widgetError);
});
test('malformed single-file repair gets one parse-error retry without guessed content',async()=>{
 let attempt=0;const h=ui(fence('{"kind":"docx",BAD}'),{history:[{role:'user',text:'Create a Word document about stacks.'}],repair:r=>{
  attempt++;if(attempt===1)return '{"repairs":[{"index":0,"widget":{"kind":"docx","title" "Stacks","blocks":[]}}]}';
  assert.match(r.slots[0].validationError,/not valid JSON/);assert.match(JSON.stringify(r.sourceContext),/stacks/);return JSON.stringify({repairs:[{index:0,widget:doc('Stacks')}]});
 }});
 await h.ctx.finalizeMessageWidgets(h.message,'Create a Word document about stacks');assert.equal(attempt,2);assert.equal(h.message.artifacts.length,1);assert.equal(h.message.widgetError,undefined);
});
test('cancel during second targeted repair never exports the late result',async()=>{
 const controller=new AbortController();const h=ui(fence('{"kind":"pdf",BAD}'),{repair:r=>{
  if(h.calls.repairs===1)return JSON.stringify({repairs:[{index:0,widget:{kind:'pdf',blocks:[]}}]});
  controller.abort();return JSON.stringify({repairs:[{index:0,widget:doc('Late','pdf')}]});
 }});
 await h.ctx.finalizeMessageWidgets(h.message,'Make a PDF',controller.signal);assert.equal(h.calls.repairs,2);assert.equal(h.calls.generated.length,0);
});

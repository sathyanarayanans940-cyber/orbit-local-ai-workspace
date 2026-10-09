const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),W=require('../widgets.js'),L=require('../long-documents.js');
const doc=(kind='docx')=>({kind,title:'Sensor report',blocks:[{type:'paragraph',text:'Sensor fact 42.'}]});
const fence=s=>'```orbit-widget\n'+JSON.stringify(s)+'\n```';
function ui(history=[],text='I will prepare it.',extra={}){
 const message={role:'assistant',text},calls=[];const ctx={OrbitWidgets:{...W,generate:async()=>new Blob(['valid'])},crypto:require('node:crypto').webcrypto,state:{models:[{key:'m'}],selectedModel:'m',messages:[...history,message]},renderMessages(){},persistCurrentChat(){},requestLocalReply:async(_,m)=>{calls.push(JSON.parse(m[1].text));return {text:'{"repairs":[]}'};},...extra};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);return {ctx,message,calls};
}
test('document intent survives content words and unrelated negative constraints',()=>{
 const h=ui();for(const p of ['Create a Word document explaining how to use stacks','Make a PDF. Do not add a cover page.','Create a Word document; don’t use web search'])assert.ok(h.ctx.requestedFileKind(p),p);
 for(const p of ['Do not create a Word document','How can I create a PDF?','Please never make a PDF','Don’t create a Word document'])assert.equal(h.ctx.requestedFileKind(p),'',p);
});
test('latest format-only amendment wins over the original requested format',()=>{
 const h=ui();const history=[{role:'user',text:'Create a Word document about sensors.'},{role:'user',text:'PDF instead.'}];assert.equal(h.ctx.requestedFileKind('Okay, now make it.',history),'pdf');
});
test('long-document numeric length amendment keeps original format and replaces old count',()=>{
 const history=[{role:'user',text:'Create a 12 page Word report about sensors.'},{role:'user',text:'Make it 9 pages instead.'}];assert.deepEqual(L.target('Now make it',history),{kind:'docx',count:9});
});
test('repair retains older document recipes even after many intervening short replies',()=>{
 const history=[{role:'user',text:'Create a Word report about sensors.'},{role:'assistant',text:'Ready.',artifacts:[{id:'old',spec:doc()}]},...Array.from({length:18},(_,i)=>({role:'assistant',text:'Small aside '+i})),{role:'user',text:'Export the earlier report as PDF.'}];const h=ui(history);assert.match(JSON.stringify(h.ctx.fileRepairContext(h.message)),/Sensor fact 42/);
});
test('a giant latest user paste cannot erase earlier source attachments and brief',()=>{
 const history=[{role:'user',text:'AUTHORITATIVE font Times New Roman',attachments:[{name:'facts.txt'}]},{role:'user',text:'START '+('filler '.repeat(20000))+' END-INSTRUCTION: keep the conclusion.'}];const h=ui(history,'Draft',{modelTextForMessage:m=>m.text+(m.attachments?'\nATTACHED-SOURCE: sensor=42':'')});const c=h.ctx.fileRepairContext(h.message);assert.match(JSON.stringify(c),/AUTHORITATIVE/);assert.match(JSON.stringify(c),/ATTACHED-SOURCE/);assert.match(JSON.stringify(c),/END-INSTRUCTION/);assert.ok(c.reduce((n,m)=>n+m.text.length,0)<=120000);assert.ok(c.some(m=>m.truncated));
});
test('malformed opportunistic widgets receive original user context even without an explicit file format',async()=>{
 const h=ui([{role:'user',text:'Explain the SENSOR-TOPIC using my values.'}],'```orbit-widget\n{"kind":"chart",BAD}\n```');await h.ctx.finalizeMessageWidgets(h.message,'Explain it');assert.match(JSON.stringify(h.calls[0].sourceContext),/SENSOR-TOPIC/);
});
test('regeneration cannot resolve a visual using an artifact from a future message',async()=>{
 const visual={kind:'diagram',title:'Future',nodes:[{id:'a',label:'A',x:100,y:100}],edges:[]};const h=ui([],fence({kind:'docx',blocks:[{type:'visual',visual:{artifactId:'future'}}]}));h.ctx.state.messages.push({role:'assistant',text:'Later',artifacts:[{id:'future',spec:visual}]});await h.ctx.finalizeMessageWidgets(h.message,'Create a Word document');assert.match(h.message.artifacts[0].error,/unavailable/i);
});
test('invalid outline formatting is repaired before drafting any long-document sections',async()=>{
 let outlines=0,sections=0;const outline={title:'Report',style:{word:{body:{size:999}}},sections:Array.from({length:8},(_,i)=>({title:'Section '+i,brief:'Subject '+i}))};
 const result=await L.build('Create an 8 page Word report',{model:{id:'3b'},context:[],instruction:'',normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB:null}),plan:async m=>{
  const t=JSON.parse(m[1].text);if(!t.sectionNumber){outlines++;if(outlines===1)return JSON.stringify(outline);assert.equal(sections,0);assert.match(m.at(-1).text,/size|font/i);return JSON.stringify({...outline,style:{word:{body:{size:11}}}});}
  sections++;return JSON.stringify({blocks:[{type:'paragraph',text:('Substantive explanation ').repeat(250)}]});
 }});assert.equal(outlines,2);assert.equal(sections,8);assert.equal(W.extract(result.text).artifacts[0].style.word.body.size,11);
});
test('explicit cancellation and text-only amendments cannot revive an older file request',()=>{
 const h=ui(),base=[{role:'user',text:'Create a Word document about sensors.'}];
 for(const text of ['No files, show it here in chat.','Do not create the document anymore.','Cancel that.'])assert.equal(h.ctx.requestedFileKind('Now make it',[...base,{role:'user',text}]),'',text);
 assert.equal(h.ctx.requestedFileKind('Do not now make it',base),'');
});
test('long-document source selection retains an old generated recipe as conversion evidence',()=>{
 const history=[{role:'assistant',text:'Ready',artifacts:[{spec:doc()}]},...Array.from({length:12},()=>({role:'assistant',text:'Aside'}))];
 assert.match(JSON.stringify(L.sourceContext(history,m=>JSON.stringify(m))),/Sensor fact 42/);
});
test('long-document format amendment changes Word to PDF without changing the page target',()=>{
 const history=[{role:'user',text:'Create a 12 page Word report.'},{role:'user',text:'PDF instead.'}];assert.deepEqual(L.target('Now make it',history),{kind:'pdf',count:12});
});
test('unsupported presentation theme has a safe fallback without losing slides',async()=>{
 let slides=0;const out={title:'Deck',theme:'unsupported',sections:Array.from({length:8},(_,i)=>({title:'Topic '+i,brief:'Point '+i}))};
 const r=await L.build('Create an 8 slide PowerPoint',{model:{id:'3b'},context:[],instruction:'',normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB:null}),plan:async m=>{const t=JSON.parse(m[1].text);if(!t.sectionNumber)return JSON.stringify(out);slides++;return JSON.stringify({slides:[{title:'Slide '+slides,bullets:['Fact '+slides]}]});}});
 assert.equal(slides,8);const spec=W.extract(r.text).artifacts[0];assert.equal(spec.theme,'midnight');assert.equal(spec.slides[7].bullets[0],'Fact 8');
});
test('context budget is deterministic across Unicode and many independent sources',()=>{
 const history=Array.from({length:60},(_,i)=>({role:i%2?'assistant':'user',text:'Requirement '+i+' '+('🌍 data ').repeat(300),artifacts:[{spec:{...doc(),title:'Source '+i}}]}));
 const h=ui(history),a=h.ctx.fileRepairContext(h.message),b=h.ctx.fileRepairContext(h.message);assert.deepEqual(a,b);assert.ok(a.reduce((n,m)=>n+m.text.length,0)<=120000);assert.equal(a.length,60);for(let i=0;i<60;i++)assert.match(a[i].text,new RegExp('Source '+i));
});
test('inherited instructions allow unrelated prohibitions but honor a later no-file amendment',()=>{
 const h=ui();for(const text of ['Create an 8 page Word document explaining how to use stacks.','Create an 8 page Word document; do not add a cover.']){
  const history=[{role:'user',text}];assert.equal(h.ctx.requestedFileKind('Now make it',history),'docx');assert.deepEqual(L.target('Now make it',history),{kind:'docx',count:8});
 }
 const history=[{role:'user',text:'Create a 12 page Word report.'},{role:'user',text:'No files, show it here in chat.'}];assert.equal(L.target('Now make it',history),null);
});
test('context clipping never splits an astral Unicode character',()=>{
 for(let i=0;i<4;i++){const h=ui([{role:'user',text:'x'.repeat(i)+'🌍'.repeat(100000)}]);const context=h.ctx.fileRepairContext(h.message);assert.equal(context[0].text.isWellFormed(),true);assert.ok(context[0].text.length<=120000);}
});
test('repair context reaches a real Word export with the original facts and requested formatting',async()=>{
 const {generate}=await import('../widgets-engine.js'),JSZip=require('jszip');let exported;
 const h=ui([{role:'user',text:'Create a Word report in Times New Roman 11 point.'},{role:'assistant',text:'Earlier source',artifacts:[{id:'old',spec:doc()}]},...Array.from({length:18},()=>({role:'assistant',text:'Aside'})),{role:'user',text:'Now make it'}],'I will prepare it.',{
  OrbitWidgets:{...W,generate:async spec=>{exported=await generate(spec);return exported;}},
  requestLocalReply:async(_,messages)=>{const payload=JSON.parse(messages[1].text);assert.match(JSON.stringify(payload.sourceContext),/Sensor fact 42/);assert.match(JSON.stringify(payload.sourceContext),/Times New Roman 11/);return {text:JSON.stringify({repairs:[{index:0,widget:{...doc(),style:{word:{body:{font:'Times New Roman',size:11}}}}}]})};}
 });
 await h.ctx.finalizeMessageWidgets(h.message,'Now make it');assert.ok(exported?.size>1000,JSON.stringify(h.message));assert.equal(h.message.artifacts[0].error,undefined);
 const zip=await JSZip.loadAsync(await exported.arrayBuffer()),xml=await zip.file('word/document.xml').async('string'),styles=await zip.file('word/styles.xml').async('string');assert.match(xml,/Sensor fact 42/);assert.match(xml+styles,/Times New Roman/);assert.match(xml+styles,/w:sz w:val="22"/);
});
test('a page-count brief awaiting its topic is not authorization to draft a speculative paper',()=>{
 for(const end of ['I will tell the topic.','ill tell the topic','I’ll provide the source next.'])assert.equal(L.target('I have a report to make, maximum 12 pages, Word document. '+end),null);
 assert.deepEqual(L.target('The topic is sensors. Now make it',[{role:'user',text:'The report should be 12 pages, Word document. I will tell the topic.'}]),{kind:'docx',count:12});
});

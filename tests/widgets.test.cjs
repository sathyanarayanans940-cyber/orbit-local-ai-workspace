const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../widgets.js');
const JSZip = require('jszip');
const document = {kind:'pdf', title:'Offline study notes', blocks:[{type:'heading',text:'Overview'},{type:'paragraph',text:'Orbit creates this file locally. No network or Python is required.'},{type:'bullets',items:['Review the concepts','Practise with examples']},{type:'table',headers:['Topic','Score'],rows:[['Algorithms','82'],['Databases','91']]}]};
const chart = {kind:'chart', title:'Study scores',chartType:'bar',labels:['Algorithms','Databases'],series:[{name:'Score',values:[82,91]}]};
test('document activity follows actual structure with bounded plain labels',()=>{
 const begin='```orbit-widget\n{"kind":"pdf","title":"Software guide","blocks":[';
 const heading='{"type":"heading","text":"Software process models"},';
 assert.equal(W.streamingStatus(begin+heading),'Adding heading Software process models');
 assert.equal(W.streamingStatus(begin+heading+'{"type":"paragraph","text":"PRIVATE BODY'),'Writing Software process models');
 assert.equal(W.streamingStatus(begin+heading+'{"type":"table",'),'Building the document table');
 assert.equal(W.streamingStatus(begin+heading+'{"type":"image",'),'Placing the uploaded image');
 assert.equal(W.streamingStatus(begin+heading+'{"type":"visual","visual":{"kind":"diagram","title":"Cloud architecture"'),'Drawing diagram Cloud architecture');
 const long=W.activityLabel('Writing','A very long title with many extra words and punctuation','Writing content');
 assert.ok(long.split(/\s+/).length<=6);
 assert.doesNotMatch(W.activityLabel('Writing','<script>\nunsafe</script>','Writing content'),/[<>\n]/);
 assert.equal(W.streamingStatus('Normal response with no widget'),'');
});
test('malformed bare document drafts remain hidden and repair as one slot',async()=>{
  const vm=require('node:vm'),fixture=require('./fixtures/pdf-draft-leak.json');
  const draft=fixture.text.slice(0,fixture.text.indexOf('\n\nDone —'));
  const parsed=W.extract(draft);
  assert.equal(parsed.slots.length,1);assert.equal(parsed.slots[0].kind,'pdf');
  assert.equal(parsed.artifacts.length,0);assert.doesNotMatch(parsed.text,/"blocks"|"kind"|"nodes"/);
  assert.match(parsed.slots[0].raw,/The Bridge Solution/);
  for(const scenario of ['success','failure']) {
    const message={role:'assistant',text:draft};let generated=0;
    const ctx={OrbitWidgets:{...W,generate:async spec=>{generated++;assert.equal(spec.blocks.length,32);return new Blob(['pdf']);}},crypto:require('node:crypto').webcrypto,state:{models:[{key:'test'}],selectedModel:'test',messages:[message]},renderMessages(){},persistCurrentChat(){},async requestLocalReply(_,history){
      const request=JSON.parse(history[1].text);assert.equal(request.slots.length,1);assert.equal(request.slots[0].kind,'pdf');
      return {text:JSON.stringify({repairs:[scenario==='success'?{index:0,widget:fixture.artifacts[0].spec}:{index:0,error:'Cannot safely repair'}]})};
    }};
    vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
    await ctx.finalizeMessageWidgets(message,'a pdf too bro');
    assert.doesNotMatch(message.text,/"blocks"|"kind"|"nodes"/);
    assert.equal(generated,scenario==='success'?1:0);
    assert.equal(message.text.includes('Done —'),scenario==='success');
  }
});
test('broken tool formats hide at streaming boundaries without eating source examples',()=>{
  const broken='{"kind":"pdf","blocks":[{"type":"paragraph","text":"Body"},BROKEN]}';
  for(const wrapper of [s=>s,s=>'```json\n'+s+'\n```',s=>'```orbit-widget\n'+s+'\n```']){
    const full='Before\n'+wrapper(broken)+'\nAfter';const parsed=W.extract(full);
    assert.equal(parsed.slots.length,1);assert.equal(parsed.text,'Before\n\nAfter');
  }
  const nested='{"kind":"pdf","blocks":[{"visual":'+JSON.stringify(chart);
  assert.equal(W.extract(nested).slots.length,1);assert.equal(W.extract(nested).artifacts.length,0);
  for(let n=13;n<=broken.length;n++)assert.doesNotMatch(W.streamingText('Before\n'+broken.slice(0,n)),/"kind"|"blocks"/);
  for(const text of ['```javascript\n'+broken+'\n```','Example: `'+broken+'`','{"example":'+JSON.stringify(chart)+',BAD}'])assert.equal(W.extract(text).text,text);
});
test('inline widget fences recover without leaking recipes while streaming',()=>{
  const reply='I will prepare it. ```orbit-widget\n'+JSON.stringify(document)+'```';
  assert.equal(W.extract(reply).artifacts.length,1);
  assert.equal(W.streamingText(reply).trim(),'I will prepare it.');
  assert.equal(W.streamingStatus(reply),'Building the document table');
});
test('double-escaped Python suites require repair, while literal strings remain intact',()=>{
  assert.throws(()=>W.normalize({...document,blocks:[{type:'code',language:'python',text:'for i in range(5):\\n    print("hello")'}]}),/double-escaped/);
  const source='print("literal \\n stays literal")';
  assert.equal(W.normalize({...document,blocks:[{type:'code',text:source}]}).blocks[0].text,source);
});
test('format repair is bounded, validated, cancellable and respects disabled tools',async()=>{
  const vm=require('node:vm');
  for(const scenario of ['success','invalid','wrong-kind','cancel','disabled']) {
    let calls=0,generated=0;
    const controller=new AbortController();
    const message={role:'assistant',text:'I’ll prepare it.\n```orbit-widget\n{"kind":"pdf",BROKEN}\n```',widgetPendingKind:'pdf'};
    const context={OrbitWidgets:{...W,settings:()=>({pdf:scenario!=='disabled',docx:true}),generate:async()=>{generated++;return new Blob(['real']);}},crypto:require('node:crypto').webcrypto,state:{models:[{key:'test'}],selectedModel:'test',messages:[message]},renderMessages(){},persistCurrentChat(){},async requestLocalReply(prompt,history,options){
      calls++;assert.equal(options.repairing,true);assert.equal(history.length,2);
      if(scenario==='cancel') controller.abort();
      return {text:scenario==='invalid'?'broken':JSON.stringify({...document,kind:scenario==='wrong-kind'?'docx':'pdf'})};
    }};
    vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),context);
    await context.finalizeMessageWidgets(message,'Create a PDF',controller.signal);
    assert.equal(calls,scenario==='disabled'?0:1);
    assert.equal(generated,scenario==='success'?1:0);
    assert.equal(/Done —/.test(message.text),scenario==='success');
    assert.equal(message.widgetStatus,undefined);
  }
});
test('export filenames are portable and saved failures retain their explanation', () => {
  for (const title of ['CON','con.txt','PRN','AUX','NUL','COM1','LPT9','COM¹','LPT²']) {
    assert.match(W.filename({title,kind:'docx'}), /^Orbit /);
  }
  assert.equal(W.filename({title:'   ... ',kind:'pdf'}),'Orbit file.pdf');
  assert.equal(W.filename({title:'Notes. ',kind:'pdf'}),'Notes.pdf');
  const vm=require('node:vm'),context={OrbitWidgets:W,crypto:require('node:crypto').webcrypto}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  const saved=context.normalizedWidgetArtifacts([{id:'failed',spec:document,error:'Creation failed'}]);
  assert.equal(saved[0].error,'Creation failed');
});
test('installers preserve source certificates and validate before stopping Windows tasks', () => {
  const mac=fs.readFileSync(path.join(__dirname,'../install-macos.sh'),'utf8');
  const win=fs.readFileSync(path.join(__dirname,'../install-windows.ps1'),'utf8');
  assert.doesNotMatch(mac,/^\s+remove_source_certificates\s*$/m);
  assert.doesNotMatch(win,/^Remove-SourceCertificates\s*$/m);
  assert.ok(win.indexOf('Missing bundled KaTeX assets.') < win.indexOf('Stop-ScheduledTask -TaskName'));
});
test('document introductions are visible before preparation, without leaking recipes',()=>{
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const context={OrbitWidgets:W,isImageFile:()=>false,widgetOptionsForMessage:()=>({allowTextFiles:false})};vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function visibleMessageText('),source.indexOf('function messageContentMarkup(')),context);
  for(const kind of ['pdf','docx','pptx']) {
    const intro='I’ll prepare a study guide covering loops and examples.';
    const message={role:'assistant',generating:true,widgetPendingKind:kind,text:intro};
    assert.equal(context.visibleMessageText(message),intro);
    assert.equal(W.streamingStatus(message.text),'');
    message.text+='\n```orbit-widget\n{"kind":"'+kind+'","title":"Loops';
    assert.equal(context.visibleMessageText(message).trim(),intro);
    assert.equal(W.streamingStatus(message.text),W.preparingLabel(kind));
    message.generating=false;
    assert.equal(context.visibleMessageText(message).trim(),intro);
  }
  assert.equal(W.fileIntroduction('I have created the Word document.'),'I’ll prepare the Word document.');
});
test('announcements cannot become fake documents and failed replies cannot recover downloads', () => {
  const vm=require('node:vm'),context={OrbitWidgets:W,crypto:require('node:crypto').webcrypto}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  assert.throws(()=>context.fallbackDocument('docx','I have created the Word document for your lab exercise. It includes implementations and results.'), /did not supply/);
  assert.equal(context.fallbackDocument('docx','# Lab exercise\n\nActual document content.').blocks.length,2);
  assert.equal(context.recoverMessageWidgets({role:'assistant',footer:'Response stopped',text:JSON.stringify(chart)}),false);
});
test('stream updates retain the shimmer clock', () => {
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const oldAnimation={currentTime:950},newAnimation={currentTime:0}; let replaced=false;
  const content={querySelector:()=>({getAnimations:()=>[replaced?newAnimation:oldAnimation]}),set innerHTML(value){replaced=true;}};
  const context={chatScrollSnapshot:()=>({}),restoreChatScroll(){},$:()=>content,messageContentMarkup:()=>'<p>Preparing PDF</p>',addTableChartButtons(){}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function updateAssistantArticle('),source.indexOf('function startEditing(')),context);
  context.updateAssistantArticle({}, {generating:true},0);
  assert.equal(newAnimation.currentTime,950);
});
test('validates documents and all chart types', () => {
  assert.equal(W.normalize(document).blocks.length,4);
  for(const chartType of ['bar','line','pie']) assert.match(W.chartSvg({...chart,chartType}),/^<svg/);
  assert.throws(()=>W.normalize({...chart,series:[{values:[NaN,2]}]}));
  assert.throws(()=>W.normalize({...chart,chartType:'pie',series:[{values:[-1,2]}]}));
  assert.throws(()=>W.normalize({...document,blocks:[{type:'html',text:'<script>'}]}));
  assert.throws(()=>W.normalize({...chart,labels:Array(41).fill('x')}));
});
test('extracts tool blocks without executing code or swallowing prose', () => {
  const source='Here is your chart.\n```orbit-widget\n'+JSON.stringify(chart)+'\n```\nThe end.';
  const result=W.extract(source);
  assert.equal(result.artifacts.length,1);
  assert.equal(result.text,'Here is your chart.\n\nThe end.');
  assert.equal(W.extract('```orbit-widget\n{"kind":').errors.length,1);
  assert.equal(W.extract('```orbit-widget\n<script>alert(1)</script>\n```').errors.length,1);
  assert.ok(!W.streamingText(source).includes('"series"'));
  assert.match(W.extract('```js\nconst x = 1;\n```').text,/const x/);
});
test('escapes chart strings, preserves negatives, supports one-slice pies', () => {
  const svg=W.chartSvg({...chart,title:'<script>alert("x")</script>',labels:['<img onerror=x>','B'],series:[{name:'<bad>',values:[-1,5]}]});
  assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('<img'));
  assert.match(svg,/&lt;script&gt;/);
  const legend=W.chartSvg({...chart,series:[{name:'Linear Search (n)',values:[1,2]},{name:'Binary Search (log n)',values:[1,2]}]});
  assert.match(legend,/Linear Search \(n\)/); assert.match(legend,/Binary Search \(log n\)/);
  assert.match(W.chartSvg({...chart,chartType:'pie',labels:['All'],series:[{name:'Total',values:[5]}]}),/<circle/);
});
test('recovers bare and JSON-fenced widgets, including braces and quotes inside labels', () => {
  const spec = {...chart,title:'A {test} and "quotes"'};
  for (const source of [JSON.stringify(spec), '```json\n'+JSON.stringify(spec)+'\n```', '```\n'+JSON.stringify(spec)+'\n```']) {
    const result = W.extract('Intro.\n'+source+'\nConclusion.');
    assert.equal(result.recognized,true); assert.equal(result.artifacts.length,1);
    assert.equal(result.artifacts[0].title,spec.title);
    assert.equal(result.text,'Intro.\n\nConclusion.');
  }
  const ordinary='Example: {"name":"A","values":[1,2]}';
  assert.equal(W.extract(ordinary).text,ordinary);
  const code='```python\n'+JSON.stringify(chart)+'\n```';
  assert.equal(W.extract(code).text,code);
  assert.equal(W.extract('`'+JSON.stringify(chart)+'`').artifacts.length,0);
  assert.equal(W.extract(JSON.stringify({...chart,series:[{values:[1]}]})).errors.length,1);
  assert.equal(W.extract(Array(5).fill(JSON.stringify(chart)).join('\n')).artifacts.length,4);
  assert.ok(!W.streamingText(JSON.stringify(chart)).includes('"series"'));
  const uppercase = W.extract(`Intro.\n\norbit-widget\n\`\`\`JSON\n${JSON.stringify(chart)}\n\`\`\`\nConclusion.`);
  assert.equal(uppercase.artifacts.length,1);
  assert.equal(uppercase.text,'Intro.\n\n\nConclusion.');
  assert.equal(W.streamingText(`orbit-widget\n\`\`\`JSON\n${JSON.stringify(chart)}\n\`\`\``).trim(),'');
});
test('saved raw chart replies recover once and table preference survives export', () => {
  const vm=require('node:vm'),context={OrbitWidgets:W,crypto:require('node:crypto').webcrypto}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  const message={role:'assistant',text:'Here is the graph.\n'+JSON.stringify(chart)};
  assert.equal(context.recoverMessageWidgets(message),true);
  assert.equal(message.artifacts.length,1); assert.equal(message.text,'Here is the graph.');
  const id=message.artifacts[0].id; assert.equal(context.recoverMessageWidgets(message),false); assert.equal(message.artifacts[0].id,id);
  message.artifacts[0].view='table'; assert.equal(context.normalizedWidgetArtifacts(message.artifacts)[0].view,'table');
  const user={role:'user',text:JSON.stringify(chart)}; context.recoverMessageWidgets(user); assert.equal(user.artifacts,undefined);
  const streaming={role:'assistant',text:JSON.stringify(chart),generating:true}; context.recoverMessageWidgets(streaming); assert.equal(streaming.artifacts,undefined);
});
test('disabled tools are not available or generated', async () => {
  let value='{}'; global.localStorage={getItem:()=>value,setItem:(_,v)=>{value=v;}};
  W.setEnabled('pdf',false);
  assert.equal(W.settings().pdf,false);
  await assert.rejects(W.generate(document),/disabled/);
  assert.equal(W.extract('```orbit-widget\n'+JSON.stringify(document)+'\n```').artifacts.length,0);
  assert.match(W.instruction(),/explain that it is off/);
  assert.match(W.instruction(),/Enabled kinds: docx, pptx, xlsx, chart/);
  for (const kind of ['docx','pptx','xlsx','chart','diagram']) W.setEnabled(kind,false);
  assert.match(W.instruction(),/offer the content as ordinary chat text or a Markdown table/);
  assert.match(W.instruction(),/Do not emit widget blocks/);
  delete global.localStorage;
});

test('rich formatting is bounded and safe while old recipes remain compatible',()=> {
  const styled=[{text:'Important',color:'#2457a6',underline:true,bold:true,italic:true}];
  const value=W.normalize({...document,blocks:[{type:'paragraph',text:styled},{type:'pageBreak'},document.blocks[3]]});
  assert.equal(value.blocks[0].text[0].color,'2457A6');
  assert.equal(value.blocks[1].type,'pageBreak');
  assert.throws(()=>W.normalize({...document,blocks:[{type:'paragraph',text:[{text:'Bad',color:'url(http://bad)'}]}]}),/hex/);
  assert.throws(()=>W.normalize({...document,blocks:[{type:'paragraph',text:[{text:'x'.repeat(7000)},{text:'y'.repeat(7000)}]}]}),/too long/);
  assert.throws(()=>W.normalize({kind:'pptx',title:'Table',slides:[{title:'Table',table:{headers:['A'],rows:Array(11).fill(['B'])}}]}),/10/);
  assert.equal(W.normalize(document).blocks[1].text,document.blocks[1].text);
});

test('eight-page reports and ten-slide decks preserve content, styled runs and tables',async()=> {
  const {generate}=await import('../widgets-engine.js');
  const blocks=[];
  for(let page=1;page<=8;page++) {
    if(page>1) blocks.push({type:'pageBreak'});
    blocks.push({type:'heading',text:`Section ${page}`},
      {type:'paragraph',text:[{text:'Key principle. ',underline:true,color:'2457A6'},{text:'A complete explanation follows with practical detail. '.repeat(24)}]},
      {type:'table',headers:['Example','Result'],rows:[['Input',[{text:`Result ${page}`,bold:true,color:'2457A6'}]]]},
      {type:'paragraph',text:'Consider the assumptions, work through the example, and compare the result with a second approach. '.repeat(10)});
  }
  const spec=W.normalize({kind:'pdf',title:'Long report verification',blocks});
  const pdf=Buffer.from(await (await generate(spec)).arrayBuffer());
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,8);
  const word=Buffer.from(await (await generate({...spec,kind:'docx'})).arrayBuffer());
  const wordZip=await JSZip.loadAsync(word), xml=await wordZip.file('word/document.xml').async('string');
  assert.match(xml,/Section 8/); assert.match(xml,/w:u w:val="single"/); assert.match(xml,/w:color w:val="2457A6"/);
  assert.equal((xml.match(/<w:pageBreakBefore\/>/g)||[]).length,7);
  const slides=Array.from({length:10},(_,i)=>({title:`Slide ${i+1}`,bullets:[[{text:'Important point',underline:true,color:'2457A6'}]],table:{headers:['Topic','Result'],rows:[['Example',`Result ${i+1}`]]},notes:'Detailed explanation. '.repeat(30)}));
  const deck=Buffer.from(await (await generate(W.normalize({kind:'pptx',title:'Ten slides',slides}))).arrayBuffer());
  const zip=await JSZip.loadAsync(deck);
  assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length,10);
  const slide=await zip.file('ppt/slides/slide10.xml').async('string');
  assert.match(slide.replace(/<[^>]*>/g,''),/Result 10/); assert.match(slide,/a:tbl/); assert.match(slide,/u="sng"/); assert.match(slide,/2457A6/);
  if (process.env.ORBIT_WIDGET_QA) {
    const dir=path.join(__dirname,'output'); fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'long-report.pdf'),pdf);
    fs.writeFileSync(path.join(dir,'long-report.docx'),word);
    fs.writeFileSync(path.join(dir,'long-deck.pptx'),deck);
  }
});
test('generates real PDF, DOCX, PPTX and SVG binaries offline', async () => {
  const {generate}=await import('../widgets-engine.js');
  const dir=path.join(__dirname,'output'); fs.mkdirSync(dir,{recursive:true});
  const pdf=await generate(W.normalize(document));
  const pdfBuffer=Buffer.from(await pdf.arrayBuffer());
  assert.equal(pdfBuffer.subarray(0,5).toString(),'%PDF-');
  fs.writeFileSync(path.join(dir,'notes.pdf'),pdfBuffer);
  const word=await generate(W.normalize({...document,kind:'docx'}));
  const wordBuffer=Buffer.from(await word.arrayBuffer());
  const wordZip=await JSZip.loadAsync(wordBuffer);
  const xml=await wordZip.file('word/document.xml').async('string');
  assert.match(xml,/Offline study notes/); assert.match(xml,/w:tbl/);
  assert.match(xml, /w:gridCol w:w="4513"/);
  assert.match(xml, /w:tblLayout w:type="fixed"/);
  fs.writeFileSync(path.join(dir,'notes.docx'),wordBuffer);
  const deck=await generate(W.normalize({kind:'pptx',title:'Study plan',slides:[{title:'Review',bullets:['Algorithms','Databases'],notes:'Practice every day.'},{title:'Results',bullets:['Algorithms: 82','Databases: 91']}]}));
  const deckBuffer=Buffer.from(await deck.arrayBuffer());
  const deckZip=await JSZip.loadAsync(deckBuffer);
  assert.ok(deckZip.file('ppt/slides/slide2.xml'));
  assert.match(await deckZip.file('ppt/notesSlides/notesSlide1.xml').async('string'),/Practice every day/);
  fs.writeFileSync(path.join(dir,'plan.pptx'),deckBuffer);
  const svg=await W.generate(chart); assert.equal(svg.type,'image/svg+xml');
  fs.writeFileSync(path.join(dir,'scores.svg'),await svg.text());
});

test('chat integration keeps saved recipes, hides JSON, and reports generator failures', async () => {
  const vm = require('node:vm');
  const message={role:'assistant',text:'Done.\n```orbit-widget\n'+JSON.stringify(document)+'\n```'};
  let saves=0;
  const context={OrbitWidgets:{...W,generate:async()=>new Blob(['example'])},crypto:require('node:crypto').webcrypto,state:{messages:[message],models:[{key:'local'}],selectedModel:'local'},renderMessages:()=>{},persistCurrentChat:()=>saves++};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  await context.finalizeMessageWidgets(message,'Create a PDF',new AbortController().signal);
  assert.equal(message.artifacts.length,1); assert.match(message.text,/Done — your file is ready\./);
  assert.equal(message.artifacts[0].size,7); assert.equal(saves,1);
  assert.equal(message.widgetStatus,undefined);
  assert.equal(context.normalizedWidgetArtifacts(JSON.parse(JSON.stringify(message.artifacts))).length,1);
  assert.equal(context.normalizedWidgetArtifacts([{spec:{kind:'shell'}}]).length,0);
  const failure={role:'assistant',text:'```orbit-widget\n'+JSON.stringify(document)+'\n```'};
  context.state.messages=[failure]; context.OrbitWidgets.generate=async()=>{throw new Error('Disk test failure');};
  await context.finalizeMessageWidgets(failure,'Create a PDF',new AbortController().signal);
  assert.match(failure.artifacts[0].error,/Disk test failure/);
  assert.doesNotMatch(failure.text,/Done —/);
  const stopped={role:'assistant',text:message.text}; const abort=new AbortController(); abort.abort();
  await context.finalizeMessageWidgets(stopped,'Create a PDF',abort.signal); assert.equal(stopped.artifacts,undefined);
  assert.equal(context.requestedFileKind('How do I create a PDF?'),'');
  const disabled={role:'assistant',text:'Here is your PDF.'};
  context.state.messages=[disabled];
  context.OrbitWidgets.settings=()=>({pdf:false});
  await context.finalizeMessageWidgets(disabled,'Create a PDF',new AbortController().signal);
  assert.equal(disabled.artifacts.length,0);
  assert.match(disabled.widgetError,/PDF generation is disabled/);
});

test('file completion is announced only after the binary succeeds', async()=> {
  const vm=require('node:vm'); let release;
  const message={role:'assistant',widgetPendingKind:'docx',text:'I created it.\n```orbit-widget\n'+JSON.stringify({...document,kind:'docx'})+'\n```'};
  const context={OrbitWidgets:{...W,generate:()=>new Promise(resolve=>release=resolve)},crypto:require('node:crypto').webcrypto,state:{messages:[message],models:[{key:'local'}],selectedModel:'local'},renderMessages(){},persistCurrentChat(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  assert.equal(context.recoverMessageWidgets(message),false,'Rendering must not consume a pending file recipe');
  assert.equal(message.artifacts,undefined);
  const pending=context.finalizeMessageWidgets(message,'Create a Word document',new AbortController().signal);
  assert.equal(message.widgetPendingKind,'docx');assert.equal(message.artifacts.length,0);
  assert.equal(message.widgetStatus,'Rendering Offline study notes');
  release(new Blob(['ready']));await pending;
  assert.match(message.text,/I’ll prepare it\.[\s\S]*Done — your file is ready\./);assert.equal(message.widgetPendingKind,undefined);
});

test('completion works without prompt detection, for multiple files and partial failures',async()=>{
  const vm=require('node:vm');
  const make=(specs)=>({role:'assistant',text:'I’ll prepare the document.\n\n'+specs.map(s=>'```orbit-widget\n'+JSON.stringify(s)+'\n```').join('\n')});
  const context={OrbitWidgets:{...W,generate:async()=>new Blob(['ready'])},crypto:require('node:crypto').webcrypto,state:{messages:[],models:[{key:'local'}],selectedModel:'local'},renderMessages(){},persistCurrentChat(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  for(const kind of ['pdf','docx','pptx','xlsx']) {
    const spec=kind==='xlsx'?{kind,title:'Inventory',sheets:[{name:'Data',headers:['Item','Count'],rows:[['Pens',12]]}]}:kind==='pptx'?{kind,title:'Lesson',slides:[{title:'Overview',bullets:['Example']}]}:{...document,kind};
    const message=make([spec]);context.state.messages=[message];
    await context.finalizeMessageWidgets(message,'Yes please',new AbortController().signal);
    assert.equal(message.text,'I’ll prepare the document.\n\nDone — your file is ready.');
  }
  const message=make([document,{...document,kind:'docx'}]);context.state.messages=[message];
  context.OrbitWidgets.generate=async(spec)=>{if(spec.kind==='docx')throw Error('Test failure');return new Blob(['ready']);};
  await context.finalizeMessageWidgets(message,'Yes please',new AbortController().signal);
  assert.match(message.text,/Some files are ready/);assert.doesNotMatch(message.text,/Done —/);
});

test('Python and Java source survive DOCX, PDF and PowerPoint notes',async()=>{
  const {generate}=await import('../widgets-engine.js');
  const samples=[['python','def greet(name):\n    if name:\n        print("Hello", name)\n\n    return "\\n"'],['java','public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}']];
  const blocks=samples.flatMap(([language,text])=>[{type:'heading',text:language},{type:'code',language,text}]);
  const spec=W.normalize({kind:'docx',title:'Language exporter regression',blocks});
  for(let i=0;i<samples.length;i++) assert.equal(spec.blocks[i*2+1].text,samples[i][1]);
  const word=Buffer.from(await(await generate(spec)).arrayBuffer());
  const zip=await JSZip.loadAsync(word),xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/        print/);assert.match(xml,/public static void main/);assert.match(xml,/Courier New/);assert.match(xml,/\\n/);
  const pdf=Buffer.from(await(await generate({...spec,kind:'pdf'})).arrayBuffer());
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const ppt=Buffer.from(await(await generate(W.normalize({kind:'pptx',title:'Languages',slides:samples.map(([language,code])=>({title:language,bullets:['Source is included in speaker notes.'],notes:code}))}))).arrayBuffer());
  const deck=await JSZip.loadAsync(ppt);
  assert.match(await deck.file('ppt/notesSlides/notesSlide1.xml').async('string'),/print/);
  assert.match(await deck.file('ppt/notesSlides/notesSlide2.xml').async('string'),/System.out.println/);
  fs.writeFileSync(path.join(__dirname,'output/languages.docx'),word);
  fs.writeFileSync(path.join(__dirname,'output/languages.pdf'),pdf);
  fs.writeFileSync(path.join(__dirname,'output/languages.pptx'),ppt);
});

test('widget guidance offers optional documents and proactive grounded charts',()=>{
  const guidance=W.instruction();
  assert.match(guidance,/wait for consent/);assert.match(guidance,/create the chart inline/);
  assert.match(guidance,/Respect refusals and disabled tools/);assert.match(guidance,/Do not claim code was executed/);
});

test('numeric table conversion excludes nonnumeric columns and supports signed values', () => {
  const vm=require('node:vm'),context={OrbitWidgets:W}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  const table={querySelectorAll:selector=>selector==='thead th'?['Month','Sales','Change','Note'].map(innerText=>({innerText})):[['January','$1,200','-4%','Good'],['February','$980','+2%','Better']].map(row=>({querySelectorAll:()=>row.map(innerText=>({innerText}))}))};
  const spec=context.tableChartSpec(table);
  assert.equal(spec.series.length,2); assert.equal(spec.series[0].values[0],1200); assert.equal(spec.series[1].values[0],-4);
});

test('installers and offline cache ship every widget asset', () => {
  for(const name of ['index.html','install-macos.sh','install-windows.ps1','service-worker.js']) {
    const source=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
    assert.ok(source.includes('widgets.js'),name); assert.ok(source.includes('widgets-ui.js'),name);
  }
  assert.ok(fs.statSync(path.join(__dirname,'../vendor/widgets/engine.js')).size>100000);
  assert.match(fs.readFileSync(path.join(__dirname,'../vendor/widgets/LICENSES.txt'),'utf8'),/SIL OPEN FONT LICENSE/);
  const updater=fs.readFileSync(path.join(__dirname,'../scripts/update-installed-macos.command'),'utf8');
  assert.match(updater,/FILES=\([^\n]*widgets\.js[^\n]*widgets-ui\.js/);
});

test('Excel schema preserves types, rejects malformed sheets and hides streamed recipes',()=>{
  const spec={kind:'xlsx',title:'Inventory',sheets:[{name:'Stock',headers:['SKU','Count','Active'],rows:[['00123',8,true]]}]};
  assert.deepEqual(W.normalize(spec),spec);
  assert.equal(W.filename(spec),'Inventory.xlsx');
  assert.equal(W.streamingStatus('```orbit-widget\n{"kind":"xlsx","title":"Inv'),'Preparing Excel spreadsheet');
  assert.equal(W.streamingText('I’ll prepare the workbook.\n```orbit-widget\n{"kind":"xlsx","sheets":[').trim(),'I’ll prepare the workbook.');
  assert.equal(W.extract('```orbit-widget\n'+JSON.stringify(spec)+'\n```').artifacts[0].kind,'xlsx');
  assert.throws(()=>W.normalize({...spec,sheets:[...spec.sheets,...spec.sheets]}),/unique/);
  assert.throws(()=>W.normalize({...spec,sheets:[{...spec.sheets[0],name:'Bad/Name'}]}),/Worksheet/);
  assert.throws(()=>W.normalize({...spec,sheets:[{...spec.sheets[0],rows:[[1,2]]}]}),/headers/);
  assert.throws(()=>W.normalize({...spec,sheets:[{name:'Data',headers:['X'],rows:[[{formula:'SUM(A1)'}]]}]}),/cells/);
});

test('Excel creates a real offline workbook with typed cells, multiple sheets, filters and frozen headers',async()=>{
  const {generate}=await import('../widgets-engine.js');
  const spec=W.normalize({kind:'xlsx',title:'Inventory',sheets:[{name:'Stock & Prices',headers:['SKU','Count','Price','Active','Note'],rows:[['00123',8,12.5,true,'=HYPERLINK("https://example.com")'],['日本語',0,-2,false,null]]},{name:'Sources',headers:['Source'],rows:[['https://example.com/?a=1&b=2']]}]});
  const blob=await generate(spec);
  assert.equal(blob.type,W.MIME.xlsx);
  const zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const workbook=await zip.file('xl/workbook.xml').async('string');
  const sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(workbook,/Stock &amp; Prices/);assert.match(workbook,/name="Sources"/);
  assert.match(sheet,/r="B2" s="0"><v>8<\/v>/);
  assert.match(sheet,/r="D2" s="0" t="b"><v>1<\/v>/);
  assert.match(sheet,/00123/);assert.match(sheet,/日本語/);assert.doesNotMatch(sheet,/<f[ >]/);
  assert.match(sheet,/state="frozen"/);assert.match(sheet,/<autoFilter ref="A1:E3"/);
  assert.ok(zip.file('[Content_Types].xml'));assert.ok(zip.file('xl/styles.xml'));
  const vm=require('node:vm'),context=vm.createContext({OrbitWidgets:W});
  const ui=fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8');
  vm.runInContext(ui.slice(ui.indexOf('function requestedFileKind('),ui.indexOf('async function finalizeMessageWidgets(')),context);
  assert.equal(context.requestedFileKind('Make an Excel spreadsheet'),'xlsx');
  assert.throws(()=>context.fallbackDocument('xlsx','Here is some prose.'),/spreadsheet rows/);
});

test('Excel shimmer remains until the workbook is ready, then saved recipes recover',async()=>{
  const vm=require('node:vm');let release;
  const spec={kind:'xlsx',title:'Inventory',sheets:[{name:'Data',headers:['Item','Count'],rows:[['Pens',12]]}]};
  const message={role:'assistant',widgetPendingKind:'xlsx',text:'I’ll prepare an Excel inventory workbook.\n```orbit-widget\n'+JSON.stringify(spec)+'\n```'};
  const context={OrbitWidgets:{...W,generate:()=>new Promise(resolve=>release=resolve)},crypto:require('node:crypto').webcrypto,state:{messages:[message],models:[{key:'local'}],selectedModel:'local'},renderMessages(){},persistCurrentChat(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  const pending=context.finalizeMessageWidgets(message,'Make an Excel spreadsheet',new AbortController().signal);
  assert.equal(message.widgetStatus,'Rendering Inventory');
  assert.doesNotMatch(message.text,/Done —/);assert.equal(message.artifacts.length,0);
  release(new Blob(['xlsx']));await pending;
  assert.equal(message.widgetStatus,undefined);assert.equal(message.widgetPendingKind,undefined);
  assert.match(message.text,/Excel inventory workbook\.[\s\S]*Done — your file is ready/);
  assert.equal(message.artifacts[0].spec.kind,'xlsx');
  const saved={role:'assistant',text:'```orbit-widget\n'+JSON.stringify(spec)+'\n```'};
  assert.equal(context.recoverMessageWidgets(saved),true);
  assert.equal(saved.artifacts[0].spec.kind,'xlsx');
});

test('extraction preserves positions and source order across supported recipe formats',()=>{
 const a={...chart,title:'First'}, b={...chart,title:'Second'}, c={...chart,title:'Third'};
 const text='Before\n```json\n'+JSON.stringify(a)+'\n```\nMiddle\n```orbit-widget\n'+JSON.stringify(b)+'\n```\nNext\n'+JSON.stringify(c)+'\nAfter';
 const parsed=W.extract(text);
 assert.deepEqual(parsed.artifacts.map(s=>s.title),['First','Second','Third']);
 assert.deepEqual(parsed.positions.map(p=>parsed.text.slice(0,p)),['Before\n','Before\n\nMiddle\n','Before\n\nMiddle\n\nNext\n']);
 assert.equal(parsed.text,'Before\n\nMiddle\n\nNext\n\nAfter');
});

test('finalization and export preserve two inline charts and continued prose',async()=>{
 const vm=require('node:vm');
 const message={role:'assistant',text:'Before\n```orbit-widget\n'+JSON.stringify(chart)+'\n```\nBetween\n```orbit-widget\n'+JSON.stringify({...chart,title:'Second'})+'\n```\nAfter'};
 const context={OrbitWidgets:{...W,generate:async()=>new Blob(['svg'])},crypto:require('node:crypto').webcrypto,state:{models:[{key:'test'}],selectedModel:'test',messages:[message]},renderMessages(){},persistCurrentChat(){}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),context);
 await context.finalizeMessageWidgets(message,'Explain with two charts');
 assert.equal(message.text,'Before\n\nBetween\n\nAfter');
 assert.deepEqual(Array.from(message.artifacts,a=>a.position),[7,16]);
 assert.deepEqual(Array.from(context.normalizedWidgetArtifacts(message.artifacts),a=>a.position),[7,16]);
 assert.ok(message.artifacts.every(a=>a.size>0));
});
test('every saved reply recovers widgets on the first render',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const messages=Array.from({length:3},()=>({role:'assistant',text:'```orbit-widget\n'+JSON.stringify(chart)+'\n```'}));
 const context=vm.createContext({OrbitWidgets:W,crypto:require('node:crypto').webcrypto,state:{messages,currentChat:'saved'},chatScrollSnapshot:()=>({}),$(){return {classList:{toggle(){}},innerHTML:''};},persistCurrentChat(){},updateConversationTools(){},latestUserMessageIndex:()=>-1,messageMarkup:()=>'',addTableChartButtons(){},requestAnimationFrame(){}});
 vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),context);
 vm.runInContext(source.slice(source.indexOf('function renderMessages('),source.indexOf('function syncComposerClearance(')),context);
 context.addTableChartButtons=()=>{};
 context.renderMessages();assert.ok(messages.every(m=>m.artifacts?.length===1));
});
test('corrupt saved message entries are isolated and stale generation flags clear',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const context=vm.createContext({SAVED_CHATS_KEY:'chats',localStorage:{getItem:()=>JSON.stringify({saved:{messages:[null,7,{role:'unexpected'},{role:'assistant',text:42,generating:true,artifacts:[null,{spec:chart}]}]}})},normalizedWidgetArtifacts:artifacts=>(artifacts||[]).filter(a=>a?.spec),isArchivedChat:()=>false});
 vm.runInContext(source.slice(source.indexOf('function readSavedChats('),source.indexOf('function readProjects(')),context);
 const messages=context.readSavedChats().saved.messages;assert.equal(messages.length,1);assert.equal(messages[0].text,'42');assert.equal(messages[0].generating,false);assert.equal(messages[0].artifacts.length,1);
});

test('a model single-run bullet object preserves text and styling without a generation retry',()=>{
 const spec=W.normalize({kind:'docx',title:'Report',blocks:[{type:'bullets',items:[{text:'Deferred transaction',bold:true,color:'#123abc'},'Ordinary item']}]});
 assert.deepEqual(spec.blocks[0].items[0],[{text:'Deferred transaction',bold:true,color:'123ABC'}]);assert.equal(spec.blocks[0].items[1],'Ordinary item');
 assert.throws(()=>W.normalize({kind:'docx',blocks:[{type:'paragraph',text:{unexpected:'Not text'}}]}),/Styled text/);
});

test('short format follow-ups trigger generation, while format questions do not',()=>{
 const vm=require('node:vm'),ctx={OrbitWidgets:W};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
 for(const [prompt,kind] of [['a pdf too bro','pdf'],['pdf please','pdf'],['as PDF','pdf'],['Word version please','docx'],['a ppt too','pptx'],['Excel instead','xlsx']])assert.equal(ctx.requestedFileKind(prompt),kind,prompt);
 for(const prompt of ['what is a PDF?','I uploaded a PDF','no PDF please','PDF vs Word','How do I create a PDF?','do not create PDF'])assert.equal(ctx.requestedFileKind(prompt),'',prompt);
});

test('missing follow-up file is repaired with earlier source content, and cannot fake success',async()=>{
 const vm=require('node:vm');
 for(const scenario of ['success','invalid','disabled','wrong-kind']){
  const prior={role:'assistant',text:'Source explanation',artifacts:[{id:'old',spec:{kind:'pptx',title:'Course notes',slides:[{title:'Bridge entity',bullets:['Stores quantity and price for each order line.']}]}}]};
  const message={role:'assistant',text:'I got you, bro!\n\nDone — your file is ready.\n\nGenerated file: Course_notes.pdf'};
  let calls=0,generated=0;
  const ctx={OrbitWidgets:{...W,settings:()=>({pdf:scenario!=='disabled',pptx:true}),generate:async()=>{generated++;return new Blob(['real']);}},crypto:require('node:crypto').webcrypto,state:{models:[{key:'test'}],selectedModel:'test',messages:[prior,{role:'user',text:'a pdf too bro'},message,{role:'assistant',text:'LATER_NOT_SOURCE'}]},renderMessages(){},persistCurrentChat(){},async requestLocalReply(_,messages){
   calls++;const input=JSON.parse(messages[1].text);assert.match(JSON.stringify(input.sourceContext),/Stores quantity and price/);assert.doesNotMatch(JSON.stringify(input.sourceContext),/LATER_NOT_SOURCE/);
   return {text:scenario==='invalid'?'Done — your file is ready.':JSON.stringify({repairs:[{index:0,widget:{...document,kind:scenario==='wrong-kind'?'docx':'pdf'}}]})};
  }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
  await ctx.finalizeMessageWidgets(message,'a pdf too bro',new AbortController().signal);
  assert.equal(calls,scenario==='disabled'?0:1);assert.equal(generated,scenario==='success'?1:0);
  assert.equal((message.text.match(/Done — your file is ready/g)||[]).length,scenario==='success'?1:0);
  assert.doesNotMatch(message.text,/Generated file:/);assert.equal(message.widgetPendingKind,undefined);
  if(scenario!=='success')assert.ok(message.widgetError);
 }
});

test('old filename-only replies show a missing-file notice, without marking real files missing',()=>{
 const vm=require('node:vm'),ctx={OrbitWidgets:W};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
 const m={role:'assistant',text:'Done — your file is ready.\n\nGenerated file: Notes.pdf'};
 assert.equal(ctx.missingFileClaim(m,'a pdf too bro'),'pdf');
 for(const extra of [{generating:true},{widgetStatus:'Preparing PDF'},{artifacts:[{spec:document}]},{footer:'Stopped'}])assert.equal(ctx.missingFileClaim({...m,...extra},'a pdf too bro'),'');
 assert.equal(ctx.missingFileClaim({...m,text:'```text\nGenerated file: Notes.pdf\n```'},'create pdf'),'');
 assert.equal(ctx.missingFileClaim(m,'Explain PDF files'),'');
});

test('Word and PDF wide tables preserve every cell in readable continuation panels',async()=>{
 for(const count of [9,11,15,26]){
  const headers=Array.from({length:count},(_,i)=>'Column '+i);
  const rows=Array.from({length:10},(_,r)=>headers.map((_,c)=>`r${r}c${c}`));
  for(const kind of ['docx','pdf']) {
   const spec=W.normalize({kind,title:'Wide statistics table',blocks:[{type:'table',headers,rows}]});
   assert.ok(spec.blocks.every(b=>b.headers.length<=8));
   assert.deepEqual([headers[0],...spec.blocks.flatMap(b=>b.headers.slice(1))],headers);
   for(let r=0;r<10;r++)assert.deepEqual([rows[r][0],...spec.blocks.flatMap(b=>b.rows[r].slice(1))],rows[r]);
   assert.deepEqual(W.normalize(spec),spec);
  }
 }
 assert.equal(W.normalize({kind:'word',title:'Worked solutions',blocks:[{type:'paragraph',text:'Content'}]}).kind,'docx');
 assert.throws(()=>W.normalize({kind:'docx',blocks:[{type:'table',headers:[],rows:[]}]}),/Table headers/);
 assert.throws(()=>W.normalize({kind:'docx',blocks:[{type:'table',headers:['A','B'],rows:[['missing cell']]}]}),/match its headers/);
});

test('wide Word table creates a real file containing every source cell',async()=>{
 const {generate}=await import('../widgets-engine.js');
 const headers=Array.from({length:11},(_,i)=>'Header_'+i),rows=Array.from({length:10},(_,r)=>headers.map((_,c)=>`Row_${r}_Col_${c}`));
 const spec=W.normalize({kind:'docx',title:'Wide data',blocks:[{type:'table',headers,rows}]});
 const zip=await JSZip.loadAsync(await(await generate(spec)).arrayBuffer());
 const xml=await zip.file('word/document.xml').async('string');
 for(const cell of [...headers,...rows.flat()])assert.ok(xml.includes(cell),cell);
 assert.equal((xml.match(/<w:tbl>/g)||[]).length,2);
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../long-documents.js'),W=require('../widgets.js');
const paragraph=i=>({type:'paragraph',text:`SECTION-${i} `+'Boundary-safe substantive test prose. '.repeat(180)});
const diagram={kind:'diagram',title:'Test process',nodes:[{id:'a',label:'Input',x:120,y:100},{id:'b',label:'Output',x:400,y:100}],edges:[{from:'a',to:'b',label:'Transform'}]};
const outline={title:'Synthetic PDF boundary audit',sections:Array.from({length:8},(_,i)=>({title:'Part '+(i+1),brief:'Independent section '+(i+1),generatedVisuals:i===0?['diagram']:[]}))};
const opts=plan=>({model:{id:'deepseek-flash',provider:'DeepSeek'},context:[],instruction:'',normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB:null}),retryDelay:async()=>{},plan});
test('a 12-page PDF request survives trailing prose, fenced JSON and exact repeated sections without redrafting or losing diagrams',async()=>{
 let calls=0;
 const result=await L.build('make a 12 page pdf on a synthetic boundary test, with diagrams please',opts(async messages=>{
  calls++;const task=JSON.parse(messages[1].text);if(!task.sectionNumber)return JSON.stringify(outline);
  const section={kind:'pdf',blocks:[{type:'heading',text:'Part '+task.sectionNumber},paragraph(task.sectionNumber),...(task.sectionNumber===1?[{type:'visual',visual:diagram}]:[])]};
  const raw=JSON.stringify(section);
  return task.sectionNumber===1?raw+'\nThe section is complete.':task.sectionNumber===2?raw+'\n'+JSON.stringify(section,null,2):task.sectionNumber===3?'Here is the assigned section:\n```json\n'+raw+'\n```\nDone.':raw;
 }));
 const spec=W.extract(result.text).artifacts[0];assert.equal(spec.kind,'pdf');assert.equal(calls,9);assert.equal(spec.blocks.filter(b=>b.type==='paragraph').length,8);assert.equal(spec.blocks.filter(b=>b.type==='visual').length,1);
 for(let i=1;i<=8;i++)assert.equal(spec.blocks.filter(b=>b.text===paragraph(i).text).length,1);
 assert.equal(spec.blocks.find(b=>b.type==='visual').visual.edges.length,1);
});

test('JSON boundaries preserve nested code, quoted braces, escaped keys, Unicode and repeated legitimate paragraphs',()=>{
 const original={blocks:[{type:'code',text:String.raw`const x = {a: "quoted } ] \\\"", b: [1,2]}; // {"blocks":[]}\nC:\\test\\new`},{type:'paragraph',text:'🙂 日本語 { literal } [literal]'},paragraph(1),paragraph(1)]};
 for(const raw of [JSON.stringify(original),'\uFEFF\n```orbit-widget\r\n'+JSON.stringify(original,null,2)+'\r\n```\nDone.','~~~JSON\n'+JSON.stringify(original)+'\n~~~',JSON.stringify(original)+'\n'+JSON.stringify(original,null,2)])assert.deepEqual(L.parseResponse(raw),original);
 assert.equal(L.parseResponse(JSON.stringify(original)).blocks.length,4);
});

test('different roots, incomplete tails and duplicate keys cannot silently discard document content',()=>{
 for(const raw of [
  '{"blocks":[{"text":"KEEP-FIRST"}]}\n{"blocks":[{"text":"KEEP-SECOND"}]}',
  '{"blocks":[{"text":"KEEP-FIRST"}]}\n{"blocks":[{"text":"PARTIAL',
  '{"blocks":[{"text":"KEEP-FIRST"}],"blocks":[{"text":"KEEP-SECOND"}]}',
  String.raw`{"blocks":[],"\u0062locks":[{"text":"SECOND"}]}`,
  '{"blocks":[{"text":"FIRST","text":"SECOND"}]}',
  '{"blocks":[]}}',
  '{"blocks":[}',
  'x'.repeat(700)+'{"blocks":[]}',
  '{"blocks":[]}\nQualification: the denominator must be nonzero.',
  '{"text":"'+'x'.repeat(240000)+'"}'
 ])assert.throws(()=>L.parseResponse(raw));
 assert.deepEqual(L.parseResponse('{"a":{"text":"A"},"b":{"text":"B"}}'),{a:{text:'A'},b:{text:'B'}});
});

test('a multi-object draft is repaired as one unit with all original content and visuals preserved',async()=>{
 let repaired=0;
 const result=await L.build('Create a 12 page PDF with diagrams',opts(async messages=>{
  const task=JSON.parse(messages[1].text);if(!task.sectionNumber)return JSON.stringify(outline);
  if(task.sectionNumber===2){
   if(messages.length===2)return JSON.stringify({blocks:[paragraph(2)]})+'\n'+JSON.stringify({blocks:[{type:'paragraph',text:'SECOND-PART-MUST-SURVIVE'}]});
   repaired++;assert.match(messages.at(-2).text,/SECOND-PART-MUST-SURVIVE/);assert.match(messages.at(-1).text,/multiple different JSON objects/);
   return JSON.stringify({blocks:[paragraph(2),{type:'paragraph',text:'SECOND-PART-MUST-SURVIVE'}]});
  }
  return JSON.stringify({blocks:[paragraph(task.sectionNumber),...(task.sectionNumber===1?[{type:'visual',visual:diagram}]:[])]});
 }));
 assert.equal(repaired,1);const spec=W.extract(result.text).artifacts[0];assert.equal(spec.blocks.filter(b=>b.text==='SECOND-PART-MUST-SURVIVE').length,1);assert.equal(spec.blocks.filter(b=>b.type==='visual').length,1);
});

test('repairs receive the whole assigned draft beyond 60k, including its final qualification',async()=>{
 let repaired=0;const text='word '.repeat(12500)+'FINAL-QUALIFICATION-MUST-SURVIVE',blocks=[];for(let i=0;i<text.length;i+=9000)blocks.push({type:'paragraph',text:text.slice(i,i+9000)});
 const out={title:'Synthetic format preservation',sections:Array.from({length:8},(_,i)=>({title:'Part '+i,brief:'Distinct part'}))};
 await L.build('Create an 8 page PDF',opts(async messages=>{
  const task=JSON.parse(messages[1].text);if(!task.sectionNumber)return JSON.stringify(out);
  if(task.sectionNumber===1&&messages.length===2)return '{"blocks":'+JSON.stringify(blocks)+',"blocks":[]}';
  if(messages.length>2){repaired++;assert.match(messages.at(-2).text,/FINAL-QUALIFICATION-MUST-SURVIVE/);assert.ok(messages.at(-2).text.length>60000);return JSON.stringify({blocks});}
  return JSON.stringify({blocks:[paragraph(task.sectionNumber)]});
 }));assert.equal(repaired,1);
});

test('a failed section keeps committed units, reports a document failure and resumes without redrafting them',async()=>{
 const store=L.createCheckpoints({indexedDB:null});const base={...opts(async messages=>{
  const task=JSON.parse(messages[1].text);if(!task.sectionNumber)return JSON.stringify(outline);
  if(task.sectionNumber===2)return '{"blocks":[{"type":"paragraph","text":"broken JSON"}';
  return JSON.stringify({blocks:[paragraph(task.sectionNumber),...(task.sectionNumber===1?[{type:'visual',visual:diagram}]:[])]});
 }),checkpointStore:store};
 let failure;try{await L.build('Create a 12 page PDF',base);}catch(e){failure=e;}
 assert.equal(failure.documentGeneration,true);assert.equal(failure.completedSections,1);assert.match(failure.message,/1 completed section is saved/);assert.equal((await store.get(failure.documentCheckpoint)).sections.length,1);
 const seen=[];const result=await L.build('Create a 12 page PDF',{...base,plan:async messages=>{const task=JSON.parse(messages[1].text);assert.ok(task.sectionNumber>=2);seen.push(task.sectionNumber);return JSON.stringify({blocks:[paragraph(task.sectionNumber)]});}});
 assert.deepEqual(seen,[2,3,4,5,6,7,8]);assert.equal(W.extract(result.text).artifacts[0].blocks.filter(b=>b.type==='visual').length,1);
});

test('the shared parser preserves schemas for outlines, sections, source audits, patches and slides',()=>{
 for(const data of [outline,{blocks:[paragraph(1)]},{issues:['Keep a factual qualification']},{patches:[{path:['blocks',0,'text'],before:'original',after:'qualified'}]},{slides:[{title:'Example',bullets:['Keep this point']}]}])assert.deepEqual(L.parseResponse('Here is the JSON:\n'+JSON.stringify(data)+'\nFinished.'),data);
});

test('document failures have accurate chat copy while genuine connection failures keep their own message',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('app.js','utf8'),c=vm.createContext({});
 vm.runInContext(source.slice(source.indexOf('function replyFailureText('),source.indexOf('async function requestRuntime(')),c);
 assert.match(c.replyFailureText({documentGeneration:true,completedSections:2}),/Completed sections are saved/);
 assert.doesNotMatch(c.replyFailureText({documentGeneration:true}),/reach the selected model/);
 assert.doesNotMatch(c.replyFailureText({documentGeneration:true}),/Completed sections are saved/);
 assert.match(c.replyFailureText(Error('Connection refused'),true),/couldn’t reach the selected model/);
 assert.match(c.replyFailureText({providerStalled:true}),/stopped making progress/);
 assert.doesNotMatch(c.replyFailureText({providerStalled:true}),/reach the selected model/);
});

test('long embedded chart titles wrap completely and reserve space above the plotting area',()=>{
 const C=require('../charts.js'),title='Search space shrinks by half per iteration (synthetic illustration of the halving argument, not measured output)';
 for(const spec of [{kind:'chart',title,chartType:'line',labels:['A','B'],series:[{name:'Count',values:[100,50]}]},{kind:'chart',title,chartType:'gantt',tasks:[{label:'First task',start:0,end:2}]}]){
  const svg=W.chartSvg(spec),lines=[...svg.matchAll(/<text x="36" y="\d+" font-size="22" font-weight="bold">([^<]*)<\/text>/g)].map(m=>m[1]);
  assert.equal(lines.join(' '),title);assert.ok(lines.length>1);const offset=(lines.length-1)*28;assert.match(svg,new RegExp(`viewBox="0 0 800 ${480+offset}"`));assert.ok(svg.includes(`transform="translate(0,${offset})"`));
 }
 const emoji='👨‍👩‍👧‍👦';assert.equal(C.titleLines((emoji+' ').repeat(20).trim()).join(' '),(emoji+' ').repeat(20).trim());
 assert.deepEqual(C.titleLines('Short title'),['Short title']);
});

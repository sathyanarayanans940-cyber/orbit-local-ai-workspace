const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../long-documents.js'),W=require('../widgets.js');
const diagram={kind:'diagram',title:'Process',nodes:[{id:'a',label:'Input',x:120,y:100},{id:'b',label:'Result',x:400,y:100}],edges:[{from:'a',to:'b'}]};
const chart={kind:'chart',title:'Illustrative values',chartType:'bar',labels:['A','B'],series:[{name:'Example',values:[1,2]}]};
const prose={type:'paragraph',text:'Synthetic validation content with retained explanatory details. '.repeat(100)};
const outline=visuals=>({title:'Visual contract regression',sections:Array.from({length:8},(_,i)=>({title:'Part '+i,brief:'Explain the process and its limitations.',generatedVisuals:i===0?visuals:[]}))});
const options=plan=>({model:{id:'gemma4:31b-cloud',provider:'Ollama'},context:[],assets:{images:[],visuals:[]},instruction:W.instruction(),normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB:null}),plan});
const section=task=>({blocks:[prose,...task.section.generatedVisuals.map(k=>({type:'visual',visual:k==='diagram'?diagram:chart}))]});
for(const [name,input,expected] of [
 ['case and whitespace',[' Diagram ','CHART'],['diagram','chart']],
 ['subtypes',['flowchart','timeline','bar chart'],['diagram','diagram','chart']],
 ['descriptions',[{type:'flowchart',description:'KEEP all steps and limitations'},{kind:'chart',chartType:'bar',description:'ONLY supplied values'}],['diagram','chart']],
 ['single kind','diagram',['diagram']],
 ['duplicates',['diagram','diagram'],['diagram','diagram']]
])test('long document accepts '+name+' without a repair call or lost visuals',async()=>{
 let calls=0,observed;
 const result=await L.build('Create a 12 page PDF with diagrams',options(async messages=>{
  calls++;const task=JSON.parse(messages[1].text);
  if(!task.sectionNumber){assert.match(messages[0].text,/ONLY the literal strings/);return JSON.stringify(outline(input));}
  if(task.sectionNumber===1){observed=task.section;assert.deepEqual(observed.generatedVisuals,expected);}
  return JSON.stringify(section(task));
 }));
 assert.equal(calls,9);
 if(JSON.stringify(input)!==JSON.stringify(expected))assert.deepEqual(observed.generatedVisualRequests,input);
 const spec=W.extract(result.text).artifacts[0];assert.equal(spec.kind,'pdf');assert.equal(spec.blocks.filter(b=>b.type==='visual').length,expected.length);
 assert.equal(spec.blocks.filter(b=>b.type==='paragraph').length,8);
});
test('unknown kinds receive actionable repair context and are not silently discarded',async()=>{
 let outlineCalls=0;
 const result=await L.build('Create a 12 page PDF with a diagram',options(async messages=>{
  const task=JSON.parse(messages[1].text);
  if(!task.sectionNumber){
   if(++outlineCalls===1)return JSON.stringify(outline(['concept-sketch']));
   assert.match(messages.at(-1).text,/Part 0/);assert.match(messages.at(-1).text,/"diagram" or "chart"/);assert.match(messages.at(-2).text,/concept-sketch/);
   return JSON.stringify(outline(['diagram']));
  }
  return JSON.stringify(section(task));
 }));assert.equal(outlineCalls,2);assert.equal(W.extract(result.text).artifacts[0].blocks.filter(b=>b.type==='visual').length,1);
});
test('ambiguous, unsupported, oversized and malformed requests fail after bounded repairs',async()=>{
 for(const input of [[{kind:'diagram',type:'chart'}],['satellite-map'],[{title:'No type'}],null,[null],['diagram',42],Array(81).fill('diagram'),[{kind:'diagram',description:'x'.repeat(20001)}]]){
  let calls=0;
  await assert.rejects(L.build('Create an 8 page PDF',options(async()=>{calls++;return JSON.stringify(outline(input));})),/generatedVisuals must be an array/);
  assert.equal(calls,3);
 }
});
test('normalizing a subtype never lets a text-only section satisfy two diagrams',async()=>{
 let calls=0;
 await assert.rejects(L.build('Create an 8 page PDF with two diagrams',options(async messages=>{
  calls++;const task=JSON.parse(messages[1].text);
  return JSON.stringify(task.sectionNumber?{blocks:[prose,{type:'visual',visual:diagram}]}:outline(['flowchart','timeline']));
 })),/new visuals: diagram/);assert.equal(calls,5);
});
test('uploaded and existing visual IDs remain exact even when new kinds are normalized',async()=>{
 let calls=0;
 await assert.rejects(L.build('Create an 8 page PDF',options(async()=>{
  calls++;const value=outline(['flowchart']);value.sections[0].visualArtifactIds=['invented'];return JSON.stringify(value);
 })),/Unknown or invalid visual/);assert.equal(calls,3);
});
test('normalized visual plans preserve renderable diagrams and charts for browser PDF export',async()=>{
 const result=await L.build('Create a 12 page PDF with diagrams',options(async messages=>{
  const task=JSON.parse(messages[1].text);
  return JSON.stringify(task.sectionNumber?{blocks:[{type:'heading',text:task.section.title},...section(task).blocks]}:outline(['flowchart','timeline','bar chart']));
 }));
 const spec=W.extract(result.text).artifacts[0];
 for(const block of spec.blocks.filter(b=>b.visual)){const svg=block.visual.kind==='diagram'?W.diagramSvg(block.visual):W.chartSvg(block.visual);assert.match(svg,/<svg/);assert.doesNotMatch(svg,/NaN|Infinity/);}
 const fs=require('node:fs');fs.mkdirSync('tests/output',{recursive:true});fs.writeFileSync('tests/output/generated-visual-plan.json',JSON.stringify(spec));
});

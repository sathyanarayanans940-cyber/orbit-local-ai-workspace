const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../widgets.js');
const fence=s=>'```orbit-widget\n'+s;
const diagram={kind:'diagram',title:'Architecture',width:600,height:300,nodes:[{id:'a',label:'A',x:300,y:150}],edges:[]};
test('malformed reordered root kinds stay hidden without extracting child diagrams',()=>{
 for(const lead of ['"title":"Study guide",','"style":{"theme":"slate"},','"title":"'+'T'.repeat(150)+'",']) {
  const raw='{'+lead+'"kind":"pdf","blocks":[{"type":"visual","visual":'+JSON.stringify(diagram)+'},BROKEN]}';
  for(const wrapper of [s=>s,s=>'```json\n'+s+'\n```',s=>fence(s)+'\n```']) {
   const out=W.extract('Before\n'+wrapper(raw)+'\nAfter');
   assert.equal(out.slots.length,1);assert.equal(out.slots[0].kind,'pdf');assert.equal(out.artifacts.length,0);
   assert.equal(out.text,'Before\n\nAfter');
  }
 }
});
test('ordinary incomplete nested tool examples remain visible in JSON and prose',()=>{
 for(const value of ['{"example":{"kind":"pdf","blocks":[','```json\n{"example":{"kind":"diagram","nodes":[','Before\n{"example":{"kind":"chart","series":[']) {
  assert.equal(W.streamingText(value),value);assert.equal(W.streamingStatus(value),'');
 }
});
test('activity recognizes heading text regardless of field order and styled text',()=>{
 for(const heading of ['{"text":"Software process models","type":"heading"}',
  '{"text":[{"text":"Software ","bold":true},{"text":"process models"}],"type":"heading"}',
  '{"type":"heading","text":[{"text":"Software ","bold":true},{"text":"process models"}]}']) {
  const begin=fence('{"kind":"pdf","title":"Study guide","blocks":['+heading);
  assert.equal(W.streamingStatus(begin),'Adding heading Software process models');
  assert.equal(W.streamingStatus(begin+',{"text":"Private body","type":"paragraph"}'),'Writing Software process models');
 }
});
test('activity resets at block boundaries instead of treating body text as a heading',()=>{
 const value=fence('{"kind":"pdf","blocks":[{"type":"heading","text":"Real heading"},{"text":"SECRET BODY"');
 assert.equal(W.streamingStatus(value),'Writing Real heading');
 const metadata=fence('{"kind":"pdf","title":"Study guide","metadata":{"type":"heading","text":"SECRET METADATA"}');
 assert.equal(W.streamingStatus(metadata),'Writing Study guide');
});
test('activity belongs to the last tool rather than a previously completed document',()=>{
 const first=JSON.stringify({kind:'pdf',title:'Old file',blocks:[{type:'heading',text:'Old chapter'},{type:'paragraph',text:'Old content'}]});
 assert.equal(W.streamingStatus(fence(first)+'\n```\nNext\n'+fence('{"kind":"docx","title":"New file","blocks":[')),'Writing New file');
});
function permutations(values) {return values.length?values.flatMap((v,i)=>permutations(values.filter((_,j)=>j!==i)).map(rest=>[v,...rest])):[[]];}
test('every root field permutation survives truncation and preserves prose and source code',()=>{
 const entries=Object.entries({kind:'pdf',title:'Guide } \\" 🌍',style:{theme:'slate'},blocks:[{type:'heading',text:'Actual section'},{type:'paragraph',text:'Body { has braces } and a quote " safely.'},{type:'visual',visual:diagram}]});
 const code='```python\nprint("{\\\"kind\\\":\\\"pdf\\\"}")\n```';
 for(const order of permutations(entries)) {
  const raw=JSON.stringify(Object.fromEntries(order));
  const result=W.extract(code+'\nBefore\n'+fence(raw)+'\n```\nAfter');
  assert.equal(result.artifacts.length,1);assert.equal(result.artifacts[0].blocks.length,3);assert.equal(result.text,code+'\nBefore\n\nAfter');
  for(let end=0;end<raw.length;end++) {
   const value=code+'\nBefore\n'+fence(raw.slice(0,end));
   assert.equal(W.streamingText(value),code+'\nBefore\n');
   assert.ok(!/Body|"kind"|"blocks"|BROKEN/.test(W.streamingStatus(value)));
  }
 }
});
test('32 mixed-format diagrams preserve every slot and reject the 33rd explicitly',()=>{
 const source=Array.from({length:33},(_,i)=>{
  const raw=JSON.stringify({...diagram,title:'Step '+(i+1)});
  return 'Explanation '+i+'\n'+(i%3===0?fence(raw)+'\n```':i%3===1?'```json\n'+raw+'\n```':raw);
 }).join('\n');
 const result=W.extract(source);assert.equal(result.artifacts.length,32);assert.equal(result.slots.length,33);assert.equal(result.errors.length,1);
 assert.deepEqual(result.artifacts.map(x=>x.title),Array.from({length:32},(_,i)=>'Step '+(i+1)));
 assert.equal(result.slots.filter(s=>s.error).length,1);assert.doesNotMatch(result.text,/"nodes"|"kind"/);
 for(const slot of result.slots)assert.match(result.text.slice(0,slot.position),/Explanation/);
});
test('long earlier headings survive large bodies and nested visual metadata never takes over',()=>{
 const blocks=[{type:'heading',text:'Correct active chapter'},...Array.from({length:12},()=>({type:'paragraph',text:'Body '.repeat(2300)})),{type:'paragraph',text:'Final body',metadata:{type:'heading',text:'Wrong heading'}}];
 assert.equal(W.streamingStatus(fence(JSON.stringify({kind:'pdf',title:'Long guide',blocks}).slice(0,-1))),'Writing Correct active chapter');
 const slide=fence('{"kind":"pptx","title":"Deck","slides":[{"title":"First slide"},{"title":"Current slide","visual":{"kind":"chart","title":"Actual metrics"');
 assert.equal(W.streamingStatus(slide),'Building chart Actual metrics');
});
test('pathological nesting is bounded and explicit later widgets still recover',()=>{
 const start=performance.now(),hostile='{"example":'.repeat(10000)+'0';
 const result=W.extract(hostile+'\n'+fence(JSON.stringify(diagram))+'\n```\nAfter');
 assert.equal(result.artifacts.length,1);assert.equal(result.text.endsWith('After'),true);
 assert.ok(performance.now()-start<3000);
});
test('header-only workbook templates export without inventing a placeholder record',async()=>{
 const {generate}=await import('../widgets-engine.js'),JSZip=require('jszip'),XLSX=require('../vendor/sheetjs/xlsx.full.min.js');
 const raw={kind:'xlsx',title:'Blank template',sheets:[{name:'Template',headers:['Item','Result'],rows:[]}]},spec=W.normalize(raw);
 assert.equal(W.extract(fence(JSON.stringify(raw))+'\n```').artifacts.length,1);
 const blob=await generate(spec),zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
 assert.match(xml,/<dimension ref="A1:B1"/);assert.equal((xml.match(/<row /g)||[]).length,1);
 const workbook=XLSX.read(await blob.arrayBuffer(),{type:'array'});
 assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets.Template,{header:1}),[['Item','Result']]);
 for(const rows of [null,{},'rows',Array.from({length:1001},()=>['a','b'])])assert.throws(()=>W.normalize({...raw,sheets:[{...raw.sheets[0],rows}]}));
});

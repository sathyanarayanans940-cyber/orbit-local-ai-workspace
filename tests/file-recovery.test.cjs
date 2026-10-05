const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../widgets.js');
const JSZip=require('jszip');
const fence=body=>'```orbit-widget\n'+body+'\n```';
test('completed file fences recover only missing outer punctuation without changing content',()=>{
 const spec={kind:'docx',title:'Literal { ] and escaped " text',blocks:[{type:'paragraph',text:'All supplied text stays intact.'},{type:'formula',text:'x = 1'}]};
 const json=JSON.stringify(spec),expected=W.normalize(spec);
 for(const end of [1,2]){
  const result=W.extract(fence(json.slice(0,-end)));
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.artifacts,[expected]);
 }
 for(const kind of ['pdf','pptx','xlsx']){
  const file=kind==='pdf'?{kind,blocks:spec.blocks}:kind==='pptx'?{kind,slides:[{title:'A',bullets:['B']}]}:{kind,sheets:[{name:'A',headers:['X'],rows:[['1']]}]};
  const result=W.extract(fence(JSON.stringify(file).slice(0,-1)));
  assert.deepEqual(result.errors,[]);assert.equal(result.artifacts[0].kind,kind);
 }
});
test('Word keeps short table rows and small tables together while allowing oversized prose cells to flow',async()=>{
 const {generate}=await import('../widgets-engine.js');
 const spec=W.normalize({kind:'docx',blocks:[{type:'table',headers:['Variable','Value'],rows:[['x','1'],['y','2']]},{type:'table',headers:['Long explanation','Other'],rows:[[('long '.repeat(290)),'A'],['short','B']]}]});
 const zip=await JSZip.loadAsync(await(await generate(spec)).arrayBuffer());
 const xml=await zip.file('word/document.xml').async('string');
 const tables=[...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map(m=>m[0]);
 assert.equal((tables[0].match(/<w:cantSplit\/>/g)||[]).length,3);
 assert.equal((tables[0].match(/<w:keepNext\/>/g)||[]).length,4);
 const rows=[...tables[1].matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map(m=>m[0]);
 assert.doesNotMatch(rows[1],/<w:cantSplit\/>/);assert.match(rows[2],/<w:cantSplit\/>/);
 assert.equal((tables[1].match(/<w:tblHeader\/>/g)||[]).length,1);
});
test('PDF keeps compact table rows intact but lets long narrow prose cells span pages',async()=>{
 const {generate}=await import('../widgets-engine.js');
 const pdfMake=require('pdfmake/build/pdfmake.js'),create=pdfMake.createPdf;let definition;
 pdfMake.createPdf=function(value,...args){definition=value;return create.call(this,value,...args);};
 try{
  const headers=['A','B','C','D','E','F','G','H'];
  const blob=await generate(W.normalize({kind:'pdf',blocks:[{type:'table',headers:['Question','Result'],rows:[['Q1','First line\nSecond line'],['Q2','Summary']]},{type:'table',headers,rows:[[('long '.repeat(290)),...headers.slice(1)]]}]}));
  assert.equal((await blob.text()).slice(0,5),'%PDF-');
  const tables=definition.content.filter(n=>n.table).map(n=>n.table);
  assert.equal(tables[0].dontBreakRows,true);assert.equal(tables[0].keepWithHeaderRows,1);
  assert.equal(tables[1].dontBreakRows,false);assert.equal(tables[1].keepWithHeaderRows,0);
  assert.equal(tables[1].body[1][0].text[0].text.length,1450);
 }finally{pdfMake.createPdf=create;}
});
test('punctuation recovery cannot fabricate missing values, nested content or a completed stream',()=>{
 const bad=[
  '{"kind":"docx","blocks":[{"type":"paragraph","text":"unfinished',
  '{"kind":"docx","blocks":[{"type":"paragraph","text":"finished"},',
  '{"kind":"docx","blocks":[{"type":"paragraph","text":',
  '{"kind":"docx","blocks":[{"type":"table","headers":["A"],"rows":[["1"]',
  '{"kind":"docx","blocks":[{"type":"paragraph","text":"A"}] ]',
  '{"kind":"diagram","nodes":[{"id":"a","label":"A"}]',
 ];
 for(const body of bad)assert.equal(W.extract(fence(body)).artifacts.length,0,body);
 const body='{"kind":"docx","blocks":[{"type":"paragraph","text":"finished"}]';
 assert.equal(W.extract('```orbit-widget\n'+body).artifacts.length,0);
 assert.equal(W.extract('Example:\n```javascript\n'+fence(body)+'\n```').artifacts.length,0);
});
test('PDF and Word totals retain an extra label and every sum in the correct column',()=>{
 const block={type:'table',headers:['x','y','xy'],rows:[['1','2','2'],['Total (n = 1)','Sx = 1','Sy = 2','Sxy = 2']]};
 for(const kind of ['docx','pdf']){
  const result=W.normalize({kind,blocks:[block]});
  assert.deepEqual(result.blocks[0].rows[1],['Total (n = 1)\nSx = 1','Sy = 2','Sxy = 2']);
  assert.deepEqual(W.normalize(result),result);
 }
 const styled={...block,rows:[[[{text:'Grand total:',bold:true}],[{text:'1',italic:true}],'2','2']]};
 const result=W.normalize({kind:'docx',blocks:[styled]});
 assert.deepEqual(result.blocks[0].rows[0][0],[{text:'Grand total:',bold:true},{text:'\n'},{text:'1',italic:true}]);
 for(const label of ['Total revenue','Some record','Total (unfinished','Total\nignored'])assert.throws(()=>W.normalize({kind:'docx',blocks:[{...block,rows:[[label,'1','2','2']]}]}));
 assert.throws(()=>W.normalize({kind:'xlsx',sheets:[{name:'Data',headers:block.headers,rows:block.rows}]}));
 assert.throws(()=>W.normalize({kind:'pptx',slides:[{title:'Totals',table:block}]}));
 assert.throws(()=>W.normalize({kind:'pdf',blocks:[{...block,rows:[['Total','1','2','2','3']]}]}));
});

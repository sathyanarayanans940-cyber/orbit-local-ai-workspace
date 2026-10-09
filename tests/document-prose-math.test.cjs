const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../widgets.js');
const raw=String.raw`C \ge \theta; time T_{train} = N \times M; x^{2}`;
const expected='C ≥ θ; time T_(train) = N × M; x²';
test('Word and PDF visible text fields normalize simple TeX without mutating source or style',()=>{
 for(const kind of ['docx','pdf']){const input={kind,title:raw,blocks:[{type:'heading',text:raw},{type:'paragraph',text:[{text:raw,bold:true}]},{type:'bullets',items:[raw]},{type:'table',headers:[raw],rows:[[raw]]},{type:'callout',title:raw,text:raw},{type:'math',latex:'x^2',caption:raw}]};const before=JSON.stringify(input),spec=W.normalize(input);assert.equal(spec.title,expected);assert.equal(spec.blocks[1].text[0].text,expected);assert.equal(spec.blocks[1].text[0].bold,true);assert.equal(spec.blocks[3].rows[0][0],expected);assert.equal(spec.blocks[5].caption,expected);assert.equal(spec.blocks[5].latex,'x^2');assert.equal(JSON.stringify(input),before);assert.deepEqual(W.normalize(spec),spec);}
});
test('complex equations in prose or table cells request a targeted repair instead of leaking raw LaTeX',()=>{
 for(const block of [{type:'paragraph',text:String.raw`Use \frac{a+b}{c} here.`},{type:'table',headers:['Value'],rows:[[String.raw`\begin{cases}1&x>0\end{cases}`]]},{type:'math',latex:'x',caption:String.raw`Caption \unknown{x}`}])assert.throws(()=>W.normalize({kind:'docx',blocks:[block]}),/math block|plain notation/i);
});
test('paired inline math delimiters are removed but currency, paths and literal code are preserved',()=>{
 const n=s=>W.normalize({kind:'docx',blocks:[{type:'paragraph',text:s}]}).blocks[0].text;
 assert.equal(n(String.raw`Use \(x \le 2\) and $y^2$.`),'Use x ≤ 2 and y².');
 for(const s of ['$5 and $10 per unit',String.raw`C:\Users\theta\report.docx`,String.raw`\\server\share\file`,String.raw`Write \n to insert a newline.`]){assert.equal(n(s),s);}
 const code=String.raw`\frac{a}{b}`;assert.equal(W.normalize({kind:'docx',blocks:[{type:'code',text:code}]}).blocks[0].text,code);assert.equal(n('Use `'+code+'` literally.'),'Use `'+code+'` literally.');
 assert.equal(W.normalize({kind:'text',filename:'formula.tex',content:code}).content,code);
});
test('PowerPoint structured text and Excel cells cannot leak typesetting commands',()=>{
 const ppt=W.normalize({kind:'pptx',title:raw,slides:[{title:raw,layout:'split',columns:[{title:raw,body:raw},{title:'Other',body:raw}],notes:raw}]});assert.equal(ppt.slides[0].columns[0].body,expected);assert.equal(ppt.slides[0].notes,expected);
 const x=W.normalize({kind:'xlsx',sheets:[{name:'Math',headers:['Expression'],rows:[[raw],[42]]}]});assert.equal(x.sheets[0].rows[0][0],expected);assert.equal(x.sheets[0].rows[1][0],42);
});
test('embedded diagram labels are cleaned while stable IDs and math sources remain intact',()=>{
 const spec=W.normalize({kind:'docx',blocks:[{type:'visual',caption:raw,visual:{kind:'diagram',nodes:[{id:'theta',label:String.raw`\theta`,x:100,y:100}],edges:[]}}]});assert.equal(spec.blocks[0].visual.nodes[0].label,'θ');assert.equal(spec.blocks[0].visual.nodes[0].id,'theta');assert.equal(spec.blocks[0].caption,expected);
});
test('styled-run boundaries, unknown commands and incomplete delimiters cannot bypass validation',async()=>{
 for(const text of [[{text:'\\'},{text:'theta'}],[{text:'T_'},{text:'{train}'}],String.raw`\theta_{train} + \unknown`,String.raw`\v{x}`,String.raw`\(x + 2`,String.raw`$$x + 2`,String.raw`\\theta + 2`,String.raw`a \\ b`,String.raw`\r{x}`]){
  await assert.rejects(W.generate({kind:'docx',blocks:[{type:'paragraph',text}]}),/Raw LaTeX/);
 }
 const spec=W.normalize({kind:'docx',blocks:[{type:'paragraph',text:String.raw`\theta_{train} ≥ 95\%`}]});
 assert.equal(spec.blocks[0].text,'θ_(train) ≥ 95%');
});
test('heatmap row labels and nested ZIP documents are validated without touching source files',()=>{
 const chart=W.normalize({kind:'chart',chartType:'heatmap',labels:[String.raw`\alpha`],rowLabels:[String.raw`\beta`],values:[[1]]});
 assert.deepEqual(chart.rowLabels,['β']);assert.deepEqual(chart.labels,['α']);assert.doesNotMatch(W.chartSvg(chart),/\\alpha|\\beta/);
 const archive=W.normalize({kind:'zip',filename:'report.zip',entries:[{path:'report.docx',file:{kind:'docx',blocks:[{type:'paragraph',text:raw}]}},{path:'source.tex',file:{kind:'text',filename:'source.tex',content:raw}}]});
 assert.equal(archive.entries[0].file.blocks[0].text,expected);assert.equal(archive.entries[1].file.content,raw);
});
test('literal protection does not collide with source characters or alter chat replies',()=>{
 const literal='\uE0000\uE001 and `\\frac{a}{b}`';
 assert.equal(W.normalize({kind:'docx',blocks:[{type:'paragraph',text:literal}]}).blocks[0].text,literal);
 const chat=String.raw`Chat equation: \(\frac{a}{b}\).`;
 assert.equal(W.extract(chat).text,chat);
});
test('actual Word, PowerPoint and Excel package text contains readable notation',async()=>{
 const {generate}=await import('../widgets-engine.js'),JSZip=require('jszip');
 const specs=[
  {kind:'docx',title:'Report',blocks:[{type:'heading',text:raw},{type:'paragraph',text:[{text:raw,bold:true}]},{type:'table',headers:['Result'],rows:[[raw]]},{type:'formula',text:'x = 2',caption:raw}]},
  {kind:'pptx',title:'Slides',slides:[{title:'Result',bullets:[raw],notes:raw}]},
  {kind:'xlsx',title:'Data',sheets:[{name:'Results',headers:['Expression'],rows:[[raw]]}]}
 ];
 for(const spec of specs){
  const blob=await generate(W.normalize(spec)),zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const names=Object.keys(zip.files).filter(n=>/^(word\/document|ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)|xl\/(?:sharedStrings|worksheets\/sheet\d+))\.xml$/.test(n));
  assert.ok(names.length,spec.kind);
  const xml=(await Promise.all(names.map(n=>zip.file(n).async('string')))).join('\n');
  assert.doesNotMatch(xml,/\\ge|\\theta|\\times|T_\{train\}|x\^\{2\}/,spec.kind);
  assert.match(xml,/θ/);assert.match(xml,/×/);assert.match(xml,/T_\(train\)/);assert.match(xml,/x²/);
 }
});
test('actual PDF definition uses cleaned prose, table cells and captions',async()=>{
 const {generate}=await import('../widgets-engine.js'),pdfMake=require('pdfmake/build/pdfmake.js'),original=pdfMake.createPdf;let definition;
 pdfMake.createPdf=(d,...args)=>{definition=d;return original.call(pdfMake,d,...args);};
 try{
  const blob=await generate(W.normalize({kind:'pdf',title:'Results',blocks:[{type:'paragraph',text:raw},{type:'table',headers:['Result'],rows:[[raw]]},{type:'formula',text:'x = 2',caption:raw}]}));
  assert.equal((await blob.text()).slice(0,5),'%PDF-');
  const content=JSON.stringify(definition.content);assert.ok(content.includes(expected));assert.doesNotMatch(content,/\\\\ge|\\\\theta|\\\\times/);
 }finally{pdfMake.createPdf=original;}
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const W=require('../widgets.js'),JSZip=require('jszip'),fixture=require('./fixtures/conditional-formulas.cjs');
const text=value=>typeof value==='string'?value:value.map(r=>r.text).join('');
test('conditional formula fields are bounded, styled and idempotent without changing saved source',()=>{
 const spec=W.normalize({kind:'docx',blocks:[{type:'formula',text:'f(x) = x²',condition:[{text:'if x ≥ 0',italic:true,color:'087F8C'}]}]});
 assert.deepEqual(W.normalize(spec),spec);assert.equal(spec.blocks[0].condition[0].color,'087F8C');
 for(const condition of [1,{},'', '  ','x'.repeat(501),[{text:'x'.repeat(251)},{text:'y'.repeat(251)}]])assert.throws(()=>W.normalize({kind:'docx',blocks:[{type:'formula',text:'x = 1',condition}]}));
 assert.match(W.instructionFor('Make Word solutions'),/separate condition field/);assert.match(W.instructionFor('Make PDF solutions'),/never align conditions with tabs/);
});
test('legacy recurrence spacing becomes separate condition rows, retaining every glyph and rich-text style',async()=>{
 const {formulaRows}=await import('../formula-layout.js');
 for(const block of fixture.blocks.filter(b=>b.type==='formula').slice(0,3)){
  const before=JSON.stringify(block),rows=formulaRows(block);assert.equal(rows.length,1);
  assert.match(text(rows[0].condition),/^if /);assert.equal(text(rows[0].text).trim()+' '+text(rows[0].condition),block.text.replace(/[ \t]+(?=if )/,' '));
  assert.equal(JSON.stringify(block),before);
 }
 const styled={type:'formula',text:[{text:'a = b ',bold:true},{text:'   i',italic:true},{text:'f x > 0',color:'087F8C'}]};
 const row=formulaRows(styled)[0];assert.equal(text(row.text),'a = b');assert.equal(text(row.condition),'if x > 0');assert.equal(row.text[0].bold,true);assert.equal(row.condition[0].italic,true);assert.equal(row.condition[1].color,'087F8C');
 const multiple=formulaRows({text:'a = 0    if x = 0\na = x    when x > 0\na = −x'});assert.equal(multiple.length,3);assert.equal(text(multiple[2].text),'a = −x');
});
test('formula layout leaves nested expressions, literal text, primes and ordinary working intact',async()=>{
 const {formulaRows,shortFormulaRow}=await import('../formula-layout.js');
 for(const value of ['F = m × a\n= 2 × 3\n= 6 N','f(x) = select(if x > 0, a, b)','a = "text if x = 0"','Only show this if needed','b = [if x = 0]','a = b + if x > 0','a = b] if x > 0'])assert.deepEqual(formulaRows({text:value}),[{text:value}]);
 assert.equal(text(formulaRows({text:"f′(x) = 2x   if x > 0"})[0].condition),'if x > 0');
 assert.equal(shortFormulaRow({text:'x'.repeat(4000),condition:'if y > 0'}),false);
 assert.equal(shortFormulaRow({text:'x = 1',condition:'if y > 0'}),true);
 assert.equal(shortFormulaRow({text:'x = 1',condition:'if y > 0'},'An explanation'),true);
 assert.equal(shortFormulaRow({text:'x'.repeat(1300),condition:'if y > 0'},'c'.repeat(500)),false);
});
test('Word separates conditions from formulas using editable paragraphs and keeps each short pair together',async()=>{
 const {generate}=await import('../widgets-engine.js'),spec=W.normalize(fixture),raw=JSON.stringify(spec);
 const blob=await generate(spec),zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('word/document.xml').async('string');
 const paragraphs=xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g)||[];
 for(const condition of ['if i = 0','if w[i] &gt; c','if w[i] &lt;= c','if x ≥ 0','if x &lt; 0']){
  const p=paragraphs.find(p=>p.includes(condition));assert.ok(p,condition);assert.doesNotMatch(p,/dp\[|f\(x\)/);assert.match(p,/<w:jc w:val="center"/);
 }
 for(const p of paragraphs.filter(p=>/dp\[|f\(x\)/.test(p))){assert.match(p,/<w:keepNext\/>/);assert.doesNotMatch(p,/\t| {3,}|if w\[|if i =/);}
 assert.match(xml,/dp\[i-1\]\[c - w\[i\]\] \+ v\[i\]/);assert.match(xml,/Choose the better/);assert.match(xml,/<w:br\/>/);assert.doesNotMatch(xml,/<w:drawing|<m:oMath/);
 assert.equal(JSON.stringify(spec),raw);
 if(process.env.ORBIT_FORMULA_QA){fs.mkdirSync('tests/output/formula-layout',{recursive:true});fs.writeFileSync('tests/output/formula-layout/conditional-formulas.docx',Buffer.from(await blob.arrayBuffer()));fs.writeFileSync('tests/output/formula-layout/spec.json',JSON.stringify(spec,null,2));}
});
test('PDF uses the same condition layout, permits long rows to paginate, and retains searchable text',async()=>{
 const {generate}=await import('../widgets-engine.js'),pdfMake=require('pdfmake/build/pdfmake.js'),original=pdfMake.createPdf;let definition;
 pdfMake.createPdf=function(value,...args){definition=value;return original.call(this,value,...args);};
 try{
  const blob=await generate(W.normalize({...fixture,kind:'pdf'}));assert.equal((await blob.text()).slice(0,5),'%PDF-');
  const formulas=definition.content.filter(node=>node.id?.startsWith('orbit-body-')&&node.stack?.some(row=>row.stack));
  const row=formulas[0].stack[0];assert.equal(row.unbreakable,true);assert.equal(row.stack[0].text.map(r=>r.text).join(''),'dp[i][c] = 0');assert.equal(row.stack[1].text.map(r=>r.text).join(''),'if i = 0');
  assert.equal(row.stack[2].text,'No items means no revenue.');
  const ordinary=formulas.at(-1).stack[0];assert.equal(ordinary.unbreakable,true);assert.equal(ordinary.stack.at(-1).text,'Equality steps keep their original line layout.');
  if(process.env.ORBIT_FORMULA_QA)fs.writeFileSync('tests/output/formula-layout/conditional-formulas.pdf',Buffer.from(await blob.arrayBuffer()));
  await generate(W.normalize({kind:'pdf',blocks:[{type:'formula',text:'x'.repeat(4000),condition:'if y > 0',caption:'c'.repeat(500)}]}));
  assert.equal(definition.content[1].stack[0].unbreakable,undefined,'oversized formulas must be allowed to span pages');
 }finally{pdfMake.createPdf=original;}
});

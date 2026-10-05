const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const W=require('../widgets.js'),A=require('../analyze.js'),JSZip=require('jszip');
const fixture=require('./fixtures/worked-statistics.cjs');
test('Analyze preserves worked explanations and supplies intermediate evidence to the writer',async()=>{
 let calls=0;
 const result=await A.analyze([{role:'user',text:'Make Word solutions for this statistics question paper'}],{
  plan:async messages=>{assert.match(messages[0].text,/intermediate quantities/);assert.match(messages[0].text,/extreme tails/);assert.match(messages[0].text,/numerical precision failure, not proof of equality/);assert.match(messages[0].text,/relative tail ratio/);assert.match(messages[0].text,/strict versus inclusive inequalities/);assert.match(messages[0].text,/LOGS OF THOSE SMALL DEFICITS/);assert.match(messages[0].text,/raise an assertion error/);return JSON.stringify(calls++?{action:'done'}:{action:'run',code:'print("n=9; sum_x=162; r=-0.999787")'});},
  run:async()=>({ok:true,output:'n=9; sum_x=162; r=-0.999787'})
 });
 assert.match(result.instruction,/does not replace the worked explanation/);
 assert.match(result.instruction,/EVERY|every question and subpart/);
 assert.match(result.instruction,/actual numerical substitution, intermediate calculations/);
 assert.match(result.instruction,/collapsed Analyze log is not the solution/);
 assert.match(result.instruction,/n=9; sum_x=162/);
 assert.match(result.instruction,/does not certify the mathematics/);
});
test('file contracts preserve subparts and do not force LaTeX; long documents retain the same contract',()=>{
 for(const prompt of ['Make Word solutions for this question paper','a pdf too']){
  const instruction=W.instructionFor(prompt);
  assert.match(instruction,/EVERY question and subpart/);
  assert.match(instruction,/must NOT shorten the solution/);
  assert.match(instruction,/actual substitutions, intermediate calculations/);
  assert.match(instruction,/LaTeX is OPTIONAL/);
  assert.match(instruction,/"type":"formula"/);
  const example=JSON.parse(instruction.match(/Mathematics in files: PDF\/Word support (\{.*?\})\./)[1]);
  assert.equal(example.text,'F = m × a\n= 2 × 3\n= 6 N');
  assert.match(instruction,/Default to one equality step per line/);
  assert.match(instruction,/centering each complete line independently/);
  assert.match(instruction,/use gathered, not aligned/);
  assert.match(instruction,/complete working in BOTH chat and each requested file/);
 }
 assert.doesNotMatch(W.instructionFor('Make an Excel inventory'),/Worked solutions:/);
 assert.match(fs.readFileSync('app.js','utf8'),/Mathematics in files:\|Worked solutions:/);
 assert.match(fs.readFileSync('long-documents.js','utf8'),/preserve every supplied question and subpart in the plan/);
});
test('plain formulas are lossless, bounded, styled and idempotent; legacy math text is unambiguous',()=>{
 const raw={kind:'docx',blocks:[{type:'formula',text:[{text:'r = ',italic:true},{text:'−5328 / √(2160 × 13148) = −0.999787',bold:true}],caption:'Numerical substitution'}]};
 const spec=W.normalize(raw);
 assert.deepEqual(W.normalize(spec),spec);
 assert.deepEqual(spec.blocks,raw.blocks);
 assert.equal(W.normalize({kind:'pdf',blocks:[{type:'math',text:'p = 6/32 = 0.1875'}]}).blocks[0].type,'formula');
 for(const text of ['', '  ',[],[{}],1,'x'.repeat(4001),[{text:'x'.repeat(2200)},{text:'x'.repeat(2200)}]])assert.throws(()=>W.normalize({kind:'docx',blocks:[{type:'formula',text}]}));
 assert.throws(()=>W.normalize({kind:'docx',blocks:[{type:'formula',text:'x = 1',caption:'x'.repeat(501)}]}));
});
test('editable file formulas do not weaken chat KaTeX or its boxed final answers',()=>{
 const source=fs.readFileSync('app.js','utf8');
 assert.match(source,/In chat mathematical solutions, present each final answer using \\boxed/);
 assert.match(source,/Chat renders LaTeX with KaTeX/);
 assert.match(source,/Generated Word\/PDF\/PowerPoint content follows the file tool's Mathematics in files rules instead/);
 assert.match(source,/This does not change chat's LaTeX formatting/);
 assert.match(source,/Chat-only worked solutions need the same complete derivation/);
 assert.match(A.instruction,/Unless the user explicitly asks for answers only or a summary, preserve this working/);
});
test('worked question-paper fixture retains all working tables, subparts and full-precision substitutions in editable Word',async()=>{
 const {generate}=await import('../widgets-engine.js'),spec=W.normalize(fixture.spec);
 const blob=await generate(spec),zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('word/document.xml').async('string');
 for(const label of ['1(i)','1(ii)','1(iii)','1(iv)','2(a)','2(b)(i)','2(b)(ii)','Question 3','4(i)','4(ii)','Question 5','Question 6'])assert.ok(xml.includes(label),label);
 const formulaCount=spec.blocks.filter(b=>b.type==='formula').length;
 assert.ok(formulaCount>30);
 assert.equal((xml.match(/<w:jc w:val="center"\/>/g)||[]).length,formulaCount);
 assert.match(xml,/9 × 3156 − 162² = 2160/);
 assert.match(xml,/9 × 12350 − 162 × 719 = −5328/);
 assert.match(xml,/50.288889/);assert.match(xml,/33.2340079034/);
 assert.equal((xml.match(/<w:tbl>/g)||[]).length,2);
 assert.doesNotMatch(xml,/<w:drawing|<w:pageBreakBefore/);
 assert.equal(Object.keys(zip.files).filter(n=>n.startsWith('word/media/')).length,0);
 const pdf=await generate({...spec,kind:'pdf'});
 assert.equal((await pdf.text()).slice(0,5),'%PDF-');
 if(process.env.ORBIT_WIDGET_QA){fs.mkdirSync('tests/output/worked-solutions',{recursive:true});fs.writeFileSync('tests/output/worked-solutions/spec.json',JSON.stringify(spec));fs.writeFileSync('tests/output/worked-solutions/statistics.docx',Buffer.from(await blob.arrayBuffer()));fs.writeFileSync('tests/output/worked-solutions/statistics.pdf',Buffer.from(await pdf.arrayBuffer()));}
});
test('centered formula text stays escaped/editable and supports captions, multiline working and a requested page break',async()=>{
 const {generate}=await import('../widgets-engine.js');
 const text='A < B & C > D\n<svg onload=alert(1)>\nx = 1; y = 2';
 const spec=W.normalize({kind:'docx',title:'Literal notation',blocks:[{type:'paragraph',text:'Introduction'},{type:'pageBreak'},{type:'formula',text:[{text,bold:true,color:'2457A6'}],caption:'Editable formula text'}]});
 const zip=await JSZip.loadAsync(await(await generate(spec)).arrayBuffer()),xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/A &lt; B &amp; C &gt; D/);assert.match(xml,/&lt;svg/);
 assert.match(xml,/<w:br\/>/);assert.match(xml,/<w:pageBreakBefore\/>/);
 assert.match(xml,/2457A6/);assert.match(xml,/Editable formula text/);
 assert.equal((xml.match(/<w:jc w:val="center"\/>/g)||[]).length,2);
 assert.doesNotMatch(xml,/<w:drawing|<svg onload/);
});
test('PDF font fallback covers actual mean, prediction, Greek, subscript and root glyphs without changing the formula text',async()=>{
 const {pdfStyledText}=await import('../pdf-text.js'),data=(await import('../document-fonts.js')).default;
 const fontkit=require('@foliojs-fork/fontkit'),fonts={...require('pdfmake/build/vfs_fonts.js'),...data};
 const font=(family,style)=>fontkit.create(Buffer.from(fonts[family==='Roboto'?`Roboto-${{normal:'Regular',bold:'Medium',italics:'Italic',bolditalics:'MediumItalic'}[style]}.ttf`:`${family}-${style}.woff`],'base64'));
 const notation='x̄ + ȳ = 97.888889; x̂ = 21.196836; σ² = 6.25; √13; Σd²; λ > 0; r₁₂.₃';
 for(const family of ['Roboto','Serif','Mono'])for(const style of [{},{bold:true},{italic:true},{bold:true,italic:true}]){
  const output=pdfStyledText([{text:notation,...style,underline:true,color:'2457A6'}],family),slant=style.bold?(style.italic?'bolditalics':'bold'):(style.italic?'italics':'normal');
  assert.equal(output.map(r=>r.text).join(''),notation);
  for(const run of output){const f=font(run.font||family,slant);for(const c of run.text)assert.ok(f.hasGlyphForCodePoint(c.codePointAt(0)),`${family}/${slant}: ${c}`);assert.equal(run.decoration,'underline');assert.equal(run.color,'#2457A6');}
  const mean=output.find(r=>r.text.includes('x̄'));assert.ok(mean);if(family==='Roboto')assert.equal(mean.font,'Symbols');
 }
 assert.deepEqual(pdfStyledText('Ordinary text stays unchanged'),[{text:'Ordinary text stays unchanged'}]);
});

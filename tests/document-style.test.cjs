const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../widgets.js'),JSZip=require('jszip');
const basic={kind:'pdf',title:'Math & styles',blocks:[{type:'math',latex:'\\frac{1}{2}'},{type:'callout',title:'Result',tone:'success',text:[{text:'Verified',bold:true,italic:true,underline:true}]},{type:'divider'}]};
test('document style validates palettes, fonts, borders and accent; old recipes get safe defaults',()=>{
 assert.equal(W.normalize(basic).style.theme,'classic');
 for(const theme of ['classic','ocean','forest','plum','terracotta','slate'])for(const font of ['sans','serif','mono'])assert.equal(W.normalize({...basic,style:{theme,font,border:'frame',accent:'#795487'}}).style.accent,'795487');
 for(const style of [{font:'url(https://evil)'},{border:'bad'},{theme:'bad'},{accent:'red; color:blue'}])assert.throws(()=>W.normalize({...basic,style}));
 assert.throws(()=>W.normalize({...basic,blocks:[{type:'math',latex:'x'.repeat(4001)}]}));
});
test('equations are standalone paths and reject unsafe, malformed or expanding TeX',async()=>{
 const {mathSvg}=await import('../document-rendering.js');
 for(const latex of ['\\int_0^1 x^2 dx=\\frac13','\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}','\\sum_{n=1}^\\infty \\frac{1}{n^2}=\\frac{\\pi^2}{6}','\\begin{aligned}a&=b+c\\\\d&=e\\end{aligned}']){const r=mathSvg(latex);assert.match(r.svg,/<path/);assert.doesNotMatch(r.svg,/<script|<foreignObject|<use|href=/);assert.ok(r.width>0&&r.height>0);}
 for(const latex of ['', '\\frac{1}{', '\\invalidmacro{x}', '\\href{https://example.com}{x}', '\\require{html}', '\\def\\x{\\x}\\x'])assert.throws(()=>mathSvg(latex));
});
test('PDF embeds each font family and valid equations; page geometry and Word styles survive export',async()=>{
 const {generate}=await import('../widgets-engine.js');
 for(const font of ['sans','serif','mono']){const blob=await generate(W.normalize({...basic,style:{font,theme:'plum',border:'frame'}}));assert.equal((await blob.text()).slice(0,5),'%PDF-');}
 for(const pageSize of ['A4','Letter']){const blob=await generate(W.normalize({kind:'docx',title:'Styled',style:{font:'serif',theme:'plum',border:'frame',pageSize},blocks:[{type:'paragraph',text:'Body'},{type:'callout',text:'Success',tone:'success'},{type:'table',headers:['A','B'],rows:[['one','two']]}]}));const zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/Georgia/);assert.match(xml,/w:pgBorders/);assert.match(xml,/326B50/);assert.match(xml,pageSize==='A4'?/w:w="4513"/:/w:w="4680"/);assert.ok(zip.file('word/footer1.xml'));}
});
test('PPT math is a main visual, with no competing layout and at most two bullets',()=>{
 const s={kind:'pptx',title:'Math',slides:[{title:'Proof',layout:'visual',math:'x^2',bullets:['One','Two']}]};assert.equal(W.normalize(s).slides[0].math,'x^2');
 assert.throws(()=>W.normalize({...s,slides:[{...s.slides[0],image:{assetId:'img-test'}}]}),/one main/);
 assert.throws(()=>W.normalize({...s,slides:[{...s.slides[0],bullets:['1','2','3']}]}),/at most 2/);
 assert.match(W.instruction(),/Mathematics in files/);
});

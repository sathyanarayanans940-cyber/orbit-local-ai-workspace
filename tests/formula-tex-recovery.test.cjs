const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../widgets.js');
const expressions=[String.raw`Decision = \begin{cases} Local & if C \ge \theta \\ Cloud & if C < \theta \end{cases}`,String.raw`T_{train} = O(T \times M \times N \log N)`,String.raw`T_{inference} = O(T \times D)`];
test('TeX in legacy formula fields becomes rendered math, retaining caption and condition',()=>{
 for(const kind of ['docx','pdf'])for(const text of expressions){const input={kind,blocks:[{type:'formula',text,condition:'where θ is the confidence threshold',caption:'Explanation'}]},before=JSON.stringify(input),spec=W.normalize(input);assert.equal(spec.blocks[0].type,'math');assert.match(spec.blocks[0].latex,/\\text\{where θ is the confidence threshold\}/);assert.ok(spec.blocks[0].latex.includes(text));assert.equal(spec.blocks[0].caption,'Explanation');assert.equal(JSON.stringify(input),before);assert.deepEqual(W.normalize(spec),spec);}
});
test('ordinary editable formulas and literal code remain unchanged',()=>{
 for(const text of ['x = 2 × 3','T_train = O(T × D)','$5 per unit','$5 + $10 = $15',String.raw`C:\Users\sample\file.txt`])assert.equal(W.normalize({kind:'docx',blocks:[{type:'formula',text}]}).blocks[0].type,'formula');
 const text=String.raw`print("\\begin{cases}")`;assert.equal(W.normalize({kind:'docx',blocks:[{type:'code',text}]}).blocks[0].text,text);
});
test('delimiters, rich-text fragments, and TeX conditions render without literal control commands',async()=>{
 const {mathSvg}=await import('../document-rendering.js');
 const blocks=[{type:'formula',text:String.raw`\[\frac{1}{2}\]`},{type:'formula',text:'$$x^{2}$$'},{type:'formula',text:[{text:'T_'},{text:'{train} = '},{text:String.raw`N \log N`}]},{type:'formula',text:'x = 1',condition:String.raw`x \ge \theta`},{type:'formula',text:'x = \\frac{1}{2}\n= 0.5'}];
 for(const b of W.normalize({kind:'pdf',blocks}).blocks){assert.equal(b.type,'math');const result=mathSvg(b.latex);assert.match(result.svg,/<path/);assert.doesNotMatch(result.svg,/data-mjx-error/);}
});
test('actual PDF output renders recovered cases and complexity formulas as vectors',async()=>{
 const {generate}=await import('../widgets-engine.js'),pdfMake=require('pdfmake/build/pdfmake.js'),original=pdfMake.createPdf;let definition;
 pdfMake.createPdf=(d,...args)=>{definition=d;return original.call(pdfMake,d,...args);};
 try{const blob=await generate(W.normalize({kind:'pdf',blocks:expressions.map(text=>({type:'formula',text,caption:'Retained caption'}))}));assert.equal((await blob.text()).slice(0,5),'%PDF-');const equations=definition.content.filter(n=>n.stack?.[0]?.svg);assert.equal(equations.length,3);for(const e of equations)assert.match(e.stack[0].svg,/<path/);}finally{pdfMake.createPdf=original;}
});
test('condition punctuation is literal, unsupported TeX fails clearly, and equations stay bounded',async()=>{
 const {mathSvg}=await import('../document-rendering.js');
 const spec=W.normalize({kind:'docx',blocks:[{type:'formula',text:String.raw`x = \frac{1}{2}`,condition:'where a_b & c^d cost $5 #1 at 50% ~ {note}'}]});assert.doesNotThrow(()=>mathSvg(spec.blocks[0].latex));
 const bad=W.normalize({kind:'pdf',blocks:[{type:'formula',text:String.raw`x = \invalidmacro{y}`}]}).blocks[0];assert.equal(bad.type,'math');assert.throws(()=>mathSvg(bad.latex),/invalid|unsupported/);
 assert.throws(()=>W.normalize({kind:'docx',blocks:[{type:'formula',text:'x = \\theta '+ 'x'.repeat(3980),condition:'where y = 2'}]}));
});
test('Word export uses the equation drawing path rather than printing raw TeX runs',async()=>{
 const {generate}=await import('../widgets-engine.js'),JSZip=require('jszip'),original={Image:global.Image,document:global.document};
 // Browser canvas shim exercises DOCX packaging; real vector glyphs are checked
 // in the PDF/mathSvg tests above, not by this one-pixel raster fixture.
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
 global.Image=class{set src(v){if(v)queueMicrotask(()=>this.onload?.());}};
 global.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=>png})};
 try{const blob=await generate(W.normalize({kind:'docx',blocks:expressions.map(text=>({type:'formula',text,caption:'Formula caption'}))})),z=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await z.file('word/document.xml').async('string');assert.equal((xml.match(/<w:drawing>/g)||[]).length,3);assert.doesNotMatch((xml.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g)||[]).join(''),/\\begin|\\times|T_\{/);assert.match(xml,/Formula caption/);}finally{global.Image=original.Image;global.document=original.document;}
});

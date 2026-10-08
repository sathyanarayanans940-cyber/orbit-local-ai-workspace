const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../document-format.js'),W=require('../widgets.js'),D=require('../document-assets.js'),E=require('../document-edits.js'),JSZip=require('jszip'),{DOMParser}=require('@xmldom/xmldom');
const xml=s=>new DOMParser().parseFromString(s,'text/xml');
const spec={kind:'docx',title:'Lab report',style:{word:{body:{font:'Times New Roman',size:12,color:'000000',lineSpacing:1.5,alignment:'justify'},title:{font:'Arial',size:22,color:'234567',alignment:'center'},heading1:{font:'Georgia',size:16,color:'012345'},code:{font:'Consolas',size:10,color:'123456',lineSpacing:1,alignment:'left'},page:{width:8.5,height:11,margins:{top:.75,right:.8,bottom:.75,left:.8},borders:Object.fromEntries(['top','right','bottom','left'].map(k=>[k,{style:'double',width:1.5,color:'345678',space:20}]))},pageNumbers:false}},blocks:[{type:'heading',text:'Method'},{type:'paragraph',text:'Body text in the requested family.'},{type:'code',text:'int value = 42;\nreturn value;',language:'cpp'},{type:'table',headers:['Item','Value'],rows:[['A','42']]}]};
async function profile(blob){const z=await JSZip.loadAsync(await blob.arrayBuffer());return F.extract({document:xml(await z.file('word/document.xml').async('string')),styles:xml(await z.file('word/styles.xml').async('string')),theme:z.file('word/theme/theme1.xml')?xml(await z.file('word/theme/theme1.xml').async('string')):null});}
test('custom Word typography, page border, geometry and code fonts survive export and sample extraction',async()=>{
 const {generate}=await import('../widgets-engine.js'),normalized=W.normalize(spec),blob=await generate(normalized),zip=await JSZip.loadAsync(await blob.arrayBuffer()),content=await zip.file('word/document.xml').async('string');
 for(const font of ['Times New Roman','Arial','Georgia','Consolas'])assert.ok(content.includes(font));
 assert.match(content,/w:line="360"/);assert.match(content,/w:val="double"/);assert.match(content,/w:sz="12"/);assert.match(content,/w:top="1080"/);assert.match(content,/w:w="12240"/);assert.ok(!zip.file('word/footer1.xml'));
 const p=await profile(blob);assert.equal(p.word.body.font,'Times New Roman');assert.equal(p.word.body.size,12);assert.equal(p.word.title.font,'Arial');assert.equal(p.word.title.color,'234567');assert.equal(p.word.heading1.font,'Georgia');assert.equal(p.word.code.font,'Consolas');assert.equal(p.word.page.borders.top.style,'double');assert.equal(p.word.page.borders.top.color,'345678');assert.equal(p.word.page.margins.top,.75);
 assert.deepEqual(W.normalize(normalized),normalized);
});
test('sample styles apply only through a selected ID; explicit overrides win and survive save/reload',async()=>{
 const {generate}=await import('../widgets-engine.js'),p=await profile(await generate(W.normalize(spec))),messages=[{attachments:[{name:'Sample.docx',formatId:'fmt-sample',formatProfile:p}]}];
 const raw=W.normalize({kind:'docx',title:'New report',style:{templateId:'fmt-sample',word:{title:{color:'FF0000'},code:{font:'Courier New'}}},blocks:[{type:'paragraph',text:'New content'}]});
 const resolved=D.applyTemplate(raw,JSON.parse(JSON.stringify(messages)));assert.equal(resolved.style.word.title.color,'FF0000');assert.equal(resolved.style.word.title.size,22);assert.equal(resolved.style.word.code.font,'Courier New');assert.equal(resolved.style.word.body.font,'Times New Roman');assert.equal(resolved.style.templateId,undefined);assert.equal(resolved.blocks[0].text,'New content');assert.equal(p.word.title.color,'234567');
 assert.deepEqual(D.applyTemplate({...raw,style:{}},messages).style,{});assert.throws(()=>D.applyTemplate(raw,[]),/unavailable/);await assert.rejects(generate(raw),/Resolve/);
 const exported=await profile(await generate(resolved));assert.equal(exported.word.title.color,'FF0000');assert.equal(exported.word.body.font,'Times New Roman');assert.match(D.instruction(messages),/ONLY when the user/);
});
test('invalid styles fail before export and margins cannot consume the page',async()=>{
 for(const word of [{body:{font:'<script>'}},{code:{size:NaN}},{title:{color:'red'}},{body:{lineSpacing:9}},{page:{width:100}},{page:{borders:{top:{style:'art'}}}},{body:{bold:'false'}},null])assert.throws(()=>W.normalize({...spec,style:{word}}));
 assert.throws(()=>W.normalize({...spec,kind:'pdf'}),/docx/i);
 const {generate}=await import('../widgets-engine.js');await assert.rejects(generate(W.normalize({...spec,style:{word:{page:{width:5,height:5,margins:{left:3,right:3}}}}})),/less than two inches/);
});
test('format-only edit can add typography to old documents without altering content',()=>{
 const original=W.normalize({kind:'docx',title:'Existing',blocks:[{type:'paragraph',text:'Keep this text exactly.'}]});
 const result=E.apply(original,[{op:'format',before:{},value:{body:{font:'Times New Roman',size:12},title:{bold:false}}}]);assert.deepEqual(result.blocks,original.blocks);assert.equal(result.style.word.body.size,12);assert.equal(original.style.word,undefined);
 assert.throws(()=>E.apply(result,[{op:'format',before:{},value:{body:{size:14}}}]),/no longer matches/);
});
test('Word style inheritance, theme fonts/colors, direct formatting and cycles are bounded',()=>{
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const styles=xml(`<w:styles xmlns:w="${ns}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:color w:themeColor="accent1"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/><w:sz w:val="44"/></w:rPr></w:style><w:style w:styleId="CycleA"><w:basedOn w:val="CycleB"/></w:style><w:style w:styleId="CycleB"><w:basedOn w:val="CycleA"/></w:style></w:styles>`);
 const theme=xml('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="123456"/></a:accent1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>');
 const document=xml(`<w:document xmlns:w="${ns}"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>Title</w:t></w:r></w:p><w:p><w:r><w:t>Body</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="CycleA"/></w:pPr><w:r><w:t>Cycle</w:t></w:r></w:p></w:body></w:document>`);
 const p=F.extract({document,styles,theme});assert.equal(p.word.title.font,'Georgia');assert.equal(p.word.title.color,'FF0000');assert.equal(p.word.body.font,'Arial');assert.equal(p.word.body.color,'123456');assert.ok(p.warnings.some(w=>w.includes('circular')));
});
test('staged DOCX carries template ID and overrides from the outline into the final recipe',async()=>{
 const L=require('../long-documents.js');let calls=0;
 const result=await L.build('Create an 8 page Word report matching Sample.docx',{model:{id:'8b'},context:[],instruction:W.instruction(),normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB:null}),plan:async messages=>{if(calls++===0){assert.match(messages[0].text,/Word formatting:/);return JSON.stringify({title:'Report',style:{templateId:'fmt-sample',word:{title:{font:'Arial'}}},sections:Array.from({length:8},(_,i)=>({title:'Section '+i,brief:'Explain'}))});}return JSON.stringify({blocks:[{type:'paragraph',text:'This section explains the supplied example. '.repeat(80)}]});}});
 const parsed=W.extract(result.text).artifacts[0];assert.equal(parsed.style.templateId,'fmt-sample');assert.equal(parsed.style.word.title.font,'Arial');
});
test('sample paragraph gaps surround the code block rather than separating every source line',async()=>{
 const {generate}=await import('../widgets-engine.js'),blob=await generate(W.normalize({...spec,style:{word:{code:{spaceBefore:8,spaceAfter:12,lineSpacing:1}}}})),z=await JSZip.loadAsync(await blob.arrayBuffer()),doc=xml(await z.file('word/document.xml').async('string'));
 const paragraphs=Array.from(doc.getElementsByTagName('w:p')).filter(p=>p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val')==='OrbitCode');
 assert.equal(paragraphs.length,2);
 const first=paragraphs[0].getElementsByTagName('w:spacing')[0],last=paragraphs[1].getElementsByTagName('w:spacing')[0];
 assert.equal(first.getAttribute('w:before'),'160');assert.equal(first.getAttribute('w:after'),'0');assert.equal(last.getAttribute('w:before'),'0');assert.equal(last.getAttribute('w:after'),'240');
});

const {test}=require('node:test'),assert=require('node:assert/strict'),JSZip=require('jszip');
const W=require('../widgets.js'),D=require('../document-assets.js');
const {modernDeck,architecture,trend}=require('./modern-deck-fixture.js');
test('modern slide layouts preserve structured content and reject contradictory layouts',()=>{
 const deck=W.normalize(modernDeck);assert.equal(deck.slides.length,10);assert.equal(deck.theme,'midnight');assert.equal(deck.slides[2].metrics.length,3);assert.equal(deck.slides[4].visual.nodes.length,5);
 assert.throws(()=>W.normalize({kind:'pptx',slides:[{title:'No data',layout:'metrics',bullets:['Missing metrics']}]}),/metrics/);
 assert.throws(()=>W.normalize({kind:'pptx',slides:[{title:'Too crowded',visual:trend,image:{assetId:'img-x'}}]}),/one main/);
 assert.throws(()=>W.normalize({kind:'pdf',blocks:[{type:'visual',visual:{kind:'pdf',blocks:[]}}]}),/diagram\/chart/);
});
test('existing diagram reuse resolves exactly and remains portable without a live source chat',()=>{
 const doc={kind:'docx',blocks:[{type:'visual',visual:{artifactId:'saved'}}]};
 const resolved=W.resolveVisuals(doc,[{id:'saved',spec:architecture}]);assert.deepEqual(resolved.blocks[0].visual,W.normalize(architecture));
 assert.deepEqual(W.normalize(JSON.parse(JSON.stringify(resolved))),resolved);
 assert.throws(()=>W.resolveVisuals(doc,[]),/unavailable/);
 assert.match(D.instruction([{artifacts:[{id:'saved',spec:architecture}]}]),/saved/);
 assert.doesNotMatch(W.visualSvg(architecture),/var\(--/);
 assert.match(W.visualSvg(trend),/180/);
});
test('PPTX themes and layouts produce editable text, accurate slide counts and speaker notes',async()=>{
 const {generate}=await import('../widgets-engine.js');
 for(const theme of ['midnight','paper','ocean','coral']){
  const spec=W.normalize({...modernDeck,theme,slides:modernDeck.slides.filter(s=>!s.visual)}),blob=await generate(spec),zip=await JSZip.loadAsync(await blob.arrayBuffer());
  assert.equal(Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).length,8);
  const xml=await zip.file('ppt/slides/slide3.xml').async('string');assert.match(xml,/24 hours/);assert.match(xml,/Planning assumptions/);assert.match(xml,/a:t/);
  const all=await Promise.all(Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).map(p=>zip.file(p).async('string')));assert.ok(all.every(s=>!s.includes('NaN')&&!s.includes('Infinity')));
  assert.match(await zip.file('ppt/notesSlides/notesSlide8.xml').async('string'),/No claims of measured/);
 }
});
test('unrendered diagram fails explicitly rather than disappearing from a file',async()=>{
 const {generate}=await import('../widgets-engine.js');await assert.rejects(generate(W.normalize({kind:'pdf',blocks:[{type:'visual',visual:architecture}]})),/has not been rendered/);
});
test('model hex colors normalize with or without a hash while unsafe colors fail',()=>{
 const diagram={...architecture,nodes:architecture.nodes.map(n=>({...n,color:'0077B6',fill:'#aabbcc'}))};
 const normalized=W.normalize(diagram);assert.equal(normalized.nodes[0].color,'#0077B6');assert.equal(normalized.nodes[0].fill,'#aabbcc');
 assert.throws(()=>W.normalize({...diagram,nodes:[{...diagram.nodes[0],color:'url(https://example.com)'}]}));
});
test('staged presentations accept a single fenced JSON response and preserve theme',async()=>{
 const L=require('../long-documents.js');let calls=0;
 const result=await L.build('Create an 8-slide PowerPoint',{model:{id:'8b'},context:[],instruction:'',normalize:W.normalize,plan:async()=>{
  const value=calls++===0?{title:'Deck',theme:'ocean',sections:Array.from({length:8},(_,i)=>({title:'Slide '+i,brief:'Clear content'}))}:{slides:[{title:'Slide '+calls,bullets:['Useful content']}]};
  return 'Here is the result:\n```json\n'+JSON.stringify(value)+'\n```';
 }});
 const deck=W.extract(result.text).artifacts[0];assert.equal(deck.slides.length,8);assert.equal(deck.theme,'ocean');assert.equal(calls,9);
});
test('embedded visuals recover unambiguous omitted kind but reject ambiguous data',()=>{
 const {kind,...diagram}=architecture,{kind:chartKind,...chart}=trend;
 const result=W.normalize({kind:'pptx',slides:[{title:'Diagram',visual:diagram},{title:'Chart',visual:chart}]});
 assert.equal(result.slides[0].visual.kind,'diagram');assert.equal(result.slides[1].visual.kind,'chart');
 assert.throws(()=>W.normalize({kind:'pptx',slides:[{title:'Ambiguous',visual:{nodes:[],series:[]}}]}),/diagram\/chart/);
});
test('overflow tables preserve final content, continuation styling and actual slide numbers',async()=>{
 const {generate}=await import('../widgets-engine.js');
 const spec=W.normalize({kind:'pptx',theme:'ocean',title:'Overflow audit',slides:[{title:'Detailed table',tone:'dark',table:{headers:['Item','Description'],rows:Array.from({length:10},(_,i)=>['Row '+i,('Detailed requirement '+i+' ').repeat(30)])},notes:'Source evidence retained.'},{title:'Last slide',bullets:['Final marker']}]});
 const blob=await generate(spec),zip=await JSZip.loadAsync(await blob.arrayBuffer());
 const files=Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1]));assert.ok(files.length>2);
 const xml=await Promise.all(files.map(p=>zip.file(p).async('string')));
 assert.match(xml.join('').replace(/<[^>]+>/g,''),/Row 9/);assert.match(xml[1],/continued/);assert.match(xml[1],/102D3A/);
 xml.forEach((s,i)=>assert.ok(s.includes('<a:t>'+String(i+1).padStart(2,'0')+'</a:t>')));
 require('node:fs').writeFileSync('tests/output/document-vision/modern-overflow.pptx',Buffer.from(await blob.arrayBuffer()));
});
test('multiline cylinder labels reserve room for their elliptical caps',()=>{
 const d=W.normalize({kind:'diagram',nodes:[{id:'db',shape:'cylinder',label:'Database\nUsers\nMetadata\nGrades',x:200,y:150,width:180,height:80}],edges:[]});
 assert.ok(d.nodes[0].height>=116);
 assert.match(W.visualSvg(d),/Metadata/);
});

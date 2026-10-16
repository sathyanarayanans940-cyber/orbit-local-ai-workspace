const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../long-documents.js'),W=require('../widgets.js');
const prose='Important evidence remains qualified. '.repeat(50)+'[S1]';
const spec=()=>W.normalize({kind:'pdf',title:'Report',blocks:[{type:'heading',text:'Findings'},{type:'paragraph',text:prose},{type:'code',language:'python',text:'assert x > 0'},{type:'table',headers:['A'],rows:[['Preserve this']]},{type:'paragraph',text:'https://example.com/source Source details'}]});
test('figure space reduces the prose allocation; explicit word count retains priority',()=>{
 const scope={kind:'pdf',count:12};const empty=L.lengthPlan(scope,{},'',[]),figs=L.lengthPlan(scope,{},'',[{generatedVisuals:['diagram','diagram','chart']}]);
 assert.ok(figs.targetWords<empty.targetWords);assert.equal(figs.visualCount,3);assert.ok(figs.reservedPages>=2);
 assert.equal(L.lengthPlan(scope,{},'Write 6000 words',[{generatedVisuals:['diagram']}]).targetWords,6000);
 assert.ok(L.budget({targetWords:400}).maximumWords>400);
});
test('no model calls when measured PDF fits an exact target or a maximum',async()=>{
 for(const pages of [8,12]){let calls=0;const input=spec();const result=await L.fitPdfPages(input,{count:12,request:pages===8?'Make up to 12 pages':'Make 12 pages',normalize:W.normalize,measure:async()=>({pages}),plan:async()=>calls++});assert.equal(calls,0);assert.deepEqual(result.spec,input);assert.equal(result.pages,pages);}
});
test('measured overflow condenses prose while retaining code, tables, references and input',async()=>{
 const input=spec(),before=JSON.stringify(input);let layouts=0,saves=0;
 const out=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async s=>({pages:++layouts===1?18:12}),plan:async messages=>{
  const t=JSON.parse(messages[1].text);assert.equal(t.actualPages,18);assert.equal(t.paragraphs.length,1);return JSON.stringify({replacements:[{index:1,text:'Important evidence remains qualified. [S1]'}]});
 },onSave:async()=>saves++});
 assert.equal(out.pages,12);assert.equal(saves,1);assert.equal(JSON.stringify(input),before);assert.deepEqual(out.spec.blocks.slice(2),input.blocks.slice(2));
});
test('malformed, citation-losing, longer or out-of-bounds edits preserve the original',async()=>{
 for(const replacement of [{index:1,text:'Lost citation'},{index:3,text:'Deletes a table'},{index:1,text:prose+prose},{index:1,text:''}]){
  const input=spec();const result=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async()=>({pages:37}),plan:async()=>JSON.stringify({replacements:[replacement]})});
  assert.equal(result.pages,37);assert.deepEqual(result.spec,input);
 }
});
test('non-improving pagination never commits speculative text changes; cancellation propagates',async()=>{
 const input=spec();let calls=0;
 const result=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async()=>({pages:37}),plan:async()=>{calls++;return JSON.stringify({replacements:[{index:1,text:'Qualified evidence [S1]'}]});}});
 assert.equal(calls,1);assert.deepEqual(result.spec,input);
 const c=new AbortController();await assert.rejects(L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async()=>{c.abort();return {pages:37};},signal:c.signal}),{name:'AbortError'});
});
test('word-count and verbatim requests are measured but never silently shortened',async()=>{
 for(const request of ['Keep it verbatim','Write 5000 words']){const input=spec();const result=await L.fitPdfPages(input,{request,count:12,normalize:W.normalize,measure:async()=>({pages:37}),plan:()=>assert.fail('No rewrite')});assert.equal(result.pages,37);assert.deepEqual(result.spec,input);}
});
test('PDF measurement uses the final compacted layout and rejects missing diagnostics',async()=>{
 const {pdfBlob}=await import('../pdf-layout.js'),{EventEmitter}=require('node:events');
 for(const pages of [12,undefined]){
 const fake={createPdf(){return {getStream(_,cb){const d=new EventEmitter();d._pdfMakePages=pages?Array.from({length:pages},()=>({pageSize:{height:842},items:[{type:'line',item:{y:700,getHeight:()=>20}}]})):undefined;d.end=()=>{d.emit('data',Buffer.from('pdf'));d.emit('end');};cb(d);}};}};
 if(pages)assert.deepEqual(await pdfBlob(fake,{content:[]},{measureOnly:true}),{pages});else await assert.rejects(pdfBlob(fake,{content:[]},{measureOnly:true}),/page count/);
 }
});
const addition='The qualified evidence supports a cautious interpretation. Its limitations should guide how the findings are applied rather than being treated as proof that the same outcome will hold in every setting. [S1]';
test('page constraints distinguish exact, ceiling, floor and range requests',()=>{
 for(const text of ['Make up to 12 pages','Make at most 12 pages','Make max 12 pages','Make 12 pages maximum'])assert.deepEqual(L.pageBounds(text,12),{min:1,max:12});
 for(const text of ['Make at least 12 pages','Make minimum 12 pages'])assert.deepEqual(L.pageBounds(text,12),{min:12,max:Infinity});
 assert.deepEqual(L.pageBounds('Make a 10–12 page PDF',12),{min:10,max:12});
 assert.deepEqual(L.pageBounds('Make a 12-page PDF',12),{min:12,max:12});
 assert.match(L.paginationMessage(8,12,L.pageBounds('up to 12 pages',12)),/requested up to 12/);
 assert.doesNotMatch(L.paginationMessage(8,12,L.pageBounds('up to 12 pages',12)),/shorter/);
 assert.match(L.paginationMessage(8,12),/shorter than requested/);
 const follow=L.target('make it now',[{role:'user',text:'Create a PDF up to 12 pages'}],true);
 assert.equal(follow.request,'Create a PDF up to 12 pages');
});
test('exact underflow expands supported explanation and checkpoints without changing original blocks',async()=>{
 const input=spec(),before=JSON.stringify(input);let calls=0,saves=0;
 const result=await L.fitPdfPages(input,{count:12,request:'Make a 12 page PDF',normalize:W.normalize,measure:async s=>({pages:s.blocks.length===input.blocks.length?9:12}),plan:async messages=>{calls++;assert.match(messages[0].text,/Do not invent/);return JSON.stringify({additions:[{afterBlock:1,text:addition}]});},onSave:async()=>saves++});
 assert.equal(result.pages,12);assert.equal(result.matched,true);assert.equal(calls,1);assert.equal(saves,1);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(result.spec.blocks.filter(b=>b.text!==addition),input.blocks);
});
test('range and minimum requests do not spend calls on already sufficient PDFs',async()=>{
 for(const [request,pages] of [['Make a 10–12 page PDF',11],['Make at least 12 pages',15]]){
  const out=await L.fitPdfPages(spec(),{count:12,request,normalize:W.normalize,measure:async()=>({pages}),plan:()=>assert.fail('already in bounds')});assert.equal(out.pages,pages);assert.equal(out.matched,true);
 }
});
test('invalid additions, new source IDs, new numbers and repeated original text never replace the original',async()=>{
 for(const additions of [[],[{afterBlock:3,text:addition}],[{afterBlock:1,text:addition+' An invented result is 98765.'}],[{afterBlock:1,text:addition+' [S99]'}],[{afterBlock:1,text:prose}]]){
  const input=spec();const out=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async()=>({pages:8}),plan:async()=>JSON.stringify({additions})});assert.deepEqual(out.spec,input);assert.equal(out.pages,8);assert.equal(out.matched,false);
 }
});
test('overshooting additions select complete paragraphs without changing original content',async()=>{
 const input=spec(),additions=[addition,addition.replace('cautious','careful'),addition.replace('cautious','tentative'),addition.replace('cautious','measured')].map(text=>({afterBlock:1,text}));
 const out=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async s=>({pages:8+2*(s.blocks.length-input.blocks.length)}),plan:async()=>JSON.stringify({additions})});
 assert.equal(out.pages,12);assert.equal(out.spec.blocks.length,input.blocks.length+2);assert.equal(out.spec.blocks[2].text,addition);assert.deepEqual(out.spec.blocks.slice(4),input.blocks.slice(2));
});
test('optional expansion layout failures retain a valid original; cancellation propagates',async()=>{
 const input=spec();let measures=0;
 const out=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async()=>{if(measures++)throw Error('layout failed');return {pages:8};},plan:async()=>JSON.stringify({additions:[{afterBlock:1,text:addition}]})});assert.deepEqual(out.spec,input);assert.equal(out.pages,8);
 const c=new AbortController();await assert.rejects(L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async()=>({pages:8}),plan:async()=>{c.abort();return '{}';},signal:c.signal}),{name:'AbortError'});
});
test('expansion is bounded to three improving passes and reports remaining shortfall honestly',async()=>{
 let calls=0;const input=spec();const out=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async s=>({pages:4+s.blocks.length-input.blocks.length}),plan:async()=>JSON.stringify({additions:[{afterBlock:1,text:addition.replace('cautious',['careful','tentative','measured'][calls++])}]})});
 assert.equal(calls,3);assert.equal(out.pages,7);assert.equal(out.matched,false);assert.match(L.paginationMessage(out.pages,12,out.bounds),/shorter/);
});
test('one invalid addition does not discard independently valid paragraphs; duplicates are skipped',async()=>{
 const input=spec();const out=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async s=>({pages:s.blocks.length===input.blocks.length?10:12}),plan:async messages=>{const request=JSON.parse(messages[1].text);assert.equal(request.document[1].index,1);return JSON.stringify({additions:[{afterBlock:999,text:addition},{afterBlock:1,text:addition},{afterBlock:1,text:addition}]});}});
 assert.equal(out.pages,12);assert.equal(out.spec.blocks.length,input.blocks.length+1);
});
test('minimum-page expansion accepts an above-minimum result without rewriting original prose',async()=>{
 const input=spec();const out=await L.fitPdfPages(input,{count:12,request:'Make at least 12 pages',normalize:W.normalize,measure:async s=>({pages:s.blocks.length===input.blocks.length?8:19}),plan:async()=>JSON.stringify({additions:[{afterBlock:1,text:addition}]})});assert.equal(out.pages,19);assert.equal(out.matched,true);assert.deepEqual(out.spec.blocks.filter(b=>b.text!==addition),input.blocks);
});
test('an indivisible overshooting addition cannot force condensation of original content',async()=>{
 const input=spec();const out=await L.fitPdfPages(input,{count:12,normalize:W.normalize,measure:async s=>({pages:s.blocks.length===input.blocks.length?10:13}),plan:async()=>JSON.stringify({additions:[{afterBlock:1,text:addition}]})});assert.deepEqual(out.spec,input);assert.equal(out.pages,10);
});

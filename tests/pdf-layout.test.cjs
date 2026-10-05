const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const page=(y=70)=>({pageSize:{height:842},items:[{type:'line',item:{y,getHeight:()=>16}},{type:'line',item:{y:810,getHeight:()=>10}}]});
test('page fill excludes footers, counts images, and safely ignores an unknown layout shape',async()=>{
 const {trailingPageFill:f}=await import('../pdf-layout.js');assert.ok(f([page(),page()])<.1);assert.ok(f([page(),page(730)])>.9);assert.equal(f(undefined),1);assert.equal(f([page()]),1);assert.equal(f([{},{}]),1);
 assert.ok(f([page(),{pageSize:{height:842},items:[{type:'image',item:{y:48,_height:600}}]}])>.8);
});
test('footer alone cannot strand a heading; real body or figure can keep it on the page',async()=>{
 const {keepHeadingWithBody:f}=await import('../pdf-layout.js');assert.equal(f({headlineLevel:1},[{text:'Footer'}],[{id:'orbit-body-paragraph-9'}]),true);assert.equal(f({headlineLevel:1},[{id:'orbit-body-4',image:'figure'}]),false);assert.equal(f({headlineLevel:1},[{id:'orbit-body-4',headlineLevel:2}],[{id:'orbit-body-paragraph-9'}]),true);assert.equal(f({},[]),false);assert.equal(f({headlineLevel:1},[],[]),false);
});
test('trailing-sliver compaction is bounded, preserves fonts/content, and respects explicit pages',async()=>{
 const {pdfBlob}=await import('../pdf-layout.js');
 for(const compact of [true,false]){
  const calls=[],definition={content:[{id:'orbit-body-paragraph-0',text:'Every original word',margin:[0,0,0,8]}],defaultStyle:{fontSize:11,lineHeight:1.15},styles:{heading:{margin:[0,14,0,8]}}};
  const fake={createPdf(d){calls.push(d);return {getStream(_,callback){const doc=new EventEmitter();doc._pdfMakePages=[page(),page(245)];doc.end=()=>{doc.emit('data',new Uint8Array([37,80,68,70]));doc.emit('end');};callback(doc);}};}};
  const blob=await pdfBlob(fake,definition,{compact});assert.equal(await blob.text(),'%PDF');assert.equal(calls.length,compact?3:1);assert.equal(definition.content[0].margin[3],8);for(const d of calls){assert.equal(d.content[0].text,'Every original word');assert.equal(d.defaultStyle.fontSize,11);assert.equal(d.defaultStyle.lineHeight,1.15);assert.ok(d.styles.heading.margin[1]>=8);assert.ok(d.styles.heading.margin[3]>=4);assert.ok(d.content[0].margin[3]>=4);}
 }
});

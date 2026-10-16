const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../long-documents.js'),W=require('../widgets.js');
const diagram={kind:'diagram',title:'Actual process',nodes:[{id:'a',label:'Input',x:150,y:100},{id:'b',label:'Output',x:450,y:100}],edges:[{from:'a',to:'b'}]};
const chart={kind:'chart',title:'Supplied sample',chartType:'bar',labels:['A','B'],series:[{name:'Count',values:[2,3]}]};
const paragraph=i=>({type:'paragraph',text:`KEEP-SECTION-${i} `+'Meaningful synthetic explanation of supplied system behavior. '.repeat(100)});
const outline={title:'Saved report',sections:Array.from({length:8},(_,i)=>({title:'Section '+(i+1),brief:'Distinct material',generatedVisuals:i===4?['diagram','diagram','chart']:[]}))};
const opts=(plan,store=L.createCheckpoints({indexedDB:null}))=>({model:{id:'gemma4:31b-cloud'},context:[],assets:{images:[],visuals:[]},instruction:W.instruction(),normalize:W.normalize,checkpointStore:store,plan});
const additions=task=>({additions:task.missingKinds.map(kind=>({afterBlock:0,caption:'Evidence-based explanatory visual',visual:kind==='diagram'?diagram:chart}))});
test('a missing fifth-section diagram is added without rewriting four committed sections or its valid prose',async()=>{
 let drafts=0,repairs=0;const statuses=[];
 const result=await L.build('Create a 12 page PDF with diagrams',{...opts(async messages=>{
  const task=JSON.parse(messages[1].text);
  if(task.missingKinds){repairs++;assert.deepEqual(task.missingKinds,['diagram','chart']);assert.equal(task.draft.blocks[0].text,paragraph(5).text);return JSON.stringify(additions(task));}
  if(!task.sectionNumber)return JSON.stringify(outline);
  drafts++;return JSON.stringify({blocks:[paragraph(task.sectionNumber),...(task.sectionNumber===5?[{type:'visual',visual:diagram,caption:'Existing first diagram'}]:[])]});
 }),onStatus:s=>statuses.push(s)});
 const spec=W.extract(result.text).artifacts[0];assert.equal(drafts,8);assert.equal(repairs,1);assert.equal(spec.blocks.filter(b=>b.visual).length,3);
 for(let i=1;i<=8;i++)assert.equal(spec.blocks.filter(b=>b.text===paragraph(i).text).length,1);
 assert.ok(statuses.some(s=>s.includes('Adding missing visuals')));
});
test('failed visual-only repair resumes the saved fifth-section prose without another drafting call',async()=>{
 const store=L.createCheckpoints({indexedDB:null});let drafts=0,repairs=0,failure;
 try{await L.build('Create a 12 page PDF',opts(async messages=>{
  const task=JSON.parse(messages[1].text);
  if(task.missingKinds){repairs++;return JSON.stringify({additions:[]});}
  if(!task.sectionNumber)return JSON.stringify(outline);
  drafts++;return JSON.stringify({blocks:[paragraph(task.sectionNumber)]});
 },store));}catch(e){failure=e;}
 assert.equal(failure.completedSections,4);assert.equal(drafts,5);assert.equal(repairs,3);
 const saved=await store.get(failure.documentCheckpoint);assert.equal(saved.pendingSection.index,4);assert.equal(saved.pendingSection.draft.blocks[0].text,paragraph(5).text);
 const result=await L.build('Create a 12 page PDF',opts(async messages=>{
  const task=JSON.parse(messages[1].text);if(task.missingKinds)return JSON.stringify(additions(task));
  assert.ok(task.sectionNumber>=6);return JSON.stringify({blocks:[paragraph(task.sectionNumber)]});
 },store));assert.equal(W.extract(result.text).artifacts[0].blocks.filter(b=>b.visual).length,3);
 assert.equal((await store.get(failure.documentCheckpoint)).pendingSection,undefined);
});
test('visual additions reject bogus anchors, missing captions, reused references and invalid geometry, then repair precisely',async()=>{
 for(const problem of ['anchor','caption','reference','geometry','wrong-kind']){
  let retries=0;
  const result=await L.build('Create a 12 page PDF',opts(async messages=>{
   const task=JSON.parse(messages[1].text);
   if(task.missingKinds){const response=additions(task);if(retries++===0){const a=response.additions[0];if(problem==='anchor')a.afterBlock=999;if(problem==='caption')a.caption='';if(problem==='reference')a.visual={artifactId:'fake'};if(problem==='geometry')a.visual={...diagram,nodes:[{id:'a',label:'Outside',x:-100,y:-100}]};if(problem==='wrong-kind')a.visual=chart;}else assert.match(messages.at(-1).text,/validation/);return JSON.stringify(response);}
   if(!task.sectionNumber)return JSON.stringify(outline);return JSON.stringify({blocks:[paragraph(task.sectionNumber)]});
  }));assert.equal(retries,2);assert.equal(W.extract(result.text).artifacts[0].blocks.filter(b=>b.visual).length,3);
 }
});
test('cancelling missing-visual generation preserves the draft and never reports a finished document',async()=>{
 const store=L.createCheckpoints({indexedDB:null}),c=new AbortController();
 await assert.rejects(L.build('Create a 12 page PDF',{...opts(async messages=>{const task=JSON.parse(messages[1].text);if(task.missingKinds){c.abort();throw new DOMException('Stopped','AbortError');}return JSON.stringify(task.sectionNumber?{blocks:[paragraph(task.sectionNumber)]}:outline);},store),signal:c.signal}),{name:'AbortError'});
});
test('Word visual recovery preserves rich text and sends added diagrams through evidence review',async()=>{
 let audited=0;
 const result=await L.build('Create an 8 page Word report',{...opts(async messages=>{
  const task=JSON.parse(messages[1].text);
  if(task.missingKinds)return JSON.stringify(additions(task));
  if(task.draft){audited++;if(task.section.title==='Section 5')assert.equal(task.draft.blocks.filter(b=>b.visual).length,3);return '{"issues":[]}';}
  if(!task.sectionNumber)return JSON.stringify({...outline,sections:outline.sections.map(s=>({...s,sourceIds:['S1']}))});
  return JSON.stringify({blocks:[{type:'paragraph',text:[{text:paragraph(task.sectionNumber).text,bold:true},{text:' [S1]'}]}]});
 }),research:[{url:'https://example.com/evidence',title:'Synthetic evidence',content:'Synthetic input and output relationship for regression testing.'}],researchRequired:true});
 const spec=W.extract(result.text).artifacts[0];assert.equal(spec.kind,'docx');assert.equal(audited,8);assert.equal(spec.blocks.filter(b=>b.visual).length,3);assert.ok(spec.blocks.some(b=>Array.isArray(b.text)&&b.text[0].bold));
});
test('invalid generated activity nodes get focused repair with original labels retained in the repair request',async()=>{
 let recovery=0;
 const result=await L.build('Create a 12 page PDF',opts(async messages=>{
  const task=JSON.parse(messages[1].text);
  if(task.missingKinds){recovery++;assert.equal(task.rejectedVisuals[0].block.visual.nodes[0].label,'Target Found!');assert.match(task.rejectedVisuals[0].error,/unlabeled/);return JSON.stringify(additions(task));}
  if(!task.sectionNumber)return JSON.stringify({...outline,sections:outline.sections.map(s=>({...s,generatedVisuals:s.title==='Section 5'?['diagram']:[]}))});
  return JSON.stringify({blocks:[paragraph(task.sectionNumber),...(task.sectionNumber===5?[{type:'visual',caption:'Keep this meaning',visual:{...diagram,nodes:[{id:'end',label:'Target Found!',shape:'final',x:100,y:100}]}}]:[])]});
 }));assert.equal(recovery,1);assert.equal(W.extract(result.text).artifacts[0].blocks.filter(b=>b.visual).length,1);
});
test('PDF and Word embedded diamonds expand safely without dropping labels, nodes or edges',()=>{
 const visual={kind:'diagram',title:'Decision',width:900,height:600,nodes:[{id:'decision',label:'Compare\nArr[mid] vs Target',x:450,y:250,shape:'diamond',width:240,height:100},{id:'result',label:'Target found',x:450,y:470,shape:'pill'}],edges:[{from:'decision',to:'result',label:'Equal'}]};
 for(const kind of ['pdf','docx']){
  const doc=W.normalize({kind,blocks:[{type:'visual',visual}]}),v=doc.blocks[0].visual;
  assert.deepEqual(v.nodes.map(n=>[n.id,n.label,n.shape]),visual.nodes.map(n=>[n.id,n.label,n.shape]));assert.equal(v.edges.length,1);assert.equal(v.edges[0].label,'Equal');assert.ok(v.nodes[0].width>240||v.nodes[0].height>100);
 }
});

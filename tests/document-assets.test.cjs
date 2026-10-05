const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../document-assets.js'),W=require('../widgets.js'),Long=require('../long-documents.js');
// Placement tests use full-size mock sections; density/recovery have separate failure tests.
const L={...Long,build:(request,options)=>Long.build(request,{...options,checkpointStore:Long.createCheckpoints({indexedDB:null}),plan:async messages=>{const raw=await options.plan(messages);let value;try{value=JSON.parse(raw);}catch(_){return raw;}if(value.blocks){const p=value.blocks.find(b=>b.type==='paragraph');if(p)p.text+=' '+Array.from({length:400},(_,i)=>'detail'+i).join(' ');else value.blocks.push({type:'paragraph',text:Array.from({length:400},(_,i)=>'detail'+i).join(' ')});}return JSON.stringify(value);}})};
const dataUrl='data:image/png;base64,aGVsbG8=';
test('image recipes accept uploaded references, reject external URLs and keep captions',()=>{
 for(const kind of ['pdf','docx']){const s=W.normalize({kind,title:'Assignment',blocks:[{type:'image',assetId:'img-screenshot',caption:'Actual output'}]});assert.equal(s.blocks[0].assetId,'img-screenshot');assert.throws(()=>W.normalize({...s,blocks:[{type:'image',assetId:'https://example.com/x.png'}]}));}
 assert.equal(W.normalize({kind:'pptx',slides:[{title:'Output',image:{assetId:'img-1'}}]}).slides[0].bullets.length,0);
 assert.throws(()=>W.normalize({kind:'pptx',slides:[{title:'Too crowded',image:{assetId:'img-1'},bullets:['a','b','c']}]}));
});
test('asset binding fails on missing images, validates schemes, and survives saved reconstruction',()=>{
 const spec=W.normalize({kind:'docx',blocks:[{type:'image',assetId:'img-1'}]});assert.throws(()=>D.bind(spec,[]),/unavailable/);
 const assets=D.bind(spec,[{id:'img-1',dataUrl,width:100,height:40}]);assert.equal(D.normalizeAssets(JSON.parse(JSON.stringify(assets)))['img-1'].dataUrl,dataUrl);
 for(const url of ['https://x/x.png','javascript:alert(1)','data:image/svg+xml;base64,aGVsbG8='])assert.equal(D.validImage(url),false);
});
test('vision reading covers every batch without mutating saved attachment data',async()=>{
 const input=[{role:'user',attachments:[{name:'19 pages',visuals:Array.from({length:19},(_,i)=>({id:'img-'+i,label:'Page '+(i+1),dataUrl}))}]}];let count=0;
 const out=await D.describe(input,{model:{provider:'Ollama',capabilities:['vision']},read:async history=>{count+=history[1].attachments.length;return history[1].attachments.map(a=>a.name).join(',');}});
 assert.equal(count,19);assert.match(out[0].attachments[0].visualSummary,/Page 19/);assert.equal(input[0].attachments[0].visualSummary,undefined);
});
test('nonvision models get explicit unread-image notice and cancellation stops batching',async()=>{
 const input=[{role:'user',attachments:[{visuals:[{dataUrl}]}]}];const out=await D.describe(input,{model:{provider:'Ollama',capabilities:['completion']},read:()=>{throw Error('unexpected')}});assert.match(out[0].attachments[0].visualSummary,/UNAVAILABLE/);
 const controller=new AbortController();controller.abort();input[0].attachments[0].visuals=Array(5).fill({dataUrl});await assert.rejects(D.describe(input,{model:{},signal:controller.signal,read:()=>''}),{name:'AbortError'});
});
test('long document scope honors explicit counts and small models get simpler drafting',()=>{
 assert.deepEqual(L.target('Make a 16-19 page Word report'),{kind:'docx',count:19});assert.equal(L.target('Explain 19 pages of this PDF'),null);assert.equal(L.target('Write a short document'),null);assert.equal(L.small({id:'gemma:4b'}),true);assert.equal(L.small({id:'gemma:8b'}),false);
});
test('19-page staged generation assembles one validated file and preserves every section',async()=>{
 let calls=0;const statuses=[];const output=await L.build('Create a 19 page PDF report',{model:{id:'8b'},context:[],instruction:W.instruction(),normalize:W.normalize,onStatus:s=>statuses.push(s),plan:async()=>JSON.stringify(calls++===0?{title:'Study',sections:Array.from({length:19},(_,i)=>({title:'Page '+(i+1),brief:'Content'}))}:{kind:'pdf',blocks:[{type:'heading',text:'Page '+(calls-1)},{type:'paragraph',text:'Substantive section '+(calls-1)}]})});
 const parsed=W.extract(output.text);assert.equal(parsed.artifacts.length,1);assert.equal(parsed.artifacts[0].blocks.filter(b=>b.type==='pageBreak').length,0);assert.match(JSON.stringify(parsed.artifacts),/Substantive section 19/);assert.equal(statuses.length,20);
});
test('long-file reading includes a single uploaded screenshot and retains its asset reference',async()=>{
 const messages=[{role:'user',attachments:[{name:'output.png',assetId:'img-output',dataUrl}]}];let reads=0;
 const result=await D.describe(messages,{force:true,model:{},read:async()=>{reads++;return 'Screenshot says all passed';}});
 assert.equal(reads,1);assert.match(result[0].attachments[0].visualSummary,/all passed/);assert.equal(D.catalog(result)[0].id,'img-output');
 const reused=D.catalog([{artifacts:[{imageAssets:{'img-output':{dataUrl,width:100,height:40}}}]}]);assert.equal(reused.length,1);
});
test('long-file cancellation stops before requesting additional pages',async()=>{
 const c=new AbortController();let calls=0;
 await assert.rejects(L.build('Create a 19 page PDF',{model:{},context:[],instruction:'',normalize:W.normalize,signal:c.signal,plan:async()=>{calls++;if(calls===1)return JSON.stringify({title:'T',sections:Array.from({length:19},()=>({title:'S',brief:'B'}))});c.abort();return JSON.stringify({blocks:[{type:'paragraph',text:'x'}]});}}),{name:'AbortError'});
 assert.equal(calls,2);
});
test('section repair includes the invalid model draft and fixes its schema without inventing cells',async()=>{
 let calls=0;
 const result=await L.build('Create an 8 page Word document',{model:{id:'3b'},context:[],instruction:'',normalize:W.normalize,plan:async messages=>{
  calls++;
  if(calls===1)return JSON.stringify({title:'D',sections:Array.from({length:8},()=>({title:'T',brief:'B'}))});
  if(calls===2)return JSON.stringify({blocks:[{type:'table',headers:['A','B'],rows:[['one']]}]});
  if(calls===3){assert.match(messages.at(-2).text,/"one"/);assert.match(messages.at(-1).text,/row must match|row must be|per header/);}
  return JSON.stringify({blocks:[{type:'paragraph',text:'The supplied value is one; its other field is unspecified.'}]});
 }});
 assert.equal(W.extract(result.text).artifacts[0].blocks.filter(b=>b.type==='paragraph').length,8);
});

test('separate screenshot uploads share bounded vision batches and retain every asset ID',async()=>{
 const attachments=Array.from({length:17},(_,i)=>({name:'Screenshot.png',assetId:'img-screen-'+i,dataUrl}));
 const input=[{role:'user',attachments}],batches=[];
 const out=await D.describe(input,{model:{provider:'Ollama',capabilities:['vision']},read:async messages=>{batches.push(messages[1].attachments.length);return messages[1].text;}});
 assert.deepEqual(batches,[4,4,4,4,1]);
 assert.equal(D.catalog(out).length,17);
 for(const a of out[0].attachments)assert.match(a.visualSummary,/img-screen-/);
 assert.equal(input[0].attachments[0].visualSummary,undefined);
});
test('abort during the final vision read never returns a successful partial reading',async()=>{
 const c=new AbortController();await assert.rejects(D.describe([{attachments:[{name:'x',assetId:'img-x',dataUrl}]}],{force:true,model:{},signal:c.signal,read:async()=>{c.abort();return 'Partial reading';}}),{name:'AbortError'});
});
test('nonvision single screenshot is explicitly unavailable even outside long documents',async()=>{
 const out=await D.describe([{attachments:[{name:'x',assetId:'img-x',dataUrl}]}],{model:{provider:'Ollama',capabilities:['completion']},read:()=>{throw Error('Unexpected vision request');}});
 assert.match(out[0].attachments[0].visualSummary,/UNAVAILABLE/);
});
test('visual budget rejects 81 images and aggregate encoded bytes instead of dropping images',()=>{
 assert.equal(D.bounded(Array.from({length:80},()=>({dataUrl}))).length,80);
 assert.throws(()=>D.bounded(Array.from({length:81},()=>({dataUrl}))),/Split/);
 assert.throws(()=>D.bounded([{dataUrl:'x'.repeat(24*1024*1024+1)}]),/Split/);
});
test('empty model reading fails explicitly',async()=>{
 await assert.rejects(D.describe([{attachments:[{dataUrl,assetId:'img-a'}]}],{force:true,model:{},read:async()=>''}),/no reading/);
});
test('PowerPoint captions stay readable and longer descriptions remain in notes',()=>{
 const base={kind:'pptx',slides:[{title:'Evidence',image:{assetId:'img-x',caption:'x'.repeat(240)},notes:'detail '.repeat(800)}]};
 assert.equal(W.normalize(base).slides[0].notes.length,5600);
 base.slides[0].image.caption+='x';assert.throws(()=>W.normalize(base),/240 characters/);
});
test('40-page upper boundary preserves every section and repair exhaustion never reports success',async()=>{
 let calls=0;const result=await L.build('Create a 40 page PDF document',{model:{id:'3b'},context:[],instruction:'',normalize:W.normalize,plan:async()=>JSON.stringify(calls++===0?{title:'Maximum',sections:Array.from({length:40},(_,i)=>({title:'Part '+i,brief:'Distinct source material'}))}:{blocks:[{type:'paragraph',text:'Content '+calls}]})});
 const spec=W.extract(result.text).artifacts[0];assert.equal(spec.blocks.filter(b=>b.type==='pageBreak').length,0);assert.match(spec.blocks.at(-1).text,/^Content 41 /);
 calls=0;await assert.rejects(L.build('Create an 8 page PDF',{model:{},context:[],instruction:'',normalize:W.normalize,plan:async()=>{calls++;return '{"title":"truncated';}}),/could not be completed/);assert.equal(calls,3);
});

test('long reports retain upload evidence older than eight messages and explicit image identity',()=>{
 const history=[{role:'system',text:'policy'},{role:'user',text:'Setup evidence',attachments:[{assetId:'img-first'}]},...Array.from({length:20},(_,i)=>({role:'assistant',text:'Later '+i}))];
 const context=L.sourceContext(history,m=>m.text);assert.equal(context.length,9);assert.equal(context[0].text,'Setup evidence');assert.equal(context.at(-1).text,'Later 19');
});
test('19-section mixed documents preserve image/diagram placement and repair an omitted screenshot',async()=>{
 const assets={images:[{assetId:'img-a',label:'Screenshot.png'},{assetId:'img-b',label:'Screenshot.png'}],visuals:[{artifactId:'arch',kind:'diagram',spec:{kind:'diagram',title:'Actual components',nodes:[{id:'api',label:'Application API',x:100,y:100}],edges:[]}}]};
 let repairs=0;
 const result=await L.build('Create a 19 page Word report with all uploaded images and the architecture',{model:{id:'8b'},context:[],assets,instruction:'',normalize:W.normalize,plan:async messages=>{
  const task=JSON.parse(messages[1].text);
  if(!task.sectionNumber){assert.deepEqual(task.availableAssets,assets);return JSON.stringify({title:'Mixed',sections:Array.from({length:19},(_,i)=>({title:'Part '+(i+1),brief:'Explain evidence',imageAssetIds:i===1?['img-a','img-b']:[],visualArtifactIds:i===4?['arch']:[]}))});}
  const blocks=[{type:'heading',text:task.section.title}];
  if(task.sectionNumber===2){blocks.push({type:'image',assetId:'img-a',caption:'Setup'});if(messages.length>2){assert.match(messages.at(-1).text,/img-b/);blocks.push({type:'image',assetId:'img-b',caption:'Result'});repairs++;}}
  if(task.sectionNumber===5){assert.equal(task.assignedAssets.visuals[0].spec.nodes[0].label,'Application API');blocks.push({type:'visual',visual:{artifactId:'arch'}});}
  return JSON.stringify({blocks});
 }});
 assert.equal(repairs,1);const spec=W.extract(result.text).artifacts[0];assert.deepEqual(D.imageIds(spec),['img-a','img-b']);assert.equal(spec.blocks.filter(b=>b.type==='pageBreak').length,0);assert.equal(spec.blocks.find(b=>b.type==='visual').visual.artifactId,'arch');
});
test('placement plan rejects missing requested images, unknown IDs and crowded PowerPoint slides',async()=>{
 for(const variant of ['missing','unknown','crowded']){
  let calls=0;await assert.rejects(L.build('Create an 8 slide PPT with all my screenshots',{model:{},context:[],assets:{images:[{assetId:'img-a'},{assetId:'img-b'}],visuals:[]},instruction:'',normalize:W.normalize,plan:async()=>{
   calls++;return JSON.stringify({title:'Bad plan',sections:Array.from({length:8},(_,i)=>({title:'Part '+i,brief:'Evidence',imageAssetIds:i===0?(variant==='missing'?['img-a']:variant==='unknown'?['img-fake']:['img-a','img-b']):[]}))});
  }}),/could not be completed/);assert.equal(calls,3);
 }
});
test('new diagrams assigned to long slides cannot disappear during drafting',async()=>{
 let calls=0;await assert.rejects(L.build('Make an 8 slide PowerPoint with architecture',{model:{},context:[],assets:{images:[],visuals:[]},instruction:'',normalize:W.normalize,plan:async()=>{
  calls++;return JSON.stringify(calls===1?{title:'Architecture',sections:Array.from({length:8},(_,i)=>({title:'Part '+i,brief:'Architecture',generatedVisuals:i===0?['diagram']:[]}))}:{slides:[{title:'Missing architecture',bullets:['Text only']} ]});
 }}),/new visuals: diagram/);assert.equal(calls,4);
});
test('multiple generated diagrams on one report page are counted, not deduplicated away',async()=>{
 let calls=0;const diagram={kind:'diagram',title:'One',nodes:[{id:'a',label:'A',x:100,y:100}],edges:[]};
 await assert.rejects(L.build('Create an 8 page PDF with two diagrams in the first section',{model:{},context:[],assets:{images:[],visuals:[]},instruction:'',normalize:W.normalize,plan:async()=>{
  calls++;return JSON.stringify(calls===1?{title:'Two diagrams',sections:Array.from({length:8},(_,i)=>({title:'Section '+i,brief:'Explain',generatedVisuals:i===0?['diagram','diagram']:[]}))}:{blocks:[{type:'visual',visual:diagram}]});
 }}),/new visuals: diagram/);assert.equal(calls,4);
});
test('direct images with identical filenames expose distinct IDs to the model',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('app.js','utf8');const code=source.slice(source.indexOf('function modelTextForMessage('),source.indexOf('async function requestLocalReply('));
 const c=vm.createContext({normalizedWidgetArtifacts:()=>[]});vm.runInContext(code,c);
 const rendered=c.modelTextForMessage({role:'user',text:'Use both screenshots',attachments:[{name:'Screenshot.png',assetId:'img-setup'},{name:'Screenshot.png',assetId:'img-result'}]});
 assert.match(rendered,/img-setup/);assert.match(rendered,/img-result/);assert.doesNotMatch(rendered,/undefined/);
});
test('exact inline copy satisfies existing-visual placement; changed copy does not',async()=>{
 const diagram={kind:'diagram',title:'Original',nodes:[{id:'a',label:'API',x:100,y:100}],edges:[]};
 for(const altered of [false,true]){
  let calls=0;const run=L.build('Create an 8 page PDF with the existing architecture',{model:{},context:[],assets:{images:[],visuals:[{artifactId:'original',spec:diagram}]},instruction:'',normalize:W.normalize,plan:async()=>{
   calls++;return JSON.stringify(calls===1?{title:'Report',sections:Array.from({length:8},()=>({title:'Architecture',brief:'Describe the actual nodes',visualArtifactIds:['original']}))}:{blocks:[{type:'visual',visual:altered?{...diagram,title:'Changed'}:diagram}]});
  }});
  if(altered){await assert.rejects(run,/existing visuals: original/);assert.equal(calls,4);}else{assert.ok((await run).text);assert.equal(calls,9);}
 }
});
test('a reused diagram cannot also satisfy a separate new-diagram requirement',async()=>{
 const diagram={kind:'diagram',title:'Existing',nodes:[{id:'a',label:'A',x:100,y:100}],edges:[]};let calls=0;
 await assert.rejects(L.build('Create an 8 page PDF with existing and new diagrams',{model:{},context:[],assets:{images:[],visuals:[{artifactId:'old',spec:diagram}]},instruction:'',normalize:W.normalize,plan:async()=>JSON.stringify(++calls===1?{title:'Distinct visuals',sections:Array.from({length:8},()=>({title:'T',brief:'B',visualArtifactIds:['old'],generatedVisuals:['diagram']}))}:{blocks:[{type:'visual',visual:diagram}]})}),/new visuals: diagram/);
});

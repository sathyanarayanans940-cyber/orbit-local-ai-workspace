const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../long-documents.js'),W=require('../widgets.js');
const {IDBFactory}=require('fake-indexeddb');
const outline={title:'Research',sections:Array.from({length:8},(_,i)=>({title:'Section '+i,brief:'Distinct analysis '+i}))};
const block=i=>({type:'paragraph',text:`FACT-${i} `+Array.from({length:490},(_,j)=>`analysis${i}-${j}`).join(' ')});
const options=extra=>({model:{id:'3b'},context:[],instruction:'',normalize:W.normalize,checkpointStore:L.createCheckpoints({indexedDB:null}),retryDelay:async()=>{},...extra});
const task=m=>JSON.parse(m[1].text);
test('thin sections are repaired, page breaks removed, rich text counted without counting headings',async()=>{
 let repaired=0;const result=await L.build('Create an 8 page PDF report',options({plan:async m=>{const t=task(m);if(!t.sectionNumber)return JSON.stringify(outline);if(m.length===2)return JSON.stringify({blocks:[{type:'heading',text:'Title'},{type:'paragraph',text:'Only four words here'}]});repaired++;assert.match(m.at(-1).text,/too thin/);return JSON.stringify({blocks:[{type:'pageBreak'},block(t.sectionNumber)]});}}));
 const spec=W.extract(result.text).artifacts[0];assert.equal(repaired,8);assert.equal(spec.blocks.length,8);assert.equal(spec.blocks.some(b=>b.type==='pageBreak'),false);assert.ok(L.wordCount(spec.blocks)>3800);
 assert.equal(L.wordCount([{type:'paragraph',text:[{text:'three real words'}]},{type:'heading',text:'ignore me'},{type:'paragraph',text:'two more'}]),5);
});
test('brief sections never succeed just because all planned sections exist',async()=>{
 await assert.rejects(L.build('Create an 8 page PDF',options({plan:async m=>JSON.stringify(task(m).sectionNumber?{blocks:[{type:'paragraph',text:'A tiny summary.'}]}:outline)})),/too thin/);
});
test('repeated idle timeouts retry only the unfinished unit, preserve prior bytes and all slide boundaries',async()=>{
 for(const kind of ['PDF','Word','PowerPoint']){
 const seen=[],done=new Map();let interruptions=0;
 const result=await L.build(`Create an 8 ${kind==='PowerPoint'?'slide':'page'} ${kind}`,options({plan:async m=>{const t=task(m);if(!t.sectionNumber)return JSON.stringify(outline);seen.push(t.sectionNumber);if(t.sectionNumber===4&&interruptions++<3)throw Object.assign(Error('Idle timeout'),{retryable:true});const value=kind==='PowerPoint'?{slides:[{title:'Slide '+t.sectionNumber,bullets:['FACT-'+t.sectionNumber]}]}:{blocks:[block(t.sectionNumber)]};done.set(t.sectionNumber,JSON.stringify(value));return JSON.stringify(value);}}));
 const spec=W.extract(result.text).artifacts[0];assert.deepEqual(seen,[1,2,3,4,4,4,4,5,6,7,8]);assert.equal((spec.blocks||spec.slides).length,8);assert.equal(done.size,8);if(spec.blocks)for(let i=0;i<8;i++)assert.equal(spec.blocks[i].text,block(i+1).text);
 }
});
test('checkpoint survives interruption and reload; resume never requests or rewrites completed sections',async()=>{
 const indexedDB=new IDBFactory(),name='recovery',c=new AbortController(),seen=[];
 await assert.rejects(L.build('Create an 8 page PDF',options({checkpointStore:L.createCheckpoints({indexedDB,name}),signal:c.signal,plan:async m=>{const t=task(m);if(!t.sectionNumber)return JSON.stringify(outline);if(t.sectionNumber===4){c.abort();throw new DOMException('Stopped','AbortError');}return JSON.stringify({blocks:[block(t.sectionNumber)]});}})),{name:'AbortError'});
 const result=await L.build('Create an 8 page PDF',options({checkpointStore:L.createCheckpoints({indexedDB,name}),plan:async m=>{const t=task(m);assert.ok(t.sectionNumber>=4);seen.push(t.sectionNumber);return JSON.stringify({blocks:[block(t.sectionNumber)]});}}));
 assert.deepEqual(seen,[4,5,6,7,8]);assert.equal(W.extract(result.text).artifacts[0].blocks[0].text,block(1).text);
});
test('permanent errors stop immediately; transient exhaustion is finite; cancellation stops reconnect',async()=>{
 let calls=0;await assert.rejects(L.build('Create an 8 page PDF',options({plan:async()=>{calls++;throw Object.assign(Error('Usage limit'),{retryable:false});}})),/Usage limit/);assert.equal(calls,1);
 calls=0;await assert.rejects(L.build('Create an 8 page PDF',options({plan:async()=>{calls++;throw Error('Connection interrupted');}})),/completed sections are saved/);assert.equal(calls,6);
 const c=new AbortController();calls=0;await assert.rejects(L.build('Create an 8 page PDF',options({signal:c.signal,retryDelay:async()=>c.abort(),plan:async()=>{calls++;throw Error('Connection interrupted');}})),{name:'AbortError'});assert.equal(calls,1);
});
test('changed source evidence invalidates checkpoint; drafts expire and cache is bounded',async()=>{
 const indexedDB=new IDBFactory();let clock=0;const storage=L.createCheckpoints({indexedDB,now:()=>clock});
 for(let i=0;i<7;i++){clock++;await storage.put('key'+i,{sections:[i]});}
 const reload=L.createCheckpoints({indexedDB,now:()=>clock});assert.equal(await reload.get('key0'),null);assert.deepEqual(await reload.get('key6'),{sections:[6]});clock+=8*24*3600*1000;assert.equal(await reload.get('key6'),null);
 const opts=options({plan:async m=>JSON.stringify(task(m).sectionNumber?{blocks:[block(task(m).sectionNumber)]}:outline)});await L.build('Create an 8 page PDF',opts);let calls=0;await L.build('Create an 8 page PDF',{...opts,context:[{text:'Corrected evidence'}],plan:async m=>{calls++;return opts.plan(m);}});assert.equal(calls,9);
});
test('successful draft is released so an explicit regeneration can produce new content',async()=>{
 let calls=0;const opts=options({plan:async m=>{calls++;return JSON.stringify(task(m).sectionNumber?{blocks:[block(task(m).sectionNumber)]}:outline);}});
 await L.build('Create an 8 page PDF',opts);await L.build('Create an 8 page PDF',opts);assert.equal(calls,18);
});
test('real incomplete NDJSON retries a section without committing partial JSON',async()=>{
 const fs=require('fs'),vm=require('vm'),source=fs.readFileSync('app.js','utf8');
 const context=vm.createContext({TextDecoder,Uint8Array,setTimeout,clearTimeout});
 vm.runInContext(source.slice(source.indexOf('function runtimeTextChunk('),source.indexOf('function modelTextForMessage(')),context);
 let attempts=0;const result=await L.build('Create an 8 page PDF',options({plan:async m=>{
  const t=task(m);if(!t.sectionNumber)return JSON.stringify(outline);
  const partial=t.sectionNumber===3&&attempts++===0;
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({message:{content:partial?'UNCOMMITTED, NEVER INSERT THIS':JSON.stringify({blocks:[block(t.sectionNumber)]})},done:!partial})+'\n'));c.close();}});
  return (await context.readRuntimeStream({body:stream},'Ollama')).text;
 }}));assert.doesNotMatch(result.text,/UNCOMMITTED/);assert.equal(W.extract(result.text).artifacts[0].blocks.length,8);
});
test('resumed job retains original research context even if a fresh vision reading differs',async()=>{
 const checkpointStore=L.createCheckpoints({indexedDB:null}),c=new AbortController(),identity={source:'same uploaded evidence'};
 const opts=options({checkpointStore,checkpointIdentity:identity,context:[{text:'Original reading'}],signal:c.signal,plan:async m=>{const t=task(m);if(!t.sectionNumber)return JSON.stringify(outline);if(t.sectionNumber===2){c.abort();throw new DOMException('Stopped','AbortError');}return JSON.stringify({blocks:[block(1)]});}});
 await assert.rejects(L.build('Create an 8 page PDF',opts),{name:'AbortError'});
 await L.build('Create an 8 page PDF',{...opts,signal:undefined,context:[{text:'Different reading'}],plan:async m=>{const t=task(m);assert.deepEqual(t.sourceContext,[{text:'Original reading'}]);assert.ok(t.sectionNumber>=2);return JSON.stringify({blocks:[block(t.sectionNumber)]});}});
});
test('CJK prose without spaces contributes real words to the document budget',()=>{
 assert.ok(L.wordCount([{type:'paragraph',text:'系统设计需要明确数据边界以及验证方法。'.repeat(80)}])>380);
});

test('web evidence reaches outline and selected sections; missing and invented citations repair before commit',async()=>{
 const research=[{title:'Primary A',url:'https://example.com/a',content:'Documented fact A',retrieval:'page'},{title:'Primary B',url:'https://example.com/b',content:'Documented fact B',retrieval:'excerpt'}];let repairs=0;
 const result=await L.build('Create an 8 page PDF report',options({research,plan:async m=>{
  const t=task(m);if(t.draft)return JSON.stringify({issues:[]});if(!t.sectionNumber){assert.equal(t.researchSources.length,2);assert.match(t.researchSources[0].content,/fact A/);return JSON.stringify({...outline,sections:outline.sections.map((s,i)=>({...s,sourceUrls:[research[i%2].url]}))});}
  assert.equal(t.sourceEvidence.length,1);assert.equal(t.sourceEvidence[0].id,t.sectionNumber%2?'S1':'S2');
  if(m.length===2)return JSON.stringify({blocks:[block(t.sectionNumber),{type:'paragraph',text:'Unsupported grouped citation ['+t.sourceEvidence[0].id+', S999]'}]});
  repairs++;return JSON.stringify({blocks:[{...block(t.sectionNumber),text:block(t.sectionNumber).text+' ['+t.sourceEvidence[0].id+']'}]});
 }}));
 const spec=W.extract(result.text).artifacts[0];assert.equal(repairs,8);assert.equal(spec.blocks.at(-3).text,'Sources');assert.match(spec.blocks.at(-2).text,/https:\/\/example.com\/a/);assert.match(spec.blocks.at(-1).text,/search excerpt only/);assert.doesNotMatch(result.text,/S999/);
});
test('resuming web draft preserves original source IDs and evidence despite fresh search results',async()=>{
 const checkpointStore=L.createCheckpoints({indexedDB:null}),c=new AbortController(),research=[{url:'https://example.com/original',title:'Original',content:'Original fact',retrieval:'page'}];
 const opts=options({research,checkpointStore,checkpointIdentity:{request:'same'},signal:c.signal,plan:async m=>{const t=task(m);if(t.draft)return JSON.stringify({issues:[]});if(!t.sectionNumber)return JSON.stringify(outline);if(t.sectionNumber===2){c.abort();throw new DOMException('Stopped','AbortError');}return JSON.stringify({blocks:[{...block(1),text:block(1).text+' [S1]'}]});}});
 await assert.rejects(L.build('Create an 8 page PDF',opts),{name:'AbortError'});
 const result=await L.build('Create an 8 page PDF',{...opts,signal:undefined,research:[{url:'https://example.com/different',content:'Different fact'}],plan:async m=>{const t=task(m);assert.equal(t.sourceEvidence[0].content,'Original fact');if(t.draft)return JSON.stringify({issues:[]});return JSON.stringify({blocks:[{...block(t.sectionNumber),text:block(t.sectionNumber).text+' [S1]'}]});}});
 assert.match(result.text,/example.com\/original/);assert.doesNotMatch(result.text,/example.com\/different/);assert.equal(result.researchSources[0].url,'https://example.com/original');assert.equal(result.researchRestored,true);
});

test('evidence review repairs unsupported assertions before any unit is committed',async()=>{
 const saved=[],research=[{url:'https://example.com/primary',title:'Primary',content:'A journal is hot only when additional recovery conditions hold.',retrieval:'page'}];let reviews=0,fixes=0;
 const result=await L.build('Create an 8 page PDF',options({research,checkpointStore:{get:async()=>null,put:async(_,v)=>saved.push(structuredClone(v)),remove:async()=>{}},plan:async m=>{
  const t=task(m);
  if(t.issues){fixes++;return JSON.stringify({patches:[{path:['blocks',0,'text'],before:'All journals are hot',after:'Recovery requires additional conditions'}]});}
  if(t.draft){reviews++;return JSON.stringify({issues:JSON.stringify(t.draft).includes('All journals are hot')?['Existing journal alone is insufficient. Remove the unconditional claim; state that additional recovery conditions are required.']:[]});}
  if(!t.sectionNumber)return JSON.stringify(outline);
  const fixed=!!t.revisionDraft;if(fixed){fixes++;assert.match(m[0].text,/EVIDENCE REVIEW/);}
  return JSON.stringify({blocks:[{...block(t.sectionNumber),text:block(t.sectionNumber).text+(fixed?' Recovery requires additional conditions [S1]':' All journals are hot [S1]')}]});
 }}));assert.equal(reviews,8);assert.equal(fixes,8);assert.doesNotMatch(result.text,/All journals are hot/);for(const snapshot of saved)assert.doesNotMatch(JSON.stringify(snapshot.sections),/All journals are hot/);
});
test('invalid factual corrections stop finitely and never enter the committed document',async()=>{
 let patches=0;const saved=[];
 await assert.rejects(L.build('Create an 8 page PDF',options({research:[{url:'https://example.com/a',content:'Facts'}],checkpointStore:{get:async()=>null,put:async(_,v)=>saved.push(structuredClone(v))},plan:async m=>{const t=task(m);if(t.issues){patches++;return JSON.stringify({patches:[{path:['blocks',99,'text'],before:'Missing text',after:'wrong'}]});}if(t.draft)return JSON.stringify({issues:['Correct this claim']});return JSON.stringify(t.sectionNumber?{blocks:[{...block(1),text:block(1).text+' [S1]'}]}:outline);}})),/before text must occur exactly once/);
 assert.equal(patches,3);assert.equal(saved.at(-1).sections.length,0);
});

test('long article selection retains late relevant passages and neighbouring qualifications within budget',()=>{
 const lead='Article introduction. The following are excerpts of documented behavior.\n\n';
 const filler=Array.from({length:20},(_,i)=>'Unrelated chapter '+i+'. '+('General background material for other topics. '.repeat(80))).join('\n\n');
 const text=lead+filler+'\n\nHot journal recovery requires more than mere file existence.\n\nQualification: an active reserved lock means this journal is not hot.\n\n'+filler;
 const chosen=L.evidenceExcerpt(text,'hot journal recovery conditions');assert.ok(chosen.length<=16000);assert.match(chosen,/more than mere file existence/);assert.match(chosen,/reserved lock/);assert.match(chosen,/Article introduction/);assert.equal(L.evidenceExcerpt('Short complete article','anything'),'Short complete article');
 const unbroken='x'.repeat(25000)+'\n\nHot journal qualifications must be read.\n\n'+'y'.repeat(25000);assert.match(L.evidenceExcerpt(unbroken,'hot journal qualifications'),/Hot journal qualifications/);
});

test('source corrections are exact isolated edits, with no prototype access or ambiguous replacements',()=>{
 const original={blocks:[{type:'paragraph',text:'A qualified fact. Preserve this sentence.'},{type:'visual',visual:{kind:'diagram',title:'Untouched'}}]};
 const updated=L.applyEvidencePatches(original,[{path:['blocks',0,'text'],before:'A qualified fact.',after:'A more precise fact [S1].'}]);
 assert.equal(original.blocks[0].text,'A qualified fact. Preserve this sentence.');assert.equal(updated.blocks[0].text,'A more precise fact [S1]. Preserve this sentence.');assert.deepEqual(updated.blocks[1],original.blocks[1]);
 for(const path of [['__proto__','x','text'],['blocks',0,'constructor']])assert.throws(()=>L.applyEvidencePatches(original,[{path,before:'fact',after:'wrong'}]));
 assert.throws(()=>L.applyEvidencePatches({blocks:[{text:'same same'}]},[{path:['blocks',0,'text'],before:'same',after:'changed'}]),/exactly once/);
});

test('an incorrect block index resolves only a unique exact quotation',()=>{const d={blocks:[{text:'First unchanged paragraph'},{text:'This specific claim needs qualification.'}]};const r=L.applyEvidencePatches(d,[{path:['blocks',9,'text'],before:'This specific claim',after:'This qualified claim'}]);assert.equal(r.blocks[0].text,d.blocks[0].text);assert.equal(r.blocks[1].text,'This qualified claim needs qualification.');});

test('source review includes complementary articles omitted from a narrow section assignment',async()=>{
 const research=[{url:'https://example.com/old',content:'Rollback-only behavior',retrieval:'page'},{url:'https://example.com/current',content:'WAL qualification',retrieval:'page'}];let reviews=0;
 await L.build('Create an 8 page PDF',options({research,plan:async m=>{const t=task(m);if(t.draft){reviews++;assert.equal(t.sourceEvidence.length,2);assert.match(t.sourceEvidence[1].content,/WAL qualification/);return JSON.stringify({issues:[]});}if(!t.sectionNumber)return JSON.stringify({...outline,sections:outline.sections.map(s=>({...s,sourceIds:['S1']}))});assert.equal(t.sourceEvidence.length,1);return JSON.stringify({blocks:[{...block(t.sectionNumber),text:block(t.sectionNumber).text+' [S1]'}]});}}));assert.equal(reviews,8);
});

test('an explicitly researched long document cannot silently draft without any retrieved evidence',async()=>{
 let calls=0;await assert.rejects(L.build('Search and create an 8 page PDF',options({researchRequired:true,plan:async()=>{calls++;return JSON.stringify(outline);}})),/No unsourced report/);assert.equal(calls,0);
});

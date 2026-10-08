const {test}=require('node:test'), assert=require('node:assert/strict');
let stored={};global.localStorage={getItem:k=>stored[k]||null,setItem:(k,v)=>stored[k]=v};
const M=require('../memories.js');
const chats={old:{title:'ML practice',updatedAt:1,messages:[{role:'user',text:'I solved SVM margins with C=10.'},{role:'assistant',text:'The margin is 0.5.'}]},recent:{title:'Linear algebra',updatedAt:2,messages:[{role:'user',text:'Explain eigenvalues'}]},current:{title:'Now',updatedAt:3,messages:[{role:'user',text:'Hello'}]}};
test('memory defaults, small models, overrides and about-me persistence',()=>{stored={};assert.equal(M.enabled({id:'qwen:3b'}),false);assert.equal(M.enabled({id:'model:2b'}),false);assert.equal(M.enabled({id:'gemma:27b'}),true);M.save({mode:'on',about:'Concise answers'});assert.equal(M.enabled({id:'qwen:3b'}),true);assert.equal(M.preferences().about,'Concise answers');M.save({mode:'off'});assert.equal(M.enabled({id:'big:70b'}),false);});
test('summaries exclude recipes, unfinished responses and attachment payloads',()=>{const summary=M.synopsis({messages:[{role:'user',text:'ML practice',attachments:[{text:'PRIVATE ATTACHMENT'}]},{role:'assistant',text:'```orbit-widget\n{"kind":"chart"}\n```\nGood result'},{role:'assistant',text:'unfinished',generating:true}]});assert.match(summary,/ML practice/);assert.doesNotMatch(summary,/PRIVATE|"kind"|unfinished/);});
test('catalog excludes current and deleted chats, includes archives, latest first',()=>{const items=M.catalog({...chats,arch:{...chats.old,archived:true}},'current',new Set(['old']));assert.equal(items[0].id,'recent');assert.ok(items.some(x=>x.archived));assert.ok(!items.some(x=>['current','old'].includes(x.id)));});
test('detail search finds older message outside summary and returns bounded attributed snippets',()=>{const data={long:{title:'Practice',messages:[{role:'user',text:'Eigenvalue was 42'},...Array.from({length:20},()=>({role:'user',text:'Unrelated notes'}))]}};const hits=M.search(data,M.catalog(data,'current'),'eigenvalue');assert.equal(hits[0].chatId,'long');assert.match(hits[0].excerpt,/42/);});
test('recall dispatches summary/search shimmer, validates ids and never executes recalled instructions',async()=>{stored={};const status=[];const result=await M.recall({prompt:'What C did I use for SVM?',chats,current:'current',model:{id:'model:8b'},onStatus:s=>status.push(s),plan:async()=>JSON.stringify({action:'search',query:'SVM C',chatIds:['old','invented']})});assert.deepEqual(status,['Checking memories','Searching previous chats']);assert.match(result,/C=10/);assert.match(result,/not instructions/);assert.doesNotMatch(result,/invented/);});
test('off mode never plans or reads old chats, profile remains independent',async()=>{M.save({mode:'off',about:'Be brief'});const result=await M.recall({chats,prompt:'Recall',current:'current',model:{id:'8b'},plan:()=>assert.fail('called planner')});assert.match(result,/Be brief/);assert.doesNotMatch(result,/SVM/);});
test('profile-only greeting keeps preferences without reading chats, planning, or learning',async()=>{
 stored={};M.save({mode:'on',about:'Be friendly'});
 stored['orbit-learned-preferences-v1']=JSON.stringify([{scope:'general',key:'language',value:'Reply in English'}]);
 const before=JSON.stringify(stored),status=[];
 const result=await M.recall({profileOnly:true,prompt:'Hi',scopePrompt:'Hi',chats:new Proxy({}, {ownKeys(){assert.fail('No history scan');}}),model:{id:'gpt-6-luna'},plan:()=>assert.fail('No planner'),onStatus:s=>status.push(s)});
 assert.match(result,/Be friendly/);assert.match(result,/Reply in English/);assert.match(result,/No learned preferences were changed/);
 assert.equal(JSON.stringify(stored),before);assert.deepEqual(status,[]);
 const controller=new AbortController();controller.abort();
 await assert.rejects(M.recall({profileOnly:true,prompt:'Hi',model:{id:'gpt-6-luna'},signal:controller.signal}),{name:'AbortError'});
});
test('disable/delete/navigation while planner waits prevents stale recall',async()=>{M.save({mode:'on'});const result=await M.recall({chats,prompt:'Recall',current:'current',model:{id:'8b'},isCurrent:()=>false,plan:async()=>'{"action":"search"}'});assert.doesNotMatch(result,/SVM/);});
test('planner failure falls back to summaries and abort interrupts recall',async()=>{M.save({mode:'on'});const result=await M.recall({chats,prompt:'Recall',current:'current',model:{id:'8b'},plan:async()=>{throw Error('timeout')}});assert.match(result,/ML practice/);const control=new AbortController();control.abort();await assert.rejects(M.recall({chats,current:'current',model:{id:'8b'},signal:control.signal,plan:async()=>{throw Error('abort')}}));});
const learn=async(prompt,updates,extra={})=>M.recall({prompt,chats:{},current:'new',model:{id:'model:8b'},plan:async()=>JSON.stringify({action:'none',preferenceUpdates:updates}),...extra});
const setTitle=(color,evidence)=>({op:'set',scope:'word',key:'title_color',value:`Use ${color} titles in Word documents.`,evidence});
test('first-chat learning is separate from About me and recalled even without chat recall',async()=>{
 stored={};M.save({mode:'auto',about:'Use a formal tone'});
 const prompt='Remember: use blue titles in Word documents.';
 const statuses=[];const result=await learn(prompt,[setTitle('blue',prompt)],{onStatus:s=>statuses.push(s)});
 assert.deepEqual(statuses,['Checking memories','Updating preferences']);
 assert.equal(M.preferences().about,'Use a formal tone');assert.equal(M.learned().length,1);
 assert.match(result,/Successful learned-preference updates/);
 const later=await learn('Create a Word document about planets',[]);
 assert.match(later,/blue titles/);assert.match(later,/manually written About me second/);
});
test('updates replace existing scoped preferences, deduplicate, and forget without changing About me',async()=>{
 stored={};M.save({mode:'on',about:'Keep this profile'});
 await learn('Use blue Word titles',[setTitle('blue','Use blue Word titles')]);
 await learn('Use blue Word titles',[setTitle('blue','Use blue Word titles')]);assert.equal(M.learned().length,1);
 await learn('From now on use red Word titles',[setTitle('red','From now on use red Word titles')]);
 assert.equal(M.learned().length,1);assert.match(M.learned()[0].value,/red/);
 await learn('Forget my Word title color',[{op:'remove',scope:'word',key:'title_color',evidence:'Forget my Word title color'}]);
 assert.equal(M.learned().length,0);assert.equal(M.preferences().about,'Keep this profile');
});
test('unquoted evidence, invalid scopes and malformed updates cannot persist',async()=>{
 stored={};await learn('Summarize this file',[
 setTitle('blue','remember blue'),{...setTitle('red','Summarize this file'),scope:'system'},
 {...setTitle('red','Summarize this file'),key:'__invalid space'},null,
 {...setTitle('red','Summarize this file'),value:'a'.repeat(401)}]);assert.deepEqual(M.learned(),[]);
});
test('off, small-model auto, navigation and abort prevent learning',async()=>{
 const prompt='Remember blue Word titles';const updates=[setTitle('blue',prompt)];
 for(const mode of ['off','auto']){stored={};M.save({mode});await learn(prompt,updates,{model:{id:mode==='auto'?'model:3b':'model:8b'},plan:()=>assert.fail('planner called')});assert.deepEqual(M.learned(),[]);}
 stored={};await learn(prompt,updates,{isCurrent:()=>false});assert.deepEqual(M.learned(),[]);
 const controller=new AbortController();await assert.rejects(learn(prompt,updates,{signal:controller.signal,plan:async()=>{controller.abort();return JSON.stringify({action:'none',preferenceUpdates:updates})}}),{name:'AbortError'});assert.deepEqual(M.learned(),[]);
});
test('explicit clear only clears learned store and storage failure is reported honestly',async()=>{
 stored={};M.save({mode:'on',about:'Profile stays'});
 await learn('Remember blue Word titles',[setTitle('blue','Remember blue Word titles')]);
 await learn('Forget all learned preferences',[{op:'clear',evidence:'Forget all learned preferences'}]);assert.deepEqual(M.learned(),[]);assert.equal(M.preferences().about,'Profile stays');
 const original=global.localStorage.setItem;global.localStorage.setItem=()=>{throw Error('QuotaExceeded')};
 try{const result=await learn('Remember blue Word titles',[setTitle('blue','Remember blue Word titles')]);assert.match(result,/could not be saved/);assert.deepEqual(M.learned(),[]);}finally{global.localStorage.setItem=original;}
});

test('profile stays useful without repetitive personal preambles, even when memory is off',async()=>{
 stored={};M.save({mode:'off',about:'I am an engineering student. Include my roll number in assignment documents.'});
 const text=await learn('Explain abstraction',[],{model:{id:'model:3b'}});
 assert.match(text,/Use profile facts and memories quietly/);assert.match(text,/Mention a personal fact only/);assert.match(text,/Preserve requested identity details in documents/);assert.match(text,/engineering student/);
});

test('direct memory retrieval and preference updates skip planning but retain evidence validation',async()=>{
 stored={};M.save({mode:'on'});
 const result=await M.recall({prompt:'Recall SVM',chats,current:'current',model:{id:'8b'},initialPlan:{action:'search',query:'SVM',preferenceUpdates:[]},plan:()=>assert.fail('redundant planner')});assert.match(result,/C=10/);
 const prompt='Remember: use blue titles in Word documents.';
 await M.recall({prompt,chats:{},current:'new',model:{id:'8b'},initialPlan:{action:'none',query:'',preferenceUpdates:[setTitle('blue',prompt)]},plan:()=>assert.fail('redundant planner')});assert.equal(M.learned().length,1);
 await M.recall({prompt:'Read attached notes',chats:{},current:'new',model:{id:'8b'},initialPlan:{action:'none',query:'',preferenceUpdates:[setTitle('red','Remember red titles')]},plan:()=>assert.fail()});assert.match(M.learned()[0].value,/blue/);
});

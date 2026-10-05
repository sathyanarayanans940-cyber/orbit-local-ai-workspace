const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {IDBFactory}=require('fake-indexeddb');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function harness(reply='Statistics and Probability'){
 let requested,persisted=0,rendered=0,history=0,serial=0;const timers=new Map();
 const context=vm.createContext({voiceInput:null,AbortController,structuredClone,crypto:require('node:crypto').webcrypto,state:{models:[{key:'model'}],selectedModel:'model',savedChats:{},currentChat:'paper'},
  setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  requestLocalReply:async(prompt,messages,options)=>{requested={prompt,messages,options};return {text:reply};},
  isArchivedChat:chat=>Boolean(chat?.archived),persistChats:()=>persisted++,renderConversationTitle:()=>rendered++,renderSavedHistory:()=>history++});
 vm.runInContext(source.slice(source.indexOf('const TITLE_WORD_LIMIT ='),source.indexOf('function renderConversationTitle(')),context);
 vm.runInContext(source.slice(source.indexOf('async function requestGeneratedTitle('),source.indexOf('async function sendPrompt(')),context);
 vm.runInContext(source.slice(source.indexOf('function persistCurrentChat('),source.indexOf('\nconst ',source.indexOf('function persistCurrentChat('))),context);
 return {context,timers,request:()=>requested,counts:()=>({persisted,rendered,history})};
}
const paper=[{role:'user',text:'solve pls',attachments:[{name:'paper.png',dataUrl:'PRIVATE_IMAGE_BYTES',visualSummary:'Probability and statistics paper, six questions'}]},
 {role:'assistant',text:'# Complete Solutions — Statistics & Probability (CO2/CO3/CO4)\n\n## Correlation and regression\nFull mathematical working.'}];
test('generic upload requests name the actual response topic across subjects',()=>{
 const c=harness().context;
 assert.equal(c.fallbackConversationTitle('solve pls',paper),'Statistics & Probability');
 for(const topic of ['Classical Mechanics','Database Normalization','JavaScript Event Loop']){
  assert.equal(c.fallbackConversationTitle('solve pls',[paper[0],{role:'assistant',text:'# Complete Solutions — '+topic}]),topic);
 }
 assert.equal(c.fallbackConversationTitle('Explain semaphores',paper),'Explain Semaphores');
 assert.equal(c.fallbackConversationTitle('solve pls',[paper[0]]),'Orbit Chat');
});
test('title request uses bounded subject evidence, keeps instructions separate, excludes image bytes',async()=>{
 const h=harness(),c=h.context;
 assert.equal(await c.requestGeneratedTitle('solve pls',paper),'Statistics and Probability');
 const r=h.request(),data=JSON.parse(r.messages[1].text);
 assert.equal(r.prompt,'');assert.equal(r.messages[0].role,'system');assert.equal(r.messages[1].role,'user');
 assert.match(r.messages[0].text,/actual subject/);assert.match(r.messages[0].text,/quoted data as evidence/);
 assert.match(data.headings[0],/Statistics & Probability/);assert.match(data.attachments[0].content,/six questions/);
 assert.doesNotMatch(JSON.stringify(r.messages),/PRIVATE_IMAGE_BYTES/);assert.equal(r.options.naming,true);
 assert.equal(h.timers.size,0);
 const oversized=[{role:'user',text:'x'.repeat(10000),attachments:Array.from({length:20},()=>({name:'n'.repeat(1000),extractedText:'v'.repeat(10000)}))},{role:'assistant',text:'a'.repeat(100000)}];
 const evidence=c.conversationTitleEvidence('x'.repeat(20000),oversized);
 assert.equal(evidence.request.length,2000);assert.equal(evidence.responseExcerpt.length,1400);assert.equal(evidence.attachments.length,4);
 assert.equal(evidence.attachments[0].name.length,160);assert.equal(evidence.attachments[0].content.length,800);
});
test('naming instruction echoes fall back without another model call; real naming topics remain valid',async()=>{
 const h=harness('Conversation Naming Request'),c=h.context;
 c.state.savedChats.paper={title:'Orbit Chat'};
 await c.updateGeneratedTitle('paper','solve pls',paper);
 assert.equal(c.state.savedChats.paper.title,'Statistics & Probability');assert.equal(c.state.currentTitle,'Statistics & Probability');
 assert.deepEqual(h.counts(),{persisted:2,rendered:1,history:1});
 assert.equal(c.cleanGeneratedTitle('Conversation Naming Techniques','Explain techniques for naming a conversation'),'Conversation Naming Techniques');
 assert.equal(c.cleanGeneratedTitle('Conversation Naming Techniques','solve pls'),'');
});
test('loaded legacy titles repair locally while manual titles and legitimate naming conversations survive',()=>{
 const c=harness().context;
 const chat={title:'Conversation Naming Request'};const raw=JSON.stringify(paper);
 assert.equal(c.repairLoadedAutomaticTitle(chat,paper),true);assert.equal(chat.title,'Statistics & Probability');
 assert.equal(c.repairLoadedAutomaticTitle(chat,paper),false);assert.equal(JSON.stringify(paper),raw);
 const manual={title:'Conversation Naming Request',titleManuallyEdited:true};assert.equal(c.repairLoadedAutomaticTitle(manual,paper),false);
 const real={title:'Conversation Naming Request'};assert.equal(c.repairLoadedAutomaticTitle(real,[{role:'user',text:'Help me name this conversation'}]),false);
 c.state.savedChats={lazy:{title:'Conversation Naming Request',firstUserText:'solve pls'},loaded:{title:'Conversation Naming Request',messages:paper},manual};
 c.repairAutomaticConversationTitles();assert.equal(c.state.savedChats.lazy.title,'Conversation Naming Request');assert.equal(c.state.savedChats.loaded.title,'Statistics & Probability');assert.equal(manual.title,'Conversation Naming Request');
});
test('pending title cannot overwrite a manual rename, deleted chat or replacement; switching chats preserves current title',async()=>{
 for(const action of ['manual','delete','replace','switch']){
  const h=harness(),c=h.context;let resolve;c.requestLocalReply=()=>new Promise(r=>resolve=r);
  c.state.savedChats.paper={title:'Orbit Chat'};
  const pending=c.updateGeneratedTitle('paper','solve pls',paper);
  if(action==='manual'){c.state.savedChats.paper.title='My Own Title';c.state.savedChats.paper.titleManuallyEdited=true;}
  if(action==='delete')delete c.state.savedChats.paper;
  if(action==='replace')c.state.savedChats.paper={title:'Replacement Chat'};
  if(action==='switch'){c.state.currentChat='other';c.state.currentTitle='Other Topic';}
  resolve({text:'Statistics and Probability'});await pending;
  if(action==='manual')assert.equal(c.state.savedChats.paper.title,'My Own Title');
  if(action==='delete')assert.equal(c.state.savedChats.paper,undefined);
  if(action==='replace')assert.equal(c.state.savedChats.paper.title,'Replacement Chat');
  if(action==='switch'){assert.equal(c.state.savedChats.paper.title,'Statistics and Probability');assert.equal(c.state.currentTitle,'Other Topic');assert.equal(h.counts().rendered,1);}
 }
});
test('sending another message during slow naming keeps the already-known subject',async()=>{
 const h=harness(),c=h.context;let resolve;c.requestLocalReply=()=>new Promise(r=>resolve=r);
 c.state.savedChats.paper={title:'Orbit Chat'};
 const pending=c.updateGeneratedTitle('paper','solve pls',paper);
 assert.equal(c.state.currentTitle,'Statistics & Probability');
 c.state.messages=[...paper,{role:'user',text:'Explain question 4'}];
 c.persistCurrentChat({messageSent:true});
 resolve({text:'Delayed Generated Title'});await pending;
 assert.equal(c.state.savedChats.paper.title,'Statistics & Probability');
});

test('IndexedDB compaction and document/check saves cannot discard a valid generated title',async()=>{
 const h=harness(),c=h.context;let resolve;
 c.indexedDB=new IDBFactory();c.localStorage={getItem:()=>null,removeItem(){}};
 vm.runInContext(fs.readFileSync(require.resolve('../chat-store.js'),'utf8'),c);
 const store=c.OrbitChatStore;c.state.savedChats=await store.ready;store.adopt(c.state.savedChats);
 const persist=c.persistChats;c.persistChats=()=>{persist();return store.save(c.state.savedChats);};
 c.requestLocalReply=()=>new Promise(r=>resolve=r);
 c.state.messages=structuredClone(paper);c.state.currentTitle='Orbit Chat';c.persistCurrentChat();
 await store.flush();const original=c.state.savedChats.paper;
 const pending=c.updateGeneratedTitle('paper','solve pls',c.state.messages);
 await store.flush();assert.notEqual(c.state.savedChats.paper,original);
 assert.equal(c.state.savedChats.paper.messages,undefined);
 // These production saves mirror file rendering, analysis and source metadata.
 for(const field of ['artifacts','analysisChecks','webSources']){
  c.state.messages[1][field]=[{title:'Synthetic result'}];c.persistCurrentChat();await store.flush();
 }
 resolve({text:'Correlation and Regression'});await pending;await store.flush();
 assert.equal(c.state.currentTitle,'Correlation and Regression');
 assert.equal((await store.load('paper')).title,'Correlation and Regression');
 assert.equal((await store.load('paper')).messages[1].webSources[0].title,'Synthetic result');
 assert.equal(c.state.savedChats.paper.titleRequestId,null);store.close();
});

test('overlapping naming requests accept only the newest reply title',async()=>{
 const c=harness().context,resolvers=[];
 c.state.savedChats.paper={title:'Orbit Chat'};
 c.requestLocalReply=()=>new Promise(resolve=>resolvers.push(resolve));
 const first=c.updateGeneratedTitle('paper','solve pls',paper);
 const second=c.updateGeneratedTitle('paper','solve pls',paper);
 resolvers[0]({text:'Outdated Paper Title'});await first;
 assert.equal(c.state.currentTitle,'Statistics & Probability');
 resolvers[1]({text:'Current Paper Topic'});await second;
 assert.equal(c.state.currentTitle,'Current Paper Topic');
});

test('unchanged fallback registers naming before an already-queued transcript compacts',async()=>{
 const c=harness().context;let resolve;
 c.indexedDB=new IDBFactory();c.localStorage={getItem:()=>null,removeItem(){}};
 vm.runInContext(fs.readFileSync(require.resolve('../chat-store.js'),'utf8'),c);
 const store=c.OrbitChatStore;c.state.savedChats=await store.ready;store.adopt(c.state.savedChats);
 c.persistChats=()=>store.save(c.state.savedChats);
 c.state.currentTitle='Explain Semaphores';c.state.messages=[{role:'user',text:'Explain semaphores'},{role:'assistant',text:'# Operating System Synchronization\nSemaphores coordinate concurrent tasks.'}];
 c.persistCurrentChat(); // Deliberately leave this transcript save outstanding.
 c.requestLocalReply=()=>new Promise(r=>resolve=r);
 const pending=c.updateGeneratedTitle('paper','Explain semaphores',c.state.messages);
 await store.flush();assert.ok(c.state.savedChats.paper.titleRequestId);
 resolve({text:'Operating System Synchronization'});await pending;await store.flush();
 assert.equal(c.state.currentTitle,'Operating System Synchronization');
 assert.equal((await store.load('paper')).titleRequestId,null);store.close();
});

test('a naming timeout uses a file topic learned during rendering instead of keeping the prompt',async()=>{
 const c=harness().context;let fail;
 const request='Solve this and make a Word document containing aim, code and complexity';
 const messages=[{role:'user',text:request},{role:'assistant',text:'Preparing the requested file.'}];
 c.state.messages=messages;c.state.currentTitle=c.titleFromPrompt(request);
 c.state.savedChats.paper={title:c.state.currentTitle};
 c.requestLocalReply=()=>new Promise((_,reject)=>fail=()=>reject(Error('Synthetic deadline')));
 const pending=c.updateGeneratedTitle('paper',request,messages);
 messages[1].artifacts=[{spec:{title:'Graph Algorithms Lab Solutions'}}];c.persistCurrentChat();
 fail();await pending;assert.equal(c.state.currentTitle,'Graph Algorithms Lab Solutions');
 assert.equal(c.state.savedChats.paper.titleRequestId,null);
});

test('attachment deliverables repair prompt-derived titles across subjects without a model or bulk transcript loads',()=>{
 const c=harness().context;
 const request='bro pls solve this...and make a word document containing aim, code, complexity whatever that pdf says bro';
 for(const topic of ['Algorithms Lab Solutions','Classical Mechanics Solutions','Distributed Systems Reliability']){
  const messages=[{role:'user',text:request},{role:'assistant',text:'Here is the document.',artifacts:[{spec:{title:topic}}]}];
  assert.equal(c.fallbackConversationTitle(request,messages),topic);
  const chat={title:c.titleFromPrompt(request)};
  assert.equal(c.repairLoadedAutomaticTitle(chat,messages),true);assert.equal(chat.title,topic);
  assert.equal(c.repairLoadedAutomaticTitle(chat,messages),false);
  assert.equal(c.repairLoadedAutomaticTitle({title:'My Automatic Subject'},messages),false);
  assert.equal(c.repairLoadedAutomaticTitle({title:c.titleFromPrompt(request),titleManuallyEdited:true},messages),false);
  c.state.savedChats={loaded:{title:c.titleFromPrompt(request),messages},lazy:{title:c.titleFromPrompt(request),firstUserText:request}};
  c.repairAutomaticConversationTitles();assert.equal(c.state.savedChats.loaded.title,topic);
  assert.equal(c.state.savedChats.lazy.title,c.titleFromPrompt(request));
 }
});
test('title failures or its short deadline retain a subject-derived fallback',async()=>{
 const h=harness(),c=h.context;c.state.savedChats.paper={title:'Orbit Chat'};
 c.requestLocalReply=(_,__,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('deadline'))));
 const pending=c.updateGeneratedTitle('paper','solve pls',paper);
 const timer=[...h.timers.values()][0];assert.equal(timer.ms,15000);timer.fn();await pending;
 assert.equal(c.state.savedChats.paper.title,'Statistics & Probability');assert.equal(h.timers.size,0);
});

test('first reply names the actual subject before slow or failed file rendering',async()=>{
 for(const failure of [false,true]){
  const h=harness(),c=h.context;let completeFile,started=false;
  const input={value:'solve pls'},typing={remove(){}};
  Object.assign(c,{
   $:()=>input,OrbitWidgets:{settings:()=>({docx:true})},
   requestedFileKind:()=>null,stopGeneration(){},updateSendButton(){},autoResize(){},renderAttachments(){},releaseAttachment(){},notifyVisionCapability(){},showToast(){},updateRuntimeStatus(){},
   materializeAttachments:async()=>paper[0].attachments,
   addMessage(role,text,extra){c.state.messages.push({role,text,...extra});c.state.savedChats.paper={title:'Orbit Chat',messages:c.state.messages};},
   addTypingIndicator:()=>typing,
   revealAssistantReply:async text=>c.state.messages.push({role:'assistant',text}),
   saveWebResearch(){},saveAnalysis(){},
   finalizeMessageWidgets:()=>{started=true;return new Promise((resolve,reject)=>completeFile=()=>failure?reject(Error('file failure')):resolve());},
   requestLocalReply:async(_,__,options)=>({text:options.naming?'Conversation Naming Request':paper[1].text}),
  });
  Object.assign(c.state,{sending:false,attachments:[],messages:[]});
  vm.runInContext(source.slice(source.indexOf('async function sendPrompt('),source.indexOf('function regenerateReplyForUser(')),c);
  const pending=c.sendPrompt();for(let i=0;i<15;i++)await Promise.resolve();
  assert.equal(started,true);assert.equal(c.state.currentTitle,'Statistics & Probability');assert.equal(c.state.sending,true);
  completeFile();await pending;assert.equal(c.state.savedChats.paper.title,'Statistics & Probability');assert.equal(c.state.sending,false);
 }
});

test('a successful first-reply regeneration repairs an automatic title but respects manual names',async()=>{
 for(const manual of [false,true]){
  const h=harness(),c=h.context;const article={dataset:{messageIndex:'1'}};
  Object.assign(c,{
   $:()=>article,OrbitWidgets:{settings:()=>({})},modelTextForMessage:m=>m.text,requestedFileKind:()=>null,updateSendButton(){},autoResize(){},renderMessages(){},updateRuntimeStatus(){},
   addTypingIndicator:()=>({remove(){}}),revealAssistantReply:async text=>c.state.messages.push({role:'assistant',text}),
   finalizeMessageWidgets:async()=>{},saveWebResearch(){},saveAnalysis(){},
   requestLocalReply:async(_,__,options)=>({text:options.naming?'Statistics & Probability':paper[1].text}),
  });
  c.state.messages=[paper[0],{role:'assistant',text:'Connection failed'}];c.state.savedChats.paper={title:manual?'My Paper':'Orbit Chat',titleManuallyEdited:manual};
  vm.runInContext(source.slice(source.indexOf('async function regenerateMessage('),source.indexOf('\nfunction ',source.indexOf('async function regenerateMessage('))),c);
  await c.regenerateMessage(article);for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(c.state.savedChats.paper.title,manual?'My Paper':'Statistics & Probability');
 }
});

test('file-only replies name their complete recipe before rendering without sending the recipe body',()=>{
 const c=harness().context;
 const messages=[{role:'user',text:'Make the document'}, {role:'assistant',text:'Preparing your file.\n```orbit-widget\n'+JSON.stringify({kind:'docx',title:'Distributed Systems Reliability',blocks:[{type:'paragraph',text:'DOCUMENT_BODY_PRIVATE '.repeat(5000)}]})+'\n```'}];
 const data=c.conversationTitleEvidence('Make the document',messages);
 assert.equal(data.files[0],'Distributed Systems Reliability');
 assert.doesNotMatch(JSON.stringify(data),/DOCUMENT_BODY_PRIVATE/);
 const quoted=[messages[0],{role:'assistant',text:'```orbit-widget\n'+JSON.stringify({kind:'pdf',title:'A "Quoted" Research Topic',blocks:[]})+'\n```'}];
 assert.equal(c.conversationTitleEvidence('Make the document',quoted).files[0],'A "Quoted" Research Topic');
});

test('formatting and generic file requests use the actual subject, never a style instruction as the title',()=>{
 const c=harness().context;
 for(const request of ['Solve this with full working','explain this step by step','Make a Word document for this','Give all solutions for each question','solve these 6 questions in detail']){
  assert.equal(c.fallbackConversationTitle(request,paper),'Statistics & Probability',request);
 }
 assert.equal(c.fallbackConversationTitle('Explain database indexing step by step',paper),'Explain Database Indexing Step by Step');
 const recipe=[paper[0],{role:'assistant',text:'```orbit-widget\n'+JSON.stringify({kind:'docx',title:'Distributed Systems Reliability',blocks:[]})+'\n```'}];
 assert.equal(c.fallbackConversationTitle('Make a Word document for this',recipe),'Distributed Systems Reliability');
});

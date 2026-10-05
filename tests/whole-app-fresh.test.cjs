// Fresh cross-feature regression cases: synthetic data, no paid model calls.
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {IDBFactory}=require('fake-indexeddb'),crypto=require('node:crypto').webcrypto;
const katex=require('../vendor/katex/katex.min.js'),W=require('../widgets.js');
const app=fs.readFileSync('app.js','utf8');
const renderer=vm.createContext({window:{katex},OrbitWidgets:W,widgetOptionsForMessage:()=>({}),icons:{copy:''},state:{currentChat:'fresh',messages:[]}});
vm.runInContext(app.slice(app.indexOf('function escapeHtml('),app.indexOf('function latestUserMessageIndex(')),renderer);
require('./interaction-harness.cjs')(renderer);
const expressions=html=>[...html.matchAll(/<annotation encoding="application\/x-tex">(.*?)<\/annotation>/gs)].map(m=>m[1]);
const render=text=>renderer.renderRichText(text,0);

test('fresh: adjacent short formulas survive punctuation, emoji, CRLF, bold and list labels',()=>{
 for(const [open,close] of [['\\(','\\)'],['$','$'],['\\[','\\]'],['$$','$$']])for(const separator of [', ','; ',' — ',' 🙂 ','\r\n']){
  const text=`${open}x=1${close}${separator}${open}y=2${close}`;
  for(const prefix of ['', '**Values:** ', '- Given: ']){const html=render(prefix+text);assert.deepEqual(expressions(html),['x=1','y=2'],prefix+text);assert.doesNotMatch(html,/katex-error|math-(?:inline|display)-fallback/);}
 }
});
test('fresh: a table keeps empty cells, a code pipe, an escaped pipe and inline absolute-value math',()=>{
 const html=render('| A | B | C | D |\r\n| --- | --- | --- | --- |\r\n| | `a|b` | A\\|B | $|x|$ |');
 assert.equal((html.match(/<td>/g)||[]).length,4);assert.deepEqual(expressions(html),['|x|']);assert.match(html,/<td><\/td>/);assert.match(html,/<code>a\|b<\/code>/);
});
test('fresh: currency ranges and shell substitutions remain literal beside a genuine equation',()=>{
 const text='Costs $1.50–$2.50; run `$(date)` and `$HOME`. Then \\(x=3\\).';
 const html=render(text);assert.deepEqual(expressions(html),['x=3']);assert.match(html,/\$1\.50–\$2\.50/);assert.match(html,/<code>\$\(date\)<\/code>/);
});
test('fresh: incomplete Unicode/formula/code streams never execute markup or lose a previously closed formula',()=>{
 const text='λ🙂 \\(a=1\\), \\(b=2\\)\n\n```html\n<img src=x onerror="alert(1)">\n```';
 const first=text.indexOf('\\)')+2;
 for(let n=first;n<=text.length;n++){const html=renderer.renderRichText(text.slice(0,n),0,{streaming:true});assert.ok(expressions(html).includes('a=1'));assert.doesNotMatch(html,/<img\b|<script\b/);}
});
test('fresh: one-line peer headings do not grow a random first numbered item',()=>{
 for(const labels of [['1) One','2) Two','3) Three'],['(i) First','(ii) Second'],['A. Method','B. Method'],['2024 results','2025 results']]){
  const text=labels.map(x=>'### '+x+'\n\nBody.').join('\n\n'),html=renderer.messageContentMarkup({role:'assistant',text},0);
  assert.equal((html.match(/<h3/g)||[]).length,labels.length);assert.doesNotMatch(html,/response-title/);
 }
});
test('fresh: hostile markup in a code block and a citation label stays escaped',()=>{
 const html=render('```html\n<script>alert(1)</script>\n```\n\n[<img onerror=alert(2)>](https://example.org/a?q=1&x=2)');
 assert.doesNotMatch(html,/<script\b|<img\b|href="javascript:/);assert.match(html.replace(/<[^>]*>/g,''),/&lt;script&gt;/);assert.match(html,/&lt;img/);
});

function streamReader(provider,raw,width){
 const c=vm.createContext({TextDecoder,DOMException,setTimeout,clearTimeout});
 vm.runInContext(app.slice(app.indexOf('function runtimeTextChunk('),app.indexOf('function modelTextForMessage(')),c);
 const bytes=new TextEncoder().encode(raw),body=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=width)controller.enqueue(bytes.slice(i,i+width));controller.close();}});
 return c.readRuntimeStream({body},provider);
}
for(const provider of ['DeepSeek','AICredits','Gemini','LM Studio']){
 test(`fresh: ${provider} accepts UTF-8 split at every byte with SSE metadata and no final newline`,async()=>{
  const raw=': heartbeat\r\nevent: message\r\nid: 1\r\nretry: 1500\r\ndata: '+JSON.stringify({choices:[{delta:{content:'தமிழ் λ 👨‍👩‍👧‍👦 e\u0301'},finish_reason:null}]})+'\r\n\r\ndata: '+JSON.stringify({choices:[{delta:{content:' final'},finish_reason:'stop'}]});
  for(const width of [1,2,3,7,64])assert.equal((await streamReader(provider,raw,width)).text,'தமிழ் λ 👨‍👩‍👧‍👦 e\u0301 final');
 });
 test(`fresh: ${provider} accepts the valid SSE CR-only line ending`,async()=>{
  const raw=': pulse\rdata: '+JSON.stringify({choices:[{delta:{content:'short'},finish_reason:null}]})+'\r\rdata: [DONE]\r\r';
  for(const width of [1,5,raw.length])assert.equal((await streamReader(provider,raw,width)).text,'short');
 });
}
test('fresh: a stream that ends after one token cannot masquerade as a completed answer',async()=>{
 for(const provider of ['Ollama','DeepSeek']){
  const raw=provider==='Ollama'?'{"message":{"content":"partial"}}\n':'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
  await assert.rejects(streamReader(provider,raw,1),/before the model finished/);
 }
});
test('fresh: a tiny non-string token or safety stop is rejected rather than printed as an object',async()=>{
 for(const content of [0,false,[],{}])await assert.rejects(streamReader('DeepSeek','data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\n',2),/malformed/);
 await assert.rejects(streamReader('Gemini','data: {"choices":[{"finish_reason":"safety"}]}\n\n',1),/blocked/);
});

test('fresh: damaged thinking preferences recover to a supported provider value',()=>{
 const models=[{key:'ds',provider:'DeepSeek',id:'deepseek-flash'},{key:'ac',provider:'AICredits',id:'deepseek/deepseek-v4.1-flash'},{key:'ol',provider:'Ollama',id:'qwen3:8b'},{key:'gm',provider:'Gemini',id:'gemini-3-flash-preview'}];
 for(const raw of ['{','null','[]','false','42','"high"','{"ds":"MAX","ol":"false","gm":99}']){
  const values=new Map([['orbit-thinking-v1',raw]]),c=vm.createContext({localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}});
  vm.runInContext(fs.readFileSync('thinking.js','utf8'),c);
  for(const model of models){assert.doesNotThrow(()=>c.OrbitThinking.options(model));c.OrbitThinking.set(model,model.provider==='Ollama'?false:'off');assert.doesNotThrow(()=>c.OrbitThinking.options(model));}
 }
});
test('fresh: all disabled tools and damaged saved tool settings are safe',()=>{
 for(const raw of ['{','null','[]','42','{"pdf":false,"docx":false,"pptx":false,"xlsx":false,"text":false,"chart":false,"diagram":false}']){
  const c=vm.createContext({localStorage:{getItem:()=>raw},Blob});vm.runInContext(fs.readFileSync('widgets.js','utf8'),c);
  const settings=c.OrbitWidgets.settings();assert.equal(typeof settings.pdf,'boolean');assert.doesNotThrow(()=>c.OrbitWidgets.instructionFor('Explain a short proof',[]));
 }
});
test('fresh: requested source files retain tabs, BOM, CRLF and trailing spaces across tiny edits',async()=>{
 const c=vm.createContext({OrbitWidgets:W,Blob,DOMException});vm.runInContext(fs.readFileSync('document-edits.js','utf8'),c);
 for(const content of ['\ufeffx = 1\r\n','\tx = 1  \n','x = 1','// λ🙂\nx = 1\n']){
  const input=W.normalize({kind:'text',filename:'main.py',content}),result=c.OrbitDocumentEdits.apply(input,[{op:'replaceText',path:['content'],before:'x = 1',value:'x = 2'}]);
  assert.deepEqual(Buffer.from(await (await W.generate(result)).arrayBuffer()),Buffer.from(content.replace('x = 1','x = 2')));
 }
});

async function chatStore(){
 const c=vm.createContext({indexedDB:new IDBFactory(),localStorage:{getItem:()=>null,removeItem(){}},structuredClone,OrbitWidgets:W});
 vm.runInContext(fs.readFileSync('chat-store.js','utf8'),c);await c.OrbitChatStore.ready;return c.OrbitChatStore;
}
test('fresh: two same-name files and a short imported artifact ID both survive the Files index',async()=>{
 const store=await chatStore();try{
  const chat={title:'Tiny files',messages:[{role:'user',text:'Two versions',attachments:[{name:'notes.txt',previewId:'one'}]},{role:'assistant',text:'Another',attachments:[{name:'notes.txt',previewId:'two'}],artifacts:[{id:'0-0',spec:{kind:'text',filename:'empty.txt',content:''}}]}]};
  const meta=store.metadata(chat);assert.equal(meta.files.length,3);assert.deepEqual(Array.from(meta.files,f=>f.name),['notes.txt','notes.txt','empty.txt']);assert.equal(new Set(meta.files.map(f=>f.key)).size,3);
  const chats={tiny:chat};await store.save(chats);assert.equal((await store.load('tiny')).messages.length,2);
 }finally{store.close();}
});
test('fresh: malformed ancillary file metadata does not prevent a healthy transcript from saving',async()=>{
 const store=await chatStore();try{
  const chat={title:'Keep the valid text',messages:[null,{role:'user',text:'Valid question',attachments:{}},{role:'assistant',text:'Valid answer',artifacts:[null]}]};
  const chats={healthy:chat};await store.save(chats);const saved=await store.load('healthy');assert.equal(saved.messages[1].text,'Valid question');assert.equal(saved.messages[2].text,'Valid answer');
 }finally{store.close();}
});
test('fresh: rapid rename/archive/unarchive saves retain Unicode text and an empty source file',async()=>{
 const store=await chatStore();try{
  const chats={a:{title:'First',messages:[{role:'user',text:'தமிழ் e\u0301'},{role:'assistant',text:'Done',artifacts:[{id:crypto.randomUUID(),spec:{kind:'text',filename:'empty.txt',content:''}}]}]}};
  const pending=[store.save(chats)];for(let n=0;n<30;n++){chats.a={...chats.a,title:'Title '+n,archived:!!(n%2),pinned:!(n%2)};pending.push(store.save(chats));}await Promise.all(pending);
  const chat=await store.load('a');assert.equal(chat.title,'Title 29');assert.equal(chat.messages[0].text,'தமிழ் e\u0301');assert.equal(chat.messages[1].artifacts[0].spec.content,'');
 }finally{store.close();}
});
test('fresh: memory finds compatibility-equivalent and combining Unicode without modifying the quoted text',()=>{
 const c=vm.createContext({localStorage:{getItem:()=>null},TextEncoder,DOMException,setTimeout});vm.runInContext(fs.readFileSync('memories.js','utf8'),c);
 for(const [text,query] of [['The code uses ＦＩＦＯ and returns 0.','FIFO'],['My cafe\u0301 notes use method 2.','café'],['தமிழ் probability example','தமிழ்']]){
  const chats={a:{title:'Unicode notes',messages:[{role:'user',text}]}},entries=c.OrbitMemories.catalog(chats,'other'),hits=c.OrbitMemories.search(chats,entries,query);
  assert.equal(hits.length,1,query);assert.equal(hits[0].excerpt,text);
 }
});

function web(fetch,extra={}){const c=vm.createContext({URL,AbortController,DOMException,setTimeout,clearTimeout,localStorage:{getItem:()=>null},fetch,...extra});vm.runInContext(fs.readFileSync('web-tools.js','utf8'),c);return c.OrbitWeb;}
test('fresh: browser-offline research never starts the planner or any network request',async()=>{
 const w=web(()=>assert.fail('Network called offline'),{navigator:{onLine:false}}),result=await w.research('search current facts',[],{plan:()=>assert.fail('Planner called offline')});assert.equal(result.sources.length,0);assert.match(result.notice,/internet/);
});
test('fresh: turning web off during a slow page read discards the pending source',async()=>{
 let enabled=true,release;const w=web(async()=>{await new Promise(r=>release=r);return {ok:true,json:async()=>({title:'Page',content:'Read content'})};},{localStorage:{getItem:()=>String(enabled)}});
 const pending=w.research('Read https://example.org/page',[],{plan:async()=>'{"action":"read","url":"https://example.org/page"}'});
 for(let n=0;n<20&&!release;n++)await Promise.resolve();enabled=false;release();const result=await pending;assert.equal(result.sources.length,0);assert.match(result.notice,/switched off/);
});
test('fresh: empty success bodies retry within bounds and never claim completed web research',async()=>{
 let calls=0;const w=web(async()=>{calls++;return {ok:true,status:200,json:async()=>{throw SyntaxError('broken JSON');}};});
 const result=await w.research('search current facts',[],{plan:async()=>'{"action":"search","query":"public fact"}',retryDelay:async()=>{}});assert.equal(calls,3);assert.equal(result.sources.length,0);assert.match(result.instruction,/Do not claim/);
});
test('fresh: tiny source titles and URL query punctuation survive rendering while credentials are excluded',()=>{
 const w=web(()=>{}),html=w.sourcesMarkup([{title:'A < B & "C"',url:'https://example.org/p?a=1&b=2#part'},{title:'Bad',url:'https://example.org/?session_key=private'}]);assert.match(html,/A &lt; B &amp; &quot;C&quot;/);assert.match(html,/a=1&amp;b=2/);assert.doesNotMatch(html,/private|#part/);
});

test('fresh: Analyze failure is visible, a corrected run can succeed, and neither replaces the explanation',async()=>{
 const c=vm.createContext({DOMException});vm.runInContext(fs.readFileSync('analyze.js','utf8'),c);let plans=0,runs=0;
 const result=await c.OrbitAnalyze.analyze([{role:'user',text:'Verify 2 + 2 and explain each step'}],{plan:async()=>JSON.stringify(++plans===1?{action:'run',code:'print(2+2)',purpose:'Check sum'}:plans===2?{action:'run',code:'print(2+2)',purpose:'Retry sum'}:{action:'done'}),run:async()=>++runs===1?{ok:false,error:'Synthetic runtime error'}:{ok:true,output:'4'}});
 assert.equal(result.checks.length,2);assert.equal(result.checks[0].ok,false);assert.equal(result.checks[1].output,'4');assert.match(result.instruction,/step|working|explanation|derivation/i);
});

test('fresh: normalized search offsets still quote the correct passage after thousands of expanded ligatures',()=>{
 const c=vm.createContext({localStorage:{getItem:()=>null},TextEncoder,DOMException,setTimeout});vm.runInContext(fs.readFileSync('memories.js','utf8'),c);
 const text='ﬃ '.repeat(2000)+'The cafe\u0301 calculation is 7.35. '+'x '.repeat(1000),chats={a:{title:'Long Unicode',messages:[{role:'user',text}]}};
 const hits=c.OrbitMemories.search(chats,c.OrbitMemories.catalog(chats,'other'),'café');assert.equal(hits.length,1);assert.match(hits[0].excerpt,/cafe\u0301 calculation is 7\.35/);assert.doesNotMatch(hits[0].excerpt,/café/);
});
test('fresh: upgrading a previous Files index recovers hidden rows without changing the transcript',async()=>{
 const idb=new IDBFactory(),req=r=>new Promise((yes,no)=>{r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
 const open=idb.open('orbit-chat-history',2);open.onupgradeneeded=()=>{for(const name of ['chats','meta','index'])open.result.createObjectStore(name);};const old=await req(open);
 const chat={title:'Imported files',messages:[{role:'user',text:'Original',attachments:[{name:'same.c'}]},{role:'assistant',text:'Download',artifacts:[{id:'0-0',spec:{kind:'text',filename:'same.c',content:'x'}}]}]};
 const tx=old.transaction(['chats','meta','index'],'readwrite');tx.objectStore('chats').put(chat,'a');tx.objectStore('meta').put(true,'migrated');tx.objectStore('meta').put(true,'indexed');tx.objectStore('index').put({title:chat.title,files:[{key:'0-0',name:'same.c'}]},'a');await new Promise((yes,no)=>{tx.oncomplete=yes;tx.onabort=no;});old.close();
 const c=vm.createContext({indexedDB:idb,localStorage:{getItem:()=>null},structuredClone,OrbitWidgets:W});vm.runInContext(fs.readFileSync('chat-store.js','utf8'),c);const store=c.OrbitChatStore;
 try{await store.ready;assert.equal(store.initial.a.files.length,2);assert.equal(JSON.stringify((await store.load('a')).messages),JSON.stringify(chat.messages));}finally{store.close();}
});
test('fresh: multiline SSE JSON survives every CRLF split without a phantom blank event',async()=>{
 const raw='data: {"choices":[\r\ndata: {"delta":{"content":"one"},"finish_reason":null}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"two"},"finish_reason":"stop"}]}\r\n\r\n';
 for(const width of [1,2,3,5,17])assert.equal((await streamReader('DeepSeek',raw,width)).text,'onetwo');
});

test('fresh: Analyze isolates damaged history and attachment entries before calling its planner',async()=>{
 const c=vm.createContext({DOMException});vm.runInContext(fs.readFileSync('analyze.js','utf8'),c);
 let history;
 const result=await c.OrbitAnalyze.analyze([null,{role:'unexpected'}, {role:'user',text:'Explain this',attachments:{}},{role:'assistant',text:'Earlier reply'},{role:'user',text:'Explain the attached notes',attachments:[null,{name:'notes.txt',extractedText:'Valid source'}]}],{plan:async h=>{history=h;return '{"action":"none"}';}});
 assert.equal(result.checks.length,0);
 const conversation=JSON.parse(history[1].text).conversation;
 assert.equal(conversation.length,3);assert.equal(conversation[0].attachments.length,0);assert.equal(conversation[2].attachments[0].text.trim(),'Valid source');
 assert.equal(history[1].attachments.length,1);assert.equal(history[1].attachments[0].name,'notes.txt');
});
test('fresh: damaged attachment entries do not hide valid files or break reply/title evidence',()=>{
 const attachments=[null,{name:'notes.txt',extractedText:'Valid source',visualWarnings:[],visuals:[]}];
 renderer.isImageFile=()=>false;renderer.attachmentFileKind=()=>({icon:'icon-file-text',className:'text',label:'Text file'});
 assert.doesNotThrow(()=>renderer.messageAttachmentsMarkup(attachments));assert.match(renderer.messageAttachmentsMarkup(attachments),/data-preview-attachment="1"/);
 const c=vm.createContext({normalizedWidgetArtifacts:()=>[],OrbitWidgets:W,stripTitleFormatting:x=>x});
 vm.runInContext(app.slice(app.indexOf('function modelTextForMessage('),app.indexOf('async function prepareReplyContext(')),c);
 vm.runInContext(app.slice(app.indexOf('function conversationTitleEvidence('),app.indexOf('function fallbackConversationTitle(')),c);
 assert.match(c.modelTextForMessage({text:'Keep the question',attachments}),/Valid source/);
 assert.match(c.modelTextForMessage({text:'Keep the question',attachments:[{name:'notes',extractedText:'Valid source',visuals:'broken',visualWarnings:{}}]}),/Valid source/);
 const evidence=c.conversationTitleEvidence('Explain this',[{role:'user',text:'Explain this',attachments:{} }]);assert.equal(evidence.attachments.length,0);
 const next=c.conversationTitleEvidence('Explain this',[{role:'user',text:'Explain this',attachments}]);assert.equal(next.attachments.length,1);assert.equal(next.attachments[0].name,'notes.txt');
});
test('fresh: document edit candidate discovery ignores damaged entries without shifting source indices',()=>{
 const c=vm.createContext({OrbitWidgets:W});vm.runInContext(fs.readFileSync('document-edits.js','utf8'),c);
 const messages=[null,{role:'user',attachments:{}},{role:'assistant',artifacts:[null,{id:'safe',spec:{kind:'text',filename:'safe.py',content:'x=1'}}]},{role:'user',attachments:[null,{name:'notes.txt'}]}];
 const items=c.OrbitDocumentEdits.candidates(messages);assert.equal(items.length,2);assert.equal(items[0].attachmentIndex,1);assert.equal(items[0].messageIndex,3);assert.equal(items[1].artifact.id,'safe');assert.equal(c.OrbitDocumentEdits.intent('Explain those notes',true),false);
});
test('fresh: damaged attachment metadata cannot block image instructions or healthy visual reading',async()=>{
 const D=require('../document-assets.js'),dataUrl='data:image/png;base64,aGVsbG8=';
 const messages=[null,{role:'user',attachments:{}},{role:'assistant',artifacts:[null]},{role:'user',attachments:[null,{name:'image.png',assetId:'img-safe',dataUrl,visuals:{broken:true}}]}];
 assert.equal(D.catalog(messages).length,1);assert.match(D.instruction(messages),/img-safe/);
 const result=await D.describe(messages,{force:true,model:{},read:async()=> 'Valid image reading'});assert.match(result.at(-1).attachments[1].visualSummary,/Valid image reading/);assert.equal(messages.at(-1).attachments[1].visualSummary,undefined);
});

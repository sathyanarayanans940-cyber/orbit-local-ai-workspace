const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'),'utf8');

function runtime(provider = 'Ollama') {
  let clock = 0, serial = 0, body, request;
  const timers = new Map();
  const context = vm.createContext({
    AbortController, AbortSignal, DOMException, TextDecoder, Promise,
    setTimeout(fn,ms) { const id=++serial; timers.set(id,{fn,at:clock+ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    state:{models:[{key:'model',id:'test-cloud',provider}],selectedModel:'model',connectedProviders:new Set()},
    runtimeEndpoints:{DeepSeek:{chat:'/api/deepseek/chat',headers:{'X-Orbit-DeepSeek':'1'}},Ollama:{chat:'/ollama'},'LM Studio':{chat:'/lmstudio'},Gemini:{chat:'/api/gemini/chat',headers:{'X-Orbit-Gemini':'1'}}},
    OrbitThinking:{options:()=>({reasoning_effort:'low'})},
    OrbitWidgets:{instruction:()=> 'Enabled kinds: pdf, docx, pptx, chart.'},
    normalizedWidgetArtifacts:()=>[], isImageFile:()=>false,
    modelUsesCloud:model=>model.id.includes('cloud'),
    updateRuntimeStatus(){}, setRuntimeStatus(){}, async discoverModels(){},
    async fetch(url,options) {
      request = {url,...options,body:JSON.parse(options.body)};
      const stream = new ReadableStream({start(controller) { body=controller; }});
      options.signal.addEventListener('abort',()=>body.error(new DOMException('Stopped','AbortError')),{once:true});
      return {ok:true,body:stream};
    },
  });
  vm.runInContext(source.slice(source.indexOf('async function requestRuntime('),source.indexOf('async function requestGeneratedTitle(')),context);
  return {
    context, timers, request:()=>request,
    tick(ms) { clock+=ms; for(const [id,timer] of [...timers]) if(timer.at<=clock) { timers.delete(id); timer.fn(); } },
    send(data) { body.enqueue(new TextEncoder().encode((provider!=='Ollama'?'data: ':'')+JSON.stringify(data)+'\n')); },
    raw(data) { body.enqueue(new TextEncoder().encode(data)); },
    bytes(data) { for(const byte of new TextEncoder().encode(data)) body.enqueue(new Uint8Array([byte])); },
    close() { body.close(); },
  };
}
const flush = async () => { for(let i=0;i<32;i++) await Promise.resolve(); };
test('title generation is short, uses lightweight internal mode, and does not load file or math tools',async()=>{
 for(const provider of ['Ollama','LM Studio','Gemini','DeepSeek','AICredits']){
  const r=runtime(provider);r.context.runtimeEndpoints.AICredits={chat:'/api/aicredits/chat'};
  let internal;r.context.OrbitThinking.options=(_,flag)=>{internal=flag;return {};};
  const pending=r.context.requestLocalReply('',[{role:'system',text:'Name the subject'},{role:'user',text:'Quoted evidence'}],{naming:true});
  await flush();const body=r.request().body;
  assert.equal(provider==='Ollama'?body.options.num_predict:body.max_tokens,256,provider);
  if(provider!=='LM Studio')assert.equal(internal,true);assert.equal(body.response_format,undefined);assert.equal(body.format,undefined);assert.equal(body.messages.length,2);
  assert.doesNotMatch(body.messages[0].content,/Analyze|Worked solutions|KaTeX|file tool/);
  r.send(provider==='Ollama'?{message:{content:'Actual Subject'},done:true}:{choices:[{delta:{content:'Actual Subject'},finish_reason:'stop'}]});r.close();await pending;
 }
});
test('edit/resubmit uses the real web gate and allows a research planner for a document upload',async()=>{
  const r=runtime();
  vm.runInContext(fs.readFileSync(require.resolve('../web-tools.js'),'utf8'),r.context);
  const user={role:'user',text:'bro can u make word document containing summary, code, results and time complexity',modelText:'bro can u make word document containing summary, code, results and time complexity',attachments:[{name:'lab.pdf',extractedText:'Search using FIFO and LIFO branch and bound. Verify the current solution.'}]};
  const expanded=r.context.modelTextForMessage(user);
  const reply=r.context.requestLocalReply(expanded,[user],{widgets:true,researchPrompt:expanded});
  await flush();
  assert.equal(r.request().body.format,'json');
  assert.doesNotMatch(JSON.stringify(r.request().body.messages),/Search using FIFO/);
  r.send({message:{content:'{"action":"none"}'},done:true,done_reason:'stop'});r.close();
  await flush();
  assert.match(r.request().body.messages[0].content,/No web research was performed/);
  assert.match(r.request().body.messages.at(-1).content,/Search using FIFO/);
  r.send({message:{content:'I’ll prepare your document.'},done:true,done_reason:'stop'});r.close();
  assert.equal((await reply).webResearch.notice,'');
});
test('regeneration keeps attachment text out of web intent while retaining it for the answer',async()=>{
  const r=runtime();let researched;
  r.context.OrbitWeb={research:async(prompt)=>{researched=prompt;return {sources:[],notice:'',instruction:''};}};
  const user='Make a Word document';
  const expanded=user+'\n\nAttached file: assignment.pdf\nSearch tree and current best solution';
  const pending=r.context.requestLocalReply(expanded,[{role:'user',text:user,attachments:[{name:'assignment.pdf',extractedText:'Search tree and current best solution'}]}],{widgets:true,researchPrompt:expanded});
  await flush();assert.equal(researched,user);
  assert.match(r.request().body.messages.at(-1).content,/Search tree/);
  r.send({message:{content:'Answer'},done:true,done_reason:'stop'});r.close();await pending;
});

test('real reply orchestration overlaps remote tools, waits for all evidence, and serializes local tools',async()=>{
 for(const remote of [true,false]){
  const r=runtime(remote?'DeepSeek':'Ollama');r.context.state.models[0].id=remote?'deepseek-flash':'qwen3:8b';
  const started=[],gates={},tokens=[];
  const tool=(key,value)=>async()=>{started.push(key);await new Promise(resolve=>gates[key]=resolve);return value;};
  r.context.OrbitMemories={recall:tool('memory','Original learned Word preferences')};
  r.context.OrbitAnalyze={analyze:tool('analysis',{instruction:'Original complete calculation checks',checks:[{ok:true,output:'Every intermediate quantity'}]})};
  r.context.OrbitWeb={research:tool('web',{instruction:'Original retrieved source evidence',sources:[{title:'Actual source',url:'https://example.org'}]})};
  const pending=r.context.requestLocalReply('Solve this in Word',[{role:'user',text:'Solve this in Word',attachments:[{name:'paper.pdf',extractedText:'Exact source problem'}]}],{widgets:true,onToken:token=>tokens.push(token)});
  await flush();assert.deepEqual(started,remote?['memory','analysis','web']:['memory']);assert.equal(r.request(),undefined);
  if(remote){gates.web();gates.memory();await flush();assert.equal(r.request(),undefined);gates.analysis();}
  else{gates.memory();await flush();assert.deepEqual(started,['memory','analysis']);gates.analysis();await flush();assert.deepEqual(started,['memory','analysis','web']);gates.web();}
  await flush();const body=r.request().body;
  assert.match(body.messages[0].content,/Original learned Word preferences/);assert.match(body.messages[0].content,/Original complete calculation checks/);assert.match(body.messages[0].content,/Original retrieved source evidence/);
  assert.match(body.messages.at(-1).content,/Exact source problem/);assert.match(body.messages[0].content,/complete derivation, substitutions, intermediate calculations/);
  r.send(remote?{choices:[{delta:{content:'Complete working'},finish_reason:'stop'}]}:{message:{content:'Complete working'},done:true});r.close();
  const result=await pending;assert.equal(result.analysis.checks[0].output,'Every intermediate quantity');assert.equal(result.webResearch.sources.length,1);assert.deepEqual(tokens,['Complete working']);
 }
});

test('latency diagnostics distinguish first text, thinking and network headers without retaining content',async()=>{
 const r=runtime('DeepSeek');r.context.state.models[0].id='deepseek-flash';
 r.context.OrbitThinking={options:()=>({thinking:{type:'disabled'}}),status:()=>''};
 let now=1000;r.context.Date={now:()=>now};const fetch=r.context.fetch;
 r.context.fetch=async(...args)=>({...await fetch(...args),headers:new Headers({'Server-Timing':'deepseek_connect;dur=100, deepseek_headers;dur=200'})});
 const statuses=[];
 const pending=r.context.requestLocalReply('Private synthetic prompt',[{role:'user',text:'Private synthetic prompt'}],{widgets:true,onStatus:label=>statuses.push(label)});await flush();
 assert.equal(statuses.at(-1),'Waiting for DeepSeek');
 now=1400;r.send({choices:[{delta:{content:'Private synthetic answer'}}]});await flush();
 now=1800;r.send({choices:[{finish_reason:'stop'}]});r.close();await pending;
 const diagnostics=r.context.state.runtimeDiagnostics,timing=diagnostics.at(-1);
 assert.equal(timing.firstTextMs,400);assert.equal(timing.firstThinkingMs,null);assert.equal(timing.requestedThinking,'disabled');assert.equal(timing.streamMs,800);assert.match(timing.serverTiming,/deepseek_connect/);
 assert.doesNotMatch(JSON.stringify(diagnostics),/Private synthetic/);
});

test('active replies stream beyond two minutes for both providers without a short output cap', async()=> {
  for(const provider of ['Ollama','LM Studio','Gemini']) {
    const r=runtime(provider), tokens=[];
    const reply=r.context.requestLocalReply('Write a thorough report',[{role:'user',text:'Write a thorough report'}],{widgets:true,onToken:t=>tokens.push(t)});
    await flush();
    const body=r.request().body;
    assert.match(body.messages[0].content,/Do not impose an arbitrary short-answer limit/);
    if(provider==='Ollama') assert.equal(body.options,undefined);
    else if(provider==='LM Studio') assert.equal(body.max_tokens,-1);
    else { assert.equal(body.max_tokens,undefined);assert.equal(body.reasoning_effort,'low');assert.equal(r.request().headers['X-Orbit-Gemini'],'1');assert.equal(body.temperature,undefined); }
    for(let i=0;i<4;i++) {
      r.tick(90000);
      assert.equal(r.request().signal.aborted,false);
      r.send(provider==='Ollama'?{message:{content:'More. '}}:{choices:[{delta:{content:'More. '}}]});
      await flush();
    }
    r.send(provider==='Ollama'?{done:true,done_reason:'stop'}:{choices:[{finish_reason:'stop'}]});
    r.close();
    assert.equal((await reply).text,'More. '.repeat(4));
    assert.equal(tokens.length,4);
    assert.equal(r.timers.size,0);
  }
});

test('stalled streams time out, and provider truncation/error signals are surfaced', async()=> {
  const r=runtime();
  const reply=r.context.requestLocalReply('Report',[],{widgets:true});
  const rejected=assert.rejects(reply,/stopped sending data/);
  await flush(); r.tick(120001); await rejected;
  assert.equal(r.timers.size,0);
  for(const provider of ['Ollama','LM Studio','Gemini']) {
    const t=runtime(provider);
    const pending=t.context.requestLocalReply('Report',[],{widgets:true});
    const failure=assert.rejects(pending,/output or context limit/);
    await flush();
    t.send(provider==='Ollama'?{done:true,done_reason:'length'}:{choices:[{finish_reason:'length'}]});
    await failure;
    assert.equal(t.timers.size,0);
  }
  const e=runtime(); const pending=e.context.requestLocalReply('Report',[],{widgets:true});
  const failure=assert.rejects(pending,/Provider failure/);
  await flush(); e.send({error:'Provider failure'}); await failure;
});

test('Stop still cancels streaming and title generation does not receive long-form instructions',async()=> {
  const r=runtime(), controller=new AbortController();
  const reply=r.context.requestLocalReply('Report',[],{widgets:true,signal:controller.signal});
  const rejected=assert.rejects(reply,{name:'AbortError'});
  await flush(); controller.abort(); await rejected;
  const title=runtime(); const pending=title.context.requestLocalReply('Title',[{role:'user',text:'Title'}]);
  await flush();
  assert.equal(title.request().body.options,undefined);
  assert.equal(title.request().body.messages.length,1);
  title.send({message:{content:'Report title'},done:true}); title.close(); await pending;
});

test('local Ollama retains unlimited output while cloud avoids its unsupported sentinel',async()=> {
  const local=runtime(); local.context.state.models[0].id='gemma4:26b';
  const reply=local.context.requestLocalReply('Explain',[],{widgets:true});
  await flush(); assert.equal(local.request().body.options.num_predict,-1);
  local.send({message:{content:'Done'},done:true});local.close();await reply;
});

test('thinking choice reaches Ollama chat requests and internal tasks use a supported level',async()=>{
 for(const internal of [false,true]) {
  const r=runtime();r.context.localStorage={getItem:()=>'{"model":"high"}'};
  vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);
  r.context.state.models[0].id='gpt-oss:120b-cloud';
  const reply=r.context.requestLocalReply('Hello',[{role:'user',text:'Hello'}],internal?{planning:true}:{});
  await flush();assert.equal(r.request().body.think,internal?'low':'high');
  r.send({message:{content:'Hello'},done:true});r.close();await reply;
 }
});

test('computational verification honors the selected thinking effort while tool routing stays light',async()=>{
 for(const provider of ['DeepSeek','AICredits'])for(const effort of ['high','off'])for(const stage of ['analyzing','planning']){
  const r=runtime(provider);r.context.state.models[0].id=provider==='AICredits'?'deepseek/deepseek-v4.1-flash':'deepseek-flash';
  r.context.runtimeEndpoints.AICredits={chat:'/api/aicredits/chat',headers:{'X-Orbit-AICredits':'1'}};
  r.context.localStorage={getItem:()=>JSON.stringify({model:effort})};
  vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);
  const reply=r.context.requestLocalReply('Verify the probability',[],{[stage]:true});await flush();
  const body=r.request().body;
  if(provider==='AICredits')assert.equal(body.reasoning_effort,stage==='analyzing'&&effort==='high'?'high':'none');
  else assert.equal(body.thinking.type,stage==='analyzing'&&effort==='high'?'enabled':'disabled');
  assert.equal(body.response_format.type,'json_object');assert.equal(body.max_tokens,16384);
  r.send({choices:[{delta:{content:'{"action":"done"}'},finish_reason:'stop'}]});r.close();await reply;
 }
});
test('reasoning verification can stream past 90 seconds while Off keeps its shorter deadline',async()=>{
 for(const effort of ['high','off']){
  const r=runtime('AICredits');r.context.state.models[0].id='deepseek/deepseek-v4.1-flash';
  r.context.runtimeEndpoints.AICredits={chat:'/api/aicredits/chat',headers:{'X-Orbit-AICredits':'1'}};
  r.context.localStorage={getItem:()=>JSON.stringify({model:effort})};
  vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);
  r.context.OrbitAnalyze={analyze:async(_,options)=>{await options.plan([{role:'user',text:'Verify the root'}]);return {instruction:'Execution evidence',checks:[]};}};
  const pending=r.context.requestLocalReply('Solve the probability',[],{widgets:true});
  const failure=effort==='off'?assert.rejects(pending,/Analyze planning timed out/):null;
  await flush();r.send({choices:[{delta:{reasoning_content:'Working'},finish_reason:null}]});await flush();r.tick(95000);await flush();
  if(failure){await failure;continue;}
  assert.equal(r.request().signal.aborted,false);
  r.send({choices:[{delta:{content:'{"action":"done"}'},finish_reason:'stop'}]});r.close();await flush();
  r.send({choices:[{delta:{content:'Complete explanation'},finish_reason:'stop'}]});r.close();
  assert.equal((await pending).text,'Complete explanation');assert.equal(r.timers.size,0);
 }
});
test('thinking status requires actual reasoning and ignored off controls disappear',async()=>{
 const r=runtime(),statuses=[];r.context.localStorage={getItem:()=>'{"model":false}'};
 vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);
 const model=r.context.state.models[0];model.id='qwen3:8b';
 const pending=r.context.requestLocalReply('Hi',[{role:'user',text:'Hi'}],{onStatus:s=>statuses.push(s)});
 await flush();assert.equal(r.request().body.think,false);assert.equal(statuses.length,0);
 r.send({message:{thinking:'Reasoning content'}});await flush();
 assert.deepEqual(statuses,['Thinking']);assert.equal(r.context.OrbitThinking.mode(model),null);
 r.send({message:{content:'Answer'},done:true});r.close();await pending;
 assert.equal(Object.keys(r.context.OrbitThinking.options(model)).length,0);
});

test('a clean socket close without completion is reported as an interrupted response',async()=>{
 for(const provider of ['Ollama','LM Studio','Gemini']) {
  const r=runtime(provider);const pending=r.context.requestLocalReply('Explain',[],{});
  const failure=assert.rejects(pending,/before the model finished/);
  await flush();r.send(provider==='Ollama'?{message:{content:'Partial'}}:{choices:[{delta:{content:'Partial'}}]});r.close();await failure;
 }
});
test('large animation queues drain promptly, preserve Unicode and still cancel',async()=>{
 const timers=new Map();let serial=0;const chunks=[];
 const context=vm.createContext({window:{setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}},appendAssistantReply:(_,text)=>chunks.push(text)});
 vm.runInContext(source.slice(source.indexOf('function createStreamedReplyRenderer('),source.indexOf('function completeAssistantReply(')),context);
 const renderer=context.createStreamedReplyRenderer(()=>({}));
 const input='😀'.repeat(120000);renderer.push(input);const finished=renderer.finish();let ticks=0;
 while(timers.size && ticks<300){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();ticks++;}
 assert.ok(ticks<150,`queue took ${ticks} frames`);await finished;
 assert.equal(chunks.join(''),input);assert.ok(chunks.every(c=>!/[\uD800-\uDBFF]$/.test(c)));
 const stopped=context.createStreamedReplyRenderer(()=>({}));stopped.push('x'.repeat(10000));stopped.cancel();await stopped.finish();assert.equal(timers.size,0);
});
test('malformed stream packets fail clearly, while fragmented Unicode and SSE metadata work',async()=>{
 const broken=runtime();const pending=broken.context.requestLocalReply('Hi',[],{});const failure=assert.rejects(pending,/malformed response data/);
 await flush();broken.raw('{broken}\n');await failure;
 const r=runtime('LM Studio');const reply=r.context.requestLocalReply('Hi',[],{});await flush();
 r.raw(':keepalive\nevent: message\ndata: {"choices":[{"delta":{"content":"Hello ');
 r.raw('🌍"}}]}\ndata: [DONE]\n');r.close();assert.equal((await reply).text,'Hello 🌍');
});

test('Gemini plain multi-line 503 after valid SSE preserves a clear provider error',async()=>{
 const r=runtime('Gemini'),tokens=[];
 const pending=r.context.requestLocalReply('Long answer',[],{onToken:t=>tokens.push(t)});
 const failure=assert.rejects(pending,/temporarily busy or experiencing high demand/);
 await flush();
 r.raw('data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n');
 r.raw('[{\n  "error": {\n    "code": 503,\n    "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",\n    "status": "UNAVAILABLE"\n  }\n}]');
 r.close();
 await flush();
 await failure;
 assert.deepEqual(tokens,['Partial answer']);
});

test('Gemini planner uses JSON and provider-filtered replies report the reason',async()=>{
 const r=runtime('Gemini');
 const pending=r.context.requestLocalReply('Plan',[{role:'user',text:'Plan'}],{planning:true});
 await flush();
 assert.deepEqual(JSON.parse(JSON.stringify(r.request().body.response_format)),{type:'json_object'});
 assert.equal(r.request().body.max_tokens,8192);
 r.send({choices:[{delta:{content:'{"action":"none"}'},finish_reason:'stop'}]});r.close();
 assert.equal((await pending).text,'{"action":"none"}');
 const f=runtime('Gemini');const blocked=f.context.requestLocalReply('Hello',[],{});
 const failure=assert.rejects(blocked,/provider blocked/);await flush();
 f.send({choices:[{finish_reason:'content_filter'}]});await failure;
});

test('provider completion ends the reply even when the socket remains open',async()=>{
 for(const provider of ['Ollama','LM Studio','Gemini']){
  const r=runtime(provider);const pending=r.context.requestLocalReply('Hi',[],{});
  await flush();r.send(provider==='Ollama'?{message:{content:'Finished'},done:true}:{choices:[{delta:{content:'Finished'},finish_reason:'stop'}]});
  await flush();r.tick(120001);
  assert.equal((await pending).text,'Finished');assert.equal(r.timers.size,0);
 }
});
test('SSE multiline records and arbitrarily split UTF-8 bytes decode correctly',async()=>{
 const r=runtime('Gemini');const pending=r.context.requestLocalReply('Hi',[],{});await flush();
 r.bytes('event: message\r\ndata: {"choices": [\r\ndata: {"delta":{"content":"தமிழ் 🌍"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');r.close();
 assert.equal((await pending).text,'தமிழ் 🌍');
});
test('invalid JSON packet types report a clear error instead of coercing objects',async()=>{
 for(const payload of [null,17,{choices:[{delta:{content:{bad:'data'}}}]}]){
  const r=runtime('LM Studio');const pending=r.context.requestLocalReply('Hi',[],{});
  const rejected=assert.rejects(pending,/malformed response data/);await flush();r.send(payload);r.close();await rejected;
 }
});
test('all providers use visual reading notes without resending summarized screenshot bytes',async()=>{
 for(const provider of ['Ollama','LM Studio','Gemini']){
  const r=runtime(provider);r.context.isImageFile=()=>true;
  r.context.OrbitDocuments={validImage:url=>!!url,instruction:()=>'',describe:async messages=>messages.map(m=>({...m,attachments:m.attachments.map(a=>({...a,visualSummary:'Actual screenshot result: 17/20 passed; Run B unknown.'}))}))};
  const pending=r.context.requestLocalReply('Document evidence',[{role:'user',text:'Document evidence',attachments:[{name:'ss.png',dataUrl:'data:image/png;base64,SHOULDNOTBERESENT'}]}],{widgets:true});await flush();
  const body=JSON.stringify(r.request().body);assert.match(body,/17\/20 passed/);assert.doesNotMatch(body,/SHOULDNOTBERESENT/);
  if(provider==='Ollama')r.send({message:{content:'Done'},done:true});else r.send({choices:[{delta:{content:'Done'},finish_reason:'stop'}]});r.close();await pending;
 }
});
test('document retry identity uses original uploads, not changing vision notes or expanded retry prompt',async()=>{
 const r=runtime();const L=require('../long-documents.js'),captured=[];let reads=0;
 r.context.OrbitLongDocuments={target:L.target,sourceContext:L.sourceContext,build:async(request,options)=>{captured.push({request,identity:JSON.stringify(options.checkpointIdentity),context:JSON.stringify(options.context)});return {text:'Complete document'};}};
 r.context.OrbitWidgets.settings=()=>({docx:true});
 r.context.OrbitDocuments={instruction:()=>'',validImage:()=>true,catalog:()=>[{id:'img-a',label:'Evidence'}],describe:async conversation=>conversation.map(m=>({...m,attachments:m.attachments.map(a=>({...a,visualSummary:'Reading '+(++reads)}))}))};
 const conversation=[{role:'user',text:'Create an 8 page Word report',attachments:[{name:'Screenshot.png',assetId:'img-a',dataUrl:'data:image/png;base64,AA=='}]}];
 await r.context.requestLocalReply(conversation[0].text,conversation,{widgets:true});
 await r.context.requestLocalReply(r.context.modelTextForMessage(conversation[0]),conversation,{widgets:true});
 assert.equal(captured.length,2);assert.equal(captured[0].request,conversation[0].text);assert.equal(captured[1].request,captured[0].request);assert.equal(captured[1].identity,captured[0].identity);assert.notEqual(captured[1].context,captured[0].context);assert.match(captured[0].identity,/img-a/);
});


test('DeepSeek survives queued keepalives then private thought and split Unicode answer',async()=>{
 const r=runtime('DeepSeek');const statuses=[],tokens=[];
 r.context.state.models[0].id='deepseek-flash';
 vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);
 const reply=r.context.requestLocalReply('Explain this',[],{widgets:true,onToken:t=>tokens.push(t),onStatus:s=>statuses.push(s)});
 await flush();
 assert.equal(r.request().url,'/api/deepseek/chat');
 assert.equal(r.request().headers['X-Orbit-DeepSeek'],'1');
 assert.equal(r.request().body.thinking.type,'enabled');
 assert.equal(r.request().body.reasoning_effort,'high');
 assert.equal(r.request().body.max_tokens,65536);
 assert.equal(r.request().body.temperature,undefined);
 for(let i=0;i<7;i++){r.tick(90000);r.raw(': keep-alive\n\n');await flush();}
 r.send({choices:[{delta:{reasoning_content:'private work'}}]});await flush();
 r.bytes('data: {"choices":[{"delta":{"content":"Verified 🧪"}}]}\n\n');
 r.raw('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":200}}\n\n');r.close();
 assert.equal((await reply).text,'Verified 🧪');assert.deepEqual(tokens,['Verified 🧪']);assert.ok(statuses.includes('Thinking'));
 assert.equal(r.timers.size,0);
});
test('DeepSeek document planning uses JSON without unsupported local token sentinels',async()=>{
 const r=runtime('DeepSeek');r.context.state.models[0].id='deepseek-flash';
 vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);
 const reply=r.context.requestLocalReply('Return a JSON document',[],{drafting:true});await flush();
 assert.equal(r.request().body.thinking.type,'disabled');
 assert.equal(r.request().body.response_format.type,'json_object');
 assert.equal(r.request().body.max_tokens,16384);
 r.send({choices:[{delta:{content:'{"blocks":[]}'},finish_reason:'stop'}]});r.close();await reply;
});
test('DeepSeek billing errors are not retried or mislabeled as Gemini errors',async()=>{
 const r=runtime('DeepSeek');let calls=0;
 r.context.fetch=async()=>{calls++;return {ok:false,status:402,json:async()=>({error:'Your DeepSeek API balance is insufficient.'})};};
 await assert.rejects(r.context.requestLocalReply('Hello',[],{}),/DeepSeek API balance/);assert.equal(calls,1);
 const q=runtime('DeepSeek');const pending=q.context.requestLocalReply('Hello',[],{});const rejected=assert.rejects(pending,/DeepSeek is temporarily unavailable/);
 await flush();q.send({error:{code:503,message:'DeepSeek is temporarily unavailable'}});await rejected;
});

test('DeepSeek Flash sends all uploaded images; Pro uses an explicit unavailable-reading note',async()=>{
 for(const vision of [true,false]){
  const r=runtime('DeepSeek');const model=r.context.state.models[0];model.id=vision?'deepseek-flash':'deepseek-v4-pro';model.capabilities=vision?['thinking','vision']:['thinking'];
  vm.runInContext(fs.readFileSync(require.resolve('../document-assets.js'),'utf8'),r.context);
  r.context.isImageFile=a=>a.type==='image/png';r.context.modelSupportsVision=m=>m.capabilities.includes('vision');
  const images=[{name:'first.png',type:'image/png',dataUrl:'data:image/png;base64,AAAA',assetId:'img-a'}, {name:'second.png',type:'image/png',dataUrl:'data:image/png;base64,BBBB',assetId:'img-b'}];
  const messages=await r.context.OrbitDocuments.describe([{role:'user',text:'Compare both',attachments:images}],{model,read:()=>{throw Error('Unexpected vision request');}});
  const pending=r.context.requestLocalReply('Compare both',messages,{});await flush();
  const content=r.request().body.messages.at(-1).content;
  if(vision)assert.equal(content.filter(part=>part.type==='image_url').length,2);
  else {assert.equal(typeof content,'string');assert.match(content,/VISUAL READING UNAVAILABLE/);assert.doesNotMatch(content,/base64/);}
  r.send({choices:[{delta:{content:'Checked'},finish_reason:'stop'}]});r.close();await pending;
 }
});

test('AICredits requests exact Flash model with JSON and internal thinking disabled',async()=>{
 const r=runtime('AICredits');vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);r.context.runtimeEndpoints.AICredits={chat:'/api/aicredits/chat',headers:{'X-Orbit-AICredits':'1'}};
 r.context.state.models[0].id='deepseek/deepseek-v4.1-flash';
 const pending=r.context.requestLocalReply('Make a JSON document',[],{drafting:true});await flush();
 const request=r.request();assert.equal(request.body.model,'deepseek/deepseek-v4.1-flash');assert.equal(request.headers['X-Orbit-AICredits'],'1');
 assert.equal(request.body.max_tokens,16384);assert.equal(request.body.response_format.type,'json_object');
 assert.equal(request.body.thinking,undefined);assert.equal(request.body.reasoning_effort,'none');
 r.send({choices:[{delta:{content:'{"blocks":[]}'},finish_reason:'stop'}]});r.close();await pending;
});
test('unavailable AICredits selection stops instead of using another provider or demo',async()=>{
 const r=runtime('AICredits');r.context.state.models=[];r.context.state.selectedModel='AICredits:deepseek/deepseek-v4.1-flash';
 await assert.rejects(r.context.requestLocalReply('Hello',[],{}),/has not switched models/);assert.equal(r.request(),undefined);
});


test('AICredits upstream 404 is not mislabeled as an outdated Orbit server', async()=>{
  const c=vm.createContext({AbortSignal,fetch:async()=>({status:404,ok:false,json:async()=>({error:'AICredits catalog unavailable'})})});
  vm.runInContext(source.slice(source.indexOf('async function aicreditsSettingsRequest('),source.indexOf('async function updateAICreditsSettings(')),c);
  await assert.rejects(c.aicreditsSettingsRequest('models'),/AICredits catalog unavailable/);
  c.fetch=async()=>({status:404,ok:false,json:async()=>{throw new Error('HTML response');}});
  await assert.rejects(c.aicreditsSettingsRequest('settings'),/missing the AICredits endpoint/);
});

test('AICredits forwards every requested effort on ordinary replies with no model fallback',async()=>{
 for(const effort of ['none','low','high','max']) {
  const r=runtime('AICredits');r.context.runtimeEndpoints.AICredits={chat:'/api/aicredits/chat',headers:{'X-Orbit-AICredits':'1'}};
  r.context.state.models[0].id='deepseek/deepseek-v4.1-flash';
  r.context.OrbitThinking.options=()=>({reasoning_effort:effort});
  const pending=r.context.requestLocalReply('Hello',[],{});await flush();
  assert.equal(r.request().body.reasoning_effort,effort);
  assert.equal(r.request().body.model,'deepseek/deepseek-v4.1-flash');
  r.send({choices:[{delta:{content:'Hello'},finish_reason:'stop'}]});r.close();await pending;
 }
});

test('Analyze inherits every supported chat thinking mode in actual provider payloads',async()=>{
 const configurations=[
  ['Ollama','qwen3:8b',[true,false]],
  ['Ollama','deepseek-v3.1:671b-cloud',[true,false]],
  ['Ollama','gpt-oss:120b-cloud',['low','medium','high']],
  ['Ollama','gemma4:31b-cloud',[undefined]],
  ['Gemini','gemini-2.5-flash',[true,false]],
  ['Gemini','gemini-3-flash-preview',['low','medium','high']],
  ['DeepSeek','deepseek-flash',['off','low','high','max']],
  ['AICredits','deepseek/deepseek-v4.1-flash',['off','low','high','max']],
  ['LM Studio','unknown-reasoning-model',[undefined]],
 ];
 for(const [provider,id,efforts] of configurations)for(const effort of efforts){
  const observed=[];
  for(const callbacks of [{},{analyzing:true},{analyzing:true,planning:true}]){
   const r=runtime(provider);r.context.runtimeEndpoints.AICredits={chat:'/api/aicredits/chat'};
   r.context.state.models[0].id=id;
   r.context.localStorage={getItem:()=>JSON.stringify({model:effort})};
   vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);
   const reply=r.context.requestLocalReply('Verify this',[],callbacks);await flush();const body=r.request().body;
   observed.push(JSON.stringify({think:body.think,thinking:body.thinking,reasoning_effort:body.reasoning_effort}));
   if(callbacks.analyzing)assert.equal(provider==='Ollama'?body.format:body.response_format.type,provider==='Ollama'?'json':'json_object');
   r.send(provider==='Ollama'?{message:{content:'Verified'},done:true}:{choices:[{delta:{content:'Verified'},finish_reason:'stop'}]});r.close();await reply;
   assert.equal(r.timers.size,0);
  }
  assert.equal(observed[1],observed[0],provider+' '+id+' '+effort);
  assert.equal(observed[2],observed[0],provider+' mixed internal flags '+effort);
 }
});
test('document edit plans use JSON while retaining the selected thinking mode across providers',async()=>{
 for(const provider of ['Ollama','DeepSeek','AICredits','Gemini','LM Studio']){
  const r=runtime(provider);r.context.runtimeEndpoints.AICredits={chat:'/api/aicredits/chat'};let internal;r.context.OrbitThinking.options=(_,value)=>{internal=value;return provider==='LM Studio'?{}:provider==='Ollama'?{think:true}:{reasoning_effort:'high'};};
  const pending=r.context.requestLocalReply('',[{role:'system',text:'Patch only the selected paragraph.'},{role:'user',text:'Quoted recipe'}],{editing:true,signal:new AbortController().signal});await flush();const body=r.request().body;
  assert.equal(internal,false,provider);if(provider==='Ollama'){assert.equal(body.format,'json');assert.equal(body.think,true);}else {assert.equal(body.response_format.type,'json_object');if(provider!=='LM Studio')assert.equal(body.reasoning_effort,'high');}
  r.send(provider==='Ollama'?{message:{content:'{"edits":[]}'},done:true}:{choices:[{delta:{content:'{"edits":[]}'},finish_reason:'stop'}]});r.close();await pending;
 }
});

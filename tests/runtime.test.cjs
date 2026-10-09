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
      return {ok:true,body:stream,headers:{get:name=>name==='X-Orbit-Tool-Routing'?'3':null}};
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
test('model-chosen direct replies skip all three real planners across providers and stream the first answer immediately',async()=>{
 for(const provider of ['OpenAI','DeepSeek','AICredits','Gemini','Ollama','LM Studio']){
  const r=runtime(provider),statuses=[],tokens=[];
  r.context.TextEncoder=TextEncoder;
  r.context.state.models[0].id=provider==='OpenAI'?'gpt-6-luna':provider==='DeepSeek'?'deepseek-flash':'test-cloud';
  r.context.state.savedChats=new Proxy({}, {ownKeys(){assert.fail('A greeting must not scan previous chats');}});
  r.context.state.deletedChats=new Set();
  const saved={'orbit-memory-preferences-v1':JSON.stringify({mode:'on',about:'Prefer a friendly tone'}),'orbit-learned-preferences-v1':JSON.stringify([{scope:'general',key:'tone',value:'Use plain English'}]),'orbit-thinking-v1':JSON.stringify({model:'off'})};
  r.context.localStorage={getItem:key=>saved[key]??null,setItem:()=>assert.fail('Greeting must not change preferences')};
  r.context.runtimeEndpoints.OpenAI={chat:'/api/openai/chat'};
  r.context.runtimeEndpoints.AICredits={chat:'/api/aicredits/chat'};
  for(const file of ['memories.js','web-tools.js','analyze.js','thinking.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),r.context);
  const pending=r.context.requestLocalReply('hi',[{role:'user',text:'hi'}],{widgets:true,onStatus:t=>statuses.push(t),onToken:t=>tokens.push(t)});
  await flush();
  const body=r.request().body;
  assert.equal(body.response_format,undefined,provider);assert.equal(body.format,undefined,provider);
  if(provider==='OpenAI')assert.equal(body.reasoning_effort,'none');
  assert.match(body.messages[0].content,/Prefer a friendly tone/);assert.match(body.messages[0].content,/Use plain English/);
  assert.doesNotMatch(body.messages[0].content,/Enabled kinds|computational verification stage/);
  assert.equal(body.messages.at(-1).content,'hi');
  r.send(provider==='Ollama'?{message:{content:'Hello!'}}:{choices:[{delta:{content:'Hello!'}}]});
  await flush();assert.deepEqual(tokens,['Hello!'],provider+' first text before completion');
  r.send(provider==='Ollama'?{message:{content:''},done:true}:{choices:[{delta:{},finish_reason:'stop'}]});r.close();
  const result=await pending;assert.equal(result.text,'Hello!');assert.equal(result.analysis,undefined);assert.equal(result.webResearch,undefined);
  assert.ok(!statuses.some(s=>/planning|checking memories|searching/i.test(s)),provider);
 }
});
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
  const reply=r.context.requestLocalReply(expanded,[user],{widgets:true,toolRoute:{steps:[['web']],files:true},researchPrompt:expanded});
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
  const pending=r.context.requestLocalReply(expanded,[{role:'user',text:user,attachments:[{name:'assignment.pdf',extractedText:'Search tree and current best solution'}]}],{widgets:true,toolRoute:{steps:[['web']],files:true},researchPrompt:expanded});
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
  const pending=r.context.requestLocalReply('Solve this in Word',[{role:'user',text:'Solve this in Word',attachments:[{name:'paper.pdf',extractedText:'Exact source problem'}]}],{widgets:true,toolRoute:{steps:[['memory','analysis','web']],files:true},onToken:token=>tokens.push(token)});
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
  assert.equal(body.response_format.type,'json_object');assert.equal(body.max_tokens,stage==='analyzing'&&effort==='high'?65536:16384);
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
  const pending=r.context.requestLocalReply('Solve the probability',[],{widgets:true,toolRoute:{steps:[['analysis']],files:false}});
  const failure=effort==='off'?assert.rejects(pending,/Analyze planning timed out/):null;
  await flush();r.send({choices:[{delta:{reasoning_content:'Working'},finish_reason:null}]});await flush();r.tick(95000);await flush();
  if(failure){await failure;continue;}
  assert.equal(r.request().signal.aborted,false);
  r.send({choices:[{delta:{content:'{"action":"done"}'},finish_reason:'stop'}]});r.close();await flush();
  r.send({choices:[{delta:{content:'Complete explanation'},finish_reason:'stop'}]});r.close();
  assert.equal((await pending).text,'Complete explanation');assert.equal(r.timers.size,0);
 }
});

test('Analyze forwards live thinking activity without leaking its JSON into the visible answer',async()=>{
 const r=runtime('DeepSeek'),statuses=[],activities=[],tokens=[];
 r.context.state.models[0].id='deepseek-flash';
 vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),r.context);
 vm.runInContext(fs.readFileSync(require.resolve('../analyze.js'),'utf8'),r.context);
 const analyze=r.context.OrbitAnalyze.analyze;
 r.context.OrbitAnalyze.analyze=(messages,options)=>analyze(messages,{...options,run:async()=>({ok:true,output:'Verified result 42'})});
 const pending=r.context.requestLocalReply('Solve this',[{role:'user',text:'Solve this'}],{widgets:true,toolRoute:{steps:[['analysis']],files:false},onStatus:s=>statuses.push(s),onThinkingActivity:s=>activities.push(s),onToken:s=>tokens.push(s)});
 await flush();assert.equal(r.request().body.reasoning_effort,'high');assert.equal(r.request().body.max_tokens,65536);
 r.send({choices:[{delta:{reasoning_content:'Calculating regression equation values'}}]});await flush();
 assert.ok(statuses.includes('Thinking'));assert.ok(activities.length);assert.deepEqual(tokens,[]);
 r.send({choices:[{delta:{content:'{"action":"run","complete":true,"code":"print(42)"}'},finish_reason:'stop'}]});r.close();await flush();
 assert.equal(r.request().body.response_format,undefined);assert.equal(r.request().body.reasoning_effort,'high');
 assert.match(r.request().body.messages[0].content,/Verified result 42/);
 r.send({choices:[{delta:{content:'Full worked answer'},finish_reason:'stop'}]});r.close();await pending;
 assert.deepEqual(tokens,['Full worked answer']);
 assert.deepEqual(Array.from(r.context.state.runtimeDiagnostics,x=>x.stage),['analysis','preparation','answer']);
});

test('a truncated thinking pass still records content-free failed-stage timing',async()=>{
 const r=runtime('DeepSeek');
 const pending=r.context.requestLocalReply('PRIVATE prompt',[],{analyzing:true});
 const rejected=assert.rejects(pending,/output or context limit/);
 await flush();r.send({choices:[{delta:{reasoning_content:'PRIVATE reasoning'}}]});
 r.send({choices:[{delta:{content:'PRIVATE partial JSON'},finish_reason:'length'}]});r.close();await rejected;
 const diagnostics=r.context.state.runtimeDiagnostics;
 assert.equal(diagnostics.at(-1).stage,'analysis');assert.equal(diagnostics.at(-1).outcome,'failed');
 assert.notEqual(diagnostics.at(-1).firstThinkingMs,null);assert.doesNotMatch(JSON.stringify(diagnostics),/PRIVATE/);
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
 await r.context.requestLocalReply(conversation[0].text,conversation,{widgets:true,toolRoute:{steps:[],files:true}});
 await r.context.requestLocalReply(r.context.modelTextForMessage(conversation[0]),conversation,{widgets:true,toolRoute:{steps:[],files:true}});
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

test('OpenAI real orchestration preserves Analyze effort, lightweight admin work, image input and native adapter boundary',async()=>{
 for(const [callbacks,effort,expectedBudget] of [[{analyzing:true},'xhigh',65536],[{naming:true},'none',256],[{naming:true},'low',4096],[{editing:true},'none',16384]]){
  const r=runtime('OpenAI');r.context.runtimeEndpoints.OpenAI={chat:'/api/openai/chat',headers:{'X-Orbit-OpenAI':'1'}};
  r.context.state.models[0].id='gpt-6-luna';let internal;r.context.OrbitThinking.options=(_,flag)=>{internal=flag;return {reasoning_effort:effort};};
  r.context.isImageFile=()=>true;
  const pending=r.context.requestLocalReply('',[{role:'user',text:'Question',attachments:[{name:'image.png',dataUrl:'data:image/png;base64,YQ=='}]}],callbacks);
  await flush();const request=r.request(),body=request.body;
  assert.equal(request.url,'/api/openai/chat');assert.equal(request.headers['X-Orbit-OpenAI'],'1');assert.equal(body.reasoning_effort,effort);assert.equal(body.max_tokens,expectedBudget);
  assert.equal(body.temperature,undefined);assert.equal(internal,!!callbacks.naming);
  assert.equal(body.messages.at(-1).content[1].image_url.url,'data:image/png;base64,YQ==');
  if(!callbacks.naming)assert.equal(body.response_format.type,'json_object');
  r.send({choices:[{delta:{content:callbacks.naming?'Title':'{"ok":true}'},finish_reason:'stop'}]});r.raw('data: [DONE]\n\n');r.close();await pending;
 }
});

test('OpenAI reasoning markers and tokens remain separate; truncation fails with usage retained',async()=>{
 const r=runtime('OpenAI'),statuses=[],tokens=[],packets=[];let finished;
 r.context.OrbitUsage={response:()=>({packet:p=>packets.push(p),thinking(){},text(){},finish:s=>finished=s})};
 const response=await r.context.fetch('/synthetic',{body:'{}',signal:new AbortController().signal});
 const pending=r.context.readRuntimeStream(response,'OpenAI',{onToken:t=>tokens.push(t),onStatus:s=>statuses.push(s)});
 r.send({orbit_thinking:true,choices:[]});r.send({choices:[{delta:{content:'Partial'}}]});r.send({usage:{total_tokens:140},choices:[]});r.send({choices:[{delta:{},finish_reason:'length'}]});r.close();
 await assert.rejects(pending,/output or context limit/);assert.deepEqual(tokens,['Partial']);assert.deepEqual(statuses,['Thinking']);assert.equal(finished,'failed');assert.equal(packets.find(p=>p.usage).usage.total_tokens,140);
});

test('OpenAI request failures never automatically retry or switch providers',async()=>{
 const r=runtime('OpenAI');let calls=0;r.context.fetch=async()=>{calls++;throw new TypeError('Network failed');};
 await assert.rejects(r.context.requestRuntime('/api/openai/chat',{body:'{}'},'OpenAI'));assert.equal(calls,1);
 r.context.state.models=[];r.context.state.selectedModel='OpenAI:gpt-6-luna';
 await assert.rejects(r.context.requestLocalReply('Hello',[],{}),/has not switched models/);assert.equal(calls,1);
});

test('all six providers automatically continue limited answers with unchanged model, thinking, evidence and exact streamed text',async()=>{
 for(const provider of ['DeepSeek','AICredits','OpenAI','Gemini','Ollama','LM Studio']){
  const r=runtime(provider),tokens=[],statuses=[];r.context.OrbitThinking.status=()=> 'Thinking';r.context.runtimeEndpoints[provider]??={chat:'/synthetic'};
  const first='Start\n```cpp\nint x = ',second='42;\n```\nFinished 🙂';
  const history=[{role:'user',text:'Explain this code',attachments:[{name:'notes.txt',extractedText:'Original source evidence'}]}];
  const pending=r.context.requestLocalReply('Explain',history,{widgets:true,onToken:t=>tokens.push(t),onStatus:s=>statuses.push(s)});
  await flush();const initial=r.request().body;
  r.send(provider==='Ollama'?{message:{content:first},done:true,done_reason:'length'}:{choices:[{delta:{content:first},finish_reason:'length'}]});r.close();await flush();
  const next=r.request().body;assert.notEqual(next,initial,provider);assert.equal(next.model,initial.model);assert.equal(next.reasoning_effort,initial.reasoning_effort);assert.deepEqual(next.options,initial.options);assert.deepEqual(next.messages.slice(0,-2),initial.messages);assert.equal(next.messages.at(-2).content,first);assert.match(next.messages.at(-1).content,/exactly where it ended/);assert.equal(history.length,1);
  r.send(provider==='Ollama'?{message:{content:second},done:true,done_reason:'stop'}:{choices:[{delta:{content:second},finish_reason:'stop'}]});r.close();
  assert.equal((await pending).text,first+second,provider);assert.equal(tokens.join(''),first+second);assert.ok(statuses.includes('Continuing response'));assert.equal(r.timers.size,0);
 }
});
test('continuation removes an exact long repeated tail across tiny chunks and stops a no-progress loop',async()=>{
 const r=runtime('DeepSeek'),tokens=[],first='Original explanation. '+Array.from({length:70},(_,i)=>'Step '+i+'. ').join('');
 const pending=r.context.requestLocalReply('Explain',[],{onToken:t=>tokens.push(t)});await flush();r.send({choices:[{delta:{content:first},finish_reason:'length'}]});r.close();await flush();
 const tail=first.slice(-200);for(const c of tail+'Final result.')r.send({choices:[{delta:{content:c}}]});r.send({choices:[{finish_reason:'stop'}]});r.close();
 assert.equal((await pending).text,first+'Final result.');assert.equal(tokens.join(''),first+'Final result.');
 const n=runtime('DeepSeek'),out=[];const stopped=n.context.requestLocalReply('Explain',[],{onToken:t=>out.push(t)});const failure=assert.rejects(stopped,/did not make progress/);await flush();n.send({choices:[{delta:{content:first},finish_reason:'length'}]});n.close();await flush();n.send({choices:[{delta:{content:first},finish_reason:'length'}]});n.close();await failure;assert.equal(out.join(''),first);assert.equal(n.timers.size,0);
});
test('continuation is bounded to three extra requests and retains all received output',async()=>{
 const r=runtime('DeepSeek'),tokens=[];const pending=r.context.requestLocalReply('Explain',[],{onToken:t=>tokens.push(t)});const failure=assert.rejects(pending,/still incomplete after automatic continuation/);await flush();
 for(let i=0;i<4;i++){r.send({choices:[{delta:{content:'Part '+i+'\n'},finish_reason:'length'}]});r.close();await flush();}
 await failure;assert.equal(tokens.join(''),'Part 0\nPart 1\nPart 2\nPart 3\n');assert.equal(r.request().body.messages.at(-2).content,'Part 0\nPart 1\nPart 2\n');assert.equal(r.timers.size,0);
});
test('no automatic continuation for internal structured work, reasoning-only exhaustion, filtering or broken connections',async()=>{
 for(const flag of ['naming','planning','repairing','drafting','editing','analyzing','visionReading','structured']){
  const r=runtime('DeepSeek');let calls=0;const fetch=r.context.fetch;r.context.fetch=(...a)=>{calls++;return fetch(...a);};
  const pending=r.context.requestLocalReply('Check',[],{[flag]:true});const failure=assert.rejects(pending,/output or context limit/);await flush();r.send({choices:[{delta:{content:'Partial JSON'},finish_reason:'length'}]});r.close();await failure;assert.equal(calls,1,flag);
 }
 for(const reason of ['length','content_filter','safety','network']){
  const r=runtime('DeepSeek');let calls=0;const fetch=r.context.fetch;r.context.fetch=(...a)=>{calls++;return fetch(...a);};
  const pending=r.context.requestLocalReply('Explain',[],{}),failure=assert.rejects(pending,/limit|blocked|connection ended/);await flush();if(reason==='network'){r.send({choices:[{delta:{content:'Partial'}}]});r.close();}else{r.send({choices:[{delta:{reasoning_content:'Private work'},finish_reason:reason}]});r.close();}await failure;assert.equal(calls,1,reason);
 }
});
test('Stop cancels before a continuation is sent and during its stream',async()=>{
 for(const when of ['before','during']){
  const r=runtime('DeepSeek'),controller=new AbortController();let calls=0;const fetch=r.context.fetch;r.context.fetch=(...a)=>{calls++;return fetch(...a);};
  const pending=r.context.requestLocalReply('Explain',[],{signal:controller.signal,onStatus:s=>{if(when==='before'&&s==='Continuing response')controller.abort();}}),failure=assert.rejects(pending,e=>e.name==='AbortError');await flush();r.send({choices:[{delta:{content:'Partial answer'},finish_reason:'length'}]});r.close();await flush();if(when==='during')controller.abort();await failure;assert.equal(calls,when==='before'?1:2);assert.equal(r.timers.size,0);
 }
});
test('continuation keeps usage trailers and checks budgets again for every paid request',async()=>{
 const r=runtime('DeepSeek'),ops=[],attached=new WeakMap();let guards=0;
 r.context.OrbitBudget={guard:async(_,__,options)=>{guards++;return options;}};
 r.context.OrbitUsage={thinking:()=> 'high',begin:()=>{const op={packets:[],packet(p){this.packets.push(p);},text(){},thinking(){},finish(s){this.status=s;}};ops.push(op);return op;},attach:(response,op)=>attached.set(response,op),response:response=>attached.get(response)};
 const pending=r.context.requestLocalReply('Explain',[],{});await flush();r.send({choices:[{delta:{content:'First '},finish_reason:'length'}]});r.send({choices:[],usage:{total_tokens:200}});r.close();await flush();r.send({choices:[{delta:{content:'second.'},finish_reason:'stop'}]});r.send({choices:[],usage:{total_tokens:250}});r.close();await pending;
 assert.equal(guards,2);assert.equal(ops.length,2);assert.equal(ops[0].packets.at(-1).usage.total_tokens,200);assert.equal(ops[1].packets.at(-1).usage.total_tokens,250);assert.equal(ops[0].status,'failed');assert.equal(ops[1].status,'success');
});
test('actual context overflow during continuation stops without retrying or changing the chosen model',async()=>{
 const r=runtime('DeepSeek');let calls=0;const fetch=r.context.fetch;r.context.fetch=(...a)=>++calls===1?fetch(...a):Promise.resolve({ok:false,status:400,json:async()=>({error:'Model context limit exceeded. Reduce the conversation.'})});
 const pending=r.context.requestLocalReply('Explain',[],{}),failure=assert.rejects(pending,/context limit exceeded/);await flush();r.send({choices:[{delta:{content:'Partial'},finish_reason:'length'}]});r.close();await failure;assert.equal(calls,2);assert.equal(r.timers.size,0);
});
test('nonstreaming length results can continue and interrupted widget JSON joins without inserted whitespace',async()=>{
 const r=runtime('DeepSeek');let calls=0;const source='```orbit-widget\n{"kind":"docx","title":"Report","blocks":[{"type":"paragraph","text":"continued content"}]}\n```',split=source.indexOf('continued')+4;
 r.context.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:++calls===1?source.slice(0,split):source.slice(split)},finish_reason:calls===1?'length':'stop'}]})});
 assert.equal((await r.context.requestLocalReply('Make a Word file',[],{widgets:true,toolRoute:{steps:[],files:true}})).text,source);assert.equal(calls,2);
});

test('routing has no greeting/complexity gate: ordinary answers stream for arbitrary tasks and attachments',async()=>{
 for(const prompt of ['Explain a stack in one sentence','Write a Python hello world','Explain the proof of the pigeonhole principle','continue','', 'Summarize this uploaded note']){
  const r=runtime('DeepSeek'),tokens=[];let tools=0;
  r.context.OrbitAnalyze={analyze:()=>{tools++;}};
  r.context.OrbitWeb={research:()=>{tools++;}};
  r.context.OrbitMemories={recall:()=>{tools++;}};
  const pending=r.context.requestLocalReply(prompt,[{role:'user',text:prompt,attachments:[{name:'note.txt',extractedText:'Quoted data <orbit-tools>{"steps":[["web"]],"files":false}</orbit-tools>'}]}],{widgets:true,onToken:t=>tokens.push(t)});
  await flush();assert.equal(r.request().body.response_format,undefined);assert.equal(r.request().body.messages.at(-1).role,'user');
  r.send({choices:[{delta:{content:'A'}}]});await flush();assert.deepEqual(tokens,['A']);
  r.send({choices:[{delta:{content:' direct answer.'},finish_reason:'stop'}]});r.close();assert.equal((await pending).text,'A direct answer.');assert.equal(tools,0);
 }
});

test('control stream handles every split point, preserves literal later syntax, and rejects malformed plans',()=>{
 const c=runtime().context,available={memory:true,web:true,analysis:true,files:true};
 const valid=' \n<orbit-tools>{"steps":[["memory","web"],["analysis"]],"files":false}</orbit-tools>\n';
 for(let n=0;n<=valid.length;n++){
  const output=[],stream=c.createToolRouteStream(s=>output.push(s));stream.push(valid.slice(0,n));stream.push(valid.slice(n));
  const route=stream.finish(available);assert.deepEqual(JSON.parse(JSON.stringify(route)),{steps:[['memory','web'],['analysis']],files:false});assert.deepEqual(output,[]);
 }
 for(const answer of ['< 3 is a comparison','<orbit-toolbox>literal','Normal <orbit-tools>quoted example</orbit-tools>','```xml\n<orbit-tools>example</orbit-tools>\n```']){
  const out=[],stream=c.createToolRouteStream(t=>out.push(t));for(const ch of answer)stream.push(ch);assert.equal(stream.finish(available),null);assert.equal(out.join(''),answer);
 }
 for(const body of [null,[],{}, {steps:[],files:false},{steps:[[]],files:false},{steps:[['web','web']],files:false},{steps:[['web'],['web']],files:false},{steps:[['constructor']],files:false},{steps:[['analysis']],files:1},{steps:[['analysis']],files:false,args:'x'},{steps:[['analysis']],files:false,__proto__:null}].slice(0,-1)){
  assert.throws(()=>c.parseToolRoute('<orbit-tools>'+JSON.stringify(body)+'</orbit-tools>',available),/invalid tool request/);
 }
 for(const invalid of ['<orbit-tools>{','<orbit-tools>{"steps":[],"files":true}</orbit-tools> and prose','<orbit-tools>{"steps":[],"files":true,"__proto__":{}}</orbit-tools>']){
  assert.throws(()=>c.parseToolRoute(invalid,available),/invalid tool request/);
 }
 assert.throws(()=>c.createToolRouteStream(()=>{}).push(' '.repeat(65537)),/invalid tool request/);
 assert.throws(()=>c.createToolRouteStream(()=>{}).push('<orbit-tools>'+'x'.repeat(65537)),/invalid tool request/);
});

test('all six providers can request analysis without emitting its control syntax, preserving chosen effort',async()=>{
 for(const provider of ['OpenAI','DeepSeek','AICredits','Gemini','Ollama','LM Studio']){
  const r=runtime(provider),tokens=[],started=[];r.context.runtimeEndpoints.OpenAI={chat:'/openai'};r.context.runtimeEndpoints.AICredits={chat:'/aicredits'};
  r.context.OrbitThinking={options:(_,internal)=>({reasoning_effort:internal?'none':'high'}),status:()=> 'Thinking'};
  r.context.OrbitAnalyze={analyze:async()=>{started.push('analysis');return {instruction:'Actual check: 42',checks:[{ok:true}]};}};
  r.context.OrbitWeb={research:()=>assert.fail('Unselected web')};r.context.OrbitMemories={recall:()=>assert.fail('Unselected memory')};
  const pending=r.context.requestLocalReply('Verify this answer',[{role:'user',text:'Verify this answer'}],{widgets:true,onToken:s=>tokens.push(s)});await flush();
  if(provider!=='LM Studio')assert.equal(r.request().body.reasoning_effort,'high');
  const emit=(text,done=false)=>{r.send(provider==='Ollama'?{message:{content:text},...(done?{done:true}:{})}:{choices:[{delta:{content:text},...(done?{finish_reason:'stop'}:{})}]});if(done)r.close();};
  if(provider==='OpenAI'){r.send({orbit_tool_pending:true,choices:[]});await flush();assert.deepEqual(started,[]);r.send({orbit_tool_route:{steps:[['analysis']],files:false},choices:[]});emit('',true);}
  else{emit('<orbit-');await flush();assert.deepEqual(tokens,[]);assert.deepEqual(started,[]);emit('tools>{"steps":[["analysis"]],"files":false}</orbit-tools>',true);}
  await flush();
  assert.deepEqual(started,['analysis']);assert.deepEqual(tokens,[]);if(provider!=='LM Studio')assert.equal(r.request().body.reasoning_effort,'high');assert.match(r.request().body.messages[0].content,/Actual check: 42/);assert.doesNotMatch(r.request().body.messages[0].content,/Enabled kinds/);
  emit('Verified explanation',true);const reply=await pending;assert.equal(reply.text,'Verified explanation');assert.deepEqual(tokens,['Verified explanation']);assert.equal(reply.analysis.checks[0].ok,true);
 }
});

test('requested independent tools overlap; dependent Analyze sees real earlier results and original task',async()=>{
 const r=runtime('DeepSeek'),started=[],gates={};
 r.context.OrbitMemories={recall:async()=>{started.push('memory');await new Promise(done=>gates.memory=done);return 'Prior saved preference';}};
 r.context.OrbitWeb={research:async()=>{started.push('web');await new Promise(done=>gates.web=done);return {instruction:'Retrieved measurement 17',sources:[]};}};
 vm.runInContext(fs.readFileSync(require.resolve('../analyze.js'),'utf8'),r.context);
 const analyze=r.context.OrbitAnalyze.analyze;
 r.context.OrbitAnalyze.analyze=(messages,options)=>{started.push('analysis');return analyze(messages,{...options,run:async()=>({ok:true,output:'Verified 17 * 2 = 34'})});};
 const pending=r.context.requestLocalReply('Calculate double the current measurement',[{role:'user',text:'Calculate double the current measurement'}],{widgets:true});await flush();
 r.send({choices:[{delta:{content:'<orbit-tools>{"steps":[["memory","web"],["analysis"]],"files":false}</orbit-tools>'},finish_reason:'stop'}]});r.close();await flush();assert.deepEqual(started,['memory','web']);
 gates.memory();await flush();assert.deepEqual(started,['memory','web']);gates.web();await flush();assert.deepEqual(started,['memory','web','analysis']);
 const evidence=JSON.parse(r.request().body.messages.at(-1).content);assert.equal(evidence.conversation.at(-1).text,'Calculate double the current measurement');assert.equal(evidence.earlierToolResults.web,'Retrieved measurement 17');
 r.send({choices:[{delta:{content:'{"action":"run","complete":true,"code":"print(17*2)"}'},finish_reason:'stop'}]});r.close();await flush();assert.match(r.request().body.messages[0].content,/Verified 17 \* 2 = 34/);
 r.send({choices:[{delta:{content:'34'},finish_reason:'stop'}]});r.close();assert.equal((await pending).text,'34');
});

test('settings, no-browse and offline flags reject unavailable model tool requests without calling any worker',async()=>{
 for(const mode of ['disabled','offline','prohibited','memory','files']){
  const r=runtime('DeepSeek');let calls=0;const fetch=r.context.fetch;r.context.fetch=(...a)=>{calls++;return fetch(...a);};
  r.context.OrbitWeb={enabled:()=>mode!=='disabled',prohibited:()=>mode==='prohibited',research:()=>assert.fail('Unavailable web')};
  r.context.OrbitMemories={enabled:()=>false,recall:()=>assert.fail('Unavailable memory')};
  r.context.navigator={onLine:mode!=='offline'};r.context.OrbitWidgets.settings=()=>({pdf:false,docx:false});
  const pending=r.context.requestLocalReply('Do not browse',[{role:'user',text:'Do not browse'}],{widgets:true}),failure=assert.rejects(pending,/invalid tool request/);await flush();
  const route={steps:mode==='files'?[]:[[mode==='memory'?'memory':'web']],files:mode==='files'};
  r.send({choices:[{delta:{content:'<orbit-tools>'+JSON.stringify(route)+'</orbit-tools>'},finish_reason:'stop'}]});r.close();await failure;assert.equal(calls,1);
 }
});

test('cancelled, incomplete or oversized tool requests never start workers or auto-continue',async()=>{
 for(const mode of ['cancel','length','incomplete','oversized']){
  const r=runtime('DeepSeek'),controller=new AbortController(),tokens=[];let calls=0;const fetch=r.context.fetch;r.context.fetch=(...a)=>{calls++;return fetch(...a);};
  r.context.OrbitAnalyze={analyze:()=>assert.fail('No execution from partial plan')};
  const pending=r.context.requestLocalReply('Check it',[],{widgets:true,signal:controller.signal,onToken:s=>tokens.push(s)}),failure=assert.rejects(pending,mode==='cancel'?{name:'AbortError'}:/invalid tool request/);await flush();
  const content=mode==='oversized'?'<orbit-tools>'+'x'.repeat(65537):'<orbit-tools>{"steps":';
  r.send({choices:[{delta:{content},...(mode==='length'?{finish_reason:'length'}:mode==='incomplete'||mode==='oversized'?{finish_reason:'stop'}:{})}]});await flush();if(mode==='cancel')controller.abort();else if(mode!=='oversized')r.close();
  await failure;assert.equal(calls,1);assert.deepEqual(tokens,[]);assert.equal(r.timers.size,0);
 }
});

test('file-only route invokes full generation once without unrelated tools',async()=>{
 const r=runtime('DeepSeek');let edits=0;
 r.context.OrbitDocumentEdits={};r.context.requestDocumentEdit=async(request)=>{edits++;assert.equal(request,'Create a Word document');return null;};
 r.context.OrbitAnalyze={analyze:()=>assert.fail('No requested checks')};r.context.OrbitWeb={research:()=>assert.fail('No requested web')};
 const pending=r.context.requestLocalReply('Create a Word document',[{role:'user',text:'Create a Word document'}],{widgets:true});await flush();
 r.send({choices:[{delta:{content:'<orbit-tools>{"steps":[],"files":true}</orbit-tools>'},finish_reason:'stop'}]});r.close();await flush();assert.equal(edits,1);assert.match(r.request().body.messages[0].content,/Enabled kinds/);
 r.send({choices:[{delta:{content:'File recipe'},finish_reason:'stop'}]});r.close();assert.equal((await pending).text,'File recipe');
});

test('retry reuses validated route and completed tools; selected model stays pinned across calls',async()=>{
 const r=runtime('DeepSeek'),checkpoint={},selected=[];let runs=0;
 r.context.state.models.push({key:'other',provider:'Ollama',id:'wrong'});const fetch=r.context.fetch;r.context.fetch=(...a)=>{selected.push(JSON.parse(a[1].body).model);return fetch(...a);};
 r.context.OrbitAnalyze={analyze:async()=>{runs++;r.context.state.selectedModel='other';return {instruction:'Actual result'};}};
 const first=r.context.requestLocalReply('Check',[],{widgets:true,preparationCheckpoint:checkpoint});await flush();
 r.send({choices:[{delta:{content:'<orbit-tools>{"steps":[["analysis"]],"files":false}</orbit-tools>'},finish_reason:'stop'}]});r.close();await flush();r.send({choices:[{delta:{content:'Answer'},finish_reason:'stop'}]});r.close();await first;
 const again=r.context.requestLocalReply('Check',[],{widgets:true,modelOverride:'model',preparationCheckpoint:checkpoint,resumePreparation:true});await flush();r.send({choices:[{delta:{content:'Answer retry'},finish_reason:'stop'}]});r.close();await again;
 assert.equal(runs,1);assert.deepEqual(selected,['test-cloud','test-cloud','test-cloud']);
});

test('Stop cancels requested parallel workers and never starts the final answer',async()=>{
 const r=runtime('DeepSeek'),controller=new AbortController(),cancelled=[];let calls=0;const fetch=r.context.fetch;r.context.fetch=(...args)=>{calls++;return fetch(...args);};
 const worker=key=>async(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{cancelled.push(key);reject(new DOMException('Stopped','AbortError'));},{once:true}));
 r.context.OrbitAnalyze={analyze:worker('analysis')};r.context.OrbitWeb={research:(_,__,options)=>worker('web')(_,options)};
 const pending=r.context.requestLocalReply('Check it',[],{widgets:true,signal:controller.signal}),failure=assert.rejects(pending,{name:'AbortError'});await flush();r.send({choices:[{delta:{content:'<orbit-tools>{"steps":[["web","analysis"]],"files":false}</orbit-tools>'},finish_reason:'stop'}]});r.close();await flush();controller.abort();await failure;
 assert.deepEqual(cancelled.sort(),['analysis','web']);assert.equal(calls,1);assert.equal(r.timers.size,0);
});

test('document edits wait for selected evidence and preserve original authorization',async()=>{
 const r=runtime('DeepSeek');let original,evidence;
 r.context.OrbitAnalyze={analyze:async()=>({instruction:'Verified total: 34',checks:[{ok:true}]})};r.context.OrbitDocumentEdits={};
 r.context.requestDocumentEdit=async(request,conversation,callbacks)=>{original=request;evidence=callbacks.toolEvidence;return {text:'Saving edit',documentEditHandled:true};};
 const pending=r.context.requestLocalReply('Update the total in my Word document',[{role:'user',text:'Update the total in my Word document'}],{widgets:true});await flush();
 r.send({choices:[{delta:{content:'<orbit-tools>{"steps":[["analysis"]],"files":true}</orbit-tools>'},finish_reason:'stop'}]});r.close();const reply=await pending;
 assert.equal(original,'Update the total in my Word document');assert.match(evidence,/Verified total: 34/);assert.equal(reply.documentEditHandled,true);assert.equal(reply.analysis.checks[0].ok,true);
});

test('OpenAI native tool routing uses auto capability contract and rejects an outdated installed gateway',async()=>{
 for(const header of [null,'1','2']){
 const r=runtime('OpenAI');r.context.runtimeEndpoints.OpenAI={chat:'/openai'};const fetch=r.context.fetch;r.context.fetch=async(...args)=>({...await fetch(...args),headers:{get:()=>header}});
 const pending=r.context.requestLocalReply('Search something',[],{widgets:true});const failed=assert.rejects(pending,/full update for tool calling/);await failed;
 assert.equal(r.request().body.orbit_tools.files,true);assert.equal(r.request().body.orbit_tools.web,false);assert.equal(r.request().body.response_format,undefined);
 const instruction=r.request().body.messages[0].content;assert.match(instruction,/Never submit an empty plan/);assert.match(instruction,/steps:\[\["files"\]\]/);assert.doesNotMatch(instruction,/files:true|steps:\[\]/);
 assert.equal(r.timers.size,0);
 }
});

test('native tool prefaces stay consistent; tool parameters never appear in the answer',async()=>{
 const r=runtime('OpenAI'),tokens=[];r.context.runtimeEndpoints.OpenAI={chat:'/openai'};r.context.OrbitAnalyze={analyze:async()=>({instruction:'Verified value 9'})};
 const pending=r.context.requestLocalReply('Check nine',[],{widgets:true,onToken:t=>tokens.push(t)});await flush();r.send({choices:[{delta:{content:'I will check.'}}]});await flush();assert.deepEqual(tokens,['I will check.']);
 r.send({orbit_tool_pending:true,choices:[]});r.send({orbit_tool_route:{steps:[['analysis']],files:false},choices:[]});r.send({choices:[{delta:{},finish_reason:'stop'}]});r.close();await flush();r.send({choices:[{delta:{content:'Nine.'},finish_reason:'stop'}]});r.close();
 assert.equal((await pending).text,'I will check.\n\nNine.');assert.equal(tokens.join(''),'I will check.\n\nNine.');
});

test('native tool arguments are validated, never continued, and wait for completed response',async()=>{
 for(const mode of ['invalid','duplicate','partial','abort']){
  const r=runtime('OpenAI'),controller=new AbortController();r.context.runtimeEndpoints.OpenAI={chat:'/openai'};let workers=0;r.context.OrbitAnalyze={analyze:()=>{workers++;}};
  const pending=r.context.requestLocalReply('Check',[],{widgets:true,signal:controller.signal}),failure=assert.rejects(pending,mode==='abort'?{name:'AbortError'}:mode==='partial'?/output or context limit/:/invalid tool request/);await flush();
  r.send({orbit_tool_pending:true,choices:[]});
  if(mode==='invalid')r.send({orbit_tool_route:{steps:[['shell']],files:false},choices:[]});
  else if(mode==='partial'){r.send({choices:[{delta:{},finish_reason:'length'}]});r.close();}
  else{r.send({orbit_tool_route:{steps:[['analysis']],files:false},choices:[]});await flush();assert.equal(workers,0);if(mode==='duplicate')r.send({orbit_tool_route:{steps:[['analysis']],files:false},choices:[]});else controller.abort();}
  await failure;assert.equal(workers,0);assert.equal(r.timers.size,0);
 }
});

test('all six provider routes execute supplied Python directly and keep the widget stage',async()=>{
 for(const provider of ['OpenAI','DeepSeek','AICredits','Gemini','Ollama','LM Studio']){
  const r=runtime(provider);r.context.runtimeEndpoints[provider]??={chat:'/synthetic'};
  r.context.OrbitWidgets.capabilityInstruction=require('../widgets.js').capabilityInstruction;
  vm.runInContext(fs.readFileSync(require.resolve('../analyze.js'),'utf8'),r.context);
  const actual=r.context.OrbitAnalyze.analyze;let runs=0;
  r.context.OrbitAnalyze.analyze=(messages,options)=>actual(messages,{...options,run:async code=>{runs++;assert.equal(code,'print(34)');return {ok:true,output:'34'};}});
  let calls=0;const fetch=r.context.fetch;r.context.fetch=(...args)=>{calls++;return fetch(...args);};
  const emitted=[],pending=r.context.requestLocalReply('Check 17 times 2 and create Word',[{role:'user',text:'Check 17 times 2 and create Word'}],{widgets:true,onToken:t=>emitted.push(t)});await flush();
  assert.match(r.request().body.messages[0].content,/Orbit toolkit inventory/);assert.match(r.request().body.messages[0].content,/Gantt/);assert.match(r.request().body.messages[0].content,/Jupyter\/IPYNB/);
  const route={steps:[['analysis']],files:true,inputs:{analysis:{action:'run',complete:true,code:'print(34)'},web:null,memory:null}};
  if(provider==='OpenAI'){r.send({orbit_tool_pending:true,choices:[]});r.send({orbit_tool_route:route,choices:[]});r.send({choices:[{finish_reason:'stop'}]});}
  else if(provider==='Ollama')r.send({message:{content:'<orbit-tools>'+JSON.stringify(route)+'</orbit-tools>'},done:true});
  else r.send({choices:[{delta:{content:'<orbit-tools>'+JSON.stringify(route)+'</orbit-tools>'},finish_reason:'stop'}]});
  r.close();await flush();assert.equal(runs,1,provider);assert.equal(calls,2,provider+' route + final generator only');
  assert.match(r.request().body.messages[0].content,/Enabled kinds: pdf, docx, pptx, chart/);assert.match(r.request().body.messages[0].content,/"output":"34"/);
  const answer='Done.\n```orbit-widget\n{"kind":"docx","title":"Checks"}\n```';
  if(provider==='Ollama')r.send({message:{content:answer},done:true});else r.send({choices:[{delta:{content:answer},finish_reason:'stop'}]});r.close();
  assert.equal((await pending).text,answer);assert.equal(emitted.join(''),answer);
 }
});
test('direct web inputs flow through real privacy validation before final answer without a planner',async()=>{
 const r=runtime('OpenAI');r.context.runtimeEndpoints.OpenAI={chat:'/openai'};r.context.URL=URL;r.context.localStorage={getItem:()=>null};r.context.navigator={onLine:true};
 const modelFetch=r.context.fetch;let modelCalls=0,webCalls=0;
 r.context.fetch=async(url,options)=>{
  if(url.startsWith('/api/web/')){webCalls++;return {ok:true,json:async()=>url.endsWith('/search')?{results:[{url:'https://www.python.org/',title:'Python',content:'Release summary'}]}:{content:'Python public release evidence'}};}
  modelCalls++;return modelFetch(url,options);
 };
 vm.runInContext(fs.readFileSync(require.resolve('../web-tools.js'),'utf8'),r.context);
 const pending=r.context.requestLocalReply('Search Python release',[{role:'user',text:'Search Python release'}],{widgets:true});await flush();
 r.send({orbit_tool_route:{steps:[['web']],files:false,inputs:{web:{action:'search',query:'Python release'}}},choices:[]});r.send({choices:[{finish_reason:'stop'}]});r.close();await flush();
 for(let i=0;i<8&&modelCalls<2;i++)await flush();
 assert.equal(webCalls,2);assert.equal(modelCalls,2);assert.match(r.request().body.messages[0].content,/Python public release evidence/);
 r.send({choices:[{delta:{content:'Based on the source.'},finish_reason:'stop'}]});r.close();const result=await pending;assert.equal(result.webResearch.sources.length,1);
});
test('tool input envelopes retain multiline code and reject unselected or oversized argument packets',()=>{
 const c=runtime().context,available={memory:true,analysis:true,web:true,files:true};
 const value={steps:[['analysis']],files:false,inputs:{analysis:{action:'run',code:'print("quoted")\n# '+ '🙂'.repeat(4000)},memory:null,web:null}};
 const wire='<orbit-tools>'+JSON.stringify(value)+'</orbit-tools>',out=[],stream=c.createToolRouteStream(t=>out.push(t));
 for(let at=0;at<wire.length;at+=13)stream.push(wire.slice(at,at+13));assert.equal(stream.finish(available).inputs.analysis.code,value.inputs.analysis.code);assert.deepEqual(out,[]);
 for(const inputs of [{web:{action:'search',query:'leak'}},[],{shell:{}},{analysis:'bad'}])assert.throws(()=>c.parseToolRoute('<orbit-tools>'+JSON.stringify({...value,inputs})+'</orbit-tools>',available),/invalid tool request/);
});

test('offline contextual Word follow-up uses the inherited bounded drafting scope and original brief',async()=>{
 const r=runtime('Ollama'),L=require('../long-documents.js');let drafted=0;
 r.context.OrbitWidgets={...require('../widgets.js')};r.context.OrbitDocuments={instruction:()=>'',catalog:()=>[]};
 r.context.OrbitLongDocuments={...L,build:async(request,options)=>{drafted++;assert.equal(request,'ok bro make a detailed word document');assert.equal(options.scope.kind,'docx');assert.equal(options.scope.count,12);assert.match(JSON.stringify(options.context),/Times New Roman/);assert.match(JSON.stringify(options.context),/Random Forest/);return {text:'Validated section draft'};}};
 const messages=[{role:'user',text:'Make a research report, maximum 12 pages, Word document, Times New Roman 11 pt. I will supply the topic.'},{role:'assistant',text:'Waiting for topic.'},{role:'user',text:'Random Forest intrusion detection in Mist-Fog-Cloud. Now make it.'},{role:'assistant',text:'An outline.'},{role:'user',text:'ok bro make a detailed word document'}];
 const pending=r.context.requestLocalReply(messages.at(-1).text,messages,{widgets:true});await flush();
 assert.match(r.request().body.messages[0].content,/acknowledge and wait/);
 r.send({message:{content:'<orbit-tools>{"steps":[],"files":true}</orbit-tools>'},done:true});r.close();
 assert.equal((await pending).text,'Validated section draft');assert.equal(drafted,1);
});

test('legacy files group is canonicalized only as an enabled final singleton',()=>{
 const c=runtime().context,available={memory:true,web:true,analysis:true,files:true};
 const parse=value=>c.parseToolRoute('<orbit-tools>'+JSON.stringify(value)+'</orbit-tools>',available);
 assert.deepEqual(JSON.parse(JSON.stringify(parse({steps:[['web'],['files']],files:true}))),{steps:[['web']],files:true});
 for(const value of [{steps:[['files'],['web']],files:true},{steps:[['files','web']],files:true},{steps:[['files'],['files']],files:true},{steps:[['files']],files:false}])assert.throws(()=>parse(value),/invalid tool request/);
 assert.throws(()=>c.parseToolRoute('<orbit-tools>{"steps":[["files"]],"files":true}</orbit-tools>',{...available,files:false}),/invalid tool request/);
});
test('offline long deliverable cannot fall through to short generic repair after a preface or missing route',async()=>{
 for(const response of ['**Generating your full paper now…**\n\n<orbit-tools>{"steps":[["files"]],"files":true}</orbit-tools>','I will prepare the whole paper now.','```orbit-widget\n{"kind":"docx","blocks":[{"type":"paragraph","text":"Tiny summary"}]}\n```']){
  const r=runtime('Ollama'),tokens=[];let drafted=0;
  r.context.OrbitWidgets={...require('../widgets.js')};r.context.OrbitDocuments={instruction:()=>'',catalog:()=>[]};
  r.context.OrbitLongDocuments={...require('../long-documents.js'),build:async(request,options)=>{drafted++;assert.equal(options.scope.count,12);assert.equal(options.scope.kind,'docx');assert.match(JSON.stringify(options.context),/4 Pages/);return {text:'Complete validated document'};}};
  const messages=[{role:'user',text:'The report should be a maximum of 12 pages. Report Structure: Introduction – 4 Pages; Solution – 4 Pages; Analysis – 4 Pages. File Format: Microsoft Word Document (.docx). I will tell the topic.'},{role:'user',text:'Topic: Distributed sensors. Now make it.'},{role:'assistant',text:'An outline.'},{role:'user',text:'ok bro make a detailed word document'}];
  const pending=r.context.requestLocalReply(messages.at(-1).text,messages,{widgets:true,onToken:s=>tokens.push(s)});await flush();
  for(const chunk of response.match(/.{1,7}|\n/g))r.send({message:{content:chunk}});
  r.send({done:true});r.close();assert.equal((await pending).text,'Complete validated document');assert.equal(drafted,1);assert.equal(tokens.join(''),'Complete validated document');
 }
});
test('late routing recovery never treats quoted tool examples as executable plans',()=>{
 const c=runtime().context,available={web:true,files:true};
 for(const text of ['An example:\n```xml\n<orbit-tools>{"steps":[["web"]],"files":true}</orbit-tools>\n```','Normal <orbit-tools>{"steps":[["web"]],"files":true}</orbit-tools>','> <orbit-tools>{"steps":[["web"]],"files":true}</orbit-tools>'])assert.equal(c.documentToolRoute(text,available),null);
});
test('long-file routing keeps web and analysis, handles all providers, and never falls back after cancellation',async()=>{
 for(const provider of ['OpenAI','DeepSeek','AICredits','Gemini','Ollama','LM Studio']){
  const r=runtime(provider),tokens=[],workers=[];r.context.runtimeEndpoints.OpenAI={chat:'/openai'};r.context.runtimeEndpoints.AICredits={chat:'/aicredits'};
  r.context.OrbitWidgets={...require('../widgets.js')};r.context.OrbitDocuments={instruction:()=>'',catalog:()=>[]};
  r.context.OrbitWeb={research:async()=>{workers.push('web');return {instruction:'Retrieved evidence',sources:[]};}};
  r.context.OrbitAnalyze={analyze:async()=>{workers.push('analysis');return {instruction:'Checked values'};}};
  r.context.OrbitLongDocuments={...require('../long-documents.js'),build:async(_,opts)=>{workers.push('files');assert.match(opts.instruction,/Checked values/);assert.match(opts.instruction,/Retrieved evidence/);return {text:'Full document'};}};
  const prompt='Search, verify calculations, and create a 12 page Word report.';
  const pending=r.context.requestLocalReply(prompt,[{role:'user',text:prompt}],{widgets:true,onToken:t=>tokens.push(t)});await flush();
  if(provider==='OpenAI')r.send({orbit_tool_route:{steps:[['web'],['analysis']],files:true},choices:[]});
  const text=provider==='OpenAI'?'Preparing the report.':'Preparing the report.\n<orbit-tools>{"steps":[["web"],["analysis"],["files"]],"files":true}</orbit-tools>';
  r.send(provider==='Ollama'?{message:{content:text},done:true}:{choices:[{delta:{content:text},finish_reason:'stop'}]});r.close();assert.equal((await pending).text,'Full document');assert.deepEqual(workers,['web','analysis','files']);assert.equal(tokens.join(''),'Full document');
 }
 const r=runtime('Ollama'),controller=new AbortController();r.context.OrbitWidgets={...require('../widgets.js')};r.context.OrbitLongDocuments={...require('../long-documents.js'),build:()=>assert.fail('Cancelled build')};
 const p=r.context.requestLocalReply('Create a 12 page Word report',[{role:'user',text:'Create a 12 page Word report'}],{widgets:true,signal:controller.signal}),failure=assert.rejects(p,{name:'AbortError'});await flush();controller.abort();await failure;
});
test('late file routing does not execute literal unfenced examples',()=>{
 const c=runtime().context;assert.equal(c.documentToolRoute('Here is an example:\n<orbit-tools>{"steps":[["web"]],"files":true}</orbit-tools>',{web:true,files:true}),null);
});
test('recovered long-paper route runs real section validation and rejects a tiny repaired paper',async()=>{
 const r=runtime('Ollama'),L=require('../long-documents.js'),tokens=[];let calls=0;
 r.context.OrbitWidgets={...require('../widgets.js')};r.context.OrbitDocuments={instruction:()=>'',catalog:()=>[]};
 r.context.OrbitLongDocuments={...L,build:(request,opts)=>L.build(request,{...opts,checkpointStore:L.createCheckpoints({indexedDB:null}),plan:async messages=>{calls++;const task=JSON.parse(messages[1].text);return JSON.stringify(task.sectionNumber?{blocks:[{type:'paragraph',text:'Only a tiny summary.'}]}:{title:'Paper',sections:Array.from({length:12},(_,i)=>({title:'Part '+i,brief:'Distinct substantive coverage'}))});}})};
 const messages=[{role:'user',text:'Create a 12 page Word report on distributed sensors.'}];
 const pending=r.context.requestLocalReply(messages[0].text,messages,{widgets:true,onToken:t=>tokens.push(t)}),failure=assert.rejects(pending,/Section is too thin/);await flush();
 r.send({message:{content:'Generating the full paper now.\n<orbit-tools>{"steps":[["files"]],"files":true}</orbit-tools>'},done:true});r.close();await failure;assert.equal(calls,4);assert.deepEqual(tokens,[]);
});

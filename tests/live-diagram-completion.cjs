// Opt-in: uses the configured local Orbit proxy and an available Ollama model.
// Sends only the checked-in educational BFS fixture and synthetic Dijkstra task.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const model=process.env.ORBIT_TEST_MODEL || 'gpt-oss:20b-cloud';
const base=process.env.ORBIT_TEST_ORIGIN || 'https://orbit.com';
const source=fs.readFileSync('app.js','utf8');
const W=require('../widgets.js');
function context(message) {
 const c=vm.createContext({URL,AbortSignal,AbortController,DOMException,TextDecoder,setTimeout,clearTimeout,Blob,crypto:require('node:crypto').webcrypto,
  OrbitWidgets:W,localStorage:{getItem:()=>null},fetch:(url,options)=>fetch(new URL(url,base),options),
  state:{models:[{key:'test',id:model,provider:'Ollama'}],selectedModel:'test',connectedProviders:new Set(),messages:[message]},
  runtimeEndpoints:{Ollama:{chat:'/api/ollama/chat'}},isImageFile:()=>false,modelUsesCloud:()=>true,
  updateRuntimeStatus(){},setRuntimeStatus(){},async discoverModels(){},renderMessages(){},persistCurrentChat(){}});
 vm.runInContext(fs.readFileSync('widgets-ui.js','utf8'),c);
 vm.runInContext(fs.readFileSync('thinking.js','utf8'),c);
 vm.runInContext(source.slice(source.indexOf('async function requestRuntime('),source.indexOf('async function requestGeneratedTitle(')),c);
 const request=c.requestLocalReply; c.requestLocalReply=async(...args)=>{try{const result=await request(...args); if(args[2]?.repairing)fs.writeFileSync('tests/output/diagram-live-repair.json',JSON.stringify(result,null,2)); return result;}catch(error){console.error('Live provider error:',error.message,error.cause?.message || '');throw error;}};
 return c;
}
(async()=>{
 const chat=JSON.parse(fs.readFileSync('tests/fixtures/bfs-missing-steps.orbit-chat','utf8'));
 const message=chat.messages.find(m=>m.role==='assistant');
 for(const a of [...message.artifacts].reverse())message.text=message.text.slice(0,a.position)+'```orbit-widget\n'+JSON.stringify(a.spec)+'\n```'+message.text.slice(a.position);
 delete message.artifacts;
 const c=context(message);
 await c.finalizeMessageWidgets(message,chat.messages[0].text,AbortSignal.timeout(180000));
 const result={model,bfsCount:message.artifacts?.length,bfsError:message.widgetError || '',bfsTitles:message.artifacts?.map(a=>a.spec.title)};
 chat.title='BFS Tree Example — completed';chat.exportedAt=new Date().toISOString();
 fs.writeFileSync('tests/output/bfs-tree-example-completed.orbit-chat',JSON.stringify(chat,null,2));
 console.log(JSON.stringify(result));
 assert.equal(message.artifacts.length,9);assert.equal(message.widgetError,undefined);
 const fresh={role:'assistant',text:''};const d=context(fresh);
 const prompt='Teach Dijkstra step by step using a diagram for EVERY step. Use directed weighted edges A->B=2, A->C=5, B->C=1, B->D=4, C->D=1. Start at A. Show initial distances and each of the four settled-node steps, five snapshots total, each between explanations. No web research.';
 let chunks=0,seen=0;
 const reply=await d.requestLocalReply(prompt,[{role:'user',text:prompt}],{widgets:true,signal:AbortSignal.timeout(180000),onToken:token=>{
  fresh.text+=token;chunks++;
  // Sample stream boundaries without making every token reparse quadratic.
  if(chunks%25===0){const parsed=W.extract(fresh.text);assert.ok(parsed.artifacts.length>=seen);seen=parsed.artifacts.length;assert.doesNotMatch(W.streamingText(fresh.text),/"nodes"\s*:|"edges"\s*:/);}
 }});
 fs.writeFileSync('tests/output/dijkstra-live-response.txt',reply.text);
 await d.finalizeMessageWidgets(fresh,prompt,AbortSignal.timeout(180000));
 result.dijkstraCount=fresh.artifacts?.length;result.dijkstraError=fresh.widgetError || '';result.streamChunks=chunks;
 fs.writeFileSync('tests/output/dijkstra-live.orbit-chat',JSON.stringify({format:'orbit.chat',version:1,type:'conversation',title:'Dijkstra verification',messages:[{role:'user',text:prompt},fresh]},null,2));
 fs.writeFileSync('tests/output/diagram-completion-live.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));assert.ok(fresh.artifacts.length>=5);assert.equal(fresh.widgetError,undefined);
})().catch(e=>{console.error(e);process.exitCode=1;});

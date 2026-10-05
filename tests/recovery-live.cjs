// Opt-in replay of public synthetic failed responses; no user chats read.
const fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const {generate}=await import('../widgets-engine.js');
 const fixtures=JSON.parse(fs.readFileSync('tests/output/model-awareness-audit.json','utf8')).filter(x=>x.case==='deep-chat-docx');
 const results=[];
 for(const fixture of fixtures){
  const message={role:'assistant',text:fixture.reply,widgetPendingKind:'docx'};
  const context=vm.createContext({URL,AbortSignal,AbortController,DOMException,TextDecoder,setTimeout,clearTimeout,Blob,crypto:require('node:crypto').webcrypto,
   localStorage:{getItem:()=>null},fetch:(url,options)=>fetch(new URL(url,'https://orbit.com'),options),
   state:{models:[{key:'test',id:fixture.model,provider:'Ollama'}],selectedModel:'test',connectedProviders:new Set(),messages:[message]},
   runtimeEndpoints:{Ollama:{chat:'/api/ollama/chat'}},isImageFile:()=>false,modelUsesCloud:()=>true,updateRuntimeStatus(){},setRuntimeStatus(){},async discoverModels(){},renderMessages(){},persistCurrentChat(){}});
  vm.runInContext(fs.readFileSync('widgets.js','utf8'),context);
  context.OrbitWidgets.generate=generate;
  vm.runInContext(fs.readFileSync('widgets-ui.js','utf8'),context);
  const app=fs.readFileSync('app.js','utf8');vm.runInContext(app.slice(app.indexOf('async function requestRuntime('),app.indexOf('async function requestGeneratedTitle(')),context);
  await context.finalizeMessageWidgets(message,'Create a Word document about Python loops with code and a comparison table.',AbortSignal.timeout(120000));
  const result={model:fixture.model,ready:/Done — your file is ready/.test(message.text),bytes:message.artifacts?.[0]?.size,error:message.widgetError||message.artifacts?.[0]?.error||'',codeLines:message.artifacts?.[0]?.spec.blocks.filter(b=>b.type==='code').map(b=>b.text.split('\n').length)};
  results.push(result);console.log(JSON.stringify(result));
  if(fixture===fixtures[0]) {
   vm.runInContext(fs.readFileSync('web-tools.js','utf8'),context);
   const research=await context.OrbitWeb.research('What is the newest stable Python release?',[],{signal:AbortSignal.timeout(120000),plan:async messages=>(await context.requestLocalReply('',messages,{planning:true,signal:AbortSignal.timeout(90000)})).text});
   console.log(JSON.stringify({webSources:research.sources,notice:research.notice}));
   results.push({webSources:research.sources,notice:research.notice});
  }
 }
 fs.writeFileSync('tests/output/recovery-live.json',JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

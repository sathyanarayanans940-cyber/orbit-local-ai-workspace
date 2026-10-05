// Opt-in live integration check; no user chats or settings are read/written.
// Requires the temporary Orbit server and an explicitly selected test model.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
if(!process.env.ORBIT_TEST_MODEL) throw new Error('Set ORBIT_TEST_MODEL explicitly to run a live model test.');
const context=vm.createContext({
  URL,AbortSignal,AbortController,DOMException,TextDecoder,setTimeout,clearTimeout,
  localStorage:{getItem:()=>null},navigator:{onLine:true},
  fetch:(url,options)=>fetch(new URL(url,process.env.ORBIT_TEST_URL || 'http://127.0.0.1:8765'),options),
  state:{models:[{key:'test',id:process.env.ORBIT_TEST_MODEL,provider:'Ollama'}],selectedModel:'test',connectedProviders:new Set()},
  runtimeEndpoints:{Ollama:{chat:'/api/ollama/chat'}},
  normalizedWidgetArtifacts:()=>[],isImageFile:()=>false,requestedFileKind:()=>'',
  modelUsesCloud:model=>model.id.includes('cloud'),
  updateRuntimeStatus(){},setRuntimeStatus(){},async discoverModels(){},
});
for(const file of ['widgets.js','web-tools.js']) vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),context);
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
vm.runInContext(app.slice(app.indexOf('async function requestRuntime('),app.indexOf('async function requestGeneratedTitle(')),context);
const prompt=process.env.ORBIT_TEST_PROMPT || 'Search online for the official Ollama API documentation. In two sentences, explain what it offers and cite the official source.';
(async()=> {
  const reply=await context.requestLocalReply(prompt,[{role:'user',text:prompt}],{widgets:true,signal:AbortSignal.timeout(90000),onStatus:console.log});
  if(!process.env.ORBIT_TEST_PROMPT) {
    assert.ok(reply.webResearch.sources.length>0,reply.webResearch.notice || 'Model did not request a search');
    assert.match(reply.text,/https:\/\//);
  } else {
    assert.equal(reply.webResearch.notice,'');
    const parsed=context.OrbitWidgets.extract(reply.text);
    assert.equal(parsed.errors.length,0,parsed.errors.join(' '));
    if(parsed.artifacts.length) {
      const code=parsed.artifacts[0].blocks?.find(b=>b.type==='code');
      if(code) assert.ok(code.text.includes('\n'),'Code must contain actual source line breaks, not literal backslash-n');
    }
  }
  console.log(JSON.stringify({text:reply.text,sources:reply.webResearch.sources,notice:reply.webResearch.notice},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

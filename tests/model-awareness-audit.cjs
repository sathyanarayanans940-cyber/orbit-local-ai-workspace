// Opt-in, public synthetic histories only. Never reads user chats.
const fs=require('node:fs'),vm=require('node:vm');
const models=(process.env.ORBIT_AUDIT_MODELS||'').split(',').filter(Boolean);
if(!models.length)throw Error('Set ORBIT_AUDIT_MODELS');
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
const fixtures=[
 {name:'deep-chat-docx',prompt:'Create a short Word document about Python loops. Include a heading, a properly indented four-line Python code example, and a table with two rows. Use the enabled file tool.',kind:'docx'},
 {name:'deep-chat-proactive-chart',prompt:'Teach me why logarithmic growth is slower than linear growth using these inputs: n = 2,4,8,16 and log2(n) = 1,2,3,4. Use whatever teaching tools help make the comparison clear.',kind:'chart'},
 {name:'deep-chat-disabled',prompt:'Create a PDF with a short summary of loops.',disabled:true},
];
(async()=>{
 const results=[];
 for(const model of models)for(const fixture of fixtures){
  const context=vm.createContext({URL,AbortSignal,AbortController,DOMException,TextDecoder,setTimeout,clearTimeout,
   localStorage:{getItem:()=>fixture.disabled?JSON.stringify({pdf:false,docx:false,pptx:false,chart:false}):null},
   fetch:(url,options)=>fetch(new URL(url,'https://orbit.com'),options),
   state:{models:[{key:'audit',id:model,provider:'Ollama'}],selectedModel:'audit',connectedProviders:new Set()},runtimeEndpoints:{Ollama:{chat:'/api/ollama/chat'}},
   normalizedWidgetArtifacts:()=>[],isImageFile:()=>false,modelUsesCloud:()=>true,updateRuntimeStatus(){},setRuntimeStatus(){},async discoverModels(){}});
  vm.runInContext(fs.readFileSync(require.resolve('../widgets.js'),'utf8'),context);
  vm.runInContext(app.slice(app.indexOf('async function requestRuntime('),app.indexOf('async function requestGeneratedTitle(')),context);
  const history=[];
  for(let i=0;i<60;i++) history.push({role:'user',text:`Lesson ${i+1}: explain loop invariants.`},{role:'assistant',text:'A loop invariant is a property maintained before and after each iteration. '.repeat(12)});
  history.push({role:'user',text:fixture.prompt});
  try{
   const reply=await context.requestLocalReply(fixture.prompt,history,{widgets:true,signal:AbortSignal.timeout(90000)});
   const parsed=context.OrbitWidgets.extract(reply.text);
   const passed=fixture.disabled?!parsed.recognized&&/\b(?:disabled|enable)\b|\b(?:tool|widget)s?\b[^.\n]{0,60}\boff\b/i.test(reply.text):parsed.artifacts.some(a=>a.kind===fixture.kind)&&!parsed.errors.length;
   results.push({model,case:fixture.name,passed,errors:parsed.errors,kinds:parsed.artifacts.map(a=>a.kind),reply:reply.text});
   console.log(JSON.stringify({model,case:fixture.name,passed,kinds:parsed.artifacts.map(a=>a.kind)}));
  }catch(error){results.push({model,case:fixture.name,passed:false,error:error.message});console.log(JSON.stringify(results.at(-1)));}
  fs.mkdirSync('tests/output',{recursive:true});fs.writeFileSync('tests/output/model-awareness-audit.json',JSON.stringify(results,null,2));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});

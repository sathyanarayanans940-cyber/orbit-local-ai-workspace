// Opt-in live typography audit. Synthetic messages only; never changes saved chats.
const fs=require('node:fs'),vm=require('node:vm');
if(!process.env.ORBIT_TEST_MODEL)throw Error('Set ORBIT_TEST_MODEL explicitly.');
const app=fs.readFileSync('app.js','utf8');
const cases=[
 {id:'lesson',prompt:'bro teach me abstraction and encapsulation properly, with everyday examples and how they differ'},
 {id:'comparison',prompt:'bro explain unit testing, integration testing, system testing and acceptance testing, with examples for each'},
 {id:'tutorial',prompt:'bro teach me how the operating system manages processes and threads, and explain scheduling and context switches'},
 {id:'followup',history:[{role:'user',text:'What are software testing levels?'},{role:'assistant',text:'### 1. Unit testing\nChecks individual components.\n\n### 2. Integration testing\nChecks how components work together.'}],prompt:'bro now teach me the software development life cycle properly with examples'},
 {id:'brief',prompt:'What does CPU stand for? Just tell me the full form.'},
];
function context(){const ctx=vm.createContext({URL,AbortSignal,AbortController,DOMException,TextDecoder,setTimeout,clearTimeout,localStorage:{getItem:()=>null},navigator:{onLine:true},
fetch:(url,options)=>fetch(new URL(url,process.env.ORBIT_TEST_URL||'http://127.0.0.1:8885'),options),
state:{models:[{key:'test',id:process.env.ORBIT_TEST_MODEL,provider:'Ollama'}],selectedModel:'test',connectedProviders:new Set()},
runtimeEndpoints:{Ollama:{chat:'/api/ollama/chat'}},normalizedWidgetArtifacts:()=>[],isImageFile:()=>false,requestedFileKind:()=>'',modelUsesCloud:()=>true,updateRuntimeStatus(){},setRuntimeStatus(){},async discoverModels(){}});
for(const f of ['widgets.js','thinking.js'])vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
vm.runInContext(app.slice(app.indexOf('async function requestRuntime('),app.indexOf('async function requestGeneratedTitle(')),ctx);return ctx;}
const out={model:process.env.ORBIT_TEST_MODEL,started:new Date().toISOString(),scope:'Production requestLocalReply with widgets enabled and actual heading instructions; synthetic history only, no personal profile, recall, search or analysis enrichment.',results:[]};
const save=()=>fs.writeFileSync('tests/output/live-heading-audit.json',JSON.stringify(out,null,2));
(async()=>{for(const c of cases){const start=Date.now();try{const ctx=context();const reply=await ctx.requestLocalReply(c.prompt,[...(c.history||[]),{role:'user',text:c.prompt}],{widgets:true,signal:AbortSignal.timeout(180000)});
const headings=[...reply.text.matchAll(/^ {0,3}(#{1,6})\s+(.+)$/gm)].map(m=>({level:m[1].length,text:m[2]}));
const r={...c,text:reply.text,headings,seconds:Math.round((Date.now()-start)/1000)};out.results.push(r);save();console.log(JSON.stringify({id:c.id,seconds:r.seconds,headings}));}
catch(e){out.results.push({id:c.id,error:e.message,cause:e.cause?.message});save();console.log(JSON.stringify(out.results.at(-1)));}}
})().catch(e=>{console.error(e);process.exitCode=1;});

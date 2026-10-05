// Explicit opt-in integration audit; public web topics only. Does not access user chats.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
if(!process.env.ORBIT_TEST_MODEL)throw Error('Set ORBIT_TEST_MODEL to explicitly run a live test.');
const base=process.env.ORBIT_TEST_URL||'http://127.0.0.1:8882',dir=path.join(__dirname,'output/document-vision');
let calls=0,searchFault=false,readFault=false;const traffic=[],status=[];
const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2));
const context=vm.createContext({URL,AbortSignal,AbortController,DOMException,TextDecoder,TextEncoder,structuredClone,crypto:globalThis.crypto,setTimeout,clearTimeout,
 localStorage:{getItem:()=>null},navigator:{onLine:true},console,
 state:{models:[{key:'test',id:process.env.ORBIT_TEST_MODEL,provider:'Ollama'}],selectedModel:'test',connectedProviders:new Set()},
 runtimeEndpoints:{Ollama:{chat:'/api/ollama/chat'}},normalizedWidgetArtifacts:()=>[],isImageFile:()=>false,requestedFileKind:()=>'',
 modelUsesCloud:m=>m.id.includes('cloud'),OrbitThinking:{options:()=>({think:false}),status:()=>''},updateRuntimeStatus(){},setRuntimeStatus(){},async discoverModels(){},
 fetch:async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;
  if(url.includes('/api/web/')){
   const row={url,body};traffic.push(row);
   if(process.env.ORBIT_TEST_FAULTS==='1'&&((url.endsWith('search')&&!searchFault)||(url.endsWith('fetch')&&!readFault))){if(url.endsWith('search'))searchFault=true;else readFault=true;row.injected='TimeoutError';throw new DOMException('Injected one-shot web timeout','TimeoutError');}
   const response=await fetch(new URL(url,base),options);row.status=response.status;try{row.result=await response.clone().json();}catch{}save('web-report-traffic.json',traffic);return response;
  }
  const id=++calls;console.log('Model request',id);save('web-report-request-'+id+'.json',body);
  return fetch(new URL(url,base),options);
 }
});
for(const f of ['widgets.js','document-assets.js','long-documents.js','web-tools.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),context);
// Persist only this synthetic audit's validated checkpoints, for inspecting or resuming a failed audit.
const build=context.OrbitLongDocuments.build;
context.OrbitLongDocuments.build=(request,options)=>build(request,{...options,checkpointStore:{
 async get(key){try{const r=JSON.parse(fs.readFileSync(path.join(dir,'web-report-checkpoint.json')));return r.key===key?r.value:null;}catch{return null;}},
 async put(key,value){save('web-report-checkpoint.json',{key,value});},
 async remove(key){save('web-report-completed-checkpoint.json',JSON.parse(fs.readFileSync(path.join(dir,'web-report-checkpoint.json'))));save('web-report-checkpoint.json',{key:null});}
}});
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');vm.runInContext(app.slice(app.indexOf('async function requestRuntime('),app.indexOf('async function requestGeneratedTitle(')),context);
let request='Search the web and read multiple authoritative SQLite documentation articles, then create a 19 page Word research-style engineering report on SQLite transaction reliability. Use primary sqlite.org documentation. Cover transaction modes, isolation, rollback versus WAL, writer concurrency, checkpoints, WAL growth, power-loss durability and synchronous settings, safe backup APIs, operational tradeoffs and practical testing. Distinguish documented guarantees, caveats, hypothetical examples and recommendations. Do not invent benchmarks, citations or version claims. Use substantial flowing text, useful concrete examples and source citations throughout. Include a generated architecture or flow diagram if it helps, never invented measurements. This report must synthesize several complementary articles, not repeat one article or pad page count. Clearly state limits when retrieved sources do not support a topic.';
if(process.env.ORBIT_TEST_PRIMARY_URLS==='1')request+=' Read these primary pages as the core sources: https://www.sqlite.org/isolation.html https://www.sqlite.org/lang_transaction.html https://www.sqlite.org/wal.html https://www.sqlite.org/lockingv3.html https://www.sqlite.org/atomiccommit.html https://www.sqlite.org/pragma.html https://www.sqlite.org/backup.html https://www.sqlite.org/c3ref/backup_finish.html .';
(async()=>{
 const reply=await context.requestLocalReply(request,[{role:'user',text:request}],{widgets:true,signal:AbortSignal.timeout(120*60*1000),onStatus:s=>{if(s){console.log(s);status.push(s);save('web-report-progress.json',{calls,status});}}});
 const spec=context.OrbitWidgets.extract(reply.text).artifacts[0];if(!spec)throw Error('No document artifact');
 save('web-report-recipe.json',spec);save('web-report-research.json',reply.webResearch);save('web-report-results.json',{model:process.env.ORBIT_TEST_MODEL,words:context.OrbitLongDocuments.wordCount(spec.blocks),blocks:spec.blocks.length,calls,sources:reply.webResearch.sources,traffic:traffic.map(({result,...x})=>x),status});console.log('COMPLETE',context.OrbitLongDocuments.wordCount(spec.blocks),'words',reply.webResearch.sources.length,'sources');
})().catch(error=>{save('web-report-error.json',{message:error.message,stack:error.stack,calls,status});console.error(error);process.exitCode=1;});

// Opt-in, bounded live integration. Uses synthetic requests and an empty profile.
// Run explicitly with --live after updating the installed macOS gateway.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const https=require('node:https'),{execFileSync}=require('node:child_process');
const assert=require('node:assert/strict'),JSZip=require('jszip');
const ROOT=path.resolve(__dirname,'..'),W=require('../widgets.js');
if(require.main===module&&!process.argv.includes('--live'))throw Error('Explicit --live required: this test makes bounded paid OpenAI requests.');
const out=path.join(__dirname,'output/tool-routing');fs.mkdirSync(out,{recursive:true});
const certificate=fs.readFileSync('/Library/Application Support/Orbit/orbit.com.pem');
const cases=[
 ['direct','Explain what a stack is in one sentence.'],
 ['web','Search the web to verify the current stable Python version. Answer in two sentences with a source.'],
 ['python-word','Execute Python to print the result of 17 * 2, assert it equals 34, and create a small downloadable Word document showing the verified result. Keep it to one page. No web search.'],
 ['web-word','Read https://docs.python.org/3/tutorial/datastructures.html and create a one-page downloadable Word document explaining stacks, with one heading, two short paragraphs, and a reference to that page. Use only that URL for research.'],
];
const reviewedArithmeticRunner=String.raw`
import ast, sys
source=sys.stdin.read()
tree=ast.parse(source)
allowed=(ast.Module,ast.Assign,ast.Expr,ast.Assert,ast.Name,ast.Constant,ast.BinOp,ast.Mult,ast.Compare,ast.Eq,ast.Load,ast.Store,ast.Call,ast.JoinedStr,ast.FormattedValue)
for node in ast.walk(tree):
    if not isinstance(node,allowed): raise ValueError('Audit executes only reviewed arithmetic syntax')
    if isinstance(node,ast.Name) and ('__' in node.id or node.id in {'exec','eval','open','globals','locals','getattr','setattr','compile','input'}): raise ValueError('Unsafe audit name')
    if isinstance(node,ast.Constant) and ((isinstance(node.value,(int,float)) and abs(node.value)>1000000) or (isinstance(node.value,str) and len(node.value)>1000)): raise ValueError('Audit literal too large')
    if isinstance(node,ast.Call) and (not isinstance(node.func,ast.Name) or node.func.id!='print' or node.keywords): raise ValueError('Audit allows only print calls')
exec(compile(tree,'<reviewed-live-arithmetic>','exec'),{'__builtins__':{'print':print}})
`;
const results=[];
function runtime(audit){
 const saved=new Map(),start=Date.now(),elapsed=()=>Date.now()-start;
 const context=vm.createContext({
  AbortController,AbortSignal,DOMException,TextDecoder,TextEncoder,URL,Headers,Date,Blob,
  setTimeout,clearTimeout,navigator:{onLine:true},
  localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v))},
  state:{models:[{key:'OpenAI:gpt-6-luna',id:'gpt-6-luna',name:'GPT-6 Luna',provider:'OpenAI'}],selectedModel:'OpenAI:gpt-6-luna',connectedProviders:new Set(),savedChats:{},deletedChats:new Set(),currentChat:'synthetic-audit'},
  runtimeEndpoints:{OpenAI:{chat:'/api/openai/chat',headers:{'X-Orbit-OpenAI':'1'}}},
  OrbitThinking:{options:()=>({reasoning_effort:'none'}),status:()=>''},OrbitWidgets:W,
  normalizedWidgetArtifacts:()=>[],isImageFile:()=>false,modelUsesCloud:()=>true,
  updateRuntimeStatus(){},setRuntimeStatus(){},async discoverModels(){},
  console:{info:(_,timing)=>audit.diagnostics.push(JSON.parse(JSON.stringify(timing)))},
  fetch(url,options){
   assert.ok(['/api/openai/chat','/api/web/search','/api/web/fetch'].includes(url),'Unexpected API endpoint');
   const body=JSON.parse(options.body),model=url==='/api/openai/chat';
   // Output caps belong only to this audit, not the application's defaults.
   if(model)body.max_tokens=body.orbit_tools?1536:4096;
   const call={endpoint:url,startMs:elapsed(),...(model?{stage:body.orbit_tools?'route':body.response_format?'planner':'answer',maxTokens:body.max_tokens}: {})};
   audit.calls.push(call);
   return new Promise((resolve,reject)=>{
    const request=https.request({hostname:'orbit.com',port:443,path:url,method:'POST',ca:certificate,lookup:(_,options,cb)=>options.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4),headers:{...options.headers,Origin:'https://orbit.com'}},response=>{
     call.status=response.statusCode;call.headersMs=elapsed()-call.startMs;call.serverTiming=response.headers['server-timing']||'';
     let buffer='';
     const stream=new ReadableStream({start(controller){
      response.on('data',chunk=>{
       if(model){
        buffer+=chunk.toString();let boundary;
        while((boundary=buffer.indexOf('\n'))>=0){
         const line=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1);
         if(!line.startsWith('data:')||line.slice(5).trim()==='[DONE]')continue;
         try{
          const packet=JSON.parse(line.slice(5));
          if(packet.usage)call.usage=packet.usage;
          if(packet.orbit_tool_route){call.route=packet.orbit_tool_route;call.routeMs=elapsed()-call.startMs;}
          if(packet.choices?.some(c=>c.delta?.content))call.firstTextMs??=elapsed()-call.startMs;
         }catch(_){}
        }
       }
       controller.enqueue(new Uint8Array(chunk));
      });
      response.on('end',()=>{call.totalMs=elapsed()-call.startMs;controller.close();});
      response.on('error',error=>controller.error(error));
     },cancel(){request.destroy();}});
     resolve(new Response(stream,{status:response.statusCode,headers:response.headers}));
    });
    request.on('error',reject);
    const abort=()=>request.destroy(new DOMException('Stopped','AbortError'));
    options.signal?.addEventListener('abort',abort,{once:true});
    request.on('close',()=>options.signal?.removeEventListener('abort',abort));
    if(options.signal?.aborted)abort();else request.end(JSON.stringify(body));
   });
  },
 });
 const source=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('async function requestRuntime('),source.indexOf('async function requestGeneratedTitle(')),context);
 for(const file of ['memories.js','web-tools.js','analyze.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context);
 const analyze=context.OrbitAnalyze.analyze;
 context.OrbitAnalyze.analyze=(messages,options)=>analyze(messages,{...options,run:async code=>{
  assert.ok(code.length<=4000,'Arithmetic audit code too large');
  const ranAt=elapsed();
  try{
   const output=execFileSync('python3',['-I','-S','-c',reviewedArithmeticRunner],{input:code,timeout:5000,maxBuffer:16000,encoding:'utf8'});
   audit.executions.push({code,ok:true,output,ms:elapsed()-ranAt});return {ok:true,output};
  }catch(error){
   const detail=String(error.stderr||error.message);audit.executions.push({code,ok:false,error:detail});return {ok:false,output:'',error:detail};
  }
 }});
 return context;
}
module.exports={runtime};
if(require.main===module)(async()=>{
 const engine=await import('../widgets-engine.js');
 for(const [name,prompt] of cases){
  const audit={case:name,prompt,model:'gpt-6-luna',effort:'none',calls:[],diagnostics:[],statuses:[],executions:[],firstVisibleTextMs:null};
  const context=runtime(audit),started=Date.now();
  try{
   const reply=await context.requestLocalReply(prompt,[{role:'user',text:prompt}],{widgets:true,signal:AbortSignal.timeout(90000),onStatus:s=>audit.statuses.push({ms:Date.now()-started,label:s}),onToken:()=>audit.firstVisibleTextMs??=Date.now()-started});
   audit.text=reply.text;
   if(name==='direct'){assert.equal(audit.calls.length,1);assert.ok(reply.text.trim());assert.equal(reply.analysis,undefined);assert.equal(reply.webResearch,undefined);}
   if(name.startsWith('web')){assert.ok(reply.webResearch?.sources.length>0,'Live source missing');audit.sources=reply.webResearch.sources;audit.webNotice=reply.webResearch.notice;}
   if(name==='python-word'){assert.ok(reply.analysis?.checks.some(c=>c.ok&&/34/.test(c.output)),'Execution did not verify 34');assert.equal(audit.calls.filter(c=>c.endpoint==='/api/openai/chat').length,2,'Extra input planner call');}
   if(name.endsWith('word')){
    const extracted=W.extract(reply.text);assert.equal(extracted.artifacts.length,1,'Exactly one file recipe expected');
    const spec=W.normalize(extracted.artifacts[0]);assert.equal(spec.kind,'docx');
    const bytes=Buffer.from(await (await engine.generate(spec)).arrayBuffer());
    const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
    assert.ok(bytes.length>1000&&xml.includes('<w:document'),'Word file not generated');
    if(name==='python-word')assert.match(xml,/34/);
    if(name==='web-word')assert.match(xml,/docs\.python\.org/);
    const filename=name+'.docx';fs.writeFileSync(path.join(out,filename),bytes);audit.file={filename,bytes:bytes.length,text:xml.replace(/<[^>]+>/g,' ')};
   }
   audit.ok=true;
  }catch(error){audit.ok=false;audit.error=error.message;}
  audit.totalMs=Date.now()-started;results.push(audit);
  fs.writeFileSync(path.join(out,'live-luna-v3-integration.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({case:name,ok:audit.ok,error:audit.error,totalMs:audit.totalMs,firstVisibleTextMs:audit.firstVisibleTextMs,modelCalls:audit.calls.filter(c=>c.endpoint==='/api/openai/chat').length,webCalls:audit.calls.filter(c=>c.endpoint.startsWith('/api/web/')).length,executions:audit.executions.length,file:audit.file?.bytes}));
 }
 if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});

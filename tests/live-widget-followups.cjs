// Synthetic bounded live requests only. No user chat or uploaded document data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto'),JSZip=require('jszip');
const {runtime}=require('./live-tool-routing-audit.cjs'),W=require('../widgets.js');
if(!process.argv.includes('--live'))throw Error('Pass --live for bounded paid model requests.');
const fixtures=[
 {name:'wait-for-topic',history:[],prompt:'I will need a Word report, Times New Roman 11 pt. I have not given you the topic yet. Wait for my next message; do not create any file or template now.',kinds:[]},
 {name:'contextual-word',history:[{role:'user',text:'I need a short Word document about stacks. Use Times New Roman 11 pt. Include push, pop and peek, plus Python code. No web or execution needed.'},{role:'assistant',text:'I can prepare that.'}],prompt:'Okay, now make it.',kinds:['docx']},
 {name:'mixed-deliverables',history:[],prompt:'Create both a short Word document and a PDF, each containing this exact table: A=0, B=2, C=-1. Also show a separate bar chart in chat using exactly those values. Include all three outputs now. Do not browse or run code.',kinds:['docx','pdf','chart']},
 {name:'source-download-does-not-persist',history:[{role:'user',text:'Create a downloadable example.py file with print(1).'},{role:'assistant',text:'Your source file is ready.'}],prompt:'Now show a Python example that prints 2, in a code block. No downloadable file, execution or browsing.',kinds:[]},
];
(async()=>{
 global.OrbitWidgetEngine=await import('../widgets-engine.js');const results=[],out=path.join(__dirname,'output/widget-fresh-extreme');fs.mkdirSync(out,{recursive:true});
 for(const f of fixtures.filter(f=>!process.env.ORBIT_AUDIT_CASES||process.env.ORBIT_AUDIT_CASES.split(',').includes(f.name))){
  const audit={case:f.name,prompt:f.prompt,model:'gpt-6-luna',effort:'none',calls:[],diagnostics:[],statuses:[],executions:[]},context=runtime(audit),start=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  const originalReply=context.requestLocalReply;context.requestLocalReply=async function(prompt,messages,options){const result=await originalReply(prompt,messages,options);if(options?.repairing)audit.repairReply=result.text;return result;};
  Object.assign(context,{Blob,File,crypto:webcrypto,renderMessages(){},persistCurrentChat(){}});vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),context);const user={role:'user',text:f.prompt};context.state.messages=[...f.history,user];
  try{
   const reply=await context.requestLocalReply(f.prompt,context.state.messages,{widgets:true,signal:controller.signal,onStatus:s=>audit.statuses.push(s)});audit.reply=reply.text;const message={role:'assistant',text:reply.text};context.state.messages.push(message);await context.finalizeMessageWidgets(message,f.prompt,controller.signal);
   audit.artifacts=JSON.parse(JSON.stringify(message.artifacts||[]));audit.widgetError=message.widgetError;audit.finalText=message.text;
   assert.equal(message.widgetError,undefined);assert.deepEqual(audit.artifacts.map(a=>a.spec.kind).sort(),f.kinds.slice().sort());
   for(const a of message.artifacts||[]){assert.equal(a.error,undefined);const blob=vm.runInContext('widgetBlobs',context).get(a.id);assert.ok(blob?.size>0);const bytes=Buffer.from(await blob.arrayBuffer());fs.writeFileSync(path.join(out,f.name+'-'+W.filename(a.spec)),bytes);
    if(f.name==='contextual-word'){const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/Times New Roman/);assert.match(xml,/w:sz w:val="22"/);assert.match(xml,/push|append/i);assert.match(xml,/pop/i);assert.match(xml,/peek/i);}
    if(f.name==='mixed-deliverables'&&a.spec.kind==='chart')assert.deepEqual(a.spec.series[0].values,[0,2,-1]);
   }
   if(!f.kinds.length)assert.equal(audit.calls.filter(c=>c.endpoint==='/api/openai/chat').length,1);
   if(f.name==='source-download-does-not-persist')assert.match(message.text,/```python/);audit.ok=true;
  }catch(e){audit.ok=false;audit.error=e.message;}finally{clearTimeout(timer);}
  audit.totalMs=Date.now()-start;results.push(audit);fs.writeFileSync(path.join(out,(process.env.ORBIT_AUDIT_LABEL||'live')+'.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({case:f.name,ok:audit.ok,error:audit.error,ms:audit.totalMs,calls:audit.calls.filter(c=>c.endpoint==='/api/openai/chat').length}));
 }
 if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

// Explicit, bounded live audit. Empty synthetic state, real model/gateway and exporters.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto'),JSZip=require('jszip'),W=require('../widgets.js'),A=require('../archives.js');
const {runtime}=require('./live-tool-routing-audit.cjs');
if(!process.argv.includes('--live'))throw Error('Pass --live to authorize this paid synthetic audit.');
const cases=[
 {name:'pdf',kind:'pdf',prompt:'Create a short PDF about stacks: explain LIFO, include Python push/pop code and a two-row operation table. Use only general knowledge. No web research needed.'},
 {name:'word',kind:'docx',prompt:'Create a short Word document about stacks. Use Times New Roman body, 18-point blue heading, a page border, and a short Python code block. No web research needed.'},
 {name:'ppt',kind:'pptx',prompt:'Create a four-slide PowerPoint introducing AWS EC2, S3 and IAM from general knowledge; no web research needed. Include a cover, a three-column comparison, a summary table and a conclusion. Use varied layouts and useful speaker notes; no invented performance statistics.'},
 {name:'excel',kind:'xlsx',prompt:'Create an Excel workbook named Inventory with rows Pen quantity 3 price 2, Book quantity 2 price 7, and Eraser quantity 0 price 1. Keep numeric values numeric; no formulas needed.'},
 {name:'diagram',kind:'diagram',prompt:'Draw a flowchart: Start, read an integer x, decide x > 0, branch Yes to Positive and No to Nonpositive, then both to End. Label both branches clearly.'},
 {name:'gantt',kind:'chart',prompt:'Create a Gantt chart from this exact schedule: Plan 2026-10-08 through 2026-10-09, Build 2026-10-09 through 2026-10-12, Review milestone on 2026-10-12. Do not invent progress.'},
 {name:'proactive-chart',kind:'chart',prompt:'Teach me why logarithmic growth is slower than linear growth using exactly n=2,4,8,16 and log2(n)=1,2,3,4. Use whatever teaching tools materially help make the comparison clear.'},
 {name:'text',kind:'text',prompt:'Give me a downloadable main.py file containing exactly print("Hello") followed by a newline. Do not execute it.'},
 {name:'notebook',kind:'ipynb',prompt:'Create an unexecuted Jupyter notebook named demo.ipynb with one Markdown cell explaining a stack and one Python code cell showing append and pop. No saved outputs.'},
 {name:'zip',kind:'zip',prompt:'Create a downloadable starter.zip containing src/main.py with print("Hello"), docs/README.md explaining how to run it, and an empty tests/ folder. No execution needed.'},
 {name:'analysis',prompt:'Use Python to print 17 * 2 and assert it equals 34. Report the actual result in one sentence. No files or web search.'},
 {name:'memory',prompt:'Remember that I prefer blue headings in Word documents. Save that preference for future documents.'},
 {name:'web',prompt:'Search the web for the current stable Python version. Cite the source in a short answer.'},
 {name:'plain-code',prompt:'Show a Python hello-world example in a code block. No execution, files or browsing.'},
];
const selected=process.env.ORBIT_AUDIT_CASES?.split(','),chosen=selected?cases.filter(c=>selected.includes(c.name)):cases;
const out=path.join(__dirname,'output/widget-matrix');fs.mkdirSync(out,{recursive:true});
const label=process.env.ORBIT_AUDIT_LABEL||'baseline',results=[];
(async()=>{
 global.OrbitWidgetEngine=await import('../widgets-engine.js');
 for(const fixture of chosen){
  const audit={case:fixture.name,prompt:fixture.prompt,model:'gpt-6-luna',effort:'none',calls:[],diagnostics:[],statuses:[],executions:[],firstVisibleTextMs:null};
  const context=runtime(audit),started=Date.now(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),90000);
  const user={role:'user',text:fixture.prompt};context.state.messages=[user];
  Object.assign(context,{Blob,File,crypto:webcrypto,OrbitArchives:A,renderMessages(){},persistCurrentChat(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../widgets-ui.js'),'utf8'),context);
  try{
   const reply=await context.requestLocalReply(fixture.prompt,[user],{widgets:true,signal:controller.signal,onStatus:s=>audit.statuses.push(s),onToken:()=>audit.firstVisibleTextMs??=Date.now()-started});
   audit.reply=reply.text;audit.sources=reply.webResearch?.sources;
   const message={role:'assistant',text:reply.text};context.state.messages.push(message);
   await context.finalizeMessageWidgets(message,fixture.prompt,controller.signal);
   audit.artifacts=JSON.parse(JSON.stringify(message.artifacts||[]));audit.widgetError=message.widgetError;
   audit.finalText=message.text;
   if(fixture.kind){
    assert.ok(!message.widgetError,message.widgetError);assert.ok(message.artifacts?.some(a=>a.spec.kind===fixture.kind),'Expected '+fixture.kind+' widget missing');
    for(const a of message.artifacts){
     assert.ok(!a.error,a.error);const blob=vm.runInContext('widgetBlobs',context).get(a.id);assert.ok(blob,'Generated bytes missing');
     const bytes=Buffer.from(await blob.arrayBuffer()),name=fixture.name+'-'+W.filename(a.spec);fs.writeFileSync(path.join(out,name),bytes);
     if(['docx','pptx','xlsx','zip'].includes(a.spec.kind)){
      const z=await JSZip.loadAsync(bytes);audit.archiveEntries=Object.keys(z.files);
      if(a.spec.kind==='pptx')assert.equal(audit.archiveEntries.filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,4);
      if(a.spec.kind==='xlsx'){const xml=await z.file('xl/worksheets/sheet1.xml').async('string');assert.match(xml,/<v>3<\/v>/);}
      if(a.spec.kind==='zip'){assert.ok(z.file('src/main.py'));assert.ok(z.file('docs/README.md'));assert.ok(z.files['tests/']?.dir);}
      if(a.spec.kind==='docx'){const xml=await z.file('word/document.xml').async('string');assert.match(xml,/Times New Roman/);assert.match(xml,/pgBorders/);}
     }
     if(a.spec.kind==='pdf')assert.equal(bytes.subarray(0,4).toString(),'%PDF');
     if(['diagram','chart'].includes(a.spec.kind)){assert.match(bytes.toString(),/<svg/);assert.doesNotMatch(bytes.toString(),/NaN|Infinity|<script/);}
     if(a.spec.kind==='text')assert.equal(bytes.toString(),'print("Hello")\n');
     if(a.spec.kind==='ipynb'){const n=JSON.parse(bytes.toString());assert.equal(n.cells.length,2);assert.equal(n.cells[1].execution_count,null);assert.equal(n.cells[1].outputs.length,0);}
    }
   }
   if(fixture.name==='analysis')assert.ok(reply.analysis?.checks.some(c=>c.ok&&/34/.test(c.output)));
   if(fixture.name==='memory')assert.ok(context.OrbitMemories.learned().some(p=>p.scope==='word'&&/blue/i.test(p.value)));
   if(fixture.name==='web')assert.ok(reply.webResearch?.sources.length);
   if(fixture.name==='plain-code'){assert.equal(audit.calls.length,1);assert.equal(message.artifacts?.length||0,0);assert.match(message.text,/```python/);}
   audit.ok=true;
  }catch(error){audit.ok=false;audit.error=error.message;}
  finally{clearTimeout(timeout);}
  audit.totalMs=Date.now()-started;results.push(audit);fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({case:audit.case,ok:audit.ok,error:audit.error,totalMs:audit.totalMs,modelCalls:audit.calls.filter(c=>c.endpoint==='/api/openai/chat').length,kinds:audit.artifacts?.map(a=>a.spec.kind)}));
 }
 if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});

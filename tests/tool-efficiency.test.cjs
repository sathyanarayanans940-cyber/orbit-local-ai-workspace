const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../widgets.js'),D=require('../document-assets.js');

test('routing inventory names every tool without carrying full schemas, and respects widget settings',()=>{
 const store=new Map(),ctx={localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets.js'),'utf8'),ctx);
 const w=ctx.OrbitWidgets,s=w.capabilityInstruction('Explain stacks');
 for(const word of ['PDF','Word/DOCX','PowerPoint/PPTX','Excel/XLSX','Gantt','flowcharts','UTF-8','Jupyter/IPYNB','ZIP'])assert.ok(s.includes(word),word);
 assert.ok(s.length<3500);assert.doesNotMatch(s,/"blocks"|"slides"|"nodes"/);
 assert.match(s,/"text":false,"ipynb":false,"zip":false/);
 w.setEnabled('chart',false);assert.doesNotMatch(w.capabilityInstruction('Plot x'),/charts: bar/);assert.match(w.capabilityInstruction('Plot x'),/Disabled kinds: chart/);
 assert.match(w.capabilityInstruction('Create a downloadable notes.txt file'),/"text":true/);
 assert.match(w.capabilityInstruction('Create a Jupyter notebook'),/"ipynb":true/);
 assert.match(w.capabilityInstruction('Create a ZIP'),/"zip":true/);
});

test('ZIP request allows explanatory README contents without authorizing read-only or quoted requests',()=>{
 for(const s of ['Create a downloadable starter.zip containing src/main.py, docs/README.md explaining how to run it, and an empty tests/ folder. No execution needed.','Make a zip with a README explaining how to extract it'])assert.equal(W.requestedZip(s),true,s);
 for(const s of ['How do I create a zip?','Explain how to make a zip','Read this zip','Extract this zip','Write a script to create a zip','Do not create a zip','Explain this: "create a zip"','> Create a zip'])assert.equal(W.requestedZip(s),false,s);
});

async function finalize(specs,prompt,replacements){
 let calls=0;const message={role:'assistant',text:specs.map(s=>'```orbit-widget\n'+JSON.stringify(s)+'\n```').join('\n')};
 const ctx={OrbitWidgets:{...W,generate:async()=>new Blob(['file'])},crypto:require('node:crypto').webcrypto,state:{models:[{key:'test'}],selectedModel:'test',messages:[message]},renderMessages(){},persistCurrentChat(){},async requestLocalReply(_,history){calls++;const slots=JSON.parse(history[1].text).slots;assert.equal(slots.length,replacements.length);return {text:JSON.stringify({repairs:slots.map((s,i)=>({index:s.index,widget:replacements[i]}))})};}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);await ctx.finalizeMessageWidgets(message,prompt);return {message,calls};
}
test('local PPT at-most limits repair the failed slot once instead of leaving a stale error',async()=>{
 const bad={kind:'pptx',title:'AWS',slides:[{layout:'cover',title:'AWS',bullets:['EC2','S3','IAM']}]};
 const good={...bad,slides:[{layout:'cover',title:'AWS',subtitle:'EC2, S3 and IAM'}]};
 const {message,calls}=await finalize([bad],'Create a PowerPoint',[good]);
 assert.equal(calls,1);assert.equal(message.widgetError,undefined);assert.equal(message.artifacts.length,1);assert.match(JSON.stringify(message.artifacts),/EC2, S3 and IAM/);
});
test('mixed-format repair keeps the valid document and repairs its chart independently',async()=>{
 const doc={kind:'docx',title:'Data',blocks:[{type:'paragraph',text:'A=1, B=2'}]},chart={kind:'chart',chartType:'bar',title:'Data',labels:['A','B'],series:[{name:'Count',values:[1,2]}]};
 const {message,calls}=await finalize([doc,{...chart,series:[{name:'Count',values:[1]}]}],'Create a Word document and a chart',[chart]);
 assert.equal(calls,1);assert.equal(message.widgetError,undefined);assert.deepEqual(Array.from(message.artifacts,a=>a.spec.kind),['docx','chart']);
});

test('vision cache reuses complete exact readings and invalidates changed bytes, context, model or effort',async()=>{
 const dataUrl='data:image/png;base64,aGVsbG8=',a={name:'19 pages',visuals:Array.from({length:19},(_,i)=>({id:'img-'+i,label:'Page '+(i+1),dataUrl}))},conversation=[{role:'user',attachments:[a]}];
 let calls=0,images=0;const options={force:true,model:{provider:'OpenAI',id:'model-a'},cacheKey:'none',read:async h=>{calls++;images+=h[1].attachments.length;return h[1].attachments.map(a=>a.name).join(', ');}};
 const first=await D.describe(conversation,options),second=await D.describe(conversation,options);
 assert.equal(calls,5);assert.equal(images,19);assert.equal(first[0].attachments[0].visualSummary,second[0].attachments[0].visualSummary);assert.equal(a.visualSummary,undefined);
 a.visuals[0].dataUrl='data:image/png;base64,d29ybGQ=';await D.describe(conversation,options);assert.equal(calls,6);
 a.extractedText='Changed extraction';await D.describe(conversation,options);assert.equal(calls,7);
 a.visuals[0].label='Corrected page';await D.describe(conversation,options);assert.equal(calls,8);
 await D.describe(conversation,{...options,cacheKey:'high'});assert.equal(calls,13);
 await D.describe(conversation,{...options,model:{provider:'OpenAI',id:'model-b'}});assert.equal(calls,18);
});
test('failed and aborted vision responses never become cached successful evidence',async()=>{
 const conversation=[{attachments:[{assetId:'img-one',dataUrl:'data:image/png;base64,aGVsbG8='}]}];let calls=0;
 const options={force:true,model:{id:'x'},read:async()=>{calls++;return '';}};
 await assert.rejects(D.describe(conversation,options),/no reading/);assert.equal(calls,1);
 const c=new AbortController();await assert.rejects(D.describe(conversation,{...options,signal:c.signal,read:async()=>{calls++;c.abort();return 'incomplete';}}),{name:'AbortError'});
 const result=await D.describe(conversation,{...options,read:async()=>{calls++;return 'complete';}});assert.equal(calls,3);assert.match(result[0].attachments[0].visualSummary,/complete/);assert.doesNotMatch(result[0].attachments[0].visualSummary,/incomplete/);
});

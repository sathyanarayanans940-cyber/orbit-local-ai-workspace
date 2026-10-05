const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../widgets.js');
const exported=JSON.parse(fs.readFileSync(__dirname+'/fixtures/bfs-missing-steps.orbit-chat','utf8'));
const original=exported.messages.find(m=>m.role==='assistant');
const fence=spec=>'```orbit-widget\n'+JSON.stringify(spec)+'\n```';
function rawReply() {
 let text=original.text;
 for(const artifact of [...original.artifacts].reverse())text=text.slice(0,artifact.position)+fence(artifact.spec)+text.slice(artifact.position);
 return text;
}
function context(reply) {
 const message={role:'assistant',text:rawReply()};
 const c=vm.createContext({OrbitWidgets:W,crypto:require('node:crypto').webcrypto,AbortSignal,
 state:{models:[{key:'m'}],selectedModel:'m',messages:[message]},requestLocalReply:reply,renderMessages(){},persistCurrentChat(){},
 escapeHtml:W.escape,attachmentFileKind:()=>({}),isArchivedChat:()=>false});
 vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),c);
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
 for(const name of ['exportableMessage','normalizeImportedMessages']){
  const start=app.indexOf('function '+name+'(');
  vm.runInContext(app.slice(start,app.indexOf('\nfunction ',start+1)),c);
 }
 return {c,message};
}
test('actual exported BFS identifies precisely steps 3–7; original and final diagrams are retained',async()=>{
 let calls=0;
 const {c,message}=context(async(_,history,options)=>{
  calls++;assert.equal(options.repairing,true);
  const request=JSON.parse(history[1].text);
  assert.deepEqual(request.slots.map(s=>s.draft.match(/Step (\d+)/)[1]),['3','4','5','6','7']);
  assert.equal(request.existingDiagrams.length,4);
  assert.ok(request.slots.every(s=>s.missingStep));
  return {text:JSON.stringify({repairs:request.slots.map(s=>({index:s.index,widget:{...original.artifacts.at(-1).spec,title:s.draft.split('\n')[0].replace(/^#+\s*/,'')}})).reverse()})};
 });
 await c.finalizeMessageWidgets(message,exported.messages[0].text);
 assert.equal(calls,1);assert.equal(message.artifacts.length,9);assert.equal(message.widgetError,undefined);
 assert.equal(message.text,original.text);
 for(const artifact of original.artifacts)assert.deepEqual(message.artifacts.find(a=>a.spec.title===artifact.spec.title).spec,artifact.spec);
 const titles=message.artifacts.map(a=>a.spec.title);
 assert.match(titles[3],/^Step 3/);assert.match(titles[7],/^Step 7/);assert.match(titles[8],/^Final BFS/);
 for(let i=3;i<=7;i++){
  const artifact=message.artifacts[i];
  assert.ok(message.text.slice(0,artifact.position).includes('### Step '+i));
  assert.ok(message.text.slice(artifact.position).startsWith(i<7?'### Step '+(i+1):'### Final BFS Tree'));
 }
 const restored=c.normalizeImportedMessages([c.exportableMessage(message)])[0];
 assert.equal(restored.artifacts.length,9);assert.equal(restored.text,original.text);
 assert.equal((c.widgetMarkup(restored,0).match(/class="orbit-diagram"/g)||[]).length,9);
});
test('partial, invalid, duplicate and collapsed completion report missing steps, including through export/import',async()=>{
 for(const mode of ['partial','invalid','duplicate','collapsed','failure']) {
  const {c,message}=context(async(_,history)=>{
   if(mode==='failure')throw Error('Unavailable');
   const slots=JSON.parse(history[1].text).slots;
   const widget=original.artifacts[0].spec;
   if(mode==='collapsed')return {text:JSON.stringify(widget)};
   const repairs=slots.slice(0,1).map(s=>({index:s.index,widget:mode==='invalid'?{...widget,nodes:[]}:widget}));
   if(mode==='duplicate')repairs.push(repairs[0]);
   return {text:JSON.stringify({repairs})};
  });
  await c.finalizeMessageWidgets(message,'Show BFS');
  assert.equal(message.artifacts.length,mode==='partial'?5:4);
  assert.match(message.widgetError,/Missing diagram for Step 7/);
  assert.equal(c.normalizeImportedMessages([c.exportableMessage(message)])[0].widgetError,message.widgetError);
  assert.equal(message.text,original.text);
 }
});
test('completion excludes code examples, unrelated headings, disabled tools and sequences without illustration intent',()=>{
 const {c}=context(()=>{throw Error('Unexpected request');});
 const spec=original.artifacts[0].spec;
 const parse=text=>W.extract(text);
 for(const text of [
  '### Step 1: Setup\nText\n### Step 2: Run\nText',
  fence(spec)+'\n### Step 1: Setup\nText\n### Step 2: Run\nText',
  '### Step 1: Setup\n'+fence(spec)+'\n### Step 2: Run\nText',
  '```markdown\n### Step 1: Example\n### Step 2: Example\n```\n'+fence(spec),
 ])assert.equal(c.missingDiagramSteps(parse(text),'Explain setup').length,0);
 assert.equal(c.missingDiagramSteps(parse('### Step 1: Start\n'+fence(spec)+'\n### Step 2: Visit B\nText'),'Show a graph step by step').length,1);
 assert.equal(c.missingDiagramSteps(parse('### Step 1: Start\nText\n### Step 2: Visit B\nText\n### Final graph\n'+fence(spec)),'Show a graph step by step').length,2);
 let stored='{"diagram":false}';global.localStorage={getItem:()=>stored};
 try {assert.equal(c.missingDiagramSteps(parse(rawReply()),'Show graph step by step').length,0);}finally{delete global.localStorage;}
});
test('completion does not retry a failed original slot as an omitted step or exceed 32 diagrams',async()=>{
 let supplied;
 const {c,message}=context(async(_,history)=>{
  supplied=JSON.parse(history[1].text).slots;
  return {text:JSON.stringify({repairs:supplied.map(s=>({index:s.index,widget:original.artifacts[0].spec}))})};
 });
 const spec=original.artifacts[0].spec;
 message.text=Array.from({length:34},(_,i)=>`### Step ${i+1}: Visit\n${i<31?fence(spec):i===31?fence({...spec,nodes:[]}):'Continue.'}`).join('\n');
 await c.finalizeMessageWidgets(message,'Show each step graph');
 assert.equal(supplied.length,1);assert.equal(supplied[0].missingStep,undefined);
 assert.equal(message.artifacts.length,32);assert.match(message.widgetError,/Missing diagram for Step 33/);
});
test('stopping completion leaves existing diagrams available and does not accept a late model response',async()=>{
 const controller=new AbortController();
 const {c,message}=context(async()=>{controller.abort();return {text:'{"repairs":[]}'};});
 await c.finalizeMessageWidgets(message,'Show BFS',controller.signal);
 assert.equal(message.widgetStatus,undefined);
 assert.equal(W.extract(message.text).artifacts.length,4);
});
test('real provider BFS repairs survive growing visited labels without moving nodes',async()=>{
 const reply=JSON.parse(fs.readFileSync(__dirname+'/fixtures/bfs-long-label-repair.json','utf8'));
 for(const {widget} of JSON.parse(reply.text).repairs){
  const spec=W.normalize(widget),visited=spec.nodes.find(n=>n.id==='V');
  assert.ok(visited.height>40);assert.equal(visited.width,160);
  assert.deepEqual(spec.nodes.map(n=>[n.x,n.y]),widget.nodes.map(n=>[n.x,n.y]));
  assert.deepEqual(W.normalize(spec),spec);
 }
 const {c,message}=context(async()=>reply);
 await c.finalizeMessageWidgets(message,'Show BFS');
 assert.equal(message.artifacts.length,9);assert.equal(message.widgetError,undefined);
});
test('label growth retains collision rejection and text size limits',()=>{
 const base={kind:'diagram',width:600,height:400,nodes:[{id:'v',label:'Visited: {A,B,C,D,E,F}',x:200,y:200,width:160,height:40}]};
 assert.equal(W.normalize(base).nodes[0].height,45);
 assert.throws(()=>W.normalize({...base,nodes:[...base.nodes,{id:'b',label:'B',x:200,y:243,width:100,height:44}]}),/overlap/);
 assert.throws(()=>W.normalize({...base,nodes:[{...base.nodes[0],width:28,label:'x'.repeat(240)}]}),/label.*does not fit/);
});
test('a last-step diagram at end of text and bold final headings do not cause duplicate completion',()=>{
 const {c}=context(()=>{}),spec=original.artifacts[0].spec;
 const text='### **Step 1: Start**\n'+fence(spec)+'\n### **Step 2: End**\n'+fence(spec);
 assert.equal(c.missingDiagramSteps(W.extract(text),'Graph step by step').length,0);
 const bold='**Step 1: Start**\n'+fence(spec)+'\n**Step 2: Visit B**\n'+fence(spec)+'\n**Step 3: Visit C**\nProse\n**Final tree**\n'+fence(spec);
 assert.equal(c.missingDiagramSteps(W.extract(bold),'Show BFS').length,1);
});
test('all visual snapshots remain present during finalization and cancellation',async()=>{
 const {c,message}=context(()=>{throw Error('Unexpected model call');});
 const spec=original.artifacts[0].spec,controller=new AbortController();
 message.text=Array.from({length:6},(_,i)=>'Snapshot '+i+'\n'+fence(spec)).join('\n');
 c.OrbitWidgets={...W,generate:async()=>{
  assert.equal(message.artifacts.length,6);controller.abort();return new Blob(['svg']);
 }};
 await c.finalizeMessageWidgets(message,'Show graph',controller.signal);
 assert.equal(message.artifacts.length,6);assert.ok(message.artifacts.every(a=>a.spec.kind==='diagram'));
});

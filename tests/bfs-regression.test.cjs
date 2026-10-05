const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../widgets.js');
const base={kind:'diagram',title:'BFS Step 1',width:600,height:450,nodes:[['a',300,100],['b',200,250],['c',400,250],['d',100,350],['e',300,350],['f',500,350]].map(([id,x,y])=>({id,label:id.toUpperCase(),x,y,shape:'circle'})),edges:[['a','b'],['a','c'],['b','d'],['b','e'],['c','f']].map(([from,to])=>({from,to,arrow:'none',dashed:true}))};
const steps=[0,1,2].map((step)=>({...structuredClone(base),title:`BFS Step ${step+1}`,edges:base.edges.map((e,i)=>({...e,dashed:step===0 || (step===1&&i>1)}))}));
const tag=(s,name='Orbit widget')=>`<${name}>\n${JSON.stringify(s)}\n</${name}>`;
const context=(message,reply)=>{const c=vm.createContext({OrbitWidgets:W,crypto:require('node:crypto').webcrypto,state:{models:[{key:'m'}],selectedModel:'m',messages:[message]},renderMessages(){},persistCurrentChat(){},requestLocalReply:reply});vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),c);return c;};
test('BFS tagged widgets stream and remain between three captions without JSON flashes',()=>{
 for(const name of ['Orbit widget','orbit-widget','orbit_widget']){
  const raw=steps.map((s,i)=>`Explain step ${i+1}\n${tag(s,name)}\nCaption ${i+1}`).join('\n')+'\nSummary';
  const parsed=W.extract(raw);assert.equal(parsed.artifacts.length,3);assert.deepEqual(parsed.errors,[]);
  parsed.positions.forEach((p,i)=>{assert.match(parsed.text.slice(0,p),new RegExp(`Explain step ${i+1}`));assert.ok(parsed.text.slice(p).startsWith('\nCaption'));});
  let previous=0;
  for(let i=1;i<=raw.length;i++){
   const p=W.extract(raw.slice(0,i));assert.ok(p.artifacts.length>=previous);previous=p.artifacts.length;
   const visible=W.streamingText(p.text);assert.doesNotMatch(visible,/<\/?orbit[ _-]?widget|"nodes"|"edges"|"kind"/i);
  }
 }
});
test('tag wrappers around JSON fences work, while code examples stay code',()=>{
 const raw='<orbit-widget>\n```json\n'+JSON.stringify(base)+'\n```\n</orbit-widget>';
 assert.equal(W.extract(raw).artifacts.length,1);
 const example='````html\n'+raw+'\n````';assert.equal(W.extract(example).text,example);assert.equal(W.extract(example).artifacts.length,0);
});
test('circle defaults and saved oversized BFS circles remain compact with unchanged centers',()=>{
 const defaults=W.normalize(base);assert.ok(defaults.nodes.every(n=>n.width===64&&n.height===64));
 const legacy=structuredClone(base);legacy.nodes.forEach(n=>{n.width=n.height=140;});
 const repaired=W.normalize(legacy);assert.ok(repaired.nodes.every(n=>n.width===64));assert.deepEqual(repaired.nodes.map(n=>[n.x,n.y]),legacy.nodes.map(n=>[n.x,n.y]));assert.deepEqual(W.normalize(repaired),repaired);
 const collision=structuredClone(base);collision.nodes[1].x=300;collision.nodes[1].y=100;assert.throws(()=>W.normalize(collision),/overlap/);
 const radius=structuredClone(base);radius.nodes[0].radius=24;assert.equal(W.normalize(radius).nodes[0].width,48);
});
test('repair preserves valid middle diagram and individually restores both invalid steps in place',async()=>{
 const drafts=steps.map((s,i)=>i===1?s:{...s,nodes:s.nodes.map(n=>({...n,color:'invalid'}))});
 const message={role:'assistant',text:drafts.map((s,i)=>`Explain ${i}\n${tag(s)}\nCaption ${i}`).join('\n')+'\nSummary'};
 let calls=0;
 const c=context(message,async(_,history)=>{calls++;const request=JSON.parse(history[1].text);assert.deepEqual(request.slots.map(s=>s.index),[0,2]);return {text:JSON.stringify({repairs:[{index:2,widget:steps[2]},{index:0,widget:steps[0]}]})};});
 await c.finalizeMessageWidgets(message,'Show BFS');assert.equal(calls,1);assert.equal(message.artifacts.length,3);assert.equal(message.widgetError,undefined);
 message.artifacts.forEach((a,i)=>{assert.equal(a.spec.title,steps[i].title);assert.ok(message.text.slice(a.position).startsWith('\nCaption '+i));});
});
test('all-invalid multi-step repair cannot silently collapse into one widget',async()=>{
 const drafts=steps.map(s=>({...s,nodes:[]}));
 for(const mode of ['all','collapsed','partial']){
  const message={role:'assistant',text:drafts.map((s,i)=>`Explain ${i}\n${tag(s)}\nCaption ${i}`).join('\n')};
  const c=context(message,async()=>({text:mode==='collapsed'?JSON.stringify(steps[0]):JSON.stringify({repairs:(mode==='partial'?steps.slice(0,1):steps).map((widget,index)=>({index,widget}))})}));
  await c.finalizeMessageWidgets(message,'Show BFS');assert.equal(message.artifacts.length,mode==='all'?3:mode==='partial'?1:0);assert.equal(!!message.widgetError,mode!=='all');assert.doesNotMatch(message.text,/<orbit|"nodes"/i);
 }
});
test('actual message renderer hides tool data during streaming, completion handoff and repair',()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const ctx=vm.createContext({OrbitWidgets:W,window:{katex:require('../vendor/katex/katex.min.js')},icons:{copy:''},state:{currentChat:'bfs'},crypto:require('node:crypto').webcrypto});
 require('./interaction-harness.cjs')(ctx);
 vm.runInContext(source.slice(source.indexOf('function escapeHtml('),source.indexOf('function latestUserMessageIndex(')),ctx);
 vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);vm.runInContext('attachmentFileKind=()=>({});',ctx);
 const raw=steps.map((s,i)=>`Stage ${i}\n${tag(s)}\nExplanation ${i}`).join('\n');
 for(const flags of [{generating:true},{generating:false},{widgetStatus:'Repairing diagrams…'}]){
  const html=ctx.messageContentMarkup({role:'assistant',text:raw,...flags},0);
  assert.equal((html.match(/class="orbit-diagram"/g)||[]).length,3);assert.doesNotMatch(html,/&lt;Orbit|"kind"|&quot;kind|"nodes"|&quot;nodes|language-json/);
  assert.ok(html.indexOf('BFS Step 1')<html.indexOf('Explanation 0'));assert.ok(html.indexOf('Explanation 0')<html.indexOf('BFS Step 2'));
 }
 const html=ctx.messageContentMarkup({role:'assistant',text:'Intro\n'+tag({...base,nodes:[]}),widgetStatus:'Repairing diagrams…'},0);
 assert.doesNotMatch(html,/&lt;Orbit|"nodes"|&quot;nodes/);assert.match(html,/Repairing diagrams/);
});
test('nodes on canvas boundaries remain intact through automatic padding',()=>{
 const s=structuredClone(base);s.nodes[3].y=s.height;s.nodes[5].x=s.width;
 const normalized=W.normalize(s);assert.deepEqual(normalized.nodes.map(n=>[n.x,n.y]),s.nodes.map(n=>[n.x,n.y]));
 const svg=W.diagramSvg(s);assert.match(svg,/viewBox="-12 52 656 446"/);assert.doesNotMatch(svg,/NaN/);
});
test('repair batch accepts provider-added prose/fences without executing or losing indexed entries',async()=>{
 const data={repairs:steps.map((widget,index)=>({index,widget}))};
 for(const wrapper of [x=>JSON.stringify(x),x=>'Repairing now.\n```orbit-widget\n'+JSON.stringify(x)+'\n```',x=>'```json\n'+JSON.stringify(x)+'\n```',x=>'Here is the repair: '+JSON.stringify(x)]){
  const message={role:'assistant',text:steps.map(s=>tag({...s,nodes:[]})).join('\n')};const c=context(message,async()=>({text:wrapper(data)}));await c.finalizeMessageWidgets(message,'Show BFS');assert.equal(message.artifacts.length,3);assert.equal(message.widgetError,undefined);
 }
});
test('only complete indexed JSON repairs survive a malformed batch envelope',()=>{
 const c=context({},()=>{}),one=JSON.stringify({index:0,widget:steps[0]}),two=JSON.stringify({index:2,widget:steps[2]});
 const malformed='Here:\n```orbit-widget\n{"repairs":['+one+'},'+two+']}\n```';
 assert.deepEqual(Array.from(c.widgetRepairEntries(malformed),e=>e.index),[0,2]);
 assert.equal(c.widgetRepairEntries('{"repairs":['+one+',{"index":2,"widget":').length,1);
 assert.equal(c.widgetRepairEntries('Unrelated '+one).length,0);
});
test('tag markers followed by JSON fences do not swallow later steps when end tags are omitted',()=>{
 const raw=steps.map((s,i)=>`Explain ${i}\n<Orbit widget>\n\`\`\`json\n${JSON.stringify(s)}\n\`\`\`\nCaption ${i}`).join('\n');
 const p=W.extract(raw);assert.equal(p.artifacts.length,3);assert.deepEqual(p.errors,[]);assert.match(p.text,/Caption 0[\s\S]*Caption 1[\s\S]*Caption 2/);
 for(let end=1;end<=raw.length;end+=13)assert.doesNotMatch(W.streamingText(raw.slice(0,end)),/<Orbit widget>|"nodes"|"kind"/);
});

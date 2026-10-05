const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const W=require('../widgets.js'),F=require('./fixtures/diagrams.cjs');
const fence=s=>'```orbit-widget\n'+JSON.stringify(s)+'\n```';
test('all diagram families preserve explicit coordinates and survive saved JSON',async()=>{
 for(const spec of F.all){const normalized=W.normalize(spec);assert.deepEqual(W.normalize(JSON.parse(JSON.stringify(normalized))),normalized);assert.deepEqual(normalized.nodes.map(n=>[n.x,n.y]),spec.nodes.map(n=>[n.x,n.y]));const svg=W.diagramSvg(spec);assert.doesNotMatch(svg,/NaN|Infinity|undefined|<script/);assert.match(svg,/role="img"/);assert.equal((await W.generate(spec)).type,'image/svg+xml');assert.match(W.filename(spec),/\.svg$/);}
});
test('triangle is a triangle; self loops, waypoints, labels and bidirectional edges render',()=>{
 const svg=W.diagramSvg(F.triangle);assert.match(svg,/cx="300" cy="65"/);assert.match(svg,/cx="120" cy="265"/);assert.match(svg,/cx="480" cy="265"/);
 const state=W.diagramSvg(F.state);for(const label of ['retry','reset','finish'])assert.match(state,new RegExp(label));assert.match(state,/L600 230 L100 230/);
 assert.match(W.diagramSvg(F.architecture),/stroke-dasharray/);
});
test('invalid IDs, missing endpoints, coordinates, colors, dimensions and overflowing labels are rejected',()=>{
 for(const mutate of [s=>s.nodes.push(s.nodes[0]),s=>s.edges.push({from:'missing',to:'a'}),s=>s.nodes[0].x=Infinity,s=>s.nodes[0].x=-1,s=>s.nodes[0].color='url(javascript:x)',s=>s.nodes[0].shape='html',s=>s.nodes[0].label='x'.repeat(200),s=>s.edges[0].points=[{x:9999,y:0}],s=>s.edges[0].arrow='code',s=>s.groups=[{x:599,y:1,width:80,height:80}]]){const spec=structuredClone(F.triangle);mutate(spec);assert.throws(()=>W.normalize(spec));}
});
test('diagram labels are inert and Unicode/newlines remain readable',()=>{
 const spec={kind:'diagram',title:'<script>alert(1)</script>',width:600,height:240,nodes:[{id:'a',label:'தமிழ் 😀\n<svg onload=x>',x:300,y:120,width:360,height:100}],edges:[{from:'a',to:'a',label:'<img onerror=x>'}]};const svg=W.diagramSvg(spec);assert.doesNotMatch(svg,/<script|<img|onload="|href=/);assert.match(svg,/தமிழ்/);assert.match(svg,/&lt;svg/);
});
test('32 diagram steps remain ordered and positioned; excess fails explicitly',()=>{
 const specs=Array.from({length:32},(_,i)=>({...F.triangle,title:'Step '+(i+1)}));const reply=specs.map((s,i)=>'Explain '+i+'\n'+fence(s)).join('\n')+'\nConclusion';const parsed=W.extract(reply);assert.equal(parsed.artifacts.length,32);assert.deepEqual(parsed.errors,[]);assert.ok(parsed.positions.every((v,i)=>!i||v>parsed.positions[i-1]));assert.match(parsed.text,/Conclusion/);
 assert.equal(W.extract(reply+'\n'+fence(F.triangle)).errors.length,1);
 for(let end=1;end<reply.length;end+=197)assert.doesNotMatch(W.streamingText(reply.slice(0,end)),/"nodes"|"edges"/);
 assert.equal(W.streamingStatus('Step\n```orbit-widget\n{"kind":"diagram","nodes":['),'Preparing diagram');
});
test('diagram finalization does not add a file-completion message or lose steps at export',async()=>{
 const message={role:'assistant',text:F.trees.map((s,i)=>'Step '+i+'\n'+fence(s)).join('\n')+'\nFinished explanation.'};const ctx=vm.createContext({OrbitWidgets:W,crypto:require('node:crypto').webcrypto,state:{models:[{key:'m'}],selectedModel:'m',messages:[message]},renderMessages(){},persistCurrentChat(){},escapeHtml:W.escape,attachmentFileKind:()=>({})});vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
 await ctx.finalizeMessageWidgets(message,'Show each insertion');assert.equal(message.artifacts.length,16);assert.equal(ctx.normalizedWidgetArtifacts(JSON.parse(JSON.stringify(message.artifacts))).length,16);assert.doesNotMatch(message.text,/file is ready|couldn’t/);assert.match(message.text,/Finished explanation/);const html=ctx.widgetMarkup(message,0);assert.equal((html.match(/class="orbit-diagram"/g)||[]).length,16);
});
test('diagrams are enabled for existing settings, can be disabled, and models receive step/layout instructions',()=>{
 let stored='{"pdf":false}';global.localStorage={getItem:()=>stored,setItem:(k,v)=>stored=v};try{assert.equal(W.settings().diagram,true);assert.match(W.instruction(),/CENTER x\/y/);assert.match(W.instruction(),/32 diagram/);W.setEnabled('diagram',false);assert.equal(W.extract(fence(F.triangle)).artifacts.length,0);}finally{delete global.localStorage;}
});
test('edge labels wrap safely at canvas borders and self loops work at each corner',()=>{
 for(const [x,y] of [[32,32],[568,32],[32,308],[568,308]]){
  const spec={kind:'diagram',title:'Corner',width:600,height:340,nodes:[{id:'a',label:'A',x,y,width:64,shape:'circle'}],edges:[{from:'a',to:'a',label:'A long transition label that must wrap and remain visible',labelPosition:{x:0,y:0}}]};
  const svg=W.diagramSvg(spec);assert.doesNotMatch(svg,/NaN|Infinity/);assert.ok((svg.match(/<tspan/g)||[]).length>2);assert.match(svg,/stroke-linejoin="round"/);
 }
 const spec=structuredClone(F.architecture);spec.groups[0].label='x'.repeat(100);assert.throws(()=>W.normalize(spec),/group title/);
});

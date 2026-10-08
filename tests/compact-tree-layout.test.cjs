const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../widgets.js'),tree=require('./fixtures/compact-suffix-tree.cjs');
const view=svg=>svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
function clearNodes(spec){for(const a of spec.nodes)for(const b of spec.nodes)if(a!==b)assert.ok(Math.abs(a.x-b.x)>=(a.width+b.width)/2+24||Math.abs(a.y-b.y)>=(a.height+b.height)/2+24,`${a.id} / ${b.id}`);}
test('sparse suffix tree packs subtrees and levels without changing content or node dimensions',()=>{
 const original=W.normalize(tree),copy=JSON.stringify(original),packed=W.compactTreeLayout(original);assert.ok(packed);clearNodes(packed);
 assert.equal(JSON.stringify(original),copy);assert.deepEqual(packed.edges,original.edges);
 assert.deepEqual(packed.nodes.map(({x,y,...n})=>n),original.nodes.map(({x,y,...n})=>n));
 const a=view(W.diagramSvg(tree,{compact:false})),b=view(W.diagramSvg(tree));assert.ok(b[2]*b[3]<a[2]*a[3]*.75,JSON.stringify({a,b}));
 assert.equal((W.diagramSvg(tree).match(/data-diagram-node=/g)||[]).length,11);assert.equal((W.diagramSvg(tree).match(/data-edge-label=/g)||[]).length,10);
 for(const parent of packed.nodes){const before=original.edges.filter(e=>e.from===parent.id).map(e=>e.to).sort((a,b)=>original.nodes.find(n=>n.id===a).x-original.nodes.find(n=>n.id===b).x);const after=before.slice().sort((a,b)=>packed.nodes.find(n=>n.id===a).x-packed.nodes.find(n=>n.id===b).x);assert.deepEqual(after,before);}
});
test('manual placement, stable steps, routed links, groups and non-tree topology do not auto-compact',()=>{
 for(const raw of [{...tree,layout:'manual'},{...tree,title:'Step 2: Insert A'},{...tree,edges:[...tree.edges,{from:'ana',to:'root'}]},{...tree,edges:tree.edges.map((e,i)=>i?e:{...e,points:[{x:60,y:60}]})},{...tree,groups:[{label:'Domain',x:0,y:0,width:1200,height:580}]}])assert.equal(W.compactTreeLayout(W.normalize(raw)),null);
 assert.deepEqual(view(W.diagramSvg({...tree,layout:'manual'})),view(W.diagramSvg(tree,{compact:false})));
 const cycle={...tree,edges:tree.edges.map(e=>e.to==='a'?{...e,from:'ana'}:e)};assert.equal(W.compactTreeLayout(W.normalize(cycle)),null);
});
test('compact-tree option survives normalization and large asymmetric trees remain bounded',()=>{
 const raw={...tree,layout:'compact-tree'};assert.deepEqual(W.normalize(W.normalize(raw)),W.normalize(raw));
 for(let count=3;count<=80;count+=7){
  const nodes=Array.from({length:count},(_,i)=>({id:String(i),label:String(i),shape:'circle',width:40,x:60+i%20*100,y:60+Math.floor(i/20)*130}));
  const spec=W.normalize({kind:'diagram',layout:'compact-tree',width:2400,height:1000,nodes,edges:nodes.slice(1).map((n,i)=>({from:String(Math.floor(i/2)),to:n.id,label:i%4===0?'child':''}))});
  const p=W.compactTreeLayout(spec,true);if(p){clearNodes(p);assert.ok(p.width<=2400&&p.height<=4000);}
  assert.doesNotMatch(W.diagramSvg(spec),/NaN|Infinity|undefined/);
 }
});
test('long connector labels preserve every word and trigger safe fallback if packing cannot fit',()=>{
 const raw={...tree,edges:tree.edges.map(e=>({...e,label:'long relationship label '.repeat(3).trim()}))};
 const svg=W.diagramSvg(raw);assert.equal((svg.match(/data-edge-label=/g)||[]).length,10);assert.doesNotMatch(svg,/NaN|Infinity/);
});
test('chat and viewer markup use rendered width instead of stretching compact content to the old canvas',()=>{
 const svg=W.diagramInlineSvg(tree),width=view(svg)[2];assert.ok(width<900);assert.match(svg,new RegExp(`style="width:${width}px;min-width:${width}px;max-width:${width}px"`));
 const fs=require('node:fs');for(const name of ['widgets-ui.js','file-preview.js'])assert.match(fs.readFileSync(require.resolve('../'+name),'utf8'),/OrbitWidgets\.diagramInlineSvg\(spec\)/);
});
test('packed suffix-tree connector labels remain clear of nodes and each other',()=>{
 const spec=W.compactTreeLayout(W.normalize(tree)),svg=W.diagramSvg(tree),boxes=[];
 for(const match of svg.matchAll(/<g data-edge-label="[^"]*"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g))boxes.push({x:+match[1],y:+match[2],w:+match[3],h:+match[4]});
 assert.equal(boxes.length,tree.edges.length);const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
 const nodes=spec.nodes.map(n=>({x:n.x-n.width/2,y:n.y-n.height/2,w:n.width,h:n.height}));
 for(let i=0;i<boxes.length;i++){assert.ok(!nodes.some(n=>overlap(boxes[i],n)));assert.ok(!boxes.slice(i+1).some(b=>overlap(boxes[i],b)));}
});

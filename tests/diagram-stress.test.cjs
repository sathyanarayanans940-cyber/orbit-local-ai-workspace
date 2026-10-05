const {test}=require('node:test');
const assert=require('node:assert/strict');
const W=require('../widgets.js');
const cases=require('./fixtures/diagram-stress.cjs');
const fixture=id=>structuredClone(cases.find(c=>c.id===id).spec);
const fence=spec=>'```orbit-widget\n'+JSON.stringify(spec)+'\n```';
const paths=svg=>[...svg.matchAll(/data-diagram-edge="\d+" d="([^"]+)"/g)].map(m=>m[1]);
for(const {id,spec} of cases)test(`stress diagram ${id}: complete, finite, stable after save/load`,()=>{
 const normalized=W.normalize(spec),svg=W.diagramSvg(normalized);
 assert.deepEqual(W.normalize(JSON.parse(JSON.stringify(normalized))),normalized);
 assert.equal((svg.match(/data-diagram-node=/g)||[]).length,spec.nodes.length);
 assert.equal(paths(svg).length,spec.edges.length);
 assert.equal((svg.match(/data-diagram-group=/g)||[]).length,spec.groups?.length||0);
 assert.doesNotMatch(svg,/NaN|Infinity|<script>|<foreignObject|onload=/);
 assert.deepEqual(normalized.nodes.map(n=>[n.id,n.x,n.y]),spec.nodes.map(n=>[n.id,n.x,n.y]));
 for(const [i,e] of spec.edges.entries())if(e.points)assert.deepEqual(normalized.edges[i].points,e.points);
});
test('nested architecture groups paint parents before children regardless of recipe order',()=>{
 const svg=W.diagramSvg(fixture('nested'));
 const groups=[...svg.matchAll(/data-diagram-group="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(groups,['Cloud account','Private network','Data subnet']);
});
test('parallel and opposing edges, repeated self-loops remain separate without moving nodes',()=>{
 for(const id of ['parallel','loops']){
  const spec=fixture(id),routes=paths(W.diagramSvg(spec));
  assert.equal(new Set(routes).size,spec.edges.length);
 }
 const explicit=fixture('parallel');explicit.edges[0].points=[{x:200,y:70},{x:800,y:70}];
 assert.match(paths(W.diagramSvg(explicit))[0],/L200 70 L800 70/);
 assert.doesNotMatch(paths(W.diagramSvg(explicit))[0],/Q/);
});
test('crossing labels occupy separate positions along their connections; fixed labels stay fixed',()=>{
 const spec=fixture('label-crossing'),svg=W.diagramSvg(spec);
 const boxes=[...svg.matchAll(/data-edge-label="[^"]+"><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map(m=>m.slice(1).map(Number));
 assert.equal(boxes.length,2);
 const [a,b]=boxes;assert.ok(a[0]+a[2]<=b[0]||b[0]+b[2]<=a[0]||a[1]+a[3]<=b[1]||b[1]+b[3]<=a[1]);
 spec.edges[0].labelPosition={x:410,y:220};
 assert.match(W.diagramSvg(spec),/<tspan x="410" y="212">Authenticated HTTPS/);
 assert.match(W.diagramSvg(fixture('maximum')),/data-label-leader=/);
});
test('narrow labels never split emoji families, flags, skin tones or combining accents',()=>{
 const spec=fixture('graphemes'),svg=W.diagramSvg(spec);
 const rendered=[...svg.matchAll(/data-diagram-node="[^"]+">([\s\S]*?)<\/text><\/g>/g)].map(m=>[...m[1].matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map(m=>m[1]));
 const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 for(let i=0;i<spec.nodes.length;i++){
  assert.equal(rendered[i].join(''),spec.nodes[i].label);
  const expected=[...segmenter.segment(spec.nodes[i].label)].map(x=>x.segment);
  const actual=rendered[i].flatMap(line=>[...segmenter.segment(line)].map(x=>x.segment));
  assert.deepEqual(actual,expected);
 }
});
test('32 maximum diagrams survive extraction, streaming boundaries and save/load; 33rd is an explicit error',()=>{
 const spec=fixture('maximum');let text='';
 const started=performance.now();
 for(let i=0;i<32;i++){
  text+=`\n### Step ${i+1}\n`+fence({...spec,title:'Snapshot '+(i+1)});
  if([0,1,15,30,31].includes(i)){
   const partial=W.extract(text+'\n```orbit-widget\n{"kind":"diagram","nodes":[');
   assert.equal(partial.artifacts.length,i+1);
   assert.doesNotMatch(partial.text,/orbit-widget|"nodes"/);
  }
 }
 const complete=W.extract(text);assert.equal(complete.artifacts.length,32);assert.equal(complete.errors.length,0);
 const restored=JSON.parse(JSON.stringify(complete));
 for(let i=0;i<32;i++){
  assert.equal(restored.artifacts[i].title,'Snapshot '+(i+1));
  assert.equal(paths(W.diagramSvg(restored.artifacts[i])).length,160);
 }
 const extra=W.extract(text+'\n'+fence(spec));assert.equal(extra.artifacts.length,32);assert.match(extra.errors.join(' '),/32 diagrams/);
 assert.ok(performance.now()-started<10000,'bounded 32-diagram workload must finish within 10 seconds');
});
test('malformed and over-limit diagrams fail clearly while neighboring valid snapshots survive',()=>{
 const max=fixture('maximum');
 const bad=[{...max,nodes:[...max.nodes,{...max.nodes[0],id:'extra'}]}, {...max,edges:[...max.edges,max.edges[0]]}, {...max,groups:[...max.groups,max.groups[0]]}, {...max,width:2401}, {...max,height:4001}, {...max,nodes:[]}, {...max,nodes:[{...max.nodes[0],x:NaN}]}, {...max,edges:[{from:'missing',to:'n0'}]}, {...max,nodes:[max.nodes[0],max.nodes[0]]}, {...max,edges:[{from:'n0',to:'n1',points:Array(13).fill({x:10,y:10})}]}, {...max,title:'x'.repeat(240001)}];
 for(const spec of bad){
  assert.throws(()=>W.normalize(spec));
  const result=W.extract(fence(fixture('parallel'))+'\n'+fence(spec)+'\n'+fence(fixture('loops')));
  assert.equal(result.artifacts.length,2);assert.ok(result.errors.length);
 }
});
test('adversarial repeated edges and self-loops stay finite and bounded at 160 edges',()=>{
 for(const loops of [false,true]){
  const spec=fixture('parallel');spec.edges=Array.from({length:160},(_,i)=>({from:'a',to:loops?'a':'b',label:'edge '+i}));
  const start=performance.now(),svg=W.diagramSvg(spec),routes=paths(svg);
  assert.equal(routes.length,160);assert.equal(new Set(routes).size,160);assert.doesNotMatch(svg,/NaN|Infinity/);
  assert.ok(svg.length<250000);assert.ok(performance.now()-start<2000);
 }
});

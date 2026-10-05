const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../widgets.js'),fixtures=require('./fixtures/diagram-notation.cjs');
for(const [name,spec] of Object.entries(fixtures))test(name+' round-trips and exports all notation',async()=>{
 const n=W.normalize(spec);assert.deepEqual(W.normalize(JSON.parse(JSON.stringify(n))),n);
 const svg=W.diagramSvg(n);assert.doesNotMatch(svg,/NaN|Infinity|undefined|<script>/);assert.equal((svg.match(/data-diagram-node=/g)||[]).length,spec.nodes.length);
 for(const node of spec.nodes){if(node.fill)assert.ok(svg.includes(`data-node-fill="${node.fill}"`));for(const a of node.attributes||[])assert.ok(svg.includes(`data-entity-attribute="${W.escape(a)}"`));}
 assert.equal((svg.match(/data-cardinality=/g)||[]).length,spec.edges.reduce((n,e)=>n+!!e.fromCardinality+!!e.toCardinality,0));
 assert.doesNotMatch(await (await W.generate(n)).text(),/var\(/);
});
test('fills are opt-in, theme-safe tints and reject executable input',()=>{
 const s=structuredClone(fixtures.er);s.nodes.forEach(n=>delete n.fill);assert.doesNotMatch(W.diagramSvg(s),/data-node-fill/);
 s.nodes[0].fill='accent';assert.match(W.diagramSvg(s),/fill-opacity=".18"/);
 s.nodes[0].fill='url(https://example.com)';assert.throws(()=>W.normalize(s),/colors/);
});
test('invalid attributes, cardinalities and labeled activity controls fail explicitly',()=>{
 const s=structuredClone(fixtures.er);s.nodes[0].attributes=Array(13).fill('field');assert.throws(()=>W.normalize(s),/12 attribute/);
 const e=structuredClone(fixtures.er);e.edges[0].toCardinality='many';assert.throws(()=>W.normalize(e),/cardinality/);
 const a=structuredClone(fixtures.activity);a.nodes[0].label='Start';assert.throws(()=>W.normalize(a),/unlabeled/);
});
test('horizontal and vertical control bars retain thin geometry and circles retain diameter',()=>{
 const spec={kind:'diagram',width:400,height:400,nodes:[{id:'fork',shape:'fork',x:100,y:100,width:8,height:150},{id:'join',shape:'join',x:300,y:100,width:8,height:150},{id:'initial',shape:'initial',x:100,y:300},{id:'final',shape:'final',x:300,y:300}],edges:[]};
 const n=W.normalize(spec);assert.equal(n.nodes[0].width,8);assert.equal(n.nodes[2].height,28);assert.match(W.diagramSvg(n),/r="8"/);
});

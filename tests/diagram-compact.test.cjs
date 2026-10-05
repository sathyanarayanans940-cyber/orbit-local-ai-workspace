const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../widgets.js');
const box=svg=>svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
test('large empty canvas margins are trimmed without moving nodes',()=>{
 const s={kind:'diagram',width:800,height:1600,nodes:[{id:'a',label:'A',shape:'circle',width:64,x:400,y:600}],edges:[]};
 const svg=W.diagramSvg(s),b=box(svg);assert.equal(b[1],552);assert.equal(b[3],96);assert.match(svg,/cy="600"/);
});
test('cropping retains group boundaries, edge waypoints and loop labels',()=>{
 const s={kind:'diagram',width:800,height:1600,groups:[{label:'Lane',x:10,y:200,width:700,height:900}],nodes:[{id:'a',label:'A',x:200,y:400},{id:'b',label:'B',x:600,y:400}],edges:[{from:'a',to:'b',points:[{x:200,y:1400},{x:600,y:1400}]},{from:'a',to:'a',label:'repeat'}]};
 const b=box(W.diagramSvg(s));assert.ok(b[1]<=184);assert.ok(b[1]+b[3]>=1416);
});

test('embedded diagrams center asymmetric canvas space without enlarging the figure or moving its nodes',()=>{
 const s={kind:'diagram',title:'Off-center content',width:1800,height:400,nodes:[{id:'a',label:'A',x:100,y:100,shape:'circle'},{id:'b',label:'B',x:400,y:100,shape:'circle'}],edges:[{from:'a',to:'b'}],groups:[{label:'Group',x:40,y:30,width:440,height:160}]};
 const normal=box(W.diagramSvg(s)),tight=box(W.diagramSvg(s,{centerContent:true}));assert.equal(tight[2],normal[2]);assert.equal(tight[0]+tight[2]/2,260);assert.ok(tight[0]<=24);assert.ok(tight[0]+tight[2]>=496);assert.match(W.diagramSvg(s,{centerContent:true}),/cx="100" cy="100"/);
});

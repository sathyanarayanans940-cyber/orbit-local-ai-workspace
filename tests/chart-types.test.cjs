const {test}=require('node:test');const assert=require('node:assert/strict');const W=require('../widgets.js');
const examples=[
{chartType:'scatter',title:'Height and weight',x:[150,158,170,172,190],series:[{name:'People',values:[48,54,68,64,90]}],xLabel:'Height (cm)',unit:'Weight (kg)'},
{chartType:'curve',title:'Sampled wave',x:[0,1,2,3,4,5,6],series:[{name:'Amplitude',values:[0,.84,.91,.14,-.76,-.96,-.28]}],xLabel:'Time (s)'},
{chartType:'box',title:'Delivery time distribution',labels:['North','South','West'],series:[{name:'Days',samples:[[1,2,3,3,4,5,20],[2,3,4,5,6,7],[1,1,2,3,4,6]]}]},
...['area','doughnut','bar','line','pie'].map(chartType=>({chartType,title:chartType+' example',labels:['Jan','Feb','Mar','Apr'],series:[{name:'Sales',values:[4,9,6,12]}]}))
].map(s=>({kind:'chart',...s}));
test('all eight chart types render finite SVG and survive persistence',()=>{for(const spec of examples){const normalized=W.normalize(spec);assert.deepEqual(W.normalize(JSON.parse(JSON.stringify(normalized))),normalized);const svg=W.chartSvg(normalized);assert.ok(svg.includes('<svg'));assert.ok(!/NaN|Infinity|undefined/.test(svg));}});
test('box quartiles and outliers use raw samples',()=>{assert.deepEqual(W.boxStats([1,2,3,4,5,6,100]),{q1:2.5,median:4,q3:5.5,min:1,max:6,outliers:[100]});});
test('numeric axes reject invalid/missing data and unsorted curves',()=>{for(const x of [[0,0,2],[3,2,1],[0,Infinity,2]])assert.throws(()=>W.normalize({...examples[1],x,series:[{values:[1,2,3]}]}));assert.throws(()=>W.normalize({...examples[0],x:undefined}));});
test('constant values, single points, negative values and escaped labels render safely',()=>{for(const spec of [{...examples[0],x:[1],series:[{values:[0]}]},{...examples[1],x:[1],series:[{values:[-4]}]},{...examples[2],labels:['<script>'],series:[{samples:[[3,3,3]]}]}]){const svg=W.chartSvg(spec);assert.ok(!/NaN|Infinity|<script>/.test(svg));}});
test('box rejects empty groups and doughnut rejects negative slices',()=>{assert.throws(()=>W.normalize({...examples[2],series:[{samples:[[],[1],[2]]}]}));assert.throws(()=>W.normalize({...examples[4],series:[{values:[1,-2,3,4]}]}));});
module.exports=examples;

test('new types extract inline in order and hide partial recipes',()=>{const reply='Before\n```orbit-widget\n'+JSON.stringify(examples[0])+'\n```\nBetween\n```orbit-widget\n'+JSON.stringify(examples[2])+'\n```\nAfter'; const result=W.extract(reply);assert.deepEqual(result.artifacts.map(s=>s.chartType),['scatter','box']);assert.ok(result.positions[1]>result.positions[0]);assert.equal(W.extract('Before\n```orbit-widget\n{"kind":"chart","chartType":"box"').artifacts.length,0);});
test('scatter accepts explicit numeric labels and paired coordinates without inventing data',()=>{
 const base={kind:'chart',chartType:'scatter',title:'Study sample'};
 for(const input of [
 {...base,labels:['1','2','3'],series:[{values:[45,60,72]}]},
 {...base,xValues:[1,2,3],series:[{values:[45,60,72]}]},
 {...base,series:[{points:[{x:1,y:45},{x:2,y:60},{x:3,y:72}]}]},
 {...base,series:[{data:[[1,45],[2,60],[3,72]]}]}
 ]){const n=W.normalize(input);assert.deepEqual(n.x,[1,2,3]);assert.deepEqual(n.series[0].values,[45,60,72]);assert.ok(!/NaN|undefined/.test(W.chartSvg(n)));}
 assert.throws(()=>W.normalize({...base,labels:['Alice','Bob'],series:[{values:[45,60]}]}),/numeric X/);
});
test('box followed by scatter with numeric labels preserves both inline charts',()=>{
 const box={kind:'chart',chartType:'box',title:'Marks',labels:['Marks'],series:[{samples:[[45,60,72]]}]};
 const scatter={kind:'chart',chartType:'scatter',title:'Study vs marks',labels:[1,2,3],series:[{values:[45,60,72]}]};
 const result=W.extract('Distribution\n```orbit-widget\n'+JSON.stringify(box)+'\n```\nRelationship\n```orbit-widget\n'+JSON.stringify(scatter)+'\n```');
 assert.equal(result.errors.length,0);assert.deepEqual(result.artifacts.map(s=>s.chartType),['box','scatter']);
});
test('curves stay finite with subnormal and nearly coincident coordinates',()=>{
 for(const x of [[0,1e-320,2e-320],[0,Number.MIN_VALUE,1],[1,1+Number.EPSILON,2],[-1e12,0,1e12]]){
  for(const values of [[0,1e12,0],[1e-320,2e-320,1e-320],[0,0,0],[-1e12,1e12,-1e12]]){
   const spec={kind:'chart',title:'Extreme curve',chartType:'curve',x,series:[{values}]};
   assert.doesNotMatch(W.chartSvg(spec),/NaN|Infinity|undefined/);
  }
 }
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../widgets.js'),C=require('../charts.js'),fixtures=require('./chart-expansion-fixtures.js');
const by=type=>fixtures.find(s=>s.chartType===type);
for(const spec of fixtures)test(spec.chartType+' validates, renders and survives a saved-chat round trip',async()=>{
 const n=W.normalize(spec);assert.deepEqual(W.normalize(JSON.parse(JSON.stringify(n))),n);
 const svg=W.chartSvg(n);assert.match(svg,/<svg/);assert.match(svg,/<desc>/);assert.doesNotMatch(svg,/NaN|Infinity|undefined|<script|onload=/);
 const data=W.chartData(n);assert.ok(data.rows.length);assert.ok(data.rows.every(row=>row.length===data.headers.length));
 const reply='Before\n```orbit-widget\n'+JSON.stringify(spec)+'\n```\nAfter';assert.equal(W.extract(reply).artifacts.length,1);
 assert.equal(await (await W.generate(n)).text(),svg);
});
test('Gantt validates UTC dates, year boundaries, numeric schedules and milestones',()=>{
 for(const tasks of [[{label:'Leap day',start:'2028-02-29',end:'2028-03-01'}],[{label:'Year boundary',start:'2026-12-31',end:'2027-01-02'}],[{label:'Milestone',start:-1,end:-1},{label:'Tiny',start:0,end:Number.MIN_VALUE}]])assert.doesNotMatch(W.chartSvg({...by('gantt'),tasks}),/NaN|Infinity/);
 for(const tasks of [[{label:'Wrong date',start:'2026-02-29',end:'2026-03-01'}],[{label:'Wrong day',start:'2026-04-31',end:'2026-05-01'}],[{label:'Backwards',start:3,end:2}],[{label:'Mixed',start:1,end:'2026-10-03'}],[{label:'A',start:1,end:2},{label:'B',start:'2026-10-03',end:'2026-10-04'}],[{label:'Infinity',start:Infinity,end:Infinity}],[{label:'Bad progress',start:1,end:2,progress:101}],[{label:'Missing end',start:1}]])assert.throws(()=>W.normalize({...by('gantt'),tasks}));
 assert.match(W.chartSvg({...by('gantt'),tasks:[{label:'Milestone',start:1,end:1}]}),/l 5 5 -5 5 -5 -5 Z/);
});
test('histogram counts duplicates, maximum boundary, constant and subnormal samples exactly',()=>{
 for(const samples of [[1,1,1],[0,1,2,3,4],[-1e12,1e12],[0,Number.MIN_VALUE,1e-320]]){
  const spec=W.normalize({...by('histogram'),samples,bins:40}),bins=C.histogram(spec);
  assert.equal(bins.reduce((sum,b)=>sum+b.count,0),samples.length);assert.doesNotMatch(W.chartSvg(spec),/NaN|Infinity/);
 }
 assert.deepEqual(C.histogram(W.normalize({...by('histogram'),samples:[4,4,4]})),[{start:4,end:4,count:3}]);
 const tiny=C.histogram(W.normalize({...by('histogram'),samples:[0,Number.MIN_VALUE],bins:40}));assert.equal(tiny.length,1);assert.ok(tiny.every(b=>b.start<b.end));
 for(const bins of [0,41,2.5,'3'])assert.throws(()=>W.normalize({...by('histogram'),bins}));
 assert.throws(()=>W.normalize({...by('histogram'),samples:Array(2001).fill(1)}));
});
test('heatmap keeps missing cells distinct from zeros and rejects ragged or empty matrices',()=>{
 const n=W.normalize({...by('heatmap'),labels:['A','B'],rowLabels:['C'],values:[[0,null]]});
 assert.deepEqual(W.chartData(n).rows,[['C',0,'Missing']]);assert.match(W.chartSvg(n),/Missing/);
 for(const values of [[[1]],[[1,2],[3,4]],[[null,null]],[[NaN,0]]])assert.throws(()=>W.normalize({...n,values}));
 assert.doesNotMatch(W.chartSvg({...n,values:[[-1e12,1e12]]}),/NaN|Infinity/);
});
test('stacked negative values diverge from zero; percentages preserve raw data and zero categories',()=>{
 const n=W.normalize({...by('stacked-bar'),labels:['Mixed'],series:[{name:'A',values:[-4]},{name:'B',values:[3]},{name:'C',values:[-2]}]});
 assert.doesNotMatch(W.chartSvg(n),/NaN|Infinity/);assert.match(W.chartSvg(n),/>-6<|>-6\.0</);
 const p=W.normalize({...by('percent-bar'),labels:['Zero','Mixed'],series:[{name:'A',values:[0,25]},{name:'B',values:[0,75]}]});
 assert.deepEqual(W.chartData(p).rows,[['Zero',0,0],['Mixed',25,75]]);assert.match(W.chartSvg(p),/25%/);assert.doesNotMatch(W.chartSvg(p),/NaN|Infinity/);
 for(const chartType of ['percent-bar','stacked-area','radar','funnel'])assert.throws(()=>W.normalize({...n,chartType}));
});
test('bubble area scales with size, zero bubbles are omitted, and no size is invented',()=>{
 const n=W.normalize({...by('bubble'),x:[1,2,3],series:[{name:'A',values:[5,5,5],sizes:[1,4,0]}]}),svg=W.chartSvg(n);
 assert.match(svg,/r="12"/);assert.match(svg,/r="24"/);assert.equal((svg.match(/<circle/g)||[]).length,2);
 for(const sizes of [[1],[1,-1,1],[0,0,0],undefined])assert.throws(()=>W.normalize({...n,series:[{name:'A',values:[5,5,5],sizes}]}));
});
test('waterfall total is not counted twice and incorrect or duplicate totals fail',()=>{
 const n=W.normalize(by('waterfall'));assert.match(W.chartSvg(n),/running total 120/);assert.doesNotMatch(W.chartSvg(n),/running total 240/);
 assert.throws(()=>W.normalize({...n,series:[{values:[100,50,-30,999]}]}));
 for(const totals of [[3,3],[4],[-1],[2.5]])assert.throws(()=>W.normalize({...n,totals}));
 assert.doesNotMatch(W.chartSvg({...n,labels:['Loss','More loss','Total'],series:[{values:[-4,-2,-6]}],totals:[2]}),/NaN|Infinity/);
});
test('funnel preserves stage order and radar rejects incompatible signed axes',()=>{
 assert.throws(()=>W.normalize({...by('funnel'),series:[{values:[1,2,3,4]}]}));
 assert.throws(()=>W.normalize({...by('funnel'),series:[{values:[0,0,0,0]}]}));
 assert.doesNotMatch(W.chartSvg({...by('funnel'),series:[{values:[10,10,0,0]}]}),/NaN|Infinity/);
 assert.throws(()=>W.normalize({...by('radar'),labels:['A','B'],series:[{values:[1,2]}]}));
});
test('treemap rejects cycles, missing parents, duplicate IDs, negative/absent leaves and inconsistent parent totals',()=>{
 const n=W.normalize(by('treemap'));assert.equal(W.chartData(n).rows.find(r=>r[1]==='files')[3],100);
 const cases=[[{id:'a',parent:'b',value:1},{id:'b',parent:'a',value:1}],[{id:'a',parent:'absent',value:1}],[{id:'a',value:1},{id:'a',value:2}],[{id:'a',value:-1}],[{id:'a'}],[{id:'a',value:0}],[{id:'a',value:99},{id:'b',parent:'a',value:1}]];
 for(const nodes of cases)assert.throws(()=>W.normalize({...n,nodes}));
 assert.throws(()=>W.normalize({...n,nodes:Array.from({length:9},(_,i)=>({id:String(i),parent:i?String(i-1):'',...(i===8?{value:1}:{})}))}));
 assert.throws(()=>W.normalize({...n,nodes:[{id:'a',value:2e-320},{id:'b',parent:'a',value:1e-320}]}));
});
test('all new charts escape every user-controlled label and never mutate source data',()=>{
 for(const input of fixtures){const spec=structuredClone(input),original=JSON.stringify(spec);spec.title='<script>unsafe & title</script>';spec.unit='" onload="bad';if(spec.labels)spec.labels=spec.labels.map(()=>'<img src=x>');if(spec.tasks)spec.tasks[0].label='<script>alert(1)</script>';if(spec.nodes)spec.nodes[0].label='<script>hi</script>';const snapshot=JSON.stringify(spec);assert.doesNotMatch(W.chartSvg(spec),/<script>|<img |onload="bad/);assert.equal(JSON.stringify(spec),snapshot);assert.equal(JSON.stringify(input),original);}
});
test('all new types withstand bounded maximum size, tiny and large values',()=>{
 const tasks=Array.from({length:40},(_,i)=>({label:'Task '+i,start:-1e12+i,end:1e12-i}));assert.doesNotMatch(W.chartSvg({...by('gantt'),tasks}),/NaN|Infinity/);
 for(const chartType of ['horizontal-bar','stacked-bar','percent-bar','stacked-area','step','radar','funnel']){
  const labels=Array(chartType==='radar'?12:40).fill('Category');
  for(const value of [0,Number.MIN_VALUE,1e-320,1e12]){
   if(chartType==='funnel'&&!value)continue;const series=Array.from({length:['funnel'].includes(chartType)?1:5},(_,i)=>({name:'Series '+i,values:labels.map(()=>value)}));
   assert.doesNotMatch(W.chartSvg({kind:'chart',title:'Extreme',chartType,labels,series}),/NaN|Infinity|undefined/);
  }
 }
 assert.doesNotMatch(W.chartSvg({...by('heatmap'),labels:Array(30).fill('Column'),rowLabels:Array(30).fill('Row'),values:Array.from({length:30},()=>Array(30).fill(Number.MIN_VALUE))}),/NaN|Infinity/);
});
test('chart schema availability follows enabled tool settings and packaging includes the new module',()=>{
 const ctx=vm.createContext({localStorage:{getItem:()=>'{"chart":false}'}});vm.runInContext(fs.readFileSync('widgets.js','utf8'),ctx);assert.match(ctx.OrbitWidgets.instructionFor('Solve this'),/Enabled kinds: pdf, docx, pptx, xlsx, diagram/);assert.doesNotMatch(ctx.OrbitWidgets.instructionFor('Create an Excel workbook'),/Chart schema:/);
 assert.match(W.instruction(),/Gantt schedule example/);
 for(const file of ['index.html','service-worker.js','scripts/package-release.py','scripts/update-installed-macos.command','install-macos.sh','install-windows.ps1'])assert.match(fs.readFileSync(file,'utf8'),/charts.js/);
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const W=require('../widgets.js');
const fixture=fs.readFileSync(__dirname+'/fixtures/mixed-code-charts.md','utf8');
const chart={kind:'chart',title:'Test',chartType:'line',labels:['A','B'],series:[{name:'Age',values:[30,37]}]};
const recipe=JSON.stringify(chart);
test('actual mixed R/chart reply recovers all four charts in original order',()=>{
 const result=W.extract(fixture);
 assert.equal(result.artifacts.length,4);
 assert.deepEqual(result.errors,[]);
 assert.deepEqual(result.artifacts.map(s=>s.chartType),['line','pie','bar','box']);
 assert.doesNotMatch(result.text,/orbit-widget|"kind"|```json/);
 const originalCode=[...fixture.matchAll(/```R\n[\s\S]*?```/g)].map(m=>m[0]);
 assert.deepEqual([...result.text.matchAll(/```R\n[\s\S]*?```/g)].map(m=>m[0]),originalCode);
 for(let i=0;i<4;i++){
   assert.ok(result.text.slice(0,result.positions[i]).includes(originalCode[i]));
   if(i<3)assert.ok(!result.text.slice(0,result.positions[i]).includes(originalCode[i+1]));
   assert.match(W.chartSvg(result.artifacts[i]),/^<svg/);
 }
});
test('mixed fences: case, CRLF, indentation, long fences, tilde and property order',()=>{
 for(const fence of ['```','````','~~~'])for(const language of ['json','JSON','','orbit-widget','ORBIT-WIDGET'])for(const nl of ['\n','\r\n']){
   const reordered=JSON.stringify({title:'Test',...chart});
   const code=fence+'python'+nl+'print("orbit-widget")'+nl+fence;
   const source=code+nl+'Before'+nl+'orbit-widget'+nl+'  '+fence+language+nl+reordered+nl+'  '+fence+nl+'After';
   const out=W.extract(source);
   assert.equal(out.artifacts.length,1,source);assert.deepEqual(out.errors,[]);
   assert.ok(out.text.startsWith(code));assert.ok(out.text.endsWith('After'));
 }
});
test('ordinary code including nested example fences and tool-looking JSON stays intact',()=>{
 for(const code of ['```python\n'+recipe+'\n```','~~~r\n'+recipe+'\n~~~','````markdown\n```orbit-widget\n'+recipe+'\n```\n````','`'+recipe+'`','```R\nplot(x)\n']){
   const out=W.extract(code);assert.equal(out.text,code.trim());assert.equal(out.artifacts.length,0);
   assert.equal(W.streamingText(code),code);assert.equal(W.streamingStatus(code),'');
 }
 const code='```text\norbit-widget\n```';
 const out=W.extract(code+'\n```orbit-widget\n'+recipe+'\n```');
 assert.ok(out.text.includes(code));assert.equal(out.artifacts.length,1);
});
test('streaming mixed replies never expose JSON after the tool marker and retain completed charts',()=>{
 let previous=0;
 for(let end=1;end<=fixture.length;end++){
   const prefix=fixture.slice(0,end),out=W.extract(prefix),visible=W.streamingText(out.text);
   assert.ok(out.artifacts.length>=previous);previous=out.artifacts.length;
   assert.doesNotMatch(visible,/"kind"|"series"|"samples"/,'prefix '+end);
   for(let i=1;i<out.positions.length;i++)assert.ok(out.positions[i]>=out.positions[i-1]);
 }
 assert.equal(previous,4);
});
test('invalid, disabled, excess and incomplete widgets preserve surrounding prose',()=>{
 const invalid={...chart,series:[]};
 const block=x=>'orbit-widget\n```json\n'+JSON.stringify(x)+'\n```';
 const out=W.extract('Before\n'+block(invalid)+'\nBetween\n'+block(chart)+'\nAfter');
 assert.equal(out.artifacts.length,1);assert.equal(out.errors.length,1);
 assert.match(out.text,/Before[\s\S]*Between[\s\S]*After/);assert.doesNotMatch(out.text,/"kind"|orbit-widget/);
 const many=W.extract(Array(6).fill(block(chart)).join('\n'));
 assert.equal(many.artifacts.length,4);assert.equal(many.errors.length,2);
 assert.equal(W.extract('```orbit-widget\n{"kind":').errors.length,1);
 assert.equal(W.streamingText('Before\norbit-widget\n```JSON\n{"title":"Partial","kind":"chart"').trim(),'Before');
});
test('saved reply recovery is idempotent and generates actual chart markup',()=>{
 const ctx={OrbitWidgets:W,crypto:require('node:crypto').webcrypto,escapeHtml:s=>String(s),attachmentFileKind:()=>({className:'chart',icon:'chart'})};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
 const message={role:'assistant',text:fixture};
 assert.equal(ctx.recoverMessageWidgets(message),true);
 const html=ctx.widgetMarkup(message,0);
 assert.equal((html.match(/<figure/g)||[]).length,4);assert.equal((html.match(/role="img"/g)||[]).length,4);
 assert.doesNotMatch(html,/saved widget is invalid/);
 const saved=JSON.stringify(message);assert.equal(ctx.recoverMessageWidgets(message),false);assert.equal(JSON.stringify(message),saved);
});

test('complete bare recipes keep following text and ordinary JSON is not a pending tool',()=>{
 assert.equal(W.streamingText('Before\n'+recipe+'\nAfter'),'Before\n\nAfter');
 const ordinary=JSON.stringify({example:chart});
 assert.equal(W.streamingText(ordinary),ordinary);
});
test('marked malformed JSON reports an error, without losing a later valid chart',()=>{
 const out=W.extract('Before\norbit-widget\n```json\n{"kind":"chart",BROKEN}\n```\nBetween\n```orbit-widget\n'+recipe+'\n```\nAfter');
 assert.equal(out.artifacts.length,1);assert.equal(out.errors.length,1);
 assert.doesNotMatch(out.text,/BROKEN|orbit-widget|"kind"/);
 assert.match(out.text,/Before[\s\S]*Between[\s\S]*After/);
});
test('finalizing a mixed reply creates four widgets without a repair model call',async()=>{
 let generated=0;
 const message={role:'assistant',text:fixture};
 const ctx={OrbitWidgets:{...W,generate:async spec=>{generated++;return new Blob([W.chartSvg(spec)]);}},
 crypto:require('node:crypto').webcrypto,state:{models:[{key:'test'}],selectedModel:'test',messages:[message]},
 renderMessages(){},persistCurrentChat(){},requestLocalReply(){throw Error('Unexpected repair request');}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
 await ctx.finalizeMessageWidgets(message,'Show code and diagrams');
 assert.equal(generated,4);assert.equal(message.artifacts.length,4);assert.equal(message.widgetError,undefined);
 assert.ok(message.artifacts.every(a=>a.size>0&&!a.error));
});

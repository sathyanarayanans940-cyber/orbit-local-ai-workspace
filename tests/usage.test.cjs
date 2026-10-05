const {test}=require('node:test');
const assert=require('node:assert/strict');
const {indexedDB}=require('fake-indexeddb');
const U=require('../usage.js');
const fs=require('node:fs'),vm=require('node:vm');
const today=new Date(2026,9,3,12).getTime();
let serial=0;
const make=options=>U.createStore({indexedDB,name:'usage-test-'+(++serial),now:()=>today,...options});
const event=(extra={})=>({kind:'model',provider:'DeepSeek',model:'flash',mode:'high',purpose:'answer',status:'success',tokens:{input:100,output:50,total:150,reasoning:30,cached:20},...extra});

test('provider token reports are precise; reasoning and cache are subsets',()=>{
 assert.deepEqual(U.tokens({usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,completion_tokens_details:{reasoning_tokens:30},prompt_cache_hit_tokens:20}},'DeepSeek'),{input:100,output:50,total:150,reasoning:30,cached:20});
 assert.equal(U.tokens({prompt_eval_count:100,eval_count:50,prompt_eval_cached_count:20},'Ollama').total,150);
 assert.equal(U.tokens({usage:{total_tokens:0}},'Gemini').total,0);
 assert.deepEqual(U.tokens({},'Ollama'),{input:null,output:null,total:null,reasoning:null,cached:null});
});
test('malformed counters, strings, NaN, infinity, negative and contradictory subsets are rejected',()=>{
 for(const n of [true,'40',-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(U.tokens({usage:{total_tokens:n}},'Gemini').total,null);
 const t=U.tokens({usage:{prompt_tokens:10,completion_tokens:20,total_tokens:4,prompt_tokens_details:{cached_tokens:11},completion_tokens_details:{reasoning_tokens:21}}},'Gemini');
 assert.equal(t.total,30);assert.equal(t.reasoning,null);assert.equal(t.cached,null);
});
test('thinking mode uses actual request options including internal off and provider default',()=>{
 for(const [o,v] of [[{think:false},'off'],[{think:true},'on'],[{think:'medium'},'medium'],[{thinking:{type:'disabled'}},'off'],[{reasoning_effort:'none'},'off'],[{thinking:{type:'enabled'},reasoning_effort:'max'},'max'],[{},'default']])assert.equal(U.thinking(o),v);
});
test('seven calendar days handle month/year boundaries and leap days',()=>{
 assert.deepEqual(U.dates(new Date(2027,0,3,12).getTime()),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 assert.ok(U.dates(new Date(2024,2,1,12).getTime()).includes('2024-02-29'));
});
test('IndexedDB persists exact aggregates and includes zero-activity days',async()=>{
 const s=make();await s.record(event());await s.record(event({status:'cancelled',tokens:{}}));
 const data=await s.read(),sum=U.summary(data);assert.equal(data.persistent,true);assert.equal(sum.total.requests,2);assert.equal(sum.total.cancelled,1);assert.equal(sum.total.total,150);assert.equal(sum.total.reported,1);assert.equal(sum.daily.length,7);assert.equal(sum.daily.slice(0,6).reduce((n,d)=>n+d.requests,0),0);s.close();
});
test('independent concurrent tabs cannot overwrite counts',async()=>{
 const name='usage-shared-'+(++serial),a=make({name}),b=make({name});await Promise.all([a.ready,b.ready]);
 await Promise.all(Array.from({length:80},(_,i)=>(i%2?a:b).record(event())));
 assert.equal(U.summary(await a.read()).total.requests,80);assert.equal(U.summary(await b.read()).total.total,12000);a.close();b.close();
});
test('retention prunes expired days and persists across reopen',async()=>{
 let now=today,name='usage-prune-'+(++serial);const a=make({name,now:()=>now});await a.record(event(),new Date(2026,8,27,12).getTime());await a.record(event(),today);now=new Date(2026,9,4,12).getTime();
 assert.deepEqual((await a.read()).rows.map(d=>d.date),['2026-10-03']);a.close();const b=make({name,now:()=>now});assert.equal(U.summary(await b.read()).total.total,150);b.close();
});
test('requests crossing midnight belong to their start day and finish only once',async()=>{
 let now=new Date(2026,9,3,23,59).getTime();const s=make({now:()=>now}),op=s.begin(event());assert.equal((await s.read()).active,1);now+=120000;
 await op.finish({status:'success'});await op.finish({status:'failed'});const data=await s.read();assert.equal(data.active,0);assert.equal(data.rows[0].date,'2026-10-03');assert.equal(data.rows[0].cells[0].requests,1);assert.equal(data.rows[0].cells[0].durationMs,120000);s.close();
});
test('same model ID on different connections remains distinct; purpose and mode filters are correct',async()=>{
 const s=make();await s.record(event());await s.record(event({provider:'AICredits',purpose:'analysis'}));await s.record(event({purpose:'title',mode:'off'}));const data=await s.read();assert.equal(U.summary(data).models.length,2);assert.equal(U.summary(data,{scope:'chat'}).total.requests,1);assert.equal(U.summary(data,{provider:'DeepSeek'}).total.requests,2);s.close();
});
test('searches and fetches retain their type, engine, outcome and results after storage',async()=>{
 const s=make();await s.record({kind:'web',action:'search',provider:'Bing',status:'success',results:5});await s.record({kind:'web',action:'fetch',provider:'Direct page reader',status:'failed'});const data=await s.read(),sum=U.summary(data);assert.equal(sum.webTotal.requests,2);assert.equal(sum.webTotal.results,5);assert.equal(sum.daily.at(-1).searches,1);assert.equal(sum.daily.at(-1).reads,1);assert.match(U.render(data),/Direct page reader · page read/);s.close();
});
test('unavailable storage is explicit, session totals work, and sensitive input is discarded',async()=>{
 const s=make({indexedDB:{open(){throw Error('blocked');}}});await s.record(event({prompt:'private prompt',answer:'secret answer',apiKey:'sk-PRIVATE',url:'https://private.example'}));const data=await s.read();assert.equal(data.persistent,false);assert.ok(data.problem);assert.equal(U.summary(data).total.requests,1);assert.doesNotMatch(JSON.stringify(data),/private prompt|secret answer|sk-PRIVATE|private.example/);s.close();
});
test('malicious labels are escaped; absent reports differ from reported zero',()=>{
 const cells=[];U.merge(cells,event({model:'<img src=x onerror=bad>',tokens:{}}));const snapshot={dates:U.dates(today),rows:[{date:'2026-10-03',cells}],active:0};const html=U.render(snapshot);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/Reported tokens<\/span><strong>—/);cells[0].reported=1;assert.match(U.render(snapshot),/Reported tokens<\/span><strong>0/);
});
test('high cardinality is bounded and preserves request totals',()=>{
 const cells=[];for(let i=0;i<2000;i++)U.merge(cells,event({model:'model-'+i}));assert.ok(cells.length<=513);assert.equal(cells.reduce((n,c)=>n+c.requests,0),2000);assert.ok(cells.some(c=>c.model.includes('storage limit')));
});
test('real SSE reader retains usage after finish_reason and never sums duplicate reports',async()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');let packets=[],status;
 const context=vm.createContext({TextDecoder,OrbitUsage:{response:()=>({packet:d=>packets.push(U.tokens(d,'DeepSeek')),text(){},thinking(){},finish:s=>{status=s;}})},setTimeout,clearTimeout});
 vm.runInContext(source.slice(source.indexOf('function runtimeTextChunk('),source.indexOf('function modelTextForMessage(')),context);
 const stream='data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n';
 const result=await context.readRuntimeStream(new Response(stream),'DeepSeek');assert.equal(result.text,'Hi');assert.equal(packets.at(-1).total,150);assert.equal(status,'success');
});

test('a failed transaction retains the last saved totals and subsequent session activity exactly once',async()=>{
 let fail=false;
 const wrapped={open(...args){const request=indexedDB.open(...args);request.addEventListener('success',()=>{const db=request.result,transaction=db.transaction.bind(db);db.transaction=(...args)=>{const tx=transaction(...args),objectStore=tx.objectStore.bind(tx);tx.objectStore=(...args)=>{const store=objectStore(...args),put=store.put.bind(store);store.put=(...args)=>{const result=put(...args);if(fail)tx.abort();return result;};return store;};return tx;};});return request;}};
 const name='usage-quota-'+(++serial),s=make({indexedDB:wrapped,name});await s.record(event());fail=true;await s.record(event());await s.record(event());
 const snapshot=await s.read();assert.equal(snapshot.persistent,false);assert.match(snapshot.problem,/session only/);assert.equal(U.summary(snapshot).total.requests,3);assert.equal(U.summary(snapshot).total.total,450);s.close();
 const reopened=make({name});assert.equal(U.summary(await reopened.read()).total.requests,1);reopened.close();
});
test('storage-limit rollups retain all thinking modes, internal purposes and both web operation counts',()=>{
 const cells=[];for(let i=0;i<2000;i++)U.merge(cells,event({model:'model-'+i}));
 for(const purpose of U.purposes)for(const mode of ['off','on','low','medium','high','max','default'])U.merge(cells,event({model:'overflow-'+purpose+mode,purpose,mode}));
 for(let i=0;i<100;i++)for(const action of ['search','fetch'])U.merge(cells,{kind:'web',provider:'engine-'+i,action,status:'success'});
 const snapshot={rows:[{date:'2026-10-03',cells}],dates:U.dates(today)},s=U.summary(snapshot);assert.ok(cells.length<=513);assert.equal(s.total.requests,2000+U.purposes.length*7);assert.equal(s.webTotal.requests,200);assert.equal(s.daily.at(-1).searches,100);assert.equal(s.daily.at(-1).reads,100);assert.equal(U.summary(snapshot,{scope:'chat'}).total.requests,2007);
});
test('real request retries count failed and successful attempts separately; pre-aborted requests count nothing',async()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),s=make(),trackers=new WeakMap();let attempts=0;
 const context=vm.createContext({AbortController,AbortSignal,DOMException,TextDecoder,setTimeout,clearTimeout,
  state:{connectedProviders:new Set()},updateRuntimeStatus(){},setRuntimeStatus(){},async discoverModels(){},
  OrbitUsage:{begin:metadata=>{const op=s.begin(metadata);let tokens={};return {packet:d=>{tokens=U.tokens(d,'LM Studio');},text(){},thinking(){},finish:status=>op.finish({status,tokens})};},attach:(r,t)=>trackers.set(r,t),response:r=>trackers.get(r)},
  async fetch(){attempts++;return attempts===1?new Response('{"error":"temporary"}',{status:503}):new Response('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n');}});
 vm.runInContext(source.slice(source.indexOf('async function requestRuntime('),source.indexOf('function modelTextForMessage(')),context);
 const response=await context.requestRuntime('/synthetic',{},'LM Studio',{model:'test',mode:'off'});await context.readRuntimeStream(response,'LM Studio');
 let total=U.summary(await s.read()).total;assert.equal(total.requests,2);assert.equal(total.failed,1);assert.equal(total.success,1);assert.equal(total.total,150);
 const stop=new AbortController();stop.abort();await assert.rejects(()=>context.requestRuntime('/synthetic',{signal:stop.signal},'LM Studio'),{name:'AbortError'});assert.equal(U.summary(await s.read()).total.requests,2);s.close();
});
test('non-streaming replies still report tokens and observed reasoning',async()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');let observed=0,status='',reported;
 const context=vm.createContext({TextDecoder,setTimeout,clearTimeout,OrbitUsage:{response:()=>({packet:d=>{reported=U.tokens(d,'Gemini');},text(){},thinking(){observed++;},finish:s=>{status=s;}})}});
 vm.runInContext(source.slice(source.indexOf('function runtimeTextChunk('),source.indexOf('function modelTextForMessage(')),context);
 const response={json:async()=>({choices:[{message:{content:'Answer',reasoning_content:'Synthetic reasoning'},finish_reason:'stop'}],usage:{total_tokens:20}})};
 assert.equal((await context.readRuntimeStream(response,'Gemini')).text,'Answer');assert.equal(observed,1);assert.equal(reported.total,20);assert.equal(status,'success');
});
test('weekly web outcomes combine days without duplicating providers or changing operation types',async()=>{
 const s=make();await s.record({kind:'web',action:'search',provider:'Bing',status:'success',results:5},new Date(2026,8,30,12).getTime());await s.record({kind:'web',action:'search',provider:'Bing',status:'failed'});await s.record({kind:'web',action:'fetch',provider:'Bing',status:'success'});
 const html=U.render(await s.read());assert.equal((html.match(/Bing · search/g)||[]).length,1);assert.equal((html.match(/Bing · page read/g)||[]).length,1);assert.match(html,/1 completed \/ 1 failed \/ 0 stopped · 5 results returned/);s.close();
});

const chartSnapshot=rows=>({rows:[{date:'2026-10-03',cells:rows.map(row=>({...U.normalize(event(row)),requests:row.requests}))}],dates:U.dates(today),active:0});
test('model-share doughnut has honest empty and single-model states',()=>{
 const empty=U.render(chartSnapshot([]));assert.match(empty,/No model requests recorded/);assert.doesNotMatch(empty,/class="usage-donut-segment"/);assert.doesNotMatch(empty,/NaN|Infinity/);
 const single=U.render(chartSnapshot([{model:'only',requests:10}]));assert.match(single,/100\.0%/);assert.match(single,/10 requests across 1 model connections/);assert.equal((single.match(/class="usage-donut-segment"/g)||[]).length,1);
});
test('doughnut shares distinguish model connections and respect current filters',()=>{
 const snapshot=chartSnapshot([{model:'same',provider:'DeepSeek',requests:3},{model:'same',provider:'AICredits',requests:1}]);
 const html=U.render(snapshot);assert.match(html,/75\.0%/);assert.match(html,/25\.0%/);assert.equal((html.match(/class="usage-donut-segment"/g)||[]).length,2);
 const filtered=U.render(snapshot,{provider:'AICredits'});assert.match(filtered,/100\.0%/);assert.match(filtered,/1 requests across 1 model connections/);assert.equal((filtered.match(/class="usage-donut-segment"/g)||[]).length,1);
});
test('doughnut includes the tail as Other so its shares account for every connection',()=>{
 const html=U.render(chartSnapshot(Array.from({length:10},(_,i)=>({model:'model-'+i,requests:10}))));assert.equal((html.match(/class="usage-donut-segment"/g)||[]).length,8);assert.match(html,/Other<small>3 model connections/);assert.match(html,/30\.0%<small>30 requests/);assert.match(html,/100 requests across 10 model connections/);
 const arcs=[...html.matchAll(/stroke-dasharray="([\d.]+) [\d.]+"/g)].map(m=>Number(m[1]));assert.equal(arcs.reduce((n,p)=>n+p,0),100);
});
test('very small doughnut shares remain positive in the legend and finite in the SVG',()=>{
 const html=U.render(chartSnapshot([{model:'large',requests:1000000000000},{model:'tiny',requests:1}]));assert.match(html,/&lt;0\.1%<small>1 requests/);assert.doesNotMatch(html,/NaN|Infinity/);
});
test('doughnut labels and tooltips cannot inject SVG or HTML',()=>{
 const html=U.render(chartSnapshot([{model:'</title><script>bad()</script>',provider:'<img src=x onerror=bad>',requests:2}]));assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;\/title&gt;&lt;script&gt;/);
});

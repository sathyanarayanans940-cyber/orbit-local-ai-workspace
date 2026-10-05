const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function harness(){const context=vm.createContext({AbortController,DOMException});vm.runInContext(source.slice(source.indexOf('async function prepareReplyContext('),source.indexOf('function recordRuntimeTiming(')),context);return context;}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('remote preparation overlaps all tools and retains every result before the answer starts',async()=>{
 const c=harness(),started=[],status=[],jobs=['memory','analysis','web'].map(key=>({key,label:key,gate:deferred()}));
 const payloads={memory:'Exact profile and learned preferences',analysis:{instruction:'Full numerical verification',checks:[{ok:true}]},web:{instruction:'Source evidence',sources:['https://example.org']}};
 let completed=false;
 const pending=c.prepareReplyContext(jobs.map(job=>({...job,run:async options=>{started.push(job.key);if(job.key==='analysis')options.onStatus('Analyzing…');await job.gate.promise;return payloads[job.key];}})),{onStatus:label=>status.push(label)}).then(result=>{completed=true;return result;});
 assert.deepEqual(started,['memory','analysis','web']);assert.equal(status.at(-1),'Analyzing…');
 jobs[2].gate.resolve();jobs[0].gate.resolve();await flush();assert.equal(completed,false);assert.equal(status.at(-1),'Analyzing…');
 jobs[1].gate.resolve();const result=await pending;
 for(const key of Object.keys(payloads)){assert.equal(result.results[key],payloads[key]);assert.ok(result.timings[key]>=0);}
 assert.equal(status.at(-1),'');
});

test('local preparation keeps one inference active at a time',async()=>{
 const c=harness(),started=[],gates=[deferred(),deferred(),deferred()];let active=0,max=0;
 const pending=c.prepareReplyContext(gates.map((gate,index)=>({key:String(index),label:'Prepare',run:async()=>{started.push(index);max=Math.max(max,++active);await gate.promise;active--;return index;}})),{parallel:false});
 assert.deepEqual(started,[0]);gates[0].resolve();await flush();assert.deepEqual(started,[0,1]);
 gates[1].resolve();await flush();assert.deepEqual(started,[0,1,2]);gates[2].resolve();await pending;assert.equal(max,1);
});

test('Stop cancels every independent job and blocks all later shimmer updates',async()=>{
 const c=harness(),parent=new AbortController(),signals=[],labels=[];let report;
 const pending=c.prepareReplyContext(['memory','analysis','web'].map(key=>({key,label:key,run:({signal,onStatus})=>{signals.push(signal);report=onStatus;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));}})),{signal:parent.signal,onStatus:label=>labels.push(label)});
 const rejected=assert.rejects(pending,{name:'AbortError'});parent.abort();await rejected;
 assert.equal(signals.length,3);assert.ok(signals.every(signal=>signal.aborted));const count=labels.length;report('Late stale update');assert.equal(labels.length,count);
 const already=new AbortController();already.abort();await assert.rejects(c.prepareReplyContext([{key:'none',run:()=>assert.fail('ran after Stop')}],{signal:already.signal}),{name:'AbortError'});
});

test('a failed tool cancels sibling paid requests without retrying or hiding the original error',async()=>{
 const c=harness(),failure=deferred(),signals=[];let calls=0;
 const tasks=['memory','analysis','web'].map(key=>({key,label:key,run:({signal})=>{calls++;signals.push(signal);if(key==='web')return failure.promise;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true}));}}));
 const pending=c.prepareReplyContext(tasks),reason=new Error('Required research failed');
 const rejected=assert.rejects(pending,error=>error===reason);failure.reject(reason);await rejected;await flush();assert.equal(calls,3);assert.ok(signals.every(signal=>signal.aborted));
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../thinking.js');
function clock(prompt='Explain regression equations',signal){let now=0,seq=0,timers=new Map(),labels=[];const c=T.createActivity({prompt,signal,onStatus:s=>labels.push(s),now:()=>now,schedule:(f,ms)=>{timers.set(++seq,{f,at:now+ms});return seq;},cancel:id=>timers.delete(id)});return {c,labels,pending:()=>timers.size,advance:ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.f();}}};}
test('Thinking remains for four seconds then becomes a 3–7 word task headline without a visible clock',()=>{
 const {c,labels,advance}=clock();c.status('Thinking');advance(3999);assert.deepEqual(labels,['Thinking']);advance(1);assert.deepEqual(labels,['Thinking','Working through regression equations']);assert.equal(labels[1].split(' ').length,4);assert.doesNotMatch(labels[1],/sec|min|\d/);c.stop();
});
test('reasoning activity changes the headline, keeps raw private reasoning hidden and throttles rapid changes',()=>{
 const a=clock('Solve this'),secret='Private password 987654: use regression equations';a.c.status('Thinking');a.c.activity(T.activity(secret));a.advance(4000);assert.equal(a.labels.at(-1),'Working through regression equations');assert.doesNotMatch(a.labels.join(),/password|987654/);
 a.c.activity(T.activity('Next work on hypothesis test'));a.advance(1999);assert.equal(a.labels.length,2);a.advance(1);assert.equal(a.labels.at(-1),'Working through the hypothesis test');a.c.stop();
});
test('repeated Thinking status does not restart grace period; hidden reasoning uses a task fallback',()=>{
 const a=clock('Plan a software process explanation');a.c.status('Thinking');a.advance(3000);a.c.status('Thinking');a.advance(1000);assert.equal(a.labels.at(-1),'Organizing the software process explanation');a.c.stop();
 const b=clock('Hello 👋');b.c.status('Thinking');b.advance(4000);assert.equal(b.labels.at(-1),'Working through your request');b.c.stop();
});
test('first answer, cancellation and errors terminate headline updates and release timers',()=>{
 for(const stop of ['token','abort','error']){const controller=new AbortController(),a=clock('',controller.signal);a.c.status('Thinking');assert.equal(a.pending(),1);if(stop==='abort')controller.abort();else a.c.stop();a.advance(60000);assert.deepEqual(a.labels,['Thinking']);assert.equal(a.pending(),0);a.c.status('Thinking');a.c.activity('Working through the next task');assert.equal(a.pending(),0);}
 const done=new AbortController();done.abort();const a=clock('Solve x',done.signal);a.c.status('Thinking');assert.equal(a.pending(),0);
});
test('Analyze, document and web statuses interrupt thinking and keep their existing presentation',()=>{
 const a=clock();a.c.status('Thinking');a.advance(3000);a.c.status('Analyzing');a.advance(9000);assert.equal(a.labels.at(-1),'Analyzing');assert.equal(a.pending(),0);a.c.status('Thinking');a.advance(4000);assert.equal(a.labels.at(-1),'Working through regression equations');a.c.status('Writing the next section');a.advance(8000);assert.equal(a.labels.at(-1),'Writing the next section');a.c.stop();
});
test('think-off starts silent and never fabricates reasoning activity',()=>{const a=clock();a.c.status('');a.advance(60000);assert.deepEqual(a.labels,['']);assert.equal(a.pending(),0);a.c.stop();});
test('fixed headlines are short, relevant and safe for every supported subject',()=>{
 for(const prompt of ['Z transform','regression','correlation','hypothesis test','probability','integral','solve x and y','knapsack','debug code','gantt','chart','software process','word document','math solution','compare sources','नमस्ते']){
  const label=T.activity(prompt,true);assert.ok(label.split(' ').length>=3&&label.split(' ').length<=7,label);assert.doesNotMatch(label,/<|>|\d/);
 }
 assert.equal(T.activity('No known topic, a secret arbitrary string'),null);
 assert.equal(T.activity('Review regression equations. Next, plan the project schedule and chart data.'),'Planning the schedule and dependencies');
});
test('Ollama and OpenAI-compatible reasoning streams deliver safe activity labels across fragmented chunks',async()=>{
 const app=fs.readFileSync('app.js','utf8');const ctx=vm.createContext({TextDecoder,OrbitThinking:T,clearTimeout,setTimeout,recordRuntimeTiming(){}});vm.runInContext(app.slice(app.indexOf('function runtimeTextChunk('),app.indexOf('async function prepareReplyContext(')),ctx);
 for(const provider of ['Ollama','DeepSeek','AICredits','Gemini','LM Studio']){
  const events=provider==='Ollama'?[{message:{thinking:'Private data: regre'}},{message:{thinking:'ssion equations'}},{message:{content:'Answer'},done:true}]:[{choices:[{delta:{reasoning_content:'Private data: regre'}}]},{choices:[{delta:{reasoning_content:'ssion equations'}}]},{choices:[{delta:{content:'Answer'}}]}];
  const wire=provider==='Ollama'?events.map(e=>JSON.stringify(e)+'\n').join(''):events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
  const chunks=[];for(let i=0;i<wire.length;i+=7)chunks.push(new TextEncoder().encode(wire.slice(i,i+7)));let index=0,labels=[],statuses=[],calls=0,text='';const response={body:{getReader:()=>({read:async()=>index<chunks.length?{done:false,value:chunks[index++]}:{done:true},cancel:async()=>{},releaseLock(){}})}};
  const result=await ctx.readRuntimeStream(response,provider,{onToken:s=>text+=s,onStatus:s=>statuses.push(s),onThinking:()=>calls++,onThinkingActivity:s=>labels.push(s)});assert.equal(result.text,'Answer');assert.equal(text,'Answer');assert.equal(calls,1);assert.deepEqual(statuses,['Thinking']);assert.equal(labels.at(-1),'Working through regression equations');assert.doesNotMatch(labels.join(),/Private data/);
 }
});

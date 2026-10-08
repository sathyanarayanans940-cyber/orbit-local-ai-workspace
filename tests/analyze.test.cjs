const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const A=require('../analyze.js');
const user=text=>[{role:'user',text}];
test('simple requests skip computation without showing a false shimmer',async()=>{
 const statuses=[];const result=await A.analyze(user('Hello'),{plan:async()=>'{"action":"none"}',run:()=>{throw Error('unexpected')},onStatus:s=>statuses.push(s)});assert.equal(result.checks.length,0);assert.deepEqual(statuses,['Planning solution checks']);assert.match(result.instruction,/No computation was executed/);
});
test('math executes before answer evidence, failed check is repaired and retried',async()=>{
 const decisions=[{action:'run',purpose:'Integral',code:'assert 1==2'},{action:'run',purpose:'Integral',code:'print(9)'},{action:'done'}];let calls=0;const statuses=[];
 const result=await A.analyze(user('Calculate the integral'),{plan:async history=>{if(calls===1)assert.match(history.at(-1).text,/AssertionError/);return JSON.stringify(decisions[calls++])},run:async code=>code.startsWith('assert')?{ok:false,error:'AssertionError'}:{ok:true,output:'9'},onStatus:s=>statuses.push(s)});
 assert.deepEqual(result.checks.map(c=>c.ok),[false,true]);assert.equal(statuses.filter(s=>s==='Analyzing…').length,2);assert.match(result.instruction,/"output":"9"/);assert.match(A.markup(result.checks),/checks completed/);
});
test('complex calculation cannot silently skip required computation',async()=>{
 let calls=0;const result=await A.analyze(user('Solve this integral'),{plan:async()=>{calls++;return '{"action":"none"}'}});assert.equal(calls,2);assert.equal(result.checks[0].ok,false);assert.match(result.instruction,/not been computationally verified/);
});
test('retries bounded; errors and Python translation limitation stay visible',async()=>{
 let calls=0;const result=await A.analyze(user('Implement binary search in C++'),{plan:async()=>JSON.stringify({action:'run',language:'C++',code:'print(1)'}),run:async()=>{calls++;return {ok:false,error:'failed'}}});assert.equal(calls,3);assert.match(A.markup(result.checks),/Python logic check for C\+\+/);assert.match(A.markup(result.checks),/check incomplete/);
});
test('cancellation prevents generation fallback',async()=>{
 const c=new AbortController();c.abort();await assert.rejects(A.analyze(user('Solve'),{signal:c.signal,plan:()=>{throw Error('unexpected')}}),{name:'AbortError'});
});
test('malformed/oversized plans fail explicitly; evidence is escaped and bounded',async()=>{
 assert.throws(()=>A.parse('{"action":"run","code":""}'));assert.throws(()=>A.parse(JSON.stringify({action:'run',code:'x'.repeat(16001)})));
 const result=await A.analyze(user('hello'),{plan:async()=>'{bad'});assert.equal(result.checks[0].ok,false);
 const html=A.markup([{ok:true,output:'<script>alert(1)</script>',code:'<svg onload=x>'}]);assert.doesNotMatch(html,/<script>|<svg/);assert.match(html,/&lt;script/);
});
test('analysis integrates all providers and offline installers',()=>{
 const s=fs.readFileSync('app.js','utf8');assert.equal((s.match(/saveAnalysis\(streamedReply/g)||[]).length,2);assert.match(s,/analysis\?\.instruction/);assert.match(s,/callbacks.analyzing/);
 for(const f of ['index.html','service-worker.js','install-macos.sh','install-windows.ps1','scripts/package-release.py','scripts/update-installed-macos.command'])assert.match(fs.readFileSync(f,'utf8'),f==='index.html'?/analyze\.js/:/analyze-worker\.js/,f);
 const worker=fs.readFileSync('analyze.js','utf8');assert.match(worker,/frame.sandbox='allow-scripts'/);assert.doesNotMatch(worker,/allow-same-origin/);assert.match(fs.readFileSync('analyze-sandbox.html','utf8'),/connect-src 'none'/);
});
test('malformed follow-up JSON retries without losing successful computation',async()=>{
 const plans=[JSON.stringify({action:'run',code:'print(9)'}),'{bad','{"action":"done"}'];
 const result=await A.analyze(user('Calculate an integral'),{plan:async()=>plans.shift(),run:async()=>({ok:true,output:'9'})});
 assert.equal(result.checks.length,1);assert.equal(result.checks[0].ok,true);
});

test('a planning transport failure is reported once without a JSON repair request',async()=>{
 let calls=0;
 const result=await A.analyze(user('Solve the probability question'),{plan:async()=>{calls++;throw Error('Analyze planning timed out; no computational verification was completed.');}});
 assert.equal(calls,1);assert.equal(result.checks.length,1);assert.equal(result.checks[0].ok,false);
 assert.match(result.instruction,/no computational verification was completed/);
});

test('collapsed summary distinguishes translated logic checks from original-language execution',()=>{
 assert.match(A.markup([{ok:true,language:'JavaScript',code:'print(1)'}]),/Analyze · Python logic checks completed/);
});

test('a complete successful batch skips a redundant done request and preserves all execution evidence',async()=>{
 let calls=0;
 const result=await A.analyze(user('Solve both questions'),{plan:async()=>{calls++;return JSON.stringify({action:'run',complete:true,language:'C++',purpose:'Both algorithms',code:'print("both checked")'});},run:async()=>({ok:true,output:'Both algorithms: sample, empty, overlap and absent cases checked'})});
 assert.equal(calls,1);assert.equal(result.checks.length,1);
 assert.match(result.instruction,/sample, empty, overlap and absent/);
 assert.match(result.instruction,/does not certify the mathematics/);
 assert.match(result.instruction,/complete worked solution/);
});

test('complete flag never bypasses failures, empty output, errors or truncated evidence',async()=>{
 for(const first of [{ok:false,error:'AssertionError'},{ok:true,output:''},{ok:true,output:'   '},{ok:true,output:'partial',truncated:true},{ok:true,output:'printed',error:'unresolved'}]){
  let calls=0,runs=0;
  const result=await A.analyze(user('Solve'),{plan:async h=>{calls++;if(calls===2)assert.match(h.at(-1).text,/execution/);return JSON.stringify({action:'run',complete:true,code:'print(1)'});},run:async()=>++runs===1?first:{ok:true,output:'Complete repaired results'}});
  assert.equal(calls,2);assert.equal(runs,2);assert.equal(result.checks.length,2);
 }
 for(const complete of [undefined,false,'true',1]){
  let calls=0;
  await A.analyze(user('Solve'),{plan:async()=>JSON.stringify(++calls===1?{action:'run',complete,code:'print(1)'}:{action:'done'}),run:async()=>({ok:true,output:'One subpart'})});
  assert.equal(calls,2);
 }
});

test('planning contains attachment evidence once while retaining image references and full answer instructions',async()=>{
 let captured;
 const attachment={name:'example.pdf',extractedText:'UNIQUE_SOURCE_TEXT',visualSummary:'UNIQUE_VISUAL_SUMMARY',visuals:[{id:'page-1',dataUrl:'data:image/png;base64,YQ=='}]};
 await A.analyze([{role:'user',text:'Explain this',attachments:[attachment,{name:'unread.png',dataUrl:'data:image/png;base64,YQ=='}]}],{plan:async h=>{captured=h;return '{"action":"none"}';}});
 assert.equal(JSON.stringify(captured).split('UNIQUE_SOURCE_TEXT').length-1,1);
 assert.equal(JSON.stringify(captured).split('UNIQUE_VISUAL_SUMMARY').length-1,1);
 assert.equal(captured[1].attachments[0].visuals,undefined);
 assert.equal(captured[1].attachments[1].dataUrl,'data:image/png;base64,YQ==');
 assert.equal(attachment.extractedText,'UNIQUE_SOURCE_TEXT');
 assert.match(captured[0].text,/not the final answer writer/);
 assert.match(A.instruction,/complete worked solution|worked explanation/);
});

test('cancellation after a complete run cannot become a successful cached result',async()=>{
 const c=new AbortController();
 await assert.rejects(A.analyze(user('Solve'),{signal:c.signal,plan:async()=>JSON.stringify({action:'run',complete:true,code:'print(1)'}),run:async()=>{c.abort();return {ok:true,output:'Late result'};}}),{name:'AbortError'});
});

test('prepared Python executes with zero planning calls and failed execution still repairs',async()=>{
 const initialPlan={action:'run',purpose:'Boundary checks',language:'python',complete:true,code:'assert 1 == 2'};
 let plans=0,runs=0;
 const result=await A.analyze(user('Run these checks'),{initialPlan,plan:async history=>{plans++;assert.match(history.at(-1).text,/AssertionError/);return JSON.stringify({...initialPlan,code:'print(34)'});},run:async code=>{runs++;return code.startsWith('assert')?{ok:false,error:'AssertionError'}:{ok:true,output:'34'};}});
 assert.equal(plans,1);assert.equal(runs,2);assert.deepEqual(result.checks.map(c=>c.ok),[false,true]);
 const statuses=[];
 const direct=await A.analyze(user('Run Python'),{initialPlan:{...initialPlan,code:'print(34)'},plan:()=>assert.fail('redundant planner'),onStatus:s=>statuses.push(s),run:async()=>({ok:true,output:'34'})});
 assert.equal(direct.checks[0].ok,true);assert.deepEqual(statuses,['Analyzing…']);
});
test('dependent analysis, malformed direct code, empty output and abort retain recovery gates',async()=>{
 const good={action:'run',complete:true,code:'print(34)'};
 for(const initialPlan of [null,{action:'none'},{...good,code:''},{...good,code:'x'.repeat(16001)}]){
  let plans=0;const result=await A.analyze(user('Run'),{initialPlan,plan:async()=>{plans++;return JSON.stringify(good);},run:async()=>({ok:true,output:'34'})});assert.equal(plans,1);assert.equal(result.checks[0].ok,true);
 }
 let plans=0;
 await A.analyze(user('Calculate using search results'),{initialPlan:good,evidence:{web:{instruction:'Fresh value is 75'}},plan:async history=>{plans++;assert.match(history[1].text,/Fresh value is 75/);return JSON.stringify(good);},run:async()=>({ok:true,output:'34'})});assert.equal(plans,1);
 plans=0;await A.analyze(user('Run'),{initialPlan:good,plan:async()=>{plans++;return '{"action":"done"}';},run:async()=>({ok:true,output:''})});assert.equal(plans,1);
 const c=new AbortController();c.abort();await assert.rejects(A.analyze(user('Run'),{initialPlan:good,signal:c.signal,plan:()=>assert.fail(),run:()=>assert.fail()}),{name:'AbortError'});
});

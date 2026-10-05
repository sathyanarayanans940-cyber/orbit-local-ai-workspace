const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const A=require('../analyze.js');
const user=text=>[{role:'user',text}];
test('simple requests skip computation without showing a false shimmer',async()=>{
 const statuses=[];const result=await A.analyze(user('Hello'),{plan:async()=>'{"action":"none"}',run:()=>{throw Error('unexpected')},onStatus:s=>statuses.push(s)});assert.equal(result.checks.length,0);assert.equal(statuses.length,0);assert.match(result.instruction,/No computation was executed/);
});
test('math executes before answer evidence, failed check is repaired and retried',async()=>{
 const decisions=[{action:'run',purpose:'Integral',code:'assert 1==2'},{action:'run',purpose:'Integral',code:'print(9)'},{action:'done'}];let calls=0;const statuses=[];
 const result=await A.analyze(user('Calculate the integral'),{plan:async history=>{if(calls===1)assert.match(history.at(-1).text,/AssertionError/);return JSON.stringify(decisions[calls++])},run:async code=>code.startsWith('assert')?{ok:false,error:'AssertionError'}:{ok:true,output:'9'},onStatus:s=>statuses.push(s)});
 assert.deepEqual(result.checks.map(c=>c.ok),[false,true]);assert.equal(statuses.length,2);assert.match(result.instruction,/"output":"9"/);assert.match(A.markup(result.checks),/checks completed/);
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

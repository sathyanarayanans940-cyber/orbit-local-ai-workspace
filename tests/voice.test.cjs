const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const V=require('../voice.js');
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function rig(options={}){
 let time=0,seq=0,value='',isOnline=true,checks=0;const timers=new Map(),instances=[],notices=[],changes=[];
 const schedule=(f,ms)=>{timers.set(++seq,{at:time+ms,f});return seq;},unschedule=id=>timers.delete(id);
 class Speech{constructor(){instances.push(this);this.aborts=0;this.stops=0;this.processLocally=true;}start(){if(options.throwStart)throw Error('blocked');if(options.autoStart!==false)this.onstart?.();}stop(){this.stops++;}abort(){this.aborts++;}}
 const c=V.create({Recognition:Speech,secure:()=>true,online:()=>isOnline,check:async()=>{checks++;return true;},getLanguage:()=> 'en-IN',getText:()=>value,onText:text=>{value=text;},onChange:s=>changes.push(s),onNotice:s=>notices.push(s),now:()=>time,schedule,unschedule,...options});
 function advance(ms){const end=time+ms;for(;;){const item=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!item||item[1].at>end)break;time=item[1].at;timers.delete(item[0]);item[1].f();}time=end;}
 function result(rows,index=0){instances.at(-1).onresult?.({resultIndex:index,results:rows.map(([text,final])=>Object.assign([{transcript:text}],{isFinal:final}))});}
 return {c,instances,notices,changes,advance,result,timers,checks:()=>checks,value:()=>value,type:text=>value=text,offline:()=>isOnline=false};
}
test('dictation is disabled until secure browser support and internet are confirmed',async()=>{
 for(const options of [{secure:()=>false},{Recognition:null},{online:()=>false}]){const r=rig(options);assert.equal(r.c.snapshot().available,false);assert.equal(await r.c.refresh(),false);assert.equal(r.c.start(),false);assert.equal(r.instances.length,0);assert.equal(r.checks(),0);}
 const r=rig();assert.equal(r.c.snapshot().available,false);assert.equal(await r.c.refresh(),true);assert.equal(r.c.snapshot().available,true);assert.equal(r.instances.length,0);
});
test('connectivity never accepts truthy strings, errors, or a server-only LAN connection',async()=>{
 for(const check of [async()=>false,async()=>({online:true}),async()=>'true',async()=>{throw Error('offline');}]){const r=rig({check});assert.equal(await r.c.refresh(),false);assert.equal(r.c.snapshot().available,false);assert.equal(r.c.start(),false);}
});
test('a stalled internet probe expires and releases its timer after four seconds',async()=>{
 const r=rig({check:()=>new Promise(()=>{})}),pending=r.c.refresh();r.advance(3999);await settle();assert.equal(r.c.snapshot().available,false);r.advance(1);assert.equal(await pending,false);assert.equal(r.timers.size,0);
});
test('an offline event wins over a late successful internet probe',async()=>{
 let resolve;const r=rig({check:()=>new Promise(r=>resolve=r)}),p=r.c.refresh();r.offline();r.c.invalidate();resolve(true);assert.equal(await p,false);assert.equal(r.c.snapshot().available,false);assert.equal(r.timers.size,0);
});
test('concurrent refreshes do not create duplicate probes and freshness expires',async()=>{
 let resolve,calls=0;const r=rig({check:()=>{calls++;return new Promise(r=>resolve=r);}}),p=r.c.refresh();assert.equal(await r.c.refresh(),false);assert.equal(calls,1);resolve(true);assert.equal(await p,true);r.advance(45001);assert.equal(r.c.snapshot().available,false);assert.equal(r.c.start(),false);
});
test('recording starts only on demand, uses the selected accent and requires an empty input',async()=>{
 const r=rig({getLanguage:()=> 'en-GB'});await r.c.refresh();r.type('Typed prompt');assert.equal(r.c.start(),false);r.type('');assert.equal(r.c.start(),true);assert.equal(r.c.start(),false);const s=r.instances[0];assert.equal(s.lang,'en-GB');assert.equal(s.processLocally,false);assert.equal(s.continuous,true);assert.equal(s.interimResults,true);assert.equal(r.c.snapshot().phase,'listening');r.c.cancel();assert.equal(r.timers.size,0);
});
test('interim revisions and final results replace previous words without duplication',async()=>{
 const r=rig();await r.c.refresh();r.c.start();r.result([['solve regress',false]]);assert.equal(r.value(),'solve regress');r.result([['Solve regression equations.',true],['With the',false]]);assert.equal(r.value(),'Solve regression equations. With the');r.result([['Solve regression equations.',true],['With the working shown.',true]],1);assert.equal(r.value(),'Solve regression equations. With the working shown.');r.instances[0].onend();assert.equal(r.c.snapshot().active,false);assert.equal(r.timers.size,0);
});
test('Cancel and stale callbacks cannot add text to a new dictation',async()=>{
 const r=rig();await r.c.refresh();r.c.start();const late=r.instances[0].onresult;r.result([['discard this',true]]);r.c.cancel();assert.equal(r.value(),'');r.c.start();late({resultIndex:0,results:[Object.assign([{transcript:'OLD text'}],{isFinal:true})]});assert.equal(r.value(),'');r.result([['New text',true]]);r.instances[1].onend();assert.equal(r.value(),'New text');assert.ok(r.instances[0].aborts>0);
});
test('a network error keeps final words, drops uncertain interim text and disables voice',async()=>{
 const r=rig();await r.c.refresh();r.c.start();r.result([['Completed words',true],['uncertain',false]]);r.instances[0].onerror({error:'network'});assert.equal(r.value(),'Completed words');assert.equal(r.c.snapshot().available,false);assert.equal(r.timers.size,0);assert.match(r.notices.at(-1),/connection failed/i);
});
test('Finish accepts the last final transcript, and a missing end event has a deadline',async()=>{
 for(const end of [true,false]){const r=rig();await r.c.refresh();r.c.start();r.result([['Interim text',false]]);r.c.finish();assert.equal(r.instances[0].stops,1);assert.equal(r.c.snapshot().phase,'finishing');r.result([['Final text',true]]);if(end)r.instances[0].onend();else r.advance(2500);assert.equal(r.value(),'Final text');assert.equal(r.c.snapshot().active,false);assert.equal(r.timers.size,0);}
});
test('silent service startup cannot leave the microphone UI stuck',async()=>{
 const r=rig({autoStart:false});await r.c.refresh();r.c.start();assert.equal(r.c.snapshot().phase,'starting');r.advance(10000);assert.equal(r.c.snapshot().active,false);assert.match(r.notices.at(-1),/did not start/);assert.equal(r.timers.size,0);
});
test('dictation is bounded to two minutes and 16000 text characters',async()=>{
 const r=rig();await r.c.refresh();r.c.start();r.result([['A long result',true]]);r.advance(120000);assert.equal(r.c.snapshot().phase,'finishing');r.advance(2500);assert.equal(r.value(),'A long result');assert.equal(r.timers.size,0);
 const s=rig();await s.c.refresh();s.c.start();s.result([['x'.repeat(20000),true]]);assert.equal(s.value().length,16000);s.advance(2500);assert.equal(s.value().length,16000);assert.equal(s.timers.size,0);
});
test('permission and speech service denial never triggers repeated recording attempts',async()=>{
 for(const error of ['not-allowed','service-not-allowed']){const r=rig();await r.c.refresh();r.c.start();r.instances[0].onerror({error});assert.equal(r.c.snapshot().available,false);assert.equal(r.c.start(),false);assert.equal(r.instances.length,1);assert.match(r.c.snapshot().reason,/blocked/);assert.equal(r.timers.size,0);}
});
test('offline interruption preserves completed words and late events are ignored',async()=>{
 const r=rig();await r.c.refresh();r.c.start();const late=r.instances[0].onresult;r.result([['Complete',true],['unfinished',false]]);r.offline();r.c.invalidate();assert.equal(r.value(),'Complete');late({results:[Object.assign([{transcript:'old words'}],{isFinal:true})],resultIndex:0});assert.equal(r.value(),'Complete');assert.equal(r.c.snapshot().active,false);assert.equal(r.c.snapshot().available,false);
});
test('dispose aborts recognition and an ignored pending probe without leaking timers',async()=>{
 const r=rig({check:()=>new Promise(()=>{})}),p=r.c.refresh();r.c.dispose();assert.equal(await p,false);assert.equal(r.timers.size,0);assert.equal(r.c.start(),false);
 const s=rig();await s.c.refresh();s.c.start();s.c.dispose();assert.equal(s.timers.size,0);assert.ok(s.instances[0].aborts>0);
});
test('exceptions, no-speech and malformed speech events keep ordinary input usable',async()=>{
 const r=rig({throwStart:true});await r.c.refresh();assert.equal(r.c.start(),false);assert.equal(r.c.snapshot().active,false);assert.equal(r.timers.size,0);
 const s=rig();await s.c.refresh();s.c.start();s.instances[0].onresult({resultIndex:0,results:{length:513}});s.instances[0].onerror({error:'no-speech'});assert.equal(s.value(),'');assert.equal(s.c.snapshot().available,true);assert.match(s.notices.at(-1),/No speech/);
});
test('voice text stays literal including HTML, emoji and newlines',async()=>{
 const r=rig();await r.c.refresh();r.c.start();r.result([['<img src=x onerror=bad> 📊\nSolve x.',true]]);assert.equal(r.value(),'<img src=x onerror=bad> 📊 Solve x.');r.c.finish();r.advance(2500);
});
test('composer button priority is generation Stop, dictation Finish, attachment/text Send, empty Voice',()=>{
 const source=fs.readFileSync('app.js','utf8'),functionSource=source.slice(source.indexOf('function updateSendButton()'),source.indexOf('function stopGeneration()'));
 for(const [sending,active,text,attachments,available,label,disabled,type] of [[false,false,'',[],false,'Start voice input',true,'button'],[false,false,'',[],true,'Start voice input',false,'button'],[false,false,'Prompt',[],false,'Send message',false,'submit'],[false,false,'',[{}],false,'Send message',false,'submit'],[false,true,'Transcript',[],true,'Finish dictation',false,'button'],[true,true,'',[],false,'Stop generating',false,'button']]){
  const attrs={},button={classList:{toggle(){}},setAttribute:(k,v)=>attrs[k]=v},ctx=vm.createContext({state:{sending,attachments},voiceInput:{snapshot:()=>({active,available,reason:'Offline'})},icons:{stop:'Stop',send:'Send',voice:'Voice'},$:s=>s==='#send-button'?button:{value:text}});vm.runInContext(functionSource+'\nupdateSendButton()',ctx);assert.equal(attrs['aria-label'],label);assert.equal(button.disabled,disabled);assert.equal(button.type,type);
 }
});

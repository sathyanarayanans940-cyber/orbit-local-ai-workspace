const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const W=require('../widgets.js'),L=require('../long-documents.js');
// Synthetic regression derived from the failure pattern, without private chat/profile data.
const brief='I have an assignment research paper to make. Maximum of 12 pages. Introduction and related work 4 pages; framework and method 4 pages; complexity and conclusion 4 pages. Times New Roman 11 pt, single spacing. Microsoft Word document (.docx). I will tell the topic.';
const topic='The topic is Random Forest intrusion detection in a Mist-Fog-Cloud environment. Now make it.';
const history=[{role:'user',text:brief},{role:'assistant',text:'A generic template.'},{role:'user',text:topic},{role:'assistant',text:'An outline instead of the requested document.'}];

test('contextual document requests inherit the user page brief, never assistant guesses',()=>{
 assert.deepEqual(L.target(topic,history.slice(0,2)),{kind:'docx',count:12});
 assert.deepEqual(L.target('ok bro make a detailed word document',history),{kind:'docx',count:12});
 assert.deepEqual(L.target('make the same PDF',history),{kind:'pdf',count:12});
 assert.deepEqual(L.target('Create a 9 page Word document instead',history),{kind:'docx',count:9});
 for(const prompt of ['Explain the above','Create a short Word document','Create a 2 page Word document','Make a new Word document','Create a PowerPoint from this','Create a Word document about gardening'])assert.equal(L.target(prompt,history),null,prompt);
 assert.equal(L.target('now make it',[{role:'assistant',text:'Make a 12 page Word document.'}]),null);
 assert.equal(L.target('now make it',[...history,{role:'user',text:'A different topic now: gardening.'}]),null);
});
test('long-document source context preserves an earlier user brief beyond eight messages',()=>{
 const context=L.sourceContext([...history,...Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',text:'Follow-up '+i}))],m=>m.text);
 assert.ok(context.some(m=>m.text===brief));assert.ok(context.some(m=>m.text===topic));
});
test('failed clarification repair cannot fabricate a Word file from profile suggestions',async()=>{
 const message={role:'assistant',text:'What topic should the document cover?\n\n* A study plan\n* A technical roadmap\n\nTell me what you have in mind.'};let generated=0,repairs=0;
 const ctx={OrbitWidgets:{...W,generate:async()=>{generated++;return new Blob(['wrong file']);}},crypto:require('node:crypto').webcrypto,state:{models:[{key:'test'}],selectedModel:'test',messages:[...history,{role:'user',text:'make a detailed word document'},message]},renderMessages(){},persistCurrentChat(){},requestLocalReply:async(_,messages)=>{
  repairs++;const r=JSON.parse(messages[1].text);assert.match(JSON.stringify(r.sourceContext),/Random Forest/);assert.match(JSON.stringify(r.sourceContext),/Times New Roman/);
  return {text:'{"repairs":[{"index":0,"error":"Cannot safely repair"}]}'};
 }};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
 await ctx.finalizeMessageWidgets(message,'make a detailed word document');
 assert.equal(repairs,1);assert.equal(generated,0);assert.equal(message.artifacts.length,0);assert.match(message.widgetError,/No substitute file/);assert.doesNotMatch(message.text,/files? (?:is|are) ready/);
});
test('malformed JSON receives bounded source-grounded repair and creates only the corrected recipe',async()=>{
 const message={role:'assistant',text:'I will prepare the Word document.\n```orbit-widget\n{"kind":"docx","title" "Research","blocks":[]}\n```'};let count=0;
 const spec={kind:'docx',title:'Random Forest IDS',style:{word:{body:{font:'Times New Roman',size:11}}},blocks:[{type:'paragraph',text:'Mist, Fog and Cloud.'}]};
 const ctx={OrbitWidgets:{...W,generate:async s=>{count++;assert.equal(s.title,spec.title);return new Blob(['valid']);}},crypto:require('node:crypto').webcrypto,state:{models:[{key:'test'}],selectedModel:'test',messages:[...history,message]},renderMessages(){},persistCurrentChat(){},requestLocalReply:async(_,messages)=>{
  const r=JSON.parse(messages[1].text);assert.equal(r.slots.length,1);assert.match(JSON.stringify(r.sourceContext),/Random Forest/);return {text:JSON.stringify({repairs:[{index:r.slots[0].index,widget:spec}]})};
 }};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),ctx);
 await ctx.finalizeMessageWidgets(message,'make a detailed word document');assert.equal(count,1);assert.equal(message.widgetError,undefined);assert.equal(message.artifacts[0].spec.style.word.body.size,11);
});

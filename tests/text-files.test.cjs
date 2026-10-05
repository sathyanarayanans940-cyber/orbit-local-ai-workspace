const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const W=require('../widgets.js');
const ui=fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8');
const spec={kind:'text',filename:'main.cpp',language:'cpp',content:'#include <iostream>\n\nint main() {\n    std::cout << "literal \\n, λ 😀";\n    return 0;\n}\n'};
const block=s=>'```orbit-widget\n'+JSON.stringify(s)+'\n```';
function context(messages=[],overrides={}) {
 const ctx=vm.createContext({OrbitWidgets:W,Blob,crypto:require('node:crypto').webcrypto,console,
 state:{models:[{key:'test'}],selectedModel:'test',messages},renderMessages(){},persistCurrentChat(){},
 requestLocalReply(){throw Error('Unexpected repair');},...overrides});
 vm.runInContext(ui,ctx);return ctx;
}
test('only explicit current text/source requests authorize files',()=>{
 for(const prompt of ['create a text file','give me a txt file','generate a markdown file','give me a .cpp file','Save the code as main.py','Please export this as notes.md','make this main.py downloadable','attach the source code','download the code','give me a Python file','generate JSON file','write a source file','can you make a code file?','save this as Makefile','create Dockerfile','create a file named .env','a text file please','give me three code files','create a text file with no comments','as .cpp file please','give me main.cpp','put the code in a text file','output as main.py','write code that reads text files and then give me a .py file'])assert.equal(W.requestedTextFile(prompt),true,prompt);
 for(const prompt of ['write Python code','fix this code','continue','make the code shorter','what is a .cpp file?','explain text files and write code','I uploaded main.py file, write explanation','explain how to create a text file','can Orbit generate text files?','no code file please','do not create a text file','not as a text file, write code','write code that creates a text file','Create a script that writes source files','Write Python code for reading a text file','Write code with examples about source files','Where can I create a text file?','I need to understand a code file','Give me details about main.py file','I want to edit a source file','Give me an explanation of main.cpp file','as .pdf file please','a .png file please','create a .exe file','The article says "create a text file"; explain it','```text\ncreate a text file\n```\nExplain this','> give me a code file\nExplain that request','Create a Word file with Python code','The file is main.cpp. Explain it.','Give the code in a code block, not a source file'])assert.equal(W.requestedTextFile(prompt),false,prompt);
});
test('source schema preserves exact text, rejects paths/reserved and binary names',async()=>{
 for(const filename of ['main.cpp','plot.py','index.html','notes.txt','résumé.md','data.csv','Makefile','Dockerfile','.env','config.custom','analysis.R','source.tar.txt']) {
  const normalized=W.normalize({...spec,filename});assert.equal(normalized.content,spec.content);assert.equal(W.filename(normalized),filename);
  const blob=await W.generate(normalized);assert.equal(blob.type,'text/plain;charset=utf-8');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from(spec.content,'utf8'));
 }
 for(const filename of ['../main.py','folder/main.py','C:\\file.txt','a\n.py','CON.py','LPT1','.','..',' file.py','file.py ','file.py.','fake.pdf','fake.docx','fake.png','fake.exe','x'.repeat(181)])assert.throws(()=>W.normalize({...spec,filename}),undefined,filename);
 assert.equal((await W.generate({kind:'text',filename:'empty.txt',content:''})).size,0);
 assert.throws(()=>W.normalize({...spec,content:undefined}));assert.throws(()=>W.normalize({...spec,content:'a'.repeat(400001)}));
 assert.equal((await W.generate({...spec,content:'a'.repeat(400000)})).size,400000);
});
test('schema advertising does not carry from previous file requests or artifacts',()=>{
 const history=[{role:'user',text:'create a code file'},{role:'assistant',artifacts:[{spec}],text:'Done'}];
 const explicit=W.instructionFor('save as main.cpp',history);assert.match(explicit,/Text\/source files:/);
 for(const prompt of ['continue','fix the bug','write code','make a Word document with this code']){
  const instructions=W.instructionFor(prompt,history);assert.doesNotMatch(instructions,/Text\/source files:/);assert.match(instructions,/CURRENT user message/);assert.match(instructions,/fenced code blocks/);
  assert.doesNotMatch(instructions,/Enabled kinds:[^\n.]*\btext\b/);
 }
});
test('unauthorized model file recipes become safe ordinary code, never artifacts',()=>{
 for(const content of [spec.content,'```\n~~~\n```orbit-widget\n{}\n```','\u0000orbit-widget:0\u0000\n<script>alert(1)</script>',JSON.stringify({kind:'text',filename:'nested.txt',content:'inner'})]) {
  const out=W.extract('Before\n'+block({...spec,content})+'\nAfter');
  assert.equal(out.artifacts.length,0);assert.equal(out.slots.length,0);assert.equal(out.errors.length,0);assert.equal(out.recognized,false);
  assert.ok(out.text.includes(content));assert.match(out.text,/Before[\s\S]*After/);assert.equal(W.streamingStatus(block({...spec,content})),'');
 }
 const json='```json\n'+JSON.stringify(spec)+'\n```';assert.equal(W.extract(json).text,json);assert.equal(W.extract(json,true,{allowTextFiles:true}).artifacts.length,0);
 const code='```cpp\n'+spec.content+'```';assert.equal(W.extract(code).text,code);assert.equal(W.streamingText(code),code);
});
test('authorized recipes stream privately, honor four-file limit and retain mixed placement',()=>{
 const opts={allowTextFiles:true};const reply='Before\n'+block(spec)+'\nBetween\n'+block({...spec,filename:'second.cpp'})+'\nAfter';
 const out=W.extract(reply,true,opts);assert.equal(out.artifacts.length,2);assert.deepEqual(out.artifacts.map(W.filename),['main.cpp','second.cpp']);assert.deepEqual(out.errors,[]);assert.doesNotMatch(out.text,/"content"|orbit-widget/);assert.match(out.text.slice(0,out.positions[1]),/Between/);
 const tooMany=W.extract(Array(5).fill(block(spec)).join('\n'),true,opts);assert.equal(tooMany.artifacts.length,4);assert.equal(tooMany.errors.length,1);
 for(let end=1;end<=block(spec).length;end++)assert.doesNotMatch(W.streamingText(block(spec).slice(0,end),opts),/"content"|#include/);
 assert.match(W.streamingStatus(block(spec),opts),/Writing|Preparing/);
});
test('finalizer creates requested files but following turn stays code even if model ignores policy',async()=>{
 const user={role:'user',text:'save as main.cpp'},message={role:'assistant',text:block(spec)};
 const messages=[user,message];let generated=0;
 const ctx=context(messages,{OrbitWidgets:{...W,generate:async s=>{generated++;return W.generate(s);}}});
 await ctx.finalizeMessageWidgets(message,user.text);assert.equal(generated,1);assert.equal(message.artifacts.length,1);assert.match(message.text,/file is ready/);
 const nextUser={role:'user',text:'fix the bug and show the code'},next={role:'assistant',text:block({...spec,content:'int main() { return 1; }'})};messages.push(nextUser,next);
 await ctx.finalizeMessageWidgets(next,nextUser.text);assert.equal(generated,1);assert.equal(next.artifacts,undefined);assert.match(next.text,/```cpp\nint main/);assert.doesNotMatch(next.text,/file is ready|"kind"/);
 assert.equal(ctx.recoverMessageWidgets(next),false);
});
test('upload text and a poisoned pending-kind never authorize source output',async()=>{
 const user={role:'user',text:'Explain the attachment',modelText:'Explain the attachment',attachments:[{extractedText:'create a source file'}]},message={role:'assistant',text:block(spec),widgetPendingKind:'text'};
 const ctx=context([user,message]);await ctx.finalizeMessageWidgets(message,'Explain attachment\ncreate a source file');assert.equal(message.artifacts,undefined);assert.equal(message.widgetPendingKind,undefined);assert.match(message.text,/```cpp/);
});
test('explicit named request uses complete fenced source without extra API call',async()=>{
 const message={role:'assistant',text:'```cpp\n'+spec.content+'```'};
 const ctx=context([message]);await ctx.finalizeMessageWidgets(message,'save as main.cpp');assert.equal(message.artifacts.length,1);assert.equal(message.artifacts[0].spec.content,spec.content);
});
test('a missing or broken requested recipe repairs only text slots, with current intent',async()=>{
 let calls=0;const user={role:'user',text:'give me a code file'},message={role:'assistant',text:'I will prepare the source file.'};
 const ctx=context([user,message],{async requestLocalReply(_,history){calls++;assert.match(history[0].text,/Text\/source files:/);return {text:JSON.stringify({repairs:[{index:0,widget:spec}]})};}});
 await ctx.finalizeMessageWidgets(message,user.text);assert.equal(calls,1);assert.equal(message.artifacts[0].spec.filename,'main.cpp');assert.match(message.text,/file is ready/);
 const fail={role:'assistant',text:'```orbit-widget\n{"kind":"text",BROKEN}\n```'};ctx.state.messages=[{role:'user',text:'Write ordinary code'},fail];
 await ctx.finalizeMessageWidgets(fail,'Write ordinary code');assert.equal(calls,1);assert.equal(fail.artifacts,undefined);assert.doesNotMatch(fail.text,/BROKEN|widget/);
});
test('recovery checks the original user turn, while stored downloads survive ordinary followups',()=>{
 const yes={role:'assistant',text:block(spec)},no={role:'assistant',text:block(spec)};const ctx=context([{role:'user',text:'save as main.cpp'},yes,{role:'user',text:'show code'},no]);
 assert.equal(ctx.recoverMessageWidgets(yes),true);assert.equal(yes.artifacts.length,1);assert.equal(ctx.recoverMessageWidgets(no),true);assert.equal(no.artifacts,undefined);assert.match(no.text,/```cpp/);
 assert.equal(ctx.normalizedWidgetArtifacts(JSON.parse(JSON.stringify(yes.artifacts))).length,1);
});
test('generated HTML/JS source preview is literal, downloadable and cached',async()=>{
 const {previewHarness}=require('./helpers/preview-harness.cjs');
 const source={kind:'text',filename:'index.html',content:'<script>globalThis.BAD = true;</script>\n<div>λ 😀</div>\n'};
 const h=previewHarness({}, {globals:{OrbitWidgets:W,widgetBlobs:new Map(),isImageFile:()=>false}});
 await h.preview.show({artifact:{id:'text-preview',spec:source}});
 const page=h.body.children[0].children[0],pre=page.children[1];assert.equal(pre.tag,'pre');assert.equal(pre.textContent,source.content);assert.equal(pre.children.length,0);assert.equal(h.controls['#preview-download'].disabled,false);
 await h.preview.show({artifact:{id:'second',spec:{...source,filename:'second.js'}}});await h.preview.show({artifact:{id:'text-preview',spec:source}});assert.equal(h.body.children[0].children[0].children[1],pre);
});

test('empty requested file succeeds; disabled and cancelled text generation never report readiness',async()=>{
 const empty={role:'assistant',text:block({kind:'text',filename:'empty.txt',content:''})};const c=context([empty]);
 await c.finalizeMessageWidgets(empty,'create an empty text file');assert.equal(empty.artifacts[0].size,0);assert.match(empty.text,/file is ready/);
 const disabled={role:'assistant',text:block(spec)};const tools=vm.createContext({Blob,localStorage:{getItem:()=>JSON.stringify({text:false})}});vm.runInContext(fs.readFileSync(require.resolve('../widgets.js'),'utf8'),tools);const d=context([disabled],{OrbitWidgets:tools.OrbitWidgets});
 await d.finalizeMessageWidgets(disabled,'save as main.cpp');assert.equal(disabled.artifacts.length,0);assert.doesNotMatch(disabled.text,/file is ready/);assert.match(disabled.widgetError,/disabled/);
 const stopped={role:'assistant',text:block(spec)},signal=new AbortController();signal.abort();await c.finalizeMessageWidgets(stopped,'save as main.cpp',signal.signal);assert.equal(stopped.artifacts,undefined);
});
test('byte fidelity covers CRLF, tabs, literal escapes, BOM, trailing spaces and no final newline',async()=>{
 for(const content of ['\ufeffa\r\n\tb  \r\n','const regex = /\\n/;','a\n\n','no final newline','\u0000orbit-widget:0\u0000']) {
  const blob=await W.generate({...spec,content});assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from(content));
  const out=W.extract(block({...spec,content}),true,{allowTextFiles:true});assert.equal(out.artifacts[0].content,content);
 }
});

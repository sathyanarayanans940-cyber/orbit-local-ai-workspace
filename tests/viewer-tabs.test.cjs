const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {previewHarness,deferred,flush,fakePage}=require('./helpers/preview-harness.cjs');
const source=fs.readFileSync(require.resolve('../file-preview.js'),'utf8');
const attachment=(name,text='int main() {\n    return 0;\n}\n')=>({name,type:'text/plain',file:new Blob([text],{type:'text/plain'})});
const globals={isPdfFile:a=>/\.pdf$/i.test(a.name),isDocxFile:a=>/\.docx$/i.test(a.name),isPptxFile:()=>false,isTextFile:a=>a.type?.startsWith('text/')};
const harness=(extra={})=>previewHarness({}, {globals:{...globals,...extra}});
const content=h=>h.body.children[0].children[0].children[1].textContent;
test('same-name uploads have distinct tabs; repeated clicks reuse the original file tab',async()=>{
 const h=harness(),a=attachment('main.cpp','first'),b=attachment('main.cpp','second');
 await h.preview.show({attachment:a});await h.preview.show({attachment:b});assert.equal(h.tabs.length,2);assert.equal(content(h),'second');
 await h.preview.show({attachment:a});assert.equal(h.tabs.length,2);assert.equal(content(h),'first');assert.equal(h.tabs[0].getAttribute('aria-selected'),'true');
 assert.equal(h.toggle.getAttribute('aria-expanded'),'true');
});
test('hiding and switching preserve connected previews, zoom and scroll without rerendering',async()=>{
 const h=harness(),a=attachment('a.c','a'),b=attachment('b.c','b');
 await h.preview.show({attachment:a});const original=h.body;h.body.scrollTop=125;h.body.scrollLeft=20;h.zoomButtons[1].click();
 await h.preview.show({attachment:b});assert.equal(h.controls['#preview-zoom'].textContent,'100%');assert.equal(h.body.children.length,1);
 await h.preview.show({attachment:a});assert.equal(h.body,original);assert.equal(h.body.scrollTop,125);assert.equal(h.body.scrollLeft,20);assert.equal(h.controls['#preview-zoom'].textContent,'125%');
 h.preview.close();assert.equal(h.panes.length,2);assert.ok(h.panes.every(p=>p.hidden));assert.equal(h.tabs.length,2);assert.equal(h.toggle.getAttribute('aria-expanded'),'false');
 await h.preview.open();assert.equal(content(h),'a');assert.equal(h.body.scrollTop,125);assert.equal(h.controls['#preview-zoom'].textContent,'125%');
});
test('closing active and inactive tabs chooses a neighbor, keeps downloads correct, and supports an empty viewer',async()=>{
 const h=harness(),a=attachment('a.c','a'),b=attachment('b.c','b'),c=attachment('c.c','c');
 for(const item of [a,b,c])await h.preview.show({attachment:item});
 await h.preview.closeTab(h.tabs[0].id);assert.equal(content(h),'c');assert.equal(h.tabs.length,2);
 await h.preview.closeTab(h.tabs[1].id);assert.equal(content(h),'b');assert.equal(h.controls['#preview-name'].textContent,'b.c');assert.equal(h.controls['#preview-download'].disabled,false);
 await h.preview.closeTab(h.tabs[0].id);assert.equal(h.tabs.length,0);assert.match(h.body.innerHTML,/Your files, side by side/);assert.equal(h.controls['#preview-download'].disabled,true);
 h.preview.close();await h.preview.open();assert.equal(h.panel.hidden,false);assert.match(h.body.innerHTML,/Open a file/);
});
test('tabs survive chat navigation and generated IDs from different chats do not collide',async()=>{
 const state={currentChat:'first'},h=harness({state,OrbitWidgets:{filename:spec=>spec.title+'.svg',normalize:s=>s,diagramInlineSvg:s=>'<svg>'+s.title+'</svg>',generate:async()=>new Blob(['svg'])},widgetBlobs:new Map()});
 const make=title=>({artifact:{id:'shared-import-id',spec:{kind:'diagram',title,width:300}}});
 await h.preview.show(make('First'));state.currentChat='second';await h.preview.show(make('Second'));assert.equal(h.tabs.length,2);
 h.preview.close();state.currentChat='new';await h.preview.open();assert.equal(h.controls['#preview-name'].textContent,'Second.svg');
 await h.tabs[0].click();assert.equal(h.controls['#preview-name'].textContent,'First.svg');assert.match(h.body.innerHTML,/First/);
});
test('tab keyboard navigation wraps, selects endpoints, and Delete closes only the selected file',async()=>{
 const h=harness();for(const name of ['a.c','b.c','c.c'])await h.preview.show({attachment:attachment(name,name)});
 const key=(tab,key)=>tab.onkeydown({key,preventDefault(){}});
 key(h.tabs[2],'ArrowRight');await flush();assert.equal(h.tabs[0].getAttribute('aria-selected'),'true');
 key(h.tabs[0],'End');await flush();assert.equal(h.tabs[2].getAttribute('aria-selected'),'true');
 key(h.tabs[2],'Home');await flush();key(h.tabs[0],'Delete');await flush();assert.equal(h.tabs.length,2);assert.equal(h.controls['#preview-name'].textContent,'b.c');
});
test('closing a Word tab during conversion cannot resurrect it or overwrite the selected text file',async()=>{
 const pending=deferred(),h=harness({OrbitWidgets:{engine:async()=>({wordPreview:()=>pending.promise})}});
 const opening=h.preview.show({attachment:{name:'slow.docx',file:new Blob(['word'])}});await flush();const old=h.tabs[0].id;
 await h.preview.show({attachment:attachment('main.c','visible')});await h.preview.closeTab(old);pending.resolve('<p>STALE</p>');await opening;
 assert.equal(h.tabs.length,1);assert.equal(content(h),'visible');assert.equal(h.controls['#preview-name'].textContent,'main.c');
});
test('cached PDF worker, canvas and page navigation survive switching; closing destroys them',async()=>{
 let destroyed=0;const reader={getDocument:()=>({promise:Promise.resolve({numPages:3,getPage:async()=>fakePage()}),destroy:async()=>{destroyed++;}})};
 const h=previewHarness(reader,{globals}),pdf={name:'a.pdf',file:new Blob(['%PDF'])};
 await h.preview.show({attachment:pdf});await h.fallback().click();h.body.children[0].children[0].children[2].click();await flush();
 assert.equal(h.body.children[0].children[0].children[1].textContent,'Page 2 of 3');
 const original=h.body,canvas=h.body.children[0].children[1];
 await h.preview.show({attachment:attachment('main.c','code')});assert.equal(destroyed,0);assert.equal(h.revoked.length,0);
 await h.preview.show({attachment:pdf});await flush();assert.equal(h.body,original);assert.equal(h.body.children[0].children[1],canvas);assert.equal(h.body.children[0].children[0].children[1].textContent,'Page 2 of 3');
 h.body.children[0].children[0].children[2].click();await flush();assert.equal(h.body.children[0].children[0].children[1].textContent,'Page 3 of 3');
 await h.preview.closeTab(h.tabs[0].id);assert.equal(destroyed,1);assert.equal(h.revoked.length,1);
});
test('150 open tabs retain at most four connected previews with only one visible',async()=>{
 const h=harness();for(let i=0;i<150;i++)await h.preview.show({attachment:attachment(`file-${i}.cpp`,String(i))});
 assert.equal(h.tabs.length,150);assert.equal(h.tabs.filter(t=>t.getAttribute('aria-selected')==='true').length,1);assert.equal(h.body.children.length,1);assert.equal(content(h),'149');
 assert.equal(h.panes.length,4);assert.equal(h.panes.filter(p=>!p.hidden).length,1);
 h.preview.close();assert.ok(h.panes.every(p=>p.hidden));assert.equal(h.tabs.length,150);
});
test('Word conversion runs once while its connected frame survives repeated switches and hide/reopen',async()=>{
 let conversions=0;const h=harness({OrbitWidgets:{engine:async()=>({wordPreview:async()=>{conversions++;return '<p>Word layout</p>';}})}}),word={name:'notes.docx',file:new Blob(['word'])},code=attachment('a.c');
 await h.preview.show({attachment:word});const pane=h.body,frame=h.body.children[0];
 for(let i=0;i<12;i++){await h.preview.show({attachment:code});await h.preview.show({attachment:word});assert.equal(h.body,pane);assert.equal(h.body.children[0],frame);}
 h.preview.close();await h.preview.open();assert.equal(h.body.children[0],frame);assert.equal(conversions,1);
});
test('native PDF iframe and URL remain intact until LRU eviction, then the original can be reopened',async()=>{
 const h=harness(),pdf={name:'notes.pdf',file:new Blob(['%PDF'])};await h.preview.show({attachment:pdf});const pane=h.body,frame=h.body.children[0],id=h.tabs[0].id;
 for(let i=0;i<3;i++)await h.preview.show({attachment:attachment(`code-${i}.c`)});
 await h.preview.show({attachment:pdf});assert.equal(h.body,pane);assert.equal(h.body.children[0],frame);assert.equal(h.revoked.length,0);
 for(let i=3;i<7;i++)await h.preview.show({attachment:attachment(`code-${i}.c`)});
 assert.equal(h.panes.length,4);assert.equal(pane.parentNode,null);assert.equal(h.revoked.length,1);assert.ok(h.tabs.some(tab=>tab.id===id));
 await h.preview.show({attachment:pdf});assert.notEqual(h.body.children[0],frame);assert.equal(h.controls['#preview-download'].disabled,false);
});
test('the backing-byte estimate evicts older previews even below the four-tab count',async()=>{
 const h=harness(),code=attachment('a.c'),file=new Blob(['large text']);Object.defineProperty(file,'size',{value:24*1024*1024});
 await h.preview.show({attachment:code});const first=h.body;
 await h.preview.show({attachment:{name:'large.txt',type:'text/plain',file}});assert.equal(h.panes.length,1);assert.equal(first.parentNode,null);assert.equal(h.tabs.length,2);
});
test('an evicted inactive PDF worker is destroyed once without touching the current download',async()=>{
 let destroyed=0;const reader={getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>fakePage()}),destroy:async()=>{destroyed++;}})},h=previewHarness(reader,{globals});
 await h.preview.show({attachment:{name:'old.pdf',file:new Blob(['%PDF'])}});await h.fallback().click();const id=h.tabs[0].id;
 for(let i=0;i<4;i++)await h.preview.show({attachment:attachment(`next-${i}.c`)});
 assert.equal(destroyed,1);assert.equal(h.revoked.length,1);assert.equal(h.controls['#preview-name'].textContent,'next-3.c');assert.equal(h.controls['#preview-download'].disabled,false);
 await h.preview.closeTab(id);assert.equal(destroyed,1);assert.equal(h.panes.length,4);
});
test('page navigation frees cached workers and panes, leaving the viewer reopenable on browser Back',async()=>{
 let destroyed=0;const h=previewHarness({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>fakePage()}),destroy:async()=>{destroyed++;}})},{globals});
 await h.preview.show({attachment:{name:'old.pdf',file:new Blob(['%PDF'])}});await h.fallback().click();await h.preview.show({attachment:attachment('a.c','cached code')});
 h.windowEvents.pagehide();assert.equal(h.panel.hidden,true);assert.equal(h.panes.length,0);assert.equal(destroyed,1);assert.equal(h.revoked.length,1);assert.equal(h.tabs.length,2);
 await h.preview.open();assert.equal(content(h),'cached code');assert.equal(h.toggle.getAttribute('aria-expanded'),'true');
});
test('a failed tab can retry without duplicates and still downloads the original binary',async()=>{
 const h=harness(),a=attachment('bad.txt','a\u0000b');await h.preview.show({attachment:a});assert.match(h.body.textContent,/binary file/);assert.equal(h.controls['#preview-download'].disabled,false);
 await h.preview.show({attachment:a});assert.equal(h.tabs.length,1);assert.match(h.body.textContent,/binary file/);
});
test('text previews preserve indentation, Unicode, UTF-16 and literal HTML, with bounded large-file decoding',async()=>{
 const ctx=vm.createContext({TextDecoder,Blob,limitExtractedText:s=>s});vm.runInContext(source.slice(0,source.indexOf('const OrbitPreview')),ctx);
 const text='    #include <iostream>\n// café 😀\n<script>alert(1)</script>\n';assert.equal((await ctx.readPreviewText(new Blob([text]))).text,text);
 const utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from('    α = 2\n','utf16le')]);assert.equal((await ctx.readPreviewText(new Blob([utf16]))).text,'    α = 2\n');
 const large=await ctx.readPreviewText(new Blob(['a'.repeat(1024*1024-1)+'😀more']));assert.equal(large.truncated,true);assert.equal(large.text.length,1024*1024-1);assert.doesNotMatch(large.text,/�/);
 const empty=await ctx.readPreviewText(new Blob([]));assert.equal(empty.text,'');assert.equal(empty.truncated,false);
});
test('file storage coalesces concurrent requests without keeping a duplicate blob per viewer tab',async()=>{
 const {indexedDB}=require('fake-indexeddb'),crypto=require('node:crypto').webcrypto,h=harness({indexedDB,crypto}),file=new Blob(['code']);
 const [a,b]=await Promise.all([h.preview.store(file),h.preview.store(file)]);assert.ok(a);assert.equal(a,b);assert.equal(await h.preview.store(file),a);
});
test('worksheet and row pagination selections survive changing viewer tabs',async()=>{
 const h=harness({OrbitWidgets:{filename:spec=>spec.title+'.xlsx',normalize:s=>s,generate:async()=>new Blob(['workbook'])},widgetBlobs:new Map()});
 const workbook={artifact:{id:'sheets',spec:{kind:'xlsx',title:'Results',sheets:[{name:'Data',headers:['Row'],rows:Array.from({length:350},(_,i)=>[i])},{name:'Notes',headers:['Note'],rows:[['Last sheet']]}]}}};
 await h.preview.show(workbook);const first=h.body.children[0];first.children[2].children[2].click();first.children[2].children[2].click();
 assert.match(first.children[2].children[1].textContent,/Rows 202–301/);
 await h.preview.show({attachment:attachment('a.c')});await h.preview.show(workbook);assert.match(h.body.children[0].children[2].children[1].textContent,/Rows 202–301/);
 h.body.children[0].children[0].children[1].click();await h.preview.show({attachment:attachment('b.c')});await h.preview.show(workbook);assert.match(h.body.children[0].children[2].children[1].textContent,/Notes/);
});
test('a pending upload and its saved preview ID reuse one tab after IndexedDB storage',async()=>{
 const {indexedDB}=require('fake-indexeddb'),crypto=require('node:crypto').webcrypto,h=harness({indexedDB,crypto}),pending=attachment('saved.cpp','saved content');
 await h.preview.show({attachment:pending});const previewId=await h.preview.store(pending.file);await flush();
 await h.preview.show({attachment:{name:pending.name,type:pending.type,previewId}});assert.equal(h.tabs.length,1);h.preview.close();await h.preview.open();assert.equal(content(h),'saved content');
});
test('common source-language and extensionless files are recognized without admitting executables',()=>{
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),ctx=vm.createContext({});
 vm.runInContext(app.match(/const TEXT_FILE_EXTENSIONS = .*;/)[0]+'\n'+app.slice(app.indexOf('function isTextFile('),app.indexOf('function limitExtractedText(')),ctx);
 for(const name of ['main.cpp','main.cxx','main.go','main.cs','main.rs','main.swift','main.kt','main.php','main.lua','main.dart','main.mjs','Dockerfile','Dockerfile.dev','Makefile','.env.local','.gitignore'])assert.equal(ctx.isTextFile({name}),true,name);
 for(const name of ['program.exe','image.png','archive.zip'])assert.equal(ctx.isTextFile({name}),false,name);
});

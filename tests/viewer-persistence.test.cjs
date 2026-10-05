const {test}=require('node:test'),assert=require('node:assert/strict');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb'),crypto=require('node:crypto').webcrypto;
const {previewHarness,deferred,flush}=require('./helpers/preview-harness.cjs');
const KEY='orbit-viewer-tabs-v1';
function fixture(){
 const values=new Map(),localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},indexedDB=new IDBFactory();
 const globals={localStorage,indexedDB,crypto,isPdfFile:a=>/\.pdf$/i.test(a.name),isTextFile:a=>/\.(txt|cpp|c)$/i.test(a.name),isPptxFile:()=>false,
  OrbitWidgets:{filename:s=>s.filename,normalize:s=>s,generate:async s=>new Blob([s.content],{type:'text/plain'})},widgetBlobs:new Map()};
 return {values,globals,create:extra=>previewHarness({}, {globals:{...globals,...extra}}),session:()=>JSON.parse(values.get(KEY))};
}
const upload=(name,text)=>({attachment:{name,type:'text/plain',size:text.length,file:new Blob([text],{type:'text/plain'})}});
const artifact=(id,name,content)=>({artifact:{id,spec:{kind:'text',filename:name,content}}});
const content=h=>h.body.children[0].children[0].children[1].textContent;
test('reload restores tab order and selection with no previews, blob reads or generation until opened',async()=>{
 const f=fixture(),first=f.create();await first.preview.show(upload('main.cpp','first α 😀'));await first.preview.show(artifact('second','main.cpp','second'));
 first.body.scrollTop=173;first.body.scrollLeft=24;first.zoomButtons[1].click();first.windowEvents.pagehide();
 const raw=f.values.get(KEY);assert.doesNotMatch(raw,/first α|"content"|"spec"|blob:/);assert.ok(raw.length<2000);
 let reads=0,generations=0;const get=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(...args){reads++;return get.apply(this,args);};
 try{
  const next=f.create({OrbitWidgets:{...f.globals.OrbitWidgets,generate:async s=>{generations++;return new Blob([s.content]);}}});
  assert.equal(next.tabs.length,2);assert.equal(next.panes.length,0);assert.equal(next.panel.hidden,true);assert.equal(reads,0);assert.equal(generations,0);
  assert.equal(next.tabs[1].getAttribute('aria-selected'),'true');await next.preview.open();
  assert.equal(content(next),'second');assert.equal(next.body.scrollTop,173);assert.equal(next.body.scrollLeft,24);assert.equal(next.controls['#preview-zoom'].textContent,'125%');assert.equal(generations,1);assert.equal(next.panes.length,1);
  next.tabs[0].click();await new Promise(r=>setTimeout(r,20));assert.equal(content(next),'first α 😀');assert.equal(next.controls['#preview-download'].disabled,false);assert.equal(next.panes.length,2);
 }finally{IDBObjectStore.prototype.get=get;}
});
test('repeated reloads deduplicate file IDs, references and generated IDs in their actual source chat',async()=>{
 const f=fixture(),first=f.create({state:{currentChat:'unrelated'}}),a=upload('notes.c','notes');
 a.chatId='source';a.ref={chatId:'source',messageIndex:3,attachmentIndex:1};await first.preview.show(a);
 const previewId=f.session().tabs[0].previewId;
 const one={...artifact('same','result.cpp','ONE'),chatId:'one'},two={...artifact('same','result.cpp','TWO'),chatId:'two'};
 await first.preview.show(one);await first.preview.show(two);first.windowEvents.pagehide();
 const next=f.create({state:{currentChat:'different'}});await next.preview.show({...a,attachment:{name:'notes.c',type:'text/plain',previewId}});assert.equal(next.tabs.length,3);assert.equal(content(next),'notes');
 await next.preview.show(one);assert.equal(next.tabs.length,3);assert.equal(content(next),'ONE');await next.preview.show(two);assert.equal(content(next),'TWO');
 next.windowEvents.pagehide();const third=f.create();await third.preview.open();assert.equal(third.tabs.length,3);assert.equal(content(third),'TWO');
});
test('closing tabs commits immediately and reload never brings closed tabs back; hiding keeps them',async()=>{
 const f=fixture(),h=f.create();for(let i=0;i<4;i++)await h.preview.show(artifact('a'+i,'a'+i+'.cpp',String(i)));
 h.preview.close();assert.equal(f.session().tabs.length,4);await h.preview.closeTab(h.tabs[1].id);await h.preview.closeTab(h.tabs[2].id);
 assert.deepEqual(f.session().tabs.map(t=>t.name),['a0.cpp','a2.cpp']);assert.equal(h.panel.hidden,true);
 const next=f.create();assert.equal(next.tabs.length,2);await next.preview.open();assert.equal(content(next),'2');
 await next.preview.closeTab(next.tabs[0].id);await next.preview.closeTab(next.tabs[0].id);assert.equal(f.session().tabs.length,0);const empty=f.create();assert.equal(empty.tabs.length,0);await empty.preview.open();assert.match(empty.body.innerHTML,/Your files/);
});
test('closing while original storage and Word conversion are pending cannot resurrect the tab',async()=>{
 const f=fixture(),pending=deferred(),h=f.create({isDocxFile:()=>true,OrbitWidgets:{engine:async()=>({wordPreview:()=>pending.promise})}});
 const opening=h.preview.show(upload('pending.docx','WORD'));await flush();await h.preview.closeTab(h.tabs[0].id);pending.resolve('<p>STALE</p>');await opening;
 assert.equal(f.session().tabs.length,0);assert.equal(f.create().tabs.length,0);
});
test('missing snapshots fall back to an exact disk transcript reference without navigating the chat',async()=>{
 const f=fixture(),state={currentChat:'other',messages:[],deletedChats:new Set()},h=f.create({state});
 await h.preview.show({...upload('result.cpp','BODY'),chatId:'source',ref:{chatId:'source',messageIndex:2,attachmentIndex:1}});h.windowEvents.pagehide();
 const tab=f.session().tabs[0];const db=await new Promise((r,j)=>{const q=f.globals.indexedDB.open('orbit-viewer-tabs');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
 const tx=db.transaction('viewer','readwrite');tx.objectStore('viewer').delete(tab.storageId);await new Promise(r=>tx.oncomplete=r);db.close();
 let loads=0;const next=f.create({state,OrbitChatStore:{load:async id=>{loads++;assert.equal(id,'source');return {messages:[{}, {},{attachments:[{name:'wrong.c',extractedText:'WRONG'},{name:'result.cpp',type:'text/plain',previewId:tab.previewId}]}]};}}});
 assert.equal(loads,0);await next.preview.open();assert.equal(content(next),'BODY');assert.equal(loads,1);assert.equal(state.currentChat,'other');
});
test('blocked or corrupt storage never breaks the live viewer; missing originals show a recoverable error',async()=>{
 for(const value of ['{bad','null','{"version":7,"tabs":[]}','{"version":1,"tabs":[null,{},42]}']){
  const f=fixture();f.values.set(KEY,value);const h=f.create();assert.equal(h.tabs.length,0);await h.preview.show(artifact('safe','safe.c','SAFE'));assert.equal(content(h),'SAFE');
 }
 const f=fixture(),h=f.create({localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('quota');}},indexedDB:undefined});await h.preview.show(upload('live.cpp','LIVE'));assert.equal(content(h),'LIVE');h.preview.close();await h.preview.open();assert.equal(content(h),'LIVE');
 f.values.set(KEY,JSON.stringify({version:1,selected:'missing',tabs:[{storageId:'missing',key:'missing',name:'missing.cpp',kind:'CPP',zoom:999,scrollTop:-5}]}));
 const missing=f.create();await missing.preview.open();assert.match(missing.body.textContent,/no longer available/);assert.equal(missing.controls['#preview-download'].disabled,true);await missing.preview.closeTab(missing.tabs[0].id);assert.equal(f.session().tabs.length,0);
});
test('150 persistent tabs retain only four connected previews and restore entirely unloaded',async()=>{
 const f=fixture(),h=f.create();for(let i=0;i<150;i++)await h.preview.show(artifact('a'+i,'a'+i+'.cpp','// '+i));
 assert.equal(h.panes.length,4);assert.equal(f.session().tabs.length,150);h.windowEvents.pagehide();const next=f.create();assert.equal(next.tabs.length,150);assert.equal(next.panes.length,0);await next.preview.open();assert.equal(content(next),'// 149');assert.equal(next.panes.length,1);
});
test('original files remain intact and another open v1 connection cannot block viewer persistence',async()=>{
 const f=fixture(),open=f.globals.indexedDB.open('orbit-file-previews',1);open.onupgradeneeded=()=>open.result.createObjectStore('files');
 const old=await new Promise(r=>open.onsuccess=()=>r(open.result));const tx=old.transaction('files','readwrite');tx.objectStore('files').put(new Blob(['OLD α']),'old');await new Promise(r=>tx.oncomplete=r);
 try{const h=f.create();await h.preview.show({attachment:{name:'old.c',type:'text/plain',previewId:'old'}});assert.equal(content(h),'OLD α');assert.equal(old.version,1);h.windowEvents.pagehide();const next=f.create();await next.preview.open();assert.equal(content(next),'OLD α');}finally{old.close();}
});
test('spreadsheet position persists across reload and restores only its selected workbook',async()=>{
 const f=fixture(),extra={OrbitWidgets:{filename:s=>s.title+'.xlsx',normalize:s=>s,generate:async()=>new Blob(['sheet'])}},h=f.create(extra);
 await h.preview.show({artifact:{id:'book',spec:{kind:'xlsx',title:'Book',sheets:[{name:'First',headers:['N'],rows:Array.from({length:350},(_,i)=>[i])},{name:'Second',headers:['N'],rows:[[42]]}]}}});
 h.body.children[0].children[2].children[2].click();h.body.children[0].children[2].children[2].click();h.windowEvents.pagehide();const next=f.create(extra);await next.preview.open();assert.match(next.body.children[0].children[2].children[1].textContent,/Rows 202–301/);
});

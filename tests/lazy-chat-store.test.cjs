const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const memories=require('../memories.js'),widgets=require('../widgets.js');
const source=fs.readFileSync('chat-store.js','utf8');
function setup(legacy=null){let raw=legacy;const storage={getItem:()=>raw,removeItem:()=>{raw=null;}};const ctx=vm.createContext({indexedDB:new IDBFactory(),localStorage:storage,structuredClone,OrbitMemories:memories,OrbitWidgets:widgets});vm.runInContext(source,ctx);return {s:ctx.OrbitChatStore,ctx,storage};}
const fixture=()=>({a:{title:'தமிழ் 🌿',updatedAt:1,messages:[{role:'user',text:'zirconium 7.35'}, {role:'assistant',text:'x'.repeat(50000)}]},b:{title:'Second',pinned:true,messages:[{role:'user',text:'Other'}]}});
test('startup reads metadata only; opening and export recover exact transcripts',async()=>{
 const data=fixture(),{s,storage}=setup(JSON.stringify(data));const index=await s.ready;s.adopt(index);
 assert.equal(storage.getItem(),null);assert.equal(index.a.messages,undefined);assert.equal(index.a.messageCount,2);assert.ok(JSON.stringify(index).length<5000);
 assert.deepEqual((await s.load('a')).messages,data.a.messages);
 index.a.title='Renamed';await s.save(index);assert.equal((await s.load('a')).title,'Renamed');assert.deepEqual((await s.load('a')).messages,data.a.messages);
 const reopened=s.create({name:'orbit-chat-history',indexedDB:undefined}); // Factory defaults use test context.
 await reopened.ready;assert.equal(reopened.initial.a.messages,undefined);assert.deepEqual((await reopened.load('a')).messages,data.a.messages);reopened.close();s.close();
});
test('failed write retries; metadata update cannot discard pending new messages; delete cannot resurrect',async()=>{
 const {s}=setup();const index=await s.ready;s.adopt(index);index.a=fixture().a;
 const original=IDBObjectStore.prototype.put;let fail=true;
 IDBObjectStore.prototype.put=function(...args){if(this.name==='chats'&&fail){fail=false;throw Error('Synthetic quota failure');}return original.apply(this,args);};
 try{await assert.rejects(s.save(index),/quota/);index.a.title='Newest';await s.save(index);assert.equal((await s.load('a')).messages.length,2);assert.equal(index.a.messages,undefined);
 index.a={...index.a,messages:[{role:'user',text:'latest detail'}]};const writes=[s.save(index)];index.a={...s.metadata(index.a),title:'Metadata only'};writes.push(s.save(index));await Promise.all(writes);assert.equal((await s.load('a')).messages[0].text,'latest detail');
 index.a={...index.a,messages:[{role:'user',text:'pending'}]};const write=s.save(index);delete index.a;await Promise.all([write,s.save(index)]);assert.equal(await s.load('a'),null);
 }finally{IDBObjectStore.prototype.put=original;s.close();}
});
test('5000 indexed chats keep no transcript bodies and oldest rare detail remains searchable',async()=>{
 const {s}=setup();const index=await s.ready;s.adopt(index);
 for(let i=0;i<5000;i++)index['c'+i]={title:'Chat '+i,updatedAt:i,messages:[{role:'user',text:i===0?'zirconium calibration 7.35':'ordinary notes '+i},{role:'assistant',text:'Detailed response '.repeat(30)}]};
 await s.save(index);assert.ok(Object.values(index).every(c=>!c.messages));let loads=0;
 const hits=await memories.searchAsync(index,memories.catalog(index,'new'),'zirconium calibration',[],undefined,()=>true,async id=>{loads++;return s.load(id);});
 assert.equal(loads,5000);assert.ok(hits.some(h=>h.excerpt.includes('7.35')));s.close();
});
test('malformed migration preserves original; aborted recall stops disk traversal',async()=>{
 const {s,storage}=setup('{broken');await assert.rejects(s.ready);assert.equal(storage.getItem(),'{broken');s.close();
 const controller=new AbortController();let reads=0;const chats={a:{messageCount:1},b:{messageCount:1}};
 await assert.rejects(memories.searchAsync(chats,memories.catalog(chats,'new'),'value',[],controller.signal,()=>true,async()=>{reads++;controller.abort();return {messages:[{role:'user',text:'value'}]};}),{name:'AbortError'});assert.equal(reads,1);
});
test('v1 database upgrades atomically without changing body bytes',async()=>{
 const {ctx,s}=setup();await s.ready;s.close();
 const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const opening=ctx.indexedDB.open('old-v1',1);opening.onupgradeneeded=()=>{opening.result.createObjectStore('chats');opening.result.createObjectStore('meta');};const old=await req(opening),tx=old.transaction(['chats','meta'],'readwrite');
 const data=fixture();for(const [id,chat]of Object.entries(data))tx.objectStore('chats').put(chat,id);tx.objectStore('meta').put(true,'migrated');await new Promise((res,rej)=>{tx.oncomplete=res;tx.onabort=rej;});old.close();
 const upgraded=s.create({name:'old-v1'});const index=await upgraded.ready;assert.equal(index.a.messages,undefined);assert.equal(index.a.messageCount,2);assert.deepEqual((await upgraded.load('a')).messages,data.a.messages);upgraded.close();
});
test('metadata-only rename writes no transcript records; rapid saves release all full bodies',async()=>{
 const {s}=setup();const chats=await s.ready;s.adopt(chats);chats.a=fixture().a;await s.save(chats);let writes=0;const original=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args){if(this.name==='chats')writes++;return original.apply(this,args);};
 try{for(let i=0;i<50;i++){chats.a.title='Rename '+i;await s.save(chats);}assert.equal(writes,0);assert.equal((await s.load('a')).title,'Rename 49');assert.equal((await s.load('a')).messages.length,2);}finally{IDBObjectStore.prototype.put=original;s.close();}
});

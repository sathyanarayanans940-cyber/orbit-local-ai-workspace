
const out=document.querySelector('#results');
const assert=(x,m)=>{if(!x)throw Error(m)};
const waitReq=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
const factory=OrbitChatStore.create;
const clone=x=>structuredClone(x);
const fixture=()=>({a:{title:'Unicode தமிழ் 👩🏽‍💻',pinned:true,projectId:'p1',updatedAt:1,messages:[{role:'user',text:'Remember zirconium calibration 7.35'}, {role:'assistant',text:'Answer with intentional \\boxed{42}',artifacts:[{id:'x',spec:{kind:'diagram',nodes:[],edges:[]}}]}]},b:{title:'Archived',archived:true,updatedAt:2,messages:[{role:'user',text:'Second chat'}]}});
document.querySelector('#run').onclick=async()=>{
 out.textContent='';document.querySelector('#run').disabled=true;
 const names=[],stores=[];let puts=0,failPut=false;
 const originalPut=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name.startsWith('orbit-test-store-')&&this.name==='chats'){puts++;if(failPut){failPut=false;throw new DOMException('Synthetic quota failure','QuotaExceededError')}}return originalPut.apply(this,args)};
 const open=(suffix,storage)=>{const name='orbit-test-store-'+Date.now()+'-'+suffix;names.push(name);const s=factory({name,legacyKey:'legacy',localStorage:storage});stores.push(s);return {name,s}};
 const storage=initial=>{let data={legacy:initial};return {getItem:k=>data[k]??null,setItem:(k,v)=>data[k]=v,removeItem:k=>delete data[k]}};
 const read=async name=>{const db=await waitReq(indexedDB.open(name));try{const t=db.transaction('chats');const [k,v]=await Promise.all([waitReq(t.objectStore('chats').getAllKeys()),waitReq(t.objectStore('chats').getAll())]);return Object.fromEntries(k.map((key,i)=>[key,v[i]]));}finally{db.close()}};
 const pass=m=>out.textContent+='PASS '+m+'\n';
 try{
  await OrbitChatStore.ready;
  const original=fixture(),ls=storage(JSON.stringify(original)),{name,s}=open('migration',ls);
  const chats=await s.ready;assert(!chats.a.messages&&JSON.stringify((await s.load('a')).messages)===JSON.stringify(original.a.messages),'Migration changed data');assert(ls.getItem('legacy')===null,'Legacy retained after commit');s.adopt(chats);pass('Atomic migration preserves Unicode, archive, pin, project, formulas and artifacts');
  puts=0;await s.save(chats);assert(puts===0,'Unchanged chats were written');
  chats.a={...chats.a,messages:[...(await s.load('a')).messages,{role:'user',text:'Latest text'}]};await s.save(chats);assert(puts===1,'Save rewrote unrelated chats');pass('Unchanged save: 0 records; one updated chat: exactly 1 record');
  chats.b.pinned=true;await s.save(chats);assert((await s.load('b')).pinned,'Metadata lost');pass('In-place metadata change persists');
  const saves=[];for(let i=0;i<40;i++){chats.a={...chats.a,title:'Rapid '+i};saves.push(s.save(chats));}delete chats.b;saves.push(s.save(chats));await Promise.all(saves);const after=await read(name);assert((await s.load('a')).title==='Rapid 39'&&!after.b,'Rapid save/delete race');pass('40 rapid saves plus deletion retain latest state without resurrection');
  failPut=true;chats.a={...await s.load('a'),title:'Retry write'};let rejected=false;try{await s.save(chats)}catch(e){rejected=true}assert(rejected,'Failed save falsely succeeded');await s.save(chats);assert((await read(name)).a.title==='Retry write','Retry lost write');pass('Failed transaction reports error and unchanged next save retries it');
  s.close();const reopened=factory({name,legacyKey:'legacy',localStorage:ls});stores.push(reopened);assert((await reopened.ready).a.title==='Retry write','Reload lost data');pass('Close and reopen recovers complete committed library');
  const bad=storage('{broken'),broken=open('malformed',bad);let badRejected=false;try{await broken.s.ready}catch(e){badRejected=true}assert(badRejected&&bad.getItem('legacy')==='{broken','Malformed legacy was erased');broken.s.close();pass('Malformed legacy library is preserved and startup fails explicitly');
  const quotaLs=storage(JSON.stringify(original));failPut=true;const quota=open('quota',quotaLs);let quotaRejected=false;try{await quota.s.ready}catch(e){quotaRejected=true}assert(quotaRejected&&quotaLs.getItem('legacy')!==null,'Failed migration erased original');quota.s.close();pass('Migration failure preserves original localStorage library');
  const recovered=factory({name:quota.name,legacyKey:'legacy',localStorage:quotaLs});stores.push(recovered);await recovered.ready;assert(JSON.stringify((await recovered.load('a')).messages)===JSON.stringify(original.a.messages),'Retry migration lost records');pass('Retry after failed migration restores every original record');
  const huge=open('scale',storage(null));await huge.s.ready;
  const large=Object.fromEntries(Array.from({length:5000},(_,i)=>['c'+i,{title:'Chat '+i,updatedAt:i,messages:Array.from({length:12},(_,j)=>({role:j%2?'assistant':'user',text:'General study notes and discussion. '+j+' '.repeat(30)}))}]));
  large.c0.messages[3].text='Zirconium calibration 7.35';let t=performance.now();await huge.s.save(large);pass('5000 chats / 60000 messages saved: '+Math.round(performance.now()-t)+' ms');
  puts=0;large.c4999={...large.c4999,title:'Latest renamed'};t=performance.now();await huge.s.save(large);assert(puts===0,'Scale save rewrote history');pass('5000-chat rename writes 0 transcripts: '+Math.round(performance.now()-t)+' ms');
  const entries=OrbitMemories.catalog(large,'new');let paints=0;const timer=setInterval(()=>paints++,0);t=performance.now();const hits=await OrbitMemories.searchAsync(large,entries,'zirconium calibration',[],undefined,()=>true,id=>huge.s.load(id));clearInterval(timer);assert(hits.some(h=>h.excerpt.includes('7.35')),'Old recall lost');assert(paints>0,'Search blocked event loop');pass('Full 60000-message recall finds oldest rare detail and yields '+paints+' times: '+Math.round(performance.now()-t)+' ms');
  large.c0=await huge.s.load('c0');large.c0.messages[3].text='Replacement detail';await huge.s.save(large);assert(!(await OrbitMemories.searchAsync(large,entries,'zirconium',[],undefined,()=>true,id=>huge.s.load(id))).length,'Stale cache evidence');pass('Edited messages invalidate cached search text');
  const deleted=new Set(['c0']);assert(!OrbitMemories.catalog(large,'new',deleted).some(e=>e.id==='c0'),'Deleted chat catalog leak');pass('Deleted chats remain excluded from recall');
  out.textContent+='\nALL PASSED';
 }catch(e){out.textContent+='\nFAIL '+e.stack;}finally{
  IDBObjectStore.prototype.put=originalPut;stores.forEach(s=>s.close());for(const name of names)await waitReq(indexedDB.deleteDatabase(name));document.querySelector('#run').disabled=false;
 }
};

/* Transcript bodies stay on disk; the startup index contains only metadata. */
(function(root){
'use strict';
function create({name='orbit-chat-history',legacyKey='orbit-conversations-v1',indexedDB=root.indexedDB,localStorage=root.localStorage}={}){
 let db,initial={},known=new Map(),pending=new Map(),queue=Promise.resolve();
 const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 const committed=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Chat storage transaction aborted'));tx.onerror=()=>{};});
 const stamp=chat=>[chat?.messages,chat?.title,chat?.titleManuallyEdited,chat?.titleRequestId,chat?.projectId,chat?.archived,chat?.pinned,chat?.updatedAt];
 const same=(a,b)=>a&&a.length===b.length&&a.every((v,i)=>v===b[i]);
 function metadata(chat){
  const {messages,...meta}=chat||{};
  if(!Array.isArray(messages))return meta;
  meta.messageCount=messages.length;
  meta.memorySummary=root.OrbitMemories?.synopsis(chat)||chat.memorySummary||'';
  meta.firstUserText=String(messages.find(m=>m?.role==='user')?.text||'').slice(0,3000);
  meta.files=[];
  for(const [mi,m] of messages.entries()){
   for(const [ai,a] of (Array.isArray(m?.attachments)?m.attachments:[]).entries())if(a?.name)meta.files.push({name:a.name,type:a.type,size:a.size||0,source:a.generated?'orbit':'my',messageIndex:mi,attachmentIndex:ai,key:'attachment:'+mi+'-'+ai});
   const artifacts=Array.isArray(m?.artifacts)&&m.artifacts.length?m.artifacts:root.OrbitWidgets?.extract?.(m?.text||'')?.artifacts||[];
   for(const [ai,a] of artifacts.entries()){const spec=a?.spec||a;if(!spec?.kind)continue;meta.files.push({name:root.OrbitWidgets?.filename(spec)||`${spec.title||'Untitled'}.${spec.kind}`,type:root.OrbitWidgets?.MIME?.[spec.kind]||'',size:a.size||0,source:'orbit',messageIndex:mi,artifactIndex:ai,artifactId:a.id||'',key:'artifact:'+(a.id||mi+'-'+ai)});}
  }
  meta.files=[...new Map(meta.files.map(file=>[file.key,file])).values()];
  return meta;
 }
 const ready=(async()=>{
  if(!indexedDB)throw Error('This browser does not provide chat storage.');
  const opening=indexedDB.open(name,2);
  opening.onupgradeneeded=()=>{const d=opening.result;for(const store of ['chats','meta','index'])if(!d.objectStoreNames.contains(store))d.createObjectStore(store);};
  db=await request(opening);db.onversionchange=()=>db.close();
  let tx=db.transaction(['chats','meta','index'],'readwrite'),done=committed(tx);
  const migrated=await request(tx.objectStore('meta').get('migrated'));let legacyPresent=false;
  try{
   if(!migrated){const raw=localStorage.getItem(legacyKey);legacyPresent=raw!==null;const legacy=raw?JSON.parse(raw):{};
    if(!legacy||typeof legacy!=='object'||Array.isArray(legacy))throw Error('Invalid existing chat library; original data was preserved.');
    for(const [id,chat]of Object.entries(legacy)){tx.objectStore('chats').put(chat,id);tx.objectStore('index').put(metadata(chat),id);}
    tx.objectStore('meta').put(true,'migrated');tx.objectStore('meta').put(true,'indexed');tx.objectStore('meta').put(2,'fileIndexVersion');
   }else if(!await request(tx.objectStore('meta').get('indexed'))||await request(tx.objectStore('meta').get('fileIndexVersion'))!==2){
    // One-time index repair walks records without retaining all transcript bodies.
    await new Promise((resolve,reject)=>{const r=tx.objectStore('chats').openCursor();r.onerror=()=>reject(r.error);r.onsuccess=()=>{try{const c=r.result;if(!c){resolve();return;}tx.objectStore('index').put(metadata(c.value),c.key);c.continue();}catch(e){reject(e);}};});
    tx.objectStore('meta').put(true,'indexed');
    tx.objectStore('meta').put(2,'fileIndexVersion');
   }
  }catch(e){tx.abort();await done.catch(()=>{});throw e;}
  await done;
  tx=db.transaction('index','readonly');done=committed(tx);
  const [keys,values]=await Promise.all([request(tx.objectStore('index').getAllKeys()),request(tx.objectStore('index').getAll())]);await done;
  initial=Object.fromEntries(keys.map((id,i)=>[id,values[i]]));if(legacyPresent)localStorage.removeItem(legacyKey);return initial;
 })();
 function adopt(chats){initial={};known=new Map(Object.entries(chats).map(([id,chat])=>[id,stamp(chat)]));}
 async function load(id){
  await ready;await queue;
  const item=pending.get(id);if(item?.deleted)return null;
  const tx=db.transaction(['chats','index'],'readonly');const done=committed(tx);
  const [body,meta]=await Promise.all([request(tx.objectStore('chats').get(id)),request(tx.objectStore('index').get(id))]);await done;
  if(!body&&!item)return null;
  return {...body,...meta,...item?.chat,messages:item?.chat?.messages||body?.messages||[]};
 }
 function save(chats){
  const next=new Map();
  for(const [id,chat]of Object.entries(chats)){const signature=stamp(chat);next.set(id,signature);if(!same(known.get(id),signature)){
   // A metadata change must retain a transcript already queued by an earlier save.
   const old=pending.get(id);pending.set(id,{chat:structuredClone({...chat,...(!chat.messages&&old?.chat?.messages?{messages:old.chat.messages}:{})}),source:chat});
  }}
  for(const id of known.keys())if(!next.has(id))pending.set(id,{deleted:true});
  known=next;if(!pending.size)return queue;
  const run=async()=>{
   await ready;const batch=new Map(pending);if(!batch.size)return;
   const tx=db.transaction(['chats','index'],'readwrite'),done=committed(tx);
   try{for(const [id,item]of batch){if(item.deleted){tx.objectStore('chats').delete(id);tx.objectStore('index').delete(id);}else{item.meta=metadata(item.chat);tx.objectStore('index').put(item.meta,id);if(Array.isArray(item.chat.messages))tx.objectStore('chats').put(item.chat,id);}}}catch(e){tx.abort();await done.catch(()=>{});throw e;}
   await done;
   for(const [id,item]of batch)if(pending.get(id)===item){pending.delete(id);if(!item.deleted&&chats[id]===item.source){chats[id]=item.meta;known.set(id,stamp(item.meta));}}
  };
  const result=queue.then(run);queue=result.catch(()=>{});return result;
 }
 return {ready,get initial(){return initial;},adopt,save,load,metadata,flush:()=>queue,close:()=>db?.close()};
}
root.OrbitChatStore=create();root.OrbitChatStore.create=create;
})(globalThis);

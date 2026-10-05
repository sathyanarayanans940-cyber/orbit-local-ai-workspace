/* Immutable version snapshots; restoring appends a revision and keeps the current copy. */
const OrbitDocumentHistory=(()=>{
 const LIMIT=20;
 function normalize(items){return (Array.isArray(items)?items:[]).filter(v=>v&&typeof v.previewId==='string'&&typeof v.name==='string').slice(-LIMIT).map(v=>({previewId:v.previewId,name:v.name,type:String(v.type||''),size:Math.max(0,Number(v.size)||0),revision:Math.max(0,Number(v.revision)||0),snapshotId:typeof v.snapshotId==='string'?v.snapshotId:'',createdAt:Number(v.createdAt)||0,summary:String(v.summary||'Saved version').slice(0,500)}));}
 async function capture(target,blob,summary='Before edit'){
  const a=target.artifact||target.attachment;
  const data=target.artifact?{kind:'artifact',spec:a.spec,imageAssets:a.imageAssets||{}}:{kind:'attachment',attachment:{name:a.name,type:a.type,extractedText:a.extractedText||'',visuals:a.visuals,visualSummary:a.visualSummary}};
  const binary=blob||(target.artifact?await OrbitWidgets.generate(a.spec,{images:a.imageAssets||{}}):await OrbitPreview.read(a.previewId));
  if(!binary)throw Error('This version’s file is unavailable. Reattach the original before editing.');
  const previewId=await OrbitPreview.store(binary),snapshotId=await OrbitPreview.store(new Blob([JSON.stringify(data)],{type:'application/json'}));
  if(!previewId||!snapshotId)throw Error('The previous version could not be saved. Free browser storage and retry.');
  return {previewId,snapshotId,name:target.name,type:binary.type,size:binary.size,revision:a.revision||0,createdAt:Date.now(),summary};
 }
 async function read(version){
  if(!version.snapshotId)throw Error('This older backup has no editable snapshot. You can still preview or download it.');
  const blob=await OrbitPreview.read(version.snapshotId);if(!blob||blob.size>25*1024*1024)throw Error('This version’s editable snapshot is unavailable.');
  const data=JSON.parse(await blob.text());if(!data||!['artifact','attachment'].includes(data.kind))throw Error('Invalid version snapshot.');
  if(data.kind==='artifact'){data.spec=OrbitWidgets.normalize(data.spec);data.imageAssets=OrbitDocuments.normalizeAssets(data.imageAssets||{});}
  else if(!data.attachment||typeof data.attachment.name!=='string')throw Error('Invalid file snapshot.');
  return data;
 }
 function text(data){return data.kind==='artifact'?OrbitWorkspaceCore.plainSpec(data.spec):String(data.attachment.extractedText||'');}
 async function restore(target,version){
  if(state.sending)throw Error('Wait for the current response to finish before restoring.');
  const chatId=state.currentChat,originalMessages=state.messages,original=target.artifact||target.attachment;
  const fingerprint=JSON.stringify(original);
  const data=await read(version),binary=await OrbitPreview.read(version.previewId);
  if(!binary)throw Error('The saved version’s file is unavailable.');
  if(target.artifact&&(data.kind!=='artifact'||data.spec.kind!==original.spec.kind))throw Error('This snapshot has a different document format.');
  if(target.attachment&&data.kind!=='attachment')throw Error('This snapshot belongs to a generated document.');
  const previous=await capture(target,null,`Before restoring v${version.revision+1}`);
  if(state.sending||state.currentChat!==chatId||state.messages!==originalMessages||JSON.stringify(original)!==fingerprint||!(target.artifact?state.messages.some(m=>(m.artifacts||[]).includes(original)):state.messages.some(m=>(m.attachments||[]).includes(original))))throw Error('The conversation changed. Reopen version history and try again.');
  const backup=structuredClone(state.messages),savedChat=state.savedChats?.[chatId],revision=(original.revision||0)+1,versions=normalize([...(original.documentVersions||[]),previous]);
  let updated;
  try{
   if(target.artifact){updated={...original,spec:data.spec,imageAssets:data.imageAssets,size:binary.size,revision,documentVersions:versions};delete updated.error;
    for(const m of state.messages)for(let i=0;i<(m.artifacts||[]).length;i++)if(m.artifacts[i].id===original.id)m.artifacts[i]=updated;
    widgetBlobs.set(updated.id,binary);
   }else{
    updated={...data.attachment,previewId:version.previewId,size:binary.size,generated:true,documentId:original.documentId||original.previewId,revision,documentVersions:versions};
    state.messages.push({role:'assistant',text:`Restored ${target.name} from v${version.revision+1} as v${revision+1}. The previous copy is retained in version history.`,attachments:[updated]});
   }
   if(await persistCurrentChat()===false)throw Error('Browser storage could not save the restored revision.');
  }catch(error){if(state.currentChat===chatId&&state.messages===originalMessages)state.messages=backup;if(state.savedChats&&savedChat)state.savedChats[chatId]=savedChat;if(target.artifact)widgetBlobs.delete(original.id);renderMessages(false);throw error;}
  if(target.artifact)await OrbitPreview.refresh(updated,chatId);
  renderMessages(false);showToast(`Restored as v${revision+1}`);return updated;
 }
 async function show(target){
  const source=target.artifact||target.attachment,versions=normalize(source.documentVersions);
  const modal=OrbitWorkspace.dialog('Version history');
  const intro=document.createElement('p');intro.textContent=`${target.name} · Current v${(source.revision||0)+1}. Up to ${LIMIT} previous versions are retained in this browser. Comparison shows text changes; preview each version to inspect formatting and images.`;modal.body.append(intro);
  if(!versions.length){const p=document.createElement('p');p.textContent='No earlier revisions yet. The next edit will preserve the current version here.';modal.body.append(p);return;}
  const list=document.createElement('div');list.className='version-list';modal.body.append(list);
  for(const v of versions.slice().reverse()){
   const row=document.createElement('section');row.className='version-row';const title=document.createElement('strong');title.textContent=`Version ${v.revision+1}`;
   const p=document.createElement('p');p.textContent=[v.createdAt?new Date(v.createdAt).toLocaleString():'Earlier backup',v.summary].filter(Boolean).join(' · ');row.append(title,p);
   const preview=document.createElement('button');preview.textContent='Preview';preview.onclick=async()=>{modal.close();await OrbitPreview.show({attachment:{...v,editBackup:true,name:v.name.replace(/(\.[^.]+)$/,` (v${v.revision+1})$1`)},chatId:state.currentChat});};row.append(preview);
   const compare=document.createElement('button');compare.textContent='Compare with current';compare.disabled=!v.snapshotId;compare.onclick=async()=>{try{const data=await read(v);const current=target.artifact?OrbitWorkspaceCore.plainSpec(source.spec):String(source.extractedText||'');const old=row.querySelector('.workspace-diff');old?.remove();row.append(OrbitWorkspace.diffView(text(data),current));}catch(e){showToast(e.message);}};row.append(compare);
   const recover=document.createElement('button');recover.textContent='Restore this version';recover.disabled=!v.snapshotId;recover.onclick=async()=>{recover.disabled=true;try{await restore(target,v);modal.close();}catch(e){showToast(e.message);recover.disabled=false;}};row.append(recover);list.append(row);
  }
 }
 return {normalize,capture,read,restore,show,text};
})();

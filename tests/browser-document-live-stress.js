document.querySelector('#saved').onclick=async()=>{
 const out=document.querySelector('#saved-result');out.textContent='Loading the synthetic QA chat only…';
 try{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('orbit-chat-history');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const chat=await new Promise((resolve,reject)=>{const r=db.transaction('chats','readonly').objectStore('chats').get('chat-1790593538791-vtbtw');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
  if(!chat)throw Error('Synthetic live test chat not present');
  const artifacts=chat.messages.flatMap(m=>m.artifacts||[]);const source=chat.messages.flatMap(m=>m.attachments||[]).find(a=>a.name==='direct-results.png');
  const checks=[];
  for(const a of artifacts){const spec=OrbitWidgets.normalize(a.spec),assets=OrbitDocuments.normalizeAssets(a.imageAssets);checks.push({name:spec.kind+' saved image equals upload',passed:Object.values(assets).some(v=>v.dataUrl===source.dataUrl)});const encoded=JSON.stringify(spec);checks.push({name:spec.kind+' truthful evidence retained',passed:/DIRECT-6158/.test(encoded)&&/17\s*\/\s*20/.test(encoded)&&/UNKNOWN/i.test(encoded)});
   const blob=await OrbitWidgets.generate(spec,{images:assets});await save('direct-live.'+spec.kind,blob);if(spec.kind==='pdf')await renderPdf(blob,'Actual live PDF');
  }
  if(artifacts.length!==2)throw Error('Expected two generated files');out.textContent=JSON.stringify(checks,null,2)+'\n'+(checks.every(c=>c.passed)?'ALL PASSED':'FAILURES');await save('direct-live-results.json',new Blob([JSON.stringify(checks,null,2)]));
 }catch(e){out.textContent='FAILED: '+e.stack;}
};
document.querySelector('#live-batch').onclick=async()=>{
 const out=document.querySelector('#batch-result');out.textContent='Reading five synthetic screenshots…';
 try{
  const expected=['PANEL-8371','PANEL-2946','PANEL-6159','PANEL-4283','PANEL-9572'];
  const attachments=expected.map((code,i)=>({name:'Screenshot.png',assetId:'img-panel-'+i,dataUrl:screenshot(1000,500,['Synthetic panel '+(i+1),'Verification: '+code,i===4?'Status: UNKNOWN, not executed':'Status: '+(i+1)+' of 5 passed']).toDataURL()}));
  let requests=0;const result=await OrbitDocuments.describe([{role:'user',attachments}],{model:{provider:'Ollama',capabilities:['vision']},onStatus:s=>out.textContent=s,read:async messages=>{
   requests++;const r=await fetch('/api/ollama/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'gemma4:31b-cloud',stream:false,messages:messages.map(m=>({role:m.role,content:m.text,...(m.attachments?{images:m.attachments.map(a=>a.dataUrl.split(',')[1])}:{})})),options:{temperature:0,num_predict:4096}})});const data=await r.json();if(!r.ok)throw Error(data.error||'Model request failed');return data.message.content;
  }});
  const notes=result[0].attachments.map(a=>a.visualSummary).join('\n');const checks=expected.map(code=>({name:code,passed:notes.includes(code)}));checks.push({name:'Two bounded provider requests',passed:requests===2},{name:'Unknown result retained',passed:/UNKNOWN|not executed/i.test(notes)});
  out.textContent=JSON.stringify(checks,null,2)+'\n'+notes+'\n'+(checks.every(c=>c.passed)?'ALL PASSED':'FAILURES');await save('live-batch-results.json',new Blob([JSON.stringify({checks,notes},null,2)]));
 }catch(e){out.textContent='FAILED: '+e.stack;}
};

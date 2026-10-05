const escapeHtml=OrbitWidgets.escape,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={currentChat:'document-edit-audit',messages:[],savedChats:{},models:[{key:'test'}],selectedModel:'test',attachments:[],projects:{},deletedChats:new Set(),filesSource:'orbit',filesQuery:''};
const MAX_EXTRACTED_TEXT=160000,isDocxFile=a=>/\.docx$/i.test(a.name),isSpreadsheetFile=a=>/\.(xlsx|csv)$/i.test(a.name),isPdfFile=a=>/\.pdf$/i.test(a.name),isImageFile=a=>a.type?.startsWith('image/'),isPptxFile=a=>/\.pptx$/i.test(a.name),isTextFile=a=>/\.(txt|cpp|c|py)$/i.test(a.name);
const extractAttachmentText=async file=>isDocxFile(file)||isPptxFile(file)?(await OrbitDocuments.read(file)).text:file.text();
const showToast=message=>$('#qa-status').textContent='ERROR: '+message;
const OrbitWeb={enabled:()=>false,setEnabled:()=>{}};
const showWorkspaceMode=()=>{},closeSidebar=()=>{},renderFilesPage=()=>{};
function persistCurrentChat(){state.savedChats[state.currentChat]={title:'Document edit audit',updatedAt:Date.now(),messages:state.messages};void OrbitChatStore.save(state.savedChats);}
let planCalls=0,badPatch=false;
async function requestLocalReply(prompt,messages,options){
 if(!options.editing)throw Error('Unexpected non-edit request');planCalls++;
 const input=JSON.parse(messages[1].text),doc=input.document;
 if(Array.isArray(doc)){const unit=doc.find(u=>u.text==='The original introduction.');return {text:JSON.stringify({summary:'Updated the introduction.',edits:[{op:'replace',id:unit.id,before:unit.text,after:'This uploaded introduction was edited without changing the document layout.'}]})};}
 const found=doc.blocks.findIndex(b=>b.text==='The original introduction.'),index=found<0?1:found;return {text:JSON.stringify({summary:'Updated only the introduction.',edits:[{op:'replace',path:['blocks',index,'text'],before:badPatch?'Wrong content':doc.blocks[index].text,value:'This introduction was edited in place. Every other section stays intact.'}]})};
}
function renderMessages(){
 $('#messages').innerHTML=state.messages.map((m,i)=>`<article class="message ${m.role}" data-message-index="${i}"><div class="message-content"><p>${escapeHtml(m.text||'')}</p>${messageAttachmentsMarkup(m.attachments)}${widgetMarkup(m,i)}</div></article>`).join('');
}
(async()=>{
 const [shell,app]=await Promise.all(['/index.html','/app.js'].map(url=>fetch(url).then(r=>r.text()))),doc=new DOMParser().parseFromString(shell,'text/html');
 $('#setup').remove();document.body.append(doc.querySelector('.svg-sprite').cloneNode(true),doc.querySelector('.app-shell').cloneNode(true));
 const controls=document.createElement('aside');controls.id='qa-controls';controls.innerHTML='<button id="qa-run">Run document edit checks</button><button id="qa-reload">Check after reload</button><div id="qa-status">Ready · Synthetic plans; real file generation and viewer.</div>';document.body.append(controls);
 const helpers=document.createElement('script');
 const extract=name=>{const start=app.indexOf('function '+name+'('),brace=app.indexOf('\n}',start);return app.slice(start,brace+2);};helpers.textContent=extract('attachmentFileKind')+'\n'+extract('messageAttachmentsMarkup');document.body.append(helpers);
 await OrbitChatStore.ready;OrbitChatStore.adopt(OrbitChatStore.initial);
 for(const url of ['/widgets-ui.js?v=32','/file-preview.js?v=21']){const s=document.createElement('script');s.src=url;await new Promise((r,j)=>{s.onload=r;s.onerror=j;document.body.append(s);});}
 initWidgetUi();$('#files-page').hidden=true;$('#chat-page').hidden=false;$('#conversation-title').textContent='Edit existing documents';$('#conversation-title').parentElement.hidden=false;
 const active=selector=>$('#preview-body>.preview-pane:not([hidden])'+(selector?' '+selector:'')),wait=async predicate=>{const end=Date.now()+15000;while(!predicate()){if(Date.now()>end)throw Error('Preview did not finish');await new Promise(r=>setTimeout(r,25));}};
 const checks=[],check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);},status=()=>$('#qa-status').textContent='PASS: '+checks.length+' checks\n'+checks.map(s=>'✓ '+s).join('\n');
 const spec=kind=>OrbitWidgets.normalize({kind,title:'Engineering Notes',style:{theme:'ocean'},blocks:[{type:'heading',text:'A document you can revise',level:1},{type:'paragraph',text:'The original introduction.'},{type:'heading',text:'Preserved section',level:2},{type:'paragraph',text:'This section, its styling and the original filename survive the edit.'},{type:'table',headers:['Component','Status'],rows:[['Untouched content','Preserved'],['Original source','Retained']]}]});
 $('#qa-run').onclick=async()=>{
  $('#qa-run').disabled=true;checks.length=0;
  try{
   for(const t of $$('#preview-tabs [role="tab"]'))await OrbitPreview.closeTab(t.id);
   const word={id:'edit-word',spec:spec('docx')};state.messages=[{role:'user',text:'Make a Word document.'},{role:'assistant',text:'Here is the original document.',artifacts:[word]}];renderMessages();
   await OrbitPreview.show({artifact:word,chatId:state.currentChat,ref:{chatId:state.currentChat,artifactId:word.id}});await wait(()=>active('iframe[data-word-preview]')?.contentDocument?.body.textContent.includes('original introduction'));
   const oldFrame=active('iframe[data-word-preview]'),original=JSON.stringify(word.spec),user={role:'user',text:'Change the introduction in Engineering Notes.docx'};state.messages.push(user);
   const reply=await requestDocumentEdit(user.text,state.messages,{}),m={role:'assistant',text:reply.text};state.messages.push(m);await completeDocumentEdit(m,reply,new AbortController().signal);
   await wait(()=>active('iframe[data-word-preview]')?.contentDocument?.body.textContent.includes('edited in place'));
   check('existing viewer tab refreshes with the edit',$$('#preview-tabs [role="tab"]').length===1&&active('iframe[data-word-preview]')!==oldFrame);check('stable file ID and filename',m.artifacts[0].id===word.id&&OrbitWidgets.filename(m.artifacts[0].spec)==='Engineering Notes.docx');check('unrelated section retained',m.artifacts[0].spec.blocks[3].text.includes('survive'));check('previous version is stored',!!m.artifacts[0].documentVersions[0].previewId);
   const beforeVersion=await OrbitPreview.read(m.artifacts[0].documentVersions[0].previewId);check('previous version contains original wording',(await OrbitDocuments.read(Object.assign(beforeVersion,{name:'Original.docx'}))).text.includes('original introduction'));
   const calls=planCalls;check('solving a question PDF never edits it',await requestDocumentEdit('Solve this question pdf and add full steps',state.messages,{})===null&&planCalls===calls);
   badPatch=true;const failed=await requestDocumentEdit('Edit Engineering Notes.docx',state.messages,{});badPatch=false;check('stale patches report failure without mutation',failed.documentEdit===undefined&&JSON.stringify(m.artifacts[0].spec)!==original);
   const pdf={id:'edit-pdf',spec:spec('pdf')};state.messages.push({role:'assistant',text:'A PDF to edit too.',artifacts:[pdf]});const pdfReply=await requestDocumentEdit('Edit Engineering Notes.pdf to change the introduction',state.messages,{}),pdfMessage={role:'assistant',text:pdfReply.text};state.messages.push(pdfMessage);await completeDocumentEdit(pdfMessage,pdfReply,new AbortController().signal);check('generated PDF edits produce a real downloadable PDF',(await widgetBlobs.get(pdf.id).text()).startsWith('%PDF-'));
   const sourceBlob=await OrbitWidgets.generate(spec('docx')),source={name:'Uploaded Notes.docx',previewId:await OrbitPreview.store(sourceBlob),type:sourceBlob.type,size:sourceBlob.size};state.messages.push({role:'user',text:'Edit the introduction in Uploaded Notes.docx',attachments:[source]});
   const uploadReply=await requestDocumentEdit(state.messages.at(-1).text,state.messages,{}),uploadMessage={role:'assistant',text:uploadReply.text};state.messages.push(uploadMessage);await completeDocumentEdit(uploadMessage,uploadReply,new AbortController().signal);
   const updated=uploadMessage.attachments?.[0];check('uploaded Word produces a separate edited copy',updated?.editedFrom===source.previewId&&updated.previewId!==source.previewId);check('uploaded original bytes are unchanged',(await OrbitPreview.read(source.previewId)).size===sourceBlob.size);check('edited copy has revised wording',updated.extractedText.includes('without changing the document layout'));
   persistCurrentChat();await OrbitChatStore.flush();await OrbitPreview.show({artifact:m.artifacts[0],chatId:state.currentChat,ref:{chatId:state.currentChat,artifactId:word.id}});await wait(()=>active('iframe[data-word-preview]')?.contentDocument?.body.textContent.includes('edited in place'));status();
  }catch(error){$('#qa-status').textContent='FAIL: '+error.stack;}finally{$('#qa-run').disabled=false;}
 };
 $('#qa-reload').onclick=async()=>{
  checks.length=0;try{check('reload keeps file tabs unloaded',$$('#preview-tabs [role="tab"]').length>0&&!active());const saved=await OrbitChatStore.load(state.currentChat);state.messages=saved.messages;renderMessages();await OrbitPreview.open();await wait(()=>active('iframe[data-word-preview]')?.contentDocument?.body.textContent.includes('edited in place'));check('edited viewer snapshot survives reload',true);check('revision and previous version survive reload',state.messages.flatMap(m=>m.artifacts||[]).find(a=>a.id==='edit-word').documentVersions.length===1);status();}catch(error){$('#qa-status').textContent='FAIL: '+error.stack;}
 };
})().catch(error=>document.body.textContent=error.stack);

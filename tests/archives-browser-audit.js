/* Actual production readers, exporters, message pills, viewer and storage.
   Only synthetic local files. No model requests or actual download writes. */
(async()=>{
 for(let i=0;i<200&&(typeof OrbitPreview==='undefined'||typeof state==='undefined');i++)await new Promise(r=>setTimeout(r,25));
 const controls=document.createElement('section');controls.style.cssText='position:fixed;bottom:80px;left:16px;z-index:10000;max-width:320px;padding:16px;border:1px solid #777;border-radius:12px;background:#202020;color:white;font:12px system-ui';
 const button=document.createElement('button');button.textContent='Run ZIP integration checks';button.style.cssText='padding:10px;background:#ddd;color:#111;border-radius:8px';
 const report=document.createElement('pre');report.id='archive-audit-result';report.style.cssText='max-height:230px;overflow:auto;white-space:pre-wrap';report.textContent='Ready · synthetic files only';
 const hide=document.createElement('button');hide.textContent='Hide ZIP test controls';hide.onclick=()=>controls.hidden=true;controls.append(button,report,hide);document.body.append(controls);
 const checks=[],check=(name,pass)=>{if(!pass)throw Error(name);checks.push(name);};
 const block=spec=>'```orbit-widget\n'+JSON.stringify(spec)+'\n```';
 const specs={pdf:{kind:'pdf',title:'Archive report',blocks:[{type:'heading',text:'ZIP report'},{type:'paragraph',text:'Synthetic document used to verify ZIP reading and exact file packaging.'}]},docx:{kind:'docx',title:'Archive notes',blocks:[{type:'paragraph',text:'Word content inside a ZIP folder.'}]},xlsx:{kind:'xlsx',title:'Values',sheets:[{name:'Data',headers:['Name','Value'],rows:[['A',42],['B',17]]}]},pptx:{kind:'pptx',title:'Slides',slides:[{title:'ZIP support',bullets:['Folder structures are preserved.','Files open in viewer tabs.']}]} };
 button.onclick=async()=>{button.disabled=true;checks.length=0;report.textContent='Running actual ZIP readers and file exporters…';
  try{
   await OrbitDocuments.ensureReaders('zip');
   const originals={};for(const [kind,spec]of Object.entries(specs))originals[kind]=await OrbitWidgets.generate(spec);
   const zip=new JSZip();zip.file('src/main.cpp','int main() { return 42; }\r\n');zip.file('web/index.html','<script>globalThis.ZIP_CODE_RAN=true;</script>');zip.file('data/values.csv','code,value\n001,42\n');zip.folder('empty');zip.file('README.md','# Synthetic project\nNo private data.');zip.file('binary/data.bin',new Uint8Array([0,255,1]));
   for(const kind of ['pdf','docx','xlsx','pptx'])zip.file('docs/sample.'+kind,new Uint8Array(await originals[kind].arrayBuffer()));
   const nested=new JSZip();nested.file('deep/note.txt','Nested file content');zip.file('extras/nested.zip',await nested.generateAsync({type:'uint8array'}));
   const upload=new File([await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})],'sample-project.zip',{type:'application/zip'});
   const attachment=(await materializeAttachments([{file:upload,name:upload.name,size:upload.size,type:upload.type}]))[0];
   check('upload inventories folders',attachment.extractedText.includes('Folder: src/'));
   for(const text of ['return 42','Word content inside','Synthetic document','B2: "42"','Folder structures','Nested file content','unsupported binary'])check('upload reads '+text,attachment.extractedText.includes(text));
   check('archive includes original preview ID',!!attachment.previewId);
   check('ZIP reading leaves code inert',globalThis.ZIP_CODE_RAN===undefined);
   state.currentChat='new';state.messages=[{role:'user',text:'Read and explain this ZIP',attachments:[attachment]}];state.models=[{key:'test',provider:'test',id:'test'}];state.selectedModel='test';state.currentTitle='ZIP integration';showWorkspaceMode('chat');$('#chat-page').classList.add('has-messages');renderMessages();renderConversationTitle();
   const input=modelTextForMessage(state.messages[0]);check('model receives directory and file contents',input.includes('src/main.cpp')&&input.includes('return 42'));
   check('reading an upload does not request ZIP generation',!widgetOptionsForMessage({role:'assistant'},state.messages[0].text).allowZipFiles);
   await OrbitPreview.show({attachment});check('ZIP viewer lists folders',!!document.querySelector('.archive-row span')&&document.querySelector('.archive-list').textContent.includes('src'));
   const folder=[...document.querySelectorAll('.archive-row')].find(b=>b.querySelector('span').textContent==='src');folder.click();check('folder navigation shows main.cpp',document.querySelector('.archive-list').textContent.includes('main.cpp'));
   document.querySelector('.archive-row').click();for(let i=0;i<100&&!document.querySelector('.preview-pane:not([hidden]) .preview-text pre');i++)await new Promise(r=>setTimeout(r,10));
   check('ZIP member opens as code in a viewer tab',document.querySelector('.preview-pane:not([hidden]) .preview-text pre')?.textContent.includes('return 42'));
   check('ZIP file and its child have separate tabs',document.querySelectorAll('[role=tab]').length>=2);
   const tabCount=document.querySelectorAll('[role=tab]').length;await OrbitPreview.show({attachment});
   check('returning to ZIP clears completed opening status',!document.querySelector('.preview-pane:not([hidden]) [role=status]').textContent);
   document.querySelector('.preview-pane:not([hidden]) .archive-row').click();for(let i=0;i<100&&!document.querySelector('.preview-pane:not([hidden]) .preview-text pre');i++)await new Promise(r=>setTimeout(r,10));
   check('reopening a ZIP member reuses its existing tab',document.querySelectorAll('[role=tab]').length===tabCount);
   const originalId=await OrbitPreview.store(new File([originals.pdf],'original.pdf',{type:'application/pdf'}));state.messages[0].attachments.push({name:'original.pdf',type:'application/pdf',size:originals.pdf.size,previewId:originalId});
   const recipe={kind:'zip',filename:'exported-project.zip',title:'Exported project',entries:[{path:'src/main.cpp',content:'int main() { return 42; }\r\n'},{path:'empty/',directory:true},{path:'docs/original.pdf',sourceId:originalId},...Object.entries(specs).map(([kind,file])=>({path:'docs/new.'+kind,file}))]};
   const user={role:'user',text:'Return a ZIP containing the source code, original PDF and new Word, PDF, Excel and PPT files'},reply={role:'assistant',text:block(recipe)};state.messages.push(user,reply);await finalizeMessageWidgets(reply,user.text);renderMessages();
   const artifact=reply.artifacts?.[0];check('finalizer produces a ready ZIP pill',artifact?.size>0&&!artifact.error&&reply.text.includes('file is ready'));
   const generated=widgetBlobs.get(artifact.id),rebuilt=await OrbitWidgets.generate(artifact.spec,{images:artifact.imageAssets,archiveSources:artifact.archiveSources});
   const exported=await JSZip.loadAsync(await generated.arrayBuffer());check('source file bytes preserve CRLF',(await exported.file('src/main.cpp').async('string'))==='int main() { return 42; }\r\n');
   for(const kind of ['pdf','docx','xlsx','pptx'])check('ZIP contains real '+kind,!!exported.file('docs/new.'+kind));
   check('existing PDF bytes are unchanged',JSON.stringify([...await exported.file('docs/original.pdf').async('uint8array')])===JSON.stringify([...new Uint8Array(await originals.pdf.arrayBuffer())]));
   check('saved recipe rebuilds with source references',!!(await JSZip.loadAsync(await rebuilt.arrayBuffer())).file('docs/original.pdf'));
   await OrbitPreview.show({artifact});check('generated ZIP opens folder viewer',document.querySelector('.preview-pane:not([hidden]) .archive-browser h2')?.textContent==='exported-project.zip');
   const nextUser={role:'user',text:'Now show the code with comments'},next={role:'assistant',text:block({kind:'text',filename:'main.cpp',content:'// answer\nint main() { return 42; }'})};state.messages.push(nextUser,next);await finalizeMessageWidgets(next,nextUser.text);renderMessages();check('ordinary next reply remains a code block',!next.artifacts?.length&&next.text.startsWith('```cpp'));
   report.textContent='PASS · '+checks.length+' checks\n'+checks.map(c=>'✓ '+c).join('\n');localStorage.setItem('archive-audit-result',JSON.stringify({checks,errors:qaErrors}));
  }catch(error){report.textContent='FAIL: '+error.message+'\n'+checks.join('\n');console.error(error);}finally{button.disabled=false;}
 };
})();

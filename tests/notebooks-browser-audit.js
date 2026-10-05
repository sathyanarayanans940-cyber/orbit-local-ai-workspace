/* Production UI/readers/exporters; synthetic cells only. No external model calls. */
(async()=>{
 for(let i=0;i<200&&(typeof OrbitPreview==='undefined'||typeof state==='undefined');i++)await new Promise(r=>setTimeout(r,25));
 const panel=document.createElement('section');panel.style.cssText='position:fixed;bottom:70px;left:16px;z-index:10000;max-width:330px;padding:16px;background:#202020;color:white;border:1px solid #777;border-radius:12px;font:12px system-ui';
 const run=document.createElement('button');run.textContent='Run notebook integration checks';run.style.cssText='padding:10px;border-radius:8px';
 const report=document.createElement('pre');report.id='notebook-audit-result';report.style.cssText='max-height:230px;overflow:auto;white-space:pre-wrap';report.textContent='Ready · Synthetic notebooks only';
 const hide=document.createElement('button');hide.textContent='Hide notebook test controls';hide.onclick=()=>panel.hidden=true;panel.append(run,report,hide);document.body.append(panel);
 const checks=[],check=(name,pass)=>{if(!pass)throw Error(name);checks.push(name);};
 const code='values = [10, 20, 30]\r\n\r\ndef mean(values):\r\n    return sum(values) / len(values)\r\n\r\nprint(mean(values))\r\n';
 const spec={kind:'ipynb',filename:'analysis.ipynb',title:'Data analysis',cells:[{cell_type:'markdown',source:'# Data analysis\n\nCalculate the mean step by step.'},{cell_type:'code',source:code},{cell_type:'markdown',source:'<script>globalThis.NOTEBOOK_CODE_RAN = true;</script>\nλ 😀 remain literal source.'}]};
 const block=s=>'```orbit-widget\n'+JSON.stringify(s)+'\n```';
 const nativeClick=HTMLAnchorElement.prototype.click;let downloaded;
 HTMLAnchorElement.prototype.click=function(){if(this.download){downloaded={name:this.download,bytes:fetch(this.href).then(r=>r.arrayBuffer())};return;}return nativeClick.call(this);};
 run.onclick=async()=>{run.disabled=true;checks.length=0;report.textContent='Running actual notebook exporter, downloads and viewer…';
  try{
   setTheme('dark');state.currentChat='new';state.models=[{key:'test',provider:'test',id:'test'}];state.selectedModel='test';state.messages=[];state.currentTitle='Jupyter notebooks';showWorkspaceMode('chat');$('#chat-page').classList.add('has-messages');renderConversationTitle();
   const user={role:'user',text:'Create a Jupyter notebook with explanations and Python code'},reply={role:'assistant',text:block(spec)};state.messages.push(user,reply);await finalizeMessageWidgets(reply,user.text);renderMessages();
   const a=reply.artifacts?.[0];check('explicit request creates a ready notebook pill',a?.spec.kind==='ipynb'&&a.size>0&&!a.error);
   check('notebook has .ipynb filename',OrbitWidgets.filename(a.spec)==='analysis.ipynb');
   const blob=widgetBlobs.get(a.id),book=JSON.parse(await blob.text());check('export uses notebook format 4.5',book.nbformat===4&&book.nbformat_minor===5);
   check('Markdown and code cell order is preserved',book.cells.map(c=>c.cell_type).join(',')==='markdown,code,markdown');check('code preserves CRLF and indentation',book.cells[1].source===code);
   check('code is unexecuted with no invented results',book.cells[1].execution_count===null&&book.cells[1].outputs.length===0);check('every cell has a unique ID',new Set(book.cells.map(c=>c.id)).size===3);check('Python kernel metadata is present',book.metadata.kernelspec.name==='python3');
   document.querySelector('[data-widget-download]').click();for(let i=0;i<100&&!downloaded;i++)await new Promise(r=>setTimeout(r,10));
   check('download handler uses analysis.ipynb',downloaded?.name==='analysis.ipynb');check('download bytes are complete notebook JSON',JSON.parse(new TextDecoder().decode(await downloaded.bytes)).cells[1].source===code);
   document.querySelector('[data-preview-widget]').click();for(let i=0;i<100&&!document.querySelector('.preview-pane:not([hidden]) pre');i++)await new Promise(r=>setTimeout(r,10));
   const pre=document.querySelector('.preview-pane:not([hidden]) pre');check('viewer displays notebook cells',pre?.textContent.includes('Cell 2 · code')&&pre.textContent.includes('Calculate the mean'));check('viewer displays script-looking Markdown as literal text',pre.textContent.includes('<script>'));check('notebook cells never execute',globalThis.NOTEBOOK_CODE_RAN===undefined);
   await OrbitPreview.show({artifact:{id:'other-test-file',spec:{kind:'text',filename:'other.py',content:'print(1)'}}});await OrbitPreview.show({artifact:a});check('tab switching reuses notebook preview',document.querySelector('.preview-pane:not([hidden]) pre')===pre);
   const upload=(await materializeAttachments([{file:new File([blob],'analysis.ipynb',{type:blob.type}),name:'analysis.ipynb',size:blob.size,type:blob.type}]))[0];check('generated notebook can be uploaded and read',upload.extractedText.includes('def mean')&&upload.extractedText.includes('Calculate the mean'));
   check('saved notebook recipe restores without losing source',normalizedWidgetArtifacts(JSON.parse(JSON.stringify(reply.artifacts)))[0].spec.notebook.cells[1].source===code);
   const nextUser={role:'user',text:'Now show the Python code'},next={role:'assistant',text:block(spec)};state.messages.push(nextUser,next);await finalizeMessageWidgets(next,nextUser.text);renderMessages();check('ordinary next reply has no notebook download',!next.artifacts?.length);check('ordinary next reply uses code blocks',next.text.includes('```python'));
   const zipUser={role:'user',text:'Make a ZIP with the original notebook and a new notebook in a notebooks folder'},zipReply={role:'assistant',text:block({kind:'zip',filename:'notebooks.zip',entries:[{path:'notebooks/original.ipynb',sourceId:a.id},{path:'notebooks/new.ipynb',file:spec}]})};state.messages.push(zipUser,zipReply);await finalizeMessageWidgets(zipReply,zipUser.text);renderMessages();
   const zipArtifact=zipReply.artifacts?.[0];check('ZIP finalizer packages notebooks',zipArtifact?.spec.kind==='zip'&&zipArtifact.size>0&&!zipArtifact.error);
   await OrbitDocuments.ensureReaders('zip');const zip=await JSZip.loadAsync(await widgetBlobs.get(zipArtifact.id).arrayBuffer());check('new notebook inside ZIP has proper cells',JSON.parse(await zip.file('notebooks/new.ipynb').async('string')).cells[1].source===code);check('original notebook ZIP bytes are unchanged',JSON.stringify([...await zip.file('notebooks/original.ipynb').async('uint8array')])===JSON.stringify([...new Uint8Array(await blob.arrayBuffer())]));
   await OrbitPreview.show({artifact:zipArtifact});document.querySelector('.preview-pane:not([hidden]) .archive-row').click();check('ZIP viewer lists notebook folder members',document.querySelector('.preview-pane:not([hidden]) .archive-list').textContent.includes('new.ipynb'));
   document.querySelector('.preview-pane:not([hidden]) .archive-row').click();for(let i=0;i<100&&!document.querySelector('.preview-pane:not([hidden]) pre');i++)await new Promise(r=>setTimeout(r,10));check('ZIP member notebook opens in its own viewer tab',document.querySelector('.preview-pane:not([hidden]) pre')?.textContent.includes('def mean'));
   await OrbitPreview.show({artifact:a});check('returning to generated notebook keeps it mounted',document.querySelector('.preview-pane:not([hidden]) pre')===pre);
   report.textContent='PASS · '+checks.length+' checks\n'+checks.map(c=>'✓ '+c).join('\n');
  }catch(error){report.textContent='FAIL: '+error.message+'\n'+checks.join('\n');console.error(error);}finally{run.disabled=false;}
 };
})();

const state={currentChat:'word-format-audit',messages:[],models:[{key:'test'}],selectedModel:'test'};
const renderMessages=()=>{},persistCurrentChat=()=>{},checks=[];
const check=(name,ok)=>{checks.push({name,ok:!!ok});document.querySelector('#result').textContent=JSON.stringify(checks,null,2);if(!ok)throw Error(name);};
const recipe=spec=>'```orbit-widget\n'+JSON.stringify(spec)+'\n```';
async function content(blob){const z=await JSZip.loadAsync(await blob.arrayBuffer());return z.file('word/document.xml').async('string');}
document.querySelector('#run').onclick=async()=>{
 try{
  checks.length=0;
  const word={body:{font:'Times New Roman',size:12,color:'000000',lineSpacing:1.5,alignment:'justify'},title:{font:'Arial',size:22,color:'234567',alignment:'center'},heading1:{font:'Georgia',size:16,color:'234567',alignment:'left'},code:{font:'Consolas',size:10,lineSpacing:1,alignment:'left',color:'000000'},page:{width:8.5,height:11,margins:{top:.75,right:.8,bottom:.75,left:.8},borders:Object.fromEntries(['top','right','bottom','left'].map(k=>[k,{style:'double',width:1.5,color:'345678',space:20}]))},pageNumbers:false};
  const source=await OrbitWidgets.generate({kind:'docx',title:'Reference lab format',style:{word},blocks:[{type:'heading',text:'Aim'},{type:'paragraph',text:'This sample supplies a format for a future lab report.'},{type:'code',text:'int sample = 1;'}]});
  const file=new File([source],'Sample.docx',{type:source.type}),read=await OrbitDocuments.read(file);
  check('real upload reader extracts body, title and code fonts',read.formatProfile.word.body.font==='Times New Roman'&&read.formatProfile.word.title.font==='Arial'&&read.formatProfile.word.code.font==='Consolas');
  check('real upload reader extracts page border color',read.formatProfile.word.page.borders.left.color==='345678');
  const attachment={name:file.name,formatId:'fmt-sample',formatProfile:read.formatProfile,extractedText:read.text};
  const request='Create a Word lab report following Sample.docx, but use a dark red title and Courier New for code.';
  const spec={kind:'docx',title:'Binary Search Lab',style:{templateId:'fmt-sample',word:{title:{color:'8B1D2C'},code:{font:'Courier New'}}},blocks:[{type:'heading',text:'Aim'},{type:'paragraph',text:'Find a target in a sorted array using binary search. Each comparison halves the remaining search interval.'},{type:'heading',text:'Implementation'},{type:'code',language:'cpp',text:'int find(const vector<int>& a, int target) {\n    int lo = 0, hi = (int)a.size() - 1;\n    while (lo <= hi) {\n        int mid = lo + (hi - lo) / 2;\n        if (a[mid] == target) return mid;\n        if (a[mid] < target) lo = mid + 1;\n        else hi = mid - 1;\n    }\n    return -1;\n}'},{type:'heading',text:'Complexity'},{type:'paragraph',text:'The algorithm uses logarithmic time and constant additional space.'},{type:'table',headers:['Input','Expected result'],rows:[['Empty array','Not found'],['Target at first index','Index 0']]}]};
  state.messages=[{role:'user',text:request,attachments:[attachment]},{role:'assistant',text:recipe(spec)}];
  await finalizeMessageWidgets(state.messages[1],request,new AbortController().signal);
  const artifact=state.messages[1].artifacts?.[0];
  check('chat finalizer resolves sample before real DOCX generation',artifact?.size>0&&!artifact.error&&!artifact.spec.style.templateId);
  const blob=widgetBlobs.get(artifact.id),out=await content(blob);
  check('explicit font and color override the sample in downloaded DOCX',out.includes('8B1D2C')&&out.includes('Courier New'));
  check('body and page borders come from the selected sample',out.includes('Times New Roman')&&out.includes('345678')&&out.includes('w:val="double"'));
  await OrbitChatStore.ready;
  const chats={'word-format-audit':{title:'Format test',updatedAt:Date.now(),messages:state.messages}};
  await OrbitChatStore.save(chats);await OrbitChatStore.flush();
  const saved=await OrbitChatStore.load('word-format-audit');
  check('sample formatting metadata persists in the real chat store',saved.messages[0].attachments[0].formatProfile.word.body.font==='Times New Roman');
  const restored=saved.messages[1].artifacts[0];
  check('saved artifact rebuild works without the original upload', (await content(await OrbitWidgets.generate(restored.spec))).includes('Courier New'));
  const ordinary={role:'assistant',text:recipe({kind:'docx',title:'Unrelated report',blocks:[{type:'paragraph',text:'Normal output.'}]})};state.messages.push(ordinary);
  await finalizeMessageWidgets(ordinary,'Create a Word report.',new AbortController().signal);
  check('ordinary question or sample upload does not silently restyle output',!ordinary.artifacts[0].spec.style.word);
  const missing={role:'assistant',text:recipe({...spec,style:{templateId:'fmt-missing'}})};state.messages.push(missing);
  await finalizeMessageWidgets(missing,request,new AbortController().signal);
  check('missing sample reports failure without announcing success',/unavailable/.test(missing.artifacts[0].error)&&!missing.text.includes('your file is ready'));
  const edited=OrbitDocumentEdits.apply(restored.spec,[{op:'format',before:restored.spec.style.word,value:{title:{bold:false},page:{borders:Object.fromEntries(['top','right','bottom','left'].map(k=>[k,{style:'none'}]))}}}]);
  const editedXml=await content(await OrbitWidgets.generate(edited));
  check('format-only edit can remove borders and title bold',!editedXml.includes('w:val="double"')&&editedXml.includes('w:val="false"'));
  const iframe=document.createElement('iframe');iframe.srcdoc=await OrbitWidgetEngine.wordPreview(blob);document.querySelector('#preview').replaceChildren(iframe);
  await fetch('/audit-save/word-format-sample.docx',{method:'POST',body:source});await fetch('/audit-save/word-format-output.docx',{method:'POST',body:blob});
  await fetch('/audit-save/word-format-checks.json',{method:'POST',body:JSON.stringify(checks,null,2)});
  document.querySelector('#result').textContent+='\nPASS: '+checks.length+' integration checks';
 }catch(error){document.querySelector('#result').textContent+='\nFAIL: '+error.stack;}
};

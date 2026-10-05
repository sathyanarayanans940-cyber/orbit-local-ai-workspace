const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8'),functions=app.slice(app.indexOf('let visibleLibraryFiles ='),app.indexOf('function showWorkspaceMode('));
function setup(){
 const calls=[],errors=[],handlers={},nodes={};const node=id=>nodes[id]||=( {hidden:false,dataset:{},querySelector:()=>({}),addEventListener:(name,fn)=>handlers[id]=fn} );
 const state={savedChats:{},messages:[],attachments:[],deletedChats:new Set(),projects:{},filesSource:'my',filesQuery:'',currentChat:'current'};
 const ctx=vm.createContext({state,$:node,$$:()=>[],recoverMessageWidgets:()=>{},normalizedWidgetArtifacts:v=>v||[],OrbitWidgets:{filename:s=>s.filename,MIME:{text:'text/plain'}},
  attachmentFileKind:()=>({label:'Text',icon:'file',className:'text'}),isImageFile:()=>false,escapeHtml:v=>String(v).replaceAll('<','&lt;').replaceAll('"','&quot;'),formatFileSize:()=>'',formatFileActivity:()=>'',
  OrbitChatStore:{load:async id=>{calls.push(['disk',id]);return ctx.disk; }},OrbitPreview:{show:async source=>calls.push(['viewer',source])},showToast:value=>errors.push(value),loadChat:id=>calls.push(['chat',id]),titleForChatId:id=>id});
 vm.runInContext(functions+'\n'+app.slice(app.indexOf("$('#files-grid').addEventListener"),app.indexOf("$('#files-search-input').addEventListener")),ctx);return {ctx,state,calls,errors,nodes,handlers};
}
test('file name and chat column have independent keyboard-accessible buttons and click routes',async()=>{
 const h=setup();h.state.savedChats.a={title:'Chat A',messages:[{attachments:[{name:'name.cpp'}]}]};h.ctx.renderFilesPage();const markup=h.nodes['#files-grid'].innerHTML;
 assert.match(markup,/<article[^>]+role="listitem"/);assert.match(markup,/<button[^>]+data-open-library-file="0"/);assert.match(markup,/<button[^>]+class="file-library-chat" data-chat="a"/);assert.doesNotMatch(markup,/<button[^>]+file-library-card/);
 h.handlers['#files-grid']({target:{closest:s=>s==='[data-open-library-file]'?{dataset:{openLibraryFile:'0'}}:null}});await new Promise(r=>setImmediate(r));
 assert.equal(h.calls[0][0],'viewer');assert.equal(h.calls[0][1].chatId,'a');assert.equal(h.state.currentChat,'current');
 h.handlers['#files-grid']({target:{closest:s=>s==='[data-chat]'?{dataset:{chat:'a'}}:null}});assert.deepEqual(h.calls.at(-1),['chat','a']);
});
test('old metadata indexes load the exact attachment lazily without changing the current chat',async()=>{
 const h=setup();h.state.savedChats.a={title:'A',files:[{key:'2-1',name:'same.c',source:'my'}]};h.ctx.disk={messages:[{attachments:[{name:'same.c',extractedText:'WRONG'}]}, {},{attachments:[{name:'same.c',extractedText:'WRONG TOO'},{name:'same.c',extractedText:'RIGHT'}]}]};
 const file=h.ctx.collectUploadedFiles()[0];assert.equal(file.messageIndex,2);assert.equal(file.attachmentIndex,1);assert.equal(h.calls.length,0);await h.ctx.previewLibraryFile(file);
 assert.equal(h.calls[0][0],'disk');assert.equal(h.calls[1][1].attachment.extractedText,'RIGHT');assert.equal(h.state.currentChat,'current');assert.equal(h.state.messages.length,0);
});
test('generated IDs and exact positions resolve same-name artifacts, while ambiguous legacy names fail safely',async()=>{
 const h=setup();h.state.savedChats.a={title:'A'};h.ctx.disk={messages:[{artifacts:[{id:'one',spec:{kind:'text',filename:'same.c',content:'ONE'}}]},{artifacts:[{id:'two',spec:{kind:'text',filename:'same.c',content:'TWO'}}]}]};
 await h.ctx.previewLibraryFile({source:'orbit',name:'same.c',chatId:'a',artifactId:'two'});assert.equal(h.calls.at(-1)[1].artifact.spec.content,'TWO');
 await h.ctx.previewLibraryFile({source:'orbit',name:'same.c',chatId:'a',messageIndex:0,artifactIndex:0});assert.equal(h.calls.at(-1)[1].artifact.spec.content,'ONE');
 await h.ctx.previewLibraryFile({source:'orbit',name:'same.c',chatId:'a'});assert.match(h.errors.at(-1),/could not be found/);
});
test('draft files preview without a chat link; search indices route only the displayed file',async()=>{
 const h=setup();h.state.savedChats.a={title:'A',messages:[{attachments:[{name:'hidden.c'},{name:'visible.c'}]}]};h.state.filesQuery='visible';h.ctx.renderFilesPage();h.handlers['#files-grid']({target:{closest:s=>s==='[data-open-library-file]'?{dataset:{openLibraryFile:'0'}}:null}});await new Promise(r=>setImmediate(r));assert.equal(h.calls[0][1].attachment.name,'visible.c');
 h.state.attachments=[{name:'draft.c'}];h.state.savedChats={};h.state.filesQuery='';h.ctx.renderFilesPage();assert.doesNotMatch(h.nodes['#files-grid'].innerHTML,/data-chat=/);await h.ctx.previewLibraryFile(h.ctx.collectUploadedFiles()[0]);assert.equal(h.calls.at(-1)[1].chatId,null);
});
test('a deleted or missing conversation cannot accidentally open another file or chat',async()=>{
 const h=setup();h.state.deletedChats.add('gone');await h.ctx.previewLibraryFile({chatId:'gone',source:'my',messageIndex:0,attachmentIndex:0});assert.equal(h.calls.length,0);assert.match(h.errors[0],/no longer available/);
});
test('an edited uploaded file in the Orbit files index opens its binary attachment',async()=>{
 const h=setup();h.state.savedChats.a={title:'A'};h.ctx.disk={messages:[{role:'assistant',attachments:[{name:'Edited.docx',previewId:'updated',generated:true}]}]};
 await h.ctx.previewLibraryFile({source:'orbit',name:'Edited.docx',chatId:'a',messageIndex:0,attachmentIndex:0});assert.equal(h.calls.at(-1)[1].attachment.previewId,'updated');assert.equal(h.errors.length,0);
});
test('multiple chat cards for one revised generated file produce one Files row',()=>{
 const h=setup(),a={id:'same-document',spec:{kind:'text',filename:'Notes.txt',content:'Updated'}};h.state.savedChats.a={title:'A',messages:[{artifacts:[a]},{artifacts:[a]}]};assert.equal(h.ctx.collectUploadedFiles().length,1);assert.equal(h.ctx.collectUploadedFiles()[0].messageIndex,1);
});

// Synthetic UI fixture: actual exporter, file pills, download handler and viewer.
// No model/API calls, private chats or actual Downloads-folder writes.
const state={currentChat:'text-audit',models:[{key:'test'}],selectedModel:'test',messages:[],attachments:[]};
const escapeHtml=OrbitWidgets.escape;
const isDocxFile=a=>/\.docx$/i.test(a.name),isSpreadsheetFile=a=>/\.(xlsx|xls|csv)$/i.test(a.name),isPdfFile=a=>/\.pdf$/i.test(a.name),isImageFile=a=>a.type?.startsWith('image/'),isPptxFile=a=>/\.pptx$/i.test(a.name),isTextFile=a=>a.type?.startsWith('text/');
const attachmentFileKind=()=>({className:'text',icon:'icon-file-text'});
function persistCurrentChat(){}
function showToast(value){document.querySelector('#qa-status').textContent=value;}
function requestLocalReply(){throw Error('This fixture must not call a model');}
function renderMessages(){
 const transcript=document.querySelector('#qa-transcript');if(!transcript)return;
 transcript.replaceChildren();state.messages.forEach((m,i)=>{
  const section=document.createElement('section');section.className='qa-message';
  const content=m.role==='assistant'?OrbitWidgets.streamingText(m.text,widgetOptionsForMessage(m)):m.text;
  const para=document.createElement('p');para.className=m.role==='user'?'qa-user':'';para.textContent=(m.role==='user'?'Prompt: ':'')+content.replace(/```[\s\S]*?```/g,'').trim();section.append(para);
  const code=content.match(/```[^\n]*\n([\s\S]*?)\n```/);if(code){const pre=document.createElement('pre');pre.textContent=code[1];section.append(pre);}
  if(m.artifacts?.length){const pills=document.createElement('div');pills.innerHTML=widgetMarkup(m,i);section.append(pills);}transcript.append(section);
 });
}
(async()=>{
 const doc=new DOMParser().parseFromString(await (await fetch('/index.html')).text(),'text/html');
 document.querySelector('#setup').remove();document.body.append(doc.querySelector('.svg-sprite').cloneNode(true),doc.querySelector('.app-shell').cloneNode(true));
 document.querySelector('#conversation-title').textContent='Text & source files';
 document.querySelector('#messages').innerHTML='<h1 id="qa-title">Files when requested. Code in chat.</h1><button id="qa-run">Run exporter and follow-up checks</button><p id="qa-status">Ready · No external model calls.</p><div id="qa-transcript"></div>';
 for(const src of ['/widgets-ui.js?v=31','/file-preview.js?v=19'])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.body.append(s);});
 initWidgetUi();
 const checks=[],status=document.querySelector('#qa-status');
 const check=(name,pass)=>{if(!pass)throw Error(name);checks.push(name);};
 const cpp='#include <iostream>\n\nint main() {\n    std::cout << "literal \\n, λ 😀";\n    return 0;\n}\n';
 const html='<script>globalThis.UNSAFE_SOURCE_RAN = true;</script>\n<div>Literal HTML source · λ 😀</div>\n';
 const widget=spec=>'```orbit-widget\n'+JSON.stringify(spec)+'\n```';
 const nativeClick=HTMLAnchorElement.prototype.click;let lastDownload=null;
 HTMLAnchorElement.prototype.click=function(){if(this.download){lastDownload={name:this.download,data:fetch(this.href).then(r=>r.arrayBuffer())};return;}return nativeClick.call(this);};
 const add=async(prompt,text)=>{const user={role:'user',text:prompt},reply={role:'assistant',text};state.messages.push(user,reply);await finalizeMessageWidgets(reply,prompt);renderMessages();return reply;};
 document.querySelector('#qa-run').onclick=async()=>{
  const button=document.querySelector('#qa-run');button.disabled=true;checks.length=0;state.messages=[];
  try{
   const first=await add('Give me a downloadable main.cpp file',widget({kind:'text',filename:'main.cpp',language:'cpp',content:cpp}));
   check('explicit request creates source file pill',first.artifacts?.length===1);
   check('filename retains .cpp extension',document.querySelector('[data-widget-download]').getAttribute('aria-label')==='Download main.cpp');
   document.querySelector('[data-widget-download]').click();await new Promise(resolve=>setTimeout(resolve,0));
   check('download handler selects main.cpp',lastDownload?.name==='main.cpp');
   check('download bytes preserve source exactly',new TextDecoder().decode(await lastDownload.data)===cpp);
   document.querySelector('[data-preview-widget]').click();await new Promise(resolve=>setTimeout(resolve,0));
   let pre=document.querySelector('#preview-body>.preview-pane:not([hidden]) pre');check('generated source opens in viewer',pre?.textContent===cpp);
   const next=await add('Fix the bug and show the code',widget({kind:'text',filename:'main.cpp',language:'cpp',content:'int main() {\n    return 1;\n}\n'}));
   check('next request creates no source artifact',!next.artifacts?.length);
   check('model file recipe becomes fenced code',next.text.startsWith('```cpp'));
   check('only one download pill remains',document.querySelectorAll('[data-widget-download]').length===1);
   const third=await add('Create an index.html source file',widget({kind:'text',filename:'index.html',content:html}));
   check('new explicit request permits another source file',third.artifacts?.length===1);
   await OrbitPreview.show({artifact:third.artifacts[0]});
   check('HTML source displays literally',document.querySelector('#preview-body>.preview-pane:not([hidden]) pre')?.textContent===html);
   check('HTML source never runs',globalThis.UNSAFE_SOURCE_RAN===undefined);
   await OrbitPreview.show({artifact:first.artifacts[0]});
   check('switching source tabs reuses preview',document.querySelector('#preview-body>.preview-pane:not([hidden]) pre')===pre);
   await OrbitPreview.show({artifact:third.artifacts[0]});
   status.textContent='PASS · '+checks.length+' browser checks\n'+checks.map(name=>'✓ '+name).join('\n');
  }catch(error){status.textContent='FAIL: '+error.message+'\n'+checks.join('\n');}finally{button.disabled=false;}
 };
})();

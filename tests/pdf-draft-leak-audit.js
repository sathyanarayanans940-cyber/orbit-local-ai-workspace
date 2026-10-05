(async()=>{
 while(typeof messageMarkup!=='function')await new Promise(r=>setTimeout(r,50));
 persistCurrentChat=()=>{};
 state.currentChat='pdf-draft-leak-audit';state.currentTitle='PDF draft recovery';
 const saved=await(await fetch('/tests/fixtures/pdf-draft-leak.json')).json();
 state.messages=[{role:'user',text:'a pdf too bro'},saved];renderMessages(false);
 const savedVisible=document.querySelector('#messages').textContent;
 const savedClean=!savedVisible.includes('"kind"')&&!savedVisible.includes('"blocks"');
 const originalRequest=requestLocalReply;
 requestLocalReply=async()=>({text:JSON.stringify({repairs:[{index:0,widget:saved.artifacts[0].spec}]})});
 const message={role:'assistant',text:saved.text.slice(0,saved.text.indexOf('\n\nDone —'))};
 state.messages=[{role:'user',text:'a pdf too bro'},message];
 try{await finalizeMessageWidgets(message,'a pdf too bro',new AbortController().signal);}finally{requestLocalReply=originalRequest;}
 renderMessages(false);renderConversationTitle();
 const artifact=message.artifacts[0],blob=widgetBlobs.get(artifact.id);
 await fetch('/audit-save/pdf-draft-recovered.pdf',{method:'POST',body:blob});
 const result={savedClean,newClean:!message.text.includes('"kind"'),blocks:artifact.spec.blocks.length,visuals:artifact.spec.blocks.filter(b=>b.type==='visual').length,size:blob.size,header:await blob.slice(0,5).text(),cards:document.querySelectorAll('[data-widget-download]').length,error:message.widgetError||''};
 const output=document.createElement('pre');output.id='draft-audit-result';output.textContent=JSON.stringify(result);document.body.append(output);
})();

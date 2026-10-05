(async()=>{
 while(typeof messageMarkup!=='function')await new Promise(r=>setTimeout(r,50));
 persistCurrentChat=()=>{};
 state.currentChat='file-followup-audit';state.currentTitle='PDF follow-up recovery';
 const audit=await(await fetch('/tests/output/live-file-followup.json')).json();
 const spec=audit.message.artifacts[0].spec;
 const broken={role:'assistant',text:'Done — your file is ready.\n\nGenerated file: SoftwareEngineeringStudyGuide.pdf'};
 state.messages=[{role:'user',text:'a pdf too bro'},broken];renderMessages(false);
 const warning=document.querySelector('.widget-error')?.textContent||'';
 const message={role:'assistant',text:'I’ll prepare the PDF.\n\n```orbit-widget\n'+JSON.stringify(spec)+'\n```'};
 state.messages=[{role:'user',text:'a pdf too bro'},message];
 await finalizeMessageWidgets(message,'a pdf too bro',new AbortController().signal);
 renderMessages(false);renderConversationTitle();
 const blob=widgetBlobs.get(message.artifacts[0].id);
 await fetch('/audit-save/file-followup.pdf',{method:'POST',body:blob});
 const result={warning,size:blob.size,header:await blob.slice(0,5).text(),cards:document.querySelectorAll('[data-widget-download]').length,error:message.widgetError||'',text:message.text};
 const output=document.createElement('pre');output.id='file-audit-result';output.textContent=JSON.stringify(result);document.body.append(output);
})();

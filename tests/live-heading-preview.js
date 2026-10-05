(async()=>{
 while(typeof messageMarkup!=='function')await new Promise(r=>setTimeout(r,50));
 const audit=await(await fetch('/tests/output/live-heading-audit.json')).json();
 persistCurrentChat=()=>{};
 state.currentChat='synthetic-heading-audit';state.currentTitle='Fresh Gemma replies — heading verification';
 state.messages=audit.results.filter(r=>r.text).flatMap(r=>[{role:'user',text:r.prompt},{role:'assistant',text:r.text}]);
 renderMessages(false);renderConversationTitle();$('#messages-wrap').scrollTop=0;
 const checks=[...document.querySelectorAll('.message.assistant')].map((el,i)=>({id:audit.results[i].id,headings:[...el.querySelectorAll('.message-text h1,.message-text h2,.message-text h3')].map(h=>({tag:h.tagName,text:h.textContent,size:getComputedStyle(h).fontSize}))}));
 const result=document.createElement('script');result.type='application/json';result.id='heading-verification';result.textContent=JSON.stringify(checks);document.body.append(result);
})();

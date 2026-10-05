(async()=>{
 while(typeof messageMarkup!=='function')await new Promise(r=>setTimeout(r,50));
 persistCurrentChat=()=>{};state.currentChat='activity-audit';state.currentTitle='Dynamic activity shimmer';
 state.messages=[{role:'user',text:'Make a software engineering study guide with an architecture diagram.'}];
 renderMessages(false);renderConversationTitle();
 const typing=addTypingIndicator(),checks=[];
 const check=(ok,name)=>{checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
 for(const label of ['Thinking','Searching the web','Writing software process models','Rendering the study guide']){
   setReplyStatus(typing,label);check(!typing.querySelector('[data-status-start]'),label+' has no timer');
 }
 setReplyStatus(typing,'Analyzing');await new Promise(r=>setTimeout(r,1250));
 check(/Analyzing\s+1 sec/.test(typing.textContent),'Analyze timer advances');
 const timer=typing.querySelector('.status-elapsed'),label=typing.querySelector('.thinking-label');
 check(getComputedStyle(timer).fontSize===getComputedStyle(label).fontSize,'Analyze timer uses shimmer size');
 setReplyStatus(typing,'Writing software process models');check(!typing.querySelector('[data-status-start]'),'Timer disappears when writing starts');typing.remove();
 const draft='```orbit-widget\n{"kind":"pdf","blocks":[{"type":"heading","text":"Software process models"},{"type":"paragraph","text":"';
 const reply={role:'assistant',generating:true,text:'I’ll prepare your study guide.\n\n'+draft};
 state.messages.push(reply);renderMessages(false);
 check(document.querySelector('.widget-status').textContent==='Writing Software process models','Streamed heading supplies real topic');
 check(!document.querySelector('#messages').textContent.includes('"kind"'),'Raw draft stays hidden');
 const result=document.createElement('pre');result.id='activity-result';result.textContent=JSON.stringify(checks);result.hidden=true;document.body.append(result);
})();

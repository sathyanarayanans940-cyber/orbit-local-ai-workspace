(async()=>{
 while(typeof beginAssistantReply!=='function') await new Promise(r=>setTimeout(r,50));
 const button=document.createElement('button');button.textContent='Run chat interaction checks';button.style.cssText='position:fixed;right:20px;top:16px;z-index:9999;padding:12px';document.body.append(button);
 const result=document.createElement('pre');result.id='audit-result';result.style.cssText='position:fixed;right:16px;top:65px;z-index:9999;background:#fff;color:#111;padding:12px;max-width:460px;max-height:45vh;overflow:auto;font:12px monospace;white-space:pre-wrap';document.body.append(result);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 button.onclick=async()=>{const checks=[];const check=(condition,name)=>{checks.push({name,passed:!!condition});result.textContent=JSON.stringify(checks,null,2);if(!condition)throw Error(name);};try{
 // Synthetic state only, on a dedicated origin. Never call a model or save transcripts.
 persistCurrentChat=()=>{};state.currentChat='interaction-audit';state.currentTitle='Chat interaction checks';state.sending=true;
 state.messages=[{role:'user',text:'Compare the two AWS Shield options'},{role:'assistant',text:'Here is the breakdown of the two options.\n\n### 1. AWS Shield Standard\n\n- First option in the comparison.\n- These sections have equal visual rank.\n\n### 2. AWS Shield Advanced\n\n- Second option in the comparison.\n- Its heading uses exactly the same size.\n\n### Summary\n\nThe first option is a section, not the overall title.'},...Array.from({length:18},(_,i)=>({role:'assistant',text:`## Earlier explanation ${i+1}\n\n`+'Detailed explanation with stable readable content. '.repeat(25)}))];
 renderMessages(true);await wait(100);
 const wrap=$('#messages-wrap');const reply=beginAssistantReply();appendAssistantReply(reply,'## New explanation\n\n'+'Streaming content. '.repeat(70));await wait(100);
 check(wrap.scrollHeight-wrap.scrollTop-wrap.clientHeight<5,'Follows output at bottom');
 wrap.dispatchEvent(new WheelEvent('wheel',{deltaY:-150}));wrap.scrollTop-=500;await wait(60);const top=wrap.scrollTop;
 for(let i=0;i<30;i++)appendAssistantReply(reply,' More text.');await wait(80);
 check(Math.abs(wrap.scrollTop-top)<2,'30 chunks do not pull reader downward');
 completeAssistantReply(reply);await wait(50);check(Math.abs(wrap.scrollTop-top)<2,'Completion preserves reading position');
 renderMessages(false);await wait(100);check(Math.abs(wrap.scrollTop-top)<2,'Source/full rerender preserves position');
 const delayed=beginAssistantReply();appendAssistantReply(delayed,'Delayed response');check(Math.abs(wrap.scrollTop-top)<2,'Delayed first token preserves position');
 $('#jump-to-latest').click();await wait(800);appendAssistantReply(delayed,'\n\n'+'Continued text. '.repeat(100));await wait(100);check(wrap.scrollHeight-wrap.scrollTop-wrap.clientHeight<5,'Jump to latest resumes following');
 completeAssistantReply(delayed);
 wrap.scrollTop-=400;await wait(60);const fallbackTop=wrap.scrollTop;await revealAssistantReply('Fallback reply. '.repeat(120));check(Math.abs(wrap.scrollTop-fallbackTop)<2,'Fallback animation preserves reading position');
 const queued=chatScrollSnapshot();wrap.dispatchEvent(new WheelEvent('wheel',{deltaY:-1}));wrap.scrollTop-=100;const interruptedTop=wrap.scrollTop;restoreChatScroll(queued);check(wrap.scrollTop===interruptedTop,'User input cancels queued scroll restoration');
 followLatest=true;wrap.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp'}));check(!followLatest,'PageUp cancels following');
 followLatest=true;const touchStart=new Event('touchstart');Object.defineProperty(touchStart,'touches',{value:[{clientY:100}]});wrap.dispatchEvent(touchStart);const touchMove=new Event('touchmove');Object.defineProperty(touchMove,'touches',{value:[{clientY:150}]});wrap.dispatchEvent(touchMove);check(!followLatest,'Touch swipe toward older messages cancels following');

 for(const theme of ['light','dark']){document.documentElement.dataset.theme=theme;for(const border of [false,true]){applyChatComposerAppearance({border,aura:false});const color=getComputedStyle($('.message.user .message-bubble')).borderTopColor;check(border?color!=='rgba(0, 0, 0, 0)':color==='rgba(0, 0, 0, 0)',`${theme}: sent outline ${border?'on':'off'}`);}}
 applyChatComposerAppearance({border:false,aura:false});
 const sample=$$('.message.assistant')[0].querySelector('.message-text');const actualReply=sample.innerHTML;sample.innerHTML='<h1>Title</h1><h2>Section</h2><h3>Subsection</h3><h4>Detail</h4>';
 for(const size of [14,18,24]){sample.style.fontSize=size+'px';const sizes=['h1','h2','h3','h4'].map(h=>parseFloat(getComputedStyle(sample.querySelector(h)).fontSize));check(sizes[0]>sizes[1]&&sizes[1]>sizes[2]&&sizes[2]>sizes[3]&&Math.abs(sizes[0]-size*1.65)<.1,`Four heading sizes render at ${size}px body`);}
 sample.style.fontSize='';sample.innerHTML=actualReply;
 const titlePatterns=[
 'Sure bro.\n\n## A lesson after a greeting\n\nBody.\n\n### Example\n\nDetails.',
 'Sure bro.\n## A lesson with no blank line\nBody.\n### Example\nDetails.',
 'Sure bro.\n\n**Topic: A lesson title**\n\nBody.\n\n## Example\n\nDetails.'
 ];
 for(const [i,text] of titlePatterns.entries()){sample.innerHTML=messageContentMarkup({role:'assistant',text},0);const title=sample.querySelector('.response-title');check(!!title&&Math.abs(parseFloat(getComputedStyle(title).fontSize)/parseFloat(getComputedStyle(sample).fontSize)-1.65)<.01,`Realistic title pattern ${i+1} uses largest scale`);}
 const peers=[['1. First option','2. Second option','3. Third option'],['Step 1: Start','Step 2: Continue'],['Advantages','Disadvantages']];
 for(const labels of peers){for(const generating of [true,false]){sample.innerHTML=messageContentMarkup({role:'assistant',generating,text:labels.map(t=>'### '+t+'\n\nBody.').join('\n\n')},0);const headings=[...sample.querySelectorAll('h3')];check(!sample.querySelector('.response-title')&&new Set(headings.map(h=>getComputedStyle(h).fontSize)).size===1,`Peer sizes match: ${labels[0]} (${generating?'streaming':'saved'})`);}}
 sample.innerHTML=actualReply;
 const original=sample.innerHTML;sample.innerHTML=messageContentMarkup({role:'assistant',text:'## Model-written lesson title 😭\n\nBody text.\n\n### Example section\n\nDetails.'},0);
 check(parseFloat(getComputedStyle(sample.querySelector('.response-title')).fontSize)>parseFloat(getComputedStyle(sample.querySelector('h3:not(.response-title)')).fontSize),'Structurally distinct title renders at largest size');sample.innerHTML=original;
 const typing=addTypingIndicator();setReplyStatus(typing,'Analyzing…');const label=typing.querySelector('.thinking-label'),elapsed=typing.querySelector('.status-elapsed');
 check(label.contains(elapsed)&&getComputedStyle(label).fontSize===getComputedStyle(elapsed).fontSize,'Timer shares shimmer parent and exact font size');
 check(getComputedStyle(elapsed).webkitTextFillColor===getComputedStyle(label).webkitTextFillColor,'Timer inherits shimmer text fill');
 const start=Number(typing.querySelector('[data-status-start]').dataset.statusStart);await wait(2600);check(/Analyzing\s+[1-9]\d* sec/.test(typing.textContent),'Elapsed timer advances while no tokens arrive');setReplyStatus(typing,'Analyzing…');check(Number(typing.querySelector('[data-status-start]').dataset.statusStart)===start,'Repeated status preserves elapsed time');setReplyStatus(typing,'Making Word…');check(typing.textContent.includes('Making Word')&&!typing.querySelector('[data-status-start]'),'Only Analyze has a clock');
 check(elapsedStatusTime(121000)==='2m 1s','Minute/second format');typing.remove();await wait(1100);check(replyStatusTimer===null,'Clock stops after status removed');
 state.sending=false;followLatest=false;wrap.scrollTop=0;await wait(100);result.textContent=`PASS: ${checks.length} browser checks\n`+JSON.stringify(checks,null,2);const preview=addTypingIndicator();setReplyStatus(preview,'Preparing Word document');$('#messages').prepend(preview);wrap.scrollTop=0;button.textContent='Hide test results';button.onclick=()=>{result.hidden=!result.hidden;button.textContent=result.hidden?'Show passed checks':'Hide test results';};
 }catch(e){result.textContent+='\nFAIL: '+e.stack;}};
})();

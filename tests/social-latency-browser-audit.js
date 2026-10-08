/* Full composer + real preparation + real streaming renderer; synthetic API. */
(async()=>{
 while(typeof sendPrompt!=='function'||typeof OrbitWorkspace==='undefined')await new Promise(r=>setTimeout(r,50));
 if(discoveryPromise)await discoveryPromise;
 const panel=document.createElement('aside');panel.style.cssText='position:fixed;top:70px;right:20px;z-index:9000;padding:16px;background:#292929;color:white;max-width:500px';
 panel.innerHTML='<button id="social-audit-run">Run greeting checks</button><pre id="social-audit-result">Ready — synthetic API</pre>';document.body.append(panel);
 panel.querySelector('button').onclick=async()=>{
  const result={checks:[],requests:[],statuses:[]},check=(name,ok)=>{result.checks.push({name,ok});if(!ok)throw Error(name);};
  const nativeFetch=window.fetch,originalStatus=setReplyStatus,originalAppend=appendAssistantReply;
  const model={key:'OpenAI:gpt-6-luna',id:'gpt-6-luna',name:'GPT-6 Luna',provider:'OpenAI',capabilities:['thinking','vision']};
  const started=performance.now();
  try{
   state.models=[model];state.selectedModel=model.key;state.currentChat='new';state.messages=[];state.attachments=[];state.activeMode='chat';
   OrbitThinking.set(model,'off');OrbitMemories.save({mode:'on',about:'Prefer plain English'});OrbitWeb.setEnabled(true);
   window.fetch=async(url,options)=>{
    if(String(url)==='/api/openai/chat'){
     const payload=JSON.parse(options.body);
     result.requests.push({timeMs:performance.now()-started,effort:payload.reasoning_effort,structured:!!payload.response_format,title:payload.max_tokens===256,profile:JSON.stringify(payload.messages).includes('Prefer plain English')});
    }
    return nativeFetch(url,options);
   };
   setReplyStatus=(typing,label,...rest)=>{result.statuses.push(label);return originalStatus(typing,label,...rest);};
   appendAssistantReply=(reply,text)=>{
    const value=originalAppend(reply,text);
    if(result.firstVisibleMs===undefined&&reply.article.innerText.trim()){
     result.firstVisibleMs=performance.now()-started;
     result.visibleWhileStreaming=reply.message.generating===true;
    }
    return value;
   };
   document.querySelector('#prompt-input').value='hi';
   await sendPrompt();
   result.finishedMs=performance.now()-started;
   const titleDeadline=performance.now()+2000;
   while(!result.requests.some(r=>r.title)&&performance.now()<titleDeadline)await new Promise(r=>setTimeout(r,20));
   check('One answer request, no preparation calls',result.requests.filter(r=>!r.title).length===1&&!result.requests.some(r=>r.structured));
   check('Think Off survives the full send path',result.requests.every(r=>r.effort==='none'));
   check('Saved profile reaches the answer',result.requests[0].profile);
   check('No misleading planning statuses',!result.statuses.some(s=>/planning|checking memories|searching/i.test(s)));
   check('Text is visible before stream completion',result.visibleWhileStreaming&&result.finishedMs-result.firstVisibleMs>250);
   check('Title starts after the first displayed text',result.requests.some(r=>r.title)&&result.requests.filter(r=>r.title).every(r=>r.timeMs>result.firstVisibleMs));
   check('Full answer rendered',state.messages.at(-1).text==='Hello! How can I help?');
   check('No browser errors',qaErrors.length===0);
  }catch(error){result.error=error.stack;}
  finally{window.fetch=nativeFetch;setReplyStatus=originalStatus;appendAssistantReply=originalAppend;}
  panel.querySelector('pre').textContent=(result.error?'FAIL':'PASS')+'\n'+JSON.stringify(result,null,2);
  await nativeFetch('/api/social-audit/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
 };
})();

/* Synthetic model decisions, real send/stream/tool/UI integration. */
(async()=>{
 while(typeof sendPrompt!=='function'||typeof OrbitWorkspace==='undefined')await new Promise(r=>setTimeout(r,50));
 if(discoveryPromise)await discoveryPromise;
 const panel=document.createElement('aside');panel.style.cssText='position:fixed;top:70px;right:20px;z-index:9000;padding:16px;background:#292929;color:white;max-width:550px;max-height:80vh;overflow:auto';
 panel.innerHTML='<button id="routing-audit-run">Run routing checks</button><pre id="routing-audit-result">Ready — synthetic model, real tools</pre>';document.body.append(panel);
 panel.querySelector('button').onclick=async()=>{
  const result={checks:[],cases:[]},check=(name,ok)=>{result.checks.push({name,ok});if(!ok)throw Error(name);};
  const nativeFetch=window.fetch,originalStatus=setReplyStatus,originalAppend=appendAssistantReply;
  const model={key:'OpenAI:gpt-6-luna',id:'gpt-6-luna',name:'GPT-6 Luna',provider:'OpenAI',capabilities:['thinking','vision']};
  try{
   state.models=[model];state.selectedModel=model.key;OrbitThinking.set(model,'off');OrbitMemories.save({mode:'on',about:'Prefer plain English'});OrbitWeb.setEnabled(true);
   for(const [name,prompt] of [['direct','Explain what a stack is.'],['analysis','Check 17 times 2 with Python.'],['web-file','Search Python documentation and make a Word document.']]){
    const item={name,requests:[],webRequests:[],statuses:[],emitted:[]},start=performance.now();result.cases.push(item);
    state.currentChat='new';state.messages=[];state.attachments=[];state.activeMode='chat';
    window.fetch=async(url,options)=>{
     if(String(url).startsWith('/api/web/'))item.webRequests.push({url,body:JSON.parse(options.body)});
     if(String(url)==='/api/openai/chat'){
      const p=JSON.parse(options.body),system=p.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
      item.requests.push({timeMs:performance.now()-start,effort:p.reasoning_effort,title:p.max_tokens===256,stage:system.includes('computational verification stage')?'analysis':system.includes('Decide which tools, if any')?'route-or-answer':'answer',profile:system.includes('Prefer plain English')});
     }
     return nativeFetch(url,options);
    };
    setReplyStatus=(typing,label,...rest)=>{item.statuses.push(label);return originalStatus(typing,label,...rest);};
    appendAssistantReply=(reply,text)=>{
     item.emitted.push(text);const value=originalAppend(reply,text);
     if(item.firstVisibleMs===undefined&&reply.article.innerText.trim()){
      item.firstVisibleMs=performance.now()-start;item.visibleWhileStreaming=reply.message.generating===true;
     }
     return value;
    };
    document.querySelector('#prompt-input').value=prompt;await sendPrompt();item.finishedMs=performance.now()-start;
    const deadline=performance.now()+2000;while(!item.requests.some(r=>r.title)&&performance.now()<deadline)await new Promise(r=>setTimeout(r,20));
    // Let this synthetic title complete before moving to the next chat.
    await new Promise(r=>setTimeout(r,800));
    check(name+': Think Off preserved',item.requests.every(r=>r.effort==='none'));
    check(name+': saved profile supplied',item.requests[0].profile);
    check(name+': no control syntax or JSON leaked',!item.emitted.join('').includes('<orbit-tools>')&&!item.emitted.join('').includes('"action"'));
    check(name+': text displays before completion',item.visibleWhileStreaming&&item.finishedMs-item.firstVisibleMs>250);
    check(name+': title occurs after visible answer',item.requests.some(r=>r.title)&&item.requests.filter(r=>r.title).every(r=>r.timeMs>item.firstVisibleMs));
    if(name==='direct'){
     check('Direct: exactly one answer request',item.requests.filter(r=>!r.title).length===1);
     check('Direct: no preparation statuses',!item.statuses.some(s=>/planning|checking memories|searching|analyzing/i.test(s)));
     check('Direct: full answer displayed',state.messages.at(-1).text==='A stack stores items in last-in, first-out order.');
    }else if(name==='analysis'){
     check('Analyze: only requested worker called',item.requests.filter(r=>!r.title).map(r=>r.stage).join(',')==='route-or-answer,answer');
     const message=state.messages.at(-1);check('Analyze: successful real execution evidence',message.analysisChecks?.some(c=>c.ok&&c.output.includes('Verified: 17 * 2 = 34')));
     check('Analyze: completed answer displayed',message.text==='17 × 2 = 34. Verified with Python.');
    }else{
     check('Web + file: route and final generator only',item.requests.filter(r=>!r.title).length===2);
     check('Web + file: actual search and read requests',item.webRequests.length===2&&item.webRequests[0].body.query==='Python documentation');
     const message=state.messages.at(-1),artifact=message.artifacts?.find(a=>a.spec?.kind==='docx');
     check('Web + file: Word artifact rendered',!!artifact&&!!document.querySelector('.generated-file-pill'));
     const blob=await OrbitWidgets.generate(artifact.spec),bytes=new Uint8Array(await blob.arrayBuffer());
     check('Web + file: real downloadable Office ZIP',bytes.length>1000&&bytes[0]===80&&bytes[1]===75);
    }
   }
   check('No browser errors',qaErrors.length===0);
  }catch(error){result.error=error.stack;}
  finally{window.fetch=nativeFetch;setReplyStatus=originalStatus;appendAssistantReply=originalAppend;}
  panel.querySelector('pre').textContent=(result.error?'FAIL':'PASS')+'\n'+JSON.stringify(result,null,2);
  await nativeFetch('/api/tool-routing-audit/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
 };
})();

(async()=>{
 while(typeof sendPrompt!=='function')await new Promise(r=>setTimeout(r,30));
 // Separate-origin synthetic UI test. All provider I/O and Python execution are fake.
 persistCurrentChat=()=>{};persistChats=()=>{};
 OrbitMemories.recall=async()=>'';OrbitWeb.setEnabled(false);
 const originalAnalyze=OrbitAnalyze.analyze;
 OrbitAnalyze.analyze=(conversation,options)=>originalAnalyze(conversation,{...options,run:async()=>({ok:true,output:'TEST FIXTURE: result=6; no real Python was executed.',error:''})});
 const requests=[];let analysisCalls=0,finishFile;
 requestRuntime=async(url,options,provider)=>{
  const body=JSON.parse(options.body);requests.push(body);
  const naming=body.max_tokens===256;
  let text;
  if(naming)text='Conversation Naming Request'; // Must be rejected, retaining subject evidence.
  else if(body.response_format){analysisCalls++;text=analysisCalls===1?JSON.stringify({action:'run',purpose:'Fixture execution only',code:'print(2 * 3)',language:'python'}):'{"action":"done"}';}
  else text=String.raw`# Statistics & Probability

## A complete worked explanation

Given: two independent factors, 2 and 3. Multiply the factors and retain the intermediate working.

\[
\begin{gathered}
R = 2 \times 3\\
= 6
\end{gathered}
\]

The result follows from multiplying the supplied values. This is a simulated UI response, not a live DeepSeek answer.`;
  const chunks=[{choices:[{delta:{content:text},finish_reason:'stop'}]}];
  return {body:new ReadableStream({start(controller){for(const value of chunks)controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(value)+'\n\n'));controller.close();}})};
 };
 const result=document.createElement('pre');result.id='provider-contract-results';result.style.cssText='white-space:pre-wrap;font-size:12px;line-height:1.4;margin:10px 0';
 finalizeMessageWidgets=async()=>{
  const checks={namedBeforeRendering:state.currentTitle==='Statistics & Probability',analyzeEffort:requests.find(r=>r.response_format)?.reasoning_effort,answerEffort:requests.find(r=>!r.response_format&&r.max_tokens!==256)?.reasoning_effort,title:state.currentTitle,stillSending:state.sending,formulaErrors:document.querySelectorAll('.katex-error').length};
  result.textContent=JSON.stringify(checks,null,2);await new Promise(resolve=>finishFile=resolve);
 };
 const controls=document.createElement('section');controls.style.cssText='position:fixed;left:15px;bottom:20px;z-index:1000;width:230px;padding:14px;background:var(--bg);border:1px solid var(--border);border-radius:12px';
 const label=document.createElement('p');label.textContent='Isolated test: simulated provider';label.style.fontSize='12px';controls.append(label);
 const run=document.createElement('button');run.className='preferences-button';run.textContent='Run first-reply check';run.onclick=()=>{
  if(state.sending)return;requests.length=0;analysisCalls=0;
  state.currentChat='provider-contract';state.currentTitle='Orbit Chat';state.messages=[];state.attachments=[];state.savedChats={'provider-contract':{title:state.currentTitle,messages:state.messages}};
  const model={key:'DeepSeek:deepseek-flash',id:'deepseek-flash',name:'DeepSeek Flash · simulated',provider:'DeepSeek',capabilities:['thinking','vision']};
  state.models=[model];state.selectedModel=model.key;state.connectedProviders.add('DeepSeek');OrbitThinking.set(model,'high');
  renderMessages(false);renderConversationTitle();renderSavedHistory();
  $('#prompt-input').value='Solve this with full working';void sendPrompt();
 };
 const done=document.createElement('button');done.className='preferences-button';done.style.marginTop='8px';done.textContent='Finish rendering check';done.onclick=()=>{finishFile?.();};
 controls.append(run,done,result);document.body.append(controls);setTheme('dark');
})();

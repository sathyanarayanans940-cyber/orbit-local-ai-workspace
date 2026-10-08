// Synthetic provider packets; real stream parser and continuation coordinator.
(async()=>{
 const source=await (await fetch('/app.js')).text(),script=document.createElement('script');
 script.textContent=source.slice(source.indexOf('function runtimeTextChunk('),source.indexOf('function modelTextForMessage('));document.body.append(script);
 const packet=(text,reason)=>new Response(new ReadableStream({start(c){for(const data of [{choices:[{delta:{content:text},finish_reason:reason}]},{choices:[],usage:{total_tokens:20}}])c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(data)+'\n\n'));c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));c.close();}}));
 document.querySelector('#run').onclick=async()=>{
  const answer=document.querySelector('#answer'),status=document.querySelector('#status'),output=document.querySelector('#checks'),checks=[];
  const check=(name,ok)=>{checks.push({name,ok});output.textContent=JSON.stringify(checks,null,2);if(!ok)throw Error(name);};
  try{
   answer.textContent='';
   const source='A complete answer with code:\n\n```cpp\nint result = 42;\n```\n\nThe response continued automatically.',parts=[source.slice(0,41),source.slice(41,58),source.slice(58)];let calls=0;
   const result=await readRuntimeReply(packet(parts[0],'length'),'DeepSeek',{onToken:t=>answer.textContent+=t,onStatus:t=>status.textContent=t},async accumulated=>{check('Continuation '+(calls+1)+' sees all prior text',accumulated===parts.slice(0,calls+1).join(''));calls++;return packet(parts[calls],calls===2?'stop':'length');});
   check('Answer continues in one message',result.text===source&&answer.textContent===source);check('Exactly two automatic continuations',calls===2);
   const recipe='```orbit-widget\n{"kind":"docx","title":"Report","blocks":[{"type":"paragraph","text":"Complete content"}]}\n```',cut=recipe.indexOf('Complete')+3;
   const joined=await readRuntimeReply(packet(recipe.slice(0,cut),'length'),'DeepSeek',{},async()=>packet(recipe.slice(cut),'stop'));
   check('Interrupted file recipe retains exact syntax',joined.text===recipe&&JSON.parse(joined.text.split('\n')[1]).blocks[0].text==='Complete content');
   const control=new AbortController();let unwanted=0,stopped=false;
   try{await readRuntimeReply(packet('Partial answer','length'),'DeepSeek',{signal:control.signal,onStatus:()=>control.abort()},async()=>{unwanted++;return packet('bad','stop');});}catch(e){stopped=e.name==='AbortError';}
   check('Stop prevents another request',stopped&&unwanted===0);status.textContent='PASS — '+checks.length+' browser checks';
  }catch(e){status.textContent='FAIL: '+e.stack;}
 };
})();

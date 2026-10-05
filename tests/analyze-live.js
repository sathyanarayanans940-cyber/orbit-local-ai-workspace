document.querySelector('#live').onclick=async()=>{
 const out=document.querySelector('#result'),prompt=document.querySelector('#prompt').value;
 out.textContent='Planning…';
 try{
 const models=await (await fetch('/api/ollama/tags')).json();const model=models.models.find(m=>m.name==='gemma4:31b-cloud')?.name||models.models.find(m=>m.remote_model)?.name;
 if(!model)throw Error('Configured cloud model unavailable');
 const plan=async history=>{const r=await fetch('/api/ollama/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:history.map(m=>({role:m.role,content:m.text})),format:'json',stream:false,options:{temperature:0,num_predict:8192}})});const d=await r.json();if(!r.ok)throw Error(d.error||'Model request failed');if(!d.message?.content)throw Error("Empty model content: "+JSON.stringify(d).slice(-1200));return d.message.content};
 const result=await OrbitAnalyze.analyze([{role:'user',text:prompt}],{plan,onStatus:s=>out.textContent=s});
 out.textContent=JSON.stringify(result,null,2);
 const evidence=document.querySelector('#evidence');evidence.innerHTML=OrbitAnalyze.markup(result.checks);
 }catch(e){out.textContent=e.stack;}
};

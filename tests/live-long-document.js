document.querySelector('#live-long').onclick=async()=>{
 const out=document.querySelector('#live-result');out.textContent='Starting…';
 try{
 let callNumber=0;
 const plan=async messages=>{
  const r=await fetch('/api/ollama/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'gemma4:31b-cloud',messages:messages.map(m=>({role:m.role,content:m.text})),format:'json',stream:false,options:{temperature:.3,num_predict:8192}})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Model failed');await save('live-draft-'+(++callNumber)+'.json',new Blob([JSON.stringify(data.message,null,2)]));return data.message.content;
 };
 const request='Create a 19-page Word study guide about binary search and lower-bound search. Cover invariants, termination, complexity, duplicates, boundary cases, reference testing, practical applications and language differences. Use distinct substantive sections, no invented execution results, no web research needed.';
 const result=await OrbitLongDocuments.build(request,{model:{id:'gemma4:31b-cloud'},context:[],instruction:OrbitWidgets.instruction().split('\n').filter(s=>/^(PDF\/Word:|Programming content:)/.test(s)).join('\n'),plan,normalize:OrbitWidgets.normalize,onStatus:s=>out.textContent=s});
 const spec=OrbitWidgets.extract(result.text).artifacts[0];if(!spec)throw Error('Missing assembled file');
 const blob=await OrbitWidgets.generate(spec);await save('live-nineteen-pages.docx',blob);await save('live-long-recipe.json',new Blob([JSON.stringify(spec,null,2)]));
 out.textContent='COMPLETE: '+spec.blocks.length+' blocks; '+spec.blocks.filter(b=>b.type==='pageBreak').length+' explicit page breaks; '+blob.size+' bytes. Saved live-nineteen-pages.docx';
 }catch(e){out.textContent='FAILED: '+e.stack;}
};

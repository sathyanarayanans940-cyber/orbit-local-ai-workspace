const themes=Object.keys(OrbitWidgets.presentationThemes).slice(4);
const save=async(name,data)=>{const r=await fetch('/audit-save/'+name,{method:'POST',body:data instanceof Blob?data:new Blob([JSON.stringify(data,null,2)])});if(!r.ok)throw Error('Could not save '+name);};
document.querySelector('#fixtures').onclick=async()=>{
 const out=document.querySelector('#status'),results=[];
 try{for(const theme of themes){out.textContent='Exporting '+theme;const spec=OrbitWidgets.normalize({...modernDeck,theme,slides:modernDeck.slides.map((s,i)=>({...s,...(i===2?{tone:'accent'}:i===6?{tone:'dark'}:{})}))});
 const blob=await OrbitWidgets.generate(spec),zip=await JSZip.loadAsync(await blob.arrayBuffer());await save('theme-'+theme+'.pptx',blob);
 results.push({theme,slides:Object.keys(zip.files).filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x)).length,images:Object.keys(zip.files).filter(x=>/^ppt\/media\//.test(x)&&!zip.files[x].dir).length});}
 await save('theme-fixture-results.json',results);out.textContent=JSON.stringify(results,null,2)+'\n'+(results.every(r=>r.slides===10&&r.images===2)?'ALL PASSED':'FAIL');}catch(e){out.textContent=e.stack;}
};
document.querySelector('#live').onclick=async()=>{
 const out=document.querySelector('#live-status'),results=[];
 const instruction=OrbitWidgets.instruction().split('\n').filter(l=>/^(PowerPoint:|Presentation design:|Embedded visuals:|Diagram schema:|Categorical example:)/.test(l)).join('\n')+'\nReturn one complete JSON object only.';
 for(const [i,theme] of themes.entries()){
  const visual=i%2?'a diagram with three nodes Input, Validate, Save, connected left to right':'a bar chart of supplied SYNTHETIC values Baseline 180, Indexed 95, Cached 42, unit ms';
  const request=`Create a 3-slide PowerPoint proposal for an assignment portal using exactly the ${theme} theme. Slide 1: cover. Slide 2: ${visual} embedded INSIDE the slide. Slide 3: a delivery timeline with 3 steps. Use concise text and speaker notes. No invented results. No web research needed.`;
  const history=[{role:'system',content:instruction},{role:'user',content:request}];let spec,attempts=0,error;
  try{for(;attempts<3;attempts++){
   out.textContent=`${i+1}/10: ${theme}, attempt ${attempts+1}`;
   const r=await fetch('/api/ollama/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'gemma4:31b-cloud',stream:false,format:'json',messages:history,options:{temperature:.2,num_predict:6500}})}),data=await r.json();if(!r.ok)throw Error(data.error||'Model request failed');const raw=data.message.content;
   await save('theme-live-'+theme+'-draft-'+(attempts+1)+'.json',{content:raw});
   try{let parsed;try{parsed=JSON.parse(raw);}catch{parsed=OrbitWidgets.extract(raw).artifacts[0];}spec=OrbitWidgets.normalize(parsed);
    if(spec.kind!=='pptx'||spec.theme!==theme||spec.slides.length!==3)throw Error('Keep exact theme '+theme+' and exactly 3 slides.');
    if(spec.slides[0].layout!=='cover'||!spec.slides[1].visual||!spec.slides[2].steps)throw Error('Use cover, embedded visual, then timeline steps.');
    if(spec.slides.some(s=>!s.notes))throw Error('Every slide needs speaker notes.');
    if(i%2===0 && !/synthetic|sample|illustrative|hypothetical/i.test([spec.slides[1].title,spec.slides[1].subtitle,spec.slides[1].caption,spec.slides[1].visual.title].join(' ')))throw Error('Visibly label the chart title as Synthetic response times; supplied values are illustrative, not measured performance.');
    if(i%2===0 && JSON.stringify(spec.slides[1].visual.series?.[0]?.values)!=='[180,95,42]')throw Error('Keep supplied chart values exactly 180,95,42.');
    break;
   }catch(e){error=e;spec=null;history.push({role:'assistant',content:raw},{role:'user',content:'Repair this draft: '+e.message+' Return complete corrected JSON only.'});}
  }
  if(!spec)throw error;
  const blob=await OrbitWidgets.generate(spec);await save('theme-live-'+theme+'.pptx',blob);await save('theme-live-'+theme+'-recipe.json',spec);
  results.push({theme,passed:true,calls:attempts+1,slides:spec.slides.length,visual:spec.slides[1].visual.kind});
  }catch(e){results.push({theme,passed:false,error:e.message});}
  await save('theme-live-results.json',results);
 }
 out.textContent=JSON.stringify(results,null,2)+'\n'+(results.every(r=>r.passed)?'ALL TEN LIVE THEMES PASSED':'FAILURES');
};

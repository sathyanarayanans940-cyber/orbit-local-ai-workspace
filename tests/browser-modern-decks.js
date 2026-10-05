document.querySelector('#result').textContent='Harness started';
const save=async(name,blob)=>{const r=await fetch('/audit-save/'+name,{method:'POST',body:blob});if(!r.ok)throw Error('Saving failed');};
document.querySelector('#run').onclick=async()=>{
 const out=document.querySelector('#result');out.textContent='Building…';const checks=[];
 try{
  document.querySelector('#visuals').innerHTML=OrbitWidgets.visualSvg(architecture)+OrbitWidgets.visualSvg(trend);
  for(const theme of ['midnight','paper','ocean','coral']){
   const spec=OrbitWidgets.normalize({...modernDeck,theme,slides:['midnight','ocean'].includes(theme)?modernDeck.slides:modernDeck.slides.slice(0,3)}),blob=await OrbitWidgets.generate(spec);await save('modern-'+theme+'.pptx',blob);
   const zip=await JSZip.loadAsync(await blob.arrayBuffer()),slides=Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p));checks.push({name:theme+' exact slide count',passed:slides.length===spec.slides.length});
   if(theme==='midnight')checks.push({name:'Diagram and chart embedded in PPTX',passed:Object.keys(zip.files).filter(p=>p.startsWith('ppt/media/')&&!zip.files[p].dir).length>=2});
  }
  for(const kind of ['pdf','docx']){
   const input={kind,title:'Project report with embedded visuals',blocks:[{type:'heading',text:'Architecture'},{type:'paragraph',text:'The web interface sends requests to the application API, which accesses project records and document storage.'},{type:'visual',visual:{artifactId:'existing-architecture'},caption:'Figure 1. The same architecture shown in chat.'},{type:'pageBreak'},{type:'heading',text:'Illustrative performance comparison'},{type:'visual',visual:trend,caption:'Figure 2. Synthetic example data, not a production benchmark.'}]};
   const spec=OrbitWidgets.resolveVisuals(input,[{id:'existing-architecture',spec:architecture}]);checks.push({name:kind+' exact existing diagram reuse',passed:JSON.stringify(spec.blocks[2].visual)===JSON.stringify(OrbitWidgets.normalize(architecture))});
   const blob=await OrbitWidgets.generate(spec);await save('modern-report.'+kind,blob);const read=await OrbitDocuments.read(new File([blob],'modern-report.'+kind,{type:blob.type}));checks.push({name:kind+' both visuals readable',passed:read.images.length===2});
  }
  await save('modern-results.json',new Blob([JSON.stringify(checks,null,2)]));out.textContent=JSON.stringify(checks,null,2)+'\n'+(checks.every(c=>c.passed)?'ALL PASSED':'FAILURES');
 }catch(e){out.textContent='FAILED: '+e.stack;}
};
document.querySelector('#live').onclick=async()=>{
 const out=document.querySelector('#live-result');out.textContent='Planning…';let calls=0;
 try{
  const plan=async messages=>{const r=await fetch('/api/ollama/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'gemma4:31b-cloud',format:'json',stream:false,messages:messages.map(m=>({role:m.role,content:m.text})),options:{temperature:.3,num_predict:8192}})});const data=await r.json();if(!r.ok)throw Error(data.error||'Model failed');await save('modern-live-draft-'+(++calls)+'.json',new Blob([JSON.stringify(data.message,null,2)]));return data.message.content;};
  const request='Create an 8-slide PowerPoint project proposal for a campus assignment portal. Use a modern ocean theme and varied layouts: a cover, comparison, architecture diagram embedded INSIDE the deck, chart embedded INSIDE the deck, delivery timeline, and practical closing decisions. Include clear speaker notes. For the chart use these supplied illustrative response times only: Baseline 180 ms, Indexed 95 ms, Cached 42 ms; label them synthetic. Do not invent metrics or testimonials. Show web client, API, database and document storage in the architecture. No web research needed.';
  const result=await OrbitLongDocuments.build(request,{model:{id:'gemma4:31b-cloud'},context:[],instruction:OrbitWidgets.instruction().split("\n").filter(line=>/^(PowerPoint:|Presentation design:|Embedded visuals:|Images:|Diagram schema:|Categorical example:|Scatter example:|Box example:)/.test(line)).join("\n"),normalize:OrbitWidgets.normalize,plan,onStatus:s=>out.textContent=s});
  const spec=OrbitWidgets.extract(result.text).artifacts[0];if(!spec)throw Error('Missing file recipe');const blob=await OrbitWidgets.generate(spec);await save('modern-live.pptx',blob);await save('modern-live-recipe.json',new Blob([JSON.stringify(spec,null,2)]));out.textContent='COMPLETE: '+spec.slides.length+' slides; theme '+spec.theme+'; layouts '+spec.slides.map(s=>s.layout).join(', ')+'; embedded visuals '+spec.slides.filter(s=>s.visual).length;
 }catch(e){out.textContent='FAILED: '+e.stack;}
};

document.querySelector('#result').textContent='Ready to build';

document.querySelector('#rebuild').onclick=async()=>{try{const spec=OrbitWidgets.normalize(await (await fetch('/tests/output/document-vision/modern-live-recipe.json')).json());await save('modern-live.pptx',await OrbitWidgets.generate(spec));document.querySelector('#live-result').textContent='Saved live deck rebuilt successfully';}catch(e){document.querySelector('#live-result').textContent=e.stack;}};

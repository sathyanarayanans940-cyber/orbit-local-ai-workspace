const output=document.querySelector('#result'),checks=[];
const check=(name,ok)=>{checks.push({name,ok:!!ok});output.textContent=JSON.stringify(checks,null,2);if(!ok)throw Error(name);};
const visual={kind:'diagram',title:'Illustrative AWS request path',width:800,height:450,nodes:[{id:'lb',label:'Application Load Balancer routes incoming HTTPS requests',x:220,y:150,width:140},{id:'svc',label:'Application services',x:340,y:150,width:140}],edges:[{from:'lb',to:'svc',label:'HTTPS'}],groups:[{label:'VPC',x:100,y:30,width:620,height:340}]};
document.querySelector('#run').onclick=async()=>{
 try{
  checks.length=0;
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=250;const ctx=canvas.getContext('2d');ctx.fillStyle='#102D3A';ctx.fillRect(0,0,600,250);ctx.fillStyle='white';ctx.font='30px sans-serif';ctx.fillText('Synthetic uploaded screenshot',28,125);const upload={dataUrl:canvas.toDataURL(),width:600,height:250};canvas.width=canvas.height=0;
  const slides=Array.from({length:40},(_,i)=>({title:'AWS export audit '+(i+1),notes:'Synthetic QA content; no cloud deployment or cost claims.',...(i%5===0?{visual}:i%5===1?{visual:{kind:'chart',title:'Synthetic demand & load\u000B',chartType:'bar',labels:['Service A','Service B'],series:[{name:'Sample requests',values:[12,24]}]}}:i%5===2?{image:{assetId:'img-upload',caption:'Synthetic uploaded image'}}:i%5===3?{math:'P(A \\mid B) = \\frac{P(A \\cap B)}{P(B)}',caption:'Conditional probability'}:{bullets:['Validate exported slide text.','Preserve all source content.']} )}));
  for(let run=1;run<=4;run++){
   output.textContent+='\nExporting run '+run;
   const spec=OrbitWidgets.normalize({kind:'pptx',title:'AWS reliability fixtures',theme:'ocean',slides});
   const blob=await OrbitWidgets.generate(spec,{images:{'img-upload':upload}}),zip=await JSZip.loadAsync(await blob.arrayBuffer());
   const names=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));check('Run '+run+': 40 complete slides',names.length===40);
   for(let i=1;i<=40;i++){
    const xml=await zip.file('ppt/slides/slide'+i+'.xml').async('string'),doc=new DOMParser().parseFromString(xml,'text/xml');
    check('Run '+run+' slide '+i+': valid XML, content and image count',!doc.querySelector('parsererror')&&xml.includes('AWS export audit '+i)&&!/(?:NaN|Infinity|undefined)/.test(xml)&&(xml.match(/<p:pic>/g)||[]).length===(i%5===0?0:1));
   }
   const media=Object.values(zip.files).filter(f=>!f.dir&&/ppt\/media\/.*\.png$/.test(f.name));check('Run '+run+': media present',media.length>=4);
   for(const f of media){const bytes=await f.async('uint8array');const png=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);check('Run '+run+' '+f.name+': valid bounded PNG',png.getUint32(0)===0x89504e47&&png.getUint32(16)*png.getUint32(20)<=4000000);}
   if(run===1){const preview=await OrbitWidgets.generate({...spec,slides:spec.slides.slice(0,5)},{images:{'img-upload':upload},preview:true});const frame=document.createElement('iframe');frame.srcdoc='<link rel="stylesheet" href="/styles.css"><style>body{display:block;overflow:auto;padding:12px}.presentation-frame{width:896px!important;height:504px!important}.presentation-canvas{transform:scale(.7);transform-origin:top left}</style>'+preview;document.querySelector('#preview').replaceChildren(frame);await fetch('/audit-save/ppt-reliability.pptx',{method:'POST',body:blob});}
  }
  const broken={kind:'pptx',slides:[{title:'Missing original image',image:{assetId:'img-missing'}}]};let failed=false;try{await OrbitWidgets.generate(broken);}catch(e){failed=/Slide 1.*unavailable/.test(e.message);}check('Missing image fails with slide number; not silently omitted',failed);
  output.textContent='ALL PASSED: '+checks.length+' checks across 4 × 40 slides. Full details saved in ppt-reliability-results.json.';await fetch('/audit-save/ppt-reliability-results.json',{method:'POST',body:JSON.stringify(checks,null,2)});
 }catch(e){output.textContent+='\nFAILED '+e.stack;}
};

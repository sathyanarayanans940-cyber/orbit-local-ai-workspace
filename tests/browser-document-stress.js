const results=[],out=document.querySelector('#result');
const save=async(name,blob)=>{const r=await fetch('/audit-save/'+name,{method:'POST',body:blob});if(!r.ok)throw Error('Saving failed');};
const check=(name,passed,detail='')=>{results.push({name,passed,detail});out.textContent=JSON.stringify(results,null,2);};
const reject=async(name,fn,match)=>{try{await fn();check(name,false,'Unexpected success');}catch(e){check(name,!match||match.test(e.message),e.message);}};
const asFile=(blob,name)=>new File([blob],name,{type:blob.type});
const show=(src,label)=>{const f=document.createElement('figure'),img=new Image(),c=document.createElement('figcaption');img.src=src;c.textContent=label;f.append(img,c);document.querySelector('#pages').append(f);};
function screenshot(w,h,lines,background='#132236'){
 const cv=document.createElement('canvas');cv.width=w;cv.height=h;const c=cv.getContext('2d');c.fillStyle=background;c.fillRect(0,0,w,h);c.strokeStyle='#52dfaf';c.lineWidth=8;c.strokeRect(5,5,w-10,h-10);c.fillStyle='#ffffff';c.font=`${Math.min(40,w/22)}px monospace`;lines.forEach((line,i)=>c.fillText(line,20,60+i*75));return cv;
}
async function renderPdf(blob,label){
 const reader=window.pdfjsLib||await import('/vendor/readers/pdf.min.mjs');window.pdfjsLib=reader;reader.GlobalWorkerOptions.workerSrc='/vendor/readers/pdf.worker.min.mjs';
 const task=reader.getDocument({data:await blob.arrayBuffer(),isEvalSupported:false,useWasm:false}),doc=await task.promise;
 const text=[];
 for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);text.push((await p.getTextContent()).items.map(i=>i.str).join(' '));const v=p.getViewport({scale:.9}),cv=document.createElement('canvas');cv.width=v.width;cv.height=v.height;await p.render({canvasContext:cv.getContext('2d'),viewport:v}).promise;show(cv.toDataURL(),`${label} / ${n}`);p.cleanup();}
 const count=doc.numPages;await task.destroy();return {count,text};
}
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;const start=performance.now();check("Native PDF viewer available",true,String(navigator.pdfViewerEnabled));let ticks=0;const heartbeat=setInterval(()=>ticks++,100);
 try{
 const fixtures=[['wide',3000,400,['ULTRAWIDE: edges must remain visible','Input -7, 0, 42 | output 42']],['portrait',700,2800,['TALL SCREENSHOT','TEST RESULT: 2 / 3 PASSED','This is a failure, not all passed','ORBIT-TALL-4931']],['tiny',24,24,[]],['square',900,900,['Run A: 17 / 20 passed','Run B: no execution evidence','Do not invent test results']]];
 const images={};
 for(const [name,w,h,lines] of fixtures){const cv=screenshot(w,h,lines),url=cv.toDataURL();const a=await OrbitDocuments.raster(await (await fetch(url)).blob(),name+'.png');images['img-'+name]=a;check(name+' aspect ratio preserved',Math.abs(a.width/a.height-w/h)<.01,`${a.width} x ${a.height}`);if(name==='portrait')await save('direct-screenshot.png',await(await fetch(url)).blob());}
 const cv=screenshot(1200,600,['Screenshot A — result 17 / 20 passed','Screenshot B — result UNKNOWN','Visual verification: DIRECT-6158']);await save('direct-results.png',await(await fetch(cv.toDataURL())).blob());
 const caption='Evidence must be read exactly as supplied; failures remain failures. '.repeat(17).slice(0,1100);
 const blocks=Object.keys(images).flatMap((assetId,i)=>[...(i?[{type:'pageBreak'}]:[]),{type:'heading',text:assetId},{type:'image',assetId,caption:assetId==='img-portrait'?caption:'All four colored borders must be visible.',widthPercent:100},{type:'paragraph',text:'AFTER-'+assetId}]);
 let wordBlob;
 await reject('Oversized slide caption requests repair without silently shrinking',async()=>OrbitWidgets.normalize({kind:'pptx',slides:[{title:'Caption boundary',image:{assetId:'img-square',caption}}]}),/240/);
 for(const kind of ['pdf','docx','pptx']){
  const spec=OrbitWidgets.normalize(kind==='pptx'?{kind,title:'Extreme screenshot layouts',slides:Object.keys(images).map(assetId=>({title:assetId,bullets:['Actual evidence only','Maintain original proportions'],notes:assetId==='img-portrait'?caption:'',image:{assetId,caption:assetId==='img-portrait'?'Tall screenshot: 2 of 3 tests passed. Full evidence description is retained in the slide notes.':'Complete screenshot with borders'}}))}:{kind,title:'Extreme screenshot layouts',blocks});
  const bound=OrbitDocuments.bind(spec,Object.entries(images).map(([id,v])=>({...v,id})));const blob=await OrbitWidgets.generate(spec,{images:bound});await save('stress-layout.'+kind,blob);check(kind+' binary generated',blob.size>1000,`${blob.size} bytes`);
  const read=await OrbitDocuments.read(asFile(blob,'layout.'+kind));check(kind+' every screenshot preserved',read.images.length>=4,`${read.images.length} images`);
  if(kind==='pdf'){const layout=await renderPdf(blob,'Stress PDF');check('PDF final marker survives',layout.text.join(' ').includes('AFTER-img-square'));check('PDF no empty pages',layout.text.every(t=>t.replace(/\d+\s*\/\s*\d+/g,'').trim().length>0));}
  if(kind==='docx')wordBlob=blob;
 }
 const mutate=async(fn,name)=>{const z=await JSZip.loadAsync(await wordBlob.arrayBuffer());await fn(z);return asFile(await z.generateAsync({type:'blob'}),name+'.docx');};
 let f=await mutate(async z=>{const p='word/_rels/document.xml.rels';z.file(p,(await z.file(p).async('string')).replace(/Target="media\//g,'Target="/word/media/'));},'absolute-target');
 check('Office absolute relationship paths', (await OrbitDocuments.read(f)).images.length===4);
 f=await mutate(async z=>{const p='word/document.xml';z.file(p,(await z.file(p).async('string')).replace(/xmlns:r=/g,'xmlns:relAlias=').replace(/\br:embed=/g,'relAlias:embed='));},'namespace-alias');
 check('Office relationship namespace aliases', (await OrbitDocuments.read(f)).images.length===4);
 f=await mutate(async z=>{for(const name of Object.keys(z.files))if(name.startsWith('word/media/')&&!z.files[name].dir){z.remove(name);break;}},'missing-image');
 const missing=await OrbitDocuments.read(f);check('Missing embedded image explicit warning',missing.warnings.some(w=>/missing/.test(w)));
 f=await mutate(async z=>{const p='word/_rels/document.xml.rels';z.file(p,(await z.file(p).async('string')).replace(/Target="media\/[^"]+"/,'Target="https://example.invalid/do-not-fetch.png" TargetMode="External"'));},'external-image');
 const external=await OrbitDocuments.read(f);check('External image is warned, never fetched',external.warnings.some(w=>/external linked/.test(w)));
 await reject('Damaged PDF fails visibly',()=>OrbitDocuments.read(asFile(new Blob(['not a pdf']),'broken.pdf')));
 await reject('Damaged Office ZIP fails visibly',()=>OrbitDocuments.read(asFile(new Blob(['bad zip']),'broken.docx')));
 await reject('Malformed raster fails visibly',()=>OrbitDocuments.raster(new Blob(['bad image'],{type:'image/png'}),'broken.png'));
 await reject('Oversized file rejected before parsing',()=>OrbitDocuments.read({size:26*1024*1024,name:'big.pdf'}),/25 MB/);
 const manyBlocks=[];for(let n=1;n<=81;n++){if(n>1)manyBlocks.push({type:'pageBreak'});manyBlocks.push({type:'paragraph',text:'Page '+n});}
 const many=await OrbitWidgets.generate(OrbitWidgets.normalize({kind:'pdf',title:'81-page boundary test',blocks:manyBlocks}));
 await reject('81-page PDF rejected without silent truncation',()=>OrbitDocuments.read(asFile(many,'81.pdf')),/80 pages/);
 const z=new JSZip();z.file('word/document.xml','<broken>');
 await reject('Invalid Office XML reported',async()=>OrbitDocuments.read(asFile(await z.generateAsync({type:'blob'}),'xml.docx')),/XML/);
 let count=0;const msgs=[{attachments:Array.from({length:17},(_,i)=>({name:'same.png',assetId:'img-'+i,dataUrl:images['img-square'].dataUrl}))}];
 const described=await OrbitDocuments.describe(msgs,{model:{provider:'Ollama',capabilities:['vision']},read:async m=>{count++;if(m[1].attachments.length>4)throw Error('Too many images');return m[1].text;}});
 check('17 separately uploaded screenshots batch safely',count===5&&described[0].attachments.every(a=>a.visualSummary));
 check('Browser remained responsive',ticks>0,`${ticks} heartbeat ticks; ${(performance.now()-start).toFixed(0)} ms total`);
 }catch(e){check('Unhandled audit failure',false,e.stack);}finally{clearInterval(heartbeat);await save('stress-results.json',new Blob([JSON.stringify(results,null,2)]));out.textContent+='\n'+(results.every(r=>r.passed)?'ALL PASSED':'FAILURES');document.querySelector('#run').disabled=false;}
};

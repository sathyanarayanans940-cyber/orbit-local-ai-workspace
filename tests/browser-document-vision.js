const report=document.querySelector('#result'),results=[];
const log=(name,passed,detail='')=>{results.push({name,passed,detail});report.textContent=JSON.stringify(results,null,2);};
const save=async(name,blob)=>{const r=await fetch('/audit-save/'+name,{method:'POST',body:blob});if(!r.ok)throw Error('Could not save audit artifact');};
document.querySelector('#run').onclick=async()=>{
 document.querySelector('#run').disabled=true;
 try{
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=500;const c=canvas.getContext('2d');c.fillStyle='#101b28';c.fillRect(0,0,1200,500);c.font='28px monospace';c.fillStyle='#dce8f2';c.fillText('$ python lower_bound.py',45,65);c.fillStyle='#7ee2ab';c.fillText('TEST RESULT: 13 / 13 PASSED',45,130);c.fillStyle='#dce8f2';c.fillText('Input: [1, 2, 2, 2, 3]    target: 2',45,195);c.fillText('Output index: 1',45,260);c.fillText('Visual-only verification code: ORBIT-7284',45,325);c.fillStyle='#f5cd75';c.fillText('Screenshot fixture — synthetic, not user data',45,430);
 const dataUrl=canvas.toDataURL('image/png'),assetId='img-audit-screen',images={[assetId]:{dataUrl,width:1200,height:500,label:'Synthetic execution screenshot'}};document.querySelector('#source').src=dataUrl;
 await save('source.png',await (await fetch(dataUrl)).blob());
 const blocks=[{type:'heading',text:'Aim',level:1},{type:'paragraph',text:'Validate lower-bound search and record the supplied execution screenshot.'},{type:'heading',text:'Code',level:1},{type:'code',language:'python',text:'def lower_bound(a, x):\n    lo, hi = 0, len(a)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if a[mid] < x:\n            lo = mid + 1\n        else:\n            hi = mid\n    return lo'},{type:'image',assetId,caption:'Figure 1. Supplied execution screenshot; preserved without invented results.',widthPercent:100},{type:'heading',text:'Result',level:1},{type:'paragraph',text:'The screenshot records thirteen passing cases and output index 1.'}];
 for(const kind of ['pdf','docx','pptx']){
  const spec=OrbitWidgets.normalize(kind==='pptx'?{kind,title:'Assignment evidence',slides:[{title:'Binary search execution',bullets:['Aim: verify lower-bound search','Result: thirteen cases passed'],image:{assetId,caption:'Supplied screenshot'}}]}:{kind,title:'Binary search assignment',blocks});
  const blob=await OrbitWidgets.generate(spec,{images});await save('assignment.'+kind,blob);
  const read=await OrbitDocuments.read(new File([blob],'assignment.'+kind,{type:blob.type}));
  log(kind+' image round trip',read.images.length>=1,`${read.images.length} visuals; ${read.text.length} text characters; ${read.warnings.join('; ')}`);
  if(kind!=='pdf')log(kind+' exact embedded image',read.images.some(i=>i.dataUrl===dataUrl),'Pixel raster is preserved at original size');
  for(const v of read.images){const f=document.createElement('figure');f.innerHTML=`<img src="${v.dataUrl}"><figcaption>${v.label}</figcaption>`;document.querySelector('#pages').append(f);}
 }
 const prose='A lower-bound search returns the first position whose value is not smaller than the target. Maintaining a half-open interval keeps the empty-array case well defined. When the middle value is below the target, the left endpoint advances; otherwise the right endpoint moves to the middle. Every iteration decreases the search interval. Duplicate values remain valid because equality selects the left half. An independent reference scan supplies expected answers for empty arrays, single-element arrays, repeated values, absent targets and boundary targets. Recorded results should be distinguished from assumptions about untested inputs. ';
 const longBlocks=[];for(let n=1;n<=19;n++){if(n>1)longBlocks.push({type:'pageBreak'});longBlocks.push({type:'heading',text:`Section ${n}: Verification record`,level:1},{type:'paragraph',text:prose.repeat(3)},{type:'paragraph',text:`Section ${n} endpoint marker: END-${n}`});}
 for(const kind of ['pdf','docx']){
  const blob=await OrbitWidgets.generate({kind,title:'Nineteen-page capacity audit',blocks:longBlocks});await save('nineteen-pages.'+kind,blob);
  if(kind==='pdf'){const task=pdfjsLib.getDocument({data:await blob.arrayBuffer(),isEvalSupported:false,useWasm:false}),doc=await task.promise;log('PDF actual page count',doc.numPages===19,`${doc.numPages} rendered pages`);
   for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),text=(await p.getTextContent()).items.map(i=>i.str).join(' ');log('Page '+n+' content intact',text.includes(`END-${n}`)&&text.includes(`Section ${n}`));const v=p.getViewport({scale:.5}),cv=document.createElement('canvas');cv.width=v.width;cv.height=v.height;await p.render({canvasContext:cv.getContext('2d'),viewport:v}).promise;const f=document.createElement('figure');f.innerHTML=`<img src="${cv.toDataURL()}"><figcaption>Long PDF · ${n}</figcaption>`;document.querySelector('#pages').append(f);p.cleanup();}await task.destroy();
  }else{const zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('word/document.xml').async('string');log('Word section breaks and last content',(xml.match(/<w:pageBreakBefore\/>/g)||[]).length===18&&xml.includes('END-19'));}
 }
 let calls=0;const many=[{role:'user',attachments:[{name:'multi.pdf',extractedText:'Source text',visuals:Array.from({length:9},(_,i)=>({id:'img-'+i,label:'Page '+(i+1),dataUrl}))}]}];
 const described=await OrbitDocuments.describe(many,{model:{provider:'Ollama',capabilities:['vision']},read:async messages=>{calls++;return messages[1].attachments.map(a=>a.name).join(',');}});
 log('All image batches read exactly once',calls===3&&described[0].attachments[0].visualSummary.includes('Page 9'));
 let denied=false;try{await OrbitWidgets.generate({kind:'pdf',title:'Missing image',blocks:[{type:'image',assetId:'img-missing'}]});}catch(_){denied=true;}log('Missing image fails visibly',denied);
 await save('results.json',new Blob([JSON.stringify(results,null,2)],{type:'application/json'}));
 report.textContent+='\n'+(results.every(r=>r.passed)?'ALL PASSED':'FAILURES');
 }catch(error){log('Audit error',false,error.stack);}finally{document.querySelector('#run').disabled=false;}
};

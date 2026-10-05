document.querySelector('#render').onclick=async()=>{const out=document.querySelector('#result');try{
 const spec=await(await fetch('/tests/output/document-vision/web-report-recipe.json',{cache:'no-store'})).json();out.textContent='Rendering PDF and Word…';
 for(const kind of ['pdf','docx']){const blob=await OrbitWidgets.generate({...spec,kind});const saved=await fetch('/audit-save/web-report.'+kind,{method:'POST',body:blob});if(!saved.ok)throw Error('Save failed');}
 out.textContent='PDF and Word saved with researched prose, inline source IDs and bibliography.';document.querySelector('#preview').src='/tests/output/document-vision/web-report.pdf';
}catch(e){out.textContent=e.stack;}};

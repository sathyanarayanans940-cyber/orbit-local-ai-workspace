const select=document.querySelector('#theme'),target=document.querySelector('#preview-samples');
const samples=[{title:'Evidence informs the decision',layout:'cover',subtitle:'One consistent palette across the presentation.'},{title:'Sample project targets',layout:'metrics',tone:'accent',metrics:[{value:'3 steps',label:'Submission',detail:'Planning example'},{value:'1 record',label:'Evidence',detail:'Illustrative target'}]},{title:'Light slide',layout:'split',columns:[{title:'Students',body:'Submit the supplied project evidence.'},{title:'Reviewers',body:'Read, discuss and verify the actual results.'}]},{title:'Dark table',tone:'dark',table:{headers:['Area','Status'],rows:[['Evidence','Ready for review']]}}];
for(const theme of Object.keys(OrbitWidgets.presentationThemes)){const o=document.createElement('option');o.value=theme;o.textContent=theme;select.append(o);}
async function render(theme){target.innerHTML=await OrbitWidgets.generate(OrbitWidgets.normalize({kind:'pptx',theme,title:'Preview validation',slides:samples}),{preview:true});target.querySelectorAll('.presentation-frame').forEach(f=>f.querySelector('.presentation-canvas').style.transform=`scale(${f.clientWidth/1280})`);}
(async()=>{
const results=[];
for(const theme of Object.keys(OrbitWidgets.presentationThemes)){
 await render(theme);const frames=target.querySelectorAll('.presentation-frame');
 const overflow=[...target.querySelectorAll('.slide-text')].filter(e=>e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2).map(e=>e.textContent);
 results.push({theme,passed:frames.length===4&&overflow.length===0,overflow});
}
select.value='forest';await render('forest');select.onchange=()=>render(select.value);
document.querySelector('#status').textContent=results.every(x=>x.passed)?'ALL 14 PREVIEW THEMES PASSED':JSON.stringify(results);
fetch('/audit-save/theme-preview-results.json',{method:'POST',body:JSON.stringify(results,null,2)});
})();

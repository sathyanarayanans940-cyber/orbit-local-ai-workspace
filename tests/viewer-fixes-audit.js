const auditDeck=OrbitWidgets.normalize({kind:'pptx',theme:'ocean',title:'Software Engineering Essentials',slides:[
 {title:"What's Inside an SRS?",metrics:[{value:'Functional',label:'What it DOES',detail:'Features like Login, Payment, Search'},{value:'Non-Functional',label:'How it BEHAVES',detail:'Speed, Security, Scalability'},{value:'Constraints',label:'The Limits',detail:'OS support, deadlines, budget'},{value:'Scope',label:'The Boundary',detail:'What is NOT included in the build'}]},
 {title:'Specialized Development Models',bullets:["Incremental: Delivering the app in usable slices","Prototyping: Building a mock-up first to validate ideas","Spiral: Heavy focus on Risk Analysis for massive projects","RAD: Using reusable tools for a speedrun delivery"]},
 {title:'Solving M:N with a Bridge Entity',bullets:['The bridge entity turns one M:N into two 1:N relationships','It stores relationship data like quantity and price'],visual:{kind:'diagram',title:'Order relationship',width:1000,height:360,nodes:[{id:'order',label:'Order\n(1)',shape:'entity',x:140,y:180,width:180,attributes:['PK order_id','date','customer_id']},{id:'line',label:'OrderLine\n(N)',shape:'entity',x:500,y:180,width:180,attributes:['FK order_id','FK product_id','quantity','price']},{id:'product',label:'Product\n(1)',shape:'entity',x:860,y:180,width:180,attributes:['PK product_id','name','category']}],edges:[{from:'order',to:'line',label:'contains'},{from:'line',to:'product',label:'appears in'}]}},
 {title:'Summary & Key Takeaways',bullets:['Choose the model based on risk and requirement stability','Use a bridge entity for many-to-many relationships'],notes:'These notes stay outside the slide.'}
]});
document.querySelector('#run').onclick=async()=>{try{
 const blob=await OrbitWidgets.generate(auditDeck);await fetch('/audit-save/viewer-regression.pptx',{method:'POST',body:blob});
 await OrbitPreview.show({artifact:{id:'viewer-regression',spec:auditDeck}});
 const frames=[...document.querySelectorAll('.presentation-frame')];const metrics=[...document.querySelectorAll('.slide-text')].filter(e=>['Functional','Non-Functional','Constraints'].includes(e.textContent));
 const result={slides:frames.length,ratios:frames.map(e=>e.clientWidth/e.clientHeight),metrics:metrics.map(e=>({text:e.textContent,font:getComputedStyle(e).fontSize,overflow:e.scrollHeight>e.clientHeight+1})),images:document.querySelectorAll('.slide-image').length};
 document.querySelector('#status').textContent=JSON.stringify(result,null,2);await fetch('/audit-save/viewer-results.json',{method:'POST',body:JSON.stringify(result)});
 }catch(e){document.querySelector('#status').textContent=e.stack;}};
document.querySelector('#charts').onclick=()=>{
 state.messages=[{artifacts:[]}];const root=document.querySelector('#messages');root.innerHTML='<section class="message" data-message-index="0"><div class="message-text">'+[['OrderLineID','OrderID','Quantity'],['Month','Sales']].map((h,i)=>'<div class="table-wrap"><table><thead><tr>'+h.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+ (i?[['Jan','10'],['Feb','20']]:[['1','101','1'],['2','102','2']]).map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>').join('')+'<div class="code-block"><div class="code-content-wrap"><code class="code-content">'+('A long code line '.repeat(25))+'</code></div></div></div></section>';
 addTableChartButtons();const spec=tableChartSpec(root.querySelectorAll('table')[1]);appendTableChart(state.messages[0],spec);appendTableChart(state.messages[0],spec);document.querySelector('#status').textContent=JSON.stringify({buttons:root.querySelectorAll('.chart-table').length,charts:state.messages[0].artifacts.length});
};

initWidgetUi();

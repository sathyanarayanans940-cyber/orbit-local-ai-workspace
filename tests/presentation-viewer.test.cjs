const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),JSZip=require('jszip'),W=require('../widgets.js');
const table=(headers,rows)=>({querySelectorAll:s=>s==='thead th'?headers.map(innerText=>({innerText})):rows.map(r=>({querySelectorAll:()=>r.map(innerText=>({innerText}))}))});
const c=vm.createContext({OrbitWidgets:W,crypto:require('node:crypto').webcrypto});vm.runInContext(fs.readFileSync('widgets-ui.js','utf8'),c);
test('record tables do not offer charts; quantitative category tables still do',()=>{
 for(const headers of [['OrderLineID','OrderID','Quantity'],['Student ID','Mark'],['Name','Phone','ID']])assert.throws(()=>c.tableChartSpec(table(headers,[['1','100','2'],['2','200','4']])));
 assert.throws(()=>c.tableChartSpec(table(['Product','Sales'],[['Phone','10'],['Phone','20']])));
 const spec=c.tableChartSpec(table(['Month','Sales','ID'],[['Jan','10','1'],['Feb','20','2']]));assert.equal(spec.series.length,1);assert.equal(spec.series[0].name,'Sales');
});
test('repeated table chart actions and reloads reuse the existing chart',()=>{
 const spec=c.tableChartSpec(table(['Month','Revenue'],[['Jan','10'],['Feb','20']])),message={};
 const first=c.appendTableChart(message,spec);c.appendTableChart(message,spec);assert.equal(message.artifacts.length,1);
 const restored=JSON.parse(JSON.stringify(message));restored.artifacts[0].spec.chartType='line';c.appendTableChart(restored,spec);assert.equal(restored.artifacts.length,1);assert.equal(restored.artifacts[0].id,first.id);
});
test('textual metrics get explicit safe font sizes and preview shares export positions',async()=>{
 const {generatePresentation}=await import('../presentation-engine.js');
 const spec=W.normalize({kind:'pptx',theme:'ocean',title:'Software Engineering',slides:[{title:"What's Inside an SRS?",metrics:['Functional','Non-Functional','Constraints','Scope'].map(value=>({value,label:'What it does',detail:'Features and constraints'}))},{title:'Models',bullets:['Incremental','Prototyping','Spiral','RAD']}]});
 const blob=await generatePresentation(spec),zip=await JSZip.loadAsync(await blob.arrayBuffer()),xml=await zip.file('ppt/slides/slide1.xml').async('string');
 for(const word of ['Functional','Non-Functional','Constraints']){const shape=xml.split('<p:sp>').find(s=>s.includes('<a:t>'+word+'</a:t>'));assert.ok(shape);const size=Number(shape.match(/<a:rPr[^>]*sz="(\d+)"/)[1]);assert.ok(size<=2800,word+': '+size);}
 const html=await generatePresentation(spec,{preview:true});assert.equal((html.match(/class="presentation-frame"/g)||[]).length,2);assert.match(html,/Functional/);assert.equal((html.match(/>•<\/div>/g)||[]).length,4);assert.match(html,/left:69.12px/);
 const bullets=await zip.file('ppt/slides/slide2.xml').async('string');assert.doesNotMatch(bullets,/<a:t>01<\/a:t>/);assert.match(bullets,/<a:t>•<\/a:t>/);
});

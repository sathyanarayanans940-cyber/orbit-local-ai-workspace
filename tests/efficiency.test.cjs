const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),W=require('../widgets.js');
test('task-scoped schema preserves full requested tools and all diagram/chart options inside documents',()=>{
 const full=W.instruction(),xlsx=W.instructionFor('Make an Excel workbook with prices'),word=W.instructionFor('Make a Word report with math'),ppt=W.instructionFor('Create PPT slides with diagrams');
 assert.ok(xlsx.length<full.length*.45);assert.ok(word.length<full.length);assert.match(word,/Diagram schema:/);assert.match(word,/Box example:/);assert.match(word,/Mathematics in files:/);assert.match(ppt,/Presentation design:/);
 for(const line of full.split('\n').filter(l=>/^(Excel:|Use only enabled kinds)/.test(l)))assert.ok(xlsx.includes(line));
 assert.equal(W.instructionFor('continue'),full);assert.equal(W.instructionFor('Tell me something interesting'),full);
 const mixed=W.instructionFor('Export to Excel',[{role:'user',text:'Create a PowerPoint with an ER diagram'}]);assert.match(mixed,/PowerPoint:/);assert.match(mixed,/Diagram schema:/);assert.match(mixed,/Excel:/);
});
test('file cache evicts by bytes, replacements release old bytes, and huge binaries are not retained',()=>{
 const src=fs.readFileSync('widgets-ui.js','utf8').split('const widgetBusy')[0];const c=vm.createContext({});vm.runInContext(src+'\nglobalThis.cache=widgetBlobs;',c);const m=c.cache;
 m.set('a',{size:20*1024*1024});m.set('b',{size:20*1024*1024});assert.equal(m.size,1);assert.ok(m.has('b'));
 m.set('b',{size:5});assert.equal(m.bytes,5);m.set('huge',{size:50*1024*1024});assert.equal(m.size,0);assert.equal(m.bytes,0);
 for(let i=0;i<30;i++)m.set(i,{size:100});assert.equal(m.size,16);m.clear();assert.equal(m.bytes,0);
});
test('reader loading shares in-flight requests, retries a failure, and keeps startup lean',async()=>{
 const scripts=[];const root={document:{currentScript:{src:'http://localhost/document-assets.js'},baseURI:'http://localhost/',head:{append:s=>scripts.push(s)},createElement:()=>({remove(){}})}};const c=vm.createContext({...root,URL,console});vm.runInContext(fs.readFileSync('document-assets.js','utf8'),c);const D=c.OrbitDocuments;
 const a=D.ensureReaders('excel'),b=D.ensureReaders('excel');assert.equal(scripts.length,1);c.XLSX={};scripts[0].onload();await Promise.all([a,b]);
 const fail=D.ensureReaders('zip');scripts[1].onerror();await assert.rejects(fail);const retry=D.ensureReaders('zip');assert.equal(scripts.length,3);c.JSZip={};scripts[2].onload();await retry;
 const html=fs.readFileSync('index.html','utf8');assert.doesNotMatch(html,/<script src="vendor\/(?:readers\/(?:mammoth|jszip)|sheetjs\/xlsx)/);
});
test('memory search cache never retains image-bearing messages and accounts for hidden recipe text',()=>{
 const source=fs.readFileSync('memories.js','utf8');const fragment=source.slice(source.indexOf('function searchable('),source.indexOf('function score('));
 const c=vm.createContext({});vm.runInContext(fragment+'\nglobalThis.inspect={searchText,searchCache,get size(){return cachedCharacters}};',c);const {inspect:i}=c;
 const first=i.searchText({text:'Rare calibration 7.35',attachments:[{dataUrl:'data:image/png;base64,'+'A'.repeat(1000000)}]});
 assert.strictEqual(i.searchText({text:'Rare calibration 7.35'}),first);assert.deepEqual([...i.searchCache.keys()],['Rare calibration 7.35']);
 const huge='```orbit-widget\n'+'a'.repeat(4000001)+'\n```';i.searchText({text:huge});assert.ok(!i.searchCache.has(huge));assert.ok(i.size<=4000000);
 assert.equal(i.searchText({text:'Edited calibration 8.25'}).text,'Edited calibration 8.25');
});
test('equation centering keeps exact alignment while batching layout measurements',()=>{
 const source=fs.readFileSync('app.js','utf8'),fragment=source.slice(source.indexOf('function centerDisplayMath()'),source.indexOf('function updateAssistantArticle('));
 const events=[],equations=Array.from({length:200},(_,n)=>({style:{set transform(v){events.push(v?'position':'reset')}},getBoundingClientRect(){events.push('measure');return {left:n,width:80};}}));
 const c=vm.createContext({$:()=>({getBoundingClientRect:()=>({left:0,width:1000})}),$$:()=>equations});vm.runInContext(fragment,c);c.centerDisplayMath();
 assert.deepEqual(events.slice(0,200),Array(200).fill('reset'));assert.deepEqual(events.slice(200,400),Array(200).fill('measure'));assert.deepEqual(events.slice(400),Array(200).fill('position'));
});

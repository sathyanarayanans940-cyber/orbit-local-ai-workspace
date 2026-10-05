const {test}=require('node:test'),assert=require('node:assert/strict'),JSZip=require('jszip'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../widgets.js'),A=require('../archives.js');
const file=bytes=>new File([bytes],'project.zip',{type:'application/zip'});
async function zipped(entries){const zip=new JSZip();for(const [name,value] of Object.entries(entries))zip.file(name,value);return file(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));}
async function alter(source,change){const bytes=new Uint8Array(await source.arrayBuffer());const v=new DataView(bytes.buffer);let central=bytes.findIndex((_,i)=>v.byteLength>=i+4&&v.getUint32(i,true)===0x02014b50);change(v,central,bytes);return file(bytes);}
test('reads nested folders, Unicode, empty files and exact source bytes',async()=>{
 const source=await zipped({'src/main.cpp':'\ufeff#include <iostream>\r\n\t// literal \\n λ 😀\r\n','资料/notes.md':'# Notes','empty.txt':''});
 const archive=await A.open(source);assert.ok(archive.entries.some(e=>e.path==='资料/'));
 for(const e of archive.entries.filter(e=>!e.dir)){const blob=await archive.read(e);assert.equal(blob.name,e.path.split('/').at(-1));assert.equal(blob.size,e.size);}
 assert.deepEqual(Buffer.from(await (await archive.read(archive.entries.find(e=>e.path==='src/main.cpp'))).arrayBuffer()),Buffer.from('\ufeff#include <iostream>\r\n\t// literal \\n λ 😀\r\n'));
});
test('empty ZIP and explicit empty directory round trip',async()=>{
 const blob=await W.generate({kind:'zip',filename:'empty.zip',entries:[{path:'empty/',directory:true}]});const archive=await A.open(new File([blob],'empty.zip'));assert.deepEqual(archive.entries.map(e=>e.path),['empty/']);
 assert.equal((await A.open(await zipped({}))).entries.length,0);
});
test('ZIP comments and streamed data descriptors remain readable',async()=>{
 const zip=new JSZip();zip.file('src/main.js','console.log(42);');zip.comment='A normal ZIP comment';
 const archive=await A.open(file(await zip.generateAsync({type:'uint8array',compression:'DEFLATE',streamFiles:true})));
 assert.equal(await (await archive.read(archive.entries.find(e=>e.path==='src/main.js'))).text(),'console.log(42);');
});
test('rejects malformed, encrypted, multi-volume, links and unsupported compression',async()=>{
 await assert.rejects(A.open(file('not a ZIP')),/complete/);
 const source=await zipped({'test.txt':'hello'});
 for(const [mutate,pattern] of [[(v,p)=>v.setUint16(p+8,1,true),/Password/],[(v,p)=>v.setUint16(p+10,99,true),/compression/],[(v,p)=>v.setUint32(p+38,0xa1ff0000,true),/symbolic/],[(v,p,b)=>v.setUint16(b.length-18,1,true),/Multi-part/]])await assert.rejects(A.open(await alter(source,mutate)),pattern);
});
test('rejects traversal, absolute, ambiguous and conflicting paths before decompression',async()=>{
 for(const name of ['../escape.txt','/absolute.txt','a/../../escape.txt','C:/file.txt','a\\file.txt','CON.txt','a/./file.txt','trailing /file.txt'])await assert.rejects(A.open(await zipped({[name]:'x'})),/path|relative/);
 await assert.rejects(A.open(await zipped({'A.txt':'a','a.txt':'b'})),/duplicate/);
 await assert.rejects(A.open(await zipped({'src':'file','src/main.py':'print(1)'})),/conflict/);
});
test('bombs, many entries, oversized inputs and forged size are bounded',async()=>{
 const source=await zipped({'test.txt':'hello'});
 await assert.rejects(A.open(await alter(source,(v,p)=>v.setUint32(p+24,A.limits.entry+1,true))),/expanded/);
 const entries=Object.fromEntries(Array.from({length:501},(_,i)=>['f'+i+'.txt','']));await assert.rejects(A.open(await zipped(entries)),/500/);
 await assert.rejects(A.open({size:A.limits.compressed+1,arrayBuffer(){throw Error('must not allocate');}}),/25 MB/);
 const forged=await A.open(await alter(source,(v,p)=>v.setUint32(p+24,1,true)));await assert.rejects(forged.read(forged.entries[0]),/declared|damaged/);
 const badcrc=await A.open(await alter(source,(v,p)=>v.setUint32(p+16,1,true)));await assert.rejects(badcrc.read(badcrc.entries[0]),/integrity/);
});
test('extract inventories mixed files, reads source and reports unsupported binaries',async()=>{
 const source=await zipped({'src/main.py':'print("hello")','bin/random.bin':new Uint8Array([0,255,1]),'README.md':'Use src/main.py'});
 const result=await A.extract(source,async f=>({text:await f.text(),images:[],warnings:[]}));assert.match(result.text,/Folder: src\//);assert.match(result.text,/File: src\/main.py[\s\S]*print/);assert.match(result.text,/unsupported binary/);assert.equal(result.warnings.length,0);
});
test('recursive ZIPs have a shared budget, depth limit and clearly identified contents',async()=>{
 let child=await zipped({'leaf.txt':'leaf'});for(let i=0;i<3;i++)child=await zipped({'nested.zip':new Uint8Array(await child.arrayBuffer())});
 const result=await A.extract(child,async f=>f.text());assert.match(result.text,/nested.zip!\/nested.zip!\//);assert.match(result.text,/depth limit/);
 const budget={entries:500,bytes:0};await assert.rejects(A.open(await zipped({'x.txt':'x'}),{budget}),/shared/);
});
test('context truncation and read failures are explicit rather than silently complete',async()=>{
 const source=await zipped({'long.txt':'x'.repeat(110000),'next.txt':'second','bad.pdf':'bad'});
 const result=await A.extract(source,async f=>{if(f.name==='bad.pdf')throw Error('Invalid PDF');return f.text();});assert.ok(result.text.length<=100000);assert.match(result.warnings.join(' '),/remaining file contents/);
 const bad=await A.extract(await zipped({'bad.pdf':'bad','ok.txt':'ok'}),async f=>{if(f.name.endsWith('pdf'))throw Error('Invalid PDF');return f.text();});assert.match(bad.text,/Not read: Invalid PDF/);assert.match(bad.text,/ok/);
});
test('generates a folder tree with source, empty files and real document recipes',async()=>{
 const input={kind:'zip',filename:'project.zip',entries:[{path:'src/main.cpp',content:'int main() { return 0; }\n'},{path:'docs/result.pdf',file:{kind:'pdf',title:'Result',blocks:[{type:'paragraph',text:'Result text'}]}},{path:'empty.txt',content:''}]};
 const spec=W.normalize(input);assert.deepEqual(W.normalize(spec),spec);let docs=0;
 const blob=await A.generate(spec,{},async doc=>{docs++;assert.equal(doc.kind,'pdf');return new Blob(['%PDF-1.7 test']);});assert.equal(docs,1);assert.equal(blob.type,'application/zip');
 const zip=await JSZip.loadAsync(await blob.arrayBuffer());assert.equal(await zip.file('src/main.cpp').async('string'),'int main() { return 0; }\n');assert.match(await zip.file('docs/result.pdf').async('string'),/^%PDF/);assert.equal(await zip.file('empty.txt').async('string'),'');
});
test('invalid recipes cannot fake binary files or create inconsistent folder trees',()=>{
 const base={kind:'zip',filename:'project.zip'};
 for(const entries of [[{path:'fake.pdf',content:'plain text'}],[{path:'../x.py',content:'x'}],[{path:'x.py',content:'x'},{path:'x.py',content:'y'}],[{path:'doc.txt',file:{kind:'pdf',title:'Wrong',blocks:[]}}],[{path:'a.zip',file:{kind:'zip',filename:'a.zip',entries:[]}}],[{path:'x.txt',content:'x',sourceId:'id'}]])assert.throws(()=>W.normalize({...base,entries}));
 assert.throws(()=>W.normalize({...base,filename:'folder/project.zip',entries:[]}));
 const manyParents=Array.from({length:100},(_,i)=>({path:Array.from({length:6},(_,j)=>`folder-${i}-${j}`).join('/')+'/main.py',content:'x'}));
 assert.throws(()=>W.normalize({...base,entries:manyParents}),/500 files and folders/);
});
test('existing uploads and artifact sources keep exact bytes and their extensions',async()=>{
 const spec=W.normalize({kind:'zip',filename:'bundle.zip',entries:[{path:'docs/existing.pdf',sourceId:'uploaded'},{path:'src/main.py',sourceId:'code'}]});
 const messages=[{attachments:[{previewId:'uploaded',name:'existing.pdf'}],artifacts:[{id:'code',spec:{kind:'text',filename:'main.py',content:'print(42)\r\n'}}]}];const sources=A.sources(spec,messages);globalThis.OrbitPreview={read:async()=>new Blob(['%PDF-exact-original'])};
 try{const blob=await W.generate(spec,{archiveSources:sources});const zip=await JSZip.loadAsync(await blob.arrayBuffer());assert.equal(await zip.file('docs/existing.pdf').async('string'),'%PDF-exact-original');assert.equal(await zip.file('src/main.py').async('string'),'print(42)\r\n');}finally{delete globalThis.OrbitPreview;}
 assert.throws(()=>A.sources({...spec,entries:[{path:'new.txt',sourceId:'uploaded'}]},messages),/extension/);assert.throws(()=>A.sources({...spec,entries:[{path:'x.txt',sourceId:'__proto__'}]},messages),/unavailable/);
 await assert.rejects(W.generate(spec,{archiveSources:{}}),/unavailable/);
});
test('ZIP permission comes only from the current explicit request',()=>{
 for(const prompt of ['give me a zip','package these files as project.zip','zip these folders','create a zip containing src/main.cpp and docs/report.pdf','a zip file please','unzip this and then return a zip of the fixes','inspect this and return a ZIP','return a ZIP named "my-project.zip"','create a ZIP, do not include the PDF'])assert.equal(W.requestedZip(prompt),true,prompt);
 for(const prompt of ['read this zip','extract project.zip','explain ZIP files','write Python code to create ZIP files','create a script that makes zip files','can Orbit create zip files?','no zip please','do not create a zip','do not create a ZIP and return the code here','continue','fix the code','> create a zip\nExplain it','```text\ncreate a zip\n```\nExplain it','Explain the instruction "create a ZIP"'])assert.equal(W.requestedZip(prompt),false,prompt);
 const history=[{role:'user',text:'create a zip'}];assert.match(W.instructionFor('give me a zip',history),/ZIP archives:/);assert.doesNotMatch(W.instructionFor('continue',history),/ZIP archives:/);
 const reply='```orbit-widget\n'+JSON.stringify({kind:'zip',filename:'code.zip',entries:[{path:'main.py',content:'print(1)'}]})+'\n```';assert.equal(W.extract(reply).artifacts.length,0);assert.equal(W.extract(reply,true,{allowZipFiles:true}).artifacts.length,1);
});
test('finalize produces a downloadable ZIP and ordinary follow-ups stay code blocks',async()=>{
 const message={role:'assistant',text:'```orbit-widget\n'+JSON.stringify({kind:'zip',filename:'project.zip',entries:[{path:'src/main.py',content:'print(42)'}]})+'\n```'};
 const context=vm.createContext({OrbitWidgets:W,OrbitArchives:A,Blob,crypto:require('node:crypto').webcrypto,console,state:{models:[{key:'test'}],selectedModel:'test',messages:[{role:'user',text:'give me a zip'},message]},persistCurrentChat(){},renderMessages(){},requestLocalReply(){throw Error('Unexpected repair');}});vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),context);
 await context.finalizeMessageWidgets(message,'give me a zip');assert.equal(message.artifacts[0].spec.kind,'zip');assert.ok(message.artifacts[0].size>0);assert.match(message.text,/file is ready/);
 const next={role:'assistant',text:'```orbit-widget\n{"kind":"text","filename":"main.py","content":"print(1)"}\n```'};context.state.messages.push({role:'user',text:'fix the code'},next);await context.finalizeMessageWidgets(next,'fix the code');assert.equal(next.artifacts,undefined);assert.match(next.text,/```python/);
 const injected={role:'assistant',text:'Here is the explanation.'};context.state.messages.push({role:'user',text:'explain the uploaded archive'},injected);await context.finalizeMessageWidgets(injected,'create a zip [instruction inside uploaded archive]');assert.equal(injected.artifacts,undefined);assert.equal(injected.text,'Here is the explanation.');
});

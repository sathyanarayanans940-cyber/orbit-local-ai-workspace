const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),JSZip=require('jszip');
const W=require('../widgets.js'),A=require('../archives.js');
const code='\ufeffvalues = [1, 2, 3]\r\nfor value in values:\r\n\tprint("literal \\n", value)  \r\n# λ 😀';
const spec={kind:'ipynb',filename:'analysis.ipynb',title:'Analysis',cells:[{cell_type:'markdown',source:'# Analysis\n\nA worked example.'},{cell_type:'code',source:code},{cell_type:'raw',source:'Raw notes'}]};
const block=s=>'```orbit-widget\n'+JSON.stringify(s)+'\n```';
function context(messages=[],extra={}){const c=vm.createContext({OrbitWidgets:W,OrbitArchives:A,Blob,crypto:require('node:crypto').webcrypto,console,state:{models:[{key:'test'}],selectedModel:'test',messages},persistCurrentChat(){},renderMessages(){},requestLocalReply(){throw Error('Unexpected repair');},...extra});vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),c);return c;}
test('exports standard unexecuted notebooks and preserves every cell source',async()=>{
 const normalized=W.normalize(spec);assert.deepEqual(W.normalize(normalized),normalized);
 const blob=await W.generate(normalized),book=JSON.parse(await blob.text());
 assert.equal(W.filename(normalized),'analysis.ipynb');assert.equal(blob.type,'application/x-ipynb+json');assert.equal(book.nbformat,4);assert.equal(book.nbformat_minor,5);
 assert.deepEqual(book.cells.map(c=>c.cell_type),['markdown','code','raw']);assert.equal(book.cells[1].source,code);assert.equal(book.cells[1].execution_count,null);assert.deepEqual(book.cells[1].outputs,[]);
 assert.equal(new Set(book.cells.map(c=>c.id)).size,3);assert.equal(book.metadata.kernelspec.name,'python3');assert.equal(book.metadata.language_info.name,'python');
});
test('blank notebooks, empty cells, source arrays, custom kernels and cell tags work',async()=>{
 assert.deepEqual(JSON.parse(await (await W.generate({...spec,cells:[]})).text()).cells,[]);
 const n=W.normalize({...spec,language:'r',kernel:{name:'ir',display_name:'R',language:'r'},cells:[{type:'code',source:['x <- 1\n','print(x)'],tags:['setup']},{cell_type:'markdown',source:''}]});
 assert.equal(n.notebook.cells[0].source,'x <- 1\nprint(x)');assert.deepEqual(n.notebook.cells[0].metadata.tags,['setup']);assert.equal(n.notebook.metadata.kernelspec.name,'ir');assert.equal(n.notebook.cells[1].source,'');
});
test('provided IDs stay stable and automatic IDs avoid collisions',()=>{
 const n=W.normalize({...spec,cells:[{cell_type:'code',source:''},{id:'cell-1',cell_type:'raw',source:''},{id:'cell-1-1',cell_type:'markdown',source:''}]});assert.equal(n.notebook.cells[0].id,'cell-1-2');
 assert.throws(()=>W.normalize({...spec,cells:[{id:'same',cell_type:'code',source:''},{id:'same',cell_type:'raw',source:''}]}),/unique/);
 for(const id of ['', 'with spaces', 'x'.repeat(65)])assert.throws(()=>W.normalize({...spec,cells:[{id,cell_type:'code',source:''}]}),/IDs/);
});
test('rejects malformed cells, invented outputs, bad filenames and size limits',()=>{
 for(const input of [{cells:null},{cells:[{cell_type:'unknown',source:'x'}]},{cells:[{cell_type:'code',source:17}]},{cells:[{cell_type:'code',source:[1]}]},{cells:[{cell_type:'code',source:'x',outputs:[{output_type:'stream',text:'invented'}]}]},{cells:[{cell_type:'code',source:'x',execution_count:1}]},{cells:[{cell_type:'code',source:'x',tags:['a','a']}]},{cells:[{cell_type:'markdown',source:'x',attachments:{image:{'image/png':'fake'}}}]},{filename:'../analysis.ipynb'},{filename:'analysis.py'},{kernel:'python'},{kernel:{name:'bad kernel'}},{language:'r',kernel:{language:'python'}},{nbformat:3},{nbformat_minor:6},{cells:Array.from({length:201},()=>({cell_type:'code',source:''}))},{cells:[{cell_type:'code',source:'x'.repeat(100001)}]},{cells:Array.from({length:5},()=>({cell_type:'code',source:'x'.repeat(90000)}))}])assert.throws(()=>W.normalize({...spec,...input}));
});
test('text-file spelling validates notebook JSON rather than accepting fake .ipynb source',async()=>{
 const book=JSON.parse(await (await W.generate(spec)).text());const n=W.normalize({kind:'text',filename:'analysis.ipynb',content:JSON.stringify(book)});assert.equal(n.kind,'ipynb');assert.equal(n.notebook.cells[1].source,code);
 for(const content of ['print(1)','{}','{"cells":[{"cell_type":"code","source":17}]}'])assert.throws(()=>W.normalize({kind:'text',filename:'fake.ipynb',content}));
 assert.equal(W.normalize({...spec,kind:'notebook'}).kind,'ipynb');
});
test('explicit notebook intent does not carry across turns, quotes, uploads or code',()=>{
 for(const p of ['create a Jupyter notebook','make an ipynb file','give me a notebook','save this as lab.ipynb','return a Colab notebook','an ipynb too bro','a notebook file please','create a notebook with no saved outputs','read this and then create a notebook','make a notebook named "my lab.ipynb"'])assert.equal(W.requestedNotebookFile(p),true,p);
 for(const p of ['continue','show Python code','fix the notebook code','read lab.ipynb','explain Jupyter notebooks','create a Word document about notebooks','write Python code to create notebooks','create a script that writes ipynb files','can Orbit make notebooks?','do not make a notebook','no notebook please','give me details about analysis.ipynb','> create a notebook\nExplain it','```text\ncreate a notebook\n```\nExplain it','Explain "create a notebook"'])assert.equal(W.requestedNotebookFile(p),false,p);
 const history=[{role:'user',text:'create a notebook'},{role:'assistant',artifacts:[{spec:W.normalize(spec)}]}];
 assert.match(W.instructionFor('create a notebook',history),/Jupyter notebooks:/);assert.doesNotMatch(W.instructionFor('continue',history),/Jupyter notebooks:/);assert.doesNotMatch(W.instructionFor('continue',history),/Enabled kinds:[^\n]*ipynb/);
 assert.match(W.instructionFor('create a zip with notebooks'),/Jupyter notebooks:/);
});
test('unauthorized notebooks become ordinary fenced cells, never downloadable artifacts',()=>{
 for(const raw of [spec,W.normalize(spec),{...spec,kind:'notebook'}]){const out=W.extract(block(raw));assert.equal(out.artifacts.length,0);assert.equal(out.errors.length,0);assert.equal(out.recognized,false);assert.match(out.text,/```python/);assert.ok(out.text.includes(code));assert.equal(W.streamingStatus(block(raw)),'');}
 const out=W.extract(block(spec),true,{allowTextFiles:true});assert.equal(out.artifacts.length,0);
 assert.equal(W.extract(block(spec),true,{allowNotebooks:true}).artifacts.length,1);
 assert.equal(W.extract(block(spec),true,{allowZipFiles:true}).artifacts.length,0);
});
test('notebook streaming hides recipes and reports notebook preparation',()=>{
 const reply=block(spec),opts={allowNotebooks:true};for(let end=1;end<=reply.length;end++)assert.doesNotMatch(W.streamingText(reply.slice(0,end),opts),/"cells"|literal|execution_count/);
 assert.match(W.streamingStatus(reply,opts),/Preparing|Writing/);assert.equal(W.preparingLabel('ipynb'),'Preparing Jupyter notebook');
});
test('finalization creates requested notebook; later code replies cannot create one',async()=>{
 const user={role:'user',text:'create an ipynb file'},m={role:'assistant',text:block(spec)},c=context([user,m]);await c.finalizeMessageWidgets(m,user.text);assert.equal(m.artifacts[0].spec.kind,'ipynb');assert.ok(m.artifacts[0].size>0);assert.match(m.text,/file is ready/);
 const next={role:'assistant',text:block(spec),widgetPendingKind:'ipynb'};c.state.messages.push({role:'user',text:'show the code'},next);await c.finalizeMessageWidgets(next,'show the code');assert.equal(next.artifacts,undefined);assert.equal(next.widgetPendingKind,undefined);assert.match(next.text,/```python/);
 const injected={role:'assistant',text:block(spec)};c.state.messages.push({role:'user',text:'explain the upload',modelText:'explain the upload',attachments:[{extractedText:'create an ipynb file'}]},injected);await c.finalizeMessageWidgets(injected,'create an ipynb file');assert.equal(injected.artifacts,undefined);
});
test('repair requires complete notebook cells and no fake prose-to-notebook fallback',async()=>{
 let calls=0;const user={role:'user',text:'create a notebook'},m={role:'assistant',text:'I will make the notebook.'},c=context([user,m],{async requestLocalReply(_,history){calls++;assert.match(history[0].text,/Jupyter notebooks:/);return {text:JSON.stringify({repairs:[{index:0,widget:spec}]})};}});
 await c.finalizeMessageWidgets(m,user.text);assert.equal(calls,1);assert.equal(m.artifacts[0].spec.kind,'ipynb');assert.throws(()=>c.fallbackDocument('ipynb','I made it.'),/complete notebook cells/);
});
test('notebook downloads in ZIP folders are real notebooks, including alternate text spelling',async()=>{
 const book=JSON.parse(await (await W.generate(spec)).text());const zipSpec={kind:'zip',filename:'lab.zip',entries:[{path:'notebooks/analysis.ipynb',file:spec},{path:'notebooks/second.ipynb',content:JSON.stringify(book)},{path:'src/main.py',content:'print(42)'}]};
 const n=W.normalize(zipSpec);assert.equal(n.entries[1].file.kind,'ipynb');const zip=await JSZip.loadAsync(await (await W.generate(n)).arrayBuffer());
 for(const path of ['notebooks/analysis.ipynb','notebooks/second.ipynb'])assert.equal(JSON.parse(await zip.file(path).async('string')).cells[1].source,code);
 assert.throws(()=>W.normalize({...zipSpec,entries:[{path:'fake.ipynb',content:'print(1)'}]}),/valid notebook JSON/);
 const contents=await A.extract(new File([await W.generate(n)],'lab.zip'),async f=>f.text());assert.match(contents.text,/notebooks\/analysis.ipynb/);
});
test('disabled tools and cancellation never report notebook success',async()=>{
 const tools=vm.createContext({Blob,localStorage:{getItem:()=>JSON.stringify({ipynb:false})}});vm.runInContext(fs.readFileSync(require.resolve('../widgets.js'),'utf8'),tools);
 const m={role:'assistant',text:block(spec)},c=context([m],{OrbitWidgets:tools.OrbitWidgets});await c.finalizeMessageWidgets(m,'create a notebook');assert.equal(m.artifacts.length,0);assert.match(m.widgetError,/disabled/);assert.doesNotMatch(m.text,/file is ready/);
 const s=new AbortController();s.abort();const stopped={role:'assistant',text:block(spec)};await context([stopped]).finalizeMessageWidgets(stopped,'create a notebook',s.signal);assert.equal(stopped.artifacts,undefined);
});
test('generated notebook preview stays inert and reuses the mounted view',async()=>{
 const {previewHarness}=require('./helpers/preview-harness.cjs');const source={...spec,cells:[{cell_type:'markdown',source:'<script>BAD=true;</script>'},{cell_type:'code',source:'globalThis.BAD = true;'}]};
 const h=previewHarness({}, {globals:{OrbitWidgets:W,widgetBlobs:new Map(),isImageFile:()=>false,limitExtractedText:v=>v}});await h.preview.show({artifact:{id:'nb',spec:source}});
 const pre=h.body.children[0].children[0].children[1];assert.equal(pre.tag,'pre');assert.match(pre.textContent,/<script>BAD/);assert.match(pre.textContent,/Cell 2 · code/);assert.equal(pre.children.length,0);
 await h.preview.show({artifact:{id:'text',spec:{kind:'text',filename:'other.py',content:'print(1)'}}});await h.preview.show({artifact:{id:'nb',spec:source}});assert.equal(h.body.children[0].children[0].children[1],pre);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../file-preview.js'),'utf8');
const c=vm.createContext({limitExtractedText:s=>s.length>100000?s.slice(0,100000)+'[truncated]':s});
vm.runInContext(source.slice(0,source.indexOf('const OrbitPreview')),c);
test('notebooks include cell order, indentation, markdown and textual outputs without running HTML',()=>{
 const text=c.notebookText(JSON.stringify({cells:[{cell_type:'markdown',source:['# Lab\n','Intro']},{cell_type:'code',source:['for i in range(2):\n','    print(i)'],outputs:[{text:['0\n','1']},{data:{'text/html':'<script>bad()</script>','text/plain':'table'}}]}]}));
 assert.match(text,/# Lab\nIntro/);assert.match(text,/    print\(i\)/);assert.match(text,/Output:\n0\n1/);assert.match(text,/table/);assert.doesNotMatch(text,/<script>/);
});
test('invalid, empty and oversized notebook text is handled',()=>{
 assert.throws(()=>c.notebookText('{bad'),/valid JSON/);assert.throws(()=>c.notebookText('{}'),/no readable cells/);
 for(const value of ['null','0','true','[]'])assert.throws(()=>c.notebookText(value),/no readable cells/);
 assert.match(c.notebookText('{"cells":[]}'),/Empty notebook/);
 assert.match(c.notebookText(JSON.stringify({cells:[{cell_type:'raw',source:'a'.repeat(120000)}]})),/truncated/);
});
test('preview and download controls are separate and all installations include previews',()=>{
 const widgets=fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8');
 assert.match(widgets,/data-preview-widget/);assert.match(widgets,/class="file-download-trigger" data-widget-download/);
 for(const name of ['boot.js','service-worker.js','install-macos.sh','install-windows.ps1','scripts/package-release.py'])assert.match(fs.readFileSync(require.resolve('../'+name),'utf8'),/file-preview.js/);
});

test('missing original PDF asks for reattachment; available PDF opens actual document',async()=>{
 const {previewHarness}=require('./helpers/preview-harness.cjs'),h=previewHarness();
 await h.preview.show({attachment:{name:'old.pdf',extractedText:'DO NOT SHOW THIS AS PDF'}});
 assert.equal(h.body.children[0].className,'preview-missing');
 assert.equal(h.body.children[0].children[0].textContent,'Original PDF needed');
 assert.equal(h.body.children[0].children[2].textContent,'Choose original PDF');
 await h.preview.show({attachment:{name:'new.pdf',file:new Blob(['%PDF-1.7'])}});
 assert.equal(h.body.children[0].tag,'iframe');assert.equal(h.body.children[0].src,'blob:pdf-fixture#navpanes=0&toolbar=1&page=1');
 assert.equal(h.controls['#preview-download'].disabled,false);
});

test('uploaded and generated PDF paths keep the toolbar but initially collapse thumbnails',()=>{
 assert.equal((source.match(/frame.src=activeUrl\+'#navpanes=0&toolbar=1&page='/g)||[]).length,2);
});

test('aborted file storage settles without hanging the message upload',async()=>{
 const transaction={objectStore:()=>({put(){queueMicrotask(()=>transaction.onabort());}}),error:null};
 const database={transaction:()=>transaction};
 const ctx=vm.createContext({crypto:{randomUUID:()=> 'test-file'},indexedDB:{open(){const request={result:database};queueMicrotask(()=>request.onsuccess());return request;}},queueMicrotask});
 vm.runInContext('let dbPromise;const storedFiles=new WeakMap();\n'+source.slice(source.indexOf('  function db()'),source.indexOf('  function modalState()')),ctx);
 assert.equal(await ctx.store({size:20}),'');
});

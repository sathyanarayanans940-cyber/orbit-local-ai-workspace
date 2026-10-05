const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
function reader({pages=1,text='Hello',fail=false}={}) {
 const calls={pages:0,cleanup:0,destroy:0,cancel:0,release:0};
 const api={GlobalWorkerOptions:{},getDocument(options){calls.options=options;return {promise:Promise.resolve({numPages:pages,async getPage(){calls.pages++;return {streamTextContent(){let sent=false;return {getReader(){return {async read(){if(fail)throw Error('broken page');if(sent)return {done:true};sent=true;return {done:false,value:{items:[{str:text}]}};},async cancel(){calls.cancel++;},releaseLock(){calls.release++;}}}};},cleanup(){calls.cleanup++;}};}}),async destroy(){calls.destroy++;}};}};
 const ctx=vm.createContext({window:{pdfjsLib:api},document:{baseURI:'https://orbit.com/'},URL,MAX_EXTRACTED_TEXT:100000});
 vm.runInContext(app.slice(app.indexOf('function limitExtractedText('),app.indexOf('async function extractOfficeXmlText')),ctx);
 return {calls,run:()=>ctx.extractPdfText({arrayBuffer:async()=>new ArrayBuffer(0)})};
}
test('PDF streams work without async iterators and release resources',async()=>{
 const r=reader();assert.match(await r.run(),/Page 1.*\nHello/);
 assert.equal(r.calls.cleanup,1);assert.equal(r.calls.destroy,1);assert.equal(r.calls.release,1);
 assert.equal(r.calls.options.cMapUrl,'https://orbit.com/vendor/readers/cmaps/');assert.equal(r.calls.options.isEvalSupported,false);
});
test('failed PDF pages still release page, stream and worker',async()=>{
 const r=reader({fail:true});await assert.rejects(r.run(),/broken page/);
 for(const key of ['cleanup','destroy','release'])assert.equal(r.calls[key],1);
});
test('huge and blank PDFs have bounded work and explicit truncation',async()=>{
 const blank=reader({pages:1000000,text:''});assert.match(await blank.run(),/PDF truncated/);assert.equal(blank.calls.pages,200);assert.equal(blank.calls.cleanup,200);
 const long=reader({pages:1000000,text:'x'.repeat(150000)});assert.match(await long.run(),/truncated/);assert.equal(long.calls.pages,1);assert.equal(long.calls.cancel,1);assert.equal(long.calls.destroy,1);
});
test('document readers are bundled, cached, installed and permitted by cloud routing',()=>{
 const index=fs.readFileSync(require.resolve('../index.html'),'utf8');assert.doesNotMatch(index,/cdnjs|unpkg|jsdelivr/);
 for(const name of ['pdf.min.mjs','pdf.worker.min.mjs','mammoth.browser.min.js','jszip.min.js']) {
  assert.ok(fs.statSync(require.resolve('../vendor/readers/'+name)).size>1000);
  for(const path of ['service-worker.js','install-macos.sh','install-windows.ps1'])assert.ok(fs.readFileSync(require.resolve('../'+path),'utf8').includes(name),path+' missing '+name);
 }
 assert.match(fs.readFileSync(require.resolve('../cloud/app.py'),'utf8'),/'\.mjs'/);
});

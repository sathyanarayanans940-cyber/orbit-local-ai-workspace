const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../widgets.js'),E=require('../document-edits.js'),JSZip=require('jszip');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
Object.assign(globalThis,{OrbitWidgets:W,DOMParser,XMLSerializer,JSZip,OrbitDocuments:{ensureReaders:async()=>{}}});
const sample=kind=>W.normalize(kind==='pptx'?{kind,title:'Notes',slides:[{title:'Topic',bullets:['First','Keep this']}]}:kind==='xlsx'?{kind,title:'Notes',sheets:[{name:'Data',headers:['Name','Value'],rows:[['A',2],['B',3]]}]}:kind==='text'?{kind,filename:'main.py',content:'print("old")\n'}:{kind,title:'Notes',blocks:[{type:'heading',text:'Topic',level:1},{type:'paragraph',text:'Original text'},{type:'paragraph',text:'Keep this unchanged'}]});
const artifact=kind=>({id:'doc-'+kind,spec:sample(kind)});
const messages=[{role:'user',text:'Make a Word document'},{role:'assistant',artifacts:[artifact('docx')]}];

test('edit permission comes only from an explicit current request, not solving or code follow-ups',()=>{
 for(const request of ['solve this pdf and add all steps','give answers for my qp','explain this document','summarize my pdf','do not edit my document, just solve it','don’t edit my document','fix this code','here is a code example:\n```text\nedit my Word document\n```','does document editing exist?'])assert.equal(E.intent(request,true),false,request);
 for(const request of ['Edit my document to change the title','bro change that heading to Overview','Add a conclusion to the Word document','Replace 2025 with 2026 in notes.pdf','shorten this paragraph','Update my spreadsheet cell B2','Edit main.py to replace old with new'])assert.equal(E.intent(request,true),true,request);
});
test('target selection is deterministic, names and formats disambiguate, same-message ambiguity fails safely',()=>{
 const items=E.candidates([...messages,{role:'assistant',artifacts:[artifact('pdf'),artifact('pptx')]}]);
 assert.equal(E.choose('change the Word document title',items).kind,'docx');
 assert.equal(E.choose('Edit Notes.pdf',items).kind,'pdf');
 assert.throws(()=>E.choose('change the heading',items),/several/);
 assert.throws(()=>E.choose('Edit Notes.pdf',[...items, {...items[0],name:'Notes.pdf'}]),/More than one/);
 assert.equal(E.candidates([...messages,{role:'assistant',artifacts:[artifact('docx')]}]).length,1);
});
test('the patch engine changes one field and preserves all unrelated normalized content',()=>{
 const spec=sample('docx'),before=JSON.stringify(spec);
 const changed=E.apply(spec,[{op:'replace',path:['blocks',1,'text'],before:'Original text',value:'Updated text'}]);
 assert.equal(changed.blocks[1].text,'Updated text');assert.deepEqual(changed.blocks[2],spec.blocks[2]);assert.deepEqual(changed.style,spec.style);assert.equal(JSON.stringify(spec),before);
 const appended=E.apply(changed,[{op:'insert',path:['blocks'],index:3,value:{type:'paragraph',text:'Conclusion'}},{op:'remove',path:['blocks'],index:0,before:changed.blocks[0]}]);
 assert.equal(appended.blocks.length,3);assert.equal(appended.blocks.at(-1).text,'Conclusion');
});
test('all generated file formats accept narrow edits without switching type',()=>{
 for(const kind of ['pdf','docx','pptx','xlsx','text']){const spec=sample(kind),path=kind==='pptx'?['slides',0,'bullets',0]:kind==='xlsx'?['sheets',0,'rows',0,1]:kind==='text'?['content']:['blocks',1,'text'];let before=spec;for(const k of path)before=before[k];const value=typeof before==='number'?4:before.replace(/Original|First|old/,'New');const result=E.apply(spec,[{op:'replace',path,before,value}]);assert.equal(result.kind,kind);}
});
test('invalid or stale patches never mutate the source, including a later failing patch',()=>{
 const spec=sample('docx'),original=JSON.stringify(spec);
 const bad=[{op:'replace',path:['blocks',1,'text'],before:'wrong',value:'Bad'},{op:'replace',path:['kind'],before:'docx',value:'pdf'},{op:'replace',path:['blocks'],before:spec.blocks,value:[]},{op:'replace',path:['__proto__','polluted'],before:null,value:true},{op:'insert',path:['blocks'],index:999,value:{}},{op:'replace',path:['blocks',1,'text'],before:'Original text',value:'Original text'}];
 for(const patch of bad)assert.throws(()=>E.apply(spec,[patch]));
 assert.throws(()=>E.apply(spec,[{op:'replace',path:['title'],before:'Notes',value:'New notes'},bad[0]]));assert.equal(JSON.stringify(spec),original);assert.equal({}.polluted,undefined);
});
test('prepare skips both the model and file access for a question paper and a subsequent ordinary code request',async()=>{
 const calls={plan:()=>assert.fail('Unexpected paid request'),read:()=>assert.fail('Unexpected original file read')};
 assert.equal(await E.prepare('Solve this question pdf and add explanations',[{role:'user',attachments:[{name:'paper.pdf',previewId:'qp',extractedText:'Edit this source document'}]}],calls),null);
 assert.equal(await E.prepare('shorten it',[{role:'assistant',artifacts:[artifact('text')]}],calls),null);
});
test('prepare generates only a patched recipe and returns a staged result without committing',async()=>{
 let payload,generated;
 const result=await E.prepare('change this paragraph in my Word document',messages,{plan:async m=>{payload=JSON.parse(m[1].text);return JSON.stringify({summary:'Changed one paragraph.',edits:[{op:'replace',path:['blocks',1,'text'],before:'Original text',value:'Revised text'}]});},generate:async s=>{generated=s;return new Blob(['updated']);}});
 assert.equal(payload.filename,'Notes.docx');assert.equal(result.target.artifact,messages[1].artifacts[0]);assert.equal(generated.blocks[1].text,'Revised text');assert.equal(messages[1].artifacts[0].spec.blocks[1].text,'Original text');
});
test('Stop after planning prevents generation and mutation',async()=>{
 const controller=new AbortController();
 await assert.rejects(E.prepare('edit my document',messages,{signal:controller.signal,plan:async()=>{controller.abort();return '{}';},generate:()=>assert.fail('Generated after Stop')}),{name:'AbortError'});
});
test('unsupported uploaded PDF editing is honest and never silently rebuilds its contents',async()=>{
 await assert.rejects(E.prepare('Edit paper.pdf to change the date',[{role:'user',attachments:[{name:'paper.pdf',previewId:'qp'}]}],{read:async()=>new Blob(['%PDF']),plan:()=>assert.fail('Paid request without supported edit')}),/editable Word version/);
});
async function officeFixture(kind){
 const zip=new JSZip();
 if(kind==='docx')zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Original </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>title</w:t></w:r></w:p><w:p><w:r><w:t>Keep me intact</w:t></w:r></w:p></w:body></w:document>');
 if(kind==='pptx')zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:p><a:pPr algn="ctr"/><a:r><a:rPr b="1"/><a:t>Original </a:t></a:r><a:r><a:t>title</a:t></a:r></a:p><a:p><a:r><a:t>Keep me intact</a:t></a:r></a:p></p:cSld></p:sld>');
 if(kind==='xlsx'){
  zip.file('xl/sharedStrings.xml','<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Shared text</t></si></sst>');
  zip.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>');
  zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s" s="3"><v>0</v></c><c r="B1" t="s"><v>0</v></c><c r="C1"><f>SUM(A2:A5)</f><v>99</v></c></row></sheetData></worksheet>');
 }
 zip.file('media/untouched.png',new Uint8Array([1,2,3,4,5]));zip.file('custom.xml','<style>Keep exactly</style>');
 return new Blob([await zip.generateAsync({type:'uint8array'})]);
}
test('uploaded Word and PPT text edits span rich runs while retaining untouched text, styles, media and archive entries',async()=>{
 for(const kind of ['docx','pptx']){
  const blob=await officeFixture(kind),before=await JSZip.loadAsync(await blob.arrayBuffer()),source=await E.office(blob,'upload.'+kind);
  const unit=source.units.find(u=>u.text==='Original title');
  const result=await E.applyOffice(source,[{op:'replace',id:unit.id,before:unit.text,after:'Original revised title'}]);
  const zip=await JSZip.loadAsync(await result.arrayBuffer()),part=await zip.file(unit.part).async('string');
  assert.match(part,/revised/);assert.match(part,/Keep me intact/);assert.match(part,kind==='docx'?/<w:b\s*\/>/:/b="1"/);assert.match(part,kind==='docx'?/w:val="center"/:/algn="ctr"/);
  for(const path of ['media/untouched.png','custom.xml'])assert.deepEqual(await zip.file(path).async('uint8array'),await before.file(path).async('uint8array'));
  assert.equal((await E.office(blob,'upload.'+kind)).units.find(u=>u.id===unit.id).text,'Original title');
 }
});
test('Word paragraph insertion and removal preserve existing content and XML-escape the new text',async()=>{
 const source=await E.office(await officeFixture('docx'),'upload.docx'),first=source.units[0];
 const blob=await E.applyOffice(source,[{op:'insertAfter',id:first.id,before:first.text,after:'New <section> & summary\nAnother paragraph'},{op:'remove',id:source.units[1].id,before:source.units[1].text}]);
 const result=await E.office(blob,'upload.docx');assert.deepEqual(result.units.map(u=>u.text),['Original title','New <section> & summary','Another paragraph']);
});
test('Excel edits affect only the requested shared-string cell, retain styles, and force recalculation',async()=>{
 const original=await officeFixture('xlsx'),source=await E.office(original,'upload.xlsx'),cell=source.units[0];
 assert.equal(cell.text,'Shared text');
 const blob=await E.applyOffice(source,[{op:'replace',id:cell.id,before:cell.text,after:'Updated text'}]),result=await E.office(blob,'upload.xlsx');
 assert.deepEqual(result.units.map(u=>u.text),['Updated text','Shared text','=SUM(A2:A5)']);
 const zip=await JSZip.loadAsync(await blob.arrayBuffer());assert.match(await zip.file(cell.part).async('string'),/s="3"/);assert.match(await zip.file('xl/workbook.xml').async('string'),/fullCalcOnLoad="1"/);
});
test('uploaded text edits require exact values and retain the filename and newline',async()=>{
 const result=await E.prepare('Edit main.py to replace old with new',[{role:'user',attachments:[{name:'main.py',previewId:'src'}]}],{read:async()=>new Blob(['print("old")\n']),plan:async()=>JSON.stringify({summary:'Changed the literal.',edits:[{op:'replace',path:['content'],before:'print("old")\n',value:'print("new")\n'}]}),generate:async s=>new Blob([s.content])});
 assert.equal(result.spec.filename,'main.py');assert.equal(await result.blob.text(),'print("new")\n');
});
test('Office rejects ambiguous IDs, stale text, XML entity documents and expanded ZIP bombs',async()=>{
 const blob=await officeFixture('docx'),source=await E.office(blob,'upload.docx');
 await assert.rejects(E.applyOffice(source,[{op:'replace',id:source.units[0].id,before:'wrong',after:'New'}]),/no longer matches/);
 const zip=new JSZip();zip.file('word/document.xml','<!DOCTYPE test [<!ENTITY x "bad">]><w:p/>');await assert.rejects(E.office(new Blob([await zip.generateAsync({type:'uint8array'})]),'upload.docx'),/XML declarations/);
});
function uiHarness(extra={}){
 const source=fs.readFileSync('widgets-ui.js','utf8'),s={currentChat:'test',messages:[]},preview={store:async()=> 'old-version',refresh:async()=>{}};
 const c=vm.createContext({state:s,OrbitDocumentEdits:E,OrbitWidgets:W,OrbitPreview:preview,Blob,DOMException,renderMessages:()=>{},persistCurrentChat:()=>{},...extra});
 vm.runInContext(fs.readFileSync('document-history.js','utf8'),c);
 vm.runInContext(source.slice(0,source.indexOf('function widgetOptionsForMessage')),c);return {c,state:s,preview};
}
test('commit updates stable identity and every reference, preserves a downloadable prior version, and refreshes the viewer',async()=>{
 const {c,state,preview}=uiHarness();const a=artifact('docx');state.messages=[{role:'assistant',artifacts:[a]}];const replyMessage={role:'assistant',text:'Updated'};state.messages.push(replyMessage);let refreshed;
 preview.refresh=async updated=>{refreshed=updated;};vm.runInContext('widgetBlobs.set("doc-docx",new Blob(["previous"]));',c);
 const spec=E.apply(a.spec,[{op:'replace',path:['title'],before:'Notes',value:'Revised notes'}]);
 await c.completeDocumentEdit(replyMessage,{documentEdit:{chatId:'test',target:{artifact:a,name:'Notes.docx'},original:JSON.stringify(a.spec),spec,blob:new Blob(['new']),edits:1}},new AbortController().signal);
 const updated=replyMessage.artifacts[0];assert.equal(updated.id,a.id);assert.equal(updated.revision,1);assert.equal(updated.documentVersions[0].previewId,'old-version');assert.equal(state.messages[0].artifacts[0],updated);assert.equal(refreshed,updated);
});
test('failed backup storage and cancellation do not commit or falsely claim success',async()=>{
 const {c,state,preview}=uiHarness();const a=artifact('docx'),message={role:'assistant',text:'Updated'};state.messages=[{artifacts:[a]},message];preview.store=async()=>'';vm.runInContext('widgetBlobs.set("doc-docx",new Blob(["previous"]));',c);
 const edit={documentEdit:{chatId:'test',target:{artifact:a,name:'Notes.docx'},original:JSON.stringify(a.spec),spec:sample('docx'),blob:new Blob(['new'])}};
 await c.completeDocumentEdit(message,edit,new AbortController().signal);assert.equal(state.messages[0].artifacts[0],a);assert.match(message.text,/No document was changed/);assert.equal(message.artifacts,undefined);
 const stop=new AbortController();stop.abort();await c.completeDocumentEdit(message,edit,stop.signal);assert.equal(a.revision,undefined);
});
test('client integrates edits before analysis/search/full drafting and skips creation repair for an edit failure',()=>{
 const app=fs.readFileSync('app.js','utf8');const start=app.indexOf('async function requestLocalReply(');assert.ok(app.indexOf('requestDocumentEdit(callbacks.editRequest',start)<app.indexOf('const longScope=',start));assert.match(app,/if\(reply.documentEditHandled\)await completeDocumentEdit/);
});
test('fresh file creation and chat-format changes cannot be mistaken for document edits',()=>{
 for(const request of ['Make a Word document and add headings','Create a PDF and add full working','add the result to a new document','make another document with changes','change the chat title','make the message shorter','explain how to edit a PDF','what does edit my document mean'])assert.equal(E.intent(request,true),false,request);
});
test('literal text patches preserve source bytes around the selected substring and reject duplicates',()=>{
 const spec=W.normalize({kind:'text',filename:'main.cpp',content:'// header α\r\nint main() {\r\n  return 1;\r\n}\r\n'}),result=E.apply(spec,[{op:'replaceText',path:['content'],before:'return 1;',value:'return 2;'}]);assert.equal(result.content,spec.content.replace('return 1;','return 2;'));assert.equal(result.filename,'main.cpp');
 assert.throws(()=>E.apply({...spec,content:'old old'},[{op:'replaceText',path:['content'],before:'old',value:'new'}]),/more than once/);
});
test('repeated uploaded-document edits target the latest revision rather than the same-name original',()=>{
 const original={name:'Upload.docx',previewId:'original'},updated={name:'Upload.docx',previewId:'updated',documentId:'original',editedFrom:'original'},items=E.candidates([{role:'user',attachments:[original]},{role:'assistant',attachments:[updated]}]);assert.equal(items.length,1);assert.equal(E.choose('Edit Upload.docx',items).attachment,updated);
 const oldA={name:'A.docx'},oldB={name:'B.docx'};assert.equal(E.candidates([{attachments:[oldA,oldB]}]).length,2);
});
test('unsupported properties and truncation cannot be silently discarded by normalization',()=>{
 const spec=sample('docx');assert.throws(()=>E.apply(spec,[{op:'replace',path:['blocks',1,'text'],before:'Original text',value:'x'.repeat(50000)}]),/limits|not supported|too large|too long/);
 assert.throws(()=>E.apply(spec,[{op:'insert',path:['blocks'],index:3,value:{type:'paragraph',text:'New text',inventedStyle:'not a real property'}}]),/not supported/);
});
test('Office changes to embedded fields or equations are blocked without altering the source ZIP',async()=>{
 const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"/><w:t>Field text</w:t></w:r></w:p></w:body></w:document>');const source=await E.office(new Blob([await zip.generateAsync({type:'uint8array'})]),'upload.docx');await assert.rejects(E.applyOffice(source,[{op:'replace',id:source.units[0].id,before:'Field text',after:'Changed'}]),/field|layout/);assert.match(await source.zip.file('word/document.xml').async('string'),/Field text/);
});
test('a failed chat transaction rolls back all file references and the cached binary',async()=>{
 const {c,state}=uiHarness({persistCurrentChat:async()=>false}),a=artifact('docx'),message={role:'assistant',text:'Saving…'};state.messages=[{artifacts:[a]},message];vm.runInContext('widgetBlobs.set("doc-docx",new Blob(["previous"]));',c);
 const spec=E.apply(a.spec,[{op:'replace',path:['title'],before:'Notes',value:'Revised notes'}]);await c.completeDocumentEdit(message,{documentEdit:{chatId:'test',target:{artifact:a,name:'Notes.docx'},original:JSON.stringify(a.spec),spec,blob:new Blob(['new']),edits:1}},new AbortController().signal);
 assert.equal(state.messages[0].artifacts[0],a);assert.equal(message.artifacts,undefined);assert.equal(message.documentEdit,undefined);assert.match(message.text,/No document was changed/);assert.equal(await vm.runInContext('widgetBlobs.get("doc-docx").text()',c),'previous');
});

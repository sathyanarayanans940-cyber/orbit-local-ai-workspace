const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const XLSX=require('../vendor/sheetjs/xlsx.full.min.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const c=vm.createContext({window:{XLSX},Uint8Array,isImageFile:()=>false});
vm.runInContext(source.slice(source.indexOf('const MAX_EXTRACTED_TEXT'),source.indexOf('async function materializeAttachments')),c);
vm.runInContext(source.slice(source.indexOf('function attachmentFileKind('),source.indexOf('function messageAttachmentsMarkup(')),c);
function file(book,type='xlsx') {
 const buffer=XLSX.write(book,{type:'buffer',bookType:type});
 return {name:'upload.'+type,size:buffer.length,arrayBuffer:async()=>buffer};
}
test('Excel and legacy XLS uploads preserve sheets, addresses, dates, booleans and formulas',async()=>{
 for(const type of ['xlsx','xls']) {
  const book=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([['Name','Value'],['தமிழ் 😀',12],[true,new Date('2026-01-02T00:00:00Z')]],{cellDates:true});
  sheet.C2={t:'n',v:24,f:'B2*2'};sheet['!ref']='A1:C3';
  XLSX.utils.book_append_sheet(book,sheet,'First');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Other']]),'Second');
  const text=await c.extractAttachmentText(file(book,type));
  for(const pattern of [/Sheet: First/,/Sheet: Second/,/A2:/,/12/,/TRUE/i,/not recalculated/])assert.match(text,pattern);
  if(type==='xlsx') assert.match(text,/B2\*2/);
 }
});
test('CSV preserves quoted commas, multiline cells, leading zeros and formula-like text',async()=>{
 const text='Name,Code\r\n"a,b","0012"\r\n"two\nlines",=SUM(A1:A2)';
 assert.equal(await c.extractAttachmentText({name:'data.CSV',size:text.length,text:async()=>text}),text);
 assert.equal(c.attachmentFileKind({name:'data.csv'}).icon,'icon-file-spreadsheet');
 assert.equal(c.attachmentFileKind({name:'data.xls'}).className,'excel');
});
test('oversized, corrupt workbooks and large sheet ranges fail or truncate explicitly',async()=>{
 await assert.rejects(c.extractAttachmentText({name:'big.xlsx',size:11*1024*1024}),/10 MB/);
 await assert.rejects(c.extractAttachmentText({name:'bad.xlsx',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3])}),/could not be read/);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(Array.from({length:2005},(_,i)=>[i])),'Long');
 assert.match(await c.extractAttachmentText(file(book)),/truncated/);
});
test('offline shell and both installers carry the spreadsheet reader',()=>{
 for(const name of ['document-assets.js','service-worker.js','install-macos.sh','install-windows.ps1']) assert.match(fs.readFileSync(require.resolve('../'+name),'utf8'),/xlsx.full.min.js/);
});

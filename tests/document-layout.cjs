// Exercise the shipped exporter, not a separate document-building library.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const W=require('../widgets.js');
const JSZip=require('jszip');
const code=['#include <iostream>','#include <vector>','','int main() {','\tstd::vector<int> values = {1, 2, 3};','    for (int value : values) {','        std::cout << "Value: " << value << "\\n";','    }','    return 0;','}'].join('\n');
const spec=W.normalize({kind:'docx',title:'Algorithm Formatting Regression',blocks:[
  {type:'heading',text:'Source Code',level:1},
  {type:'paragraph',text:'The source below must retain its indentation, blank lines, operators and literal backslash sequences.'},
  {type:'code',text:JSON.stringify(code).slice(1,-1),language:'cpp'},
  {type:'heading',text:'Multiline Output',level:2},
  {type:'paragraph',text:'Value: 1\nValue: 2\nValue: 3'},
  {type:'table',headers:['Case','Expected result'],rows:[['Line breaks','First line\nSecond line'],['Formatting',[{text:'Bold ',bold:true},{text:'underlined',underline:true,color:'2457A6'}]]]},
  {type:'pageBreak'},
  {type:'heading',text:'Long Source and Legacy Content',level:1},
  {type:'paragraph',text:code.replace(/\n/g,'\r\n')},
  {type:'code',text:Array.from({length:55},(_,i)=>`// Line ${i+1}: source continues across pages without clipping`).join('\n'),language:'cpp'},
  {type:'heading',text:'Final Result',level:2},
  {type:'paragraph',text:'All source lines should be readable and the final section should follow the code.'}
]});
assert.equal(spec.blocks[9].type,'code');
assert.equal(spec.blocks[2].text,code);
const literal='std::cout << "\\n";';
assert.equal(W.normalize({kind:'docx',title:'Literal',blocks:[{type:'code',text:literal}]}).blocks[0].text,literal);
(async()=>{
  const {generate}=await import('../widgets-engine.js');
  const blob=await generate(spec),buffer=Buffer.from(await blob.arrayBuffer());
  const zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
  assert.ok((xml.match(/<w:br\s*\/>/g)||[]).length>=3);
  assert.match(xml,/Courier New/);assert.match(xml,/xml:space="preserve"/);
  assert.match(xml,/\\n/);
  fs.mkdirSync('tests/output',{recursive:true});fs.writeFileSync('tests/output/code-layout.docx',buffer);
  console.log('DOCX layout fixture and XML checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

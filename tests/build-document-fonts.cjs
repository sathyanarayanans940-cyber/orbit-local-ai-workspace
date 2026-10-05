const fs=require('node:fs'),fontkit=require('@foliojs-fork/fontkit');const data={};
for(const [family,pkg]of [['Serif','noto-serif'],['Mono','roboto-mono']])for(const [style,weight,slant]of [['normal',400,'normal'],['bold',700,'normal'],['italics',400,'italic'],['bolditalics',700,'italic']])data[`${family}-${style}.woff`]=fs.readFileSync(`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-${slant}.woff`).toString('base64');
for(const style of ['normal','bold','italics','bolditalics'])data[`Symbols-${style}.woff`]=fs.readFileSync(`vendor/widgets/fonts/Symbols-${style}.woff`).toString('base64');
fs.writeFileSync('document-fonts.js','// Generated from OFL font packages by tests/build-document-fonts.cjs.\nexport default '+JSON.stringify(data)+';\n');
const fonts={...require('pdfmake/build/vfs_fonts.js'),...data},coverage={};
const ranges=codes=>{const result=[];for(const code of codes.sort((a,b)=>a-b)){const last=result.at(-1);if(last&&code===last[1]+1)last[1]=code;else result.push([code,code]);}return result;};
for(const family of ['Roboto','Serif','Mono','Symbols']){
 coverage[family]={};
 for(const [style,roboto] of [['normal','Regular'],['bold','Medium'],['italics','Italic'],['bolditalics','MediumItalic']]){
  const name=family==='Roboto'?`Roboto-${roboto}.ttf`:`${family}-${style}.woff`;
  coverage[family][style]=ranges(fontkit.create(Buffer.from(fonts[name],'base64')).characterSet);
 }
}
fs.writeFileSync('document-font-coverage.js','// Generated from the exact embedded font files.\nexport default '+JSON.stringify(coverage)+';\n');

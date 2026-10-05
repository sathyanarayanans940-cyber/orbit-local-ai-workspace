import pdfMake from 'pdfmake/build/pdfmake.js';
import fonts from 'pdfmake/build/vfs_fonts.js';
import {Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, TableLayoutType, UnderlineType, ImageRun, AlignmentType, BorderStyle, Footer, PageNumber} from 'docx';
import {generatePresentation,THEMES} from './presentation-engine.js';
import {generateSpreadsheet} from './spreadsheet-engine.js';

import extraFonts from './document-fonts.js';
import {pdfStyledText} from './pdf-text.js';
import {pdfBlob,keepHeadingWithBody} from './pdf-layout.js';
import {formulaRows,shortFormulaRow} from './formula-layout.js';
import {mathSvg,mathImage,documentStyle,wordPreview} from './document-rendering.js';
export {mathSvg,wordPreview};
pdfMake.addVirtualFileSystem({...fonts,...extraFonts});
pdfMake.addFonts({Roboto:{normal:'Roboto-Regular.ttf',bold:'Roboto-Medium.ttf',italics:'Roboto-Italic.ttf',bolditalics:'Roboto-MediumItalic.ttf'}});
for(const family of ['Serif','Mono','Symbols'])pdfMake.addFonts({[family]:Object.fromEntries(['normal','bold','italics','bolditalics'].map(style=>[style,`${family}-${style}.woff`]))});

const shortCallout = block => {const text=typeof block.text==='string'?block.text:block.text.map(r=>r.text).join('');return text.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/55)),0)<=24;};
const runs = value => typeof value === 'string' ? [{text:value}] : value;
const slideText = value => runs(value).map(r => ({text:r.text,options:{...(r.bold?{bold:true}:{}),...(r.italic?{italic:true}:{}),...(r.underline?{underline:{style:'sng'}}:{}),...(r.color?{color:r.color}:{})}}));

export async function generate(spec,{images={},visuals={},preview=false}={}) {
  images={...images};
  const style=documentStyle(spec),accent='#'+style.accent,tint='#'+style.tint;
  const pdfFont={sans:'Roboto',serif:'Serif',mono:'Mono'}[style.font],wordFont={sans:'Arial',serif:'Georgia',mono:'Courier New'}[style.font];
  const pdfText=value=>pdfStyledText(value,pdfFont);
  const equations={};
  for(const [index,item] of (spec.blocks||spec.slides||[]).entries())if(item.type==='math'||item.math){
    const latex=item.latex||item.math;
    equations[index]=spec.kind==='pdf'?mathSvg(latex):await mathImage(latex,spec.kind==='pptx'?{transparent:true,color:['dark','accent'].includes(item.tone)?'#FFFFFF':'#'+(THEMES[spec.theme]||THEMES.midnight).text}:{});
  }
  const embedded=(item,index)=>{
    if(item.math){const assetId='img-orbit-math-'+index;images[assetId]=equations[index];return {...item,math:undefined,image:{assetId,caption:item.caption||'',widthPercent:100}};}
    if(!item.visual)return item;
    const v=visuals[index];if(!v)throw new Error('Embedded diagram/chart has not been rendered.');
    const assetId='img-orbit-visual-'+index;images[assetId]=v;
    return spec.kind==='pptx'?{...item,visual:undefined,image:{assetId,caption:item.caption||'',widthPercent:100}}:{type:'image',assetId,caption:item.caption||'',widthPercent:item.widthPercent||100};
  };
  spec={...spec,...(spec.blocks?{blocks:spec.blocks.map(embedded)}:{}),...(spec.slides?{slides:spec.slides.map(embedded)}:{})};
  const image=b=>{
    const value=images[b.assetId];
    if(!value || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value.dataUrl||''))throw new Error('An uploaded image is missing. Reattach it before generating the file.');
    return {...value,width:Number(value.width)||1000,height:Number(value.height)||1000};
  };
  const fitted=(v,maxW,maxH,nativeScale=1)=>{const scale=Math.min(nativeScale,maxW/v.width,maxH/v.height);return {width:v.width*scale,height:v.height*scale};};
  if (spec.kind === 'xlsx') return generateSpreadsheet(spec);
  if (spec.kind === 'pdf') {
    const content = [{text:pdfText(spec.title), style:'title'}];
    let pageBreak = false;
    spec.blocks.forEach((b,index) => {
      const callout=b.tone==='success'?{accent:'#326B50',tint:'#F0F6F1'}:b.tone==='warning'?{accent:'#94601F',tint:'#FFF7E9'}:{accent,tint};
      if(b.type==='pageBreak') { pageBreak = content.length > 1; return; }
      if(b.type==='math'){const v=equations[index],scale=Math.min(1,507/v.width,580/v.height),w=v.width*scale,h=v.height*scale;content.push({stack:[{svg:v.svg,width:w,height:h,alignment:'center'},...(b.caption?[{text:b.caption,alignment:'center',fontSize:9,color:'#536174',margin:[0,7,0,0]}]:[])],unbreakable:true,margin:[0,10,0,14]});}
      if(b.type==='formula'){
        const rows=formulaRows(b);
        const rowStack=(row,i)=>{
          const caption=i===rows.length-1?b.caption:'';
          return {stack:[{text:pdfText(row.text),alignment:'center',fontSize:12,lineHeight:1.25},...(row.condition?[{text:pdfText(row.condition),alignment:'center',fontSize:11,color:'#536174',margin:[0,4,0,0]}]:[]),...(caption?[{text:caption,alignment:'center',fontSize:9,color:'#536174',margin:[0,6,0,0]}]:[])],...((row.condition||caption)&&shortFormulaRow(row,caption)?{unbreakable:true}:{}),margin:[0,i?8:0,0,0]};
        };
        content.push({stack:rows.map(rowStack),margin:[0,7,0,12]});
      }
      if(b.type==='divider')content.push({canvas:[{type:'line',x1:0,y1:0,x2:507,y2:0,lineWidth:.7,lineColor:accent}],margin:[0,12,0,16]});
      if(b.type==='callout')content.push({table:{dontBreakRows:shortCallout(b),widths:['*'],body:[[{stack:[...(b.title?[{text:b.title,bold:true,color:callout.accent,margin:[0,0,0,5]}]:[]),{text:pdfText(b.text)}],fillColor:callout.tint,margin:[10,8,10,8]}]]},layout:{hLineWidth:()=>0,vLineWidth:i=>i===0?3:0,vLineColor:()=>callout.accent},margin:[0,8,0,14]});
      if(b.type==='image'){const v=image(b);content.push({stack:[{image:v.dataUrl,fit:[Math.min(v.width*.75,507*b.widthPercent/100),Math.min(v.height*.75,Math.max(340,620-Math.ceil(b.caption.length/90)*12))],alignment:'center'},...(b.caption?[{text:b.caption,fontSize:9,color:'#555555',alignment:'center',margin:[0,6,0,0]}]:[])],unbreakable:true,margin:[0,10,0,14]});}
      if(b.type==='heading') content.push({text:pdfText(b.text), headlineLevel:b.level||1, style:b.level===2?'subheading':'heading'});
      if(b.type==='paragraph') content.push({text:pdfText(b.text), margin:[0,0,0,8]});
      if(b.type==='code') content.push({text:b.text.replace(/\t/g,'    '),font:'Mono',fontSize:9,lineHeight:1.15,preserveLeadingSpaces:true,margin:[0,4,0,12]});
      if(b.type==='bullets') content.push({ul:b.items.map(value=>({text:pdfText(value)})), margin:[0,0,0,12]});
      if(b.type==='table') {
        const width=((style.pageSize==='Letter'?612:595.28)-88-16*(b.headers.length-1))/b.headers.length;
        const charsPerLine=Math.max(4,Math.floor(width/6.5));
        const shortRows=[b.headers,...b.rows].every(row=>row.every(value=>runs(value).map(r=>r.text).join('').split(/\r\n?|\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/charsPerLine)),0)<=24));
        content.push({table:{headerRows:1,dontBreakRows:shortRows,keepWithHeaderRows:shortRows?1:0,widths:b.headers.map(()=>width),body:[b.headers.map(value=>({text:pdfText(value),bold:true,fillColor:tint,color:accent})),...b.rows.map(row=>row.map(value=>({text:pdfText(value)})))]},layout:'lightHorizontalLines',margin:[0,6,0,16]});
      }
      content.at(-1).id='orbit-body-'+(b.type==='paragraph'?'paragraph-':'')+index;
      if (pageBreak) { content.at(-1).pageBreak = 'before'; pageBreak = false; }
    });
    return pdfBlob(pdfMake,{pageBreakBefore:keepHeadingWithBody,info:{title:spec.title,author:'Orbit'},pageSize:style.pageSize,pageMargins:[44,48,44,48],background:(_,size)=>style.border==='none'?null:{canvas:style.border==='frame'?[{type:'rect',x:23,y:23,w:size.width-46,h:size.height-46,lineColor:accent,lineWidth:.6}]:[{type:'line',x1:44,y1:29,x2:size.width-44,y2:29,lineColor:accent,lineWidth:2}]},defaultStyle:{font:pdfFont,color:'#243244',fontSize:11,lineHeight:1.15},styles:{title:{fontSize:26,bold:true,color:accent,margin:[0,0,0,22]},heading:{fontSize:16,bold:true,color:accent,margin:[0,14,0,8]},subheading:{fontSize:13,bold:true,color:accent,margin:[0,12,0,6]}},content,footer:(page,total)=>({text:`${page} / ${total}`,alignment:'center',fontSize:9,color:'#6b7280'})},{compact:!spec.blocks.some(b=>b.type==='pageBreak')});
  }
  if(spec.kind==='docx') {
    const run = (text, options = {}) => new TextRun({text,font:wordFont,color:'243244',size:22,...options});
    const wordText = (value, options = {}) => runs(value).flatMap(r => r.text.replace(/\r\n?/g,'\n').split('\n').map((line,i) => run(line,{...options,...(i?{break:1}:{}),...(r.bold?{bold:true}:{}),...(r.italic?{italics:true}:{}),...(r.underline?{underline:{type:UnderlineType.SINGLE}}:{}),...(r.color?{color:r.color}:{})})));
    const children=[new Paragraph({children:[run(spec.title,{size:48,bold:true,color:style.accent})],heading:HeadingLevel.TITLE,spacing:{after:300}})];
    let pageBreak = false;
    spec.blocks.forEach((b,index)=> {
      const callout=b.tone==='success'?{accent:'326B50',tint:'F0F6F1'}:b.tone==='warning'?{accent:'94601F',tint:'FFF7E9'}:style;
      if(b.type==='pageBreak') { pageBreak = children.length > 1; return; }
      if(b.type==='math'){const v=equations[index],size=fitted({width:v.displayWidth,height:v.displayHeight},624,650);children.push(new Paragraph({pageBreakBefore:pageBreak,alignment:AlignmentType.CENTER,children:[new ImageRun({type:'png',data:Uint8Array.from(atob(v.dataUrl.split(',')[1]),c=>c.charCodeAt(0)),transformation:size,altText:{title:'Equation',description:b.latex,name:'Equation'}})],spacing:{before:150,after:150},keepNext:!!b.caption}));if(b.caption)children.push(new Paragraph({alignment:AlignmentType.CENTER,children:[run(b.caption,{size:18,italics:true})],spacing:{after:160}}));}
      if(b.type==='formula'){
        const rows=formulaRows(b);
        rows.forEach((row,rowIndex)=>{
          children.push(new Paragraph({pageBreakBefore:pageBreak&&rowIndex===0,alignment:AlignmentType.CENTER,children:wordText(row.text,{size:24}),spacing:{before:100,after:row.condition?60:b.caption?100:180,line:300},keepNext:!!row.condition||!!b.caption&&rowIndex===rows.length-1,widowControl:true}));
          if(row.condition)children.push(new Paragraph({alignment:AlignmentType.CENTER,children:wordText(row.condition,{size:22,color:'536174'}),spacing:{after:b.caption&&rowIndex===rows.length-1?100:180,line:280},keepNext:!!b.caption&&rowIndex===rows.length-1,widowControl:true}));
        });
        if(b.caption)children.push(new Paragraph({alignment:AlignmentType.CENTER,children:[run(b.caption,{size:18,italics:true})],spacing:{after:180}}));
      }
      if(b.type==='divider')children.push(new Paragraph({pageBreakBefore:pageBreak,border:{bottom:{color:style.accent,style:BorderStyle.SINGLE,size:6,space:6}},spacing:{before:120,after:200}}));
      if(b.type==='callout'){
        if(pageBreak)children.push(new Paragraph({pageBreakBefore:true,spacing:{after:0}}));
        const noBorder={style:BorderStyle.NONE,size:0,color:callout.tint};
        children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[new TableRow({cantSplit:shortCallout(b),children:[new TableCell({shading:{fill:callout.tint},margins:{top:160,bottom:160,left:240,right:240},borders:{top:noBorder,bottom:noBorder,right:noBorder,left:{color:callout.accent,style:BorderStyle.SINGLE,size:18}},children:[...(b.title?[new Paragraph({children:[run(b.title,{bold:true,color:callout.accent})],spacing:{after:100},keepNext:true})]:[]),new Paragraph({children:wordText(b.text),spacing:{after:0,line:280}})]})]})]}));
        children.push(new Paragraph({spacing:{before:0,after:120},children:[]}));
      }
      if(b.type==='image'){const v=image(b),size=fitted(v,624*b.widthPercent/100,650);children.push(new Paragraph({pageBreakBefore:pageBreak,alignment:AlignmentType.CENTER,children:[new ImageRun({type:v.dataUrl.startsWith('data:image/png')?'png':'jpg',data:Uint8Array.from(atob(v.dataUrl.split(',')[1]),c=>c.charCodeAt(0)),transformation:size,altText:{title:b.caption||'Uploaded image',description:b.caption||v.label||'Uploaded image',name:'Image'}})],spacing:{before:120,after:100},keepNext:!!b.caption}));if(b.caption)children.push(new Paragraph({alignment:AlignmentType.CENTER,children:[run(b.caption,{size:18,italics:true})],spacing:{after:160}}));}
      if(b.type==='heading') children.push(new Paragraph({children:wordText(b.text,{size:b.level===2?26:32,bold:true,color:style.accent}),pageBreakBefore:pageBreak,heading:b.level===2?HeadingLevel.HEADING_2:HeadingLevel.HEADING_1,keepNext:true,spacing:{before:240,after:140}}));
      if(b.type==='paragraph') children.push(new Paragraph({children:wordText(b.text),pageBreakBefore:pageBreak,spacing:{after:180}}));
      if(b.type==='code') children.push(...b.text.replace(/\t/g,'    ').split('\n').map((line,i)=>new Paragraph({children:[run(line || ' ',{font:'Courier New',size:20})],pageBreakBefore:pageBreak && i===0,spacing:{before:i===0?80:0,after:i===b.text.replace(/\t/g,'    ').split('\n').length-1?180:0,line:240},keepNext:false,widowControl:false})));
      if(b.type==='bullets') children.push(...b.items.map((text,i)=>new Paragraph({children:wordText(text),pageBreakBefore:pageBreak && i===0,bullet:{level:0},spacing:{after:100}})));
      if(b.type==='table') {
        if (pageBreak) children.push(new Paragraph({pageBreakBefore:true,spacing:{after:0,before:0}}));
        const tableWidth=style.pageSize==='Letter'?9360:9026;
        const columnWidth = Math.floor(tableWidth / b.headers.length);
        const rows=[b.headers,...b.rows];
        // Keep compact data rows intact. Long prose cells must remain able to
        // span pages; a blanket cantSplit would create blank gaps or overflow.
        const charsPerLine=Math.max(4,Math.floor((columnWidth-240)/120));
        const rowHeight=row=>200+280*Math.max(...row.map(value=>runs(value).map(r=>r.text).join('').split(/\r\n?|\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/charsPerLine)),0)));
        const compact=row=>rowHeight(row)<=5600;
        const small=rows.length<=4&&rows.reduce((n,row)=>n+rowHeight(row),0)<=3600;
        children.push(new Table({width:{size:tableWidth,type:WidthType.DXA},columnWidths:b.headers.map(()=>columnWidth),layout:TableLayoutType.FIXED,rows:rows.map((row,i)=>new TableRow({tableHeader:i===0,cantSplit:compact(row),children:row.map(text=>new TableCell({width:{size:columnWidth,type:WidthType.DXA},margins:{top:100,bottom:100,left:120,right:120},shading:i===0?{fill:style.tint}:undefined,children:[new Paragraph({children:wordText(text,{bold:i===0,...(i===0?{color:style.accent}:{})}),keepNext:small&&i<rows.length-1})]}))}))}));
        children.push(new Paragraph({text:'',spacing:{after:160}}));
      }
      pageBreak = false;
    });
    return Packer.toBlob(new Document({creator:'Orbit',title:spec.title,styles:{default:{document:{run:{font:wordFont,size:22},paragraph:{spacing:{after:160}}}}},sections:[{properties:{page:{size:style.pageSize==='Letter'?{width:12240,height:15840}:{width:11906,height:16838},borders:style.border==='none'?undefined:Object.fromEntries((style.border==='frame'?['Top','Right','Bottom','Left']:['Top']).map(side=>['pageBorder'+side,{color:style.accent,style:BorderStyle.SINGLE,size:6,space:24}])),margin:{top:1440,bottom:1440,left:1440,right:1440}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({children:[PageNumber.CURRENT,' / ',PageNumber.TOTAL_PAGES],size:18,color:'64748B'})]})]})},children}]}));
  }
  if(spec.kind==='pptx') return generatePresentation(spec,{images,preview});
  throw new Error('Unsupported file format.');
}

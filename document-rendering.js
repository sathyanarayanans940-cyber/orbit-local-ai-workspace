import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import {renderAsync} from 'docx-preview';
import JSZip from 'jszip';
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const mathDocument=mathjax.document('',{InputJax:new TeX({packages:['base','ams'],maxBuffer:8000,maxMacros:500}),OutputJax:new SVG({fontCache:'none'})});
export function mathSvg(latex){
 if(typeof latex!=='string'||!latex.trim()||latex.length>4000)throw Error('An equation must contain 1–4,000 characters of TeX.');
 const node=mathDocument.convert(latex,{display:true});
 let svg=adaptor.outerHTML(adaptor.firstChild(node));
 if(/data-mjx-error|<merror/.test(svg))throw Error('This equation contains invalid or unsupported TeX. Correct it before exporting.');
 const box=svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
 const width=box[2]/1000*22,height=box[3]/1000*22;
 if(width>8000||height>4000||width/height>70)throw Error('Equation is too large. Split the derivation into shorter equations.');
 svg=svg.replace(/width="[^"]+"/,`width="${width}"`).replace(/height="[^"]+"/,`height="${height}"`).replace(/currentColor/g,'#172334');
 return {svg,width,height};
}
export async function mathImage(latex,{transparent=false,color='#172334'}={}){
 const rendered=mathSvg(latex),{width,height}=rendered,svg=rendered.svg.replace(/#172334/g,color),canvas=document.createElement('canvas');
 const scale=Math.min(6,4200/Math.max(width,height));canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);
 const image=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
 try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Equation rendering failed.'));image.src=url;});const ctx=canvas.getContext('2d');if(!transparent){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.drawImage(image,0,0,canvas.width,canvas.height);return {dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,displayWidth:width,displayHeight:height,label:latex,svg};}finally{URL.revokeObjectURL(url);}
}
export const documentThemes={classic:{accent:'334155',tint:'F1F5F9'},ocean:{accent:'087F8C',tint:'EFF8F8'},forest:{accent:'326B50',tint:'F0F6F1'},plum:{accent:'795487',tint:'F7F2F9'},terracotta:{accent:'A74E36',tint:'FCF2EC'},slate:{accent:'4B6485',tint:'F0F4FA'}};
export function documentStyle(spec){const s=spec.style||{};return {...{font:'sans',border:'none',pageSize:'A4'},...s,...(documentThemes[s.theme]||documentThemes.classic),...(s.accent?{accent:s.accent}:{})};}
export async function wordPreview(blob){
 // Render disconnected content and display only in an sandbox with no
 // script, network, frame, object or navigation permissions.
 const body=document.createElement('div'),styles=document.createElement('div');
 const zip=await JSZip.loadAsync(await blob.arrayBuffer()),part=zip.file('word/document.xml');
 if(!part)throw Error('This file has no Word document content.');
 const xml=await part.async('string');if(xml.length>15000000)throw Error('This Word document is too large to preview. Download the original.');
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',parsed=new DOMParser().parseFromString(xml,'application/xml');
 // docx-preview recognizes run page breaks but misses direct paragraph-level
 // pageBreakBefore. Translate only the preview copy, preserving the download.
 for(const p of [...parsed.getElementsByTagNameNS(ns,'p')]){const props=[...p.children].find(x=>x.localName==='pPr'),br=props&&[...props.children].find(x=>x.localName==='pageBreakBefore');if(!br||['0','false','off'].includes(br.getAttributeNS(ns,'val')))continue;const para=parsed.createElementNS(ns,'w:p'),run=parsed.createElementNS(ns,'w:r'),breakNode=parsed.createElementNS(ns,'w:br');breakNode.setAttributeNS(ns,'w:type','page');run.append(breakNode);para.append(run);p.parentNode.insertBefore(para,p);br.remove();}
 zip.file('word/document.xml',new XMLSerializer().serializeToString(parsed));
 await renderAsync(await zip.generateAsync({type:'arraybuffer'}),body,styles,{className:'orbit-word',inWrapper:true,useBase64URL:true,renderAltChunks:false,renderComments:false,ignoreLastRenderedPageBreak:false});
 for(const el of body.querySelectorAll('img')){const src=el.getAttribute('src')||'';if(src.startsWith('data:application/octet-stream;base64,iVBOR'))el.src=src.replace('application/octet-stream','image/png');else if(src.startsWith('data:application/octet-stream;base64,/9j/'))el.src=src.replace('application/octet-stream','image/jpeg');}
 for(const el of [...body.querySelectorAll('p div')]){const span=document.createElement('span');for(const a of el.attributes)span.setAttribute(a.name,a.value);span.append(...el.childNodes);el.replaceWith(span);}
 for(const el of body.querySelectorAll('a'))el.removeAttribute('href');
 for(const el of body.querySelectorAll('script,iframe,object,embed'))el.remove();
 for(const el of body.querySelectorAll('*'))for(const a of [...el.attributes])if(/^on/i.test(a.name))el.removeAttribute(a.name);
 return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; font-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+styles.innerHTML+'<style>html,body{margin:0;background:#e9edf2;color:#182334} .orbit-word-wrapper{padding:20px!important;background:transparent!important} section.orbit-word{box-sizing:border-box;box-shadow:0 3px 18px #15233a18!important} img{max-width:100%} table{max-width:100%}</style>'+body.innerHTML;
}

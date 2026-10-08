/* Bounded Word formatting profiles. Document content never becomes instructions. */
(function(root){
'use strict';
const roles=['body','title','heading1','heading2','code','caption','tableHeader','tableBody'];
const sides=['top','right','bottom','left'];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function number(v,min,max,key){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`Word ${key} must be between ${min} and ${max}.`);return v;}
function color(v){if(typeof v!=='string'||!/^#?[\da-f]{6}$/i.test(v))throw Error('Word colors require six-digit hex values.');return v.replace('#','').toUpperCase();}
function role(value){
 if(!object(value))throw Error('Word text formatting must be an object.');const out={};
 if(value.font!==undefined){if(typeof value.font!=='string'||!value.font.trim()||value.font.length>80||/[<>;{}\u0000-\u001f]/.test(value.font))throw Error('Use a font family name, not CSS or a URL.');out.font=value.font.trim();}
 for(const [key,min,max] of [['size',6,72],['spaceBefore',0,144],['spaceAfter',0,144],['lineSpacing',.5,3]])if(value[key]!==undefined)out[key]=number(value[key],min,max,key);
 if(value.color!==undefined)out.color=color(value.color);
 for(const key of ['bold','italic','underline'])if(value[key]!==undefined){if(typeof value[key]!=='boolean')throw Error(`Word ${key} must be true or false.`);out[key]=value[key];}
 if(value.alignment!==undefined){if(!['left','center','right','justify'].includes(value.alignment))throw Error('Word alignment must be left, center, right or justify.');out.alignment=value.alignment;}
 return out;
}
function normalize(value){
 if(!object(value))throw Error('Word formatting must be an object.');const out={};
 for(const key of roles)if(value[key]!==undefined)out[key]=role(value[key]);
 if(value.page!==undefined){
  if(!object(value.page))throw Error('Word page formatting must be an object.');const p=value.page,page={};
  for(const key of ['width','height'])if(p[key]!==undefined)page[key]=number(p[key],5,22,'page '+key);
  if(p.margins!==undefined){if(!object(p.margins))throw Error('Word margins must be an object.');page.margins={};for(const key of sides)if(p.margins[key]!==undefined)page.margins[key]=number(p.margins[key],.2,3,key+' margin');}
  if(p.borders!==undefined){if(!object(p.borders))throw Error('Word borders must be an object.');page.borders={};for(const key of sides)if(p.borders[key]!==undefined){const b=p.borders[key];if(!object(b)||!['none','single','double','dashed','dotted'].includes(b.style))throw Error('Word border style must be none, single, double, dashed or dotted.');page.borders[key]={style:b.style,...(b.color!==undefined?{color:color(b.color)}:{}),...(b.width!==undefined?{width:number(b.width,.25,6,'border width')} :{}),...(b.space!==undefined?{space:number(b.space,0,31,'border spacing')}:{})};}}
  if(p.borderOffset!==undefined){if(!['page','text'].includes(p.borderOffset))throw Error('Word border offset must be page or text.');page.borderOffset=p.borderOffset;}
  out.page=page;
 }
 if(value.pageNumbers!==undefined){if(typeof value.pageNumbers!=='boolean')throw Error('Word pageNumbers must be true or false.');out.pageNumbers=value.pageNumbers;}
 return out;
}
function merge(base={},override={}){
 const out={...normalize(base),...normalize(override)};
 for(const key of roles)if(base[key]||override[key])out[key]={...base[key],...override[key]};
 if(base.page||override.page)out.page={...base.page,...override.page,...(base.page?.margins||override.page?.margins?{margins:{...base.page?.margins,...override.page?.margins}}:{}),...(base.page?.borders||override.page?.borders?{borders:{...base.page?.borders,...override.page?.borders}}:{})};
 return normalize(out);
}
const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',aNS='http://schemas.openxmlformats.org/drawingml/2006/main';
const children=n=>Array.from(n?.childNodes||[]).filter(n=>n.nodeType===1);
const child=(n,name)=>children(n).find(n=>n.localName===name);
const all=(n,name,namespace=ns)=>Array.from(n?.getElementsByTagNameNS(namespace,name)||[]);
const attr=(n,key)=>n?.getAttributeNS(ns,key)||n?.getAttribute('w:'+key)||'';
const val=n=>attr(n,'val');
function extract({document,styles,theme}){
 const warnings=new Set(),styleMap=new Map(all(styles,'style').map(s=>[attr(s,'styleId'),s]));
 if(styleMap.size>2048)throw Error('Too many Word styles to inspect safely.');
 const palette={};const scheme=all(theme,'clrScheme',aNS)[0];for(const n of children(scheme)){const c=children(n)[0],hex=c?.getAttribute('lastClr')||c?.getAttribute('val');if(/^[\da-f]{6}$/i.test(hex||''))palette[n.localName]=hex.toUpperCase();}
 const fontScheme=all(theme,'fontScheme',aNS)[0],fonts={};for(const key of ['major','minor'])fonts[key]=child(child(fontScheme,key+'Font'),'latin')?.getAttribute('typeface');
 const hexColor=(n,field='val')=>{
  const themeKey=attr(n,'themeColor'),aliases={background1:'lt1',text1:'dk1',background2:'lt2',text2:'dk2'};
  let hex=palette[aliases[themeKey]||themeKey]||attr(n,field);if(hex==='auto')hex='000000';
  if(!/^[\da-f]{6}$/i.test(hex))return undefined;
  let rgb=hex.match(/../g).map(v=>parseInt(v,16));
  for(const [key,tint] of [['themeShade',false],['themeTint',true]]){const v=attr(n,key);if(/^[\da-f]{2}$/i.test(v)){const f=parseInt(v,16)/255;rgb=rgb.map(c=>Math.round(tint?c+(255-c)*(1-f):c*f));}}
  return rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
 };
 const props=(r,p)=>{
  const out={},f=child(r,'rFonts'),themeFont=attr(f,'asciiTheme')||attr(f,'hAnsiTheme');
  const family=(themeFont?fonts[themeFont.startsWith('major')?'major':'minor']:null)||attr(f,'ascii')||attr(f,'hAnsi');if(family)out.font=family;
  const size=Number(val(child(r,'sz')))/2;if(size>=6&&size<=72)out.size=size;
  const c=hexColor(child(r,'color'));if(c)out.color=c;
  for(const [key,name] of [['bold','b'],['italic','i'],['underline','u']]){const n=child(r,name);if(n)out[key]=!['0','false','off','none'].includes(val(n));}
  const align=val(child(p,'jc'));if(['left','start','center','right','end','both'].includes(align))out.alignment={both:'justify',start:'left',end:'right'}[align]||align;
  const spacing=child(p,'spacing');for(const [key,field] of [['spaceBefore','before'],['spaceAfter','after']]){const raw=attr(spacing,field),v=Number(raw)/20;if(raw&&v>=0&&v<=144)out[key]=v;}
  const line=Number(attr(spacing,'line'))/240;if(line>=.5&&line<=3&&(!attr(spacing,'lineRule')||attr(spacing,'lineRule')==='auto'))out.lineSpacing=line;
  else if(attr(spacing,'line'))warnings.add('Exact/minimum line spacing is not copied; only proportional line spacing is supported.');
  return out;
 };
 const defaults=all(styles,'docDefaults')[0],base=props(child(child(defaults,'rPrDefault'),'rPr'),child(child(defaults,'pPrDefault'),'pPr'));
 const cache=new Map();
 function resolve(id,seen=new Set()){
  if(cache.has(id))return cache.get(id);const s=styleMap.get(id);if(!s)return {};
  if(seen.has(id)||seen.size>32){warnings.add('A circular or overly deep style inheritance chain was ignored.');return {};}
  seen.add(id);const result={...resolve(val(child(s,'basedOn')),seen),...props(child(s,'rPr'),child(s,'pPr'))};cache.set(id,result);return result;
 }
 const normal=Array.from(styleMap).find(([,s])=>attr(s,'type')==='paragraph'&&attr(s,'default')==='1')?.[0]||'Normal';
 const word={body:{...base,...resolve(normal)}};
 const identify=id=>{
  const s=styleMap.get(id),name=(id+' '+val(child(s,'name'))).toLowerCase();
  if(/subtitle/.test(name))return null;
  if(/\btitle\b/.test(name))return 'title';
  const level=val(child(child(s,'pPr'),'outlineLvl'));
  if(/heading\s*1\b/.test(name)||level==='0')return 'heading1';
  if(/heading\s*2\b/.test(name)||level==='1')return 'heading2';
  if(/code|source|preformatted|html pre/.test(name))return 'code';
  if(/caption/.test(name))return 'caption';
  return null;
 };
 for(const [id] of styleMap){const key=identify(id);if(key&&!word[key])word[key]={...base,...resolve(id)};}
 const observed={};
 let seenText=false;const paras=all(document,'p');if(paras.length>20000)warnings.add('Formatting inspection was limited to the first 20,000 paragraphs.');
 for(const p of paras.slice(0,20000)){
  const pPr=child(p,'pPr'),id=val(child(pPr,'pStyle'))||normal;
  const paragraph={...base,...resolve(id),...props(child(pPr,'rPr'),pPr)};
  const samples=new Map();for(const r of children(p).filter(n=>n.localName==='r')){const text=all(r,'t').map(t=>t.textContent).join('');if(!text.trim())continue;const rp=child(r,'rPr'),fmt={...paragraph,...resolve(val(child(rp,'rStyle'))),...props(rp,null)};const json=JSON.stringify(fmt);samples.set(json,(samples.get(json)||0)+text.length);}
  if(!samples.size)continue;
  const fmt=JSON.parse([...samples].sort((a,b)=>b[1]-a[1])[0][0]);
  let key=identify(id)||(!seenText&&fmt.bold&&fmt.size>=(word.body.size||11)*1.15?'title':null)||(/Courier|Consolas|Menlo|Monaco|Mono/i.test(fmt.font||'')?'code':'body');
  if(p.parentNode?.localName==='tc'){const row=p.parentNode.parentNode,table=row?.parentNode;key=child(row,'trPr')&&child(child(row,'trPr'),'tblHeader')||children(table).filter(n=>n.localName==='tr')[0]===row?'tableHeader':'tableBody';}
  seenText=true;if(!observed[key])observed[key]=new Map();const json=JSON.stringify(fmt);observed[key].set(json,(observed[key].get(json)||0)+1);
 }
 for(const [key,samples] of Object.entries(observed)){word[key]=JSON.parse([...samples].sort((a,b)=>b[1]-a[1])[0][0]);if(samples.size>1)warnings.add(`Multiple ${key} formats found; the most common paragraph format is used.`);}
 const sections=all(document,'sectPr');if(sections.length>1)warnings.add('Multiple page sections found; the first section supplies the new document page format.');
 const section=sections[0],size=child(section,'pgSz'),margins=child(section,'pgMar'),page={};
 for(const [key,name] of [['width','w'],['height','h']]){const n=Number(attr(size,name))/1440;if(n>=5&&n<=22)page[key]=Math.round(n*10000)/10000;}
 if(margins){page.margins={};for(const key of sides){const raw=attr(margins,key),n=Number(raw)/1440;if(raw&&n>=.2&&n<=3)page.margins[key]=Math.round(n*10000)/10000;else if(raw)warnings.add('A margin outside the supported 0.2–3 inch range was not copied.');}}
 const borders=child(section,'pgBorders');page.borders={};
 for(const key of sides){const b=child(borders,key),style=val(b)||'none';if(!['none','nil','single','double','dashed','dotted'].includes(style)){warnings.add('Decorative page borders are unsupported; specify a simple border instead.');continue;}
  page.borders[key]={style:style==='nil'?'none':style,...(hexColor(b,'color')?{color:hexColor(b,'color')}:{}),...(Number(attr(b,'sz'))>=2&&Number(attr(b,'sz'))<=48?{width:Number(attr(b,'sz'))/8}:{}),...(attr(b,'space')&&Number(attr(b,'space'))<=31?{space:Number(attr(b,'space'))}:{})};}
 page.borderOffset=attr(borders,'offsetFrom')==='text'?'text':'page';word.page=page;
 warnings.add('Style matching does not clone headers, footers, logos, custom numbering, table fills or multi-column layouts.');
 return {version:1,word:normalize(word),warnings:[...warnings]};
}
root.OrbitDocumentFormat={normalize,role,merge,extract,roles};if(typeof module!=='undefined')module.exports=root.OrbitDocumentFormat;
})(typeof window==='undefined'?globalThis:window);

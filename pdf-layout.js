/* pdfmake 0.2.20 exposes its finished layout on the PDFKit stream. Keep this
   adapter isolated: if that diagnostic shape changes, ordinary export still works. */
export function trailingPageFill(pages,margin=48){
 if(!Array.isArray(pages)||pages.length<2)return 1;
 const page=pages.at(-1),height=page.pageSize?.height;if(!Number.isFinite(height))return 1;
 let bottom=margin,observed=false;
 for(const entry of page.items||[]){
  if(!['line','image','svg'].includes(entry.type))continue;
  const item=entry.item,y=item?.y;
  const h=entry.type==='line'?item?.getHeight?.():item?._height??item?.height;
  if(!Number.isFinite(y)||!Number.isFinite(h)||y<margin-1||y>=height-margin)continue;
  bottom=Math.max(bottom,y+h);observed=true;
 }
 return observed?Math.min(1,(bottom-margin)/(height-2*margin)):1;
}
const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clone(v)])):value;
export function pdfBlob(pdfMake,definition,{compact=true,timeout=90000}={}){
 return new Promise((resolve,reject)=>{
  let finished=false;const timer=setTimeout(()=>fail(Error('PDF creation timed out. Try again or split a very large document.')),timeout);
  const fail=error=>{if(finished)return;finished=true;clearTimeout(timer);reject(error);};
  const render=attempt=>{
   if(finished)return;
   const docDefinition=clone(definition);
   if(attempt){
    for(const node of docDefinition.content)if(node.id?.startsWith('orbit-body-paragraph-'))node.margin[3]=Math.max(4,node.margin[3]-2*attempt);
    // Reclaim a little decorative heading space as well, while preserving
    // the type size, line spacing and a clear gap above each section.
    for(const key of ['heading','subheading']){
     const margin=docDefinition.styles?.[key]?.margin;
     if(Array.isArray(margin)){margin[1]=Math.max(8,margin[1]-2*attempt);margin[3]=Math.max(4,margin[3]-attempt);}
    }
   }
   try{pdfMake.createPdf(docDefinition).getStream({},doc=>{
    try{
     const retry=compact&&attempt<2&&trailingPageFill(doc._pdfMakePages)<.33;
     const chunks=[];doc.on('error',fail);doc.on('data',chunk=>{if(!retry)chunks.push(chunk);});
     doc.on('end',()=>{if(finished)return;if(retry){render(attempt+1);return;}finished=true;clearTimeout(timer);resolve(new Blob(chunks,{type:'application/pdf'}));});doc.end();
    }catch(error){fail(error);}
   });}catch(error){fail(error);}
  };
  render(0);
 });
}
export function keepHeadingWithBody(node,following,next){
 // Footers also appear in pdfmake's following-nodes array; they cannot count
 // as the body text that keeps a heading on the preceding page.
 const body=n=>n.id?.startsWith('orbit-body-')&&!n.headlineLevel;
 return !!node.headlineLevel&&!following.some(body)&&!!next?.some(body);
}

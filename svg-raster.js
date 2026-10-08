// Bounded, shared rasterization for document diagrams and equations.
export async function rasterizeSvg(svg,width,height,{scale=3,transparent=false,label='Visual',timeout=15000}={}) {
 if(![width,height,scale].every(n=>Number.isFinite(n)&&n>0))throw Error(`${label}: invalid image dimensions.`);
 // XML 1.0 forbids these controls; copied PDF text can contain them.
 svg=svg.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'');
 const image=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
 let timer,canvas;
 try {
  await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(Error(`${label}: image decoding timed out. Retry creating the file.`)),timeout);
   image.onload=resolve;image.onerror=()=>reject(Error(`${label}: image could not be decoded.`));image.src=url;
  });
  clearTimeout(timer);
  // A 4200px square used 67 MB per canvas. Limit area as well as each side,
  // release every backing buffer, and retry allocation at lower resolution.
  let failure;
  for(const pixels of [4000000,1000000]){
   canvas=document.createElement('canvas');
   const ratio=Math.min(scale,4200/Math.max(width,height),Math.sqrt(pixels/(width*height)));
   canvas.width=Math.max(1,Math.floor(width*ratio));canvas.height=Math.max(1,Math.floor(height*ratio));
   try {
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image canvas is unavailable.');
    if(!transparent){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL('image/png');
    if(!dataUrl.startsWith('data:image/png;base64,'))throw Error('Image canvas could not be exported.');
    return {dataUrl,width:canvas.width,height:canvas.height,label};
   }catch(error){failure=error;}finally{canvas.width=canvas.height=0;}
  }
  throw Error(`${label}: ${failure?.message||'Image export failed.'}`);
 }finally{
  clearTimeout(timer);image.onload=image.onerror=null;image.src='';URL.revokeObjectURL(url);
  if(canvas)canvas.width=canvas.height=0;
 }
}

/* Read-only presentation adapter. Coordinates and typography come from the PPTX layout. */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hex=s=>/^[a-f\d]{6}$/i.test(s||'')?'#'+s:'#222222';
const box=o=>`left:${o.x*96}px;top:${o.y*96}px;width:${o.w*96}px;height:${o.h*96}px;`;
export class PresentationPreview {
 constructor(){this.slides=[];this.ShapeType={line:'line'};}
 addSlide(){
  const page={background:{color:'FFFFFF'},parts:[],notes:'',
   addText(value,o){const text=Array.isArray(value)?value.map(r=>`<span style="${r.options?.bold?'font-weight:700;':''}${r.options?.italic?'font-style:italic;':''}${r.options?.underline?'text-decoration:underline;':''}${r.options?.color?'color:'+hex(r.options.color)+';':''}">${esc(r.text)}</span>`).join(''):esc(value);
    this.parts.push(`<div class="slide-text" style="${box(o)}font-size:${o.fontSize*4/3}px;color:${hex(o.color)};font-weight:${o.bold?700:400};font-family:${o.fontFace==='Georgia'?'Georgia':'Arial'},sans-serif;text-align:${o.align||'left'};letter-spacing:${(o.charSpacing||0)*4/3}px;${o.fill?'background:'+hex(o.fill.color)+';':''}">${text}</div>`);},
   addShape(type,o){this.parts.push(`<div class="slide-rule" style="${box(o)}border-top:${o.line.width*4/3}px solid ${hex(o.line.color)}"></div>`);},
   addImage(o){if(!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(o.data))throw Error('Invalid preview image');this.parts.push(`<img class="slide-image" style="${box(o)}" src="${o.data}" alt="${esc(o.altText)}"/>`);},
   addTable(rows,o){
    // Large tables remain scrollable in the preview; export paginates them natively.
    const html=rows.map(row=>'<tr>'+row.map(c=>`<td style="background:${hex(c.options.fill)};color:${hex(c.options.color)};font-weight:${c.options.bold?700:400}">${c.text.map(r=>esc(r.text)).join('')}</td>`).join('')+'</tr>').join('');
    this.parts.push(`<div class="slide-table" style="${box({...o,h:6.67-o.y})}font-size:${o.fontSize*4/3}px"><table>${html}</table></div>`);},
   addNotes(notes){this.notes=notes;}
  };this.slides.push(page);return page;
 }
 write(){return this.slides.map((p,i)=>`<article class="presentation-preview"><div class="presentation-frame" aria-label="Slide ${i+1}"><div class="presentation-canvas" style="background:${hex(p.background.color)}">${p.parts.join('')}</div></div>${p.notes?`<details class="presentation-notes"><summary>Speaker notes · Slide ${i+1}</summary><p>${esc(p.notes)}</p></details>`:''}</article>`).join('');}
}

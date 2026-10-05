import PptxGenJS from 'pptxgenjs';
import {PresentationPreview} from './presentation-preview.js';
export const THEMES={
 midnight:{ink:'171C35',accent:'6554C0',bright:'B5A5FF',paper:'F7F7FB',text:'222940',muted:'677087',rule:'DADDE8'},
 paper:{ink:'302822',accent:'A34B32',bright:'F5B69A',paper:'FBF8F2',text:'302822',muted:'7B7067',rule:'E2D9CB'},
 ocean:{ink:'102D3A',accent:'087F83',bright:'76DBCE',paper:'F3F9F8',text:'173642',muted:'566F78',rule:'CDE0E0'},
 coral:{ink:'362038',accent:'A53C56',bright:'FFB2A5',paper:'FCF7F8',text:'382C3D',muted:'826779',rule:'E7D8E0'},
 forest:{ink:'142E25',accent:'286347',bright:'A4DFC0',paper:'F4F8F2',text:'203B2D',muted:'536B5C',rule:'D3E1D1'},
 ember:{ink:'30221F',accent:'A23E26',bright:'FFC1A2',paper:'FCF7F2',text:'422A24',muted:'7A6155',rule:'EAD8CD'},
 cobalt:{ink:'122747',accent:'2857B5',bright:'A8CAFF',paper:'F4F7FE',text:'203553',muted:'596C88',rule:'D6E0F2'},
 lavender:{ink:'2C243E',accent:'72508F',bright:'DFC6F5',paper:'F9F6FC',text:'3E3150',muted:'73627F',rule:'E4D9ED'},
 sandstone:{ink:'332B21',accent:'845A2B',bright:'EED4A3',paper:'FAF7EF',text:'40372A',muted:'726653',rule:'E2DAC8'},
 cherry:{ink:'351D2A',accent:'A22D50',bright:'FFBDD2',paper:'FCF5F7',text:'482638',muted:'7D5D6B',rule:'EBD4DD'},
 arctic:{ink:'172F3B',accent:'326779',bright:'ADDDEA',paper:'F2F8FB',text:'253E49',muted:'566E7A',rule:'D2E2EA'},
 olive:{ink:'292E1F',accent:'62682F',bright:'DAE2A4',paper:'F8F9F0',text:'373D28',muted:'646B4D',rule:'DFE2CB'},
 graphite:{ink:'23262B',accent:'4D5560',bright:'D5DCE6',paper:'F6F7F9',text:'2D333B',muted:'646D79',rule:'DDE1E7'},
 espresso:{ink:'30221D',accent:'855038',bright:'F3CBAD',paper:'FCF6F0',text:'422E25',muted:'786151',rule:'E9D9CB'},
};
const runs=v=>typeof v==='string'?[{text:v}]:v;
const rich=v=>runs(v).map(r=>({text:r.text,options:{...(r.bold?{bold:true}:{}),...(r.italic?{italic:true}:{}),...(r.underline?{underline:{style:'sng'}}:{}),...(r.color?{color:r.color}:{})}}));
const plain=v=>runs(v).map(r=>r.text).join('');
// Conservative width/line estimates are shared by export and preview. Do not
// depend on Office's deferred auto-fit, which differs across viewers.
export function fittedFont(value,w,h,size,bold=false){
 const text=plain(value),weight=c=>/[MW@#%]/.test(c)?.92:/[ilI.,'!| ]/.test(c)?.29:/[A-Z0-9]/.test(c)?.66:/[^\x00-\xff]/.test(c)?1:.56;
 const width=s=>[...s].reduce((n,c)=>n+weight(c),0)*(bold?1.06:1);
 for(let f=size;f>=8;f-=.5){
  const capacity=w*72/f*.96;let lines=0;
  for(const paragraph of text.split('\n')){let used=0;lines++;
   for(const word of paragraph.split(/\s+/)){const units=width(word);if(used&&used+units+.3>capacity){lines++;used=0;}const extra=Math.max(0,Math.ceil(units/capacity)-1);lines+=extra;used=(extra?units-extra*capacity:used+units)+.3;}
  }
  if(lines*f*1.22<=h*72*.95)return f;
 }
 return 8;
}
export async function generatePresentation(spec,{images={},preview=false}={}){
 const deck=preview?new PresentationPreview():new PptxGenJS(),t=THEMES[spec.theme]||THEMES.midnight;deck.layout='LAYOUT_WIDE';deck.author='Orbit';deck.title=spec.title;deck.subject=spec.title;deck.lang='en-US';deck.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:'en-US'};
 const W=13.333,H=7.5,M=.72;
 spec.slides.forEach(s=>{
  const startIndex=deck.slides.length;
  const slide=deck.addSlide();
  const layout=s.layout==='auto'||!s.layout?(s.image?'visual':s.columns?'split':s.metrics?'metrics':s.steps?'timeline':s.quote?'quote':'bullets'):s.layout;
  const tone=s.tone==='auto'||!s.tone?(['cover','section'].includes(layout)?'dark':'light'):s.tone;
  const dark=tone!=='light',bg=tone==='accent'?t.accent:dark?t.ink:t.paper,fg=dark?'FFFFFF':t.text,muted=tone==='accent'?'FFFFFF':dark?'D9DDE9':t.muted,accent=tone==='accent'?'FFFFFF':dark?t.bright:t.accent;
  slide.background={color:bg};
  const txt=(v,x,y,w,h,size=20,options={})=>slide.addText(typeof v==='string'?v:rich(v),{x,y,w,h,fontFace:'Arial',fontSize:options.fit==='shrink'?fittedFont(v,w,h,size,options.bold):size,color:fg,margin:0,breakLine:false,valign:'top',...options});
  const line=(x,y,w,color=t.rule)=>slide.addShape(deck.ShapeType.line,{x,y,w,h:0,line:{color,width:1}});
  const kicker=s.kicker || (layout==='cover'?'':spec.title);
  txt(kicker,M,.34,10.7,.3,10,{color:muted,charSpacing:1.7,bold:true});
  line(M,6.94,W-2*M,dark?'576072':t.rule);
  const titleSize=s.title.length>110?28:s.title.length>75?32:36;
  const mainTitle=(y=1.03)=>txt(s.title,M,y,W-2*M,1.12,titleSize,{fontFace:'Arial',bold:true,fit:'shrink',lineSpacingMultiple:1.02});
  if(layout==='cover'||layout==='section'){
   txt(s.title,M,1.6,10.9,2.2,s.title.length>95?38:48,{fontFace:'Arial',bold:true,fit:'shrink',lineSpacingMultiple:1.03});
   line(M,4.14,1.05,accent);
   const details=[s.subtitle,...s.bullets.map(plain)].filter(Boolean).join('\n');
   txt(details,M,4.48,10.3,1.7,23,{color:muted,fit:'shrink',paraSpaceAfterPt:12});
  }else{
   mainTitle();
   if(s.subtitle)txt(s.subtitle,M,2.12,W-2*M,.64,16,{color:muted,fit:'shrink'});
   const top=s.subtitle?2.95:2.65,bottom=6.67,available=bottom-top;
   if(s.image){
    const v=images[s.image.assetId];if(!v?.dataUrl)throw Error('An uploaded or generated visual is unavailable.');
    const ratio=v.width/v.height,side=!!s.bullets.length&&ratio<=2.8;
    const bulletArea=side?available:Math.min(available*.5,s.bullets.length*.6),bulletRow=bulletArea/Math.max(1,s.bullets.length);
    const box={x:side?5.45:M,y:top+(side?0:bulletArea),w:side?7.14:W-2*M,h:available-(s.image.caption?.length ? .7 : 0)-(side?0:bulletArea)};
    const scale=Math.min(1/96,box.w/v.width,box.h/v.height),iw=v.width*scale,ih=v.height*scale;
    slide.addImage({data:v.dataUrl,x:box.x+(box.w-iw)/2,y:box.y+(box.h-ih)/2,w:iw,h:ih,altText:s.image.caption||v.label||s.title});
    if(s.image.caption)txt(s.image.caption,box.x,bottom-.57,box.w,.53,12,{color:muted,align:'center',fit:'shrink'});
    s.bullets.forEach((b,i)=>{txt('•',M,top+i*bulletRow,.3,.4,18,{color:accent});txt(b,M+.55,top+i*bulletRow,side?3.8:10.8,Math.max(.2,bulletRow-.08),18,{fit:'shrink'});});
   }else if(s.columns){
    const gap=.55,w=(W-2*M-gap*(s.columns.length-1))/s.columns.length;
    s.columns.forEach((c,i)=>{const x=M+i*(w+gap);line(x,top,w,accent);txt(c.title,x,top+.27,w,.75,23,{bold:true,fit:'shrink'});txt(c.body,x,top+1.16,w,available-1.2,19,{color:muted,fit:'shrink',paraSpaceAfterPt:12});});
   }else if(s.metrics){
    const gap=.4,w=(W-2*M-gap*(s.metrics.length-1))/s.metrics.length;
    s.metrics.forEach((m,i)=>{const x=M+i*(w+gap);txt(m.value,x,top+.18,w,1.13,Math.min(/^[\d\s.,%+−–×x:/-]+$/.test(m.value)?50:28, w*72/(Math.max(...m.value.split(/\s+/).map(x=>x.length))*0.68)),{color:accent,bold:true,fit:'shrink'});txt(m.label,x,top+1.56,w,.82,21,{bold:true,fit:'shrink'});line(x,top+2.59,w);if(m.detail)txt(m.detail,x,top+2.87,w,Math.max(.65,available-2.87),15,{color:muted,fit:'shrink'});});
   }else if(s.steps){
    const gap=.35,w=(W-2*M-gap*(s.steps.length-1))/s.steps.length;
    line(M,top+.42,W-2*M,dark?'576072':t.rule);
    s.steps.forEach((step,i)=>{const x=M+i*(w+gap);txt(String(i+1).padStart(2,'0'),x,top,w,.5,25,{color:accent,bold:true,fill:{color:bg}});txt(step.title,x,top+.93,w,.86,21,{bold:true,fit:'shrink'});txt(step.body,x,top+1.99,w,available-2,17,{color:muted,fit:'shrink'});});
   }else if(s.quote){
    txt('“',M,top-.32,1.2,1.15,84,{color:accent,fontFace:'Georgia'});
    txt(s.quote,M+1.08,top+.23,10.1,2.35,s.quote.length>220?27:34,{fontFace:'Arial',fit:'shrink'});
    if(s.attribution)txt(s.attribution,M+1.08,bottom-.55,10.1,.5,16,{color:muted,fit:'shrink'});
   }else if(s.table){
    const rows=[s.table.headers,...s.table.rows].map((row,i)=>row.map(value=>({text:rich(value),options:{bold:i===0,color:i===0?'FFFFFF':t.text,fill:i===0?t.accent:i%2?'FFFFFF':t.paper}})));
    const rowH=Math.min(.65,available/(s.bullets.length+2));
    s.bullets.forEach((b,i)=>txt(b,M,top+i*rowH,W-2*M,rowH-.05,18,{fit:'shrink'}));
    slide.addTable(rows,{x:M,y:top+s.bullets.length*rowH,w:W-2*M,fontFace:'Arial',fontSize:15,border:{type:'solid',pt:.5,color:t.rule},margin:.12,slideMargin:[.8,.72,1.5,.72],autoPageLineWeight:1,autoPage:true,autoPageRepeatHeader:true,autoPageHeaderRows:1,autoPageSlideStartY:.8});
   }else{
    const rowH=available/Math.max(s.bullets.length,1);
    s.bullets.forEach((b,i)=>{const y=top+i*rowH;txt('•',M,y+.02,.3,.42,21,{color:accent});txt(b,M+.7,y,W-2*M-.7,rowH-.22,s.bullets.length>4?21:25,{fit:'shrink',paraSpaceAfterPt:12});if(i<s.bullets.length-1)line(M+.7,y+rowH-.12,W-2*M-.7,dark?'576072':t.rule);});
   }
  }
  deck.slides.slice(startIndex).forEach((page,offset)=>{
   if(offset){page.background={color:bg};page.addText(s.title+' · continued',{x:M,y:.34,w:W-2*M,h:.3,fontFace:'Arial',fontSize:11,color:muted,margin:0,fit:'shrink'});page.addShape(deck.ShapeType.line,{x:M,y:6.94,w:W-2*M,h:0,line:{color:dark?'576072':t.rule,width:1}});}
   page.addText(String(startIndex+offset+1).padStart(2,'0'),{x:W-M-.5,y:7.07,w:.5,h:.18,fontFace:'Arial',fontSize:9,color:muted,margin:0,align:'right'});
   if(s.notes)page.addNotes(s.notes);
  });
 });
 return deck.write({outputType:'blob'});
}

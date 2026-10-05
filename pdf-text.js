import coverage from './document-font-coverage.js';
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
const supported=(font,style,code)=>{
 const ranges=coverage[font]?.[style]||[];let low=0,high=ranges.length-1;
 while(low<=high){const mid=(low+high)>>1,[start,end]=ranges[mid];if(code<start)high=mid-1;else if(code>end)low=mid+1;else return true;}
 return code===10||code===13||code===9;
};
const contains=(font,style,text)=>{for(const c of text)if(!supported(font,style,c.codePointAt(0)))return false;return true;};
function clusters(text){
 if(segmenter)return [...segmenter.segment(text)].map(s=>s.segment);
 const result=[];for(const c of text){if(/\p{Mark}/u.test(c)&&result.length)result[result.length-1]+=c;else result.push(c);}return result;
}
// Preserve exact text and styles. A base letter and its combining marks must
// use one font together; choosing fonts one code point at a time detaches accents.
export function pdfStyledText(value,font='Roboto'){
 const runs=typeof value==='string'?[{text:value}]:value;
 return runs.flatMap(run=>{
  const style=run.bold?(run.italic?'bolditalics':'bold'):(run.italic?'italics':'normal');
  const props={...(run.bold?{bold:true}:{}),...(run.italic?{italics:true}:{}),...(run.underline?{decoration:'underline'}:{}),...(run.color?{color:'#'+run.color}:{})};
  if(contains(font,style,run.text))return [{text:run.text,...props}];
  const result=[];
  for(const cluster of clusters(run.text)){
   const selected=contains(font,style,cluster)?font:contains('Symbols',style,cluster)?'Symbols':contains('Roboto',style,cluster)?'Roboto':font;
   const last=result.at(-1);
   if(last?.font===selected)last.text+=cluster;else result.push({text:cluster,font:selected,...props});
  }
  return result;
 });
}

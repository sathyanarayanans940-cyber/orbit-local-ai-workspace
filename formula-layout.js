/* Presentation only: keep the saved recipe and mathematical text unchanged.
   Conditions belong below their formula, never at a guessed tab stop. */
const runs=value=>typeof value==='string'?[{text:value}]:value;
const plain=value=>runs(value).map(r=>r.text).join('');
function sliceRuns(value,start,end){
 let offset=0;const result=[];
 for(const run of value){const next=offset+run.text.length,left=Math.max(start,offset),right=Math.min(end,next);
  if(right>left)result.push({...run,text:run.text.slice(left-offset,right-offset)});
  offset=next;
 }
 return result;
}
function conditionBoundary(text){
 const brackets=[];let quote='';
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quote){if(c===quote&&text[i-1]!=='\\')quote='';continue;}
  if(c==='"'){quote=c;continue;}
  if('([{'.includes(c)){brackets.push(c);continue;}
  if(')]}'.includes(c)){if(brackets.pop()!==({')':'(',']':'[','}':'{'})[c])return null;continue;}
  if(brackets.length||!/[ \t]/.test(c))continue;
  let end=i;while(/[ \t]/.test(text[end]||'\n'))end++;
  if(!/^(?:if|when)\s+\S/i.test(text.slice(end))){i=end-1;continue;}
  const formula=text.slice(0,i).trim();
  if(/[=<>≤≥≈≠]/.test(formula)&&!/[=+−\-×*/^,]$/.test(formula))return {end:i,start:end};
  i=end-1;
 }
 return null;
}
export function formulaRows(block){
 if(block.condition)return [{text:block.text,condition:block.condition}];
 const lines=[[]];
 for(const run of runs(block.text)){
  const parts=run.text.replace(/\r\n?/g,'\n').split('\n');
  parts.forEach((part,index)=>{if(index)lines.push([]);if(part)lines.at(-1).push({...run,text:part});});
 }
 const rows=lines.map(line=>{
  const text=plain(line),boundary=conditionBoundary(text);
  return boundary?{text:sliceRuns(line,0,boundary.end),condition:sliceRuns(line,boundary.start,text.length)}:{text:line};
 });
 // Preserve ordinary multiline working as one paragraph, including rich text,
 // explicit blank lines and existing equality-step layout.
 if(!rows.some(row=>row.condition))return [{text:block.text}];
 return rows.filter(row=>plain(row.text).trim()||row.condition);
}
export function shortFormulaRow(row,caption=''){
 return [row.text,row.condition||'',caption].flatMap(value=>plain(value).split('\n')).reduce((lines,line)=>lines+Math.max(1,Math.ceil(line.length/60)),0)<=24;
}

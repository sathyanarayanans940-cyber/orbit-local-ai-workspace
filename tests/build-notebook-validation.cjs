// Synthetic, unexecuted files for independent validation with jupyter/nbformat.
const fs=require('node:fs/promises'),path=require('node:path'),W=require('../widgets.js');
const dir=path.join(__dirname,'output/notebooks');
(async()=>{
 await fs.mkdir(dir,{recursive:true});
 const cell=(type,source,extra={})=>({cell_type:type,source,...extra});
 const cases={
  'example.ipynb':{title:'Worked example',cells:[cell('markdown','# Data analysis\n\nCalculate the mean.'),cell('code','values = [10, 20, 30]\nmean = sum(values) / len(values)\nprint(mean)\n')]},
  'blank.ipynb':{cells:[]},
  'empty-cells.ipynb':{cells:[cell('markdown',''),cell('code',''),cell('raw','')]},
  'unicode.ipynb':{cells:[cell('markdown','# λ 😀 中文'),cell('code','\ufeffx = "literal \\n"\r\n\t# preserve tabs and trailing spaces  \r\n')]},
  'r-notebook.ipynb':{language:'r',kernel:{name:'ir',display_name:'R',language:'r'},cells:[cell('code','x <- c(1, 2, 3)\nmean(x)')]},
  'custom-kernel.ipynb':{language:'julia',kernel:{name:'julia-custom',display_name:'Julia custom',language:'julia'},cells:[cell('code','println(42)')]},
  'ids-and-tags.ipynb':{cells:[cell('code',''),cell('raw','',{id:'cell-1'}),cell('markdown','# Tagged',{tags:['setup','example']})]},
  'many-cells.ipynb':{cells:Array.from({length:200},(_,i)=>cell(i%2?'code':'markdown',String(i)))},
  'large-source.ipynb':{cells:Array.from({length:4},()=>cell('code','#'+ 'x'.repeat(99999)))}
 };
 for(const [filename,s]of Object.entries(cases)){const blob=await W.generate({kind:'ipynb',filename,...s});await fs.writeFile(path.join(dir,filename),Buffer.from(await blob.arrayBuffer()));}
 const zip=await W.generate({kind:'zip',filename:'notebooks.zip',entries:Object.entries(cases).map(([filename,s])=>({path:'notebooks/'+filename,file:{kind:'ipynb',filename,...s}}))});
 await fs.writeFile(path.join(dir,'notebooks.zip'),Buffer.from(await zip.arrayBuffer()));console.log('Generated '+Object.keys(cases).length+' standalone notebooks and ZIP copies.');
})();

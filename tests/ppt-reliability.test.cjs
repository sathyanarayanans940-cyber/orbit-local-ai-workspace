const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../widgets.js'),JSZip=require('jszip');
const visual={kind:'diagram',title:'AWS request path',width:800,height:450,nodes:[{id:'lb',label:'Application Load Balancer routes incoming HTTPS requests',x:220,y:150,width:140},{id:'svc',label:'Application services',x:340,y:150,width:140}],edges:[{from:'lb',to:'svc',label:'HTTPS'}],groups:[{label:'VPC',x:100,y:30,width:620,height:340}]};
const deck=v=>({kind:'pptx',title:'AWS architecture',slides:[{title:'Request path',visual:v,notes:'Preserve these notes.'}]});
test('crowded embedded AWS diagram expands without dropping content or mutating its source',()=>{
 assert.throws(()=>W.normalize(visual),/overlap/);
 const before=JSON.stringify(visual),spec=W.normalize(deck(visual)),fixed=spec.slides[0].visual;
 assert.ok(fixed.width>800);assert.equal(JSON.stringify(visual),before);
 assert.deepEqual(fixed.nodes.map(n=>[n.id,n.label]),visual.nodes.map(n=>[n.id,n.label]));
 assert.equal(fixed.edges[0].label,'HTTPS');assert.equal(fixed.groups[0].label,'VPC');
 assert.equal(spec.slides[0].notes,'Preserve these notes.');assert.deepEqual(W.normalize(spec),spec);
 assert.equal(W.extract('```orbit-widget\n'+JSON.stringify(deck(visual))+'\n```').artifacts.length,1);
});
test('embedded fit recovers circle/diamond labels, overflowing groups and explicit edge geometry',()=>{
 for(const shape of ['circle','diamond','entity']){
  const v={...visual,nodes:[{id:'lb',label:'Application Load Balancer routes incoming requests',shape,x:220,y:180,width:60,height:40,...(shape==='entity'?{attributes:['PK request_id: UUID','request_metadata: JSON']}: {})}],edges:[{from:'lb',to:'lb',label:'retry',points:[{x:440,y:150}],labelPosition:{x:420,y:100}}],groups:[{label:'Availability zone with a long heading',x:10,y:10,width:800,height:450}]};
  const fixed=W.normalize(deck(v)).slides[0].visual;assert.equal(fixed.nodes.length,1);assert.equal(fixed.nodes[0].label,v.nodes[0].label);assert.equal(fixed.edges[0].points.length,1);assert.equal(fixed.groups[0].label,v.groups[0].label);
  assert.deepEqual(W.normalize(fixed),fixed);
 }
});
test('bad graph facts, missing assets and impossible geometry remain explicit failures',async()=>{
 for(const v of [{...visual,edges:[{from:'lb',to:'missing'}]},{...visual,nodes:visual.nodes.map(n=>({...n,x:220,y:150}))},{...visual,nodes:[...visual.nodes,{...visual.nodes[0]}]}])assert.throws(()=>W.normalize(deck(v)),/Slide 1:/);
 const {generatePresentation}=await import('../presentation-engine.js');
 const spec=W.normalize({kind:'pptx',slides:[{title:'Upload',image:{assetId:'img-test'}}]});
 await assert.rejects(generatePresentation(spec),/Slide 1 \(Upload\).*unavailable/);
 for(const dimensions of [{width:0,height:10},{width:NaN,height:10},{width:10,height:Infinity},{width:-1,height:10}])await assert.rejects(generatePresentation(spec,{images:{'img-test':{dataUrl:'data:image/png;base64,AA==',...dimensions}}}),/invalid data or dimensions/);
});
test('repaired recipes export editable slide text, notes and all embedded media across repeated runs',async()=>{
 const {generate}=await import('../widgets-engine.js');
 const image={dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6r5kAAAAASUVORK5CYII=',width:1,height:1};
 const spec=W.normalize({...deck(visual),slides:Array.from({length:40},(_,i)=>({...deck(visual).slides[0],title:'AWS slide '+(i+1)}))});
 for(let run=0;run<4;run++){
  const blob=await generate(spec,{visuals:Object.fromEntries(spec.slides.map((_,i)=>[i,image]))}),zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const slides=Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p));assert.equal(slides.length,40);
  for(let i=1;i<=40;i++){const xml=await zip.file(`ppt/slides/slide${i}.xml`).async('string');assert.match(xml,/<p:pic>/);assert.ok(xml.includes('AWS slide '+i));assert.doesNotMatch(xml,/NaN|Infinity|undefined/);assert.match(await zip.file(`ppt/notesSlides/notesSlide${i}.xml`).async('string'),/Preserve these notes/);}
 }
});
test('rasterizer bounds allocations, retries resource failure and releases every canvas and URL',async()=>{
 const {rasterizeSvg}=await import('../svg-raster.js');const original={Image:global.Image,document:global.document,URL:global.URL};
 try{
  for(const mode of ['ok','retry','no-context','decode','timeout']){
   const canvases=[],images=[];let revokes=0;
   global.URL={createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revokes++};
   global.Image=class{constructor(){images.push(this);}set src(v){this.value=v;if(v&&mode!=='timeout')queueMicrotask(()=>mode==='decode'?this.onerror?.():this.onload?.());}};
   global.document={createElement:()=>{const c={width:0,height:0,getContext(){return mode==='no-context'?null:{fillRect(){},drawImage(){assert.ok(c.width*c.height<=4000000);}};},toDataURL(){return mode==='retry'&&canvases.length===1?'data:,':'data:image/png;base64,AA==';}};canvases.push(c);return c;}};
   const pending=rasterizeSvg('<svg/>',2400,4000,{timeout:10});
   if(['decode','timeout','no-context'].includes(mode))await assert.rejects(pending,/decoded|timed out|unavailable/);else{const image=await pending;assert.ok(image.width*image.height<=4000000);if(mode==='retry'){assert.equal(canvases.length,2);assert.ok(image.width*image.height<=1000000);}}
   assert.equal(revokes,1);assert.ok(canvases.every(c=>c.width===0&&c.height===0));assert.equal(images[0].value,'');
  }
  await assert.rejects(rasterizeSvg('<svg/>',0,20),/dimensions/);
 }finally{Object.assign(global,original);}
});
test('lazy engine resolves from the script URL and can recover from a failed or incomplete load',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const scripts=[];const ctx={URL,OrbitArchives:{},document:{currentScript:{src:'https://orbit.example/widgets.js?v=58'},createElement:()=>({remove(){}}),head:{appendChild(script){scripts.push(script);}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('widgets.js','utf8'),ctx);
 let pending=ctx.OrbitWidgets.engine();assert.equal(scripts[0].src,'https://orbit.example/vendor/widgets/engine.js?v=28');scripts[0].onerror();await assert.rejects(pending,/could not load/);
 pending=ctx.OrbitWidgets.engine();scripts[1].onload();await assert.rejects(pending,/could not load/);
 pending=ctx.OrbitWidgets.engine();ctx.OrbitWidgetEngine={generate(){},rasterizeSvg(){}};scripts[2].onload();assert.equal(await pending,ctx.OrbitWidgetEngine);
});

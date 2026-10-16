const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),JSZip=require('jszip');
const W=require('../widgets.js'),{modernDeck}=require('./modern-deck-fixture.js');
const luminance=hex=>hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('all twenty-two themes are offered to the model, normalized, rendered and previewed',async()=>{
 const {THEMES}=await import('../presentation-engine.js');assert.equal(Object.keys(THEMES).length,22);assert.deepEqual(Object.keys(W.presentationThemes),Object.keys(THEMES));
 const css=fs.readFileSync('styles.css','utf8'),planner=fs.readFileSync('long-documents.js','utf8');
 for(const [name,t] of Object.entries(THEMES)){
  assert.equal(W.normalize({...modernDeck,theme:name}).theme,name);assert.match(W.instruction(),new RegExp(name+' \\('));assert.ok(planner.includes(name));
  if(name!=='midnight'){const rule=css.match(new RegExp('\\.modern-slide\\.theme-'+name+' \\{([^}]+)'))?.[1];assert.ok(rule,name+' preview');assert.ok(rule.toUpperCase().includes(t.accent));}
  for(const [fg,bg,min] of [[t.text,t.paper,7],[t.muted,t.paper,4.5],['FFFFFF',t.ink,7],['FFFFFF',t.accent,4.5],[t.bright,t.ink,4.5]])assert.ok(contrast(fg,bg)>=min,`${name}: ${fg}/${bg} = ${contrast(fg,bg)}`);
 }
 assert.equal(W.normalize({...modernDeck,theme:'nonexistent'}).theme,'midnight');
});
test('every theme exports every layout in all three tones without missing content',async()=>{
 const {generate}=await import('../widgets-engine.js');
 const base=modernDeck.slides.filter(s=>!s.visual);
 for(const theme of Object.keys(W.presentationThemes)){
  const spec=W.normalize({...modernDeck,theme,slides:['light','dark','accent'].flatMap(tone=>base.map(s=>({...s,tone})))});
  const blob=await generate(spec),zip=await JSZip.loadAsync(await blob.arrayBuffer());const slides=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));assert.equal(slides.length,24,theme);
  for(const name of slides){const xml=await zip.file(name).async('string');assert.ok(!/NaN|Infinity|undefined/.test(xml),theme+name);assert.match(xml,/Arial/);}
 }
});
test('new palette colors reach both native slide backgrounds and exact-layout previews',async()=>{
 const {THEMES,generatePresentation}=await import('../presentation-engine.js');
 for(const theme of ['porcelain','blueprint','sage','aurora','goldleaf','orchid','vermilion','slate']){
  const t=THEMES[theme],spec=W.normalize({kind:'pptx',title:'Palette check',theme,slides:['light','dark','accent'].map(tone=>({title:'Readable '+tone,tone,bullets:['Keep the supplied content.']}))});
  const zip=await JSZip.loadAsync(await (await generatePresentation(spec)).arrayBuffer()),preview=await generatePresentation(spec,{preview:true});
  for(const [i,color] of [t.paper,t.ink,t.accent].entries()){
   const xml=await zip.file(`ppt/slides/slide${i+1}.xml`).async('string');assert.ok(xml.includes(`<a:srgbClr val="${color}"`),theme+' exported background');assert.ok(preview.includes('background:#'+color),theme+' preview background');assert.ok(xml.includes('Keep the supplied content.'));
  }
 }
});

const W=require('../widgets.js'),fs=require('node:fs');
(async()=>{const {generate}=await import('../widgets-engine.js');
 const phrase=(s,n)=>(s+' ').repeat(Math.ceil(n/(s.length+1))).slice(0,n);
 const slides=[
 {layout:'cover',title:phrase('A detailed project proposal with a deliberately long but meaningful heading',180),subtitle:phrase('Context for the project and the decisions needed for implementation',320)},
 {layout:'split',title:'Three detailed workstreams',columns:Array.from({length:3},(_,i)=>({title:phrase('Workstream '+(i+1)+' ownership and implementation',80),body:phrase('Preserve evidence, validate behavior, identify ownership and review the supplied source material before accepting a result.',400)}))},
 {layout:'metrics',tone:'accent',title:'Long labels and supporting detail',metrics:Array.from({length:4},(_,i)=>({value:phrase('Target '+i,30),label:phrase('Illustrative target description',70),detail:phrase('Planning assumptions supplied for layout testing only; these are not measured results.',160)}))},
 {layout:'timeline',tone:'dark',title:'Five dense stages',steps:Array.from({length:5},(_,i)=>({title:phrase('Stage '+(i+1)+' development and review',60),body:phrase('Discuss requirements, implement changes, collect evidence and review each result with the project owner.',220)}))},
 {title:'Six maximum-length points',bullets:Array.from({length:6},(_,i)=>phrase('Point '+(i+1)+': preserve the actual source material and explain the reasoning clearly. Include concrete evidence and make the required decisions easy to identify.',240))}
 ];
 const spec=W.normalize({kind:'pptx',theme:'forest',title:'Dense layout stress fixture',slides});const blob=await generate(spec);fs.writeFileSync('tests/output/document-vision/theme-stress.pptx',Buffer.from(await blob.arrayBuffer()));
})();

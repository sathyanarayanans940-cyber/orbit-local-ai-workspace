const fs=require('node:fs'),vm=require('node:vm'),W=require('../widgets.js'),cases=require('./fixtures/diagram-stress.cjs');
const out='tests/output/diagram-stress';fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync('app.js','utf8');
const ctx=vm.createContext({OrbitWidgets:W,window:{katex:require('../vendor/katex/katex.min.js')},icons:{copy:''},state:{currentChat:'stress'},crypto:require('node:crypto').webcrypto});
vm.runInContext(source.slice(source.indexOf('function escapeHtml('),source.indexOf('function latestUserMessageIndex(')),ctx);
vm.runInContext(fs.readFileSync('widgets-ui.js','utf8'),ctx);
vm.runInContext('attachmentFileKind=()=>({});',ctx);
const write=(name,title,html,message,fit=true,theme='dark')=>{
 fs.writeFileSync(`${out}/${name}.html`,`<!doctype html><html data-theme="${theme}" style="--diagram-accent:${theme==='light'?'#4c1d95':'#c4b5fd'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${W.escape(title)}</title><link rel="stylesheet" href="/styles.css"><style>html,body{height:auto;overflow:auto}main.app-shell{display:block;height:auto;max-width:1180px;margin:12px auto;padding:20px}h1{font-size:19px;margin:0}p.audit-note{margin:8px 0;font-size:13px;color:var(--text-secondary)}${fit?'.audit-fit .diagram-plot>svg{min-width:0!important;max-width:100%!important;width:100%;max-height:520px}':''}</style><main class="app-shell ${fit?'audit-fit':''}"><h1>${W.escape(title)}</h1><p class="audit-note">${fit?'Overview / visual audit. Large diagrams are inspected separately at native size.':'Production inline rendering · scroll wide diagrams or expand.'}</p>${html}</main><script src="/widgets.js?stress=3"></script><script>const state=${JSON.stringify({messages:[message]}).replace(/</g,'\\u003c')};const widgetBlobs=new Map();const escapeHtml=OrbitWidgets.escape;</script><script src="/file-preview.js"></script></html>`);
};
const manifest=[];
for(const {id,spec} of cases){
 const message={role:'assistant',text:'',artifacts:[{id:'stress-'+id,spec:W.normalize(spec)}]};
 const html=ctx.messageContentMarkup(message,0);
 for(const theme of ['dark','light'])write(id+'-'+theme,spec.title,html,message,true,theme);
 write(id+'-native',spec.title,html,message,false);
 const tiles=[];
 if(spec.nodes.length>=24 || spec.height>=1400 || spec.width>=1800){
  const svg=W.diagramSvg(spec);const [vx,vy,vw,vh]=svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  for(let y=vy,iy=0;y<vy+vh;y+=640,iy++)for(let x=vx,ix=0;x<vx+vw;x+=1040,ix++){
   const name=`${id}-tile-${ix}-${iy}`;
   const view=svg.replace(/viewBox="[^"]+"/,`viewBox="${x} ${y} ${Math.min(1040,vx+vw-x)} ${Math.min(640,vy+vh-y)}"`).replace(/width="[^"]+" height="[^"]+" role=/,'width="1040" height="640" role=');
   write(name,`${spec.title} · tile ${ix+1},${iy+1}`,`<figure class="orbit-diagram"><div class="diagram-plot">${view}</div></figure>`,message);
   tiles.push(name);
  }
 }
 manifest.push({id,title:spec.title,nodes:spec.nodes.length,edges:spec.edges.length,groups:spec.groups?.length||0,tiles});
}
const sequence={role:'assistant',text:Array.from({length:32},(_,i)=>`### Snapshot ${i+1}\nThis is independent snapshot ${i+1}.\n\n`).join(''),artifacts:[]};
let pos=0;for(let i=0;i<32;i++){pos+=`### Snapshot ${i+1}\nThis is independent snapshot ${i+1}.\n\n`.length;sequence.artifacts.push({id:'sequence-'+i,spec:W.normalize({...cases[i%cases.length].spec,title:'Snapshot '+(i+1)}),position:pos});}
write('sequence','32 interleaved diagram snapshots',ctx.messageContentMarkup(sequence,0),sequence,false);
fs.writeFileSync(`${out}/manifest.json`,JSON.stringify(manifest,null,2));
console.log('Built '+manifest.length+' cases and '+manifest.reduce((n,c)=>n+c.tiles.length,0)+' native-detail tiles.');
// Screenshot evidence can be opened directly from disk without a running server.
fs.writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>Orbit diagram stress audit</title><style>body{margin:36px;background:#171717;color:#eee;font:16px system-ui;line-height:1.5}main{max-width:1200px;margin:auto}h1{font-size:30px}h2{font-size:20px}a{color:#c4b5fd}img{width:100%;border:1px solid #444;border-radius:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}section{margin:40px 0}details{margin:16px 0}summary{cursor:pointer}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><main><h1>Orbit diagram stress audit</h1><p>18 scenarios · 79 inspected detail views · dark and light themes. Overview images show structure; expand the detail screenshots to inspect large diagrams at readable scale.</p>${manifest.map(c=>`<section><h2>${W.escape(c.title)}</h2><p>${c.nodes} nodes · ${c.edges} connections · ${c.groups} containers</p><div class="pair">${['dark','light'].map(t=>`<a href="${c.id}-${t}.png"><img loading="lazy" src="${c.id}-${t}.png" alt="${W.escape(c.title)} in ${t} mode"></a>`).join('')}</div>${c.tiles.length?`<details><summary>${c.tiles.length} detail screenshots</summary>${c.tiles.map(t=>`<a href="${t}.png"><img loading="lazy" src="${t}.png" alt="${t}"></a>`).join('')}</details>`:''}</section>`).join('')}</main>`);

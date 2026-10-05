const fs=require('node:fs'),W=require('../widgets.js'),fixtures=require('./fixtures/diagram-notation.cjs');
const dir='tests/output/diagram-notation';fs.mkdirSync(dir,{recursive:true});
for(const [id,spec] of Object.entries(fixtures))for(const theme of ['dark','light']){
 fs.writeFileSync(`${dir}/${id}-${theme}.html`,`<!doctype html><html data-theme="${theme}" style="--diagram-accent:${theme==='dark'?'#c4b5fd':'#6d28d9'}"><meta charset="utf-8"><title>${W.escape(spec.title)}</title><link rel="stylesheet" href="/styles.css"><style>body{height:auto;overflow:auto;padding:24px;max-width:1150px;margin:auto}h1{font:600 20px system-ui}svg{display:block;width:100%;height:auto;max-height:1050px}p{font:14px system-ui;color:var(--text-secondary)}</style><h1>${W.escape(spec.title)}</h1><p>Optional fills · live chat accent · ${theme} theme</p><figure class="orbit-diagram"><div class="diagram-plot">${W.diagramSvg(spec)}</div></figure></html>`);
}

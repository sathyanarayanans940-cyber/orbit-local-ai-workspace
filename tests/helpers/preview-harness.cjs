const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../../file-preview.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function previewHarness(reader={},options={}) {
 const controls={},revoked=[],windowEvents={};
 function node(tag='div') {
  const classes=new Set();
  const n={tag,tagName:tag.toUpperCase(),style:{},dataset:{},children:[],textContent:'',disabled:false,
   classList:{contains:v=>classes.has(v),toggle(v,on){if(on)classes.add(v);else classes.delete(v);},add:v=>classes.add(v),remove:v=>classes.delete(v)},
   attributes:{},setAttribute(name,value){this.attributes[name]=String(value);},getAttribute(name){return this.attributes[name]??null;},removeAttribute(name){delete this.attributes[name];},focus(){document.activeElement=this;},getContext:()=>({}),click(){return this.disabled?undefined:this.onclick?.();},
   appendChild(item){item.parentNode=this;this.children.push(item);return item;},append(...items){items.forEach(item=>this.appendChild(item));},remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;},
   replaceChildren(...items){this.textContent='';this.children=items;},querySelector(sel){const descendants=this.children.flatMap(child=>[child,...allChildren(child)]);if(sel.startsWith('#viewer-tab-'))return descendants.find(child=>child.id===sel.slice(1))||null;if(sel==='iframe[data-word-preview]')return descendants.find(child=>child.tag==='iframe'&&child.dataset.wordPreview)||null;return controls[sel] ||= node();},querySelectorAll(sel){return sel==='[data-preview-zoom]'?zoomButtons:[];}};
  let text='';Object.defineProperty(n,'textContent',{get:()=>text,set:value=>{text=value;n.children=[];}});
  Object.defineProperty(n,'firstElementChild',{get:()=>n.children[0]});return n;
 }
 function allChildren(n){return n.children.flatMap(child=>[child,...allChildren(child)]);}
 let panel;
 const shell=node(),toggle=node('button'),zoomButtons=[node('button'),node('button')];zoomButtons[0].dataset.previewZoom='-1';zoomButtons[1].dataset.previewZoom='1';
 const document={baseURI:'http://localhost/',activeElement:null,body:node(),
  createElement(tag){const result=node(tag);if(tag==='section'&&!panel)panel=result;return result;},querySelector:sel=>sel==='#open-viewer'?toggle:shell,addEventListener(){}};
 const ctx=vm.createContext({document,window:{pdfjsLib:{GlobalWorkerOptions:{},...reader},dispatchEvent(){},addEventListener(name,listener){windowEvents[name]=listener;}},Event:function(){},matchMedia:()=>({matches:false}),
  URL:Object.assign(class extends URL {},{createObjectURL:()=> 'blob:pdf-fixture',revokeObjectURL:url=>revoked.push(url)}),Blob,
  isDocxFile:()=>false,isSpreadsheetFile:()=>false,isImageFile:()=>false,isPdfFile:()=>true,escapeHtml:s=>s,console,setTimeout,TextDecoder,...options.globals});
 vm.runInContext(source+'\nglobalThis.preview=OrbitPreview;',ctx);
 const host=controls['#preview-body'],activeBody=()=>host.children.find(n=>n.className==='preview-pane'&&!n.hidden)||host;
 return {preview:ctx.preview,controls,revoked,document,toggle,zoomButtons,ctx,host,windowEvents,get panes(){return host.children.filter(n=>n.className==='preview-pane');},get tabs(){return controls['#preview-tabs'].children.map(item=>item.children[0]);},get panel(){return panel;},get body(){return activeBody();},
  open:async(name='test.pdf')=>ctx.preview.show({attachment:{name,file:new Blob(['%PDF-1.7'])}}),
  fallback:()=>activeBody().children.find(n=>n.className==='preview-pdf-fallback')};
}
function fakePage({render=()=>Promise.resolve()}={}) {
 return {cleaned:0,rendered:0,getViewport:({scale})=>({width:1000*scale,height:1500*scale}),
  render(){this.rendered++;return {promise:render(),cancel(){}};},cleanup(){this.cleaned++;}};
}
module.exports={previewHarness,deferred,flush,fakePage};

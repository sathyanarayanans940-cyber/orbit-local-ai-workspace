const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../custom-theme.js');
function harness(initial){
 const nodes=new Map(),data=new Map(initial?[['orbit-custom-theme-v1',JSON.stringify(initial)]]:[]),root={dataset:{},setAttribute(k,v){this.dataset[k]=v;},toggleAttribute(k,on){if(on)this.dataset[k]='';else delete this.dataset[k];}};
 function node(){return {value:'',checked:false,disabled:false,hidden:false,children:[],dataset:{},style:{setProperty(){}},setAttribute(){},focus(){},setCustomValidity(v){this.error=v;},reportValidity(){return !this.error;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},querySelectorAll(){return this.children.flatMap(row=>row.children.filter(n=>n.type==='text'));}};}
 const document={documentElement:root,head:node(),getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
 const sync=[],localStorage={getItem:k=>data.get(k)||null,setItem(k,v){if(localStorage.fail)throw Error('Quota');data.set(k,v);}};
 const window={document,localStorage,OrbitAppearance:{sync(...args){sync.push(args);}}};
 const ctx=vm.createContext({window,document,getComputedStyle:()=>({getPropertyValue:()=> '#ffffff'})});vm.runInContext(fs.readFileSync('custom-theme.js','utf8'),ctx);
 return {api:window.OrbitCustom,nodes,$:id=>document.getElementById(id),root,style:document.head.children[0],data,localStorage,sync};
}
test('custom palette validates color values, bounded preset names and malformed storage',()=>{
 for(const input of [null,[],{},'broken'])assert.equal(C.normalize(input).enabled,false);
 const p=C.normalize({enabled:'true',colors:{background:'red;display:none',code:'#ABCDEF'},presets:[{name:'   '},{name:'x'.repeat(90),colors:{}},{name:'Same'},{name:'same'}]});
 assert.equal(p.enabled,false);assert.equal(p.colors.background,C.defaults.background);assert.equal(p.colors.code,'#abcdef');assert.equal(p.presets.length,2);assert.equal(p.presets[0].name.length,40);
 assert.equal(C.normalize({presets:Array.from({length:100},(_,i)=>({name:'p'+i}))}).presets.length,20);
 assert.doesNotMatch(C.stylesheet(C.colors({background:'</style><script>'})),/<script>/);
});
test('enabling overrides ordinary values; cancel restores saved state; commit survives reload',()=>{
 const h=harness();h.api.begin();h.$('custom-enabled').checked=true;h.$('custom-enabled').onchange({target:h.$('custom-enabled')});
 assert.match(h.style.textContent,/--bg:#111923 !important/);assert.equal(h.root.dataset['data-custom-theme'],'on');
 const picker=h.$('custom-colors').children[2].children[1];picker.value='#123456';picker.oninput();assert.match(h.style.textContent,/--bg:#123456/);
 h.api.cancel();assert.equal(h.style.textContent,'');assert.equal(h.data.size,0);
 h.api.begin();h.$('custom-enabled').onchange({target:{checked:true}});h.api.commit();h.api.cancel();assert.ok(h.style.textContent);
 const reloaded=harness(JSON.parse(h.data.get('orbit-custom-theme-v1')));assert.ok(reloaded.style.textContent);
 reloaded.api.begin();reloaded.$('custom-enabled').onchange({target:{checked:false}});reloaded.api.commit();assert.equal(reloaded.style.textContent,'');assert.equal(JSON.parse(reloaded.data.get('orbit-custom-theme-v1')).enabled,false);
});
test('named presets are safe, replaceable and independent of active settings',()=>{
 const h=harness();h.api.begin();h.$('custom-preset-name').value='<img src=x>';h.$('custom-save-preset').onclick();
 let saved=JSON.parse(h.data.get('orbit-custom-theme-v1'));assert.equal(saved.enabled,false);assert.equal(saved.presets[0].name,'<img src=x>');assert.equal(h.$('custom-presets').children[1].textContent,'<img src=x>');
 h.$('custom-save-preset').onclick();assert.equal(JSON.parse(h.data.get('orbit-custom-theme-v1')).presets.length,1);
 h.$('custom-presets').value='0';h.$('custom-load-preset').onclick();assert.ok(h.style.textContent);h.api.cancel();assert.equal(h.style.textContent,'');
 h.api.begin();h.$('custom-presets').value='0';h.$('custom-delete-preset').onclick();assert.equal(JSON.parse(h.data.get('orbit-custom-theme-v1')).presets.length,0);
});
test('invalid hex cannot alter colors and failed storage leaves saved settings intact',()=>{
 const h=harness();h.api.begin();const row=h.$('custom-colors').children[0],hex=row.children[2];hex.value='bad';hex.oninput();assert.ok(hex.error);
 h.$('custom-preset-name').value='Bad';h.$('custom-save-preset').onclick();assert.equal(h.data.size,0);
 hex.value='#123456';hex.oninput();assert.equal(hex.error,'');h.localStorage.fail=true;h.$('custom-save-preset').onclick();assert.match(h.$('custom-status').textContent,/Could not save/);assert.equal(h.data.size,0);
 h.$('custom-enabled').onchange({target:{checked:true}});assert.throws(()=>h.api.commit(),/Quota/);h.api.cancel();assert.equal(h.style.textContent,'');
});
test('readability helper repairs all selectable text pairs and preserves chosen backgrounds',()=>{
 const h=harness({colors:Object.fromEntries(C.fields.map(([key])=>[key,'#ffffff']))});h.api.begin();h.$('custom-readable').onclick();h.api.commit();const c=JSON.parse(h.data.get('orbit-custom-theme-v1')).colors;
 for(const key of ['sidebar','background','panel','bubble','composer','code','button'])assert.equal(c[key],'#ffffff');
 for(const key of ['sidebarText','text','panelText','bubbleText','composerText','codeText','buttonText','keyword','string','comment'])assert.ok(C.contrast('#ffffff',c[key])>=4.5,key);
});

test('unfinished hex input can be left safely and cannot block disabling Custom',()=>{
 const h=harness();h.api.begin();let hex=h.$('custom-colors').children[0].children[2];hex.value='#12';hex.oninput();hex.onblur();assert.equal(hex.value,C.defaults.sidebar);assert.equal(hex.error,'');
 hex.value='bad';hex.oninput();h.$('custom-enabled').onchange({target:{checked:false}});hex=h.$('custom-colors').children[0].children[2];assert.equal(hex.value,C.defaults.sidebar);assert.ok(hex.reportValidity());h.api.commit();assert.equal(h.style.textContent,'');
});

test('generating dot color migrates existing palettes and persists independently of chat text',()=>{
 assert.equal(C.colors({text:'#123456'}).indicator,'#123456');
 const h=harness({enabled:true,colors:{text:'#123456'}});h.api.begin();
 const index=C.fields.findIndex(([key])=>key==='indicator'),picker=h.$('custom-colors').children[index].children[1];
 assert.equal(picker.value,'#123456');picker.value='#ff9900';picker.oninput();
 assert.match(h.style.textContent,/--generation-indicator-color:#ff9900 !important/);
 h.$('custom-preset-name').value='Amber dot';h.$('custom-save-preset').onclick();h.api.commit();
 const saved=JSON.parse(h.data.get('orbit-custom-theme-v1'));assert.equal(saved.colors.indicator,'#ff9900');assert.equal(saved.colors.text,'#123456');assert.equal(saved.presets[0].colors.indicator,'#ff9900');
 const reloaded=harness(saved);assert.match(reloaded.style.textContent,/--generation-indicator-color:#ff9900/);
 reloaded.api.begin();reloaded.$('custom-enabled').onchange({target:{checked:false}});reloaded.api.commit();assert.equal(reloaded.style.textContent,'');
});

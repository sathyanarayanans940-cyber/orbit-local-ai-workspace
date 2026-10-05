const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function setup(preferred='cloud',last='local'){
 const nodes=new Map();const writes=[];
 const c=vm.createContext({startupModelPending:!!preferred,startupDefaultModel:preferred,startupLastModel:last,SELECTED_MODEL_KEY:'last',state:{selectedModel:last,models:[]},$:(id)=>{if(!nodes.has(id))nodes.set(id,{classList:{toggle(){}},style:{},setAttribute(){}});return nodes.get(id);},localStorage:{setItem:(...args)=>writes.push(args)},escapeHtml:x=>x,modelSupportsVision:()=>false,modelUsesCloud:()=>false,icons:{check:'yes'},updateRuntimeStatus(){}});
 vm.runInContext(source.slice(source.indexOf('function renderModelOptions('),source.indexOf('function formatFileSize(')),c);
 return {c,writes};
}
test('default waits for discovery, then wins without intermediate persistence',()=>{
 const {c,writes}=setup();c.state.models=[{key:'local'}];c.renderModelOptions();assert.equal(c.state.selectedModel,'local');assert.equal(writes.length,0);
 c.state.models.push({key:'cloud'});c.renderModelOptions();assert.equal(c.state.selectedModel,'cloud');assert.equal(c.startupModelPending,false);
 c.finishStartupModelWait();assert.equal(c.state.selectedModel,'cloud');
});
test('timeout selects last used, unavailable last falls back, late default does not steal',()=>{
 const {c}=setup();c.state.models=[{key:'local'}];c.finishStartupModelWait();assert.equal(c.state.selectedModel,'local');
 c.state.models.push({key:'cloud'});c.renderModelOptions();assert.equal(c.state.selectedModel,'local');
 const other=setup();other.c.state.models=[{key:'other'}];other.c.finishStartupModelWait();assert.equal(other.c.state.selectedModel,'other');
});
test('manual choice cancels startup and no runtimes preserve last-used storage',()=>{
 const {c,writes}=setup();c.startupModelPending=false;c.state.models=[{key:'manual'},{key:'cloud'}];c.state.selectedModel='manual';c.finishStartupModelWait();c.renderModelOptions();assert.equal(c.state.selectedModel,'manual');
 const empty=setup();empty.c.finishStartupModelWait();assert.equal(empty.c.state.selectedModel,'demo');assert.equal(empty.writes.length,0);
 assert.match(source,/if\(startupModelPending\) window.setTimeout\(finishStartupModelWait,6000\)/);
});

test('model panel uses menu-relative placement and stays inside narrow viewports',()=>{
 const {c}=setup();
 c.window={innerWidth:1600,innerHeight:1000};
 const menu=c.$('#plus-menu'); menu.clientLeft=1;
 menu.getBoundingClientRect=()=>({left:600,right:840,top:760,bottom:900,height:140});
 const panel=c.$('#model-submenu'); panel.hidden=false;
 c.positionModelSubmenu();
 assert.equal(panel.style.maxHeight,'288px');
 assert.equal(panel.style.left,'247px'); assert.equal(panel.style.bottom,'0px');
 c.window.innerWidth=390;
 menu.getBoundingClientRect=()=>({left:24,right:264,top:400,bottom:540,height:140});
 c.positionModelSubmenu();
 assert.equal(panel.style.left,'-1px'); assert.equal(panel.style.bottom,'148px');
});
test('mobile picker stays below the fixed top bar',()=>{
 const {c}=setup();c.window={innerWidth:390,innerHeight:844};
 const menu=c.$('#plus-menu');menu.clientLeft=1;menu.getBoundingClientRect=()=>({left:26,right:266,top:321,bottom:433,height:112});
 c.$('#model-submenu').hidden=false;c.positionModelSubmenu();assert.equal(c.$('#model-submenu').style.maxHeight,'241px');
});

test('AICredits failure never silently selects another available provider',()=>{
 const key='AICredits:deepseek/deepseek-v4.1-flash';const {c}=setup('',key);
 c.state.models=[{key:'Gemini:gemini-2.5-flash',label:'Gemini',provider:'Gemini'}];c.renderModelOptions();
 assert.equal(c.state.selectedModel,key);
 assert.match(c.$('#model-menu').innerHTML,/Flash unavailable/);
 const preferred=setup(key,'Gemini:gemini-2.5-flash');preferred.c.state.models=[{key:'Gemini:gemini-2.5-flash'}];
 preferred.c.finishStartupModelWait();assert.equal(preferred.c.state.selectedModel,key);
});

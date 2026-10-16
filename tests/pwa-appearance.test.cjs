const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(theme,dark,blocked=false){
 const meta={};const element={dataset:{},removeAttribute(n){if(n==='data-theme')delete this.dataset.theme;}};
 const window={matchMedia:()=>({matches:dark}),localStorage:{getItem(){if(blocked)throw Error('Storage blocked');return theme;}}};
 const c=vm.createContext({window,document:{documentElement:element,querySelector(selector){return {setAttribute(_,v){meta[selector]=v;}};}}});
 vm.runInContext(fs.readFileSync('pwa-appearance.js','utf8'),c);return {window,meta,element};
}
test('native chrome respects explicit theme over OS preference and survives blocked storage',()=>{
 for(const [theme,os,expected]of [['dark',false,'#161616'],['light',true,'#ffffff'],['system',true,'#161616'],['system',false,'#ffffff'],['invalid',true,'#161616']]){
  const h=harness(theme,os);assert.equal(h.meta['meta[name="theme-color"]'],expected);assert.equal(h.meta['meta[name="color-scheme"]'],expected==='#161616'?'dark':'light');
 }
 assert.equal(harness(null,true,true).meta['meta[name="theme-color"]'],'#161616');
});
test('live surface changes update window tint and keep system theme semantics',()=>{
 const h=harness('dark',true);h.window.OrbitAppearance.sync('system','#202020');assert.equal(h.meta['meta[name="theme-color"]'],'#202020');assert.equal(h.element.dataset.theme,undefined);
 h.window.OrbitAppearance.sync('light','#fafafa');assert.equal(h.meta['meta[name="color-scheme"]'],'light');assert.equal(h.meta['meta[name="theme-color"]'],'#fafafa');
 h.window.OrbitAppearance.sync('dark','invalid');assert.equal(h.meta['meta[name="theme-color"]'],'#161616');
});

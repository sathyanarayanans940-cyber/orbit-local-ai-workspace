// Non-mutating production audit; writes only disposable fixtures/results.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const W=require('../widgets.js');
const results=[];
function check(name,fn){try{fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}}
const assert=require('node:assert/strict');
const chart={kind:'chart',title:'Test',chartType:'line',labels:['a','b'],series:[{name:'x',values:[0,1]}]};
check('640 document blocks accepted, 641 rejected',()=>{
 const base={kind:'docx',title:'Test',blocks:Array.from({length:640},()=>({type:'paragraph',text:'x'}))};
 assert.equal(W.normalize(base).blocks.length,640);assert.throws(()=>W.normalize({...base,blocks:[...base.blocks,base.blocks[0]]}));
});
check('40 labels and 5 series render finite SVG at extreme magnitudes',()=>{
 for(const values of [Array(40).fill(0),Array(40).fill(-1e12),Array.from({length:40},(_,i)=>i%2?1e12:-1e12)]) {
  const svg=W.chartSvg({...chart,labels:Array(40).fill('Long <script> label'),series:Array.from({length:5},()=>({name:'Series & name',values}))});
  assert.doesNotMatch(svg,/NaN|Infinity|<script>/);
 }
});
check('invalid numbers, table dimensions, and oversized content rejected',()=>{
 for(const n of [NaN,Infinity,-Infinity,1e13])assert.throws(()=>W.normalize({...chart,series:[{values:[n,0]}]}));
 assert.throws(()=>W.normalize({kind:'pdf',title:'x',blocks:[{type:'table',headers:['a'],rows:[['a','b']]}]}));
 assert.throws(()=>W.normalize({kind:'pdf',title:'x',blocks:[{type:'code',text:'x'.repeat(60001)}]}));
});
check('pathological braces cannot freeze widget extraction',()=>{
 const start=performance.now();const result=W.extract('{'.repeat(250000));assert.equal(result.artifacts.length,0);assert.ok(performance.now()-start<3000);
});
check('interrupted tool payload never creates a file',()=>{
 for(const value of ['```orbit-widget\n{"kind":"pdf"','{"kind":"docx","blocks":[','```orbit-widget\n{"kind":"pdf","title":"x","blocks":[] }'])assert.equal(W.extract(value).artifacts.length,0);
});
check('failed artifact error survives save/export normalization',()=>{
 const context={OrbitWidgets:W,crypto:require('node:crypto').webcrypto};vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),context);
 const result=context.normalizedWidgetArtifacts([{id:'failed',spec:{kind:'pdf',title:'x',blocks:[{type:'paragraph',text:'x'}]},error:'Creation failed',size:0}]);
 assert.equal(result[0].error,'Creation failed');
});
check('Windows reserved device names receive safe filenames',()=>{assert.notEqual(W.filename({title:'CON',kind:'docx'}).toUpperCase(),'CON.DOCX');});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-install-audit-'));
const staged=path.join(root,'space & unicode Ω');
check('macOS staged install and reinstall with spaces/unicode',()=>{
 for(let i=0;i<2;i++) {
  const result=spawnSync('bash',['install-macos.sh','--staging-dir',staged],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr);
 }
 const hosts=fs.readFileSync(path.join(staged,'hosts'),'utf8');
 assert.equal(hosts.match(/^127\.0\.0\.1 orbit\.com$/gm).length,1);assert.equal(hosts.match(/^::1 orbit\.com$/gm).length,1);
 const sw=fs.readFileSync(path.join(staged,'Orbit/service-worker.js'),'utf8');
 const assets=[...sw.matchAll(/'\.\/([^']+)'/g)].map(m=>m[1].split('?')[0]);
 for(const asset of assets)assert.ok(fs.existsSync(path.join(staged,'Orbit',asset)),asset);
 assert.equal(fs.statSync(path.join(staged,'Orbit/orbit.com-key.pem')).mode&0o777,0o600);
});
check('macOS generated launchd plist parses',()=>{
 const plist=path.join(staged,'LaunchDaemons/com.sathya.orbit.server.plist');
 const result=spawnSync('plutil',['-lint',plist],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);
});
fs.mkdirSync(path.join(__dirname,'output'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'output/extreme-audit.json'),JSON.stringify({staging:root,results},null,2));
console.log(JSON.stringify({staging:root,results},null,2));

if(results.some(result=>!result.passed)) process.exitCode=1;

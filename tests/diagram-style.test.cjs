const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../widgets.js'),state=require('./fixtures/diagram-style.cjs');
test('defaults survive saved recipes as a live accent; legacy blue follows accent and explicit highlights remain',()=>{
 const normalized=W.normalize(state);assert.equal(normalized.nodes[0].color,'accent');
 assert.deepEqual(W.normalize(JSON.parse(JSON.stringify(normalized))),normalized);
 const svg=W.diagramSvg(normalized);assert.match(svg,/stroke="var\(--diagram-accent,#6b7280\)"/);
 assert.doesNotMatch(svg,/#5984f5/i);assert.match(svg,/stroke="#41a653"/);
 const x=structuredClone(state);x.nodes[0].color='#0077cc';assert.match(W.diagramSvg(x),/stroke="#0077cc"/);
 x.nodes[0].color='var(--anything)';assert.throws(()=>W.normalize(x),/colors/);
});
test('state labels keep parenthetical descriptions together and use quieter secondary typography',()=>{
 const svg=W.diagramSvg(state);
 for(const label of ['(Initial)','(Saw 0)','(Accepted!)'])assert.ok(svg.includes('>'+label+'</tspan>'));
 assert.doesNotMatch(svg,/>\)<\/tspan>|>Accepte<\/tspan>/);
 assert.match(svg,/font-family="system-ui/);assert.match(svg,/font-size="13" font-weight="400"/);
 const long=structuredClone(state);long.nodes[1].label='<script>\n😀';assert.doesNotMatch(W.diagramSvg(long),/<script>/);
});
test('self-loops have a visible external curve and label with padded bounds, including old cramped waypoints',()=>{
 const svg=W.diagramSvg(state);assert.equal((svg.match(/ C/g)||[]).length,2);
 assert.match(svg,/L650 236 L445 236/); // Explicit return route stays intact.
 const only={kind:'diagram',width:200,height:120,nodes:[{id:'a',label:'A',shape:'circle',width:64,x:32,y:32}],edges:[{from:'a',to:'a',label:'stay'}]};
 const corner=W.diagramSvg(only),bounds=corner.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
 assert.ok(bounds[1]<-60);assert.match(corner,/ C/);assert.doesNotMatch(corner,/NaN|Infinity/);
 const custom=structuredClone(only);custom.edges[0].points=[{x:130,y:32},{x:130,y:100},{x:32,y:100}];
 assert.match(W.diagramSvg(custom),/L130 32 L130 100 L32 100/);
});
test('downloaded SVG freezes current accent/theme while inline SVG remains reactive',async()=>{
 const palette={'--diagram-accent':'#c084fc','--bg':'#161616','--panel':'#1c1c1c','--text':'#f0f0f0','--text-secondary':'#a2a2a2'};
 const ctx=vm.createContext({Blob,document:{documentElement:{}},getComputedStyle:()=>({getPropertyValue:key=>palette[key]||''})});
 vm.runInContext(fs.readFileSync(require.resolve('../widgets.js'),'utf8'),ctx);
 const svg=await (await ctx.OrbitWidgets.generate(state)).text();assert.doesNotMatch(svg,/var\(/);
 assert.match(svg,/#c084fc/);assert.match(svg,/#41a653/);assert.match(svg,/#161616/);
 palette['--diagram-accent']='#fb7185';assert.match(await (await ctx.OrbitWidgets.generate(state)).text(),/#fb7185/);
 assert.match(ctx.OrbitWidgets.diagramSvg(state),/var\(--diagram-accent/);
});
test('actual chat accent settings supply readable diagram colors across themes',()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const properties={};
 const c=vm.createContext({state:{theme:'light'},localStorage:{getItem:()=>null},window:{matchMedia:()=>({matches:false})},document:{documentElement:{style:{setProperty:(k,v)=>properties[k]=v}}},setChatAccentSelection(){},defaultChatAccentForTheme:()=> 'default-light'});
 vm.runInContext(source.slice(source.indexOf('const CHAT_ACCENTS ='),source.indexOf('const PROFILE_ACCENTS =')),c);
 for(const name of ['mixHex','applyChatAccent']){const start=source.indexOf('function '+name+'(');vm.runInContext(source.slice(start,source.indexOf('\nfunction ',start+1)),c);}
 c.applyChatAccent('violet');assert.equal(properties['--diagram-accent'],'#4c1d95');
 c.state.theme='dark';c.applyChatAccent('violet');assert.equal(properties['--diagram-accent'],'#9d6bf2');
 c.applyChatAccent('default-light');assert.equal(properties['--diagram-accent'],'#e4e4e4');
 c.state.theme='light';c.applyChatAccent('default-dark');assert.equal(properties['--diagram-accent'],'#333333');
});

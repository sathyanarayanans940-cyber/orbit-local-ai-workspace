const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const M=require('../memories.js');
// Behavioral reference for the previous full-filter synopsis (same output budget).
function previousSynopsis(chat){
 const clean=v=>String(v||'').replace(/```[\s\S]*?(?:```|$)/g,' [code or artifact] ').replace(/\s+/g,' ').trim();
 const messages=(chat.messages||[]).filter(m=>m&&['user','assistant'].includes(m.role)&&!m.generating&&!m.footer),users=messages.filter(m=>m.role==='user');
 const first=clean(users[0]?.text).slice(0,220),last=clean(users.at(-1)?.text).slice(0,220),answer=clean(messages.filter(m=>m.role==='assistant').at(-1)?.text).slice(0,260);
 return [first&&`Initial request: ${first}`,last&&last!==first&&`Latest request: ${last}`,answer&&`Latest answer excerpt: ${answer}`].filter(Boolean).join('\n').slice(0,750);
}
test('optimized summaries exactly match full-filter summaries without scanning entire long chats',()=>{
 let reads=0;const messages=Array.from({length:10000},(_,i)=>({get role(){reads++;return i%2?'assistant':'user'},text:'Unicode தமிழ் '+i}));
 const expected=previousSynopsis({messages});reads=0;assert.equal(M.synopsis({messages}),expected);assert.ok(reads<30,`Scanned ${reads} roles`);
 for(let n=0;n<20;n++){const messages=Array.from({length:n},(_,i)=>i%5===0?null:{role:['system','user','assistant'][i%3],text:'```x\ncode```\nText '+i,generating:i%7===0,footer:i%11===0});assert.equal(M.synopsis({messages}),previousSynopsis({messages}));}
});
test('cached and cold recall have identical full-corpus ranking; mutations and deletion stay current',()=>{
 const chats=Object.fromEntries(Array.from({length:300},(_,i)=>['c'+i,{title:'Chat '+i,updatedAt:i,messages:Array.from({length:20},(_,j)=>({role:j%2?'assistant':'user',text:'common discussion '+(i===2&&j===3?'rare zirconium calibration 7.35':'exercise '+j)}))}]));
 const entries=M.catalog(chats,'new'),cold=M.search(chats,entries,'zirconium calibration discussion'),warm=M.search(chats,entries,'zirconium calibration discussion');assert.deepEqual(warm,cold);assert.equal(warm[0].chatId,'c2');
 chats.c2.messages[3].text='Replaced original';assert.equal(M.search(chats,entries,'zirconium').length,0);
 chats.c299.messages.push({role:'user',text:'Zirconium new fact'});assert.equal(M.search(chats,M.catalog(chats,'new'),'zirconium')[0].chatId,'c299');
 assert.equal(M.search(chats,M.catalog(chats,'new',new Set(['c299'])),'zirconium').length,0);
});
test('unchanged sidebar lists preserve DOM instead of rebuilding every saved response',()=>{
 const source=fs.readFileSync('app.js','utf8'),start=source.indexOf('const chatListMarkup ='),end=source.indexOf('function renderSavedHistory()',start),ctx=vm.createContext({});vm.runInContext(source.slice(start,end),ctx);
 let writes=0;const element={set innerHTML(value){writes++;}};ctx.updateChatList(element,'first');ctx.updateChatList(element,'first');assert.equal(writes,1);ctx.updateChatList(element,'second');assert.equal(writes,2);
});
test('storage ships in offline shell and every installer',()=>{
 for(const file of ['index.html','service-worker.js','install-macos.sh','install-windows.ps1','scripts/package-release.py','scripts/update-installed-macos.command'])assert.ok(fs.readFileSync(file,'utf8').includes('chat-store.js'),file);
});

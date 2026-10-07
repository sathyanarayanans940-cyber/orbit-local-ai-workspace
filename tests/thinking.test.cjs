const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const stored=new Map();const context=vm.createContext({localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)}});
vm.runInContext(fs.readFileSync(require.resolve('../thinking.js'),'utf8'),context);const T=context.OrbitThinking;
const model=id=>({id,key:'Ollama:'+id,provider:'Ollama'});
test('only adjustable known models expose thinking controls',()=>{
 for(const id of ['qwen3:8b','qwen3.6:35b','deepseek-v3.1:671b-cloud']) assert.equal(T.mode(model(id)),'toggle');
 for(const id of ['gemma4:31b-cloud','gemma4:26b','gemma3:4b','llama3:8b','deepseek-r1:8b','qwen3:thinking','qwen3-coder:30b','qwen3:instruct','unknown:latest']) assert.equal(T.mode(model(id)),null);
 assert.equal(T.mode({...model('qwen3:8b'),provider:'LM Studio'}),null);
});
test('per-model toggles persist booleans; GPT-OSS keeps levels and never sends false',()=>{
 const q=model('qwen3:8b'),g=model('gpt-oss:120b-cloud');
 assert.equal(T.value(q),true);T.set(q,false);assert.equal(T.options(q).think,false);
 assert.equal(T.value(model('gemma4:31b-cloud')),undefined);
 assert.equal(T.mode(g),'levels');assert.equal(T.value(g),'medium');T.set(g,'high');assert.equal(T.options(g).think,'high');
 T.set(g,false);assert.equal(T.value(g),'high');assert.equal(T.options(g,true).think,'low');assert.equal(T.value(g),'high');
 assert.equal(T.options(q,true).think,false);assert.equal(Object.keys(T.options(model('llama3'))).length,0);
});

test('Gemma sends no thinking override and disabled bulbs retain opacity',()=>{
 for(const id of ['gemma4:31b-cloud','gemma4:26b','gemma4:e4b']) {
  const m=model(id);T.set(m,false);assert.equal(T.mode(m),null);assert.equal(Object.keys(T.options(m)).length,0);
 }
 const css=fs.readFileSync(require.resolve('../styles.css'),'utf8');
 assert.match(css,/#thinking-button:disabled\s*\{\s*opacity: 1;/);
});

test('waiting status is silent for non-thinking and off models, Thinking for reasoning models',()=>{
 assert.equal(T.status(model('llama3:8b')),'');
 assert.equal(T.status(model('qwen3-coder:30b')),'');
 const q=model('qwen3:8b');T.set(q,false);assert.equal(T.status(q),'');
 T.set(q,true);assert.equal(T.status(q),'Thinking');
 for(const id of ['deepseek-r1:8b','gemma4:31b-cloud','nemotron-3-super:cloud','gpt-oss:20b']) assert.equal(T.status(model(id)),'Thinking');
});

test('reply status switches between only a pulsing dot and meaningful tool/reasoning labels',()=>{
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const ctx=vm.createContext({escapeHtml:s=>s});
 require('./interaction-harness.cjs')(ctx);
 vm.runInContext(app.slice(app.indexOf('function setReplyStatus('),app.indexOf('function addTypingIndicator(')),ctx);
 const attributes={},body={setAttribute:(k,v)=>attributes[k]=v,innerHTML:''};
 const typing={querySelector:()=>body};
 ctx.setReplyStatus(typing,'');assert.match(body.innerHTML,/generation-indicator/);assert.doesNotMatch(body.innerHTML,/thinking-label|Preparing/);
 assert.equal(attributes['aria-label'],'Generating response');
 ctx.setReplyStatus(typing,'Thinking');assert.match(body.innerHTML,/>Thinking<\/span>/);
 ctx.setReplyStatus(typing,'Preparing Excel spreadsheet');assert.match(body.innerHTML,/Preparing Excel spreadsheet/);
 ctx.setReplyStatus(typing,'');assert.doesNotMatch(body.innerHTML,/Thinking|Excel/);
});

test('Gemini 2.5 can disable thinking; Gemini 3 supports levels and internal low effort',()=>{
 const m=id=>({id,key:'Gemini:'+id,provider:'Gemini'});
 for(const id of ['gemini-2.5-flash','gemini-2.5-flash-lite']) {
  const item=m(id);assert.equal(T.mode(item),'toggle');T.set(item,false);assert.equal(T.options(item).reasoning_effort,'none');assert.equal(T.status(item),'');
 }
 for(const id of ['gemini-3.8-flash','gemini-3.5-flash-lite','gemini-3-flash-preview']) {
  const item=m(id);assert.equal(T.mode(item),'levels');assert.equal(T.value(item),'low');T.set(item,'high');assert.equal(T.options(item).reasoning_effort,'high');assert.equal(T.options(item,true).reasoning_effort,'low');assert.equal(T.status(item),'Thinking');
 }
});
test('level thinking uses a compact three-step slider contract',()=>{
 assert.deepEqual([...T.levels],['low','medium','high']);
 assert.equal(T.levelIndex('low'),0);assert.equal(T.levelIndex('medium'),1);assert.equal(T.levelIndex('high'),2);
 assert.equal(T.levelValue(0),'low');assert.equal(T.levelValue(1),'medium');assert.equal(T.levelValue(2),'high');
 assert.equal(T.levelValue(-4),'low');assert.equal(T.levelValue(99),'high');
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
 const css=fs.readFileSync(require.resolve('../styles.css'),'utf8');
 assert.match(html,/id="thinking-slider" type="range"/);
 assert.match(css,/#thinking-slider::\-webkit-slider-runnable-track/);
 assert.match(css,/#ef4444/);
});


test('DeepSeek uses its own effort scale, defaults high, and disables internal planning thought',()=>{
 const m={id:'deepseek-flash',key:'DeepSeek:deepseek-flash',provider:'DeepSeek'};
 const thinking=require('../thinking.js');
 assert.deepEqual(thinking.levelsFor(m),['off','low','high','max']);
 assert.equal(thinking.defaultValue(m),'high');
 for(const [index,effort] of ['off','low','high','max'].entries()) {
  assert.equal(thinking.levelValue(index,m),effort);
  assert.equal(thinking.levelIndex(effort,m),index);
 }
 assert.deepEqual(thinking.options(m,true),{thinking:{type:'disabled'}});
 assert.equal(thinking.mode({...m,id:'deepseek-chat'}),null);
});


test('AICredits Flash exposes persistent effort requests without enabling other models',()=>{
 const m={id:'deepseek/deepseek-v4.1-flash',provider:'AICredits',key:'AICredits:deepseek/deepseek-v4.1-flash'};
 assert.equal(T.mode(m),'levels');assert.equal(T.value(m),'high');
 assert.deepEqual([...T.levelsFor(m)],['off','low','high','max']);
 for(const effort of ['off','low','high','max']) {
  T.set(m,effort);assert.equal(T.value(m),effort);
  assert.equal(T.options(m).reasoning_effort,effort==='off'?'none':effort);
  assert.equal(T.options(m,true).reasoning_effort,'none');
  assert.equal(T.options(m).thinking,undefined);
 }
 assert.equal(T.mode({...m,id:'deepseek/deepseek-v4-pro'}),null);
});

test('OpenAI efforts follow each model and internal work does not overwrite user selection',()=>{
 for(const id of ['gpt-6-luna','gpt-6-sol','gpt-6.1-sol','gpt-6-astra']){
  const m={id,provider:'OpenAI',key:'OpenAI:'+id},off=['gpt-6-luna','gpt-6-sol'].includes(id);
  assert.equal(T.mode(m),'levels');assert.equal(T.defaultValue(m),'medium');
  assert.deepEqual([...T.levelsFor(m)],[...(off?['off']:[]),'low','medium','high','xhigh','max']);
  T.set(m,'max');assert.equal(T.options(m).reasoning_effort,'max');
  assert.equal(T.options(m,true).reasoning_effort,off?'none':'low');assert.equal(T.value(m),'max');
  T.set(m,'off');assert.equal(T.value(m),off?'off':'max');
 }
 assert.equal(T.mode({provider:'OpenAI',id:'not-a-model'}),null);
});

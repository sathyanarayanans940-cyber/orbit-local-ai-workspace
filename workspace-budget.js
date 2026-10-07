/* Browser-local controls, not provider billing limits. No prompts or credentials stored. */
(function(root){
 'use strict';
 const key='orbit-api-limits-v1';
 const number=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):0;
 function normalize(v={}){return {requests:Math.floor(number(v.requests)),tokens:Math.floor(number(v.tokens)),output:Math.floor(number(v.output)),budget:number(v.budget),currency:String(v.currency||'USD').slice(0,12),rates:Object.fromEntries(Object.entries(v.rates||{}).slice(0,300).map(([k,r])=>[k,{input:number(r?.input),output:number(r?.output),confirm:!!r?.confirm}]))};}
 const settings=()=>{try{return normalize(JSON.parse(root.localStorage.getItem(key))||{});}catch(_){return normalize();}};
 function estimate(rows,rates){let cost=0,missing=0,total=0,requests=0,reported=0;for(const c of rows){if(c.kind!=='model'||!(['DeepSeek','AICredits','Gemini','OpenAI'].includes(c.provider)||(c.provider==='Ollama'&&(c.remote||/(?:^|[:._-])cloud(?:$|[:._-])/i.test(c.model)))))continue;const r=rates[c.provider+':'+c.model];total+=c.total||0;requests+=c.requests||0;reported+=c.reported||0;if(r)cost+=((c.input||0)*r.input+(c.output||0)*r.output)/1e6;else missing+=c.requests||0;}return {cost,missing,total,requests,reported};}
 function cap(body,provider,limit){if(!limit)return body;const b=JSON.parse(body);if(provider==='Ollama'){const old=b.options?.num_predict;b.options={...b.options,num_predict:old>0?Math.min(old,limit):limit};}else b.max_tokens=b.max_tokens>0?Math.min(b.max_tokens,limit):limit;return JSON.stringify(b);}
 function counter(indexedDB=root.indexedDB){let dbPromise;function db(){return dbPromise??=new Promise((resolve,reject)=>{if(!indexedDB)return reject(Error('Browser storage is unavailable'));const r=indexedDB.open('orbit-api-request-limits',1);r.onupgradeneeded=()=>r.result.createObjectStore('days');r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>reject(Error('API limit storage is unavailable'));});}
 return async function take(day,limit){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction('days','readwrite'),s=tx.objectStore('days'),r=s.get(day);let used,blocked=false;r.onsuccess=()=>{used=Number(r.result)||0;if(limit&&used>=limit){blocked=true;return;}s.put(++used,day);const keys=s.getAllKeys();keys.onsuccess=()=>keys.result.filter(k=>k!==day).forEach(k=>s.delete(k));};tx.oncomplete=()=>blocked?reject(Error('Daily API request limit reached. Change the limit in Chat tools → API limits.')):resolve(used);tx.onerror=tx.onabort=()=>reject(Error('API request limits could not be saved.'));});};}
 const take=counter(),approved=new Set(),warned=new Set();
 async function guard(provider,metadata,options){
  if(!['DeepSeek','AICredits','Gemini','OpenAI'].includes(provider)&&!(provider==='Ollama'&&metadata.remote))return options;
  if(options.signal?.aborted)throw new DOMException('Stopped','AbortError');
  const config=settings(),model=provider+':'+metadata.model,rate=config.rates[model];
  if(rate?.confirm&&!approved.has(model)){if(!root.confirm(`Allow API requests to ${model} for this tab session? This includes internal requests such as titles and analysis.`))throw Error('This model was not authorized for this session. No request was sent.');approved.add(model);}
  const day=root.OrbitUsage.dates().at(-1),snapshot=(config.tokens||config.budget)?await root.OrbitUsage.store.read():{rows:[],persistent:true};
  if((config.tokens||config.budget)&&!snapshot.persistent)throw Error('Usage storage is unavailable; API token/budget controls cannot be checked.');
  const tally=estimate(snapshot.rows.find(r=>r.date===day)?.cells||[],config.rates);
  if(config.tokens&&tally.total>=config.tokens)throw Error('Daily reported-token threshold reached. Change it in API limits to continue.');
  if(config.budget&&tally.cost>=config.budget)throw Error('Daily estimated-cost threshold reached. Change it in API limits to continue.');
  if(options.signal?.aborted)throw new DOMException('Stopped','AbortError');
  let used;try{used=await take(day,config.requests);}catch(e){if(config.requests||/limit reached/.test(e.message))throw e;}
  for(const [name,n,limit]of [['requests',used,config.requests],['tokens',tally.total,config.tokens],['estimated cost',tally.cost,config.budget]])if(limit&&n>=limit*.8&&!warned.has(day+name)){warned.add(day+name);root.dispatchEvent(new CustomEvent('orbit-budget-alert',{detail:`You have reached 80% of today’s ${name} limit.`}));}
  return {...options,body:cap(options.body,provider,config.output)};
 }
 root.OrbitBudget={normalize,settings,estimate,cap,counter,guard,save(value){root.localStorage.setItem(key,JSON.stringify(normalize(value)));approved.clear();}};
 if(typeof module!=='undefined')module.exports=root.OrbitBudget;
})(typeof window==='undefined'?globalThis:window);

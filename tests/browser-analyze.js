document.querySelector('#run').onclick=async()=>{
 const out=document.querySelector('#result');out.textContent='Analyzing…';
 try{
 const result=await OrbitAnalyze.execute(`import sympy as s\nimport numpy as np\nfrom scipy.integrate import quad\nimport mpmath as mp\nx=s.symbols('x')\nassert s.integrate(x**2,(x,0,3))==9\nassert np.allclose(np.linalg.solve([[2,1],[1,3]],[5,6]),[1.8,1.4])\nassert abs(quad(lambda x:x*x,0,3)[0]-9)<1e-10\nmp.mp.dps=50\nprint('Integral:',9,'; roots:',s.solve(x*x-2,x))\nprint('High precision sqrt(2):',mp.sqrt(2))\nprint('ALL MATH CHECKS PASSED')`);
 out.textContent=JSON.stringify(result,null,2);
 }catch(e){out.textContent=e.stack;}
};

// Additional controls exercise the real isolated worker, not mocks.
const cases=[
 ['Algorithm boundaries',`def search(a,x):\n    lo,hi=0,len(a)\n    while lo<hi:\n        m=(lo+hi)//2\n        if a[m]<x: lo=m+1\n        else: hi=m\n    return lo\nimport bisect,random\nr=random.Random(42)\nfor n in range(100):\n    a=sorted(r.randrange(-20,20) for _ in range(n))\n    for x in range(-25,25): assert search(a,x)==bisect.bisect_left(a,x)\nprint('5000 reference comparisons passed; includes empty, duplicates and absent values')`],
 ['Deliberate wrong answer',`assert 2+2==5, 'Expected failure caught'`],
 ['Syntax failure',`def broken(:\n    pass`],
 ['Output limit',`print('x'*30000)`],
 ['Network and storage isolation',`import js\nblocked=[]\ntry:\n    js.indexedDB.open('orbit-chat-history')\nexcept Exception:\n    blocked.append('app storage denied')\ntry:\n    xhr=js.XMLHttpRequest.new()\n    xhr.open('GET','http://127.0.0.1:8877/private-analysis-test',False)\n    xhr.send()\nexcept Exception:\n    blocked.append('network denied')\nassert len(blocked)==2,blocked\nprint(blocked)\nprint('origin:',js.location.origin)`],
 ['Infinite loop timeout',`while True: pass`,4000],
 ['Fresh globals',`assert 'search' not in globals()\nprint('Fresh namespace confirmed')`]
];
for(const [name,code,timeout] of cases){const b=document.createElement('button');b.textContent=name;b.onclick=async()=>{const out=document.querySelector('#result');out.textContent='Analyzing…';try{out.textContent=JSON.stringify(await OrbitAnalyze.execute(code,{timeout}),null,2)}catch(e){out.textContent=e.message}};document.body.append(b);}
const cancel=document.createElement('button');cancel.textContent='Cancellation';cancel.onclick=async()=>{const c=new AbortController();const p=OrbitAnalyze.execute('while True: pass',{signal:c.signal});setTimeout(()=>c.abort(),500);try{await p;document.querySelector('#result').textContent='FAIL: not canceled'}catch(e){document.querySelector('#result').textContent=e.name==='AbortError'?'PASS: canceled and isolated worker removed':e.message}};document.body.append(cancel);
const all=document.createElement('button');all.textContent='Run all regression checks';all.onclick=async()=>{
 const out=document.querySelector('#result');out.textContent='Running…';const results=[];
 for(const [name,code,timeout] of cases){
  out.textContent=JSON.stringify(results,null,2)+'\nAnalyzing: '+name;
  try{const value=await OrbitAnalyze.execute(code,{timeout});const expectedFailure=['Deliberate wrong answer','Syntax failure','Infinite loop timeout'].includes(name);const passed=expectedFailure?!value.ok:name==='Output limit'?value.ok&&value.truncated&&value.output.length<=16000:value.ok;results.push({name,passed,...value,output:value.output?.slice(0,600)});}catch(e){results.push({name,passed:false,error:e.message});}
 }
 const c=new AbortController();const running=OrbitAnalyze.execute('while True: pass',{signal:c.signal});setTimeout(()=>c.abort(),500);try{await running;results.push({name:'Cancellation',passed:false})}catch(e){results.push({name:'Cancellation',passed:e.name==='AbortError'})}
 results.push({name:'Worker cleanup',passed:document.querySelectorAll('iframe').length===0});
 out.textContent=JSON.stringify(results,null,2)+'\n'+(results.every(r=>r.passed)?'ALL PASSED':'FAILED');
};document.body.append(all);

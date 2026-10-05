/* Seven local calendar days of aggregate metadata. Never stores chat text or keys. */
(function(root){
  'use strict';
  const purposes=['answer','analysis','title','web-planning','memory','planning','document','document-edit','repair','vision','study','comparison'];
  const modes=['off','on','low','medium','high','max','default'];
  const metrics=['requests','success','failed','cancelled','input','output','total','reasoning','cached','reported','inputReported','outputReported','reasoningReported','cachedReported','durationMs','firstTextMs','firstTextCount','thinkingMs','thinkingCount','observedThinking','results'];
  const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
  const safe=n=>Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Number.isFinite(n)?Math.round(n):0));
  const clean=s=>String(s??'').replace(/[\u0000-\u001f]/g,' ').slice(0,160);
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function day(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function dates(now=Date.now()){const d=new Date(now);return Array.from({length:7},(_,i)=>day(new Date(d.getFullYear(),d.getMonth(),d.getDate()-6+i)));}
  function tokens(data,provider){
    const u=data?.usage;
    let input=count(provider==='Ollama'?data?.prompt_eval_count:u?.prompt_tokens),output=count(provider==='Ollama'?data?.eval_count:u?.completion_tokens);
    let total=count(u?.total_tokens),reasoning=count(u?.completion_tokens_details?.reasoning_tokens??u?.reasoning_tokens);
    let cached=count(provider==='Ollama'?data?.prompt_eval_cached_count:u?.prompt_cache_hit_tokens??u?.prompt_tokens_details?.cached_tokens);
    if(total!==null&&((input!==null&&total<input)||(output!==null&&total<output)||(input!==null&&output!==null&&total<input+output)))total=null;
    if(total===null&&input!==null&&output!==null&&Number.isSafeInteger(input+output))total=input+output;
    if(reasoning!==null&&output!==null&&reasoning>output)reasoning=null;
    if(cached!==null&&input!==null&&cached>input)cached=null;
    return {input,output,total,reasoning,cached};
  }
  function thinking(options={}){
    if(options.thinking?.type==='disabled'||options.think===false||options.reasoning_effort==='none')return 'off';
    if(options.think===true)return 'on';
    const value=options.reasoning_effort??options.think;
    return modes.includes(value)?value:options.thinking?.type==='enabled'?'on':'default';
  }
  const zero=()=>Object.fromEntries(metrics.map(key=>[key,0]));
  function normalize(event){
    const kind=event?.kind==='web'?'web':'model';
    const m=zero(),t=event?.tokens||{};m.requests=1;m[event?.status==='cancelled'?'cancelled':event?.status==='success'?'success':'failed']=1;
    for(const k of ['input','output','total','reasoning','cached'])if(count(t[k])!==null){m[k]=t[k];if(k!=='total')m[k+'Reported']=1;}
    m.reported=count(t.total)!==null?1:0;
    m.durationMs=safe(event?.durationMs);m.results=kind==='web'?safe(event?.results):0;
    if(Number.isFinite(event?.firstTextMs)&&event.firstTextMs>=0){m.firstTextMs=safe(event.firstTextMs);m.firstTextCount=1;}
    if(event?.observedThinking){m.observedThinking=1;if(Number.isFinite(event.thinkingMs)&&event.thinkingMs>=0){m.thinkingMs=safe(event.thinkingMs);m.thinkingCount=1;}}
    return {kind,remote:event?.remote===true,provider:clean(event?.provider||'Unknown'),model:kind==='model'?clean(event?.model||'Unknown'):'',purpose:kind==='web'?(event?.action==='fetch'?'fetch':'search'):(purposes.includes(event?.purpose)?event.purpose:'answer'),mode:kind==='model'?(modes.includes(event?.mode)?event.mode:'default'):'default',...m};
  }
  function validCells(cells){return (Array.isArray(cells)?cells:[]).slice(0,513).filter(c=>c&&typeof c==='object').map(c=>({...normalize({...c,action:c.purpose}),...Object.fromEntries(metrics.map(k=>[k,safe(c[k])]))}));}
  function merge(cells,event){
    const row=normalize(event),key=c=>JSON.stringify([c.kind,c.provider,c.model,c.purpose,c.mode]);
    let cell=cells.find(c=>key(c)===key(row));
    // Reserve rollup slots for every purpose/mode and both web operations.
    // Even extreme cardinality must preserve the meaning of the counts.
    if(!cell&&cells.length>=513-(purposes.length*modes.length+2)){row.provider='Other';row.model=row.kind==='model'?'Other models (storage limit)':'';cell=cells.find(c=>key(c)===key(row));}
    if(!cell){cell={...row,...zero()};cells.push(cell);}
    for(const k of metrics)cell[k]=safe(cell[k]+row[k]);return cells;
  }
  function createStore({indexedDB=root.indexedDB,now=()=>Date.now(),name='orbit-usage-v1'}={}){
    let memory=[],persistent=false,problem='',db=null,queue=Promise.resolve();const listeners=new Set(),active=new Set();
    let channel;try{if(root.window===root&&root.BroadcastChannel){channel=new root.BroadcastChannel(name);channel.onmessage=()=>notify(false);}}catch(_){}
    function notify(broadcast=true){for(const fn of listeners)fn();if(broadcast)try{channel?.postMessage('updated');}catch(_){} }
    const ready=new Promise(resolve=>{
      if(!indexedDB){problem='Browser storage is unavailable. Usage is kept for this session only.';resolve();return;}
      let done=false;const timer=setTimeout(()=>finish(null),2500);
      function finish(value){if(done){value?.close();return;}done=true;clearTimeout(timer);db=value;persistent=!!value;if(!value)problem='Usage could not be saved. Session totals are shown until storage is available.';resolve();}
      try{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>{request.result.createObjectStore('days',{keyPath:'date'});};request.onsuccess=()=>{const value=request.result;value.onversionchange=()=>{value.close();db=null;persistent=false;problem='Usage storage changed. Reload to save further activity.';};finish(value);};request.onerror=request.onblocked=()=>finish(null);}catch(_){finish(null);}
    });
    async function access(event,date){
      await ready;const keys=dates(now());
      const inMemory=()=>{memory=memory.filter(d=>keys.includes(d.date));if(event&&keys.includes(date)){let bucket=memory.find(d=>d.date===date);if(!bucket){bucket={date,cells:[]};memory.push(bucket);}merge(bucket.cells,event);}return structuredClone(memory);};
      if(!db)return inMemory();
      return new Promise(resolve=>{
        let rows=[],readSucceeded=false,settled=false;
        const fallback=()=>{if(settled)return;settled=true;db?.close();db=null;persistent=false;problem='Usage storage is full or unavailable. Further activity is kept for this session only; reload to retry saving.';
          if(readSucceeded)memory=rows;resolve(readSucceeded?structuredClone(memory):inMemory());};
        try{const tx=db.transaction('days','readwrite'),store=tx.objectStore('days'),read=store.getAll();
          read.onsuccess=()=>{rows=read.result.filter(d=>d&&keys.includes(d.date)).map(d=>({date:d.date,cells:validCells(d.cells)}));readSucceeded=true;for(const d of read.result)if(d&&!keys.includes(d.date))store.delete(d.date);
            if(event&&keys.includes(date)){let bucket=rows.find(d=>d.date===date);if(!bucket){bucket={date,cells:[]};rows.push(bucket);}merge(bucket.cells,event);store.put(bucket);}};
          tx.oncomplete=()=>{if(settled)return;settled=true;memory=structuredClone(rows);resolve(rows);};tx.onabort=tx.onerror=fallback;
        }catch(_){fallback();}
      });
    }
    function record(event,at=now()){const date=day(new Date(at));queue=queue.then(()=>access(event,date));return queue.then(rows=>{notify();return rows;});}
    async function read(){await queue;const rows=await access();return {rows,dates:dates(now()),persistent,problem,active:active.size};}
    function begin(metadata){const started=now(),id={};active.add(id);notify();let done=false;return {finish(details={}){if(done)return Promise.resolve();done=true;active.delete(id);return record({...metadata,...details,durationMs:now()-started},started);}};}
    return {ready,record,read,begin,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},close(){db?.close();channel?.close();}};
  }
  function summary(snapshot,{provider='',model='',scope='all'}={}){
    const modelKey=c=>JSON.stringify([c.provider,c.model]);
    const match=c=>(!provider||c.provider===provider)&&(!model||c.model===model)&&(scope!=='chat'||c.purpose==='answer');
    const cells=snapshot.rows.flatMap(d=>d.cells).filter(c=>c.kind==='model'&&match(c));const total=zero();for(const c of cells)for(const k of metrics)total[k]=safe(total[k]+c[k]);
    const models=new Map();for(const c of cells){const key=modelKey(c);if(!models.has(key))models.set(key,{provider:c.provider,model:c.model,...zero()});const row=models.get(key);for(const k of metrics)row[k]=safe(row[k]+c[k]);}
    const web=snapshot.rows.flatMap(d=>d.cells).filter(c=>c.kind==='web');const webTotal=zero();for(const c of web)for(const k of metrics)webTotal[k]=safe(webTotal[k]+c[k]);
    const daily=snapshot.dates.map(date=>{const rows=snapshot.rows.find(d=>d.date===date)?.cells||[];return {date,requests:rows.filter(c=>c.kind==='model'&&match(c)).reduce((n,c)=>n+c.requests,0),tokens:rows.filter(c=>c.kind==='model'&&match(c)).reduce((n,c)=>n+c.total,0),searches:rows.filter(c=>c.kind==='web'&&c.purpose==='search').reduce((n,c)=>n+c.requests,0),reads:rows.filter(c=>c.kind==='web'&&c.purpose==='fetch').reduce((n,c)=>n+c.requests,0)};});
    return {cells,total,models:[...models.values()].sort((a,b)=>b.requests-a.requests||a.model.localeCompare(b.model)),web,webTotal,daily};
  }
  function format(n){return new Intl.NumberFormat().format(n);}
  function duration(ms){return ms>=60000?(ms/60000).toFixed(1)+' min':(ms/1000).toFixed(1)+' s';}
  function bars(values,label){const max=Math.max(1,...values.map(v=>v.value));return `<div class="usage-bars" role="img" aria-label="${escape(label)}">${values.map(v=>`<div class="usage-bar-column" title="${escape(v.title||v.label)}: ${format(v.value)}"><span class="usage-bar-value">${format(v.value)}</span><div class="usage-bar-track"><span style="height:${v.value/max*100}%"></span></div><span>${escape(v.label)}</span></div>`).join('')}</div>`;}
  function donut(models){
    const rows=models.filter(m=>m.requests>0),total=rows.reduce((n,m)=>n+m.requests,0);
    const slices=rows.slice(0,7).map(m=>({label:m.model,detail:m.provider,value:m.requests}));
    if(rows.length>7)slices.push({label:'Other',detail:`${rows.length-7} model connections`,value:rows.slice(7).reduce((n,m)=>n+m.requests,0)});
    const colors=['#6389ed','#29b6a3','#ad83e5','#e5a446','#df7598','#4eafce','#93b85f','#8995a7'];
    const percentage=value=>value>0&&value<.1?'<0.1%':value.toFixed(1)+'%';
    let offset=0;
    const segments=slices.map((slice,i)=>{
      const percent=slice.value/total*100,start=offset;offset+=percent;
      return `<circle class="usage-donut-segment" cx="110" cy="110" r="80" pathLength="100" fill="none" stroke="${colors[i]}" stroke-width="26" stroke-dasharray="${percent.toFixed(6)} ${(100-percent).toFixed(6)}" stroke-dashoffset="${(-start).toFixed(6)}" transform="rotate(-90 110 110)"><title>${escape(slice.detail+' · '+slice.label)}: ${format(slice.value)} requests (${escape(percentage(percent))})</title></circle>`;
    }).join('');
    const description=total?`Model request share: ${format(total)} requests across ${rows.length} model connections.`:'No model requests recorded.';
    const legend=slices.map((slice,i)=>`<li><span class="usage-donut-swatch" style="background:${colors[i]}"></span><span class="usage-donut-label">${escape(slice.label)}<small>${escape(slice.detail)}</small></span><span class="usage-donut-value">${escape(percentage(slice.value/total*100))}<small>${format(slice.value)} requests</small></span></li>`).join('');
    return `<div class="usage-donut-layout"><div class="usage-donut"><svg viewBox="0 0 220 220" role="img" aria-label="${escape(description)}"><circle class="usage-donut-track" cx="110" cy="110" r="80" fill="none" stroke-width="26"/>${segments}</svg><div class="usage-donut-center" aria-hidden="true"><strong>${format(total)}</strong><span>requests</span></div></div>${legend?'<ul class="usage-donut-legend">'+legend+'</ul>':'<p class="usage-muted">Send a message to start tracking model usage.</p>'}</div>`;
  }
  function render(snapshot,filters={}){
    const s=summary(snapshot,filters),t=s.total,metric=filters.metric==='tokens'?'tokens':'requests';
    const group=(cells,key)=>{const out=new Map();for(const c of cells){const k=key(c);out.set(k,(out.get(k)||0)+c.requests);}return [...out].sort((a,b)=>b[1]-a[1]);};
    const webGroups=new Map();for(const c of s.web){const key=JSON.stringify([c.provider,c.purpose]);if(!webGroups.has(key))webGroups.set(key,{provider:c.provider,purpose:c.purpose,...zero()});const row=webGroups.get(key);for(const k of metrics)row[k]=safe(row[k]+c[k]);}
    const webDetails=[...webGroups.values()].sort((a,b)=>b.requests-a.requests).map(w=>`<div><span>${escape(w.provider)} · ${w.purpose==='search'?'search':'page read'}<small>${format(w.success)} completed / ${format(w.failed)} failed / ${format(w.cancelled)} stopped${w.purpose==='search'?' · '+format(w.results)+' results returned':''} · Avg. ${duration(w.durationMs/w.requests)}</small></span><strong>${format(w.requests)} <small>attempts</small></strong></div>`).join('');
    const list=(rows,unit='requests')=>rows.length?`<div class="usage-breakdown">${rows.map(([label,n])=>`<div><span>${escape(label)}</span><strong>${format(n)} <small>${unit}</small></strong></div>`).join('')}</div>`:'<p class="usage-muted">No activity yet.</p>';
    const known=(value,coverage)=>coverage?format(value):'—';
    return `<div class="usage-summary"><article><span>Model requests</span><strong>${format(t.requests)}</strong><small>${format(t.success)} completed · ${format(t.failed)} failed · ${format(t.cancelled)} stopped</small></article><article><span>Reported tokens</span><strong>${known(t.total,t.reported)}</strong><small>Totals available for ${format(t.reported)} of ${format(t.requests)} requests</small></article><article><span>Thinking observed</span><strong>${format(t.observedThinking)}</strong><small>${known(t.reasoning,t.reasoningReported)} reasoning tokens reported</small></article><article><span>Web searches</span><strong>${format(s.web.filter(c=>c.purpose==='search').reduce((n,c)=>n+c.requests,0))}</strong><small>${format(s.web.filter(c=>c.purpose==='fetch').reduce((n,c)=>n+c.requests,0))} page reads · ${format(s.webTotal.failed+s.webTotal.cancelled)} incomplete</small></article></div>
    <div class="usage-chart-grid"><section class="usage-card"><div class="usage-card-heading"><h2>${metric==='tokens'?'Reported tokens':'Model requests'} per day</h2><label>Chart <select id="usage-metric"><option value="requests" ${metric==='requests'?'selected':''}>Requests</option><option value="tokens" ${metric==='tokens'?'selected':''}>Tokens</option></select></label></div>${bars(s.daily.map(d=>({label:new Date(d.date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short'}),title:d.date,value:d[metric]})),'Daily '+metric)}<p class="usage-muted">${metric==='tokens'?'Missing token reports are excluded; a zero bar may mean no reported tokens.':'Every model attempt is counted, including internal work and retries.'}</p></section>
    <section class="usage-card"><h2>Web activity per day</h2>${bars(s.daily.map(d=>({label:new Date(d.date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short'}),title:d.date,value:d.searches+d.reads})),'Daily searches and page reads')}<p class="usage-muted">Searches and page reads combined. Web totals include all models.</p></section></div>
    <section class="usage-card"><h2>Models</h2><div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>Model / connection</th><th>Requests</th><th>Input tokens</th><th>Output tokens</th><th>Total tokens</th><th>Reasoning tokens</th><th>Cached input</th><th>Token reports</th><th>Avg. first text</th><th>Avg. request</th></tr></thead><tbody>${s.models.map(m=>`<tr><th>${escape(m.model)}<small>${escape(m.provider)} · ${m.success} completed / ${m.failed} failed / ${m.cancelled} stopped</small></th><td>${format(m.requests)}</td><td>${known(m.input,m.inputReported)}</td><td>${known(m.output,m.outputReported)}</td><td>${known(m.total,m.reported)}</td><td>${known(m.reasoning,m.reasoningReported)}</td><td>${known(m.cached,m.cachedReported)}</td><td>${m.reported} / ${m.requests}</td><td>${m.firstTextCount?duration(m.firstTextMs/m.firstTextCount):'—'}</td><td>${m.requests?duration(m.durationMs/m.requests):'—'}</td></tr>`).join('')||'<tr><td colspan="10">No model activity recorded yet. Send a message to start.</td></tr>'}</tbody></table></div><p class="usage-muted">Provider-reported counts only. Reasoning and cached input are subsets, never added to total again. Timing is measured by Orbit from request start; it includes network time. Partial reports do not represent your full billed usage.</p></section>
    <div class="usage-chart-grid"><section class="usage-card"><h2>Requested thinking modes</h2>${bars(group(s.cells,c=>c.mode).map(([label,value])=>({label,value})),'Requests by thinking mode')}${list(group(s.cells,c=>`${c.provider} · ${c.model} · ${c.mode}`))}<p class="usage-muted">Requested setting, including lighter internal work. “Default” means Orbit did not set an effort. Observed thinking is counted separately; a requested mode does not prove provider compliance. ${t.thinkingCount?'Average observed reasoning phase: '+duration(t.thinkingMs/t.thinkingCount)+'. Measured from first reasoning event to first answer text, including network time.':''}</p></section><section class="usage-card"><h2>Where model requests went</h2>${list(group(s.cells,c=>({'answer':'Chat replies','analysis':'Analyze','title':'Chat naming','web-planning':'Web planning','memory':'Memory selection','planning':'Planning','document':'Document drafting','document-edit':'Document edits','repair':'File repair','vision':'Image reading','study':'Study mode','comparison':'Model comparisons'})[c.purpose]))}</section></div>
    <div class="usage-chart-grid"><section class="usage-card"><h2>Model share</h2>${donut(s.models)}<p class="usage-muted">Share of model requests with the current filters. The seven most-used connections are shown individually; the rest are grouped as Other. The table includes every model.</p></section><section class="usage-card"><h2>Web providers and outcomes</h2>${webDetails?'<div class="usage-breakdown">'+webDetails+'</div>':'<p class="usage-muted">No activity yet.</p>'}<p class="usage-muted">Counts Orbit web operations and retries. Results are returned search entries, not unique sources. Hidden upstream fallback attempts and manual browsing outside Orbit are not measurable.</p></section></div>
    <p class="usage-footer">Last seven local calendar days, including today. Updates as requests finish. ${snapshot.active} request${snapshot.active===1?'':'s'} in progress in this tab. ${snapshot.problem?escape(snapshot.problem):snapshot.persistent?'Saved in this browser; shared with other Orbit tabs.':'Session storage only.'} Tracking starts with this update; earlier activity and other browsers/devices are not included. Reloading or closing Orbit during a request may prevent its final report.</p>`;
  }
  const store=root.window===root?createStore():null,responses=new WeakMap();
  function begin(metadata){
    if(!store)return null;const request=store.begin(metadata),start=Date.now();let usage={},firstTextMs=null,firstThinkingAt=null,thinkingEnd=null;
    return {packet(data){const next=tokens(data,metadata.provider);for(const k of Object.keys(next))if(next[k]!==null)usage[k]=next[k];},text(){firstTextMs??=Date.now()-start;if(firstThinkingAt!==null)thinkingEnd??=Date.now();},thinking(){firstThinkingAt??=Date.now();},finish(status='success',extra={}){return request.finish({...extra,status,tokens:usage,firstTextMs,observedThinking:firstThinkingAt!==null,thinkingMs:firstThinkingAt===null?null:(thinkingEnd??Date.now())-firstThinkingAt});}};
  }
  root.OrbitUsage={createStore,tokens,thinking,dates,normalize,merge,summary,render,escape,purposes,metrics,store,begin,attach(response,tracker){if(tracker)responses.set(response,tracker);},response(response){return responses.get(response);}};
  if(typeof module!=='undefined')module.exports=root.OrbitUsage;
})(typeof window==='undefined'?globalThis:window);

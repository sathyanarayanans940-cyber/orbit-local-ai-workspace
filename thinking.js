/* Provider-specific effort controls; relay requests do not prove upstream support. */
(function(root){
  const KEY='orbit-thinking-v1';
  const LEVELS=Object.freeze(['low','medium','high']);
  const unsupported=new Set();
  function mode(model) {
    if(unsupported.has(model?.key)) return null;
    if(model?.provider==='AICredits' && model.id==='deepseek/deepseek-v4.1-flash') return 'levels';
    if(model?.provider==='DeepSeek' && ['deepseek-flash','deepseek-v4-pro'].includes(model.id)) return 'levels';
    if(model?.provider==='Gemini') {
      if(/^gemini-2\.5-flash(?:-lite)?$/.test(model.id)) return 'toggle';
      if(/^gemini-3(?:\.[0-9]+)?-flash(?:-lite|-preview)?$/.test(model.id)) return 'levels';
      return null;
    }
    if(model?.provider!=='Ollama') return null;
    const id=String(model.id||'').toLowerCase().split('/').pop();
    if(/^gpt-oss(?:[:\-]|$)/.test(id) && !id.includes('safeguard')) return 'levels';
    if(/(?:thinking|instruct|coder|deepseek-r1)/.test(id)) return null;
    if(/^(?:qwen3(?:\.[56])?|deepseek-v3\.1)(?::|$)/.test(id)) return 'toggle';
    return null;
  }
  function levelsFor(model) { return ['DeepSeek','AICredits'].includes(model?.provider)?['off','low','high','max']:LEVELS.slice(); }
  function defaultValue(model) {
    const type=mode(model);
    if(type==='levels') return ['DeepSeek','AICredits'].includes(model?.provider)?'high':model?.provider==='Gemini'?'low':'medium';
    if(type==='toggle') return true;
    return undefined;
  }
  function value(model) {
    const type=mode(model);
    let saved;try { saved=JSON.parse(root.localStorage.getItem(KEY)||'{}')[model.key]; } catch(_) {}
    return type==='levels' ? (levelsFor(model).includes(saved)?saved:defaultValue(model)) : type==='toggle' ? (typeof saved==='boolean'?saved:defaultValue(model)) : undefined;
  }
  function set(model,value) {
    const type=mode(model);
    if(!(type==='levels' && levelsFor(model).includes(value)) && !(type==='toggle' && typeof value==='boolean')) return;
    try { let saved=JSON.parse(root.localStorage.getItem(KEY)||'{}');if(!saved || typeof saved!=='object' || Array.isArray(saved)) saved={};saved[model.key]=value;root.localStorage.setItem(KEY,JSON.stringify(saved)); } catch(_) {}
  }
  function levelIndex(value,model) {
    const index=levelsFor(model).indexOf(value);
    return index<0?1:index;
  }
  function levelValue(index,model) {
    const LEVELS=levelsFor(model);
    const numeric=Number(index);
    if(!Number.isFinite(numeric)) return LEVELS[1];
    return LEVELS[Math.min(LEVELS.length-1,Math.max(0,Math.round(numeric)))];
  }
  function options(model,internal=false) {
    const type=mode(model);
    if(!type) return {};
    if(model?.provider==='AICredits') {
      const effort=internal?'off':value(model);
      return {reasoning_effort:effort==='off'?'none':effort};
    }
    if(model?.provider==='DeepSeek') {
      const effort=internal?'off':value(model);
      return effort==='off'?{thinking:{type:'disabled'}}:{thinking:{type:'enabled'},reasoning_effort:effort};
    }
    if(model?.provider==='Gemini') return {reasoning_effort:internal?(type==='toggle'?'none':'low'):type==='toggle'?(value(model)?'medium':'none'):value(model)};
    return {think:internal?(type==='levels'?'low':false):value(model)};
  }
  function status(model) {
    if(mode(model)) return value(model) && value(model)!=='off'?'Thinking':'';
    if(unsupported.has(model?.key)) return 'Thinking';
    const id=String(model?.id || '').toLowerCase().split('/').pop();
    const known=/^(?:deepseek-r1|gemma4|nemotron-3|gpt-oss)(?:[:\-]|$)/.test(id) || /(?:^|[-:])thinking(?:[-:]|$)/.test(id);
    return known || model?.capabilities?.includes('thinking') ? 'Thinking' : '';
  }
  function rejectToggle(model) { if(model?.key) unsupported.add(model.key); }
  // Only fixed, high-level activity labels leave this classifier. Provider
  // reasoning text, quoted instructions and private details are never shown.
  const activityTopics=[
      [/\bz[ -]?transform\b/,'Working through the Z transform'],
      [/\bregress(?:ion|ions)\b/,'Working through regression equations'],
      [/\b(?:correlation|spearman|pearson)\b/,'Checking the correlation calculations'],
      [/\b(?:standard error|z.score|hypothesis|p.value)\b/,'Working through the hypothesis test'],
      [/\b(?:probability|binomial|poisson|normal distribution)\b/,'Working through the probability calculations'],
      [/\b(?:integral|integration|differentiat|derivative)/,'Working through the calculus steps'],
      [/\b(?:solve|solving|equation)\b[^\n]{0,80}\bx\b[^\n]{0,40}\by\b/,'Calculating values for x and y'],
      [/\b(?:knapsack|longest common subsequence|dynamic programming)\b/,'Working through the algorithm steps'],
      [/\b(?:code|coding|debug|function|algorithm|programming)\b/,'Planning the code and logic'],
      [/\b(?:gantt|schedule|timeline|project plan)\b/,'Planning the schedule and dependencies'],
      [/\b(?:chart|graph|plot|heatmap|histogram|treemap)\b/,'Planning the chart and data'],
      [/\b(?:software process|process models|srs)\b/,'Organizing the software process explanation'],
      [/\b(?:word|docx|pdf|report|document|presentation|pptx)\b/,'Planning the document and structure'],
      [/\b(?:equation|solve|solution|math|calculate|calculation)\b/,'Working through the solution steps'],
      [/\b(?:compare|comparison|research|sources)\b/,'Comparing the information and sources'],
    ];
  const activityLabels=new Set([...activityTopics.map(([,label])=>label),'Working through your request']);
  function activity(text,fallback=false){
    const s=String(text||'').slice(-1600).toLowerCase();
    for(const sentence of s.split(/[.!?]\s+|\n/).filter(v=>v.trim()).reverse()){
      const label=activityTopics.find(([pattern])=>pattern.test(sentence))?.[1];if(label)return label;
    }
    return fallback?'Working through your request':null;
  }
  function createActivity({prompt='',onStatus,signal,delay=4000,now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}={}){
    let timer=null,active=false,stopped=false,started=0,lastUpdate=0,headline=activity(prompt,true),visible=null;
    const emit=label=>{if(label!==visible){visible=label;onStatus?.(label);}};
    const clear=()=>{if(timer!==null){cancel(timer);timer=null;}};
    function refresh(){timer=null;if(stopped||!active)return;emit(headline);lastUpdate=now();}
    function status(label){
      if(stopped)return;
      if(label!=='Thinking'){clear();active=false;headline=activity(prompt,true);emit(label);return;}
      // Repeated reasoning chunks must not restart the four-second grace period.
      if(active)return;
      active=true;started=now();lastUpdate=started;emit('Thinking');timer=schedule(refresh,delay);
    }
    function update(label){
      if(stopped||!active||!activityLabels.has(label))return;
      headline=label;
      if(now()-started<delay)return;
      const remaining=2000-(now()-lastUpdate);clear();if(remaining<=0)refresh();else timer=schedule(refresh,remaining);
    }
    function stop(){if(stopped)return;stopped=true;active=false;clear();signal?.removeEventListener('abort',stop);}
    if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
    return {status,activity:update,stop};
  }
  root.OrbitThinking={mode,value,set,options,rejectToggle,status,activity,createActivity,levels:LEVELS.slice(),levelsFor,levelIndex,levelValue,defaultValue};
  if(typeof module!=='undefined') module.exports=root.OrbitThinking;
})(typeof window==='undefined'?globalThis:window);

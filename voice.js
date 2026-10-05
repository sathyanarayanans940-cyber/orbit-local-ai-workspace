/* Online browser dictation. Audio is handled by the browser's speech service;
   Orbit receives text only and never sends a chat automatically. */
(function(root){
  'use strict';
  const languages=Object.freeze({'en-IN':'English (India)','en-US':'English (US)','en-GB':'English (UK)','en-AU':'English (Australia)'});
  const key='orbit-voice-language-v1';
  function language(){try{const value=root.localStorage?.getItem(key);return languages[value]?value:'en-IN';}catch(_){return 'en-IN';}}
  function saveLanguage(value){if(!languages[value])return;try{root.localStorage?.setItem(key,value);}catch(_){} }
  async function probe(signal){
    const response=await root.fetch('/api/voice/connectivity',{cache:'no-store',credentials:'same-origin',headers:{'X-Orbit-Voice':'1'},signal});
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))return false;
    return (await response.json())?.online===true;
  }
  function create({Recognition=root.SpeechRecognition||root.webkitSpeechRecognition,secure=()=>root.isSecureContext===true,online=()=>root.navigator?.onLine===true,check=probe,getText=()=>'',onText=()=>{},onChange=()=>{},onNotice=()=>{},now=()=>Date.now(),schedule=setTimeout,unschedule=clearTimeout,getLanguage=language}={}){
    let phase='idle',connected=false,checkedAt=-Infinity,checking=false,blocked='',rec=null,epoch=0,networkEpoch=0,pending=null,networkTimer=null,expireNetwork=null,disposed=false,base='',parts=[],text='',startTimer=null,limitTimer=null,endTimer=null;
    const active=()=>phase!=='idle';
    function snapshot(){const reason=!secure()?'Voice input needs HTTPS or localhost.':typeof Recognition!=='function'?'Voice input is unavailable in this browser. Try Chrome or Safari.':blocked||(!online()?'Voice input needs an internet connection.':checking?'Checking internet connection…':!connected||now()-checkedAt>45000?'Voice input needs a confirmed internet connection.':'');return {phase,active:active(),available:!disposed&&!reason,reason,text};}
    function emit(){if(!disposed)onChange(snapshot());}
    function clear(){for(const timer of [startTimer,limitTimer,endTimer])if(timer!==null)unschedule(timer);startTimer=limitTimer=endTimer=null;}
    function resultText(finalOnly=false){return base+parts.filter(p=>p&&(!finalOnly||p.final)).map(p=>p.text).join(' ').trim();}
    function release({discard=false,finalOnly=false}={}){
      if(!active())return;const old=rec;rec=null;epoch++;clear();phase='idle';text=discard?base:resultText(finalOnly);parts=[];
      if(old){old.onstart=old.onaudiostart=old.onresult=old.onerror=old.onend=null;try{old.abort();}catch(_){} }
      onText(text);emit();
    }
    function stopProbe(){pending?.abort();pending=null;if(networkTimer!==null)unschedule(networkTimer);networkTimer=null;expireNetwork?.(false);expireNetwork=null;}
    function invalidate(message){networkEpoch++;stopProbe();checking=false;connected=false;checkedAt=-Infinity;if(active())release({finalOnly:true});emit();if(message)onNotice(message);}
    async function refresh(){
      if(disposed)return false;
      if(!online()||!secure()||typeof Recognition!=='function'){invalidate();return false;}
      if(checking)return false;
      checking=true;const revision=++networkEpoch,controller=new AbortController();pending=controller;emit();
      // Race against a deadline even if a service or a test ignores AbortSignal.
      const deadline=new Promise(resolve=>{expireNetwork=resolve;networkTimer=schedule(()=>{controller.abort();resolve(false);},4000);});
      let ok=false;try{ok=await Promise.race([Promise.resolve(check(controller.signal)),deadline])===true;}catch(_){}
      if(disposed||revision!==networkEpoch)return false;
      stopProbe();checking=false;connected=ok&&online();checkedAt=now();
      if(!connected&&active()){release({finalOnly:true});onNotice('Internet connection lost. Your completed dictation is kept.');}
      emit();return connected;
    }
    function finish(){if(!active()||phase==='finishing')return;phase='finishing';for(const timer of [startTimer,limitTimer])if(timer!==null)unschedule(timer);startTimer=limitTimer=null;emit();const revision=epoch;endTimer=schedule(()=>{if(revision===epoch)release();},2500);try{rec.stop();}catch(_){release();}}
    function start(){
      if(disposed||active()||!snapshot().available||getText().trim())return false;
      base=getText();parts=[];text=base;phase='starting';const revision=++epoch;
      try{
        rec=new Recognition();rec.lang=languages[getLanguage()]?getLanguage():'en-IN';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
        if('processLocally' in rec)rec.processLocally=false;
        const current=()=>!disposed&&revision===epoch&&active();
        const listening=()=>{if(!current()||phase==='finishing')return;phase='listening';if(startTimer!==null)unschedule(startTimer);startTimer=null;emit();};
        rec.onstart=rec.onaudiostart=listening;
        rec.onresult=event=>{
          if(!current())return;const results=event.results;if(!results||!Number.isInteger(results.length)||results.length>512)return;
          const from=Number.isInteger(event.resultIndex)&&event.resultIndex>=0?event.resultIndex:0;
          for(let i=from;i<results.length;i++){const r=results[i],value=r?.[0]?.transcript;if(typeof value==='string')parts[i]={text:value.replace(/[\u0000-\u001f]/g,' ').trim(),final:r.isFinal===true};}
          parts.length=results.length;text=resultText();
          if(text.length>16000){text=text.slice(0,16000);parts=[{text:text.slice(base.length),final:true}];finish();onNotice('Dictation reached the text limit. Review it before sending.');}
          onText(text);emit();
        };
        rec.onerror=event=>{
          if(!current())return;const code=event.error;
          if(code==='not-allowed'||code==='service-not-allowed')blocked='Microphone or speech service access is blocked. Allow it in browser settings, then reload.';
          if(code==='network'){connected=false;checkedAt=-Infinity;}
          release({finalOnly:true});
          if(code!=='aborted')onNotice(({network:'Speech service connection failed. Your completed text is kept.','audio-capture':'No microphone is available. Check your microphone settings.','no-speech':'No speech detected. Try again when ready.','language-not-supported':'This speech service does not support the selected accent. Choose another in Settings → Chat.'})[code]||blocked||'Voice input could not start. Your typed text is kept.');
        };
        rec.onend=()=>{if(!current())return;const empty=!resultText().trim();release();if(empty)onNotice('No speech detected. Try again when ready.');};
        startTimer=schedule(()=>{if(current()){release({finalOnly:true});onNotice('The microphone did not start. Check browser microphone access.');}},10000);
        limitTimer=schedule(()=>{if(current()){finish();onNotice('Dictation stopped after two minutes. Review the text before sending.');}},120000);
        emit();rec.start();return true;
      }catch(_){release({finalOnly:true});onNotice('Voice input could not start in this browser. Check microphone access.');return false;}
    }
    function cancel(){release({discard:true});}
    function dispose(){if(disposed)return;cancel();disposed=true;networkEpoch++;stopProbe();}
    return {snapshot,refresh,start,finish,cancel,invalidate,dispose};
  }
  root.OrbitVoice={create,languages,language,saveLanguage};
  if(typeof module!=='undefined')module.exports=root.OrbitVoice;
})(typeof window!=='undefined'?window:globalThis);

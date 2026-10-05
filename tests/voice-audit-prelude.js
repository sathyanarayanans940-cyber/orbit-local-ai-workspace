// This disposable fixture uses a fake microphone and never captures audio.
const qaVoice={online:true,network:true,instances:[],requests:[]};
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>qaVoice.online});
class VoiceAuditRecognition {
  constructor(){this.processLocally=true;this.aborted=false;qaVoice.instances.push(this);}
  start(){this.onstart?.();}
  stop(){this.onend?.();}
  abort(){this.aborted=true;}
}
window.SpeechRecognition=VoiceAuditRecognition;
window.webkitSpeechRecognition=undefined;
const qaVoiceFetch=window.fetch.bind(window);
window.fetch=(url,options={})=>{
  if(String(url).includes('/api/voice/connectivity'))return Promise.resolve(new Response(JSON.stringify({online:qaVoice.network}),{headers:{'Content-Type':'application/json'}}));
  if(String(url).includes('/api/ollama/chat'))qaVoice.requests.push(JSON.parse(options.body));
  return qaVoiceFetch(url,options);
};

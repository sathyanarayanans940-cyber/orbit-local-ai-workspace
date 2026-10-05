// Runs only inside an opaque-origin iframe. Its CSP denies network access.
// Each job gets a fresh worker and private in-memory Python filesystem.
self.onmessage = async ({data}) => {
  const send=self.postMessage.bind(self);
  let output='',truncated=false;
  const append=value=>{const line=String(value)+'\n';if(output.length+line.length>16000)truncated=true;output=(output+line).slice(0,16000);};
  try {
    const assets=new Map(data.assets.map(a=>[a.name,a.bytes]));
    const blobModule=name=>URL.createObjectURL(new Blob([assets.get(name)],{type:'text/javascript'}));
    // Loader reads exclusively from already-bundled bytes. CSP remains the
    // actual network boundary even if generated code changes this function.
    self.fetch=async input=>{
      const name=String(input?.url||input).split('/').pop();
      if(!assets.has(name))throw new Error('Offline Analyze: resource unavailable');
      return new Response(assets.get(name),{headers:{'Content-Type':name.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});
    };
    importScripts(blobModule('pyodide.js'),blobModule('pyodide.asm.js'));
    const python=await loadPyodide({indexURL:'https://offline.invalid/',stdout:append,stderr:append});
    await python.loadPackage(['numpy','scipy','sympy','mpmath']);
    output='';
    // No inherited globals or prior chat data enter the execution namespace.
    const scope=python.toPy({});
    try {const result=await python.runPythonAsync(data.code,{globals:scope});if(result!==undefined&&result!==null)append(String(result));result?.destroy?.();}
    finally{scope.destroy();}
    send({type:'result',ok:true,output,truncated});
  }catch(error){send({type:'result',ok:false,output,truncated,error:String(error?.message||error).slice(-6000)});}
};

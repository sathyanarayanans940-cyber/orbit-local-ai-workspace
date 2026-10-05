// Only the disposable localhost audit page uses these stubs.
const qaNativeFetch=window.fetch.bind(window);
window.fetch=(url,options)=>String(url).startsWith('http://127.0.0.1:1234/')?Promise.resolve(new Response('{"data":[]}',{headers:{'Content-Type':'application/json'}})):qaNativeFetch(url,options);
const qaErrors=[];window.addEventListener('error',e=>qaErrors.push(e.message));window.addEventListener('unhandledrejection',e=>qaErrors.push(String(e.reason?.message||e.reason)));

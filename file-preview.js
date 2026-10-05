/* Read-only previews. Notebook content is data: never execute cells or HTML output. */
function notebookText(value) {
  let book;
  try { book=JSON.parse(value); } catch (_) { throw new Error('This notebook is not valid JSON. Export it as .ipynb from Colab and try again.'); }
  if (!Array.isArray(book?.cells)) throw new Error('This notebook has no readable cells. Export a current .ipynb notebook.');
  const source=v=>Array.isArray(v)?v.join(''):String(v??'');
  const parts=[]; let size=0;
  for(const [i,cell] of book.cells.entries()) {
    if(!cell || !['markdown','code','raw'].includes(cell.cell_type)) continue;
    let part=`--- Cell ${i+1} · ${cell.cell_type} ---\n${source(cell.source)}`;
    for(const output of Array.isArray(cell.outputs)?cell.outputs:[]) {
      const text=output?.text ?? output?.data?.['text/plain'] ?? output?.traceback;
      if(text) part+=`\nOutput:\n${source(text)}`;
    }
    parts.push(part); size+=part.length;
    if(size>100000) break;
  }
  return limitExtractedText(parts.join('\n\n') || '[Empty notebook]');
}

async function readPreviewText(blob){
  const limit=1024*1024,bytes=new Uint8Array(await blob.slice(0,limit).arrayBuffer());
  const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  const text=new TextDecoder(encoding).decode(bytes,{stream:blob.size>limit});
  if(text.includes('\u0000'))throw new Error('This appears to be a binary file. Download the original to open it in its own app.');
  return {text,truncated:blob.size>limit};
}

const OrbitPreview = (()=> {
  const readerBase=new URL('./vendor/readers/',document.currentScript?.src||document.baseURI).href;
  let dbPromise,viewerDbPromise, serial=0, activeUrl='', downloadBlob=null, downloadName='', returnFocus=null, zoom=1, previewCleanup=null;
  const entries=[],identities=new WeakMap(),storedFiles=new WeakMap();let nextId=0,selected=null,mounted=null,used=0;
  const SESSION_KEY='orbit-viewer-tabs-v1';
  // Bound connected previews by count and estimated backing/markup/canvas cost.
  const CACHE_LIMIT=4,CACHE_BYTES=64*1024*1024;
  const panel=document.createElement('section');
  panel.id='file-preview';panel.hidden=true;panel.setAttribute('aria-label','Viewer');
  panel.innerHTML='<div id="preview-tabs" role="tablist" aria-label="Open files"></div><header><strong id="preview-name">Viewer</strong><div class="preview-controls"><button type="button" data-preview-zoom="-1" aria-label="Zoom out"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button><span id="preview-zoom">100%</span><button type="button" data-preview-zoom="1" aria-label="Zoom in"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button><button type="button" id="preview-download" aria-label="Download file"><svg><use href="#icon-arrow-down"/></svg></button><button type="button" id="preview-close" aria-label="Hide viewer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header><div id="preview-body" role="tabpanel" tabindex="0"></div>';
  document.body.appendChild(panel);
  const host=panel.querySelector('#preview-body');let body=host;
  const tabList=panel.querySelector('#preview-tabs');
  function db() {
    return dbPromise ||= openDatabase('orbit-file-previews','files',()=>{dbPromise=null;});
  }
  function viewerDb(){return viewerDbPromise ||= openDatabase('orbit-viewer-tabs','viewer',()=>{viewerDbPromise=null;});}
  function openDatabase(name,storeName,invalidate){
    return new Promise((resolve,reject)=>{
      // No version upgrade: another Orbit tab can still hold the original file DB.
      const request=indexedDB.open(name);let failed=false;
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName);};
      request.onsuccess=()=>{if(failed){request.result.close();return;}request.result.onversionchange=()=>{request.result.close();invalidate();};resolve(request.result);};
      const fail=error=>{failed=true;invalidate();reject(error||new Error('File storage is temporarily unavailable.'));};
      request.onerror=()=>fail(request.error);request.onblocked=()=>fail(new Error('File storage is temporarily unavailable.'));
    });
  }
  async function store(file) {
    if(storedFiles.has(file))return storedFiles.get(file);
    const pending=storeFile(file);storedFiles.set(file,pending);
    const id=await pending;if(!id)storedFiles.delete(file);return id;
  }
  async function storeFile(file) {
    if(file.size>25*1024*1024) return '';
    try {
      const database=await db(),id=crypto.randomUUID();
      await new Promise((resolve,reject)=>{const tx=database.transaction('files','readwrite');tx.objectStore('files').put(file,id);tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error || new Error("File storage was interrupted"));});
      return id;
    } catch (_) { return ''; }
  }
  async function retrieve(id) {
    if(!id) return null;
    try {const database=await db();return await new Promise((resolve,reject)=>{const r=database.transaction('files').objectStore('files').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch(_){return null;}
  }
  const token=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bounded=(value,min,max,fallback=0)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
  function fileRef(value){
    if(!value||typeof value.chatId!=='string')return null;
    return {chatId:value.chatId,messageIndex:Number.isInteger(value.messageIndex)&&value.messageIndex>=0?value.messageIndex:undefined,
      attachmentIndex:Number.isInteger(value.attachmentIndex)&&value.attachmentIndex>=0?value.attachmentIndex:undefined,
      artifactId:typeof value.artifactId==='string'?value.artifactId:undefined};
  }
  function capturePosition(){
    if(selected!==mounted||!mounted?.ready||panel.hidden)return;
    selected.zoom=zoom;selected.scrollTop=body.scrollTop||0;selected.scrollLeft=body.scrollLeft||0;
    const frame=body.querySelector('iframe[data-word-preview]');try{selected.wordScroll=frame?.contentDocument?.scrollingElement?.scrollTop||0;}catch(_){}
  }
  // Only small descriptors live in localStorage. Originals and recipes stay on disk.
  function saveSession(){
    capturePosition();
    try{localStorage.setItem(SESSION_KEY,JSON.stringify({version:1,selected:selected?.storageId||null,tabs:entries.map(entry=>({
      storageId:entry.storageId,key:entry.key,name:entry.name,kind:entry.kind,origin:entry.origin,ref:entry.ref,
      previewId:entry.source?.attachment?.previewId||entry.previewId,zoom:entry.zoom,scrollTop:entry.scrollTop,scrollLeft:entry.scrollLeft,wordScroll:entry.wordScroll,position:entry.position
    }))}));}catch(_){} // Storage restrictions must not break the in-memory viewer.
  }
  function restoreSession(){
    try{
      const raw=localStorage.getItem(SESSION_KEY);if(!raw||raw.length>2*1024*1024)return;
      const saved=JSON.parse(raw);if(saved.version!==1||!Array.isArray(saved.tabs))return;
      const ids=new Set();
      for(const tab of saved.tabs){
        if(!tab||typeof tab.storageId!=='string'||typeof tab.key!=='string'||typeof tab.name!=='string'||ids.has(tab.storageId))continue;
        ids.add(tab.storageId);
        const p=tab.position||{};
        entries.push({id:`viewer-tab-${++nextId}`,storageId:tab.storageId,key:tab.key,name:tab.name.slice(0,1000),kind:String(tab.kind||'FILE').slice(0,6),
          origin:typeof tab.origin==='string'?tab.origin:null,ref:fileRef(tab.ref),previewId:typeof tab.previewId==='string'?tab.previewId:'',source:null,
          zoom:bounded(tab.zoom,.25,3,1),scrollTop:bounded(tab.scrollTop,0,1e9),scrollLeft:bounded(tab.scrollLeft,0,1e9),wordScroll:bounded(tab.wordScroll,0,1e9),
          position:{sheet:Math.floor(bounded(p.sheet,0,1000)),offset:Math.floor(bounded(p.offset,0,1e6)),pdfPage:Math.floor(bounded(p.pdfPage,1,1e6,1)),pdfRendered:p.pdfRendered===true,archivePath:typeof p.archivePath==='string'?p.archivePath.slice(0,500):''}});
      }
      selected=entries.find(entry=>entry.storageId===saved.selected)||entries.at(-1)||null;
    }catch(_){}
  }
  async function viewerRecord(id,value,remove=false){
    try{
      const database=await viewerDb();
      return await new Promise((resolve,reject)=>{
        const tx=database.transaction('viewer',value||remove?'readwrite':'readonly'),store=tx.objectStore('viewer');
        if(remove)store.delete(id);else if(value)store.put(value,id);
        else{const r=store.get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}
        tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Viewer storage was interrupted'));
      });
    }catch(_){return null;}
  }
  async function rememberSource(entry){
    const source=entry.source;if(!source)return;
    const a=source.attachment;
    if(a?.file&&!a.previewId){const id=await store(a.file);if(id&&entry.source===source){a.previewId=id;delete a.file;}}
    if(!entries.includes(entry)||entry.source!==source)return;
    // Blob URLs and File objects are transient. Keep only reconstructable source data.
    const snapshot=source.artifact?{artifact:{id:source.artifact.id,spec:source.artifact.spec,imageAssets:source.artifact.imageAssets||{},archiveSources:source.artifact.archiveSources||{},revision:source.artifact.revision||0}}:
      {attachment:Object.fromEntries(['name','type','size','previewId','extractedText','dataUrl'].filter(key=>a[key]!==undefined).map(key=>[key,a[key]]))};
    await viewerRecord(entry.storageId,snapshot);
    if(entries.includes(entry))saveSession();
  }
  async function resolveSource(entry){
    if(entry.source)return entry.source;
    let source=await viewerRecord(entry.storageId);
    if(!source?.artifact&&!source?.attachment && entry.ref && typeof OrbitChatStore!=='undefined'){
      const ref=entry.ref;
      if(typeof state==='undefined'||!state.deletedChats?.has(ref.chatId)){
        const messages=typeof state!=='undefined'&&state.currentChat===ref.chatId?state.messages:(await OrbitChatStore.load(ref.chatId))?.messages;
        if(ref.artifactId){
          for(const message of messages||[]){if(typeof recoverMessageWidgets==='function')recoverMessageWidgets(message);const artifact=message.artifacts?.find(item=>item.id===ref.artifactId);if(artifact){source={artifact};break;}}
        }else{const attachment=messages?.[ref.messageIndex]?.attachments?.[ref.attachmentIndex];if(attachment)source={attachment:{...attachment}};}
      }
    }
    if(!source?.artifact&&!source?.attachment && entry.previewId)source={attachment:{name:entry.name,previewId:entry.previewId}};
    if(!source?.artifact&&!source?.attachment)throw new Error('This file is no longer available. Open it from Files or reattach the original.');
    entry.source=source;return source;
  }
  function modalState() {
    const modal=!panel.hidden && (panel.classList.contains('image-preview') || matchMedia('(max-width: 900px)').matches);
    const shell=document.querySelector('.app-shell');if(shell)shell.inert=modal;
    panel.setAttribute('role',modal?'dialog':'region');
    if(modal) panel.setAttribute('aria-modal','true');else panel.removeAttribute('aria-modal');
  }
  function disposeEntry(entry){
    entry.cleanup?.();entry.cleanup=null;
    if(entry.url)URL.revokeObjectURL(entry.url);entry.url='';entry.blob=null;
    entry.view?.remove();entry.view=null;entry.ready=false;entry.bytes=0;
  }
  function trimCache(){
    let live=entries.filter(entry=>entry.view);
    while(live.length>CACHE_LIMIT||live.reduce((total,entry)=>total+(entry.bytes||0),0)>CACHE_BYTES){
      const oldest=live.filter(entry=>entry!==mounted).sort((a,b)=>a.used-b.used)[0];if(!oldest)break;
      disposeEntry(oldest);live=live.filter(entry=>entry!==oldest);
    }
  }
  function release(discard=false) {
    capturePosition();saveSession();
    serial++;
    if(mounted){mounted.url=activeUrl;mounted.blob=downloadBlob;mounted.cleanup=previewCleanup;
      if(discard||!mounted.ready||mounted.busy||mounted.failed)disposeEntry(mounted);else mounted.view.hidden=true;
    }
    previewCleanup=null;
    mounted=null;
    activeUrl='';downloadBlob=null;body=host;
    // The empty-state content is not a cached file pane.
    if(!selected)host.replaceChildren();
  }
  function close() {
    if(panel.hidden)return;
    release();panel.hidden=true;document.body.classList.remove('preview-open');
    const shell=document.querySelector('.app-shell');if(shell)shell.inert=false;
    syncControls();
    if(returnFocus?.isConnected) returnFocus.focus();else document.querySelector('#open-viewer')?.focus();
    window.dispatchEvent(new Event('resize'));
  }
  function syncControls(){
    const toggle=document.querySelector('#open-viewer');if(toggle){toggle.setAttribute('aria-expanded',String(!panel.hidden));toggle.setAttribute('aria-label',`${panel.hidden?'Open':'Hide'} viewer${entries.length?` · ${entries.length} open file${entries.length===1?'':'s'}`:''}`);
      const count=toggle.querySelector('.viewer-tab-count');if(count){count.hidden=!entries.length;count.textContent=String(entries.length);}
    }
    panel.querySelectorAll('[data-preview-zoom]').forEach(button=>button.disabled=!selected);
    if(!selected){panel.querySelector('#preview-download').disabled=true;panel.querySelector('#preview-name').textContent='Viewer';panel.querySelector('#preview-zoom').textContent='';body.removeAttribute('aria-labelledby');}
  }
  function renderTabs(){
    const focused=document.activeElement?.dataset?.viewerTab;
    tabList.replaceChildren();
    for(const entry of entries){
      const item=document.createElement('div');item.className='viewer-tab';item.classList.toggle('is-active',entry===selected);
      const tab=document.createElement('button');tab.type='button';tab.id=entry.id;tab.dataset.viewerTab=entry.id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','preview-body');tab.setAttribute('aria-selected',String(entry===selected));tab.tabIndex=entry===selected?0:-1;tab.title=entry.name;
      const label=document.createElement('span');label.className='viewer-tab-name';label.textContent=entry.name;
      const kind=document.createElement('span');kind.className='viewer-tab-kind';kind.dataset.kind=entry.kind;kind.textContent=entry.kind;tab.append(kind,label);tab.onclick=()=>void activate(entry);
      tab.onkeydown=event=>{let index=entries.indexOf(entry),target;
        if(event.key==='ArrowRight')target=entries[(index+1)%entries.length];
        if(event.key==='ArrowLeft')target=entries[(index+entries.length-1)%entries.length];
        if(event.key==='Home')target=entries[0];if(event.key==='End')target=entries.at(-1);
        if(event.key==='Delete'){event.preventDefault();void closeTab(entry.id);return;}
        if(target){event.preventDefault();void activate(target);}
      };
      const remove=document.createElement('button');remove.type='button';remove.className='viewer-tab-close';remove.setAttribute('aria-label',`Close ${entry.name}`);remove.title=`Close ${entry.name}`;remove.textContent='×';remove.onclick=()=>void closeTab(entry.id);
      item.append(tab,remove);tabList.append(item);
      if(entry===selected){host.setAttribute('aria-labelledby',entry.id);if(focused)tab.focus();tab.scrollIntoView?.({block:'nearest',inline:'nearest'});}
    }
    syncControls();
  }
  function empty(){panel.classList.remove('image-preview');body.innerHTML='<div class="viewer-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/></svg><h2>Your files, side by side</h2><p>Open a file from your chat to add a tab here.</p><p class="preview-note">ZIP folders, PDF, Word, Excel, PowerPoint, images and text or code files</p></div>';syncControls();modalState();}
  async function open(){
    if(!panel.hidden)return;
    if(selected)await activate(selected);else{returnFocus=document.activeElement;panel.hidden=false;document.body.classList.add('preview-open');empty();panel.querySelector('#preview-close').focus();window.dispatchEvent(new Event('resize'));}
  }
  async function closeTab(id){
    const index=entries.findIndex(entry=>entry.id===id);if(index<0)return;
    const entry=entries[index],active=entry===selected;if(active)release(true);disposeEntry(entry);entries.splice(index,1);
    if(active)selected=entries[Math.min(index,entries.length-1)]||null;
    saveSession();void viewerRecord(entry.storageId,null,true);renderTabs();
    if(active&&!panel.hidden){if(selected)await activate(selected);else{empty();panel.querySelector('#preview-close').focus();}}
    else if(!panel.hidden&&selected)tabList.querySelector(`#${selected.id}`)?.focus();
  }
  function identity(source){
    if(typeof source.archiveMemberKey==='string')return source.archiveMemberKey;
    const origin=Object.hasOwn(source,'chatId')?source.chatId:(typeof state==='undefined'?'':state.currentChat||'');
    if(source.artifact?.id)return `artifact:${origin||''}:${source.artifact.id}`;
    const a=source.attachment;if(a?.previewId)return `file:${a.previewId}`;
    const ref=fileRef(source.ref);if(ref&&ref.attachmentIndex!==undefined&&ref.messageIndex!==undefined)return `attachment:${ref.chatId}:${ref.messageIndex}:${ref.attachmentIndex}`;
    const object=a?.file||source.artifact||a;
    if(!identities.has(object))identities.set(object,`object:${token()}`);return identities.get(object);
  }
  async function show(source){
    if(!source?.attachment&&!source?.artifact)return;
    const key=identity(source),name=source.artifact?OrbitWidgets.filename(source.artifact.spec):source.attachment.name||'File';
    const ref=fileRef(source.ref);
    let entry=entries.find(entry=>entry.key===key||source.attachment?.previewId&&(entry.source?.attachment?.previewId||entry.previewId)===source.attachment.previewId || ref&&entry.ref?.chatId===ref.chatId && (ref.artifactId?entry.ref.artifactId===ref.artifactId:ref.messageIndex===entry.ref.messageIndex&&ref.attachmentIndex!==undefined&&ref.attachmentIndex===entry.ref.attachmentIndex));
    if(!entry){const kind=source.artifact?.spec.kind?.toUpperCase()||(/\.([^.]+)$/.exec(name)?.[1]||'TEXT').slice(0,6).toUpperCase();entry={id:`viewer-tab-${++nextId}`,storageId:token(),key,name,kind,source:source.artifact?{artifact:source.artifact}:{attachment:{...source.attachment}},ref,zoom:1,scrollTop:0,scrollLeft:0,position:{},origin:Object.hasOwn(source,'chatId')?source.chatId:(typeof state==='undefined'?null:state.currentChat),original:source.attachment&&!source.attachment.file&&!source.attachment.previewId&&isPdfFile(source.attachment)?source.attachment:null};entries.push(entry);}
    else if(!entry.source||source.attachment?.file)entry.source=source.artifact?{artifact:source.artifact}:{attachment:{...source.attachment}};
    if(ref)entry.ref=ref;
    const page=Number(source.page);
    const jump=Number.isSafeInteger(page)&&page>0&&entry.kind==='PDF';
    if(jump){entry.position.pdfPage=page;entry.position.pdfRendered=true;entry.scrollTop=0;}
    // Commit the source before show resolves, without delaying preview rendering.
    await Promise.all([rememberSource(entry),activate(entry,jump)]);
  }
  async function activate(entry,force=false){
    if(!entries.includes(entry))return;
    if(!force&&!entry.failed&&selected===entry&&mounted===entry&&!panel.hidden){tabList.querySelector(`#${entry.id}`)?.focus();return;}
    if(panel.hidden)returnFocus=document.activeElement;
    release();if(force)disposeEntry(entry);selected=mounted=entry;entry.used=++used;zoom=entry.zoom;panel.hidden=false;document.body.classList.add('preview-open');
    if(!entry.view){body=document.createElement('div');body.className='preview-pane';entry.view=body;host.append(body);}else body=entry.view;
    body.hidden=false;renderTabs();trimCache();saveSession();
    if(entry.ready){activeUrl=entry.url||'';downloadBlob=entry.blob;previewCleanup=entry.cleanup;downloadName=entry.name;
      panel.querySelector('#preview-name').textContent=entry.name;panel.querySelector('#preview-download').disabled=!downloadBlob;
      panel.classList.toggle('image-preview',!!entry.source.attachment&&isImageFile(entry.source.attachment));modalState();setZoom();
      body.scrollTop=entry.scrollTop;body.scrollLeft=entry.scrollLeft;
      const frame=body.querySelector('iframe[data-word-preview]');try{if(frame?.contentDocument?.scrollingElement)frame.contentDocument.scrollingElement.scrollTop=entry.wordScroll||0;}catch(_){}
      tabList.querySelector(`#${entry.id}`)?.focus();window.dispatchEvent(new Event('resize'));return;
    }
    await renderEntry(entry);
    if(selected!==entry||mounted!==entry||panel.hidden)return;
    entry.ready=!entry.failed&&!entry.missing;entry.bytes+=(body.innerHTML?.length||0)*2;trimCache();
    body.scrollTop=entry.scrollTop;body.scrollLeft=entry.scrollLeft;
  }
  function fitSlides() {
    if(!mounted||panel.hidden)return;
    const word=body.querySelector('iframe[data-word-preview]');
    if(word?.contentDocument){const doc=word.contentDocument,pages=[...doc.querySelectorAll('section.orbit-word')];if(pages.length){const width=Math.max(...pages.map(p=>p.offsetWidth))+40;doc.documentElement.style.zoom=String(Math.min(1,word.clientWidth/width)*zoom);}}

    const content=body.firstElementChild;
    if(content?.classList.contains('presentation-document')) {
      const padding=getComputedStyle(body);
      content.style.width=`${Math.max(1,body.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight))}px`;
    }
    body.querySelectorAll('.presentation-frame').forEach(frame=>{
      const canvas=frame.querySelector('.presentation-canvas');
      if(canvas)canvas.style.transform=`scale(${frame.clientWidth/1280})`;
    });
  }
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(fitSlides).observe(body);
  function setZoom() {
    panel.querySelector('#preview-zoom').textContent=`${Math.round(zoom*100)}%`;
    const content=body.firstElementChild;if(content && content.tagName!=='IFRAME') content.style.zoom=String(zoom);fitSlides();
  }
  const rich=v=>Array.isArray(v)?v.map(r=>{let t=escapeHtml(r.text);if(r.bold)t=`<strong>${t}</strong>`;if(r.italic)t=`<em>${t}</em>`;if(r.underline)t=`<u>${t}</u>`;if(/^[0-9a-f]{6}$/i.test(r.color||''))t=`<span style="color:#${r.color}">${t}</span>`;return t;}).join(''):escapeHtml(v==null?'':String(v));
  const table=(headers,rows)=>`<div class="preview-table"><table><thead><tr>${headers.map(x=>`<th>${rich(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${rich(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  function specMarkup(spec,images={}) {
    const img=b=>{const v=images[b.assetId];return v&&OrbitDocuments.validImage(v.dataUrl)?`<figure><img style="max-width:100%;max-height:650px;object-fit:contain" src="${v.dataUrl}" alt="${escapeHtml(b.caption||v.label||'Uploaded image')}"/>${b.caption?`<figcaption>${escapeHtml(b.caption)}</figcaption>`:''}</figure>`:'<p>Image unavailable; reattach the original.</p>';};
    if(spec.kind==='diagram') return OrbitWidgets.diagramSvg(spec).replace('<svg ', `<svg style="min-width:${spec.width}px" `);
    if(spec.kind==='chart') return OrbitWidgets.chartSvg(spec);
    if(spec.kind==='xlsx') return spec.sheets.map(sheet=>`<section class="preview-page"><h2>${escapeHtml(sheet.name)}</h2>${table(sheet.headers,sheet.rows)}</section>`).join('');
    const visual=v=>`<div class="preview-embedded-visual">${OrbitWidgets.visualSvg(v)}</div>`;
    if(spec.kind==='pptx') return '<p>Loading slide preview…</p>';
    return `<section class="preview-page"><h1>${escapeHtml(spec.title)}</h1>${spec.blocks.map(b=>{
      if(b.type==='image')return img(b);
      if(b.type==='visual')return `<figure>${visual(b.visual)}${b.caption?`<figcaption>${escapeHtml(b.caption)}</figcaption>`:''}</figure>`;
      if(b.type==='heading')return `<h2>${rich(b.text)}</h2>`;
      if(b.type==='paragraph')return `<p>${rich(b.text)}</p>`;
      if(b.type==='code')return `<pre>${escapeHtml(b.text)}</pre>`;
      if(b.type==='bullets')return `<ul>${b.items.map(x=>`<li>${rich(x)}</li>`).join('')}</ul>`;
      if(b.type==='table')return table(b.headers,b.rows);
      return '</section><section class="preview-page">';
    }).join('')}</section>`;
  }
  async function officeMarkup(blob, attachment) {
    if(isPptxFile(attachment)) {
      const doc=await OrbitDocuments.read(new File([blob],attachment.name,{type:blob.type}));
      const text=doc.text;
      return '<p class="preview-note">Read-only slide text and embedded-image preview · Original slide layout may differ.</p>'+text.split(/(?=--- Slide \d+ ---)/).filter(Boolean).map(slide=>`<section class="preview-page preview-slide"><pre>${escapeHtml(slide)}</pre></section>`).join('')+doc.images.map(v=>`<figure><img style="max-width:100%" src="${v.dataUrl}" alt="${escapeHtml(v.label)}"/><figcaption>${escapeHtml(v.label)}</figcaption></figure>`).join('');
    }
    return '';
  }
  async function showWord(blob,request,entry){
    if(blob.size>25*1024*1024)throw Error('Word previews are limited to 25 MB. Download the original document.');
    const markup=await (await OrbitWidgets.engine()).wordPreview(blob);
    if(request!==serial)return;
    const pane=body;entry.bytes+=(markup.length||0)*2;
    const frame=document.createElement('iframe');frame.title='Word document preview';frame.setAttribute('sandbox','allow-same-origin');frame.dataset.wordPreview='true';frame.onload=()=>{if(entry.view!==pane)return;if(mounted===entry)fitSlides();if(frame.contentDocument?.scrollingElement)frame.contentDocument.scrollingElement.scrollTop=entry.wordScroll||0;};frame.srcdoc=markup;
    const note=document.createElement('p');note.className='preview-note';note.textContent='Word layout preview · Some automatic pagination and advanced Office features may differ. Download for the original.';
    body.replaceChildren(frame,note);
  }
  function showSheets(sheets,note='Read-only workbook preview · Values are shown without recalculating formulas.',position={}){
    const root=document.createElement('div');root.className='sheet-viewer';
    const tabs=document.createElement('div');tabs.className='sheet-tabs';tabs.setAttribute('role','tablist');
    const grid=document.createElement('div');grid.className='sheet-grid';
    const nav=document.createElement('div');nav.className='sheet-nav';
    const status=document.createElement('span'),previous=document.createElement('button'),next=document.createElement('button');previous.textContent='Previous rows';next.textContent='Next rows';previous.type=next.type='button';
    const notice=document.createElement('p');notice.className='preview-note';notice.textContent=note;
    let selected=Math.min(position.sheet||0,Math.max(0,sheets.length-1)),offset=position.offset||0;
    if(!sheets.length)sheets=[{name:'Workbook',headers:[],rows:[]}];
    function render(){const sheet=sheets[selected],rows=sheet.rows||[],first=sheet.startRow||2;offset=Math.max(0,Math.min(offset,Math.max(0,Math.ceil(rows.length/100)-1)));position.sheet=selected;position.offset=offset;const start=offset*100,visible=rows.slice(start,start+100);grid.innerHTML=table(['Row',...sheet.headers],visible.map((r,i)=>[String(start+i+first),...r]));status.textContent=rows.length?`${sheet.name} · Rows ${start+first}–${start+visible.length+first-1} of ${rows.length+first-1}`:`${sheet.name} · Empty sheet`;previous.disabled=offset===0;next.disabled=start+100>=rows.length;[...tabs.children].forEach((t,i)=>t.setAttribute('aria-selected',String(i===selected)));grid.scrollTop=0;}
    sheets.forEach((sheet,i)=>{const b=document.createElement('button');b.type='button';b.textContent=sheet.name;b.setAttribute('role','tab');b.onclick=()=>{selected=i;offset=0;render();};tabs.append(b);});
    previous.onclick=()=>{offset--;render();};next.onclick=()=>{offset++;render();};nav.append(previous,status,next);root.append(tabs,grid,nav,notice);body.replaceChildren(root);render();
  }
  async function uploadedSheets(blob){
    if(blob.size>10*1024*1024)throw Error('Spreadsheet previews are limited to 10 MB.');
    const wb=window.XLSX.read(await blob.arrayBuffer(),{type:'array',sheetRows:2000,cellHTML:false});
    return wb.SheetNames.slice(0,20).map(name=>{const sheet=wb.Sheets[name];if(!sheet['!ref'])return {name,headers:[],rows:[]};const range=window.XLSX.utils.decode_range(sheet['!ref']);range.e.r=Math.min(range.e.r,range.s.r+1999);range.e.c=Math.min(range.e.c,range.s.c+99);const rows=window.XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',range});const width=range.e.c-range.s.c+1;return {name,startRow:range.s.r+1,headers:Array.from({length:width},(_,i)=>window.XLSX.utils.encode_col(range.s.c+i)),rows:rows.map(row=>Array.from({length:width},(_,i)=>row[i]??''))};});
  }
  function pdfFallback(blob,name,request,position={},entry=mounted) {
    const pane=body,alive=()=>entry.view===pane;
    const button=document.createElement('button');button.type='button';button.className='preview-pdf-fallback';button.textContent='PDF not showing? Render PDF pages';
    const original=[...body.children];
    button.onclick=async()=>{
      if(button.disabled || !alive() || mounted!==entry)return;
      button.disabled=true;button.textContent='Rendering PDF pages…';
      position.pdfRendered=true;entry.busy=true;
      let task,renderTask,disposed=false;
      const active=()=>!disposed && alive();
      const dispose=()=>{
        if(disposed)return;disposed=true;
        renderTask?.cancel();
        if(task)void Promise.resolve(task.destroy()).catch(()=>{});
      };
      entry.cleanup=previewCleanup=dispose;
      try {
        const reader=window.pdfjsLib||await import('./vendor/readers/pdf.min.mjs');reader.GlobalWorkerOptions.workerSrc=readerBase+'pdf.worker.min.mjs';
        const data=await blob.arrayBuffer();if(!active())return;
        task=reader.getDocument({data,cMapUrl:readerBase+'cmaps/',cMapPacked:true,standardFontDataUrl:readerBase+'standard_fonts/',isEvalSupported:false,useWasm:false});
        const doc=await task.promise;if(!active())return;
        const root=document.createElement('div'),nav=document.createElement('div'),canvas=document.createElement('canvas'),status=document.createElement('span'),prev=document.createElement('button'),next=document.createElement('button'),retry=document.createElement('button');
        root.className='pdf-page-viewer';nav.className='sheet-nav';prev.type=next.type=retry.type='button';prev.textContent='Previous page';next.textContent='Next page';retry.textContent='Retry page';retry.hidden=true;canvas.style.maxWidth='100%';let current=Math.max(1,Math.min(doc.numPages,position.pdfPage||1)),busy=false;
        async function render(){
          busy=true;entry.busy=true;prev.disabled=next.disabled=retry.disabled=true;const number=current;let page;
          try {
            page=await doc.getPage(number);if(!active())return;
            const original=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,2800/Math.max(original.width,original.height))});
            canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#fff'});
            await renderTask.promise;if(!active())return;
            position.pdfPage=number;status.textContent=`Page ${number} of ${doc.numPages}`;retry.hidden=true;
            entry.bytes=Math.max(entry.bytes||0,blob.size*3+canvas.width*canvas.height*4);trimCache();
          } finally {
            renderTask=null;page?.cleanup();busy=false;if(alive())entry.busy=false;
            if(active()){prev.disabled=current===1;next.disabled=current===doc.numPages;retry.disabled=false;}
          }
        }
        const turn=async(delta)=>{
          if(!active() || mounted!==entry || busy || current+delta<1 || current+delta>doc.numPages)return;
          current+=delta;
          try{await render();}catch(error){if(active()){status.textContent=`Page ${current}: ${error.message || 'Could not render'}`;retry.hidden=false;}}
        };
        prev.onclick=()=>void turn(-1);next.onclick=()=>void turn(1);retry.onclick=()=>void turn(0);nav.append(prev,status,next,retry);root.append(nav,canvas);pane.replaceChildren(root);
        await render();if(active()&&mounted===entry)setZoom();
      }catch(error){
        dispose();if(previewCleanup===dispose)previewCleanup=null;if(entry.cleanup===dispose)entry.cleanup=null;
        if(alive()){button.disabled=false;button.textContent=(error.message || 'PDF rendering failed')+' Download the original PDF or retry.';pane.replaceChildren(...original,button);}
      }finally{
        if(alive())entry.busy=false;
      }
    };
    body.append(button);
    if(position.pdfRendered)void button.onclick();
  }
  async function showArchive(blob,request,entry){
    const archive=await OrbitArchives.open(blob);if(request!==serial)return;
    const pane=body,section=document.createElement('section');section.className='archive-browser';
    const title=document.createElement('h2');title.textContent=entry.name;
    const note=document.createElement('p');note.className='preview-note';note.textContent=`${archive.entries.filter(e=>!e.dir).length} files · Open folders to explore; click a file to open a viewer tab.`;
    const crumbs=document.createElement('nav');crumbs.className='archive-breadcrumbs';crumbs.setAttribute('aria-label','ZIP folders');
    const list=document.createElement('div');list.className='archive-list';
    const status=document.createElement('p');status.className='preview-note';status.setAttribute('role','status');
    section.append(title,note,crumbs,list,status);pane.replaceChildren(section);
    const children=new Map();
    function draw(prefix=''){
      if(prefix&&!archive.entries.some(e=>e.path.startsWith(prefix)))prefix='';entry.position.archivePath=prefix;
      crumbs.replaceChildren();list.replaceChildren();status.textContent='';
      const crumb=(label,folder)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{draw(folder);saveSession();};crumbs.append(b);};
      crumb('ZIP','');let walked='';for(const name of prefix.split('/').filter(Boolean)){walked+=name+'/';crumb(name,walked);}
      const rows=new Map();
      for(const e of archive.entries){if(!e.path.startsWith(prefix)||e.path===prefix)continue;const relative=e.path.slice(prefix.length),name=relative.split('/')[0],dir=relative.includes('/');if(!rows.has(name)||!dir)rows.set(name,{name,dir,path:prefix+name+(dir?'/':''),entry:e});}
      for(const row of [...rows.values()].sort((a,b)=>Number(b.dir)-Number(a.dir)||a.name.localeCompare(b.name))){
        const button=document.createElement('button');button.type='button';button.className='archive-row';
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href',row.dir?'#icon-folder':'#'+attachmentFileKind({name:row.name}).icon);icon.append(use);
        const label=document.createElement('span');label.textContent=row.name;
        const detail=document.createElement('small');detail.textContent=row.dir?'Folder':typeof formatFileSize==='function'?formatFileSize(row.entry.size):`${row.entry.size} B`;
        button.append(icon,label,detail);button.onclick=async()=>{
          if(row.dir){draw(row.path);saveSession();return;}button.disabled=true;status.textContent='Opening '+row.name+'…';
          try{const archiveMemberKey=`zip-member:${entry.storageId}:${row.path}`,existing=entries.find(child=>child.key===archiveMemberKey);if(existing){await activate(existing);status.textContent='';return;}let attachment=children.get(row.path);if(!attachment){const file=await archive.read(row.entry);const previewId=await store(file);attachment={...(previewId?{previewId}:{file}),name:file.name,type:file.type,size:file.size};children.set(row.path,attachment);if(children.size>2)children.delete(children.keys().next().value);}if(entry.view!==pane||mounted!==entry){status.textContent='';return;}await show({attachment,chatId:entry.origin,archiveMemberKey});status.textContent='';}
          catch(error){if(entry.view===pane)status.textContent=error.message;}finally{button.disabled=false;}
        };list.append(button);
      }
      if(!rows.size){const empty=document.createElement('p');empty.className='preview-note';empty.textContent='This folder is empty.';list.append(empty);}
    }
    draw(entry.position.archivePath||'');
  }
  async function renderEntry(entry) {
    const request=++serial,name=entry.name;
    mounted=entry;entry.failed=false;entry.missing=false;entry.bytes=0;
    downloadName=name;panel.querySelector('#preview-name').textContent=name;
    panel.classList.remove('image-preview');
    body.textContent='Loading preview…';
    const download=panel.querySelector('#preview-download');download.disabled=true;
    modalState();tabList.querySelector(`#${entry.id}`)?.focus();window.dispatchEvent(new Event('resize'));
    try {
      const {attachment,artifact}=await resolveSource(entry);if(request!==serial)return;
      panel.classList.toggle('image-preview',!!attachment&&isImageFile(attachment));modalState();
      let blob=artifact?null:attachment.file || await retrieve(attachment.previewId);
      if(request!==serial)return;
      entry.bytes=(blob?.size||0)*3;
      downloadBlob=blob;download.disabled=!blob;
      if(!artifact&&blob&&isSpreadsheetFile(attachment)&&!window.XLSX){await OrbitDocuments.ensureReaders('excel');if(request!==serial)return;}
      if(artifact) {
        if(artifact.spec.kind==='pptx') {
          const markup=await OrbitWidgets.generate(artifact.spec,{images:artifact.imageAssets||{},preview:true});
          if(request!==serial)return;
          body.innerHTML=`<div class="preview-document presentation-document">${markup}</div>`;fitSlides();
        } else if(artifact.spec.kind==='zip') {
          // ZIP folder UI is populated after the exact archive bytes are built.
        } else if(['text','ipynb'].includes(artifact.spec.kind)) {
          const spec=OrbitWidgets.normalize(artifact.spec);
          const content=document.createElement('div');content.className='preview-document';
          const page=document.createElement('section');page.className='preview-page preview-text';
          const note=document.createElement('p');note.className='preview-note';note.textContent=spec.kind==='ipynb'?'Read-only notebook preview · Code has not been executed.':'Read-only text preview';
          const pre=document.createElement('pre');pre.textContent=spec.kind==='ipynb'?notebookText(JSON.stringify(spec.notebook)):spec.content;
          page.append(note,pre);content.append(page);body.replaceChildren(content);
        } else if(!['pdf','docx','xlsx'].includes(artifact.spec.kind)) body.innerHTML=`<div class="preview-document">${specMarkup(OrbitWidgets.normalize(artifact.spec),artifact.imageAssets||{})}</div>`;
        blob=(artifact.spec.kind==='diagram'?null:widgetBlobs.get(artifact.id))||await OrbitWidgets.generate(artifact.spec,{images:artifact.imageAssets||{},archiveSources:artifact.archiveSources});
        if(request!==serial)return;
        entry.bytes=(blob?.size||0)*3;
        if(artifact.spec.kind==='zip')await showArchive(blob,request,entry);
        if(artifact.spec.kind==='docx')await showWord(blob,request,entry);
        if(artifact.spec.kind==='xlsx')showSheets(OrbitWidgets.normalize(artifact.spec).sheets,undefined,entry.position);
        if(artifact.spec.kind==='pdf') {activeUrl=URL.createObjectURL(blob);const frame=document.createElement('iframe');frame.title=name;frame.src=activeUrl+'#navpanes=0&toolbar=1&page='+(entry.position.pdfPage||1);body.replaceChildren(frame);pdfFallback(blob,name,request,entry.position);}
      } else if(blob && typeof OrbitArchives!=='undefined' && OrbitArchives.isZip(attachment)) {
        await showArchive(blob,request,entry);
      } else if(blob && isDocxFile(attachment)) {
        await showWord(blob,request,entry);
      } else if(blob && isSpreadsheetFile(attachment) && window.XLSX) {
        const sheets=await uploadedSheets(blob);if(request!==serial)return;showSheets(sheets,'Read-only preview · Up to 20 sheets, 2,000 rows and 100 columns per sheet. Saved values; formulas are not recalculated.',entry.position);
      } else if(isImageFile(attachment)) {
        const image=document.createElement('img');image.alt=name;
        const pane=body;image.onload=()=>{if(entry.view!==pane)return;entry.bytes=Math.max(entry.bytes||0,image.naturalWidth*image.naturalHeight*4);trimCache();};
        if(blob) {activeUrl=URL.createObjectURL(blob);image.src=activeUrl;}
        else if(/^data:image\//.test(attachment.dataUrl||'')) {image.src=attachment.dataUrl;blob=await (await fetch(attachment.dataUrl)).blob();}
        else throw new Error('The original image is unavailable. Attach it again to preview it.');
        if(request!==serial)return;
        body.replaceChildren(image);
      } else if(isPdfFile(attachment)) {
        if(!blob) {
          entry.missing=true;
          const notice=document.createElement('div');notice.className='preview-missing';
          const heading=document.createElement('h2');heading.textContent='Original PDF needed';
          const description=document.createElement('p');description.textContent='This older attachment only has saved text. Choose the original PDF to view its pages, formatting and images.';
          const choose=document.createElement('button');choose.type='button';choose.textContent='Choose original PDF';
          const input=document.createElement('input');input.type='file';input.accept='.pdf,application/pdf';input.hidden=true;
          choose.onclick=()=>input.click();
          input.onchange=async()=>{
            const file=input.files?.[0];if(!file || request!==serial)return;
            choose.disabled=true;
            try {
              const signature=await file.slice(0,1024).text();
              if(!signature.includes('%PDF-'))throw new Error('Choose a valid PDF file.');
              if(file.name!==attachment.name)throw new Error(`Choose the original file named ${attachment.name}.`);
              const previewId=await store(file);
              if(request!==serial)return;
              if(previewId) {attachment.previewId=previewId;if(typeof state!=='undefined'&&state.currentChat===entry.origin){const original=state.messages?.flatMap(m=>m.attachments||[]).find(a=>a===entry.original);if(original){original.previewId=previewId;persistCurrentChat();}}}
              entry.source.attachment={...attachment,file};await Promise.all([rememberSource(entry),activate(entry,true)]);
            } catch(error) {if(request===serial){description.textContent=error.message;choose.disabled=false;}}
          };
          notice.append(heading,description,choose,input);body.replaceChildren(notice);return;
        }
        activeUrl=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));const frame=document.createElement('iframe');frame.title=name;frame.src=activeUrl+'#navpanes=0&toolbar=1&page='+(entry.position.pdfPage||1);body.replaceChildren(frame);pdfFallback(blob,name,request,entry.position);
      } else {
        const markup=blob?await officeMarkup(blob,attachment):'';
        if(request!==serial)return;
        if(markup) {body.innerHTML=`<div class="preview-document">${markup}</div>`;downloadBlob=blob;download.disabled=false;setZoom();return;}
        const raw=blob&&typeof isTextFile==='function'&&isTextFile(attachment)&&! /\.ipynb$/i.test(name)?await readPreviewText(blob):null;
        const text=raw?.text??(attachment.extractedText || (blob?await extractAttachmentText(blob):''));
        if(request!==serial)return;
        const content=document.createElement('div');content.className='preview-document';
        const page=document.createElement('section');page.className='preview-page preview-text';
        const note=document.createElement('p');note.className='preview-note';note.textContent=raw?.truncated?'Large file · Showing the first 1 MB. Download for the complete original.':'Read-only text preview';
        const pre=document.createElement('pre');pre.textContent=text||'No readable text is available. Reattach the original file to preview it.';
        page.append(note,pre);content.append(page);body.replaceChildren(content);
      }
      if(request!==serial)return;
      downloadBlob=blob;download.disabled=!blob;setZoom();
    }catch(error){if(request===serial){entry.failed=true;body.textContent=error.message||'Preview could not be opened.';}}
  }
  panel.querySelector('#preview-close').onclick=close;
  const toggle=document.querySelector('#open-viewer');if(toggle)toggle.onclick=()=>panel.hidden?void open():close();
  panel.querySelector('#preview-download').onclick=()=>{if(!downloadBlob)return;const url=URL.createObjectURL(downloadBlob),a=document.createElement('a');a.href=url;a.download=downloadName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  panel.querySelectorAll('[data-preview-zoom]').forEach(button=>button.onclick=()=>{zoom=Math.max(.25,Math.min(3,zoom+Number(button.dataset.previewZoom)*.25));setZoom();saveSession();});
  document.addEventListener('keydown',event=>{
    if(panel.hidden)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    if(event.key==='Tab' && panel.getAttribute('aria-modal')==='true') {
      const items=[...panel.querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(item=>item.tabIndex!==-1&&!item.hidden&&!item.closest('.preview-pane[hidden]'));
      if(event.shiftKey && document.activeElement===items[0]) {event.preventDefault();items.at(-1).focus();}
      else if(!event.shiftKey && document.activeElement===items.at(-1)) {event.preventDefault();items[0].focus();}
    }
  },true);
  window.addEventListener('resize',modalState);
  window.addEventListener('pagehide',()=>{saveSession();close();entries.forEach(disposeEntry);});
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-preview-attachment],[data-preview-pending],[data-preview-widget]');if(!target)return;
    if(target.dataset.previewWidget){const [mi,ai]=target.dataset.previewWidget.split(':').map(Number);const artifact=state.messages[mi]?.artifacts?.[ai];if(artifact)void show({artifact,chatId:state.currentChat,ref:{chatId:state.currentChat,messageIndex:mi,artifactId:artifact.id}});}
    else if(target.hasAttribute('data-preview-pending')) {const attachment=state.attachments[Number(target.dataset.previewPending)];if(attachment)void show({attachment,chatId:null});}
    else {const mi=Number(target.closest('.message')?.dataset.messageIndex),ai=Number(target.dataset.previewAttachment),attachment=state.messages[mi]?.attachments?.[ai];if(attachment)void show({attachment,chatId:state.currentChat,ref:{chatId:state.currentChat,messageIndex:mi,attachmentIndex:ai}});}
  });
  async function refresh(artifact,chatId){
    for(const entry of entries.filter(e=>e.key===`artifact:${chatId||''}:${artifact.id}` || e.ref?.chatId===chatId&&e.ref?.artifactId===artifact.id)){
      entry.source={artifact};entry.name=OrbitWidgets.filename(artifact.spec);entry.failed=false;entry.missing=false;
      const active=selected===entry&&!panel.hidden;
      await rememberSource(entry);
      if(active)await activate(entry,true);else disposeEntry(entry);
    }
    renderTabs();saveSession();
  }
  restoreSession();renderTabs();
  return {store,read:retrieve,show,open,close,closeTab,refresh,specMarkup};
})();

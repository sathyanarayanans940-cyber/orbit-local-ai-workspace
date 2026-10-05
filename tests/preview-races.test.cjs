const {test}=require('node:test'),assert=require('node:assert/strict');
const {previewHarness,deferred,flush,fakePage}=require('./helpers/preview-harness.cjs');
test('closing a PDF cancels a still-pending loading task immediately',async()=>{
 const load=deferred();let destroyed=0;
 const h=previewHarness({getDocument:()=>({promise:load.promise,destroy:async()=>{destroyed++;}})});
 await h.open();const pending=h.fallback().click();await flush();h.preview.close();
 assert.equal(destroyed,1);
 load.resolve({numPages:1,getPage:async()=>fakePage()});await pending;
 assert.equal(destroyed,1);assert.equal(h.body.children.length,0);
});
test('a stale PDF getPage result cannot render over the next preview',async()=>{
 const page=deferred(),old=fakePage();let destroyed=0;
 const h=previewHarness({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:()=>page.promise}),destroy:async()=>{destroyed++;}})});
 await h.open('old.pdf');const pending=h.fallback().click();await flush();await h.open('new.pdf');
 page.resolve(old);await pending;
 assert.equal(old.rendered,0);assert.equal(old.cleaned,1);assert.equal(destroyed,1);
 assert.equal(h.controls['#preview-name'].textContent,'new.pdf');assert.equal(h.body.children[0].tag,'iframe');
});
test('initial PDF raster failure retains a visible retry and the original download',async()=>{
 let fail=true;const page=fakePage({render:()=>fail?Promise.reject(Error('Raster failed')):Promise.resolve()});
 const h=previewHarness({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>page}),destroy:async()=>{}})});
 await h.open();await h.fallback().click();
 assert.ok(h.fallback(),'Retry must remain in the visible preview');assert.equal(h.fallback().disabled,false);
 assert.match(h.fallback().textContent,/Raster failed/);assert.equal(h.controls['#preview-download'].disabled,false);
 fail=false;await h.fallback().click();assert.equal(h.body.children[0].className,'pdf-page-viewer');
});
test('PDF page navigation serializes rendering and stays within document bounds',async()=>{
 const second=deferred(),requests=[];let running=0,maximum=0;
 const h=previewHarness({getDocument:()=>({promise:Promise.resolve({numPages:3,getPage:async n=>{requests.push(n);return fakePage({render:async()=>{running++;maximum=Math.max(maximum,running);if(n===2)await second.promise;running--;}});}}),destroy:async()=>{}})});
 await h.open();await h.fallback().click();const [prev,status,next]=h.body.children[0].children[0].children;
 next.onclick();next.onclick();next.onclick();await flush();second.resolve();await flush();
 assert.equal(maximum,1);assert.deepEqual(requests,[1,2]);assert.equal(status.textContent,'Page 2 of 3');
 next.click();await flush();assert.equal(status.textContent,'Page 3 of 3');assert.equal(next.disabled,true);
 prev.click();await flush();assert.equal(status.textContent,'Page 2 of 3');
});
test('closing during an active PDF raster task cancels it without stale UI writes',async()=>{
 const raster=deferred();let cancelled=0,cleaned=0;
 const h=previewHarness({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getViewport:({scale})=>({width:100*scale,height:100*scale}),render:()=>({promise:raster.promise,cancel(){cancelled++;raster.reject(Error('Cancelled'));}}),cleanup(){cleaned++;}})}),destroy:async()=>{}})});
 await h.open();const pending=h.fallback().click();await flush();h.preview.close();
 assert.equal(cancelled,1);await pending;assert.equal(cleaned,1);assert.equal(h.body.children.length,0);
});
test('a PDF page failure has a working in-place retry without changing its number',async()=>{
 let fail=true;const requests=[];
 const h=previewHarness({getDocument:()=>({promise:Promise.resolve({numPages:2,getPage:async n=>{requests.push(n);if(n===2 && fail)throw Error('Page decode failed');return fakePage();}}),destroy:async()=>{}})});
 await h.open();await h.fallback().click();const [,status,next,retry]=h.body.children[0].children[0].children;
 next.click();await flush();assert.match(status.textContent,/Page 2: Page decode failed/);assert.equal(retry.hidden,false);
 fail=false;retry.click();await flush();assert.equal(status.textContent,'Page 2 of 2');assert.equal(retry.hidden,true);
 assert.deepEqual(requests,[1,2,2]);
});
test('loading failure can retry and double Close never destroys a task twice',async()=>{
 let loads=0,destroys=0;
 const h=previewHarness({getDocument:()=>({promise:++loads===1?Promise.reject(Error('Invalid PDF structure')):Promise.resolve({numPages:1,getPage:async()=>fakePage()}),destroy:async()=>{destroys++;}})});
 await h.open();await h.fallback().click();assert.equal(destroys,1);assert.match(h.fallback().textContent,/Invalid PDF/);
 await h.fallback().click();h.preview.close();h.preview.close();assert.equal(destroys,1);assert.equal(h.revoked.length,0);
 await h.preview.closeTab(h.tabs[0].id);await h.preview.closeTab('missing');assert.equal(destroys,2);assert.equal(h.revoked.length,1);
});
test('closing while PDF bytes are loading never creates a late worker',async()=>{
 const bytes=deferred();let loads=0;
 const h=previewHarness({getDocument:()=>{loads++;throw Error('Should not load');}});
 const file=new Blob(['%PDF']);file.arrayBuffer=()=>bytes.promise;
 await h.preview.show({attachment:{name:'slow.pdf',file}});const pending=h.fallback().click();await flush();h.preview.close();
 bytes.resolve(new ArrayBuffer(10));await pending;assert.equal(loads,0);assert.equal(h.body.children.length,0);
});

(async()=>{
  while(typeof renderMessages!=='function')await new Promise(resolve=>setTimeout(resolve,50));
  persistCurrentChat=()=>{};persistChats=()=>{};
  const params=new URLSearchParams(location.search);
  setTheme(params.get('theme')==='light'?'light':'dark');followLatest=false;
  state.currentChat='print-chat';state.currentTitle='Complete conversation print audit';state.models=[];
  const messages=[];
  const line='The complete conversation must print in reading order, including content above the current scroll position. A long reply must continue onto later pages without hiding intermediate text or leaving empty pages.';
  for(let i=1;i<=12;i++){
    messages.push({role:'user',text:`Question ${i}: explain the method and preserve every step.`});
    let text=`## Section ${i} — full working\n\nPRINT-SECTION-${String(i).padStart(2,'0')}\n\n`;
    text+=Array.from({length:5},(_,p)=>`Paragraph ${i}.${p+1}: ${line} ${line}`).join('\n\n');
    if(i===1)text='FIRST-CHAT-MESSAGE\n\n'+text;
    if(i===2)text+='\n\n'+String.raw`\[SE = \sqrt{\frac{p_0(1-p_0)}{n}} = \sqrt{\frac{0.05\times0.95}{400}} = 0.0108972\]`;
    if(i===3)text+='\n\n| Input | Calculation | Result |\n|---|---|---|\n'+Array.from({length:45},(_,r)=>`| Row ${r+1} | ${'LongIdentifier'.repeat(8)} | ${r*r} |`).join('\n');
    if(i===4)text+='\n\n```python\n'+Array.from({length:42},(_,r)=>`result_${r} = "${'unbroken_code_token_'.repeat(11)}"`).join('\n')+'\n```';
    if(i===12)text+='\n\nLAST-CHAT-MESSAGE';
    messages.push({role:'assistant',text});
  }
  const imageSvg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180"><rect width="640" height="180" fill="#e8f2fa"/><text x="30" y="100" font-size="30" fill="#184a6b">Attached screenshot survives printing</text></svg>';
  messages[0].attachments=[{name:'Synthetic screenshot.svg',type:'image/svg+xml',dataUrl:'data:image/svg+xml;base64,'+btoa(imageSvg)}];
  messages[9].artifacts=[{id:'print-diagram',spec:OrbitWidgets.normalize({kind:'diagram',title:'Wide diagram fits the printed page',width:1200,height:240,nodes:[{id:'a',label:'Input',x:140,y:120},{id:'b',label:'Verify',x:600,y:120},{id:'c',label:'Explain',x:1060,y:120}],edges:[{from:'a',to:'b'},{from:'b',to:'c'}]})}];
  state.messages=messages;
  state.savedChats={'print-chat':{title:state.currentTitle,messages}};
  renderConversationTitle();renderSavedHistory();renderMessages(false);
  await new Promise(requestAnimationFrame);
  const scroller=document.querySelector('#messages-wrap');
  scroller.scrollTop=scroller.scrollHeight;
  const controls=document.createElement('div');controls.id='print-test-controls';
  controls.style.cssText='position:fixed;top:10px;right:10px;z-index:10000;padding:8px;background:var(--panel);border:1px solid var(--border);display:flex;gap:8px';
  for(const [label,handler] of [
    ['Print entire conversation',()=>window.print()],
    ['Open print layout',()=>location.assign(location.pathname+'?layout=print&theme='+(params.get('theme')||'dark'))],
    ['Scroll to beginning',()=>{followLatest=false;scroller.scrollTop=0;}],
  ]){
    const button=document.createElement('button');button.className='preferences-button';button.textContent=label;button.onclick=handler;controls.append(button);
  }
  document.body.append(controls);
  if(params.get('preview')==='open')document.body.classList.add('preview-open');
  window.addEventListener('beforeprint',()=>{
    const result=document.createElement('script');result.id='native-print-results';result.type='application/json';
    result.textContent=JSON.stringify({printMedia:window.matchMedia('print').matches,checks:inspectPrintLayout()});
    document.body.append(result);
  });
  if(params.get('layout')==='print'){
    // Apply the actual production print rules on screen for browser inspection.
    // No app function or private state is accessed by the automation client.
    const sheet=[...document.styleSheets].find(sheet=>sheet.href?.includes('styles.css'));
    const media=[...sheet.cssRules].find(rule=>rule.conditionText==='print');
    const style=document.createElement('style');style.id='print-rules-preview';
    style.textContent=[...media.cssRules].map(rule=>rule.cssText).join('\n');
    style.textContent+='\nhtml { width:182mm !important; margin-inline:auto !important; }';
    document.head.append(style);
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    const result=document.createElement('script');result.id='print-audit-results';result.type='application/json';result.textContent=JSON.stringify(inspectPrintLayout());document.body.append(result);
  }
  function inspectPrintLayout(){
    const checks=[];
    const check=(name,passed)=>checks.push({name,passed:Boolean(passed)});
    const nodes=[...document.querySelectorAll('.message')];
    const rects=nodes.map(node=>node.getBoundingClientRect());
    check('all 24 messages in order with nonzero height',nodes.length===24&&rects.every((r,i)=>r.height>0&&(i===0||r.top>=rects[i-1].bottom)));
    check('all scroll ancestors expanded',[document.documentElement,document.body,document.querySelector('.app-shell'),document.querySelector('.main-content'),document.querySelector('.chat-page'),scroller].every(node=>getComputedStyle(node).overflowY==='visible'));
    check('first and last messages inside expanded container',scroller.scrollTop===0&&scroller.clientHeight>=rects.at(-1).bottom-rects[0].top);
    check('sidebar and composer absent',['.sidebar','.composer-zone','.jump-to-latest','.message-actions'].every(selector=>getComputedStyle(document.querySelector(selector)).display==='none'));
    check('chat visible with file preview open',getComputedStyle(document.querySelector('.app-shell')).visibility==='visible');
    check('dark mode prints readable text',getComputedStyle(document.querySelector('.message-text')).color==='rgb(32, 32, 32)');
    const table=document.querySelector('.table-wrap'),code=document.querySelector('.code-content'),diagram=document.querySelector('.diagram-plot > svg');
    check('wide table fits page without clipping',table.scrollWidth<=table.clientWidth+1&&document.querySelectorAll('tbody tr').length===45);
    check('long code lines wrap without clipping',getComputedStyle(code).whiteSpace==='pre-wrap'&&code.scrollWidth<=code.clientWidth+1&&code.textContent.includes('result_41'));
    check('wide diagram scales inside page',diagram&&diagram.getBoundingClientRect().width<=scroller.clientWidth+1&&getComputedStyle(diagram).minWidth==='0px');
    check('attachment and math retained',document.querySelector('.message-attachment img')?.naturalWidth>0&&document.querySelector('.katex')&&!document.querySelector('.katex-error'));
    check('screen equation translation removed',[...document.querySelectorAll('.math-display')].every(node=>getComputedStyle(node).transform==='none'));
    return checks;
  }
})();

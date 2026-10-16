/* Keep the phone workspace inside the visual viewport, including the keyboard.
   No storage, authentication or provider behavior belongs in this module. */
(() => {
  const narrow = matchMedia('(max-width: 900px)'), root = document.documentElement;
  const sidebar = document.querySelector('#sidebar'), shell = document.querySelector('.app-shell'), main = document.querySelector('.main-content');
  const overlays = ['#preferences-modal','#project-rename-modal','#confirmation-modal','#file-preview'].map(s=>document.querySelector(s)).filter(Boolean);
  let active = null, returnFocus = null, frame;
  const visible = e => e && !e.hidden && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const controls = e => [...e.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(x=>visible(x)&&!x.closest('[inert]'));
  function viewport() {
    const v = window.visualViewport;
    // Pinch zoom must retain native panning and magnification.
    if (v && Math.abs(v.scale - 1) > .05) return;
    root.style.setProperty('--mobile-height', `${v?.height || innerHeight}px`);
    root.style.setProperty('--mobile-top', `${v?.offsetTop || 0}px`);
  }
  function sync() {
    const mobile = narrow.matches, drawer = mobile && sidebar?.classList.contains('open');
    const overlay = [...overlays].reverse().find(e=>visible(e)&&(mobile||e.id==='file-preview'&&e.getAttribute('aria-modal')==='true'));
    if (shell && typeof state!=='undefined') shell.classList.toggle('sidebar-collapsed', !mobile && state.sidebarCollapsed);
    if (sidebar) sidebar.inert = mobile && !drawer;
    if (main) main.inert = !!drawer;
    if (shell) shell.inert = !!overlay;
    document.querySelector('#open-sidebar')?.setAttribute('aria-expanded', String(!!drawer));
    const next = overlay || (drawer ? sidebar : null);
    if (next !== active) {
      const previous = active; active = next;
      if (next) {
        if (!previous) returnFocus = document.activeElement;
        if (!next.contains(document.activeElement)) (controls(next)[0] || next).focus({preventScroll:true});
      } else if (previous && returnFocus?.isConnected && !returnFocus.closest('[inert]')) {
        returnFocus.focus({preventScroll:true}); returnFocus = null;
      }
    }
  }
  const observer = new MutationObserver(sync);
  for (const element of [sidebar,...overlays].filter(Boolean)) observer.observe(element,{attributes:true,attributeFilter:['class','hidden']});
  const resize = () => { cancelAnimationFrame(frame); frame=requestAnimationFrame(()=>{viewport();sync();}); };
  window.visualViewport?.addEventListener('resize',resize);
  window.visualViewport?.addEventListener('scroll',resize);
  window.addEventListener('resize',resize);
  narrow.addEventListener('change',()=>{ if(!narrow.matches) {sidebar?.classList.remove('open');document.querySelector('#scrim')?.classList.remove('visible');} resize(); });
  document.addEventListener('keydown',event=>{
    if (!active || active.id==='file-preview' || event.key!=='Tab') return;
    const items=controls(active),first=items[0],last=items.at(-1);
    if(!first){event.preventDefault();return;}
    // Explicit traversal also works with Safari's default button-skipping Tab behavior.
    event.preventDefault();
    const index=items.indexOf(document.activeElement);
    items[index<0 ? (event.shiftKey ? items.length-1 : 0) : (index+(event.shiftKey?-1:1)+items.length)%items.length].focus();
  });
  document.addEventListener('click',event=>{
    const tab=event.target.closest('.settings-nav-item');
    if(tab&&narrow.matches){tab.scrollIntoView({block:'nearest',inline:'nearest'});document.querySelector('.settings-panels')?.scrollTo(0,0);}
  });
  viewport();sync();
})();

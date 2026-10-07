// Load classic scripts in order so their shared globals stay available.
(async () => {
  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.onload = resolve; script.onerror = reject;
    document.body.append(script);
  });
  try {
    await OrbitChatStore.ready;
    await load('workspace-core.js?v=2');
    await load('workspace-budget.js?v=2');
    await load('document-history.js?v=1');
    await load('app.js?v=251');
    await load('file-preview.js?v=24');
    await load('workspace-tools.js?v=4');
    initWidgetUi();
  } catch (error) {
    const notice = document.createElement('div');
    notice.setAttribute('role', 'alert');
    notice.style.cssText = 'position:fixed;inset:20% 10%;z-index:9999;padding:32px;background:var(--bg,#fff);color:var(--text,#222);border:1px solid #888;border-radius:16px';
    notice.textContent = 'Orbit could not open its local chat library. Your saved data has not been cleared. Close other Orbit tabs and reload; if this continues, check browser storage permissions and available disk space.';
    const retry = document.createElement('button');
    retry.textContent = 'Reload'; retry.onclick = () => location.reload();
    notice.append(document.createElement('br'), retry); document.body.append(notice);
    console.error('Orbit startup failed', error);
  }
})();

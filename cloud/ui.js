/* Cloud-only UX; the local desktop edition does not load this file. */
(() => {
  // Do not let a previously installed offline shell bypass the login screen.
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(items => Promise.all(items.map(item => item.unregister()))).catch(() => {});
  if ('caches' in window) caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('orbit-')).map(key => caches.delete(key)))).catch(() => {});
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  const originalFetch = window.fetch.bind(window);
  let expired = false;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 401 && !expired && new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href).origin === location.origin) {
      expired = true;
      // Drafts already sent remain in local history; a redirect only renews login.
      window.location.assign('/login');
    }
    return response;
  };
})();

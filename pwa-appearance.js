/* Set native window colors before the app/database finishes loading. */
(function (root) {
  const query = root.matchMedia?.('(prefers-color-scheme: dark)');
  function savedTheme() {
    try { return root.localStorage.getItem('orbit-theme') || 'system'; }
    catch (_) { return 'system'; }
  }
  function sync(theme = savedTheme(), color) {
    if (!['light', 'dark', 'system'].includes(theme)) theme = 'system';
    const dark = theme === 'dark' || (theme === 'system' && query?.matches);
    const element = document.documentElement;
    if (theme === 'system') element.removeAttribute('data-theme');
    else element.dataset.theme = theme;
    const scheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', /^#[0-9a-f]{6}$/i.test(color || '') ? color : dark ? '#161616' : '#ffffff');
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', scheme);
  }
  root.OrbitAppearance = {sync};
  sync();
  // app.js handles system changes after boot, including custom surface tones.
})(window);

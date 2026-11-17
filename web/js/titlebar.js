// Desktop app only (Tauri): the window has no system title bar, so the top
// header becomes one. It drags the window, double-click maximizes, and it gets
// minimize / maximize / close buttons. On macOS the native traffic lights sit
// over the header instead. In a normal browser this file does nothing.
const T = window.__TAURI__;

if (T?.window) {
  const win = T.window.getCurrentWindow();
  const mac = /Mac/.test(navigator.platform);
  const root = document.documentElement;
  root.classList.add('desktop', mac ? 'os-mac' : 'os-other');

  const header = document.querySelector('header.top');
  const ICONS = {
    min: '<path d="M3.5 8h9"/>',
    max: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.2"/>',
    restore: '<path d="M5.5 5.5V4.2c0-.4.3-.7.7-.7h5.6c.4 0 .7.3.7.7v5.6c0 .4-.3.7-.7.7h-1.3"/><rect x="3.5" y="5.5" width="7" height="7" rx="1"/>',
    close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  };
  const btn = (cls, title, icon, fn) => {
    const b = document.createElement('button');
    b.className = `wc-btn ${cls}`;
    b.title = title;
    b.tabIndex = -1;
    b.innerHTML = `<svg viewBox="0 0 16 16">${icon}</svg>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };

  if (header && !mac) {
    const wc = document.createElement('div');
    wc.className = 'wc';
    const maxBtn = btn('wc-max', 'Maximize', ICONS.max, () => win.toggleMaximize());
    wc.append(
      btn('wc-min', 'Minimize', ICONS.min, () => win.minimize()),
      maxBtn,
      btn('wc-close', 'Close', ICONS.close, () => win.close()),
    );
    header.append(wc);
    const sync = async () => {
      const on = await win.isMaximized().catch(() => false);
      root.classList.toggle('maximized', on);
      maxBtn.title = on ? 'Restore' : 'Maximize';
      maxBtn.firstChild.innerHTML = on ? ICONS.restore : ICONS.max;
    };
    sync();
    let t = 0;
    win.onResized(() => { clearTimeout(t); t = setTimeout(sync, 60); });
  }

  // Empty parts of the header move the window; anything clickable stays clickable.
  const INTERACTIVE = 'button, a, input, select, textarea, label, [contenteditable], [role="menu"], [role="menuitem"], .pill, .wc';
  header?.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
    e.preventDefault();
    if (e.detail === 2) win.toggleMaximize();
    else win.startDragging();
  });

  // Links and window.open go to the system browser / player, not a new webview.
  const openOut = (href) => {
    let url;
    try { url = new URL(href, location.href).href; } catch { return; }
    if (T.opener?.openUrl) T.opener.openUrl(url).catch(() => {});
    else T.core?.invoke('plugin:opener|open_url', { url }).catch(() => {});
  };
  window.open = (href) => { if (href) openOut(String(href)); return null; };
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    const external = a.target === '_blank' || new URL(a.href, location.href).origin !== location.origin;
    if (!external) return;
    e.preventDefault();
    openOut(a.href);
  }, true);

  // The webview's own menu (Back / Reload / Inspect) is not part of the app.
  // Editable fields keep it for copy and paste; the app's own menus still work
  // because they call preventDefault() themselves.
  window.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    if (e.target.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
  });
}

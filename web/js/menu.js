// Small menu (context menus and the menu bar).
// items: { label, kbd?, on?, disabled?, danger?, checked? } or '-' for a divider.
import { h } from './util.js';

let el = null;
let onClose = null;
export function closeMenu() {
  el?.remove();
  el = null;
  const f = onClose;
  onClose = null;
  f?.();
}
export const menuOpen = () => !!el;

export function openMenu(x, y, items, opts = {}) {
  closeMenu();
  onClose = opts.onClose || null;
  const checks = items.some((it) => it && it.checked !== undefined);
  const list = items.filter((it, i, a) => it && !(it === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1)));
  el = h(`div.menu${opts.cls ? `.${opts.cls}` : ''}`, { role: 'menu' }, ...list.map((it) => (it === '-' ? h('div.menu-sep')
    : h('button.menu-item', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.sub ? ' sub' : ''}${checks ? ' checks' : ''}${it.checked ? ' checked' : ''}`,
      disabled: !!it.disabled,
      on: { click: () => { closeMenu(); it.on?.(); } },
    }, h('span', {}, it.label), it.kbd ? h('span.kbd', {}, it.kbd) : null))));
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  el.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  el.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
}

window.addEventListener('pointerdown', (e) => { if (el && !el.contains(e.target) && !e.target.closest?.('.mb-item')) closeMenu(); }, true);
window.addEventListener('keydown', (e) => { if (el && e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

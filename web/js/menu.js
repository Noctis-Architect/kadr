// Small context menu. items: { label, kbd?, on?, disabled?, danger? } or '-' for a divider.
import { h } from './util.js';

let el = null;
export function closeMenu() {
  el?.remove();
  el = null;
}

export function openMenu(x, y, items) {
  closeMenu();
  const list = items.filter((it, i, a) => it && !(it === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1)));
  el = h('div.menu', { role: 'menu' }, ...list.map((it) => (it === '-' ? h('div.menu-sep')
    : h('button.menu-item', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.sub ? ' sub' : ''}`,
      disabled: !!it.disabled,
      on: { click: () => { closeMenu(); it.on?.(); } },
    }, h('span', {}, it.label), it.kbd ? h('span.kbd', {}, it.kbd) : null))));
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  el.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  el.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
}

window.addEventListener('pointerdown', (e) => { if (el && !el.contains(e.target)) closeMenu(); }, true);
window.addEventListener('keydown', (e) => { if (el && e.key === 'Escape') { e.stopPropagation(); closeMenu(); } }, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

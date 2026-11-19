// Markers panel: every marker with its time, color and note. Click to jump,
// double-click a note to edit it. The chat and agents read these notes too.
import { tc } from '/shared/model.js';
import { S, on, commit, seek, selectMarker } from './state.js';
import { $, h, svg, ICON } from './util.js';
import { addMarker } from './ops.js';
import { markerHex } from './colors.js';

const box = () => $('#binMarkers');

export function renderMarkers() {
  const el = box();
  if (!el || !S.project) return;
  const list = [...S.project.markers].sort((a, b) => a.t - b.t);
  const head = h('div.ph', {}, h('h3', {}, 'Markers'), h('span.gh-n', {}, list.length), h('div.grow'),
    h('button.btn.ghost.sm', { title: 'Add a marker at the playhead  M', on: { click: () => selectMarker(addMarker(S.t)) } }, '+ Marker'));
  if (!list.length) {
    el.replaceChildren(head, h('div.empty.bin-empty', {}, h('b', {}, 'No markers yet'),
      h('span', {}, 'Press M while playing to drop markers on the beat, or to note where something should change. Notes like "cut here" or "add a title" work as instructions for the chat.')));
    return;
  }
  el.replaceChildren(head, h('div.mk-list', {}, ...list.map((m) => {
    const note = h('div.mk-note', { dir: 'auto' }, m.note || h('span.faint', {}, 'no note'));
    note.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const ta = h('textarea.in.mk-edit', { rows: 2, dir: 'auto', spellcheck: false });
      ta.value = m.note || '';
      const done = (ok) => {
        if (ok && ta.value !== (m.note || '')) commit(() => { const x = S.project.markers.find((k) => k.id === m.id); if (x) x.note = ta.value; });
        else renderMarkers();
      };
      ta.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); }
        if (ev.key === 'Escape') { ta.onblur = null; done(false); }
      });
      ta.onblur = () => done(true);
      note.replaceChildren(ta);
      ta.focus();
    });
    return h(`div.mk${S.marker === m.id ? '.on' : ''}`, {
      title: 'Click: go there · double-click the note to edit',
      on: { click: () => { seek(m.t); selectMarker(m.id); } },
    }, h('i.mk-dot', { style: { background: markerHex(m) } }), h('div.mk-body', {}, h('span.mk-tc', {}, tc(m.t, S.project.fps)), note),
    h('button.btn.ghost.icon.sm.mk-x', { title: 'Delete marker', on: { click: (e) => { e.stopPropagation(); commit((p) => { p.markers = p.markers.filter((k) => k.id !== m.id); }); } } }, svg(ICON.x)));
  })));
}

on('project', () => { if (box()?.offsetParent) renderMarkers(); });
on('select', () => { if (box()?.offsetParent) renderMarkers(); });
on('left-tab', (t) => { if (t === 'markers') renderMarkers(); });

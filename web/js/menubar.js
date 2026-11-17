// Menu bar at the top left (File, Edit, View, Insert, AI, Help), like other
// editing apps: every command can be found by browsing, with its shortcut.
import { S, undo, redo, canUndo, canRedo, select, selectMarker, commit, publishState, snapFrame, toast } from './state.js';
import { $, h, api } from './util.js';
import { openMenu, closeMenu, menuOpen } from './menu.js';
import { setZoom, zoomFit, toggleSnap, render as renderTimeline } from './timeline.js';
import { toggleGuides } from './viewer.js';
import { addText } from './bin.js';
import { openExport } from './exporter.js';
import { openProjects } from './projects.js';
import { openGallery } from './gallery.js';
import { askChat, openAiSettings } from './chat.js';
import { openGenerate } from './generate.js';
import { openBrief } from './brief.js';
import { openStock } from './stockdlg.js';
import { cutNear, openTransitionPopup } from './transitions.js';
import { workspaceItems } from './workspace.js';
import {
  splitAtPlayhead, deleteSelected, duplicateSelected, addMarker, addTrack, copySelected, paste, clipById, isLocked,
} from './ops.js';

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const K = (s) => (mac ? s.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥') : s);

// Starter requests for the editing skills (the user finishes or sends them).
const RECIPES = [
  ['YouTube video', 'این ویدیو رو برای یوتیوب ادیت کن: سکوت‌ها رو بگیر، شروعش رو جذاب کن، زیرنویس و لوور‌ترد بذار.'],
  ['Shorts / Reels / TikTok', 'از این ویدیو یه ویدیوی عمودی کوتاه برای ریلز و شورتس بساز، با زیرنویس کلمه‌به‌کلمه.'],
  ['Instagram post', 'یه پست ویدیویی ۴:۵ برای اینستاگرام از این ویدیو بساز.'],
  ['Captions for the speech', 'برای حرف‌هایی که زده می‌شه زیرنویس کلمه‌به‌کلمه بذار.'],
  ['Short clips from a long video', 'بهترین لحظه‌های این ویدیوی بلند رو پیدا کن و ازشون چندتا کلیپ کوتاه بساز.'],
  ['Thumbnail', 'یه تامبنیل یوتیوب برای این ویدیو طراحی کن.'],
  ['Video from a script (voice-over)', 'از این متن یه ویدیو با صدای گوینده و تصویر بساز: '],
  ['Lyric video for a song', 'برای آهنگ media/… یه ویدیوی متن آهنگ بساز. متن آهنگ اینه:\n'],
  ['Podcast or interview', 'این پادکست رو ادیت کن: بین گوینده‌ها کات بزن و برای مهمون‌ها لوور‌ترد بذار.'],
  ['Tutorial from a screen recording', 'این فیلم صفحه رو یه آموزش تمیز کن: زمان‌های مرده رو بگیر و روی جاهای مهم زوم کن.'],
];

let actions = {};

function menus() {
  const sel = [...S.sel].map(clipById).filter(Boolean);
  const hasSel = sel.length > 0;
  const guidesOn = $('#tGuides')?.classList.contains('on');
  const ask = (text) => { actions.setTab('chat'); askChat(text); };
  return {
    File: [
      { label: 'New project…', on: openProjects },
      { label: 'Open project…', kbd: K('Ctrl+O'), on: openProjects },
      '-',
      { label: 'Import media…', kbd: K('Ctrl+I'), on: actions.importDialog },
      { label: 'Show project folder', on: () => api('/api/reveal', { path: 'project.json', select: true }).catch((e) => toast(e.message, true)) },
      '-',
      { label: 'Save frame as PNG', on: () => $('#tSnapshot')?.click() },
      { label: 'Export video…', kbd: K('Ctrl+E'), on: openExport },
    ],
    Edit: [
      { label: 'Undo', kbd: K('Ctrl+Z'), disabled: !canUndo(), on: undo },
      { label: 'Redo', kbd: K('Ctrl+Shift+Z'), disabled: !canRedo(), on: redo },
      '-',
      { label: 'Cut', kbd: K('Ctrl+X'), disabled: !hasSel, on: () => copySelected(true) },
      { label: 'Copy', kbd: K('Ctrl+C'), disabled: !hasSel, on: () => copySelected() },
      { label: 'Paste', kbd: K('Ctrl+V'), on: paste },
      { label: 'Duplicate', kbd: K('Ctrl+D'), disabled: !hasSel, on: duplicateSelected },
      { label: 'Delete', kbd: 'Del', disabled: !hasSel, on: () => deleteSelected() },
      { label: 'Delete and close gap', kbd: K('Shift+Del'), disabled: !hasSel, on: () => deleteSelected({ ripple: true }) },
      '-',
      { label: 'Split at playhead', kbd: 'S', on: splitAtPlayhead },
      { label: hasSel && sel.every((c) => c.disabled) ? 'Enable clip' : 'Disable clip', kbd: K('Shift+E'), disabled: !hasSel, on: () => commit(() => { const v = !sel[0].disabled; for (const c of sel) { const x = clipById(c.id); if (x) x.disabled = v; } }) },
      { label: 'Select all', kbd: K('Ctrl+A'), on: () => select(S.project.clips.filter((c) => !isLocked(c)).map((c) => c.id)) },
      { label: 'Deselect', kbd: 'Esc', disabled: !hasSel, on: () => select([]) },
    ],
    View: [
      { label: 'Zoom in', kbd: '+', on: () => setZoom(S.pps * 1.4) },
      { label: 'Zoom out', kbd: '−', on: () => setZoom(S.pps / 1.4) },
      { label: 'Fit timeline', kbd: '\\', on: zoomFit },
      '-',
      { label: 'Snapping', kbd: 'N', checked: !!S.snap, on: toggleSnap },
      { label: 'Safe-area guides', kbd: 'G', checked: !!guidesOn, on: toggleGuides },
      { label: 'Loop in → out', kbd: K('Shift+L'), checked: !!S.loop, on: () => $('#tLoop')?.click() },
      '-',
      { label: 'Properties', on: () => actions.setTab('props') },
      { label: 'Chat', kbd: '/', on: () => actions.setTab('chat') },
    ],
    Insert: [
      { label: 'Text', kbd: 'T', on: addText },
      { label: 'Template…', on: openGallery },
      { label: 'Photos & videos from the internet…', on: () => openStock() },
      { label: 'Marker', kbd: 'M', on: () => selectMarker(addMarker(S.t)) },
      { label: 'Transition at playhead…', on: () => {
        const c = cutNear(S.t);
        if (!c) return toast('No cut between two clips yet: put two clips back to back on a track');
        select([c.id]);
        const r = $('#stage')?.getBoundingClientRect();
        openTransitionPopup(c, r ? r.left + r.width / 2 - 170 : 200, r ? r.top + 40 : 120);
      } },
      '-',
      { label: 'Video track', on: () => addTrack('video') },
      { label: 'Audio track', on: () => addTrack('audio') },
      '-',
      { label: 'Set in point', kbd: 'I', on: () => { S.inPt = snapFrame(S.t); if (S.outPt != null && S.outPt <= S.inPt) S.outPt = null; renderTimeline(); publishState(); } },
      { label: 'Set out point', kbd: 'O', on: () => { S.outPt = snapFrame(S.t); if (S.inPt != null && S.inPt >= S.outPt) S.inPt = null; renderTimeline(); publishState(); } },
      { label: 'Clear in / out', kbd: 'X', disabled: S.inPt == null && S.outPt == null, on: () => { S.inPt = null; S.outPt = null; renderTimeline(); publishState(); } },
    ],
    AI: [
      { label: 'New video from a brief…', on: () => openBrief() },
      { label: 'Ask the chat…', kbd: '/', on: () => actions.setTab('chat') },
      { label: 'AI settings…', on: () => openAiSettings() },
      '-',
      { label: 'Generate an image…', on: () => openGenerate('image') },
      { label: 'Generate a voice-over…', on: () => openGenerate('speech') },
      { label: 'Find photos & videos online…', on: () => openStock() },
      '-',
      { label: 'Ready-made jobs', disabled: true },
      ...RECIPES.map(([label, text]) => ({ label, sub: true, on: () => ask(text) })),
    ],
    Window: workspaceItems(),
    Help: [
      { label: 'Keyboard shortcuts', on: () => $('#helpBtn')?.click() },
      { label: 'Tip: right-click clips, gaps and tracks for more', disabled: true },
    ],
  };
}

let openName = null;

function show(name, btn) {
  const r = btn.getBoundingClientRect();
  openName = name;
  for (const b of document.querySelectorAll('.mb-item')) b.classList.toggle('on', b === btn);
  openMenu(r.left, r.bottom + 4, menus()[name], { cls: 'mb-menu', onClose: () => { openName = null; for (const b of document.querySelectorAll('.mb-item')) b.classList.remove('on'); } });
}

export function initMenubar(a) {
  actions = a;
  const bar = $('#menubar');
  const names = Object.keys(menus());
  bar.replaceChildren(...names.map((name) => {
    const b = h('button.mb-item', { type: 'button' }, name);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (openName === name) closeMenu(); else show(name, b);
    });
    b.addEventListener('pointerenter', () => { if (menuOpen() && openName && openName !== name) show(name, b); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); show(name, b); } });
    return b;
  }));
}

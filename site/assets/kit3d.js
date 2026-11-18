// Real 3D objects for the site, each one a small interactive scene:
//   clapper(canvas)  — a film slate: drag to turn it, click to clap (CUT!), the take counts up
//   reel(canvas)     — a film reel: drag to spin it, the strip unspools as it turns
//   timeline(canvas) — clips on three tracks: hover lifts a clip, click splits it like S
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const root = document.documentElement;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isLight = () => root.dataset.themeNow === 'light';
const lang = () => root.dataset.lang;
const cursorLabel = (t) => dispatchEvent(new CustomEvent('kadr:cursor', { detail: t }));

/* ------------------------------------------------------------------ stage */
function stage(canvas, { fov = 32, z = 12, drag = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  const camera = new THREE.PerspectiveCamera(fov, 1, .1, 100);
  camera.position.set(0, 0, z);
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(4, 7, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
  key.shadow.radius = 6; key.shadow.bias = -.0004;
  const rim = new THREE.DirectionalLight('#e8ff59', 1.4); rim.position.set(-6, 2, -4);
  const fill = new THREE.HemisphereLight('#ffffff', '#202030', .5);
  scene.add(key, rim, fill);
  // soft contact shadow under the object
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: .28 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  const pivot = new THREE.Group(); scene.add(pivot);
  const S = { renderer, scene, camera, pivot, ground, key, rim, fill, rx: 0, ry: 0, vx: 0, vy: 0, px: 0, py: 0, inside: false, dragging: false, moved: false, fns: [], clicks: [], ndc: new THREE.Vector2(-9, -9) };
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas); resize();

  const theme = () => {
    const l = isLight();
    renderer.toneMappingExposure = l ? 1 : 1.1;
    ground.material.opacity = l ? .16 : .32;
    fill.intensity = l ? .9 : .5;
    S.onTheme?.(l);
  };
  addEventListener('kadr:theme', theme);

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    S.px = (e.clientX - r.left) / r.width * 2 - 1;
    S.py = -((e.clientY - r.top) / r.height) * 2 + 1;
    S.ndc.set(S.px, S.py);
    if (S.dragging) {
      S.vy = (e.clientX - S.lx) * .008; S.vx = (e.clientY - S.ly) * .006;
      S.ry += S.vy; S.rx += S.vx;
      S.lx = e.clientX; S.ly = e.clientY;
      if (Math.abs(e.clientX - S.sx) + Math.abs(e.clientY - S.sy) > 5) S.moved = true;
    }
  });
  canvas.addEventListener('pointerenter', () => { S.inside = true; });
  canvas.addEventListener('pointerleave', () => { S.inside = false; S.ndc.set(-9, -9); S.px = S.py = 0; S.onLeave?.(); });
  canvas.addEventListener('pointerdown', (e) => {
    if (!drag) return;
    S.dragging = true; S.moved = false; S.lx = S.sx = e.clientX; S.ly = S.sy = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointerup', () => {
    if (!S.moved) S.clicks.forEach((f) => f());
    S.dragging = false; canvas.style.cursor = '';
  });

  let visible = false, running = false;
  const clock = new THREE.Clock();
  const frame = () => {
    if (!visible || document.hidden) { running = false; return; }
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    if (!S.dragging) {
      S.vx *= .93; S.vy *= .93; S.rx += S.vx; S.ry += S.vy;
      S.rx *= .96; // drift back upright
    }
    S.rx = Math.max(-.9, Math.min(.9, S.rx));
    pivot.rotation.x += ((S.rx - S.py * .12) - pivot.rotation.x) * .12;
    pivot.rotation.y += ((S.ry + S.px * .25) - pivot.rotation.y) * .12;
    S.fns.forEach((f) => f(dt, t));
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  const go = () => { if (running || !visible) return; running = true; clock.getDelta(); requestAnimationFrame(frame); };
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; go(); }, { rootMargin: '100px' }).observe(canvas);
  document.addEventListener('visibilitychange', go);
  S.start = () => { theme(); go(); };
  S.raycast = (objects) => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(S.ndc, camera);
    return ray.intersectObjects(objects, false)[0] || null;
  };
  return S;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.redraw = (fn) => { fn(c.getContext('2d'), w, h); t.needsUpdate = true; };
  return t;
}
const stripes = (light) => canvasTex(512, 64, (c, w, h) => {
  c.fillStyle = light ? '#f4f4ef' : '#0d0d10'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#e8ff59';
  for (let x = -h; x < w + h; x += 64) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 32, h); c.lineTo(x + 32 + h, 0); c.lineTo(x + h, 0); c.fill(); }
});

/* ------------------------------------------------------------- clapper */
export function clapper(canvas, { onClap } = {}) {
  const S = stage(canvas, { fov: 30, z: 13 });
  const { pivot, camera } = S;
  camera.position.set(0, 1.2, 13); camera.lookAt(0, .2, 0);
  S.ground.position.y = -2.25;
  let take = 1;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const slateTex = canvasTex(1024, 704, () => {});
  const drawSlate = () => slateTex.redraw((c, w, h) => {
    const light = isLight();
    c.fillStyle = light ? '#f6f6f1' : '#121215'; c.fillRect(0, 0, w, h);
    const ink = light ? '#151517' : '#ecece6';
    c.strokeStyle = light ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.35)'; c.lineWidth = 4;
    const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    line(0, 250, w, 250); line(0, 450, w, 450); line(340, 250, 340, 450); line(680, 250, 680, 450); line(512, 450, 512, h);
    c.fillStyle = light ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.5)';
    c.font = '600 30px "JetBrains Mono", monospace';
    c.fillText('PROD.', 40, 60); c.fillText('ROLL', 40, 300); c.fillText('SCENE', 380, 300); c.fillText('TAKE', 720, 300);
    c.fillText(lang() === 'fa' ? 'DIRECTOR · کارگردان' : 'DIRECTOR', 40, 500); c.fillText('DATE', 552, 500);
    c.fillStyle = ink;
    c.font = '900 150px "Inter Tight", sans-serif'; c.fillText('kadr', 40, 210);
    c.fillStyle = '#e8ff59'; c.beginPath(); c.moveTo(430, 105); c.lineTo(430, 195); c.lineTo(500, 150); c.fill();
    c.fillStyle = ink;
    c.font = '800 90px "Inter Tight", sans-serif';
    c.fillText('A001', 40, 410); c.fillText('01', 380, 410);
    c.fillStyle = light ? '#4c5a00' : '#e8ff59'; c.fillText(String(take), 720, 410);
    c.fillStyle = ink;
    c.font = lang() === 'fa' ? '800 66px Vazirmatn, sans-serif' : '800 66px "Inter Tight", sans-serif';
    c.fillText(lang() === 'fa' ? 'خودت' : 'you', 40, 620);
    c.font = '700 54px "JetBrains Mono", monospace'; c.fillText(date, 552, 620);
  });

  const dark = () => new THREE.MeshPhysicalMaterial({ color: '#111114', roughness: .45, metalness: .1, clearcoat: .6, clearcoatRoughness: .3 });
  const W = 4.6, H = 3.1, D = .22;
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, .06), [dark(), dark(), dark(), dark(), new THREE.MeshStandardMaterial({ map: slateTex, roughness: .8 }), dark()]);
  body.castShadow = true;
  body.position.y = -.65;
  let strip = stripes(isLight());
  const stripeMat = () => new THREE.MeshPhysicalMaterial({ map: strip, roughness: .35, clearcoat: 1 });
  const barGeo = new RoundedBoxGeometry(W, .55, D, 3, .05);
  const base = new THREE.Mesh(barGeo, [dark(), dark(), dark(), dark(), stripeMat(), dark()]);
  base.position.y = H / 2 - .65 + .3; base.castShadow = true;
  // the arm hinges on the left edge
  const hinge = new THREE.Group(); hinge.position.set(-W / 2, base.position.y + .3, 0);
  const arm = new THREE.Mesh(barGeo, [dark(), dark(), dark(), dark(), stripeMat(), dark()]);
  arm.position.set(W / 2, .3, 0); arm.castShadow = true;
  hinge.add(arm);
  const metal = new THREE.MeshStandardMaterial({ color: '#c9c9cf', metalness: 1, roughness: .25 });
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, D + .14, 24), metal);
  pin.rotation.x = Math.PI / 2; pin.position.set(-W / 2 + .14, base.position.y + .3, 0);
  const clap = new THREE.Group();
  clap.add(body, base, hinge, pin);
  clap.rotation.set(.12, -.38, 0);
  pivot.add(clap);

  S.onTheme = (l) => {
    strip = stripes(l);
    [base, arm].forEach((m) => { m.material[4].map = strip; m.material[4].needsUpdate = true; });
    const c = l ? '#f2f2ec' : '#111114';
    [body, base, arm].forEach((m) => m.material.forEach((mm, i) => { if (i !== 4) mm.color.set(c); }));
    drawSlate();
  };
  addEventListener('kadr:lang', drawSlate);

  // open ↔ clap
  let open = .55, target = .55, shake = 0, clapping = false;
  const doClap = () => {
    if (clapping) return;
    clapping = true; target = 0;
    setTimeout(() => {
      shake = 1; take += 1; drawSlate(); onClap?.(take);
      setTimeout(() => { target = .55; clapping = false; }, 420);
    }, 110);
  };
  S.clicks.push(doClap);
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doClap(); } });
  S.onLeave = () => cursorLabel('');
  S.fns.push((dt, t) => {
    const k = target < open ? .55 : .08;
    open += (target - open) * k;
    hinge.rotation.z = open + (clapping ? 0 : Math.sin(t * 1.6) * .03);
    clap.position.y = Math.sin(t * 1.1) * .06;
    if (shake > 0) { shake *= .86; clap.position.x = (Math.random() - .5) * .12 * shake; clap.rotation.z = (Math.random() - .5) * .04 * shake; }
    if (S.inside) cursorLabel(lang() === 'fa' ? 'کلیک: کات!' : 'Click: CUT!');
  });
  S.start();
  drawSlate();
  return { clap: doClap };
}

/* ---------------------------------------------------------------- reel */
export function reel(canvas) {
  const S = stage(canvas, { fov: 30, z: 14 });
  const { pivot, camera } = S;
  camera.position.set(0, .4, 14); camera.lookAt(0, 0, 0);
  S.ground.position.y = -3.6;
  const R = 2.9;
  // a plate: a disc with six windows and a hub hole, extruded
  const plateShape = new THREE.Shape(); plateShape.absarc(0, 0, R, 0, Math.PI * 2, false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, hole = new THREE.Path();
    hole.absarc(Math.cos(a) * R * .55, Math.sin(a) * R * .55, R * .26, 0, Math.PI * 2, true);
    plateShape.holes.push(hole);
  }
  const hub = new THREE.Path(); hub.absarc(0, 0, .32, 0, Math.PI * 2, true); plateShape.holes.push(hub);
  const plateGeo = new THREE.ExtrudeGeometry(plateShape, { depth: .09, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 3, curveSegments: 64 });
  const plateMat = new THREE.MeshPhysicalMaterial({ color: '#b9b9c2', metalness: 1, roughness: .28, clearcoat: .4 });
  const spin = new THREE.Group();
  const p1 = new THREE.Mesh(plateGeo, plateMat), p2 = new THREE.Mesh(plateGeo, plateMat);
  p1.position.z = .42; p2.position.z = -.51; p1.castShadow = p2.castShadow = true;
  // the wound film between the plates
  const filmMat = new THREE.MeshPhysicalMaterial({ color: '#16161a', roughness: .35, clearcoat: 1, clearcoatRoughness: .2, sheen: .5, sheenColor: '#e8ff59' });
  const wound = new THREE.Mesh(new THREE.CylinderGeometry(R * .78, R * .78, .82, 96, 1, true), filmMat);
  wound.rotation.x = Math.PI / 2;
  const woundCap = new THREE.Mesh(new THREE.RingGeometry(R * .2, R * .78, 96), new THREE.MeshStandardMaterial({ color: '#2a2418', roughness: .5, side: THREE.DoubleSide }));
  const core = new THREE.Mesh(new THREE.CylinderGeometry(R * .2, R * .2, .9, 48), new THREE.MeshStandardMaterial({ color: '#e8ff59', roughness: .4, emissive: '#7e8c1e', emissiveIntensity: .25 }));
  core.rotation.x = Math.PI / 2;
  spin.add(p1, p2, wound, woundCap, core);
  // the strip coming off the reel: a ribbon along a curve, textured with frames
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(R * .78, -.2, 0), new THREE.Vector3(R * 1.12, -1.4, 0), new THREE.Vector3(R * 1.22, -2.7, 0),
    new THREE.Vector3(R * .85, -3.38, 0), new THREE.Vector3(-R * .3, -3.42, 0), new THREE.Vector3(-R * 1.5, -3.42, 0),
  ]);
  const N = 160, wdt = .8;
  const pos = [], uv = [], idx = [];
  const len = curve.getLength();
  for (let i = 0; i <= N; i++) {
    const u = i / N, p = curve.getPointAt(u), tg = curve.getTangentAt(u);
    const off = new THREE.Vector3(0, 0, 1).multiplyScalar(wdt / 2);
    pos.push(p.x - off.x, p.y - off.y, p.z - off.z, p.x + off.x, p.y + off.y, p.z + off.z);
    uv.push(u * len / wdt / 1.4, 0, u * len / wdt / 1.4, 1);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const rib = new THREE.BufferGeometry();
  rib.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rib.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  rib.setIndex(idx); rib.computeVertexNormals();
  const COLORS = ['#3a2a6b', '#1d3a5a', '#4a1f4e', '#1f4a3a', '#5a4214', '#2a2a6a'];
  const filmTex = canvasTex(1536, 256, (c, w, h) => {
    c.fillStyle = '#0c0c0e'; c.fillRect(0, 0, w, h);
    for (let x = 10; x < w; x += 32) { c.fillStyle = '#d8d8d0'; c.beginPath(); c.roundRect(x, 12, 16, 22, 4); c.fill(); c.beginPath(); c.roundRect(x, h - 34, 16, 22, 4); c.fill(); }
    for (let i = 0; i < 6; i++) {
      const gx = i * 256 + 14;
      const g = c.createLinearGradient(gx, 50, gx + 228, 206); g.addColorStop(0, COLORS[i]); g.addColorStop(1, '#0b0b10');
      c.fillStyle = g; c.beginPath(); c.roundRect(gx, 48, 228, 160, 8); c.fill();
      c.fillStyle = '#e8ff59'; c.fillRect(gx + 18, 170, 60 + (i * 23) % 80, 10);
      c.fillStyle = 'rgba(255,255,255,.85)'; c.font = '800 34px "Inter Tight", sans-serif'; c.fillText(['TITLE', 'CUT', 'kadr', 'LOWER', '42%', 'END'][i], gx + 18, 150);
    }
  });
  filmTex.wrapS = THREE.RepeatWrapping; filmTex.repeat.set(len / wdt / 1.4 / 6 * 6 / 6, 1);
  const strip = new THREE.Mesh(rib, new THREE.MeshStandardMaterial({ map: filmTex, roughness: .4, metalness: .1, side: THREE.DoubleSide }));
  strip.castShadow = true;
  const all = new THREE.Group();
  all.add(spin, strip);
  all.rotation.set(-.15, -.55, 0);
  all.position.set(-.6, .5, 0);
  pivot.add(all);
  S.onTheme = (l) => { plateMat.color.set(l ? '#d8d8de' : '#a9a9b4'); plateMat.roughness = l ? .35 : .28; };

  // spinning: drag adds spin instead of turning the whole scene
  let speed = .5, boost = 0;
  S.fns.push((dt) => {
    const userSpin = S.dragging ? S.vy * 18 : 0;
    speed += ((.5 + boost + userSpin) - speed) * .08;
    spin.rotation.z -= speed * dt;
    filmTex.offset.x -= speed * dt * .55;
    S.ry *= .9; S.rx *= .9;
    if (S.inside) cursorLabel(lang() === 'fa' ? 'بکش تا بچرخه' : 'Drag to spin');
  });
  S.onLeave = () => cursorLabel('');
  addEventListener('kadr:boost', (e) => { boost = e.detail ? 4 : 0; });
  S.start();
}

/* ------------------------------------------------------------ timeline */
export function timeline(canvas) {
  const S = stage(canvas, { fov: 30, z: 15 });
  const { pivot, camera } = S;
  camera.position.set(0, 9.5, 15.5); camera.lookAt(0, -1, 0);
  S.scene.environmentIntensity = .55;
  S.ground.position.y = -1.2;
  const COL = [['#6f5cff', '#3a2f72'], ['#ff6b8b', '#6b2f5e'], ['#3ddc84', '#1f5a4a'], ['#f0b84a', '#5a4214']];
  const NAMES = ['intro.mp4', 'talk.mp4', 'b-roll.mp4', 'music.m4a', 'title.html', 'captions', 'logo.html', 'outro.mp4'];
  const tracks = [
    [[-5.4, -1.6, 0], [-1.4, 2.2, 1], [2.4, 5.4, 2]],
    [[-4.2, -.6, 4], [1, 3.6, 6]],
    [[-5.4, 5.4, 3]],
  ];
  const clips = [];
  const geoCache = new Map();
  const make = (x0, x1, row, ni, ci) => {
    const w = Math.max(.3, x1 - x0 - .08);
    const key = w.toFixed(2);
    const geo = geoCache.get(key) || new RoundedBoxGeometry(w, .5, 1.1, 3, .12);
    geoCache.set(key, geo);
    const [hi, lo] = COL[ci % COL.length];
    const mat = new THREE.MeshPhysicalMaterial({ color: hi, roughness: .35, metalness: .05, clearcoat: 1, clearcoatRoughness: .2, emissive: hi, emissiveIntensity: 0 });
    mat.color.lerp(new THREE.Color(lo), .55);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.position.set((x0 + x1) / 2, -.85, (row - 1) * 1.45);
    m.userData = { x0, x1, row, ni, ci, lift: 0, hi };
    pivot.add(m); clips.push(m);
    return m;
  };
  tracks.forEach((tr, row) => tr.forEach(([a, b, ni], k) => make(a, b, row, ni, row + k)));
  // the playhead: a thin glowing sheet that sweeps across
  const head = new THREE.Mesh(new THREE.BoxGeometry(.06, 2.2, 4.6), new THREE.MeshStandardMaterial({ color: '#e8ff59', emissive: '#e8ff59', emissiveIntensity: 1.6, transparent: true, opacity: .9 }));
  const headTop = new THREE.Mesh(new THREE.ConeGeometry(.28, .45, 3), head.material);
  headTop.rotation.z = Math.PI; headTop.position.y = 1.25;
  const ph = new THREE.Group(); ph.add(head, headTop); ph.position.y = -.2;
  pivot.add(ph);
  // track floor
  const floor = new THREE.Mesh(new RoundedBoxGeometry(11.6, .12, 4.6, 2, .05), new THREE.MeshStandardMaterial({ color: '#141418', roughness: .8 }));
  floor.position.y = -1.18; floor.receiveShadow = true; pivot.add(floor);
  S.onTheme = (l) => floor.material.color.set(l ? '#e2e2da' : '#141418');
  pivot.rotation.y = -.15;
  S.ry = -.38; S.rx = 0;

  let hovered = null, phx = -5.4;
  const split = (m) => {
    const u = m.userData, cut = THREE.MathUtils.clamp(phx > u.x0 + .3 && phx < u.x1 - .3 ? phx : (u.x0 + u.x1) / 2, u.x0 + .3, u.x1 - .3);
    if (u.x1 - u.x0 < .8) return;
    pivot.remove(m); clips.splice(clips.indexOf(m), 1);
    const a = make(u.x0, cut, u.row, u.ni, u.ci), b = make(cut, u.x1, u.row, (u.ni + 3) % NAMES.length, u.ci);
    a.position.x -= .15; b.position.x += .15; a.userData.lift = b.userData.lift = .6;
    dispatchEvent(new CustomEvent('kadr:toast', { detail: lang() === 'fa' ? 'برش خورد (S)' : 'Split (S)' }));
  };
  S.clicks.push(() => { if (hovered) split(hovered); });
  S.onLeave = () => { hovered = null; cursorLabel(''); };
  S.fns.push((dt, t) => {
    phx += dt * 1.6; if (phx > 5.6) phx = -5.6;
    ph.position.x = phx;
    const hit = S.inside ? S.raycast(clips) : null;
    hovered = hit?.object || null;
    if (S.inside) cursorLabel(hovered ? `${NAMES[hovered.userData.ni]} · ${lang() === 'fa' ? 'کلیک = برش' : 'click to split'}` : (lang() === 'fa' ? 'روی یه کلیپ برو' : 'Hover a clip'));
    for (const m of clips) {
      const u = m.userData;
      const under = phx > u.x0 && phx < u.x1;
      u.lift += ((m === hovered ? .55 : 0) - u.lift) * .15;
      m.position.y = -.85 + u.lift + Math.sin(t * 2 + u.x0) * .02;
      m.position.x += (((u.x0 + u.x1) / 2) - m.position.x) * .12;
      m.material.emissiveIntensity += ((under ? .32 : m === hovered ? .18 : 0) - m.material.emissiveIntensity) * .2;
    }
  });
  S.start();
}

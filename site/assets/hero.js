// Home hero: an extruded kadr logo with a reel of film frames orbiting it.
// Move the mouse to look around, drag to spin the reel, hover a frame to see
// which template it is, click it to flip it. Scrolling dollies the camera in.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 640px)').matches;
const root = document.documentElement;

const FRAMES = [
  ['Title', 'title'], ['Counter', 'counter'], ['Captions', 'captions'], ['Lower third', 'lower'],
  ['Bar chart', 'chart'], ['Logo reveal', 'logo'], ['کادر', 'fa'], ['Audio', 'wave'],
  ['End card', 'end'], ['Gradient', 'grad'], ['Kinetic type', 'kinetic'], ['Lyrics', 'lyrics'],
];

/* ---------- frame textures (drawn once on a canvas) ---------- */
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function frameTexture(kind, renderer) {
  const W = 640, H = 420, IH = 360, top = 30;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  // film stock with sprocket holes
  c.fillStyle = '#0d0d10'; rr(c, 0, 0, W, H, 22); c.fill();
  c.fillStyle = '#26262c';
  for (let x = 18; x < W - 10; x += 34) { rr(c, x, 9, 18, 12, 3); c.fill(); rr(c, x, H - 21, 18, 12, 3); c.fill(); }
  c.save(); rr(c, 10, top, W - 20, IH, 10); c.clip();
  const g = (a, b, x0 = 0, y0 = 0, x1 = W, y1 = H) => { const gr = c.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  const L = '#e8ff59';
  const font = (w, s, f = '"Inter Tight", Inter, system-ui, sans-serif') => `${w} ${s}px ${f}`;
  c.fillStyle = g('#2a1f55', '#0f1530'); c.fillRect(0, 0, W, H);
  c.textBaseline = 'alphabetic';
  switch (kind) {
    case 'title':
      c.fillStyle = L; c.fillRect(60, 210, 90, 9);
      c.fillStyle = '#fff'; c.font = font(800, 64); c.fillText('Made with kadr', 56, 290);
      c.globalAlpha = .7; c.font = font(500, 26); c.fillText('HTML, CSS and a timeline', 58, 330); c.globalAlpha = 1;
      break;
    case 'counter': {
      c.fillStyle = g('#3a2a6b', '#1a1440'); c.fillRect(0, 0, W, H);
      c.lineWidth = 12; c.strokeStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(320, 200, 110, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = L; c.lineCap = 'round'; c.beginPath(); c.arc(320, 200, 110, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * .42); c.stroke();
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = font(800, 76); c.fillText('42%', 320, 222);
      c.globalAlpha = .7; c.font = font(500, 20); c.fillText('less busywork', 320, 256); c.globalAlpha = 1; c.textAlign = 'left';
      break;
    }
    case 'captions':
      c.fillStyle = g('#1d2b4a', '#0b0f1c'); c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,.06)'; c.beginPath(); c.arc(330, 200, 150, 0, Math.PI * 2); c.fill();
      c.font = font(900, 58); c.textAlign = 'center';
      c.fillStyle = L; rr(c, 92, 268, 238, 70, 10); c.fill();
      c.fillStyle = '#0b0b0c'; c.fillText('EVERY', 211, 324);
      c.fillStyle = '#fff'; c.fillText('WORD', 440, 324); c.textAlign = 'left';
      break;
    case 'lower':
      c.fillStyle = g('#24343a', '#0e1416'); c.fillRect(0, 0, W, H);
      c.fillStyle = L; c.fillRect(50, 262, 8, 76);
      c.fillStyle = 'rgba(10,10,12,.82)'; c.fillRect(58, 262, 330, 76);
      c.fillStyle = '#fff'; c.font = font(700, 30); c.fillText('Alex Rivera', 78, 296);
      c.globalAlpha = .65; c.font = font(500, 19); c.fillText('Director · kadr studio', 78, 324); c.globalAlpha = 1;
      break;
    case 'chart': {
      c.fillStyle = '#121216'; c.fillRect(0, 0, W, H);
      const v = [.35, .55, .42, .8, .62, .95];
      v.forEach((h, i) => { c.fillStyle = i === 5 ? L : i % 2 ? '#7c86a6' : '#4b5470'; rr(c, 80 + i * 82, 350 - h * 260, 56, h * 260, 8); c.fill(); });
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(60, 352, 520, 2);
      break;
    }
    case 'logo':
      c.fillStyle = '#09090b'; c.fillRect(0, 0, W, H);
      c.save(); c.translate(320 - 96, 205 - 96); c.scale(6, 6);
      c.strokeStyle = L; c.lineWidth = 2.6; c.lineCap = 'round';
      c.stroke(new Path2D('M7 7v18M25 7v18M7 7h5M7 25h5M25 7h-5M25 25h-5'));
      c.fillStyle = L; c.fill(new Path2D('M13.5 11.5v9l7-4.5z')); c.restore();
      break;
    case 'fa':
      c.fillStyle = g('#3b1f3f', '#140d20'); c.fillRect(0, 0, W, H);
      c.direction = 'rtl'; c.textAlign = 'center'; c.fillStyle = '#fff'; c.font = font(900, 120, 'Vazirmatn, "Noto Sans Arabic", sans-serif');
      c.fillText('کادر', 320, 250); c.fillStyle = L; c.font = font(500, 26, 'Vazirmatn, sans-serif'); c.fillText('قاب · фрейм · frame', 320, 310);
      c.textAlign = 'left'; c.direction = 'ltr';
      break;
    case 'wave':
      c.fillStyle = '#0f1d18'; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) {
        const h = (Math.sin(i * .42) * .5 + .5) * (Math.sin(i * .13 + 1) * .4 + .6) * 220 + 10;
        c.fillStyle = i > 44 ? 'rgba(120,255,190,.35)' : '#5ff0a8'; rr(c, 40 + i * 8, 200 - h / 2, 5, h, 2); c.fill();
      }
      c.fillStyle = L; c.fillRect(40 + 44 * 8 + 1, 50, 3, 300);
      break;
    case 'end':
      c.fillStyle = g('#151520', '#07070a'); c.fillRect(0, 0, W, H);
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = font(800, 44); c.fillText('Thanks for watching', 320, 170);
      c.fillStyle = '#ff3b3b'; rr(c, 220, 215, 200, 56, 28); c.fill();
      c.fillStyle = '#fff'; c.font = font(700, 22); c.fillText('SUBSCRIBE', 320, 251); c.textAlign = 'left';
      break;
    case 'grad':
      c.fillStyle = g('#ff6b8b', '#5fd4ff', 0, 0, W, H); c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,.18)'; c.beginPath(); c.arc(470, 120, 140, 0, Math.PI * 2); c.fill();
      break;
    case 'kinetic':
      c.fillStyle = '#0c0c0f'; c.fillRect(0, 0, W, H);
      c.font = font(900, 72); c.fillStyle = '#fff'; c.fillText('MAKE', 60, 150);
      c.fillStyle = L; c.fillText('EVERY', 60, 230);
      c.fillStyle = 'transparent'; c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeText('FRAME', 60, 310);
      c.fillStyle = '#fff'; c.font = font(900, 72); c.fillText('COUNT', 330, 310);
      break;
    case 'lyrics':
      c.fillStyle = g('#2b1638', '#0d0b1a'); c.fillRect(0, 0, W, H);
      c.textAlign = 'center'; c.font = font(600, 30);
      c.fillStyle = 'rgba(255,255,255,.35)'; c.fillText('and the night was young', 320, 150);
      c.fillStyle = '#fff'; c.font = font(800, 40); c.fillText('we sang it ', 270, 215);
      c.fillStyle = L; c.fillText('loud', 438, 215);
      c.fillStyle = 'rgba(255,255,255,.35)'; c.font = font(600, 30); c.fillText('until the city slept', 320, 275);
      c.textAlign = 'left';
      break;
    default:
  }
  c.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

/* ---------- the logo as a solid ---------- */
function logoMesh() {
  const s = (pts) => { const sh = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? sh.lineTo(x, -y) : sh.moveTo(x, -y))); sh.closePath(); return sh; };
  const t = 1.15;
  const left = s([[7 - t, 7 - t], [12 + t, 7 - t], [12 + t, 7 + t], [7 + t, 7 + t], [7 + t, 25 - t], [12 + t, 25 - t], [12 + t, 25 + t], [7 - t, 25 + t]]);
  const right = s([[25 + t, 7 - t], [20 - t, 7 - t], [20 - t, 7 + t], [25 - t, 7 + t], [25 - t, 25 - t], [20 - t, 25 - t], [20 - t, 25 + t], [25 + t, 25 + t]]);
  const tri = s([[13.5, 11.5], [13.5, 20.5], [20.5, 16]]);
  const ex = { depth: 1.7, bevelEnabled: true, bevelThickness: .45, bevelSize: .4, bevelSegments: 8, curveSegments: 6 };
  const bracketsGeo = new THREE.ExtrudeGeometry([left, right], ex);
  const triGeo = new THREE.ExtrudeGeometry(tri, { ...ex, depth: 2.4 });
  bracketsGeo.translate(-16, 16, -.85);
  triGeo.translate(-16, 16, -1.2);
  const metal = new THREE.MeshPhysicalMaterial({ color: '#2c2c33', metalness: .85, roughness: .16, clearcoat: 1, clearcoatRoughness: .08, iridescence: .9, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520], envMapIntensity: 1.7 });
  const glow = new THREE.MeshStandardMaterial({ color: '#e8ff59', emissive: '#c8e63a', emissiveIntensity: .55, metalness: .2, roughness: .3 });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(bracketsGeo, metal), new THREE.Mesh(triGeo, glow));
  g.scale.setScalar(.17);
  return { group: g, metal, glow };
}

export async function startHero(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 200);
  camera.position.set(0, 0, 17);

  const key = new THREE.DirectionalLight('#ffffff', 1.4); key.position.set(4, 6, 8); scene.add(key);
  const rim = new THREE.PointLight('#e8ff59', 30, 30); rim.position.set(-4, -2, 4); scene.add(rim);
  const back = new THREE.DirectionalLight('#8b7bff', 2.2); back.position.set(-3, 4, -6); scene.add(back);

  const world = new THREE.Group(); scene.add(world);
  const { group: logo, metal, glow } = logoMesh();
  world.add(logo);

  // the reel
  try { await Promise.all([document.fonts.load('800 60px "Inter Tight"'), document.fonts.load('900 100px Vazirmatn')]); } catch { /* draw with fallbacks */ }
  const reel = new THREE.Group(); world.add(reel);
  reel.rotation.set(.6, 0, -.18);
  const N = small ? 14 : 20;
  const cardGeo = new THREE.PlaneGeometry(2.05, 1.345);
  const cards = [];
  const texCache = {};
  for (let i = 0; i < N; i++) {
    const [name, kind] = FRAMES[i % FRAMES.length];
    const map = texCache[kind] ||= frameTexture(kind, renderer);
    const mat = new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, toneMapped: false });
    const m = new THREE.Mesh(cardGeo, mat);
    m.userData = { name, base: (i / N) * Math.PI * 2, hover: 0, flip: 0, flipT: 0 };
    reel.add(m); cards.push(m);
  }

  // dust
  const P = small ? 260 : 600;
  const pos = new Float32Array(P * 3);
  for (let i = 0; i < P; i++) {
    const r = 6 + Math.random() * 16, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * .6, r * Math.sin(ph) * Math.sin(th) - 4], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dustMat = new THREE.PointsMaterial({ size: .045, color: '#ffffff', transparent: true, opacity: .45, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat); scene.add(dust);

  // theme
  const applyTheme = () => {
    const light = root.dataset.themeNow === 'light';
    metal.color.set(light ? '#f2f2ee' : '#2c2c33');
    metal.iridescence = light ? .45 : .9;
    metal.metalness = light ? .15 : .95;
    metal.roughness = light ? .32 : .22;
    glow.color.set(light ? '#c9e82a' : '#e8ff59');
    glow.emissive.set(light ? '#9db800' : '#c8e63a');
    glow.emissiveIntensity = light ? .25 : .55;
    dustMat.color.set(light ? '#2a2a20' : '#ffffff');
    dustMat.opacity = light ? .3 : .45;
    renderer.toneMappingExposure = light ? .95 : 1.05;
  };
  applyTheme();
  addEventListener('kadr:theme', applyTheme);

  // layout: keep the object clear of the headline (text sits left in EN, right in FA)
  let side = 1;
  const layout = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    side = root.dir === 'rtl' ? -1 : 1;
    const wide = w > 900;
    world.position.x = wide ? side * Math.max(3.4, Math.min(5.6, (w / h) * 2.95)) : 0;
    world.position.y = wide ? .3 : 2.1;
    world.scale.setScalar(wide ? .84 : .7);
  };
  layout();
  addEventListener('resize', layout);
  addEventListener('kadr:lang', () => setTimeout(layout, 50));

  // input
  const mouse = new THREE.Vector2(), ndc = new THREE.Vector2(-9, -9);
  let spin = 0, vel = 0, drag = null, hovered = null, labelShown = '';
  const ray = new THREE.Raycaster();
  const hero = canvas.parentElement;
  hero.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ndc.copy(mouse);
    if (drag) { vel = (e.clientX - drag.x) * .0022 * side; drag.x = e.clientX; spin += vel; drag.moved = true; }
  });
  hero.addEventListener('pointerleave', () => { ndc.set(-9, -9); });
  hero.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas && !e.target.classList.contains('vf')) return;
    drag = { x: e.clientX, moved: false };
    hero.setPointerCapture?.(e.pointerId);
  });
  hero.addEventListener('pointerup', () => {
    if (drag && !drag.moved && hovered) { hovered.userData.flipT += Math.PI * 2; }
    drag = null;
  });

  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) tick(); }, { threshold: 0 }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  let running = false;
  function tick() {
    if (running) return;
    running = true;
    clock.getDelta();
    requestAnimationFrame(frame);
  }
  function frame() {
    if (!visible || document.hidden) { running = false; return; }
    const dt = Math.min(clock.getDelta(), .05);
    const t = clock.elapsedTime;
    const scrollP = Math.min(1, scrollY / innerHeight);

    if (!drag) { vel *= .94; spin += vel; }
    spin += dt * (still ? .01 : .09);

    // place frames on a wavy ellipse, facing outward
    const RX = 6.1, RZ = 4.4;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(cards, false);
    const hit = hits[0]?.object || null;
    if (hit !== hovered) hovered = hit;
    const name = hovered ? hovered.userData.name : '';
    if (name !== labelShown) { labelShown = name; dispatchEvent(new CustomEvent('kadr:cursor', { detail: name })); }
    for (const m of cards) {
      const u = m.userData;
      const a = u.base + spin;
      const x = Math.cos(a) * RX, z = Math.sin(a) * RZ, y = Math.sin(a * 3 + t * .6) * .45;
      m.position.set(x, y, z);
      tmp.set(x * 2, y, z * 2);
      m.lookAt(reel.localToWorld(tmp.clone()));
      u.hover += ((m === hovered ? 1 : 0) - u.hover) * .15;
      u.flip += (u.flipT - u.flip) * .08;
      m.rotateY(u.flip);
      m.scale.setScalar(1 + u.hover * .22);
      m.translateZ(u.hover * .35);
    }

    // logo: float + look at the mouse
    logo.rotation.y += ((mouse.x * .55 + Math.sin(t * .4) * .15) - logo.rotation.y) * .06;
    logo.rotation.x += ((-mouse.y * .35 + scrollP * .9) - logo.rotation.x) * .06;
    logo.position.y = Math.sin(t * 1.1) * .12;
    rim.intensity = 26 + Math.sin(t * 2.2) * 6;

    world.rotation.y += ((mouse.x * .12) - world.rotation.y) * .04;
    world.rotation.x += ((-mouse.y * .06) - world.rotation.x) * .04;
    camera.position.z = 17 - scrollP * 5.5;
    camera.position.y = -scrollP * 1.2;
    dust.rotation.y = t * .015;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  tick();
  canvas.classList.add('ready');
}

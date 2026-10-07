import * as THREE from 'three';
import { SERVER_URL, CHASER_IMAGE } from './config.js';
import * as S from './shared.js';
import { Character } from './character.js';

// ===========================================================================
// Scene
// ===========================================================================
const SKY = 0x4fa9ff;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 170, 460);

const BASE_FOV = 75;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 1200);

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa8bb, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(70, 120, 45);

// Light grey block with a dark grey grid
function gridTexture(repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#cdcdcd';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#7a7a7a';                       // small lines every 4 units
  for (const p of [64, 128, 192]) { g.fillRect(p - 1, 0, 2, 256); g.fillRect(0, p - 1, 256, 2); }
  g.fillStyle = '#5a5a5a';                       // bigger lines every 16 units
  g.fillRect(0, 0, 256, 3); g.fillRect(0, 253, 256, 3);
  g.fillRect(0, 0, 3, 256); g.fillRect(253, 0, 3, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const sideMat = new THREE.MeshStandardMaterial({ color: 0xa3a3a3, roughness: 0.95 });
const bottomMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1 });
for (const p of S.PLATFORMS) {
  const size = p.half * 2;
  const thick = p.top - p.bottom;
  const topMat = new THREE.MeshStandardMaterial({ map: gridTexture(size / 16), roughness: 0.95 });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, thick, size),
    [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat],
  );
  mesh.position.set(p.x, p.top - thick / 2, p.z);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// Floating "LOBBY" sign
{
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 96px Fredoka, "Trebuchet MS", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = 'rgba(20,24,32,0.8)'; g.lineJoin = 'round';
  g.strokeText('LOBBY', 256, 64);
  g.fillStyle = '#ffffff'; g.fillText('LOBBY', 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
  sign.scale.set(16, 4, 1);
  sign.position.set(S.LOBBY.x, S.LOBBY.y + 12, S.LOBBY.z);
  scene.add(sign);
}

// A few low poly clouds so the sky does not feel empty
{
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const blob = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 40; i++) {
    const cloud = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(blob, cloudMat);
      const s = 6 + Math.random() * 8;
      m.scale.set(s, s * 0.6, s);
      m.position.set(j * 8 - n * 4, Math.random() * 3, Math.random() * 6);
      cloud.add(m);
    }
    const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 300;
    cloud.position.set(Math.cos(a) * r * 0.8, -95 + Math.random() * 60, Math.sin(a) * r * 0.8);
    cloud.rotation.y = Math.random() * Math.PI;
    scene.add(cloud);
  }
}

// ===========================================================================
// Chaser (a big flat red image that always faces you)
// ===========================================================================
function chaserTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 288;
  const g = c.getContext('2d');
  g.fillStyle = '#e0201b'; g.fillRect(0, 0, 256, 288);
  g.fillStyle = '#9c0f0c'; g.fillRect(0, 0, 256, 10); g.fillRect(0, 278, 256, 10);
  g.fillRect(0, 0, 10, 288); g.fillRect(246, 0, 10, 288);
  // eyes
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(80, 105, 34, 40, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(176, 105, 34, 40, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#111111';
  g.beginPath(); g.arc(88, 112, 15, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(168, 112, 15, 0, Math.PI * 2); g.fill();
  // grin
  g.beginPath(); g.moveTo(50, 185); g.quadraticCurveTo(128, 260, 206, 185); g.quadraticCurveTo(128, 225, 50, 185); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const chaserMat = new THREE.MeshBasicMaterial({ map: chaserTexture(), transparent: true, side: THREE.DoubleSide, alphaTest: 0.05 });
if (CHASER_IMAGE) {
  new THREE.TextureLoader().load(CHASER_IMAGE, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    chaserMat.map = t;
    chaserMat.needsUpdate = true;
  });
}
const chaserGeo = new THREE.PlaneGeometry(S.CHASER_W, S.CHASER_H);
const blobGeo = new THREE.CircleGeometry(3.4, 24);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });

function makeChaserView() {
  const mesh = new THREE.Mesh(chaserGeo, chaserMat);
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  scene.add(mesh, blob);
  return { mesh, blob, x: 0, z: 0 };
}

// ===========================================================================
// HUD
// ===========================================================================
const $ = (id) => document.getElementById(id);
const hud = {
  overlay: $('overlay'), status: $('status'), myname: $('myname'), online: $('online'),
  v1: $('v1'), v3: $('v3'), viewtoast: $('viewtoast'), prompt: $('prompt'),
  big: $('bigmsg'), feed: $('feed'), vignette: $('vignette'), crosshair: $('crosshair'),
};
const shown = new Map();
function setHTML(el, html) {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  el.innerHTML = html;
}
function bar(frac) {
  return `<div class="bar"><div style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></div></div>`;
}
function toast(text) {
  const d = document.createElement('div');
  d.className = 'feeditem';
  d.textContent = text;
  hud.feed.prepend(d);
  while (hud.feed.children.length > 5) hud.feed.lastChild.remove();
  setTimeout(() => d.classList.add('fade'), 3500);
  setTimeout(() => d.remove(), 4300);
}
let viewToastTimer = 0;

// ===========================================================================
// Input
// ===========================================================================
const keys = {};
const pressed = new Set();
const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyE', 'Digit1', 'Digit3'];
addEventListener('keydown', (e) => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (!keys[e.code]) pressed.add(e.code);
  keys[e.code] = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let camYaw = 0, camPitch = -0.25, camDist = 14;
let view = 3; // 1 = first person, 3 = third person
const SENS = 0.0022;

hud.overlay.addEventListener('click', () => renderer.domElement.requestPointerLock());
renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  hud.overlay.classList.toggle('hidden', locked);
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  camYaw -= e.movementX * SENS;
  camPitch = Math.max(-1.45, Math.min(1.45, camPitch - e.movementY * SENS));
});
addEventListener('wheel', (e) => {
  if (view === 3) camDist = Math.max(6, Math.min(30, camDist + Math.sign(e.deltaY) * 1.5));
}, { passive: true });

function setView(v) {
  view = v;
  hud.v1.classList.toggle('active', v === 1);
  hud.v3.classList.toggle('active', v === 3);
  hud.crosshair.classList.toggle('hidden', v !== 1);
  hud.viewtoast.textContent = v === 1 ? 'First Person' : 'Third Person';
  hud.viewtoast.classList.add('show');
  clearTimeout(viewToastTimer);
  viewToastTimer = setTimeout(() => hud.viewtoast.classList.remove('show'), 1100);
}

// ===========================================================================
// Local player
// ===========================================================================
const me = {
  pos: new THREE.Vector3(0, 0.5, 0),
  vel: new THREE.Vector3(),
  grounded: false,
  bodyYaw: 0,
  slideT: 0,
  slideCd: 0,
  slideDir: new THREE.Vector2(0, 1),
  slideBuffer: 0,
  fellSent: false,
  prevYaw: 0,
  yawRate: 0,
  rv: 0,
  char: null,
};
let myId = 0, myName = '', tpSeq = -1;

const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function updateLocal(dt, srv, carrierPos) {
  const downed = srv && srv.s === S.DOWNED;
  const carried = srv && srv.cb && carrierPos;

  if (carried) {
    me.pos.set(carrierPos.x, carrierPos.y + S.CARRY_HEIGHT, carrierPos.z);
    me.vel.set(0, 0, 0);
    me.grounded = true;
    me.slideT = 0;
    me.fellSent = false;
    return;
  }

  me.slideCd = Math.max(0, me.slideCd - dt);
  me.slideBuffer = Math.max(0, me.slideBuffer - dt);
  if (pressed.has('ShiftLeft') || pressed.has('ShiftRight')) me.slideBuffer = 0.2;

  // Wanted direction from WASD, relative to where the camera looks
  const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  let wx = fx * fwd + rx * str, wz = fz * fwd + rz * str;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  const hSpeed = Math.hypot(me.vel.x, me.vel.z);

  if (me.grounded) {
    // Start a slide
    if (!downed && me.slideBuffer > 0 && me.slideCd <= 0 && me.slideT <= 0 && (wl > 0 || hSpeed > 4)) {
      me.slideBuffer = 0;
      me.slideT = S.SLIDE_TIME;
      me.slideCd = S.SLIDE_COOLDOWN;
      if (wl > 0) me.slideDir.set(wx, wz); else me.slideDir.set(me.vel.x / hSpeed, me.vel.z / hSpeed);
    }

    if (me.slideT > 0 && !downed) {
      me.slideT -= dt;
      const k = 1 - Math.max(0, me.slideT) / S.SLIDE_TIME;
      const sp = S.SLIDE_SPEED + (S.RUN_SPEED * 0.9 - S.SLIDE_SPEED) * k;
      if (wl > 0) { // a little steering while sliding
        const cur = Math.atan2(me.slideDir.x, me.slideDir.y);
        const want = Math.atan2(wx, wz);
        const turn = Math.max(-1.6 * dt, Math.min(1.6 * dt, angleDiff(cur, want)));
        me.slideDir.set(Math.sin(cur + turn), Math.cos(cur + turn));
      }
      me.vel.x = me.slideDir.x * sp;
      me.vel.z = me.slideDir.y * sp;
    } else {
      me.slideT = 0;
      const speed = downed ? S.CRAWL_SPEED : S.RUN_SPEED;
      const tx = wx * speed, tz = wz * speed;
      let ax = tx - me.vel.x, az = tz - me.vel.z;
      const al = Math.hypot(ax, az), maxDv = S.GROUND_ACCEL * dt;
      if (al > maxDv) { ax *= maxDv / al; az *= maxDv / al; }
      me.vel.x += ax; me.vel.z += az;
    }

    // Jump (hold space to keep hopping). Jumping out of a slide keeps the speed.
    if (keys.Space && !downed) {
      me.vel.y = S.JUMP_SPEED;
      me.grounded = false;
      me.slideT = 0;
    }
  } else {
    me.slideT = 0;
    // Air: steer, but keep momentum
    if (wl > 0) {
      const mag = Math.max(downed ? S.CRAWL_SPEED : S.RUN_SPEED, hSpeed);
      const k = Math.min(1, S.AIR_CONTROL * dt);
      me.vel.x += (wx * mag - me.vel.x) * k;
      me.vel.z += (wz * mag - me.vel.z) * k;
    }
    const h = Math.hypot(me.vel.x, me.vel.z);
    if (h > S.RUN_SPEED) { // extra speed slowly bleeds off in the air
      const nh = Math.max(S.RUN_SPEED, h - 4 * dt);
      me.vel.x *= nh / h; me.vel.z *= nh / h;
    }
  }

  // Gravity and moving
  me.vel.y = Math.max(-120, me.vel.y - S.GRAVITY * dt);
  const px = me.pos.x, py = me.pos.y, pz = me.pos.z;
  me.pos.addScaledVector(me.vel, dt);

  // Collide with the platforms
  me.grounded = false;
  for (const p of S.PLATFORMS) {
    const inside = Math.abs(me.pos.x - p.x) <= p.half && Math.abs(me.pos.z - p.z) <= p.half;
    if (!inside) continue;
    if (me.pos.y <= p.top && py >= p.top - 0.01 && me.vel.y <= 0) {
      me.pos.y = p.top;
      me.vel.y = 0;
      me.grounded = true;
    } else if (me.pos.y < p.top && me.pos.y + 5 > p.bottom) {
      // Ran into the side of a block from below the top: block sideways movement
      me.pos.x = px; me.pos.z = pz;
      me.vel.x = 0; me.vel.z = 0;
    }
  }

  if (me.pos.y < S.FALL_LIMIT && !me.fellSent && ws && ws.readyState === 1) {
    me.fellSent = true;
    ws.send(JSON.stringify({ t: 'fell', q: tpSeq }));
  }
}

// ===========================================================================
// Networking
// ===========================================================================
let ws = null;
let snaps = [];
let clockOffset = null;
let latest = null;

function serverUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return 'ws://localhost:8787/ws';
  return SERVER_URL;
}

function connect() {
  const url = serverUrl();
  if (url.includes('YOURNAME')) {
    hud.status.textContent = 'Server address not set. Put it in client/config.js';
    hud.status.className = 'bad';
    return;
  }
  hud.status.textContent = 'Connecting';
  hud.status.className = '';
  ws = new WebSocket(url);
  ws.onopen = () => { hud.status.textContent = ''; };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  };
  ws.onclose = () => {
    hud.status.textContent = 'Lost connection. Reconnecting';
    hud.status.className = 'bad';
    myId = 0;
    snaps = [];
    latest = null;
    clockOffset = null;
    setTimeout(connect, 2000);
  };
}

function onMessage(m) {
  if (m.t === 'w') {
    myId = m.id;
    myName = m.name;
    hud.myname.textContent = myName;
    if (!me.char) {
      me.char = new Character();
      scene.add(me.char.root);
    }
  } else if (m.t === 'tp') {
    me.pos.set(m.x, m.y, m.z);
    me.vel.set(0, 0, 0);
    me.slideT = 0;
    me.fellSent = false;
    tpSeq = m.q;
  } else if (m.t === 'S') {
    const o = Date.now() - m.now;
    if (clockOffset === null || o < clockOffset) clockOffset = o;
    else clockOffset += (o - clockOffset) * 0.02;
    const snap = { t: m.now, p: new Map(), c: new Map() };
    for (const p of m.p) snap.p.set(p.i, p);
    for (const c of m.c) snap.c.set(c.i, c);
    snaps.push(snap);
    if (snaps.length > 40) snaps.shift();
    latest = snap;
    hud.online.textContent = `${m.p.length} online`;
  } else if (m.t === 'ev') {
    toast(m.m);
  }
}

function wsSend(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

let sendTimer = 0;
let lastRv = 0;
function sendState(force) {
  if (!ws || ws.readyState !== 1 || !myId) return;
  let a = 0;
  if (Math.hypot(me.vel.x, me.vel.z) > 0.5) a |= S.A_MOVING;
  if (!me.grounded) a |= S.A_AIR;
  if (me.slideT > 0) a |= S.A_SLIDE;
  ws.send(JSON.stringify({
    t: 's',
    x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2),
    r: +me.bodyYaw.toFixed(2), a, rv: me.rv, q: tpSeq,
  }));
  lastRv = me.rv;
}

// Find the two snapshots around a moment in server time
function sampleAt(t) {
  if (snaps.length === 0) return null;
  if (t >= snaps[snaps.length - 1].t) { const s = snaps[snaps.length - 1]; return { a: s, b: s, k: 0 }; }
  if (t <= snaps[0].t) return { a: snaps[0], b: snaps[0], k: 0 };
  for (let i = snaps.length - 1; i > 0; i--) {
    if (snaps[i - 1].t <= t) {
      const a = snaps[i - 1], b = snaps[i];
      return { a, b, k: (t - a.t) / Math.max(1, b.t - a.t) };
    }
  }
  return { a: snaps[0], b: snaps[0], k: 0 };
}

// ===========================================================================
// Other players and chasers
// ===========================================================================
const remotes = new Map();  // id -> { char, x, y, z, yaw, speed, lateral, yawRate, data }
const chaserViews = new Map();

function updateRemotes(dt, sample) {
  const seen = new Set();
  if (sample) {
    const { a, b, k } = sample;
    for (const [id, pb] of b.p) {
      if (id === myId) continue;
      seen.add(id);
      const pa = a.p.get(id) || pb;
      let r = remotes.get(id);
      if (!r) {
        r = { char: new Character(), x: pb.x, y: pb.y, z: pb.z, yaw: pb.r, speed: 0, lateral: 0, yawRate: 0, data: pb, fresh: true };
        scene.add(r.char.root);
        remotes.set(id, r);
      }
      // A big jump in position means a teleport, so do not smear across it
      const jump = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 15;
      const nx = jump ? pb.x : pa.x + (pb.x - pa.x) * k;
      const ny = jump ? pb.y : pa.y + (pb.y - pa.y) * k;
      const nz = jump ? pb.z : pa.z + (pb.z - pa.z) * k;
      const nyaw = pa.r + angleDiff(pa.r, pb.r) * k;
      if (!r.fresh && dt > 0 && !jump) {
        const vx = (nx - r.x) / dt, vz = (nz - r.z) / dt;
        const sm = 1 - Math.exp(-dt * 10);
        r.speed += (Math.hypot(vx, vz) - r.speed) * sm;
        // sideways part of the movement, relative to where they face
        const lat = (vx * Math.cos(nyaw) - vz * Math.sin(nyaw)) / S.RUN_SPEED;
        r.lateral += (lat - r.lateral) * sm;
        r.yawRate += (angleDiff(r.yaw, nyaw) / dt - r.yawRate) * sm;
      }
      r.fresh = false;
      r.x = nx; r.y = ny; r.z = nz; r.yaw = nyaw;
      r.data = (latest && latest.p.get(id)) || pb;
    }
  }
  for (const [id, r] of remotes) {
    if (!seen.has(id)) { r.char.dispose(); remotes.delete(id); }
  }
}

function placeRemotes(dt) {
  for (const [, r] of remotes) {
    const d = r.data;
    // Riding on someone's shoulders
    if (d.cb) {
      const carrier = d.cb === myId ? { x: me.pos.x, y: me.pos.y, z: me.pos.z, yaw: me.bodyYaw } : remotes.get(d.cb);
      if (carrier) {
        r.x = carrier.x; r.y = carrier.y + S.CARRY_HEIGHT; r.z = carrier.z; r.yaw = carrier.yaw;
      }
    }
    const root = r.char.root;
    root.position.set(r.x, r.y, r.z);
    root.rotation.y = r.yaw;
    r.char.animate(dt, {
      speed: r.speed,
      lateral: r.lateral,
      yawRate: r.yawRate,
      air: (d.a & S.A_AIR) !== 0,
      slide: (d.a & S.A_SLIDE) !== 0,
      downed: d.s === S.DOWNED,
      carried: !!d.cb,
      reviving: d.s === S.ALIVE && !!d.v,
    });
    if (d.s === S.DOWNED) r.char.setTag(`${d.n}  ${Math.ceil(d.dl)}`, '#ff6b6b');
    else if (d.s === S.IN_LOBBY) r.char.setTag(d.n, '#d6dbe3');
    else r.char.setTag(d.n, '#ffffff');
  }
}

function updateChasers(sample) {
  const seen = new Set();
  if (sample) {
    const { a, b, k } = sample;
    for (const [id, cb] of b.c) {
      seen.add(id);
      const ca = a.c.get(id) || cb;
      let v = chaserViews.get(id);
      if (!v) { v = makeChaserView(); chaserViews.set(id, v); }
      v.x = ca.x + (cb.x - ca.x) * k;
      v.z = ca.z + (cb.z - ca.z) * k;
    }
  }
  const t = performance.now() / 1000;
  for (const [id, v] of chaserViews) {
    if (!seen.has(id)) { v.mesh.removeFromParent(); v.blob.removeFromParent(); chaserViews.delete(id); continue; }
    v.mesh.position.set(v.x, S.CHASER_H / 2 + 0.3 + Math.sin(t * 3 + id) * 0.25, v.z);
    v.mesh.rotation.y = Math.atan2(camera.position.x - v.x, camera.position.z - v.z);
    v.blob.position.set(v.x, 0.03, v.z);
  }
}

// ===========================================================================
// Camera and HUD every frame
// ===========================================================================
function updateCamera(dt, srv) {
  const downed = srv && srv.s === S.DOWNED && !srv.cb;
  const sliding = me.slideT > 0;
  if (view === 1) {
    let eye = S.EYE_HEIGHT;
    if (downed) eye = 1.1;
    else if (sliding) eye = 2.3;
    const target = me.pos.y + eye;
    camera.position.x = me.pos.x;
    camera.position.z = me.pos.z;
    camera.position.y += (target - camera.position.y) * Math.min(1, dt * 18);
    if (Math.abs(camera.position.y - target) > 3) camera.position.y = target;
    camera.rotation.set(camPitch, camYaw, 0, 'YXZ');
  } else {
    const tx = me.pos.x, ty = me.pos.y + (downed ? 1.6 : 4.2), tz = me.pos.z;
    const cp = Math.cos(camPitch);
    let cx = tx + Math.sin(camYaw) * cp * camDist;
    let cy = ty - Math.sin(camPitch) * camDist;
    let cz = tz + Math.cos(camYaw) * cp * camDist;
    for (const p of S.PLATFORMS) { // do not let the camera dig into the floor
      if (Math.abs(cx - p.x) < p.half && Math.abs(cz - p.z) < p.half && cy < p.top + 0.6 && cy > p.bottom) cy = p.top + 0.6;
    }
    camera.position.set(cx, cy, cz);
    camera.lookAt(tx, ty, tz);
  }
  const fov = BASE_FOV + (sliding ? 8 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }
}

function updateHud(srv) {
  // Center messages (downed, lobby)
  let big = '';
  if (srv && srv.s === S.DOWNED) {
    let sub = `${Math.ceil(srv.dl)}s until you go to the lobby`;
    if (srv.rp > 0) sub = `Getting revived ${bar(srv.rp / S.REVIVE_TIME)}`;
    if (srv.cb) {
      const c = latest && latest.p.get(srv.cb);
      sub = `${c ? c.n : 'Someone'} is carrying you<br>${Math.ceil(srv.dl)}s left`;
    }
    big = `<div class="title red">YOU ARE DOWNED</div><div class="sub">${sub}</div><div class="hint">Crawl to a friend so they can revive you</div>`;
  } else if (srv && srv.s === S.IN_LOBBY) {
    big = `<div class="title">LOBBY</div><div class="sub">Back in the game in ${Math.max(1, Math.ceil(srv.ll))}</div>`;
  }
  setHTML(hud.big, big);

  // Prompts for reviving and carrying
  let prompt = '';
  me.rv = 0;
  if (srv && srv.s === S.ALIVE && !srv.cb) {
    if (srv.cy) {
      const c = latest && latest.p.get(srv.cy);
      prompt = `<div class="line">Carrying <b>${c ? c.n : ''}</b> ${Math.ceil(srv.cl)}s</div><div class="line small"><kbd>E</kbd> drop</div>`;
    } else {
      let near = null, nearD = S.REVIVE_RANGE;
      for (const [id, r] of remotes) {
        const d = r.data;
        if (d.s !== S.DOWNED || d.cb) continue;
        const dist = Math.hypot(r.x - me.pos.x, r.z - me.pos.z);
        if (dist < nearD && Math.abs(r.y - me.pos.y) < 4) { nearD = dist; near = { id, d }; }
      }
      if (near) {
        if (keys.KeyR) me.rv = near.id;
        const carry = srv.cc > 0 ? `Carry ready in ${Math.ceil(srv.cc)}s` : '<kbd>E</kbd> carry';
        prompt = `<div class="line">Hold <kbd>R</kbd> to revive <b>${near.d.n}</b></div>` +
          (me.rv ? bar(near.d.rp / S.REVIVE_TIME) : '') +
          `<div class="line small">${carry}</div>`;
        if (pressed.has('KeyE') && srv.cc <= 0) wsSend({ t: 'carry' });
      } else if (srv.cc > 0) {
        prompt = `<div class="line small">Carry ready in ${Math.ceil(srv.cc)}s</div>`;
      }
    }
    if (srv.cy && pressed.has('KeyE')) wsSend({ t: 'carry' });
    if (srv.pr) prompt += '<div class="line small">Spawn protection</div>';
  }
  setHTML(hud.prompt, prompt);
  if (me.rv !== lastRv) sendState(); // send revive changes right away

  // Red edges when a chaser is close
  let nearest = Infinity;
  for (const [, v] of chaserViews) nearest = Math.min(nearest, Math.hypot(v.x - me.pos.x, v.z - me.pos.z));
  const danger = srv && srv.s === S.ALIVE ? Math.max(0, Math.min(0.85, 1 - (nearest - 6) / 34)) : 0;
  hud.vignette.style.opacity = danger.toFixed(2);
}

// ===========================================================================
// Main loop
// ===========================================================================
setView(3);
connect();

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());

  if (pressed.has('Digit1')) setView(1);
  if (pressed.has('Digit3')) setView(3);

  const renderT = clockOffset === null ? 0 : Date.now() - clockOffset - S.INTERP_MS;
  const sample = sampleAt(renderT);
  const srv = latest && myId ? latest.p.get(myId) : null;

  updateRemotes(dt, sample);

  let carrierPos = null;
  if (srv && srv.cb) carrierPos = remotes.get(srv.cb) || null;
  updateLocal(dt, srv, carrierPos);

  // Which way the body faces
  const prevYaw = me.bodyYaw;
  if (srv && srv.cb && carrierPos) {
    me.bodyYaw = carrierPos.yaw;
  } else if (view === 1) {
    me.bodyYaw = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
  } else {
    const h = Math.hypot(me.vel.x, me.vel.z);
    if (h > 1) {
      const want = me.slideT > 0 ? Math.atan2(me.slideDir.x, me.slideDir.y) : Math.atan2(me.vel.x, me.vel.z);
      me.bodyYaw += angleDiff(me.bodyYaw, want) * Math.min(1, dt * 14);
    }
  }
  me.yawRate += ((dt > 0 ? angleDiff(prevYaw, me.bodyYaw) / dt : 0) - me.yawRate) * Math.min(1, dt * 10);

  placeRemotes(dt);

  if (me.char) {
    const c = me.char;
    c.root.visible = view === 3;
    c.root.position.copy(me.pos);
    c.root.rotation.y = me.bodyYaw;
    const lat = (me.vel.x * Math.cos(me.bodyYaw) - me.vel.z * Math.sin(me.bodyYaw)) / S.RUN_SPEED;
    c.animate(dt, {
      speed: Math.hypot(me.vel.x, me.vel.z),
      lateral: lat,
      yawRate: me.yawRate,
      air: !me.grounded,
      slide: me.slideT > 0,
      downed: !!srv && srv.s === S.DOWNED,
      carried: !!srv && !!srv.cb,
      reviving: me.rv !== 0,
    });
    if (srv && srv.s === S.DOWNED) c.setTag(`${myName}  ${Math.ceil(srv.dl)}`, '#ff6b6b');
    else c.setTag(myName, '#ffffff');
  }

  updateCamera(dt, srv);
  updateChasers(sample);
  updateHud(srv);

  sendTimer -= dt;
  if (sendTimer <= 0) { sendTimer = 1 / S.SEND_HZ; sendState(); }

  // Shadows follow you around
  sun.target.position.copy(me.pos);
  sun.position.copy(me.pos).add(SUN_OFFSET);

  renderer.render(scene, camera);
  pressed.clear();
}
frame();

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

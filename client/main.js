import * as THREE from 'three';
import { SERVER_URL } from './config.js';
import * as S from './shared.js';
import { Character, Ghost, Entity } from './character.js';

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
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(70, 120, 45);

// ---------------------------------------------------------------------------
// Floor: white tiles, light blue lines, a random 0 or 1 on every tile.
// A tiny texture holds one "0" tile and one "1" tile, and the shader picks
// one per tile from the tile's position, so everyone sees the same numbers.
// ---------------------------------------------------------------------------
function tileAtlas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#111111';
  g.font = 'bold 64px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('0', 64, 68);
  g.fillText('1', 192, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

{
  const size = S.MAP_HALF * 2, thick = 6;
  const topMat = new THREE.MeshStandardMaterial({ map: tileAtlas(), roughness: 0.95 });
  topMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTiles = { value: size / S.TILE_SIZE };
    sh.uniforms.uLine = { value: new THREE.Color('#8fd0ff') };
    sh.fragmentShader = 'uniform float uTiles;\nuniform vec3 uLine;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
      vec2 tuv = vMapUv * uTiles;
      vec2 cell = floor(tuv);
      float pickOne = step(0.5, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
      vec2 local = fract(tuv);
      vec4 sampledDiffuseColor = texture2D(map, vec2((local.x + pickOne) * 0.5, local.y));
      // Light blue grid lines, drawn smoothly so they stay thin and clean far away
      vec2 d = abs(fract(tuv - 0.5) - 0.5);
      vec2 w = fwidth(tuv);
      const float halfW = 0.022;
      vec2 dw = max(vec2(halfW), w);
      vec2 a = (1.0 - smoothstep(dw - w, dw + w, d)) * clamp(halfW / dw, 0.0, 1.0);
      sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, uLine, max(a.x, a.y));
      diffuseColor *= sampledDiffuseColor;
    `);
  };
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.95 });
  const bottomMat = new THREE.MeshStandardMaterial({ color: 0xb9c3cf, roughness: 1 });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(size, thick, size),
    [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat],
  );
  floor.position.y = -thick / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}

// ===========================================================================
// HUD
// ===========================================================================
const $ = (id) => document.getElementById(id);
const hud = {
  start: $('start'), startBtn: $('startbtn'), startMsg: $('startmsg'), paused: $('paused'),
  hud: $('hud'), myname: $('myname'), online: $('online'), status: $('status'), note: $('note'),
  timer: $('timer'), countdown: $('countdown'), banner: $('banner'), warn: $('warn'),
  v1: $('v1'), v3: $('v3'), viewtoast: $('viewtoast'), prompt: $('prompt'), role: $('role'),
  big: $('bigmsg'), feed: $('feed'), hurt: $('hurt'), crosshair: $('crosshair'),
};
const shown = new Map();
function setHTML(el, html) {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  el.innerHTML = html;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
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
const flashTimers = new Map();
function flash(el, text, ms) {
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashTimers.get(el));
  flashTimers.set(el, setTimeout(() => el.classList.remove('show'), ms));
}
const fmt = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// ===========================================================================
// Input
// ===========================================================================
const keys = {};
const pressed = new Set();
const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyE', 'Digit1', 'Digit3'];
addEventListener('keydown', (e) => {
  if (!playing) return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (!keys[e.code]) pressed.add(e.code);
  keys[e.code] = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let camYaw = 0, camPitch = -0.25, camDist = 14;
let view = 3; // 1 = first person, 3 = third person
const SENS = 0.0022;
let playing = false;

const lockPointer = () => { try { renderer.domElement.requestPointerLock(); } catch { /* not allowed right now */ } };
hud.paused.addEventListener('click', lockPointer);
renderer.domElement.addEventListener('click', () => { if (playing) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  hud.paused.classList.toggle('hidden', locked || !playing);
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  camYaw -= e.movementX * SENS;
  camPitch = Math.max(-1.45, Math.min(1.45, camPitch - e.movementY * SENS));
});
addEventListener('wheel', (e) => {
  if (view === 3) camDist = Math.max(6, Math.min(30, camDist + Math.sign(e.deltaY) * 1.5));
}, { passive: true });

let viewToastTimer = 0;
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

// Start screen: nothing connects until you press START (saves the free tier)
hud.startBtn.addEventListener('click', () => {
  playing = true;
  hud.start.classList.add('hidden');
  hud.hud.classList.remove('hidden');
  lockPointer();
  connect();
});

// ===========================================================================
// Players: one view per player, showing a character, a ghost or an entity
// ===========================================================================
const roster = new Map(); // id -> { n: name, c: colour }

function makeView(id) {
  const info = roster.get(id) || { n: '', c: '#ffffff' };
  return {
    id, name: info.n, color: info.c, mode: '', skin: -1, char: null, ghost: null, ent: null,
    x: 0, y: 0, z: 0, yaw: 0, speed: 0, lateral: 0, yawRate: 0, fresh: true, data: null,
  };
}

function disposeView(v) {
  if (v.char) v.char.dispose();
  if (v.ghost) v.ghost.dispose();
  if (v.ent) v.ent.dispose();
  v.char = v.ghost = v.ent = null;
  v.mode = '';
}

function setMode(v, state, skin) {
  const mode = state === S.ENTITY ? 'ent' : state === S.GHOST ? 'ghost' : 'char';
  if (mode === v.mode && (mode !== 'ent' || skin === v.skin)) return;
  disposeView(v);
  v.mode = mode;
  v.skin = skin;
  if (mode === 'char') { v.char = new Character(v.color); scene.add(v.char.root); }
  else if (mode === 'ghost') { v.ghost = new Ghost(v.color); scene.add(v.ghost.root); }
  else { v.ent = new Entity(skin, true); scene.add(v.ent.root); }
}

// Draw a player view. o holds animation info for the 3D character.
function drawView(v, d, o, visible, t) {
  setMode(v, d.s, d.k);
  if (v.char) {
    v.char.root.visible = visible;
    v.char.root.position.set(v.x, v.y, v.z);
    v.char.root.rotation.y = v.yaw;
    v.char.animate(o.dt, o);
    if (d.s === S.DOWNED) v.char.tag.set(`${v.name}  ${Math.ceil(d.dl)}`, '#ff5b5b');
    else v.char.tag.set(v.name, '#ffffff');
  } else if (v.ghost) {
    v.ghost.root.visible = visible;
    v.ghost.root.position.set(v.x, v.y, v.z);
    v.ghost.tag.set(`Ghost: ${v.name}`, '#000000', true);
  } else if (v.ent) {
    v.ent.root.visible = visible;
    v.ent.place(v.x, v.y, v.z, camera, t, v.id);
    v.ent.tag.set(v.name, '#ffffff');
  }
}

// ===========================================================================
// Local player
// ===========================================================================
const me = {
  pos: new THREE.Vector3(0, S.MAP_HALF, 0),
  vel: new THREE.Vector3(),
  grounded: false,
  bodyYaw: 0,
  slideT: 0,
  slideCd: 0,
  slideDir: new THREE.Vector2(0, 1),
  slideBuffer: 0,
  fellSent: false,
  yawRate: 0,
  rv: 0,
  view: null,
};
let myId = 0, myName = '', myColor = '#ffffff', tpSeq = -1;

const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function updateLocal(dt, srv, carrierPos) {
  const state = srv ? srv.s : S.ALIVE;
  const downed = state === S.DOWNED;
  const isEnt = state === S.ENTITY;

  if (srv && srv.cb && carrierPos) {
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

  const runSpeed = downed ? S.CRAWL_SPEED : isEnt ? S.ENTITY_SPEED : S.RUN_SPEED;
  const canSlide = !downed && !isEnt;
  const canJump = !downed && !isEnt;
  const hSpeed = Math.hypot(me.vel.x, me.vel.z);

  if (me.grounded) {
    // Start a slide
    if (canSlide && me.slideBuffer > 0 && me.slideCd <= 0 && me.slideT <= 0 && (wl > 0 || hSpeed > 4)) {
      me.slideBuffer = 0;
      me.slideT = S.SLIDE_TIME;
      me.slideCd = S.SLIDE_COOLDOWN;
      if (wl > 0) me.slideDir.set(wx, wz); else me.slideDir.set(me.vel.x / hSpeed, me.vel.z / hSpeed);
    }

    if (me.slideT > 0 && canSlide) {
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
      const tx = wx * runSpeed, tz = wz * runSpeed;
      let ax = tx - me.vel.x, az = tz - me.vel.z;
      const al = Math.hypot(ax, az), maxDv = S.GROUND_ACCEL * dt;
      if (al > maxDv) { ax *= maxDv / al; az *= maxDv / al; }
      me.vel.x += ax; me.vel.z += az;
    }

    // Jump (hold space to keep hopping). Jumping out of a slide keeps the speed.
    if (keys.Space && canJump) {
      me.vel.y = S.JUMP_SPEED;
      me.grounded = false;
      me.slideT = 0;
    }
  } else {
    me.slideT = 0;
    // Air: steer, but keep momentum
    if (wl > 0) {
      const mag = Math.max(runSpeed, hSpeed);
      const k = Math.min(1, S.AIR_CONTROL * dt);
      me.vel.x += (wx * mag - me.vel.x) * k;
      me.vel.z += (wz * mag - me.vel.z) * k;
    }
    const h = Math.hypot(me.vel.x, me.vel.z);
    if (h > runSpeed) { // extra speed slowly bleeds off in the air
      const nh = Math.max(runSpeed, h - 4 * dt);
      me.vel.x *= nh / h; me.vel.z *= nh / h;
    }
  }

  // Gravity and moving
  me.vel.y = Math.max(-120, me.vel.y - S.GRAVITY * dt);
  const px = me.pos.x, py = me.pos.y, pz = me.pos.z;
  me.pos.addScaledVector(me.vel, dt);

  // Collide with the block
  me.grounded = false;
  const inside = Math.abs(me.pos.x) <= S.MAP_HALF && Math.abs(me.pos.z) <= S.MAP_HALF;
  if (inside) {
    if (me.pos.y <= 0 && py >= -0.01 && me.vel.y <= 0) {
      me.pos.y = 0;
      me.vel.y = 0;
      me.grounded = true;
    } else if (me.pos.y < 0 && me.pos.y > -11) {
      // Ran into the side of the block from below the top
      me.pos.x = px; me.pos.z = pz;
      me.vel.x = 0; me.vel.z = 0;
    }
  }

  if (me.pos.y < S.FALL_LIMIT && !me.fellSent) {
    me.fellSent = true;
    wsSend({ t: 'fell', q: tpSeq });
  }
}

// ===========================================================================
// Networking
// ===========================================================================
let ws = null;
let retry = 0;
let reconnectTimer = 0;
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
  if (ws) return;
  hud.status.textContent = 'Connecting';
  const sock = new WebSocket(serverUrl());
  ws = sock;
  sock.onopen = () => { retry = 0; hud.status.textContent = ''; };
  sock.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onMessage(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    resetWorld();
    hud.status.textContent = 'Lost connection. Reconnecting';
    // Hidden tabs wait until you come back, so idle tabs do not use up the free tier
    if (!document.hidden) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, Math.min(30000, 2000 * 2 ** retry++));
    }
  };
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && playing && !ws) connect();
});

function wsSend(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function resetWorld() {
  for (const [, r] of remotes) disposeView(r);
  remotes.clear();
  for (const [, c] of chaserViews) c.ent.dispose();
  chaserViews.clear();
  if (me.view) disposeView(me.view);
  me.view = null;
  myId = 0;
  tpSeq = -1;
  snaps = [];
  latest = null;
  clockOffset = null;
  lastRound = -1;
  roster.clear();
}

const toPlayer = (a) => ({
  i: a[0], x: a[1], y: a[2], z: a[3], r: a[4], a: a[5], s: a[6], dl: a[7], rp: a[8],
  cb: a[9], cy: a[10], cl: a[11], cc: a[12], pr: a[13], v: a[14], k: a[15], rv: a[16],
});

let lastRound = -1;
function onMessage(m) {
  if (m.t === 'w') {
    myId = m.id;
    myName = m.name;
    myColor = m.color;
    for (const [i, n, c] of m.roster) roster.set(i, { n, c });
    hud.myname.textContent = myName;
    hud.myname.style.color = myColor;
    me.view = makeView(myId);
  } else if (m.t === 'j') {
    roster.set(m.i, { n: m.n, c: m.c });
  } else if (m.t === 'l') {
    roster.delete(m.i);
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
    const snap = { t: m.now, rt: m.rt, rn: m.rn, p: new Map(), c: new Map() };
    for (const a of m.p) snap.p.set(a[0], toPlayer(a));
    for (const c of m.c) snap.c.set(c[0], { x: c[1], z: c[2], k: c[3] });
    snaps.push(snap);
    if (snaps.length > 40) snaps.shift();
    latest = snap;
    latestAt = performance.now();
    hud.online.textContent = `${m.p.length} online`;
    if (m.rn !== lastRound) {
      if (m.rt < 1.5) flash(hud.banner, 'NEW ROUND', 2000);
      lastRound = m.rn;
    }
  } else if (m.t === 'ev') {
    toast(m.m);
  } else if (m.t === 'warn') {
    flash(hud.warn, m.m, 2000);
  }
}

let latestAt = 0;
// Round time, smoothed between server updates
function roundTime() {
  if (!latest) return 0;
  return latest.rt + (performance.now() - latestAt) / 1000;
}

let sendTimer = 0, lastKey = '', lastSentAt = 0;
function maybeSend(dt) {
  sendTimer -= dt;
  if (sendTimer > 0) return;
  sendTimer = S.SEND_EVERY;
  if (!ws || ws.readyState !== 1 || !myId || tpSeq < 0) return;
  let a = 0;
  if (Math.hypot(me.vel.x, me.vel.z) > 0.5) a |= S.A_MOVING;
  if (!me.grounded) a |= S.A_AIR;
  if (me.slideT > 0) a |= S.A_SLIDE;
  const msg = {
    t: 's',
    x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2),
    r: +me.bodyYaw.toFixed(2), a, rv: me.rv, q: tpSeq,
  };
  // Standing still? Only send a heartbeat once a second (saves the free tier)
  const key = `${me.pos.x.toFixed(1)},${me.pos.y.toFixed(1)},${me.pos.z.toFixed(1)},${me.bodyYaw.toFixed(1)},${a},${me.rv},${tpSeq}`;
  const now = performance.now();
  if (key === lastKey && now - lastSentAt < S.IDLE_SEND_EVERY * 1000) return;
  lastKey = key;
  lastSentAt = now;
  ws.send(JSON.stringify(msg));
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
// Other players and the K-pop entities
// ===========================================================================
const remotes = new Map();
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
        r = makeView(id);
        r.x = pb.x; r.y = pb.y; r.z = pb.z; r.yaw = pb.r;
        remotes.set(id, r);
      }
      // A big jump in position means a teleport, so do not smear across it
      const jump = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 15 || Math.abs(pb.y - pa.y) > 15;
      const nx = jump ? pb.x : pa.x + (pb.x - pa.x) * k;
      const ny = jump ? pb.y : pa.y + (pb.y - pa.y) * k;
      const nz = jump ? pb.z : pa.z + (pb.z - pa.z) * k;
      const nyaw = pa.r + angleDiff(pa.r, pb.r) * k;
      if (!r.fresh && dt > 0 && !jump) {
        const vx = (nx - r.x) / dt, vz = (nz - r.z) / dt;
        const sm = 1 - Math.exp(-dt * 10);
        r.speed += (Math.hypot(vx, vz) - r.speed) * sm;
        // Sideways part of the movement, relative to where they face
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
    if (!seen.has(id)) { disposeView(r); remotes.delete(id); }
  }
}

function drawRemotes(dt, t) {
  for (const [, r] of remotes) {
    const d = r.data;
    // Riding on someone's shoulders
    if (d.cb) {
      const c = d.cb === myId ? { x: me.pos.x, y: me.pos.y, z: me.pos.z, yaw: me.bodyYaw } : remotes.get(d.cb);
      if (c) { r.x = c.x; r.y = c.y + S.CARRY_HEIGHT; r.z = c.z; r.yaw = c.yaw; }
    }
    drawView(r, d, {
      dt, speed: r.speed, lateral: r.lateral, yawRate: r.yawRate,
      air: (d.a & S.A_AIR) !== 0, slide: (d.a & S.A_SLIDE) !== 0,
      downed: d.s === S.DOWNED, carried: !!d.cb, reviving: d.s === S.ALIVE && !!d.v,
    }, true, t);
  }
}

function updateChasers(sample, t) {
  const seen = new Set();
  if (sample) {
    const { a, b, k } = sample;
    for (const [id, cb] of b.c) {
      seen.add(id);
      const ca = a.c.get(id) || cb;
      let v = chaserViews.get(id);
      if (!v || v.ent.skin !== cb.k) {
        if (v) v.ent.dispose();
        v = { ent: new Entity(cb.k), x: cb.x, z: cb.z };
        scene.add(v.ent.root);
        chaserViews.set(id, v);
      }
      v.x = ca.x + (cb.x - ca.x) * k;
      v.z = ca.z + (cb.z - ca.z) * k;
    }
  }
  for (const [id, v] of chaserViews) {
    if (!seen.has(id)) { v.ent.dispose(); chaserViews.delete(id); continue; }
    v.ent.place(v.x, 0, v.z, camera, t, id * 7);
  }
}

// ===========================================================================
// Camera
// ===========================================================================
function nearestHunter() {
  let best = Infinity;
  for (const [, v] of chaserViews) best = Math.min(best, Math.hypot(v.x - me.pos.x, v.z - me.pos.z));
  for (const [, r] of remotes) {
    if (r.data && r.data.s === S.ENTITY) best = Math.min(best, Math.hypot(r.x - me.pos.x, r.z - me.pos.z));
  }
  return best;
}

function updateCamera(dt, srv, t) {
  const state = srv ? srv.s : S.ALIVE;
  const downed = state === S.DOWNED && !srv.cb;
  const isEnt = state === S.ENTITY;
  const sliding = me.slideT > 0;
  if (view === 1) {
    let eye = S.EYE_HEIGHT;
    if (downed) eye = 1.1;
    else if (isEnt) eye = 6.5;
    else if (sliding) eye = 2.3;
    const target = me.pos.y + eye;
    camera.position.x = me.pos.x;
    camera.position.z = me.pos.z;
    camera.position.y += (target - camera.position.y) * Math.min(1, dt * 18);
    if (Math.abs(camera.position.y - target) > 3) camera.position.y = target;
    camera.rotation.set(camPitch, camYaw, 0, 'YXZ');
  } else {
    const tx = me.pos.x, ty = me.pos.y + (downed ? 1.6 : isEnt ? 6 : 4.2), tz = me.pos.z;
    const dist = isEnt ? camDist + 4 : camDist;
    const cp = Math.cos(camPitch);
    const cx = tx + Math.sin(camYaw) * cp * dist;
    let cy = ty - Math.sin(camPitch) * dist;
    const cz = tz + Math.cos(camYaw) * cp * dist;
    if (Math.abs(cx) < S.MAP_HALF && Math.abs(cz) < S.MAP_HALF && cy < 0.6 && cy > -6) cy = 0.6; // stay above the floor
    camera.position.set(cx, cy, cz);
    camera.lookAt(tx, ty, tz);
  }

  // Screen shake when an entity is close (only while you can still be bonked)
  if (state === S.ALIVE) {
    const d = nearestHunter();
    const k = Math.max(0, Math.min(1, 1 - (d - 5) / 25));
    const amp = 0.3 * k * k;
    if (amp > 0.001) {
      camera.position.x += Math.sin(t * 41) * amp;
      camera.position.y += Math.sin(t * 33 + 1.3) * amp * 0.8;
      camera.position.z += Math.cos(t * 37) * amp;
      camera.rotateZ(Math.sin(t * 23) * amp * 0.04);
    }
  }

  const fov = BASE_FOV + (sliding ? 8 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }
}

// Before you press START the camera slowly circles the map
function menuCamera(t) {
  const a = t * 0.08;
  camera.position.set(Math.sin(a) * 120, 45, Math.cos(a) * 120);
  camera.lookAt(0, 0, 0);
}

// ===========================================================================
// HUD every frame
// ===========================================================================
function updateHud(srv) {
  const rt = roundTime();

  // Round timer and the start of round countdown
  hud.timer.textContent = latest ? fmt(Math.min(S.ROUND_TIME, rt)) : '';
  if (latest && rt < S.INTRO_TIME) {
    const n = Math.ceil(S.INTRO_TIME - rt);
    setHTML(hud.countdown, `<div class="num ${n % 2 ? 'red' : 'white'}">${n}</div><div class="sub">Entity released in</div>`);
  } else setHTML(hud.countdown, '');

  // Bonked message and the red screen
  let big = '';
  let red = 0;
  if (srv && srv.s === S.DOWNED) {
    let sub = `${Math.ceil(srv.dl)}s`;
    if (srv.rp > 0) sub = `Getting revived ${bar(srv.rp / S.REVIVE_TIME)}`;
    if (srv.cb) {
      const c = roster.get(srv.cb);
      sub = `${esc(c ? c.n : 'Someone')} is carrying you<br>${Math.ceil(srv.dl)}s`;
    }
    big = `<div class="title">BONKED!</div><div class="sub">${sub}</div><div class="hint">Get a friend to hold R on you</div>`;
    // Not red for the first second or so, then redder and redder
    const gone = S.DOWN_TIME - srv.dl;
    red = Math.max(0, Math.min(1, (gone - 1.5) / (S.DOWN_TIME - 1.5))) * 0.75;
  }
  setHTML(hud.big, big);
  hud.hurt.style.opacity = red.toFixed(3);

  // What you are right now
  let role = '';
  if (srv && srv.s === S.ENTITY) role = '<b>You are an entity.</b> Bonk the survivors! Back to normal next round.';
  else if (srv && srv.s === S.GHOST) role = '<b>You are a ghost.</b> You come back next round.';
  setHTML(hud.role, role);
  hud.note.textContent = srv && srv.s === S.ALIVE && srv.rv >= 1 ? 'Revive used' : '';

  // Prompts for reviving and carrying
  let prompt = '';
  me.rv = 0;
  if (srv && srv.s === S.ALIVE && !srv.cb) {
    if (srv.cy) {
      const c = roster.get(srv.cy);
      prompt = `<div class="line">Carrying <b>${esc(c ? c.n : '')}</b> ${Math.ceil(srv.cl)}s</div><div class="line small"><kbd>E</kbd> drop</div>`;
      if (pressed.has('KeyE')) wsSend({ t: 'carry' });
    } else {
      let near = null, nearD = S.REVIVE_RANGE;
      for (const [id, r] of remotes) {
        const d = r.data;
        if (!d || d.s !== S.DOWNED || d.cb) continue;
        const dist = Math.hypot(r.x - me.pos.x, r.z - me.pos.z);
        if (dist < nearD && Math.abs(r.y - me.pos.y) < 4) { nearD = dist; near = { id, r }; }
      }
      if (near) {
        if (keys.KeyR) me.rv = near.id;
        const carry = srv.cc > 0 ? `Carry ready in ${Math.ceil(srv.cc)}s` : '<kbd>E</kbd> carry';
        prompt = `<div class="line">Hold <kbd>R</kbd> to revive <b>${esc(near.r.name)}</b></div>` +
          (me.rv ? bar(near.r.data.rp / S.REVIVE_TIME) : '') +
          `<div class="line small">${carry}</div>`;
        if (pressed.has('KeyE') && srv.cc <= 0) wsSend({ t: 'carry' });
      } else if (srv.cc > 0) {
        prompt = `<div class="line small">Carry ready in ${Math.ceil(srv.cc)}s</div>`;
      }
    }
    if (srv.pr) prompt += '<div class="line small">Spawn protection</div>';
  }
  setHTML(hud.prompt, prompt);
}

// ===========================================================================
// Main loop
// ===========================================================================
setView(3);

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  if (!playing) {
    menuCamera(t);
    renderer.render(scene, camera);
    return;
  }

  if (pressed.has('Digit1')) setView(1);
  if (pressed.has('Digit3')) setView(3);

  const renderT = clockOffset === null ? 0 : Date.now() - clockOffset - S.INTERP_MS;
  const sample = sampleAt(renderT);
  const srv = latest && myId ? latest.p.get(myId) : null;

  updateRemotes(dt, sample);

  let carrierPos = null;
  if (srv && srv.cb) carrierPos = remotes.get(srv.cb) || null;
  if (tpSeq >= 0) updateLocal(dt, srv, carrierPos);

  // Which way the body faces
  const prevYaw = me.bodyYaw;
  if (carrierPos) {
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

  updateCamera(dt, srv, t);
  drawRemotes(dt, t);
  updateChasers(sample, t);

  if (me.view && srv) {
    const v = me.view;
    v.x = me.pos.x; v.y = me.pos.y; v.z = me.pos.z; v.yaw = me.bodyYaw;
    const lat = (me.vel.x * Math.cos(me.bodyYaw) - me.vel.z * Math.sin(me.bodyYaw)) / S.RUN_SPEED;
    drawView(v, srv, {
      dt, speed: Math.hypot(me.vel.x, me.vel.z), lateral: lat, yawRate: me.yawRate,
      air: !me.grounded, slide: me.slideT > 0, downed: srv.s === S.DOWNED, carried: !!srv.cb, reviving: me.rv !== 0,
    }, view === 3, t);
  }

  updateHud(srv);
  maybeSend(dt);

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

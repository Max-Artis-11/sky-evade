// Player looks: blocky Roblox style characters, flat ghosts and entity cards.
// Local space: feet at y = 0, the character faces +Z.
import * as THREE from 'three';
import { RUN_SPEED, SKINS } from './shared.js';

const edgeMat = new THREE.LineBasicMaterial({ color: 0x3c3c3c });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1c1c1c });

const bodyMats = new Map();
function bodyMat(color) {
  if (!bodyMats.has(color)) {
    const c = new THREE.Color(color);
    bodyMats.set(color, new THREE.MeshStandardMaterial({
      color: c, emissive: c.clone().multiplyScalar(0.28), roughness: 0.8, flatShading: true,
    }));
  }
  return bodyMats.get(color);
}

// Torso: a square frustum (a cut off pyramid), wide shoulders, narrow waist
const torsoGeo = new THREE.CylinderGeometry(1.556, 1.13, 2, 4, 1);
torsoGeo.rotateY(Math.PI / 4);
torsoGeo.scale(1, 1, 0.55);
const headGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.1, 10);
const limbGeo = new THREE.BoxGeometry(0.78, 2, 0.78);
const eyeGeo = new THREE.BoxGeometry(0.14, 0.28, 0.06);

const edgesCache = new Map();
function edges(geo) {
  if (!edgesCache.has(geo)) edgesCache.set(geo, new THREE.EdgesGeometry(geo, 25));
  return edgesCache.get(geo);
}

function piece(geo, mat, y = 0) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  const e = new THREE.LineSegments(edges(geo), edgeMat);
  m.position.y = e.position.y = y;
  g.add(m, e);
  return g;
}

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// The normal 3D character
// ---------------------------------------------------------------------------
export class Character {
  constructor(color = '#ffffff') {
    const mat = bodyMat(color);
    this.root = new THREE.Group();   // placed at the feet, rotated by yaw
    this.body = new THREE.Group();   // tilts for lean, slide and crawl
    this.root.add(this.body);

    this.torso = piece(torsoGeo, mat);
    this.torso.position.y = 3;

    this.head = piece(headGeo, mat);
    this.head.position.y = 4.67;
    for (const sx of [-0.22, 0.22]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx, 0.08, 0.61);
      this.head.add(eye);
    }

    // Limbs hang from a pivot (shoulder or hip) so they can swing
    this.armP = piece(limbGeo, mat, -0.85); this.armP.position.set(1.5, 3.8, 0);
    this.armN = piece(limbGeo, mat, -0.85); this.armN.position.set(-1.5, 3.8, 0);
    this.legP = piece(limbGeo, mat, -1);    this.legP.position.set(0.41, 2, 0);
    this.legN = piece(limbGeo, mat, -1);    this.legN.position.set(-0.41, 2, 0);

    this.body.add(this.torso, this.head, this.armP, this.armN, this.legP, this.legN);

    this.phase = 0;
    this.tag = new NameTag();
    this.tag.sprite.position.y = 6.4;
    this.root.add(this.tag.sprite);
  }

  // o: { speed, lateral, yawRate, air, slide, downed, carried, reviving }
  animate(dt, o) {
    const k = 1 - Math.exp(-dt * 14);
    let legP = 0, legN = 0, armP = 0, armN = 0, armPz = 0, armNz = 0;
    let bodyX = 0, bodyY = 0, bodyZ = 0, lean = 0;

    if (o.downed && !o.carried) {
      // Lying face down, crawling with the arms
      const moving = o.speed > 0.5;
      this.phase += dt * (moving ? 6 : 1.5);
      const s = Math.sin(this.phase) * (moving ? 0.6 : 0.15);
      bodyX = Math.PI / 2;
      bodyY = 0.5;
      bodyZ = -2.3; // keep the middle of the body over the player's position
      armP = -Math.PI + s;  armN = -Math.PI - s;
      legP = s * 0.4;       legN = -s * 0.4;
    } else if (o.carried) {
      // Standing on someone's shoulders, arms out for balance
      this.phase += dt * 2;
      armPz = 1.2 + Math.sin(this.phase) * 0.1;
      armNz = -1.2 - Math.sin(this.phase) * 0.1;
    } else if (o.slide) {
      // Leaning back, feet first
      bodyX = -1.0;
      bodyY = -0.75;
      bodyZ = 0.6;
      legP = -0.5; legN = -0.45;
      armP = -0.7; armN = -0.7; armPz = 0.5; armNz = -0.5;
    } else if (o.air) {
      armP = -2.8; armN = -2.8; armPz = 0.25; armNz = -0.25;
      legP = -0.45; legN = 0.25;
      lean = clamp(-(o.lateral * 0.25), -0.35, 0.35);
    } else {
      const amt = clamp(o.speed / RUN_SPEED, 0, 1.3);
      this.phase += dt * (3 + o.speed * 0.55);
      const s = Math.sin(this.phase) * 0.95 * amt;
      legP = s; legN = -s;
      armP = -s * 0.9; armN = s * 0.9;
      bodyX = 0.12 * amt;
      // Lean into sideways movement and into turns
      lean = clamp(-(o.lateral * 0.3 + o.yawRate * 0.05), -0.4, 0.4);
      if (o.reviving) { armP = -1.2; armN = -1.2; bodyX = 0.35; }
    }

    // Name tag drops down when lying on the floor
    const tagY = o.downed && !o.carried ? 2.6 : 6.4;
    this.tag.sprite.position.y = lerp(this.tag.sprite.position.y, tagY, k);

    const b = this.body;
    b.rotation.x = lerp(b.rotation.x, bodyX, k);
    b.rotation.z = lerp(b.rotation.z, lean, k);
    b.position.y = lerp(b.position.y, bodyY, k);
    b.position.z = lerp(b.position.z, bodyZ, k);
    this.legP.rotation.x = lerp(this.legP.rotation.x, legP, k);
    this.legN.rotation.x = lerp(this.legN.rotation.x, legN, k);
    this.armP.rotation.x = lerp(this.armP.rotation.x, armP, k);
    this.armN.rotation.x = lerp(this.armN.rotation.x, armN, k);
    this.armP.rotation.z = lerp(this.armP.rotation.z, armPz, k);
    this.armN.rotation.z = lerp(this.armN.rotation.z, armNz, k);
  }

  dispose() {
    this.root.removeFromParent();
    this.tag.dispose();
  }
}

// ---------------------------------------------------------------------------
// Name tags (text sprites)
// ---------------------------------------------------------------------------
export class NameTag {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 96;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(5.6, 1.05, 1);
    this.key = '';
  }

  // Normal tags are coloured text with a dark outline.
  // dark = true gives dark text with a light outline (used for ghosts).
  set(text, color = '#ffffff', dark = false) {
    const key = text + color + dark;
    if (key === this.key) return;
    this.key = key;
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, 512, 96);
    g.font = '700 54px Fredoka, "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = dark ? 7 : 10;
    g.strokeStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(20,24,32,0.85)';
    g.strokeText(text, 256, 48);
    g.fillStyle = color;
    g.fillText(text, 256, 48);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.sprite.removeFromParent();
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Ghost: a flat, see through picture of your character in your colour
// ---------------------------------------------------------------------------
const ghostTextures = new Map();
function ghostTexture(color) {
  if (ghostTextures.has(color)) return ghostTextures.get(color);
  const U = 30; // pixels per world unit
  const c = document.createElement('canvas');
  c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  const X = (x) => 64 + x * U;          // world x to canvas x (0 is the middle)
  const Y = (y) => 192 - 4 - y * U;     // world y to canvas y (0 is the feet)
  g.fillStyle = color;
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = 3;
  g.lineJoin = 'round';
  const box = (x0, y0, x1, y1) => {
    g.beginPath(); g.rect(X(x0), Y(y1), (x1 - x0) * U, (y1 - y0) * U); g.fill(); g.stroke();
  };
  box(-0.8, 0, -0.02, 2);       // legs
  box(0.02, 0, 0.8, 2);
  box(-1.89, 1.95, -1.11, 3.95); // arms
  box(1.11, 1.95, 1.89, 3.95);
  g.beginPath();                  // torso, wide at the shoulders
  g.moveTo(X(-1.1), Y(4)); g.lineTo(X(1.1), Y(4)); g.lineTo(X(0.8), Y(2)); g.lineTo(X(-0.8), Y(2));
  g.closePath(); g.fill(); g.stroke();
  box(-0.62, 4.12, 0.62, 5.22);  // head
  g.fillStyle = '#1c1c1c';
  g.fillRect(X(-0.29), Y(4.86), 0.14 * U, 0.28 * U);
  g.fillRect(X(0.15), Y(4.86), 0.14 * U, 0.28 * U);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  ghostTextures.set(color, tex);
  return tex;
}

export class Ghost {
  constructor(color) {
    this.root = new THREE.Group();
    const mat = new THREE.SpriteMaterial({ map: ghostTexture(color), transparent: true, opacity: 0.5, depthWrite: false });
    this.body = new THREE.Sprite(mat);
    this.body.scale.set(128 / 30, 192 / 30, 1);
    this.body.position.y = 192 / 30 / 2 - 4 / 30;
    this.tag = new NameTag();
    this.tag.sprite.position.y = 7.2;
    this.root.add(this.body, this.tag.sprite);
  }

  dispose() {
    this.root.removeFromParent();
    this.body.material.dispose();
    this.tag.dispose();
  }
}

// ---------------------------------------------------------------------------
// Entities: a big flat picture that always turns to face the camera
// ---------------------------------------------------------------------------
const loader = new THREE.TextureLoader();
const skinMats = SKINS.map((s) => {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const tex = loader.load(s.file, (t) => {
    s.aspect = t.image.width / t.image.height;
    for (const e of Entity.all) e.fit();
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  if (s.pixel) { tex.magFilter = THREE.NearestFilter; }
  mat.map = tex;
  return mat;
});
const planeGeo = new THREE.PlaneGeometry(1, 1);
const blobGeo = new THREE.CircleGeometry(3.4, 24);
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });

export class Entity {
  static all = new Set();

  constructor(skin, withTag = false) {
    this.skin = skin;
    this.root = new THREE.Group();
    this.card = new THREE.Mesh(planeGeo, skinMats[skin]);
    this.blob = new THREE.Mesh(blobGeo, blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.03;
    this.root.add(this.card, this.blob);
    this.tag = null;
    if (withTag) {
      this.tag = new NameTag();
      this.root.add(this.tag.sprite);
    }
    this.fit();
    Entity.all.add(this);
  }

  fit() {
    const s = SKINS[this.skin];
    const h = s.h, w = h * (s.aspect || 1);
    this.h = h;
    this.card.scale.set(w, h, 1);
    if (this.tag) this.tag.sprite.position.y = h + 1.2;
  }

  // Put the card at a ground position and turn it to face the camera
  place(x, y, z, camera, t, bobSeed = 0) {
    this.root.position.set(x, y, z);
    this.card.position.y = this.h / 2 + 0.3 + Math.sin(t * 3 + bobSeed) * 0.25;
    this.card.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
  }

  dispose() {
    this.root.removeFromParent();
    if (this.tag) this.tag.dispose();
    Entity.all.delete(this);
  }
}

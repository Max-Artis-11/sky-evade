// Simple blocky white characters, Roblox style.
// Local space: feet at y = 0, the character faces +Z.
import * as THREE from 'three';
import { RUN_SPEED } from './shared.js';

const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x4a4a4a, roughness: 0.8, flatShading: true });
const edgeMat = new THREE.LineBasicMaterial({ color: 0x3c3c3c });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1c1c1c });

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

function piece(geo, y = 0) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(geo, whiteMat);
  m.castShadow = true;
  m.receiveShadow = true;
  const e = new THREE.LineSegments(edges(geo), edgeMat);
  m.position.y = e.position.y = y;
  g.add(m, e);
  return g;
}

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Character {
  constructor() {
    this.root = new THREE.Group();   // placed at the feet, rotated by yaw
    this.body = new THREE.Group();   // tilts for lean, slide and crawl
    this.root.add(this.body);

    this.torso = piece(torsoGeo);
    this.torso.position.y = 3;

    this.head = piece(headGeo);
    this.head.position.y = 4.67;
    for (const sx of [-0.22, 0.22]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(sx, 0.08, 0.61);
      this.head.add(eye);
    }

    // Limbs hang from a pivot (shoulder or hip) so they can swing
    this.armP = piece(limbGeo, -0.85); this.armP.position.set(1.5, 3.8, 0);
    this.armN = piece(limbGeo, -0.85); this.armN.position.set(-1.5, 3.8, 0);
    this.legP = piece(limbGeo, -1);    this.legP.position.set(0.41, 2, 0);
    this.legN = piece(limbGeo, -1);    this.legN.position.set(-0.41, 2, 0);

    this.body.add(this.torso, this.head, this.armP, this.armN, this.legP, this.legN);

    this.phase = 0;
    this.tagText = '';
    this.tagColor = '';
    this.tag = makeTag();
    this.tag.position.y = 6.4;
    this.root.add(this.tag);
  }

  setTag(text, color = '#ffffff') {
    if (text === this.tagText && color === this.tagColor) return;
    this.tagText = text;
    this.tagColor = color;
    drawTag(this.tag, text, color);
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
    this.tag.position.y = lerp(this.tag.position.y, tagY, k);

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
    this.tag.material.map.dispose();
    this.tag.material.dispose();
  }
}

// Name tag above the head
function makeTag() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 96;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(5.6, 1.05, 1);
  sprite.userData.canvas = canvas;
  return sprite;
}

function drawTag(sprite, text, color) {
  const c = sprite.userData.canvas;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.font = '700 54px Fredoka, "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(20,24,32,0.85)';
  g.strokeText(text, c.width / 2, c.height / 2);
  g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2);
  sprite.material.map.needsUpdate = true;
}

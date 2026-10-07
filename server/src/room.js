// The one and only game room. Runs rounds, the K-pop entity AI and every
// game rule (bonks, revives, carrying, player entities, ghosts).
// Players own their own movement and report their position to the server.

// ---------------------------------------------------------------------------
// Tuning. Keep RUN_SPEED, the map size and timers in sync with client/shared.js
// ---------------------------------------------------------------------------
const TICK_MS = 50;               // 20 server ticks per second
const MAX_PLAYERS = 40;
const SILENT_KICK_MS = 30000;     // drop players we have not heard from (closed laptop, hidden tab)

const MAP_HALF = 100;             // the block is 200 x 200, top at y = 0
const DROP_HEIGHT = 35;           // about 1 second of falling
const RUN_SPEED = 18;

const ROUND_TIME = 120;           // 2 minute rounds
const INTRO_TIME = 5;             // entity stands still in the middle, nobody can be bonked

// K-pop entity AI (translated from how Evade nextbots work)
const KPOP_SPEED_MULT = 1.15;     // override with the CHASER_SPEED_MULT variable on Cloudflare
const ENTITY_ACCEL = 75;          // how fast it can change direction (lower = easier to juke)
const REPATH_EVERY = 0.15;        // re-plan the route this often (seconds)
const RETARGET_EVERY = 0.15;
const RETARGET_HYSTERESIS = 0.75; // someone must be 25% closer to steal its focus
const CLOSE_RANGE = 14;           // inside this, chase your exact position
const LEAD_MAX = 0.5;             // further out, aim where you will be (up to this many seconds ahead)
const STUCK_TIME = 4;             // no progress for this long and it re-plans from scratch
const DOWN_RADIUS = 4;            // touching distance (Evade uses 3.4 studs, scaled to our size)
const ENTITY_H = 10;

const DOWN_TIME = 10;
const REVIVE_TIME = 5;
const MAX_REVIVES = 1;            // second bonk in a round and you are out
const REVIVE_RANGE = 5.5;
const CARRY_RANGE = 5.5;
const CARRY_TIME = 10;
const CARRY_COOLDOWN = 30;
const CARRY_HEIGHT = 5.1;
const JOIN_PROTECT = 4;           // 1 second falling plus 3 seconds on the ground
const REVIVE_PROTECT = 2;
const MAX_PLAYER_ENTITIES = 3;
const NEW_ENTITY_WAIT = 3;        // new player entities cannot bonk straight away

const SKIN_KPOP = 0;
const PLAYER_SKINS = [1, 2, 3];   // fork bomb, doodle, you are an idiot

const FRUITS = [
  'Apple', 'Banana', 'Cherry', 'Grape', 'Kiwi', 'Lemon', 'Lime', 'Mango',
  'Melon', 'Orange', 'Papaya', 'Peach', 'Pear', 'Plum', 'Coconut', 'Guava',
  'Lychee', 'Fig', 'Apricot', 'Pineapple', 'Strawberry', 'Blueberry',
  'Raspberry', 'Watermelon', 'Date', 'Nectarine', 'Cranberry', 'Dragonfruit',
  'Passionfruit', 'Tangerine', 'Pomegranate', 'Cantaloupe', 'Blackberry',
];
const COLORS = [
  '#ffffff', '#ff3b3b', '#ff8a1f', '#ffd31a', '#8be04a', '#22c55e',
  '#20d3d3', '#3b82f6', '#8b5cf6', '#ec4899', '#b0703c', '#9ca3af',
];

const ALIVE = 0, DOWNED = 1, ENTITY = 2, GHOST = 3;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

// Squared distance from point (px, pz) to the segment (ax, az) to (bx, bz).
// Used so a fast player cannot skip through an entity between two updates.
function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len = dx * dx + dz * dz;
  let t = len > 0 ? ((px - ax) * dx + (pz - az) * dz) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return dist2(px, pz, ax + dx * t, az + dz * t);
}

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = new Map();
    this.chasers = [];
    this.nextId = 1;
    this.nextChaserId = 1;
    this.loop = null;
    this.lastTick = Date.now();
    this.roundStart = Date.now();
    this.roundNo = 0;
    this.chaserSpeed = RUN_SPEED * (Number(env && env.CHASER_SPEED_MULT) || KPOP_SPEED_MULT);
    this.roundTime = Number(env && env.ROUND_TIME) || ROUND_TIME; // for testing
  }

  async fetch() {
    if (this.players.size >= MAX_PLAYERS) {
      return new Response('Server is full', { status: 503 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.addPlayer(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // -------------------------------------------------------------------------
  // Connections
  // -------------------------------------------------------------------------
  addPlayer(ws) {
    const now = Date.now();
    const p = {
      id: this.nextId++,
      name: this.makeName(),
      color: pick(COLORS),
      ws,
      x: 0, y: DROP_HEIGHT, z: 0, px: 0, pz: 0, vx: 0, vz: 0, lastPosT: now,
      yaw: 0, anim: 0,
      state: ALIVE,
      downLeft: 0, reviveProg: 0, revives: 0, rv: 0,
      carriedBy: 0, carrying: 0, carryLeft: 0, carryCd: 0,
      protect: 0, skin: 0, huntCd: 0,
      tpSeq: 0, lastMsg: now,
    };
    const wasEmpty = this.players.size === 0;
    this.players.set(p.id, p);

    const roster = [...this.players.values()].map((o) => [o.id, o.name, o.color]);
    this.send(p, { t: 'w', id: p.id, name: p.name, color: p.color, roster });
    this.broadcast({ t: 'j', i: p.id, n: p.name, c: p.color }, p);

    ws.addEventListener('message', (e) => this.onMessage(p, e.data));
    const bye = () => this.removePlayer(p);
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);

    if (wasEmpty) {
      // Nobody was playing: start a fresh round from 00:00
      this.startLoop();
      this.startRound(now);
    } else {
      this.event(`${p.name} joined`);
      if (this.inIntro(now)) this.dropAtCenter(p);
      else this.dropRandom(p, JOIN_PROTECT);
      this.ensureChasers(false);
    }
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    this.releaseCarry(p);
    this.players.delete(p.id);
    this.broadcast({ t: 'l', i: p.id });
    this.event(`${p.name} left`);
    if (this.players.size === 0) this.stopLoop();
    else this.ensureChasers(false);
  }

  makeName() {
    const used = new Set([...this.players.values()].map((p) => p.name));
    for (let i = 0; i < 50; i++) {
      const n = pick(FRUITS) + (1 + Math.floor(Math.random() * 99));
      if (!used.has(n)) return n;
    }
    return 'Fruit' + (1 + Math.floor(Math.random() * 99));
  }

  onMessage(p, raw) {
    if (typeof raw !== 'string' || raw.length > 300) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!this.players.has(p.id)) return;
    const now = Date.now();
    p.lastMsg = now;

    if (m.t === 's') {
      p.rv = p.state === ALIVE ? Math.floor(num(m.rv)) : 0;
      // Ignore positions sent before the client saw our last teleport,
      // and positions from players riding on someone's shoulders.
      if (num(m.q, -1) !== p.tpSeq || p.carriedBy) return;
      const x = num(m.x, p.x), z = num(m.z, p.z);
      const dt = (now - p.lastPosT) / 1000;
      if (dt > 0.03 && dt < 1.5) {
        const k = 0.6;
        p.vx += ((x - p.x) / dt - p.vx) * k;
        p.vz += ((z - p.z) / dt - p.vz) * k;
      } else { p.vx = 0; p.vz = 0; }
      p.px = p.x; p.pz = p.z;
      p.x = x; p.z = z; p.y = num(m.y, p.y);
      p.lastPosT = now;
      p.yaw = num(m.r, p.yaw);
      p.anim = Math.floor(num(m.a)) & 255;
    } else if (m.t === 'carry') {
      this.toggleCarry(p);
    } else if (m.t === 'fell') {
      if (num(m.q, -1) !== p.tpSeq || p.carriedBy) return;
      if (p.state === ALIVE || p.state === DOWNED) {
        this.event(`${p.name} fell off`);
        this.kill(p);
      }
      this.dropRandom(p, 0);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  send(p, obj) {
    try { p.ws.send(JSON.stringify(obj)); } catch { /* socket gone */ }
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (p === except) continue;
      try { p.ws.send(s); } catch { /* socket gone */ }
    }
  }

  event(text) {
    this.broadcast({ t: 'ev', m: text });
  }

  inIntro(now) {
    return (now - this.roundStart) / 1000 < INTRO_TIME;
  }

  teleport(p, x, y, z) {
    p.x = p.px = x; p.y = y; p.z = p.pz = z;
    p.vx = p.vz = 0;
    p.tpSeq++;
    this.send(p, { t: 'tp', x: r2(x), y: r2(y), z: r2(z), q: p.tpSeq });
  }

  dropAtCenter(p) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 7;
    this.teleport(p, Math.cos(a) * r, DROP_HEIGHT, Math.sin(a) * r);
  }

  // Drop in from the sky somewhere away from the entities
  dropRandom(p, protect) {
    let best = null, bestScore = -1;
    for (let i = 0; i < 12; i++) {
      const x = rand(-MAP_HALF * 0.8, MAP_HALF * 0.8);
      const z = rand(-MAP_HALF * 0.8, MAP_HALF * 0.8);
      let score = Infinity;
      for (const h of this.hunters()) {
        if (h.id !== p.id) score = Math.min(score, dist2(x, z, h.x, h.z));
      }
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    p.protect = protect;
    this.teleport(p, best.x, DROP_HEIGHT, best.z);
  }

  resetPlayer(p) {
    p.state = ALIVE;
    p.downLeft = 0; p.reviveProg = 0; p.revives = 0; p.rv = 0;
    p.carriedBy = 0; p.carrying = 0; p.carryLeft = 0; p.carryCd = 0;
    p.protect = 0; p.skin = 0; p.huntCd = 0;
  }

  // Everything that can bonk: AI entities plus players who became entities
  hunters() {
    const list = this.chasers.map((c) => ({ id: -c.id, x: c.x, z: c.z, y: 0, ai: c }));
    for (const p of this.players.values()) {
      if (p.state === ENTITY && p.huntCd <= 0) list.push({ id: p.id, x: p.x, z: p.z, y: p.y, player: p });
    }
    return list;
  }

  isTargetable(p) {
    return p.state === ALIVE && p.protect <= 0 && !p.carriedBy &&
      Math.abs(p.x) < MAP_HALF + 2 && Math.abs(p.z) < MAP_HALF + 2 && p.y > -4 && p.y < 25;
  }

  // -------------------------------------------------------------------------
  // Rounds
  // -------------------------------------------------------------------------
  startRound(now) {
    this.roundStart = now;
    this.roundNo++;
    this.chasers = [];
    this.ensureChasers(true);
    for (const p of this.players.values()) {
      this.resetPlayer(p);
      this.dropAtCenter(p);
    }
  }

  // One K-pop always, a second one once there are 3 or more players
  ensureChasers(atCenter) {
    const wanted = this.players.size >= 3 ? 2 : 1;
    while (this.chasers.length < wanted) {
      this.chasers.push(this.spawnChaser(atCenter));
      if (this.chasers.length === 2) this.broadcast({ t: 'warn', m: 'SECOND KPOP' });
    }
    while (this.chasers.length > wanted) this.chasers.pop();
  }

  spawnChaser(atCenter) {
    let x = 0, z = 0;
    if (atCenter) {
      x = this.chasers.length === 0 ? 0 : 10;
    } else {
      // The corner furthest from everyone
      let bestScore = -1;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = sx * MAP_HALF * 0.85, cz = sz * MAP_HALF * 0.85;
        let score = Infinity;
        for (const p of this.players.values()) score = Math.min(score, dist2(cx, cz, p.x, p.z));
        if (score > bestScore) { bestScore = score; x = cx; z = cz; }
      }
    }
    return {
      id: this.nextChaserId++, skin: SKIN_KPOP, x, z, vx: 0, vz: 0,
      target: 0, retarget: 0, repath: 0, dirX: 0, dirZ: 0, spd: 0,
      wander: null, bestDist: Infinity, stuck: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Bonks, deaths, revives, carrying
  // -------------------------------------------------------------------------
  bonk(p) {
    if (p.revives >= MAX_REVIVES) {
      this.event(`${p.name} got bonked again`);
      this.kill(p);
      return;
    }
    p.state = DOWNED;
    p.downLeft = DOWN_TIME;
    p.reviveProg = 0;
    p.rv = 0;
    this.releaseCarry(p);
    this.event(`${p.name} got bonked`);
  }

  // Out for the rest of the round: become an entity if there is room, else a ghost
  kill(p) {
    this.releaseCarry(p);
    p.downLeft = 0; p.reviveProg = 0; p.rv = 0;
    const used = new Set();
    for (const o of this.players.values()) if (o.state === ENTITY) used.add(o.skin);
    const free = PLAYER_SKINS.filter((s) => !used.has(s));
    if (free.length > 0 && used.size < MAX_PLAYER_ENTITIES) {
      p.state = ENTITY;
      p.skin = pick(free);
      p.huntCd = NEW_ENTITY_WAIT;
      this.event(`${p.name} became an entity`);
    } else {
      p.state = GHOST;
      p.skin = 0;
      this.event(`${p.name} is a ghost`);
    }
  }

  // Undo any carrying this player is part of
  releaseCarry(p) {
    if (p.carrying) this.dropCarry(p);
    if (p.carriedBy) {
      const c = this.players.get(p.carriedBy);
      if (c) { c.carrying = 0; c.carryLeft = 0; c.carryCd = CARRY_COOLDOWN; }
      p.carriedBy = 0;
      this.teleport(p, p.x, p.y, p.z);
    }
  }

  toggleCarry(p) {
    if (p.carrying) { this.dropCarry(p); return; }
    if (p.state !== ALIVE || p.carriedBy || p.carryCd > 0) return;
    let best = null, bestD = CARRY_RANGE * CARRY_RANGE;
    for (const d of this.players.values()) {
      if (d === p || d.state !== DOWNED || d.carriedBy) continue;
      const dd = dist2(p.x, p.z, d.x, d.z);
      if (dd < bestD && Math.abs(d.y - p.y) < 4) { bestD = dd; best = d; }
    }
    if (!best) return;
    p.carrying = best.id;
    p.carryLeft = CARRY_TIME;
    best.carriedBy = p.id;
    best.reviveProg = 0;
  }

  dropCarry(carrier) {
    const d = this.players.get(carrier.carrying);
    carrier.carrying = 0;
    carrier.carryLeft = 0;
    carrier.carryCd = CARRY_COOLDOWN;
    if (d) {
      d.carriedBy = 0;
      this.teleport(d, carrier.x, carrier.y + 0.2, carrier.z);
    }
  }

  // -------------------------------------------------------------------------
  // Game loop
  // -------------------------------------------------------------------------
  startLoop() {
    if (this.loop) return;
    this.lastTick = Date.now();
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  stopLoop() {
    // Nobody here: stop ticking so the server can go to sleep (saves the free tier)
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.chasers = [];
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;

    // Drop players we have not heard from in a while
    for (const p of [...this.players.values()]) {
      if (now - p.lastMsg > SILENT_KICK_MS) {
        try { p.ws.close(4000, 'idle'); } catch { /* already closed */ }
        this.removePlayer(p);
      }
    }
    if (this.players.size === 0) return;

    if ((now - this.roundStart) / 1000 >= this.roundTime) {
      this.event('New round');
      this.startRound(now);
    }
    const intro = this.inIntro(now);

    // Timers
    for (const p of this.players.values()) {
      if (p.protect > 0) p.protect -= dt;
      if (p.huntCd > 0) p.huntCd -= dt;
      if (p.carryCd > 0) p.carryCd = Math.max(0, p.carryCd - dt);
      if (p.carrying) {
        p.carryLeft -= dt;
        const d = this.players.get(p.carrying);
        if (!d || d.state !== DOWNED) {
          p.carrying = 0; p.carryCd = CARRY_COOLDOWN;
          if (d) d.carriedBy = 0;
        } else if (p.carryLeft <= 0) this.dropCarry(p);
      }
    }

    // Carried players ride on the carrier's shoulders
    for (const p of this.players.values()) {
      if (!p.carriedBy) continue;
      const c = this.players.get(p.carriedBy);
      if (!c) { p.carriedBy = 0; continue; }
      p.x = p.px = c.x; p.y = c.y + CARRY_HEIGHT; p.z = p.pz = c.z; p.yaw = c.yaw;
    }

    // Reviving and bleeding out
    for (const d of this.players.values()) {
      if (d.state !== DOWNED) continue;
      let helper = null;
      if (!d.carriedBy) {
        for (const p of this.players.values()) {
          if (p.rv === d.id && p.state === ALIVE && !p.carrying && !p.carriedBy &&
              dist2(p.x, p.z, d.x, d.z) < REVIVE_RANGE * REVIVE_RANGE && Math.abs(p.y - d.y) < 4) {
            helper = p; break;
          }
        }
      }
      if (helper) {
        // The bleed out timer pauses while someone is reviving you
        d.reviveProg += dt;
        if (d.reviveProg >= REVIVE_TIME) {
          d.state = ALIVE;
          d.reviveProg = 0;
          d.revives++;
          d.protect = REVIVE_PROTECT;
          helper.rv = 0;
          this.event(`${helper.name} revived ${d.name}`);
        }
      } else {
        d.reviveProg = 0;
        d.downLeft -= dt;
        if (d.downLeft <= 0) this.kill(d);
      }
    }

    if (!intro) {
      this.updateChasers(dt);
      this.checkBonks();
    }
    this.snapshot(now);
  }

  updateChasers(dt) {
    const targets = [...this.players.values()].filter((p) => this.isTargetable(p));

    for (const c of this.chasers) {
      // 1. Pick a target: the closest survivor. Stick with the current one
      //    unless someone is clearly closer, so it does not flicker.
      c.retarget -= dt;
      let cur = c.target ? this.players.get(c.target) : null;
      if (cur && !this.isTargetable(cur)) { cur = null; c.target = 0; c.retarget = 0; }
      if (c.retarget <= 0) {
        c.retarget = RETARGET_EVERY;
        let best = null, bestD = Infinity;
        for (const p of targets) {
          const d = dist2(c.x, c.z, p.x, p.z);
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best && (!cur || bestD < dist2(c.x, c.z, cur.x, cur.z) * RETARGET_HYSTERESIS ** 2)) {
          if (!cur || best.id !== cur.id) { c.bestDist = Infinity; c.stuck = 0; }
          c.target = best.id;
          cur = best;
        }
      }

      // 2. Re-plan the route every REPATH_EVERY seconds instead of following an
      //    old path. The map is one open block, so the "path" is a straight line:
      //    far away it aims at where you are heading, up close at where you are.
      //    Between re-plans it keeps its last heading, which is what lets you juke.
      c.repath -= dt;
      if (c.repath <= 0) {
        c.repath = REPATH_EVERY;
        let ax, az;
        if (cur) {
          const dist = Math.sqrt(dist2(c.x, c.z, cur.x, cur.z));
          if (dist < CLOSE_RANGE) {
            ax = cur.x; az = cur.z;
          } else {
            const lead = Math.min(LEAD_MAX, dist / this.chaserSpeed);
            ax = cur.x + cur.vx * lead; az = cur.z + cur.vz * lead;
          }
          c.spd = this.chaserSpeed;

          // 3. Stuck check: if it has not got any closer for a while, forget
          //    the target and plan again (later, with walls, this is where the
          //    teleport fallback goes).
          if (dist < c.bestDist - 0.5) { c.bestDist = dist; c.stuck = 0; }
          else c.stuck += REPATH_EVERY;
          if (c.stuck > STUCK_TIME) { c.target = 0; c.retarget = 0; c.stuck = 0; c.bestDist = Infinity; }
        } else {
          if (!c.wander || dist2(c.x, c.z, c.wander.x, c.wander.z) < 16) {
            c.wander = { x: rand(-MAP_HALF * 0.8, MAP_HALF * 0.8), z: rand(-MAP_HALF * 0.8, MAP_HALF * 0.8) };
          }
          ax = c.wander.x; az = c.wander.z;
          c.spd = this.chaserSpeed * 0.45;
        }
        const lim = MAP_HALF - 2;
        ax = Math.max(-lim, Math.min(lim, ax));
        az = Math.max(-lim, Math.min(lim, az));
        const dx = ax - c.x, dz = az - c.z, dl = Math.hypot(dx, dz);
        c.dirX = dl > 0.01 ? dx / dl : 0;
        c.dirZ = dl > 0.01 ? dz / dl : 0;
      }

      // 4. Steering: speed up toward the planned heading with limited turning
      let ax = c.dirX * c.spd - c.vx, az = c.dirZ * c.spd - c.vz;
      const al = Math.hypot(ax, az), maxDv = ENTITY_ACCEL * dt;
      if (al > maxDv) { ax *= maxDv / al; az *= maxDv / al; }
      c.vx += ax; c.vz += az;
      c.x += c.vx * dt; c.z += c.vz * dt;

      const lim = MAP_HALF - 2;
      if (c.x > lim) { c.x = lim; c.vx = Math.min(0, c.vx); }
      if (c.x < -lim) { c.x = -lim; c.vx = Math.max(0, c.vx); }
      if (c.z > lim) { c.z = lim; c.vz = Math.min(0, c.vz); }
      if (c.z < -lim) { c.z = -lim; c.vz = Math.max(0, c.vz); }
    }

    // Keep the two K-pops from stacking on top of each other
    if (this.chasers.length === 2) {
      const [a, b] = this.chasers;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 7) {
        const push = (7 - d) / 2;
        a.x -= (dx / d) * push; a.z -= (dz / d) * push;
        b.x += (dx / d) * push; b.z += (dz / d) * push;
      }
    }
  }

  // Touching any entity (AI or player) bonks you. Plain distance check, no physics.
  checkBonks() {
    const hunters = this.hunters();
    for (const p of this.players.values()) {
      if (!this.isTargetable(p)) continue;
      for (const h of hunters) {
        if (h.id === p.id) continue;
        if (Math.abs(p.y - h.y) > ENTITY_H) continue;
        if (segDist2(h.x, h.z, p.px, p.pz, p.x, p.z) < DOWN_RADIUS * DOWN_RADIUS) {
          this.bonk(p);
          if (h.ai && h.ai.target === p.id) { h.ai.target = 0; h.ai.retarget = 0; } // go find the next person
          break;
        }
      }
    }
  }

  snapshot(now) {
    // Arrays instead of objects keep every message small
    const pl = [];
    for (const p of this.players.values()) {
      pl.push([
        p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), p.anim, p.state,
        r2(Math.max(0, p.downLeft)), r2(p.reviveProg),
        p.carriedBy, p.carrying, r2(Math.max(0, p.carryLeft)), r2(p.carryCd),
        p.protect > 0 ? 1 : 0, p.rv ? 1 : 0, p.skin, p.revives,
      ]);
    }
    const ch = this.chasers.map((c) => [c.id, r2(c.x), r2(c.z), c.skin]);
    this.broadcast({
      t: 'S', now, rt: r2((now - this.roundStart) / 1000), rn: this.roundNo, p: pl, c: ch,
    });
  }
}

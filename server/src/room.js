// The one and only game room. Runs the chaser AI and owns every game rule
// (downed, revive, carry, lobby). Players own their own movement and report
// their position about 10 times a second.

// ---------------------------------------------------------------------------
// Tuning. Keep RUN_SPEED and the map numbers in sync with client/shared.js
// ---------------------------------------------------------------------------
const TICK_MS = 50;               // 20 server ticks per second
const MAX_PLAYERS = 40;

const MAP_HALF = 100;             // main platform is 200 x 200, top at y = 0
const LOBBY = { x: 0, y: 20, z: -180, half: 22 };

const RUN_SPEED = 18;
const CHASER_SPEED_MULT = 1.25;   // 1.1 to 1.4 feels right
const CHASER_ACCEL = 38;          // lower = more drift when you juke
const CHASER_REACTION = 0.25;     // seconds behind your real position
const CHASER_RADIUS = 2.6;
const CHASER_HEIGHT = 9;
const PLAYER_RADIUS = 1;
const RETARGET_EVERY = 0.4;
const RETARGET_HYSTERESIS = 0.75; // new target must be 25% closer to steal focus

const DOWN_TIME = 30;
const REVIVE_TIME = 5;
const REVIVE_RANGE = 5.5;
const CARRY_RANGE = 5.5;
const CARRY_TIME = 30;
const CARRY_COOLDOWN = 30;
const CARRY_HEIGHT = 5.1;         // carried player stands on the shoulders
const LOBBY_TIME = 8;
const SPAWN_PROTECT = 3;
const REVIVE_PROTECT = 2;

const FRUITS = [
  'Apple', 'Banana', 'Cherry', 'Grape', 'Kiwi', 'Lemon', 'Lime', 'Mango',
  'Melon', 'Orange', 'Papaya', 'Peach', 'Pear', 'Plum', 'Coconut', 'Guava',
  'Lychee', 'Fig', 'Apricot', 'Pineapple', 'Strawberry', 'Blueberry',
  'Raspberry', 'Watermelon', 'Date', 'Nectarine', 'Cranberry', 'Dragonfruit',
  'Passionfruit', 'Tangerine', 'Pomegranate', 'Cantaloupe', 'Blackberry',
];

const ALIVE = 0, DOWNED = 1, IN_LOBBY = 2;

const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

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
    // Optional override from wrangler.toml [vars], e.g. CHASER_SPEED_MULT = "1.3"
    this.chaserSpeed = RUN_SPEED * (Number(env && env.CHASER_SPEED_MULT) || CHASER_SPEED_MULT);
  }

  async fetch(request) {
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
    const p = {
      id: this.nextId++,
      name: this.makeName(),
      ws,
      x: 0, y: 0, z: 0, yaw: 0, anim: 0,
      hist: [],
      state: ALIVE,
      downLeft: 0,
      reviveProg: 0,
      rv: 0,              // id of the downed player this player is holding R on
      carriedBy: 0,
      carrying: 0,
      carryLeft: 0,
      carryCd: 0,
      protect: 0,
      lobbyLeft: 0,
      tpSeq: 0,
    };
    this.players.set(p.id, p);

    this.send(p, { t: 'w', id: p.id, name: p.name });
    this.respawn(p);
    this.event(`${p.name} joined`);

    ws.addEventListener('message', (e) => this.onMessage(p, e.data));
    const bye = () => this.removePlayer(p);
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);

    this.startLoop();
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    if (p.carrying) this.dropCarry(p);
    if (p.carriedBy) {
      const c = this.players.get(p.carriedBy);
      if (c) { c.carrying = 0; c.carryCd = CARRY_COOLDOWN; }
    }
    this.players.delete(p.id);
    this.event(`${p.name} left`);
    if (this.players.size === 0) this.stopLoop();
  }

  makeName() {
    const used = new Set([...this.players.values()].map((p) => p.name));
    for (let i = 0; i < 50; i++) {
      const n = FRUITS[Math.floor(Math.random() * FRUITS.length)] + (1 + Math.floor(Math.random() * 99));
      if (!used.has(n)) return n;
    }
    return 'Fruit' + (1 + Math.floor(Math.random() * 99));
  }

  onMessage(p, raw) {
    if (typeof raw !== 'string' || raw.length > 400) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!this.players.has(p.id)) return;

    if (m.t === 's') {
      p.rv = p.state === ALIVE ? Math.floor(num(m.rv)) : 0;
      // Ignore positions sent before the client saw our last teleport,
      // and positions from players riding on someone's shoulders.
      if (num(m.q, -1) !== p.tpSeq || p.carriedBy) return;
      p.x = num(m.x, p.x); p.y = num(m.y, p.y); p.z = num(m.z, p.z);
      p.yaw = num(m.r, p.yaw);
      p.anim = Math.floor(num(m.a)) & 255;
      const now = Date.now();
      p.hist.push({ t: now, x: p.x, z: p.z });
      while (p.hist.length > 2 && now - p.hist[0].t > 1000) p.hist.shift();
    } else if (m.t === 'carry') {
      this.toggleCarry(p);
    } else if (m.t === 'fell') {
      if (num(m.q, -1) !== p.tpSeq) return;
      if (p.state === IN_LOBBY) this.teleport(p, LOBBY.x + rand(-6, 6), LOBBY.y, LOBBY.z + rand(-6, 6));
      else {
        this.event(`${p.name} fell off`);
        this.sendToLobby(p);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  send(p, obj) {
    try { p.ws.send(JSON.stringify(obj)); } catch { /* socket gone */ }
  }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) {
      try { p.ws.send(s); } catch { /* socket gone */ }
    }
  }

  event(text) {
    this.broadcast({ t: 'ev', m: text });
  }

  teleport(p, x, y, z) {
    p.x = x; p.y = y; p.z = z;
    p.hist = [];
    p.tpSeq++;
    this.send(p, { t: 'tp', x: r2(x), y: r2(y), z: r2(z), q: p.tpSeq });
  }

  respawn(p) {
    // Pick the spot furthest from every chaser out of a few random tries.
    let best = null, bestScore = -1;
    for (let i = 0; i < 12; i++) {
      const x = rand(-MAP_HALF * 0.8, MAP_HALF * 0.8);
      const z = rand(-MAP_HALF * 0.8, MAP_HALF * 0.8);
      let score = Infinity;
      for (const c of this.chasers) score = Math.min(score, dist2(x, z, c.x, c.z));
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    p.state = ALIVE;
    p.downLeft = 0;
    p.reviveProg = 0;
    p.protect = SPAWN_PROTECT;
    this.teleport(p, best.x, 0.5, best.z);
  }

  sendToLobby(p) {
    if (p.carrying) this.dropCarry(p);
    if (p.carriedBy) {
      const c = this.players.get(p.carriedBy);
      if (c) { c.carrying = 0; c.carryCd = CARRY_COOLDOWN; }
      p.carriedBy = 0;
    }
    p.state = IN_LOBBY;
    p.lobbyLeft = LOBBY_TIME;
    p.downLeft = 0;
    p.reviveProg = 0;
    this.teleport(p, LOBBY.x + rand(-8, 8), LOBBY.y + 0.5, LOBBY.z + rand(-8, 8));
  }

  down(p) {
    p.state = DOWNED;
    p.downLeft = DOWN_TIME;
    p.reviveProg = 0;
    p.rv = 0;
    if (p.carrying) this.dropCarry(p);
    this.event(`${p.name} got downed`);
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

  // Where the chaser thinks you are: your position CHASER_REACTION seconds ago.
  delayedPos(p, now) {
    const h = p.hist;
    if (h.length === 0) return { x: p.x, z: p.z };
    const t = now - CHASER_REACTION * 1000;
    if (t <= h[0].t) return { x: h[0].x, z: h[0].z };
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (a.t <= t && t <= b.t) {
        const k = (t - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
      }
    }
    return { x: p.x, z: p.z };
  }

  isTargetable(p) {
    return p.state === ALIVE && p.protect <= 0 && !p.carriedBy &&
      Math.abs(p.x) < MAP_HALF + 4 && Math.abs(p.z) < MAP_HALF + 4 && p.y > -6 && p.y < 30;
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
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.chasers = [];
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this.lastTick) / 1000);
    this.lastTick = now;

    // Timers
    for (const p of this.players.values()) {
      if (p.protect > 0) p.protect -= dt;
      if (p.carryCd > 0) p.carryCd = Math.max(0, p.carryCd - dt);
      if (p.carrying) {
        p.carryLeft -= dt;
        const d = this.players.get(p.carrying);
        if (!d || d.state !== DOWNED) { p.carrying = 0; p.carryCd = CARRY_COOLDOWN; if (d) d.carriedBy = 0; }
        else if (p.carryLeft <= 0) this.dropCarry(p);
      }
      if (p.state === IN_LOBBY) {
        p.lobbyLeft -= dt;
        if (p.lobbyLeft <= 0) { this.respawn(p); this.event(`${p.name} is back in`); }
      }
    }

    // Carried players ride on the carrier's shoulders
    for (const p of this.players.values()) {
      if (!p.carriedBy) continue;
      const c = this.players.get(p.carriedBy);
      if (!c) { p.carriedBy = 0; continue; }
      p.x = c.x; p.y = c.y + CARRY_HEIGHT; p.z = c.z; p.yaw = c.yaw;
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
          d.protect = REVIVE_PROTECT;
          helper.rv = 0;
          this.event(`${helper.name} revived ${d.name}`);
        }
      } else {
        d.reviveProg = 0;
        d.downLeft -= dt;
        if (d.downLeft <= 0) {
          this.event(`${d.name} went to the lobby`);
          this.sendToLobby(d);
        }
      }
    }

    this.updateChasers(dt, now);

    // Snapshot
    const pl = [];
    for (const p of this.players.values()) {
      pl.push({
        i: p.id, n: p.name,
        x: r2(p.x), y: r2(p.y), z: r2(p.z), r: r2(p.yaw), a: p.anim,
        s: p.state,
        dl: r2(Math.max(0, p.downLeft)),
        rp: r2(p.reviveProg),
        cb: p.carriedBy, cy: p.carrying,
        cl: r2(Math.max(0, p.carryLeft)), cc: r2(p.carryCd),
        ll: r2(Math.max(0, p.lobbyLeft)),
        pr: p.protect > 0 ? 1 : 0,
        v: p.rv ? 1 : 0,
      });
    }
    const ch = this.chasers.map((c) => ({ i: c.id, x: r2(c.x), z: r2(c.z) }));
    this.broadcast({ t: 'S', now, p: pl, c: ch });
  }

  updateChasers(dt, now) {
    // 1 chaser, plus 1 more for every 4 players (max 3)
    const wanted = Math.min(3, 1 + Math.floor(this.players.size / 4));
    while (this.chasers.length < wanted) this.chasers.push(this.spawnChaser());
    while (this.chasers.length > wanted) this.chasers.pop();

    const targets = [...this.players.values()].filter((p) => this.isTargetable(p));

    for (const c of this.chasers) {
      // Pick the closest target. Stick with the current one unless someone
      // is clearly closer, so it does not flicker between two people.
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
          c.target = best.id;
          cur = best;
        }
      }

      // Steering: accelerate toward where the target was a moment ago.
      // Limited acceleration means it overshoots when you cut sideways.
      let tx, tz, speed = this.chaserSpeed;
      if (cur) {
        const dp = this.delayedPos(cur, now);
        tx = dp.x; tz = dp.z;
      } else {
        if (!c.wander || dist2(c.x, c.z, c.wander.x, c.wander.z) < 16) {
          c.wander = { x: rand(-MAP_HALF * 0.8, MAP_HALF * 0.8), z: rand(-MAP_HALF * 0.8, MAP_HALF * 0.8) };
        }
        tx = c.wander.x; tz = c.wander.z; speed = this.chaserSpeed * 0.45;
      }
      const dx = tx - c.x, dz = tz - c.z;
      const dl = Math.hypot(dx, dz);
      const wantX = dl > 0.01 ? (dx / dl) * speed : 0;
      const wantZ = dl > 0.01 ? (dz / dl) * speed : 0;
      let ax = wantX - c.vx, az = wantZ - c.vz;
      const al = Math.hypot(ax, az), maxDv = CHASER_ACCEL * dt;
      if (al > maxDv) { ax *= maxDv / al; az *= maxDv / al; }
      c.vx += ax; c.vz += az;
      c.x += c.vx * dt; c.z += c.vz * dt;

      // Stay on the main platform
      const lim = MAP_HALF - 2;
      if (c.x > lim) { c.x = lim; c.vx = Math.min(0, c.vx); }
      if (c.x < -lim) { c.x = -lim; c.vx = Math.max(0, c.vx); }
      if (c.z > lim) { c.z = lim; c.vz = Math.min(0, c.vz); }
      if (c.z < -lim) { c.z = -lim; c.vz = Math.max(0, c.vz); }
    }

    // Keep chasers from stacking on top of each other
    for (let i = 0; i < this.chasers.length; i++) {
      for (let j = i + 1; j < this.chasers.length; j++) {
        const a = this.chasers[i], b = this.chasers[j];
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 7) {
          const push = (7 - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
    }

    // Touching a chaser downs you (anyone, not just its target)
    const hitR = (CHASER_RADIUS + PLAYER_RADIUS) ** 2;
    for (const c of this.chasers) {
      for (const p of this.players.values()) {
        if (!this.isTargetable(p)) continue;
        if (p.y < CHASER_HEIGHT && dist2(c.x, c.z, p.x, p.z) < hitR) {
          this.down(p);
          if (c.target === p.id) { c.target = 0; c.retarget = 0; } // go find the next person
        }
      }
    }
  }

  spawnChaser() {
    // Spawn in the corner furthest from everyone
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ x: sx * MAP_HALF * 0.85, z: sz * MAP_HALF * 0.85 }));
    let best = corners[0], bestScore = -1;
    for (const k of corners) {
      let score = Infinity;
      for (const p of this.players.values()) score = Math.min(score, dist2(k.x, k.z, p.x, p.z));
      if (score > bestScore) { bestScore = score; best = k; }
    }
    return { id: this.nextChaserId++, x: best.x, z: best.z, vx: 0, vz: 0, target: 0, retarget: 0, wander: null };
  }
}

// Solmara — game.js
// Gameplay: player, cars, traffic, pedestrians, police, wanted level,
// missions, shops, save/load, day/night cycle and camera.
// Vanilla JS, ES module, zero libraries, zero network.
// Fresh implementation for the gta6-01 rebuild.
import {
  WORLD_W, WORLD_H, DAY_SECONDS, DAY_START_MINUTES,
  PRICES, MISSION_REWARDS,
  PLAYER_WALK_SPEED, PLAYER_RUN_SPEED, PLAYER_RADIUS, PLAYER_MAX_HEALTH,
  PLAYER_PUNCH_DAMAGE, PLAYER_PUNCH_RANGE, PLAYER_PUNCH_COOLDOWN,
  PLAYER_SHOT_DAMAGE, PLAYER_SHOT_COOLDOWN, PLAYER_SHOT_RANGE,
  PLAYER_START_AMMO, AMMO_PACK,
  CAR_MAX_SPEED, CAR_REVERSE_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_DRAG,
  CAR_TURN_SPEED, CAR_MAX_HEALTH, TRAFFIC_SPEED, POLICE_SPEED,
  POLICE_RAM_DAMAGE, WANTED_MAX, WANTED_SIGHT_RANGE,
  MISSION1_TIME_LIMIT, MISSION4_TIME_LIMIT,
  CAMERA_LERP, SAVE_KEY, BEST_CASH_KEY,
} from './config.js';
import { createRng } from './random.js';

const Sol = (typeof globalThis !== 'undefined' && globalThis.Sol) || {};
const SAVE_VERSION = 1;

// Brief-specified numbers (the task brief is the authority for these rules).
const BRIEF_RUN_SPEED = 280; // brief: run 280 px/s (config tuning says 300)
const BUSTED_CASH_FRACTION = 0.15; // brief: lose 15% when busted
const BUSTED_CASH_MIN = 25;
const WASTED_CASH_FRACTION = 0.10; // brief: lose 10% when wasted
const MISSION4_HP_FLOOR = 30; // brief: HP cannot drop below 30 during Heat
const SNACK_HEAL = 30; // brief: snack +30 HP
const SHOP_RANGE = 60;
const ENTER_CAR_RANGE = 46;
const DAY_MINUTES_PER_SECOND = 1440 / DAY_SECONDS; // 3 min per real second

// ---------------------------------------------------------------- helpers
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function pointInBox(px, py, b) {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
}

// Normalise a collider from whatever shape the world module produced.
function normalizeCollider(c) {
  if (!c) return null;
  if (typeof c.x1 === 'number' && typeof c.y1 === 'number') {
    return { x: Math.min(c.x1, c.x2), y: Math.min(c.y1, c.y2), w: Math.abs(c.x2 - c.x1), h: Math.abs(c.y2 - c.y1) };
  }
  const w = c.w !== undefined ? c.w : c.width;
  const h = c.h !== undefined ? c.h : c.height;
  if (typeof c.x !== 'number' || typeof c.y !== 'number' || typeof w !== 'number' || typeof h !== 'number') return null;
  return { x: c.x, y: c.y, w, h };
}

// Line of sight: sample the segment; blocked if any sample lands in a collider.
function lineOfSightClear(x1, y1, x2, y2, colliders) {
  const d = dist(x1, y1, x2, y2);
  const steps = Math.max(2, Math.ceil(d / 40));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    for (const b of colliders) {
      if (pointInBox(px, py, b)) return false;
    }
  }
  return true;
}

// Push a circle out of every AABB it overlaps. Returns the impact speed
// (the component of velocity killed by the wall) for damage decisions.
function resolveCircleColliders(ent, r, vx, vy, colliders) {
  let impact = 0;
  for (const b of colliders) {
    const cx = clamp(ent.x, b.x, b.x + b.w);
    const cy = clamp(ent.y, b.y, b.y + b.h);
    const dx = ent.x - cx;
    const dy = ent.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = r - d;
      const nx = dx / d;
      const ny = dy / d;
      ent.x += nx * push;
      ent.y += ny * push;
      const into = -(vx * nx + vy * ny);
      if (into > impact) impact = into;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const left = ent.x - b.x;
      const right = b.x + b.w - ent.x;
      const top = ent.y - b.y;
      const bottom = b.y + b.h - ent.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) { ent.x = b.x - r; impact = Math.max(impact, Math.abs(vx)); }
      else if (m === right) { ent.x = b.x + b.w + r; impact = Math.max(impact, Math.abs(vx)); }
      else if (m === top) { ent.y = b.y - r; impact = Math.max(impact, Math.abs(vy)); }
      else { ent.y = b.y + b.h + r; impact = Math.max(impact, Math.abs(vy)); }
    }
  }
  return impact;
}

// ------------------------------------------------------------ mission defs
const MISSION_DEFS = [
  { n: 1, name: 'First Fare', reward: MISSION_REWARDS[0], timeLimit: MISSION1_TIME_LIMIT,
    brief: 'Mama Rosa needs a driver. Pick up the fare and drop them downtown — fast.' },
  { n: 2, name: 'Hot Wheels', reward: MISSION_REWARDS[1], timeLimit: 0,
    brief: 'A sunrise-yellow sportscar is parked uptown. Steal it and bring it to the garage.' },
  { n: 3, name: 'Paper Trail', reward: MISSION_REWARDS[2], timeLimit: 0,
    brief: 'Three packages, three corners of Solmara. Collect them all, then drop them off.' },
  { n: 4, name: 'Heat', reward: MISSION_REWARDS[3], timeLimit: MISSION4_TIME_LIMIT,
    brief: 'The whole force is on you — 3 stars. Lose them before the clock runs out.' },
  { n: 5, name: 'The Solmara Job', reward: MISSION_REWARDS[4], timeLimit: 0,
    brief: 'The downtown bank. Park up, walk in on foot, grab the cash with SPACE.' },
];

const CAR_TYPES = {
  sedan: { maxSpeed: 420, accel: CAR_ACCEL, color: '#7d8ea6' },
  sport: { maxSpeed: 520, accel: 480, color: '#e8b73a' },
  taxi: { maxSpeed: 440, accel: CAR_ACCEL, color: '#f5c518' },
  truck: { maxSpeed: 380, accel: 340, color: '#8a6f4d' },
  van: { maxSpeed: 400, accel: 360, color: '#6a8a7d' },
  police: { maxSpeed: POLICE_SPEED, accel: 500, color: '#1c4fd6' },
};

const SHOP_DEFS = [
  { kind: 'repair', label: 'Repair', price: PRICES.repair },
  { kind: 'ammo', label: 'Ammo +24', price: PRICES.ammo },
  { kind: 'snack', label: 'Snack +30 HP', price: PRICES.snack },
];

// ================================================================ createGame
export function createGame(city, input, audio) {
  const rng = createRng((city && city.seed) || 1337);
  const W = (city && city.width) || WORLD_W;
  const H = (city && city.height) || WORLD_H;

  // ---- city accessors (tolerant of the world module's exact shapes) ----
  function citySpawn() {
    const s = city && city.spawn;
    if (s && typeof s.x === 'number') return { x: s.x, y: s.y };
    return { x: W * 0.5, y: H * 0.62 };
  }
  function cityGarage() {
    const g = city && (city.garage || city.garagePos);
    if (g && typeof g.x === 'number') return { x: g.x, y: g.y };
    const s = citySpawn();
    return { x: clamp(s.x + 320, 80, W - 80), y: s.y };
  }
  function cityBank() {
    const b = city && (city.bank || city.bankPos);
    if (b && typeof b.x === 'number') return { x: b.x, y: b.y };
    return { x: W * 0.5, y: H * 0.38 };
  }
  function cityDowntown() {
    const d = city && (city.downtown || city.downtownPos);
    if (d && typeof d.x === 'number') return { x: d.x, y: d.y };
    return { x: W * 0.5, y: H * 0.38 };
  }
  function cityColliders() {
    const list = [];
    const raw = (city && (city.colliders || city.collisionBoxes)) || [];
    for (const c of raw) { const n = normalizeCollider(c); if (n) list.push(n); }
    // Fall back to building rects if no explicit collider list exists.
    if (list.length === 0 && city && Array.isArray(city.buildings)) {
      for (const b of city.buildings) { const n = normalizeCollider(b); if (n) list.push(n); }
    }
    return list;
  }
  function roadLines() {
    const hLines = [];
    const vLines = [];
    const raw = (city && city.roads) || [];
    for (const r of raw) {
      const n = normalizeCollider(r);
      if (!n) continue;
      if (n.w >= n.h) hLines.push({ line: n.y + n.h / 2, min: n.x, max: n.x + n.w });
      else vLines.push({ line: n.x + n.w / 2, min: n.y, max: n.y + n.h });
    }
    if (hLines.length === 0) {
      for (let y = 340; y < H; y += 340) hLines.push({ line: y, min: 60, max: W - 60 });
    }
    if (vLines.length === 0) {
      for (let x = 360; x < W; x += 360) vLines.push({ line: x, min: 60, max: H - 60 });
    }
    return { hLines, vLines };
  }
  function cityShops() {
    const raw = (city && city.shops) || [];
    const shops = [];
    for (const s of raw) {
      if (typeof s.x !== 'number') continue;
      shops.push({ x: s.x, y: s.y, kind: s.kind || s.type || 'repair', name: s.name || 'Shop' });
    }
    if (shops.length === 0) {
      const s = citySpawn();
      const g = cityGarage();
      const d = cityDowntown();
      shops.push(
        { x: s.x + 90, y: s.y - 60, kind: 'repair', name: 'Auto Repair' },
        { x: g.x - 90, y: g.y + 70, kind: 'ammo', name: 'Ammo Store' },
        { x: d.x + 120, y: d.y + 80, kind: 'snack', name: 'Snack Bar' },
      );
    }
    return shops;
  }
  function nearestRoadPoint(x, y) {
    const { hLines, vLines } = roadLines();
    let best = null;
    let bestD = Infinity;
    for (const r of hLines) {
      const px = clamp(x, r.min, r.max);
      const d = Math.abs(y - r.line) + Math.abs(x - px) * 0.2;
      if (d < bestD) { bestD = d; best = { x: px, y: r.line }; }
    }
    for (const r of vLines) {
      const py = clamp(y, r.min, r.max);
      const d = Math.abs(x - r.line) + Math.abs(y - py) * 0.2;
      if (d < bestD) { bestD = d; best = { x: r.line, y: py }; }
    }
    return best || { x: clamp(x, 60, W - 60), y: clamp(y, 60, H - 60) };
  }
  function freeSpotNear(x, y, radius) {
    // Find a point near (x,y) that is not inside any collider.
    const colliders = cityColliders();
    for (let tries = 0; tries < 24; tries++) {
      const a = rng.next() * Math.PI * 2;
      const r = tries === 0 ? 0 : radius * (0.4 + rng.next() * 0.8);
      const px = clamp(x + Math.cos(a) * r, 40, W - 40);
      const py = clamp(y + Math.sin(a) * r, 40, H - 40);
      let bad = false;
      for (const b of colliders) {
        if (px > b.x - 24 && px < b.x + b.w + 24 && py > b.y - 24 && py < b.y + b.h + 24) { bad = true; break; }
      }
      if (!bad) return { x: px, y: py };
    }
    return { x: clamp(x, 40, W - 40), y: clamp(y, 40, H - 40) };
  }

  const colliders = cityColliders();
  const shops = cityShops();
  const spawn = citySpawn();
  const garage = cityGarage();
  const bank = cityBank();
  const downtown = cityDowntown();
  const { hLines, vLines } = roadLines();

  // ---- audio helpers (audio may be a stub; never throw) ----
  function safeSfx(name) {
    try { if (audio && typeof audio.sfx === 'function') audio.sfx(name); }
    catch (e) { /* audio is best-effort */ }
  }
  function safeEngine() {
    try {
      if (audio && typeof audio.setEngine === 'function') {
        const car = state.player.inCar;
        audio.setEngine(!!car, car ? Math.abs(car.speed) / CAR_MAX_SPEED : 0);
      }
    } catch (e) { /* ignore */ }
  }

  // ---- input helpers (tolerant of the input module's exact shape) ----
  const KEY_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ShiftLeft', 'ShiftRight', 'Space', 'KeyE', 'KeyP', 'Escape', 'KeyM', 'KeyQ', 'Enter', 'KeyC',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
  function readKeys() {
    const set = new Set();
    if (!input) return set;
    if (typeof input.isDown === 'function') {
      for (const c of KEY_CODES) { try { if (input.isDown(c)) set.add(c); } catch (e) { /* ignore */ } }
      return set;
    }
    const k = input.keys || input.down;
    if (k instanceof Set) return new Set(k);
    if (Array.isArray(k)) return new Set(k);
    if (k && typeof k === 'object') {
      for (const code of Object.keys(k)) if (k[code]) set.add(code);
    }
    return set;
  }
  function readStick() {
    if (!input) return { x: 0, y: 0 };
    const j = input.joy || input.stick || input.move;
    if (j && typeof j.x === 'number') return { x: clamp(j.x, -1, 1), y: clamp(j.y, -1, 1) };
    return { x: 0, y: 0 };
  }
  function readTouchButton(name) {
    if (!input) return false;
    if (typeof input[name] === 'boolean') return input[name];
    if (input.buttons && typeof input.buttons[name] === 'boolean') return input.buttons[name];
    return false;
  }
  function readClicked() {
    if (!input) return false;
    if (typeof input.clicked === 'boolean') return input.clicked;
    if (typeof input.tapped === 'boolean') return input.tapped;
    if (typeof input.mouseClicked === 'boolean') return input.mouseClicked;
    return false;
  }

  let prevKeys = new Set();
  let prevFire = false;
  let prevAct = false;
  let prevClick = false;
  let keys = new Set();
  function isDown(...codes) { return codes.some((c) => keys.has(c)); }
  function justPressed(...codes) {
    return codes.some((c) => keys.has(c) && !prevKeys.has(c));
  }
  function anyKeyPressed() {
    for (const c of keys) if (!prevKeys.has(c)) return true;
    return false;
  }
  function snapshotInput() { prevKeys = keys; prevFire = fireHeld; prevAct = actHeld; prevClick = clickHeld; }

  let fireHeld = false;
  let actHeld = false;
  let clickHeld = false;

  // ---- entity spawners ----
  let nextId = 1;
  function makeCar(type, x, y, angle) {
    const t = CAR_TYPES[type] || CAR_TYPES.sedan;
    return {
      id: 'car' + (nextId++), type, x, y, angle: angle || 0,
      speed: 0, health: CAR_MAX_HEALTH, wrecked: false, color: t.color, driver: null,
    };
  }
  function spawnParkedCars() {
    const cars = [];
    const types = ['sedan', 'sedan', 'taxi', 'van', 'truck', 'sedan', 'sport', 'sedan'];
    // Parked cars sit 38px clear of the driving lane (v1 bug: 28 scraped traffic).
    for (let i = 0; i < 8; i++) {
      const road = rng.pick(hLines);
      const x = rng.range(road.min + 80, road.max - 80);
      const side = rng.chance(0.5) ? 1 : -1;
      const y = road.line + side * 38;
      const spot = freeSpotNear(x, y, 10);
      const car = makeCar(types[i % types.length], spot.x, spot.y, side > 0 ? 0 : Math.PI);
      car.driver = null;
      cars.push(car);
    }
    // One parked car near the spawn so the player can always get moving.
    const near = freeSpotNear(spawn.x + 70, spawn.y + 40, 20);
    const starter = makeCar('sedan', near.x, near.y, 0);
    cars.push(starter);
    return cars;
  }
  function spawnTrafficCar() {
    const horizontal = rng.chance(0.5);
    let car;
    if (horizontal) {
      const road = rng.pick(hLines);
      const dir = rng.chance(0.5) ? 1 : -1;
      car = makeCar(rng.pick(['sedan', 'sedan', 'taxi', 'van', 'truck']),
        rng.range(road.min + 60, road.max - 60), road.line + (dir > 0 ? -14 : 14), dir > 0 ? 0 : Math.PI);
      car.road = 'h'; car.line = road.line; car.dir = dir;
    } else {
      const road = rng.pick(vLines);
      const dir = rng.chance(0.5) ? 1 : -1;
      car = makeCar(rng.pick(['sedan', 'sedan', 'taxi', 'van', 'truck']),
        road.line + (dir > 0 ? -14 : 14), rng.range(road.min + 60, road.max - 60), dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      car.road = 'v'; car.line = road.line; car.dir = dir;
    }
    car.speed = TRAFFIC_SPEED * rng.range(0.8, 1.1);
    car.cruise = car.speed;
    car.driver = 'traffic';
    return car;
  }
  function spawnPedestrian() {
    const p = nearestRoadPoint(rng.range(100, W - 100), rng.range(100, H - 100));
    const spot = freeSpotNear(p.x + rng.range(-30, 30), p.y + rng.range(-30, 30), 30);
    return {
      id: 'ped' + (nextId++), x: spot.x, y: spot.y, angle: rng.next() * Math.PI * 2,
      speed: 0, health: 100, down: false, fleeX: 0, fleeY: 0, fleeUntil: 0,
      tx: spot.x, ty: spot.y, color: rng.pick(['#d06a6a', '#6ad08a', '#6a8ad0', '#d0b26a', '#c06ad0']),
    };
  }
  function spawnPoliceCarNear(px, py, minDist) {
    const a = rng.next() * Math.PI * 2;
    const d = (minDist || 480) + rng.range(0, 220);
    const spot = nearestRoadPoint(px + Math.cos(a) * d, py + Math.sin(a) * d);
    const car = makeCar('police', spot.x, spot.y, Math.atan2(py - spot.y, px - spot.x));
    car.driver = 'police';
    car.siren = true;
    return car;
  }
  function spawnOfficerNear(px, py) {
    const spot = freeSpotNear(px + rng.range(-160, 160), py + rng.range(-160, 160), 60);
    return {
      id: 'off' + (nextId++), x: spot.x, y: spot.y, angle: 0,
      speed: 0, health: 100, punchCd: 0, color: '#1c4fd6',
    };
  }

  // ---- state ----
  const state = {
    screen: 'title',
    player: {
      x: spawn.x, y: spawn.y, angle: -Math.PI / 2, health: PLAYER_MAX_HEALTH,
      ammo: PLAYER_START_AMMO, inCar: null,
    },
    vehicles: spawnParkedCars(),
    traffic: [],
    pedestrians: [],
    police: { cars: [], officers: [], bust: 0 },
    cash: 100,
    rep: 0,
    wanted: 0,
    minutes: DAY_START_MINUTES,
    day: 1,
    elapsed: 0,
    speedKmh: 0,
    prompt: null,
    city,
    missions: {
      active: null, phase: '', timer: 0, timeLimit: 0, progress: 0,
      text: 'Press ENTER to start your first job for Mama Rosa.',
      unlocked: [true, false, false, false, false],
      completed: [false, false, false, false, false],
      brief: 'Welcome to Solmara. Mama Rosa has work for a driver who asks no questions.',
      waypoint: null, fareX: 0, fareY: 0, dropX: 0, dropY: 0,
      packages: [], targetCarId: null,
    },
    settings: { muted: false, quality: 'high' },
    camera: { x: spawn.x, y: spawn.y },
    viewW: 1280,
    viewH: 720,
    __hasSave: false,
    // Internal bookkeeping (underscore fields; the renderer ignores them).
    _outOfSight: 0,
    _policeSyncT: 0,
    _sirenT: 0,
    _shotT: -10,
    _shotX: 0,
    _shotY: 0,
    _attackCd: 0,
    _enterCd: 0,
    _deathKind: null,
    _bestCash: 100,
  };
  state.peds = state.pedestrians;
  state.world = city; // render.js reads state.world; the city object is the world
  for (let i = 0; i < 10; i++) state.traffic.push(spawnTrafficCar());
  for (let i = 0; i < 12; i++) state.pedestrians.push(spawnPedestrian());

  // Load any existing save flag (read-only check; never writes here).
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(SAVE_KEY)) state.__hasSave = true;
    if (typeof localStorage !== 'undefined') {
      const best = Number(localStorage.getItem(BEST_CASH_KEY) || 0);
      if (best > 0) state._bestCash = best;
    }
  } catch (e) { /* storage unavailable (private mode, etc.) */ }

  // ------------------------------------------------------------ combat
  function damagePlayer(amount) {
    if (state.screen !== 'playing' || state.player.health <= 0) return;
    // Heat mission fairness fix: HP cannot drop below 30 during mission 4.
    if (state.missions.active === 4) {
      state.player.health = Math.max(MISSION4_HP_FLOOR, state.player.health - amount);
      return;
    }
    state.player.health = Math.max(0, state.player.health - amount);
    if (state.player.health <= 0) doWasted();
  }
  function damageCar(car, amount, opts) {
    if (!car || car.wrecked) return;
    const scrape = opts && opts.scrape;
    car.health -= amount;
    // Scraping a wall never grinds a car below 1 HP (v1 bug).
    if (scrape && car.health < 1) car.health = 1;
    if (car.health <= 0) {
      car.health = 0;
      car.wrecked = true;
      car.speed = 0;
      if (car === state.player.inCar) {
        state.prompt = 'Your car is wrecked — press E to get out.';
      }
      safeSfx('crash');
    }
  }
  function policeCanSee(x, y) {
    for (const c of state.police.cars) {
      if (dist(c.x, c.y, x, y) <= WANTED_SIGHT_RANGE && lineOfSightClear(c.x, c.y, x, y, colliders)) return true;
    }
    for (const o of state.police.officers) {
      if (dist(o.x, o.y, x, y) <= WANTED_SIGHT_RANGE && lineOfSightClear(o.x, o.y, x, y, colliders)) return true;
    }
    return false;
  }
  // A crime only raises wanted when police actually witness it.
  function witnessCrime(level, x, y) {
    if (policeCanSee(x, y)) {
      state.wanted = clamp(Math.max(state.wanted, level), 0, WANTED_MAX);
      state._outOfSight = 0;
      syncPolice();
    }
  }
  function nearestPoliceDist(x, y) {
    let best = Infinity;
    for (const c of state.police.cars) best = Math.min(best, dist(c.x, c.y, x, y));
    for (const o of state.police.officers) best = Math.min(best, dist(o.x, o.y, x, y));
    return best;
  }

  // ------------------------------------------------------------ police
  function syncPolice() {
    const wantCars = state.wanted === 0 ? 0 : Math.min(state.wanted, 4);
    const wantOfficers = state.wanted === 0 ? 0 : Math.min(state.wanted, 4);
    const p = state.player;
    while (state.police.cars.length < wantCars) {
      state.police.cars.push(spawnPoliceCarNear(p.x, p.y, 480));
    }
    while (state.police.cars.length > wantCars) state.police.cars.pop();
    while (state.police.officers.length < wantOfficers) {
      state.police.officers.push(spawnOfficerNear(p.x, p.y));
    }
    while (state.police.officers.length > wantOfficers) state.police.officers.pop();
  }
  function updatePolice(dt) {
    const p = state.player;
    const targetCar = p.inCar;
    const tx = targetCar ? targetCar.x : p.x;
    const ty = targetCar ? targetCar.y : p.y;
    // Police cars chase and ram.
    for (const car of state.police.cars) {
      if (car.wrecked) continue;
      const want = Math.atan2(ty - car.y, tx - car.x);
      const diff = angleDiff(want, car.angle);
      car.angle = normalizeAngle(car.angle + clamp(diff, -2.8 * dt, 2.8 * dt));
      const d = dist(car.x, car.y, tx, ty);
      const cruise = d > 260 ? POLICE_SPEED : POLICE_SPEED * 0.55;
      car.speed += (cruise - car.speed) * Math.min(1, dt * 1.6);
      const vx = Math.cos(car.angle) * car.speed;
      const vy = Math.sin(car.angle) * car.speed;
      car.x += vx * dt;
      car.y += vy * dt;
      car.x = clamp(car.x, 30, W - 30);
      car.y = clamp(car.y, 30, H - 30);
      resolveCircleColliders(car, 16, vx, vy, colliders);
      // Ram the player's car.
      if (targetCar && !targetCar.wrecked && dist(car.x, car.y, targetCar.x, targetCar.y) < 52) {
        if (!car._ramCd || car._ramCd <= 0) {
          damageCar(targetCar, POLICE_RAM_DAMAGE, {});
          targetCar.speed *= 0.7;
          car.speed *= 0.6;
          car._ramCd = 1.0;
          safeSfx('crash');
          witnessCrime(2, targetCar.x, targetCar.y);
        }
      }
      if (car._ramCd > 0) car._ramCd -= dt;
      // A police car that gets too far away is repositioned closer (keeps the chase hot).
      if (d > 1400) {
        const fresh = spawnPoliceCarNear(tx, ty, 600);
        car.x = fresh.x; car.y = fresh.y; car.angle = fresh.angle;
      }
    }
    // Officers chase on foot; on foot they punch and build the bust meter.
    const onFoot = !targetCar;
    for (const o of state.police.officers) {
      const d = dist(o.x, o.y, p.x, p.y);
      const want = Math.atan2(p.y - o.y, p.x - o.x);
      o.angle = want;
      const spd = onFoot ? 205 : 235;
      if (d > 34) {
        o.x += Math.cos(want) * spd * dt;
        o.y += Math.sin(want) * spd * dt;
        resolveCircleColliders(o, 12, Math.cos(want) * spd, Math.sin(want) * spd, colliders);
      }
      o.punchCd -= dt;
      if (onFoot && d < 40) {
        state.police.bust = clamp(state.police.bust + dt / 1.2, 0, 1);
        if (o.punchCd <= 0) {
          damagePlayer(6);
          o.punchCd = 0.9;
          safeSfx('punch');
        }
        if (state.police.bust >= 1) { doBusted(); return; }
      } else if (onFoot && d < 90 && o.punchCd <= 0) {
        damagePlayer(4);
        o.punchCd = 0.9;
      }
      if (d > 1200) {
        const fresh = spawnOfficerNear(p.x, p.y);
        o.x = fresh.x; o.y = fresh.y;
      }
    }
    if (!onFoot || state.police.officers.length === 0) {
      state.police.bust = Math.max(0, state.police.bust - dt * 0.8);
    }
    // Sirens while any police car is active.
    state._sirenT -= dt;
    if (state.police.cars.length > 0 && state._sirenT <= 0) {
      safeSfx('siren');
      state._sirenT = 2.4;
    }
  }
  function updateWanted(dt) {
    if (state.wanted === 0) { state._outOfSight = 0; return; }
    // Does any police unit currently see the player?
    const seen = policeCanSee(state.player.x, state.player.y);
    if (seen) { state._outOfSight = 0; return; }
    state._outOfSight += dt;
    // Decay: ~8s out of sight at 1 star, slower at higher stars.
    const interval = 6 + state.wanted * 2;
    if (state._outOfSight >= interval) {
      state.wanted = Math.max(0, state.wanted - 1);
      state._outOfSight = 0;
      state.police.bust = 0;
      syncPolice();
    }
  }

  // ------------------------------------------------------------ busted / wasted
  function respawnPlayer(hp) {
    state.player.x = spawn.x;
    state.player.y = spawn.y;
    state.player.angle = -Math.PI / 2;
    state.player.health = hp;
    state.player.inCar = null;
    state.camera.x = spawn.x;
    state.camera.y = spawn.y;
    state.police.bust = 0;
  }
  function doBusted() {
    if (state.screen !== 'playing') return;
    // Getting arrested during Heat fails the job: without this, the bust
    // resets wanted to 0 below and updateMissions would complete Heat
    // for free. Other missions survive a bust (Mama Rosa bails you out).
    if (state.missions.active === 4) failMission(4, 'you got arrested — the heat won.');
    const loss = Math.max(BUSTED_CASH_MIN, Math.floor(state.cash * BUSTED_CASH_FRACTION));
    state.cashLost = loss;
    state.cash = Math.max(0, state.cash - loss);
    state._deathKind = 'busted';
    state.screen = 'busted';
    state.wanted = 0;
    state.police.cars = [];
    state.police.officers = [];
    state.missions.brief = 'Busted! The cops took $' + loss + '. Mama Rosa bailed you out — get back to work.';
    safeSfx('busted');
  }
  function doWasted() {
    if (state.screen !== 'playing') return;
    const loss = Math.floor(state.cash * WASTED_CASH_FRACTION);
    state.cashLost = loss;
    state.cash = Math.max(0, state.cash - loss);
    state._deathKind = 'wasted';
    state.screen = 'wasted';
    state.wanted = Math.max(0, Math.floor(state.wanted / 2));
    state.police.cars = [];
    state.police.officers = [];
    state.missions.brief = 'Wasted! You lost $' + loss + '. You wake up patched up — keep the job going.';
    safeSfx('wasted');
  }
  function continueAfterDeath() {
    if (state._deathKind === 'busted') respawnPlayer(50);
    else respawnPlayer(PLAYER_MAX_HEALTH);
    state._deathKind = null;
    state.screen = 'playing';
    syncPolice();
  }

  // ------------------------------------------------------------ player: on foot
  function updatePlayerOnFoot(dt) {
    const p = state.player;
    let mx = 0;
    let my = 0;
    if (isDown('KeyW', 'ArrowUp')) my -= 1;
    if (isDown('KeyS', 'ArrowDown')) my += 1;
    if (isDown('KeyA', 'ArrowLeft')) mx -= 1;
    if (isDown('KeyD', 'ArrowRight')) mx += 1;
    const stick = readStick();
    mx += stick.x;
    my += stick.y;
    const len = Math.hypot(mx, my);
    if (len > 0.01) {
      const run = isDown('ShiftLeft', 'ShiftRight') || readTouchButton('run');
      const speed = run ? BRIEF_RUN_SPEED : PLAYER_WALK_SPEED;
      mx /= Math.max(1, len);
      my /= Math.max(1, len);
      p.angle = Math.atan2(my, mx);
      const vx = mx * speed;
      const vy = my * speed;
      p.x += vx * dt;
      p.y += vy * dt;
      p.x = clamp(p.x, 20, W - 20);
      p.y = clamp(p.y, 20, H - 20);
      resolveCircleColliders(p, PLAYER_RADIUS, vx, vy, colliders);
      state.speedKmh = Math.round(speed * 0.18);
    } else {
      state.speedKmh = 0;
    }
    // Attack: SPACE (or touch FIRE). Pistol if ammo remains, else punch.
    // (Cooldown is decremented once per frame in update(); not here.)
    const fireEdge = justPressed('Space') || (fireHeld && !prevFire);
    if (fireEdge && state._attackCd <= 0) {
      if (p.ammo > 0) shootPistol();
      else punchAttack();
    }
  }
  function facingConeTargets(range, halfAngle) {
    const p = state.player;
    const hits = [];
    const consider = (ent, kind) => {
      const d = dist(p.x, p.y, ent.x, ent.y);
      if (d > range) return;
      const want = Math.atan2(ent.y - p.y, ent.x - p.x);
      if (Math.abs(angleDiff(want, p.angle)) > halfAngle && d > 30) return;
      hits.push({ ent, kind, d });
    };
    for (const c of state.vehicles) if (!c.wrecked) consider(c, 'car');
    for (const c of state.traffic) if (!c.wrecked) consider(c, 'car');
    for (const c of state.police.cars) if (!c.wrecked) consider(c, 'policecar');
    for (const ped of state.pedestrians) if (!ped.down) consider(ped, 'ped');
    for (const o of state.police.officers) consider(o, 'officer');
    hits.sort((a, b) => a.d - b.d);
    return hits;
  }
  function shootPistol() {
    const p = state.player;
    p.ammo -= 1;
    state._attackCd = PLAYER_SHOT_COOLDOWN;
    state._shotT = state.elapsed;
    state._shotX = p.x;
    state._shotY = p.y;
    safeSfx('shot');
    const hits = facingConeTargets(PLAYER_SHOT_RANGE, 0.45);
    if (hits.length > 0) {
      const hit = hits[0];
      if (hit.kind === 'ped') {
        hit.ent.down = true;
        hit.ent.health = 0;
        scarePedestrians(p.x, p.y);
        witnessCrime(2, p.x, p.y);
      } else if (hit.kind === 'officer') {
        hit.ent.health -= PLAYER_SHOT_DAMAGE;
        if (hit.ent.health <= 0) {
          state.police.officers = state.police.officers.filter((o) => o !== hit.ent);
        }
        witnessCrime(2, p.x, p.y);
      } else {
        damageCar(hit.ent, PLAYER_SHOT_DAMAGE, {});
        witnessCrime(1, p.x, p.y);
      }
    } else {
      // A shot fired where police can see it is still a crime.
      witnessCrime(1, p.x, p.y);
    }
  }
  function punchAttack() {
    const p = state.player;
    state._attackCd = PLAYER_PUNCH_COOLDOWN;
    safeSfx('punch');
    const hits = facingConeTargets(PLAYER_PUNCH_RANGE + 14, 0.9);
    if (hits.length > 0) {
      const hit = hits[0];
      if (hit.kind === 'ped') {
        hit.ent.down = true;
        hit.ent.health = 0;
        scarePedestrians(p.x, p.y);
        witnessCrime(2, p.x, p.y);
      } else if (hit.kind === 'officer') {
        hit.ent.health -= PLAYER_PUNCH_DAMAGE;
        if (hit.ent.health <= 0) {
          state.police.officers = state.police.officers.filter((o) => o !== hit.ent);
        }
        witnessCrime(2, p.x, p.y);
      } else {
        damageCar(hit.ent, PLAYER_PUNCH_DAMAGE, {});
      }
    }
  }
  function scarePedestrians(x, y) {
    for (const ped of state.pedestrians) {
      if (ped.down) continue;
      if (dist(ped.x, ped.y, x, y) < 320) {
        ped.fleeX = x;
        ped.fleeY = y;
        ped.fleeUntil = state.elapsed + 2.5;
      }
    }
  }

  // ------------------------------------------------------------ player: in car
  function updatePlayerInCar(dt) {
    const p = state.player;
    const car = p.inCar;
    if (!car || car.wrecked) { p.inCar = null; return; }
    const t = CAR_TYPES[car.type] || CAR_TYPES.sedan;
    const maxSpeed = t.maxSpeed;
    let throttle = 0;
    if (isDown('KeyW', 'ArrowUp')) throttle = 1;
    if (isDown('KeyS', 'ArrowDown')) throttle = -1;
    const stick = readStick();
    if (Math.abs(stick.y) > 0.15) throttle = -stick.y;
    let steer = 0;
    if (isDown('KeyA', 'ArrowLeft')) steer -= 1;
    if (isDown('KeyD', 'ArrowRight')) steer += 1;
    steer += stick.x;
    steer = clamp(steer, -1, 1);
    const prevSpeed = car.speed;
    if (throttle > 0) car.speed += t.accel * throttle * dt;
    else if (throttle < 0) {
      if (car.speed > 20) car.speed -= CAR_BRAKE * dt; // braking
      else car.speed -= t.accel * 0.6 * dt; // reversing
    } else {
      // Drag / rolling resistance.
      car.speed -= car.speed * CAR_DRAG * dt;
      if (Math.abs(car.speed) < 4) car.speed = 0;
    }
    car.speed = clamp(car.speed, -CAR_REVERSE_SPEED, maxSpeed);
    // Steering scales with speed; slight drift at high speed.
    const steerAuthority = clamp(Math.abs(car.speed) / 120, 0, 1);
    car.angle = normalizeAngle(car.angle + steer * CAR_TURN_SPEED * steerAuthority * dt * Math.sign(car.speed || 1));
    const vx = Math.cos(car.angle) * car.speed;
    const vy = Math.sin(car.angle) * car.speed;
    car.x += vx * dt;
    car.y += vy * dt;
    car.x = clamp(car.x, 24, W - 24);
    car.y = clamp(car.y, 24, H - 24);
    // Two-circle car collision (front + back), r=16 each.
    const fx = car.x + Math.cos(car.angle) * 22;
    const fy = car.y + Math.sin(car.angle) * 22;
    const bx = car.x - Math.cos(car.angle) * 22;
    const by = car.y - Math.sin(car.angle) * 22;
    const front = { x: fx, y: fy };
    const back = { x: bx, y: by };
    const impactF = resolveCircleColliders(front, 16, vx, vy, colliders);
    const impactB = resolveCircleColliders(back, 16, vx, vy, colliders);
    const impact = Math.max(impactF, impactB);
    if (impact > 0) {
      // Re-centre the car body from the resolved circles.
      car.x = (front.x + back.x) / 2;
      car.y = (front.y + back.y) / 2;
      const speedLoss = Math.abs(prevSpeed) - Math.abs(car.speed);
      const hit = Math.max(impact, speedLoss);
      if (hit > 260) {
        // Only real impacts damage the car; scraping never grinds below 1 HP.
        damageCar(car, Math.min(14, (hit - 260) * 0.03), { scrape: true });
        if (hit > 340) safeSfx('crash');
      }
      car.speed *= 0.55;
    }
    // Car-vs-car circle collisions (player car vs traffic / parked / police).
    collideCarWithOthers(car, dt);
    // Running over a pedestrian is a crime if police can see it.
    for (const ped of state.pedestrians) {
      if (ped.down) continue;
      if (dist(car.x, car.y, ped.x, ped.y) < 34 && Math.abs(car.speed) > 60) {
        ped.down = true;
        ped.health = 0;
        scarePedestrians(car.x, car.y);
        witnessCrime(2, car.x, car.y);
        safeSfx('thud');
      }
    }
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    state.speedKmh = Math.round(Math.abs(car.speed) * 0.22);
    safeEngine();
  }
  function collideCarWithOthers(car, dt) {
    const others = [...state.vehicles, ...state.traffic, ...state.police.cars];
    for (const o of others) {
      if (o === car || o.wrecked) continue;
      const d = dist(car.x, car.y, o.x, o.y);
      if (d < 44 && d > 0.01) {
        const nx = (o.x - car.x) / d;
        const ny = (o.y - car.y) / d;
        const overlap = 44 - d;
        const push = overlap * 0.5;
        o.x += nx * push;
        o.y += ny * push;
        car.x -= nx * push;
        car.y -= ny * push;
        const relSpeed = Math.abs(car.speed - (o.speed || 0));
        if (relSpeed > 200) {
          damageCar(car, Math.min(10, (relSpeed - 200) * 0.02), {});
          damageCar(o, Math.min(10, (relSpeed - 200) * 0.02), {});
          if (o.driver === 'police' || car.driver === 'police') witnessCrime(2, car.x, car.y);
          safeSfx('crash');
        }
        // Nudge the other car so traffic does not sit glued to the player.
        if (o.driver === 'traffic') o.speed *= 0.6;
      }
    }
  }

  // ------------------------------------------------------------ enter / exit car
  function nearestEnterableCar() {
    const p = state.player;
    let best = null;
    let bestD = ENTER_CAR_RANGE;
    for (const c of state.vehicles) {
      if (c.wrecked) continue;
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    for (const c of state.traffic) {
      if (c.wrecked) continue;
      const d = dist(p.x, p.y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  function enterCar(car) {
    const p = state.player;
    if (!car || car.wrecked) return;
    // Stealing a traffic car while police watch is a crime; parked cars are free.
    // witnessCrime itself checks police line of sight, so one call covers it.
    if (car.driver === 'traffic') {
      state.traffic = state.traffic.filter((c) => c !== car);
      state.vehicles.push(car);
      car.driver = 'player';
      witnessCrime(1, p.x, p.y);
    }
    p.inCar = car;
    car.driver = 'player';
    safeSfx('door');
  }
  function exitCar() {
    const p = state.player;
    const car = p.inCar;
    if (!car) return;
    p.inCar = null;
    const side = { x: p.x - Math.sin(car.angle) * 34, y: p.y + Math.cos(car.angle) * 34 };
    const spot = freeSpotNear(side.x, side.y, 10);
    p.x = spot.x;
    p.y = spot.y;
    p.angle = car.angle;
    safeSfx('door');
  }

  // ------------------------------------------------------------ traffic
  function updateTraffic(dt) {
    const p = state.player;
    for (let i = state.traffic.length - 1; i >= 0; i--) {
      const c = state.traffic[i];
      if (c.wrecked) continue;
      // Despawn far away, respawn near the player.
      if (dist(c.x, c.y, p.x, p.y) > 1500) {
        state.traffic[i] = spawnTrafficCarNearPlayer();
        continue;
      }
      // Slow for a stopped car ahead in the same lane.
      let target = c.cruise || TRAFFIC_SPEED;
      for (const o of state.traffic) {
        if (o === c || o.wrecked || o.road !== c.road || o.line !== c.line || o.dir !== c.dir) continue;
        const ahead = c.road === 'h' ? (o.x - c.x) * c.dir : (o.y - c.y) * c.dir;
        if (ahead > 0 && ahead < 70) { target = 0; break; }
        if (ahead > 0 && ahead < 130) { target = Math.min(target, TRAFFIC_SPEED * 0.4); break; }
      }
      // Slow for the player's car stopped ahead.
      if (p.inCar && p.inCar.road === undefined) {
        const pc = p.inCar;
        const sameLane = c.road === 'h'
          ? Math.abs(pc.y - c.line) < 26
          : Math.abs(pc.x - c.line) < 26;
        if (sameLane) {
          const ahead = c.road === 'h' ? (pc.x - c.x) * c.dir : (pc.y - c.y) * c.dir;
          if (ahead > 0 && ahead < 80) target = 0;
        }
      }
      c.speed += (target - c.speed) * Math.min(1, dt * 1.5);
      if (c.road === 'h') {
        c.x += c.dir * c.speed * dt;
        c.angle = c.dir > 0 ? 0 : Math.PI;
        const road = hLines.find((r) => r.line === c.line);
        const minX = road ? road.min : 60;
        const maxX = road ? road.max : W - 60;
        if (c.x < minX || c.x > maxX) turnTrafficCar(c);
      } else {
        c.y += c.dir * c.speed * dt;
        c.angle = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        const road = vLines.find((r) => r.line === c.line);
        const minY = road ? road.min : 60;
        const maxY = road ? road.max : H - 60;
        if (c.y < minY || c.y > maxY) turnTrafficCar(c);
      }
    }
    // Top the traffic back up to ~10 cars.
    while (state.traffic.length < 10) state.traffic.push(spawnTrafficCarNearPlayer());
  }
  function turnTrafficCar(c) {
    // At a road end, turn onto a crossing road (or reverse if none is near).
    if (c.road === 'h') {
      let best = null;
      let bestD = Infinity;
      for (const r of vLines) {
        const d = Math.abs(r.line - c.x);
        if (d < bestD) { bestD = d; best = r; }
      }
      if (best && bestD < 420) {
        c.road = 'v';
        c.line = best.line;
        c.x = best.line + (rng.chance(0.5) ? -14 : 14);
        c.dir = rng.chance(0.5) ? 1 : -1;
      } else {
        c.dir *= -1;
        c.x = clamp(c.x, 70, W - 70);
      }
    } else {
      let best = null;
      let bestD = Infinity;
      for (const r of hLines) {
        const d = Math.abs(r.line - c.y);
        if (d < bestD) { bestD = d; best = r; }
      }
      if (best && bestD < 420) {
        c.road = 'h';
        c.line = best.line;
        c.y = best.line + (rng.chance(0.5) ? -14 : 14);
        c.dir = rng.chance(0.5) ? 1 : -1;
      } else {
        c.dir *= -1;
        c.y = clamp(c.y, 70, H - 70);
      }
    }
  }
  function spawnTrafficCarNearPlayer() {
    const p = state.player;
    for (let tries = 0; tries < 12; tries++) {
      const car = spawnTrafficCar();
      if (dist(car.x, car.y, p.x, p.y) < 1100 && dist(car.x, car.y, p.x, p.y) > 320) return car;
    }
    return spawnTrafficCar();
  }

  // ------------------------------------------------------------ pedestrians
  function updatePedestrians(dt) {
    for (const ped of state.pedestrians) {
      if (ped.down) continue;
      const fleeing = state.elapsed < ped.fleeUntil;
      if (fleeing) {
        const away = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
        ped.angle = away;
        ped.x += Math.cos(away) * 185 * dt;
        ped.y += Math.sin(away) * 185 * dt;
      } else {
        const d = dist(ped.x, ped.y, ped.tx, ped.ty);
        if (d < 12) {
          const spot = nearestRoadPoint(
            clamp(ped.x + rng.range(-420, 420), 80, W - 80),
            clamp(ped.y + rng.range(-420, 420), 80, H - 80));
          ped.tx = spot.x;
          ped.ty = spot.y;
        } else {
          const want = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
          ped.angle = want;
          ped.x += Math.cos(want) * 62 * dt;
          ped.y += Math.sin(want) * 62 * dt;
        }
      }
      ped.x = clamp(ped.x, 20, W - 20);
      ped.y = clamp(ped.y, 20, H - 20);
      resolveCircleColliders(ped, 12, 0, 0, colliders);
    }
    // Keep ~12 walkers around.
    let alive = 0;
    for (const ped of state.pedestrians) if (!ped.down) alive++;
    if (alive < 10) {
      for (let i = 0; i < state.pedestrians.length && alive < 12; i++) {
        if (state.pedestrians[i].down && dist(state.pedestrians[i].x, state.pedestrians[i].y, state.player.x, state.player.y) > 700) {
          state.pedestrians[i] = spawnPedestrian();
          alive++;
        }
      }
    }
  }

  // ------------------------------------------------------------ shops
  function nearestShop() {
    const p = state.player;
    let best = null;
    let bestD = SHOP_RANGE;
    for (const s of shops) {
      const d = dist(p.x, p.y, s.x, s.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }
  function shopOffer(shop) {
    if (!shop) return null;
    if (shop.kind === 'repair') return { kind: 'repair', label: 'Repair $' + PRICES.repair, price: PRICES.repair };
    if (shop.kind === 'ammo') return { kind: 'ammo', label: 'Ammo +24  $' + PRICES.ammo, price: PRICES.ammo };
    if (shop.kind === 'snack') return { kind: 'snack', label: 'Snack +30 HP  $' + PRICES.snack, price: PRICES.snack };
    // A generic shop sells what the player needs most right now.
    if (state.player.inCar) return { kind: 'repair', label: 'Repair $' + PRICES.repair, price: PRICES.repair };
    if (state.player.ammo < 12) return { kind: 'ammo', label: 'Ammo +24  $' + PRICES.ammo, price: PRICES.ammo };
    return { kind: 'snack', label: 'Snack +30 HP  $' + PRICES.snack, price: PRICES.snack };
  }
  function canBuyFromShop(offer) {
    if (!offer) return false;
    // Only intercept E for a purchase that would actually happen — otherwise
    // E must still exit the car (a full-health car at a repair shop, or a
    // snack shop while driving, must never trap the player in the car).
    if (offer.kind === 'repair') return !!state.player.inCar && state.player.inCar.health < CAR_MAX_HEALTH;
    if (offer.kind === 'snack') return state.player.health < PLAYER_MAX_HEALTH;
    return true; // ammo is always buyable
  }
  function buyFromShop(offer) {
    if (!offer || state.cash < offer.price) { safeSfx('denied'); return false; }
    if (offer.kind === 'repair' && !state.player.inCar) return false;
    if (offer.kind === 'repair' && state.player.inCar.health >= CAR_MAX_HEALTH) return false;
    if (offer.kind === 'snack' && state.player.health >= PLAYER_MAX_HEALTH) return false;
    state.cash -= offer.price;
    if (offer.kind === 'repair') state.player.inCar.health = CAR_MAX_HEALTH;
    if (offer.kind === 'ammo') state.player.ammo += AMMO_PACK;
    if (offer.kind === 'snack') state.player.health = Math.min(PLAYER_MAX_HEALTH, state.player.health + SNACK_HEAL);
    safeSfx('buy');
    return true;
  }

  // ------------------------------------------------------------ missions
  function nextUncompletedMission() {
    for (let i = 0; i < 5; i++) {
      if (state.missions.unlocked[i] && !state.missions.completed[i]) return i + 1;
    }
    return 0;
  }
  function startMission(n) {
    if (n < 1 || n > 5) return false;
    if (!state.missions.unlocked[n - 1]) return false;
    if (state.missions.completed[n - 1]) return false;
    const m = state.missions;
    const def = MISSION_DEFS[n - 1];
    m.active = n;
    m.progress = 0;
    m.timeLimit = def.timeLimit;
    m.timer = def.timeLimit;
    m.brief = def.brief;
    m.targetCarId = null;
    m.packages = [];
    const s = citySpawn();
    if (n === 1) {
      const fare = nearestRoadPoint(s.x + 560, s.y - 260);
      const drop = nearestRoadPoint(downtown.x, downtown.y);
      m.fareX = fare.x; m.fareY = fare.y;
      m.dropX = drop.x; m.dropY = drop.y;
      m.phase = 'pickup';
      m.text = 'Pick up the fare — follow the marker.';
      m.waypoint = { x: fare.x, y: fare.y, label: 'Fare pickup' };
    } else if (n === 2) {
      const spot = nearestRoadPoint(s.x - 620, s.y + 380);
      const car = makeCar('sport', spot.x, spot.y, 0);
      car.driver = null;
      state.vehicles.push(car);
      m.targetCarId = car.id;
      m.phase = 'steal';
      m.text = 'Steal the yellow sportscar, then deliver it to the garage.';
      m.waypoint = { x: spot.x, y: spot.y, label: 'Target car' };
    } else if (n === 3) {
      const pts = [
        nearestRoadPoint(W * 0.22, H * 0.28),
        nearestRoadPoint(W * 0.78, H * 0.62),
        nearestRoadPoint(W * 0.5, H * 0.82),
      ];
      m.packages = pts.map((pt) => ({ x: pt.x, y: pt.y, taken: false }));
      m.dropX = garage.x; m.dropY = garage.y;
      m.phase = 'collect';
      m.text = 'Collect the 3 packages (0/3).';
      m.waypoint = { x: pts[0].x, y: pts[0].y, label: 'Package 1/3' };
    } else if (n === 4) {
      m.phase = 'evade';
      m.text = 'Lose the 3-star wanted level before time runs out!';
      m.waypoint = null;
      state.wanted = 3;
      state._outOfSight = 0;
      syncPolice();
    } else if (n === 5) {
      const zone = nearestRoadPoint(bank.x + 90, bank.y + 60);
      m.phase = 'drive';
      m.text = 'Drive to the bank and park in the marked zone.';
      m.waypoint = { x: zone.x, y: zone.y, label: 'Bank — park here' };
      m.dropX = bank.x; m.dropY = bank.y;
    }
    safeSfx('mission');
    return true;
  }
  function completeMission(n) {
    const m = state.missions;
    const def = MISSION_DEFS[n - 1];
    state.cash += def.reward;
    state.rep += 10 + n * 5;
    m.completed[n - 1] = true;
    if (n < 5) m.unlocked[n] = true;
    m.active = null;
    m.phase = '';
    m.progress = 1;
    m.timer = 0;
    m.timeLimit = 0;
    m.waypoint = null;
    m.brief = def.name + ' complete! +$' + def.reward +
      (n < 5 ? ' — next job unlocked: ' + MISSION_DEFS[n].name + '.' : ' — the Solmara Job is done. You run this city now.');
    m.text = n < 5
      ? 'Job done. Next: ' + MISSION_DEFS[n].name + ' — press ENTER to start it.'
      : 'All jobs complete. Solmara is yours — free roam!';
    if (state.cash > state._bestCash) {
      state._bestCash = state.cash;
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(BEST_CASH_KEY, String(state._bestCash)); } catch (e) { /* ignore */ }
    }
    safeSfx('complete');
    saveGame(); // auto-save on mission complete
  }
  function failMission(n, reason) {
    const m = state.missions;
    const def = MISSION_DEFS[n - 1];
    m.active = null;
    m.phase = '';
    m.progress = 0;
    m.timer = 0;
    m.timeLimit = 0;
    m.waypoint = null;
    m.brief = def.name + ' failed — ' + reason + ' You can retry it any time: press ENTER.';
    m.text = def.name + ' failed. Press ENTER to retry.';
    if (n === 4) {
      // Failing Heat never strands the player at 3 stars forever; the heat
      // stays as-is in free play and decays normally out of sight.
    }
    safeSfx('fail');
  }
  function updateMissions(dt) {
    const m = state.missions;
    if (!m.active) return;
    const n = m.active;
    const p = state.player;
    // Mission timer: expiry fails the mission (and always returns to free play).
    if (m.timeLimit > 0) {
      m.timer -= dt;
      if (m.timer <= 0) {
        m.timer = 0;
        failMission(n, 'time ran out.');
        return;
      }
    }
    if (n === 1) {
      if (m.phase === 'pickup') {
        m.waypoint = { x: m.fareX, y: m.fareY, label: 'Fare pickup' };
        if (dist(p.x, p.y, m.fareX, m.fareY) < 55) {
          m.phase = 'dropoff';
          m.progress = 0.5;
          m.text = 'Passenger aboard — drop them downtown.';
          safeSfx('pickup');
        }
      } else if (m.phase === 'dropoff') {
        m.waypoint = { x: m.dropX, y: m.dropY, label: 'Drop-off' };
        if (dist(p.x, p.y, m.dropX, m.dropY) < 60) completeMission(1);
      }
    } else if (n === 2) {
      const target = state.vehicles.find((c) => c.id === m.targetCarId);
      if (!target) { failMission(2, 'the target car is gone.'); return; }
      if (m.phase === 'steal') {
        m.waypoint = { x: target.x, y: target.y, label: 'Target car' };
        if (p.inCar === target) {
          m.phase = 'deliver';
          m.progress = 0.5;
          m.text = 'You have the car — deliver it to the garage.';
          safeSfx('pickup');
        }
      } else if (m.phase === 'deliver') {
        m.waypoint = { x: garage.x, y: garage.y, label: 'Garage' };
        if (p.inCar === target && dist(target.x, target.y, garage.x, garage.y) < 70) {
          completeMission(2);
        }
      }
    } else if (n === 3) {
      const remaining = m.packages.filter((pk) => !pk.taken);
      for (const pk of m.packages) {
        if (!pk.taken && dist(p.x, p.y, pk.x, pk.y) < 42) {
          pk.taken = true;
          m.progress = m.packages.filter((q) => q.taken).length / m.packages.length;
          safeSfx('pickup');
        }
      }
      if (remaining.length === 0 || m.packages.every((pk) => pk.taken)) {
        m.phase = 'deliver';
        m.text = 'All packages collected — deliver them to the garage.';
        m.waypoint = { x: garage.x, y: garage.y, label: 'Garage' };
        if (dist(p.x, p.y, garage.x, garage.y) < 70) completeMission(3);
      } else {
        const next = m.packages.find((pk) => !pk.taken);
        const got = m.packages.filter((pk) => pk.taken).length;
        m.phase = 'collect';
        m.text = 'Collect the 3 packages (' + got + '/3).';
        m.waypoint = { x: next.x, y: next.y, label: 'Package ' + (got + 1) + '/3' };
      }
    } else if (n === 4) {
      m.phase = 'evade';
      m.text = 'Lose the wanted level! Stars: ' + state.wanted + ' — ' + Math.ceil(m.timer) + 's left.';
      m.waypoint = null;
      m.progress = 1 - state.wanted / 3;
      if (state.wanted === 0) completeMission(4);
    } else if (n === 5) {
      if (m.phase === 'drive') {
        const zone = m.waypoint || { x: bank.x, y: bank.y };
        if (p.inCar && dist(p.x, p.y, zone.x, zone.y) < 80) {
          m.phase = 'parked';
          m.progress = 0.5;
          m.text = 'Parked. Get out and walk to the bank door.';
        }
      } else if (m.phase === 'parked') {
        if (!p.inCar) {
          m.phase = 'heist';
          m.text = 'Walk to the bank door and press SPACE to grab the cash.';
        }
        m.waypoint = { x: bank.x, y: bank.y, label: 'Bank door' };
      } else if (m.phase === 'heist') {
        m.waypoint = { x: bank.x, y: bank.y, label: 'Bank door' };
        const nearDoor = dist(p.x, p.y, bank.x, bank.y) < 55;
        if (nearDoor && !p.inCar) {
          state.prompt = 'SPACE - Grab the cash';
          if (justPressed('Space') || (fireHeld && !prevFire)) {
            m.progress = 1;
            state.wanted = 3;
            state._outOfSight = 0;
            syncPolice();
            completeMission(5);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ clock / camera
  function updateClock(dt) {
    state.minutes += dt * DAY_MINUTES_PER_SECOND;
    if (state.minutes >= 1440) {
      state.minutes -= 1440;
      state.day += 1;
    }
  }
  function updateCamera(dt) {
    const p = state.player;
    const tx = clamp(p.x, state.viewW / 2, W - state.viewW / 2);
    const ty = clamp(p.y, state.viewH / 2, H - state.viewH / 2);
    const k = Math.min(1, CAMERA_LERP * dt);
    state.camera.x += (tx - state.camera.x) * k;
    state.camera.y += (ty - state.camera.y) * k;
    // Keep the camera inside the city even on small viewports.
    state.camera.x = clamp(state.camera.x, 0, W);
    state.camera.y = clamp(state.camera.y, 0, H);
  }

  // ------------------------------------------------------------ save / load
  function saveGame() {
    // NEVER overwrite a live save with a dead state (v1 death-loop bug).
    if (state.screen !== 'playing') return false;
    if (state.player.health <= 0) return false;
    if (state._deathKind) return false;
    try {
      if (typeof localStorage === 'undefined') return false;
      const data = {
        version: SAVE_VERSION,
        cash: state.cash,
        rep: state.rep,
        unlocked: [...state.missions.unlocked],
        completed: [...state.missions.completed],
        player: {
          x: Math.round(state.player.x),
          y: Math.round(state.player.y),
          health: state.player.health,
          ammo: state.player.ammo,
        },
        day: state.day,
        minutes: Math.round(state.minutes),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      state.__hasSave = true;
      return true;
    } catch (e) { return false; }
  }
  function loadGame() {
    try {
      if (typeof localStorage === 'undefined') return false;
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.version !== SAVE_VERSION) return false;
      state.cash = data.cash;
      state.rep = data.rep;
      state.missions.unlocked = [...data.unlocked];
      state.missions.completed = [...data.completed];
      state.player.x = data.player.x;
      state.player.y = data.player.y;
      state.player.health = data.player.health;
      state.player.ammo = data.player.ammo;
      state.player.inCar = null;
      state.day = data.day;
      state.minutes = data.minutes;
      state.missions.text = state.missions.completed.every(Boolean)
        ? 'All jobs complete. Solmara is yours — free roam!'
        : 'Press ENTER to start your next job for Mama Rosa.';
      state.camera.x = data.player.x;
      state.camera.y = data.player.y;
      state.screen = 'playing';
      state.wanted = 0;
      state.police.cars = [];
      state.police.officers = [];
      state.police.bust = 0;
      state.__hasSave = true;
      return true;
    } catch (e) { return false; }
  }
  function clearSave() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* ignore */ }
    state.__hasSave = false;
  }
  function hasSave() {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch (e) { return false; }
  }

  // ------------------------------------------------------------ main update
  function update(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    keys = readKeys();
    fireHeld = isDown('Space') || readTouchButton('fire');
    actHeld = isDown('KeyE') || readTouchButton('act');
    clickHeld = readClicked();

    // Global toggles.
    if (justPressed('KeyM')) {
      state.settings.muted = !state.settings.muted;
      try { if (audio && typeof audio.setMuted === 'function') audio.setMuted(state.settings.muted); } catch (e) { /* ignore */ }
    }
    if (justPressed('KeyQ')) {
      state.settings.quality = state.settings.quality === 'high' ? 'low' : 'high';
    }

    if (state.screen === 'title') {
      // Keys 1-5 start an unlocked mission; ENTER starts/resumes the next one.
      if (justPressed('KeyC') && loadGame()) { snapshotInput(); return; }
      for (let n = 1; n <= 5; n++) {
        if (justPressed('Digit' + n)) {
          state.screen = 'playing';
          loadGame(); // resume saved progress first (no-op without a save)
          if (!startMission(n)) {
            const next = nextUncompletedMission();
            if (next) startMission(next);
          }
          snapshotInput();
          return;
        }
      }
      if (justPressed('Enter') || (clickHeld && !prevClick)) {
        state.screen = 'playing';
        loadGame(); // resume saved progress first (no-op without a save)
        const next = nextUncompletedMission();
        if (next) startMission(next);
        snapshotInput();
        return;
      }
      snapshotInput();
      return;
    }

    if (state.screen === 'paused') {
      if (justPressed('KeyP', 'Escape', 'Enter') || (clickHeld && !prevClick)) {
        state.screen = 'playing';
      }
      snapshotInput();
      return;
    }

    if (state.screen === 'busted' || state.screen === 'wasted') {
      // Any key or click continues — these screens must never soft-lock.
      if (anyKeyPressed() || (clickHeld && !prevClick)) {
        continueAfterDeath();
      }
      snapshotInput();
      return;
    }

    if (state.screen !== 'playing') { snapshotInput(); return; }

    if (justPressed('Enter') && !state.missions.active) {
      const next = nextUncompletedMission();
      if (next) startMission(next);
    }

    // Pause.
    if (justPressed('KeyP', 'Escape')) {
      state.screen = 'paused';
      snapshotInput();
      return;
    }

    state.elapsed += dt;
    state._attackCd = Math.max(0, state._attackCd - dt);
    state._enterCd = Math.max(0, state._enterCd - dt);
    updateClock(dt);

    // E: shop purchase first (only when it would actually buy, and only a
    // repair while driving), then enter/exit car.
    const actEdge = (actHeld && !prevAct);
    const shop = nearestShop();
    const offer = shopOffer(shop);
    const inCar = !!state.player.inCar;
    const shopBuys = shop && offer && canBuyFromShop(offer) && (!inCar || offer.kind === 'repair');
    if (actEdge && shopBuys) {
      buyFromShop(offer);
    } else if (actEdge && state._enterCd <= 0) {
      if (state.player.inCar) exitCar();
      else {
        const car = nearestEnterableCar();
        if (car) enterCar(car);
      }
      state._enterCd = 0.25;
    }

    if (state.player.inCar) updatePlayerInCar(dt);
    else updatePlayerOnFoot(dt);

    // Prompt: shop offer wins, then car entry, then mission-5 grab (set in missions).
    if (state.screen === 'playing') {
      if (shop && offer) {
        state.prompt = 'E - ' + offer.label;
      } else if (!state.player.inCar && nearestEnterableCar()) {
        state.prompt = 'E - Get in car';
      } else if (state.missions.active !== 5) {
        state.prompt = null;
      }
      if (state.player.inCar && state.player.inCar.wrecked) {
        state.prompt = 'Your car is wrecked — press E to get out.';
      }
    }

    updateTraffic(dt);
    updatePedestrians(dt);
    updateWanted(dt);
    updatePolice(dt);
    updateMissions(dt);
    updateCamera(dt);

    // Police sync on a slow tick so counts track the wanted level.
    state._policeSyncT -= dt;
    if (state._policeSyncT <= 0) {
      syncPolice();
      state._policeSyncT = 0.5;
    }

    snapshotInput();
  }

  // ------------------------------------------------------------ public API
  function startGame() {
    state.screen = 'playing';
    const next = nextUncompletedMission();
    if (next && !state.missions.active) startMission(next);
  }
  function pauseGame() { if (state.screen === 'playing') state.screen = 'paused'; }
  function resumeGame() { if (state.screen === 'paused') state.screen = 'playing'; }
  function setQuality(q) {
    state.settings.quality = q === 'low' ? 'low' : 'high';
  }
  function toggleMute() {
    state.settings.muted = !state.settings.muted;
    try { if (audio && typeof audio.setMuted === 'function') audio.setMuted(state.settings.muted); } catch (e) { /* ignore */ }
    return state.settings.muted;
  }
  function warp(x, y) {
    state.player.inCar = null;
    state.player.x = clamp(x, 20, W - 20);
    state.player.y = clamp(y, 20, H - 20);
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    state.prompt = null;
  }
  function setClock(min) {
    state.minutes = ((min % 1440) + 1440) % 1440;
  }
  function setWanted(n) {
    state.wanted = clamp(Math.round(n) || 0, 0, WANTED_MAX);
    state._outOfSight = 0;
    state.police.bust = 0;
    syncPolice();
  }
  function spawnPolice(n) {
    const count = Math.max(0, Math.round(n) || 0);
    for (let i = 0; i < count; i++) {
      state.police.cars.push(spawnPoliceCarNear(state.player.x, state.player.y, 420));
    }
    if (count > 0 && state.wanted === 0) state.wanted = 1;
  }
  function giveCar() {
    // QA/debug helper: spawn a sedan next to the player AND seat them in it,
    // so a scripted playthrough can drive immediately (no E press needed).
    if (state.player.inCar) exitCar();
    const spot = freeSpotNear(state.player.x + 70, state.player.y, 30);
    const car = makeCar('sedan', spot.x, spot.y, state.player.angle);
    state.vehicles.push(car);
    enterCar(car);
    return car;
  }

  state.update = update;
  state.startGame = startGame;
  state.startMission = startMission;
  state.pauseGame = pauseGame;
  state.resumeGame = resumeGame;
  state.saveGame = saveGame;
  state.loadGame = loadGame;
  state.clearSave = clearSave;
  state.hasSave = hasSave;
  state.setQuality = setQuality;
  state.toggleMute = toggleMute;
  state.warp = warp;
  state.setClock = setClock;
  state.setWanted = setWanted;
  state.spawnPolice = spawnPolice;
  state.giveCar = giveCar;

  return state;
}

Sol.createGame = createGame;
if (typeof globalThis !== 'undefined') {
  globalThis.Sol = globalThis.Sol || {};
  globalThis.Sol.createGame = createGame;
}

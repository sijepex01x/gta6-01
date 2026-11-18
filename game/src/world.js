// Solmara — world.js
// Procedural city generation. Deterministic: buildWorld(seed) always returns
// the same city for the same seed (seeded RNG only, fixed call order).
// City: 3936x2800 px, road grid, downtown / harbour / park / beach / suburbs.
// Parked cars sit with their inner edge 38 px from the road centreline —
// clear of the through driving lanes (which occupy the inner +/-30 px).
import { createRng } from './random.js';
import { WORLD_W, WORLD_H } from './config.js';

const Sol = window.Sol = window.Sol || {};

// --- layout constants -------------------------------------------------------
const ROAD_W = 84; // asphalt width
const LANE_HALF = 30; // through driving lanes occupy +/-30 px of centreline
const PARK_CLEAR = 38; // parked-car inner edge offset from road centreline
const SIDE_W = 26; // sidewalk strip width alongside each road
const BLOCK_INSET = 34; // building setback from a block edge
const VX = [240, 624, 1008, 1392, 1776, 2160, 2544, 2928, 3312, 3696];
const HY = [240, 624, 1008, 1392, 1776, 2160, 2544];

const TOWER_COLORS = ['#6b7c93', '#7d8ea6', '#5d6f84', '#8a97a8', '#4e5f73', '#7488a0'];
const HOUSE_COLORS = ['#a8876b', '#b59a7d', '#96795c', '#c2a586', '#8a7a68'];
const WARE_COLORS = ['#7a6a55', '#8c7a62', '#6b5f4c', '#9a8871'];
const KIOSK_COLORS = ['#7a9a6a', '#9a7a5a'];
const CAR_COLORS = ['#c23b3b', '#3b6fc2', '#e8e8e8', '#2b2b2b', '#c2a23b', '#4a9a5a', '#7a4ac2'];

function overlaps(ax, ay, aw, ah, bx, by, bw, bh, pad) {
  return ax - pad < bx + bw && ax + aw + pad > bx && ay - pad < by + bh && ay + ah + pad > by;
}

function pointInRoads(x, y, roads) {
  for (let i = 0; i < roads.length; i++) {
    const r = roads[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

export function buildWorld(seed) {
  const rng = createRng(seed === undefined ? 1337 : seed);

  // --- districts ------------------------------------------------------------
  const districts = [
    { name: 'Downtown', x: 1008, y: 624, w: 1920, h: 1152, kind: 'downtown' },
    { name: 'Harbour', x: 0, y: 1776, w: 1008, h: 1024, kind: 'harbour' },
    { name: 'Riverside Park', x: 1392, y: 1776, w: 1152, h: 768, kind: 'park' },
    { name: 'South Beach', x: 1008, y: 2600, w: 2928, h: 200, kind: 'beach' },
    { name: 'East Suburbs', x: 2928, y: 240, w: 1008, h: 2304, kind: 'suburbs' },
    { name: 'North Suburbs', x: 0, y: 240, w: 1008, h: 1536, kind: 'suburbs' },
    { name: 'North End', x: 1008, y: 240, w: 1920, h: 384, kind: 'suburbs' },
    { name: 'West Park Edge', x: 1008, y: 1776, w: 384, h: 768, kind: 'suburbs' },
    { name: 'East Park Edge', x: 2544, y: 1776, w: 384, h: 768, kind: 'suburbs' },
  ];
  function districtAt(x, y) {
    for (let i = 0; i < districts.length; i++) {
      const d = districts[i];
      if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d.kind;
    }
    return 'suburbs';
  }

  // --- roads + sidewalks ----------------------------------------------------
  const roads = [];
  for (let i = 0; i < VX.length; i++) {
    roads.push({ x: VX[i] - ROAD_W / 2, y: 0, w: ROAD_W, h: WORLD_H, horiz: false });
  }
  for (let j = 0; j < HY.length; j++) {
    roads.push({ x: 0, y: HY[j] - ROAD_W / 2, w: WORLD_W, h: ROAD_W, horiz: true });
  }
  const sidewalks = [];
  for (let i = 0; i < VX.length; i++) {
    sidewalks.push({ x: VX[i] - ROAD_W / 2 - SIDE_W, y: 0, w: SIDE_W, h: WORLD_H });
    sidewalks.push({ x: VX[i] + ROAD_W / 2, y: 0, w: SIDE_W, h: WORLD_H });
  }
  for (let j = 0; j < HY.length; j++) {
    sidewalks.push({ x: 0, y: HY[j] - ROAD_W / 2 - SIDE_W, w: WORLD_W, h: SIDE_W });
    sidewalks.push({ x: 0, y: HY[j] + ROAD_W / 2, w: WORLD_W, h: SIDE_W });
  }

  // --- fixed landmarks (reserved before buildings so nothing overlaps) -----
  const bank = { x: 1860, y: 1090, w: 160, h: 120 };
  const garage = { x: 700, y: 2240, w: 180, h: 110 };
  const shops = [
    { kind: 'repair', x: 1852, y: 700, w: 72, h: 56, price: 50, label: 'REPAIR' },
    { kind: 'ammo', x: 2236, y: 1090, w: 72, h: 56, price: 30, label: 'AMMO' },
    { kind: 'snack', x: 1468, y: 1470, w: 72, h: 56, price: 10, label: 'SNACK' },
  ];
  const reserved = [bank, garage];
  for (const s of shops) reserved.push(s);
  const pond = { x: 1968, y: 2100, rx: 220, ry: 130 };
  const beach = { x: 1008, y: 2600, w: 2928, h: 200 };
  const beachDrop = { x: 2400, y: 2700 };
  const spawn = { x: 1831, y: 1200 }; // downtown sidewalk, east of 5th avenue

  function inReserved(x, y, w, h, pad) {
    for (let i = 0; i < reserved.length; i++) {
      const r = reserved[i];
      if (overlaps(x, y, w, h, r.x, r.y, r.w, r.h, pad)) return true;
    }
    return false;
  }
  function inPond(x, y, w, h) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const dx = (cx - pond.x) / (pond.rx + 30);
    const dy = (cy - pond.y) / (pond.ry + 30);
    return dx * dx + dy * dy < 1;
  }

  // --- buildings: one pass over the blocks between roads --------------------
  const colBounds = [0];
  for (let i = 0; i < VX.length; i++) {
    colBounds.push(VX[i] - ROAD_W / 2, VX[i] + ROAD_W / 2);
  }
  colBounds.push(WORLD_W);
  const rowBounds = [0];
  for (let j = 0; j < HY.length; j++) {
    rowBounds.push(HY[j] - ROAD_W / 2, HY[j] + ROAD_W / 2);
  }
  rowBounds.push(WORLD_H);

  const buildings = [];
  function addBuilding(x, y, w, h, kind, colors, fMin, fMax) {
    if (inReserved(x, y, w, h, 6) || inPond(x, y, w, h)) return false;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (overlaps(x, y, w, h, b.x, b.y, b.w, b.h, 8)) return false;
    }
    buildings.push({
      x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
      kind, color: rng.pick(colors),
      floors: rng.int(fMin, fMax + 1),
      winSeed: rng.int(0, 1000000000),
    });
    return true;
  }

  const suburbBlocks = [];
  for (let ci = 0; ci < colBounds.length - 1; ci += 2) {
    for (let ri = 0; ri < rowBounds.length - 1; ri += 2) {
      const bx0 = colBounds[ci] + BLOCK_INSET;
      const by0 = rowBounds[ri] + BLOCK_INSET;
      const bx1 = colBounds[ci + 1] - BLOCK_INSET;
      const by1 = rowBounds[ri + 1] - BLOCK_INSET;
      if (bx1 - bx0 < 64 || by1 - by0 < 64) continue;
      const cx = (bx0 + bx1) / 2;
      const cy = (by0 + by1) / 2;
      const kind = districtAt(cx, cy);
      const qw = (bx1 - bx0) / 2;
      const qh = (by1 - by0) / 2;
      // Quadrant origins (2x2 split of the block interior).
      const qx = [bx0, bx0 + qw];
      const qy = [by0, by0 + qh];
      if (kind === 'downtown') {
        // Two tall towers on a diagonal + one mid-rise.
        addBuilding(qx[0] + 6, qy[0] + 6, qw - 18, qh - 18, 'tower', TOWER_COLORS, 12, 24);
        addBuilding(qx[1] + 6, qy[1] + 6, qw - 18, qh - 18, 'tower', TOWER_COLORS, 12, 24);
        addBuilding(qx[1] + 10, qy[0] + 10, qw - 26, qh - 26, 'mid', TOWER_COLORS, 5, 10);
      } else if (kind === 'harbour') {
        // Wide low warehouses.
        addBuilding(bx0 + 4, by0 + 8, (bx1 - bx0) - 8, qh - 20, 'warehouse', WARE_COLORS, 1, 2);
        if (rng.chance(0.6)) {
          addBuilding(qx[0] + 8, qy[1] + 8, qw - 20, qh - 20, 'warehouse', WARE_COLORS, 1, 2);
        }
      } else if (kind === 'park') {
        if (rng.chance(0.5)) {
          addBuilding(qx[0] + 10, qy[0] + 10, 54, 44, 'kiosk', KIOSK_COLORS, 1, 1);
        }
      } else if (kind === 'beach') {
        // No buildings on the sand.
      } else {
        // Suburbs: houses in most quadrants.
        suburbBlocks.push([bx0, by0, bx1, by1]);
        const quads = rng.shuffle([0, 1, 2, 3]);
        const n = rng.int(3, 5);
        for (let k = 0; k < n; k++) {
          const q = quads[k];
          const gx = qx[q % 2];
          const gy = qy[(q / 2) | 0];
          addBuilding(gx + 8, gy + 8, qw - 24, qh - 24, 'house', HOUSE_COLORS, 1, 3);
        }
      }
    }
  }

  // --- tune the building count toward ~215 (deterministic) ------------------
  if (buildings.length < 205) {
    // Fill free suburb quadrants with extra houses until we reach 215.
    outer: for (let b = 0; b < suburbBlocks.length; b++) {
      if (buildings.length >= 215) break;
      const sb = suburbBlocks[b];
      const qw = (sb[2] - sb[0]) / 2;
      const qh = (sb[3] - sb[1]) / 2;
      for (let q = 0; q < 4; q++) {
        if (buildings.length >= 215) break outer;
        const gx = sb[0] + (q % 2) * qw;
        const gy = sb[1] + ((q / 2) | 0) * qh;
        addBuilding(gx + 10, gy + 10, qw - 28, qh - 28, 'house', HOUSE_COLORS, 1, 2);
      }
    }
  } else if (buildings.length > 228) {
    // Trim smallest houses from the end until we are back in range.
    for (let i = buildings.length - 1; i >= 0 && buildings.length > 228; i--) {
      if (buildings[i].kind === 'house') buildings.splice(i, 1);
    }
  }

  // --- props (~219): lamps at corners, trees, benches, hydrants ------------
  const props = [];
  // Lamps: one per intersection corner, capped at 48.
  for (let i = 0; i < VX.length && props.filter((p) => p.type === 'lamp').length < 48; i++) {
    for (let j = 0; j < HY.length; j++) {
      if (props.filter((p) => p.type === 'lamp').length >= 48) break;
      if (!rng.chance(0.75)) continue;
      const sx = rng.chance(0.5) ? 1 : -1;
      const sy = rng.chance(0.5) ? 1 : -1;
      props.push({
        type: 'lamp',
        x: Math.round(VX[i] + sx * (ROAD_W / 2 + 14)),
        y: Math.round(HY[j] + sy * (ROAD_W / 2 + 14)),
      });
    }
  }
  function propFree(x, y, pad) {
    if (pointInRoads(x, y, roads)) return false;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return false;
    }
    if (inReserved(x, y, 4, 4, pad)) return false;
    if (inPond(x, y, 4, 4)) return false;
    return true;
  }
  function scatter(type, count, zone, tries) {
    let placed = 0;
    for (let t = 0; t < tries && placed < count; t++) {
      const x = rng.range(zone.x, zone.x + zone.w);
      const y = rng.range(zone.y, zone.y + zone.h);
      if (!propFree(x, y, 12)) continue;
      props.push({ type, x: Math.round(x), y: Math.round(y) });
      placed++;
    }
    return placed;
  }
  // Trees: park first, then suburbs, beach palms, harbour.
  const parkZone = { x: 1392, y: 1776, w: 1152, h: 768 };
  scatter('tree', 58, parkZone, 400);
  scatter('tree', 46, { x: 2928, y: 240, w: 1008, h: 2304 }, 400);
  scatter('tree', 14, beach, 200);
  scatter('tree', 10, { x: 0, y: 1776, w: 1008, h: 1024 }, 200);
  // Benches: park paths + a few suburb sidewalks.
  scatter('bench', 16, parkZone, 200);
  scatter('bench', 8, { x: 2928, y: 240, w: 1008, h: 2304 }, 200);
  // Hydrants: on sidewalk corners near intersections (both axes clear of
  // the asphalt, like the lamps but at a different corner offset).
  let hydrants = 0;
  for (let t = 0; t < 160 && hydrants < 19; t++) {
    const vx = rng.pick(VX);
    const hy = rng.pick(HY);
    const sx = rng.chance(0.5) ? 1 : -1;
    const sy = rng.chance(0.5) ? 1 : -1;
    const x = vx + sx * (ROAD_W / 2 + 12);
    const y = hy + sy * (ROAD_W / 2 + 12);
    if (!propFree(x, y, 8)) continue;
    props.push({ type: 'hydrant', x: Math.round(x), y: Math.round(y) });
    hydrants++;
  }

  // --- colliders (~324): buildings + landmarks + benches/hydrants + trees ---
  const colliders = [];
  for (const b of buildings) colliders.push({ x: b.x, y: b.y, w: b.w, h: b.h });
  colliders.push({ x: bank.x, y: bank.y, w: bank.w, h: bank.h });
  colliders.push({ x: garage.x, y: garage.y, w: garage.w, h: garage.h });
  for (const s of shops) colliders.push({ x: s.x, y: s.y, w: s.w, h: s.h });
  const trees = [];
  for (const p of props) {
    if (p.type === 'tree') trees.push(p);
    if (p.type === 'bench') colliders.push({ x: p.x - 14, y: p.y - 6, w: 28, h: 12 });
    if (p.type === 'hydrant') colliders.push({ x: p.x - 6, y: p.y - 6, w: 12, h: 12 });
  }
  for (let i = 0; i < trees.length && colliders.length < 324; i++) {
    const t = trees[i];
    colliders.push({ x: t.x - 7, y: t.y - 7, w: 14, h: 14 });
  }

  // --- parked cars: inner edge PARK_CLEAR (38) from the road centreline -----
  const parked = [];
  const carHalfW = 11; // half car width
  const parkOff = PARK_CLEAR + carHalfW; // centreline -> car centre = 49
  function nearRoadCentre(v, list, gap) {
    for (let i = 0; i < list.length; i++) {
      if (Math.abs(v - list[i]) < gap) return true;
    }
    return false;
  }
  for (let t = 0; t < 220 && parked.length < 14; t++) {
    const vertical = rng.chance(0.55);
    const side = rng.chance(0.5) ? 1 : -1;
    let x, y, angle;
    if (vertical) {
      const vx = rng.pick(VX);
      x = vx + side * parkOff;
      y = rng.range(120, WORLD_H - 120);
      if (nearRoadCentre(y, HY, 110)) continue;
      angle = rng.chance(0.5) ? 0 : Math.PI;
    } else {
      const hy = rng.pick(HY);
      y = hy + side * parkOff;
      x = rng.range(120, WORLD_W - 120);
      if (nearRoadCentre(x, VX, 110)) continue;
      angle = rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2;
    }
    let clash = false;
    for (let i = 0; i < parked.length; i++) {
      if (Math.hypot(parked[i].x - x, parked[i].y - y) < 90) { clash = true; break; }
    }
    if (clash) continue;
    parked.push({
      x: Math.round(x), y: Math.round(y), angle,
      color: rng.pick(CAR_COLORS), type: rng.pick(['sedan', 'sedan', 'taxi', 'van', 'sport']),
    });
  }

  // --- mission waypoints: fare pickups + drop-offs on driving lanes --------
  const fareSpots = [
    { x: 1797, y: 800 }, { x: 2139, y: 1500 }, { x: 1029, y: 1200 },
    { x: 2523, y: 900 }, { x: 1413, y: 2000 }, { x: 2907, y: 1800 },
  ];
  const dropSpots = [
    { x: 2181, y: 800 }, { x: 1755, y: 1500 }, { x: 2565, y: 1200 },
    { x: 1371, y: 900 }, { x: 987, y: 1600 }, { x: 2949, y: 1400 },
  ];

  return {
    w: WORLD_W, h: WORLD_H, seed: seed === undefined ? 1337 : seed,
    districts, roads, sidewalks, buildings, props, colliders,
    pond, beach, shops, bank, garage, beachDrop, spawn, parked,
    fareSpots, dropSpots,
  };
}

Sol.buildWorld = buildWorld;

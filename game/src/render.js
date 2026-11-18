// Solmara — render.js
// All drawing: world, entities, day/night lighting, HUD, minimap, touch UI,
// title / pause / busted / wasted screens. Vanilla Canvas 2D, zero assets.
//
// Expected state shape (fields are read defensively — missing ones fall back):
//   state.screen: 'title' | 'playing' | 'paused' | 'busted' | 'wasted'
//   state.world: the city object from buildWorld
//   state.minutes (0-1440), state.day, state.cash, state.bestCash,
//   state.hp / state.maxHp, state.ammo, state.wanted (0-5), state.rep
//   state.settings: { muted, quality: 'High' | 'Low' } (or state.muted / state.quality)
//   state.player: { x, y, angle, inCar } — player car in state.playerCar / state.car
//   state.cars / state.traffic: [{ x, y, angle, color, type, police }]
//   state.police: [{ x, y, angle, ... }] (defaults to cars flagged police)
//   state.peds: [{ x, y, angle, color }], state.bullets: [{ x, y, angle }]
//   state.pickups: [{ x, y, kind }]
//   state.mission: { text, timer, timeLeft, waypoint: { x, y, label } }
//   state.missions: [{ name, reward, unlocked, done }]
//   state.prompt: string, state.cashLost: number, state.__hasSave / state.hasSave
//   state.speedKmh (or the player car's .speed in px/s)
// Car angle convention: 0 = facing north (-y), positive = clockwise.
// NOTE: ctx.ellipse() always takes SEVEN arguments (a 6-arg call throws).
import { COLORS } from './config.js';

const Sol = window.Sol = window.Sol || {};

const MISSION_NAMES = ['First Fare', 'Hot Wheels', 'Paper Trail', 'Heat', 'The Solmara Job'];
const MISSION_REWARDS = [300, 500, 450, 600, 1500];
const MAP_W = 180;
const MAP_H = 128;

// --- per-world cache (window layouts + shaded colours, computed once) -------
const worldCache = new WeakMap();
function cacheFor(world) {
  let c = worldCache.get(world);
  if (c) return c;
  c = { wins: new Map(), roof: new Map(), side: new Map() };
  for (const b of world.buildings) {
    const cols = Math.max(2, Math.floor((b.w - 14) / 17));
    const rows = Math.max(2, Math.floor((b.h - 14) / 15));
    const lit = new Uint8Array(cols * rows);
    let h = (b.winSeed >>> 0) || 1;
    for (let i = 0; i < cols * rows; i++) {
      h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
      lit[i] = (h % 100) < 42 ? 1 : 0; // 42% of windows are lit-able
    }
    c.wins.set(b, { cols, rows, lit });
    c.roof.set(b, shade(b.color, 1.22));
    c.side.set(b, shade(b.color, 0.62));
  }
  worldCache.set(world, c);
  return c;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// --- cached radial glow gradients (one per context, reused every frame) -----
let glowCtx = null;
let lampGlowGrad = null;
let headGlowGrad = null;
function glowGrads(ctx) {
  if (glowCtx === ctx && lampGlowGrad) return;
  glowCtx = ctx;
  lampGlowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 78);
  lampGlowGrad.addColorStop(0, 'rgba(255,214,120,0.55)');
  lampGlowGrad.addColorStop(0.5, 'rgba(255,200,100,0.18)');
  lampGlowGrad.addColorStop(1, 'rgba(255,200,100,0)');
  headGlowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
  headGlowGrad.addColorStop(0, 'rgba(255,246,190,0.85)');
  headGlowGrad.addColorStop(1, 'rgba(255,246,190,0)');
}

// Fit a single-line label inside maxW: shrink the font, then ellipsize.
// Returns { text, font } ready to assign to ctx.font / fillText.
function fitText(ctx, text, maxW, fontPx, weight) {
  let px = fontPx;
  let font = weight + ' ' + px + 'px Arial, sans-serif';
  ctx.font = font;
  let w = ctx.measureText(text).width;
  while (px > 10 && w > maxW) {
    px -= 1;
    font = weight + ' ' + px + 'px Arial, sans-serif';
    ctx.font = font;
    w = ctx.measureText(text).width;
  }
  let out = text;
  while (out.length > 4 && ctx.measureText(out + '…').width > maxW) {
    out = out.slice(0, -1);
  }
  if (out !== text) out += '…';
  return { text: out, font };
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function fmtClock(minutes) {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}
// Night factor: 0 = day, 1 = full night. Dusk ramps 19:00-21:00,
// full night 21:00-06:00, dawn ramps 06:00-07:00. Headlights on from 19:00.
function nightFactor(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m >= 1260 || m < 360) return 1;
  if (m >= 1140) return (m - 1140) / 120;
  if (m < 420) return 1 - (m - 360) / 60;
  return 0;
}
function lightsOn(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return m >= 1140 || m < 360;
}

// --- state readers (defensive aliases) --------------------------------------
function getPlayer(s) { return s.player || s.hero || {}; }
function getPlayerCar(s) {
  if (s.playerCar) return s.playerCar;
  if (s.car) return s.car;
  const p = getPlayer(s);
  return p.inCar || null;
}
function getTraffic(s) { return s.cars || s.traffic || s.vehicles || []; }
function getPolice(s) {
  if (s.police) return s.police.cars ? s.police.cars.concat(s.police.officers || []) : s.police;
  const t = getTraffic(s);
  const out = [];
  for (let i = 0; i < t.length; i++) if (t[i].police || t[i].type === 'police') out.push(t[i]);
  return out;
}
function getMission(s) { return s.mission || s.currentMission || s.missions || null; }
function getMissions(s) {
  if (s.missions && s.missions.length) return s.missions;
  if (s.missions && s.missions.unlocked) return MISSION_NAMES.map((n, i) => ({ name: n, reward: MISSION_REWARDS[i], unlocked: !!s.missions.unlocked[i], done: !!s.missions.completed[i] }));
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push({
      name: MISSION_NAMES[i], reward: MISSION_REWARDS[i],
      unlocked: i === 0, done: false,
    });
  }
  return out;
}

// --- main entry -------------------------------------------------------------
export function draw(ctx, state, input, timeMs) {
  state = state || {};
  input = input || {};
  timeMs = timeMs || 0;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const world = state.world;
  const screen = state.screen || 'playing';

  if (!world) {
    ctx.fillStyle = '#0d1526';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SOLMARA', W / 2, H / 2);
    return;
  }

  if (screen === 'title') { drawTitle(ctx, state, input, timeMs, W, H); return; }

  // Camera: follow the player car, else the player on foot.
  const p = getPlayer(state);
  const car = getPlayerCar(state);
  let fx = num(p.x, world.w / 2);
  let fy = num(p.y, world.h / 2);
  if (p.inCar && car) { fx = num(car.x, fx); fy = num(car.y, fy); }
  if (state.camera) { fx = num(state.camera.x, fx); fy = num(state.camera.y, fy); }
  if (state.cam) { fx = num(state.cam.x, fx); fy = num(state.cam.y, fy); }
  let camX = fx - W / 2;
  let camY = fy - H / 2;
  if (W >= world.w) camX = (world.w - W) / 2; else camX = Math.max(0, Math.min(world.w - W, camX));
  if (H >= world.h) camY = (world.h - H) / 2; else camY = Math.max(0, Math.min(world.h - H, camY));

  const minutes = num(state.minutes, num(state.clock, 480));
  const nf = nightFactor(minutes);
  const lowQ = String((state.settings && state.settings.quality) || state.quality || '').toLowerCase() === 'low';

  drawWorld(ctx, state, world, camX, camY, W, H, timeMs, nf, lowQ);
  if (screen === 'playing') {
    drawHUD(ctx, state, W, H, minutes, timeMs);
    drawMinimap(ctx, state, world, W, H, timeMs);
    drawTouch(ctx, state, input, W, H);
  } else if (screen === 'paused') {
    drawHUD(ctx, state, W, H, minutes, timeMs);
    drawPaused(ctx, state, W, H);
  } else if (screen === 'busted' || screen === 'wasted') {
    drawEnd(ctx, state, screen, W, H);
  } else {
    drawHUD(ctx, state, W, H, minutes, timeMs);
    drawMinimap(ctx, state, world, W, H, timeMs);
  }
}

// --- world ------------------------------------------------------------------
function drawWorld(ctx, state, world, camX, camY, W, H, timeMs, nf, lowQ) {
  const cache = cacheFor(world);
  const vx0 = camX - 48, vy0 = camY - 48, vx1 = camX + W + 48, vy1 = camY + H + 48;
  function vis(x, y, w, h) { return x + w >= vx0 && x <= vx1 && y + h >= vy0 && y <= vy1; }

  ctx.save();
  ctx.translate(-camX, -camY);

  // Ground: dull grass base, then district ground.
  ctx.fillStyle = '#6f7f5e';
  ctx.fillRect(camX, camY, W, H);
  for (let i = 0; i < world.districts.length; i++) {
    const d = world.districts[i];
    if (!vis(d.x, d.y, d.w, d.h)) continue;
    if (d.kind === 'park') ctx.fillStyle = COLORS.parkGrass;
    else if (d.kind === 'beach') ctx.fillStyle = COLORS.beachSand;
    else if (d.kind === 'harbour') ctx.fillStyle = '#878d94';
    else ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(d.x, d.y, d.w, d.h);
  }
  // Harbour water along the west edge + sea at the south edge of the beach.
  ctx.fillStyle = COLORS.water;
  ctx.fillRect(0, 1776, 96, 1024);
  ctx.fillRect(1008, 2770, 2928, 30);
  // Pond (ellipse: SEVEN arguments).
  ctx.fillStyle = COLORS.pond;
  ctx.beginPath();
  ctx.ellipse(world.pond.x, world.pond.y, world.pond.rx, world.pond.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.ellipse(world.pond.x - 30, world.pond.y - 24, world.pond.rx * 0.55, world.pond.ry * 0.4, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Sidewalks.
  ctx.fillStyle = COLORS.sidewalk;
  for (let i = 0; i < world.sidewalks.length; i++) {
    const s = world.sidewalks[i];
    if (vis(s.x, s.y, s.w, s.h)) ctx.fillRect(s.x, s.y, s.w, s.h);
  }

  // Roads + centre dashes.
  for (let i = 0; i < world.roads.length; i++) {
    const r = world.roads[i];
    if (!vis(r.x, r.y, r.w, r.h)) continue;
    ctx.fillStyle = COLORS.road;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = COLORS.roadLine;
    if (r.horiz) {
      const cy = r.y + r.h / 2 - 2;
      const x0 = Math.max(r.x, vx0);
      const x1 = Math.min(r.x + r.w, vx1);
      for (let x = x0 - (x0 % 46); x < x1; x += 46) ctx.fillRect(x, cy, 26, 4);
    } else {
      const cx = r.x + r.w / 2 - 2;
      const y0 = Math.max(r.y, vy0);
      const y1 = Math.min(r.y + r.h, vy1);
      for (let y = y0 - (y0 % 46); y < y1; y += 46) ctx.fillRect(cx, y, 4, 26);
    }
  }

  // Buildings, phase 1: shadow + body + roof + 2.5D side faces.
  for (let i = 0; i < world.buildings.length; i++) {
    const b = world.buildings[i];
    if (!vis(b.x - 12, b.y - 12, b.w + 24, b.h + 24)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(b.x + 8, b.y + 10, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = cache.side.get(b);
    ctx.fillRect(b.x, b.y + b.h - 10, b.w, 10); // south face
    ctx.fillRect(b.x + b.w - 10, b.y, 10, b.h); // east face
    ctx.fillStyle = cache.roof.get(b);
    ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
    if (b.floors >= 10) { // rooftop plant box on towers
      ctx.fillStyle = cache.side.get(b);
      ctx.fillRect(b.x + b.w / 2 - 12, b.y + b.h / 2 - 9, 24, 18);
    }
  }

  // Landmarks: shops, bank, garage — block + coloured roof + label.
  drawLandmark(ctx, world.bank.x, world.bank.y, world.bank.w, world.bank.h, '#c9a227', 'BANK', vis);
  drawLandmark(ctx, world.garage.x, world.garage.y, world.garage.w, world.garage.h, '#5a5f66', 'GARAGE', vis);
  const shopCols = { repair: '#b5764a', ammo: '#4a7db5', snack: '#7db54a' };
  for (let i = 0; i < world.shops.length; i++) {
    const s = world.shops[i];
    drawLandmark(ctx, s.x, s.y, s.w, s.h, shopCols[s.kind] || '#888888', s.label, vis);
  }

  // Props.
  for (let i = 0; i < world.props.length; i++) {
    const pr = world.props[i];
    if (!vis(pr.x - 30, pr.y - 30, 60, 60)) continue;
    if (pr.type === 'tree') drawTree(ctx, pr.x, pr.y, timeMs, lowQ);
    else if (pr.type === 'lamp') drawLamp(ctx, pr.x, pr.y);
    else if (pr.type === 'bench') {
      ctx.fillStyle = '#7a5a38';
      ctx.fillRect(pr.x - 14, pr.y - 6, 28, 12);
      ctx.fillStyle = '#5d4326';
      ctx.fillRect(pr.x - 14, pr.y + 2, 28, 4);
    } else if (pr.type === 'hydrant') {
      ctx.fillStyle = '#c23b3b';
      ctx.fillRect(pr.x - 5, pr.y - 7, 10, 14);
      ctx.fillStyle = '#8f2a2a';
      ctx.fillRect(pr.x - 5, pr.y - 7, 10, 4);
    }
  }

  // Parked cars.
  for (let i = 0; i < world.parked.length; i++) {
    const c = world.parked[i];
    if (vis(c.x - 30, c.y - 30, 60, 60)) drawCar(ctx, c.x, c.y, c.angle, c.color, c.type, false, 0, false);
  }

  // Traffic + police.
  const traffic = getTraffic(state);
  for (let i = 0; i < traffic.length; i++) {
    const c = traffic[i];
    if (!c || !vis(c.x - 40, c.y - 40, 80, 80)) continue;
    const isPolice = !!(c.police || c.type === 'police');
    drawCar(ctx, c.x, c.y, c.angle || 0, isPolice ? '#e8e8e8' : (c.color || '#888888'),
      isPolice ? 'police' : (c.type || 'sedan'), isPolice, timeMs, lightsOn(num(state.minutes, 480)));
  }

  // Player car (drawn above traffic).
  const pcar = getPlayerCar(state);
  const p = getPlayer(state);
  if (pcar && p.inCar) {
    drawCar(ctx, pcar.x, pcar.y, pcar.angle || 0, pcar.color || COLORS.taxi,
      pcar.type || 'sedan', false, timeMs, lightsOn(num(state.minutes, 480)));
    // Gold ring under the player's car.
    ctx.strokeStyle = 'rgba(255,210,63,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(pcar.x, pcar.y, 30, 30, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Pedestrians.
  const peds = state.peds || [];
  for (let i = 0; i < peds.length; i++) {
    const pd = peds[i];
    if (!pd || !vis(pd.x - 16, pd.y - 16, 32, 32)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(pd.x, pd.y + 8, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = pd.color || '#c98a5a';
    ctx.beginPath();
    ctx.arc(pd.x, pd.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pd.x, pd.y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Pickups (cash / packages): bobbing green-gold markers.
  const pickups = state.pickups || [];
  for (let i = 0; i < pickups.length; i++) {
    const pk = pickups[i];
    if (!pk || !vis(pk.x - 20, pk.y - 20, 40, 40)) continue;
    const bob = Math.sin(timeMs / 280 + i) * 3;
    ctx.fillStyle = '#2fae4e';
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + bob, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pk.x, pk.y + bob, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', pk.x, pk.y + bob + 1);
  }

  // Bullets: short bright streaks.
  const bullets = state.bullets || [];
  ctx.strokeStyle = '#ffe98a';
  ctx.lineWidth = 3;
  for (let i = 0; i < bullets.length; i++) {
    const bl = bullets[i];
    if (!bl || !vis(bl.x - 12, bl.y - 12, 24, 24)) continue;
    const a = bl.angle || 0;
    const dx = Math.sin(a) * 10;
    const dy = -Math.cos(a) * 10;
    ctx.beginPath();
    ctx.moveTo(bl.x - dx, bl.y - dy);
    ctx.lineTo(bl.x + dx, bl.y + dy);
    ctx.stroke();
  }

  // Player on foot.
  if (!p.inCar && p.x !== undefined) {
    const px = p.x, py = p.y;
    if (vis(px - 20, py - 20, 40, 40)) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(px, py + 10, 12, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2f6fd0';
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#e8b88a';
      ctx.beginPath();
      ctx.arc(px, py - 2, 6, 0, Math.PI * 2);
      ctx.fill();
      const a = p.angle || 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.sin(a) * 18, py - Math.cos(a) * 18);
      ctx.stroke();
    }
  }

  // Mission waypoint marker (world space, pulsing).
  const mission = getMission(state);
  if (mission && mission.waypoint) {
    const wx = mission.waypoint.x, wy = mission.waypoint.y;
    const pulse = 1 + Math.sin(timeMs / 220) * 0.18;
    if (vis(wx - 40, wy - 40, 80, 80)) {
      ctx.fillStyle = 'rgba(255,210,63,0.95)';
      ctx.beginPath();
      ctx.moveTo(wx, wy - 34 * pulse);
      ctx.lineTo(wx - 13 * pulse, wy - 12 * pulse);
      ctx.lineTo(wx + 13 * pulse, wy - 12 * pulse);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,63,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(wx, wy, 22 * pulse, 22 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // --- night: dark overlay, then windows + light pools shine through -------
  if (nf > 0.01) {
    ctx.fillStyle = 'rgba(6,10,34,' + (0.42 * nf).toFixed(3) + ')';
    ctx.fillRect(camX - 48, camY - 48, W + 96, H + 96);
  }

  // Windows, phase 2 (after the night overlay so lit windows stay visible).
  const litRatio = nf > 0.5 ? 1 : 0.45; // more windows lit at night
  for (let i = 0; i < world.buildings.length; i++) {
    const b = world.buildings[i];
    if (!vis(b.x, b.y, b.w, b.h)) continue;
    const wl = cache.wins.get(b);
    if (!wl) continue;
    const gw = (b.w - 14) / wl.cols;
    const gh = (b.h - 14) / wl.rows;
    for (let r = 0; r < wl.rows; r++) {
      for (let c = 0; c < wl.cols; c++) {
        const lit = wl.lit[r * wl.cols + c] === 1;
        if (!lit && nf < 0.5) {
          ctx.fillStyle = COLORS.windowDark;
        } else if (lit) {
          ctx.fillStyle = nf > 0.5 ? '#ffe08a' : COLORS.windowLit;
        } else {
          ctx.fillStyle = COLORS.windowDark;
        }
        if (lit && nf <= 0.5 && ((r * wl.cols + c) % 3 !== 0)) continue; // day: fewer lit
        ctx.fillRect(b.x + 8 + c * gw, b.y + 8 + r * gh, 8, 6);
      }
    }
    void litRatio;
  }

  // Light pools (additive): headlight cones, lamp glows, player glow.
  if (nf > 0.05) {
    glowGrads(ctx);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const headOn = lightsOn(num(state.minutes, 480));
    if (headOn) {
      drawHeadlights(ctx, traffic, nf, lowQ);
      if (pcar && p.inCar) drawHeadlights(ctx, [pcar], nf, lowQ);
    }
    if (!lowQ) {
      for (let i = 0; i < world.props.length; i++) {
        const pr = world.props[i];
        if (pr.type !== 'lamp' || !vis(pr.x - 80, pr.y - 80, 160, 160)) continue;
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.globalAlpha = 0.5 * nf;
        ctx.fillStyle = lampGlowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 78, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    // Soft glow around the player so the night scene never goes unreadable.
    if (p.x !== undefined) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = 0.35 * nf;
      ctx.fillStyle = lampGlowGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 78, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  ctx.restore();

  // Off-screen waypoint arrow (screen space).
  if (mission && mission.waypoint) {
    const wx = mission.waypoint.x, wy = mission.waypoint.y;
    const sx = wx - camX, sy = wy - camY;
    if (sx < 0 || sx > W || sy < 0 || sy > H) {
      const cx = Math.max(60, Math.min(W - 60, sx));
      const cy = Math.max(80, Math.min(H - 180, sy));
      const a = Math.atan2(sy - cy, sx - cx);
      const dist = Math.round(Math.hypot(wx - fxOf(state), wy - fyOf(state)) / 4);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(255,210,63,0.95)';
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(-10, -11);
      ctx.lineTo(-10, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 14px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((mission.waypoint.label || 'Waypoint') + '  ' + dist + 'm', cx, cy + 26);
    } else {
      const dist = Math.round(Math.hypot(wx - fxOf(state), wy - fyOf(state)) / 4);
      ctx.fillStyle = '#ffd23f';
      ctx.font = 'bold 13px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((mission.waypoint.label || 'Waypoint') + '  ' + dist + 'm', sx, sy + 44);
    }
  }
}
function fxOf(s) { const p = getPlayer(s); return num(p.x, 0); }
function fyOf(s) { const p = getPlayer(s); return num(p.y, 0); }

function drawLandmark(ctx, x, y, w, h, roofCol, label, vis) {
  if (!vis(x - 10, y - 10, w + 20, h + 20)) return;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x + 6, y + 8, w, h);
  ctx.fillStyle = '#6a6f76';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = roofCol;
  ctx.fillRect(x + 4, y + 4, w - 8, 14);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 6);
}

function drawTree(ctx, x, y, timeMs, lowQ) {
  if (!lowQ) {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(x + 4, y + 8, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#5d4326';
  ctx.fillRect(x - 2, y - 2, 4, 10);
  ctx.fillStyle = '#3f7d3a';
  ctx.beginPath();
  ctx.arc(x, y - 6, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#57a352';
  ctx.beginPath();
  ctx.arc(x - 4, y - 10, 8, 0, Math.PI * 2);
  ctx.fill();
}

function drawLamp(ctx, x, y) {
  ctx.fillStyle = '#3a3f46';
  ctx.fillRect(x - 2, y - 10, 4, 20);
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath();
  ctx.arc(x, y - 11, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawHeadlights(ctx, cars, nf, lowQ) {
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (!c || c.x === undefined) continue;
    const a = c.angle || 0;
    const fx = Math.sin(a), fy = -Math.cos(a);
    const px = -fy, py = fx; // perpendicular
    const bx = c.x + fx * 22, by = c.y + fy * 22;
    // Two cones, one per headlight: a wide soft outer cone plus a
    // narrower brighter inner cone, so the beam fades instead of
    // ending in a hard triangle edge.
    for (let s = -1; s <= 1; s += 2) {
      const hx = c.x + px * s * 7 + fx * 20;
      const hy = c.y + py * s * 7 + fy * 20;
      ctx.fillStyle = 'rgba(255,244,180,' + (0.10 * nf).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + fx * 190 + px * s * 62, hy + fy * 190 + py * s * 62);
      ctx.lineTo(hx + px * s * 12, hy + py * s * 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,246,200,' + (0.15 * nf).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + fx * 150 + px * s * 26, hy + fy * 150 + py * s * 26);
      ctx.lineTo(hx + px * s * 8, hy + py * s * 8);
      ctx.closePath();
      ctx.fill();
    }
    if (!lowQ) {
      for (let s = -1; s <= 1; s += 2) {
        ctx.save();
        ctx.translate(bx + px * s * 7, by + py * s * 7);
        ctx.globalAlpha = 0.8 * nf;
        ctx.fillStyle = headGlowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

// --- cars -------------------------------------------------------------------
function drawCar(ctx, x, y, angle, color, type, isPolice, timeMs, headlights) {
  const len = type === 'van' ? 54 : type === 'sport' ? 44 : 46;
  const wid = type === 'van' ? 24 : 22;
  const hl = len / 2, hw = wid / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Shadow (ellipse: SEVEN arguments).
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 3, hw + 3, hl + 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Wheels.
  ctx.fillStyle = '#141414';
  ctx.fillRect(-hw - 2, -hl + 7, 5, 10);
  ctx.fillRect(hw - 3, -hl + 7, 5, 10);
  ctx.fillRect(-hw - 2, hl - 17, 5, 10);
  ctx.fillRect(hw - 3, hl - 17, 5, 10);
  // Body.
  ctx.fillStyle = color;
  rr(ctx, -hw, -hl, wid, len, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Windshield + rear window + roof.
  ctx.fillStyle = '#1c2733';
  ctx.fillRect(-hw + 3, -hl + 6, wid - 6, 8);
  ctx.fillRect(-hw + 3, hl - 14, wid - 6, 7);
  ctx.fillStyle = shade(color, 1.18);
  ctx.fillRect(-hw + 2, -hl + 16, wid - 4, hl - 8);
  if (type === 'taxi') {
    ctx.fillStyle = '#222222';
    ctx.fillRect(-hw + 2, -2, wid - 4, 5); // checker band
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-6, -hl - 4, 12, 5); // roof sign
  }
  if (isPolice) {
    ctx.fillStyle = '#1c4fd6';
    ctx.fillRect(-hw + 2, -4, wid - 4, 8); // blue door band
    const phase = Math.floor(timeMs / 180) % 2;
    ctx.fillStyle = phase === 0 ? '#ff2e2e' : '#7a1515';
    ctx.fillRect(-hw + 2, -hl + 16, 8, 5);
    ctx.fillStyle = phase === 0 ? '#274b8f' : '#2e7bff';
    ctx.fillRect(hw - 10, -hl + 16, 8, 5);
  }
  // Headlight dots.
  if (headlights) {
    ctx.fillStyle = '#fff8c0';
    ctx.beginPath();
    ctx.arc(-hw + 5, -hl + 1, 2.5, 0, Math.PI * 2);
    ctx.arc(hw - 5, -hl + 1, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- HUD --------------------------------------------------------------------
function drawHUD(ctx, state, W, H, minutes, timeMs) {
  const cash = num(state.cash, 0);
  const hp = num(state.hp, num(getPlayer(state).hp, 100));
  const maxHp = num(state.maxHp, 100);
  const ammo = num(state.ammo, num(getPlayer(state).ammo, 0));
  const wanted = Math.max(0, Math.min(5, Math.round(num(state.wanted, 0))));
  const rep = num(state.rep, 0);
  const day = num(state.day, 1);
  const nf = nightFactor(minutes);

  // Top bar.
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(0, 0, W, 36);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.hudAccent;
  ctx.font = 'bold 21px Arial, sans-serif';
  ctx.fillText('$' + cash, 12, 19);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px Arial, sans-serif';
  ctx.fillText((nf > 0.5 ? '☾ ' : '☀ ') + fmtClock(minutes) + '  ·  DAY ' + day, W / 2, 19);
  ctx.textAlign = 'right';
  ctx.font = '20px Arial, sans-serif';
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < wanted ? '#ffd23f' : 'rgba(255,255,255,0.28)';
    ctx.fillText('★', W - 14 - i * 24, 19);
  }

  // Mission banner (text fitted so it can never overflow the pill).
  const mission = getMission(state);
  if (mission && mission.text) {
    const label = mission.text + (mission.timeLeft !== undefined && mission.timeLeft !== null && mission.timeLeft > 0
      ? '  ·  ' + Math.max(0, Math.ceil(mission.timeLeft)) + 's'
      : (mission.timer !== undefined && mission.timer !== null && mission.timer > 0
        ? '  ·  ' + Math.max(0, Math.ceil(mission.timer)) + 's' : ''));
    const fit = fitText(ctx, label, W - 76, 14, 'bold');
    const tw = ctx.measureText(fit.text).width;
    const bw = Math.min(W - 24, tw + 28);
    ctx.fillStyle = 'rgba(8,12,18,0.72)';
    rr(ctx, (W - bw) / 2, 44, bw, 28, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,63,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = fit.font;
    ctx.textAlign = 'center';
    ctx.fillText(fit.text, W / 2, 59);
  }

  // Bottom-left chips: REP + AMMO.
  ctx.textAlign = 'left';
  ctx.font = 'bold 13px Arial, sans-serif';
  ctx.fillStyle = 'rgba(8,12,18,0.72)';
  ctx.fillRect(10, H - 68, 118, 22);
  ctx.fillStyle = COLORS.hudAccent;
  ctx.fillText('REP ' + rep + '   ·   AMMO ' + ammo, 16, H - 57);

  // HP bar + speed.
  const hpW = 170;
  const frac = Math.max(0, Math.min(1, hp / maxHp));
  ctx.fillStyle = 'rgba(8,12,18,0.72)';
  ctx.fillRect(10, H - 40, hpW + 64, 22);
  ctx.fillStyle = '#222222';
  ctx.fillRect(14, H - 35, hpW, 12);
  ctx.fillStyle = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#f5c518' : '#ff4d4d';
  ctx.fillRect(14, H - 35, Math.round(hpW * frac), 12);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText('HP', 14 + hpW + 8, H - 29);
  const car = getPlayerCar(state);
  const p = getPlayer(state);
  if (p.inCar && car) {
    const kmh = state.speedKmh !== undefined ? Math.round(state.speedKmh)
      : Math.round(num(car.speed, 0) * 0.2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillText(kmh + ' km/h', 14 + hpW + 34, H - 29);
  }

  // Prompt pill (bottom centre, text fitted).
  if (state.prompt) {
    const fit = fitText(ctx, state.prompt, W - 76, 14, 'bold');
    const tw = ctx.measureText(fit.text).width;
    const bw = Math.min(W - 24, tw + 28);
    ctx.fillStyle = 'rgba(8,12,18,0.78)';
    rr(ctx, (W - bw) / 2, H - 84, bw, 28, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = fit.font;
    ctx.textAlign = 'center';
    ctx.fillText(fit.text, W / 2, H - 70);
  }

  // Low-HP red pulse at the screen edge.
  if (hp > 0 && hp < 30) {
    const a = 0.12 + 0.08 * Math.sin(timeMs / 200);
    ctx.strokeStyle = 'rgba(255,40,40,' + a.toFixed(3) + ')';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, W, H);
  }
}

// --- minimap ----------------------------------------------------------------
function drawMinimap(ctx, state, world, W, H, timeMs) {
  const mw = MAP_W, mh = MAP_H;
  const mx = W - mw - 12, my = H - mh - 12;
  const sx = mw / world.w, sy = mh / world.h;
  ctx.fillStyle = 'rgba(8,12,18,0.8)';
  rr(ctx, mx, my, mw, mh, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,212,77,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  rr(ctx, mx, my, mw, mh, 8);
  ctx.clip();
  // District tints.
  for (let i = 0; i < world.districts.length; i++) {
    const d = world.districts[i];
    ctx.fillStyle = d.kind === 'park' ? '#3f7d3a' : d.kind === 'beach' ? '#c9b078'
      : d.kind === 'harbour' ? '#5a6b7d' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(mx + d.x * sx, my + d.y * sy, d.w * sx, d.h * sy);
  }
  // Roads.
  ctx.strokeStyle = 'rgba(200,200,200,0.85)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < world.roads.length; i++) {
    const r = world.roads[i];
    ctx.beginPath();
    ctx.moveTo(mx + r.x * sx, my + r.y * sy);
    ctx.lineTo(mx + (r.x + r.w) * sx, my + (r.y + r.h) * sy);
    ctx.stroke();
  }
  // Shops / bank / garage dots.
  ctx.fillStyle = '#ffd23f';
  for (let i = 0; i < world.shops.length; i++) {
    ctx.fillRect(mx + world.shops[i].x * sx - 1, my + world.shops[i].y * sy - 1, 3, 3);
  }
  // Police dots (red, only while wanted).
  const wanted = num(state.wanted, 0);
  if (wanted > 0) {
    const police = getPolice(state);
    ctx.fillStyle = '#ff3b3b';
    for (let i = 0; i < police.length; i++) {
      if (police[i].x === undefined) continue;
      ctx.beginPath();
      ctx.arc(mx + police[i].x * sx, my + police[i].y * sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Waypoint dot (pulsing gold).
  const mission = getMission(state);
  if (mission && mission.waypoint) {
    const pr = 3 + Math.sin(timeMs / 200) * 1;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(mx + mission.waypoint.x * sx, my + mission.waypoint.y * sy, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow (north up).
  const p = getPlayer(state);
  const car = getPlayerCar(state);
  const px = p.inCar && car ? car.x : p.x;
  const py = p.inCar && car ? car.y : p.y;
  const pa = p.inCar && car ? (car.angle || 0) : (p.angle || 0);
  if (px !== undefined) {
    ctx.save();
    ctx.translate(mx + px * sx, my + py * sy);
    ctx.rotate(pa);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// --- touch UI ---------------------------------------------------------------
let touchSeen = false;
function drawTouch(ctx, state, input, W, H) {
  const t = input.touch;
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  if (t && (t.active || t.joyX !== 0 || t.joyY !== 0)) touchSeen = true;
  if (t && t.buttons) {
    for (let i = 0; i < t.buttons.length; i++) if (t.buttons[i].pressed) touchSeen = true;
  }
  if (!touchSeen && !coarse && !(typeof window !== 'undefined' && 'ontouchstart' in window)) return;
  if (!t) return;
  const jx = num(t.joyBaseX, 96);
  const jy = num(t.joyBaseY, H - 104);
  const jr = num(t.joyRadius, 64);
  // Joystick base + knob.
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(jx, jy, jr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(jx, jy, jr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.arc(jx + num(t.joyX, 0) * 40, jy + num(t.joyY, 0) * 40, 28, 0, Math.PI * 2);
  ctx.fill();
  // Buttons (positions come from input.layout; 72 px diameter).
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px Arial, sans-serif';
  for (let i = 0; i < t.buttons.length; i++) {
    const b = t.buttons[i];
    if (!b || b.x === 0 && b.y === 0) continue;
    ctx.fillStyle = b.pressed ? 'rgba(255,210,63,0.45)' : 'rgba(255,255,255,0.13)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, num(b.r, 36), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, num(b.r, 36), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.label || '', b.x, b.y);
  }
}

// --- screens ----------------------------------------------------------------
function drawTitle(ctx, state, input, timeMs, W, H) {
  const world = state.world;
  // Slow-panning daytime city behind the panel.
  const cx = 1968 + 500 * Math.sin(timeMs * 0.00003);
  const cy = 1400 + 300 * Math.cos(timeMs * 0.000023);
  let camX = Math.max(0, Math.min(world.w - W, cx - W / 2));
  let camY = Math.max(0, Math.min(world.h - H, cy - H / 2));
  if (W >= world.w) camX = (world.w - W) / 2;
  if (H >= world.h) camY = (world.h - H) / 2;
  drawWorld(ctx, state, world, camX, camY, W, H, timeMs, 0, false);
  ctx.fillStyle = 'rgba(4,8,20,0.62)';
  ctx.fillRect(0, 0, W, H);

  const pw = Math.min(600, W - 28);
  const ph = Math.min(560, H - 24);
  const px = (W - pw) / 2;
  const py = (H - ph) / 2;
  ctx.fillStyle = 'rgba(10,14,24,0.9)';
  rr(ctx, px, py, pw, ph, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,63,0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();

  let y = py + 52;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.hudAccent;
  ctx.font = 'bold ' + (pw < 420 ? 44 : 56) + 'px Arial, sans-serif';
  ctx.fillText('SOLMARA', W / 2, y);
  y += 44;
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '15px Arial, sans-serif';
  ctx.fillText('Solmara — a coastal city that never sleeps.', W / 2, y);
  y += 20;
  ctx.fillText('You are Jace Rook, driver-for-hire. Walk the streets,', W / 2, y);
  y += 20;
  ctx.fillText('steal a car, take Mama Rosa\'s jobs, and stay ahead of the law.', W / 2, y);
  y += 34;
  ctx.fillStyle = '#c8c8c8';
  ctx.font = '14px Arial, sans-serif';
  ctx.fillText('Move  WASD / Arrows   ·   Run  Shift   ·   Action  E', W / 2, y);
  y += 20;
  ctx.fillText('Shoot  Space   ·   Pause  P / Esc   ·   Mute  M   ·   Quality  Q', W / 2, y);
  y += 30;
  // Mission list with unlock state.
  const missions = getMissions(state);
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.textAlign = 'left';
  const listX = px + 36;
  for (let i = 0; i < missions.length; i++) {
    const m = missions[i];
    const tag = m.done ? '[DONE]' : m.unlocked ? '[OPEN]' : '[LOCKED]';
    ctx.fillStyle = m.done ? '#4ade80' : m.unlocked ? '#ffffff' : '#777777';
    ctx.fillText((i + 1) + '. ' + m.name + ' — $' + m.reward, listX, y);
    ctx.textAlign = 'right';
    ctx.fillText(tag, px + pw - 36, y);
    ctx.textAlign = 'left';
    y += 21;
  }
  y += 12;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 19px Arial, sans-serif';
  const pulse = 0.75 + 0.25 * Math.sin(timeMs / 300);
  ctx.globalAlpha = pulse;
  ctx.fillText('Press ENTER or tap to start', W / 2, y);
  ctx.globalAlpha = 1;
  y += 28;
  const muted = !!(state.muted || (state.settings && state.settings.muted));
  const quality = (state.settings && state.settings.quality) || state.quality || 'High';
  const best = num(state.bestCash, num(state.best, num(state._bestCash, 0)));
  ctx.fillStyle = '#b8b8b8';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText('Sound: ' + (muted ? 'OFF' : 'ON') + '   ·   Quality: ' + quality
    + '   ·   Best cash $' + best, W / 2, y);
  const hasSave = state.hasSave === true || state.__hasSave === true;
  if (hasSave) {
    y += 24;
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText('Continue — save found (press C)', W / 2, y);
  }
}

function drawPaused(ctx, state, W, H) {
  ctx.fillStyle = 'rgba(4,8,20,0.6)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px Arial, sans-serif';
  ctx.fillText('PAUSED', W / 2, H / 2 - 60);
  ctx.fillStyle = '#c8c8c8';
  ctx.font = '16px Arial, sans-serif';
  ctx.fillText('P / Esc — Resume', W / 2, H / 2);
  ctx.fillText('M — Mute', W / 2, H / 2 + 28);
  ctx.fillText('Q — Quality High / Low', W / 2, H / 2 + 56);
  const muted = !!(state.muted || (state.settings && state.settings.muted));
  const quality = (state.settings && state.settings.quality) || state.quality || 'High';
  ctx.fillStyle = '#888888';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText('Sound: ' + (muted ? 'OFF' : 'ON') + '   ·   Quality: ' + quality, W / 2, H / 2 + 96);
}

function drawEnd(ctx, state, screen, W, H) {
  const busted = screen === 'busted';
  ctx.fillStyle = busted ? 'rgba(20,4,8,0.72)' : 'rgba(8,4,20,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff4d4d';
  ctx.font = 'bold 54px Arial, sans-serif';
  ctx.fillText(busted ? 'BUSTED' : 'WASTED', W / 2, H / 2 - 56);
  ctx.fillStyle = '#ffffff';
  ctx.font = '17px Arial, sans-serif';
  ctx.fillText(busted ? 'The Solmara PD got you.' : 'You flatlined on the streets of Solmara.',
    W / 2, H / 2);
  const lost = num(state.cashLost, Math.max(50, Math.round(num(state.cash, 0) * 0.25)));
  ctx.fillStyle = COLORS.hudAccent;
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillText('Lost $' + lost, W / 2, H / 2 + 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillText('Press ENTER to continue', W / 2, H / 2 + 72);
}

Sol.draw = draw;

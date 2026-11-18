// Solmara — main.js
// Bootstrap: canvas + resize, fixed-timestep loop, debug/QA handle.
// Imports every engine module (which also populate the Sol namespace),
// builds the world from ?seed=N, creates the game, and draws each frame.
import { DEFAULT_SEED } from './config.js';
import { createRng } from './random.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import './world.js';
import './game.js';
import './render.js';

const Sol = window.Sol = window.Sol || {};
Sol.createRng = Sol.createRng || createRng;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const STEP = 1 / 60; // fixed timestep
const MAX_STEPS = 5; // spiral-of-death guard

let viewW = 0;
let viewH = 0;
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.max(1, Math.round(viewW * dpr));
  canvas.height = Math.max(1, Math.round(viewH * dpr));
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
}

window.addEventListener('resize', resize);
resize();

// Seed from the URL (?seed=N); falls back to the default on bad input.
let seed = DEFAULT_SEED;
try {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw !== null && raw !== '') {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed)) seed = parsed;
  }
} catch (_err) {
  seed = DEFAULT_SEED;
}

const city = Sol.buildWorld(seed);
const input = createInput(canvas);
const audio = createAudio();
const state = Sol.createGame(city, input, audio);

// FPS as an exponential moving average of real frame time.
let fps = 60;
let lastTime = performance.now();
let accumulator = 0;
let firstFrameDrawn = false;

function frame(nowMs) {
  requestAnimationFrame(frame);
  let dtReal = (nowMs - lastTime) / 1000;
  lastTime = nowMs;
  if (dtReal > 0.25) dtReal = 0.25; // tab was hidden / hitching: clamp
  if (dtReal > 0) fps = fps * 0.95 + (1 / dtReal) * 0.05;

  accumulator += dtReal;
  let steps = 0;
  while (accumulator >= STEP && steps < MAX_STEPS) {
    state.update(STEP);
    accumulator -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) accumulator = 0; // drop backlog, never spiral

  // Logical (CSS-pixel) drawing space; backing store is dpr-scaled.
  // Renderers: logical size is ctx.canvas.clientWidth/clientHeight.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Sol.draw(ctx, state, input, nowMs);
  if (!firstFrameDrawn) {
    firstFrameDrawn = true;
    window.__shotReady = true;
  }
}

// Debug / QA handle (contract with the other modules and the QA harness).
// state.__hasSave is maintained by game.js and updated on save/load.
window.__solmara = {
  state,
  screen: () => state.screen,
  fps: () => Math.round(fps),
  get quality() {
    return state.settings.quality;
  },
  get hasSave() {
    return state.__hasSave === true;
  },
  start: () => state.startGame(),
  warp: (x, y) => state.warp(x, y),
  setClock: (m) => state.setClock(m),
  setMission: (n) => state.startMission(n),
  giveCar: () => state.giveCar(),
  setWanted: (n) => state.setWanted(n),
  spawnPolice: (n) => state.spawnPolice(n),
  save: () => state.saveGame(),
  load: () => state.loadGame(),
  clearSave: () => state.clearSave(),
  setQuality: (q) => state.setQuality(q),
  toggleMute: () => state.toggleMute(),
  pause: () => state.pauseGame(),
  resume: () => state.resumeGame(),
  // Extra diagnostics for QA (not part of the required contract).
  view: () => ({ w: viewW, h: viewH, dpr }),
  seed: () => seed,
};

Sol.main = { canvas, ctx, state, input, audio, city, seed };

requestAnimationFrame(frame);

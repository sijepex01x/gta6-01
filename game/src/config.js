// Solmara — config.js
// Every tuning number and colour in one place. Named exports only.
// Other modules import these; the Sol namespace mirrors them for QA.
const Sol = window.Sol = window.Sol || {};

export const WORLD_W = 3936;
export const WORLD_H = 2800;
export const DEFAULT_SEED = 1337;
export const DAY_SECONDS = 480;

// Clock: the in-game day runs 00:00-24:00 over DAY_SECONDS real seconds.
export const DAY_START_MINUTES = 8 * 60; // 08:00 at the start of day 1
export const NIGHT_START_MINUTES = 19 * 60; // 19:00 — headlights on
export const NIGHT_END_MINUTES = 6 * 60; // 06:00 — headlights off

export const PRICES = { repair: 50, ammo: 30, snack: 10 };
export const MISSION_REWARDS = [300, 500, 450, 600, 1500];
export const MISSION_COUNT = 5;

// Player (on foot), pixels per second.
export const PLAYER_WALK_SPEED = 170;
export const PLAYER_RUN_SPEED = 280; // brief: run 280 px/s
export const PLAYER_RADIUS = 14;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_PUNCH_DAMAGE = 12;
export const PLAYER_PUNCH_RANGE = 34;
export const PLAYER_PUNCH_COOLDOWN = 0.35;
export const PLAYER_SHOT_DAMAGE = 34;
export const PLAYER_SHOT_COOLDOWN = 0.28;
export const PLAYER_SHOT_RANGE = 420;
export const PLAYER_START_AMMO = 24;
export const AMMO_PACK = 24;
export const SNACK_HEAL = 30; // brief: snack +30 HP

// Cars, pixels per second / radians per second.
export const CAR_MAX_SPEED = 520;
export const CAR_REVERSE_SPEED = 160;
export const CAR_ACCEL = 420;
export const CAR_BRAKE = 700;
export const CAR_DRAG = 0.55;
export const CAR_TURN_SPEED = 2.6;
export const CAR_MAX_HEALTH = 100;
export const TRAFFIC_SPEED = 150;
export const POLICE_SPEED = 560;
export const POLICE_RAM_DAMAGE = 8;

// Wanted level 0-5.
export const WANTED_MAX = 5;
export const WANTED_DECAY_SECONDS = 8; // base: one star per 6 + wanted*2 s out of sight (8 s at 1 star)
export const WANTED_SIGHT_RANGE = 520; // police / witnesses spot crimes inside this
export const BUST_CASH_FRACTION = 0.15; // brief: lose 15% cash when busted
export const BUST_CASH_MIN = 25;

// Missions.
export const MISSION1_TIME_LIMIT = 150; // First Fare
export const MISSION4_TIME_LIMIT = 90; // Heat — fair timer, not 60
export const MISSION4_HP_FLOOR = 30; // Heat — player HP never drops below this
export const MISSION5_CASH_AMOUNT = 1500;

// World / camera.
export const CAMERA_LERP = 6;
export const VIEW_MARGIN = 40;
export const MINIMAP_SIZE = 180; // minimap is 180x128 px (width)
export const SAVE_KEY = 'solmara-save-v1';
export const BEST_CASH_KEY = 'solmara-best-cash-v1';

export const COLORS = {
  grass: '#4d8f4a',
  parkGrass: '#57a352',
  road: '#33363b',
  roadLine: '#e8d44d',
  sidewalk: '#9a9a92',
  beachSand: '#e3cd8f',
  water: '#2f7fb8',
  pond: '#3b8fc4',
  downtown: '#5a6b7d',
  harbour: '#6b7f8c',
  suburbs: '#7d9b6a',
  player: '#ffd23f',
  playerShirt: '#2f6fd0',
  police: '#1c4fd6',
  policeLightRed: '#ff2e2e',
  policeLightBlue: '#2e7bff',
  taxi: '#f5c518',
  hudBg: 'rgba(8, 12, 18, 0.62)',
  hudText: '#ffffff',
  hudAccent: '#ffd23f',
  titleSkyTop: '#0d1b3d',
  titleSkyBottom: '#f2a65a',
  headlight: 'rgba(255, 244, 180, 0.28)',
  nightOverlay: 'rgba(6, 10, 34, 0.42)',
  lampGlow: 'rgba(255, 214, 120, 0.30)',
  windowLit: '#ffd97a',
  windowDark: '#2c3a4d',
};

// Named palette entries the renderer can grab by building kind.
export const BUILDING_COLORS = {
  downtown: ['#6b7c93', '#7d8ea6', '#5d6f84', '#8a97a8', '#4e5f73'],
  harbour: ['#7a6a55', '#8c7a62', '#6b5f4c', '#9a8871'],
  suburbs: ['#a8876b', '#b59a7d', '#96795c', '#c2a586'],
  shop: ['#b5764a', '#4a7db5', '#7db54a'],
};

Sol.CONFIG = {
  WORLD_W, WORLD_H, DEFAULT_SEED, DAY_SECONDS,
  DAY_START_MINUTES, NIGHT_START_MINUTES, NIGHT_END_MINUTES,
  PRICES, MISSION_REWARDS, MISSION_COUNT,
  PLAYER_WALK_SPEED, PLAYER_RUN_SPEED, PLAYER_RADIUS, PLAYER_MAX_HEALTH,
  PLAYER_PUNCH_DAMAGE, PLAYER_PUNCH_RANGE, PLAYER_PUNCH_COOLDOWN,
  PLAYER_SHOT_DAMAGE, PLAYER_SHOT_COOLDOWN, PLAYER_SHOT_RANGE,
  PLAYER_START_AMMO, AMMO_PACK, SNACK_HEAL,
  CAR_MAX_SPEED, CAR_REVERSE_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_DRAG,
  CAR_TURN_SPEED, CAR_MAX_HEALTH, TRAFFIC_SPEED, POLICE_SPEED, POLICE_RAM_DAMAGE,
  WANTED_MAX, WANTED_DECAY_SECONDS, WANTED_SIGHT_RANGE,
  BUST_CASH_FRACTION, BUST_CASH_MIN,
  MISSION1_TIME_LIMIT, MISSION4_TIME_LIMIT, MISSION4_HP_FLOOR, MISSION5_CASH_AMOUNT,
  CAMERA_LERP, VIEW_MARGIN, MINIMAP_SIZE, SAVE_KEY, BEST_CASH_KEY,
  COLORS, BUILDING_COLORS,
};

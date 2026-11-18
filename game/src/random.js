// Solmara — random.js
// Seeded RNG (mulberry32) plus small helpers. Deterministic: the same seed
// always builds the same city, so ?seed=N replays exactly.
const Sol = window.Sol = window.Sol || {};

// mulberry32: tiny, fast, good-enough 32-bit seeded PRNG.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// createRng(seed) -> { next, range, int, pick, shuffle, chance, seed }
// next() returns a float in [0, 1). range/int are inclusive-exclusive
// in the usual [min, max) style, except int(max) which is [0, max).
export function createRng(seed) {
  const next = mulberry32(seed);
  const rng = {
    seed: seed >>> 0,
    next,
    range(min, max) {
      return min + next() * (max - min);
    },
    int(min, max) {
      if (max === undefined) {
        max = min;
        min = 0;
      }
      return Math.floor(min + next() * (max - min));
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    chance(p) {
      return next() < p;
    },
    // Fisher-Yates, in place, returns the same array for chaining.
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
  };
  return rng;
}

Sol.createRng = createRng;
Sol.mulberry32 = mulberry32;

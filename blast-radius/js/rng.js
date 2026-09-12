// Blast Radius — rng.js
//
// A seeded PRNG (mulberry32), implemented as pure functions: the generator's
// internal state is a plain 32-bit integer that callers thread through
// themselves, rather than a stateful closure. That's what lets state.js stay
// 100% pure (same input state + same action => same output state, always) —
// there is no hidden mutable RNG object living outside the game state.
//
// Usage:
//   let rngState = seedToRngState(seed);
//   const { value, rngState: next } = nextFloat(rngState);
//   rngState = next;

function mulberry32Step(a) {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: a };
}

/** Deterministically turns any seed (string or number) into a 32-bit int. */
export function seedToRngState(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  const str = String(seed);
  // xmur3-style string hash.
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Returns { value: 0..1, rngState: next }. */
export function nextFloat(rngState) {
  const { value, next } = mulberry32Step(rngState);
  return { value, rngState: next };
}

/** Returns { value: 0..maxExclusive-1, rngState: next }. */
export function nextInt(rngState, maxExclusive) {
  const { value, rngState: next } = nextFloat(rngState);
  return { value: Math.floor(value * maxExclusive), rngState: next };
}

/** Uniform pick from a non-empty array. Returns { value, rngState }. */
export function pick(rngState, arr) {
  const { value: index, rngState: next } = nextInt(rngState, arr.length);
  return { value: arr[index], rngState: next };
}

/**
 * Weighted pick from a non-empty array, weight(item) via weightFn.
 * Returns { value, rngState }.
 */
export function weightedPick(rngState, items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  const { value: r0, rngState: next } = nextFloat(rngState);
  if (total <= 0) return { value: items[0], rngState: next };
  let r = r0 * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return { value: items[i], rngState: next };
  }
  return { value: items[items.length - 1], rngState: next };
}

/** A short, URL-safe random seed for a fresh game when none is supplied. */
export function randomSeed() {
  return Math.floor(Math.random() * 36 ** 6).toString(36);
}

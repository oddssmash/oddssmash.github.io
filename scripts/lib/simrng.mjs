// Seeded random numbers for the Monte Carlo simulator (scripts/simulate.mjs).
// sfc32 generator: fast, 128-bit state, the same seed always gives the same stream,
// so every simulation file can be reproduced from the seed it stores.

export function hashSeed(...parts) {
  // FNV-1a over the joined parts -> 32-bit unsigned
  let h = 2166136261 >>> 0;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = 0x9e3779b9 ^ seed, b = 0x243f6a88 ^ (seed * 31), c = 0xb7e15162 ^ (seed * 17), d = seed >>> 0 || 1;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 20; i++) next();
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do { u = next() * 2 - 1; v = next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m;
    return u * m;
  };
  const poisson = (lam) => {
    if (!(lam > 0)) return 0;
    if (lam < 30) {
      const L = Math.exp(-lam); let k = 0, p = 1;
      do { k++; p *= next(); } while (p > L);
      return k - 1;
    }
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * normal()));
  };
  const binom = (n, p) => {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n < 40) { let k = 0; for (let i = 0; i < n; i++) if (next() < p) k++; return k; }
    const m = n * p, sd = Math.sqrt(m * (1 - p));
    return Math.min(n, Math.max(0, Math.round(m + sd * normal())));
  };
  // draw `n` items over weights w[0..k-1] (k small); adds into out[]
  const multinom = (n, w, k, out) => {
    let tot = 0;
    for (let i = 0; i < k; i++) tot += w[i];
    if (!(tot > 0) || n <= 0) return;
    let left = n, rest = tot;
    for (let i = 0; i < k && left > 0; i++) {
      if (w[i] <= 0) continue;
      if (i === k - 1 || rest <= w[i]) { out[i] += left; left = 0; break; }
      const x = binom(left, w[i] / rest);
      out[i] += x; left -= x; rest -= w[i];
    }
  };
  return { next, normal, poisson, binom, multinom };
}

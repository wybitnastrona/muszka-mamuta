/** xoshiro128** — https://prng.di.unimi.it/xoshiro128starstar.c */

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function splitmix32(state: number): [next: number, value: number] {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return [next, (z ^ (z >>> 16)) >>> 0];
}

export class Xoshiro128ss {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    let state = seed >>> 0;
    let a: number, b: number, c: number, d: number;
    [state, a] = splitmix32(state);
    [state, b] = splitmix32(state);
    [state, c] = splitmix32(state);
    [state, d] = splitmix32(state);
    if ((a | b | c | d) === 0) a = 1;
    this.s0 = a;
    this.s1 = b;
    this.s2 = c;
    this.s3 = d;
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1). */
  nextFloat(): number {
    return (this.nextUint32() >>> 8) * (1 / 16777216);
  }
}

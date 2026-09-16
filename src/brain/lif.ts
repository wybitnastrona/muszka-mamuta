import type { ActivityFrame } from '../lib/replay.ts';
import type { RoleTag } from './params.ts';
import type { CircuitGraph } from './csr.ts';
import {
  BACKGROUND_RATE_HZ,
  DT_MS,
  FRAME_STEPS,
  RATE_NORM_HZ,
  RATE_WINDOW_MS,
  RATE_WINDOW_STEPS,
  REFRACTORY_STEPS,
  TAU_M_MS,
  TAU_SYN_MS,
  V_RESET_MV,
  V_REST_MV,
  V_TH_MV,
  W_SYN_MV,
  clamp01,
} from './params.ts';
import { isGustatorySeed } from './drive.ts';
import { Xoshiro128ss } from './rng.ts';

export type { CircuitGraph } from './csr.ts';

export type PopulationSummary = {
  mn9Rate: number;
  gustDriveRate: number;
  gustNeutralRate: number;
  gustSuppressRate: number;
  mnOtherRate: number;
  dnRate: number;
};

export class LifNetwork {
  readonly n: number;
  readonly bodyId: Int32Array;
  readonly role: CircuitGraph['role'];
  readonly pathSign: CircuitGraph['pathSign'];
  readonly spikeCount: Uint32Array;
  readonly lastSpikes: Int32Array;
  lastSpikeN = 0;
  seed: number;
  readonly backgroundRateHz: number;

  private readonly indptr: Int32Array;
  private readonly indices: Int32Array;
  private readonly weights: Float32Array;
  private readonly v: Float32Array;
  private readonly g: Float32Array;
  private readonly iExt: Float32Array;
  private readonly refrac: Int16Array;
  private readonly gain: Float32Array;
  private readonly tonicRate: Float32Array;
  private readonly pulseRate: Float32Array;
  private readonly pulseLeft: Int32Array;
  private readonly windowCount: Uint16Array;
  private readonly live: Uint8Array;
  private roster: Int32Array;
  private rosterN = 0;
  private qI: Int32Array;
  private qS: Int32Array;
  private qHead = 0;
  private qLen = 0;
  private rng: Xoshiro128ss;
  private stepIndex = 0;
  private readonly idToIndex: Map<number, number>;
  private readonly roleIndex: Map<RoleTag, Int32Array>;
  private readonly synDecay = Math.exp(-DT_MS / TAU_SYN_MS);
  private readonly dtOverTau = DT_MS / TAU_M_MS;

  constructor(
    circuit: CircuitGraph,
    seed: number,
    opts: { backgroundRateHz?: number } = {},
  ) {
    this.n = circuit.n;
    this.bodyId = circuit.bodyId;
    this.role = circuit.role;
    this.pathSign = circuit.pathSign;
    this.backgroundRateHz = opts.backgroundRateHz ?? BACKGROUND_RATE_HZ;
    this.indptr = circuit.indptr;
    this.indices = circuit.indices;
    this.weights = circuit.weights;
    this.v = new Float32Array(this.n);
    this.g = new Float32Array(this.n);
    this.iExt = new Float32Array(this.n);
    this.refrac = new Int16Array(this.n);
    this.gain = new Float32Array(this.n);
    this.tonicRate = new Float32Array(this.n);
    this.pulseRate = new Float32Array(this.n);
    this.pulseLeft = new Int32Array(this.n);
    this.windowCount = new Uint16Array(this.n);
    this.live = new Uint8Array(this.n);
    this.roster = new Int32Array(this.n);
    this.spikeCount = new Uint32Array(this.n);
    this.lastSpikes = new Int32Array(this.n);
    this.qI = new Int32Array(Math.max(4096, this.n));
    this.qS = new Int32Array(this.qI.length);
    this.idToIndex = new Map();
    const buckets = new Map<RoleTag, number[]>();
    for (let i = 0; i < this.n; i++) {
      this.idToIndex.set(this.bodyId[i], i);
      const list = buckets.get(this.role[i]) ?? [];
      list.push(i);
      buckets.set(this.role[i], list);
      if (isGustatorySeed(this.role[i])) {
        this.tonicRate[i] = this.backgroundRateHz;
      }
    }
    this.roleIndex = new Map();
    for (const [role, list] of buckets) this.roleIndex.set(role, Int32Array.from(list));
    this.seed = seed >>> 0;
    this.rng = new Xoshiro128ss(this.seed);
    this.clearState();
    this.applyTonic();
  }

  reset(seed = this.seed): void {
    this.seed = seed >>> 0;
    this.rng = new Xoshiro128ss(this.seed);
    this.iExt.fill(0);
    this.pulseRate.fill(0);
    this.pulseLeft.fill(0);
    this.clearState();
    this.applyTonic();
  }

  private clearState(): void {
    this.v.fill(V_REST_MV);
    this.g.fill(0);
    this.refrac.fill(0);
    this.gain.fill(1);
    this.spikeCount.fill(0);
    this.windowCount.fill(0);
    this.qHead = 0;
    this.qLen = 0;
    this.stepIndex = 0;
    this.lastSpikeN = 0;
    this.live.fill(0);
    this.rosterN = 0;
  }

  private applyTonic(): void {
    for (let i = 0; i < this.n; i++) {
      if (this.tonicRate[i] > 0) this.wake(i);
    }
  }

  private wake(index: number): void {
    if (this.live[index]) return;
    this.live[index] = 1;
    this.roster[this.rosterN++] = index;
  }

  setCurrent(index: number, mV: number): void {
    this.iExt[index] = mV;
    this.wake(index);
  }

  setGain(role: RoleTag, gain: number): void {
    const idx = this.roleIndex.get(role);
    if (!idx) return;
    for (let k = 0; k < idx.length; k++) this.gain[idx[k]] = gain;
  }

  stimulate(ids: Int32Array, rateHz: number, durationMs: number): void {
    const steps = Math.max(0, Math.round(durationMs / DT_MS));
    for (let k = 0; k < ids.length; k++) {
      const index = this.idToIndex.get(ids[k]);
      if (index === undefined) continue;
      this.pulseRate[index] = rateHz;
      this.pulseLeft[index] = steps;
      this.wake(index);
    }
  }

  /** Advance `count` steps of dt. Returns how many neurons spiked on the last step. */
  step(count = 1): number {
    let fired = 0;
    for (let i = 0; i < count; i++) fired = this.advance();
    return fired;
  }

  private advance(): number {
    const v = this.v;
    const g = this.g;
    const decay = this.synDecay;
    const dtOverTau = this.dtOverTau;
    const refrac = this.refrac;
    const pScale = DT_MS / 1000;
    let fired = 0;
    const n0 = this.rosterN;

    for (let k = 0; k < n0; k++) {
      const i = this.roster[k];
      let gi = g[i] * decay;
      if (gi > -1e-8 && gi < 1e-8) gi = 0;
      g[i] = gi;

      if (refrac[i] > 0) {
        refrac[i]--;
        v[i] = V_RESET_MV;
      } else {
        const drive = gi + this.iExt[i];
        if (drive !== 0 || v[i] !== V_REST_MV) {
          v[i] += dtOverTau * (drive - (v[i] - V_REST_MV));
          if (v[i] >= V_TH_MV) {
            this.lastSpikes[fired++] = i;
            v[i] = V_RESET_MV;
            refrac[i] = REFRACTORY_STEPS;
          }
        }
      }

      const pulse = this.pulseLeft[i];
      if (pulse > 0) this.pulseLeft[i] = pulse - 1;
      const rate = pulse > 0 ? this.pulseRate[i] : this.tonicRate[i];
      if (rate > 0 && refrac[i] === 0 && this.rng.nextFloat() < rate * pScale) {
        this.lastSpikes[fired++] = i;
        v[i] = V_RESET_MV;
        refrac[i] = REFRACTORY_STEPS;
      }
    }

    const step = this.stepIndex++;
    const expireAt = step - RATE_WINDOW_STEPS;
    while (this.qLen > 0 && this.qS[this.qHead] <= expireAt) {
      const ni = this.qI[this.qHead];
      if (this.windowCount[ni] > 0) this.windowCount[ni]--;
      this.qHead++;
      if (this.qHead === this.qI.length) this.qHead = 0;
      this.qLen--;
    }

    for (let s = 0; s < fired; s++) {
      const pre = this.lastSpikes[s];
      this.spikeCount[pre]++;
      this.windowCount[pre]++;
      if (this.qLen === this.qI.length) this.growQueue();
      const at = (this.qHead + this.qLen) % this.qI.length;
      this.qI[at] = pre;
      this.qS[at] = step;
      this.qLen++;
      const wScale = W_SYN_MV * this.gain[pre];
      const start = this.indptr[pre];
      const end = this.indptr[pre + 1];
      for (let e = start; e < end; e++) {
        const post = this.indices[e];
        g[post] += this.weights[e] * wScale;
        this.wake(post);
      }
    }

    let kept = 0;
    for (let k = 0; k < this.rosterN; k++) {
      const i = this.roster[k];
      const stay =
        refrac[i] > 0 ||
        this.iExt[i] !== 0 ||
        this.pulseLeft[i] > 0 ||
        this.tonicRate[i] > 0 ||
        g[i] !== 0 ||
        v[i] !== V_REST_MV;
      if (stay) {
        this.roster[kept++] = i;
      } else {
        this.live[i] = 0;
        v[i] = V_REST_MV;
      }
    }
    this.rosterN = kept;
    this.lastSpikeN = fired;
    return fired;
  }

  stepMs(ms: number): void {
    const steps = Math.max(0, Math.round(ms / DT_MS));
    this.step(steps);
  }

  stepFrame(): { time: number; values: [number, number][]; summary: PopulationSummary } {
    this.step(FRAME_STEPS);
    return this.snapshot();
  }

  snapshot(): { time: number; values: [number, number][]; summary: PopulationSummary } {
    const values = this.activityValues();
    return { time: this.timeSec, values, summary: this.populationSummary() };
  }

  get timeSec(): number {
    return (this.stepIndex * DT_MS) / 1000;
  }

  rateHz(index: number): number {
    const elapsedMs = Math.min(RATE_WINDOW_MS, this.stepIndex * DT_MS);
    if (elapsedMs <= 0) return 0;
    return this.windowCount[index] / (elapsedMs / 1000);
  }

  meanRoleRate(role: RoleTag): number {
    const idx = this.roleIndex.get(role);
    if (!idx || idx.length === 0) return 0;
    let sum = 0;
    for (let k = 0; k < idx.length; k++) sum += this.rateHz(idx[k]);
    return sum / idx.length;
  }

  populationSummary(): PopulationSummary {
    return {
      mn9Rate: this.meanRoleRate('mn9'),
      gustDriveRate: this.meanRoleRate('gust_drive'),
      gustNeutralRate: this.meanRoleRate('gust_neutral'),
      gustSuppressRate: this.meanRoleRate('gust_suppress'),
      mnOtherRate: this.meanRoleRate('mn_other'),
      dnRate: this.meanRoleRate('dn'),
    };
  }

  activityValues(): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < this.n; i++) {
      const norm = clamp01(this.rateHz(i) / RATE_NORM_HZ);
      if (norm > 0) out.push([this.bodyId[i], norm]);
    }
    return out;
  }

  activityFrame(): ActivityFrame {
    return { time: this.timeSec, values: this.activityValues() };
  }

  idsForRole(role: RoleTag): Int32Array {
    const idx = this.roleIndex.get(role);
    if (!idx) return new Int32Array(0);
    const ids = new Int32Array(idx.length);
    for (let k = 0; k < idx.length; k++) ids[k] = this.bodyId[idx[k]];
    return ids;
  }

  private growQueue(): void {
    const next = new Int32Array(this.qI.length * 2);
    const nextS = new Int32Array(next.length);
    for (let k = 0; k < this.qLen; k++) {
      const src = (this.qHead + k) % this.qI.length;
      next[k] = this.qI[src];
      nextS[k] = this.qS[src];
    }
    this.qI = next;
    this.qS = nextS;
    this.qHead = 0;
  }
}

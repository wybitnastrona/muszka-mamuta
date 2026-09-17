/**
 * Twaróg eating logic. No Three.js — FlyScene / Twarog.tsx consume the
 * events and drive meshes.
 *
 * Chemosensory boundary (authored, not connectome):
 *   CONTACT (sweet, aa, sour, bitter) — millimetre-scale, sampled at tarsi
 *     and labellum, converted to Poisson rates on gust_labellar and
 *     gust_pharyngeal via BrainRuntime.stimulate().
 *   ODOR (vanillin) — long-range 1/r, fills the table, steers ORIENT only.
 *     It must never be posted as a stimulus onto MN9: MaleCNS olfactory
 *     pathways are not in the extracted feeding subgraph.
 */
import { PUMP_HZ } from '../body/feedingMotion.ts';
import { odorConcentration, odorGradientYaw, type XZ } from '../body/odorField.ts';
import { clamp01 } from '../body/math.ts';
import { Xoshiro128ss } from '../brain/rng.ts';
import {
  CONTACT_RADIUS_BODY_LENGTHS,
  CURD_BITE_MM,
  CURD_CHUNK_COUNT,
  CURD_DENSITY_G_CM3,
  CURD_MM,
  CURD_TOTAL_MASS_G,
  ETERNITY_MASS_FRAC,
  LOD_BODY_LENGTHS,
  LOD_FADE_MS,
  bodyCollisionPadMm,
  contactRadiusMm,
  flyVisualLengthMm,
  lodDistanceMm,
  lodFadeSec,
  mm,
  standoffMm,
} from '../scene/scale.ts';
import type { FoodProfile } from './foodProfile.ts';
import { TWAROG_MAMUTA_WANILIOWY } from './foodProfile.ts';
import type { FracturedCurd } from './proceduralTwarog.ts';
import { supportHeightAt as composeSupport } from '../scene/layout.ts';

export const PORTION_STORAGE_KEY = 'muszka-mamuta.portions';
export const CRUMB_MIN = 3;
export const CRUMB_MAX = 8;
export const LABELLAR_RATE_MAX_HZ = 48;
export const PHARYNGEAL_RATE_MAX_HZ = 36;
export const PUMP_PERIOD_S = 1 / PUMP_HZ;
/** Retract 0.42 s + groom 0.7 s, authored clip lengths. */
export const REFILL_ANIM_S = 1.12;
/** Fade-in of a fresh 250 g portion after refill. */
export const APPEAR_FADE_S = 0.28;

export type KvStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type Vec3 = { x: number; y: number; z: number };

export type ChunkRecord = {
  index: number;
  centroid: Vec3;
  massGrams: number;
  biteDistance: number;
  neighbours: number[];
  eaten: boolean;
  /** Local-space top of the cell (food origin). Used by supportHeightAt. */
  topY: number;
  /** XZ radius of the cell around its centroid. */
  radiusXz: number;
};

export type ConsumeEvent = {
  type: 'consume';
  index: number;
  massGrams: number;
  centroid: Vec3;
  crumbCount: number;
  exposed: number[];
};

export type RefillEvent = { type: 'refill'; portion: number };
export type GroomEvent = { type: 'groom' };
export type TwarogEvent = ConsumeEvent | RefillEvent | GroomEvent;

export type ContactFields = {
  sweet: number;
  aa: number;
  sour: number;
  bitter: number;
  strength: number;
};

export type GustRates = {
  labellarHz: number;
  pharyngealHz: number;
};

export type ChemoSample = {
  contact: ContactFields;
  odor: number;
  odorYaw: number;
  rates: GustRates;
};

export type TwarogStepInput = {
  dt: number;
  pumping: boolean;
  labellum: Vec3;
  cameraDist: number;
  sensors: readonly Vec3[];
  profile?: FoodProfile;
  foodXZ: XZ;
  flyXZ: XZ;
  /**
   * TASTE / EXTEND / PUMP: tarsi are authored to be on the food, but the
   * coxa bones sit short of `standoffMm()` and the rest labellum is closer
   * still. The extracted circuit also has no tarsal GRNs, only labellar /
   * also has no tarsal GRNs, only labellar / peg / pharyngeal seeds.
   * When true, chemo includes the nearest surface chunk so the labellar
   * channel sees food chemistry before PER.
   */
  tasting?: boolean;
};

export type TwarogStepResult = {
  events: TwarogEvent[];
  chemo: ChemoSample;
  lodBlend: number;
  refillT: number;
  remainingMassGrams: number;
};

function hypot3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export type XzAabb = { cx: number; cz: number; hx: number; hz: number };
export type XzObb = XzAabb & { yaw: number };
export type Hit2 = { t: number; x: number; z: number; nx: number; nz: number };

export type ApproachTarget = {
  point: Vec3;
  hit: Vec3;
  normal: { x: number; z: number };
  yaw: number;
  distance: number;
  arrived: boolean;
};

export function pointInXzAabb(p: XZ, b: XzAabb, pad = 0): boolean {
  return Math.abs(p.x - b.cx) <= b.hx + pad && Math.abs(p.z - b.cz) <= b.hz + pad;
}

/** First hit of a horizontal ray against an XZ AABB, or null if it misses. */
export function raycastXzAabb(origin: XZ, dir: XZ, b: XzAabb): Hit2 | null {
  const len = Math.hypot(dir.x, dir.z);
  if (len < 1e-9) return null;
  const dx = dir.x / len;
  const dz = dir.z / len;
  const invX = Math.abs(dx) < 1e-12 ? 1e12 * Math.sign(dx || 1) : 1 / dx;
  const invZ = Math.abs(dz) < 1e-12 ? 1e12 * Math.sign(dz || 1) : 1 / dz;
  const t1x = (b.cx - b.hx - origin.x) * invX;
  const t2x = (b.cx + b.hx - origin.x) * invX;
  const t1z = (b.cz - b.hz - origin.z) * invZ;
  const t2z = (b.cz + b.hz - origin.z) * invZ;
  const tmin = Math.max(Math.min(t1x, t2x), Math.min(t1z, t2z));
  const tmax = Math.min(Math.max(t1x, t2x), Math.max(t1z, t2z));
  if (tmax < 0 || tmin > tmax) return null;
  const t = tmin >= 0 ? tmin : tmax;
  if (t < 0) return null;
  const x = origin.x + dx * t;
  const z = origin.z + dz * t;
  const eps = 1e-3;
  let nx = 0;
  let nz = 0;
  if (Math.abs(x - (b.cx - b.hx)) <= eps) nx = -1;
  else if (Math.abs(x - (b.cx + b.hx)) <= eps) nx = 1;
  else if (Math.abs(z - (b.cz - b.hz)) <= eps) nz = -1;
  else if (Math.abs(z - (b.cz + b.hz)) <= eps) nz = 1;
  else {
    const wx = Math.abs(x - b.cx) - b.hx;
    const wz = Math.abs(z - b.cz) - b.hz;
    if (wx >= wz) nx = x >= b.cx ? 1 : -1;
    else nz = z >= b.cz ? 1 : -1;
  }
  return { t, x, z, nx, nz };
}

function clampAbs(v: number, lim: number): number {
  if (v > lim) return lim;
  if (v < -lim) return -lim;
  return v;
}

/** Closest point on the AABB surface plus the outward normal (inside or out). */
export function closestXzAabb(p: XZ, b: XzAabb): Hit2 {
  const dx = p.x - b.cx;
  const dz = p.z - b.cz;
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  if (ax > b.hx || az > b.hz) {
    const cx = b.cx + clampAbs(dx, b.hx);
    const cz = b.cz + clampAbs(dz, b.hz);
    const nx = cx === p.x ? 0 : Math.sign(p.x - cx);
    const nz = cz === p.z ? 0 : Math.sign(p.z - cz);
    const nlen = Math.hypot(nx, nz) || 1;
    return { t: Math.hypot(p.x - cx, p.z - cz), x: cx, z: cz, nx: nx / nlen, nz: nz / nlen };
  }
  const ox = b.hx - ax;
  const oz = b.hz - az;
  if (ox < oz) {
    const nx = dx >= 0 ? 1 : -1;
    return { t: 0, x: b.cx + nx * b.hx, z: p.z, nx, nz: 0 };
  }
  const nz = dz >= 0 ? 1 : -1;
  return { t: 0, x: p.x, z: b.cz + nz * b.hz, nx: 0, nz };
}

/**
 * Hard constraint: if `p` is inside the (padded) AABB, push it out along the
 * face normal of least penetration. Not physics.
 */
export function clampOutsideXzAabb(p: XZ, b: XzAabb, pad = 0): { x: number; z: number; nx: number; nz: number } {
  const box: XzAabb = { cx: b.cx, cz: b.cz, hx: b.hx + pad, hz: b.hz + pad };
  if (!pointInXzAabb(p, box)) return { x: p.x, z: p.z, nx: 0, nz: 0 };
  const hit = closestXzAabb(p, box);
  const eps = 1e-3;
  return { x: hit.x + hit.nx * eps, z: hit.z + hit.nz * eps, nx: hit.nx, nz: hit.nz };
}

/** Same constraint against a yawed box (packaging). Matches THREE.Object3D rotation.y. */
export function clampOutsideXzObb(p: XZ, obb: XzObb, pad = 0): { x: number; z: number } {
  const c = Math.cos(obb.yaw);
  const s = Math.sin(obb.yaw);
  const dx = p.x - obb.cx;
  const dz = p.z - obb.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const local = clampOutsideXzAabb({ x: lx, z: lz }, { cx: 0, cz: 0, hx: obb.hx, hz: obb.hz }, pad);
  return {
    x: obb.cx + local.x * c + local.z * s,
    z: obb.cz - local.x * s + local.z * c,
  };
}

/**
 * Ray from `origin` toward `target` (usually the food centroid). First hit
 * on `box`, then a point `standoff` millimetres before that hit along the ray.
 */
export function standoffOnRay(
  origin: XZ,
  target: XZ,
  box: XzAabb,
  standoff: number,
): ApproachTarget {
  const y = 0;
  const inside = pointInXzAabb(origin, box);
  if (inside) {
    const hit = closestXzAabb(origin, box);
    const px = hit.x + hit.nx * standoff;
    const pz = hit.z + hit.nz * standoff;
    const yaw = Math.atan2(px - origin.x, pz - origin.z);
    const distance = Math.hypot(px - origin.x, pz - origin.z);
    return {
      point: { x: px, y, z: pz },
      hit: { x: hit.x, y, z: hit.z },
      normal: { x: hit.nx, z: hit.nz },
      yaw,
      distance,
      arrived: distance <= 1e-3,
    };
  }
  const dir = { x: target.x - origin.x, z: target.z - origin.z };
  const hit = raycastXzAabb(origin, dir, box) ?? closestXzAabb(origin, box);
  const dirLen = Math.hypot(dir.x, dir.z) || 1;
  const dx = dir.x / dirLen;
  const dz = dir.z / dirLen;
  const t = hit.t > 0 ? hit.t : Math.hypot(hit.x - origin.x, hit.z - origin.z);
  let px: number;
  let pz: number;
  if (t <= standoff) {
    px = origin.x;
    pz = origin.z;
  } else {
    px = origin.x + dx * (t - standoff);
    pz = origin.z + dz * (t - standoff);
  }
  const yaw = Math.atan2(hit.x - origin.x, hit.z - origin.z);
  const distance = Math.hypot(px - origin.x, pz - origin.z);
  return {
    point: { x: px, y, z: pz },
    hit: { x: hit.x, y, z: hit.z },
    normal: { x: hit.nx, z: hit.nz },
    yaw,
    distance,
    arrived: t <= standoff || distance <= 1e-3,
  };
}

export function kvStore(store?: KvStore | null): KvStore | null {
  if (store === null) return null;
  if (store) return store;
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function loadPortionCount(store?: KvStore | null): number {
  try {
    const kv = kvStore(store);
    if (!kv) return 0;
    const raw = kv.getItem(PORTION_STORAGE_KEY);
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    const n = parsed && typeof parsed === 'object' && 'portions' in parsed
      ? (parsed as { portions: unknown }).portions
      : parsed;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  } catch {
    return 0;
  }
}

export function savePortionCount(n: number, store?: KvStore | null): void {
  try {
    const kv = kvStore(store);
    if (!kv) return;
    kv.setItem(PORTION_STORAGE_KEY, JSON.stringify({ portions: n }));
  } catch {
    /* quota / private mode */
  }
}

export class UniformGrid {
  readonly cell: number;
  private readonly bins = new Map<string, number[]>();

  constructor(cell: number) {
    this.cell = cell;
  }

  clear(): void {
    this.bins.clear();
  }

  private key(ix: number, iy: number, iz: number): string {
    return `${ix},${iy},${iz}`;
  }

  private cellOf(p: Vec3): [number, number, number] {
    return [
      Math.floor(p.x / this.cell),
      Math.floor(p.y / this.cell),
      Math.floor(p.z / this.cell),
    ];
  }

  insert(id: number, p: Vec3): void {
    const [ix, iy, iz] = this.cellOf(p);
    const k = this.key(ix, iy, iz);
    const bin = this.bins.get(k);
    if (bin) bin.push(id);
    else this.bins.set(k, [id]);
  }

  query(p: Vec3, radius: number): number[] {
    const r = Math.max(this.cell, radius);
    const [cx, cy, cz] = this.cellOf(p);
    const n = Math.ceil(r / this.cell);
    const out: number[] = [];
    for (let ix = cx - n; ix <= cx + n; ix++) {
      for (let iy = cy - n; iy <= cy + n; iy++) {
        for (let iz = cz - n; iz <= cz + n; iz++) {
          const bin = this.bins.get(this.key(ix, iy, iz));
          if (bin) out.push(...bin);
        }
      }
    }
    return out;
  }
}

export function massesFromFracture(fractured: FracturedCurd): number[] {
  const volScale = fractured.totalVolumeMm3 > 0
    ? CURD_TOTAL_MASS_G / (fractured.totalVolumeMm3 / 1000 * CURD_DENSITY_G_CM3)
    : 1;
  return fractured.cells.map((c) => (c.volumeMm3 / 1000) * CURD_DENSITY_G_CM3 * volScale);
}

function neighbourRadiusMm(): number {
  return Math.max(mm(CURD_MM.width) / 8, mm(CURD_MM.length) / 8) * 2.15;
}

/** Strength falls off in 3D toward the chunk centroid. Pass `contactReachMm()` when the target is a Voronoi centroid. */
export function sampleContactFields(
  sensors: readonly Vec3[],
  target: Vec3 | null,
  profile: FoodProfile,
  radius = contactRadiusMm(),
): ContactFields {
  if (!target || sensors.length === 0) {
    return { sweet: 0, aa: 0, sour: 0, bitter: 0, strength: 0 };
  }
  let g = 0;
  for (const s of sensors) {
    g = Math.max(g, clamp01(1 - hypot3(s, target) / radius));
  }
  return {
    sweet: profile.sweet * g,
    aa: profile.aa * g,
    sour: profile.sour * g,
    bitter: profile.bitter * g,
    strength: g,
  };
}

/**
 * Map contact chemistry onto whole-channel gustatory Poisson rates.
 * MaleCNS has no sweet/bitter receptor split, so we do not pick a sugar-only
 * subset of seeds — both roles receive a drive scaled by the profile.
 *
 * Falloff radius must match `nearestUneaten` (`contactReachMm` = contact
 * radius plus chunk half-extent). A 6 mm 3D radius to the centroid misses
 * even a labellum standing on the top face: Voronoi centroids sit millimetres
 * inside the block.
 */
export function contactToGustRates(contact: ContactFields, pumping: boolean): GustRates {
  const drive = (contact.sweet + 0.45 * contact.aa + 0.15 * contact.sour) * (1 - contact.bitter);
  const gated = clamp01(drive);
  return {
    labellarHz: LABELLAR_RATE_MAX_HZ * gated,
    pharyngealHz: pumping ? PHARYNGEAL_RATE_MAX_HZ * gated : 0,
  };
}

export function sampleChemo(
  sensors: readonly Vec3[],
  nearest: Vec3 | null,
  flyXZ: XZ,
  foodXZ: XZ,
  pumping: boolean,
  profile: FoodProfile = TWAROG_MAMUTA_WANILIOWY,
  radius = contactRadiusMm(),
): ChemoSample {
  const contact = sampleContactFields(sensors, nearest, profile, radius);
  return {
    contact,
    odor: odorConcentration(flyXZ, foodXZ, profile.odor),
    odorYaw: odorGradientYaw(flyXZ, foodXZ),
    rates: contactToGustRates(contact, pumping),
  };
}

export class TwarogSystem {
  readonly chunks: ChunkRecord[];
  readonly totalMassGrams: number;
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  biteFront: Vec3;
  readonly grid: UniformGrid;
  lodBlend = 0;
  portionCount: number;
  refillT = 0;
  refilling = false;
  /** 0 → 1 after a refill; 1 while a portion is already on the table. */
  appearT = 1;
  lastBiteFront: Vec3;
  private remaining = 0;
  private consuming: { index: number; elapsed: number; duration: number } | null = null;
  private readonly rng: Xoshiro128ss;
  private readonly store: KvStore | null | undefined;
  private readonly initialBiteFront: Vec3;
  /**
   * Opening bite: chunks that start every portion already eaten (authored
   * crater, see CURD_BITE_MM). `biteAnchor` is its centre on the top face.
   */
  private readonly openingBite: ReadonlySet<number>;
  readonly biteAnchor: Vec3 | null;

  constructor(
    chunks: Array<Omit<ChunkRecord, 'topY' | 'radiusXz'> & Partial<Pick<ChunkRecord, 'topY' | 'radiusXz'>>>,
    biteFront: Vec3,
    opts: {
      seed?: number;
      store?: KvStore | null;
      hx?: number;
      hy?: number;
      hz?: number;
      openingBite?: readonly number[];
      biteAnchor?: Vec3;
    } = {},
  ) {
    const defaultR = Math.max(2, (opts.hx ?? mm(CURD_MM.width) / 2) / 8);
    this.chunks = chunks.map((c) => ({
      ...c,
      topY: c.topY ?? c.centroid.y + defaultR,
      radiusXz: c.radiusXz ?? defaultR,
    }));
    this.biteFront = biteFront;
    this.initialBiteFront = { ...biteFront };
    this.lastBiteFront = { ...biteFront };
    this.hx = opts.hx ?? mm(CURD_MM.width) / 2;
    this.hy = opts.hy ?? mm(CURD_MM.height) / 2;
    this.hz = opts.hz ?? mm(CURD_MM.length) / 2;
    this.totalMassGrams = chunks.reduce((s, c) => s + c.massGrams, 0);
    this.grid = new UniformGrid(mm(CURD_MM.width) / 8);
    this.rng = new Xoshiro128ss(opts.seed ?? 1);
    this.store = opts.store;
    this.portionCount = loadPortionCount(this.store);
    this.openingBite = new Set(opts.openingBite ?? []);
    this.biteAnchor = opts.biteAnchor ? { ...opts.biteAnchor } : null;
    this.applyOpeningBite();
    this.rebuildGrid();
    this.remaining = this.uneatenMass();
  }

  /** Mark the opening-bite chunks eaten and point the wet spot at the crater. */
  private applyOpeningBite(): void {
    for (const i of this.openingBite) {
      const c = this.chunks[i];
      if (c) c.eaten = true;
    }
    if (this.biteAnchor && this.openingBite.size > 0) {
      this.lastBiteFront = { ...this.biteAnchor };
    }
  }

  /** True while nothing beyond the opening bite has been eaten. */
  pristine(): boolean {
    return this.uneatenCount === this.chunkCount - this.openingBite.size;
  }

  /** Chunk indices that start every portion eaten. */
  get openingBiteIndices(): number[] {
    return [...this.openingBite];
  }

  /** Grams on the table at portion start (total minus the opening bite). */
  get portionMassGrams(): number {
    let s = 0;
    for (const c of this.chunks) if (!this.openingBite.has(c.index)) s += c.massGrams;
    return s;
  }

  static fromFracture(
    fractured: FracturedCurd,
    opts: { seed?: number; store?: KvStore | null } = {},
  ): TwarogSystem {
    const masses = massesFromFracture(fractured);
    const chunks: ChunkRecord[] = fractured.cells.map((cell, index) => {
      let topY = cell.centroid.y;
      let radiusXz = 1.5;
      for (const v of cell.poly.vertices) {
        if (v.y > topY) topY = v.y;
        radiusXz = Math.max(radiusXz, Math.hypot(v.x - cell.centroid.x, v.z - cell.centroid.z));
      }
      return {
        index,
        centroid: { ...cell.centroid },
        massGrams: masses[index]!,
        biteDistance: cell.biteDistance,
        neighbours: [],
        eaten: false,
        topY,
        radiusXz,
      };
    });
    const rad = neighbourRadiusMm();
    for (let i = 0; i < chunks.length; i++) {
      for (let j = i + 1; j < chunks.length; j++) {
        if (hypot3(chunks[i]!.centroid, chunks[j]!.centroid) <= rad) {
          chunks[i]!.neighbours.push(j);
          chunks[j]!.neighbours.push(i);
        }
      }
    }
    return new TwarogSystem(chunks, { ...fractured.biteFront }, {
      ...opts,
      hx: fractured.hx,
      hy: fractured.hy,
      hz: fractured.hz,
      openingBite: fractured.openingBite,
      biteAnchor: fractured.biteAnchor,
    });
  }

  get remainingMassGrams(): number {
    return this.remaining;
  }

  get uneatenCount(): number {
    let n = 0;
    for (const c of this.chunks) if (!c.eaten) n++;
    return n;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  /** 1 = fully shrunk. */
  consumeProgress(index: number): number {
    if (this.chunks[index]?.eaten) return 1;
    if (this.consuming?.index === index) {
      return clamp01(this.consuming.elapsed / this.consuming.duration);
    }
    return 0;
  }

  scaleOf(index: number): number {
    return 1 - this.consumeProgress(index);
  }

  isExposed(index: number): boolean {
    const c = this.chunks[index];
    if (!c || c.eaten) return false;
    return c.neighbours.some((n) => this.chunks[n]!.eaten);
  }

  reset(): void {
    for (const c of this.chunks) c.eaten = false;
    this.consuming = null;
    this.refilling = false;
    this.refillT = 0;
    this.lodBlend = 0;
    this.appearT = 1;
    this.biteFront = { ...this.initialBiteFront };
    this.lastBiteFront = { ...this.biteFront };
    // A fresh portion is bitten too; otherwise nextPortion() would bring
    // back an intact block and the LOD (built minus the crater) would lie.
    this.applyOpeningBite();
    this.rebuildGrid();
    this.remaining = this.uneatenMass();
  }

  /** Fresh 250 g portion after EXIT_FRAME. Authored eternity loop, not connectome. */
  nextPortion(): number {
    this.reset();
    this.portionCount += 1;
    savePortionCount(this.portionCount, this.store);
    this.appearT = 0;
    return this.portionCount;
  }

  /** Intact block AABB in world XZ (food is axis-aligned). */
  worldAabb(origin: XZ): XzAabb {
    return { cx: origin.x, cz: origin.z, hx: this.hx, hz: this.hz };
  }

  /**
   * AABB of remaining uneaten chunk centroids, padded to the hull. Recedes
   * as a bite face is eaten so later approaches target the new surface.
   */
  uneatenAabb(origin: XZ): XzAabb {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let n = 0;
    for (const c of this.chunks) {
      if (c.eaten) continue;
      n++;
      if (c.centroid.x < minX) minX = c.centroid.x;
      if (c.centroid.x > maxX) maxX = c.centroid.x;
      if (c.centroid.z < minZ) minZ = c.centroid.z;
      if (c.centroid.z > maxZ) maxZ = c.centroid.z;
    }
    if (n === 0) return this.worldAabb(origin);
    const pad = Math.max(this.hx, this.hz) / 10;
    return {
      cx: origin.x + (minX + maxX) / 2,
      cz: origin.z + (minZ + maxZ) / 2,
      hx: (maxX - minX) / 2 + pad,
      hz: (maxZ - minZ) / 2 + pad,
    };
  }

  /** Intact hull (the opening bite does not count), or the remaining-chunk AABB once a bite face has receded. */
  foodBounds(origin: XZ): XzAabb {
    if (this.pristine()) return this.worldAabb(origin);
    return this.uneatenAabb(origin);
  }

  /**
   * Surface standoff: ray from the fly toward the food centroid, first hit
   * on the uneaten block (or remaining-chunk AABB once fractured), then
   * `standoffMm` back along that ray.
   */
  approachTarget(fly: Vec3, foodOrigin: Vec3, standoff = standoffMm()): ApproachTarget {
    const box = this.foodBounds(foodOrigin);
    const target = standoffOnRay(fly, foodOrigin, box, standoff);
    target.point.y = fly.y;
    target.hit.y = foodOrigin.y - this.hy * 0.45;
    return target;
  }

  /** Push the body root outside the remaining food volume (padded by half body length). */
  clampRoot(fly: Vec3, foodOrigin: Vec3, pad = bodyCollisionPadMm()): Vec3 {
    const out = clampOutsideXzAabb(fly, this.foodBounds(foodOrigin), pad);
    return { x: out.x, y: fly.y, z: out.z };
  }

  /**
   * World Y of the standing surface at `(x, z)`: the top of the tallest uneaten
   * chunk whose XZ footprint contains the point, else the intact hull top if
   * the point is still in the uneaten footprint, else the cutting-board top
   * inside its footprint, else 0 (table). Collision is still XZ for the
   * pouch on the ground; this is the vertical support.
   */
  supportHeightAt(x: number, z: number, foodOrigin: Vec3): number {
    const lx = x - foodOrigin.x;
    const lz = z - foodOrigin.z;
    let best = -Infinity;
    for (const c of this.chunks) {
      if (c.eaten) continue;
      if (Math.hypot(lx - c.centroid.x, lz - c.centroid.z) <= c.radiusXz) {
        const top = foodOrigin.y + c.topY;
        if (top > best) best = top;
      }
    }
    let foodY = 0;
    if (best === -Infinity) {
      // Intact-hull fallback for footprint gaps between cell circles — but
      // never inside the opening-bite crater, which is genuinely open.
      if (
        this.pristine()
        && pointInXzAabb({ x, z }, this.worldAabb(foodOrigin))
        && !this.inOpeningBiteXz(lx, lz)
      ) {
        foodY = foodOrigin.y + this.hy;
      }
    } else {
      foodY = best;
    }
    return composeSupport(x, z, foodY);
  }

  /** Local XZ inside the opening-bite footprint (radiusXz around the anchor). */
  inOpeningBiteXz(lx: number, lz: number): boolean {
    if (!this.biteAnchor || this.openingBite.size === 0) return false;
    return Math.hypot(lx - this.biteAnchor.x, lz - this.biteAnchor.z) <= CURD_BITE_MM.radiusXz;
  }

  /**
   * Project the body onto a vertical food face (outward XZ normal) so a side
   * approach can walk up the wall. Y is left unchanged for the caller to climb.
   */
  projectOntoVerticalFace(fly: Vec3, foodOrigin: Vec3, standoff = 0): {
    x: number;
    y: number;
    z: number;
    nx: number;
    nz: number;
  } {
    const box = this.foodBounds(foodOrigin);
    const hit = closestXzAabb(fly, box);
    const nlen = Math.hypot(hit.nx, hit.nz) || 1;
    const nx = hit.nx / nlen;
    const nz = hit.nz / nlen;
    return {
      x: hit.x + nx * standoff,
      y: fly.y,
      z: hit.z + nz * standoff,
      nx,
      nz,
    };
  }

  /**
   * Recompute bite-front from the fly's actual approach corner (local space)
   * so eating starts where she stands, not a fixed +X/−Z corner.
   */
  followBiteFront(flyLocal: Vec3): void {
    const box: XzAabb = this.foodBounds({ x: 0, z: 0 });
    const target = standoffOnRay(flyLocal, { x: 0, z: 0 }, box, 0);
    const y = -this.hy * 0.45;
    this.biteFront = { x: target.hit.x, y, z: target.hit.z };
    // With an opening bite the wet spot stays on the crater until she really bites.
    if (this.pristine() && this.openingBite.size === 0) this.lastBiteFront = { ...this.biteFront };
    for (const c of this.chunks) {
      c.biteDistance = hypot3(c.centroid, this.biteFront);
    }
  }

  nearestUneaten(point: Vec3, radius = contactRadiusMm()): number | null {
    let best = -1;
    let bestD = radius;
    for (const c of this.chunks) {
      if (c.eaten) continue;
      const d = hypot3(point, c.centroid);
      if (d <= bestD) {
        bestD = d;
        best = c.index;
      }
    }
    return best < 0 ? null : best;
  }

  /** Half-size of a mean Voronoi cell (mm). Labellum-to-centroid contact includes this. */
  chunkHalfExtentMm(): number {
    const meanG = this.totalMassGrams / Math.max(1, this.chunkCount);
    const volMm3 = (meanG / CURD_DENSITY_G_CM3) * 1000;
    return 0.5 * Math.cbrt(Math.max(0, volMm3));
  }

  /** Labellum reach for eating: fly contact radius plus a Voronoi cell (food does not scale). */
  contactReachMm(): number {
    return contactRadiusMm() + 2 * this.chunkHalfExtentMm();
  }

  /** Instantly eat one uneaten chunk. Returns grams ingested (0 if already eaten). */
  commitChunk(index: number): number {
    const c = this.chunks[index];
    if (!c || c.eaten) return 0;
    c.eaten = true;
    if (this.consuming?.index === index) this.consuming = null;
    this.lastBiteFront = { ...c.centroid };
    this.remaining = this.uneatenMass();
    this.rebuildGrid();
    return c.massGrams;
  }

  step(input: TwarogStepInput): TwarogStepResult {
    const dt = Math.max(0, input.dt);
    const events: TwarogEvent[] = [];
    const radius = this.contactReachMm();
    const fade = lodFadeSec();
    const lodTarget = input.cameraDist <= lodDistanceMm() ? 1 : 0;
    if (fade > 0) {
      const dir = Math.sign(lodTarget - this.lodBlend);
      this.lodBlend = clamp01(this.lodBlend + dir * (dt / fade));
      if (Math.abs(this.lodBlend - lodTarget) < 0.02) this.lodBlend = lodTarget;
    } else {
      this.lodBlend = lodTarget;
    }
    if (this.appearT < 1) {
      this.appearT = Math.min(1, this.appearT + dt / APPEAR_FADE_S);
    }

    if (this.refilling) {
      this.refillT += dt;
      if (this.refillT >= REFILL_ANIM_S) {
        this.finishRefill();
        events.push({ type: 'refill', portion: this.portionCount });
      }
    } else if (!this.consuming && this.remaining < ETERNITY_MASS_FRAC * this.totalMassGrams) {
      this.refilling = true;
      this.refillT = 0;
      this.consuming = null;
      events.push({ type: 'groom' });
    } else if (input.pumping) {
      if (!this.consuming) {
        const near = this.nearestUneaten(input.labellum, radius);
        if (near !== null) {
          this.consuming = { index: near, elapsed: 0, duration: PUMP_PERIOD_S };
        }
      }
      if (this.consuming) {
        const c = this.chunks[this.consuming.index]!;
        if (hypot3(input.labellum, c.centroid) <= radius * 1.35) {
          this.consuming.elapsed += dt;
          if (this.consuming.elapsed >= this.consuming.duration) {
            const ev = this.completeConsume(this.consuming.index);
            if (ev) events.push(ev);
          }
        }
      }
    } else if (this.consuming) {
      const ev = this.completeConsume(this.consuming.index);
      if (ev) events.push(ev);
    }

    const sensors = input.sensors.length ? [...input.sensors] : [input.labellum];
    let nearestIdx = this.nearestUneaten(input.labellum, radius);
    if (nearestIdx === null && input.tasting) {
      nearestIdx = this.nearestUneaten(this.biteFront, radius);
    }
    if (input.tasting && nearestIdx !== null) {
      sensors.push(this.chunks[nearestIdx]!.centroid);
    }
    const nearest = nearestIdx !== null ? this.chunks[nearestIdx]!.centroid : null;
    const chemo = sampleChemo(
      sensors,
      nearest,
      input.flyXZ,
      input.foodXZ,
      input.pumping,
      input.profile ?? TWAROG_MAMUTA_WANILIOWY,
      radius,
    );

    return {
      events,
      chemo,
      lodBlend: this.lodBlend,
      refillT: this.refillT,
      remainingMassGrams: this.remaining,
    };
  }

  private completeConsume(index: number): ConsumeEvent | null {
    const mass = this.commitChunk(index);
    if (mass <= 0) return null;
    const span = CRUMB_MAX - CRUMB_MIN + 1;
    const crumbCount = CRUMB_MIN + (this.rng.nextUint32() % span);
    const c = this.chunks[index]!;
    return {
      type: 'consume',
      index,
      massGrams: mass,
      centroid: { ...c.centroid },
      crumbCount,
      exposed: c.neighbours.filter((n) => !this.chunks[n]!.eaten),
    };
  }

  private finishRefill(): void {
    this.reset();
    this.portionCount += 1;
    savePortionCount(this.portionCount, this.store);
    this.lodBlend = 1;
    this.appearT = 0;
    this.refilling = false;
    this.refillT = 0;
  }

  private uneatenMass(): number {
    let s = 0;
    for (const c of this.chunks) if (!c.eaten) s += c.massGrams;
    return s;
  }

  private rebuildGrid(): void {
    this.grid.clear();
    for (const c of this.chunks) {
      if (!c.eaten) this.grid.insert(c.index, c.centroid);
    }
  }
}

export const CONTACT_RADIUS_MM = contactRadiusMm;
export { contactRadiusMm, lodDistanceMm, lodFadeSec, LOD_BODY_LENGTHS, LOD_FADE_MS, CONTACT_RADIUS_BODY_LENGTHS, ETERNITY_MASS_FRAC, CURD_CHUNK_COUNT };

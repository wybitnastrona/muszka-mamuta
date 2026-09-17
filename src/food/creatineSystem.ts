/**
 * Creatine powder ledger + scoop fill. Extends TwarogSystem so the director
 * keeps the same consume / approach / chemo API. Scoop chemistry is authored:
 * MaleCNS has no creatine / Ir76b annotations (verified 0 hits).
 */
import { CREATINE_KFD, type FoodProfile } from './foodProfile.ts';
import { makePowderChunks, pileHeightAt } from './powderPile.ts';
import {
  contactToGustRates,
  TwarogSystem,
  type ChemoSample,
  type KvStore,
  type TwarogStepInput,
  type TwarogStepResult,
  type Vec3,
  type XzAabb,
} from './twarogSystem.ts';
import {
  PILE_MM,
  SCOOP_CAPACITY_G,
  SCOOP_EMPTY_S,
  TUB_MM,
  flyVisualLengthMm,
  mm,
  tableTopY,
  tubInnerRadiusMm,
} from '../scene/scale.ts';
import { scoopEatStand } from '../scene/layout.ts';

export type ScoopMode = 'well' | 'held' | 'dropped';

export class CreatineSystem extends TwarogSystem {
  scoopFill = 0;
  scoopMode: ScoopMode = 'well';
  readonly profile: FoodProfile;
  private scoopMassGrams = 0;
  private lastDipIndex = 0;

  constructor(
    chunks: ConstructorParameters<typeof TwarogSystem>[0],
    biteFront: ConstructorParameters<typeof TwarogSystem>[1],
    opts: ConstructorParameters<typeof TwarogSystem>[2] & { profile?: FoodProfile } = {},
  ) {
    super(chunks, biteFront, opts);
    this.profile = opts.profile ?? CREATINE_KFD;
  }

  static create(opts: { seed?: number; store?: KvStore | null; profile?: FoodProfile } = {}): CreatineSystem {
    const spec = makePowderChunks({ seed: opts.seed });
    const tubR = mm(TUB_MM.diameter) / 2;
    const sys = new CreatineSystem(spec.chunks, spec.biteFront, {
      seed: opts.seed,
      store: opts.store,
      hx: tubR,
      hy: mm(TUB_MM.height) / 2,
      hz: tubR,
      profile: opts.profile,
    });
    sys.fillWell();
    return sys;
  }

  /** Collision / approach hull is the tub, not the shrinking powder AABB. */
  override foodBounds(origin: { x: number; z: number }): XzAabb {
    const r = mm(TUB_MM.diameter) / 2;
    return { cx: origin.x, cz: origin.z, hx: r, hz: r };
  }

  /** In the well the fly stands on the powder mound, not the table. */
  override supportHeightAt(x: number, z: number, foodOrigin: Vec3): number {
    const dx = x - foodOrigin.x;
    const dz = z - foodOrigin.z;
    if (Math.hypot(dx, dz) < tubInnerRadiusMm()) {
      return tableTopY() + mm(TUB_MM.wall) + pileHeightAt(
        dx,
        dz,
        mm(PILE_MM.radius),
        mm(PILE_MM.height),
      );
    }
    return tableTopY();
  }

  pick(): void {
    this.scoopMode = 'held';
  }

  drop(): void {
    this.scoopMode = 'dropped';
  }

  resetScoop(): void {
    this.scoopMode = 'well';
    this.scoopFill = 0;
    this.scoopMassGrams = 0;
  }

  /** Pre-fill the scoop on the powder surface. Stays in the well until pick(). */
  fillWell(grams = SCOOP_CAPACITY_G): number {
    const taken = this.takeIntoScoop(grams);
    this.scoopMode = 'well';
    return taken;
  }

  /** Move surface powder into the scoop (mass leaves the pile). */
  dip(grams = SCOOP_CAPACITY_G): number {
    const taken = this.takeIntoScoop(grams);
    this.scoopMode = 'held';
    return taken;
  }

  private takeIntoScoop(grams: number): number {
    const ranked = this.chunks
      .filter((c) => !c.eaten)
      .sort((a, b) => b.topY - a.topY || a.biteDistance - b.biteDistance);
    let taken = 0;
    for (const c of ranked) {
      if (taken >= grams) break;
      const got = this.commitChunk(c.index);
      if (got > 0) this.lastDipIndex = c.index;
      taken += got;
    }
    this.scoopMassGrams = taken;
    this.scoopFill = taken > 0 ? 1 : 0;
    return taken;
  }

  override reset(): void {
    super.reset();
    this.resetScoop();
    this.fillWell();
  }

  override step(input: TwarogStepInput): TwarogStepResult {
    const holding = this.scoopMode === 'held';
    const stand = scoopEatStand();
    const nearBowl = Math.hypot(input.flyXZ.x - stand.x, input.flyXZ.z - stand.z)
      < flyVisualLengthMm() * 1.8;
    const labellumDown = input.tasting || input.pumping;
    const tastingBowl = this.scoopMode === 'dropped' && this.scoopFill > 0 && nearBowl && labellumDown;
    const siphonEvents: TwarogStepResult['events'] = [];
    if (tastingBowl && input.pumping) {
      const before = this.scoopFill;
      this.scoopFill = Math.max(0, this.scoopFill - input.dt / SCOOP_EMPTY_S);
      const grams = (before - this.scoopFill) * this.scoopMassGrams;
      if (grams > 1e-6) {
        siphonEvents.push({
          type: 'consume',
          index: this.lastDipIndex,
          massGrams: grams,
          centroid: { ...this.biteFront },
          crumbCount: 2,
          exposed: [],
        });
      }
    }
    const labellum = tastingBowl ? this.biteFront : input.labellum;
    const out = super.step({
      ...input,
      pumping: tastingBowl || holding ? false : input.pumping,
      labellum,
      tasting: input.tasting || tastingBowl,
      profile: input.profile ?? this.profile,
    });
    if (tastingBowl) {
      const g = this.scoopFill;
      const p = input.profile ?? this.profile;
      const contact = {
        sweet: p.sweet * g,
        aa: p.aa * g,
        sour: p.sour * g,
        bitter: p.bitter * g,
        strength: g,
      };
      const chemo: ChemoSample = {
        ...out.chemo,
        contact,
        rates: contactToGustRates(contact, input.pumping),
      };
      return { ...out, chemo, events: [...out.events, ...siphonEvents] };
    }
    return siphonEvents.length ? { ...out, events: [...out.events, ...siphonEvents] } : out;
  }
}

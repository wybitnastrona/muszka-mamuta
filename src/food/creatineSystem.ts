/**
 * Creatine powder ledger + scoop fill. Extends TwarogSystem so the director
 * keeps the same consume / approach / chemo API. Scoop chemistry is authored:
 * MaleCNS has no creatine / Ir76b annotations (verified 0 hits).
 */
import { CREATINE_KFD, type FoodProfile } from './foodProfile.ts';
import { makePowderChunks } from './powderPile.ts';
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
import { SCOOP_CAPACITY_G, SCOOP_EMPTY_S, TUB_MM, mm, tableTopY } from '../scene/scale.ts';

export type ScoopMode = 'table' | 'held' | 'dropped';

export class CreatineSystem extends TwarogSystem {
  scoopFill = 0;
  scoopMode: ScoopMode = 'table';
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
    return new CreatineSystem(spec.chunks, spec.biteFront, {
      seed: opts.seed,
      store: opts.store,
      hx: tubR,
      hy: mm(TUB_MM.height) / 2,
      hz: tubR,
      profile: opts.profile,
    });
  }

  /** Collision / approach hull is the tub, not the shrinking powder AABB. */
  override foodBounds(origin: { x: number; z: number }): XzAabb {
    const r = mm(TUB_MM.diameter) / 2;
    return { cx: origin.x, cz: origin.z, hx: r, hz: r };
  }

  /** The fly stands on the table, never in the well. */
  override supportHeightAt(_x: number, _z: number, _foodOrigin: Vec3): number {
    return tableTopY();
  }

  pick(): void {
    this.scoopMode = 'held';
  }

  drop(): void {
    this.scoopMode = 'dropped';
  }

  resetScoop(): void {
    this.scoopMode = 'table';
    this.scoopFill = 0;
    this.scoopMassGrams = 0;
  }

  /** Move surface powder into the scoop (mass leaves the pile). */
  dip(grams = SCOOP_CAPACITY_G): number {
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
    this.scoopMode = 'held';
    return taken;
  }

  override reset(): void {
    super.reset();
    this.resetScoop();
  }

  override step(input: TwarogStepInput): TwarogStepResult {
    const holding = this.scoopMode === 'held';
    const tastingBowl = holding && this.scoopFill > 0;
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
      pumping: holding ? false : input.pumping,
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

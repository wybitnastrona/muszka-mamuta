/**
 * HUD copy. Feeding-gate phases map from the FSM; loop/gag lines are authored.
 * Polish strings are the on-screen originals; English is the toggle.
 */
import type { FeedingState } from '../body/types.ts';
import { GAG_CAPTIONS_PL, type GagId } from '../body/gags.ts';
import type { Lang } from '../i18n.ts';

export const PHASE_IDS = ['APPROACH', 'TASTE', 'EXTEND', 'PUMP', 'RETRACT', 'REST'] as const;
export type PhaseId = (typeof PHASE_IDS)[number];

export const PHASE_STRIP: Record<PhaseId, { label: string; pl: string; en: string }> = {
  APPROACH: { label: 'PODEJŚCIE', pl: 'Wyczuwa proszek', en: 'Sensing powder' },
  TASTE: { label: 'SMAK', pl: 'Sprawdza nogą', en: 'Tasting with a foot' },
  EXTEND: { label: 'WYSUŃ', pl: 'Wysuwa ryjek', en: 'Extending the proboscis' },
  PUMP: { label: 'POMPUJ', pl: 'Pompuje', en: 'Pumping' },
  RETRACT: { label: 'SCHOWAJ', pl: 'Chowa ryjek', en: 'Retracting the proboscis' },
  REST: { label: 'ODPOCZYNEK', pl: 'Trawi', en: 'Digesting' },
};

export const LOOP_CAPTIONS_PL: Record<string, string> = {
  ORBIT: 'Krąży',
  ORBIT_SHORT: 'Krąży',
  LAND_TOP: 'Ląduje',
  LAND_MILL: 'Ląduje',
  TAKEOFF_MILL: 'Startuje',
  TAKEOFF_EXIT: 'Startuje',
  EXIT_FRAME: 'Startuje',
  GROOM_SHORT: 'Czyści się',
  GROOM_FULL: 'Czyści się',
  WAKE: 'Czyści się',
  NAP: 'Trawi',
  WALK_SCOOP: 'Idzie po miarkę',
  APPROACH_TUB: 'Podchodzi do puszki',
  PICK_SCOOP: 'Podnosi miarkę',
  DIP_SCOOP: 'Nabiera proszek',
  DROP_SCOOP: 'Odkłada miarkę',
  WALK_MILL: 'Chodzi na bieżni',
  WALK_BIPED: 'Chodzi na dwóch',
  WALK_BIPED_ON_MILL: 'Chodzi na dwóch',
  FLY_INTO_TUB: 'Wpada do puszki',
  FLY_OUT_WITH_SCOOP: 'Wylatuje z miarką',
  AUTONOMOUS: 'Wędruje',
  EAT_SCOOP: 'Je kreatynę',
};

const LOOP_CAPTIONS_EN: Record<string, string> = {
  'Krąży': 'Orbiting',
  'Ląduje': 'Landing',
  'Startuje': 'Taking off',
  'Czyści się': 'Grooming',
  'Trawi': 'Digesting',
  'Przechodzi': 'Walking',
  'Idzie po miarkę': 'Walking to the scoop',
  'Podchodzi do puszki': 'Approaching the tub',
  'Podnosi miarkę': 'Picking up the scoop',
  'Nabiera proszek': 'Scooping powder',
  'Odkłada miarkę': 'Putting the scoop down',
  'Chodzi na bieżni': 'Walking the mill',
  'Chodzi na dwóch': 'Walking on two legs',
  'Wpada do puszki': 'Flying into the tub',
  'Wylatuje z miarką': 'Flying out with the scoop',
  'Wędruje': 'Roaming',
  'Je kreatynę': 'Eating creatine',
  'Śpiewa do krowy': 'Singing to the cow',
  'Śliska folia': 'Slippery foil',
  'Okruszek': 'A crumb',
  'Za dużo zjadła': 'She ate too much',
  'Cień łyżki': 'Spoon shadow',
  'Czyta skład': 'Reading the label',
  'Wyczuwa wanilię': 'Sensing vanilla',
  'Sprawdza nogą': 'Tasting with a foot',
  'Wysuwa ryjek': 'Extending the proboscis',
  'Pompuje': 'Pumping',
  'Chowa ryjek': 'Retracting the proboscis',
};

export const CAPTION_EN = LOOP_CAPTIONS_EN;

export function feedingToPhase(state: FeedingState): PhaseId {
  if (state === 'TASTE') return 'TASTE';
  if (state === 'EXTEND') return 'EXTEND';
  if (state === 'PUMP') return 'PUMP';
  if (state === 'RETRACT') return 'RETRACT';
  if (state === 'REST') return 'REST';
  return 'APPROACH';
}

export function loopCaptionPl(macro: string): string | null {
  if (macro === 'GROUND') return null;
  return LOOP_CAPTIONS_PL[macro] ?? null;
}

export function translateCaption(pl: string, lang: Lang): string {
  if (!pl) return '';
  if (lang === 'en') return LOOP_CAPTIONS_EN[pl] ?? pl;
  return pl;
}

export type HudCaption = {
  phase: PhaseId;
  headline: string;
  phaseLine: string;
  highlightPhase: boolean;
};

export function resolveHudCaption(args: {
  lang: Lang;
  caption: string;
  macro: string;
  hudState: FeedingState;
  gag: GagId | null;
}): HudCaption {
  const phase = feedingToPhase(args.hudState);
  const phaseLine = args.lang === 'en' ? PHASE_STRIP[phase].en : PHASE_STRIP[phase].pl;
  const gagLine = args.gag ? GAG_CAPTIONS_PL[args.gag] : '';
  const authored = args.caption || gagLine || loopCaptionPl(args.macro) || '';
  const eating = args.macro === 'GROUND' || args.macro === 'EAT_SCOOP'
    || args.macro === 'EAT_TOP' || args.macro === 'EAT_SIDE'
    || args.macro === 'EAT_SIDE_2' || args.macro === 'WALK_TOP';
  const headline = translateCaption(authored, args.lang) || phaseLine;
  return { phase, headline, phaseLine, highlightPhase: eating && !authored };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export function formatGrams(grams: number, lang: Lang): string {
  const n = Math.max(0, grams);
  const raw = n.toFixed(1);
  return `${lang === 'pl' ? raw.replace('.', ',') : raw} g`;
}

export function formatBites(current: number, target: number, lang: Lang): string {
  const n = Math.max(0, current);
  const cap = Math.max(1, target);
  return lang === 'pl' ? `KĘSY ${n}/${cap}` : `BITES ${n}/${cap}`;
}

export function formatPortion(n: number, lang: Lang): string {
  return lang === 'pl' ? `PORCJA #${n}` : `PORTION #${n}`;
}

export function formatTimeReadout(sec: number, lang: Lang): string {
  const clock = formatClock(sec);
  return lang === 'pl' ? `CZAS ${clock}` : `TIME ${clock}`;
}

export function formatSubCaption(bites: number, grams: number, lang: Lang): string {
  const g = formatGrams(grams, lang);
  return lang === 'pl'
    ? `Kęs ${bites} · ${g} zjedzone łącznie`
    : `Bite ${bites} · ${g} eaten in total`;
}

export function formatSpikeCount(n: number, lang: Lang): string {
  return lang === 'pl'
    ? `${n} iglic / 20 ms · MN9 · SMAK`
    : `${n} spikes / 20 ms · MN9 · TASTE`;
}

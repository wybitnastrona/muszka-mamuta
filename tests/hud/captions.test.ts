import { describe, expect, it } from 'vitest';
import {
  PHASE_STRIP,
  PHASE_IDS,
  formatBites,
  formatClock,
  formatGrams,
  formatSpikeCount,
  formatSubCaption,
  resolveHudCaption,
  translateCaption,
} from '../../src/hud/captions.ts';
import { parseReelMode, REEL_SLOGAN_PL } from '../../src/hud/reel.ts';
import { RASTER_COUNT_MS, SpikeHistory } from '../../src/hud/spikeHistory.ts';
import { GAG_CAPTIONS_PL, GAG_IDS } from '../../src/body/gags.ts';

describe('HUD captions', () => {
  it('uses the exact Polish feeding-phase lines', () => {
    expect(PHASE_IDS).toEqual(['APPROACH', 'TASTE', 'EXTEND', 'PUMP', 'RETRACT', 'REST']);
    expect(PHASE_STRIP.APPROACH).toMatchObject({ label: 'PODEJŚCIE', pl: 'Wyczuwa proszek' });
    expect(PHASE_STRIP.TASTE).toMatchObject({ label: 'SMAK', pl: 'Sprawdza nogą' });
    expect(PHASE_STRIP.EXTEND).toMatchObject({ label: 'WYSUŃ', pl: 'Wysuwa ryjek' });
    expect(PHASE_STRIP.PUMP).toMatchObject({ label: 'POMPUJ', pl: 'Pompuje' });
    expect(PHASE_STRIP.RETRACT).toMatchObject({ label: 'SCHOWAJ', pl: 'Chowa ryjek' });
    expect(PHASE_STRIP.REST).toMatchObject({ label: 'ODPOCZYNEK', pl: 'Trawi' });
  });

  it('emits loop and gag headlines in Polish', () => {
    const orbit = resolveHudCaption({ lang: 'pl', caption: 'Krąży', macro: 'ORBIT', hudState: 'SEARCH', gag: null });
    expect(orbit.headline).toBe('Krąży');
    expect(orbit.highlightPhase).toBe(false);
    const taste = resolveHudCaption({ lang: 'pl', caption: '', macro: 'GROUND', hudState: 'TASTE', gag: null });
    expect(taste.headline).toBe('Sprawdza nogą');
    expect(taste.highlightPhase).toBe(true);
    expect(taste.phase).toBe('TASTE');
    for (const id of GAG_IDS) {
      const line = GAG_CAPTIONS_PL[id];
      const out = resolveHudCaption({ lang: 'pl', caption: line, macro: 'GAG', hudState: 'REST', gag: id });
      expect(out.headline).toBe(line);
    }
    expect(translateCaption('Czyści się', 'en')).toBe('Grooming');
    expect(translateCaption('Chodzi na bieżni', 'en')).toBe('Walking the mill');
  });

  it('formats readouts', () => {
    expect(formatClock(311)).toBe('5:11');
    expect(formatBites(0, 6, 'pl')).toBe('KĘSY 0/6');
    expect(formatGrams(12.4, 'pl')).toBe('12,4 g');
    expect(formatSubCaption(41, 12.4, 'pl')).toBe('Kęs 41 · 12,4 g zjedzone łącznie');
    expect(formatSpikeCount(12, 'pl')).toBe('12 iglic / 20 ms · MN9 · SMAK');
    expect(formatSpikeCount(12, 'en')).toBe('12 spikes / 20 ms · MN9 · TASTE');
  });
});

describe('reel query', () => {
  it('is on only for reel=1', () => {
    expect(parseReelMode('?reel=1')).toBe(true);
    expect(parseReelMode('?debug=weights')).toBe(false);
    expect(REEL_SLOGAN_PL).toContain('kreatyny');
  });
});

describe('spike history', () => {
  it('keeps 2000 ms and counts 20 ms', () => {
    const h = new SpikeHistory();
    h.push(1.0, [990, 995], [980]);
    h.push(2.05, [2040], [2035, 2045]);
    expect(h.mn9.every((t) => t >= h.nowMs - 2000)).toBe(true);
    expect(h.countIn(RASTER_COUNT_MS)).toBe(3);
  });
});

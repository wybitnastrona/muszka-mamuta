/**
 * Rolling MN9 / gustatory spike buffer for the HUD raster.
 * Times are simulation milliseconds from PopulationSummary (RATE_WINDOW_MS = 50).
 * Authored display; spikes themselves are the LIF worker.
 */
export const RASTER_WINDOW_MS = 2000;
export const RASTER_COUNT_MS = 20;

export class SpikeHistory {
  mn9: number[] = [];
  gust: number[] = [];
  nowMs = 0;

  push(timeSec: number, mn9TimesMs: readonly number[], gustTimesMs: readonly number[]): void {
    this.nowMs = timeSec * 1000;
    if (mn9TimesMs.length) this.mn9.push(...mn9TimesMs);
    if (gustTimesMs.length) this.gust.push(...gustTimesMs);
    this.trim(this.nowMs - RASTER_WINDOW_MS);
  }

  countIn(windowMs: number): number {
    const cut = this.nowMs - windowMs;
    let n = 0;
    for (const t of this.mn9) if (t >= cut) n++;
    for (const t of this.gust) if (t >= cut) n++;
    return n;
  }

  reset(): void {
    this.mn9.length = 0;
    this.gust.length = 0;
    this.nowMs = 0;
  }

  private trim(cut: number): void {
    if (this.mn9.length && this.mn9[0]! < cut) this.mn9 = this.mn9.filter((t) => t >= cut);
    if (this.gust.length && this.gust[0]! < cut) this.gust = this.gust.filter((t) => t >= cut);
  }
}

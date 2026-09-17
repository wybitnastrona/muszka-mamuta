import { describe, expect, it } from 'vitest';
import { GagPlayer } from '../../src/body/gags.ts';
import { SONG_ENVELOPE_HZ } from '../../src/body/wings.ts';

const ctx = {
  satiety: 0.8,
  cropVolume: 0,
  position: { x: 0, y: 2, z: 0 },
  heading: 0,
  pouch: { x: 0, y: 1.2, z: 0, yaw: 0 },
  food: { x: 0, y: 0, z: 0 },
  standingY: 2,
};

describe('courtship song wings', () => {
  it('puts a 5 Hz envelope and a 200 Hz blur fan on one wing only', () => {
    expect(SONG_ENVELOPE_HZ).toBe(5);
    const player = new GagPlayer();
    player.start('courtshipSong', ctx);
    let sawSoloBlur = false;
    let maxSong = 0;
    for (let i = 0; i < 900; i++) {
      const f = player.update(1 / 60, ctx);
      maxSong = Math.max(maxSong, Math.abs(f.wingSongL), Math.abs(f.wingSongR));
      if (f.wingBlurL > 0.2 && f.wingBlurR < 0.05) sawSoloBlur = true;
      if (f.wingBlurR > 0.2 && f.wingBlurL < 0.05) sawSoloBlur = true;
      if (f.done) break;
    }
    expect(sawSoloBlur).toBe(true);
    expect(maxSong).toBeGreaterThan(90);
  });
});

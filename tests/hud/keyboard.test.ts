import { describe, expect, it } from 'vitest';
import { cameraPresetFromKey, nextCameraPreset } from '../../src/hud/keyboard.ts';

describe('camera chip keyboard', () => {
  it('cycles presets with arrows and jumps with Home/End', () => {
    expect(nextCameraPreset('Widok kuchni', 1)).toBe('Z boku');
    expect(nextCameraPreset('Reel', 1)).toBe('Widok kuchni');
    expect(cameraPresetFromKey('Z boku', 'ArrowLeft')).toBe('Widok kuchni');
    expect(cameraPresetFromKey('Z boku', 'Home')).toBe('Widok kuchni');
    expect(cameraPresetFromKey('Z boku', 'End')).toBe('Reel');
    expect(cameraPresetFromKey('Z boku', 'Enter')).toBeNull();
  });
});

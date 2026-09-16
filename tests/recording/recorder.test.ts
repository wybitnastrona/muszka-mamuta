import { describe, expect, it } from 'vitest';
import {
  RECORD_BITS_PER_SECOND,
  RECORD_DEFAULT_SECONDS,
  RECORD_FPS,
  RECORD_HEIGHT,
  RECORD_WIDTH,
  mediaRecorderOptions,
  parseRecordSeconds,
  pickRecorderMime,
  RECORDER_MIME_CANDIDATES,
} from '../../src/recording/recorder.ts';

describe('reel recorder options', () => {
  it('prefers VP9/WebM at 12 Mbps 1080×1920 30 fps', () => {
    expect(RECORD_FPS).toBe(30);
    expect(RECORD_WIDTH).toBe(1080);
    expect(RECORD_HEIGHT).toBe(1920);
    expect(RECORD_BITS_PER_SECOND).toBe(12_000_000);
    expect(RECORD_DEFAULT_SECONDS).toBe(210);
    expect(RECORDER_MIME_CANDIDATES[0]).toBe('video/webm;codecs=vp9');
    expect(pickRecorderMime(() => false)).toBe('video/webm');
    expect(pickRecorderMime((type) => type === 'video/webm;codecs=vp9')).toBe('video/webm;codecs=vp9');
    const opts = mediaRecorderOptions('video/webm;codecs=vp9');
    expect(opts.mimeType).toBe('video/webm;codecs=vp9');
    expect(opts.videoBitsPerSecond).toBe(12_000_000);
  });

  it('parses ?record=1 and numeric durations', () => {
    expect(parseRecordSeconds('')).toBeNull();
    expect(parseRecordSeconds('?reel=1')).toBeNull();
    expect(parseRecordSeconds('?record=1')).toBe(210);
    expect(parseRecordSeconds('?record=45')).toBe(45);
  });
});

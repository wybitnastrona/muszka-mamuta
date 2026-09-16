/**
 * 1080×1920 VP9/WebM capture of the kitchen canvas with the ?reel=1 slogan
 * composited in. Force camera 'Reel' at the call site while this runs.
 */
export const RECORD_FPS = 30;
export const RECORD_WIDTH = 1080;
export const RECORD_HEIGHT = 1920;
export const RECORD_BITS_PER_SECOND = 12_000_000;
/** Soft upper bound of one authored scene loop (sum of CAP + pad). */
export const RECORD_DEFAULT_SECONDS = 210;

export const RECORDER_MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

export type StartRecordingOpts = {
  fps: number;
  width: number;
  height: number;
  seconds: number;
  caption?: string;
  filename?: string;
  bitsPerSecond?: number;
  download?: boolean;
};

export type RecordingHandle = {
  canvas: HTMLCanvasElement;
  stop: () => Promise<Blob>;
  capture: (source: CanvasImageSource) => void;
  readonly mimeType: string;
  readonly finished: Promise<Blob>;
};

export type MimeIsTypeSupported = (type: string) => boolean;

export function pickRecorderMime(
  isTypeSupported: MimeIsTypeSupported | undefined = globalThis.MediaRecorder?.isTypeSupported.bind(
    globalThis.MediaRecorder,
  ),
): string {
  if (!isTypeSupported) return 'video/webm';
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (isTypeSupported(mime)) return mime;
  }
  return 'video/webm';
}

export function mediaRecorderOptions(mimeType: string, bitsPerSecond = RECORD_BITS_PER_SECOND): MediaRecorderOptions {
  return { mimeType, videoBitsPerSecond: bitsPerSecond };
}

export function parseRecordSeconds(
  search = typeof window === 'undefined' ? '' : window.location.search,
): number | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const value = new URLSearchParams(raw).get('record');
  if (value === null) return null;
  if (value === '' || value === '1') return RECORD_DEFAULT_SECONDS;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : RECORD_DEFAULT_SECONDS;
}

export function paintReelCaption(
  ctx: CanvasRenderingContext2D,
  opts: { width: number; height: number; caption: string },
): void {
  const { width, height, caption } = opts;
  const pad = Math.round(height * 0.045);
  const fontPx = Math.max(28, Math.round(width * 0.038));
  ctx.save();
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const x = width / 2;
  const y = height - pad;
  ctx.lineWidth = Math.max(4, fontPx / 8);
  ctx.strokeStyle = 'rgba(7,10,14,0.85)';
  ctx.fillStyle = '#f4efe4';
  wrapText(ctx, caption, width - pad * 2).forEach((line, i, lines) => {
    const ly = y - (lines.length - 1 - i) * fontPx * 1.15;
    ctx.strokeText(line, x, ly);
    ctx.fillText(line, x, ly);
  });
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function startRecording(opts: StartRecordingOpts): RecordingHandle {
  if (typeof MediaRecorder === 'undefined' || typeof document === 'undefined') {
    throw new Error('MediaRecorder is not available');
  }
  const fps = opts.fps;
  const width = opts.width;
  const height = opts.height;
  const bits = opts.bitsPerSecond ?? RECORD_BITS_PER_SECOND;
  const caption = opts.caption ?? '';
  const filename = opts.filename ?? 'muszka-mamuta.webm';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D context unavailable for reel capture');
  const mimeType = pickRecorderMime();
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, mediaRecorderOptions(mimeType, bits));
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  let settle: (blob: Blob) => void = () => {};
  let fail: (err: Error) => void = () => {};
  const finished = new Promise<Blob>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const stop = (): Promise<Blob> => {
    if (recorder.state === 'recording' || recorder.state === 'paused') recorder.stop();
    return finished;
  };
  recorder.onerror = () => fail(new Error('MediaRecorder failed'));
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' });
    canvas.remove();
    for (const track of stream.getTracks()) track.stop();
    if (opts.download !== false) downloadBlob(blob, filename);
    settle(blob);
  };
  recorder.start(1000);
  if (opts.seconds > 0) {
    window.setTimeout(() => { void stop(); }, opts.seconds * 1000);
  }
  return {
    canvas,
    mimeType,
    finished,
    stop,
    capture: (source) => {
      ctx.fillStyle = '#070a0e';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);
      if (caption) paintReelCaption(ctx, { width, height, caption });
    },
  };
}

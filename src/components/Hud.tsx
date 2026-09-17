/**
 * Side HUD for the kitchen reel. Polish first, English toggle.
 * Readouts throttle at 10 Hz; the spike raster paints every frame.
 * Connectome drives only gustatory → MN9; captions here are authored.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { CAMERA_PRESETS, type CameraPreset, type ClipName, type FeedingState } from '../body/types.ts';
import type { GagId } from '../body/gags.ts';
import { t, type Lang } from '../i18n.ts';
import {
  PHASE_IDS,
  PHASE_STRIP,
  formatBites,
  formatPortion,
  formatSpikeCount,
  formatSubCaption,
  formatTimeReadout,
  resolveHudCaption,
} from '../hud/captions.ts';
import { cameraPresetFromKey } from '../hud/keyboard.ts';
import { parseReelMode, REEL_SLOGAN_EN, REEL_SLOGAN_PL } from '../hud/reel.ts';
import { RASTER_COUNT_MS, RASTER_WINDOW_MS, type SpikeHistory } from '../hud/spikeHistory.ts';
import { Attribution } from './Attribution.tsx';

export type SceneHudSnapshot = {
  state: FeedingState;
  clip: ClipName;
  caption: string;
  macro: string;
  gag: GagId | null;
  portions: number;
  bites: number;
  bitesTarget: number;
  remainingFrac: number;
  gramsEaten: number;
  lifetimeBites: number;
  lifetimeGrams: number;
};

export const EMPTY_SCENE_HUD: SceneHudSnapshot = {
  state: 'SEARCH',
  clip: 'odorTrack',
  caption: '',
  macro: 'FLY_INTO_TUB',
  gag: null,
  portions: 0,
  bites: 0,
  bitesTarget: 6,
  remainingFrac: 1,
  gramsEaten: 0,
  lifetimeBites: 0,
  lifetimeGrams: 0,
};

export type HudReadout = {
  playing: boolean;
  timeSec: number;
  seed: number;
  hunger: number;
  satiety: number;
  crop: number;
  remainingFrac: number;
  mn9Hz: number;
  smakHz: number;
  scene: SceneHudSnapshot;
};

type HudProps = {
  lang: Lang;
  onLang: () => void;
  reel?: boolean;
  preset: CameraPreset;
  onPreset: (name: CameraPreset) => void;
  readout: HudReadout;
  raster: RefObject<SpikeHistory>;
  onPause: () => void;
  onRestartMeal: () => void;
  onNewPortion: () => void;
  onSeed: (seed: number) => void;
  recording?: boolean;
  onRecord?: () => void;
};

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function Gauge({
  label, display, fill,
}: {
  label: string; display: string; fill: number;
}) {
  return (
    <div className="hud-gauge" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp01(fill) * 100)}>
      <div className="hud-gauge-row">
        <span>{label}</span>
        <span className="hud-num">{display}</span>
      </div>
      <div className="hud-bar" aria-hidden="true">
        <i style={{ width: `${clamp01(fill) * 100}%` }} />
      </div>
    </div>
  );
}

function SpikeRaster({
  raster, lang,
}: {
  raster: RefObject<SpikeHistory>;
  lang: Lang;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let id = 0;
    const draw = () => {
      const hist = raster.current;
      const ctx = canvas.getContext('2d');
      if (ctx && hist) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cssW = Math.max(1, canvas.clientWidth);
        const cssH = Math.max(1, canvas.clientHeight);
        const w = Math.round(cssW * dpr);
        const h = Math.round(cssH * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#070a0e';
        ctx.fillRect(0, 0, cssW, cssH);
        ctx.strokeStyle = '#1c2430';
        ctx.lineWidth = 1;
        for (let g = 1; g < 4; g++) {
          const x = (g / 4) * cssW;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, cssH);
          ctx.stroke();
        }
        const band = cssH / 2;
        ctx.strokeStyle = '#28323e';
        ctx.beginPath();
        ctx.moveTo(0, band);
        ctx.lineTo(cssW, band);
        ctx.stroke();
        const t0 = hist.nowMs - RASTER_WINDOW_MS;
        const paint = (times: readonly number[], y0: number, y1: number, color: string) => {
          const seen = new Uint8Array(Math.max(1, Math.floor(cssW)));
          for (const t of times) {
            const x = Math.floor(((t - t0) / RASTER_WINDOW_MS) * cssW);
            if (x >= 0 && x < seen.length) seen[x] = 1;
          }
          ctx.fillStyle = color;
          for (let x = 0; x < seen.length; x++) {
            if (seen[x]) ctx.fillRect(x, y0, 1, y1 - y0);
          }
        };
        paint(hist.mn9, 2, band - 1, '#d7f4ff');
        paint(hist.gust, band + 1, cssH - 2, '#e8c07a');
        if (countRef.current) {
          countRef.current.textContent = formatSpikeCount(hist.countIn(RASTER_COUNT_MS), lang);
        }
      }
      id = requestAnimationFrame(draw);
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [raster, lang]);

  return (
    <div className="hud-raster" aria-label={lang === 'pl' ? 'Raster iglic MN9 i SMAK' : 'MN9 and taste spike raster'}>
      <div className="hud-raster-labels" aria-hidden="true">
        <span>MN9</span>
        <span>{lang === 'pl' ? 'SMAK' : 'TASTE'}</span>
      </div>
      <canvas ref={canvasRef} className="hud-raster-canvas" />
      <span ref={countRef} className="hud-num hud-raster-count">{formatSpikeCount(0, lang)}</span>
    </div>
  );
}

export function Hud({
  lang, onLang, reel = parseReelMode(), preset, onPreset, readout, raster,
  onPause, onRestartMeal, onNewPortion, onSeed, recording = false, onRecord,
}: HudProps) {
  const methodsId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const scene = readout.scene;
  const resolved = resolveHudCaption({
    lang,
    caption: scene.caption,
    macro: scene.macro,
    hudState: scene.state,
    gag: scene.gag,
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const onDialogKey = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') setOpen(false);
  };

  if (reel) {
    return (
      <div className="hud hud-reel">
        <p className="hud-slogan">{lang === 'pl' ? REEL_SLOGAN_PL : REEL_SLOGAN_EN}</p>
        <SpikeRaster raster={raster} lang={lang} />
      </div>
    );
  }

  const hz = (n: number) => n.toFixed(1);
  const pct = (n: number) => `${Math.round(clamp01(n) * 100)}%`;

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-readouts" aria-live="polite">
          <span className="hud-num">{formatBites(scene.bites, scene.bitesTarget, lang)}</span>
          <span className="hud-num">{formatPortion(scene.portions, lang)}</span>
          <span className="hud-num">{formatTimeReadout(readout.timeSec, lang)}</span>
        </div>
        <div className="hud-top-right">
          <button type="button" className="lang-toggle" onClick={onLang} aria-label={lang === 'pl' ? 'Switch to English' : 'Przełącz na polski'}>
            {t(lang, 'lang')}
          </button>
          <div
            className="hud-views"
            role="radiogroup"
            aria-label={t(lang, 'view')}
            onKeyDown={(event) => {
              const next = cameraPresetFromKey(preset, event.key);
              if (!next || recording) return;
              event.preventDefault();
              onPreset(next);
            }}
          >
            {CAMERA_PRESETS.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={preset === name}
                className={preset === name ? 'is-on' : ''}
                disabled={recording}
                onClick={() => onPreset(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="hud-gauges" aria-label={t(lang, 'gauges')}>
        <Gauge label={t(lang, 'gaugeHunger')} display={readout.hunger.toFixed(2)} fill={readout.hunger} />
        <Gauge label={t(lang, 'gaugeSatiety')} display={readout.satiety.toFixed(2)} fill={readout.satiety} />
        <Gauge label={t(lang, 'gaugeCrop')} display={readout.crop.toFixed(2)} fill={readout.crop} />
        <Gauge label={t(lang, 'gaugeLeft')} display={pct(readout.remainingFrac)} fill={readout.remainingFrac} />
        <Gauge label={t(lang, 'gaugeMn9')} display={hz(readout.mn9Hz)} fill={readout.mn9Hz / 50} />
        <Gauge label={t(lang, 'gaugeSmak')} display={hz(readout.smakHz)} fill={readout.smakHz / 50} />
      </div>

      <div className="hud-phase">
        <div className="hud-phase-strip" role="list" aria-label={t(lang, 'phaseStrip')}>
          {PHASE_IDS.map((id) => {
            const on = resolved.highlightPhase && resolved.phase === id;
            const copy = PHASE_STRIP[id];
            return (
              <div key={id} role="listitem" className={on ? 'is-on' : ''} aria-current={on ? 'true' : undefined}>
                <strong>{copy.label}</strong>
                {on && <span>{resolved.phaseLine}</span>}
              </div>
            );
          })}
        </div>
        <p className="hud-caption" aria-live="polite">{resolved.headline}</p>
        <p className="hud-sub">{formatSubCaption(scene.lifetimeBites, scene.lifetimeGrams, lang)}</p>
      </div>

      <SpikeRaster raster={raster} lang={lang} />

      <div className="hud-controls">
        <button type="button" onClick={onPause}>{readout.playing ? t(lang, 'pause') : t(lang, 'play')}</button>
        <button type="button" onClick={onRestartMeal}>{t(lang, 'restartMeal')}</button>
        <button type="button" onClick={onNewPortion}>{t(lang, 'newPortion')}</button>
        {onRecord && (
          <button type="button" disabled={recording} onClick={onRecord} aria-pressed={recording}>
            {recording ? t(lang, 'recording') : t(lang, 'record')}
          </button>
        )}
        <label className="seed-field">{t(lang, 'seed')}
          <input
            type="number"
            min={0}
            max={0xffffffff}
            value={readout.seed}
            aria-label={t(lang, 'seed')}
            onChange={(event) => onSeed(Number(event.target.value) || 0)}
          />
        </label>
        <button type="button" aria-haspopup="dialog" aria-controls={methodsId} onClick={() => setOpen(true)}>
          {t(lang, 'methodsShort')}
        </button>
      </div>

      <footer className="hud-foot">
        <span>{t(lang, 'hudFoot')}</span>
        <button type="button" className="hud-foot-link" onClick={() => setOpen(true)}>{t(lang, 'methodsShort')}</button>
      </footer>
      <Attribution />

      <dialog ref={dialog} id={methodsId} className="hud-methods" onClose={() => setOpen(false)} onKeyDown={onDialogKey}>
        <h2>{t(lang, 'methods')}</h2>
        <p><strong>{t(lang, 'methodsMeasuredLabel')}</strong> {t(lang, 'methodsMeasured')}</p>
        <p><strong>{t(lang, 'methodsAuthoredLabel')}</strong> {t(lang, 'methodsAuthored')}</p>
        <p>{t(lang, 'methodsDopamine')}</p>
        <p>{t(lang, 'methodsProps')}</p>
        <p>{t(lang, 'methodsBody')}</p>
        <p><strong>{t(lang, 'methodsLimitsLabel')}</strong> {t(lang, 'methodsLimits')}</p>
        <p><strong>{t(lang, 'methodsCreditLabel')}</strong> {t(lang, 'methodsCredit')}{' '}
          <a href="https://github.com/cobanov/fly-connectome-template">fly-connectome-template</a>
          {' '}{t(lang, 'methodsCreditBy')}{' '}
          <a href="https://github.com/cobanov">Mert Cobanov</a>. {t(lang, 'methodsCreditRest')}
        </p>
        <form method="dialog">
          <button type="submit" onClick={() => setOpen(false)}>{t(lang, 'close')}</button>
        </form>
      </dialog>
    </div>
  );
}

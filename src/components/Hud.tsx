/**
 * Side HUD for the kitchen reel. Polish first, English toggle.
 * Connectome drives only gustatory → MN9; captions here are authored.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { CAMERA_PRESETS, type CameraPreset, type ClipName, type FeedingState } from '../body/types.ts';
import type { GagId } from '../body/gags.ts';
import { t, type Lang } from '../i18n.ts';
import {
  formatBites,
  formatPortion,
  formatTimeReadout,
  resolveHudCaption,
} from '../hud/captions.ts';
import { cameraPresetFromKey } from '../hud/keyboard.ts';
import { parseReelMode, REEL_SLOGAN_EN, REEL_SLOGAN_PL } from '../hud/reel.ts';
import type { SpikeHistory } from '../hud/spikeHistory.ts';
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
  scoopFill: number;
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
  scoopFill: 0,
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

export function Hud({
  lang, onLang, reel = parseReelMode(), preset, onPreset, readout, raster: _raster,
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
      </div>
    );
  }

  const hz = (n: number) => n.toFixed(1);
  const energy = clamp01(Math.max(scene.scoopFill, readout.crop));
  void _raster;

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
        <Gauge
          label={t(lang, 'gaugeCreatineEnergy')}
          display={`${Math.round(energy * 100)}`}
          fill={energy}
        />
        <Gauge label={t(lang, 'gaugePumpHz')} display={hz(readout.mn9Hz)} fill={readout.mn9Hz / 50} />
        <Gauge label={t(lang, 'gaugeHunger')} display={readout.hunger.toFixed(2)} fill={readout.hunger} />
        <p className="hud-caption hud-caption-left" aria-live="polite">{resolved.headline}</p>
      </div>

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
        <div className="hud-credit">
          <Attribution />
        </div>
      </div>

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

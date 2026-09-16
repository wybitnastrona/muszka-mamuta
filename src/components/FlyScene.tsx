import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CameraPreset, FeedingEvent, FeedingState } from '../body/types.ts';
import { parseDebugMode } from '../body/debugQuery.ts';
import { MOTION_LOOP_ORDER } from '../body/feedingMotion.ts';
import { WEIGHT_LEGEND } from '../body/palette.ts';
import { TWAROG_MAMUTA_WANILIOWY } from '../food/foodProfile.ts';
import type { ChemoSample } from '../food/twarogSystem.ts';
import { mountFlyScene, type FlyCommand, type FlyRecorderApi } from './flySceneMount.ts';
import type { SceneHudSnapshot } from './Hud.tsx';
import type { PopulationSummary } from '../brain/lif.ts';
import type { Hemolymph } from '../metabolism/hemolymph.ts';

type FlySceneProps = {
  playing?: boolean;
  mn9Rate?: number;
  satiety?: number;
  bitter?: number;
  odor?: number;
  cropVolume?: number;
  preset: CameraPreset;
  commandRef: MutableRefObject<FlyCommand>;
  seedRef: MutableRefObject<number>;
  onEvents?: (events: readonly FeedingEvent[]) => void;
  onHud?: (hud: SceneHudSnapshot) => void;
  onChemo?: (sample: ChemoSample) => void;
  onPortion?: (count: number) => void;
  summaryRef?: MutableRefObject<PopulationSummary | null>;
  hemoRef?: MutableRefObject<Hemolymph>;
  recorderApiRef?: MutableRefObject<FlyRecorderApi | null>;
};

export function FlyScene({
  playing = true, mn9Rate = 0, satiety = 0, bitter = 0,
  odor = TWAROG_MAMUTA_WANILIOWY.odor, cropVolume = 0, preset,
  commandRef, seedRef, summaryRef, hemoRef, recorderApiRef,
  onEvents, onHud, onChemo, onPortion,
}: FlySceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const debug = parseDebugMode();
  const [clipLabel, setClipLabel] = useState(debug === 'motion' ? MOTION_LOOP_ORDER[0] : 'odorTrack');
  const [, setStateLabel] = useState<FeedingState>('SEARCH');
  const [, setToast] = useState(false);
  const [, setPortions] = useState(0);
  const [, setCaption] = useState('');
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const inputRef = useRef({ playing, mn9Rate, satiety, bitter, odor, cropVolume });
  inputRef.current = { playing, mn9Rate, satiety, bitter, odor, cropVolume };
  const onEventsRef = useRef(onEvents); onEventsRef.current = onEvents;
  const onHudRef = useRef(onHud); onHudRef.current = onHud;
  const onChemoRef = useRef(onChemo); onChemoRef.current = onChemo;
  const onPortionRef = useRef(onPortion); onPortionRef.current = onPortion;

  useEffect(() => mountFlyScene({
    element: host.current!,
    debug,
    inputRef,
    presetRef,
    commandRef,
    seedRef,
    setError,
    setClipLabel,
    setStateLabel,
    setToast,
    setPortions,
    setCaption,
    onEventsRef,
    onHudRef,
    onChemoRef,
    onPortionRef,
    summaryRef,
    hemoRef,
    recorderApiRef,
  }), [debug, commandRef, seedRef, summaryRef, hemoRef, recorderApiRef]);

  useEffect(() => { presetRef.current = preset; }, [preset]);

  return <>
    {debug === 'weights' && (
      <ul className="fly-weight-legend">
        {WEIGHT_LEGEND.map((row) => (
          <li key={row.name}><i style={{ background: row.hex }} />{row.name}</li>
        ))}
      </ul>
    )}
    {(debug === 'motion' || debug === 'extend' || debug === 'pump') && (
      <div className="fly-debug-label" aria-live="polite">{debug === 'motion' ? clipLabel : debug}</div>
    )}
    <div ref={host} className="three-viewport" aria-label="Flybody feeding view">{error && <p role="alert">{error}</p>}</div>
  </>;
}

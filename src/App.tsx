import { useEffect, useRef, useState } from 'react';
import { BrainScene } from './components/BrainScene';
import { FlyScene } from './components/FlyScene';
import { EMPTY_SCENE_HUD, Hud, type HudReadout, type SceneHudSnapshot } from './components/Hud';
import type { FlyCommand, FlyRecorderApi } from './components/flySceneMount.ts';
import type { ChemoSample } from './food/twarogSystem.ts';
import type { FeedingEvent } from './body/types.ts';
import type { CameraPreset } from './body/types.ts';
import { BrainRuntime } from './brain/BrainRuntime';
import { idsForRole, idsForSubclasses } from './brain/csr';
import { LABELLAR_SUBCLASSES, PHARYNGEAL_SUBCLASSES } from './brain/params';
import { BRAIN_SOURCE } from './brain/protocol';
import type { PopulationSummary } from './brain/lif';
import { asset, loadAtlas, type Atlas } from './lib/atlas';
import { frameAt, type ActivityFrame, type ModelReplay } from './lib/replay';
import { t, type Lang } from './i18n';
import { TWAROG_MAMUTA_WANILIOWY } from './food/foodProfile';
import { Hemolymph } from './metabolism/hemolymph';
import { MODULATION_PUSH_MS, pushModulation } from './metabolism/modulation';
import { parseReelMode, REEL_SLOGAN_EN, REEL_SLOGAN_PL } from './hud/reel.ts';
import {
  RECORD_DEFAULT_SECONDS,
  RECORD_FPS,
  RECORD_HEIGHT,
  RECORD_WIDTH,
  parseRecordSeconds,
} from './recording/recorder.ts';
import { SpikeHistory } from './hud/spikeHistory.ts';

const HUD_HZ_MS = 100;

function emptySummary(): PopulationSummary {
  return {
    mn9Rate: 0, gustDriveRate: 0, gustNeutralRate: 0, gustSuppressRate: 0,
    mnOtherRate: 0, dnRate: 0, pamRate: 0, ppl1Rate: 0, mbonRate: 0, gustRate: 0,
    mn9SpikeTimesMs: [], gustSpikeTimesMs: [], pamSpikeTimesMs: [],
  };
}

export function App() {
  const reel = parseReelMode();
  const [lang, setLang] = useState<Lang>('pl');
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [error, setError] = useState('');
  const [replay, setReplay] = useState<ModelReplay | null>(null);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [seed, setSeed] = useState(1);
  const [live, setLive] = useState(false);
  const [liveFrame, setLiveFrame] = useState<ActivityFrame | null>(null);
  const [summary, setSummary] = useState<PopulationSummary | null>(null);
  const [neuronN, setNeuronN] = useState(0);
  const [preset, setPreset] = useState<CameraPreset>(parseRecordSeconds() != null ? 'Reel' : 'Widok kuchni');
  const [recording, setRecording] = useState(() => parseRecordSeconds() != null);
  const [hemoHud, setHemoHud] = useState(() => new Hemolymph({ profile: TWAROG_MAMUTA_WANILIOWY }).hud());
  const [sceneHud, setSceneHud] = useState<SceneHudSnapshot>(EMPTY_SCENE_HUD);
  const runtime = useRef<BrainRuntime | null>(null);
  const hemolymph = useRef(new Hemolymph({ profile: TWAROG_MAMUTA_WANILIOWY, spotsEnabled: false }));
  const lastChemoMs = useRef(0);
  const raster = useRef(new SpikeHistory());
  const commandRef = useRef<FlyCommand>('idle');
  const recorderApiRef = useRef<FlyRecorderApi | null>(null);
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const sceneHudRef = useRef<SceneHudSnapshot>(EMPTY_SCENE_HUD);
  const summaryRef = useRef<PopulationSummary | null>(null);
  const liveFrameRef = useRef<ActivityFrame | null>(null);
  const timeRef = useRef(0);
  const lifetime = useRef({ bites: 0, grams: 0 });
  const autoStarted = useRef(false);
  const duration = replay?.frames.at(-1)?.time ?? 30;

  useEffect(() => {
    const abort = new AbortController();
    void loadAtlas(abort.signal).then(setAtlas).catch((e) => {
      if (!abort.signal.aborted) setError(String(e));
    });
    return () => abort.abort();
  }, []);

  useEffect(() => () => { runtime.current?.dispose(); runtime.current = null; }, []);

  useEffect(() => {
    if (!playing) return;
    let previous = performance.now(), frame = 0, pushMs = 0;
    const step = (now: number) => {
      const delta = document.hidden ? 0 : Math.min(0.1, (now - previous) / 1000);
      previous = now;
      if (delta > 0) {
        hemolymph.current.step(delta);
        pushMs += delta * 1000;
        if (pushMs >= MODULATION_PUSH_MS) {
          pushMs = 0;
          const rt = runtime.current;
          if (live && rt) pushModulation(rt, hemolymph.current.getModulation());
        }
      }
      if (!live) {
        timeRef.current = Math.min(duration, timeRef.current + delta);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, live]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setHemoHud(hemolymph.current.hud());
      setTime(timeRef.current);
      setSummary(summaryRef.current);
      setLiveFrame(liveFrameRef.current);
      const snap = sceneHudRef.current;
      setSceneHud({
        ...snap,
        lifetimeBites: lifetime.current.bites,
        lifetimeGrams: lifetime.current.grams,
      });
    }, HUD_HZ_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!live && time >= duration) setPlaying(false);
  }, [time, duration, live]);

  useEffect(() => {
    const rt = runtime.current;
    if (!live || !rt) return;
    if (playing) rt.start();
    else rt.stop();
  }, [playing, live]);

  const resetHemolymph = () => {
    hemolymph.current.reset();
    setHemoHud(hemolymph.current.hud());
  };

  const startLive = async () => {
    setError('');
    setReplay(null);
    timeRef.current = 0;
    setTime(0);
    resetHemolymph();
    raster.current.reset();
    const rt = new BrainRuntime(seed);
    runtime.current = rt;
    rt.onError = (message) => setError(message);
    rt.onReady = (n, nextSeed) => {
      setNeuronN(n);
      setSeed(nextSeed);
      seedRef.current = nextSeed;
      pushModulation(rt, hemolymph.current.getModulation());
    };
    rt.onFrame = (frame, nextSummary) => {
      liveFrameRef.current = frame;
      summaryRef.current = nextSummary;
      timeRef.current = frame.time;
      raster.current.push(
        frame.time,
        nextSummary.mn9SpikeTimesMs,
        nextSummary.gustSpikeTimesMs,
      );
    };
    try {
      await rt.connect();
      setLive(true);
      setPlaying(true);
      rt.start();
      pushModulation(rt, hemolymph.current.getModulation());
    } catch (e) {
      runtime.current = null;
      setError(String(e));
    }
  };

  useEffect(() => {
    if (!atlas || autoStarted.current) return;
    autoStarted.current = true;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => { void startLive(); });
    });
    // atlas-gated auto-start of the LIF worker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas]);

  const applySeed = (next: number) => {
    const value = next >>> 0;
    setSeed(value);
    seedRef.current = value;
    runtime.current?.setSeed(value);
    raster.current.reset();
    if (live) {
      liveFrameRef.current = null;
      summaryRef.current = null;
      timeRef.current = 0;
      const rt = runtime.current;
      if (rt) pushModulation(rt, hemolymph.current.getModulation());
    }
  };

  const restartAll = () => {
    lifetime.current = { bites: 0, grams: 0 };
    timeRef.current = 0;
    setTime(0);
    resetHemolymph();
    raster.current.reset();
    commandRef.current = 'restartMeal';
    if (live) {
      runtime.current?.reset(seed);
      const rt = runtime.current;
      if (rt) pushModulation(rt, hemolymph.current.getModulation());
    }
    liveFrameRef.current = null;
    summaryRef.current = null;
  };

  const startReelRecording = async () => {
    const api = recorderApiRef.current;
    if (!api || recording) return;
    setRecording(true);
    setPreset('Reel');
    try {
      await api.startRecording({
        fps: RECORD_FPS,
        width: RECORD_WIDTH,
        height: RECORD_HEIGHT,
        seconds: parseRecordSeconds() ?? RECORD_DEFAULT_SECONDS,
        caption: lang === 'pl' ? REEL_SLOGAN_PL : REEL_SLOGAN_EN,
        filename: parseRecordSeconds() != null ? 'loop-seed1.webm' : 'muszka-mamuta.webm',
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setRecording(false);
    }
  };

  const frame = replay ? frameAt(replay, time) : liveFrame;
  const rates = summary ?? emptySummary();
  const readout: HudReadout = {
    playing,
    timeSec: time,
    seed,
    hunger: hemoHud.hungerDrive,
    satiety: hemoHud.satiety,
    crop: hemoHud.cropVolume,
    remainingFrac: sceneHud.remainingFrac,
    mn9Hz: rates.mn9Rate,
    smakHz: rates.gustRate,
    scene: sceneHud,
  };

  return (
    <div className={reel ? 'app is-reel' : 'app'}>
      {error && <p className="error hud-error" role="alert">{error}</p>}
      <div className="workbench">
        <section className="panel fly-panel">
          <Hud
            lang={lang}
            onLang={() => setLang(lang === 'pl' ? 'en' : 'pl')}
            reel={reel}
            preset={preset}
            onPreset={setPreset}
            readout={readout}
            raster={raster}
            onPause={() => {
              if (!live && time >= duration) {
                timeRef.current = 0;
                setTime(0);
              }
              setPlaying(!playing);
            }}
            onRestartMeal={restartAll}
            onNewPortion={() => { commandRef.current = 'newPortion'; }}
            onSeed={applySeed}
            recording={recording}
            onRecord={() => { void startReelRecording(); }}
          />
          <FlyScene
            playing={playing}
            preset={preset}
            commandRef={commandRef}
            recorderApiRef={recorderApiRef}
            seedRef={seedRef}
            mn9Rate={rates.mn9Rate}
            satiety={hemoHud.satiety}
            cropVolume={hemoHud.cropVolume}
            bitter={TWAROG_MAMUTA_WANILIOWY.bitter}
            odor={TWAROG_MAMUTA_WANILIOWY.odor}
            summaryRef={summaryRef}
            hemoRef={hemolymph}
            onChemo={(sample: ChemoSample) => {
              const rt = runtime.current;
              if (!live || !rt) return;
              void rt.ensureCircuit();
              if (!rt.circuit) return;
              const now = performance.now();
              if (now - lastChemoMs.current < 80) return;
              lastChemoMs.current = now;
              // Live graph has 0 gust_labellar tags (measured terciles). Subclass fallback is the 223 labellar/peg seeds.
              const labIds = idsForRole(rt.circuit, 'gust_labellar');
              const pharIds = idsForRole(rt.circuit, 'gust_pharyngeal');
              const lab = labIds.length ? labIds : idsForSubclasses(rt.circuit, LABELLAR_SUBCLASSES);
              const phar = pharIds.length ? pharIds : idsForSubclasses(rt.circuit, PHARYNGEAL_SUBCLASSES);
              if (sample.rates.labellarHz > 0.5 && lab.length) {
                rt.stimulate(lab, sample.rates.labellarHz, 80);
              }
              if (sample.rates.pharyngealHz > 0.5 && phar.length) {
                rt.stimulate(phar, sample.rates.pharyngealHz, 80);
              }
            }}
            onEvents={(events: readonly FeedingEvent[]) => {
              for (const event of events) {
                if (event.type === 'consume') {
                  hemolymph.current.eat(event.massGrams);
                  lifetime.current.bites += 1;
                  lifetime.current.grams += event.massGrams;
                }
              }
            }}
            onHud={(snap) => { sceneHudRef.current = snap; }}
          />
        </section>
        {!reel && (
          <section className="panel brain-panel">
            <h2>{t(lang, 'brain')} <span>MaleCNS v1.0</span></h2>
            {atlas ? <BrainScene atlas={atlas} frame={frame} /> : <p className="loading" role="status">{t(lang, 'loadingAnatomy')}</p>}
            <div className="panel-bottom">
              {t(lang, 'drag')} · {atlas?.visibleIds.size.toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-US') ?? '…'} {t(lang, 'somata')}
              {' '}<a href={asset('data/brain-atlas/NOTICE.md')}>{t(lang, 'dataNotice')}</a>
              {live && neuronN ? ` · ${t(lang, 'live')} · ${neuronN.toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-US')} LIF` : ''}
              {live ? ` · ${BRAIN_SOURCE.name}` : ''}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

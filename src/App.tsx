import { useEffect, useRef, useState } from 'react';
import { BrainScene } from './components/BrainScene';
import { FlyScene } from './components/FlyScene';
import type { ChemoSample } from './food/twarogSystem.ts';
import type { FeedingEvent, FeedingState } from './body/types.ts';
import { Environment } from './components/Environment';
import { Attribution } from './components/Attribution';
import { BrainRuntime } from './brain/BrainRuntime';
import { idsForRole, idsForSubclasses } from './brain/csr';
import { LABELLAR_SUBCLASSES, PHARYNGEAL_SUBCLASSES, PROTOCOL_DURATION_MS, PROTOCOL_STIM_HZ } from './brain/params';
import { BRAIN_SOURCE } from './brain/protocol';
import type { PopulationSummary } from './brain/lif';
import { asset, loadAtlas, type Atlas } from './lib/atlas';
import { frameAt, parseReplay, type ActivityFrame, type ModelReplay } from './lib/replay';
import { t, type Lang } from './i18n';
import { TWAROG_MAMUTA_WANILIOWY } from './food/foodProfile';
import { Hemolymph, type DefecationEvent } from './metabolism/hemolymph';
import { MODULATION_PUSH_MS, pushModulation } from './metabolism/modulation';

const hz = (value: number) => value.toFixed(2);
const n01 = (value: number) => value.toFixed(2);

export function App() {
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
  const [showSpots, setShowSpots] = useState(false);
  const [spots, setSpots] = useState<DefecationEvent[]>([]);
  const [hemoHud, setHemoHud] = useState(() => new Hemolymph({ profile: TWAROG_MAMUTA_WANILIOWY }).hud());
  const [feedHud, setFeedHud] = useState<{ state: FeedingState; clip: string }>({ state: 'SEARCH', clip: 'odorTrack' });
  const file = useRef<HTMLInputElement>(null);
  const runtime = useRef<BrainRuntime | null>(null);
  const hemolymph = useRef(new Hemolymph({ profile: TWAROG_MAMUTA_WANILIOWY, spotsEnabled: false }));
  const lastChemoMs = useRef(0);
  const duration = replay?.frames.at(-1)?.time ?? 30;

  useEffect(() => {
    hemolymph.current.spotsEnabled = showSpots;
  }, [showSpots]);

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
        const events = hemolymph.current.step(delta);
        if (showSpots && events.length) setSpots((value) => value.concat(events));
        pushMs += delta * 1000;
        if (pushMs >= MODULATION_PUSH_MS) {
          pushMs = 0;
          setHemoHud(hemolymph.current.hud());
          const rt = runtime.current;
          if (live && rt) pushModulation(rt, hemolymph.current.getModulation());
        }
      }
      if (!live) setTime((value) => Math.min(duration, value + delta));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, live, showSpots]);

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
    hemolymph.current.spotsEnabled = showSpots;
    setSpots([]);
    setHemoHud(hemolymph.current.hud());
  };

  const accept = (value: unknown) => {
    if (!atlas) throw Error('Wait for the atlas to load.');
    stopLive();
    const validated = parseReplay(value, atlas.visibleIds);
    setReplay(validated);
    setTime(0);
    setPlaying(false);
    setError('');
    resetHemolymph();
  };

  const example = async () => {
    try {
      const response = await fetch(asset('examples/model-output.example.json'));
      if (!response.ok) throw Error('Example unavailable.');
      accept(await response.json());
    } catch (e) {
      setError(String(e));
    }
  };

  const stopLive = () => {
    runtime.current?.dispose();
    runtime.current = null;
    setLive(false);
    setLiveFrame(null);
    setSummary(null);
    setNeuronN(0);
  };

  const startLive = async () => {
    setError('');
    setReplay(null);
    setTime(0);
    resetHemolymph();
    const rt = new BrainRuntime(seed);
    runtime.current = rt;
    rt.onError = (message) => setError(message);
    rt.onReady = (n, nextSeed) => {
      setNeuronN(n);
      setSeed(nextSeed);
      pushModulation(rt, hemolymph.current.getModulation());
    };
    rt.onFrame = (frame, nextSummary) => {
      setLiveFrame(frame);
      setSummary(nextSummary);
      setTime(frame.time);
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

  const applySeed = (next: number) => {
    const value = next >>> 0;
    setSeed(value);
    runtime.current?.setSeed(value);
    if (live) {
      setLiveFrame(null);
      setSummary(null);
      setTime(0);
      const rt = runtime.current;
      if (rt) pushModulation(rt, hemolymph.current.getModulation());
    }
  };

  const frame = replay ? frameAt(replay, time) : liveFrame;
  const statusKind = replay ? replay.source.kind : live ? 'predicted' : null;
  const statusLabel = statusKind === 'predicted'
    ? t(lang, 'predicted')
    : statusKind === 'synthetic'
      ? t(lang, 'synthetic')
      : statusKind === 'measured'
        ? t(lang, 'measured')
        : t(lang, 'anatomyOnly');

  return <>
    <header>
      <h1>{t(lang, 'title')}</h1>
      <span>{t(lang, 'subtitle')}</span>
      <button className="lang-toggle" onClick={() => setLang(lang === 'pl' ? 'en' : 'pl')}>{t(lang, 'lang')}</button>
      <a href="https://github.com/cobanov/fly-connectome-template#readme">{t(lang, 'guide')}</a>
    </header>
    <main>
      <div className="toolbar">
        <span className="status">{playing ? t(lang, 'running') : t(lang, 'paused')} · {time.toFixed(2)} s{live && neuronN ? ` · ${neuronN.toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-US')} LIF` : ''}</span>
        <div className="controls">
          <button onClick={() => {
            setTime(0);
            setPlaying(false);
            resetHemolymph();
            if (live) {
              runtime.current?.reset(seed);
              const rt = runtime.current;
              if (rt) pushModulation(rt, hemolymph.current.getModulation());
            }
            setLiveFrame(null);
            setSummary(null);
          }}>{t(lang, 'reset')}</button>
          <button onClick={() => {
            if (!live && time >= duration) setTime(0);
            setPlaying(!playing);
          }}>{playing ? t(lang, 'pause') : t(lang, 'play')}</button>
          <label className="seed-field">{t(lang, 'seed')}
            <input
              type="number"
              min={0}
              max={0xffffffff}
              value={seed}
              aria-label={t(lang, 'seed')}
              onChange={(event) => applySeed(Number(event.target.value) || 0)}
            />
          </label>
          <label className="seed-field">
            <input
              type="checkbox"
              checked={showSpots}
              onChange={(event) => setShowSpots(event.target.checked)}
            />
            {t(lang, 'spots')}
          </label>
          {live
            ? <button onClick={() => { stopLive(); setPlaying(false); setTime(0); }}>{t(lang, 'liveStop')}</button>
            : <button disabled={!atlas} onClick={() => void startLive()}>{t(lang, 'live')}</button>}
          <button disabled={!live} onClick={() => {
            const rt = runtime.current;
            if (!rt?.circuit) return;
            rt.stimulate(idsForSubclasses(rt.circuit, LABELLAR_SUBCLASSES), PROTOCOL_STIM_HZ, PROTOCOL_DURATION_MS);
          }}>{t(lang, 'stimLabellar')}</button>
          <button disabled={!atlas} onClick={() => void example()}>{t(lang, 'loadExample')}</button>
          <button disabled={!atlas} onClick={() => file.current?.click()}>{t(lang, 'loadJson')}</button>
          {(replay || live) && <button onClick={() => {
            stopLive();
            setReplay(null);
            setTime(0);
            setPlaying(false);
          }}>{t(lang, 'clearOutput')}</button>}
          <input ref={file} hidden type="file" accept=".json,application/json" onChange={async (event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (!selected) return;
            try {
              if (selected.size > 10 * 1024 * 1024) throw Error('Replay must be under 10 MB.');
              accept(JSON.parse(await selected.text()));
            } catch (e) {
              setError(String(e));
            }
          }} />
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="workbench">
        <section className="panel environment-panel">
          <h2>{t(lang, 'env')}</h2>
          <Environment time={time} spots={spots} showSpots={showSpots} />
          <div className="panel-bottom">{t(lang, 'envFoot')}</div>
        </section>
        <section className="panel brain-panel">
          <h2>{t(lang, 'brain')} <span>MaleCNS v1.0</span></h2>
          {atlas ? <BrainScene atlas={atlas} frame={frame} /> : <p className="loading" role="status">{t(lang, 'loadingAnatomy')}</p>}
          <div className="panel-bottom">{atlas?.visibleIds.size.toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-US') ?? '…'} {t(lang, 'somata')} <a href={asset('data/brain-atlas/NOTICE.md')}>{t(lang, 'dataNotice')}</a></div>
        </section>
        <section className="panel fly-panel">
          <h2>{t(lang, 'body')} <span>Flybody</span></h2>
          <FlyScene
            playing={playing}
            lang={lang}
            mn9Rate={summary?.mn9Rate ?? 0}
            satiety={hemoHud.satiety}
            bitter={TWAROG_MAMUTA_WANILIOWY.bitter}
            odor={TWAROG_MAMUTA_WANILIOWY.odor}
            onChemo={(sample: ChemoSample) => {
              // Contact → gust_labellar / gust_pharyngeal only. Vanillin odor
              // steers ORIENT in FlyScene and must never be posted onto MN9.
              const rt = runtime.current;
              if (!live || !rt?.circuit) return;
              const now = performance.now();
              if (now - lastChemoMs.current < 80) return;
              lastChemoMs.current = now;
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
              let bitten = false;
              for (const event of events) {
                if (event.type === 'consume') {
                  hemolymph.current.eat(event.massGrams);
                  bitten = true;
                }
              }
              if (bitten) setHemoHud(hemolymph.current.hud());
            }}
            onHud={setFeedHud}
          />
          <div className="panel-bottom">{t(lang, 'bodyFoot')} <span>{t(lang, 'feedHud', { state: feedHud.state, clip: feedHud.clip })}</span></div>
        </section>
      </div>
      <section className="model-status" aria-label="Model provenance">
        <strong>{statusLabel}</strong>
        <p>{replay ? replay.source.name : live ? BRAIN_SOURCE.name : t(lang, 'noModel')}</p>
        {live && <p>{t(lang, 'liveHint')} · {t(lang, 'seed')} {seed}</p>}
        <p>{t(lang, 'hemoHud', {
          tre: n01(hemoHud.trehalose),
          hunger: n01(hemoHud.hungerDrive),
          satiety: n01(hemoHud.satiety),
          crop: n01(hemoHud.cropVolume),
          gut: n01(hemoHud.gutLoad),
        })}</p>
        {replay && <>
          <p>{t(lang, 'replayNorm')}: {replay.source.normalization}</p>
          <p>{replay.source.kind === 'synthetic' ? t(lang, 'syntheticNote') : t(lang, 'declaredNote')}</p>
        </>}
        {live && summary && <p>{t(lang, 'summary', {
          mn9: hz(summary.mn9Rate),
          drive: hz(summary.gustDriveRate),
          neu: hz(summary.gustNeutralRate),
          sup: hz(summary.gustSuppressRate),
          mn: hz(summary.mnOtherRate),
          dn: hz(summary.dnRate),
        })}</p>}
        {!live && <label>{t(lang, 'time')} <input type="range" aria-label={t(lang, 'time')} min="0" max={duration} step=".01" value={time} onChange={(event) => setTime(Number(event.target.value))} /><span>{duration.toFixed(1)} s</span></label>}
      </section>
      <details>
        <summary>{t(lang, 'methods')}</summary>
        <p>{t(lang, 'methods1')}</p>
        <p>{t(lang, 'methods2')}</p>
        <p>{t(lang, 'methodsLif')}</p>
        <p>{t(lang, 'methodsMetabolism')}</p>
        <p>{t(lang, 'methodsBody')}</p>
        <p>{t(lang, 'methodsChemo')}</p>
        <p>{t(lang, 'methods3')} <a href="https://male-cns.janelia.org/download/">{t(lang, 'maleCns')}</a>, CC BY 4.0. <a href={asset('data/brain-atlas/manifest.json')}>{t(lang, 'hashes')}</a>.</p>
        <p>{t(lang, 'methods4')}</p>
      </details>
    </main>
    <Attribution />
  </>;
}

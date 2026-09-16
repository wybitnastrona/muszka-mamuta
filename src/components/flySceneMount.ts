import * as THREE from 'three';
import type { MutableRefObject } from 'react';
import { asset } from '../lib/atlas';
import type { CameraPreset, ClipName, DebugMode, FeedingEvent, FeedingState } from '../body/types.ts';
import { formatGateOverlay } from '../body/debugQuery.ts';
import type { PopulationSummary } from '../brain/lif.ts';
import type { Hemolymph } from '../metabolism/hemolymph.ts';
import type { SceneHudSnapshot } from './Hud.tsx';
import { closeupOffset, frameForPreset, kitchenFrame, labelCloseupFrame, reelFrame, usesShallowDof, CLOSEUP_APERTURE, CLOSEUP_MAXBLUR, REEL_APERTURE, REEL_MAXBLUR } from '../body/cameras.ts';
import { CLIPS, MOTION_LOOP_ORDER, MotionMixer, reviewTime, sampleClip } from '../body/feedingMotion.ts';
import { createKitchen, poseContactAo, poseSpoon } from '../body/kitchen.ts';
import { applyPoseToBones, buildFlybodyRig } from '../body/rig.ts';
import {
  AntennaFlick,
  applyAntennaFlickDeg,
  applyFootContactOffset,
  applyGazeStabilization,
  handheldOffset,
  standingFootSinkMm,
} from '../body/appearanceMotion.ts';
import { applyWingVisual } from '../body/wings.ts';
import { describeFlybodyHierarchy, type FlybodyMeta } from '../body/hierarchy.ts';
import { SceneDirector } from '../body/sceneDirector.ts';
import { odorGradientYaw } from '../body/odorField.ts';
import { createProceduralTwarog, type ProceduralTwarog } from '../food/proceduralTwarog.ts';
import { TwarogSystem, type ChemoSample } from '../food/twarogSystem.ts';
import { createTwarogView, type TwarogView } from './Twarog.tsx';
import { createFlyViewport } from './flyViewport.ts';
import { createPackaging } from '../scene/Packaging.tsx';
import { kitchenLayout } from '../scene/layout.ts';
import { POUCH_MM, flyRootScale, mm } from '../scene/scale.ts';
import { disposeKitchenTextures, loadKitchenTextures, type KitchenTextures } from '../scene/textures.ts';
import {
  RECORD_FPS,
  RECORD_HEIGHT,
  RECORD_WIDTH,
  parseRecordSeconds,
  startRecording,
  type RecordingHandle,
  type StartRecordingOpts,
} from '../recording/recorder.ts';
import { REEL_SLOGAN_PL } from '../hud/reel.ts';

export type FlySceneLive = {
  playing: boolean;
  mn9Rate: number;
  satiety: number;
  bitter: number;
  odor: number;
  cropVolume: number;
};

export type FlyCommand = 'idle' | 'restartMeal' | 'newPortion';

export type FlyRecorderApi = {
  startRecording: (opts: StartRecordingOpts) => Promise<Blob>;
  stopRecording: () => Promise<Blob | null>;
  isRecording: () => boolean;
};

export type FlySceneMountOpts = {
  element: HTMLElement;
  debug: DebugMode;
  inputRef: MutableRefObject<FlySceneLive>;
  presetRef: MutableRefObject<CameraPreset>;
  commandRef: MutableRefObject<FlyCommand>;
  seedRef: MutableRefObject<number>;
  setError: (value: string) => void;
  setClipLabel: (value: ClipName) => void;
  setStateLabel: (value: FeedingState) => void;
  setToast: (value: boolean) => void;
  setPortions: (value: number) => void;
  setCaption: (value: string) => void;
  onEventsRef: MutableRefObject<((events: readonly FeedingEvent[]) => void) | undefined>;
  onHudRef: MutableRefObject<((hud: SceneHudSnapshot) => void) | undefined>;
  onChemoRef: MutableRefObject<((sample: ChemoSample) => void) | undefined>;
  onPortionRef: MutableRefObject<((count: number) => void) | undefined>;
  summaryRef?: MutableRefObject<PopulationSummary | null>;
  hemoRef?: MutableRefObject<Hemolymph>;
  recorderApiRef?: MutableRefObject<FlyRecorderApi | null>;
};

export function mountFlyScene(opts: FlySceneMountOpts): () => void {
  const { element, debug } = opts;
  const controller = new AbortController();
  let disposed = false;
  const view = createFlyViewport(element);
  const { world, camera, controls, envMap, materials, renderer } = view;
  const mixer = new MotionMixer();
  mixer.setJitter(1, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let rig: ReturnType<typeof buildFlybodyRig> | null = null;
  let radius = 10;
  let twarog: ProceduralTwarog | null = null;
  let twarogView: TwarogView | null = null;
  let director: SceneDirector | null = null;
  let packLabel: THREE.Object3D | null = null;
  let kitchenTex: KitchenTextures | null = null;
  const layout = kitchenLayout();
  const kitchen = createKitchen(layout.table.width, layout.table.depth, view.quality);
  world.add(kitchen.group);
  const labWorld = new THREE.Vector3();
  const labRight = new THREE.Vector3();
  const foodWorld = new THREE.Vector3();
  const biteWorld = new THREE.Vector3();
  const contactMid = new THREE.Vector3();
  const tarsusL = new THREE.Vector3();
  const tarsusR = new THREE.Vector3();
  const closeCam = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let motionIndex = 0;
  let motionHold = 0;
  let lastHud = { state: 'SEARCH' as FeedingState, clip: 'idle' as ClipName };
  let lastCaption = '';
  let frameId = 0;
  let previous = performance.now();
  let ready = false;
  let appliedPreset: CameraPreset | null = null;
  let gateEl: HTMLPreElement | null = null;
  if (debug === 'gate') {
    gateEl = document.createElement('pre');
    gateEl.className = 'fly-debug-gate';
    (element.parentElement ?? element).appendChild(gateEl);
  }
  const spoon = kitchen.spoon;
  const gagShadow = kitchen.gagShadow;
  const antennaFlick = new AntennaFlick();
  const headWorld = new THREE.Vector3();
  const reelLook = new THREE.Vector3();
  const reelPos = new THREE.Vector3();
  const drift = new THREE.Vector3();
  let sceneTime = 0;
  let rec: RecordingHandle | null = null;
  const gagCrumb = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.1, 1.3),
    new THREE.MeshStandardMaterial({ color: 0xe1d7ca, roughness: 0.85 }),
  );
  gagCrumb.visible = false;
  world.add(gagCrumb);
  const rootEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  const toFood = (worldPt: THREE.Vector3) => {
    tmp.copy(worldPt);
    twarog!.group.worldToLocal(tmp);
    return { x: tmp.x, y: tmp.y, z: tmp.z };
  };

  const applyPreset = (name: CameraPreset) => {
    if (debug === 'label' && packLabel) {
      const frame = labelCloseupFrame(packLabel);
      camera.fov = frame.fov;
      camera.position.fromArray(frame.position);
      camera.lookAt(...frame.lookAt);
      camera.updateProjectionMatrix();
      controls.target.fromArray(frame.lookAt);
      controls.enabled = true;
      controls.update();
      appliedPreset = name;
      return;
    }
    if (name === 'Zbliżenie' || name === 'Reel') {
      controls.enabled = false;
      appliedPreset = name;
      return;
    }
    const frame = frameForPreset(name, radius);
    camera.fov = frame.fov;
    camera.position.fromArray(frame.position);
    camera.lookAt(...frame.lookAt);
    camera.updateProjectionMatrix();
    controls.target.fromArray(frame.lookAt);
    controls.enabled = debug !== 'weights';
    controls.update();
    appliedPreset = name;
  };

  const updateCloseup = (dt: number) => {
    if (!rig || !twarog) return;
    const left = rig.bones.get('labellum_L');
    const right = rig.bones.get('labellum_R');
    if (left && right) { left.getWorldPosition(labWorld); right.getWorldPosition(labRight); labWorld.lerp(labRight, 0.5); }
    else rig.contact.getWorldPosition(labWorld);
    biteWorld.copy(twarog.biteFront);
    twarog.group.localToWorld(biteWorld);
    contactMid.copy(labWorld).lerp(biteWorld, 0.18);
    const off = closeupOffset(radius);
    closeCam.copy(contactMid).add(new THREE.Vector3(off[0], off[1], off[2]));
    camera.position.lerp(closeCam, 1 - Math.exp(-dt / 0.22));
    camera.lookAt(contactMid);
    camera.fov = 32;
    camera.updateProjectionMatrix();
    controls.target.copy(contactMid);
  };

  const updateReel = (dt: number) => {
    const frame = reelFrame(radius);
    reelLook.fromArray(frame.lookAt);
    if (rig) {
      const head = rig.bones.get('head');
      if (head) {
        head.getWorldPosition(headWorld);
        reelLook.lerp(headWorld, 0.22);
      }
    }
    reelPos.fromArray(frame.position);
    drift.copy(handheldOffset(sceneTime));
    camera.position.lerp(reelPos.add(drift), 1 - Math.exp(-dt / 0.18));
    camera.lookAt(reelLook);
    camera.fov = frame.fov;
    camera.updateProjectionMatrix();
    controls.target.copy(reelLook);
  };

  const applyVisualPolish = (
    mode: 'ground' | 'flight' | 'onFood',
    pitch: number,
    roll: number,
    odorYaw: number,
    dt: number,
    crop: number,
    flyX: number,
    flyY: number,
    flyZ: number,
  ) => {
    if (!rig) return;
    const head = rig.bones.get('head');
    if (head) applyGazeStabilization(head, pitch, roll);
    applyAntennaFlickDeg(rig.bones, antennaFlick.update(dt, odorYaw));
    const sink = standingFootSinkMm(mode);
    const tL = rig.bones.get('foreleg_L_tarsus');
    const tR = rig.bones.get('foreleg_R_tarsus');
    if (tL) applyFootContactOffset(tL, rig.tarsusRest.L, sink);
    if (tR) applyFootContactOffset(tR, rig.tarsusRest.R, sink);
    view.setCropVolume(crop);
    poseContactAo(kitchen.contactAo, flyX, Math.max(0.08, flyY - 1.8), flyZ, mode !== 'flight');
  };

  const updateDof = (preset: CameraPreset) => {
    const on = view.quality.dof && usesShallowDof(preset);
    let focus = 40;
    if (rig) {
      const head = rig.bones.get('head');
      if (head) {
        head.getWorldPosition(headWorld);
        focus = camera.position.distanceTo(headWorld);
      } else if (preset === 'Zbliżenie') {
        focus = camera.position.distanceTo(contactMid);
      }
    }
    view.setDof({
      enabled: on,
      focus,
      aperture: preset === 'Reel' ? REEL_APERTURE : CLOSEUP_APERTURE,
      maxblur: preset === 'Reel' ? REEL_MAXBLUR : CLOSEUP_MAXBLUR,
    });
  };

  const frameMouthparts = (tightMouth = false) => {
    if (!rig) return;
    const left = rig.bones.get('labellum_L');
    const right = rig.bones.get('labellum_R');
    const head = rig.bones.get('head');
    if (left && right) { left.getWorldPosition(labWorld); right.getWorldPosition(labRight); labWorld.lerp(labRight, 0.5); }
    else rig.contact.getWorldPosition(labWorld);
    const aim = labWorld.clone();
    if (!tightMouth && head) { head.getWorldPosition(foodWorld); aim.lerp(foodWorld, 0.45); }
    if (tightMouth) { camera.position.set(aim.x + 8, aim.y + 2, aim.z + 6); camera.lookAt(aim.x, aim.y, aim.z); camera.fov = 28; }
    else { camera.position.set(aim.x + 14, aim.y + 6, aim.z + 12); camera.lookAt(aim.x, aim.y - 1.5, aim.z); camera.fov = 30; }
    camera.updateProjectionMatrix();
  };

  const endRecord = (): Promise<Blob | null> => {
    const handle = rec;
    rec = null;
    view.setPixelSize(null);
    if (!handle) return Promise.resolve(null);
    return handle.stop();
  };

  const beginRecord = (recordOpts: StartRecordingOpts): Promise<Blob> => {
    if (rec) void rec.stop();
    view.setPixelSize({ width: recordOpts.width, height: recordOpts.height });
    rec = startRecording(recordOpts);
    const handle = rec;
    void handle.finished.finally(() => {
      if (rec === handle) rec = null;
      view.setPixelSize(null);
    });
    return handle.finished;
  };

  if (opts.recorderApiRef) {
    opts.recorderApiRef.current = {
      startRecording: (recordOpts) => beginRecord(recordOpts),
      stopRecording: () => endRecord(),
      isRecording: () => rec !== null,
    };
  }

  const tick = (now: number) => {
    if (disposed) return;
    const rawDt = Math.min(0.08, (now - previous) / 1000);
    previous = now;
    const live = opts.inputRef.current;
    const dt = !live.playing || document.hidden ? 0 : rawDt;
    sceneTime += dt;
    if (ready && rig && director) {
      const cmd = opts.commandRef.current;
      if (cmd === 'restartMeal') {
        director.reset(opts.seedRef.current);
        director.food.reset();
        twarogView?.resetCrumbs();
        opts.commandRef.current = 'idle';
      } else if (cmd === 'newPortion') {
        const n = director.food.nextPortion();
        twarogView?.resetCrumbs();
        opts.setPortions(n);
        opts.setToast(true);
        opts.onPortionRef.current?.(n);
        opts.commandRef.current = 'idle';
      }
    }
    if (ready && rig) {
      if (debug === 'weights') {
        applyPoseToBones(rig.bones, sampleClip(CLIPS.idle, 0, { reduceMotion: true }));
        world.updateMatrixWorld(true);
        frameMouthparts(true);
      } else if (debug === 'extend' || debug === 'pump') {
        const name = debug === 'extend' ? 'per' : 'pump';
        applyPoseToBones(rig.bones, sampleClip(CLIPS[name], reviewTime(name), { amplitude: 1, reduceMotion: true }));
        world.updateMatrixWorld(true);
        frameMouthparts(false);
      } else if (debug === 'label') {
        applyPoseToBones(rig.bones, sampleClip(CLIPS.idle, 0, { reduceMotion: true }));
      } else if (debug === 'motion') {
        const pose = mixer.update(dt);
        applyPoseToBones(rig.bones, pose);
        motionHold += dt;
        const clip = mixer.clip;
        const hold = clip.loop ? clip.duration * 2 : clip.duration + 0.18;
        if (mixer.ended || motionHold >= hold) {
          motionHold = 0;
          motionIndex = (motionIndex + 1) % MOTION_LOOP_ORDER.length;
          mixer.play(MOTION_LOOP_ORDER[motionIndex], { restart: true, fade: 0.12 });
          opts.setClipLabel(MOTION_LOOP_ORDER[motionIndex]);
        }
      } else if (twarog && twarogView && director) {
        const workerMn9 = opts.summaryRef?.current?.mn9Rate;
        const mn9Rate = typeof workerMn9 === 'number' ? workerMn9 : live.mn9Rate;
        const out = director.update({
          dt, mn9Rate, satiety: live.satiety, bitter: live.bitter, odor: live.odor,
          cameraDist: camera.position.distanceTo(twarog.group.position),
          cropVolume: live.cropVolume,
        });
        applyPoseToBones(rig.bones, out.flyPose.pose);
        const abd = rig.bones.get('abdomen');
        if (abd) abd.scale.set(out.flyPose.abdomenScale, out.flyPose.abdomenScale, 1);
        rig.root.position.copy(out.flyPose.position);
        rootEuler.set(out.flyPose.pitch, out.flyPose.heading, out.flyPose.bank + out.flyPose.roll, 'YXZ');
        rig.root.quaternion.setFromEuler(rootEuler);
        if (rig.wings) {
          applyWingVisual(rig.wings.L, {
            raise: out.flyPose.wingRaiseL,
            songDeg: out.flyPose.wingSongL,
            flicker: out.flyPose.wingFlicker,
            blurAlpha: out.flyPose.wingBlurAlpha,
          });
          applyWingVisual(rig.wings.R, {
            raise: out.flyPose.wingRaiseR,
            songDeg: out.flyPose.wingSongR,
            flicker: out.flyPose.wingFlicker,
            blurAlpha: out.flyPose.wingBlurAlpha,
          });
        }
        applyVisualPolish(
          out.mode,
          out.flyPose.pitch,
          out.flyPose.roll,
          odorGradientYaw(
            { x: out.flyPose.position.x, z: out.flyPose.position.z },
            { x: layout.curd.x, z: layout.curd.z },
          ),
          dt,
          live.cropVolume,
          out.flyPose.position.x,
          out.flyPose.position.y,
          out.flyPose.position.z,
        );
        poseSpoon(spoon, layout.table.width, layout.table.depth, out.spoonShadow);
        const gagMat = gagShadow.material as THREE.MeshBasicMaterial;
        gagMat.opacity = out.spoonShadow * 0.55;
        gagShadow.visible = out.spoonShadow > 0.02;
        gagShadow.position.set(spoon.position.x, 0.18, spoon.position.z);
        if (out.crumbAttach) {
          const bone = rig.bones.get(out.crumbAttach);
          if (bone) {
            bone.getWorldPosition(tmp);
            gagCrumb.position.copy(tmp);
            gagCrumb.visible = true;
          }
        } else {
          gagCrumb.visible = false;
        }
        if (out.caption !== lastCaption) {
          lastCaption = out.caption;
          opts.setCaption(out.caption);
        }
        opts.onHudRef.current?.({
          state: out.hudState,
          clip: out.flyPose.clipName,
          caption: out.caption,
          macro: out.macro,
          gag: out.gag,
          portions: out.portionCount,
          bites: out.bites,
          bitesTarget: out.bitesTarget,
          remainingFrac: out.remainingFrac,
          gramsEaten: out.gramsEaten,
          lifetimeBites: 0,
          lifetimeGrams: 0,
        });
        if (out.hudState !== lastHud.state || out.flyPose.clipName !== lastHud.clip) {
          lastHud = { state: out.hudState, clip: out.flyPose.clipName };
          opts.setClipLabel(out.flyPose.clipName);
          opts.setStateLabel(out.hudState);
        }
        if (out.events.length) opts.onEventsRef.current?.(out.events);
        for (const ev of out.crumbs) twarogView.spawnCrumbs(ev);
        for (const ev of out.events) {
          if (ev.type === 'portion') {
            twarogView.resetCrumbs();
            opts.setPortions(ev.count);
            opts.setToast(true);
            opts.onPortionRef.current?.(ev.count);
          }
        }
        if (out.chemo) opts.onChemoRef.current?.(out.chemo);
        if (gateEl) {
          const hemo = opts.hemoRef?.current;
          const mod = hemo?.getModulation();
          gateEl.textContent = formatGateOverlay({
            state: director.fsm.state,
            fsmMn9Hz: mn9Rate,
            workerMn9Hz: opts.summaryRef?.current?.mn9Rate ?? 0,
            mn9HoldMs: director.fsm.mn9HoldMs,
            hunger: hemo?.hungerDrive ?? 0,
            gustGain: mod?.gustGain ?? 0,
            mn9ThresholdShift: mod?.mn9ThresholdShift ?? 0,
            labellarHz: out.chemo?.rates.labellarHz ?? 0,
            pharyngealHz: out.chemo?.rates.pharyngealHz ?? 0,
            contactStrength: out.chemo?.contact.strength ?? 0,
          });
        }
        twarogView.update(dt, director.food);
        if (out.loopWrapped && rec) void rec.stop();
      }
      world.updateMatrixWorld(true);
      const want: CameraPreset = rec ? 'Reel' : opts.presetRef.current;
      if (debug === 'label' && packLabel) { if (appliedPreset !== want) applyPreset(want); }
      else if (want === 'Zbliżenie' && debug === 'off') {
        if (appliedPreset !== want) applyPreset(want);
        updateCloseup(Math.max(dt, 1 / 60));
      } else if (want === 'Reel' && debug === 'off') {
        if (appliedPreset !== want) applyPreset(want);
        updateReel(Math.max(dt, 1 / 60));
      } else if (want !== appliedPreset) applyPreset(want);
      if (debug === 'off') updateDof(want);
    }
    view.draw();
    if (rec) rec.capture(renderer.domElement);
    frameId = requestAnimationFrame(tick);
  };

  controls.addEventListener('change', view.draw);
  void (async () => {
    const get = async (path: string) => {
      const r = await fetch(asset(`data/flybody/${path}`), { signal: controller.signal });
      if (!r.ok) throw Error('Flybody asset unavailable');
      return r;
    };
    kitchenTex = await loadKitchenTextures(controller.signal);
    if (disposed) return;
    twarog = createProceduralTwarog(kitchenTex, { seed: 1 });
    twarog.group.position.set(layout.curd.x, layout.curd.y, layout.curd.z);
    world.add(twarog.group);
    const foodSystem = TwarogSystem.fromFracture(twarog.fractured, { seed: 1 });
    twarogView = createTwarogView(twarog);
    opts.setPortions(foodSystem.portionCount);
    const pack = createPackaging(kitchenTex, { anisotropy: renderer.capabilities.getMaxAnisotropy(), seed: 11, envMap });
    pack.group.position.set(layout.pouch.x, layout.pouch.y, layout.pouch.z);
    pack.group.rotation.y = layout.pouch.yaw;
    world.add(pack.group);
    packLabel = pack.labelFront;
    const meta = await (await get('model.json')).json() as FlybodyMeta;
    const buffer = await (await get(meta.binary)).arrayBuffer();
    if (disposed) return;
    describeFlybodyHierarchy(meta);
    const built = buildFlybodyRig(meta, buffer, materials, { debugWeights: debug === 'weights' });
    rig = built;
    built.root.scale.setScalar(flyRootScale());
    built.root.position.set(0, 0, 0);
    world.add(built.root);
    built.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(built.root);
    const spawnY = -bounds.min.y;
    built.root.position.set(layout.fly.x, spawnY, layout.fly.z);
    radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    director = new SceneDirector({
      food: foodSystem,
      foodOrigin: { x: layout.curd.x, y: layout.curd.y, z: layout.curd.z },
      pouch: {
        cx: layout.pouch.x, cz: layout.pouch.z,
        hx: mm(POUCH_MM.length) / 2, hz: mm(POUCH_MM.width) / 2, yaw: layout.pouch.yaw,
      },
      position: { x: layout.fly.x, y: spawnY, z: layout.fly.z },
      heading: 0.35,
      seed: 1,
      scriptedLoop: true,
      sampleContacts: ({ position, heading, pose }) => {
        built.root.position.set(position.x, position.y, position.z);
        built.root.rotation.y = heading;
        applyPoseToBones(built.bones, pose);
        built.bones.get('foreleg_L_tarsus')?.position.copy(built.tarsusRest.L);
        built.bones.get('foreleg_R_tarsus')?.position.copy(built.tarsusRest.R);
        world.updateMatrixWorld(true);
        const left = built.bones.get('labellum_L');
        const right = built.bones.get('labellum_R');
        if (left) left.getWorldPosition(labWorld); else built.contact.getWorldPosition(labWorld);
        if (right) right.getWorldPosition(labRight); else labRight.copy(labWorld);
        const tL = built.bones.get('foreleg_L_tarsus');
        const tR = built.bones.get('foreleg_R_tarsus');
        if (tL) tL.getWorldPosition(tarsusL); else tarsusL.copy(labWorld);
        if (tR) tR.getWorldPosition(tarsusR); else tarsusR.copy(labRight);
        return {
          labellum: toFood(labWorld.clone().lerp(labRight, 0.5)),
          sensors: [toFood(labWorld), toFood(labRight), toFood(tarsusL), toFood(tarsusR)],
        };
      },
    });
    if (debug === 'motion') mixer.play(MOTION_LOOP_ORDER[0], { restart: true, fade: 0 });
    else if (debug === 'extend') mixer.play('per', { restart: true, fade: 0 });
    else if (debug === 'pump') mixer.play('pump', { restart: true, fade: 0 });
    ready = true;
    applyPreset(opts.presetRef.current);
    if (debug === 'off' && opts.presetRef.current === 'Widok kuchni') {
      const frame = kitchenFrame(radius);
      camera.position.fromArray(frame.position);
      camera.lookAt(...frame.lookAt);
      controls.target.fromArray(frame.lookAt);
    }
    view.resize();
    if (debug === 'extend' || debug === 'pump') {
      const name = debug === 'extend' ? 'per' : 'pump';
      applyPoseToBones(built.bones, sampleClip(CLIPS[name], reviewTime(name), { amplitude: 1, reduceMotion: true }));
    }
    if (debug === 'weights' || debug === 'extend' || debug === 'pump') {
      world.updateMatrixWorld(true);
      frameMouthparts(debug === 'weights');
    }
    if (debug === 'label' && packLabel) {
      world.updateMatrixWorld(true);
      applyPreset('Widok kuchni');
    }
    const autoSec = parseRecordSeconds();
    if (autoSec !== null && !rec) {
      void beginRecord({
        fps: RECORD_FPS,
        width: RECORD_WIDTH,
        height: RECORD_HEIGHT,
        seconds: autoSec,
        caption: REEL_SLOGAN_PL,
        filename: 'loop-seed1.webm',
      });
    }
  })().catch((e) => { if (!disposed) opts.setError(String(e)); });

  const observer = new ResizeObserver(view.resize);
  observer.observe(element);
  view.resize();
  frameId = requestAnimationFrame(tick);
  return () => {
    disposed = true;
    controller.abort();
    cancelAnimationFrame(frameId);
    observer.disconnect();
    if (rec) void rec.stop();
    if (opts.recorderApiRef) opts.recorderApiRef.current = null;
    gateEl?.remove();
    if (kitchenTex) disposeKitchenTextures(kitchenTex);
    kitchen.maps.forEach((m) => m.dispose());
    twarogView?.dispose();
    view.dispose();
  };
}

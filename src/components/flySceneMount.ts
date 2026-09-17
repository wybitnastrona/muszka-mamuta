import * as THREE from 'three';
import type { MutableRefObject } from 'react';
import { asset } from '../lib/atlas';
import type { CameraPreset, ClipName, DebugMode, FeedingEvent, FeedingState } from '../body/types.ts';
import { formatGateOverlay, parseLoopVariant } from '../body/debugQuery.ts';
import type { PopulationSummary } from '../brain/lif.ts';
import type { Hemolymph } from '../metabolism/hemolymph.ts';
import type { SceneHudSnapshot } from './Hud.tsx';
import { closeupOffset, frameForPreset, labelCloseupFrame, usesShallowDof, CLOSEUP_APERTURE, CLOSEUP_MAXBLUR, REEL_APERTURE, REEL_MAXBLUR } from '../body/cameras.ts';
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
import { createHeadstage, type Headstage } from '../body/headstage.ts';
import { createScoop } from '../body/scoop.ts';
import { createTreadmill } from '../body/treadmill.ts';
import { createCreatineTub } from '../food/creatineTub.ts';
import { odorGradientYaw } from '../body/odorField.ts';
import { CreatineSystem } from '../food/creatineSystem.ts';
import type { ChemoSample } from '../food/twarogSystem.ts';
import { createPowderView, type PowderView } from './Powder.tsx';
import { createFlyViewport } from './flyViewport.ts';
import { kitchenLayout } from '../scene/layout.ts';
import { crumbSizeMm, flyRootScale, tableTopY } from '../scene/scale.ts';
import { disposeKitchenTextures, loadKitchenTextures, type KitchenTextures } from '../scene/textures.ts';
import { disposeCreatineTextures, loadCreatineTextures, type CreatineTextures } from '../scene/creatineTextures.ts';
import { KITCHEN_ENV_INTENSITY, loadKitchenEnvironment } from '../scene/kitchenEnvironment.ts';
import { updateStudioFog } from '../scene/kitchenFog.ts';
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
  let powderView: PowderView | null = null;
  let director: SceneDirector | null = null;
  let headstage: Headstage | null = null;
  let scoopHandle: ReturnType<typeof createScoop> | null = null;
  let millHandle: ReturnType<typeof createTreadmill> | null = null;
  let tubHandle: ReturnType<typeof createCreatineTub> | null = null;
  let kitchenTex: KitchenTextures | null = null;
  let creatineTex: CreatineTextures | null = null;
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
  let kitchenEnv: THREE.Texture | null = null;
  const boardCentre = new THREE.Vector3(0, tableTopY(), 0);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let gateEl: HTMLPreElement | null = null;
  if (debug === 'gate') {
    gateEl = document.createElement('pre');
    gateEl.className = 'fly-debug-gate';
    (element.parentElement ?? element).appendChild(gateEl);
  }
  // `?debug=flight`: solid boxes plus the 200 ms lookahead segment. Camera
  // logic runs as in 'off' so the reel path can be watched with helpers on.
  const cameraLive = debug === 'off' || debug === 'flight';
  const flightDebug = new THREE.Group();
  flightDebug.name = 'flightDebug';
  flightDebug.visible = debug === 'flight';
  const flightBoxes: THREE.Box3Helper[] = [];
  const flightObbs: THREE.LineSegments[] = [];
  const lookaheadGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const lookahead = new THREE.Line(lookaheadGeom, new THREE.LineBasicMaterial({ color: 0xffd166 }));
  let flightEl: HTMLPreElement | null = null;
  if (debug === 'flight') {
    flightDebug.add(lookahead);
    world.add(flightDebug);
    flightEl = document.createElement('pre');
    flightEl.className = 'fly-debug-gate';
    (element.parentElement ?? element).appendChild(flightEl);
  }
  const spoon = kitchen.spoon;
  const gagShadow = kitchen.gagShadow;
  const antennaFlick = new AntennaFlick();
  const headWorld = new THREE.Vector3();
  let sceneTime = 0;
  let rec: RecordingHandle | null = null;
  const gagCrumb = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.1, 1.3),
    new THREE.MeshStandardMaterial({ color: 0xe1d7ca, roughness: 0.85 }),
  );
  gagCrumb.visible = false;
  world.add(gagCrumb);
  // Morsel held between the forelegs while PUMP consumes a chunk. Scaled by
  // 1 − consumeProgress so it visibly disappears as the chunk is eaten.
  // Authored prop; the progress itself is the twaróg system's state.
  const heldCrumbSize = crumbSizeMm() * 1.6;
  const heldCrumb = new THREE.Mesh(
    new THREE.DodecahedronGeometry(heldCrumbSize * 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0xe1d7ca, roughness: 0.9 }),
  );
  heldCrumb.castShadow = true;
  heldCrumb.visible = false;
  world.add(heldCrumb);
  const rootEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  const obbOutline = (hx: number, hy: number, hz: number): THREE.LineSegments => {
    const geom = new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2));
    return new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: 0x6ee7b7 }));
  };

  const updateFlightDebug = (d: SceneDirector, mode: 'ground' | 'flight' | 'onFood' | 'mill') => {
    const s = d.debugSolids();
    while (flightBoxes.length < s.aabbs.length) {
      const h = new THREE.Box3Helper(new THREE.Box3(), 0xf87171);
      flightBoxes.push(h);
      flightDebug.add(h);
    }
    s.aabbs.forEach((b, i) => {
      flightBoxes[i]!.box.set(
        new THREE.Vector3(b.cx - b.hx, b.cy - b.hy, b.cz - b.hz),
        new THREE.Vector3(b.cx + b.hx, b.cy + b.hy, b.cz + b.hz),
      );
    });
    while (flightObbs.length < s.obbs.length) {
      const o = s.obbs[flightObbs.length]!;
      const l = obbOutline(o.hx, o.hy, o.hz);
      flightObbs.push(l);
      flightDebug.add(l);
    }
    s.obbs.forEach((o, i) => {
      flightObbs[i]!.position.set(o.cx, o.cy, o.cz);
      // toLocalObb is the inverse of a three.js +Y rotation by `yaw` (pack.group.rotation.y = yaw).
      flightObbs[i]!.rotation.y = o.yaw;
    });
    const pos = lookaheadGeom.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, s.lookahead.from.x, s.lookahead.from.y, s.lookahead.from.z);
    pos.setXYZ(1, s.lookahead.to.x, s.lookahead.to.y, s.lookahead.to.z);
    pos.needsUpdate = true;
    if (flightEl) {
      const food = s.aabbs[0]!;
      const dx = Math.max(0, Math.abs(s.lookahead.from.x - food.cx) - food.hx);
      const dz = Math.max(0, Math.abs(s.lookahead.from.z - food.cz) - food.hz);
      flightEl.textContent = [
        `mode          ${mode}`,
        `loop          ${d.loop.state}`,
        `flight        ${d.flight.kind}`,
        `xz gap→food   ${Math.hypot(dx, dz).toFixed(1)} mm`,
        `solid hits    ${s.flightHits}`,
      ].join('\n');
    }
  };

  const toFood = (worldPt: THREE.Vector3) => {
    tmp.copy(worldPt);
    powderView!.group.worldToLocal(tmp);
    return { x: tmp.x, y: tmp.y, z: tmp.z };
  };

  const applyReelCamera = (tSec: number) => {
    const frame = frameForPreset('Reel', radius);
    camera.fov = frame.fov;
    camera.position.fromArray(frame.position);
    if (!reduceMotion) camera.position.add(handheldOffset(tSec));
    camera.lookAt(...frame.lookAt);
    camera.updateProjectionMatrix();
    controls.target.fromArray(frame.lookAt);
    controls.enabled = false;
  };

  const applyPreset = (name: CameraPreset) => {
    view.setLetterbox(name === 'Reel');
    if (name === 'Zbliżenie') {
      controls.enabled = false;
      appliedPreset = name;
      return;
    }
    if (name === 'Reel') {
      applyReelCamera(sceneTime);
      appliedPreset = name;
      return;
    }
    const frame = name === 'Etykieta' && tubHandle
      ? labelCloseupFrame(tubHandle.labelAnchor)
      : frameForPreset(name, radius);
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
    if (!rig || !powderView) return;
    const left = rig.bones.get('labellum_L');
    const right = rig.bones.get('labellum_R');
    if (left && right) { left.getWorldPosition(labWorld); right.getWorldPosition(labRight); labWorld.lerp(labRight, 0.5); }
    else rig.contact.getWorldPosition(labWorld);
    biteWorld.set(layout.biteFront.x, layout.biteFront.y, layout.biteFront.z);
    contactMid.copy(labWorld).lerp(biteWorld, 0.18);
    const off = closeupOffset(radius);
    closeCam.copy(contactMid).add(new THREE.Vector3(off[0], off[1], off[2]));
    camera.position.lerp(closeCam, 1 - Math.exp(-dt / 0.22));
    camera.lookAt(contactMid);
    camera.fov = 32;
    camera.updateProjectionMatrix();
    controls.target.copy(contactMid);
  };

  const applyVisualPolish = (
    mode: 'ground' | 'flight' | 'onFood' | 'mill',
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

  const frameWeights = () => {
    if (!rig) return;
    rig.root.getWorldPosition(foodWorld);
    // 3/4 from the right, pulled back so all six leg colours read (OrbitControls
    // must not update() here — that would snap back to the kitchen spherical).
    camera.position.set(foodWorld.x + 42, foodWorld.y + 22, foodWorld.z + 38);
    camera.lookAt(foodWorld.x, foodWorld.y - 1, foodWorld.z);
    camera.fov = 30;
    camera.updateProjectionMatrix();
    controls.enabled = false;
    controls.target.set(foodWorld.x, foodWorld.y - 1, foodWorld.z);
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
        powderView?.resetCrumbs();
        opts.commandRef.current = 'idle';
      } else if (cmd === 'newPortion') {
        const n = director.food.nextPortion();
        powderView?.resetCrumbs();
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
        frameWeights();
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
      } else if (powderView && director) {
        const workerMn9 = opts.summaryRef?.current?.mn9Rate;
        const mn9Rate = typeof workerMn9 === 'number' ? workerMn9 : live.mn9Rate;
        const out = director.update({
          dt, mn9Rate, satiety: live.satiety, bitter: live.bitter, odor: live.odor,
          cameraDist: camera.position.distanceTo(powderView.group.position),
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
            blurAlpha: out.flyPose.wingBlurAlphaL,
            flickDeg: out.flyPose.wingFlickL,
          });
          applyWingVisual(rig.wings.R, {
            raise: out.flyPose.wingRaiseR,
            songDeg: out.flyPose.wingSongR,
            flicker: out.flyPose.wingFlicker,
            blurAlpha: out.flyPose.wingBlurAlphaR,
            flickDeg: out.flyPose.wingFlickR,
          });
        }
        applyVisualPolish(
          out.mode,
          out.flyPose.pitch,
          out.flyPose.roll,
          odorGradientYaw(
            { x: out.flyPose.position.x, z: out.flyPose.position.z },
            { x: layout.pile.x, z: layout.pile.z },
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
        const held = out.heldCrumb;
        const tL = rig.bones.get('foreleg_L_tarsus');
        const tR = rig.bones.get('foreleg_R_tarsus');
        if (held && tL && tR && held.progress < 0.97) {
          tL.getWorldPosition(tarsusL);
          tR.getWorldPosition(tarsusR);
          heldCrumb.position.lerpVectors(tarsusL, tarsusR, 0.5);
          heldCrumb.position.y += heldCrumbSize * 0.35;
          const s = Math.max(0.05, 1 - held.progress);
          heldCrumb.scale.setScalar(s);
          heldCrumb.rotation.y = held.chunkIndex * 0.61 + out.flyPose.heading;
          heldCrumb.visible = true;
        } else {
          heldCrumb.visible = false;
        }
        if (scoopHandle && tR) {
          const grip = new THREE.Matrix4();
          tR.updateWorldMatrix(true, false);
          grip.copy(tR.matrixWorld);
          scoopHandle.update({
            mode: out.scoop?.mode ?? 'table',
            fill: out.scoop?.fill ?? 0,
            dipU: out.scoop?.dipU ?? 0,
            table: layout.scoop,
            dropped: {
              x: layout.mill.x - layout.mill.hx - 10,
              y: tableTopY() + 0.6,
              z: layout.mill.z + 16,
              yaw: 0.3,
            },
            gripWorld: out.scoop?.mode === 'held' ? grip : null,
            heading: out.flyPose.heading,
          });
        }
        millHandle?.update(dt, out.mode === 'mill');
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
        for (const ev of out.crumbs) powderView.spawnCrumbs(ev);
        for (const ev of out.events) {
          if (ev.type === 'portion') {
            powderView.resetCrumbs();
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
        if (director.food instanceof CreatineSystem) powderView.update(dt, director.food);
        if (flightEl) updateFlightDebug(director, out.mode);
        if (out.loopWrapped && rec) void rec.stop();
      }
      world.updateMatrixWorld(true);
      // After the rig's world matrices: the cable socket is a bone child.
      headstage?.update(dt);
      const want: CameraPreset = rec ? 'Reel' : opts.presetRef.current;
      if (debug === 'weights') {
        frameWeights();
      } else if (want === 'Reel' && cameraLive) {
        if (appliedPreset !== want) applyPreset(want);
        applyReelCamera(sceneTime);
      } else if (want === 'Zbliżenie' && cameraLive) {
        if (appliedPreset !== want) applyPreset(want);
        updateCloseup(Math.max(dt, 1 / 60));
      } else if (want !== appliedPreset) applyPreset(want);
      updateStudioFog(view.scene, camera, boardCentre);
      if (cameraLive) updateDof(want);
    }
    view.draw();
    if (rec) rec.capture(renderer.domElement);
    frameId = requestAnimationFrame(tick);
  };

  controls.addEventListener('change', () => view.draw());
  void (async () => {
    const get = async (path: string) => {
      const r = await fetch(asset(`data/flybody/${path}`), { signal: controller.signal });
      if (!r.ok) throw Error('Flybody asset unavailable');
      return r;
    };
    kitchenTex = await loadKitchenTextures(controller.signal);
    if (disposed) return;
    try {
      creatineTex = await loadCreatineTextures(controller.signal);
    } catch (err) {
      console.warn('Creatine tub textures unavailable; using authored plastic.', err);
      creatineTex = null;
    }
    try {
      kitchenEnv = await loadKitchenEnvironment(view.pmrem, controller.signal);
      if (disposed) {
        kitchenEnv.dispose();
        kitchenEnv = null;
        return;
      }
      view.scene.environment = kitchenEnv;
      view.scene.environmentIntensity = KITCHEN_ENV_INTENSITY;
    } catch {
      kitchenEnv = null;
    }
    powderView = createPowderView(layout.pile, creatineTex?.crumb ?? null);
    world.add(powderView.group);
    const foodSystem = CreatineSystem.create({ seed: 1 });
    opts.setPortions(foodSystem.portionCount);
    tubHandle = createCreatineTub(creatineTex);
    world.add(tubHandle.group);
    scoopHandle = createScoop();
    world.add(scoopHandle.group);
    millHandle = createTreadmill();
    world.add(millHandle.group);
    const meta = await (await get('model.json')).json() as FlybodyMeta;
    const buffer = await (await get(meta.binary)).arrayBuffer();
    if (disposed) return;
    describeFlybodyHierarchy(meta);
    const built = buildFlybodyRig(meta, buffer, materials, { debugWeights: debug === 'weights' });
    rig = built;
    built.root.scale.setScalar(flyRootScale());
    built.root.position.set(0, 0, 0);
    world.add(built.root);
    // Headstage prop: cap rides the head bone, cable lives in world space.
    const headBone = built.bones.get('head');
    if (headBone && debug !== 'weights') {
      headstage = createHeadstage();
      headBone.add(headstage.cap);
      world.add(headstage.cable);
    }
    built.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(built.root);
    const spawnY = tableTopY() + (-bounds.min.y);
    built.root.position.set(layout.fly.x, spawnY, layout.fly.z);
    radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    director = new SceneDirector({
      food: foodSystem,
      foodOrigin: { x: layout.pile.x, y: layout.pile.y, z: layout.pile.z },
      pouch: {
        cx: layout.mill.x, cz: layout.mill.z,
        hx: layout.mill.hx, hz: layout.mill.hz, yaw: layout.mill.yaw,
      },
      position: { x: layout.fly.x, y: spawnY, z: layout.fly.z },
      heading: 0.35,
      seed: 1,
      scriptedLoop: true,
      loopVariant: parseLoopVariant(),
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
    if (debug !== 'weights') applyPreset(opts.presetRef.current);
    view.resize();
    if (debug === 'extend' || debug === 'pump') {
      const name = debug === 'extend' ? 'per' : 'pump';
      applyPoseToBones(built.bones, sampleClip(CLIPS[name], reviewTime(name), { amplitude: 1, reduceMotion: true }));
    }
    if (debug === 'weights') {
      world.updateMatrixWorld(true);
      frameWeights();
    } else if (debug === 'extend' || debug === 'pump') {
      world.updateMatrixWorld(true);
      frameMouthparts(false);
    }
    if (debug === 'label') {
      world.updateMatrixWorld(true);
      applyPreset('Etykieta');
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
    kitchenEnv?.dispose();
    if (kitchenTex) disposeKitchenTextures(kitchenTex);
    if (creatineTex) disposeCreatineTextures(creatineTex);
    kitchen.maps.forEach((m) => m.dispose());
    powderView?.dispose();
    tubHandle?.dispose();
    scoopHandle?.dispose();
    millHandle?.dispose();
    headstage?.dispose();
    view.dispose();
  };
}

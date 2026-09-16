import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { asset } from '../lib/atlas';
import type { CameraPreset, ClipName, FeedingEvent, FeedingState } from '../body/types.ts';
import { CAMERA_PRESETS } from '../body/cameras.ts';
import { closeupOffset, frameForPreset, kitchenFrame, labelCloseupFrame } from '../body/cameras.ts';
import { parseDebugMode } from '../body/debugQuery.ts';
import { CLIPS, CLIP_DURATION, MOTION_LOOP_ORDER, MotionMixer, reviewTime, sampleClip } from '../body/feedingMotion.ts';
import { FeedingStateMachine } from '../body/feedingStateMachine.ts';
import { createTable } from '../body/kitchen.ts';
import { odorConcentration, odorGradientYaw } from '../body/odorField.ts';
import { WEIGHT_LEGEND } from '../body/palette.ts';
import { applyPoseToBones, buildFlybodyRig } from '../body/rig.ts';
import { describeFlybodyHierarchy, type FlybodyMeta } from '../body/hierarchy.ts';
import { TWAROG_MAMUTA_WANILIOWY } from '../food/foodProfile.ts';
import { createProceduralTwarog, type ProceduralTwarog } from '../food/proceduralTwarog.ts';
import { TwarogSystem, clampOutsideXzObb, type ChemoSample } from '../food/twarogSystem.ts';
import { createTwarogView, TwarogHud, type TwarogView } from './Twarog.tsx';
import type { Lang } from '../i18n.ts';
import { createPackaging } from '../scene/Packaging.tsx';
import { kitchenLayout } from '../scene/layout.ts';
import {
  FLY_WALK_MM_S,
  POUCH_MM,
  bodyCollisionPadMm,
  flyRootScale,
  mm,
} from '../scene/scale.ts';
import { disposeKitchenTextures, loadKitchenTextures, type KitchenTextures } from '../scene/textures.ts';

type Model = FlybodyMeta;

type FlySceneProps = {
  playing?: boolean;
  mn9Rate?: number;
  satiety?: number;
  bitter?: number;
  odor?: number;
  lang?: Lang;
  onEvents?: (events: readonly FeedingEvent[]) => void;
  onHud?: (hud: { state: FeedingState; clip: ClipName }) => void;
  onChemo?: (sample: ChemoSample) => void;
  onPortion?: (count: number) => void;
};

export function FlyScene({
  playing = true,
  mn9Rate = 0,
  satiety = 0,
  bitter = 0,
  odor = TWAROG_MAMUTA_WANILIOWY.odor,
  lang = 'pl',
  onEvents,
  onHud,
  onChemo,
  onPortion,
}: FlySceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const debug = parseDebugMode();
  const initialPreset: CameraPreset = debug === 'extend' || debug === 'pump' || debug === 'weights'
    ? 'Zbliżenie'
    : 'Widok kuchni';
  const [preset, setPreset] = useState<CameraPreset>(initialPreset);
  const [clipLabel, setClipLabel] = useState(debug === 'motion' ? MOTION_LOOP_ORDER[0] : 'odorTrack');
  const [stateLabel, setStateLabel] = useState<FeedingState>('SEARCH');
  const [toast, setToast] = useState(false);
  const [portions, setPortions] = useState(0);
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const inputRef = useRef({ playing, mn9Rate, satiety, bitter, odor });
  inputRef.current = { playing, mn9Rate, satiety, bitter, odor };
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;
  const onHudRef = useRef(onHud);
  onHudRef.current = onHud;
  const onChemoRef = useRef(onChemo);
  onChemoRef.current = onChemo;
  const onPortionRef = useRef(onPortion);
  onPortionRef.current = onPortion;

  useEffect(() => {
    const element = host.current!;
    const controller = new AbortController();
    let disposed = false;
    const scene = new THREE.Scene();
    const world = new THREE.Group();
    scene.add(world);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.08, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    element.append(renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.maxDistance = 600;
    controls.minDistance = 8;
    scene.add(new THREE.HemisphereLight(0xfff1dd, 0x1a222c, 1.1));
    const key = new THREE.DirectionalLight(0xffe4c4, 2.6);
    key.position.set(90, 160, 70);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 20;
    key.shadow.camera.far = 480;
    key.shadow.camera.left = -180;
    key.shadow.camera.right = 180;
    key.shadow.camera.top = 180;
    key.shadow.camera.bottom = -180;
    key.shadow.radius = 6;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc5d4e4, 0.55);
    fill.position.set(-70, 60, -40);
    scene.add(fill);
    const materials: Record<string, THREE.Material> = {};
    const colors: Record<string, number> = {
      body: 0x9e6834, black: 0x15110e, red: 0xad331f, ocelli: 0xe6b351,
      'bristle-brown': 0x281c10, lower: 0xbb8949, brown: 0x52351f,
    };
    for (const [keyName, color] of Object.entries(colors)) {
      materials[keyName] = new THREE.MeshStandardMaterial({ color, roughness: 0.65 });
    }
    materials.membrane = new THREE.MeshStandardMaterial({
      color: 0xaabbcc, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false,
    });

    const mixer = new MotionMixer();
    mixer.setJitter(1, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const fsm = new FeedingStateMachine({ heading: 0.35 });
    let rig: ReturnType<typeof buildFlybodyRig> | null = null;
    let radius = 10;
    let twarog: ProceduralTwarog | null = null;
    let twarogView: TwarogView | null = null;
    let foodSystem: TwarogSystem | null = null;
    let refillClip: 'retract' | 'groom' | null = null;
    let refillHold = 0;
    let packLabel: THREE.Object3D | null = null;
    let kitchenTex: KitchenTextures | null = null;
    const layout = kitchenLayout();
    const table = createTable(layout.table.width, layout.table.depth);
    world.add(table);
    const labWorld = new THREE.Vector3();
    const labRight = new THREE.Vector3();
    const foodWorld = new THREE.Vector3();
    const biteWorld = new THREE.Vector3();
    const contactMid = new THREE.Vector3();
    const tarsusL = new THREE.Vector3();
    const tarsusR = new THREE.Vector3();
    const labLocal = new THREE.Vector3();
    const sensorLocal: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const closeCam = new THREE.Vector3();
    let motionIndex = 0;
    let motionHold = 0;
    let lastHud = { state: 'SEARCH' as FeedingState, clip: 'idle' as ClipName };
    let frameId = 0;
    let previous = performance.now();
    let ready = false;

    let appliedPreset: CameraPreset | null = null;
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
      if (name === 'Zbliżenie') {
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

    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };

    const updateCloseup = (dt: number) => {
      if (!rig || !twarog) return;
      const left = rig.bones.get('labellum_L');
      const right = rig.bones.get('labellum_R');
      if (left && right) {
        left.getWorldPosition(labWorld);
        right.getWorldPosition(labRight);
        labWorld.lerp(labRight, 0.5);
      } else {
        rig.contact.getWorldPosition(labWorld);
      }
      biteWorld.copy(twarog.biteFront);
      twarog.group.localToWorld(biteWorld);
      contactMid.copy(labWorld).lerp(biteWorld, 0.18);
      const off = closeupOffset(radius);
      closeCam.copy(contactMid).add(new THREE.Vector3(off[0], off[1], off[2]));
      const a = 1 - Math.exp(-dt / 0.22);
      camera.position.lerp(closeCam, a);
      camera.lookAt(contactMid);
      camera.fov = 32;
      camera.updateProjectionMatrix();
      controls.target.copy(contactMid);
    };

    const frameMouthparts = (tightMouth = false) => {
      if (!rig) return;
      const left = rig.bones.get('labellum_L');
      const right = rig.bones.get('labellum_R');
      const head = rig.bones.get('head');
      if (left && right) {
        left.getWorldPosition(labWorld);
        right.getWorldPosition(labRight);
        labWorld.lerp(labRight, 0.5);
      } else {
        rig.contact.getWorldPosition(labWorld);
      }
      const aim = labWorld.clone();
      if (!tightMouth && head) {
        head.getWorldPosition(foodWorld);
        aim.lerp(foodWorld, 0.45);
      }
      if (tightMouth) {
        camera.position.set(aim.x + 8, aim.y + 2, aim.z + 6);
        camera.lookAt(aim.x, aim.y, aim.z);
        camera.fov = 28;
      } else {
        camera.position.set(aim.x + 14, aim.y + 6, aim.z + 12);
        camera.lookAt(aim.x, aim.y - 1.5, aim.z);
        camera.fov = 30;
      }
      camera.updateProjectionMatrix();
    };

    const draw = () => renderer.render(scene, camera);

    const tick = (now: number) => {
      if (disposed) return;
      const rawDt = Math.min(0.08, (now - previous) / 1000);
      previous = now;
      const live = inputRef.current;
      const dt = !live.playing || document.hidden ? 0 : rawDt;
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
            setClipLabel(MOTION_LOOP_ORDER[motionIndex]);
          }
        } else if (twarog && foodSystem && twarogView) {
          const flyPos = rig.root.position;
          const foodOrigin = twarog.group.position;
          const foodXZ = { x: foodOrigin.x, z: foodOrigin.z };
          const posXZ = { x: flyPos.x, z: flyPos.z };
          const approach = foodSystem.approachTarget(
            { x: flyPos.x, y: flyPos.y, z: flyPos.z },
            { x: foodOrigin.x, y: foodOrigin.y, z: foodOrigin.z },
          );
          const dist = approach.distance;

          if (refillClip) {
            refillHold += dt;
            const pose = mixer.update(dt);
            applyPoseToBones(rig.bones, pose);
            if (refillHold >= CLIP_DURATION[refillClip]) {
              if (refillClip === 'retract') {
                refillClip = 'groom';
                refillHold = 0;
                mixer.play('groom', { restart: true, fade: 0.08 });
                setStateLabel('REST');
                setClipLabel('groom');
              } else {
                refillClip = null;
                refillHold = 0;
                fsm.reset(fsm.heading);
              }
            }
          } else {
            const output = fsm.step({
              dt,
              mn9Rate: live.mn9Rate,
              bitter: live.bitter,
              satiety: live.satiety,
              odorYaw: odorGradientYaw(posXZ, foodXZ),
              approachYaw: approach.yaw,
              odorStrength: odorConcentration(posXZ, foodXZ, live.odor),
              distanceToFood: dist,
            });
            mixer.setAmplitude(output.pumpAmplitude);
            mixer.play(output.clip);
            const pose = mixer.update(dt);
            applyPoseToBones(rig.bones, pose);
            rig.root.rotation.y = output.heading;
            if (output.walk > 0) {
              rig.root.position.x += Math.sin(output.heading) * FLY_WALK_MM_S * dt;
              rig.root.position.z += Math.cos(output.heading) * FLY_WALK_MM_S * dt;
            }
            if (output.events.length) onEventsRef.current?.(output.events);
            if (output.state !== lastHud.state || output.clip !== lastHud.clip) {
              lastHud = { state: output.state, clip: output.clip };
              setClipLabel(output.clip);
              setStateLabel(output.state);
              onHudRef.current?.(lastHud);
            }
          }
          const padded = foodSystem.clampRoot(
            { x: rig.root.position.x, y: rig.root.position.y, z: rig.root.position.z },
            { x: foodOrigin.x, y: foodOrigin.y, z: foodOrigin.z },
          );
          const packPos = clampOutsideXzObb(
            padded,
            {
              cx: layout.pouch.x,
              cz: layout.pouch.z,
              hx: mm(POUCH_MM.length) / 2,
              hz: mm(POUCH_MM.width) / 2,
              yaw: layout.pouch.yaw,
            },
            bodyCollisionPadMm(),
          );
          rig.root.position.x = packPos.x;
          rig.root.position.z = packPos.z;

          world.updateMatrixWorld(true);
          foodWorld.copy(rig.root.position);
          twarog.group.worldToLocal(foodWorld);
          foodSystem.followBiteFront({ x: foodWorld.x, y: foodWorld.y, z: foodWorld.z });
          const left = rig.bones.get('labellum_L');
          const right = rig.bones.get('labellum_R');
          if (left) left.getWorldPosition(labWorld);
          else rig.contact.getWorldPosition(labWorld);
          if (right) right.getWorldPosition(labRight);
          else labRight.copy(labWorld);
          const tarsusBoneL = rig.bones.get('foreleg_L_tarsus');
          const tarsusBoneR = rig.bones.get('foreleg_R_tarsus');
          if (tarsusBoneL) tarsusBoneL.getWorldPosition(tarsusL);
          else tarsusL.copy(labWorld);
          if (tarsusBoneR) tarsusBoneR.getWorldPosition(tarsusR);
          else tarsusR.copy(labRight);
          labLocal.copy(labWorld).lerp(labRight, 0.5);
          twarog.group.worldToLocal(labLocal);
          twarog.group.worldToLocal(sensorLocal[0]!.copy(labWorld));
          twarog.group.worldToLocal(sensorLocal[1]!.copy(labRight));
          twarog.group.worldToLocal(sensorLocal[2]!.copy(tarsusL));
          twarog.group.worldToLocal(sensorLocal[3]!.copy(tarsusR));
          const camDist = camera.position.distanceTo(twarog.group.position);
          const foodOut = foodSystem.step({
            dt,
            pumping: !refillClip && fsm.state === 'PUMP',
            labellum: { x: labLocal.x, y: labLocal.y, z: labLocal.z },
            cameraDist: camDist,
            sensors: sensorLocal.map((s) => ({ x: s.x, y: s.y, z: s.z })),
            profile: TWAROG_MAMUTA_WANILIOWY,
            foodXZ,
            flyXZ: posXZ,
          });
          const extra: FeedingEvent[] = [];
          for (const ev of foodOut.events) {
            if (ev.type === 'consume') {
              twarogView.spawnCrumbs(ev);
              extra.push({ type: 'consume', massGrams: ev.massGrams, chunkId: ev.index, t: fsm.time });
            } else if (ev.type === 'groom') {
              refillClip = 'retract';
              refillHold = 0;
              mixer.play('retract', { restart: true, fade: 0.1 });
              setStateLabel('RETRACT');
            } else if (ev.type === 'refill') {
              twarogView.resetCrumbs();
              extra.push({ type: 'portion', count: ev.portion, t: fsm.time });
              setPortions(ev.portion);
              setToast(true);
              onPortionRef.current?.(ev.portion);
            }
          }
          if (extra.length) onEventsRef.current?.(extra);
          onChemoRef.current?.(foodOut.chemo);
          twarogView.update(dt, foodSystem);
        }
        world.updateMatrixWorld(true);
        const want = presetRef.current;
        if (debug === 'label' && packLabel) {
          if (appliedPreset !== want) applyPreset(want);
        } else if (want === 'Zbliżenie' && debug === 'off') updateCloseup(Math.max(dt, 1 / 60));
        else if (want !== appliedPreset) applyPreset(want);
      }
      draw();
      frameId = requestAnimationFrame(tick);
    };

    controls.addEventListener('change', draw);
    void (async () => {
      const get = async (path: string) => {
        const r = await fetch(asset(`data/flybody/${path}`), { signal: controller.signal });
        if (!r.ok) throw Error('Flybody asset unavailable');
        return r;
      };
      kitchenTex = await loadKitchenTextures(controller.signal);
      if (disposed) return;
      const anisotropy = renderer.capabilities.getMaxAnisotropy();
      twarog = createProceduralTwarog(kitchenTex, { seed: 1 });
      twarog.group.position.set(layout.curd.x, layout.curd.y, layout.curd.z);
      world.add(twarog.group);
      foodSystem = TwarogSystem.fromFracture(twarog.fractured, { seed: 1 });
      twarogView = createTwarogView(twarog);
      setPortions(foodSystem.portionCount);
      const pack = createPackaging(kitchenTex, { anisotropy, seed: 11, envMap });
      pack.group.position.set(layout.pouch.x, layout.pouch.y, layout.pouch.z);
      pack.group.rotation.y = layout.pouch.yaw;
      world.add(pack.group);
      packLabel = pack.labelFront;

      const meta = await (await get('model.json')).json() as Model;
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
      built.root.position.set(layout.fly.x, -bounds.min.y, layout.fly.z);
      radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
      if (debug === 'motion') mixer.play(MOTION_LOOP_ORDER[0], { restart: true, fade: 0 });
      else if (debug === 'extend') mixer.play('per', { restart: true, fade: 0 });
      else if (debug === 'pump') mixer.play('pump', { restart: true, fade: 0 });
      else mixer.play('odorTrack', { fade: 0 });
      ready = true;
      applyPreset(presetRef.current);
      if (debug === 'off' && presetRef.current === 'Widok kuchni') {
        const frame = kitchenFrame(radius);
        camera.position.fromArray(frame.position);
        camera.lookAt(...frame.lookAt);
        controls.target.fromArray(frame.lookAt);
      }
      resize();
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
    })().catch((e) => { if (!disposed) setError(String(e)); });

    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    frameId = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      controller.abort();
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      world.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const mat = object.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      Object.values(materials).forEach((m) => m.dispose());
      if (kitchenTex) disposeKitchenTextures(kitchenTex);
      twarogView?.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [debug]);

  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(false), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  return <>
    <div className="fly-view-controls">
      {CAMERA_PRESETS.map((name) => (
        <button key={name} type="button" aria-pressed={preset === name} onClick={() => setPreset(name)}>{name}</button>
      ))}
    </div>
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
    {debug === 'off' && <div className="fly-debug-label fly-state-label">{stateLabel}</div>}
    <TwarogHud lang={lang} toast={toast} portions={portions} />
    <div ref={host} className="three-viewport" aria-label="Flybody feeding view">{error && <p role="alert">{error}</p>}</div>
  </>;
}

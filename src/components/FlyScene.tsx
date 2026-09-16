import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { asset } from '../lib/atlas';
import type { CameraPreset, ClipName, FeedingEvent, FeedingState } from '../body/types.ts';
import { CAMERA_PRESETS } from '../body/cameras.ts';
import { closeupOffset, frameForPreset } from '../body/cameras.ts';
import { parseDebugMode } from '../body/debugQuery.ts';
import { CLIPS, MOTION_LOOP_ORDER, MotionMixer, reviewTime, sampleClip } from '../body/feedingMotion.ts';
import { FeedingStateMachine } from '../body/feedingStateMachine.ts';
import { createTable, createTwarogWedge } from '../body/kitchen.ts';
import { odorConcentration, odorGradientYaw } from '../body/odorField.ts';
import { WEIGHT_LEGEND } from '../body/palette.ts';
import { applyPoseToBones, buildFlybodyRig } from '../body/rig.ts';
import { describeFlybodyHierarchy, ANCHORS, type FlybodyMeta } from '../body/hierarchy.ts';
import { TWAROG_MAMUTA_WANILIOWY } from '../food/foodProfile.ts';

type Model = FlybodyMeta;

type FlySceneProps = {
  playing?: boolean;
  mn9Rate?: number;
  satiety?: number;
  bitter?: number;
  odor?: number;
  onEvents?: (events: readonly FeedingEvent[]) => void;
  onHud?: (hud: { state: FeedingState; clip: ClipName }) => void;
};

export function FlyScene({
  playing = true,
  mn9Rate = 0,
  satiety = 0,
  bitter = 0,
  odor = TWAROG_MAMUTA_WANILIOWY.odor,
  onEvents,
  onHud,
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
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const inputRef = useRef({ playing, mn9Rate, satiety, bitter, odor });
  inputRef.current = { playing, mn9Rate, satiety, bitter, odor };
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;
  const onHudRef = useRef(onHud);
  onHudRef.current = onHud;

  useEffect(() => {
    const element = host.current!;
    const controller = new AbortController();
    let disposed = false;
    const scene = new THREE.Scene();
    const world = new THREE.Group();
    scene.add(world);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 20);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.append(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    scene.add(new THREE.HemisphereLight(0xffedda, 0x18202a, 2.2));
    const key = new THREE.DirectionalLight(0xffdfb2, 3.4);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8d6e5, 0.7);
    fill.position.set(-2, 1.2, -1);
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
    const fsm = new FeedingStateMachine({ heading: 0.55 });
    let rig: ReturnType<typeof buildFlybodyRig> | null = null;
    let radius = 0.3;
    const food = createTwarogWedge();
    const table = createTable();
    world.add(table);
    world.add(food);
    const labWorld = new THREE.Vector3();
    const labRight = new THREE.Vector3();
    const foodWorld = new THREE.Vector3();
    const contactMid = new THREE.Vector3();
    const closeCam = new THREE.Vector3();
    let motionIndex = 0;
    let motionHold = 0;
    let lastHud = { state: 'SEARCH' as FeedingState, clip: 'idle' as ClipName };
    let frameId = 0;
    let previous = performance.now();
    let ready = false;

    let appliedPreset: CameraPreset | null = null;
    const applyPreset = (name: CameraPreset) => {
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
      if (!rig) return;
      const left = rig.bones.get('labellum_L');
      const right = rig.bones.get('labellum_R');
      if (left && right) {
        left.getWorldPosition(labWorld);
        right.getWorldPosition(labRight);
        labWorld.lerp(labRight, 0.5);
      } else {
        rig.contact.getWorldPosition(labWorld);
      }
      food.getWorldPosition(foodWorld);
      contactMid.copy(labWorld).lerp(foodWorld, 0.12);
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
      const named = (name: (typeof ANCHORS.bones)[number]['name']) => {
        const a = ANCHORS.bones.find((b) => b.name === name)!;
        return new THREE.Vector3(a.position[0], a.position[1], a.position[2]).add(rig!.root.position);
      };
      const mouth = named('labellum_L').add(named('labellum_R')).multiplyScalar(0.5);
      const aim = tightMouth ? mouth : named('head').lerp(mouth, 0.45);
      if (tightMouth) {
        camera.position.set(aim.x + 0.07, aim.y + 0.012, aim.z + 0.055);
        camera.lookAt(aim.x, aim.y, aim.z);
        camera.fov = 28;
      } else {
        camera.position.set(aim.x + 0.12, aim.y + 0.045, aim.z + 0.11);
        camera.lookAt(aim.x, aim.y - 0.015, aim.z);
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
        } else {
          const flyPos = rig.root.position;
          const foodXZ = { x: food.position.x, z: food.position.z };
          const posXZ = { x: flyPos.x, z: flyPos.z };
          const dist = Math.hypot(foodXZ.x - posXZ.x, foodXZ.z - posXZ.z);
          const output = fsm.step({
            dt,
            mn9Rate: live.mn9Rate,
            bitter: live.bitter,
            satiety: live.satiety,
            odorYaw: odorGradientYaw(posXZ, foodXZ),
            odorStrength: odorConcentration(posXZ, foodXZ, live.odor),
            distanceToFood: dist,
          });
          mixer.setAmplitude(output.pumpAmplitude);
          mixer.play(output.clip);
          const pose = mixer.update(dt);
          applyPoseToBones(rig.bones, pose);
          rig.root.rotation.y = output.heading;
          if (output.walk > 0) {
            const speed = 0.05;
            rig.root.position.x += Math.sin(output.heading) * speed * dt;
            rig.root.position.z += Math.cos(output.heading) * speed * dt;
          }
          if (output.events.length) onEventsRef.current?.(output.events);
          if (output.state !== lastHud.state || output.clip !== lastHud.clip) {
            lastHud = { state: output.state, clip: output.clip };
            setClipLabel(output.clip);
            setStateLabel(output.state);
            onHudRef.current?.(lastHud);
          }
        }
        world.updateMatrixWorld(true);
        const want = presetRef.current;
        if (want === 'Zbliżenie' && debug === 'off') updateCloseup(Math.max(dt, 1 / 60));
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
      const meta = await (await get('model.json')).json() as Model;
      const buffer = await (await get(meta.binary)).arrayBuffer();
      if (disposed) return;
      describeFlybodyHierarchy(meta);
      const built = buildFlybodyRig(meta, buffer, materials, { debugWeights: debug === 'weights' });
      rig = built;
      world.add(built.root);
      const bounds = new THREE.Box3().setFromObject(built.root);
      const center = bounds.getCenter(new THREE.Vector3());
      built.root.position.sub(center);
      table.position.sub(center);
      const feet = bounds.min.y - center.y;
      table.position.set(0, feet, 0);
      food.position.set(0, feet + 0.018, bounds.max.z - center.z + 0.04);
      radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
      if (debug === 'motion') mixer.play(MOTION_LOOP_ORDER[0], { restart: true, fade: 0 });
      else if (debug === 'extend') mixer.play('per', { restart: true, fade: 0 });
      else if (debug === 'pump') mixer.play('pump', { restart: true, fade: 0 });
      else mixer.play('odorTrack', { fade: 0 });
      ready = true;
      applyPreset(presetRef.current);
      resize();
      if (debug === 'extend' || debug === 'pump') {
        const name = debug === 'extend' ? 'per' : 'pump';
        applyPoseToBones(built.bones, sampleClip(CLIPS[name], reviewTime(name), { amplitude: 1, reduceMotion: true }));
      }
      if (debug === 'weights' || debug === 'extend' || debug === 'pump') {
        world.updateMatrixWorld(true);
        frameMouthparts(debug === 'weights');
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
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [debug]);

  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);

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
    <div ref={host} className="three-viewport" aria-label="Flybody feeding view">{error && <p role="alert">{error}</p>}</div>
  </>;
}

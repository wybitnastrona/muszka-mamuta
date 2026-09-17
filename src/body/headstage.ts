/**
 * Headstage cap + tether cable. An authored PROP, a deliberate joke about
 * tethered / head-fixed electrophysiology rigs ("she is wired into the
 * system"). It is not Drosophila anatomy, it is not in MaleCNS, and nothing
 * here reads or writes ActivityFrame or the brain worker. See docs/BODY-MODEL.md.
 *
 * Cap: small box + post + LED parented to the `head` bone, so it rides every
 * head motion (gaze stabilisation, grooming clips). Dimensions are authored in
 * millimetres and divided by `flyRootScale()` into bone-local units.
 *
 * Cable: a position-based rope in WORLD space. Point 0 is pinned to the cap
 * socket, the last point to an off-screen anchor high above the scene that
 * follows the fly in XZ with a lag, so the tether sways behind her and works
 * in flight too. The tube mesh has a fixed vertex budget and is updated in
 * place — no geometry rebuilds in the 60 fps loop.
 */
import * as THREE from 'three';
import { flyRootScale } from '../scene/scale.ts';

export type Vec3 = { x: number; y: number; z: number };

export const HEADSTAGE_MM = {
  capWidth: 2.4,
  capHeight: 1.0,
  capDepth: 1.9,
  postRadius: 0.32,
  postHeight: 1.1,
  ledRadius: 0.28,
  /** Cap centre above the `head` bone origin (native head radius ≈ 0.038 × flyRootScale). */
  capLift: 1.6,
  cableRadius: 0.42,
} as const;

/** Where the cable disappears (mm above the table). Above every camera frame. */
export const CABLE_CEILING_MM = 340;
/** Rope resolution and slack. */
export const CABLE_POINTS = 14;
export const CABLE_SLACK = 1.05;
/** The ceiling anchor follows the fly in XZ with this time constant (s). */
export const CABLE_ANCHOR_TAU_S = 0.7;
export const CABLE_GRAVITY_MM_S2 = 900;
export const CABLE_DAMPING = 0.92;
export const CABLE_ITERATIONS = 10;
const CABLE_RING = 6;

export type CableChain = {
  points: Vec3[];
  previous: Vec3[];
  anchor: Vec3;
};

export function createCableChain(head: Vec3, ceilingY = CABLE_CEILING_MM): CableChain {
  const anchor = { x: head.x, y: ceilingY, z: head.z };
  const points: Vec3[] = [];
  const previous: Vec3[] = [];
  for (let i = 0; i < CABLE_POINTS; i++) {
    const u = i / (CABLE_POINTS - 1);
    const p = {
      x: head.x + (anchor.x - head.x) * u,
      y: head.y + (anchor.y - head.y) * u,
      z: head.z + (anchor.z - head.z) * u,
    };
    points.push(p);
    previous.push({ ...p });
  }
  return { points, previous, anchor };
}

/** Segment length that leaves `CABLE_SLACK` of extra rope between the pins. */
export function cableSegmentLength(head: Vec3, anchor: Vec3): number {
  const span = Math.hypot(anchor.x - head.x, anchor.y - head.y, anchor.z - head.z);
  return (span * CABLE_SLACK) / (CABLE_POINTS - 1);
}

/**
 * One rope step: Verlet integrate the free points under gravity + damping,
 * then satisfy distance constraints with both ends pinned. Deterministic.
 */
export function stepCable(chain: CableChain, head: Vec3, dt: number): void {
  const step = Math.min(0.05, Math.max(0, dt));
  const { points, previous, anchor } = chain;
  const n = points.length;
  // Off-screen anchor drifts toward the fly in XZ (lag = sway).
  const k = 1 - Math.exp(-step / CABLE_ANCHOR_TAU_S);
  anchor.x += (head.x - anchor.x) * k;
  anchor.z += (head.z - anchor.z) * k;

  for (let i = 1; i < n - 1; i++) {
    const p = points[i]!;
    const q = previous[i]!;
    const vx = (p.x - q.x) * CABLE_DAMPING;
    const vy = (p.y - q.y) * CABLE_DAMPING - CABLE_GRAVITY_MM_S2 * step * step;
    const vz = (p.z - q.z) * CABLE_DAMPING;
    q.x = p.x; q.y = p.y; q.z = p.z;
    p.x += vx; p.y += vy; p.z += vz;
  }
  points[0]!.x = head.x; points[0]!.y = head.y; points[0]!.z = head.z;
  points[n - 1]!.x = anchor.x; points[n - 1]!.y = anchor.y; points[n - 1]!.z = anchor.z;

  const seg = cableSegmentLength(head, anchor);
  for (let it = 0; it < CABLE_ITERATIONS; it++) {
    // Keep the free rope above the socket (it hangs from the ceiling) before
    // each relaxation pass so the clamp cannot leave a stretched segment.
    for (let i = 1; i < n - 1; i++) {
      if (points[i]!.y < head.y) points[i]!.y = head.y;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const diff = (d - seg) / d;
      // Ropes only pull: never push points apart.
      if (diff <= 0) continue;
      const pinA = i === 0;
      const pinB = i + 1 === n - 1;
      const wa = pinA ? 0 : pinB ? 1 : 0.5;
      const wb = pinB ? 0 : pinA ? 1 : 0.5;
      a.x += dx * diff * wa; a.y += dy * diff * wa; a.z += dz * diff * wa;
      b.x -= dx * diff * wb; b.y -= dy * diff * wb; b.z -= dz * diff * wb;
    }
  }
  // Pins are exact after relaxation (weights already keep them in place).
  points[0]!.x = head.x; points[0]!.y = head.y; points[0]!.z = head.z;
  points[n - 1]!.x = anchor.x; points[n - 1]!.y = anchor.y; points[n - 1]!.z = anchor.z;
}

/** Largest consecutive-point distance in the chain (for tests / debugging). */
export function maxSegment(chain: CableChain): number {
  let m = 0;
  for (let i = 0; i < chain.points.length - 1; i++) {
    const a = chain.points[i]!;
    const b = chain.points[i + 1]!;
    m = Math.max(m, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  return m;
}

export type Headstage = {
  /** Parent this to the `head` bone. */
  cap: THREE.Group;
  /** World-space tube; add to the scene root. */
  cable: THREE.Mesh;
  /** Call once per frame after the rig's world matrices are current. */
  update(dt: number): void;
  dispose(): void;
};

export function createHeadstage(): Headstage {
  const s = 1 / flyRootScale();
  const M = HEADSTAGE_MM;
  const cap = new THREE.Group();
  cap.name = 'headstage';
  const shell = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.45, metalness: 0.35 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a44a, roughness: 0.35, metalness: 0.8 });
  const led = new THREE.MeshStandardMaterial({ color: 0x3a0000, emissive: 0xff2a2a, emissiveIntensity: 1.6, roughness: 0.4 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(M.capWidth * s, M.capHeight * s, M.capDepth * s), shell);
  box.position.y = M.capLift * s;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(M.postRadius * s, M.postRadius * s, M.postHeight * s, 10), gold);
  post.position.y = (M.capLift + M.capHeight / 2 + M.postHeight / 2) * s;
  const light = new THREE.Mesh(new THREE.SphereGeometry(M.ledRadius * s, 8, 6), led);
  light.position.set(M.capWidth * 0.32 * s, (M.capLift + M.capHeight / 2 + M.ledRadius * 0.6) * s, M.capDepth * 0.25 * s);
  const socket = new THREE.Object3D();
  socket.name = 'headstageSocket';
  socket.position.y = (M.capLift + M.capHeight / 2 + M.postHeight) * s;
  cap.add(box, post, light, socket);
  for (const m of [box, post, light]) {
    m.castShadow = true;
  }

  // Tube with a fixed topology: CABLE_POINTS rings × CABLE_RING vertices.
  const ringN = CABLE_RING;
  const vertCount = CABLE_POINTS * ringN;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices: number[] = [];
  for (let i = 0; i < CABLE_POINTS - 1; i++) {
    for (let j = 0; j < ringN; j++) {
      const a = i * ringN + j;
      const b = i * ringN + ((j + 1) % ringN);
      const c = (i + 1) * ringN + j;
      const d = (i + 1) * ringN + ((j + 1) % ringN);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setIndex(indices);
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.1 });
  const cable = new THREE.Mesh(geom, cableMat);
  cable.name = 'headstageCable';
  cable.frustumCulled = false;
  cable.castShadow = true;

  const headWorld = new THREE.Vector3();
  let chain: CableChain | null = null;
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const helper = new THREE.Vector3(0, 1, 0);
  const alt = new THREE.Vector3(1, 0, 0);

  const writeTube = (c: CableChain) => {
    const pts = c.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const prev = pts[Math.max(0, i - 1)]!;
      const next = pts[Math.min(pts.length - 1, i + 1)]!;
      tangent.set(next.x - prev.x, next.y - prev.y, next.z - prev.z);
      if (tangent.lengthSq() < 1e-9) tangent.set(0, 1, 0);
      tangent.normalize();
      const ref = Math.abs(tangent.y) > 0.9 ? alt : helper;
      side.crossVectors(tangent, ref).normalize();
      up.crossVectors(side, tangent).normalize();
      for (let j = 0; j < ringN; j++) {
        const ang = (j / ringN) * Math.PI * 2;
        const cx = Math.cos(ang);
        const sy = Math.sin(ang);
        const nx = side.x * cx + up.x * sy;
        const ny = side.y * cx + up.y * sy;
        const nz = side.z * cx + up.z * sy;
        const o = (i * ringN + j) * 3;
        positions[o] = p.x + nx * M.cableRadius;
        positions[o + 1] = p.y + ny * M.cableRadius;
        positions[o + 2] = p.z + nz * M.cableRadius;
        normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz;
      }
    }
    (geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  };

  const update = (dt: number) => {
    socket.getWorldPosition(headWorld);
    const head = { x: headWorld.x, y: headWorld.y, z: headWorld.z };
    if (!chain) chain = createCableChain(head);
    stepCable(chain, head, dt);
    writeTube(chain);
    cable.visible = true;
  };

  const dispose = () => {
    geom.dispose();
    cableMat.dispose();
    for (const m of [box, post, light]) {
      m.geometry.dispose();
    }
    shell.dispose();
    gold.dispose();
    led.dispose();
  };

  cable.visible = false;
  return { cap, cable, update, dispose };
}

export type V3 = { x: number; y: number; z: number };
export type FaceTag = 'hull' | 'cut';
export type Face = { indices: number[]; tag: FaceTag };
export type Polyhedron = { vertices: V3[]; faces: Face[] };

const EPS = 1e-7;

export function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

export function add(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: V3, s: number): V3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function len(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function norm(a: V3): V3 {
  const n = len(a);
  return n < EPS ? { x: 0, y: 1, z: 0 } : scale(a, 1 / n);
}

export function lerp(a: V3, b: V3, t: number): V3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function cloneV(a: V3): V3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function axisBox(hx: number, hy: number, hz: number): Polyhedron {
  const v = [
    v3(-hx, -hy, -hz), v3(hx, -hy, -hz), v3(hx, hy, -hz), v3(-hx, hy, -hz),
    v3(-hx, -hy, hz), v3(hx, -hy, hz), v3(hx, hy, hz), v3(-hx, hy, hz),
  ];
  const faces: Face[] = [
    { indices: [0, 3, 2, 1], tag: 'hull' },
    { indices: [4, 5, 6, 7], tag: 'hull' },
    { indices: [0, 1, 5, 4], tag: 'hull' },
    { indices: [2, 3, 7, 6], tag: 'hull' },
    { indices: [0, 4, 7, 3], tag: 'hull' },
    { indices: [1, 2, 6, 5], tag: 'hull' },
  ];
  return { vertices: v, faces };
}

/**
 * Chamfer every edge by `bevel` along each adjacent axis.
 * Plane for the +Y+Z edge: y + z <= hy + hz - bevel.
 */
export function beveledBox(hx: number, hy: number, hz: number, bevel: number): Polyhedron {
  const b = Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45);
  let poly = axisBox(hx, hy, hz);
  const edges: V3[] = [
    { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: -1 }, { x: 0, y: -1, z: 1 }, { x: 0, y: -1, z: -1 },
    { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: -1 }, { x: -1, y: 0, z: 1 }, { x: -1, y: 0, z: -1 },
    { x: 1, y: 1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: -1, y: 1, z: 0 }, { x: -1, y: -1, z: 0 },
  ];
  const corner = { x: hx, y: hy, z: hz };
  for (const e of edges) {
    const limit = Math.abs(e.x) * corner.x + Math.abs(e.y) * corner.y + Math.abs(e.z) * corner.z - b;
    const clipped = clipPolyhedron(poly, e, limit);
    if (clipped) poly = clipped;
  }
  return poly;
}

/** Keep vertices with n·x <= d. */
export function clipPolyhedron(poly: Polyhedron, n: V3, d: number, eps = EPS): Polyhedron | null {
  const verts = poly.vertices;
  const dist = verts.map((p) => dot(p, n) - d);
  const inside = dist.map((s) => s <= eps);
  if (inside.every(Boolean)) return poly;
  if (!inside.some(Boolean)) return null;

  const newVerts: V3[] = [];
  const remap = new Map<number, number>();
  const intern = (i: number): number => {
    let j = remap.get(i);
    if (j === undefined) {
      j = newVerts.length;
      remap.set(i, j);
      newVerts.push(cloneV(verts[i]!));
    }
    return j;
  };
  const cuts = new Map<string, number>();
  const cutEdge = (i: number, j: number): number => {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    let idx = cuts.get(key);
    if (idx === undefined) {
      const di = dist[i]!;
      const dj = dist[j]!;
      const t = di === dj ? 0.5 : di / (di - dj);
      idx = newVerts.length;
      newVerts.push(lerp(verts[i]!, verts[j]!, t));
      cuts.set(key, idx);
    }
    return idx;
  };

  const newFaces: Face[] = [];
  const capIds: number[] = [];

  for (const face of poly.faces) {
    const ids = face.indices;
    const out: number[] = [];
    const nFace = ids.length;
    for (let k = 0; k < nFace; k++) {
      const i = ids[k]!;
      const j = ids[(k + 1) % nFace]!;
      const iIn = inside[i]!;
      const jIn = inside[j]!;
      if (iIn && jIn) {
        out.push(intern(i));
      } else if (iIn && !jIn) {
        const c = cutEdge(i, j);
        out.push(intern(i), c);
        capIds.push(c);
      } else if (!iIn && jIn) {
        const c = cutEdge(i, j);
        out.push(c);
        capIds.push(c);
      }
    }
    if (out.length >= 3) newFaces.push({ indices: dedupeCycle(out), tag: face.tag });
  }

  const cap = orderCapPoints(newVerts, capIds, n);
  if (cap.length >= 3) newFaces.push({ indices: cap, tag: 'cut' });

  if (newVerts.length < 4 || newFaces.length < 4) return null;
  return { vertices: newVerts, faces: newFaces };
}

function dedupeCycle(ids: number[]): number[] {
  const out: number[] = [];
  for (const id of ids) {
    if (out.length === 0 || out[out.length - 1] !== id) out.push(id);
  }
  if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

function orderCapPoints(verts: V3[], raw: number[], n: V3): number[] {
  const ids = [...new Set(raw)];
  if (ids.length < 3) return ids;
  let cx = 0, cy = 0, cz = 0;
  for (const id of ids) {
    const p = verts[id]!;
    cx += p.x; cy += p.y; cz += p.z;
  }
  const inv = 1 / ids.length;
  const center = { x: cx * inv, y: cy * inv, z: cz * inv };
  const tmp = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const u = norm(cross(n, tmp));
  const v = cross(n, u);
  ids.sort((ia, ib) => {
    const a = sub(verts[ia]!, center);
    const b = sub(verts[ib]!, center);
    return Math.atan2(dot(a, v), dot(a, u)) - Math.atan2(dot(b, v), dot(b, u));
  });
  return windingAlong(verts, ids, n);
}

function windingAlong(verts: V3[], ids: number[], n: V3): number[] {
  if (ids.length < 3) return ids;
  const a = verts[ids[0]!]!;
  const b = verts[ids[1]!]!;
  const c = verts[ids[2]!]!;
  const nn = cross(sub(b, a), sub(c, a));
  if (dot(nn, n) < 0) return ids.slice().reverse();
  return ids;
}

export function polyVolume(poly: Polyhedron): number {
  let acc = 0;
  const o = v3(0, 0, 0);
  for (const face of poly.faces) {
    const ids = face.indices;
    for (let i = 1; i < ids.length - 1; i++) {
      const a = poly.vertices[ids[0]!]!;
      const b = poly.vertices[ids[i]!]!;
      const c = poly.vertices[ids[i + 1]!]!;
      acc += dot(a, cross(b, c));
    }
  }
  void o;
  return acc / 6;
}

export function polyCentroid(poly: Polyhedron): V3 {
  let cx = 0, cy = 0, cz = 0, vol = 0;
  for (const face of poly.faces) {
    const ids = face.indices;
    const v0 = poly.vertices[ids[0]!]!;
    for (let i = 1; i < ids.length - 1; i++) {
      const v1 = poly.vertices[ids[i]!]!;
      const v2 = poly.vertices[ids[i + 1]!]!;
      const tet = dot(v0, cross(v1, v2)) / 6;
      cx += tet * (v0.x + v1.x + v2.x) / 4;
      cy += tet * (v0.y + v1.y + v2.y) / 4;
      cz += tet * (v0.z + v1.z + v2.z) / 4;
      vol += tet;
    }
  }
  if (Math.abs(vol) < EPS) {
    let x = 0, y = 0, z = 0;
    for (const p of poly.vertices) {
      x += p.x; y += p.y; z += p.z;
    }
    const n = Math.max(1, poly.vertices.length);
    return { x: x / n, y: y / n, z: z / n };
  }
  return { x: cx / vol, y: cy / vol, z: cz / vol };
}

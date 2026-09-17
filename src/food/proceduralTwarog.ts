import * as THREE from 'three';
import { Xoshiro128ss } from '../brain/rng.ts';
import {
  CURD_ALBEDO_HEX,
  CURD_BEVEL_MM,
  CURD_BITE_MM,
  CURD_CHUNK_COUNT,
  CURD_DENSITY_G_CM3,
  CURD_INTERIOR_LIGHTEN,
  CURD_INTERIOR_ROUGHNESS,
  CURD_MM,
  CURD_NORMAL_SCALE,
  CURD_RIM_HEX,
  CURD_TILE,
  CURD_TOP_RISE_MM,
  CURD_TOTAL_MASS_G,
  mm,
} from '../scene/scale.ts';
import { SimplexNoise } from '../scene/simplex.ts';
import {
  add,
  beveledBox,
  clipPolyhedron,
  dot,
  len,
  polyCentroid,
  polyVolume,
  scale as vscale,
  sub,
  type Polyhedron,
  type V3,
} from '../scene/polyhedron.ts';
import { meshFromPolyhedron } from '../scene/meshFromPoly.ts';
import type { KitchenTextures } from '../scene/textures.ts';

export type FracturedCell = {
  poly: Polyhedron;
  centroid: V3;
  volumeMm3: number;
  biteDistance: number;
};

export type FracturedCurd = {
  cells: FracturedCell[];
  biteFront: V3;
  /** Centre of the opening-bite crater on the top face (local space). */
  biteAnchor: V3;
  /** Indices into `cells` that start every portion already eaten (the crater). */
  openingBite: number[];
  totalVolumeMm3: number;
  hx: number;
  hy: number;
  hz: number;
};

/** Local-space anchor of the opening bite on the top face. */
export function openingBiteAnchor(hx: number, hy: number, hz: number): V3 {
  return { x: hx * CURD_BITE_MM.anchorFracX, y: hy, z: hz * CURD_BITE_MM.anchorFracZ };
}

/** True when a local-space point lies inside the opening-bite ellipsoid. */
export function insideOpeningBite(p: V3, anchor: V3): boolean {
  const rx = CURD_BITE_MM.radiusXz;
  const ry = CURD_BITE_MM.depth;
  const u = (p.x - anchor.x) / rx;
  const v = (p.y - anchor.y) / ry;
  const w = (p.z - anchor.z) / rx;
  return u * u + v * v + w * w <= 1;
}

export type TwarogChunk = {
  mesh: THREE.Mesh;
  centroid: THREE.Vector3;
  massGrams: number;
  volumeMm3: number;
  biteDistance: number;
};

export type ProceduralTwarog = {
  group: THREE.Group;
  chunks: TwarogChunk[];
  biteFront: THREE.Vector3;
  totalMassGrams: number;
  fractured: FracturedCurd;
  exterior: THREE.MeshStandardMaterial;
  interior: THREE.MeshStandardMaterial;
  wetInterior: THREE.MeshStandardMaterial;
  lodBlock: THREE.Mesh;
  /** Crater-wall material of the LOD block (second material group). */
  lodInterior: THREE.MeshStandardMaterial;
  biteUniforms: {
    uBiteFront: { value: THREE.Vector3 };
    uBiteRadius: { value: number };
    uBiteWet: { value: number };
  };
};

function halfExtents(): { hx: number; hy: number; hz: number } {
  return {
    hx: mm(CURD_MM.width) / 2,
    hy: mm(CURD_MM.height) / 2,
    hz: mm(CURD_MM.length) / 2,
  };
}

function jitteredSites(count: number, hx: number, hy: number, hz: number, seed: number): V3[] {
  const rng = new Xoshiro128ss(seed);
  const nx = 8, ny = 5, nz = 5;
  if (nx * ny * nz !== count) throw new Error(`CURD_CHUNK_COUNT must be ${nx * ny * nz}`);
  const margin = mm(CURD_BEVEL_MM) + 1.2;
  const ix = hx - margin, iy = hy - margin, iz = hz - margin;
  const pts: V3[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        const jx = (rng.nextFloat() - 0.5) * 0.72;
        const jy = (rng.nextFloat() - 0.5) * 0.72;
        const jz = (rng.nextFloat() - 0.5) * 0.72;
        pts.push({
          x: ((i + 0.5 + jx) / nx) * 2 * ix - ix,
          y: ((j + 0.5 + jy) / ny) * 2 * iy - iy,
          z: ((k + 0.5 + jz) / nz) * 2 * iz - iz,
        });
      }
    }
  }
  return pts;
}

function voronoiCell(site: V3, sites: readonly V3[], hull: Polyhedron): Polyhedron | null {
  let cell = hull;
  for (const other of sites) {
    if (other === site) continue;
    const n = sub(other, site);
    if (len(n) < 1e-8) continue;
    const mid = vscale(add(site, other), 0.5);
    const clipped = clipPolyhedron(cell, n, dot(n, mid));
    if (!clipped) return null;
    cell = clipped;
  }
  return cell;
}

export function fractureCurdBlock(opts: { seed?: number; count?: number } = {}): FracturedCurd {
  const count = opts.count ?? CURD_CHUNK_COUNT;
  const { hx, hy, hz } = halfExtents();
  const hull = beveledBox(hx, hy, hz, mm(CURD_BEVEL_MM));
  const sites = jitteredSites(count, hx, hy, hz, opts.seed ?? 1);
  const biteAnchor = openingBiteAnchor(hx, hy, hz);
  // Eating starts at the crater column, mid-height on the bitten faces.
  const biteFront: V3 = { x: biteAnchor.x, y: -hy * 0.45, z: biteAnchor.z };
  const cells: FracturedCell[] = [];
  for (const site of sites) {
    const poly = voronoiCell(site, sites, hull);
    if (!poly) continue;
    const volumeMm3 = Math.abs(polyVolume(poly));
    if (volumeMm3 < 1) continue;
    const centroid = polyCentroid(poly);
    const dx = centroid.x - biteFront.x;
    const dy = centroid.y - biteFront.y;
    const dz = centroid.z - biteFront.z;
    cells.push({
      poly,
      centroid,
      volumeMm3,
      biteDistance: Math.hypot(dx, dy, dz),
    });
  }
  cells.sort((a, b) => a.biteDistance - b.biteDistance);
  const totalVolumeMm3 = cells.reduce((s, c) => s + c.volumeMm3, 0);
  const openingBite: number[] = [];
  cells.forEach((c, i) => {
    if (insideOpeningBite(c.centroid, biteAnchor)) openingBite.push(i);
  });
  return { cells, biteFront, biteAnchor, openingBite, totalVolumeMm3, hx, hy, hz };
}

/**
 * One draw-call LOD of the block with the opening bite already taken: the
 * exterior faces of every uneaten cell plus their cut faces (exposed ones
 * form the crater walls; buried ones sit inside the closed hull). Later bites
 * are not reflected here — the LOD is only shown from far away.
 */
export function buildLodGeometry(
  cellGeometries: readonly THREE.BufferGeometry[],
  eaten: ReadonlySet<number>,
): THREE.BufferGeometry {
  const hullPos: number[] = [];
  const hullUv: number[] = [];
  const cutPos: number[] = [];
  const cutUv: number[] = [];
  cellGeometries.forEach((g, i) => {
    if (eaten.has(i)) return;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (const grp of g.groups) {
      const isCut = grp.materialIndex === 1;
      const P = isCut ? cutPos : hullPos;
      const U = isCut ? cutUv : hullUv;
      for (let v = grp.start; v < grp.start + grp.count; v++) {
        P.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        U.push(uv.getX(v), uv.getY(v));
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(hullPos.concat(cutPos), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(hullUv.concat(cutUv), 2));
  geometry.computeVertexNormals();
  const nHull = hullPos.length / 3;
  const nCut = cutPos.length / 3;
  if (nHull > 0) geometry.addGroup(0, nHull, 0);
  if (nCut > 0) geometry.addGroup(nHull, nCut, 1);
  return geometry;
}

function attachCurdSurfaceShader(
  material: THREE.MeshStandardMaterial,
  uniforms: ProceduralTwarog['biteUniforms'],
): void {
  const rim = new THREE.Color(CURD_RIM_HEX);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBiteFront = uniforms.uBiteFront;
    shader.uniforms.uBiteRadius = uniforms.uBiteRadius;
    shader.uniforms.uBiteWet = uniforms.uBiteWet;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vBiteWorld;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vBiteWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vBiteWorld;
       uniform vec3 uBiteFront;
       uniform float uBiteRadius;
       uniform float uBiteWet;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
      `float bite = 1.0 - saturate(length(vBiteWorld - uBiteFront) / max(uBiteRadius, 0.001));
       bite *= saturate(uBiteWet);
       outgoingLight *= 1.0 - 0.38 * bite;
       outgoingLight += vec3(0.12, 0.14, 0.16) * bite * 0.25;
       float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.4);
       outgoingLight += vec3(${rim.r.toFixed(4)}, ${rim.g.toFixed(4)}, ${rim.b.toFixed(4)}) * fres * 0.4;
       gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,
    );
  };
  material.customProgramCacheKey = () => 'twarog-bite-front-v1';
}

function displaceChunk(
  geometry: THREE.BufferGeometry,
  hx: number, hy: number, hz: number,
  noise: SimplexNoise,
): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const rise = mm(CURD_TOP_RISE_MM);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const nx = x / hx;
    const ny = y / hy;
    const nz = z / hz;
    const top = Math.max(0, (ny + 1) * 0.5);
    y += rise * (1 - nx * nx) * (1 - nz * nz) * top * top;
    const corner = Math.max(0, Math.abs(nx) + Math.abs(ny) + Math.abs(nz) - 1.32);
    const nse = noise.noise3(x * 0.11, y * 0.11, z * 0.11);
    const il = Math.hypot(x, y, z) || 1;
    const amp = corner * 2.4 * (0.5 + 0.5 * nse);
    x -= (x / il) * amp;
    y -= (y / il) * amp;
    z -= (z / il) * amp;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function createProceduralTwarog(
  textures: KitchenTextures,
  opts: { seed?: number } = {},
): ProceduralTwarog {
  const fractured = fractureCurdBlock({ seed: opts.seed ?? 1 });
  const { hx, hy, hz } = fractured;
  const noise = new SimplexNoise((opts.seed ?? 1) ^ 0x9e3779b9);

  for (const map of [textures.crumb, textures.crumbNormal, textures.crumbRough]) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(CURD_TILE, CURD_TILE);
    map.needsUpdate = true;
  }
  textures.crumb.colorSpace = THREE.SRGBColorSpace;

  const biteUniforms = {
    uBiteFront: { value: new THREE.Vector3(fractured.biteFront.x, fractured.biteFront.y, fractured.biteFront.z) },
    uBiteRadius: { value: 18 },
    uBiteWet: { value: 0 },
  };
  const exterior = new THREE.MeshStandardMaterial({
    map: textures.crumb,
    normalMap: textures.crumbNormal,
    roughnessMap: textures.crumbRough,
    color: CURD_ALBEDO_HEX,
    metalness: 0,
    roughness: 1,
    normalScale: new THREE.Vector2(CURD_NORMAL_SCALE, CURD_NORMAL_SCALE),
    transparent: true,
    opacity: 1,
  });
  attachCurdSurfaceShader(exterior, biteUniforms);
  const interiorColor = new THREE.Color(CURD_ALBEDO_HEX).lerp(new THREE.Color(0xffffff), CURD_INTERIOR_LIGHTEN);
  const interior = new THREE.MeshStandardMaterial({
    color: interiorColor,
    metalness: 0,
    roughness: CURD_INTERIOR_ROUGHNESS,
    transparent: true,
    opacity: 1,
  });
  const wetInterior = interior.clone();
  wetInterior.color.lerp(new THREE.Color(0xd8cfc4), 0.35);
  wetInterior.roughness = Math.min(interior.roughness, 0.45);
  attachCurdSurfaceShader(wetInterior, biteUniforms);
  const lodMat = exterior.clone();
  attachCurdSurfaceShader(lodMat, biteUniforms);
  const lodInterior = wetInterior.clone();
  attachCurdSurfaceShader(lodInterior, biteUniforms);

  const group = new THREE.Group();
  group.name = 'twarog';

  const volScale = fractured.totalVolumeMm3 > 0
    ? CURD_TOTAL_MASS_G / (fractured.totalVolumeMm3 / 1000 * CURD_DENSITY_G_CM3)
    : 1;
  const chunks: TwarogChunk[] = [];
  const cellGeometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < fractured.cells.length; i++) {
    const cell = fractured.cells[i]!;
    const { geometry } = meshFromPolyhedron(cell.poly, hx, hy, hz, CURD_TILE);
    displaceChunk(geometry, hx, hy, hz, noise);
    cellGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, [exterior, interior]);
    mesh.name = `twarogChunk-${i}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    group.add(mesh);
    const massGrams = (cell.volumeMm3 / 1000) * CURD_DENSITY_G_CM3 * volScale;
    chunks.push({
      mesh,
      centroid: new THREE.Vector3(cell.centroid.x, cell.centroid.y, cell.centroid.z),
      massGrams,
      volumeMm3: cell.volumeMm3,
      biteDistance: cell.biteDistance,
    });
  }

  // Far LOD: the block minus the opening bite, as one geometry. The wet
  // interior material paints the exposed crater walls.
  const lodGeom = buildLodGeometry(cellGeometries, new Set(fractured.openingBite));
  const lodBlock = new THREE.Mesh(lodGeom, [lodMat, lodInterior]);
  lodBlock.name = 'twarogLod';
  lodBlock.castShadow = true;
  lodBlock.receiveShadow = true;
  group.add(lodBlock);

  return {
    group,
    chunks,
    biteFront: new THREE.Vector3(fractured.biteFront.x, fractured.biteFront.y, fractured.biteFront.z),
    totalMassGrams: chunks.reduce((s, c) => s + c.massGrams, 0),
    fractured,
    exterior,
    interior,
    wetInterior,
    lodBlock,
    lodInterior,
    biteUniforms,
  };
}

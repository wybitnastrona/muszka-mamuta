import type { RoleTag } from './params.ts';
import { ROLE_TAGS } from './params.ts';

export type CircuitGraph = {
  n: number;
  nEdges: number;
  indptr: Int32Array;
  indices: Int32Array;
  weights: Float32Array;
  bodyId: Int32Array;
  role: RoleTag[];
  pathSign: Array<1 | -1 | null>;
  type?: Array<string | null>;
  subclass?: Array<string | null>;
  ntUncertain?: boolean[];
};

const ROLE_SET = new Set<string>(ROLE_TAGS);

function asRole(value: unknown, index: number): RoleTag {
  if (typeof value === 'string' && ROLE_SET.has(value)) return value as RoleTag;
  throw new Error(`Unknown role tag at neuron ${index}: ${String(value)}`);
}

function asPathSign(value: unknown): 1 | -1 | null {
  if (value === null || value === undefined) return null;
  if (value === 1 || value === -1) return value;
  if (value === 0) return null;
  throw new Error(`path_sign_deprecated must be 1, -1, or null (got ${String(value)})`);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** CSR layout: int32 indptr (n+1), int32 indices (nEdges), float32 weights (nEdges). */
export function parseGraphBin(buffer: ArrayBuffer, n: number, nEdges: number): {
  indptr: Int32Array;
  indices: Int32Array;
  weights: Float32Array;
} {
  const expected = (n + 1) * 4 + nEdges * 4 + nEdges * 4;
  if (buffer.byteLength !== expected) {
    throw new Error(`graph.bin length ${buffer.byteLength} != ${expected} (n=${n}, edges=${nEdges})`);
  }
  const indptrBytes = (n + 1) * 4;
  const indexBytes = nEdges * 4;
  const indptr = new Int32Array(buffer.slice(0, indptrBytes));
  const indices = new Int32Array(buffer.slice(indptrBytes, indptrBytes + indexBytes));
  const weights = new Float32Array(
    buffer.slice(indptrBytes + indexBytes, indptrBytes + indexBytes + nEdges * 4),
  );
  if (indptr[0] !== 0 || indptr[n] !== nEdges) {
    throw new Error(`CSR indptr ends at ${indptr[n]}, expected ${nEdges}`);
  }
  return { indptr, indices, weights };
}

export function parseCircuitMeta(meta: unknown): {
  n: number;
  nEdges: number;
  bodyId: Int32Array;
  role: RoleTag[];
  pathSign: Array<1 | -1 | null>;
  type: Array<string | null>;
  subclass: Array<string | null>;
  ntUncertain: boolean[];
} {
  if (!record(meta)) throw new Error('graph.meta.json must be an object');
  const n = Number(meta.n_neurons);
  const nEdges = Number(meta.n_edges);
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(nEdges) || nEdges < 0) {
    throw new Error('graph.meta.json is missing n_neurons / n_edges');
  }
  if (!Array.isArray(meta.bodyId) || meta.bodyId.length !== n) {
    throw new Error('graph.meta.json bodyId length does not match n_neurons');
  }
  if (!Array.isArray(meta.role) || meta.role.length !== n) {
    throw new Error('graph.meta.json role length does not match n_neurons');
  }
  const pathRaw = Array.isArray(meta.path_sign_deprecated)
    ? meta.path_sign_deprecated
    : Array.isArray(meta.path_sign)
      ? meta.path_sign
      : Array.from({ length: n }, () => null);
  if (pathRaw.length !== n) {
    throw new Error('graph.meta.json path_sign / path_sign_deprecated length does not match n_neurons');
  }
  const typeRaw = Array.isArray(meta.type) ? meta.type : Array.from({ length: n }, () => null);
  const subclassRaw = Array.isArray(meta.subclass) ? meta.subclass : Array.from({ length: n }, () => null);
  const uncRaw = Array.isArray(meta.nt_uncertain) ? meta.nt_uncertain : Array.from({ length: n }, () => false);
  const bodyId = new Int32Array(n);
  const role: RoleTag[] = [];
  const pathSign: Array<1 | -1 | null> = [];
  const type: Array<string | null> = [];
  const subclass: Array<string | null> = [];
  const ntUncertain: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const id = meta.bodyId[i];
    if (!Number.isSafeInteger(id)) throw new Error(`Invalid bodyId at ${i}`);
    bodyId[i] = id as number;
    role.push(asRole(meta.role[i], i));
    pathSign.push(asPathSign(pathRaw[i]));
    type.push(typeof typeRaw[i] === 'string' ? typeRaw[i] : null);
    subclass.push(typeof subclassRaw[i] === 'string' ? subclassRaw[i] : null);
    ntUncertain.push(Boolean(uncRaw[i]));
  }
  return { n, nEdges, bodyId, role, pathSign, type, subclass, ntUncertain };
}

export function parseCircuit(meta: unknown, bin: ArrayBuffer): CircuitGraph {
  const parsed = parseCircuitMeta(meta);
  const csr = parseGraphBin(bin, parsed.n, parsed.nEdges);
  return {
    n: parsed.n,
    nEdges: parsed.nEdges,
    indptr: csr.indptr,
    indices: csr.indices,
    weights: csr.weights,
    bodyId: parsed.bodyId,
    role: parsed.role,
    pathSign: parsed.pathSign,
    type: parsed.type,
    subclass: parsed.subclass,
    ntUncertain: parsed.ntUncertain,
  };
}

export function idsForRole(circuit: CircuitGraph, role: RoleTag): Int32Array {
  const ids: number[] = [];
  for (let i = 0; i < circuit.n; i++) if (circuit.role[i] === role) ids.push(circuit.bodyId[i]);
  return Int32Array.from(ids);
}

export function idsForSubclasses(
  circuit: CircuitGraph,
  subclasses: readonly string[],
): Int32Array {
  const allowed = new Set(subclasses);
  const ids: number[] = [];
  const list = circuit.subclass;
  if (!list) return new Int32Array(0);
  for (let i = 0; i < circuit.n; i++) {
    const value = list[i];
    if (typeof value === 'string' && allowed.has(value)) ids.push(circuit.bodyId[i]);
  }
  return Int32Array.from(ids);
}

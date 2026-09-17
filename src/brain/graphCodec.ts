/**
 * Feeding-circuit graph.bin encodings.
 *
 * Uncompressed (audit): int32 indptr, int32 indices, float32 weights.
 * Compressed (shipped): magic MMG1, uint32 n/nEdges, int32 indptr,
 * per-row sorted unsigned LEB128 index deltas, IEEE float16 weights.
 *
 * Row order of synapses does not affect LIF (g += w). Sorting is encode-only.
 */

export const GRAPH_MAGIC = 'MMG1';

export const GRAPH_BIN_LAYOUT_UNCOMPRESSED =
  'CSR little-endian: int32 indptr (n+1), int32 indices (n_edges), float32 signed weights (n_edges)';

export const GRAPH_BIN_LAYOUT_COMPRESSED =
  'MMG1 little-endian: uint32 n, uint32 nEdges, int32 indptr (n+1), unsigned LEB128 delta-encoded indices (rows sorted by target), IEEE float16 signed weights (n_edges)';

export type CsrArrays = {
  indptr: Int32Array;
  indices: Int32Array;
  weights: Float32Array;
};

/** ASCII `MMG1`. Literal bytes so worker/main do not depend on TextEncoder. */
const MAGIC_BYTES = Uint8Array.of(0x4d, 0x4d, 0x47, 0x31);

export type GraphBytes = ArrayBuffer | ArrayBufferView;

function view(buffer: ArrayBuffer): DataView {
  return new DataView(buffer);
}

/** Payload bytes. Honours TypedArray/DataView byteOffset (transfer/Node Buffer pools). */
export function asU8(data: GraphBytes): Uint8Array {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

export function uncompressedGraphBytes(n: number, nEdges: number): number {
  return (n + 1) * 4 + nEdges * 4 + nEdges * 4;
}

export function isCompressedGraph(data: GraphBytes): boolean {
  const bytes = asU8(data);
  return bytes.length >= 4
    && bytes[0] === MAGIC_BYTES[0]
    && bytes[1] === MAGIC_BYTES[1]
    && bytes[2] === MAGIC_BYTES[2]
    && bytes[3] === MAGIC_BYTES[3];
}

/**
 * Shared CSR loader (worker + Node). MMG1 magic first; exact uncompressed
 * length is the only path that uses the raw CSR layout.
 */
export function parseGraphPayload(data: GraphBytes, n: number, nEdges: number): CsrArrays {
  const bytes = asU8(data);
  if (isCompressedGraph(bytes)) return decodeCompressedGraph(bytes, n, nEdges);
  const expected = uncompressedGraphBytes(n, nEdges);
  if (bytes.byteLength === expected) return parseUncompressedGraph(bytes, n, nEdges);
  const mag = bytes.length >= 4 ? `[${bytes[0]}, ${bytes[1]}, ${bytes[2]}, ${bytes[3]}]` : 'short';
  throw new Error(
    `graph.bin is not MMG1 (magic ${mag}, ${bytes.byteLength} bytes) and not uncompressed CSR `
      + `(${expected} bytes for n=${n}, edges=${nEdges})`,
  );
}

/** IEEE-754 binary16 bits from a float32, round-to-nearest-even. */
export function float32ToFloat16Bits(value: number): number {
  const buf = new ArrayBuffer(4);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  const mant = x & 0x7fffff;
  if (exp === 255) return sign | 0x7c00 | (mant ? 0x0200 : 0);
  const unb = exp - 127 + 15;
  if (unb >= 31) return sign | 0x7c00;
  if (unb <= 0) {
    if (unb < -10) return sign;
    const keep = mant | 0x800000;
    const shift = 1 - unb;
    const rounded = (keep + (1 << (shift - 1)) - 1 + ((keep >> shift) & 1)) >> shift;
    return sign | (rounded >> 13);
  }
  const rounded = mant + 0x1000 + ((mant >> 13) & 1);
  if (rounded & 0x800000) {
    if (unb + 1 >= 31) return sign | 0x7c00;
    return sign | ((unb + 1) << 10);
  }
  return sign | (unb << 10) | (rounded >> 13);
}

export function float16BitsToFloat32(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * (mant ? (mant / 0x400) * 2 ** -14 : 0);
  if (exp === 31) return mant ? Number.NaN : sign * Infinity;
  return sign * (1 + mant / 0x400) * 2 ** (exp - 15);
}

export function writeUleb128(n: number, out: number[]): void {
  let x = n >>> 0;
  while (x >= 0x80) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
}

export function readUleb128(bytes: Uint8Array, offset: { i: number }): number {
  let result = 0;
  let shift = 0;
  const n = bytes.length;
  while (offset.i < n) {
    const b = bytes[offset.i]!;
    offset.i += 1;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return result >>> 0;
    shift += 7;
    if (shift > 35) throw new Error('uleb128 overflow');
  }
  throw new Error('uleb128 truncated');
}

function sortRow(
  indices: Int32Array,
  weights: Float32Array,
  start: number,
  end: number,
  outIdx: Int32Array,
  outW: Float32Array,
  dest: number,
): void {
  const len = end - start;
  const order = new Uint32Array(len);
  for (let k = 0; k < len; k++) order[k] = k;
  order.sort((a, b) => {
    const d = indices[start + a]! - indices[start + b]!;
    return d !== 0 ? d : a - b;
  });
  for (let k = 0; k < len; k++) {
    const src = start + order[k]!;
    outIdx[dest + k] = indices[src]!;
    outW[dest + k] = weights[src]!;
  }
}

export function encodeCompressedGraph(csr: CsrArrays): ArrayBuffer {
  const { indptr } = csr;
  const n = indptr.length - 1;
  const nEdges = csr.indices.length;
  if (indptr[0] !== 0 || indptr[n] !== nEdges) {
    throw new Error(`CSR indptr ends at ${indptr[n]}, expected ${nEdges}`);
  }
  const sortedIdx = new Int32Array(nEdges);
  const sortedW = new Float32Array(nEdges);
  for (let i = 0; i < n; i++) {
    const a = indptr[i]!;
    const b = indptr[i + 1]!;
    sortRow(csr.indices, csr.weights, a, b, sortedIdx, sortedW, a);
  }
  const varint: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = indptr[i]!;
    const b = indptr[i + 1]!;
    let prev = 0;
    for (let e = a; e < b; e++) {
      const idx = sortedIdx[e]!;
      const delta = idx - prev;
      if (delta < 0) throw new Error('delta-encoded indices must be non-decreasing per row');
      writeUleb128(delta, varint);
      prev = idx;
    }
  }
  const header = 4 + 4 + 4 + (n + 1) * 4;
  const out = new ArrayBuffer(header + varint.length + nEdges * 2);
  const bytes = new Uint8Array(out);
  bytes.set(MAGIC_BYTES, 0);
  const dv = view(out);
  dv.setUint32(4, n, true);
  dv.setUint32(8, nEdges, true);
  const indptrBytes = new Uint8Array(indptr.buffer, indptr.byteOffset, indptr.byteLength);
  bytes.set(indptrBytes, 12);
  bytes.set(varint, header);
  const wOff = header + varint.length;
  const wdv = new DataView(out, wOff);
  for (let i = 0; i < nEdges; i++) {
    wdv.setUint16(i * 2, float32ToFloat16Bits(sortedW[i]!), true);
  }
  return out;
}

function dataViewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function int32Copy(bytes: Uint8Array, byteOffset: number, count: number): Int32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + byteOffset, count * 4);
  const out = new Int32Array(count);
  for (let i = 0; i < count; i++) out[i] = dv.getInt32(i * 4, true);
  return out;
}

export function decodeCompressedGraph(data: GraphBytes, n: number, nEdges: number): CsrArrays {
  const bytes = asU8(data);
  if (!isCompressedGraph(bytes)) throw new Error('graph.bin is not MMG1 compressed');
  if (bytes.byteLength < 12 + (n + 1) * 4) {
    throw new Error(`graph.bin too short for MMG1 header (${bytes.byteLength})`);
  }
  const dv = dataViewOf(bytes);
  const nHeader = dv.getUint32(4, true);
  const eHeader = dv.getUint32(8, true);
  if (nHeader !== n || eHeader !== nEdges) {
    throw new Error(`MMG1 header n=${nHeader} e=${eHeader} != meta n=${n} e=${nEdges}`);
  }
  const indptrBytes = (n + 1) * 4;
  const packedOff = 12 + indptrBytes;
  const indptr = int32Copy(bytes, 12, n + 1);
  if (indptr[0] !== 0 || indptr[n] !== nEdges) {
    throw new Error(`CSR indptr ends at ${indptr[n]}, expected ${nEdges}`);
  }
  const packed = bytes.subarray(packedOff);
  const indices = new Int32Array(nEdges);
  const cursor = { i: 0 };
  for (let i = 0; i < n; i++) {
    const a = indptr[i]!;
    const b = indptr[i + 1]!;
    let prev = 0;
    for (let e = a; e < b; e++) {
      prev += readUleb128(packed, cursor);
      indices[e] = prev;
    }
  }
  const remain = packed.byteLength - cursor.i;
  if (remain !== nEdges * 2) {
    throw new Error(`MMG1 weight blob ${remain} bytes, expected ${nEdges * 2} (varint consumed ${cursor.i})`);
  }
  const wdv = new DataView(bytes.buffer, bytes.byteOffset + packedOff + cursor.i, nEdges * 2);
  const weights = new Float32Array(nEdges);
  for (let i = 0; i < nEdges; i++) {
    weights[i] = float16BitsToFloat32(wdv.getUint16(i * 2, true));
  }
  return { indptr, indices, weights };
}

export function parseUncompressedGraph(data: GraphBytes, n: number, nEdges: number): CsrArrays {
  const bytes = asU8(data);
  const expected = uncompressedGraphBytes(n, nEdges);
  if (bytes.byteLength !== expected) {
    throw new Error(`graph.bin length ${bytes.byteLength} != ${expected} (n=${n}, edges=${nEdges})`);
  }
  const indptrBytes = (n + 1) * 4;
  const indexBytes = nEdges * 4;
  const copy = bytes.slice();
  const indptr = new Int32Array(copy.buffer, 0, n + 1);
  const indices = new Int32Array(copy.buffer, indptrBytes, nEdges);
  const weights = new Float32Array(copy.buffer, indptrBytes + indexBytes, nEdges);
  if (indptr[0] !== 0 || indptr[n] !== nEdges) {
    throw new Error(`CSR indptr ends at ${indptr[n]}, expected ${nEdges}`);
  }
  return { indptr: indptr.slice(), indices: indices.slice(), weights: weights.slice() };
}

#!/usr/bin/env node
/**
 * Encode public/data/feeding-circuit/graph.bin as MMG1 (float16 + delta-varint).
 * Copies the uncompressed original to data/derived/ for audit.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCircuit } from '../src/brain/csr.ts';
import {
  GRAPH_BIN_LAYOUT_COMPRESSED,
  encodeCompressedGraph,
  isCompressedGraph,
} from '../src/brain/graphCodec.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicBin = join(root, 'public/data/feeding-circuit/graph.bin');
const metaPath = join(root, 'public/data/feeding-circuit/graph.meta.json');
const derivedDir = join(root, 'data/derived');
const auditBin = join(derivedDir, 'feeding-circuit-graph.uncompressed.bin');
const TARGET_BYTES = 20 * 1024 * 1024;

function main(): number {
  if (!existsSync(publicBin) || !existsSync(metaPath)) {
    console.error('Need public/data/feeding-circuit/graph.bin and graph.meta.json');
    return 1;
  }
  const raw = readFileSync(publicBin);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  const graph = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  if (!isCompressedGraph(graph)) {
    mkdirSync(derivedDir, { recursive: true });
    copyFileSync(publicBin, auditBin);
    console.log(`audit copy ${auditBin} (${raw.byteLength} bytes)`);
  }
  const circuit = parseCircuit(meta, graph);
  const compressed = encodeCompressedGraph(circuit);
  if (compressed.byteLength >= TARGET_BYTES) {
    console.error(`compressed size ${compressed.byteLength} >= 20 MiB target`);
    return 1;
  }
  writeFileSync(publicBin, Buffer.from(compressed));
  let metaText = readFileSync(metaPath, 'utf8');
  const oldLayout =
    '"layout": "CSR little-endian: int32 indptr (n+1), int32 indices (n_edges), float32 signed weights (n_edges)"';
  const newLayout = `"layout": "${GRAPH_BIN_LAYOUT_COMPRESSED}"`;
  if (metaText.includes(oldLayout)) metaText = metaText.replace(oldLayout, newLayout);
  writeFileSync(metaPath, metaText);
  console.log(
    `wrote ${publicBin} ${compressed.byteLength} bytes ` +
      `(${(compressed.byteLength / 1e6).toFixed(2)} MB) ` +
      `from ${raw.byteLength} (${(raw.byteLength / 1e6).toFixed(2)} MB) ` +
      `n=${circuit.n} edges=${circuit.nEdges}`,
  );
  return 0;
}

process.exit(main());

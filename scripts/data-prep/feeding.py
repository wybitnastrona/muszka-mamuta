"""Shared MaleCNS feeding-circuit helpers (no invented cell types)."""

from __future__ import annotations

import hashlib
import json
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw"
DERIVED_DIR = REPO_ROOT / "data" / "derived"
OUT_DIR = REPO_ROOT / "public" / "data" / "feeding-circuit"

ANNOTATION_FILE = "body-annotations-male-cns-v1.0-minconf-0.5.feather"
NT_FILE = "body-neurotransmitters-male-cns-v1.0.feather"
WEIGHT_FILE = "connectome-weights-male-cns-v1.0-minconf-0.5.feather"

DATASET_VERSION = "male-cns:v1.0"
MAX_DEPTH = 4
MAX_NEURONS = 20_000
CORE_CAP = 20_000
# Extra 10k (I = G∩P) is abandoned: Kenyon extras self-ignite without working
# APL; excluding ^KC/^MBON left 297 extra PAM-type cells that ride the same
# loop. The 19 verified PAM stay ~silent. Restore 2d084d9 (20k feeding gate).
PAM_EXTRA_SLOTS = 0
# Gustatory→PAM intersection uses a longer forward depth than the feeding gate.
GUST_TO_PAM_DEPTH = 6
GUST_TO_PAM_DEPTH_FALLBACK = 5
# If |I| exceeds this, retry forward BFS at fallback depth before ranking.
INTERSECTION_RANK_MAX = 80_000
CONTROL_SYNAPSE_MIN = 5
# compress_graph.ts TARGET_BYTES. Trim unsigned weight=1 edges if compressed ≥ this.
TARGET_COMPRESSED_BYTES = 20 * 1024 * 1024
# Measured 2-hop path (measure_reward). Do not drop these edges when trimming weight=1.
KNOWN_GUST_PAM_PATH = (13491, 13537, 28434)
MN9_BODY_IDS = frozenset({10331, 16949})
# The 19 PAM cells actually present in the gustatory→MN9 subgraph.
# Looked up in MaleCNS annotations (type starts with PAM). Not guessed.
# MaleCNS has 316 PAM-type cells; we BFS only from these 19.
PAM_BODY_IDS = frozenset(
    {
        28434,
        29565,
        32865,
        36624,
        37845,
        48113,
        60930,
        66934,
        125080,
        143120,
        170450,
        178945,
        200973,
        520403,
        520616,
        525787,
        544257,
        544359,
        547260,
    }
)
PROBOSCIS_SUBCLASSES = frozenset(
    {"labellar bristle", "taste peg", "pharyngeal sensillum"}
)

FILTER_DEFINITIONS = {
    "proboscis_gustatory": (
        'class == "gustatory" AND subclass in '
        '{"labellar bristle", "taste peg", "pharyngeal sensillum"}'
    ),
    "mn9": 'type == "MN9"',
    "proboscis_motor": 'superclass == "cb_motor"',
    "pam_reward": (
        'type starts with "PAM"; bodyIds exactly the 19 PAM cells that were '
        "present in the gustatory→MN9 extracted subgraph (not all 316 MaleCNS PAM)"
    ),
    "apl": 'type == "APL" (MaleCNS annotation; giant MB inhibitory neuron)',
}

NT_INHIBITORY = frozenset({"gaba", "glutamate"})
NT_EXCITATORY = frozenset({"acetylcholine"})


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def nt_sign(name: str | None) -> tuple[int, bool]:
    """Map a neurotransmitter name to (sign, uncertain).

    acetylcholine -> +1 (certain). GABA / glutamate -> -1 (certain).
    Missing, unclear, and all other transmitters -> +1 with nt_uncertain.
    """
    if name is None:
        return 1, True
    key = str(name).strip().lower()
    if not key or key in {"unclear", "unknown", "nan", "none"}:
        return 1, True
    if key in NT_EXCITATORY:
        return 1, False
    if key in NT_INHIBITORY:
        return -1, False
    return 1, True


def resolve_weight_columns(column_names: Sequence[str]) -> tuple[str, str, str]:
    names = list(column_names)
    pre_candidates = ("body_pre", "bodyId_pre", "pre", "bodyId_pre")
    post_candidates = ("body_post", "bodyId_post", "post")
    weight_candidates = ("weight", "roiWeight", "syn_count", "synapse_count")
    pre = next((c for c in pre_candidates if c in names), None)
    post = next((c for c in post_candidates if c in names), None)
    weight = next((c for c in weight_candidates if c in names), None)
    if pre is None or post is None or weight is None:
        raise RuntimeError(
            "Could not resolve weight columns from "
            f"{names}. Need pre, post, and weight."
        )
    return pre, post, weight


def resolve_seeds(annotations: pd.DataFrame) -> dict[str, pd.DataFrame]:
    gustatory = annotations[
        (annotations["class"] == "gustatory")
        & (annotations["subclass"].isin(PROBOSCIS_SUBCLASSES))
    ].copy()
    n_g = len(gustatory)
    if not (250 <= n_g <= 290):
        raise AssertionError(
            f"PROBOSCIS_GUSTATORY expected 250–290 neurons, got {n_g}. "
            "Stopping; filters will not be changed."
        )

    mn9 = annotations[annotations["type"] == "MN9"].copy()
    mn9_ids = frozenset(int(x) for x in mn9["bodyId"].tolist())
    if mn9_ids != MN9_BODY_IDS:
        raise AssertionError(
            f"MN9 expected bodyIds {sorted(MN9_BODY_IDS)}, got {sorted(mn9_ids)}. "
            "Stopping; filters will not be changed."
        )

    motor = annotations[annotations["superclass"] == "cb_motor"].copy()
    n_m = len(motor)
    if n_m != 107:
        raise AssertionError(
            f"PROBOSCIS_MOTOR (superclass == cb_motor) expected 107 neurons, "
            f"got {n_m}. Stopping; filters will not be changed."
        )
    motor_ids = frozenset(int(x) for x in motor["bodyId"].tolist())
    if not MN9_BODY_IDS <= motor_ids:
        raise AssertionError(
            "MN9 is not a subset of PROBOSCIS_MOTOR (cb_motor). Stopping."
        )

    return {
        "proboscis_gustatory": gustatory,
        "mn9": mn9,
        "proboscis_motor": motor,
    }


def resolve_pam(annotations: pd.DataFrame) -> pd.DataFrame:
    """Confirm the 19 subgraph PAM bodyIds in MaleCNS annotations.

    Stops if any ID is missing or its type does not start with PAM.
    Does not expand the start set to the other ~297 MaleCNS PAM cells.
    """
    body = annotations["bodyId"].astype("int64")
    pam = annotations[body.isin(list(PAM_BODY_IDS))].copy()
    found = frozenset(int(x) for x in pam["bodyId"].tolist())
    missing = PAM_BODY_IDS - found
    if missing:
        raise AssertionError(
            f"PAM bodyIds missing from annotations: {sorted(missing)}. Stopping."
        )
    for body_id, cell_type_raw in zip(pam["bodyId"].tolist(), pam["type"].tolist()):
        cell_type = None if pd.isna(cell_type_raw) else str(cell_type_raw)
        if cell_type is None or not cell_type.startswith("PAM"):
            raise AssertionError(
                f"bodyId {int(body_id)} expected type PAM*, got {cell_type!r}. Stopping."
            )
    return pam.sort_values("bodyId")


def resolve_apl(annotations: pd.DataFrame) -> pd.DataFrame:
    """APL cells from MaleCNS `type == "APL"`. Empty frame if none exist.

    Does not invent IDs. Callers must treat an empty result as "APL is not
    in this dataset" and fall back to excluding ^KC from extra slots.
    """
    raw = annotations["type"]
    is_apl = raw.astype("string").str.fullmatch("APL", case=False, na=False)
    apl = annotations[is_apl].copy()
    for body_id, cell_type_raw in zip(apl["bodyId"].tolist(), apl["type"].tolist()):
        cell_type = None if pd.isna(cell_type_raw) else str(cell_type_raw)
        if cell_type != "APL":
            raise AssertionError(
                f"bodyId {int(body_id)} matched APL lookup but type is {cell_type!r}. Stopping."
            )
    return apl.sort_values("bodyId")


def annotation_prefix_body_ids(annotations: pd.DataFrame, prefix: str) -> np.ndarray:
    """bodyIds whose MaleCNS type starts with `prefix` (e.g. KC, MBON)."""
    raw = annotations["type"].astype("string")
    hit = raw.str.match(f"^{prefix}", na=False)
    return annotations.loc[hit, "bodyId"].to_numpy(dtype=np.int64)


def mask_body_ids(node_ids: np.ndarray, body_ids: np.ndarray) -> np.ndarray:
    """Boolean mask over `node_ids` for the given bodyIds."""
    mask = np.zeros(len(node_ids), dtype=bool)
    if len(body_ids) == 0:
        return mask
    idx = np.searchsorted(node_ids, body_ids)
    ok = (idx < len(node_ids)) & (node_ids[np.minimum(idx, len(node_ids) - 1)] == body_ids)
    mask[idx[ok]] = True
    return mask


def json_records(frame: pd.DataFrame, columns: Sequence[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    ordered = frame.sort_values("bodyId")
    for row in ordered.itertuples(index=False):
        rec: dict[str, Any] = {}
        for col in columns:
            val = getattr(row, col)
            if pd.isna(val):
                rec[col] = None
            elif col == "bodyId":
                rec[col] = int(val)
            else:
                rec[col] = val
        out.append(rec)
    return out


def build_csr(
    sources: np.ndarray,
    targets: np.ndarray,
    weights: np.ndarray,
    n_nodes: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Build a CSR adjacency from 0-based source/target indices."""
    if n_nodes < 0:
        raise ValueError("n_nodes must be >= 0")
    if len(sources) == 0:
        indptr = np.zeros(n_nodes + 1, dtype=np.int32)
        return indptr, np.zeros(0, dtype=np.int32), np.zeros(0, dtype=np.float32)

    order = np.argsort(sources, kind="stable")
    src = np.asarray(sources)[order].astype(np.int64, copy=False)
    tgt = np.asarray(targets)[order].astype(np.int32, copy=False)
    if weights is None:
        w = np.zeros(0, dtype=np.float32)
    else:
        w = np.asarray(weights)[order].astype(np.float32, copy=False)
    counts = np.bincount(src, minlength=n_nodes)
    if len(counts) > n_nodes:
        raise ValueError("source index exceeds n_nodes")
    indptr = np.zeros(n_nodes + 1, dtype=np.int64)
    indptr[1:] = np.cumsum(counts)
    if indptr[-1] > np.iinfo(np.int32).max:
        raise OverflowError("CSR indptr does not fit in int32")
    return indptr.astype(np.int32), tgt, w


GRAPH_MAGIC = b"MMG1"
GRAPH_BIN_LAYOUT_UNCOMPRESSED = (
    "CSR little-endian: int32 indptr (n+1), int32 indices (n_edges), "
    "float32 signed weights (n_edges)"
)
GRAPH_BIN_LAYOUT_COMPRESSED = (
    "MMG1 little-endian: uint32 n, uint32 nEdges, int32 indptr (n+1), "
    "unsigned LEB128 delta-encoded indices (rows sorted by target), "
    "IEEE float16 signed weights (n_edges)"
)


def write_csr(
    path: Path,
    indptr: np.ndarray,
    indices: np.ndarray,
    weights: np.ndarray,
) -> None:
    """Uncompressed CSR writer — kept for audit dumps."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        np.asarray(indptr, dtype="<i4").tofile(handle)
        np.asarray(indices, dtype="<i4").tofile(handle)
        np.asarray(weights, dtype="<f4").tofile(handle)


def _uleb128(n: int) -> bytes:
    if n < 0:
        raise ValueError("uleb128 is unsigned")
    out = bytearray()
    x = int(n)
    while x >= 0x80:
        out.append((x & 0x7F) | 0x80)
        x >>= 7
    out.append(x)
    return bytes(out)


def write_csr_compressed(
    path: Path,
    indptr: np.ndarray,
    indices: np.ndarray,
    weights: np.ndarray,
) -> None:
    """Ship format: float16 weights + per-row sorted index deltas as uleb128."""
    indptr = np.asarray(indptr, dtype=np.int32)
    indices = np.asarray(indices, dtype=np.int32)
    weights = np.asarray(weights, dtype=np.float32)
    n = int(indptr.size - 1)
    n_edges = int(indices.size)
    if int(indptr[0]) != 0 or int(indptr[-1]) != n_edges:
        raise ValueError("CSR indptr does not match n_edges")
    packed = bytearray()
    sorted_w = np.empty(n_edges, dtype=np.float32)
    for i in range(n):
        a = int(indptr[i])
        b = int(indptr[i + 1])
        order = np.argsort(indices[a:b], kind="stable")
        row_i = indices[a:b][order]
        row_w = weights[a:b][order]
        sorted_w[a:b] = row_w
        prev = 0
        for idx in row_i.tolist():
            delta = int(idx) - prev
            if delta < 0:
                raise ValueError("row indices must be non-decreasing after sort")
            packed.extend(_uleb128(delta))
            prev = int(idx)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.write(GRAPH_MAGIC)
        np.asarray([n, n_edges], dtype="<u4").tofile(handle)
        np.asarray(indptr, dtype="<i4").tofile(handle)
        handle.write(packed)
        np.asarray(sorted_w, dtype="<f2").tofile(handle)


def _read_uleb128(buf: memoryview, offset: int) -> tuple[int, int]:
    result = 0
    shift = 0
    i = offset
    n = len(buf)
    while i < n:
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return result, i
        shift += 7
        if shift > 35:
            raise ValueError("uleb128 overflow")
    raise ValueError("uleb128 truncated")


def read_csr_compressed(
    path: Path, n_nodes: int, n_edges: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    raw = path.read_bytes()
    if raw[:4] != GRAPH_MAGIC:
        raise ValueError("not an MMG1 compressed CSR")
    n_hdr = int(np.frombuffer(raw, dtype="<u4", count=1, offset=4)[0])
    e_hdr = int(np.frombuffer(raw, dtype="<u4", count=1, offset=8)[0])
    if n_hdr != n_nodes or e_hdr != n_edges:
        raise ValueError(f"MMG1 header n={n_hdr} e={e_hdr} != {n_nodes}/{n_edges}")
    indptr_off = 12
    indptr = np.frombuffer(raw, dtype="<i4", count=n_nodes + 1, offset=indptr_off).copy()
    packed_off = indptr_off + (n_nodes + 1) * 4
    packed = memoryview(raw)[packed_off:]
    indices = np.empty(n_edges, dtype=np.int32)
    cursor = 0
    for i in range(n_nodes):
        a = int(indptr[i])
        b = int(indptr[i + 1])
        prev = 0
        for e in range(a, b):
            delta, cursor = _read_uleb128(packed, cursor)
            prev += delta
            indices[e] = prev
    remain = len(packed) - cursor
    if remain != n_edges * 2:
        raise ValueError(f"MMG1 weight blob {remain} bytes, expected {n_edges * 2}")
    weights = np.frombuffer(raw, dtype="<f2", offset=packed_off + cursor, count=n_edges).astype(
        np.float32, copy=True
    )
    return indptr, indices, weights


def read_csr(
    path: Path, n_nodes: int, n_edges: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Uncompressed CSR reader (audit). Compressed files use read_csr_compressed."""
    with path.open("rb") as handle:
        indptr = np.fromfile(handle, dtype="<i4", count=n_nodes + 1)
        indices = np.fromfile(handle, dtype="<i4", count=n_edges)
        weights = np.fromfile(handle, dtype="<f4", count=n_edges)
        leftover = handle.read()
    if indptr.size != n_nodes + 1 or indices.size != n_edges or weights.size != n_edges:
        raise ValueError("CSR file does not match n_nodes/n_edges")
    if leftover:
        raise ValueError("CSR file has trailing bytes")
    return indptr, indices, weights


def bfs_reach(
    starts: Iterable[int],
    indptr: np.ndarray,
    indices: np.ndarray,
    max_depth: int,
    n_nodes: int,
    allowed: np.ndarray | None = None,
) -> np.ndarray:
    """Return a boolean mask of nodes reached in <= max_depth hops.

    If `allowed` is set, walks stay inside that mask (starts outside it
    are skipped).
    """
    reached = np.zeros(n_nodes, dtype=bool)
    depth = np.full(n_nodes, -1, dtype=np.int32)
    q: deque[int] = deque()
    for s in starts:
        if s < 0 or s >= n_nodes or reached[s]:
            continue
        if allowed is not None and not bool(allowed[s]):
            continue
        reached[s] = True
        depth[s] = 0
        q.append(s)
    while q:
        u = q.popleft()
        if depth[u] >= max_depth:
            continue
        start, end = int(indptr[u]), int(indptr[u + 1])
        for v in indices[start:end]:
            v = int(v)
            if reached[v]:
                continue
            if allowed is not None and not bool(allowed[v]):
                continue
            reached[v] = True
            depth[v] = depth[u] + 1
            q.append(v)
    return reached


def nodes_on_paths(
    starts: Iterable[int],
    goals: Iterable[int],
    fwd_indptr: np.ndarray,
    fwd_indices: np.ndarray,
    rev_indptr: np.ndarray,
    rev_indices: np.ndarray,
    allowed: np.ndarray,
    n_nodes: int,
) -> tuple[np.ndarray, int | None]:
    """Neurons on any start→goal walk inside `allowed`, plus shortest hops.

    Unlimited depth within the allowed set. Hops is the first time a BFS
    from `starts` hits any goal.
    """
    start_list = [int(s) for s in starts]
    goal_list = [int(g) for g in goals]
    goal_mask = np.zeros(n_nodes, dtype=bool)
    for g in goal_list:
        if 0 <= g < n_nodes:
            goal_mask[g] = True
    unlimited = max(1, int(allowed.sum()) if allowed.any() else 1)
    from_start = bfs_reach(
        start_list, fwd_indptr, fwd_indices, unlimited, n_nodes, allowed
    )
    to_goal = bfs_reach(
        goal_list, rev_indptr, rev_indices, unlimited, n_nodes, allowed
    )
    on_path = from_start & to_goal & allowed
    hops: int | None = None
    reached = np.zeros(n_nodes, dtype=bool)
    depth = np.full(n_nodes, -1, dtype=np.int32)
    q: deque[int] = deque()
    for s in start_list:
        if s < 0 or s >= n_nodes or not bool(allowed[s]) or reached[s]:
            continue
        reached[s] = True
        depth[s] = 0
        q.append(s)
        if goal_mask[s]:
            hops = 0
            break
    while q and hops is None:
        u = q.popleft()
        start, end = int(fwd_indptr[u]), int(fwd_indptr[u + 1])
        for v in fwd_indices[start:end]:
            v = int(v)
            if reached[v] or not bool(allowed[v]):
                continue
            reached[v] = True
            depth[v] = depth[u] + 1
            if goal_mask[v]:
                hops = int(depth[v])
                break
            q.append(v)
        if hops is not None:
            break
    return on_path, hops


def max_log_product_to_targets(
    targets: Iterable[int],
    pre: np.ndarray,
    post: np.ndarray,
    weight: np.ndarray,
    max_depth: int,
    n_nodes: int,
    allowed: np.ndarray | None = None,
) -> np.ndarray:
    """log(max unsigned-weight product) of a hop-limited walk to a target.

    COO edges are pre→post. Each Bellman–Ford sweep updates the presynaptic
    node from the postsynaptic score (walks toward PAM). Restricted to
    `allowed` when given — rank only inside I, not the whole 151M-edge graph.
    """
    log_score = np.full(n_nodes, -np.inf, dtype=np.float64)
    for t in targets:
        t = int(t)
        if t < 0 or t >= n_nodes:
            continue
        if allowed is not None and not bool(allowed[t]):
            continue
        log_score[t] = 0.0
    if len(pre) == 0 or max_depth <= 0:
        return log_score
    if allowed is not None:
        inside = allowed[pre] & allowed[post]
        pre_e = pre[inside]
        post_e = post[inside]
        w = weight[inside]
    else:
        pre_e = pre
        post_e = post
        w = weight
    mag = np.abs(w.astype(np.float64, copy=False))
    mag = np.maximum(mag, 1e-12)
    logw = np.log(mag)
    for _ in range(max_depth):
        finite = np.isfinite(log_score[post_e])
        if not bool(finite.any()):
            break
        cand = log_score[post_e[finite]] + logw[finite]
        nxt = log_score.copy()
        np.maximum.at(nxt, pre_e[finite], cand)
        log_score = nxt
    return log_score


def pick_top_scored(
    mask: np.ndarray,
    scores: np.ndarray,
    k: int,
) -> np.ndarray:
    """Boolean mask of the k highest scores inside `mask`. Ties: lower index."""
    idx = np.flatnonzero(mask)
    if k <= 0 or len(idx) == 0:
        return np.zeros(len(mask), dtype=bool)
    if len(idx) <= k:
        out = np.zeros(len(mask), dtype=bool)
        out[idx] = True
        return out
    sc = scores[idx]
    order = np.lexsort((idx, -sc))
    chosen = idx[order[:k]]
    out = np.zeros(len(mask), dtype=bool)
    out[chosen] = True
    return out


def gustatory_pam_intersection(
    gust_idx: np.ndarray,
    pam_idx: np.ndarray,
    fwd_indptr: np.ndarray,
    fwd_indices: np.ndarray,
    rev_indptr: np.ndarray,
    rev_indices: np.ndarray,
    n_nodes: int,
    forward_depth: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    """I = forward(gust, depth) ∩ backward(PAM, MAX_DEPTH). Returns I, G, P, |I|."""
    g = bfs_reach(gust_idx.tolist(), fwd_indptr, fwd_indices, forward_depth, n_nodes)
    p = bfs_reach(pam_idx.tolist(), rev_indptr, rev_indices, MAX_DEPTH, n_nodes)
    p[pam_idx] = True
    inter = g & p
    return inter, g, p, int(inter.sum())


def select_intersection_extras(
    intersection: np.ndarray,
    core_keep: np.ndarray,
    scores: np.ndarray,
    extra_slots: int = PAM_EXTRA_SLOTS,
    exclude: np.ndarray | None = None,
) -> tuple[np.ndarray, int]:
    """Top `extra_slots` of I minus the feeding-gate core, by path strength.

    `exclude` drops candidates (Kenyon cells when APL is absent).
    """
    candidates = intersection & ~core_keep
    if exclude is not None:
        candidates = candidates & ~exclude
    n_cand = int(candidates.sum())
    extras = pick_top_scored(candidates, scores, extra_slots)
    return extras, n_cand


def protect_weight_one_edges(
    src: np.ndarray,
    dst: np.ndarray,
    graph_ids: np.ndarray,
    on_path: np.ndarray,
    known_path: Sequence[int] = KNOWN_GUST_PAM_PATH,
) -> np.ndarray:
    """Protect gustatory→PAM walk edges, including the measured PhG4→SLP234→PAM10 path.

    Weight-1 trim must not cut those edges: they can be thin and are the reason
    the extra 10k slots exist.
    """
    if len(src) == 0:
        return np.zeros(0, dtype=bool)
    protect = on_path[src] & on_path[dst]
    index = {int(b): i for i, b in enumerate(graph_ids)}
    local = [index[int(b)] for b in known_path if int(b) in index]
    for a, b in zip(local, local[1:]):
        protect = protect | ((src == a) & (dst == b))
    return protect


def drop_weight_one_edges(
    src: np.ndarray,
    dst: np.ndarray,
    mag: np.ndarray,
    protect: np.ndarray,
) -> np.ndarray:
    """Keep edges unless unsigned weight is 1 and the edge is not protected."""
    if len(src) == 0:
        return np.zeros(0, dtype=bool)
    w1 = np.isclose(mag.astype(np.float64), 1.0)
    return ~w1 | protect


def add_presynaptic_control(
    keep: np.ndarray,
    sources: np.ndarray,
    targets: np.ndarray,
    weights: np.ndarray,
    min_synapses: int = CONTROL_SYNAPSE_MIN,
) -> np.ndarray:
    """Add neurons with >= min_synapses onto the current keep set."""
    incoming = np.zeros(len(keep), dtype=np.int64)
    post_kept = keep[targets]
    if post_kept.any():
        src = sources[post_kept]
        w = weights[post_kept]
        not_kept = ~keep[src]
        src = src[not_kept]
        w = w[not_kept]
        if len(src):
            np.add.at(incoming, src, w)
    extra = incoming >= min_synapses
    out = keep.copy()
    out[extra] = True
    return out


def cap_neurons(
    keep: np.ndarray,
    seed: np.ndarray,
    sources: np.ndarray,
    targets: np.ndarray,
    weights: np.ndarray,
    max_neurons: int = MAX_NEURONS,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Drop weakest-connected non-seeds first. Returns (keep, dropped_idx, scores)."""
    n_keep = int(keep.sum())
    if n_keep <= max_neurons:
        return keep, np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.int64)

    score = np.zeros(len(keep), dtype=np.int64)
    both = keep[sources] & keep[targets]
    if both.any():
        np.add.at(score, sources[both], weights[both])
        np.add.at(score, targets[both], weights[both])

    candidates = np.flatnonzero(keep & ~seed)
    cand_scores = score[candidates]
    order = np.lexsort((candidates, cand_scores))  # weakest, then lowest index
    n_drop = n_keep - max_neurons
    if n_drop > len(candidates):
        raise AssertionError(
            f"Cannot cap to {max_neurons}: {int(seed.sum())} seed neurons exceed the cap."
        )
    dropped = candidates[order[:n_drop]]
    new_keep = keep.copy()
    new_keep[dropped] = False
    return new_keep, dropped, score[dropped]


def assign_role(
    body_id: int,
    cell_type: str | None,
    subclass: str | None,
    superclass: str | None,
    gustatory_ids: set[int],
    mn9_ids: set[int],
) -> str:
    if body_id in mn9_ids:
        return "mn9"
    if body_id in gustatory_ids:
        if subclass in {"labellar bristle", "taste peg"}:
            return "gust_labellar"
        if subclass == "pharyngeal sensillum":
            return "gust_pharyngeal"
        raise AssertionError(
            f"Gustatory seed {body_id} has unexpected subclass {subclass!r}"
        )
    if superclass == "cb_motor":
        return "mn_other"
    if superclass == "descending_neuron":
        return "dn"
    return "interneuron"


def csr_to_coo(
    indptr: np.ndarray, indices: np.ndarray, weights: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    counts = np.diff(indptr).astype(np.int64)
    src = np.repeat(np.arange(len(indptr) - 1, dtype=np.int32), counts)
    return src, indices, weights


def strongest_path_sign(
    indptr: np.ndarray,
    indices: np.ndarray,
    signed_weights: np.ndarray,
    source: int,
    targets: set[int],
    max_depth: int = MAX_DEPTH,
) -> int | None:
    """Sign of the highest unsigned-weight walk from source to any target.

    Path strength is the product of |edge weights| (implemented as a sum of
    logs). The returned value is the product of edge signs along that walk.
    This is an inference, not a measured receptor identity.
    """
    src, dst, weights = csr_to_coo(indptr, indices, signed_weights)
    n = len(indptr) - 1
    return strongest_path_sign_coo(src, dst, weights, n, source, targets, max_depth)


def strongest_path_sign_coo(
    src: np.ndarray,
    dst: np.ndarray,
    signed_weights: np.ndarray,
    n_nodes: int,
    source: int,
    targets: set[int],
    max_depth: int = MAX_DEPTH,
) -> int | None:
    if len(src) == 0:
        return None
    mag = np.abs(signed_weights.astype(np.float64, copy=False))
    usable = mag > 0
    src_e = src[usable]
    dst_e = dst[usable]
    logmag = np.log(mag[usable])
    edge_sign = np.where(signed_weights[usable] >= 0, 1, -1).astype(np.int8)
    target_idx = np.fromiter(targets, dtype=np.int64) if targets else np.zeros(0, dtype=np.int64)

    best_log = np.full(n_nodes, -np.inf, dtype=np.float64)
    best_sign = np.zeros(n_nodes, dtype=np.int8)
    best_log[source] = 0.0
    best_sign[source] = 1
    found_log = -np.inf
    found_sign: int | None = None

    for _ in range(max_depth):
        cand_log = best_log[src_e] + logmag
        finite = np.isfinite(cand_log)
        if not finite.any():
            break
        cl = cand_log[finite]
        cd = dst_e[finite]
        cs = best_sign[src_e[finite]] * edge_sign[finite]
        order = np.lexsort((cl, cd))
        cd_s = cd[order]
        cl_s = cl[order]
        cs_s = cs[order]
        last = np.flatnonzero(np.r_[cd_s[1:] != cd_s[:-1], True])
        new_log = np.full(n_nodes, -np.inf, dtype=np.float64)
        new_sign = np.zeros(n_nodes, dtype=np.int8)
        new_log[cd_s[last]] = cl_s[last]
        new_sign[cd_s[last]] = cs_s[last]
        if len(target_idx):
            for t in target_idx:
                val = new_log[t]
                if val > found_log:
                    found_log = val
                    found_sign = int(new_sign[t])
        best_log = new_log
        best_sign = new_sign

    if found_sign is None or not np.isfinite(found_log):
        return None
    return found_sign


def dump_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

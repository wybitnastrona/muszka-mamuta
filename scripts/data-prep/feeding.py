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
CONTROL_SYNAPSE_MIN = 5
MN9_BODY_IDS = frozenset({10331, 16949})
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


def write_csr(
    path: Path,
    indptr: np.ndarray,
    indices: np.ndarray,
    weights: np.ndarray,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        np.asarray(indptr, dtype="<i4").tofile(handle)
        np.asarray(indices, dtype="<i4").tofile(handle)
        np.asarray(weights, dtype="<f4").tofile(handle)


def read_csr(
    path: Path, n_nodes: int, n_edges: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
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
) -> np.ndarray:
    """Return a boolean mask of nodes reached in <= max_depth hops."""
    reached = np.zeros(n_nodes, dtype=bool)
    depth = np.full(n_nodes, -1, dtype=np.int16)
    q: deque[int] = deque()
    for s in starts:
        if s < 0 or s >= n_nodes or reached[s]:
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
            if not reached[v]:
                reached[v] = True
                depth[v] = depth[u] + 1
                q.append(v)
    return reached


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

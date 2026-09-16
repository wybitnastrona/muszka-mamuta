#!/usr/bin/env python3
"""Extract a signed feeding subgraph from MaleCNS v1.0 weights."""

from __future__ import annotations

import json
import resource
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.feather as feather

from feeding import (
    ANNOTATION_FILE,
    CONTROL_SYNAPSE_MIN,
    DATASET_VERSION,
    DERIVED_DIR,
    FILTER_DEFINITIONS,
    MAX_DEPTH,
    MAX_NEURONS,
    MN9_BODY_IDS,
    NT_FILE,
    OUT_DIR,
    RAW_DIR,
    WEIGHT_FILE,
    add_presynaptic_control,
    assign_role,
    bfs_reach,
    build_csr,
    cap_neurons,
    nt_sign,
    read_csr,
    resolve_seeds,
    resolve_weight_columns,
    sha256_file,
    strongest_path_sign_coo,
    utc_now,
    write_csr,
)


def peak_rss_mb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return rss / (1024 * 1024)
    return rss / 1024


def log(msg: str) -> None:
    print(f"[extract {peak_rss_mb():8.1f} MiB] {msg}", flush=True)


def load_nt_tables(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    nt = pd.read_feather(path)
    body = nt["body"].to_numpy(dtype=np.int64, copy=False)
    consensus = nt["consensus_nt"]
    predicted = nt["predicted_nt"]
    chosen = consensus.where(consensus.notna(), predicted)
    names = chosen.astype("string").to_numpy(copy=False)
    signs = np.empty(len(body), dtype=np.int8)
    uncertain = np.empty(len(body), dtype=bool)
    dist: Counter[str] = Counter()
    for i, name in enumerate(names):
        label = None if pd.isna(name) else str(name)
        dist[label if label else "missing"] += 1
        s, u = nt_sign(label)
        signs[i] = s
        uncertain[i] = u
    order = np.argsort(body, kind="stable")
    print("Neurotransmitter table (per body, consensus_nt else predicted_nt):")
    for key, count in dist.most_common():
        print(f"  {key}: {count:,}")
    print(f"  unique bodies: {len(body):,}")
    return body[order], signs[order], uncertain[order]


def lookup_nt(
    bodies: np.ndarray,
    nt_body: np.ndarray,
    nt_sign_arr: np.ndarray,
    nt_unc: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    idx = np.searchsorted(nt_body, bodies)
    in_range = idx < len(nt_body)
    found = np.zeros(len(bodies), dtype=bool)
    found[in_range] = nt_body[idx[in_range]] == bodies[in_range]
    signs = np.ones(len(bodies), dtype=np.int8)
    uncertain = np.ones(len(bodies), dtype=bool)
    signs[found] = nt_sign_arr[idx[found]]
    uncertain[found] = nt_unc[idx[found]]
    return signs, uncertain


def id_to_index(sorted_ids: np.ndarray, values: np.ndarray) -> np.ndarray:
    idx = np.searchsorted(sorted_ids, values)
    ok = (idx < len(sorted_ids)) & (sorted_ids[np.minimum(idx, len(sorted_ids) - 1)] == values)
    out = np.full(len(values), -1, dtype=np.int64)
    out[ok] = idx[ok]
    return out


def main() -> int:
    for name in (ANNOTATION_FILE, NT_FILE, WEIGHT_FILE):
        if not (RAW_DIR / name).exists():
            print(f"Missing {RAW_DIR / name}", file=sys.stderr)
            return 1

    log("loading annotations")
    annotations = pd.read_feather(RAW_DIR / ANNOTATION_FILE)
    try:
        seeds = resolve_seeds(annotations)
    except AssertionError as exc:
        print("SEED ASSERTION FAILED", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

    gust_ids = {int(x) for x in seeds["proboscis_gustatory"]["bodyId"]}
    motor_ids = {int(x) for x in seeds["proboscis_motor"]["bodyId"]}
    mn9_ids = set(MN9_BODY_IDS)
    seed_ids = gust_ids | motor_ids
    log(
        f"seeds: gustatory={len(gust_ids)} mn9={len(mn9_ids)} "
        f"motor={len(motor_ids)} union={len(seed_ids)}"
    )

    log("loading neurotransmitter predictions")
    nt_body, nt_signs, nt_unc = load_nt_tables(RAW_DIR / NT_FILE)

    weight_path = RAW_DIR / WEIGHT_FILE
    log(f"opening weight table (pyarrow memory_map, needed columns only): {weight_path}")
    table = feather.read_table(weight_path, memory_map=True)
    print("Weight table columns:", list(table.column_names))
    print(f"Weight table rows: {table.num_rows:,}")
    pre_col, post_col, w_col = resolve_weight_columns(table.column_names)
    print(f"Using columns: pre={pre_col} post={post_col} weight={w_col}")
    table = table.select([pre_col, post_col, w_col])
    pre = table.column(pre_col).to_numpy()
    post = table.column(post_col).to_numpy()
    weight = table.column(w_col).to_numpy()
    del table
    log(f"weight arrays in memory: {len(pre):,} edges")

    log("factorizing body IDs")
    node_ids = np.unique(np.concatenate([pre, post]))
    n_full = int(len(node_ids))
    log(f"unique neurons in weight table: {n_full:,}")
    pre_i = id_to_index(node_ids, pre)
    post_i = id_to_index(node_ids, post)
    if np.any(pre_i < 0) or np.any(post_i < 0):
        raise RuntimeError("Failed to map weight endpoints onto unique node IDs")

    log("building forward and reverse adjacency of the full weight graph")
    fwd_indptr, fwd_indices, _ = build_csr(pre_i, post_i, None, n_full)
    rev_indptr, rev_indices, _ = build_csr(post_i, pre_i, None, n_full)

    def map_seeds(ids: set[int]) -> np.ndarray:
        arr = np.fromiter(ids, dtype=np.int64)
        idx = id_to_index(node_ids, arr)
        missing = arr[idx < 0]
        if len(missing):
            preview = ", ".join(str(int(x)) for x in missing[:12])
            log(f"  {len(missing)} seed bodyIds have no edges in the weight table: {preview}")
        return idx[idx >= 0]

    gust_idx = map_seeds(gust_ids)
    motor_idx = map_seeds(motor_ids | mn9_ids)
    seed_idx = map_seeds(seed_ids)
    log(f"seed nodes present in weights: gust={len(gust_idx)} motor={len(motor_idx)}")

    log(f"forward BFS from PROBOSCIS_GUSTATORY, max depth {MAX_DEPTH}")
    forward = bfs_reach(gust_idx.tolist(), fwd_indptr, fwd_indices, MAX_DEPTH, n_full)
    log(f"  forward reached {int(forward.sum()):,}")
    log(f"backward BFS from MN9 ∪ PROBOSCIS_MOTOR, max depth {MAX_DEPTH}")
    backward = bfs_reach(motor_idx.tolist(), rev_indptr, rev_indices, MAX_DEPTH, n_full)
    log(f"  backward reached {int(backward.sum()):,}")

    keep = forward & backward
    keep[seed_idx] = True
    log(f"intersection ∪ seeds-in-graph: {int(keep.sum()):,}")
    del fwd_indptr, fwd_indices, rev_indptr, rev_indices

    log(f"adding neurons with >= {CONTROL_SYNAPSE_MIN} synapses onto that set")
    keep = add_presynaptic_control(keep, pre_i, post_i, weight, CONTROL_SYNAPSE_MIN)
    log(f"  after control partners: {int(keep.sum()):,}")

    seed_mask = np.zeros(n_full, dtype=bool)
    seed_mask[seed_idx] = True
    keep, dropped_idx, dropped_scores = cap_neurons(
        keep, seed_mask, pre_i, post_i, weight, MAX_NEURONS
    )
    if len(dropped_idx):
        dropped_ids = node_ids[dropped_idx]
        log(
            f"cap {MAX_NEURONS}: dropped {len(dropped_idx):,} weakest-connected "
            f"non-seeds (score min={int(dropped_scores.min())} "
            f"max={int(dropped_scores.max())})"
        )
        preview = ", ".join(str(int(x)) for x in dropped_ids[:25])
        log(f"  dropped bodyId preview: {preview}")
        drop_path = DERIVED_DIR / "feeding-circuit-dropped.json"
        DERIVED_DIR.mkdir(parents=True, exist_ok=True)
        drop_path.write_text(
            json.dumps(
                {
                    "count": int(len(dropped_idx)),
                    "score_min": int(dropped_scores.min()),
                    "score_max": int(dropped_scores.max()),
                    "bodyIds": [int(x) for x in dropped_ids],
                    "scores": [int(x) for x in dropped_scores],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        log(f"  wrote {drop_path}")
    else:
        log(f"no cap needed ({int(keep.sum()):,} <= {MAX_NEURONS})")

    graph_ids = node_ids[keep]
    extra_seeds = sorted(seed_ids - set(int(x) for x in graph_ids))
    if extra_seeds:
        log(f"appending {len(extra_seeds)} seed neurons with no weight-table edges")
        graph_ids = np.sort(np.concatenate([graph_ids, np.array(extra_seeds, dtype=np.int64)]))
    else:
        graph_ids = np.sort(graph_ids)

    n = int(len(graph_ids))
    log(f"final neuron count: {n:,}")
    if n > MAX_NEURONS:
        raise AssertionError(f"Final graph has {n} neurons, cap is {MAX_NEURONS}")

    src = id_to_index(graph_ids, pre)
    dst = id_to_index(graph_ids, post)
    internal = (src >= 0) & (dst >= 0)
    src = src[internal]
    dst = dst[internal]
    mag = weight[internal].astype(np.float32)
    log(f"internal edges before NT sign: {len(src):,}")

    pre_bodies = graph_ids[src]
    pre_sign, pre_unc = lookup_nt(pre_bodies, nt_body, nt_signs, nt_unc)
    signed = mag * pre_sign.astype(np.float32)
    n_unc_edges = int(pre_unc.sum())
    pct_unc = 100.0 * n_unc_edges / len(signed) if len(signed) else 0.0
    print("Extracted-subgraph NT (keyed on PRE-synaptic neuron):")
    print(f"  edges: {len(signed):,}")
    print(f"  uncertain-NT edges: {n_unc_edges:,} ({pct_unc:.2f}%)")
    print(f"  signed-weight < 0: {int((signed < 0).sum()):,}")
    print(f"  signed-weight > 0: {int((signed > 0).sum()):,}")

    neuron_sign, neuron_unc = lookup_nt(graph_ids, nt_body, nt_signs, nt_unc)
    nt_neuron_dist = Counter()
    for s, u in zip(neuron_sign, neuron_unc):
        if u:
            nt_neuron_dist["uncertain_default_+1"] += 1
        elif s < 0:
            nt_neuron_dist["inhibitory_-1"] += 1
        else:
            nt_neuron_dist["excitatory_+1"] += 1
    print("Neuron-level NT flags in subgraph:")
    for key, count in nt_neuron_dist.most_common():
        print(f"  {key}: {count:,}")

    log("building subgraph CSR")
    indptr, indices, data = build_csr(src, dst, signed, n)

    ann_by_id = annotations.set_index("bodyId")
    roles: list[str] = []
    types: list[str | None] = []
    subclasses: list[str | None] = []
    superclasses: list[str | None] = []
    for body in graph_ids:
        bid = int(body)
        if bid in ann_by_id.index:
            row = ann_by_id.loc[bid]
            cell_type = None if pd.isna(row["type"]) else str(row["type"])
            subclass = None if pd.isna(row["subclass"]) else str(row["subclass"])
            superclass = None if pd.isna(row["superclass"]) else str(row["superclass"])
        else:
            cell_type = subclass = superclass = None
        types.append(cell_type)
        subclasses.append(subclass)
        superclasses.append(superclass)
        roles.append(
            assign_role(bid, cell_type, subclass, superclass, gust_ids, mn9_ids)
        )

    log("computing path_sign for each gustatory seed → MN9 (inference, depth <= 4)")
    mn9_local = {int(i) for i, bid in enumerate(graph_ids) if int(bid) in mn9_ids}
    if len(mn9_local) != 2:
        log(f"WARNING: {len(mn9_local)} MN9 nodes in subgraph (expected 2)")
    path_signs: list[int | None] = [None] * n
    path_dist: Counter[str] = Counter()
    for i, bid in enumerate(graph_ids):
        if int(bid) not in gust_ids:
            continue
        sign = strongest_path_sign_coo(src, dst, signed, n, i, mn9_local, MAX_DEPTH)
        path_signs[i] = sign
        if sign is None:
            path_dist["none"] += 1
        elif sign > 0:
            path_dist["+1"] += 1
        else:
            path_dist["-1"] += 1
    print("path_sign distribution (gustatory seeds only; inference, not a receptor label):")
    for key in ("+1", "-1", "none"):
        print(f"  {key}: {path_dist[key]}")

    role_counts = Counter(roles)
    print()
    print("Summary")
    print("-------")
    print(f"{'role':<18} {'n':>8}")
    for role in (
        "gust_labellar",
        "gust_pharyngeal",
        "mn9",
        "mn_other",
        "dn",
        "interneuron",
    ):
        print(f"{role:<18} {role_counts[role]:>8}")
    print(f"{'TOTAL':<18} {n:>8}")
    print(f"edges: {len(data):,}")
    print(f"uncertain NT edges: {n_unc_edges:,} ({pct_unc:.2f}%)")
    print(f"path_sign +1/-1/none: {path_dist['+1']}/{path_dist['-1']}/{path_dist['none']}")
    print(f"peak RSS: {peak_rss_mb():.1f} MiB")

    hashes = {
        name: sha256_file(RAW_DIR / name)
        for name in (ANNOTATION_FILE, NT_FILE, WEIGHT_FILE)
    }
    meta = {
        "dataset": DATASET_VERSION,
        "n_neurons": n,
        "n_edges": int(len(data)),
        "bodyId": [int(x) for x in graph_ids],
        "type": types,
        "subclass": subclasses,
        "role": roles,
        "path_sign": path_signs,
        "nt_uncertain": [bool(x) for x in neuron_unc],
        "graph_bin": {
            "path": "graph.bin",
            "layout": "CSR little-endian: int32 indptr (n+1), int32 indices (n_edges), float32 signed weights (n_edges)",
            "indptr_count": n + 1,
            "indices_count": int(len(data)),
            "weights_count": int(len(data)),
            "note": "indices are positions into bodyId. signed weight = synapse_count * NT_sign(pre).",
        },
        "provenance": {
            "date": utc_now(),
            "dataset_version": DATASET_VERSION,
            "filter_definitions": FILTER_DEFINITIONS,
            "bfs": {
                "forward_from": "proboscis_gustatory",
                "backward_from": "mn9 ∪ proboscis_motor",
                "max_depth": MAX_DEPTH,
                "keep": "intersection of both searches, plus seed sets",
            },
            "control_partners": {
                "min_synapses_onto_set": CONTROL_SYNAPSE_MIN,
                "reason": "preserve neurons that may provide inhibitory control onto the core set",
            },
            "cap": {
                "max_neurons": MAX_NEURONS,
                "dropped": int(len(dropped_idx)),
                "policy": "drop weakest-connected first; never drop a seed",
            },
            "neurotransmitters": {
                "key": "PRE-synaptic body",
                "field": "consensus_nt, else predicted_nt",
                "mapping": {
                    "acetylcholine": "+1",
                    "GABA": "-1",
                    "glutamate": "-1",
                    "others_or_unclear": "+1 with nt_uncertain",
                },
                "uncertain_edge_count": n_unc_edges,
                "uncertain_edge_percent": round(pct_unc, 4),
            },
            "path_sign": {
                "definition": (
                    "For each proboscis gustatory seed, the sign of the strongest "
                    "walk of length <= 4 to either MN9, where strength is the product "
                    "of unsigned synapse counts and the sign is the product of NT signs."
                ),
                "status": "inference, not a measurement",
                "reason": (
                    "MaleCNS provides no sugar/bitter receptor annotations "
                    "(no Gr64f / Gr5a / Gr66a). path_sign is not a sweet/bitter label."
                ),
                "distribution": dict(path_dist),
            },
            "source_files": {
                ANNOTATION_FILE: {
                    "path": f"data/raw/{ANNOTATION_FILE}",
                    "sha256": hashes[ANNOTATION_FILE],
                    "rows": int(len(annotations)),
                },
                NT_FILE: {
                    "path": f"data/raw/{NT_FILE}",
                    "sha256": hashes[NT_FILE],
                    "rows": int(len(nt_body)),
                },
                WEIGHT_FILE: {
                    "path": f"data/raw/{WEIGHT_FILE}",
                    "sha256": hashes[WEIGHT_FILE],
                    "rows": int(len(pre)),
                    "columns_used": [pre_col, post_col, w_col],
                },
            },
            "neuron_counts": {
                "weight_table_unique": n_full,
                "forward_reached": int(forward.sum()),
                "backward_reached": int(backward.sum()),
                "final": n,
                "by_role": dict(role_counts),
            },
            "peak_rss_mib": round(peak_rss_mb(), 2),
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bin_path = OUT_DIR / "graph.bin"
    meta_path = OUT_DIR / "graph.meta.json"
    write_csr(bin_path, indptr, indices, data)
    rt_indptr, rt_indices, rt_data = read_csr(bin_path, n, len(data))
    if not (
        np.array_equal(rt_indptr, indptr)
        and np.array_equal(rt_indices, indices)
        and np.allclose(rt_data, data)
    ):
        raise RuntimeError("CSR round-trip failed")
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    log(f"wrote {bin_path} ({bin_path.stat().st_size / 1e6:.1f} MB)")
    log(f"wrote {meta_path}")
    log(f"done, peak RSS {peak_rss_mb():.1f} MiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

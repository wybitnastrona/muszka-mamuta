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
    CORE_CAP,
    CONTROL_SYNAPSE_MIN,
    DATASET_VERSION,
    DERIVED_DIR,
    FILTER_DEFINITIONS,
    GRAPH_BIN_LAYOUT_COMPRESSED,
    GRAPH_BIN_LAYOUT_UNCOMPRESSED,
    GUST_TO_PAM_DEPTH,
    GUST_TO_PAM_DEPTH_FALLBACK,
    INTERSECTION_RANK_MAX,
    KNOWN_GUST_PAM_PATH,
    MAX_DEPTH,
    MAX_NEURONS,
    MN9_BODY_IDS,
    PAM_BODY_IDS,
    PAM_EXTRA_SLOTS,
    NT_FILE,
    OUT_DIR,
    RAW_DIR,
    TARGET_COMPRESSED_BYTES,
    WEIGHT_FILE,
    add_presynaptic_control,
    annotation_prefix_body_ids,
    assign_role,
    bfs_reach,
    build_csr,
    cap_neurons,
    drop_weight_one_edges,
    mask_body_ids,
    max_log_product_to_targets,
    nt_sign,
    nodes_on_paths,
    protect_weight_one_edges,
    read_csr,
    read_csr_compressed,
    resolve_apl,
    resolve_pam,
    resolve_seeds,
    resolve_weight_columns,
    select_intersection_extras,
    sha256_file,
    utc_now,
    write_csr_compressed,
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
        pam_table = resolve_pam(annotations)
        apl_table = resolve_apl(annotations)
    except AssertionError as exc:
        print("SEED ASSERTION FAILED", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

    gust_ids = {int(x) for x in seeds["proboscis_gustatory"]["bodyId"]}
    motor_ids = {int(x) for x in seeds["proboscis_motor"]["bodyId"]}
    mn9_ids = set(MN9_BODY_IDS)
    pam_ids = {int(x) for x in pam_table["bodyId"]}
    apl_ids = {int(x) for x in apl_table["bodyId"]}
    if pam_ids != set(PAM_BODY_IDS):
        print("SEED ASSERTION FAILED", file=sys.stderr)
        print(
            f"PAM bodyIds {sorted(pam_ids)} != verified {sorted(PAM_BODY_IDS)}",
            file=sys.stderr,
        )
        return 1
    seed_ids = gust_ids | motor_ids | pam_ids
    log(
        f"seeds: gustatory={len(gust_ids)} mn9={len(mn9_ids)} "
        f"motor={len(motor_ids)} pam={len(pam_ids)} apl={len(apl_ids)} union={len(seed_ids)}"
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
    pam_idx = map_seeds(pam_ids)
    apl_idx = map_seeds(apl_ids)
    seed_idx = map_seeds(seed_ids)
    log(
        f"seed nodes present in weights: gust={len(gust_idx)} "
        f"motor={len(motor_idx)} pam={len(pam_idx)} apl={len(apl_idx)}"
    )

    log(f"forward BFS from PROBOSCIS_GUSTATORY, max depth {MAX_DEPTH}")
    forward = bfs_reach(gust_idx.tolist(), fwd_indptr, fwd_indices, MAX_DEPTH, n_full)
    log(f"  forward reached {int(forward.sum()):,}")
    log(f"backward BFS from MN9 ∪ PROBOSCIS_MOTOR, max depth {MAX_DEPTH}")
    backward = bfs_reach(motor_idx.tolist(), rev_indptr, rev_indices, MAX_DEPTH, n_full)
    log(f"  backward reached {int(backward.sum()):,}")

    core = forward & backward
    core[seed_idx] = True
    core[gust_idx] = True
    core[motor_idx] = True
    log(f"intersection ∪ gust/motor/PAM seeds-in-graph: {int(core.sum()):,}")
    core_n = int(core.sum())

    log(f"adding neurons with >= {CONTROL_SYNAPSE_MIN} synapses onto the GRN∩MN9 core")
    core = add_presynaptic_control(core, pre_i, post_i, weight, CONTROL_SYNAPSE_MIN)
    log(f"  core after control partners: {int(core.sum()):,}")

    seed_mask = np.zeros(n_full, dtype=bool)
    seed_mask[seed_idx] = True
    core_keep, dropped_core_idx, dropped_core_scores = cap_neurons(
        core, seed_mask, pre_i, post_i, weight, CORE_CAP
    )
    log(
        f"core cap {CORE_CAP}: kept {int(core_keep.sum()):,}, "
        f"dropped {len(dropped_core_idx):,} (feeding-gate carve)"
    )

    pam_back = bfs_reach(
        pam_idx.tolist(), rev_indptr, rev_indices, MAX_DEPTH, n_full
    )
    pam_back[pam_idx] = True
    pam_back_n = int(pam_back.sum())
    log(f"PAM-backward |P|={pam_back_n:,} (depth {MAX_DEPTH})")
    # |I| ≤ |P|. Depth 6 on 151M edges is the requested default; if P is already
    # hundreds of thousands, skip it and use depth 5 so ranking stays tractable.
    fwd_depth = GUST_TO_PAM_DEPTH
    if pam_back_n > INTERSECTION_RANK_MAX:
        fwd_depth = GUST_TO_PAM_DEPTH_FALLBACK
        log(
            f"  |P| exceeds {INTERSECTION_RANK_MAX:,}; using forward depth "
            f"{fwd_depth} instead of {GUST_TO_PAM_DEPTH} (ranking compromise)"
        )
    log(f"gustatory-forward |G| at depth {fwd_depth}")
    g_fwd = bfs_reach(
        gust_idx.tolist(), fwd_indptr, fwd_indices, fwd_depth, n_full
    )
    inter = g_fwd & pam_back
    n_i = int(inter.sum())
    log(
        f"  |G|={int(g_fwd.sum()):,} |P|={pam_back_n:,} |I|={n_i:,} "
        f"(depth_fwd={fwd_depth})"
    )
    if n_i > INTERSECTION_RANK_MAX and fwd_depth != GUST_TO_PAM_DEPTH_FALLBACK:
        log(
            f"  |I| exceeds {INTERSECTION_RANK_MAX:,}; ranking that set is costly. "
            f"Retrying forward BFS at depth {GUST_TO_PAM_DEPTH_FALLBACK}"
        )
        fwd_depth = GUST_TO_PAM_DEPTH_FALLBACK
        g_fwd = bfs_reach(
            gust_idx.tolist(), fwd_indptr, fwd_indices, fwd_depth, n_full
        )
        inter = g_fwd & pam_back
        n_i = int(inter.sum())
        log(
            f"  fallback |G|={int(g_fwd.sum()):,} |I|={n_i:,} (depth_fwd={fwd_depth})"
        )
    if n_i == 0:
        print(
            "STOP: gustatory-forward ∩ PAM-backward is empty at depth "
            f"{fwd_depth}/{MAX_DEPTH}. The gustatory-to-PAM route is not in "
            "MaleCNS at this confidence. Not padding the graph.",
            file=sys.stderr,
        )
        return 1

    log(
        "ranking I by max unsigned-weight product to PAM "
        f"(Bellman–Ford, hops ≤ {MAX_DEPTH}, restricted to I)"
    )
    scores = max_log_product_to_targets(
        pam_idx, pre_i, post_i, weight, MAX_DEPTH, n_full, allowed=inter
    )
    kc_ids_arr = annotation_prefix_body_ids(annotations, "KC")
    mbon_ids_arr = annotation_prefix_body_ids(annotations, "MBON")
    kc_mask = mask_body_ids(node_ids, kc_ids_arr)
    mbon_mask = mask_body_ids(node_ids, mbon_ids_arr)
    apl_in_weights = len(apl_idx) > 0
    # APL is in MaleCNS (2 GABA cells) and is always forced into keep.
    # Adding them was not enough, and excluding ^KC alone still left a
    # post-cut rise. Extra slots exclude ^KC and ^MBON.
    exclude = kc_mask | mbon_mask
    # Extra 10k abandoned: extras ignited an unphysiological loop; PAM
    # activity in I was inseparable from it. PAM_EXTRA_SLOTS is 0.
    extra_policy = "extras disabled (unphysiological MB/PAM loop; restored 20k feeding gate)"
    if apl_in_weights:
        extra_policy += "; APL still annotated in weights (not forced; extras unused)"
        log(
            f"APL present in weight table: bodyIds={sorted(int(x) for x in node_ids[apl_idx])}. "
            f"Not adding extras. {int(kc_mask.sum()):,} ^KC and {int(mbon_mask.sum()):,} ^MBON in the weight table."
        )
    else:
        extra_policy += "; APL absent from weights"
        log("APL not in weight table. Extra slots are 0.")
    n_apl_new = int((~core_keep[apl_idx]).sum()) if len(apl_idx) else 0
    extra_slots = max(0, PAM_EXTRA_SLOTS - n_apl_new)
    extras, n_cand = select_intersection_extras(
        inter, core_keep, scores, extra_slots, exclude=exclude
    )
    extras_n = int(extras.sum())
    if n_cand <= extra_slots:
        log(
            f"  candidates in I minus core (after exclude): {n_cand:,} — taking all "
            f"(slots={extra_slots})"
        )
    else:
        log(
            f"  candidates in I minus core (after exclude): {n_cand:,} — taking top "
            f"{extras_n:,} by path strength to PAM (slots={extra_slots})"
        )

    keep = core_keep | extras
    keep[seed_idx] = True
    # Do not force APL into the 20k feeding gate: adding them on a 30k extract
    # did not hold the KC sheet, and extras are now unused.
    if PAM_EXTRA_SLOTS > 0 and len(apl_idx):
        keep[apl_idx] = True
        log(f"  forced {len(apl_idx)} APL cell(s) into keep")
    elif len(apl_idx):
        log(
            f"  APL in weights (n={len(apl_idx)}) not forced into keep "
            "(extras disabled; 20k feeding gate)"
        )
    kc_in_keep = int((keep & kc_mask).sum())
    mbon_in_keep = int((keep & mbon_mask).sum())
    log(f"  retained ^KC={kc_in_keep:,} ^MBON={mbon_in_keep:,} APL={len(apl_idx)}")
    pam_slots = int((keep & ~core_keep).sum())
    log(
        f"keep = {CORE_CAP}-core ∪ {pam_slots:,} intersection extras "
        f"(no control partners on the extra set); total {int(keep.sum()):,}"
    )
    dropped_idx = dropped_core_idx
    dropped_scores = dropped_core_scores
    pam_back_n = int(pam_back.sum())
    if len(dropped_idx):
        dropped_ids = node_ids[dropped_idx]
        log(
            f"core cap {CORE_CAP}: dropped {len(dropped_idx):,} weakest-connected "
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
                    "core_cap": CORE_CAP,
                    "core_dropped": int(len(dropped_core_idx)),
                    "final_cap": MAX_NEURONS,
                    "intersection_size": n_i,
                    "forward_depth": fwd_depth,
                    "candidates_in_I_minus_core": n_cand,
                    "pam_slots_filled": pam_slots,
                    "apl_bodyIds": [int(x) for x in node_ids[apl_idx]] if len(apl_idx) else [],
                    "extra_policy": extra_policy,
                    "not_selected_from_I": int(n_cand - extras_n),
                    "bodyId_preview": [int(x) for x in dropped_ids[:25]],
                    "note": (
                        "Extra 10k are G(depth≤6, fallback 5) ∩ P(depth≤4), "
                        "ranked by path strength to PAM. APL is forced in when "
                        "present so ^KC can stay; otherwise ^KC is excluded."
                    ),
                }
            )
            + "\n",
            encoding="utf-8",
        )
        log(f"  wrote {drop_path}")
    else:
        log(f"no core cap needed ({int(core_keep.sum()):,} <= {CORE_CAP})")

    del fwd_indptr, fwd_indices, rev_indptr, rev_indices

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

    log("gustatory→PAM on-path mask in the extracted neuron set (pre-trim)")
    tmp_indptr, tmp_indices, _ = build_csr(src, dst, None, n)
    tmp_rev_indptr, tmp_rev_indices, _ = build_csr(dst, src, None, n)
    gust_local = [i for i, bid in enumerate(graph_ids) if int(bid) in gust_ids]
    pam_local = [i for i, bid in enumerate(graph_ids) if int(bid) in pam_ids]
    on_path_nodes, hops_final = nodes_on_paths(
        gust_local,
        pam_local,
        tmp_indptr,
        tmp_indices,
        tmp_rev_indptr,
        tmp_rev_indices,
        np.ones(n, dtype=bool),
        n,
    )
    del tmp_indptr, tmp_indices, tmp_rev_indptr, tmp_rev_indices
    protect = protect_weight_one_edges(src, dst, graph_ids, on_path_nodes)
    n_w1 = int(np.isclose(mag.astype(np.float64), 1.0).sum())
    n_w1_protected = int((np.isclose(mag.astype(np.float64), 1.0) & protect).sum())
    log(
        f"  on-path neurons={int(on_path_nodes.sum()):,} hops={hops_final}; "
        f"weight-1 edges={n_w1:,} of which protected={n_w1_protected:,}"
    )
    trim_mask = drop_weight_one_edges(src, dst, mag, protect)
    n_trim = int((~trim_mask).sum())
    log(
        f"  weight-1 trim candidates (not on a gustatory→PAM path): {n_trim:,}"
    )

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
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)
    bin_path = OUT_DIR / "graph.bin"
    write_csr_compressed(bin_path, indptr, indices, data)
    compressed_size = int(bin_path.stat().st_size)
    weight1_dropped = 0
    if compressed_size >= TARGET_COMPRESSED_BYTES and n_trim > 0:
        log(
            f"compressed {compressed_size:,} bytes ≥ 20 MiB target; "
            f"dropping {n_trim:,} unprotected weight-1 edges "
            f"(keeping on-path + {KNOWN_GUST_PAM_PATH} PhG4→SLP234→PAM10)"
        )
        src, dst, mag = src[trim_mask], dst[trim_mask], mag[trim_mask]
        weight1_dropped = n_trim
        pre_bodies = graph_ids[src]
        pre_sign, pre_unc = lookup_nt(pre_bodies, nt_body, nt_signs, nt_unc)
        signed = mag * pre_sign.astype(np.float32)
        n_unc_edges = int(pre_unc.sum())
        pct_unc = 100.0 * n_unc_edges / len(signed) if len(signed) else 0.0
        indptr, indices, data = build_csr(src, dst, signed, n)
        tmp_indptr, tmp_indices, _ = build_csr(src, dst, None, n)
        tmp_rev_indptr, tmp_rev_indices, _ = build_csr(dst, src, None, n)
        on_path_nodes, hops_final = nodes_on_paths(
            gust_local,
            pam_local,
            tmp_indptr,
            tmp_indices,
            tmp_rev_indptr,
            tmp_rev_indices,
            np.ones(n, dtype=bool),
            n,
        )
        del tmp_indptr, tmp_indices, tmp_rev_indptr, tmp_rev_indices
        write_csr_compressed(bin_path, indptr, indices, data)
        compressed_size = int(bin_path.stat().st_size)
        if compressed_size >= TARGET_COMPRESSED_BYTES:
            log(
                f"WARNING: still {compressed_size:,} bytes after weight-1 trim; "
                "on-path edges were not dropped"
            )
    elif compressed_size >= TARGET_COMPRESSED_BYTES:
        log(
            f"WARNING: compressed {compressed_size:,} bytes ≥ 20 MiB and "
            "there are no unprotected weight-1 edges to drop"
        )
    on_path_final_n = int(on_path_nodes.sum())
    log(
        f"final graph gustatory→PAM: {on_path_final_n:,} neurons on a path; "
        f"shortest hops={hops_final}; PAM in graph={len(pam_local)}; "
        f"compressed={compressed_size:,} bytes; weight-1 dropped={weight1_dropped:,}"
    )

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

    kc_local = np.array(
        [i for i, t in enumerate(types) if t is not None and t.startswith("KC")],
        dtype=np.int64,
    )
    apl_local = np.array(
        [i for i, bid in enumerate(graph_ids) if int(bid) in apl_ids],
        dtype=np.int64,
    )
    apl_onto_kc_edges = 0
    apl_onto_kc_syn = 0.0
    if len(apl_local) and len(kc_local) and len(src):
        hit = np.isin(src, apl_local) & np.isin(dst, kc_local)
        apl_onto_kc_edges = int(hit.sum())
        apl_onto_kc_syn = float(mag[hit].sum())
    log(
        f"APL → retained KC: {apl_onto_kc_edges:,} edges, "
        f"{apl_onto_kc_syn:.0f} synapses (unsigned count); "
        f"APL n={len(apl_local)} KC n={len(kc_local)}"
    )

    log("skipping per-seed path_sign (deprecated; previously hung extract)")
    path_signs: list[int | None] = [None] * n
    path_dist: Counter[str] = Counter({"none": len(gust_ids), "+1": 0, "-1": 0})
    print("path_sign_deprecated: all null (not recomputed)")

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
    print(f"|I| gustatory-forward ∩ PAM-backward: {n_i:,} (depth_fwd={fwd_depth})")
    print(f"I minus core (candidates): {n_cand:,}; extras kept: {extras_n:,}")
    print(f"extra policy: {extra_policy}")
    print(
        f"APL → KC: {apl_onto_kc_edges:,} edges / {apl_onto_kc_syn:.0f} synapses; "
        f"retained KC={len(kc_local)} APL={len(apl_local)}"
    )
    print(f"gustatory→PAM path neurons (final): {on_path_final_n:,}; hops={hops_final}")
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
        "path_sign_deprecated": path_signs,
        "nt_uncertain": [bool(x) for x in neuron_unc],
        "graph_bin": {
            "path": "graph.bin",
            "layout": GRAPH_BIN_LAYOUT_COMPRESSED,
            "audit_uncompressed": {
                "path": "data/derived/feeding-circuit-graph.uncompressed.bin",
                "layout": GRAPH_BIN_LAYOUT_UNCOMPRESSED,
            },
            "indptr_count": n + 1,
            "indices_count": int(len(data)),
            "weights_count": int(len(data)),
            "note": "indices are positions into bodyId. signed weight = synapse_count * NT_sign(pre). Rows are sorted by target at encode time; LIF is order-independent.",
        },
        "provenance": {
            "date": utc_now(),
            "dataset_version": DATASET_VERSION,
            "filter_definitions": FILTER_DEFINITIONS,
            "bfs": {
                "forward_from": "proboscis_gustatory",
                "backward_from": "mn9 ∪ proboscis_motor",
                "backward_pam_from": "19 PAM bodyIds present in the prior subgraph",
                "max_depth": MAX_DEPTH,
                "gustatory_to_pam_forward_depth": fwd_depth,
                "gustatory_to_pam_forward_depth_requested": GUST_TO_PAM_DEPTH,
                "gustatory_to_pam_forward_depth_fallback": GUST_TO_PAM_DEPTH_FALLBACK,
                "keep": (
                    "feeding-gate: gustatory-forward ∩ motor-backward depth 4, "
                    "plus seeds and control partners, capped at 20k; extra slots: "
                    "G(gustatory-forward depth 6, fallback 5) ∩ P(PAM-backward depth 4), "
                    "ranked by max unsigned-weight product to PAM. "
                    "Not the PAM-backward union."
                ),
                "pam_backward_reached": pam_back_n,
                "core_intersection_union_seeds": core_n,
                "intersection_size": n_i,
                "intersection_minus_core": n_cand,
                "gustatory_to_pam": {
                    "neurons_on_path_final": on_path_final_n,
                    "shortest_hops_final": hops_final,
                    "known_path_bodyIds": list(KNOWN_GUST_PAM_PATH),
                },
            },
            "control_partners": {
                "min_synapses_onto_set": CONTROL_SYNAPSE_MIN,
                "applied_to": "feeding-gate core only, not the extra 10k",
                "reason": "preserve neurons that may provide inhibitory control onto the core set",
            },
            "cap": {
                "max_neurons": MAX_NEURONS,
                "core_cap": CORE_CAP,
                "core_dropped": int(len(dropped_core_idx)),
                "pam_slots_filled": pam_slots,
                "extra_policy": extra_policy,
                "policy": (
                    "Cap GRN∩MN9 core to 20k (never drop seeds). Extra 10k from "
                    "I = G ∩ P is disabled: PAM activity in that subgraph was "
                    "inseparable from an unphysiological loop (KC sheet without "
                    "working APL, then extra PAM-type cells). Shipped graph is "
                    "the 20k feeding gate."
                ),
            },
            "apl": {
                "annotated_bodyIds": sorted(apl_ids),
                "in_weight_table": [int(x) for x in node_ids[apl_idx]] if len(apl_idx) else [],
                "in_final_graph": [int(graph_ids[i]) for i in apl_local],
                "onto_retained_kc_edges": apl_onto_kc_edges,
                "onto_retained_kc_synapses": apl_onto_kc_syn,
                "retained_kc": int(len(kc_local)),
                "neurotransmitter": "GABA (consensus_nt; sign -1)",
            },
            "size": {
                "target_compressed_bytes": TARGET_COMPRESSED_BYTES,
                "compressed_bytes": compressed_size,
                "weight1_dropped": weight1_dropped,
                "weight1_trim_candidates": n_trim,
                "note": (
                    "If compressed ≥ 20 MiB, drop edges with unsigned synapse "
                    "count 1 that are not on a gustatory→PAM walk. The measured "
                    "PhG4→SLP234→PAM10 path may itself be weight-1 and is protected."
                ),
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
            "path_sign_deprecated": {
                "status": "not recomputed",
                "reason": (
                    "path_sign was tested and rejected (validate_per.ts 2026-09-16). "
                    "Per-seed walks hung extract; metadata keeps a null array."
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
                "pam_backward_reached": pam_back_n,
                "intersection_size": n_i,
                "intersection_minus_core": n_cand,
                "extras_kept": extras_n,
                "final": n,
                "by_role": dict(role_counts),
            },
            "peak_rss_mib": round(peak_rss_mb(), 2),
        },
    }

    meta_path = OUT_DIR / "graph.meta.json"
    audit_path = DERIVED_DIR / "feeding-circuit-graph.uncompressed.bin"
    write_csr(audit_path, indptr, indices, data)
    rt_indptr, rt_indices, rt_data = read_csr(audit_path, n, len(data))
    if not (
        np.array_equal(rt_indptr, indptr)
        and np.array_equal(rt_indices, indices)
        and np.allclose(rt_data, data)
    ):
        raise RuntimeError("uncompressed CSR round-trip failed")
    write_csr_compressed(bin_path, indptr, indices, data)
    c_indptr, c_indices, c_data = read_csr_compressed(bin_path, n, len(data))
    if not np.array_equal(c_indptr, indptr):
        raise RuntimeError("compressed CSR indptr round-trip failed")
    for i in range(n):
        a, b = int(indptr[i]), int(indptr[i + 1])
        order = np.argsort(indices[a:b], kind="stable")
        if not np.array_equal(c_indices[a:b], indices[a:b][order]):
            raise RuntimeError(f"compressed CSR indices mismatch at row {i}")
        if not np.allclose(c_data[a:b], np.asarray(data[a:b][order], dtype="<f2").astype(np.float32)):
            raise RuntimeError(f"compressed CSR weights mismatch at row {i}")
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    log(f"wrote audit {audit_path} ({audit_path.stat().st_size / 1e6:.1f} MB)")
    log(f"wrote {bin_path} ({bin_path.stat().st_size / 1e6:.1f} MB)")
    log(f"wrote {meta_path}")
    log(f"done, peak RSS {peak_rss_mb():.1f} MiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

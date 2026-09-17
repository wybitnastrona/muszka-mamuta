"""Synthetic tests for the MaleCNS feeding-circuit extractor."""

from __future__ import annotations

import numpy as np
from scipy import sparse

from feeding import (
    PAM_BODY_IDS,
    add_presynaptic_control,
    bfs_reach,
    build_csr,
    cap_neurons,
    nodes_on_paths,
    nt_sign,
    read_csr,
    read_csr_compressed,
    resolve_pam,
    strongest_path_sign,
    write_csr,
    write_csr_compressed,
)


def test_nt_sign_mapping():
    assert nt_sign("acetylcholine") == (1, False)
    assert nt_sign("GABA") == (-1, False)
    assert nt_sign("gaba") == (-1, False)
    assert nt_sign("glutamate") == (-1, False)
    assert nt_sign("dopamine") == (1, True)
    assert nt_sign("histamine") == (1, True)
    assert nt_sign("unclear") == (1, True)
    assert nt_sign(None) == (1, True)
    assert nt_sign("") == (1, True)


def test_csr_round_trip(tmp_path):
    sources = np.array([0, 0, 1, 2, 2], dtype=np.int64)
    targets = np.array([1, 2, 2, 0, 1], dtype=np.int64)
    weights = np.array([1.5, -2.0, 3.0, 4.0, -5.0], dtype=np.float32)
    indptr, indices, data = build_csr(sources, targets, weights, n_nodes=3)
    path = tmp_path / "graph.bin"
    write_csr(path, indptr, indices, data)
    rt_indptr, rt_indices, rt_data = read_csr(path, n_nodes=3, n_edges=5)
    assert np.array_equal(rt_indptr, indptr)
    assert np.array_equal(rt_indices, indices)
    assert np.allclose(rt_data, data)

    matrix = sparse.csr_matrix((rt_data, rt_indices, rt_indptr), shape=(3, 3))
    assert matrix.shape == (3, 3)
    assert matrix[0, 1] == np.float32(1.5)
    assert matrix[0, 2] == np.float32(-2.0)
    assert matrix[2, 1] == np.float32(-5.0)
    assert matrix.nnz == 5


def test_csr_compressed_round_trip(tmp_path):
    sources = np.array([0, 0, 1, 2, 2], dtype=np.int64)
    targets = np.array([2, 1, 2, 0, 1], dtype=np.int64)
    weights = np.array([1.5, -2.0, 3.0, 4.0, -5.0], dtype=np.float32)
    indptr, indices, data = build_csr(sources, targets, weights, n_nodes=3)
    path = tmp_path / "graph.bin"
    write_csr_compressed(path, indptr, indices, data)
    rt_indptr, rt_indices, rt_data = read_csr_compressed(path, n_nodes=3, n_edges=5)
    assert np.array_equal(rt_indptr, indptr)
    for i in range(3):
        a, b = int(indptr[i]), int(indptr[i + 1])
        order = np.argsort(indices[a:b], kind="stable")
        assert np.array_equal(rt_indices[a:b], indices[a:b][order])
        expect_w = np.asarray(data[a:b][order], dtype="<f2").astype(np.float32)
        assert np.allclose(rt_data[a:b], expect_w)


def test_bfs_depth_limit():
    # 0 -> 1 -> 2 -> 3 -> 4 -> 5
    sources = np.array([0, 1, 2, 3, 4], dtype=np.int64)
    targets = np.array([1, 2, 3, 4, 5], dtype=np.int64)
    weights = np.ones(5, dtype=np.float32)
    indptr, indices, _ = build_csr(sources, targets, weights, n_nodes=6)
    reached = bfs_reach([0], indptr, indices, max_depth=4, n_nodes=6)
    assert reached.tolist() == [True, True, True, True, True, False]


def test_pam_backward_union_adds_inputs_outside_mn9_intersection():
    """Gust 0→1→MN9 2. PAM 4←3←0. Node 3 is a PAM input not on the MN9 path."""
    sources = np.array([0, 1, 0, 3], dtype=np.int64)
    targets = np.array([1, 2, 3, 4], dtype=np.int64)
    indptr, indices, _ = build_csr(sources, targets, None, n_nodes=5)
    rev_indptr, rev_indices, _ = build_csr(targets, sources, None, n_nodes=5)
    forward = bfs_reach([0], indptr, indices, max_depth=4, n_nodes=5)
    backward = bfs_reach([2], rev_indptr, rev_indices, max_depth=4, n_nodes=5)
    core = forward & backward
    pam_back = bfs_reach([4], rev_indptr, rev_indices, max_depth=4, n_nodes=5)
    keep = core | pam_back
    assert core.tolist() == [True, True, True, False, False]
    assert keep.tolist() == [True, True, True, True, True]
    assert int((pam_back & ~core).sum()) == 2
    on_path, hops = nodes_on_paths(
        [0], [4], indptr, indices, rev_indptr, rev_indices, keep, 5
    )
    assert hops == 2
    assert on_path.tolist() == [True, False, False, True, True]


def test_resolve_pam_accepts_verified_ids():
    import pandas as pd

    rows = [{"bodyId": bid, "type": "PAM10"} for bid in sorted(PAM_BODY_IDS)]
    frame = pd.DataFrame(rows)
    out = resolve_pam(frame)
    assert len(out) == 19


def test_resolve_pam_stops_on_wrong_type():
    import pandas as pd

    rows = [{"bodyId": bid, "type": "PAM10"} for bid in sorted(PAM_BODY_IDS)]
    rows[0]["type"] = "MBON01"
    frame = pd.DataFrame(rows)
    try:
        resolve_pam(frame)
    except AssertionError as exc:
        assert "PAM*" in str(exc)
    else:
        raise AssertionError("expected AssertionError")


def test_resolve_apl_from_type():
    import pandas as pd
    from feeding import resolve_apl

    frame = pd.DataFrame(
        [
            {"bodyId": 10540, "type": "APL"},
            {"bodyId": 10977, "type": "APL"},
            {"bodyId": 1, "type": "KC"},
        ]
    )
    out = resolve_apl(frame)
    assert list(out["bodyId"]) == [10540, 10977]


def test_resolve_apl_empty_when_absent():
    import pandas as pd
    from feeding import resolve_apl

    frame = pd.DataFrame([{"bodyId": 1, "type": "PAM10"}])
    out = resolve_apl(frame)
    assert len(out) == 0


def test_extras_exclude_kc_prefix_mask():
    from feeding import select_intersection_extras

    inter = np.array([True, True, True, True, True])
    core = np.array([True, False, False, False, True])
    scores = np.array([0.0, 9.0, 8.0, 1.0, 0.0])
    # index 1 is a KC hub — strongest, but excluded
    exclude = np.array([False, True, False, False, False])
    extras, n_cand = select_intersection_extras(inter, core, scores, extra_slots=1, exclude=exclude)
    assert n_cand == 2
    assert extras[2] and not extras[1]


def test_cap_never_drops_a_seed():
    keep = np.ones(5, dtype=bool)
    seed = np.array([True, True, False, False, False])
    # Node 0,1 are weakly connected seeds; 2 is weakest extra; 3 medium; 4 strongest.
    sources = np.array([0, 1, 2, 3, 4, 0], dtype=np.int64)
    targets = np.array([1, 0, 0, 0, 0, 4], dtype=np.int64)
    weights = np.array([1, 1, 1, 50, 500, 500], dtype=np.int64)
    new_keep, dropped, scores = cap_neurons(
        keep, seed, sources, targets, weights, max_neurons=3
    )
    assert int(new_keep.sum()) == 3
    assert new_keep[0] and new_keep[1]
    assert not new_keep[2]
    assert 2 in set(dropped.tolist())
    assert 0 not in set(dropped.tolist())
    assert 1 not in set(dropped.tolist())
    assert len(scores) == len(dropped)


def test_gustatory_pam_intersection_is_empty_when_no_route():
    """Gust 0→1. PAM 3 has no path from taste. I must be empty — do not pad."""
    sources = np.array([0], dtype=np.int64)
    targets = np.array([1], dtype=np.int64)
    indptr, indices, _ = build_csr(sources, targets, None, n_nodes=4)
    rev_indptr, rev_indices, _ = build_csr(targets, sources, None, n_nodes=4)
    from feeding import gustatory_pam_intersection

    inter, _g, _p, n_i = gustatory_pam_intersection(
        np.array([0]),
        np.array([3]),
        indptr,
        indices,
        rev_indptr,
        rev_indices,
        4,
        forward_depth=6,
    )
    assert n_i == 0
    assert not inter.any()


def test_intersection_ranking_prefers_taste_path_not_strong_pam_listener():
    """Hub 3→PAM is a strong listener but not on a gustatory path. Do not pick it.

    0 (gust) -2→ 1 -2→ 4 (PAM)   product 4
    0 (gust) -1→ 2 -1→ 4 (PAM)   product 1
    3 -100→ 4                   off-path PAM input
    Core already has gust+PAM. Extra slot = 1. Winner is 1, not 2 or 3.
    """
    from feeding import max_log_product_to_targets, select_intersection_extras

    sources = np.array([0, 1, 0, 2, 3], dtype=np.int64)
    targets = np.array([1, 4, 2, 4, 4], dtype=np.int64)
    weights = np.array([2, 2, 1, 1, 100], dtype=np.float32)
    n = 5
    indptr, indices, _ = build_csr(sources, targets, None, n_nodes=n)
    rev_indptr, rev_indices, _ = build_csr(targets, sources, None, n_nodes=n)
    from feeding import gustatory_pam_intersection

    inter, _g, _p, n_i = gustatory_pam_intersection(
        np.array([0]),
        np.array([4]),
        indptr,
        indices,
        rev_indptr,
        rev_indices,
        n,
        forward_depth=6,
    )
    assert n_i == 4  # 0,1,2,4 — not 3
    assert not inter[3]
    scores = max_log_product_to_targets(
        [4], sources, targets, weights, max_depth=4, n_nodes=n, allowed=inter
    )
    core = np.array([True, False, False, False, True])
    extras, n_cand = select_intersection_extras(inter, core, scores, extra_slots=1)
    assert n_cand == 2  # nodes 1 and 2
    assert extras[1] and not extras[2] and not extras[3]


def test_intersection_takes_all_when_under_slot_cap():
    from feeding import pick_top_scored

    mask = np.array([False, True, True, True, False])
    scores = np.array([0.0, 1.0, 3.0, 2.0, 9.0])
    out = pick_top_scored(mask, scores, k=10_000)
    assert out.tolist() == [False, True, True, True, False]


def test_path_strength_is_weight_product_not_degree():
    from feeding import max_log_product_to_targets

    # 0 -10→ 1 -10→ 2(PAM). 0 -2→ 3 -2→ 2. Node 1 outranks 3.
    sources = np.array([0, 1, 0, 3], dtype=np.int64)
    targets = np.array([1, 2, 3, 2], dtype=np.int64)
    weights = np.array([10, 10, 2, 2], dtype=np.float32)
    scores = max_log_product_to_targets(
        [2], sources, targets, weights, max_depth=4, n_nodes=4
    )
    assert scores[2] == 0.0
    assert scores[1] > scores[3]
    assert np.isclose(scores[1], np.log(10.0))
    assert np.isclose(scores[3], np.log(2.0))
    assert np.isclose(scores[0], np.log(100.0))


def test_weight_one_trim_skips_on_path_and_known_thin_path():
    """Drop noise weight-1 edges; keep on-path and PhG4→SLP234→PAM10."""
    from feeding import (
        KNOWN_GUST_PAM_PATH,
        drop_weight_one_edges,
        protect_weight_one_edges,
    )

    phg4, slp, pam = KNOWN_GUST_PAM_PATH
    graph_ids = np.array([phg4, slp, pam, 99], dtype=np.int64)
    # local: 0=PhG4, 1=SLP234, 2=PAM10, 3=noise
    src = np.array([0, 1, 3], dtype=np.int64)
    dst = np.array([1, 2, 2], dtype=np.int64)
    mag = np.array([1, 1, 1], dtype=np.float32)
    on_path = np.array([True, True, True, False])
    protect = protect_weight_one_edges(src, dst, graph_ids, on_path)
    keep = drop_weight_one_edges(src, dst, mag, protect)
    assert keep[0] and keep[1], "thin gustatory→PAM path must survive weight-1 trim"
    assert not keep[2], "off-path weight-1 edge is noise"


def test_second_stage_cap_keeps_weak_pam_inputs_when_core_is_protected():
    """Replaced: extra slots come from I ranked by path strength, not degree."""
    from feeding import max_log_product_to_targets, select_intersection_extras

    # 0,1 = dense core (gust, MN9). 2 = PAM. 3 = weak on-path. 4,5 = off-path hubs.
    sources = np.array([0, 3, 4, 5], dtype=np.int64)
    targets = np.array([3, 2, 2, 2], dtype=np.int64)
    weights = np.array([2, 2, 400, 400], dtype=np.float32)
    inter = np.array([True, False, True, True, False, False])
    core_keep = np.array([True, True, True, False, False, False])
    scores = max_log_product_to_targets(
        [2], sources, targets, weights, max_depth=4, n_nodes=6, allowed=inter
    )
    extras, n_cand = select_intersection_extras(inter, core_keep, scores, extra_slots=1)
    assert n_cand == 1
    assert extras[3]
    assert not extras[4] and not extras[5]


def test_presynaptic_control_threshold():
    keep = np.array([True, True, False, False])
    sources = np.array([2, 2, 3], dtype=np.int64)
    targets = np.array([0, 1, 0], dtype=np.int64)
    weights = np.array([3, 3, 4], dtype=np.int64)
    # node 2 has 6 synapses onto the set; node 3 has 4 (< 5)
    out = add_presynaptic_control(keep, sources, targets, weights, min_synapses=5)
    assert out.tolist() == [True, True, True, False]


def test_path_sign_strongest_walk_hand_checked():
    """Toy graph, signs and magnitudes checked by hand.

    0 (gust) --(+10)--> 1 --(+10)--> 3 (MN9)     product 100, sign +
    0 (gust) --(-100)-> 2 --(+3)-->  3 (MN9)     product 300, sign -
    Strongest walk is the inhibitory one: path_sign = -1.
    """
    sources = np.array([0, 1, 0, 2], dtype=np.int64)
    targets = np.array([1, 3, 2, 3], dtype=np.int64)
    weights = np.array([10.0, 10.0, -100.0, 3.0], dtype=np.float32)
    indptr, indices, data = build_csr(sources, targets, weights, n_nodes=4)
    sign = strongest_path_sign(indptr, indices, data, source=0, targets={3}, max_depth=4)
    assert sign == -1


def test_path_sign_respects_depth_limit():
    """A 5-hop heavy walk must lose to a 1-hop light walk when max_depth is 4."""
    # 0 -> 1 -> 2 -> 3 -> 4 -> 5  (weights 10 each, 5 hops)
    # 0 -> 5                     (weight 1)
    sources = np.array([0, 1, 2, 3, 4, 0], dtype=np.int64)
    targets = np.array([1, 2, 3, 4, 5, 5], dtype=np.int64)
    weights = np.array([10, 10, 10, 10, 10, 1], dtype=np.float32)
    indptr, indices, data = build_csr(sources, targets, weights, n_nodes=6)
    sign = strongest_path_sign(indptr, indices, data, source=0, targets={5}, max_depth=4)
    assert sign == 1
    sign_deep = strongest_path_sign(
        indptr, indices, data, source=0, targets={5}, max_depth=5
    )
    assert sign_deep == 1  # all-positive; both walks +.
    # Flip the long walk negative at the last edge; with depth 5 it should win.
    weights_neg = np.array([10, 10, 10, 10, -10, 1], dtype=np.float32)
    indptr, indices, data = build_csr(sources, targets, weights_neg, n_nodes=6)
    assert strongest_path_sign(indptr, indices, data, 0, {5}, max_depth=4) == 1
    assert strongest_path_sign(indptr, indices, data, 0, {5}, max_depth=5) == -1

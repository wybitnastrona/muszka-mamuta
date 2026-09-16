"""Synthetic tests for the MaleCNS feeding-circuit extractor."""

from __future__ import annotations

import numpy as np
from scipy import sparse

from feeding import (
    add_presynaptic_control,
    bfs_reach,
    build_csr,
    cap_neurons,
    nt_sign,
    read_csr,
    read_csr_compressed,
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

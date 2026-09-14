import numpy as np

from pipeline.hubs import hub_scores


def test_flags_uniform_hub_and_caps_outliers():
    # Orthogonal ordinary vectors have low mean similarity; the uniform vector is a hub.
    vectors = np.vstack([np.tile(np.eye(100), (10, 1)), np.ones(100) / 10])
    means, flagged, summary = hub_scores(vectors)
    assert flagged.tolist() == [1000]
    assert means[1000] > summary["threshold"]
    assert summary["flaggedVectors"] <= len(vectors) * 0.005
    assert sum(summary["histogram"]["counts"]) == len(vectors)


def test_sampling_is_repeatable_and_matches_pairwise_cosines():
    vectors = np.random.default_rng(3).normal(size=(200, 16))
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    means, flags, summary = hub_scores(vectors, sample_size=40)
    sample = np.random.default_rng(20260908).choice(len(vectors), 40, replace=False)
    np.testing.assert_allclose(means, (vectors @ vectors[sample].T).mean(axis=1), atol=1e-8)
    np.testing.assert_array_equal(flags, hub_scores(vectors, sample_size=40)[1])
    assert summary["sampleSize"] == 40


def test_empty_and_constant_distributions_have_no_hubs():
    for vectors in (np.empty((0, 4)), np.ones((500, 4)) / 2):
        assert len(hub_scores(vectors)[1]) == 0

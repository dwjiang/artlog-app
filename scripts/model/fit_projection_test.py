import numpy as np
import pytest

import fit_projection
from export_coreml import EMBEDDING_DIM, SUMMARY_DIM, WHITEN_POWER


def unit_vectors(count, seed):
    rng = np.random.default_rng(seed)
    # Decaying per-axis spread gives the principal components a well-defined order.
    vectors = rng.standard_normal((count, SUMMARY_DIM)) * np.geomspace(1, 0.01, SUMMARY_DIM)
    return (vectors / np.linalg.norm(vectors, axis=1, keepdims=True)).astype(np.float32)


def test_projected_components_are_centered_and_root_whitened():
    vectors = unit_vectors(4000, seed=1)
    mean, matrix, explained = fit_projection.fit(vectors)

    assert mean.shape == (SUMMARY_DIM,) and matrix.shape == (SUMMARY_DIM, EMBEDDING_DIM)
    projected = (vectors.astype(np.float64) - mean) @ matrix
    np.testing.assert_allclose(projected.mean(axis=0), 0, atol=1e-6)
    # Component variance λ becomes λ^(1 - WHITEN_POWER): still decreasing, but compressed.
    variance = projected.var(axis=0, ddof=1)
    assert np.all(np.diff(variance) <= 1e-9)
    directions = matrix / np.linalg.norm(matrix, axis=0)
    np.testing.assert_allclose(directions.T @ directions, np.eye(EMBEDDING_DIM), atol=1e-4)
    eigenvalues = (np.linalg.norm(matrix, axis=0) ** (-2 / WHITEN_POWER))
    np.testing.assert_allclose(variance, eigenvalues ** (1 - WHITEN_POWER), rtol=1e-3)
    assert 0 < explained <= 1


def test_refits_agree_despite_eigenvector_sign_freedom():
    vectors = unit_vectors(3000, seed=2)
    _, first, _ = fit_projection.fit(vectors)
    _, second, _ = fit_projection.fit(vectors[::-1].copy())
    np.testing.assert_allclose(first, second, atol=1e-4)


def test_fit_refuses_too_few_or_wrong_width_vectors():
    with pytest.raises(ValueError):
        fit_projection.fit(unit_vectors(SUMMARY_DIM, seed=3))
    with pytest.raises(ValueError):
        fit_projection.fit(np.ones((4000, 8), dtype=np.float32))

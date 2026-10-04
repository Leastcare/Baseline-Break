"""
algorithms/persistence.py
──────────────────────────
Checks whether an unusual signal has *persisted* across multiple
consecutive recent observations — the key false-alarm protection.

One noisy point is not enough to trigger a break alert.
Multiple consecutive unusual points strengthen the case significantly.
"""

from dataclasses import dataclass
from algorithms.baseline import Baseline
from algorithms.anomaly import score as anomaly_score


@dataclass
class PersistenceResult:
    consecutive_unusual:  int     # how many recent points are unusual
    window_checked:       int     # total points examined
    required:             int     # how many needed to confirm break
    confirmed:            bool    # True if consecutive >= required
    recent_scores:        list    # [(value, abs_score), ...] newest first
    last_direction:       str     # 'above' / 'below' / 'normal'


def check(
    recent_observations: list[dict],
    baseline: Baseline,
    threshold: float = 3.5,
    required_consecutive: int = 3,
    window: int = 10,
) -> PersistenceResult:
    """
    Evaluate whether the most-recent observations show a persistent break.

    Args:
        recent_observations: list of normalised observation dicts,
                             SORTED oldest → newest
        baseline:            Baseline for this site
        threshold:           anomaly score threshold
        required_consecutive: how many consecutive unusual points needed
        window:              how many recent points to examine

    Returns:
        PersistenceResult
    """
    # Take the most recent `window` points (newest first)
    candidates = recent_observations[-window:][::-1]

    recent_scores = []
    consecutive   = 0
    last_direction = "normal"

    for obs in candidates:
        val = obs.get("value")
        if val is None:
            break   # gap in data — stop counting

        s = anomaly_score(val, baseline, threshold)
        recent_scores.append((round(val, 3), round(s.abs_score, 3)))

        if s.is_anomalous:
            consecutive    += 1
            last_direction  = s.direction
        else:
            break   # streak broken — stop counting

    return PersistenceResult(
        consecutive_unusual=consecutive,
        window_checked=len(candidates),
        required=required_consecutive,
        confirmed=consecutive >= required_consecutive,
        recent_scores=recent_scores[:5],   # show up to 5 for UI
        last_direction=last_direction,
    )

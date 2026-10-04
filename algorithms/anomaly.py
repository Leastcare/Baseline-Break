"""
algorithms/anomaly.py
──────────────────────
Robust anomaly scoring.

Produces a 'robust z-score' (also called modified z-score):

    score = (current_value - baseline_median) / (1.4826 * baseline_MAD)

Interpretation:
  |score| < 2   → well within normal range
  2 ≤ |score| < threshold → borderline, worth watching
  |score| ≥ threshold     → anomalous

The threshold is configurable; the spec recommends 3.5 as a starting point.
"""

from dataclasses import dataclass
from algorithms.baseline import Baseline, MAD_SCALE


@dataclass
class AnomalyScore:
    value:          float   # the measurement being evaluated
    score:          float   # robust z-score (can be negative)
    abs_score:      float   # |score|
    threshold:      float   # threshold used
    is_anomalous:   bool    # True if |score| >= threshold
    direction:      str     # 'above', 'below', or 'normal'
    deviation_pct:  float   # % deviation from baseline median


def score(
    current_value: float,
    baseline: Baseline,
    threshold: float = 3.5,
) -> AnomalyScore:
    """
    Compute the anomaly score for current_value against a Baseline.

    Args:
        current_value: the most-recent measurement
        baseline:      the Baseline object for this site
        threshold:     robust z-score cutoff for anomaly

    Returns:
        AnomalyScore dataclass
    """
    if baseline.sigma == 0:
        # Edge case: completely flat baseline
        raw_score = 0.0
    else:
        raw_score = (current_value - baseline.median) / baseline.sigma

    abs_score    = abs(raw_score)
    is_anomalous = abs_score >= threshold

    if current_value > baseline.upper:
        direction = "above"
    elif current_value < baseline.lower:
        direction = "below"
    else:
        direction = "normal"

    if baseline.median != 0:
        deviation_pct = ((current_value - baseline.median) / baseline.median) * 100
    else:
        deviation_pct = 0.0

    return AnomalyScore(
        value=current_value,
        score=round(raw_score, 3),
        abs_score=round(abs_score, 3),
        threshold=threshold,
        is_anomalous=is_anomalous,
        direction=direction,
        deviation_pct=round(deviation_pct, 1),
    )

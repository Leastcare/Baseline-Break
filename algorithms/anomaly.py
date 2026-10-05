from dataclasses import dataclass
from algorithms.baseline import Baseline, MAD_SCALE


@dataclass
class AnomalyScore:
    value:          float
    score:          float
    abs_score:      float
    threshold:      float
    is_anomalous:   bool
    direction:      str
    deviation_pct:  float


def score(
    current_value: float,
    baseline: Baseline,
    threshold: float = 3.5,
) -> AnomalyScore:
    if baseline.sigma == 0:
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

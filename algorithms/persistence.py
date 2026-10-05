from dataclasses import dataclass
from algorithms.baseline import Baseline
from algorithms.anomaly import score as anomaly_score


@dataclass
class PersistenceResult:
    consecutive_unusual:  int
    window_checked:       int
    required:             int
    confirmed:            bool
    recent_scores:        list
    last_direction:       str


def check(
    recent_observations: list[dict],
    baseline: Baseline,
    threshold: float = 3.5,
    required_consecutive: int = 3,
    window: int = 10,
) -> PersistenceResult:
    candidates = recent_observations[-window:][::-1]

    recent_scores  = []
    consecutive    = 0
    last_direction = "normal"

    for obs in candidates:
        val = obs.get("value")
        if val is None:
            break

        s = anomaly_score(val, baseline, threshold)
        recent_scores.append((round(val, 3), round(s.abs_score, 3)))

        if s.is_anomalous:
            consecutive    += 1
            last_direction  = s.direction
        else:
            break

    return PersistenceResult(
        consecutive_unusual=consecutive,
        window_checked=len(candidates),
        required=required_consecutive,
        confirmed=consecutive >= required_consecutive,
        recent_scores=recent_scores[:5],
        last_direction=last_direction,
    )

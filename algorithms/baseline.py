import statistics
from dataclasses import dataclass
from typing import Optional

MAD_SCALE = 1.4826


@dataclass
class Baseline:
    n:              int
    median:         float
    mad:            float
    sigma:          float
    lower:          float
    upper:          float
    p10:            float
    p90:            float
    minimum:        float
    maximum:        float
    sufficient:     bool
    warning:        Optional[str]


def build(
    values: list[float],
    min_points: int = 30,
    band_width_sigma: float = 2.0,
) -> Baseline:
    clean = [v for v in values if v is not None and v >= 0]

    if len(clean) < 2:
        return Baseline(
            n=len(clean), median=0, mad=0, sigma=0,
            lower=0, upper=0, p10=0, p90=0,
            minimum=0, maximum=0,
            sufficient=False,
            warning="Not enough valid observations to build a baseline.",
        )

    med   = statistics.median(clean)
    mad   = statistics.median([abs(v - med) for v in clean])
    sigma = mad * MAD_SCALE

    if sigma == 0:
        sigma = med * 0.05 if med != 0 else 1.0

    lower = max(0.0, med - band_width_sigma * sigma)
    upper = med + band_width_sigma * sigma

    sorted_vals = sorted(clean)
    n           = len(sorted_vals)

    def _percentile(pct: float) -> float:
        idx = max(0, min(n - 1, int(round(pct / 100 * (n - 1)))))
        return sorted_vals[idx]

    sufficient = len(clean) >= min_points
    warning    = None if sufficient else (
        f"Baseline built from only {len(clean)} observations "
        f"(minimum recommended: {min_points}). "
        "Results may be less reliable."
    )

    return Baseline(
        n=len(clean),
        median=round(med, 4),
        mad=round(mad, 4),
        sigma=round(sigma, 4),
        lower=round(lower, 4),
        upper=round(upper, 4),
        p10=round(_percentile(10), 4),
        p90=round(_percentile(90), 4),
        minimum=round(min(clean), 4),
        maximum=round(max(clean), 4),
        sufficient=sufficient,
        warning=warning,
    )


def build_from_observations(
    observations: list[dict],
    min_points: int = 30,
) -> Baseline:
    values = [obs["value"] for obs in observations if obs.get("value") is not None]
    return build(values, min_points=min_points)

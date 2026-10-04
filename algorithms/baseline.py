"""
algorithms/baseline.py
───────────────────────
Builds a site-specific baseline from historical observations.

Uses robust statistics (median + MAD) rather than mean + std so that
extreme values in the history do not distort the 'normal' definition.

Reference:
  Leys et al. (2013). Detecting outliers: Do not use standard deviation
  around the mean, use absolute deviation around the median.
  Journal of Experimental Social Psychology, 49(4), 764–766.
"""

import statistics
from dataclasses import dataclass
from typing import Optional


# The scaling factor that makes MAD comparable to σ for normal data.
MAD_SCALE = 1.4826


@dataclass
class Baseline:
    """Represents the 'normal' behaviour of a single monitoring site."""
    n:              int           # number of observations used
    median:         float         # central value
    mad:            float         # median absolute deviation
    sigma:          float         # scaled MAD ≈ std dev equivalent
    lower:          float         # baseline lower bound  (median - 2σ)
    upper:          float         # baseline upper bound  (median + 2σ)
    p10:            float         # 10th percentile
    p90:            float         # 90th percentile
    minimum:        float
    maximum:        float
    sufficient:     bool          # False when we don't have enough data
    warning:        Optional[str] # human-readable reason if insufficient


def build(
    values: list[float],
    min_points: int = 30,
    band_width_sigma: float = 2.0,
) -> Baseline:
    """
    Build a Baseline from a list of float values.

    Args:
        values:           historical measurement values (any order)
        min_points:       minimum required to consider the baseline reliable
        band_width_sigma: how many σ either side to call 'normal'

    Returns:
        Baseline dataclass
    """
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

    # If MAD is 0 (all values identical), fall back to a tiny absolute band
    if sigma == 0:
        sigma = med * 0.05 if med != 0 else 1.0

    lower = max(0.0, med - band_width_sigma * sigma)
    upper = med + band_width_sigma * sigma

    # Percentiles (simple nearest-rank)
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
    """
    Convenience wrapper: build a Baseline from a list of normalised
    observation dicts (each must have a 'value' key).
    """
    values = [obs["value"] for obs in observations if obs.get("value") is not None]
    return build(values, min_points=min_points)

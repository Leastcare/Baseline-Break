from algorithms.anomaly import AnomalyScore
from algorithms.baseline import Baseline
from algorithms.persistence import PersistenceResult


def build_explanation(
    anomaly:     AnomalyScore,
    baseline:    Baseline,
    persistence: PersistenceResult,
    unit:        str = "",
    approval:    str = "Unknown",
    site_name:   str = "",
    param_name:  str = "Streamflow",
) -> list[str]:
    reasons: list[str] = []
    unit_str = f" {unit}" if unit else ""

    direction_word = "above" if anomaly.direction == "above" else "below"
    pct_str = f"{abs(anomaly.deviation_pct):.0f}%"

    if anomaly.direction in ("above", "below"):
        reasons.append(
            f"Current {param_name.lower()} ({anomaly.value:.1f}{unit_str}) is "
            f"{pct_str} {direction_word} this site's recent median "
            f"({baseline.median:.1f}{unit_str})."
        )
    else:
        reasons.append(
            f"Current {param_name.lower()} ({anomaly.value:.1f}{unit_str}) is "
            f"within the normal range for this site."
        )

    reasons.append(
        f"Typical recent range for this site: "
        f"{baseline.lower:.1f}–{baseline.upper:.1f}{unit_str}."
    )

    if persistence.confirmed:
        reasons.append(
            f"The unusual pattern has persisted across "
            f"{persistence.consecutive_unusual} consecutive recent observations, "
            f"which reduces the likelihood of a single noisy reading."
        )
    elif persistence.consecutive_unusual >= 1:
        reasons.append(
            f"This is the {persistence.consecutive_unusual} consecutive unusual "
            f"observation. Further observations are needed to confirm a sustained change."
        )

    if not baseline.sufficient:
        reasons.append(
            f"Note: The baseline was built from only {baseline.n} observations. "
            "A longer history would improve reliability."
        )
    else:
        reasons.append(
            f"Baseline built from {baseline.n} daily observations."
        )

    approval_note = f" (approval status: {approval})" if approval else ""
    reasons.append(f"Data source: USGS Water Data{approval_note}.")

    return reasons


def build_normal_explanation(
    anomaly:  AnomalyScore,
    baseline: Baseline,
    unit:     str = "",
    param_name: str = "Streamflow",
) -> list[str]:
    unit_str = f" {unit}" if unit else ""
    return [
        f"Current {param_name.lower()} ({anomaly.value:.1f}{unit_str}) is "
        f"within the normal range for this site "
        f"({baseline.lower:.1f}–{baseline.upper:.1f}{unit_str}).",
        f"Baseline median: {baseline.median:.1f}{unit_str} "
        f"(from {baseline.n} daily observations).",
        "No unusual change detected at this time.",
    ]


def one_health_context(direction: str, param_name: str = "Streamflow") -> dict:
    if direction == "above":
        ecosystem = (
            "A significant increase in streamflow can indicate heavy rainfall, "
            "upstream runoff, or other hydrological changes in the watershed."
        )
        animals = (
            "Higher flows may affect aquatic habitat, potentially displacing or "
            "stressing fish and other stream-dependent wildlife."
        )
        people = (
            "Elevated streamflow can impact recreational access, infrastructure near "
            "the stream, and downstream water management."
        )
    elif direction == "below":
        ecosystem = (
            "A significant decrease in streamflow may indicate reduced precipitation, "
            "drought conditions, or upstream changes in water use."
        )
        animals = (
            "Lower flows can concentrate aquatic organisms and reduce dissolved oxygen, "
            "which may stress fish and other wildlife."
        )
        people = (
            "Reduced streamflow can affect water availability for downstream communities "
            "and agricultural or municipal users."
        )
    else:
        ecosystem = (
            "Streamflow is within the normal range for this site. "
            "The ecosystem is behaving consistently with recent historical patterns."
        )
        animals   = "No unusual signal detected that would affect aquatic habitat."
        people    = "No unusual change detected at this time."

    return {
        "ecosystem": ecosystem,
        "animals":   animals,
        "people":    people,
        "disclaimer": (
            "This is an environmental monitoring signal, not a confirmed cause-and-effect "
            "relationship. All findings should be reviewed by qualified environmental staff."
        ),
    }

import logging
import time
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from typing import Optional

from algorithms import anomaly, baseline, explanation, persistence
from clients.usgs_client import USGSClient
from services.timeseries_service import TimeseriesService

logger = logging.getLogger(__name__)

SITE_REGISTRY: list[dict] = [
    {
        "id":            "USGS-02336000",
        "number":        "02336000",
        "name":          "Chattahoochee River at Atlanta",
        "location":      "Fulton County, GA",
        "state":         "Georgia",
        "latitude":      33.8651,
        "longitude":     -84.4363,
        "parameter_code":"00060",
        "unit":          "ft³/s",
        "ts_id_daily":   "b964b6cc6a18411c8a95b53a6dae2b61",
        "ts_id_cont":    "32502bb8dd364ed7b4d5d95f7b20cf98",
    },
    {
        "id":            "USGS-01646500",
        "number":        "01646500",
        "name":          "Potomac River at Little Falls",
        "location":      "Montgomery County, MD",
        "state":         "Maryland",
        "latitude":      38.9440,
        "longitude":     -77.1194,
        "parameter_code":"00060",
        "unit":          "ft³/s",
        "ts_id_daily":   "2cf409b0d9694c01828f5d4ff14586a5",
        "ts_id_cont":    "66a4e3fb8abe42fcb0942b5c0fe98f68",
    },
    {
        "id":            "USGS-14211720",
        "number":        "14211720",
        "name":          "Willamette River at Portland",
        "location":      "Multnomah County, OR",
        "state":         "Oregon",
        "latitude":      45.5175,
        "longitude":     -122.6760,
        "parameter_code":"00060",
        "unit":          "ft³/s",
        "ts_id_daily":   "ca6acd13f9dd4fb095d1af7a344a9c59",
        "ts_id_cont":    "25161ce7dc08491389080de10c85fd9e",
    },
    {
        "id":            "USGS-08075000",
        "number":        "08075000",
        "name":          "Buffalo Bayou at Houston",
        "location":      "Harris County, TX",
        "state":         "Texas",
        "latitude":      29.7604,
        "longitude":     -95.3698,
        "parameter_code":"00060",
        "unit":          "ft³/s",
        "ts_id_daily":   "e09de020510f42f5903f48b79c0441e4",
        "ts_id_cont":    "ba4b071b738d471eb1c9ee898cf80afa",
    },
    {
        "id":            "USGS-04087000",
        "number":        "04087000",
        "name":          "Milwaukee River at Milwaukee",
        "location":      "Milwaukee County, WI",
        "state":         "Wisconsin",
        "latitude":      43.0389,
        "longitude":     -87.9065,
        "parameter_code":"00060",
        "unit":          "ft³/s",
        "ts_id_daily":   "f70251c35ec94a22a5cf9cac25e080b7",
        "ts_id_cont":    "088fac20698149b9a1ffb8bdb2c35689",
    },
    {
        "id":            "USGS-03015500",
        "number":        "03015500",
        "name":          "Allegheny River at Salamanca",
        "location":      "Cattaraugus County, NY",
        "state":         "New York",
        "latitude":      42.1584,
        "longitude":     -78.7158,
        "parameter_code":"00060",
        "unit":          "ft³/s",
        "ts_id_daily":   "5b6bcbd63e794328a2b972caee335a45",
        "ts_id_cont":    "1b5b8813cd134d9d8cf90d2e3db21301",
    },
]


@dataclass
class AnalysisResult:
    site_id:          str
    site_name:        str
    location:         str
    state:            str
    latitude:         float
    longitude:        float
    parameter_code:   str
    parameter_name:   str
    unit:             str

    status:           str
    current_value:    Optional[float]
    timestamp:        Optional[str]
    approval_status:  str

    baseline_median:  Optional[float]
    baseline_mad:     Optional[float]
    baseline_lower:   Optional[float]
    baseline_upper:   Optional[float]
    baseline_n:       int
    baseline_warning: Optional[str]

    anomaly_score:    Optional[float]
    persistence:      int
    direction:        str
    deviation_pct:    Optional[float]

    explanation:      list[str]
    one_health:       dict

    trend:            list[dict]
    error:            Optional[str]


class AnalysisService:
    def __init__(
        self,
        usgs_client: USGSClient,
        anomaly_threshold: float = 3.5,
        persistence_required: int = 3,
        baseline_days: int = 90,
        cache_ttl: int = 300,
    ):
        self._ts_svc              = TimeseriesService(usgs_client)
        self._threshold           = anomaly_threshold
        self._persistence_required = persistence_required
        self._baseline_days       = baseline_days
        self._cache_ttl           = cache_ttl
        self._result_cache: dict[str, tuple[float, AnalysisResult]] = {}

    def get_sites(self) -> list[dict]:
        return [
            {
                "id":       s["id"],
                "name":     s["name"],
                "location": s["location"],
                "state":    s["state"],
                "latitude": s["latitude"],
                "longitude":s["longitude"],
            }
            for s in SITE_REGISTRY
        ]

    def analyze(self, site_id: str) -> Optional[AnalysisResult]:
        cached = self._result_cache.get(site_id)
        if cached and (time.monotonic() - cached[0]) < self._cache_ttl:
            logger.debug("Analysis cache hit: %s", site_id)
            return cached[1]

        site_cfg = next((s for s in SITE_REGISTRY if s["id"] == site_id), None)
        if not site_cfg:
            return None

        result = self._run_pipeline(site_cfg)
        self._result_cache[site_id] = (time.monotonic(), result)
        return result

    def to_dict(self, result: AnalysisResult) -> dict:
        return asdict(result)

    def _run_pipeline(self, cfg: dict) -> AnalysisResult:
        site_id    = cfg["id"]
        param_code = cfg["parameter_code"]
        unit       = cfg["unit"]
        param_name = {"00060": "Streamflow", "00065": "Gage height"}.get(
            param_code, param_code
        )

        base_result = dict(
            site_id        = site_id,
            site_name      = cfg["name"],
            location       = cfg["location"],
            state          = cfg["state"],
            latitude       = cfg["latitude"],
            longitude      = cfg["longitude"],
            parameter_code = param_code,
            parameter_name = param_name,
            unit           = unit,
        )

        def _make_result(status, current_value, timestamp, error=None, **kwargs):
            defaults = dict(
                approval_status = "Unknown",
                baseline_median = None,
                baseline_mad    = None,
                baseline_lower  = None,
                baseline_upper  = None,
                baseline_n      = 0,
                baseline_warning= None,
                anomaly_score   = None,
                persistence     = 0,
                direction       = "normal",
                deviation_pct   = None,
                explanation     = [],
                one_health      = {},
                trend           = [],
            )
            defaults.update(kwargs)
            return AnalysisResult(
                **base_result,
                status        = status,
                current_value = current_value,
                timestamp     = timestamp,
                error         = error,
                **defaults,
            )

        try:
            history = self._ts_svc.get_historical_daily(
                cfg["ts_id_daily"], days_back=self._baseline_days
            )
        except Exception as e:
            logger.error("History fetch failed for %s: %s", site_id, e)
            return _make_result("no_data", None, None,
                                error=f"Could not retrieve historical data: {e}")

        if len(history) < 5:
            return _make_result("no_data", None, None,
                                error="Not enough historical observations.")

        try:
            latest = self._ts_svc.get_latest_observation(cfg["ts_id_cont"])
            if not latest and history:
                latest = history[-1]
        except Exception as e:
            logger.warning("Latest fetch failed for %s: %s", site_id, e)
            latest = history[-1] if history else None

        if not latest:
            return _make_result("no_data", None, None,
                                error="No recent observation available.")

        current_value   = latest["value"]
        current_ts      = latest["timestamp_iso"]
        approval_status = latest.get("approval_status", "Unknown")

        baseline_obs = [h for h in history if h["date_str"] < latest["date_str"]]
        if not baseline_obs:
            baseline_obs = history[:-1] if len(history) > 1 else history

        bl = baseline.build_from_observations(baseline_obs, min_points=30)

        score = anomaly.score(current_value, bl, threshold=self._threshold)

        history_with_latest = history.copy()
        if not history_with_latest or history_with_latest[-1]["date_str"] != latest["date_str"]:
            history_with_latest.append(latest)

        pers = persistence.check(
            history_with_latest,
            bl,
            threshold=self._threshold,
            required_consecutive=self._persistence_required,
            window=10,
        )

        if not bl.sufficient:
            status = "insufficient_baseline"
        elif score.is_anomalous and pers.confirmed:
            status = "potential_break"
        else:
            status = "normal"

        if status == "potential_break":
            expl = explanation.build_explanation(
                score, bl, pers,
                unit=unit,
                approval=approval_status,
                site_name=cfg["name"],
                param_name=param_name,
            )
        else:
            expl = explanation.build_normal_explanation(
                score, bl, unit=unit, param_name=param_name
            )

        oh = explanation.one_health_context(score.direction, param_name)

        trend_obs = history[-30:]
        trend = []
        for obs in trend_obs:
            s = anomaly.score(obs["value"], bl, threshold=self._threshold)
            trend.append({
                "date":  obs["date_str"],
                "value": round(obs["value"], 2),
                "alert": s.is_anomalous,
            })

        if trend and trend[-1]["date"] != latest["date_str"]:
            trend.append({
                "date":  latest["date_str"],
                "value": round(current_value, 2),
                "alert": score.is_anomalous,
            })

        return _make_result(
            status,
            round(current_value, 2),
            current_ts,
            approval_status = approval_status,
            baseline_median = bl.median,
            baseline_mad    = bl.mad,
            baseline_lower  = round(bl.lower, 2),
            baseline_upper  = round(bl.upper, 2),
            baseline_n      = bl.n,
            baseline_warning= bl.warning,
            anomaly_score   = score.abs_score,
            persistence     = pers.consecutive_unusual,
            direction       = score.direction,
            deviation_pct   = score.deviation_pct,
            explanation     = expl,
            one_health      = oh,
            trend           = trend,
        )

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from clients.usgs_client import USGSClient, USGSError

logger = logging.getLogger(__name__)

PARAM_NAMES = {
    "00060": "Streamflow",
    "00065": "Gage height",
    "00010": "Water temperature",
    "00300": "Dissolved oxygen",
    "00400": "pH",
    "00095": "Specific conductance",
    "63680": "Turbidity",
}

PREFERRED_STAT_IDS = {"00003", "00011", None}


def _parse_iso(ts_str) -> Optional[datetime]:
    if not ts_str:
        return None
    try:
        s = str(ts_str).strip()
        if len(s) == 10:
            return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _safe_float(val) -> Optional[float]:
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _normalise_observation(raw: dict) -> Optional[dict]:
    value = _safe_float(raw.get("value"))
    if value is None:
        return None
    if value < 0:
        return None

    ts = _parse_iso(raw.get("time"))
    if ts is None:
        return None

    return {
        "time_series_id":          raw.get("time_series_id", ""),
        "monitoring_location_id":  raw.get("monitoring_location_id", ""),
        "monitoring_location_name": raw.get("monitoring_location_name", ""),
        "parameter_code":          raw.get("parameter_code", ""),
        "parameter_name": PARAM_NAMES.get(
            str(raw.get("parameter_code", "")), raw.get("parameter_code", "")
        ),
        "value":           value,
        "unit":            raw.get("unit_of_measure", ""),
        "timestamp":       ts,
        "timestamp_iso":   ts.isoformat(),
        "date_str":        ts.strftime("%Y-%m-%d"),
        "approval_status": raw.get("approval_status", "Unknown"),
        "qualifier":       raw.get("qualifier"),
        "state_name":      raw.get("state_name", ""),
        "county_name":     raw.get("county_name", ""),
    }


class TimeseriesService:
    def __init__(self, client: USGSClient):
        self._client = client

    def get_site_info(self, site_number: str) -> Optional[dict]:
        try:
            raw = self._client.get_site_metadata(site_number)
            if not raw:
                return None
            return {
                "monitoring_location_id":     f"USGS-{site_number}",
                "monitoring_location_number": site_number,
                "name":     raw.get("monitoring_location_name", site_number),
                "state":    raw.get("state_name", ""),
                "county":   raw.get("county_name", ""),
                "site_type": raw.get("site_type", ""),
                "huc":      raw.get("hydrologic_unit_code", ""),
            }
        except USGSError as e:
            logger.error("get_site_info(%s) failed: %s", site_number, e)
            return None

    def get_timeseries_id(
        self,
        monitoring_location_id: str,
        parameter_code: str = "00060",
        prefer_period: str = "Daily",
    ) -> Optional[str]:
        try:
            rows = self._client.get_timeseries_metadata(
                monitoring_location_id, parameter_code
            )
        except USGSError as e:
            logger.error("get_timeseries_id failed: %s", e)
            return None

        if not rows:
            return None

        def _score(row):
            score = 0
            period = (row.get("computation_period_identifier") or "").lower()
            primary = (row.get("primary") or "").lower()
            if period == prefer_period.lower():
                score += 10
            if "primary" in primary:
                score += 5
            end = _parse_iso(row.get("end"))
            if end:
                days_old = (datetime.now(timezone.utc) - end).days
                if days_old < 7:
                    score += 8
                elif days_old < 30:
                    score += 4
            return score

        best = max(rows, key=_score)
        ts_id = best.get("id") or best.get("time_series_id")
        logger.info(
            "Selected ts_id=%s (period=%s) for %s param=%s",
            ts_id,
            best.get("computation_period_identifier"),
            monitoring_location_id,
            parameter_code,
        )
        return ts_id

    def get_latest_observation(self, ts_id: str) -> Optional[dict]:
        try:
            raw = self._client.get_latest_continuous(ts_id)
            if raw:
                obs = _normalise_observation(raw)
                if obs:
                    return obs
        except USGSError as e:
            logger.warning("get_latest_continuous(%s) failed: %s", ts_id, e)

        try:
            today     = date.today()
            start_str = (today - timedelta(days=7)).isoformat()
            end_str   = today.isoformat()
            rows      = self._client.get_daily_history(ts_id, start_str, end_str, max_records=10)
            if rows:
                valid = [_normalise_observation(r) for r in rows]
                valid = [o for o in valid if o]
                if valid:
                    return sorted(valid, key=lambda o: o["timestamp"], reverse=True)[0]
        except USGSError as e:
            logger.warning("daily fallback for latest failed: %s", e)

        return None

    def get_historical_daily(
        self,
        ts_id: str,
        days_back: int = 90,
    ) -> list[dict]:
        today     = date.today()
        start_str = (today - timedelta(days=days_back)).isoformat()
        end_str   = today.isoformat()

        try:
            rows = self._client.get_daily_history(
                ts_id, start_str, end_str, max_records=500
            )
        except USGSError as e:
            logger.error("get_historical_daily(%s) failed: %s", ts_id, e)
            return []

        obs_list = [_normalise_observation(r) for r in rows]
        obs_list = [o for o in obs_list if o is not None]

        seen: set[str] = set()
        deduped = []
        for obs in obs_list:
            if obs["date_str"] not in seen:
                seen.add(obs["date_str"])
                deduped.append(obs)

        deduped.sort(key=lambda o: o["timestamp"])
        logger.info(
            "get_historical_daily(%s): %d raw → %d clean points",
            ts_id, len(rows), len(deduped),
        )
        return deduped

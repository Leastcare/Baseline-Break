import json
import logging
import os
import time
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

BASE_URL   = "https://api.waterdata.usgs.gov/ogcapi/v1/collections"
USER_AGENT = "baseline-break/1.0 (hackathon-prototype)"
TIMEOUT    = 20
PAGE_LIMIT = 500


class USGSError(Exception):
    pass


class USGSClient:
    def __init__(self, api_key: str = "", cache_ttl: int = 300):
        self._api_key  = api_key
        self._ttl      = cache_ttl
        self._cache: dict[str, tuple[float, Any]] = {}

    def _headers(self) -> dict:
        h = {
            "Accept":     "application/json",
            "User-Agent": USER_AGENT,
        }
        if self._api_key:
            h["X-Api-Key"] = self._api_key
        return h

    def _get(self, url: str) -> Any:
        now = time.monotonic()
        cached = self._cache.get(url)
        if cached and (now - cached[0]) < self._ttl:
            logger.debug("Cache hit: %s", url)
            return cached[1]

        logger.debug("Fetching: %s", url)
        req = urllib.request.Request(url, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                data = json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:500]
            raise USGSError(f"HTTP {e.code} from {url}: {body}") from e
        except Exception as e:
            raise USGSError(f"Request failed for {url}: {e}") from e

        self._cache[url] = (now, data)
        return data

    def _items(self, collection: str, params: dict) -> list[dict]:
        params = {**params, "f": "json"}
        url    = f"{BASE_URL}/{collection}/items?{urllib.parse.urlencode(params)}"
        data   = self._get(url)
        feats  = data.get("features", [])

        total   = data.get("numberMatched", len(feats))
        offset  = len(feats)
        while offset < total and len(feats) < 5000:
            paged_params = {**params, "offset": offset}
            paged_url    = (
                f"{BASE_URL}/{collection}/items?"
                f"{urllib.parse.urlencode(paged_params)}"
            )
            page_data  = self._get(paged_url)
            page_feats = page_data.get("features", [])
            if not page_feats:
                break
            feats  += page_feats
            offset += len(page_feats)

        return [f.get("properties", {}) for f in feats]

    def get_site_metadata(self, monitoring_location_number: str) -> dict | None:
        params = {
            "monitoring_location_number": monitoring_location_number,
            "limit": 1,
        }
        rows = self._items("monitoring-locations", params)
        return rows[0] if rows else None

    def get_timeseries_metadata(
        self,
        monitoring_location_id: str,
        parameter_code: str = "00060",
    ) -> list[dict]:
        params = {
            "monitoring_location_id": monitoring_location_id,
            "parameter_code":        parameter_code,
            "limit":                 20,
        }
        return self._items("time-series-metadata", params)

    def get_latest_continuous(self, time_series_id: str) -> dict | None:
        params = {"time_series_id": time_series_id, "limit": 1}
        rows   = self._items("latest-continuous", params)
        return rows[0] if rows else None

    def get_daily_history(
        self,
        time_series_id: str,
        start_date: str,
        end_date: str,
        max_records: int = 500,
    ) -> list[dict]:
        params = {
            "time_series_id": time_series_id,
            "datetime":       f"{start_date}/{end_date}",
            "limit":          min(max_records, PAGE_LIMIT),
        }
        return self._items("daily", params)

    def get_continuous_history(
        self,
        time_series_id: str,
        start_date: str,
        end_date: str,
        max_records: int = 500,
    ) -> list[dict]:
        params = {
            "time_series_id": time_series_id,
            "datetime":       f"{start_date}/{end_date}",
            "limit":          min(max_records, PAGE_LIMIT),
        }
        return self._items("continuous", params)

    def invalidate_cache(self, url_fragment: str = "") -> None:
        if not url_fragment:
            self._cache.clear()
        else:
            for key in list(self._cache.keys()):
                if url_fragment in key:
                    del self._cache[key]

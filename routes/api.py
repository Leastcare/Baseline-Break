"""
routes/api.py
──────────────
All /api/* endpoints.  Talks to AnalysisService — never directly to USGS.
"""

import json
import logging
import os
import datetime

from flask import Blueprint, current_app, jsonify, request

logger = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _svc():
    """Retrieve the shared AnalysisService from the Flask app context."""
    return current_app.config["ANALYSIS_SERVICE"]


# ─────────────────────────────────────────────────────────────────────────
# Sites
# ─────────────────────────────────────────────────────────────────────────

@api_bp.route("/sites", methods=["GET"])
def get_sites():
    """Return the list of monitored sites with live status from cache."""
    from services.analysis_service import SITE_REGISTRY
    svc   = _svc()
    sites = svc.get_sites()
    enriched = []
    for site in sites:
        cached = svc._result_cache.get(site["id"])
        cfg    = next((s for s in SITE_REGISTRY if s["id"] == site["id"]), {})
        if cached:
            result = cached[1]
            extra = {
                "status":         result.status,
                "current_value":  result.current_value,
                "unit":           result.unit,
                "parameter_name": result.parameter_name,
                "timestamp":      result.timestamp,
            }
        else:
            extra = {
                "status":         "unknown",
                "current_value":  None,
                "unit":           cfg.get("unit", ""),
                "parameter_name": "Streamflow",
                "timestamp":      None,
            }
        enriched.append({**site, **extra})
    return jsonify({"sites": enriched})


@api_bp.route("/site/<site_id>", methods=["GET"])
def get_site(site_id: str):
    """Return site metadata + latest cached analysis status."""
    from services.analysis_service import SITE_REGISTRY
    cfg = next((s for s in SITE_REGISTRY if s["id"] == site_id), None)
    if not cfg:
        return jsonify({"error": "Site not found"}), 404
    return jsonify({
        "id":        cfg["id"],
        "name":      cfg["name"],
        "location":  cfg["location"],
        "state":     cfg["state"],
        "latitude":  cfg["latitude"],
        "longitude": cfg["longitude"],
        "unit":      cfg["unit"],
        "parameter": cfg.get("parameter_code", "00060"),
    })


# ─────────────────────────────────────────────────────────────────────────
# Analysis  (the core route)
# ─────────────────────────────────────────────────────────────────────────

@api_bp.route("/analyze/<site_id>", methods=["GET"])
def analyze_site(site_id: str):
    """
    Run or return cached analysis for a site.
    This is the route the frontend calls to get everything it needs.
    """
    svc = _svc()
    result = svc.analyze(site_id)

    if result is None:
        return jsonify({"error": "Site not found"}), 404

    if result.error and result.status == "no_data":
        return jsonify({
            "site_id":    site_id,
            "site_name":  result.site_name,
            "status":     "no_data",
            "error":      result.error,
            "trend":      [],
            "explanation": [result.error],
        })

    d = svc.to_dict(result)
    return jsonify(d)


# ─────────────────────────────────────────────────────────────────────────
# Human review
# ─────────────────────────────────────────────────────────────────────────

@api_bp.route("/review", methods=["POST"])
def submit_review():
    """Accept a human review decision and persist it."""
    data = request.get_json(silent=True) or {}
    required = {"series_id", "decision"}
    if not required.issubset(data.keys()):
        return jsonify({"error": "Missing required fields: series_id, decision"}), 400

    valid_decisions = {"confirmed", "rejected", "unsure"}
    if data["decision"] not in valid_decisions:
        return jsonify({"error": f"decision must be one of {valid_decisions}"}), 400

    review = {
        "id":         _new_id(),
        "series_id":  data["series_id"],
        "decision":   data["decision"],
        "note":       data.get("note", ""),
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    _save_review(review)
    logger.info("Review saved: %s %s", review["series_id"], review["decision"])
    return jsonify({"ok": True, "review_id": review["id"]}), 201


# ─────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────

def _new_id() -> str:
    import uuid
    return str(uuid.uuid4())[:8]


def _save_review(review: dict) -> None:
    path = os.path.join("data", "reviews.jsonl")
    os.makedirs("data", exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(review) + "\n")

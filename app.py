"""
Baseline-Break · StreamWatch
Entry point for the Flask application.
"""

import logging
import os

from flask import Flask

from config.settings import Config
from routes.pages import pages_bp
from routes.api import api_bp


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)

    # ── Set up logging ────────────────────────────────────────────────
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # ── Wire the analysis pipeline ────────────────────────────────────
    from clients.usgs_client import USGSClient
    from services.analysis_service import AnalysisService

    usgs_client = USGSClient(
        api_key   = app.config.get("USGS_API_KEY", ""),
        cache_ttl = app.config.get("CACHE_TTL_SECONDS", 300),
    )

    analysis_svc = AnalysisService(
        usgs_client          = usgs_client,
        anomaly_threshold    = app.config.get("ANOMALY_THRESHOLD", 3.5),
        persistence_required = app.config.get("PERSISTENCE_POINTS", 3),
        baseline_days        = app.config.get("BASELINE_DAYS", 90),
        cache_ttl            = app.config.get("CACHE_TTL_SECONDS", 300),
    )

    app.config["ANALYSIS_SERVICE"] = analysis_svc

    # ── Pre-warm analysis cache in background thread ──────────────────
    # Runs analysis for all sites at startup so /api/sites immediately
    # returns real statuses instead of 'unknown'.
    import threading

    def _prewarm():
        import logging
        log = logging.getLogger("prewarm")
        from services.analysis_service import SITE_REGISTRY
        with app.app_context():
            for cfg in SITE_REGISTRY:
                try:
                    analysis_svc.analyze(cfg["id"])
                    log.info("Pre-warmed: %s", cfg["id"])
                except Exception as e:
                    log.warning("Pre-warm failed for %s: %s", cfg["id"], e)

    t = threading.Thread(target=_prewarm, daemon=True, name="prewarm")
    t.start()

    # ── Register blueprints ───────────────────────────────────────────
    app.register_blueprint(pages_bp)
    app.register_blueprint(api_bp)

    return app


if __name__ == "__main__":
    application = create_app()
    application.run(
        host  = "0.0.0.0",
        port  = 5000,
        debug = application.config.get("FLASK_DEBUG", False),
    )

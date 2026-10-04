import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-in-prod")
    USGS_API_KEY = os.environ.get("USGS_API_KEY", "")
    USGS_BASE_URL = "https://api.waterdata.usgs.gov/ogcapi/v1/collections"
    CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", 300))
    BASELINE_DAYS = int(os.environ.get("BASELINE_DAYS", 90))
    MIN_HISTORY_POINTS = int(os.environ.get("MIN_HISTORY_POINTS", 30))
    PERSISTENCE_POINTS = int(os.environ.get("PERSISTENCE_POINTS", 3))
    ANOMALY_THRESHOLD = float(os.environ.get("ANOMALY_THRESHOLD", 3.5))
    DATABASE_PATH = os.environ.get("DATABASE_PATH", "data/streamwatch.db")
    FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "false").lower() == "true"

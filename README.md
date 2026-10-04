# Baseline-Break

**One Health Early-Warning for Freshwater Ecosystems**

> Built for the OneAquaHealth IEEE Global Hackathon 2026 — Track 6: Resilience Informatics

---

## What it does

Most water monitoring dashboards just show you a number. Baseline-Break asks a different question:

**Is this number actually unusual for *this specific* stream?**

The app learns what normal looks like for each monitored site using 90 days of real USGS measurements. When a new reading breaks that pattern, it flags it, shows you exactly why, and asks a human to review it — instead of claiming pollution or making any automated health decision.

```
Real USGS data → Build site-specific baseline → Detect break → Explain it → Human reviews
```

---

## Demo

🌐 **Live app: https://baseline-break.onrender.com**

The app shows real-time USGS river monitoring data. First load takes ~10 seconds while it fetches live data from the USGS API.

*(Screenshots below)*

---

## The problem it solves

A generic threshold can be wrong for a specific site. A reading of 2000 ft³/s might be normal at one river and a flood warning at another. Baseline-Break solves this by learning each site's own history rather than applying a universal cutoff.

---

## How it works

1. **Site registry** — 6 real USGS stream monitoring sites across the US
2. **Historical baseline** — fetches 90 days of daily discharge values from the USGS Water Data API
3. **Robust statistics** — builds a median + MAD baseline (resistant to outliers)
4. **Anomaly score** — computes a robust z-score: `(current − median) / (1.4826 × MAD)`
5. **Persistence check** — requires multiple consecutive unusual readings before flagging
6. **Explainability** — every alert shows the exact numbers and reason in plain English
7. **Human review** — the system flags and explains; a person decides

---

## Architecture

```
Browser (HTML/CSS/JS)
    ↓ fetch
Flask API (/api/sites, /api/analyze, /api/review)
    ↓
AnalysisService
    ├── USGSClient      → api.waterdata.usgs.gov (live data)
    ├── TimeseriesService → normalise observations
    ├── baseline.py     → median, MAD, percentiles
    ├── anomaly.py      → robust z-score
    ├── persistence.py  → streak detection
    └── explanation.py  → human-readable output
```

**Stack:** Python · Flask · pandas · NumPy · Leaflet.js · Chart.js · vanilla JS

**Data source:** [USGS Water Data OGC API](https://api.waterdata.usgs.gov/) — public government data, no scraping

---

## Monitored sites

| Site | Location | Parameter |
|------|----------|-----------|
| Chattahoochee River at Atlanta | Fulton County, GA | Discharge |
| Potomac River at Little Falls | Montgomery County, MD | Discharge |
| Willamette River at Portland | Multnomah County, OR | Discharge |
| Buffalo Bayou at Houston | Harris County, TX | Discharge |
| Milwaukee River at Milwaukee | Milwaukee County, WI | Discharge |
| Allegheny River at Salamanca | Cattaraugus County, NY | Discharge |

---

## Detection method

The core algorithm is a **modified z-score** using median absolute deviation:

```python
robust_z = (current_value - baseline_median) / (1.4826 * baseline_MAD)
```

- Threshold: 3.5 (configurable)
- Persistence: 3 consecutive unusual readings required to confirm a break
- Baseline: 90 days of daily values, excluding the current day

This approach is more robust than mean ± standard deviation because it is not pulled by extreme historic values.

---

## One Health connection

Baseline-Break detects an environmental signal in a freshwater ecosystem. It does not diagnose health conditions or prove pollution. The connection to One Health is:

- Freshwater ecosystem condition is connected to biodiversity and aquatic life
- Changes in streamflow can affect downstream water availability
- Early awareness of unusual patterns supports the human-environment-animal connection at the core of the OneAquaHealth mission

---

## What it is NOT

- Not a pollution detector
- Not a medical system
- Not a flood prediction tool
- Not an autonomous decision-maker

Every alert requires human review. The system shows evidence, not verdicts.

---

## Screenshots

*(add after recording demo)*

---

## Run locally

**Requirements:** Python 3.11+

```bash
git clone https://github.com/Leastcare/Baseline-Break.git
cd Baseline-Break
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Open `http://localhost:5000`

The app fetches live USGS data on first load. Expect ~5–10 seconds for the first analysis to complete. Subsequent requests are cached for 5 minutes.

---

## Deploy to Render (free)

1. Go to [render.com](https://render.com) and sign in with GitHub
2. Click **New Web Service** → connect this repository
3. Render auto-detects Python
4. Add environment variables from `.env.example`
5. Click **Deploy**

Your app will be live at `https://baseline-break.onrender.com` (or similar).

**Free tier note:** The app sleeps after 15 minutes of inactivity. First request after sleep takes ~30 seconds to wake up.

## Deploy to Railway (alternative)

1. Go to [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo
3. Select `Baseline-Break`
4. Add environment variables
5. Deploy

Railway gives $5/month free credit — enough for a demo.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `USGS_API_KEY` | *(empty)* | Optional — increases USGS rate limits |
| `CACHE_TTL_SECONDS` | `300` | How long to cache USGS responses |
| `BASELINE_DAYS` | `90` | Days of history to build baseline from |
| `ANOMALY_THRESHOLD` | `3.5` | Robust z-score cutoff for anomaly flag |
| `PERSISTENCE_POINTS` | `3` | Consecutive unusual readings to confirm break |
| `FLASK_DEBUG` | `false` | Enable Flask debug mode |

---

## Project structure

```
baseline-break/
├── app.py                    Flask entry point
├── config/settings.py        Config from environment
├── clients/usgs_client.py    USGS API HTTP client
├── services/
│   ├── timeseries_service.py Fetch + normalise observations
│   └── analysis_service.py   Full pipeline orchestrator
├── algorithms/
│   ├── baseline.py           Median + MAD baseline
│   ├── anomaly.py            Robust z-score
│   ├── persistence.py        Streak detection
│   └── explanation.py        Human-readable output
├── routes/
│   ├── api.py                REST API endpoints
│   └── pages.py              HTML page route
├── templates/index.html      Single-page app shell
├── static/
│   ├── css/style.css         Desktop (teal) + mobile (purple) themes
│   └── js/
│       ├── app.js            Main frontend orchestrator
│       ├── chart-module.js   Chart.js trend chart
│       ├── map-module.js     Leaflet map with custom pins
│       └── review.js         Human review submit
└── data/demo_cache/          Pre-cached USGS responses (demo fallback)
```

---

## Limitations

- USGS coverage is US-focused. The architecture supports adding other monitoring networks as adapters.
- The baseline is derived from daily discharge values. High-frequency anomalies within a single day are not currently detected.
- Anomaly thresholds have not been validated against environmental ground truth — they are statistically reasonable starting points.
- The app is a proof-of-concept prototype, not a production monitoring system.

---

## Responsible use

Baseline-Break is an early-warning signal tool. It detects statistically unusual patterns in publicly available environmental monitoring data. It does not:

- Confirm the cause of any detected change
- Provide medical, legal, or regulatory advice
- Replace qualified environmental scientists or water quality experts

Any observation flagged by this system should be reviewed by appropriate environmental professionals before any action is taken.

---

## Future directions

- Additional monitoring networks (beyond USGS)
- More parameters (turbidity, dissolved oxygen, pH)
- CUSUM or Bayesian change-point detection
- FHIR-compatible data export (Track 7 alignment)
- Integration with OneAquaHealth Citizen Science App observations

---

## License

MIT

---

## Built by

Built for the OneAquaHealth IEEE Global Hackathon 2026.
Data provided by the [U.S. Geological Survey Water Resources](https://waterdata.usgs.gov/) under public domain.

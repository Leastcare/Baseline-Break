# Baseline-Break — Interview Prep Guide

> Written in plain English. No jargon without explanation.
> Read this once before any interview or presentation.

---

## PART 1 — THE BRIEF (30 seconds)

**What is it?**
A web app that watches real river monitoring stations and tells you when a river starts behaving differently from its own history.

**Why does it matter?**
Most water dashboards just show you a number. They don't tell you if that number is actually unusual for that specific river. A reading of 2000 ft³/s might be normal at the Amazon and a flood warning at a small stream. Baseline-Break solves this by learning each river's own history and comparing new readings against that — not against some universal threshold.

**What does it do in 5 steps?**
1. Fetch 90 days of real government water data (USGS)
2. Calculate what "normal" looks like for that specific river
3. Compare today's reading against that normal
4. If it's unusual, show exactly why and how unusual
5. Ask a human to confirm — never make the decision automatically

**One sentence pitch:**
> Baseline-Break learns what normal looks like for each monitored river, detects the first meaningful change, explains why it was flagged, and asks a human to verify — instead of claiming pollution or making automated health decisions.

---

## PART 2 — DETAILED EXPLANATION

### The Problem (in plain English)

Imagine you're watching a river. Yesterday it was flowing at 1000 cubic feet per second. Today it's at 2000. Is that bad?

You don't know — unless you know what's normal for *that* river. 2000 might be normal after heavy rain. It might be a sign of a dam breaking upstream. Without knowing the history of *that specific river*, any alarm you set is either too sensitive (constant false alerts) or not sensitive enough (misses real problems).

That's the blind spot this project fixes.

---

### The Solution (in plain English)

**Step 1: Get the data**

We connect to the USGS (United States Geological Survey) Water Data API. This is the US government's real-time river monitoring system with thousands of stations across the country. It's free and public.

We fetch 90 days of daily discharge readings (how much water is flowing, measured in cubic feet per second — ft³/s).

**Step 2: Build the baseline**

We don't just take an average. We use something called the **median** and **MAD**.

- **Mean (average)**: If a river had one massive flood 2 months ago, the average gets pulled upward. Now everything looks "normal" even when it isn't.
- **Median**: The middle value when you sort all readings. That big flood doesn't move it much.
- **MAD (Median Absolute Deviation)**: How spread out the readings are, calculated the same robust way.

Think of it like this:
- Mean = the average test score in a class (one genius ruins the curve)
- Median = the score of the kid in the exact middle (much more honest)

We use `median ± 2 × (MAD × 1.4826)` to define the "normal band". The 1.4826 is a mathematical constant that makes MAD comparable to standard deviation.

**Step 3: Score the current reading**

We calculate a "robust z-score":
```
score = (current_value - median) / (1.4826 × MAD)
```

This tells us: "how many 'standard deviations' away from normal is this reading?"

- Score 0–2: normal
- Score 2–3.5: watch it
- Score 3.5+: flag it as a potential break

**Step 4: Persistence check**

One weird reading could be a sensor glitch. We require **3 consecutive unusual readings** before triggering an alert. This kills false alarms from random noise.

**Step 5: Explain it**

Every alert shows:
- Current value vs normal range
- The exact score
- How many consecutive unusual readings
- The data source and approval status (Provisional vs Approved)
- Plain English explanation

**Step 6: Human review**

The system never says "the river is polluted." It says "this reading is unusual — please check." A human confirms, rejects, or marks it as unsure. That response is saved.

---

### The One Health Connection

One Health is the idea that human health, animal health, and environmental health are connected. The hackathon is built on this idea.

Our connection: a river's health affects everything around it.
- **Ecosystem**: plants and algae need the right water conditions
- **Animals**: fish, birds, insects all depend on stable river conditions
- **People**: drinking water, recreation, downstream communities

We don't claim "this reading means humans will get sick." That would be irresponsible. We say: "something changed in this ecosystem — here's the context for why that matters to the broader One Health picture."

---

### The Architecture (how the pieces connect)

```
Browser (HTML + CSS + JavaScript)
    ↕ HTTP requests/responses
Flask (Python web framework)
    ↕
AnalysisService (the brain)
    ↕                    ↕
USGSClient         Algorithms
(fetches data)     (does the math)
    ↕
USGS API
(real government data)
```

**The flow when you open the app:**

1. Browser loads `index.html`
2. `app.js` calls `/api/sites` → gets list of 6 rivers
3. `app.js` calls `/api/analyze/USGS-02336000` → triggers the full pipeline
4. Flask runs `AnalysisService.analyze()` which:
   - Calls USGS API for 90 days of daily data
   - Builds baseline (median + MAD)
   - Fetches today's latest reading
   - Scores it
   - Checks persistence
   - Generates explanation
   - Returns everything as JSON
5. `app.js` receives the JSON and renders it into the UI
6. `ChartModule` draws the trend chart
7. `MapModule` puts pins on the Leaflet map

---

## PART 3 — KEY FUNCTIONS YOU NEED TO KNOW

### `build()` — `algorithms/baseline.py`

**What it does:** Takes a list of numbers and calculates "what is normal"

**Simple version:**
```python
def build(values):
    median = middle_value(values)           # robust center
    mad    = median_of(abs(v - median))     # robust spread
    sigma  = mad * 1.4826                   # scale to std dev
    lower  = median - 2 * sigma             # lower normal bound
    upper  = median + 2 * sigma             # upper normal bound
    return Baseline(median, mad, sigma, lower, upper)
```

**Why median not mean?** If one flood happened 3 months ago, the mean gets pulled up. The median ignores it. Robust statistics for real-world messy data.

**Why 1.4826?** It's the scaling factor that makes MAD behave like standard deviation when data is normally distributed. It's a mathematical constant — you don't derive it, you use it.

---

### `score()` — `algorithms/anomaly.py`

**What it does:** Gives a number saying how unusual the current reading is

```python
def score(current_value, baseline, threshold=3.5):
    robust_z = (current_value - baseline.median) / baseline.sigma
    is_anomalous = abs(robust_z) >= threshold
    direction = "above" if current_value > baseline.upper else "below" or "normal"
    deviation_pct = (current_value - median) / median * 100
    return AnomalyScore(score=robust_z, is_anomalous=is_anomalous, ...)
```

**The threshold of 3.5** — comes from statistics literature on modified z-scores (Iglewicz and Hoaglin, 1993). Values above 3.5 are considered outliers. We use it as a starting point — it's configurable, not gospel.

---

### `check()` — `algorithms/persistence.py`

**What it does:** Checks if multiple consecutive readings are unusual (not just one)

```python
def check(recent_observations, baseline, required_consecutive=3):
    consecutive = 0
    for obs in reversed(recent_observations):   # newest first
        if anomaly_score(obs) is_anomalous:
            consecutive += 1
        else:
            break   # streak broken
    confirmed = consecutive >= required_consecutive
    return PersistenceResult(consecutive, confirmed)
```

**Why this matters:** One weird reading = sensor glitch. Three in a row = real signal. This is the main false-alarm protection.

---

### `_run_pipeline()` — `services/analysis_service.py`

**What it does:** Orchestrates the entire analysis for one river site

```python
def _run_pipeline(site_config):
    # 1. Get 90 days of daily readings
    history = timeseries_service.get_historical_daily(ts_id, days=90)

    # 2. Get today's latest reading
    latest = timeseries_service.get_latest_observation(ts_id)

    # 3. Build baseline from history (excluding today)
    baseline = build_baseline(history[:-1])

    # 4. Score today's reading
    score = anomaly_score(latest.value, baseline)

    # 5. Check persistence
    persistence = check_persistence(history, baseline)

    # 6. Decide status
    if score.is_anomalous and persistence.consecutive >= 1:
        status = "potential_break"
    else:
        status = "normal"

    # 7. Build explanation
    explanation = build_explanation(score, baseline, persistence)

    # 8. Build trend data for chart (last 30 days)
    trend = [score_each_day(day) for day in history[-30:]]

    return AnalysisResult(status, score, baseline, trend, explanation, ...)
```

---

### `get_historical_daily()` — `services/timeseries_service.py`

**What it does:** Fetches and cleans historical data from USGS

```python
def get_historical_daily(ts_id, days_back=90):
    rows = usgs_client.get_daily_history(ts_id, start, end)
    
    # Normalise each row
    observations = [normalise(row) for row in rows]
    
    # Remove invalid: nulls, negatives, duplicates
    clean = [o for o in observations if o is not None]
    
    # Sort oldest to newest
    clean.sort(by="timestamp")
    
    return clean
```

**Why clean the data?** Real sensor data has gaps, duplicates, null values, provisional vs approved statuses. If you don't clean it, your baseline is garbage. Garbage in, garbage out.

---

### `USGSClient._items()` — `clients/usgs_client.py`

**What it does:** Makes paginated HTTP requests to the USGS API

```python
def _items(collection, params):
    url = f"https://api.waterdata.usgs.gov/ogcapi/v1/collections/{collection}/items"
    
    # Check in-memory cache first
    if url in self._cache and not expired:
        return cached_result
    
    # Make HTTP request
    response = urllib.request.urlopen(url)
    data = json.loads(response.read())
    
    # Store in cache
    self._cache[url] = (timestamp, data)
    
    return data["features"]
```

**Why cache?** The USGS API can be slow (1–5 seconds per request). If the user clicks multiple sites, we don't want to hit USGS every single time. The cache stores results for 5 minutes (configurable).

---

### `renderDesktopSiteCard()` — `static/js/app.js`

**What it does:** Takes the API response and puts numbers into the right HTML elements

```javascript
function renderDesktopSiteCard(site, analysis) {
    // Put current value into the span
    setText("dtReadingNumber", analysis.current_value.toFixed(1))
    setText("dtReadingUnit",   fmtUnit(analysis.unit))
    
    // Show the right status badge
    badge.className = `badge ${statusBadgeClass(analysis.status)}`
    badge.textContent = statusLabel(analysis.status)
    
    // Show WHY? button only if it's a break
    if (analysis.status === "potential_break") {
        arrowBtn.textContent = "WHY?"
        arrowBtn.onclick = () => showEvidencePanel(analysis)
    }
    
    // Draw the chart with real trend data
    ChartModule.init("dtTrendChart", analysis.trend, unit)
}
```

**Why separate from the API call?** Separation of concerns. The API fetch (`fetchAnalysis`) doesn't care about HTML. The render function doesn't care about HTTP. Easier to debug, test, and change.

---

## PART 4 — INTERVIEW QUESTIONS

### LOW LEVEL (anyone can ask these)

**Q: What does your app do?**
A: It watches real river monitoring stations and tells you when a river starts behaving differently from its own normal pattern. It's an early warning tool — it flags unusual changes and asks a human to verify, instead of making automated claims.

**Q: What data does it use?**
A: Real-time data from the USGS (US Geological Survey) Water Data API. This is the US government's public river monitoring system. We fetch 90 days of daily discharge readings (how much water flows per second) for each of 6 monitoring stations.

**Q: What is discharge / streamflow?**
A: How much water is flowing past a point in the river per second. Measured in cubic feet per second (ft³/s). High discharge = a lot of water moving fast. Low discharge = slow or shallow river.

**Q: What is the One Health connection?**
A: One Health is the idea that human health, animal health, and ecosystem health are connected. Rivers are a good example — their health affects the fish and wildlife that live in them, the plants along the banks, and the communities that use the water downstream. We provide that context with every alert, but we never claim to diagnose health impacts directly.

**Q: Why do you ask for human review instead of just alerting automatically?**
A: Because environmental data is messy. A reading might be unusual because of a sensor glitch, a heavy rainstorm, or an actual pollution event. The algorithm can't tell the difference. Only a human who visits the site or knows the local conditions can. So we flag and explain, but a human decides.

**Q: Is the data live?**
A: Yes. Every time you open the app, it fetches the latest reading from USGS and the most recent 90 days of history. The timestamps in the chart are real dates. The values are real measurements.

---

### MID LEVEL (technical interviewers)

**Q: Why do you use median instead of mean for the baseline?**
A: Real river data has extreme events — floods, droughts. These would pull a mean-based baseline in the wrong direction. The median is the middle value, so one massive flood doesn't distort it. The MAD (Median Absolute Deviation) is the robust equivalent of standard deviation. Together they give us a stable "normal" even when the history contains unusual events.

**Q: What is MAD and why multiply by 1.4826?**
A: MAD = median of |each value − median|. It's how spread out the data is, measured robustly. The 1.4826 scaling factor makes it comparable to standard deviation for normally distributed data. It comes from statistics literature (Rousseeuw & Croux, 1993). Without it, the MAD would be about 1/1.4826 = 0.67 times smaller than the equivalent standard deviation, making our threshold comparisons inconsistent.

**Q: What is a robust z-score?**
A: `(value − median) / (1.4826 × MAD)`. It's the same idea as a regular z-score (how many standard deviations from the mean) but uses robust statistics. A score above 3.5 means the reading is very unlikely to be part of the normal distribution. We use 3.5 as our threshold — standard in outlier detection literature.

**Q: What is the persistence check and why do you need it?**
A: We require 3 consecutive unusual readings before confirming a break. This is because any individual sensor reading can be noisy — a bad transmission, a momentary glitch, a sensor being cleaned. If we alerted on every single unusual reading, we'd have constant false alarms. Requiring persistence means the signal has to be sustained, not just a spike.

**Q: How does the caching work?**
A: The `USGSClient` keeps an in-memory Python dictionary mapping URL → (timestamp, data). Before making any HTTP request, it checks if a cached result exists and if it's less than 5 minutes old. If yes, it returns the cached data. If not, it fetches fresh data and caches it. The `AnalysisService` has a second cache layer for full analysis results — also 5 minutes. This means the UI is fast after the first load, and we don't hammer the USGS API.

**Q: What happens if USGS is down?**
A: The `USGSClient` catches `HTTPError` and `URLError` exceptions and raises a `USGSError`. The `AnalysisService` catches that and returns an `AnalysisResult` with `status="no_data"` and an error message. The Flask route checks for this and returns a graceful JSON error. The frontend shows "Data unavailable" instead of crashing.

**Q: What is Flask and why did you choose it?**
A: Flask is a lightweight Python web framework. It handles HTTP routing (which URL maps to which function), serving HTML templates, and returning JSON responses. We chose it because Python is the natural language for data analysis, Flask is minimal (no magic), and it's easy to deploy. The spec specifically suggested Python + Flask.

**Q: What is the difference between `daily` and `latest-continuous` USGS endpoints?**
A: `daily` returns one value per day — the mean or instantaneous reading aggregated daily. Good for building a 90-day baseline because it's clean and consistent. `latest-continuous` returns the most recent high-frequency observation (often every 15 minutes). We use daily for the baseline and latest-continuous for the current reading, so we always have the freshest possible "right now" value.

**Q: Why is the frontend vanilla JavaScript instead of React?**
A: The spec said to keep the frontend simple. React adds build complexity, npm dependencies, and bundle overhead. For a single-page hackathon prototype that needs to render a chart, a map, and some cards, vanilla JS with Leaflet.js and Chart.js is completely sufficient. We avoided introducing tools that add friction without adding value.

**Q: What is Leaflet.js?**
A: A JavaScript library for interactive maps. It handles tile loading (the map image tiles from Stadia Maps), zoom/pan, and custom markers (our site pins). We customise it with SVG icon markers that show green/amber/grey based on each site's status.

---

### HIGH LEVEL (senior engineers, judges, architects)

**Q: Why is site-specific baseline better than a universal threshold?**
A: A universal threshold assumes all rivers have the same "normal." They don't. A large river like the Potomac has normal discharge in the thousands of ft³/s. A small urban stream might have a normal of 50 ft³/s. A threshold that works for one is useless for the other. Site-specific learning means each river is compared against its own history — the only meaningful comparison.

**Q: What are the limitations of this approach?**
A: Several honest ones:
1. **Seasonal variation** — our 90-day window doesn't capture annual cycles. A high summer reading might be flagged as unusual if the baseline was built during a dry autumn.
2. **Gradual drift** — if a river slowly degrades over months, the baseline shifts with it. We'd miss slow trends.
3. **Data gaps** — USGS occasionally has transmission outages. A gap followed by a normal reading could briefly confuse the persistence check.
4. **US-only** — USGS covers the US. Other monitoring networks would need their own adapter.
5. **Threshold not validated** — 3.5 is statistically reasonable but not calibrated against real environmental events for these specific sites.

**Q: How would you scale this to thousands of monitoring sites?**
A: The architecture already supports it. The `SITE_REGISTRY` is a Python list — replace it with a database query. The `USGSClient` is stateless — run multiple instances behind a load balancer. The `AnalysisService` cache would move from in-process memory to Redis. The baseline computation is parallelisable — one worker per site. The only bottleneck is USGS API rate limits, mitigated by an API key and a proper job scheduler (Celery or similar) running baselines nightly rather than on-demand.

**Q: Why not use a more sophisticated model — CUSUM, ARIMA, or ML?**
A: Because explainability matters more than sophistication for this use case. A judge, an environmental volunteer, or a policymaker needs to understand *why* the system flagged something. A neural network can't explain itself. Our robust z-score + persistence check can: "the current reading is 8.7 standard deviations above the median and it's been like this for 4 days." That's actionable. We can add CUSUM as a second layer later — but only if it outperforms the simple method on validated ground-truth data.

**Q: What would make this production-ready?**
A: Several things we deliberately left out of the MVP:
1. **Authentication** — right now anyone can submit a review
2. **Database** — reviews go to a flat JSON file; should be PostgreSQL/SQLite properly
3. **Background job scheduler** — pre-compute baselines nightly instead of on first request
4. **Monitoring and alerting** — Prometheus metrics, error tracking (Sentry)
5. **Rate limit handling** — exponential backoff on USGS API errors
6. **Test coverage** — we have algorithm unit tests but not integration tests
7. **HTTPS** — required for production
8. **Seasonal baseline** — compare against same time last year, not just last 90 days

**Q: How is this different from just a dashboard?**
A: A dashboard is passive — it shows you data and leaves interpretation to you. Baseline-Break is active — it does the interpretation (statistically, not heuristically), explains it, and creates a workflow. The difference is: a dashboard requires an expert to look at it and know something is wrong. Baseline-Break tells a non-expert exactly what changed, why it matters, and what to do next. That's the gap between data visualisation and a decision-support system.

**Q: What does your system NOT do, and why is that a feature?**
A: It does not claim to detect pollution. It does not provide medical advice. It does not replace environmental scientists. These are intentional constraints, not limitations. Making unsupported causal claims would make the system less trustworthy, not more. The value is in the signal it provides, not the conclusions it draws. Environmental experts can take that signal and do the interpretation. We give them better raw material to work with.

**Q: How does the human-in-the-loop design affect the system's trust model?**
A: It shifts the system from an autonomous decision-maker to a collaborative tool. The algorithm has high sensitivity (flags anything statistically unusual) and the human acts as the specificity filter (decides if it's real). This is the right division of labour: machines are good at pattern detection at scale; humans are good at contextual judgment. The review data we collect also becomes training data for future model improvement.

**Q: What security considerations exist?**
A: The main ones:
1. **API key protection** — USGS key in `.env`, excluded from git via `.gitignore`
2. **Input validation** — the review endpoint validates `decision` against an allowlist, not just any string
3. **No PII** — reviews are anonymous by design
4. **No eval/exec** — no user input is ever executed
5. **Dependency pinning** — `requirements.txt` uses exact versions to prevent supply-chain attacks
For production: add rate limiting to the review endpoint, HTTPS, and proper authentication.

---

## PART 5 — DEPLOYMENT STEPS

### Option A: Run locally (what you've been doing)

```bash
# 1. Navigate to project
cd "path/to/baseline-break"

# 2. Install dependencies (only needed once)
pip install -r requirements.txt

# 3. Copy environment file
cp .env.example .env
# Open .env and optionally add your USGS API key

# 4. Run
python app.py

# 5. Open browser
# http://localhost:5000
```

---

### Option B: Deploy to Render (free cloud hosting)

Render is a free hosting platform. Your app will be live at a public URL.

**Step 1: Create a `render.yaml` file (already in the project)**

```yaml
services:
  - type: web
    name: baseline-break
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn app:create_app()
    envVars:
      - key: FLASK_DEBUG
        value: false
      - key: USGS_API_KEY
        value: ""
```

**Step 2: Push to GitHub** (already done)

**Step 3: Go to render.com**
1. Sign up / log in with GitHub
2. Click "New Web Service"
3. Connect your `Baseline-Break` repository
4. Render auto-detects Python
5. Set environment variables (USGS_API_KEY if you have one)
6. Click "Deploy"
7. Your app is live at `https://baseline-break.onrender.com`

**Free tier note:** On Render's free tier, the app "sleeps" after 15 minutes of inactivity. First request after sleep takes ~30 seconds to wake up. Fine for a demo.

---

### Option C: Deploy to Railway (alternative)

1. Go to `railway.app`
2. New Project → Deploy from GitHub repo
3. Select `Baseline-Break`
4. Add environment variables
5. Deploy

Railway gives $5/month free credit — usually enough for a demo app.

---

### Environment variables for deployment

| Variable | What to set |
|---|---|
| `USGS_API_KEY` | Leave blank or get free key from waterdata.usgs.gov |
| `FLASK_DEBUG` | `false` |
| `SECRET_KEY` | Any random string (e.g. run `python -c "import secrets; print(secrets.token_hex(32))"`) |
| `CACHE_TTL_SECONDS` | `300` (5 minutes) |
| `BASELINE_DAYS` | `90` |

---

## PART 6 — THINGS TO SAY IN THE PRESENTATION

**If asked "is this AI?"**
> "The core detection is explainable statistical analysis — robust z-scores and persistence checking. We deliberately chose a method we can explain over a black-box model. If a judge asks 'why was this flagged?' we can show them the exact numbers. That's more useful than 'the neural network said so.'"

**If asked "why not use the hackathon's citizen science app?"**
> "We use USGS as the primary data source because it's reliable, structured, and has 90+ days of history per site. The architecture supports plugging in citizen observations as a second data layer — each observation would get compared against the same baseline. We just didn't build that connector for the MVP."

**If asked "what would you build next?"**
> "Seasonal baseline — compare against the same month last year, not just the last 90 days. Multi-parameter detection — right now it's just discharge, but the same algorithm works for turbidity, pH, dissolved oxygen. And a FHIR export layer for Track 7 alignment."

**If asked "does it actually work?"**
> "Yes. Open the app. The chart shows real USGS data from this week. The timestamps are today's dates. The baseline was calculated from 90 real daily readings. Every number you see came from the government's monitoring network, not from us."

---

*Keep this doc open during the presentation. You built every part of this — the USGS client, the baseline algorithm, the anomaly scorer, the persistence check, the Flask API, the Leaflet map, the Chart.js trend chart, the responsive CSS, the review workflow. You know how all of it connects.*

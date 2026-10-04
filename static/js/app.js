/* ═══════════════════════════════════════════════════════════════════════
   app.js  —  StreamWatch Atlas · Baseline-Break
   Orchestrates: API calls, desktop UI, mobile wizard, map, chart, review

   All rendering reads live fields from the /api/analyze response.
   AnalysisResult fields used:
     status, current_value, unit, parameter_name, timestamp,
     approval_status, baseline_median, baseline_lower, baseline_upper,
     baseline_n, anomaly_score, persistence, direction, deviation_pct,
     explanation, one_health, trend, error
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

/* ───────────────────────────────────────────────────────────────────────
   STATE
   ─────────────────────────────────────────────────────────────────────── */
const App = {
  sites:          [],       // from /api/sites
  selectedSiteId: null,
  analysisCache:  {},       // siteId → AnalysisResult dict
  isMobile:       false,
  mapReady:       false,

  wizard: {
    step:     1,
    total:    6,
    answers:  {},
    selected: null,
  },
};

/* ───────────────────────────────────────────────────────────────────────
   HELPERS
   ─────────────────────────────────────────────────────────────────────── */
function isMobileLayout() {
  return window.innerWidth < 900;
}

function el(id) { return document.getElementById(id); }

function setText(id, val) {
  const e = el(id);
  if (e) e.textContent = val ?? "—";
}

function showEl(id)  { el(id)?.classList.remove("hidden"); }
function hideEl(id)  { el(id)?.classList.add("hidden"); }

/* Format ISO timestamp → { date, time } strings */
function fmtTimestamp(iso) {
  if (!iso) return { date: "—", time: "—" };
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    };
  } catch { return { date: "—", time: "—" }; }
}

function fmtNow() {
  const d = new Date();
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
  };
}

/* Clean unit string for display — normalise ft³/s variants */
function fmtUnit(raw) {
  if (!raw) return "";
  // API returns "ft³/s" or "ft^3/s" — show as "ft³/s"
  return raw.replace("^3", "³");
}

/* Status from API → display label */
function statusLabel(status) {
  return {
    normal:                "✓ Normal",
    potential_break:       "⚠ Needs recheck",
    no_data:               "No recent data",
    insufficient_baseline: "⚠ Limited data",
    unknown:               "Loading…",
  }[status] ?? status;
}

function statusBadgeClass(status) {
  return {
    normal:                "badge-normal",
    potential_break:       "badge-recheck",
    no_data:               "badge-nodata",
    insufficient_baseline: "badge-nodata",
    unknown:               "badge-nodata",
  }[status] ?? "badge-nodata";
}

/* Map API status → map pin status key */
function toMapStatus(apiStatus) {
  return {
    normal:                "normal",
    potential_break:       "needs_recheck",
    no_data:               "no_data",
    insufficient_baseline: "no_data",
    unknown:               "no_data",
  }[apiStatus] ?? "no_data";
}

/* ───────────────────────────────────────────────────────────────────────
   API CALLS
   ─────────────────────────────────────────────────────────────────────── */
async function fetchSites() {
  try {
    const r = await fetch("/api/sites");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return d.sites ?? [];
  } catch (e) {
    console.error("[App] fetchSites failed:", e);
    return [];
  }
}

async function fetchAnalysis(siteId) {
  // Return cached result if present (cache busted on range change)
  if (App.analysisCache[siteId]) return App.analysisCache[siteId];
  try {
    const r = await fetch(`/api/analyze/${siteId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    App.analysisCache[siteId] = d;

    // Update the site's status in our local site list so map pins refresh
    const site = App.sites.find(s => s.id === siteId);
    if (site) site.status = d.status ?? "unknown";

    return d;
  } catch (e) {
    console.error("[App] fetchAnalysis failed:", siteId, e);
    return null;
  }
}

/* ───────────────────────────────────────────────────────────────────────
   CLOCK
   ─────────────────────────────────────────────────────────────────────── */
function startClock() {
  function tick() {
    const { date, time } = fmtNow();
    setText("dtDate", date);
    setText("dtTime", time);
    // Mobile status bar uses HH:MM 24h
    const t24 = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).slice(0, 5);
    setText("mobTime", t24);
  }
  tick();
  setInterval(tick, 30_000);
}

/* ───────────────────────────────────────────────────────────────────────
   DESKTOP — LOADING STATE
   ─────────────────────────────────────────────────────────────────────── */
function showSiteCardLoading() {
  setText("dtSiteName",     "Loading…");
  setText("dtSiteLocation", "");
  setText("dtReadingNumber","—");
  setText("dtReadingUnit",  "");
  setText("dtReadingDate",  "—");
  setText("dtReadingTime",  "—");
  const badge = el("dtStatusBadge");
  if (badge) { badge.className = "badge badge-nodata"; badge.textContent = "Loading…"; }
  hideEl("dtReadingDelta");
}

/* ───────────────────────────────────────────────────────────────────────
   DESKTOP — SITE CARD  (driven entirely by AnalysisResult)
   ─────────────────────────────────────────────────────────────────────── */
function renderDesktopSiteCard(site, analysis) {
  if (!site || !analysis) return;

  const unit = fmtUnit(analysis.unit || site.unit || "");

  // Site identity
  setText("dtSiteName",     analysis.site_name || site.name);
  setText("dtSiteLocation", analysis.location  || site.location);

  // Timestamp
  const { date, time } = fmtTimestamp(analysis.timestamp);
  setText("dtReadingDate", date);
  setText("dtReadingTime", time);

  // Reading value — uses dedicated #dtReadingNumber span
  setText("dtReadingNumber",
    analysis.current_value != null ? analysis.current_value.toFixed(1) : "—"
  );
  setText("dtReadingUnit", unit);

  // Percentage delta from baseline — only shown for breaks
  const deltaEl = el("dtReadingDelta");
  if (deltaEl) {
    if (
      analysis.status === "potential_break" &&
      analysis.deviation_pct != null
    ) {
      const pct      = analysis.deviation_pct;
      const sign     = pct >= 0 ? "+" : "";
      const dirWord  = analysis.direction === "above" ? "Higher" : "Lower";
      setText("dtDeltaText", `${sign}${pct.toFixed(0)}%`);
      const labelEl = deltaEl.querySelector(".dt-delta-label");
      if (labelEl) labelEl.textContent = `${dirWord} than usual`;
      showEl("dtReadingDelta");
    } else {
      hideEl("dtReadingDelta");
    }
  }

  // Status badge
  const badgeEl = el("dtStatusBadge");
  if (badgeEl) {
    badgeEl.className = `badge ${statusBadgeClass(analysis.status)}`;
    badgeEl.textContent = statusLabel(analysis.status);
  }

  // Chart title and subtitle
  const paramName = analysis.parameter_name || "Streamflow";
  setText("dtChartTitle", `${paramName} Trend`);
  const trendCount = analysis.trend?.length ?? 0;
  setText("dtChartSub",
    `Last ${trendCount} days · ${(analysis.site_name || site.name).split(" ").slice(0, 4).join(" ")}`
  );

  // Chart — pass real trend array from API
  if (analysis.trend && analysis.trend.length) {
    ChartModule.init("dtTrendChart", analysis.trend, unit);
  }

  // WHY? button on the site card arrow
  const arrowBtn = el("dtSiteArrow");
  if (arrowBtn) {
    if (analysis.status === "potential_break") {
      arrowBtn.textContent     = "WHY?";
      arrowBtn.style.fontSize  = "0.82rem";
      arrowBtn.style.fontWeight= "700";
      arrowBtn.style.color     = "var(--dt-warn)";
      arrowBtn.onclick         = () => showEvidencePanel(analysis, unit);
    } else {
      arrowBtn.textContent     = "›";
      arrowBtn.style.fontSize  = "1.4rem";
      arrowBtn.style.fontWeight= "400";
      arrowBtn.style.color     = "";
      arrowBtn.onclick         = null;
    }
  }

  // Always hide evidence panel when switching site
  hideEl("dtEvidencePanel");

  // Baseline warning (shown as a subtle note if baseline is short)
  if (analysis.baseline_warning) {
    console.warn("[App] Baseline warning:", analysis.baseline_warning);
  }
}

/* ───────────────────────────────────────────────────────────────────────
   DESKTOP — EVIDENCE PANEL
   ─────────────────────────────────────────────────────────────────────── */
function showEvidencePanel(analysis, unit) {
  const panel = el("dtEvidencePanel");
  if (!panel) return;
  showEl("dtEvidencePanel");

  // Current reading
  const val = analysis.current_value != null
    ? `${analysis.current_value.toFixed(1)} ${unit}`
    : "—";
  setText("dtEvCurrent", val);

  // Normal range
  const lo = analysis.baseline_lower != null ? analysis.baseline_lower.toFixed(1) : "—";
  const hi = analysis.baseline_upper != null ? analysis.baseline_upper.toFixed(1) : "—";
  setText("dtEvRange", `${lo} – ${hi} ${unit}`);

  // Anomaly score
  setText("dtEvScore",
    analysis.anomaly_score != null ? analysis.anomaly_score.toFixed(2) : "—"
  );

  // Explanation bullets
  const reasonsEl = el("dtEvReasons");
  if (reasonsEl) {
    reasonsEl.innerHTML = (analysis.explanation ?? [])
      .map(r => `<div class="reason-item">${escHtml(r)}</div>`)
      .join("");
  }

  // Wire review buttons with the real site ID
  ReviewModule.wireDesktop(App.selectedSiteId);

  // Reset feedback state
  const fb = el("dtReviewFeedback");
  if (fb) { hideEl("dtReviewFeedback"); fb.textContent = ""; }
  document.querySelectorAll(".dt-review-btn").forEach(b => (b.disabled = false));

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function wireEvidenceClose() {
  const btn = el("dtEvidenceClose");
  if (btn) btn.onclick = () => hideEl("dtEvidencePanel");
}

/* Minimal HTML escaping for explanation strings */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ───────────────────────────────────────────────────────────────────────
   DESKTOP — AT A GLANCE STATS
   ─────────────────────────────────────────────────────────────────────── */
function renderGlanceStats(sites) {
  const total   = sites.length;
  const recheck = sites.filter(s =>
    s.status === "potential_break" || s.status === "needs_recheck"
  ).length;
  const normal  = sites.filter(s => s.status === "normal").length;
  const nodata  = sites.filter(s =>
    s.status === "no_data" || s.status === "unknown" || s.status === "insufficient_baseline"
  ).length;

  setText("dtTotalSites",   total);
  setText("dtRecheckCount", recheck);
  setText("dtNormalCount",  normal);
  setText("dtNoDataCount",  nodata);
}

/* ───────────────────────────────────────────────────────────────────────
   DESKTOP — MAP PINS  (refresh after analysis loads)
   ─────────────────────────────────────────────────────────────────────── */
function buildMapSites(sites) {
  // Convert API status values to the format MapModule expects
  return sites.map(s => ({
    ...s,
    status: toMapStatus(s.status),
  }));
}

/* ───────────────────────────────────────────────────────────────────────
   DESKTOP — NAV LINKS
   ─────────────────────────────────────────────────────────────────────── */
function wireDesktopNav() {
  document.querySelectorAll(".dt-nav-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".dt-nav-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
    });
  });
}

/* ───────────────────────────────────────────────────────────────────────
   DESKTOP — MAP TILE SWITCHER
   ─────────────────────────────────────────────────────────────────────── */
function wireMapTypeBtns() {
  document.querySelectorAll(".dt-map-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dt-map-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const type = btn.id.replace("btn", "").toLowerCase();
      MapModule.switchTile(type);
    });
  });
}

/* ───────────────────────────────────────────────────────────────────────
   DESKTOP — RANGE DROPDOWN
   ─────────────────────────────────────────────────────────────────────── */
function wireRangeDropdown() {
  const sel = el("dtRangeSelect");
  if (!sel) return;
  sel.addEventListener("change", async () => {
    if (!App.selectedSiteId) return;
    // Bust cache and re-fetch
    delete App.analysisCache[App.selectedSiteId];
    const analysis = await fetchAnalysis(App.selectedSiteId);
    if (analysis?.trend?.length) {
      const unit = fmtUnit(analysis.unit || "");
      ChartModule.init("dtTrendChart", analysis.trend, unit);
      const trendCount = analysis.trend.length;
      setText("dtChartSub",
        `Last ${trendCount} days · ${(analysis.site_name || "").split(" ").slice(0, 4).join(" ")}`
      );
    }
  });
}

/* ───────────────────────────────────────────────────────────────────────
   SITE SELECTION  (desktop + mobile shared)
   ─────────────────────────────────────────────────────────────────────── */
async function selectSite(siteId) {
  App.selectedSiteId = siteId;
  const site = App.sites.find(s => s.id === siteId);
  if (!site) return;

  // Scroll data column to top
  const dataCol = document.querySelector(".dt-data-col");
  if (dataCol) dataCol.scrollTop = 0;

  // Show loading state immediately
  showSiteCardLoading();

  // Update mobile pill
  setText("mobPillName", site.name);
  setText("mobPillLoc",  site.location);

  // Focus map on this site
  MapModule.focusSite(siteId, buildMapSites(App.sites));

  // Fetch real analysis from API
  const analysis = await fetchAnalysis(siteId);
  if (!analysis) {
    setText("dtSiteName", site.name);
    setText("dtSiteLocation", site.location);
    const badge = el("dtStatusBadge");
    if (badge) {
      badge.className   = "badge badge-nodata";
      badge.textContent = "Data unavailable";
    }
    return;
  }

  // ── Desktop card ──────────────────────────────────────────────────
  renderDesktopSiteCard(site, analysis);

  // After analysis loads, refresh map pins with real status
  MapModule.focusSite(siteId, buildMapSites(App.sites));

  // Update glance stats with live statuses
  renderGlanceStats(App.sites);

  // ── Mobile result screen ──────────────────────────────────────────
  const unit = fmtUnit(analysis.unit || site.unit || "");
  setText("mobResultSiteName", analysis.site_name || site.name);
  const { date, time } = fmtTimestamp(analysis.timestamp);
  setText("mobResultSiteDate", `${date} · ${time}`);

  // Result headline and observation text
  const mobHeadline = document.querySelector(".mob-result-headline");
  const mobObs      = el("mobResultObsText");

  if (analysis.status === "potential_break") {
    if (mobHeadline) mobHeadline.innerHTML =
      `YOUR REPORT <span class="mob-result-accent">DIFFERS</span><br>from this stream's normal pattern`;
    if (mobObs) mobObs.textContent =
      `Current ${(analysis.parameter_name || "reading").toLowerCase()} ` +
      `(${analysis.current_value?.toFixed(1)} ${unit}) is ` +
      `${Math.abs(analysis.deviation_pct ?? 0).toFixed(0)}% ` +
      `${analysis.direction === "above" ? "above" : "below"} ` +
      `the normal range. Please review the observation.`;
    // Swap result circle to amber/red
    const circle = document.querySelector(".mob-result-circle");
    if (circle) circle.style.filter = "drop-shadow(0 0 20px rgba(251,191,36,0.6))";
    if (circle) {
      circle.querySelector("path")?.setAttribute("stroke", "#fbbf24");
      circle.querySelectorAll("circle").forEach(c => {
        c.setAttribute("stroke", "#fbbf24");
      });
    }
  } else {
    if (mobHeadline) mobHeadline.innerHTML =
      `YOUR REPORT <span class="mob-result-accent">MATCHES</span><br>this stream's normal pattern`;
    if (mobObs) mobObs.textContent =
      `${analysis.explanation?.[0] ?? "Your observation is within the usual range for this site. Thanks for checking!"}`;
    // Reset circle to green
    const circle = document.querySelector(".mob-result-circle");
    if (circle) circle.style.filter = "drop-shadow(0 0 20px rgba(74,222,128,0.5))";
  }
}

/* ───────────────────────────────────────────────────────────────────────
   MOBILE — SCREEN NAVIGATION
   ─────────────────────────────────────────────────────────────────────── */
const MOB_SCREENS = {
  home:    "mobHome",
  check:   "mobCheckScreen",
  result:  "mobResultScreen",
  map:     "mobMapScreen",
  learn:   "mobHome",
  profile: "mobHome",
};

function showMobScreen(name) {
  Object.values(MOB_SCREENS).forEach(id => {
    el(id)?.classList.remove("active");
  });
  const target = MOB_SCREENS[name] ?? "mobHome";
  const scr = el(target);
  if (scr) {
    scr.classList.add("active");
    if (name === "map") {
      MapModule.invalidate();
      if (!App.mapReady && App.sites.length) {
        MapModule.initMobile("mobMap", buildMapSites(App.sites), App.selectedSiteId, selectSite);
        App.mapReady = true;
      }
    }
  }
  document.querySelectorAll(".mob-nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.screen === name);
  });
}

function wireMobileNav() {
  document.querySelectorAll(".mob-nav-item").forEach(item => {
    item.addEventListener("click", e => {
      e.preventDefault();
      showMobScreen(item.dataset.screen);
    });
  });

  el("mobStartCheck")?.addEventListener("click", () => {
    resetWizard();
    showMobScreen("check");
  });
  el("mobCheckBack")?.addEventListener("click", () => showMobScreen("home"));
  el("mobMapBack")?.addEventListener("click",   () => showMobScreen("home"));
  el("mobSubmitAnother")?.addEventListener("click", () => {
    resetWizard();
    showMobScreen("check");
  });
  el("mobViewData")?.addEventListener("click",  () => showMobScreen("home"));
  el("mobSitePill")?.addEventListener("click",  () => showMobScreen("map"));
}

/* ───────────────────────────────────────────────────────────────────────
   MOBILE — CHECK WIZARD
   ─────────────────────────────────────────────────────────────────────── */
function resetWizard() {
  App.wizard = { step: 1, total: 6, answers: {}, selected: null };
  updateWizardUI();
  document.querySelectorAll(".mob-tile").forEach(t => t.classList.remove("selected"));
  const cont = el("mobContinueBtn");
  if (cont) cont.disabled = true;
}

function updateWizardUI() {
  const { step, total } = App.wizard;
  const pct = ((step - 1) / total * 100).toFixed(0);
  const fill = el("mobProgressFill");
  if (fill) fill.style.width = pct + "%";
  setText("mobStepLabel", `${step} / ${total}`);
}

function wireTiles() {
  document.querySelectorAll(".mob-tile").forEach(tile => {
    tile.addEventListener("click", () => {
      document.querySelectorAll(".mob-tile").forEach(t => t.classList.remove("selected"));
      tile.classList.add("selected");
      App.wizard.selected = tile.dataset.value;
      const cont = el("mobContinueBtn");
      if (cont) cont.disabled = false;
    });
  });
}

function wireContinueBtn() {
  const btn = el("mobContinueBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!App.wizard.selected) return;
    App.wizard.answers["clarity"] = App.wizard.selected;
    App.wizard.step = Math.min(App.wizard.step + 1, App.wizard.total);
    updateWizardUI();

    // Map tile selection to a review decision
    const decision = App.wizard.selected === "clear" ? "confirmed" : "unsure";
    await ReviewModule.wireMobileResult(App.selectedSiteId ?? "unknown", decision);

    // Navigate to result — content already populated by selectSite()
    showMobScreen("result");
  });
}

/* ───────────────────────────────────────────────────────────────────────
   MOBILE — WEEKLY STREAK  (UI display only — no real data needed)
   ─────────────────────────────────────────────────────────────────────── */
function renderWeekRow() {
  const container = el("mobWeekRow");
  if (!container) return;

  const days      = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const today     = new Date().getDay();          // 0=Sun…6=Sat
  const todayMon  = (today + 6) % 7;             // 0=Mon…6=Sun
  // Mark all days before today as done
  const checkSvg  = (col) =>
    `<svg viewBox="0 0 16 16" width="16"><path d="M3 8l4 4 6-6" stroke="${col}" stroke-width="1.5" fill="none"/></svg>`;

  container.innerHTML = days.map((day, i) => {
    let dotClass, inner;
    if (i === todayMon) {
      dotClass = "today";
      inner    = checkSvg("#fff");
    } else if (i < todayMon) {
      dotClass = "done";
      inner    = checkSvg("#22d3ee");
    } else {
      dotClass = "empty";
      inner    = "";
    }
    return `<div class="mob-week-item">
      <div class="mob-week-day">${day}</div>
      <div class="mob-week-dot ${dotClass}">${inner}</div>
    </div>`;
  }).join("");
}

/* ───────────────────────────────────────────────────────────────────────
   BOOT
   ─────────────────────────────────────────────────────────────────────── */
async function boot() {
  App.isMobile = isMobileLayout();

  startClock();
  wireDesktopNav();
  wireMapTypeBtns();
  wireRangeDropdown();
  wireEvidenceClose();
  wireMobileNav();
  wireTiles();
  wireContinueBtn();
  renderWeekRow();

  // ── Load sites ────────────────────────────────────────────────────
  App.sites = await fetchSites();
  if (!App.sites.length) {
    console.warn("[App] No sites returned from /api/sites");
    return;
  }

  // Initial glance stats (may show 'unknown' status until analyses load)
  renderGlanceStats(App.sites);

  // ── Init desktop map ──────────────────────────────────────────────
  if (!App.isMobile) {
    MapModule.initDesktop("dtMap", buildMapSites(App.sites), null, selectSite);
  }

  // ── Select default site ───────────────────────────────────────────
  // Prefer a site already known to need review; fall back to first
  const defaultSite =
    App.sites.find(s => s.status === "potential_break" || s.status === "needs_recheck")
    ?? App.sites[0];
  await selectSite(defaultSite.id);

  // ── Background: pre-fetch remaining sites so map pins get real status
  _prefetchRemainingAnalyses();

  // ── Resize handler ────────────────────────────────────────────────
  window.addEventListener("resize", () => {
    const nowMobile = isMobileLayout();
    if (nowMobile !== App.isMobile) {
      App.isMobile = nowMobile;
      if (!nowMobile) MapModule.invalidate();
    }
  });
}

/* Pre-fetch analysis for all sites in the background so map pins
   show real colours without waiting for the user to select each one. */
async function _prefetchRemainingAnalyses() {
  const remaining = App.sites.filter(s => s.id !== App.selectedSiteId);
  for (const site of remaining) {
    await fetchAnalysis(site.id);
    // Refresh map and glance stats after each one comes in
    MapModule.initDesktop("dtMap", buildMapSites(App.sites), App.selectedSiteId, selectSite);
    renderGlanceStats(App.sites);
    // Small yield so we don't block UI
    await new Promise(r => setTimeout(r, 200));
  }
}

/* ── Wait for DOM ── */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

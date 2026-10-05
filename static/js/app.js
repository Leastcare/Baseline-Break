"use strict";

const App = {
  sites:          [],
  selectedSiteId: null,
  analysisCache:  {},
  isMobile:       false,
  mapReady:       false,

  wizard: {
    step:     1,
    total:    6,
    answers:  {},
    selected: null,
  },
};

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

function fmtUnit(raw) {
  if (!raw) return "";
  return raw.replace("^3", "³");
}

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

function toMapStatus(apiStatus) {
  return {
    normal:                "normal",
    potential_break:       "needs_recheck",
    no_data:               "no_data",
    insufficient_baseline: "no_data",
    unknown:               "no_data",
  }[apiStatus] ?? "no_data";
}

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
  if (App.analysisCache[siteId]) return App.analysisCache[siteId];
  try {
    const r = await fetch(`/api/analyze/${siteId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    App.analysisCache[siteId] = d;
    const site = App.sites.find(s => s.id === siteId);
    if (site) site.status = d.status ?? "unknown";
    return d;
  } catch (e) {
    console.error("[App] fetchAnalysis failed:", siteId, e);
    return null;
  }
}

function startClock() {
  function tick() {
    const { date, time } = fmtNow();
    setText("dtDate", date);
    setText("dtTime", time);
    const t24 = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).slice(0, 5);
    setText("mobTime", t24);
  }
  tick();
  setInterval(tick, 30_000);
}

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

function renderDesktopSiteCard(site, analysis) {
  if (!site || !analysis) return;

  const unit = fmtUnit(analysis.unit || site.unit || "");

  setText("dtSiteName",     analysis.site_name || site.name);
  setText("dtSiteLocation", analysis.location  || site.location);
  setText("dtReadingLabel", analysis.parameter_name || "Streamflow");

  const { date, time } = fmtTimestamp(analysis.timestamp);
  setText("dtReadingDate", date);
  setText("dtReadingTime", time);

  setText("dtReadingNumber",
    analysis.current_value != null ? analysis.current_value.toFixed(1) : "—"
  );
  setText("dtReadingUnit", unit);

  const deltaEl = el("dtReadingDelta");
  if (deltaEl) {
    if (analysis.status === "potential_break" && analysis.deviation_pct != null) {
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

  const badgeEl = el("dtStatusBadge");
  if (badgeEl) {
    badgeEl.className = `badge ${statusBadgeClass(analysis.status)}`;
    badgeEl.textContent = statusLabel(analysis.status);
  }

  const paramName = analysis.parameter_name || "Streamflow";
  setText("dtChartTitle", `${paramName} Trend`);
  const trendCount = analysis.trend?.length ?? 0;
  setText("dtChartSub",
    `Last ${trendCount} days · ${(analysis.site_name || site.name).split(" ").slice(0, 4).join(" ")}`
  );

  if (analysis.trend && analysis.trend.length) {
    ChartModule.init("dtTrendChart", analysis.trend, unit);
  }

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

  hideEl("dtEvidencePanel");

  if (analysis.baseline_warning) {
    console.warn("[App] Baseline warning:", analysis.baseline_warning);
  }
}

function showEvidencePanel(analysis, unit) {
  const panel = el("dtEvidencePanel");
  if (!panel) return;
  showEl("dtEvidencePanel");

  const val = analysis.current_value != null
    ? `${analysis.current_value.toFixed(1)} ${unit}`
    : "—";
  setText("dtEvCurrent", val);

  const lo = analysis.baseline_lower != null ? analysis.baseline_lower.toFixed(1) : "—";
  const hi = analysis.baseline_upper != null ? analysis.baseline_upper.toFixed(1) : "—";
  setText("dtEvRange", `${lo} – ${hi} ${unit}`);

  setText("dtEvScore",
    analysis.anomaly_score != null ? analysis.anomaly_score.toFixed(2) : "—"
  );

  const reasonsEl = el("dtEvReasons");
  if (reasonsEl) {
    reasonsEl.innerHTML = (analysis.explanation ?? [])
      .map(r => `<div class="reason-item">${escHtml(r)}</div>`)
      .join("");
  }

  ReviewModule.wireDesktop(App.selectedSiteId);

  const fb = el("dtReviewFeedback");
  if (fb) { hideEl("dtReviewFeedback"); fb.textContent = ""; }
  document.querySelectorAll(".dt-review-btn").forEach(b => (b.disabled = false));

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function wireEvidenceClose() {
  const btn = el("dtEvidenceClose");
  if (btn) btn.onclick = () => hideEl("dtEvidencePanel");
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

function buildMapSites(sites) {
  return sites.map(s => ({
    ...s,
    status: toMapStatus(s.status),
  }));
}

const DT_PANELS = {
  overview:  "panelOverview",
  sites:     "panelSites",
  trends:    "panelTrends",
  community: "panelCommunity",
  reports:   "panelReports",
};

function switchDesktopPanel(page) {
  Object.values(DT_PANELS).forEach(id => {
    el(id)?.classList.remove("active");
  });
  const targetId = DT_PANELS[page] ?? "panelOverview";
  el(targetId)?.classList.add("active");

  const dataCol = document.querySelector(".dt-data-col");
  if (dataCol) dataCol.scrollTop = 0;

  if (page === "sites")     renderSitesPanel();
  if (page === "trends")    renderTrendsPanel();
  if (page === "community") renderCommunityPanel();
  if (page === "reports")   renderReportsPanel();
}

function wireDesktopNav() {
  document.querySelectorAll(".dt-nav-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      document.querySelectorAll(".dt-nav-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      const page = link.dataset.page ?? "overview";
      switchDesktopPanel(page);
    });
  });
}

function renderSitesPanel() {
  const container = el("dtSitesList");
  if (!container || !App.sites.length) return;
  container.innerHTML = App.sites.map(site => {
    const cached  = App.analysisCache[site.id];
    const status  = cached?.status ?? site.status ?? "unknown";
    const valStr  = cached?.current_value != null
      ? `${cached.current_value.toFixed(1)} ${fmtUnit(cached.unit || "")}`
      : "—";
    return `
      <div class="dt-site-row" onclick="selectSite('${site.id}'); switchDesktopPanel('overview'); document.querySelectorAll('.dt-nav-link').forEach(l => l.classList.toggle('active', l.dataset.page==='overview'))">
        <span class="dt-site-row-dot ${status}"></span>
        <div class="dt-site-row-info">
          <div class="dt-site-row-name">${escHtml(site.name)}</div>
          <div class="dt-site-row-loc">${escHtml(site.location ?? site.state ?? "")}</div>
        </div>
        <div class="dt-site-row-val">${valStr}</div>
        <span class="dt-site-row-arrow">›</span>
      </div>`;
  }).join("");
}

function renderTrendsPanel() {
  if (!App.selectedSiteId) return;
  const analysis = App.analysisCache[App.selectedSiteId];
  if (!analysis) return;

  const unit = fmtUnit(analysis.unit || "");
  setText("dtTrendsTitle", `${analysis.parameter_name || "Streamflow"} Trend`);
  setText("dtTrendsSub",   `Last ${analysis.trend?.length ?? 0} days · ${analysis.site_name || ""}`);
  setText("dtTrendsCurrent", analysis.current_value != null ? `${analysis.current_value.toFixed(1)} ${unit}` : "—");
  setText("dtTrendsMedian",  analysis.baseline_median != null ? `${analysis.baseline_median.toFixed(1)} ${unit}` : "—");
  setText("dtTrendsRange",
    analysis.baseline_lower != null && analysis.baseline_upper != null
      ? `${analysis.baseline_lower.toFixed(1)} – ${analysis.baseline_upper.toFixed(1)} ${unit}`
      : "—"
  );
  setText("dtTrendsScore", analysis.anomaly_score != null ? analysis.anomaly_score.toFixed(2) : "—");

  if (analysis.trend?.length) {
    const canvas = el("dtTrendsChart");
    if (canvas) ChartModule.init("dtTrendsChart", analysis.trend, unit);
  }
}

function renderCommunityPanel() {
  if (!App.selectedSiteId) return;
  const analysis = App.analysisCache[App.selectedSiteId];
  if (!analysis?.one_health) return;

  const oh = analysis.one_health;
  if (oh.ecosystem)   setText("dtCommunityEco",     oh.ecosystem);
  if (oh.animals)     setText("dtCommunityAnimals",  oh.animals);
  if (oh.people)      setText("dtCommunityPeople",   oh.people);
  if (oh.disclaimer)  setText("dtCommunityDisclaimer", oh.disclaimer);
}

function renderReportsPanel() {
  const container = el("dtReportsList");
  if (!container) return;

  const entries = Object.entries(App.analysisCache);
  if (!entries.length) {
    container.innerHTML = `<div style="color:var(--dt-text-muted);font-size:0.82rem;padding:16px">No analysis data loaded yet. Select a site first.</div>`;
    return;
  }

  container.innerHTML = entries.map(([siteId, analysis]) => {
    const status   = analysis.status ?? "unknown";
    const dotColor = {
      normal:          "#4ade80",
      potential_break: "#fbbf24",
      no_data:         "#6b7280",
    }[status] ?? "#6b7280";

    const { date, time } = fmtTimestamp(analysis.timestamp);
    const unit    = fmtUnit(analysis.unit || "");
    const valStr  = analysis.current_value != null
      ? `${analysis.current_value.toFixed(1)} ${unit}`
      : "No data";
    const expStr  = analysis.explanation?.[0] ?? statusLabel(status);

    return `
      <div class="dt-report-row">
        <div class="dt-report-status-dot" style="background:${dotColor};box-shadow:0 0 6px ${dotColor}"></div>
        <div class="dt-report-info">
          <div class="dt-report-site">${escHtml(analysis.site_name || siteId)}</div>
          <div class="dt-report-detail">${escHtml(expStr)}</div>
          <div class="dt-report-time">${date} ${time} · ${analysis.approval_status ?? ""}</div>
        </div>
        <div class="dt-site-row-val">${valStr}</div>
      </div>`;
  }).join("");
}

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

function wireRangeDropdown() {
  const sel = el("dtRangeSelect");
  if (!sel) return;
  sel.addEventListener("change", async () => {
    if (!App.selectedSiteId) return;
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

async function selectSite(siteId) {
  App.selectedSiteId = siteId;
  const site = App.sites.find(s => s.id === siteId);
  if (!site) return;

  const dataCol = document.querySelector(".dt-data-col");
  if (dataCol) dataCol.scrollTop = 0;

  showSiteCardLoading();

  setText("mobPillName", site.name);
  setText("mobPillLoc",  site.location);

  MapModule.focusSite(siteId, buildMapSites(App.sites));

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

  renderDesktopSiteCard(site, analysis);

  MapModule.focusSite(siteId, buildMapSites(App.sites));

  renderGlanceStats(App.sites);

  const activePanel = document.querySelector(".dt-panel-view.active");
  if (activePanel?.id === "panelTrends")    renderTrendsPanel();
  if (activePanel?.id === "panelCommunity") renderCommunityPanel();
  if (activePanel?.id === "panelReports")   renderReportsPanel();

  const unit = fmtUnit(analysis.unit || site.unit || "");
  setText("mobResultSiteName", analysis.site_name || site.name);
  const { date, time } = fmtTimestamp(analysis.timestamp);
  setText("mobResultSiteDate", `${date} · ${time}`);

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
    const circle = document.querySelector(".mob-result-circle");
    if (circle) circle.style.filter = "drop-shadow(0 0 20px rgba(74,222,128,0.5))";
  }
}

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

    const decision = App.wizard.selected === "clear" ? "confirmed" : "unsure";
    await ReviewModule.wireMobileResult(App.selectedSiteId ?? "unknown", decision);

    showMobScreen("result");
  });
}

function renderWeekRow() {
  const container = el("mobWeekRow");
  if (!container) return;

  const days      = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const today     = new Date().getDay();
  const todayMon  = (today + 6) % 7;
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

  App.sites = await fetchSites();
  if (!App.sites.length) {
    console.warn("[App] No sites returned from /api/sites");
    return;
  }

  renderGlanceStats(App.sites);

  if (!App.isMobile) {
    MapModule.initDesktop("dtMap", buildMapSites(App.sites), null, selectSite);
  }

  const defaultSite =
    App.sites.find(s => s.status === "potential_break" || s.status === "needs_recheck")
    ?? App.sites[0];
  await selectSite(defaultSite.id);

  _prefetchRemainingAnalyses();

  window.addEventListener("resize", () => {
    const nowMobile = isMobileLayout();
    if (nowMobile !== App.isMobile) {
      App.isMobile = nowMobile;
      if (!nowMobile) MapModule.invalidate();
    }
  });
}

async function _prefetchRemainingAnalyses() {
  const remaining = App.sites.filter(s => s.id !== App.selectedSiteId);
  for (const site of remaining) {
    await fetchAnalysis(site.id);
    MapModule.initDesktop("dtMap", buildMapSites(App.sites), App.selectedSiteId, selectSite);
    renderGlanceStats(App.sites);
    await new Promise(r => setTimeout(r, 200));
  }
}

function runSplash(onDone) {
  const splash = document.getElementById("splashScreen");
  const fill   = document.getElementById("splashLoaderFill");
  const text   = document.getElementById("splashLoaderText");
  if (!splash) { onDone(); return; }

  const steps = [
    { pct: 20,  msg: "Connecting to USGS Water Data...",   delay: 100  },
    { pct: 45,  msg: "Fetching river monitoring sites...", delay: 500  },
    { pct: 65,  msg: "Building site baselines...",         delay: 1000 },
    { pct: 85,  msg: "Running anomaly detection...",       delay: 1600 },
    { pct: 100, msg: "Ready.",                             delay: 2100 },
  ];

  steps.forEach(({ pct, msg, delay }) => {
    setTimeout(() => {
      if (fill) fill.style.width = pct + "%";
      if (text) text.textContent = msg;
    }, delay);
  });

  setTimeout(() => {
    splash.classList.add("hidden");
    setTimeout(onDone, 650);
  }, 2600);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => runSplash(boot));
} else {
  runSplash(boot);
}

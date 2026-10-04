/* ═══════════════════════════════════════════════════════════════════════
   chart-module.js  —  Water Clarity Trend (Chart.js)
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

const ChartModule = (() => {
  let _chart = null;
  let _unit  = "";
  const TEAL   = "#2dd4bf";
  const WARN   = "#fbbf24";
  const BAND   = "rgba(45,212,191,0.08)";
  const GRID   = "rgba(45,212,191,0.06)";
  const TEXT   = "#7fa9b5";

  /* ── Build a gradient fill for the observed line ── */
  function _makeGradient(ctx, chartArea) {
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0,   "rgba(45,212,191,0.35)");
    g.addColorStop(0.5, "rgba(45,212,191,0.08)");
    g.addColorStop(1,   "rgba(45,212,191,0)");
    return g;
  }

  /* ── Convert API trend array into Chart.js datasets ── */
  function _buildDatasets(trend, ctx, chartArea) {
    const labels  = trend.map(p => p.date.slice(5));   // "MM-DD"
    const values  = trend.map(p => p.value);
    const alerts  = trend.map(p => p.alert ? p.value : null);

    // Baseline band: we derive upper/lower from the non-spike portion
    const normal  = trend.filter(p => !p.alert).map(p => p.value);
    const center  = _median(normal);
    const spread  = _mad(normal) * 1.4826 * 1.5;        // ±1.5σ band
    const upper   = trend.map(() => +(center + spread).toFixed(1));
    const lower   = trend.map(() => +(center - spread).toFixed(1));

    const gradient = chartArea ? _makeGradient(ctx, chartArea) : "rgba(45,212,191,0.15)";

    return {
      labels,
      datasets: [
        // Shaded normal band — upper boundary (invisible line)
        {
          label: "_upper",
          data: upper,
          borderWidth: 0,
          pointRadius: 0,
          fill: "+1",
          backgroundColor: BAND,
          tension: 0.4,
        },
        // Shaded normal band — lower boundary (invisible line)
        {
          label: "_lower",
          data: lower,
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
          tension: 0.4,
        },
        // Normal range border (dashed)
        {
          label: "Normal range",
          data: upper,
          borderColor: "rgba(255,255,255,0.18)",
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0.4,
        },
        // Observed line
        {
          label: "Observed value",
          data: values,
          borderColor: TEAL,
          borderWidth: 2.5,
          pointBackgroundColor: trend.map(p =>
            p.alert ? WARN : TEAL
          ),
          pointBorderColor: trend.map(p =>
            p.alert ? WARN : TEAL
          ),
          pointRadius: trend.map(p => p.alert ? 7 : 4),
          pointHoverRadius: 8,
          fill: true,
          backgroundColor: gradient,
          tension: 0.4,
          z: 10,
        },
        // Alert highlight dots (separate layer so they render on top)
        {
          label: "Alert",
          data: alerts,
          borderColor: WARN,
          backgroundColor: WARN,
          pointRadius: 9,
          pointBorderWidth: 2,
          pointBorderColor: "#0a2535",
          showLine: false,
          fill: false,
        },
      ],
    };
  }

  /* ── Robust stats helpers ── */
  function _median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function _mad(arr) {
    const med = _median(arr);
    return _median(arr.map(v => Math.abs(v - med)));
  }

  /* ── Initialise or re-draw chart ── */
  function init(canvasId, trend, unit) {
    _unit = unit || "";
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    if (_chart) { _chart.destroy(); _chart = null; }

    const initialData = _buildDatasets(trend, ctx, null);

    _chart = new Chart(ctx, {
      type: "line",
      data: initialData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(6,26,36,0.95)",
            borderColor: "rgba(45,212,191,0.25)",
            borderWidth: 1,
            titleColor: "#e2f4f1",
            bodyColor: "#7fa9b5",
            padding: 12,
            cornerRadius: 10,
            callbacks: {
              label(ctx) {
                if (ctx.dataset.label.startsWith("_")) return null;
                if (ctx.dataset.label === "Alert" && ctx.raw === null) return null;
                const val = ctx.raw !== null ? ctx.raw.toFixed(1) : null;
                if (val === null) return null;
                const unitStr = _unit ? ` ${_unit}` : "";
                const flag = ctx.dataset.label === "Alert" ? " ⚠ ALERT" : "";
                return ` ${ctx.dataset.label}: ${val}${unitStr}${flag}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: GRID },
            ticks: { color: TEXT, font: { size: 11 }, maxTicksLimit: 10 },
            border: { color: "transparent" },
          },
          y: {
            grid: { color: GRID },
            ticks: { color: TEXT, font: { size: 11 } },
            border: { color: "transparent" },
          },
        },
        animation: { duration: 500, easing: "easeInOutQuart" },
      },
      plugins: [
        {
          // Rebuild gradient after initial render (needs chartArea)
          id: "gradientFill",
          afterLayout(chart) {
            const ds = chart.data.datasets.find(d => d.label === "Observed value");
            if (ds && chart.chartArea) {
              ds.backgroundColor = _makeGradient(
                chart.ctx,
                chart.chartArea
              );
            }
          },
        },
      ],
    });
  }

  /* ── Public API ── */
  return { init };
})();

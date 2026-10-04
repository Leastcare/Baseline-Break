/* ═══════════════════════════════════════════════════════════════════════
   review.js  —  Human review submit (desktop + mobile)
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

const ReviewModule = (() => {
  /* ── POST /api/review ── */
  async function submit(seriesId, decision, note = "") {
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series_id: seriesId, decision, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      return { ok: true, reviewId: data.review_id };
    } catch (err) {
      console.error("[ReviewModule] submit error:", err);
      return { ok: false, error: err.message };
    }
  }

  /* ── Wire desktop review buttons ── */
  function wireDesktop(seriesId) {
    const btns      = document.querySelectorAll(".dt-review-btn");
    const feedback  = document.getElementById("dtReviewFeedback");
    if (!btns.length) return;

    btns.forEach(btn => {
      // Clone to remove any previous listeners
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);

      fresh.addEventListener("click", async () => {
        const decision = fresh.dataset.decision;
        // Disable all while submitting
        document.querySelectorAll(".dt-review-btn").forEach(b => (b.disabled = true));

        const result = await submit(seriesId, decision);

        if (feedback) {
          feedback.classList.remove("hidden");
          if (result.ok) {
            const msgs = {
              confirmed: "✓ Observation confirmed — thank you for your review.",
              rejected:  "✓ Noted — marked as not unusual. Thank you.",
              unsure:    "✓ Recorded as uncertain. Thanks for checking.",
            };
            feedback.textContent = msgs[decision] ?? "Review submitted.";
            feedback.style.color = "var(--dt-teal)";
          } else {
            feedback.textContent = "⚠ Could not submit review right now.";
            feedback.style.color = "var(--dt-warn)";
            // Re-enable on error
            document.querySelectorAll(".dt-review-btn")
              .forEach(b => (b.disabled = false));
          }
        }
      });
    });
  }

  /* ── Wire mobile result screen review ── */
  function wireMobileResult(seriesId, decision) {
    // Mobile result is shown after the wizard completes;
    // the decision is already captured from the tile selection.
    return submit(seriesId, decision);
  }

  return { submit, wireDesktop, wireMobileResult };
})();

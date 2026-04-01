/**
 * analytics.js — Vercel Web Analytics integration (generic / non-framework).
 *
 * Uses the same script-injection approach as @vercel/analytics `inject()`,
 * without requiring a bundler.  The analytics script is only loaded in
 * production (on Vercel); in local dev it is a no-op.
 */

var ANALYTICS_SRC = "/_vercel/insights/script.js";

/**
 * Initialise the Vercel Web Analytics queue and inject the tracking script.
 * Safe to call in any environment — script loading only happens in production.
 */
export function initAnalytics() {
  if (typeof window === "undefined") return;

  // Initialise the event queue (same pattern as the official SDK)
  if (!window.va) {
    window.va = function () {
      if (!window.vaq) window.vaq = [];
      window.vaq.push(arguments);
    };
  }

  // Avoid duplicate injection
  if (document.head.querySelector('script[src*="' + ANALYTICS_SRC + '"]')) return;

  var script = document.createElement("script");
  script.src = ANALYTICS_SRC;
  script.defer = true;
  script.dataset.sdkn = "@vercel/analytics";
  script.dataset.sdkv = "2.0.1";
  script.onerror = function () {
    // Expected to fail in local dev — only works when deployed on Vercel
    console.log("[Analytics] Script not loaded (expected outside Vercel).");
  };
  document.head.appendChild(script);
}

/**
 * Track a custom analytics event.
 * @param {string} name  — event name (e.g. "sonar_search")
 * @param {Object} [properties] — optional key/value pairs (strings or numbers)
 */
export function trackEvent(name, properties) {
  if (typeof window === "undefined" || !window.va) return;
  if (properties) {
    window.va("event", { name: name, data: properties });
  } else {
    window.va("event", { name: name });
  }
}

/**
 * Next.js instrumentation (v3.3.2) — boots the Always-Warm Engine with the
 * server. The engine core AND the dashboard stay hot WITHOUT any browser:
 * live ESPN feed, settlements, fresh quotes, the 45-minute The Odds API
 * credit shield AND the full dashboard-state build run on a self-healing
 * 10-minute loop in-process, so /api/bootstrap is never cold.
 */
export async function register() {
  // Only in the actual Node.js server runtime (skip edge + build phase).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWarmEngine } = await import("@/core/pipeline/warm-engine");
  startWarmEngine();
}

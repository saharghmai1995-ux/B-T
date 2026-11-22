/**
 * Next.js instrumentation (v2.5) — boots the Warm Engine with the server.
 * The engine keeps the dashboard always-hot: live ESPN feed, settlements,
 * fresh quotes and the 45-minute The Odds API credit shield run every
 * 10 minutes in-process, so /api/bootstrap is never cold.
 */
export async function register() {
  // Only in the actual Node.js server runtime (skip edge + build phase).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startWarmEngine } = await import("@/core/pipeline/warm-engine");
  startWarmEngine();
}

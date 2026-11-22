/**
 * Warm Engine (v2.5) — keeps the dashboard hot at all times.
 * A singleton server-side loop runs the live ingest (ESPN feed + settlement +
 * fresh quotes + The Odds API v4 45-minute credit shield) every 10 minutes,
 * so `/api/bootstrap` always serves a fresh, non-cold dashboard:
 *  - first warm-up fires 45s after boot (after Prisma is ready);
 *  - a mutex prevents overlapping runs;
 *  - failures are logged and swallowed — the loop never crashes the server.
 */

import { runIngest } from "./ingest-service";
import { db } from "@/lib/db";

const WARM_INTERVAL_MS = 10 * 60_000; // 10 minutes — well inside the 15-min stale window
const FIRST_TICK_DELAY_MS = 45_000;

const globalWarm = globalThis as unknown as {
  __neobetWarmEngine?: { started: boolean; running: boolean; lastRun: number | null; lastOk: boolean };
};

const state =
  globalWarm.__neobetWarmEngine ??
  (globalWarm.__neobetWarmEngine = { started: false, running: false, lastRun: null, lastOk: true });

/** Public snapshot for health endpoints/logs. */
export function warmEngineStats(): { started: boolean; running: boolean; lastRun: string | null; lastOk: boolean } {
  return {
    started: state.started,
    running: state.running,
    lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : null,
    lastOk: state.lastOk,
  };
}

async function tick(): Promise<void> {
  if (state.running) return; // mutex — never overlap
  state.running = true;
  try {
    // DB reachability guard: skip silently when Prisma/SQLite is not ready yet.
    await db.$queryRaw`SELECT 1`;
    await runIngest();
    state.lastOk = true;
  } catch (e) {
    state.lastOk = false;
    console.warn("[warm-engine] tick failed (will retry next cycle):", (e as Error).message);
  } finally {
    state.lastRun = Date.now();
    state.running = false;
  }
}

/** Idempotent — safe to call from instrumentation register(). */
export function startWarmEngine(): void {
  if (state.started) return;
  state.started = true;
  console.log("[warm-engine] started — dashboard stays warm every", WARM_INTERVAL_MS / 60000, "min");
  // v2.6: the broadcast dispatcher rides the same boot — the PUBLIC/VIP
  // channels are managed every 60s as long as the server is alive.
  void import("@/core/telegram/dispatcher").then(({ startBroadcastDispatcher }) => {
    startBroadcastDispatcher();
  }).catch((e) => console.warn("[warm-engine] dispatcher boot failed:", (e as Error).message));
  setTimeout(() => {
    void tick();
    const t = setInterval(() => void tick(), WARM_INTERVAL_MS);
    // Never keep the Node process alive just for the warm loop.
    if (typeof t.unref === "function") t.unref();
  }, FIRST_TICK_DELAY_MS);
}

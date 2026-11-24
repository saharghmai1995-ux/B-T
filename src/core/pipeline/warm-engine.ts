/**
 * Warm Engine (v3.3.2) — the engine core AND the dashboard stay hot at all
 * times WITHOUT any browser. A self-healing in-process loop:
 *   • boots 15s after server start (instrumentation register())
 *   • every 10 min: live ingest (ESPN feed + settlement + fresh quotes +
 *     The Odds API 45-minute credit shield) AND a FULL dashboard-state build
 *     (migrations, metrics, cards) — so /api/bootstrap is never cold
 *   • the built AppState is cached (45s TTL) and served instantly by
 *     /api/bootstrap — the first paint is hot even when no browser ever opened
 *   • chained setTimeout + mutex + failure backoff (60s retry): the loop can
 *     never overlap, a failed tick self-heals on a shorter cadence, and no
 *     error can ever crash the server
 */

import { runIngest } from "./ingest-service";
import { ensureBootstrapState, type AppState } from "./bootstrap-service";
import { db } from "@/lib/db";

const WARM_INTERVAL_MS = 10 * 60_000; // 10 minutes — well inside the 15-min stale window
const RETRY_INTERVAL_MS = 60_000; // fast self-heal after a failed tick
const FIRST_TICK_DELAY_MS = 15_000; // v3.3.2 — warm up 3x faster than v2.5
const STATE_CACHE_TTL_MS = 45_000; // /api/bootstrap serves the cached state for 45s

interface WarmState {
  started: boolean;
  running: boolean;
  lastRun: number | null;
  lastOk: boolean;
  ticks: number;
  failures: number;
  lastDurationMs: number | null;
  stateCache: { state: AppState; at: number } | null;
}

const globalWarm = globalThis as unknown as {
  __neobetWarmEngine?: WarmState;
};

const state =
  globalWarm.__neobetWarmEngine ??
  (globalWarm.__neobetWarmEngine = {
    started: false,
    running: false,
    lastRun: null,
    lastOk: true,
    ticks: 0,
    failures: 0,
    lastDurationMs: null,
    stateCache: null,
  });

/** Public snapshot for health endpoints/logs. */
export function warmEngineStats(): {
  started: boolean;
  running: boolean;
  lastRun: string | null;
  lastOk: boolean;
  ticks: number;
  failures: number;
  lastDurationMs: number | null;
  intervalMs: number;
  stateCacheFresh: boolean;
} {
  return {
    started: state.started,
    running: state.running,
    lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : null,
    lastOk: state.lastOk,
    ticks: state.ticks,
    failures: state.failures,
    lastDurationMs: state.lastDurationMs,
    intervalMs: WARM_INTERVAL_MS,
    stateCacheFresh: getCachedAppState() != null,
  };
}

/** v3.3.2 — the freshest dashboard state built by the warm loop (45s TTL). */
export function getCachedAppState(): AppState | null {
  const c = state.stateCache;
  if (!c) return null;
  if (Date.now() - c.at > STATE_CACHE_TTL_MS) return null;
  return c.state;
}

/** Store a freshly built state so the NEXT /api/bootstrap answers instantly. */
export function cacheAppState(appState: AppState): void {
  state.stateCache = { state: appState, at: Date.now() };
}

async function tick(): Promise<void> {
  if (state.running) return; // mutex — never overlap
  state.running = true;
  const t0 = Date.now();
  try {
    // DB reachability guard: skip silently when Prisma/SQLite is not ready yet.
    await db.$queryRaw`SELECT 1`;
    await runIngest();
    // v3.3.2 — build the FULL dashboard payload in-process (no browser needed):
    // migrations, metrics, cards and the cache the load route serves.
    const appState = await ensureBootstrapState();
    state.stateCache = { state: appState, at: Date.now() };
    state.ticks++;
    state.lastOk = true;
    state.lastDurationMs = Date.now() - t0;
    console.log(`[warm-engine] tick #${state.ticks} ok in ${state.lastDurationMs}ms — engine core + dashboard state cached (browser-independent)`);
  } catch (e) {
    state.lastOk = false;
    state.failures++;
    state.lastDurationMs = Date.now() - t0;
    console.warn("[warm-engine] tick failed (self-heal retry next cycle):", (e as Error).message);
  } finally {
    state.lastRun = Date.now();
    state.running = false;
  }
}

/**
 * v3.3.2 — self-healing chained timer: one tick at a time, normal 10-min
 * cadence, 60s fast retry after any failure. The chain can never overlap and
 * re-arms itself even when a tick throws — the sandbox stays warm and alive.
 */
function schedule(delayMs: number): void {
  const t = setTimeout(() => {
    void tick().finally(() => {
      schedule(state.lastOk ? WARM_INTERVAL_MS : RETRY_INTERVAL_MS);
    });
  }, delayMs);
  // Never keep the Node process alive JUST for the warm loop (the HTTP server
  // is the process owner; inside the sandbox server this always lives).
  if (typeof t.unref === "function") t.unref();
}

/** Idempotent — safe to call from instrumentation register(). */
export function startWarmEngine(): void {
  if (state.started) return;
  state.started = true;
  console.log("[warm-engine] v3.3.2 started — engine core + dashboard stay warm WITHOUT a browser every", WARM_INTERVAL_MS / 60000, "min");
  // v2.6 — the broadcast dispatcher rides the same boot: the PUBLIC/VIP
  // channels are managed every 60s as long as the server is alive.
  void import("@/core/telegram/dispatcher")
    .then(({ startBroadcastDispatcher }) => {
      startBroadcastDispatcher();
    })
    .catch((e) => console.warn("[warm-engine] dispatcher boot failed:", (e as Error).message));
  // v3.4 — the Telegram updater rides the same boot: @Aineobet_bot stays
  // LIVE (join requests, memberships, commands) without any browser open.
  void import("@/core/telegram/updater")
    .then(({ startTelegramUpdater }) => {
      startTelegramUpdater();
    })
    .catch((e) => console.warn("[warm-engine] telegram updater boot failed:", (e as Error).message));
  schedule(FIRST_TICK_DELAY_MS);
}

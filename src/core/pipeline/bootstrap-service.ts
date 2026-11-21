/**
 * Bootstrap Service — the single load route's brain.
 * Cold-Start Auto-Ingest: if the DB is empty, ingest runs synchronously so the
 * response NEVER comes back with zero matches. All views read from here.
 */

import { db } from "@/lib/db";
import { computeMasterMetrics } from "@/core/ledger/ledger-service";
import type { MasterMetrics, SettledRow, MatchContext } from "@/core/types";
import { runIngest, tehranDayKey, type IngestSummary } from "./ingest-service";
import { seedHistoricalLedger, type HistorySeedSummary } from "./history-seed";
import { getSettings, maskSettings, SETTING_KEYS } from "./settings";
import { shinDevig } from "@/core/math/devig";

export interface AppState {
  metrics: MasterMetrics;
  matches: AppMatch[];
  openSignals: AppSignal[];
  settledSignals: AppSignal[];
  shadowVetoes: Array<{ id: string; signalRef: string; reason: string; createdAt: string }>;
  settings: Record<string, string>;
  health: { espn: boolean; oddsApi: boolean; lastIngest: string | null; degraded: boolean; mode: "LIVE" | "SIM"; historySeed: string | null };
  ingestSummary: IngestSummary | null;
  historySeed: HistorySeedSummary | null;
  generatedAt: string;
}

export interface AppSignal {
  id: string;
  matchId: string;
  matchInfo: string;
  league: string;
  sport: string;
  line: string;
  marketKey: string;
  marketLabel: string;
  selection: string;
  modelProb: number;
  price: number;
  evPct: number;
  stake: number;
  stakeMode: string;
  status: string;
  netProfit: number | null;
  shaHash: string;
  dayKey: string;
  startTime: string;
  legs?: Array<{ label: string; price: number; prob: number }> | null;
  espnUrl: string;
  settledAt: string | null;
}

export interface AppMatch extends MatchContext {
  espnEventId: string;
  scores: { home: number | null; away: number | null };
  quotes: Array<{ marketKey: string; selection: string; price: number; trueProb: number; source: string }>;
}

/** Pure cold-start decision (unit-testable). */
export function resolveBootstrapAction(matchCount: number, lastRun: Date | null, maxAgeMs = 15 * 60_000): "AUTO_INGEST" | "REFRESH_STALE" | "OK" {
  if (matchCount === 0) return "AUTO_INGEST";
  if (!lastRun || Date.now() - lastRun.getTime() > maxAgeMs) return "REFRESH_STALE";
  return "OK";
}

const espnUrlFor = (sport: string, leagueCode: string, espnEventId: string): string =>
  sport === "tennis"
    ? `https://www.espn.com/tennis/match/_/id/${espnEventId}`
    : `https://www.espn.com/soccer/match/_/gameId/${espnEventId}`;

async function toAppSignals(rows: Awaited<ReturnType<typeof fetchSignals>>): Promise<AppSignal[]> {
  return rows.map((s) => ({
    id: s.id, matchId: s.matchId,
    matchInfo: `${s.match.homeName} vs ${s.match.awayName}`,
    league: s.match.league, sport: s.sport, line: s.line,
    marketKey: s.marketKey, marketLabel: s.marketLabel, selection: s.selection,
    modelProb: s.modelProb, price: s.price, evPct: s.evPct,
    stake: s.stake, stakeMode: s.stakeMode, status: s.status,
    netProfit: s.netProfit, shaHash: s.shaHash, dayKey: s.dayKey,
    startTime: s.match.startTime.toISOString(),
    legs: s.legs ? JSON.parse(s.legs) : null,
    espnUrl: espnUrlFor(s.sport, s.match.leagueCode, s.match.espnEventId),
    settledAt: s.settledAt?.toISOString() ?? null,
  }));
}

function fetchSignals() {
  return db.signal.findMany({
    include: { match: { select: { homeName: true, awayName: true, league: true, leagueCode: true, startTime: true, espnEventId: true } } },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
}

/** Assemble the full client state from the ledger (single source of truth). */
export async function bootstrapState(opts?: { ingestSummary?: IngestSummary | null; historySeed?: HistorySeedSummary | null }): Promise<AppState> {
  const [matchRows, signals, vetoes, settings, ingest] = await Promise.all([
    db.match.findMany({
      orderBy: { startTime: "asc" },
      include: { odds: { where: { bookmaker: { in: ["1XBET_EST", "1XBET_LIVE"] } } } },
    }),
    fetchSignals(),
    db.shadowVeto.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    getSettings(),
    db.ingestState.findUnique({ where: { id: "singleton" } }),
  ]);

  const settledRows: SettledRow[] = signals
    .filter((s) => s.status !== "OPEN")
    .map((s) => ({
      id: s.id, sport: s.sport, league: s.match.league, line: s.line,
      marketKey: s.marketKey, marketLabel: s.marketLabel, selection: s.selection,
      status: s.status as SettledRow["status"], netProfit: s.netProfit ?? 0,
      stake: s.stake, price: s.price, evPct: s.evPct, settledAt: s.settledAt,
      matchInfo: `${s.match.homeName} vs ${s.match.awayName}`,
    }));
  const openRows = signals.filter((s) => s.status === "OPEN").map((s) => ({ stake: s.stake }));
  const metrics = computeMasterMetrics(settledRows, openRows);

  const matches: AppMatch[] = matchRows.map((m) => ({
    id: m.id, espnEventId: m.espnEventId, sport: m.sport as "football" | "tennis",
    league: m.league, leagueCode: m.leagueCode, homeName: m.homeName, awayName: m.awayName,
    homeRank: m.homeRank, awayRank: m.awayRank, startTime: m.startTime,
    status: m.status, surface: m.surface, venue: m.venue, round: m.round,
    scores: { home: m.homeScore, away: m.awayScore },
    quotes: m.odds.map((q) => ({
      marketKey: q.marketKey, selection: q.selection, price: q.price,
      trueProb: q.trueProb, source: q.source,
    })),
  }));

  const open = signals.filter((s) => s.status === "OPEN");
  const settled = signals.filter((s) => s.status !== "OPEN");
  const [openSignals, settledSignals] = await Promise.all([
    toAppSignals(open), toAppSignals(settled),
  ]);

  // Feed mode honesty: the LAST ingest run decides whether the current board
  // is live ESPN data or the deterministic SIM fallback.
  let lastDegraded: boolean | undefined;
  if (ingest?.lastSummary) {
    try { lastDegraded = (JSON.parse(ingest.lastSummary) as { degraded?: boolean }).degraded; } catch { /* ignore */ }
  }
  const degraded = opts?.ingestSummary?.degraded ?? lastDegraded ?? false;

  return {
    metrics,
    matches,
    openSignals,
    settledSignals,
    shadowVetoes: vetoes.map((v) => ({
      id: v.id, signalRef: v.signalRef, reason: v.reason, createdAt: v.createdAt.toISOString(),
    })),
    settings: maskSettings(settings),
    health: {
      espn: matches.length > 0,
      oddsApi: !!settings[SETTING_KEYS.oddsApiKey],
      lastIngest: ingest?.lastRun.toISOString() ?? null,
      degraded,
      mode: degraded ? "SIM" : "LIVE",
      historySeed: settings["historySeededAt"] ?? null,
    },
    ingestSummary: opts?.ingestSummary ?? null,
    historySeed: opts?.historySeed ?? null,
    generatedAt: new Date().toISOString(),
  };
}

/** Cold-start entrypoint — guarantees a non-empty, populated response. */
export async function ensureBootstrapState(): Promise<AppState> {
  const matchCount = await db.match.count();
  const ingest = await db.ingestState.findUnique({ where: { id: "singleton" } });
  const action = resolveBootstrapAction(matchCount, ingest?.lastRun ?? null);
  let summary: IngestSummary | null = null;
  if (action === "AUTO_INGEST") {
    summary = await runIngest();
  }
  // Cold-start ledger backfill: real history seed when no settled rows exist.
  const settledCount = await db.signal.count({ where: { status: { not: "OPEN" } } });
  let seedSummary: HistorySeedSummary | null = null;
  if (settledCount === 0) {
    seedSummary = await seedHistoricalLedger();
    if (seedSummary.signalsSeeded > 0) {
      summary = summary ?? {
        matchesUpserted: 0, quotesUpserted: 0, signalsCreated: 0, settledCount: 0,
        accasCreated: 0, degraded: false, notes: ["Cold-start history seed applied"],
        ranAt: new Date().toISOString(),
      };
    }
  }
  const state = await bootstrapState({ ingestSummary: summary, historySeed: seedSummary });
  // Absolute guard: even in a total network outage, never return zero matches.
  if (state.matches.length === 0) {
    const again = await runIngest();
    if (again.matchesUpserted > 0) return bootstrapState({ ingestSummary: again, historySeed: seedSummary });
  }
  return state;
}

/** Reference-book helper for QuantLab: de-vig any 3-way book for display. */
export function devigDisplay(prices: number[]): number[] {
  return shinDevig(prices).map((p) => Math.round(p * 1000) / 10);
}

export { tehranDayKey };

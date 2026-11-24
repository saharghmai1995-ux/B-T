/**
 * Bootstrap Service — the single load route's brain.
 * Cold-Start Auto-Ingest: if the DB is empty, ingest runs synchronously.
 * v2.0: REAL-only backfill (past 7 days from ESPN), lock timestamps on every
 * card, richer shadow-vetoes and LIVE/OFFLINE health (no SIM mode exists).
 */

import { db } from "@/lib/db";
import { computeMasterMetrics } from "@/core/ledger/ledger-service";
import type { MasterMetrics, SettledRow, MatchContext } from "@/core/types";
import { runIngest, tehranDayKey, type IngestSummary } from "./ingest-service";
import { sweepStaleOpenPicks, dedupeOneCardPerFixture } from "./active-picks-service";
import {
  seedRealHistory, runTennisSeedBackground, HISTORY_SEEDED_KEY, TENNIS_SEEDED_KEY, type HistorySeedSummary,
} from "./real-history-backfill";
import { backfillShadowVetoes } from "./rca-veto";
import { getSettings, getSetting, setSetting, maskSettings, SETTING_KEYS, getOddsPapiApiKey } from "./settings";
import { getOddsFeedStats } from "@/core/bookmakers/odds-feed";
import { shinDevig } from "@/core/math/devig";
import {
  computeCalibration, trainPlatt, computeEnsembleWeights, computeWinStreak, auditShadowLedger,
  type CalibrationRow, type ReliabilityBin, type PlattParams,
} from "@/core/agents/calibration";
import { runSuperAgentV31Migration } from "@/core/agents/v31-migration";

export interface AppState {
  metrics: MasterMetrics;
  matches: AppMatch[];
  openSignals: AppSignal[];
  settledSignals: AppSignal[];
  shadowVetoes: AppVeto[];
  /** v3.1 — SuperAgent Calibration Lab block. */
  agentLab: AgentLab;
  settings: Record<string, string>;
  health: {
    espn: boolean; oddsApi: boolean; oddsApiIo: boolean;
    lastIngest: string | null; degraded: boolean; mode: "LIVE" | "OFFLINE";
    historySeed: string | null;
    /* v2.5 — The Odds API v4 credit shield telemetry */
    oddsApiCredits: string | null;
    oddsApiCachedAt: string | null;
    oddsApiSportKeys: string[];
    oddsApiError: string | null;
    oddsApiKeyFromEnv: boolean;
  };
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
  trueProb: number;
  price: number;
  evPct: number;
  stake: number;
  stakeMode: string;
  status: string;
  netProfit: number | null;
  shaHash: string;
  dayKey: string;
  startTime: string;
  lockedAt: string; // REAL pre-match lock timestamp (Signal.createdAt)
  legs?: Array<{ label: string; price: number; prob: number }> | null;
  espnUrl: string;
  settledAt: string | null;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  venue: string | null;
  surface: string | null;
  homeScore: number | null;
  awayScore: number | null;
  /** v2.7.2 §3 — REAL set scores (e.g. "6-4, 6-3") extracted from the ESPN
   * linescores-derived detail — shown in the Verified Ledger FT column. */
  setResult: string | null;
  /** v3.1 — SuperAgent ensemble metadata (Push-Shield Hit-Rate Engine). */
  tier: string | null;
  shieldType: string | null;
  noLossProb: number | null;
  consensusPct: number | null;
  sharpSource: string | null;
  sharpAlert: boolean | null;
}

export interface AppVeto {
  id: string;
  signalRef: string;
  reason: string;
  category: string;
  sport: string | null;
  league: string | null;
  repMatch: string | null; // v2.7 — representative fixture "Home vs Away"
  marketLabel: string | null;
  selection: string | null;
  price: number | null;
  modelProb: number | null;
  ftScore: string | null;
  savedUnits: number | null;
  verdict: string | null;
  decidedAt: string | null;
  startTime: string | null; // v2.7 — REAL fixture kickoff
  createdAt: string;
}

export interface AppMatch extends MatchContext {
  espnEventId: string;
  homeLogo: string | null;
  awayLogo: string | null;
  scores: { home: number | null; away: number | null };
  quotes: Array<{ marketKey: string; selection: string; price: number; trueProb: number; source: string }>;
}

/** v3.1 — SuperAgent Calibration Lab payload (SuperAgent 3 live dashboard). */
export interface AgentLab {
  brier: number;
  logLoss: number;
  ece: number;
  pureWinRate: number;
  noLossRate: number;
  decidedCount: number;
  settledCount: number;
  reliabilityBins: ReliabilityBin[];
  platt: PlattParams;
  weights: { wQuant: number; wCoach: number; wMarket: number };
  winStreak: number;
  lastStatuses: string[];
  shadow: {
    savedLossCount: number;
    savedLossUnits: number;
    missedWinCount: number;
    missedWinUnits: number;
    shadowLiftPct: number;
    winRateWithVeto: number;
    winRateWithoutVeto: number;
  };
  tierStats: Record<string, { wins: number; losses: number; voids: number; winRate: number; noLossRate: number; settled: number }>;
  shieldStats: Record<string, { wins: number; losses: number; voids: number; winRate: number; noLossRate: number; settled: number }>;
  vetoedLeagues: Array<{ league: string; sport: string; count: number }>;
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

/**
 * v2.7.2 §3 — extract the REAL set scores (e.g. "6-4, 6-3") from the tennis
 * detail string. ESPN carries the per-set values in
 * `competitions[0].competitors[].linescores`; both feed parsers bake them
 * into the match detail ("Winner bt Loser 7-5 6-3" or "6-4 6-3"). Tiebreak
 * internals ("(7-0)") are dropped; unfinished 0-0 sets are filtered; a
 * retirement is flagged honestly with " ret".
 */
export function extractTennisSetResult(detail: string | null | undefined): string | null {
  if (!detail || !/\d+-\d+/.test(detail)) return null;
  const tokens = [...detail.matchAll(/(\d+-\d+)(\s*\(\d+-\d+\))?/g)]
    .map((m) => m[1])
    .filter((t) => t !== "0-0");
  if (tokens.length === 0) return null;
  const retired = /\b(ret\.?|retired|walkover)\b/i.test(detail) ? " ret" : "";
  return `${tokens.join(", ")}${retired}`;
}

async function toAppSignals(rows: Awaited<ReturnType<typeof fetchSignals>>): Promise<AppSignal[]> {
  return rows.map((s) => ({
    id: s.id, matchId: s.matchId,
    matchInfo: `${s.match.homeName} vs ${s.match.awayName}`,
    league: s.match.league, sport: s.sport, line: s.line,
    marketKey: s.marketKey, marketLabel: s.marketLabel, selection: s.selection,
    modelProb: s.modelProb, trueProb: s.trueProb, price: s.price, evPct: s.evPct,
    stake: s.stake, stakeMode: s.stakeMode, status: s.status,
    netProfit: s.netProfit, shaHash: s.shaHash, dayKey: s.dayKey,
    startTime: s.match.startTime.toISOString(),
    lockedAt: s.createdAt.toISOString(),
    legs: s.legs ? JSON.parse(s.legs) : null,
    espnUrl: espnUrlFor(s.sport, s.match.leagueCode, s.match.espnEventId),
    settledAt: s.settledAt?.toISOString() ?? null,
    homeName: s.match.homeName, awayName: s.match.awayName,
    homeLogo: s.match.homeLogo, awayLogo: s.match.awayLogo,
    venue: s.match.venue, surface: s.match.surface,
    homeScore: s.match.homeScore, awayScore: s.match.awayScore,
    setResult: s.sport === "tennis" ? extractTennisSetResult(s.match.detail) : null,
    tier: s.tier, shieldType: s.shieldType,
    noLossProb: s.noLossProb, consensusPct: s.consensusPct,
    sharpSource: s.sharpSource, sharpAlert: s.sharpAlert,
  }));
}

// v3.3 — PENDING_SETTLEMENT rows are in the settlement queue: not open, not decided.
const isDecided = (st: string) => st === "WON" || st === "LOST" || st === "VOID";

function fetchSignals() {
  return db.signal.findMany({
    include: {
      match: {
        select: {
          homeName: true, awayName: true, league: true, leagueCode: true, startTime: true,
          espnEventId: true, homeLogo: true, awayLogo: true, venue: true, surface: true,
          homeScore: true, awayScore: true, detail: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
}

/**
 * v3.1 — assemble the SuperAgent Calibration Lab from settled rows + vetoes.
 * Pure DB reads + deterministic math; runs in <10ms for 400 rows.
 */
function buildAgentLab(
  signals: Awaited<ReturnType<typeof fetchSignals>>,
  vetoes: Array<{ verdict: string | null; savedUnits: number | null; league: string | null; sport: string | null }>,
): AgentLab {
  const settled = signals.filter((s) => isDecided(s.status));
  const calibRows: CalibrationRow[] = settled.map((s) => ({
    modelProb: s.noLossProb ?? s.modelProb,
    trueProb: s.trueProb,
    status: s.status as CalibrationRow["status"],
    stake: s.stake,
    netProfit: s.netProfit ?? 0,
    sport: s.sport,
    tier: s.tier,
  }));
  const calibration = computeCalibration(calibRows);
  const platt = trainPlatt(calibRows);
  // v3.3.1 hotfix §2 — the DISPLAYED ensemble weights mirror the LIVE blend:
  // when any open SHIELD signal locked a REAL sharp-market prior
  // (ESPN Core / The Odds API / OddsPapi), the ensemble runs 0.50/0.30/0.20
  // and the SHARP MARKET PRIOR card flips STANDBY → ACTIVE 20%. Without an
  // open prior the honest model-only 0.65/0.35 view stays (no fake weights).
  const marketPriorLive = signals.some(
    (s) => s.status === "OPEN" && s.line === "SHIELD" && !!s.sharpSource,
  );
  const weights = computeEnsembleWeights(calibration, marketPriorLive, platt);
  const streak = computeWinStreak([...calibRows].reverse()); // newest-first
  const shadow = auditShadowLedger(
    calibRows,
    vetoes.map((v) => ({ verdict: v.verdict, savedUnits: v.savedUnits })),
  );

  const bucket = (key: string, acc: Record<string, { wins: number; losses: number; voids: number; winRate: number; noLossRate: number; settled: number }>) => {
    acc[key] = acc[key] ?? { wins: 0, losses: 0, voids: 0, winRate: 0, noLossRate: 0, settled: 0 };
    return acc[key];
  };
  const tierStats: AgentLab["tierStats"] = {};
  const shieldStats: AgentLab["shieldStats"] = {};
  for (const s of settled) {
    const decided = s.status === "WON" || s.status === "LOST";
    if (s.tier) {
      const b = bucket(s.tier, tierStats);
      if (s.status === "WON") b.wins++;
      else if (s.status === "LOST") b.losses++;
      else b.voids++;
      b.settled++;
    }
    if (s.shieldType) {
      const b = bucket(s.shieldType, shieldStats);
      if (s.status === "WON") b.wins++;
      else if (s.status === "LOST") b.losses++;
      else b.voids++;
      b.settled++;
    }
    void decided;
  }
  for (const b of Object.values(tierStats)) {
    const d = b.wins + b.losses;
    b.winRate = d > 0 ? b.wins / d : 0;
    b.noLossRate = b.settled > 0 ? (b.wins + b.voids) / b.settled : 0;
  }
  for (const b of Object.values(shieldStats)) {
    const d = b.wins + b.losses;
    b.winRate = d > 0 ? b.wins / d : 0;
    b.noLossRate = b.settled > 0 ? (b.wins + b.voids) / b.settled : 0;
  }

  const leagueCount = new Map<string, { league: string; sport: string; count: number }>();
  for (const v of vetoes) {
    if (!v.league) continue;
    const key = `${v.league}|${v.sport ?? ""}`;
    const e = leagueCount.get(key) ?? { league: v.league, sport: v.sport ?? "football", count: 0 };
    e.count++;
    leagueCount.set(key, e);
  }

  return {
    brier: calibration.brier,
    logLoss: calibration.logLoss,
    ece: calibration.ece,
    pureWinRate: calibration.pureWinRate,
    noLossRate: calibration.noLossRate,
    decidedCount: calibration.decidedCount,
    settledCount: calibration.settledCount,
    reliabilityBins: calibration.reliabilityBins,
    platt,
    weights: { wQuant: weights.wQuant, wCoach: weights.wCoach, wMarket: weights.wMarket },
    winStreak: streak.streak,
    lastStatuses: streak.lastStatuses,
    shadow,
    tierStats,
    shieldStats,
    vetoedLeagues: [...leagueCount.values()].sort((a, b) => b.count - a.count).slice(0, 12),
  };
}

/** Assemble the full client state from the ledger (single source of truth). */
export async function bootstrapState(opts?: { ingestSummary?: IngestSummary | null; historySeed?: HistorySeedSummary | null }): Promise<AppState> {
  const [matchRows, signals, vetoes, settings, ingest] = await Promise.all([
    db.match.findMany({
      orderBy: { startTime: "asc" },
      include: { odds: { where: { bookmaker: { in: ["1XBET_EST", "1XBET_LIVE"] } } } },
    }),
    fetchSignals(),
    db.shadowVeto.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    getSettings(),
    db.ingestState.findUnique({ where: { id: "singleton" } }),
  ]);

  const settledRows: SettledRow[] = signals
    .filter((s) => isDecided(s.status))
    .map((s) => ({
      id: s.id, sport: s.sport, league: s.match.league, line: s.line,
      marketKey: s.marketKey, marketLabel: s.marketLabel, selection: s.selection,
      status: s.status as SettledRow["status"], netProfit: s.netProfit ?? 0,
      stake: s.stake, price: s.price, evPct: s.evPct, settledAt: s.settledAt,
      matchInfo: `${s.match.homeName} vs ${s.match.awayName}`,
    }));
  const openRows = signals.filter((s) => s.status === "OPEN").map((s) => ({ stake: s.stake }));

  // REAL shadow-ledger saving: signed sum of the veto verdicts (a saved loss
  // adds +100u, a missed win subtracts its honest opportunity cost).
  const savedCapital = vetoes.reduce((acc, v) => acc + (v.savedUnits ?? 0), 0);
  const savedCount = vetoes.filter((v) => v.verdict === "SAVED_LOSS").length;
  const missedWinCount = vetoes.filter((v) => v.verdict === "MISSED_WIN").length;
  const metrics = computeMasterMetrics(settledRows, openRows, { savedCapital, savedCount, missedWinCount });

  const matches: AppMatch[] = matchRows.map((m) => ({
    id: m.id, espnEventId: m.espnEventId, sport: m.sport as "football" | "tennis" | "basketball",
    league: m.league, leagueCode: m.leagueCode, homeName: m.homeName, awayName: m.awayName,
    homeRank: m.homeRank, awayRank: m.awayRank, startTime: m.startTime,
    status: m.status, surface: m.surface, venue: m.venue, round: m.round,
    homeLogo: m.homeLogo, awayLogo: m.awayLogo,
    scores: { home: m.homeScore, away: m.awayScore },
    quotes: m.odds.map((q) => ({
      marketKey: q.marketKey, selection: q.selection, price: q.price,
      trueProb: q.trueProb, source: q.source,
    })),
  }));

  // v3.3.2 §3 — max ONE card per fixture in Predictions Hub (highest
  // noLossProb wins). ACCA rows are multi-fixture cards and stay outside the
  // gate. Fixtures like `Chapecoense vs Palmeiras` can never emit 3 cards again.
  const openAll = signals.filter((s) => s.status === "OPEN");
  const openAccas = openAll.filter((s) => s.line === "ACCA2");
  const open = [
    ...openAccas,
    ...dedupeOneCardPerFixture(openAll.filter((s) => s.line !== "ACCA2")),
  ];
  // v3.3 — the settlement queue (PENDING_SETTLEMENT) is hidden from both lists.
  const settled = signals.filter((s) => isDecided(s.status));
  const [openSignals, settledSignals] = await Promise.all([
    toAppSignals(open), toAppSignals(settled),
  ]);

  // Feed mode honesty: the LAST ingest run decides whether the board reflects
  // live ESPN data or a temporarily unreachable feed (OFFLINE — never SIM).
  let lastDegraded: boolean | undefined;
  if (ingest?.lastSummary) {
    try { lastDegraded = (JSON.parse(ingest.lastSummary) as { degraded?: boolean }).degraded; } catch { /* ignore */ }
  }
  const degraded = opts?.ingestSummary?.degraded ?? lastDegraded ?? false;

  // v2.5 — The Odds API v4 credit-shield telemetry for the Settings card.
  const oddsStats = getOddsFeedStats();
  const oddsKeyFromEnv = !settings[SETTING_KEYS.oddsApiKey] && !!process.env.THE_ODDS_API_KEY;
  // v2.7.2 hotfix — the odds-api.io health flag must honour the full resolver
  // chain (DB → env), not the raw DB row: an env-only key used to report
  // `oddsApiIo: false` while the Layer-2 feed was in fact fully active.
  const oddsIoKey = await getOddsPapiApiKey();

  return {
    metrics,
    matches,
    openSignals,
    settledSignals,
    agentLab: buildAgentLab(signals, vetoes),
    shadowVetoes: vetoes.map((v) => ({
      id: v.id, signalRef: v.signalRef, reason: v.reason, category: v.category,
      sport: v.sport, league: v.league, repMatch: v.repMatch, marketLabel: v.marketLabel,
      selection: v.selection, price: v.price, modelProb: v.modelProb, ftScore: v.ftScore,
      savedUnits: v.savedUnits, verdict: v.verdict,
      decidedAt: v.decidedAt?.toISOString() ?? null,
      startTime: v.startTime?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    })),
    settings: maskSettings(settings),
    health: {
      espn: matches.length > 0,
      oddsApi: !!(settings[SETTING_KEYS.oddsApiKey] || process.env.THE_ODDS_API_KEY),
      oddsApiIo: !!oddsIoKey,
      lastIngest: ingest?.lastRun.toISOString() ?? null,
      degraded,
      mode: degraded ? "OFFLINE" : "LIVE",
      historySeed: settings["historySeededAt"] ?? null,
      oddsApiCredits: oddsStats.remainingCredits,
      oddsApiCachedAt: oddsStats.lastFetchAt ? new Date(oddsStats.lastFetchAt).toISOString() : null,
      oddsApiSportKeys: oddsStats.cachedSportKeys,
      oddsApiError: oddsStats.lastError,
      oddsApiKeyFromEnv: oddsKeyFromEnv,
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
  // Cold-start ledger backfill: REAL 7-day history when no settled rows exist.
  const settledCount = await db.signal.count({ where: { status: { not: "OPEN" } } });
  let seedSummary: HistorySeedSummary | null = null;
  if (settledCount === 0) {
    seedSummary = await seedRealHistory();
    if (seedSummary.signalsSeeded > 0) {
      summary = summary ?? {
        matchesUpserted: 0, quotesUpserted: 0, signalsCreated: 0, settledCount: 0,
        accasCreated: 0, shieldsCreated: 0, shieldVetoes: 0, degraded: false,
        notes: ["Cold-start REAL history backfill applied"],
        ranAt: new Date().toISOString(),
      };
    }
  }
  // v3.1 — one-time SuperAgent metadata backfill (tier / shield / consensus).
  try {
    const v31 = await runSuperAgentV31Migration();
    if (!v31.skipped) {
      console.log(`[v3.1] superagent migration: ${v31.updated} legacy rows enriched`, v31.tiers);
    }
  } catch (err) {
    console.error("v3.1 superagent migration failed (contained)", err);
  }
  // v2.7.2 tennis hotfix §3 — ONE-TIME purge of every buggy -EV tennis ledger
  // row (ev < +4.0% / forced stakes / estimate Total Sets) + re-backfill with
  // the new hard rules, BEFORE the state snapshot is assembled.
  try {
    const mig = await runTennisEvMigration();
    if (!mig.skipped) {
      console.log(`[v2.7.2] tennis EV migration: ${mig.deleted} buggy rows purged, ${mig.reseeded} clean rows reseeded`);
    }
  } catch (err) {
    console.error("tennis EV migration failed", err);
  }
  // v3.2 — ONE-TIME Pure Hit-Rate ledger migration: purge the settled ledger
  // + shadow rows, then re-seed in the BACKGROUND under the v3.2 rules
  // (14-day football window, independent 30/30 quotas, tennis market
  // diversity, Elo-1500 rejection, REAL Shadow Ledger verdicts).
  try {
    const v32 = await runV32LedgerMigration();
    if (!v32.skipped) {
      console.log(`[v3.2] ledger migration: ${v32.purgedSignals} settled rows + ${v32.purgedVetoes} vetoes purged — background reseed fired`);
    }
  } catch (err) {
    console.error("v3.2 ledger migration failed (contained)", err);
  }
  // v3.3 — ONE-TIME migration: 25/25/25 quotas + NBA engine + calibrated vetoes.
  try {
    const v33 = await runV33LedgerMigration();
    if (!v33.skipped) {
      console.log(`[v3.3] ledger migration: ${v33.purgedSignals} settled rows + ${v33.purgedVetoes} vetoes purged — background reseed fired`);
    }
  } catch (err) {
    console.error("v3.3 ledger migration failed (contained)", err);
  }
  // v3.3.1 hotfix §3 — ONE-TIME data hygiene: purge the "Alpha vs Beta" /
  // "Test Masters" Vitest leak from the live DB + every uncalibrated NBA row
  // (old 1X2/AH_PLUS_025 keys or >90% overconfidence), then rebuild from the
  // REAL 14-day backfill under the calibrated v3.3.1 model.
  try {
    const v331 = await runV331DataHygieneMigration();
    if (!v331.skipped) {
      console.log(`[v3.3.1] data hygiene: ${v331.purgedTestRows} test-leak rows + ${v331.purgedNbaRows} uncalibrated NBA rows purged — calibrated reseed fired`);
    }
  } catch (err) {
    console.error("v3.3.1 data hygiene failed (contained)", err);
  }
  // v3.3.2 §4.3 — ONE-TIME real-bookmaker rebuild: previous NBA records and
  // tennis ret/w-o games are re-aligned to the v3.3.2 rules in the background
  // (single-flight — never blocks the bootstrap response).
  try {
    const v332 = await runV332RealismMigration();
    if (!v332.skipped) {
      console.log(`[v3.3.2] realism migration: ${v332.purgedNbaRows} NBA rows + ${v332.purgedTennisRetRows} tennis-ret rows purged — background rebuild fired`);
    }
  } catch (err) {
    console.error("v3.3.2 realism migration failed (contained)", err);
  }
  // v2.7.2 hotfix — 30-day tennis backfill runs NON-BLOCKING (background,
  // single-flight): the ESPN range fetch + hundreds of upserts used to run
  // synchronously here and held every /api/bootstrap response for ~12s,
  // which pinned the dashboard on Skeleton Loading forever. Fire-and-forget:
  // the first paint assembles from the ledger immediately; the tennis tab
  // repopulates on the next poll once the background seed finishes.
  void runTennisSeedBackground();
  // v2.7.1 hotfix §2.2 — Shadow Ledger hygiene: purge incomplete veto rows and
  // rebuild the 14-row tracker before the state snapshot is assembled.
  try {
    await backfillShadowVetoes();
  } catch (err) {
    console.error("shadow veto backfill failed", err);
  }
  const state = await bootstrapState({ ingestSummary: summary, historySeed: seedSummary });
  // Absolute guard: retry the live feed once when the board came back empty.
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

export interface TennisEvMigrationSummary {
  skipped: boolean;
  deleted: number;
  reseeded: number;
  won: number;
  lost: number;
  void: number;
  ranAt: string;
}

const TENNIS_EV_MIGRATION_KEY = "tennisEvMigration_v272";

/**
 * v2.7.2 §3 — ONE-TIME migration: purge every buggy tennis ledger row and
 * re-run the tennis backfill under the new hard rules, so the official track
 * record and the total bank (Overview + Verified Ledger) are clean of the
 * audited -EV bets:
 *  - every tennis signal with evPct < +4.0% (§1 hard lock — covers "ev <= 0"
 *    AND every forced 10u-stake row without a genuine +EV edge), and
 *  - every tennis `tot_sets_o2.5` row (§2 — the market is estimate-only by
 *    construction: LIVE rows exist for the winner market exclusively, so all
 *    Total Sets rows carry artificial margin prices that produced -52.8u).
 * The tennis backfill then re-runs with the v2.7.2 hard +EV gate (EV >= 4%,
 * Kelly > 0, winner = REAL prices only), guarded by the migration flag so it
 * never runs twice.
 */
export async function runTennisEvMigration(opts?: { force?: boolean }): Promise<TennisEvMigrationSummary> {
  const ranAt = new Date().toISOString();
  const done = await getSetting(TENNIS_EV_MIGRATION_KEY);
  if (done && !opts?.force) {
    return { skipped: true, deleted: 0, reseeded: 0, won: 0, lost: 0, void: 0, ranAt };
  }
  // v2.7.2 hotfix — column names verified 1:1 against prisma/schema.prisma:
  //   Signal.sport (String, line 66) / Signal.evPct (Float, line 74) /
  //   Signal.marketKey (String, line 68) / Setting.key (@id, line 93).
  // The purge is wrapped in try/catch so it can NEVER crash the bootstrap
  // API (a failed cleanup must degrade to "keep the rows", not a 500).
  let deleted = 0;
  try {
    const dead = await db.signal.deleteMany({
      where: {
        sport: "tennis",
        OR: [
          { evPct: { lt: 4 } }, // §1 — ev < +4.0% (includes ev <= 0 / forced stakes)
          { marketKey: "tot_sets_o2.5" }, // §2 — estimate-only market, fully disabled
        ],
      },
    });
    deleted = dead.count;
  } catch (err) {
    console.error("tennis -EV purge failed (rows kept, bootstrap continues)", err);
  }
  // Re-run the tennis backfill under the new hard rules (clear the old
  // one-time tennis seed flag so seedTennisHistory executes again) — also
  // crash-proofed, and executed in the BACKGROUND so the response never
  // waits on ESPN.
  try {
    await db.setting.deleteMany({ where: { key: TENNIS_SEEDED_KEY } });
  } catch (err) {
    console.error("tennis seed-flag reset failed", err);
  }
  void runTennisSeedBackground();
  // The one-time migration flag is stamped IMMEDIATELY after the purge:
  // a slow/failed background re-seed must never cause the destructive purge
  // to re-run on the next request (the v2.7.2 repeated-purge loop bug).
  await setSetting(TENNIS_EV_MIGRATION_KEY, ranAt);
  return {
    skipped: false,
    deleted,
    reseeded: 0, // re-seed is non-blocking; counts surface via the background runner log
    won: 0,
    lost: 0,
    void: 0,
    ranAt,
  };
}

export { tehranDayKey };

export interface V32LedgerMigrationSummary {
  skipped: boolean;
  purgedSignals: number;
  purgedVetoes: number;
  ranAt: string;
}

const V32_MIGRATION_KEY = "v32LedgerMigrationAt";

/**
 * v3.2 single-flight background reseed — runs seedRealHistory({force:true})
 * with the NEW v3.2 rules (14-day football window, independent 30/30 quotas,
 * tennis market diversity, Elo-1500 rejection, REAL Shadow Ledger verdicts)
 * WITHOUT ever blocking a request path (the v2.7.2 lesson).
 */
let v32SeedInFlight: Promise<HistorySeedSummary> | null = null;

export function runV32SeedBackground(): Promise<HistorySeedSummary> {
  if (!v32SeedInFlight) {
    v32SeedInFlight = seedRealHistory({ force: true })
      .then((summary) => {
        console.log(
          `[v3.2] ledger reseed: ${summary.signalsSeeded} seeded (W${summary.won}/L${summary.lost}/V${summary.void}) ` +
          `· ${summary.vetoes} shadow vetoes from ${summary.fixturesFetched} REAL fixtures`,
        );
        return summary;
      })
      .catch((err) => {
        console.error("v3.2 ledger reseed failed (background, non-fatal)", err);
        return {
          skipped: false, fixturesFetched: 0, matchesUpserted: 0, signalsSeeded: 0,
          won: 0, lost: 0, void: 0, accas: 0, vetoes: 0, posters: 0,
          notes: [`background run failed: ${(err as Error).message}`],
          seededAt: new Date().toISOString(),
        } satisfies HistorySeedSummary;
      })
      .finally(() => { v32SeedInFlight = null; });
  }
  return v32SeedInFlight;
}

// v3.3 — one-time ledger migration flag (25/25/25 quotas + NBA engine + 22pp
// superagent-conflict veto + auto-veto league gate).
const V33_MIGRATION_KEY = "v33LedgerMigrationAt";

/**
 * v3.3 one-time ledger migration — identical containment contract to v3.2:
 * purge settled rows + vetoes + posters, stamp flags IMMEDIATELY (the purge
 * can never re-run), fire the v3.3 reseed in the BACKGROUND.
 */
export async function runV33LedgerMigration(opts?: { force?: boolean }): Promise<V32LedgerMigrationSummary> {
  const ranAt = new Date().toISOString();
  const done = await getSetting(V33_MIGRATION_KEY);
  if (done && !opts?.force) {
    return { skipped: true, purgedSignals: 0, purgedVetoes: 0, ranAt };
  }
  let purgedSignals = 0;
  let purgedVetoes = 0;
  try {
    const s = await db.signal.deleteMany({ where: { status: { not: "OPEN" } } });
    purgedSignals = s.count;
  } catch (err) {
    console.error("v3.3 settled-signal purge failed (rows kept, bootstrap continues)", err);
  }
  try {
    const v = await db.shadowVeto.deleteMany({});
    purgedVetoes = v.count;
  } catch (err) {
    console.error("v3.3 shadow-veto purge failed (rows kept, bootstrap continues)", err);
  }
  try {
    await db.posterLog.deleteMany({});
  } catch (err) {
    console.error("v3.3 poster purge failed (non-fatal)", err);
  }
  try {
    await setSetting(HISTORY_SEEDED_KEY, ranAt);
    await setSetting(TENNIS_SEEDED_KEY, ranAt);
  } catch (err) {
    console.error("v3.3 seed-flag stamping failed", err);
  }
  await setSetting(V33_MIGRATION_KEY, ranAt);
  void runV33SeedBackground();
  return { skipped: false, purgedSignals, purgedVetoes, ranAt };
}

let v33SeedInFlight: Promise<HistorySeedSummary> | null = null;

/** v3.3 single-flight background reseed (25/25/25 quotas + NBA backfill).
 *  v3.3.2 — observable start/completion so a hung rebuild is visible in dev.log. */
export function runV33SeedBackground(): Promise<HistorySeedSummary> {
  if (!v33SeedInFlight) {
    console.log("[v3.3] background reseed fired (single-flight)");
    v33SeedInFlight = seedRealHistory({ force: true })
      .then((summary) => {
        console.log(
          `[v3.3] ledger reseed: ${summary.signalsSeeded} seeded (W${summary.won}/L${summary.lost}/V${summary.void}) ` +
            `· ${summary.vetoes} shadow vetoes from ${summary.fixturesFetched} REAL fixtures (FB+TN+NBA)`,
        );
        return summary;
      })
      .catch((err) => {
        console.error("v3.3 ledger reseed failed (background, non-fatal)", err);
        return {
          skipped: false, fixturesFetched: 0, matchesUpserted: 0, signalsSeeded: 0,
          won: 0, lost: 0, void: 0, accas: 0, vetoes: 0, posters: 0,
          notes: [`background run failed: ${(err as Error).message}`],
          seededAt: new Date().toISOString(),
        } satisfies HistorySeedSummary;
      })
      .finally(() => { v33SeedInFlight = null; });
  } else {
    console.log("[v3.3] background reseed already in flight — join");
  }
  return v33SeedInFlight;
}

export interface V331HygieneSummary {
  skipped: boolean;
  purgedTestRows: number;
  purgedNbaRows: number;
  ranAt: string;
}

const V331_HYGIENE_KEY = "v331DataHygieneAt";

/**
 * v3.3.1 hotfix §3 — ONE-TIME data hygiene migration (contained like v3.2/3.3):
 *   a) Vitest leak purge — every Match/ShadowVeto row carrying the
 *      "Test Masters" / "Alpha vs Beta" test fixtures is deleted (Match delete
 *      cascades its Signal + OddsQuote rows via FK onDelete: Cascade).
 *   b) Uncalibrated NBA rebuild — basketball signals still carrying the old
 *      football vocabulary (1X2 / AH_PLUS_025) or >90% overconfidence are
 *      purged with their SHIELD vetoes, then the calibrated v3.3.1 backfill
 *      rebuilds them in the background (single-flight, never blocks bootstrap).
 */
export async function runV331DataHygieneMigration(opts?: { force?: boolean }): Promise<V331HygieneSummary> {
  const ranAt = new Date().toISOString();
  if (!opts?.force) {
    const seen = await getSetting(V331_HYGIENE_KEY);
    if (seen) return { skipped: true, purgedTestRows: 0, purgedNbaRows: 0, ranAt };
  }
  let purgedTestRows = 0;
  let purgedNbaRows = 0;

  // a) Test-leak purge — fixtures first (cascades quotes + signals).
  try {
    const m = await db.match.deleteMany({
      where: {
        OR: [
          { league: { contains: "Test Masters" } },
          { league: { contains: "Test League" } },
          { homeName: "Alpha", awayName: "Beta" },
          { homeName: "Alpha", awayName: "Gamma" },
        ],
      },
    });
    purgedTestRows += m.count;
  } catch (err) {
    console.error("v3.3.1 test-leak match purge failed (rows kept, bootstrap continues)", err);
  }
  try {
    const v = await db.shadowVeto.deleteMany({
      where: {
        OR: [
          { repMatch: { contains: "Alpha vs Beta" } },
          { repMatch: { contains: "Alpha vs Gamma" } },
          { repMatch: { contains: "Test Masters" } },
          { repMatch: { contains: "Test League" } },
          { league: { contains: "Test Masters" } },
          { league: { contains: "Test League" } },
        ],
      },
    });
    purgedTestRows += v.count;
  } catch (err) {
    console.error("v3.3.1 test-leak veto purge failed (rows kept, bootstrap continues)", err);
  }
  // Defensive signal-side sweep (survivor rows whose label still leaks).
  try {
    const s = await db.signal.deleteMany({
      where: {
        OR: [
          { marketLabel: { contains: "Alpha vs" } },
          { marketLabel: { contains: "Test Masters" } },
          { marketLabel: { contains: "Test League" } },
        ],
      },
    });
    purgedTestRows += s.count;
  } catch (err) {
    console.error("v3.3.1 test-leak signal purge failed (rows kept, bootstrap continues)", err);
  }

  // b) Uncalibrated NBA rebuild — old keys or >90% overconfidence never stay.
  try {
    const s = await db.signal.deleteMany({
      where: {
        sport: "basketball",
        OR: [
          { marketKey: { in: ["1X2", "AH_PLUS_025"] } },
          { modelProb: { gt: 0.90 } },
        ],
      },
    });
    purgedNbaRows += s.count;
  } catch (err) {
    console.error("v3.3.1 NBA signal purge failed (rows kept, bootstrap continues)", err);
  }
  try {
    const v = await db.shadowVeto.deleteMany({
      where: { sport: "basketball", category: "SHIELD_ENGINE" },
    });
    purgedNbaRows += v.count;
  } catch (err) {
    console.error("v3.3.1 NBA veto purge failed (rows kept, bootstrap continues)", err);
  }

  try {
    await setSetting(V331_HYGIENE_KEY, ranAt);
  } catch (err) {
    console.error("v3.3.1 hygiene flag stamping failed", err);
  }
  void runV33SeedBackground(); // calibrated rebuild from the REAL 14-day backfill
  return { skipped: false, purgedTestRows, purgedNbaRows, ranAt };
}

export interface V332RealismSummary {
  skipped: boolean;
  purgedNbaRows: number;
  purgedTennisRetRows: number;
  ranAt: string;
}

const V332_REALISM_KEY = "v332RealismMigrationAt";

/** Tennis retirement marker — identical vocabulary to extractTennisSetResult. */
const RETIRED_DETAIL_RE = /\b(ret\.?|retired|walkover|w\/o)\b/i;

/**
 * v3.3.2 §4.3 — ONE-TIME real-bookmaker rebuild (contained like v3.2/3.3/3.3.1):
 *   a) NBA — every SETTLED basketball row (the v3.3/v3.3.1 vocabulary incl.
 *      the now-ILLEGAL favourite +4.5 spread) plus its SHIELD vetoes is
 *      purged, and the single-flight background reseed rebuilds the records
 *      under the v3.3.2 real-bookmaker rules (Match Winner / whole-number
 *      handicap with push shield; +4.5 on a favourite can never exist again).
 *   b) Tennis — settled LOST rows on ret/w-o matches for the retirement-
 *      protected markets (TENNIS_SET_PLUS_15 / TENNIS_ML) are purged: the
 *      new settlement rules make a retirement a WON (≥1 set won) or a PUSH
 *      (stake returned) — never a LOST verdict.
 * OPEN live signals are NEVER touched; the migration flag is stamped
 * IMMEDIATELY so the destructive purge can never re-run.
 */
export async function runV332RealismMigration(opts?: { force?: boolean }): Promise<V332RealismSummary> {
  const ranAt = new Date().toISOString();
  if (!opts?.force) {
    const seen = await getSetting(V332_REALISM_KEY);
    if (seen) return { skipped: true, purgedNbaRows: 0, purgedTennisRetRows: 0, ranAt };
  }
  let purgedNbaRows = 0;
  let purgedTennisRetRows = 0;

  // a) NBA rebuild purge — settled rows under the old vocabulary, PLUS every
  //    OPEN row carrying the now-ILLEGAL favourite +4.5 spread (the patch's
  //    golden rule: a favourite NEVER gets a plus handicap — not even live).
  try {
    const s = await db.signal.deleteMany({
      where: { sport: "basketball", status: { not: "OPEN" } },
    });
    purgedNbaRows += s.count;
  } catch (err) {
    console.error("v3.3.2 NBA signal purge failed (rows kept, bootstrap continues)", err);
  }
  try {
    const alt = await db.signal.deleteMany({
      where: { sport: "basketball", marketKey: "NBA_ALT_SPREAD" },
    });
    purgedNbaRows += alt.count;
  } catch (err) {
    console.error("v3.3.2 NBA alt-spread purge failed (rows kept, bootstrap continues)", err);
  }
  try {
    const v = await db.shadowVeto.deleteMany({
      where: { sport: "basketball", category: "SHIELD_ENGINE" },
    });
    purgedNbaRows += v.count;
  } catch (err) {
    console.error("v3.3.2 NBA veto purge failed (rows kept, bootstrap continues)", err);
  }

  // b) Tennis retirement rebuild purge (LOST rows on ret/w-o matches only).
  try {
    const tennisRows = await db.match.findMany({
      where: { sport: "tennis", status: "post", detail: { not: null } },
      select: { id: true, detail: true },
      orderBy: { startTime: "desc" },
      take: 800,
    });
    const retIds = tennisRows
      .filter((m) => RETIRED_DETAIL_RE.test(m.detail ?? ""))
      .map((m) => m.id);
    if (retIds.length > 0) {
      const s = await db.signal.deleteMany({
        where: {
          sport: "tennis",
          status: "LOST",
          matchId: { in: retIds },
          marketKey: { in: ["TENNIS_SET_PLUS_15", "TENNIS_ML"] },
        },
      });
      purgedTennisRetRows = s.count;
    }
  } catch (err) {
    console.error("v3.3.2 tennis-ret purge failed (rows kept, bootstrap continues)", err);
  }

  try {
    await setSetting(V332_REALISM_KEY, ranAt);
  } catch (err) {
    console.error("v3.3.2 realism flag stamping failed", err);
  }
  void runV33SeedBackground(); // single-flight rebuild under the v3.3.2 rules
  return { skipped: false, purgedNbaRows, purgedTennisRetRows, ranAt };
}

/**
 * v3.2 §1/§3 — ONE-TIME ledger migration: purge every settled ledger row,
 * shadow veto and poster (OPEN live signals are NEVER touched), clear both
 * seed flags and fire the v3.2 reseed in the BACKGROUND. The migration flag
 * is stamped IMMEDIATELY so the destructive purge can never re-run (the
 * v2.7.2 repeated-purge-loop bug stays dead).
 */
export async function runV32LedgerMigration(opts?: { force?: boolean }): Promise<V32LedgerMigrationSummary> {
  const ranAt = new Date().toISOString();
  const done = await getSetting(V32_MIGRATION_KEY);
  if (done && !opts?.force) {
    return { skipped: true, purgedSignals: 0, purgedVetoes: 0, ranAt };
  }
  let purgedSignals = 0;
  let purgedVetoes = 0;
  try {
    const s = await db.signal.deleteMany({ where: { status: { not: "OPEN" } } });
    purgedSignals = s.count;
  } catch (err) {
    console.error("v3.2 settled-signal purge failed (rows kept, bootstrap continues)", err);
  }
  try {
    const v = await db.shadowVeto.deleteMany({});
    purgedVetoes = v.count;
  } catch (err) {
    console.error("v3.2 shadow-veto purge failed (rows kept, bootstrap continues)", err);
  }
  try {
    await db.posterLog.deleteMany({});
  } catch (err) {
    console.error("v3.2 poster purge failed (non-fatal)", err);
  }
  // Stamp BOTH seed flags BEFORE firing the background reseed: the blocking
  // cold-start path (settledCount === 0 → await seedRealHistory) must see the
  // flags and skip instantly, while the background run re-seeds everything.
  try {
    await setSetting(HISTORY_SEEDED_KEY, ranAt);
    await setSetting(TENNIS_SEEDED_KEY, ranAt);
  } catch (err) {
    console.error("v3.2 seed-flag stamping failed", err);
  }
  await setSetting(V32_MIGRATION_KEY, ranAt);
  void runV32SeedBackground();
  return { skipped: false, purgedSignals, purgedVetoes, ranAt };
}

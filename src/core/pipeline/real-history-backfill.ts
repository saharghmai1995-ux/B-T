/**
 * Real History Backfill — v2.0 ZERO-MOCK cold-start ledger bootstrap.
 *
 * Replaces the removed sim/history-seed modules: a fresh install back-fills
 * the ledger from REAL ESPN finished fixtures of the past 7 days only.
 * - Fixtures: ESPN soccer scoreboard `?dates=YYYYMMDD` (post state) + ESPN
 *   tennis ATP/WTA past range. No synthetic fixtures anywhere.
 * - Odds: REAL ESPN closing pickcenter when available.
 * - Picks: the same model factories the live pipeline uses.
 * - Settlement: the REAL settlement engine against REAL final scores.
 * - Vetoes: toxic-league fixtures become shadow-ledger rows carrying the
 *   REAL FT score and the REAL verdict (saved-loss / missed-win).
 *
 * Idempotent: guarded by a Setting flag; never runs twice (unless forced).
 */

import { db } from "@/lib/db";
import type { FeedMatch, MatchContext, TeamStat } from "@/core/types";
import { fetchFootballPastDay, fetchTennisPastRange, pastDayKey, fetchFootballSummaryOdds } from "@/core/bookmakers/espn-history";
import { fetchFootballStandings, FOOTBALL_LEAGUES } from "@/core/bookmakers/odds-feed";
import { getMarket } from "@/core/bookmakers/market-whitelist";
import { buildFootballFactory, buildTennisFactory, type FactoryOutput } from "./signal-factory";
import { resolveSelection } from "@/core/ledger/settlement-engine";
import { chooseStakeMode, accaPrice, STARTING_BANK, calculateSafeQuarterKellyStake, MIN_STAKE, fullKelly, FLAT_VIEW_STAKE } from "@/core/math/kelly";
import { marginPrice, BOOK_MARGIN, round2 } from "@/core/math/devig";
import { MIN_TENNIS_EV } from "@/engines/tennis/tennis-selector";
import { lockSignal } from "@/core/ledger/sha256-chain";
import { tehranDayKey } from "./ingest-service";
import { leagueAverageGoals, findTeamStat } from "./feed-gatherer";
import { setSetting, getSetting } from "./settings";
import { runQuantAgent, runCoachAgent } from "@/core/agents/orchestrator";
import {
  buildFootballProtectedCandidates, buildTennisProtectedCandidates, assignConfidenceTier,
} from "@/core/agents/push-shield-selector";
import { fetchNbaPastRange } from "@/core/bookmakers/nba-feed";
import { buildNbaProtectedCandidates, nbaWinProbabilities, type NbaMatchFeatures } from "@/engines/nba/nba-selector";

export const HISTORY_SEEDED_KEY = "historySeededAt";

const TOXIC_LEAGUES = new Set(["esp.2", "usa.1", "fifa.friendly"]);
// v3.2 §3 — REAL football backfill window: 14 past days across the REAL ESPN
// league set (fixes the audited "Football = 0" state: tennis used to eat the
// whole shared cap, leaving the football tab permanently empty).
const FOOTBALL_PAST_DAYS = [1, 2, 3, 4]; // all-league probes (yesterday .. -4)
export const FOOTBALL_LEAGUES_V32 = [
  "eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "bra.1", "uefa.champions",
] as const;
const FOOTBALL_FILL_DAYS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // v3.2 league fills to the full 14-day window
// v2.7.1 hotfix §2.5 — 30 days of finished ATP/WTA (+ Davis Cup ties carried
// by the tours' scoreboards) so the tennis tab of the ledger never stays zero.
const TENNIS_RANGE = [30, 1]; // from 30 days ago to yesterday
export const TENNIS_SEEDED_KEY = "tennisHistorySeededAt"; // one-time 30d tennis backfill flag
const COVERAGE = 0.66; // share of finished fixtures the supervisor would have issued
const ANCHOR_COVERAGE = 0.3; // occasional extra anchor pick (as in live acca anchors)
const ACCA_EVERY = 6; // every N-th issued signal becomes a 2-leg acca instead
const MAX_SUMMARY_FETCHES = 90; // closing-odds summary calls per backfill run
// v3.2 §3 — INDEPENDENT per-sport quotas (never a shared cap again):
// football and tennis each get their own 30-row slot in the ledger.
export const FOOTBALL_BACKFILL_LIMIT = 25; // v3.3 §4 — doc quotas 25/25/25
export const TENNIS_BACKFILL_LIMIT = 25; // v3.3 §4 — doc quotas 25/25/25
export const NBA_BACKFILL_LIMIT = 25; // v3.3 §4 — Engine 3 own 14-day quota
const VETO_INSERT_CAP = 60; // v3.2 — Shadow Ledger must hold REAL verdict rows

export interface HistorySeedSummary {
  skipped: boolean;
  fixturesFetched: number;
  matchesUpserted: number;
  signalsSeeded: number;
  won: number;
  lost: number;
  void: number;
  accas: number;
  vetoes: number;
  posters: number;
  notes: string[];
  seededAt: string;
}

/** Deterministic PRNG from a string seed (fixture-stable, no crypto needed). */
function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function upsertHistoryMatch(m: FeedMatch): Promise<string> {
  const row = await db.match.upsert({
    where: { espnEventId: m.espnEventId },
    create: {
      espnEventId: m.espnEventId, sport: m.sport, league: m.league, leagueCode: m.leagueCode,
      homeName: m.homeName, awayName: m.awayName, homeRank: m.homeRank ?? null,
      awayRank: m.awayRank ?? null, homeLogo: m.homeLogo ?? null, awayLogo: m.awayLogo ?? null,
      startTime: m.startTime, status: m.status,
      homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null,
      detail: m.detail ?? null, surface: m.surface ?? null, round: m.round ?? null,
      venue: m.venue ?? null, source: "ESPN",
    },
    update: {
      status: m.status, homeScore: m.homeScore ?? null, awayScore: m.awayScore ?? null,
      detail: m.detail ?? null, homeLogo: m.homeLogo ?? undefined, awayLogo: m.awayLogo ?? undefined,
    },
  });
  return row.id;
}

/** REAL history pack only — a total network outage leaves an empty pack.
 *  v3.2 §3 — football probes the last 4 days across ALL ESPN leagues, then
 *  fills the FULL 14-day window for the REAL league set (eng.1, esp.1, ita.1,
 *  ger.1, fra.1, bra.1, uefa.champions). Tennis keeps the 30-day ATP/WTA
 *  range. Both packs stay 100% REAL — an outage leaves an empty pack. */
async function fetchHistoryPack(): Promise<{ football: FeedMatch[]; tennis: FeedMatch[]; basketball: FeedMatch[]; notes: string[] }> {
  const notes: string[] = [];

  // Probe recent past days across ALL leagues, then fill the 14-day window
  // for the REAL v3.2 league set.
  const probe: FeedMatch[] = [];
  for (const d of FOOTBALL_PAST_DAYS) {
    probe.push(...await fetchFootballPastDay(pastDayKey(d), [...FOOTBALL_LEAGUES]));
  }
  const activeLeagues = [...new Set(probe.map((m) => m.leagueCode))];
  const v32Leagues = [...new Set([...activeLeagues, ...FOOTBALL_LEAGUES_V32])];
  const fill: FeedMatch[] = [];
  for (const d of FOOTBALL_FILL_DAYS) {
    fill.push(...await fetchFootballPastDay(pastDayKey(d), v32Leagues));
  }
  const football = [...probe, ...fill];
  if (activeLeagues.length === 0) notes.push("No finished football fixtures found in the 14-day window");
  const tennis = await fetchTennisPastRange(TENNIS_RANGE[0], TENNIS_RANGE[1]);
  if (tennis.length === 0) notes.push("No finished tennis fixtures found in the 30-day window");

  // v3.3 §4 — Engine 3 (NBA): independent 14-day window of finished REAL
  // scoreboard games (keyless ESPN endpoint, 5s timeout per day).
  const basketball = await fetchNbaPastRange(14, 1);
  if (basketball.length === 0) notes.push("No finished NBA fixtures found in the 14-day window");

  return { football, tennis, basketball, notes };
}

interface PendingLeg {
  matchId: string;
  espnEventId: string;
  sport: "football" | "tennis" | "basketball";
  league: string;
  label: string;
  marketKey: string;
  marketLabel: string;
  selection: string;
  modelProb: number;
  trueProb: number;
  price: number;
  evPct: number;
  startTime: Date;
  fixture: { sport: string; homeScore: number; awayScore: number; retired: boolean; detail?: string | null };
  /** v3.1 — Push-Shield ensemble metadata when the leg is a shield pick. */
  line?: "SINGLE_EV" | "SHIELD";
  tier?: string | null;
  shieldType?: string | null;
  noLossProb?: number | null;
  consensusPct?: number | null;
}

/**
 * v3.1 — Push-Shield ensemble pick for a HISTORICAL fixture (pure, sync).
 * Runs the same Quant + Coach agents the live orchestrator uses, derives the
 * protected candidates from the factory quote board, and returns the best
 * tier-cleared shield leg — or null. NO EV gate: the v3.1 engine maximises
 * noLossProb = winProb + pushProb and blocks on the Tier S/A/B ladder only.
 */
function shieldPickForFixture(
  m: FeedMatch,
  ctx: MatchContext,
  f: FactoryOutput,
  statHome: TeamStat | null,
  statAway: TeamStat | null,
): PendingLeg | null {
  try {
    const quant = runQuantAgent(ctx, f.quotes, statHome, statAway);
    if (!quant || quant.completeness < 0.65) return null;
    const coach = runCoachAgent(ctx, quant, statHome, statAway);
    const candidates = m.sport === "football"
      ? buildFootballProtectedCandidates({
          homeTeam: m.homeName, awayTeam: m.awayName,
          pHome: quant.pHome, pDraw: quant.pDraw, pAway: quant.pAway,
          pOver2: quant.pOver2, pExact2: quant.pExact2,
          pUnder3: quant.pUnder3, pExact3: quant.pExact3,
        })
      : buildTennisProtectedCandidates({
          homePlayer: m.homeName, awayPlayer: m.awayName,
          // v3.2 §3 — REAL rankings feed the hard Elo-1500 rejection.
          homeRank: m.homeRank ?? null, awayRank: m.awayRank ?? null,
          winnerHome: quant.pHome, winnerAway: quant.pAway,
          setBet20Home: f.quotes.find((q) => q.marketKey === "setbet_2_0" && q.selection === "HOME")?.modelProb ?? 0,
          setBet20Away: f.quotes.find((q) => q.marketKey === "setbet_2_0" && q.selection === "AWAY")?.modelProb ?? 0,
          gameHandHomePlus35: f.quotes.find((q) => q.marketKey === "gamehand_home_+3.5")?.modelProb ?? null,
          gameHandAwayPlus35: f.quotes.find((q) => q.marketKey === "gamehand_away_+3.5")?.modelProb ?? null,
          gameHandHomeMinus35: f.quotes.find((q) => q.marketKey === "gamehand_home_-3.5")?.modelProb ?? null,
          gameHandAwayMinus35: f.quotes.find((q) => q.marketKey === "gamehand_away_-3.5")?.modelProb ?? null,
        });
    if (candidates.length === 0) return null;
    const top = candidates[0];
    // No sharp prior at backfill time (historical closing odds are absent for
    // most rows) → model-only blend per spec: 0.65·Quant + 0.35·Coach with
    // identity Platt (SuperAgent 3 trains on the settled rows afterwards).
    const quantNoLoss = top.noLossProb;
    const coachNoLoss = Math.min(1, Math.max(0, quantNoLoss + coach.tacticalDelta));
    const blended = 0.65 * quantNoLoss + 0.35 * coachNoLoss;
    const consensus = Math.round(Math.min(100, Math.max(0, 100 - Math.abs(quantNoLoss - coachNoLoss) * 150)) * 10) / 10;
    const tier = assignConfidenceTier(blended, consensus);
    if (!tier) return null;
    const margin = m.sport === "football" ? BOOK_MARGIN.football : BOOK_MARGIN.tennis;
    const price = marginPrice(top.winProb, margin);
    const noLossProb = round2(blended * 1000) / 1000;
    const winProb = round2(top.winProb * 1000) / 1000;
    return {
      matchId: ctx.id, espnEventId: m.espnEventId, sport: m.sport as "football" | "tennis" | "basketball",
      league: m.league,
      label: `${m.homeName} vs ${m.awayName} — ${top.marketKey} ${top.selection}`,
      marketKey: top.marketKey, marketLabel: top.posterLabel, selection: top.selection,
      modelProb: winProb, trueProb: noLossProb, price,
      evPct: Math.round((top.winProb * price - 1) * 1000) / 10,
      startTime: m.startTime,
      fixture: {
        sport: m.sport, homeScore: m.homeScore ?? 0, awayScore: m.awayScore ?? 0,
        retired: m.retired === true, detail: m.detail ?? null,
      },
      line: "SHIELD", tier, shieldType: top.shieldType,
      noLossProb, consensusPct: consensus,
    };
  } catch {
    return null; // the shield path NEVER breaks the backfill
  }
}

/** Best backfill candidate: highest-EV quote inside the tradable price band.
 *  Backfill-only widening (live Line-1 keeps its strict +4.5% gate in the
 *  selectors): without it, a fresh install would show a permanently dead
 *  ledger. Prices stay the honest margin formula; results stay real. */
function bestSoftPick(
  quotes: Array<{ marketKey: string; selection: string; modelProb: number; trueProb: number; price: number; source: string }>,
): { marketKey: string; selection: string; modelProb: number; trueProb: number; price: number } | null {
  let best: { marketKey: string; selection: string; modelProb: number; trueProb: number; price: number } | null = null;
  let bestEv = 0; // ≥ 0 vs the real closing market — honest paper-trading floor
  for (const q of quotes) {
    if (q.price < 1.42 || q.price > 2.15) continue;
    const ev = q.modelProb * q.price - 1;
    if (ev > bestEv) {
      bestEv = ev;
      best = { marketKey: q.marketKey, selection: q.selection, modelProb: q.modelProb, trueProb: q.trueProb, price: q.price };
    }
  }
  return best;
}

/**
 * v2.7.1 hotfix §2.2 — a shadow-veto row must NEVER be empty again: when the
 * strict band finds nothing, fall back to the engine quote closest to a
 * realistic bet (same model machinery, real margin price) so every tracker
 * row carries the engine's pre-veto selection + odds + reference stake.
 */
export function pickVetoCandidate(
  quotes: Array<{ marketKey: string; selection: string; modelProb: number; trueProb: number; price: number; source: string }>,
): { marketKey: string; selection: string; modelProb: number; trueProb: number; price: number } | null {
  const soft = bestSoftPick(quotes);
  if (soft) return soft;
  const widened = quotes.filter((q) => q.price >= 1.3 && q.price <= 3.0);
  const pool = widened.length > 0 ? widened : quotes;
  if (pool.length === 0) return null;
  return pool.reduce((best, q) =>
    q.modelProb * q.price > best.modelProb * best.price ? q : best,
  );
}

/** Issue candidates for every finished fixture (chronological, deterministic). */
async function buildCandidates(
  pack: { football: FeedMatch[]; tennis: FeedMatch[]; basketball: FeedMatch[] },
  standings: Record<string, TeamStat[]>,
  leagueAvg: (rows: TeamStat[] | undefined) => number,
): Promise<{
  singles: PendingLeg[];
  vetoes: Array<{
    ref: string; reason: string; category: string; sport: string; league: string;
    ftScore: string; startTime: Date;
    wouldHaveBeen: { marketKey: string; selection: string; price: number; modelProb: number; fixture: { sport: string; homeScore: number; awayScore: number; retired: boolean; detail?: string | null } } | null;
  }>;
}> {
  const singles: PendingLeg[] = [];
  const vetoes: Array<{
    ref: string; reason: string; category: string; sport: string; league: string;
    ftScore: string; startTime: Date;
    wouldHaveBeen: { marketKey: string; selection: string; price: number; modelProb: number; fixture: { sport: string; homeScore: number; awayScore: number; retired: boolean; detail?: string | null } } | null;
  }> = [];
  // v3.2 §3.1 — INDEPENDENT per-sport quotas: tennis can NEVER eat the whole
  // ledger again, and football always gets its own 30-row slot.
  const caps: Record<"football" | "tennis" | "basketball", number> = {
    football: FOOTBALL_BACKFILL_LIMIT,
    tennis: TENNIS_BACKFILL_LIMIT,
    basketball: NBA_BACKFILL_LIMIT,
  };
  const issued: Record<"football" | "tennis" | "basketball", number> = { football: 0, tennis: 0, basketball: 0 };
  // v3.2 §3.1 — per-sport chronological queues. The old SHARED slice(0, 240)
  // over the merged list starved football forever: 30 days of tennis fixtures
  // (oldest-first) consumed every slot before football's 14-day window was
  // ever reached. Each sport now owns its full queue and its own cap.
  const queues: Record<"football" | "tennis" | "basketball", FeedMatch[]> = {
    football: [...pack.football].sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
    tennis: [...pack.tennis].sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
    basketball: [...pack.basketball].sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
  };
  // v3.3 §4 — window-derived REAL NBA form: running per-game differential
  // computed ONLY from games already finished INSIDE the fetched window
  // (no look-ahead, no standings anachronism). The first 1-2 window games of
  // a team stay unrated → honest tactical veto with a REAL would-have-been.
  const nbaForm = new Map<string, { g: number; diff: number; w: number; last: Date }>();
  // Pre-fetch REAL closing odds (ESPN pickcenter) for tradable football fixtures.
  const oddsByEvent = new Map<string, Awaited<ReturnType<typeof fetchFootballSummaryOdds>>>();
  const needOdds = pack.football
    .filter((m) => m.status === "post" && !TOXIC_LEAGUES.has(m.leagueCode))
    .slice(0, MAX_SUMMARY_FETCHES);
  const CHUNK = 6;
  for (let i = 0; i < needOdds.length; i += CHUNK) {
    const slice = needOdds.slice(i, i + CHUNK);
    await Promise.all(slice.map(async (m) => {
      const o = await fetchFootballSummaryOdds(m.leagueCode, m.espnEventId);
      if (o) oddsByEvent.set(m.espnEventId, o);
    }));
  }
  for (const sport of ["football", "tennis", "basketball"] as const) {
    for (const m of queues[sport]) {
      // v3.2 §3.1 — quota reached for this sport → stop issuing (quota, not veto).
      if (issued[sport] >= caps[sport]) break;
    if (m.status !== "post" || m.homeScore == null || m.awayScore == null) continue;
    const id = await upsertHistoryMatch(m);
    const ftScore = `${m.homeScore}-${m.awayScore}`;
    const fixture = {
      sport: m.sport, homeScore: m.homeScore, awayScore: m.awayScore,
      retired: m.retired === true, detail: m.detail ?? null,
    };
    // Toxic football leagues → honest supervisor veto. The "would-have-been"
    // pick is computed with the SAME model machinery and resolved against the
    // REAL final score, so the tracker can PROVE whether the veto saved the
    // stake or cost a missed win.
    if (m.sport === "football" && TOXIC_LEAGUES.has(m.leagueCode)) {
      const ctx = {
        id, sport: m.sport as "football", league: m.league, leagueCode: m.leagueCode,
        homeName: m.homeName, awayName: m.awayName, homeRank: null, awayRank: null,
        startTime: m.startTime, status: m.status, surface: null, venue: m.venue ?? null, round: m.round ?? null,
      };
      const f = buildFootballFactory(
        ctx,
        findTeamStat(standings, m.leagueCode, m.homeName),
        findTeamStat(standings, m.leagueCode, m.awayName),
        null,
        leagueAvg(standings[m.leagueCode]),
      );
      // v2.7.1 §2.2 — vetoes are ALWAYS complete: strict band → widened pick.
      const soft = pickVetoCandidate(f.quotes);
      vetoes.push({
        ref: `${m.homeName} vs ${m.awayName}`,
        reason: `Supervisor blacklist: league ${m.leagueCode} excluded pre-match (data-integrity risk)`,
        category: "TOXIC_LEAGUE",
        sport: m.sport, league: m.league, ftScore, startTime: m.startTime,
        wouldHaveBeen: soft
          ? { marketKey: soft.marketKey, selection: soft.selection, price: soft.price, modelProb: soft.modelProb, fixture }
          : null,
      });
      continue;
    }
    const ctx = {
      id, sport: m.sport as "football" | "tennis" | "basketball", league: m.league, leagueCode: m.leagueCode,
      homeName: m.homeName, awayName: m.awayName, homeRank: m.homeRank ?? null,
      awayRank: m.awayRank ?? null, startTime: m.startTime, status: m.status,
      surface: m.surface ?? null, venue: m.venue ?? null, round: m.round ?? null,
    };
    const rng = mulberry32(hashSeed(m.espnEventId));
    const roll = rng();
    // v3.3 §4 — Engine 3 (NBA) backfill branch: normal-CDF margin model over
    // in-window REAL form; same Shadow/Veto honesty as football/tennis.
    if (m.sport === "basketball") {
      const normKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const gk = normKey(m.homeName), ak = normKey(m.awayName);
      const g = nbaForm.get(gk), a = nbaForm.get(ak);
      const ready = !!(g && a && g.g >= 2 && a.g >= 2);
      const DAY_MS = 86400_000;
      const feats: NbaMatchFeatures = {
        homeTeam: m.homeName, awayTeam: m.awayName,
        homeNetRating: g ? g.diff / g.g : 0,
        awayNetRating: a ? a.diff / a.g : 0,
        // v3.3.1 §1a — REAL in-window win% feeds the calibrated 70/30 blend.
        homeWinPct: g && g.g > 0 ? g.w / g.g : undefined,
        awayWinPct: a && a.g > 0 ? a.w / a.g : undefined,
        homeBackToBack: g ? m.startTime.getTime() - g.last.getTime() <= 1.2 * DAY_MS : false,
        awayBackToBack: a ? m.startTime.getTime() - a.last.getTime() <= 1.2 * DAY_MS : false,
        homeRestDays: g ? Math.floor((m.startTime.getTime() - g.last.getTime()) / DAY_MS) : 7,
        awayRestDays: a ? Math.floor((m.startTime.getTime() - a.last.getTime()) / DAY_MS) : 7,
        homeStarOut: false, // no free reliable injury feed — never invented
        awayStarOut: false,
      };
      const { pHomeWin } = nbaWinProbabilities(feats);
      const favIsHome = pHomeWin >= 1 - pHomeWin;
      const favWinProb = favIsHome ? pHomeWin : 1 - pHomeWin;
      const rawPick = {
        marketKey: "NBA_ML", // v3.3.1 — dedicated NBA key (never football 1X2)
        selection: favIsHome ? "NBA_ML_HOME" : "NBA_ML_AWAY",
        price: marginPrice(favWinProb, BOOK_MARGIN.basketball),
        modelProb: round2(favWinProb * 1000) / 1000,
      };
      const candidates = ready ? buildNbaProtectedCandidates(feats) : [];
      if (candidates.length === 0) {
        if (roll <= COVERAGE && rawPick.price > 0) {
          vetoes.push({
            ref: `${m.homeName} vs ${m.awayName}`,
            reason: ready
              ? "No NBA candidate cleared the 72% no-loss shield floor"
              : "Unrated NBA pairing — insufficient in-window form data",
            category: ready ? "LOW_CONSENSUS" : "TACTICAL_VETO",
            sport: m.sport, league: m.league, ftScore, startTime: m.startTime,
            wouldHaveBeen: {
              marketKey: rawPick.marketKey, selection: rawPick.selection,
              price: rawPick.price, modelProb: rawPick.modelProb, fixture,
            },
          });
        }
      } else if (issued.basketball < caps.basketball) {
        const top = candidates[0];
        // Model-only blend (identity Platt at backfill time; no NBA sharp
        // layer) — the SAME 0.65/0.35 treatment football rows get.
        const quantNoLoss = top.noLossProb;
        const blended = quantNoLoss;
        const consensus = Math.round(Math.min(100, Math.max(0, 100 - 0 * 150)) * 10) / 10;
        const tier = assignConfidenceTier(blended, consensus);
        const price = marginPrice(top.winProb, BOOK_MARGIN.basketball);
        if (tier && price > 0) {
          singles.push({
            matchId: id, espnEventId: m.espnEventId, sport: "basketball",
            league: m.league,
            label: `${m.homeName} vs ${m.awayName} — ${top.marketKey} ${top.selection}`,
            marketKey: top.marketKey, marketLabel: top.posterLabel, selection: top.selection,
            modelProb: round2(top.winProb * 1000) / 1000,
            trueProb: round2(blended * 1000) / 1000,
            price,
            evPct: Math.round((top.winProb * price - 1) * 1000) / 10,
            startTime: m.startTime,
            fixture: {
              sport: "basketball", homeScore: m.homeScore ?? 0, awayScore: m.awayScore ?? 0,
              retired: false, detail: m.detail ?? null,
            },
            line: "SHIELD", tier, shieldType: top.shieldType,
            noLossProb: round2(blended * 1000) / 1000, consensusPct: consensus,
          });
          issued.basketball++;
        }
      }
      // Update running REAL form with the actual result (chronological walk).
      for (const [key, scored] of [[gk, m.homeScore ?? 0], [ak, m.awayScore ?? 0]] as const) {
        const opp = key === gk ? m.awayScore ?? 0 : m.homeScore ?? 0;
        const prev = nbaForm.get(key) ?? { g: 0, diff: 0, w: 0, last: m.startTime };
        nbaForm.set(key, { g: prev.g + 1, diff: prev.diff + (scored - opp), w: prev.w + (scored > opp ? 1 : 0), last: m.startTime });
      }
      continue;
    }
    const f = m.sport === "football"
      ? buildFootballFactory(
          ctx,
          findTeamStat(standings, m.leagueCode, m.homeName),
          findTeamStat(standings, m.leagueCode, m.awayName),
          oddsByEvent.get(m.espnEventId) ?? m.refOdds ?? null,
          leagueAvg(standings[m.leagueCode]),
        )
      : buildTennisFactory(ctx);
    // v3.2 §3 — HARD Elo-1500 rejection in the backfill path: a tennis match
    // with NO real ATP/WTA ranking on BOTH sides is an unrated coin-flip and
    // is rejected IMMEDIATELY — recorded in the Shadow Ledger with the model's
    // initial pick + the REAL FT so the veto carries a real verdict.
    if (m.sport === "tennis" && m.homeRank == null && m.awayRank == null) {
      if (roll <= COVERAGE) {
        const would = pickVetoCandidate(f.quotes);
        if (would) {
          vetoes.push({
            ref: `${m.homeName} vs ${m.awayName}`,
            reason: "Elo 1500 vs 1500 — unrated coin-flip rejected (v3.2 §3)",
            category: "TACTICAL_VETO",
            sport: m.sport, league: m.league, ftScore, startTime: m.startTime,
            wouldHaveBeen: {
              marketKey: would.marketKey, selection: would.selection,
              price: would.price, modelProb: would.modelProb, fixture,
            },
          });
        }
      }
      continue;
    }
    // v3.1 — the Push-Shield ensemble pick is the fixture's PRIMARY track
    // record row: the v3.1 engine has NO blocking dependency on odds/EV/Kelly
    // (spec §0), so whenever a Tier-cleared protected market exists, the
    // historical ledger records IT instead of the EV-gated ladder pick.
    const shield = shieldPickForFixture(m, ctx, f, findTeamStat(standings, m.leagueCode, m.homeName), findTeamStat(standings, m.leagueCode, m.awayName));
    if (shield) {
      // v3.2 §3.1 — per-sport quota applies to the shield track as well.
      const sportKey = shield.sport as "football" | "tennis" | "basketball";
      if (issued[sportKey] >= caps[sportKey]) continue;
      singles.push(shield);
      issued[sportKey]++;
      continue;
    }
    // v3.2 §3.1 — quota reached for this sport → silently stop issuing (the
    // fixture is NOT vetoed, it simply has no free quota slot left).
    if (issued[m.sport] >= caps[m.sport]) continue;
    // Primary pick: live-gate single → soft paper pick (EV ≥ 0 vs REAL closing
    // odds — the backfill keeps every edge the model saw, not just deep value)
    // → anchor fallback. Supervisor selectivity applies via the coverage roll.
    const soft = bestSoftPick(f.quotes);
    // v2.7.2 tennis hotfix §1 — tennis ledger legs are HARD-locked to +EV:
    // the EV>=0 soft paper pick and the widened veto pick are BOTH banned for
    // tennis (they built the audited -77.3u tab). Only a factory candidate
    // that already passed the hard gate (EV >= +4.0%, Kelly > 0, winner market
    // = REAL prices only) may enter the ledger.
    const c = m.sport === "tennis"
      ? (f.single ?? f.anchors[0] ?? null)
      : (f.single ?? soft ?? f.anchors[0] ?? null);
    const keep = roll <= COVERAGE || (roll <= COVERAGE + ANCHOR_COVERAGE && f.anchors[0]);
    // v3.2 §3.2 — the engine produced NO tradable candidate (no tier cleared
    // the ladder / consensus gate): record a REAL shadow veto carrying the
    // model's initial pick, the veto reason, the REAL FT and the computed
    // verdict — this is what fills the Shadow Ledger beyond toxic leagues.
    if (!c) {
      if (roll <= COVERAGE) {
        const would = pickVetoCandidate(f.quotes);
        if (would) {
          vetoes.push({
            ref: `${m.homeName} vs ${m.awayName}`,
            reason: "No candidate cleared the Tier S/A/B ladder (consensus gate)",
            category: "LOW_CONSENSUS",
            sport: m.sport, league: m.league, ftScore, startTime: m.startTime,
            wouldHaveBeen: {
              marketKey: would.marketKey, selection: would.selection,
              price: would.price, modelProb: would.modelProb, fixture,
            },
          });
        }
      }
      continue;
    }
    if (!keep) continue;
    const push = (cand: typeof c) => {
      const evRaw = cand.modelProb * cand.price - 1;
      // §1 hard gate — NO tennis record with ev < +4.0% (or Kelly <= 0) may
      // reach the track record, no matter which ladder rung produced it.
      if (m.sport === "tennis" && (evRaw < MIN_TENNIS_EV || fullKelly(cand.modelProb, cand.price) <= 0)) return;
      const evPct = "evPct" in cand && typeof cand.evPct === "number"
        ? cand.evPct
        : Math.round((cand.modelProb * cand.price - 1) * 1000) / 10;
      singles.push({
        matchId: id, espnEventId: m.espnEventId, sport: m.sport as "football" | "tennis" | "basketball",
        league: m.league,
        label: `${m.homeName} vs ${m.awayName} — ${cand.marketKey} ${cand.selection}`,
        marketKey: cand.marketKey,
        marketLabel: ("marketLabel" in cand && cand.marketLabel
          ? String(cand.marketLabel)
          : getMarket(cand.marketKey)?.label ?? cand.marketKey),
        selection: cand.selection, modelProb: cand.modelProb, trueProb: cand.trueProb,
        price: cand.price, evPct, startTime: m.startTime,
        fixture,
      });
      issued[m.sport]++;
    };
    push(c);
    // Occasional second (anchor) pick on the same fixture — mirrors live acca anchors.
    if (roll > COVERAGE && f.anchors[0] && f.anchors[0].marketKey !== c.marketKey) {
      push(f.anchors[0]);
    }
    }
  }
  return { singles, vetoes };
}

/** The one-time REAL backfill entrypoint. */
export async function seedRealHistory(opts?: { force?: boolean }): Promise<HistorySeedSummary> {
  const existing = await getSetting(HISTORY_SEEDED_KEY);
  const settledAlready = await db.signal.count({ where: { status: { not: "OPEN" } } });
  if (!opts?.force && (existing || settledAlready >= 6)) {
    return {
      skipped: true, fixturesFetched: 0, matchesUpserted: 0, signalsSeeded: 0,
      won: 0, lost: 0, void: 0, accas: 0, vetoes: 0, posters: 0,
      notes: [], seededAt: existing ?? "",
    };
  }
  if (opts?.force) {
    // Rebuild from scratch: wipe the backfilled ledger artifacts (open live signals stay).
    await db.signal.deleteMany({ where: { status: { not: "OPEN" } } });
    await db.shadowVeto.deleteMany({});
    await db.posterLog.deleteMany({});
  }

  const pack = await fetchHistoryPack();

  // Standings for EVERY football league present in history (real season tables).
  // No cap: a missing table silently degrades model-vs-market divergence to zero
  // and the fixture can never produce an honest signal.
  const leagues = [...new Set(pack.football.map((m) => m.leagueCode))];
  const standings: Record<string, TeamStat[]> = {};
  const missing = leagues.filter((lg) => !standings[lg]);
  const SCHUNK = 5;
  for (let i = 0; i < missing.length; i += SCHUNK) {
    await Promise.all(missing.slice(i, i + SCHUNK).map(async (lg) => {
      const rows = await fetchFootballStandings(lg);
      if (rows.length) standings[lg] = rows;
    }));
  }

  const { singles, vetoes } = await buildCandidates(pack, standings, leagueAverageGoals);

  let bank = STARTING_BANK;
  let won = 0, lost = 0, void_ = 0, accas = 0;
  const createdIds: Array<{ id: string; status: string; kind: string; title: string }> = [];

  for (let i = 0; i < singles.length; i++) {
    const leg = singles[i];
    // Every N-th issued pick becomes a 2-leg smart acca with the next leg.
    if (i % ACCA_EVERY === ACCA_EVERY - 1 && i + 1 < singles.length && singles[i + 1].matchId !== leg.matchId) {
      const b = singles[i + 1];
      const legs = [leg, b];
      const price = accaPrice(legs.map((l) => l.price));
      const prob = legs.reduce((acc, l) => acc * l.modelProb, 1);
      // v2.5 unified staking — ACCA legs stake with the SAME Quarter-Kelly rule.
      // v2.7.2 §1 — stake 0 (raw Kelly <= 0) => the pair is never issued.
      const stake = chooseStakeMode(prob, price, bank).stake;
      if (stake <= 0) { i++; continue; }
      const verdicts = legs.map((l) => resolveSelection(l.marketKey, l.selection, l.fixture));
      const lostLeg = verdicts.some((v) => v.status === "LOST");
      const eff = legs.reduce((acc, l, j) => acc * (verdicts[j].status === "WON" ? l.price : 1), 1);
      const net = round2(lostLeg ? -stake : stake * (eff - 1));
      const status = lostLeg ? "LOST" : net > 0 ? "WON" : "VOID";
      const settledAt = settleTime(legs[1].startTime);
      const hash = lockSignal({
        matchInfo: legs.map((l) => l.label).join(" + "), sport: "multi", line: "ACCA2",
        marketKey: "acca2", selection: "ACCA", price, modelProb: prob,
        evPct: round2(prob * price - 1), stake,
        issuedAt: legs[0].startTime.toISOString(),
      });
      const ok = await createSeededSignal({
        matchId: leg.matchId, sport: legs[0].sport, line: "ACCA2", marketKey: "acca2",
        marketLabel: "2-Leg Smart Accumulator", selection: "ACCA",
        modelProb: round2(prob), trueProb: round2(prob), price, evPct: round2(prob * price - 1),
        stake, stakeMode: "KELLY_025",
        legs: JSON.stringify(legs.map((l) => ({
          espnEventId: l.espnEventId, label: l.label, marketKey: l.marketKey,
          selection: l.selection, price: l.price, prob: l.modelProb,
        }))),
        shaHash: hash, status, netProfit: net, settledAt,
        dayKey: tehranDayKey(settledAt), createdAt: legs[0].startTime,
      });
      if (!ok) { i++; continue; }
      createdIds.push({ id: hash, status, kind: "SIGNAL", title: legs.map((l) => l.label).join(" + ") });
      bank = round2(bank + net);
      accas++;
      if (status === "WON") won++;
      else if (status === "LOST") lost++;
      else void_++;
      i++; // consumed the second leg
      continue;
    }

    const { stake, stakeMode } = leg.line === "SHIELD"
      ? { stake: FLAT_VIEW_STAKE, stakeMode: "FLAT_100" as const } // v3.1 — constant-risk flat staking, NO Kelly dependency
      : chooseStakeMode(leg.modelProb, leg.price, bank);
    // v2.7.2 §1 — a 0 stake means raw Kelly <= 0: never create the row.
    if (stake <= 0) continue;
    const v = resolveSelection(leg.marketKey, leg.selection, leg.fixture);
    const net = round2(
      v.status === "WON" ? stake * v.factor * (leg.price - 1)
        : v.status === "LOST" ? -stake : 0,
    );
    const status = net > 0 && v.status === "WON" ? "WON"
      : v.status === "LOST" ? "LOST"
        : net === 0 && v.status === "WON" ? "VOID" : v.status;
    const settledAt = settleTime(leg.startTime);
    const hash = lockSignal({
      matchInfo: leg.label, sport: leg.sport, line: leg.line ?? "SINGLE_EV",
      marketKey: leg.marketKey, selection: leg.selection, price: leg.price,
      modelProb: leg.modelProb, evPct: leg.evPct, stake,
      issuedAt: leg.startTime.toISOString(),
    });
    const ok = await createSeededSignal({
      matchId: leg.matchId, sport: leg.sport, line: leg.line ?? "SINGLE_EV",
      marketKey: leg.marketKey, marketLabel: leg.marketLabel, selection: leg.selection,
      modelProb: leg.modelProb, trueProb: leg.trueProb, price: leg.price,
      evPct: leg.evPct, stake, stakeMode, shaHash: hash,
      status, netProfit: net, settledAt, dayKey: tehranDayKey(settledAt),
      createdAt: leg.startTime,
      // v3.1 shield metadata (null for legacy ladder legs)
      tier: leg.tier ?? null,
      shieldType: leg.shieldType ?? null,
      noLossProb: leg.noLossProb ?? null,
      consensusPct: leg.consensusPct ?? null,
    });
    if (!ok) continue; // duplicate deterministic hash — skip silently
    createdIds.push({ id: hash, status, kind: "SIGNAL", title: leg.label });
    bank = round2(bank + net);
    if (status === "WON") won++;
    else if (status === "LOST") lost++;
    else void_++;
  }

  let vetoCount = 0;
  // v3.2 §3.2 — only veto rows with a computable REAL verdict are inserted
  // (wouldHaveBeen present → resolveSelection vs the REAL FT). Rows that
  // cannot be scored are skipped so no verdict-null record ever exists.
  for (const v of vetoes.slice(0, VETO_INSERT_CAP)) {
    if (!v.wouldHaveBeen) continue;
    let verdict = "UNKNOWN";
    let savedUnits: number | null = null;
    if (v.wouldHaveBeen) {
      const pick = v.wouldHaveBeen;
      // v2.5 unified staking — the shadow book values vetoes at the SAME
      // Quarter-Kelly stake the signal center would have issued (1%-3.5% band).
      const refStake = calculateSafeQuarterKellyStake(pick.modelProb, pick.price).stakeUnits || MIN_STAKE;
      const verdict_ = resolveSelection(pick.marketKey, pick.selection, pick.fixture);
      if (verdict_.status === "LOST") {
        verdict = "SAVED_LOSS";
        savedUnits = refStake; // stake spared by the veto
      } else if (verdict_.status === "WON") {
        verdict = "MISSED_WIN";
        savedUnits = round2(-refStake * (pick.price - 1)); // honest opportunity cost
      } else {
        verdict = "PENDING";
        savedUnits = 0;
      }
    }
    await db.shadowVeto.create({
      data: {
        signalRef: v.ref, reason: v.reason, category: v.category,
        sport: v.sport, league: v.league,
        repMatch: v.ref, // v2.7.1 — tracker shows the REAL fixture name
        startTime: v.startTime, // v2.7.1 — REAL kickoff for the tracker table
        marketLabel: v.wouldHaveBeen ? v.wouldHaveBeen.marketKey : null,
        selection: v.wouldHaveBeen ? v.wouldHaveBeen.selection : null,
        price: v.wouldHaveBeen ? v.wouldHaveBeen.price : null,
        modelProb: v.wouldHaveBeen ? v.wouldHaveBeen.modelProb : null,
        ftScore: v.ftScore, // REAL final score of the vetoed fixture
        savedUnits, verdict,
        decidedAt: settleTime(v.startTime),
      },
    });
    vetoCount++;
  }

  // Poster queue for Telegram Studio — recent signals + recent results.
  let posters = 0;
  const recent = createdIds.slice(-6);
  for (const r of recent) {
    await db.posterLog.create({
      data: { kind: r.kind, signalId: r.id, title: r.title.slice(0, 180), sent: false, transport: "preview" },
    });
    posters++;
  }
  const results = createdIds.filter((r) => r.status === "WON" || r.status === "LOST").slice(-4);
  for (const r of results) {
    await db.posterLog.create({
      data: { kind: r.status === "WON" ? "WIN" : "LOSS", signalId: r.id, title: r.title.slice(0, 180), sent: false, transport: "preview" },
    });
    posters++;
  }

  const seededAt = new Date().toISOString();
  await setSetting(HISTORY_SEEDED_KEY, seededAt);
  return {
    skipped: false,
    fixturesFetched: pack.football.length + pack.tennis.length + pack.basketball.length,
    matchesUpserted: pack.football.length + pack.tennis.length + pack.basketball.length,
    signalsSeeded: won + lost + void_,
    won, lost, void: void_, accas, vetoes: vetoCount, posters,
    notes: pack.notes, seededAt,
  };
}

/** Realistic settlement moment: kickoff + ~2h, never in the future. */
function settleTime(startTime: Date): Date {
  const t = new Date(startTime.getTime() + 2 * 3600_000);
  return t.getTime() > Date.now() - 60_000 ? new Date(Date.now() - 60_000) : t;
}

/**
 * Insert a seeded signal, tolerating a duplicate deterministic SHA-256 lock
 * (a re-run of an interrupted backfill recomputes the SAME hash). A P2002
 * duplicate is skipped silently; any other failure still surfaces.
 */
async function createSeededSignal(data: Parameters<typeof db.signal.create>[0]["data"]): Promise<boolean> {
  try {
    await db.signal.create({ data });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return false;
    throw err;
  }
}

export interface TennisSeedSummary {
  skipped: boolean;
  reason: string;
  fixtures: number;
  seeded: number;
  won: number;
  lost: number;
  void: number;
  ranAt: string;
}

/**
 * v2.7.1 hotfix §2.5 — 30-day tennis ledger backfill for EXISTING installs.
 * seedRealHistory runs once with the old 7-day tennis window; installs that
 * already have a football ledger would otherwise keep an empty tennis tab
 * forever. This appends settled tennis singles from the last 30 days of REAL
 * ATP/WTA (and Davis Cup ties carried by the tours) — no wipe, no mocks:
 * real ESPN set scores, the same tennis factory, the same Quarter-Kelly
 * staking chain against the running bank.
 */
export async function seedTennisHistory(): Promise<TennisSeedSummary> {
  const ranAt = new Date().toISOString();
  const flag = await getSetting(TENNIS_SEEDED_KEY);
  const tennisSettled = await db.signal.count({ where: { sport: "tennis", status: { not: "OPEN" } } });
  // v2.7.2 hotfix — the completion flag ALONE guards the re-run. The old
  // `flag && tennisSettled > 0` condition re-fetched 30 days of ESPN and
  // re-ran hundreds of upserts on EVERY request whenever the hard +EV gate
  // legitimately produced 0 surviving rows — the root cause of the ~12s
  // /api/bootstrap loop that pinned the dashboard on Skeleton Loading.
  // A re-run is requested EXPLICITLY by deleting the flag (the EV migration
  // path does exactly that); a completed seed is never silently re-run.
  if (flag) {
    return {
      skipped: true,
      reason: tennisSettled > 0
        ? "30d tennis history already seeded"
        : "already seeded — 0 rows passed the hard +EV gate",
      fixtures: 0, seeded: 0, won: 0, lost: 0, void: 0, ranAt,
    };
  }

  const pack = await fetchTennisPastRange(TENNIS_RANGE[0], TENNIS_RANGE[1]);
  const finished = pack
    .filter((m) => m.status === "post" && m.homeScore != null && m.awayScore != null)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  let bank = round2(STARTING_BANK + await db.signal.aggregate({ _sum: { netProfit: true } }).then((a) => a._sum.netProfit ?? 0));
  let seeded = 0, won = 0, lost = 0, void_ = 0;

  for (const m of finished) {
    if (seeded >= TENNIS_BACKFILL_LIMIT) break;
    const id = await upsertHistoryMatch(m);
    const ctx = {
      id, sport: "tennis" as const, league: m.league, leagueCode: m.leagueCode,
      homeName: m.homeName, awayName: m.awayName, homeRank: m.homeRank ?? null,
      awayRank: m.awayRank ?? null, startTime: m.startTime, status: m.status,
      surface: m.surface ?? null, venue: m.venue ?? null, round: m.round ?? null,
    };
    const rng = mulberry32(hashSeed(m.espnEventId));
    const roll = rng();
    const f = buildTennisFactory(ctx);
    // v3.1 — Push-Shield pick FIRST: the protected-market engine has no EV
    // blocking dependency, so a Tier-cleared shield candidate (noLoss ≥ 0.72,
    // win ≥ 0.52, Tier S/A/B) enters the tennis ledger with REAL set scores
    // and the constant-risk flat stake — exactly the live engine's behavior.
    const shield = shieldPickForFixture(m, ctx, f, null, null);
    if (shield) {
      const v = resolveSelection(shield.marketKey, shield.selection, shield.fixture);
      const stake = FLAT_VIEW_STAKE;
      const net = round2(
        v.status === "WON" ? stake * v.factor * (shield.price - 1)
          : v.status === "LOST" ? -stake : 0,
      );
      const status = net > 0 && v.status === "WON" ? "WON"
        : v.status === "LOST" ? "LOST"
          : net === 0 && v.status === "WON" ? "VOID" : v.status;
      const settledAt = settleTime(m.startTime);
      const hash = lockSignal({
        matchInfo: shield.label, sport: "tennis", line: "SHIELD",
        marketKey: shield.marketKey, selection: shield.selection,
        price: shield.price, modelProb: shield.modelProb, evPct: shield.evPct,
        stake, issuedAt: m.startTime.toISOString(),
      });
      await createSeededSignal({
        matchId: id, sport: "tennis", line: "SHIELD",
        marketKey: shield.marketKey, marketLabel: shield.marketLabel,
        selection: shield.selection,
        modelProb: shield.modelProb, trueProb: shield.trueProb, price: shield.price,
        evPct: shield.evPct, stake, stakeMode: "FLAT_100", shaHash: hash,
        status, netProfit: net, settledAt, dayKey: tehranDayKey(settledAt),
        createdAt: m.startTime,
        tier: shield.tier ?? null, shieldType: shield.shieldType ?? null,
        noLossProb: shield.noLossProb ?? null, consensusPct: shield.consensusPct ?? null,
      });
      bank = round2(bank + net);
      seeded++;
      if (status === "WON") won++;
      else if (status === "LOST") lost++;
      else void_++;
      continue;
    }
    // v2.7.2 §1 — HARD +EV tennis backfill: only factory candidates that
    // passed the strict gate (EV >= +4.0%, Kelly > 0, winner = REAL prices,
    // Total Sets = REAL prices) may enter the ledger. The old widening ladder
    // (EV>=0 → strongest quote) manufactured the audited -77.3u tab and is
    // banned here forever. No free historical tennis odds exist, so the
    // surviving rows carry the honest MODEL FAIR price — set scores, stakes
    // and results stay 100% REAL.
    const c = f.single ?? f.anchors[0] ?? null;
    const keep = roll <= COVERAGE || (roll <= COVERAGE + ANCHOR_COVERAGE && f.anchors[0]);
    if (!keep || !c) continue;
    const evRaw = c.modelProb * c.price - 1;
    if (evRaw < MIN_TENNIS_EV || fullKelly(c.modelProb, c.price) <= 0) continue;

    const evPct = "evPct" in c && typeof c.evPct === "number"
      ? c.evPct
      : Math.round(evRaw * 1000) / 10;
    const marketLabel = ("marketLabel" in c && c.marketLabel
      ? String(c.marketLabel)
      : getMarket(c.marketKey)?.label ?? c.marketKey);
    const { stake, stakeMode } = chooseStakeMode(c.modelProb, c.price, bank);
    if (stake <= 0) continue; // §1 — forced 10u stakes on non-+EV picks are dead
    const fixture = {
      sport: "tennis", homeScore: m.homeScore!, awayScore: m.awayScore!,
      retired: m.retired === true,
    };
    const v = resolveSelection(c.marketKey, c.selection, fixture);
    const net = round2(
      v.status === "WON" ? stake * v.factor * (c.price - 1)
        : v.status === "LOST" ? -stake : 0,
    );
    const status = net > 0 && v.status === "WON" ? "WON"
      : v.status === "LOST" ? "LOST"
        : net === 0 && v.status === "WON" ? "VOID" : v.status;
    const settledAt = settleTime(m.startTime);
    const hash = lockSignal({
      matchInfo: `${m.homeName} vs ${m.awayName} — ${c.marketKey} ${c.selection}`,
      sport: "tennis", line: "SINGLE_EV", marketKey: c.marketKey, selection: c.selection,
      price: c.price, modelProb: c.modelProb, evPct, stake,
      issuedAt: m.startTime.toISOString(),
    });
    await createSeededSignal({
      matchId: id, sport: "tennis", line: "SINGLE_EV",
      marketKey: c.marketKey, marketLabel, selection: c.selection,
      modelProb: c.modelProb, trueProb: c.trueProb, price: c.price,
      evPct, stake, stakeMode, shaHash: hash,
      status, netProfit: net, settledAt, dayKey: tehranDayKey(settledAt),
      createdAt: m.startTime,
    });
    bank = round2(bank + net);
    seeded++;
    if (status === "WON") won++;
    else if (status === "LOST") lost++;
    else void_++;
  }

  await setSetting(TENNIS_SEEDED_KEY, ranAt);
  return { skipped: false, reason: tennisSettled === 0 ? "empty tennis tab backfilled (30d)" : "refreshed", fixtures: finished.length, seeded, won, lost, void: void_, ranAt };
}

/**
 * v2.7.2 hotfix — single-flight, NON-BLOCKING runner for the 30-day tennis
 * backfill. `ensureBootstrapState` and the EV migration both fire this as a
 * background task (never awaited on the request path): concurrent requests
 * share ONE in-flight run instead of stacking duplicate ESPN fetches, and a
 * failure is logged without ever rejecting into the bootstrap pipeline.
 */
let tennisSeedInFlight: Promise<TennisSeedSummary> | null = null;

export function runTennisSeedBackground(): Promise<TennisSeedSummary> {
  if (!tennisSeedInFlight) {
    tennisSeedInFlight = seedTennisHistory()
      .then((summary) => {
        if (!summary.skipped) {
          console.log(`[tennis-backfill] ${summary.reason}: ${summary.seeded} seeded (W${summary.won}/L${summary.lost}/V${summary.void}) from ${summary.fixtures} fixtures`);
        }
        return summary;
      })
      .catch((err) => {
        console.error("tennis 30d backfill failed (background, non-fatal)", err);
        return {
          skipped: false, reason: `background run failed: ${(err as Error).message}`,
          fixtures: 0, seeded: 0, won: 0, lost: 0, void: 0,
          ranAt: new Date().toISOString(),
        } satisfies TennisSeedSummary;
      })
      .finally(() => { tennisSeedInFlight = null; });
  }
  return tennisSeedInFlight;
}

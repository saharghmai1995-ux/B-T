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
import type { FeedMatch, TeamStat } from "@/core/types";
import { fetchFootballPastDay, fetchTennisPastRange, pastDayKey, fetchFootballSummaryOdds } from "@/core/bookmakers/espn-history";
import { fetchFootballStandings, FOOTBALL_LEAGUES } from "@/core/bookmakers/odds-feed";
import { getMarket } from "@/core/bookmakers/market-whitelist";
import { buildFootballFactory, buildTennisFactory } from "./signal-factory";
import { resolveSelection } from "@/core/ledger/settlement-engine";
import { chooseStakeMode, accaPrice, STARTING_BANK, calculateSafeQuarterKellyStake, MIN_STAKE } from "@/core/math/kelly";
import { round2 } from "@/core/math/devig";
import { lockSignal } from "@/core/ledger/sha256-chain";
import { tehranDayKey } from "./ingest-service";
import { leagueAverageGoals, findTeamStat } from "./feed-gatherer";
import { setSetting, getSetting } from "./settings";

export const HISTORY_SEEDED_KEY = "historySeededAt";

const TOXIC_LEAGUES = new Set(["esp.2", "usa.1", "fifa.friendly"]);
const FOOTBALL_PAST_DAYS = [1, 2, 3, 4]; // all-league probes (yesterday .. -4)
const FOOTBALL_FILL_DAYS = [5, 6, 7]; // active-league fills up to the full 7-day window
// v2.7.1 hotfix §2.5 — 30 days of finished ATP/WTA (+ Davis Cup ties carried
// by the tours' scoreboards) so the tennis tab of the ledger never stays zero.
const TENNIS_RANGE = [30, 1]; // from 30 days ago to yesterday
const TENNIS_SEEDED_KEY = "tennisHistorySeededAt"; // one-time 30d tennis backfill flag
const COVERAGE = 0.66; // share of finished fixtures the supervisor would have issued
const ANCHOR_COVERAGE = 0.3; // occasional extra anchor pick (as in live acca anchors)
const ACCA_EVERY = 6; // every N-th issued signal becomes a 2-leg acca instead
const MAX_SUMMARY_FETCHES = 90; // closing-odds summary calls per backfill run
const TENNIS_BACKFILL_MAX = 48; // tennis singles cap per backfill run (cold-start safe)

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

/** REAL history pack only — a total network outage leaves an empty pack. */
async function fetchHistoryPack(): Promise<{ football: FeedMatch[]; tennis: FeedMatch[]; notes: string[] }> {
  const notes: string[] = [];

  // Probe recent past days across ALL leagues, then fill older days for active ones only.
  const probe: FeedMatch[] = [];
  for (const d of FOOTBALL_PAST_DAYS) {
    probe.push(...await fetchFootballPastDay(pastDayKey(d), [...FOOTBALL_LEAGUES]));
  }
  const activeLeagues = [...new Set(probe.map((m) => m.leagueCode))];
  const fill: FeedMatch[] = [];
  for (const d of FOOTBALL_FILL_DAYS) {
    fill.push(...await fetchFootballPastDay(pastDayKey(d), activeLeagues.length ? activeLeagues : [...FOOTBALL_LEAGUES]));
  }
  const football = [...probe, ...fill];
  if (activeLeagues.length === 0) notes.push("No finished football fixtures found in the 7-day window");
  const tennis = await fetchTennisPastRange(TENNIS_RANGE[0], TENNIS_RANGE[1]);
  if (tennis.length === 0) notes.push("No finished tennis fixtures found in the 7-day window");

  return { football, tennis, notes };
}

interface PendingLeg {
  matchId: string;
  espnEventId: string;
  sport: "football" | "tennis";
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
  pack: { football: FeedMatch[]; tennis: FeedMatch[] },
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
  const all = [...pack.football, ...pack.tennis].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );
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
  for (const m of all.slice(0, 240)) {
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
        category: "league",
        sport: m.sport, league: m.league, ftScore, startTime: m.startTime,
        wouldHaveBeen: soft
          ? { marketKey: soft.marketKey, selection: soft.selection, price: soft.price, modelProb: soft.modelProb, fixture }
          : null,
      });
      continue;
    }
    const ctx = {
      id, sport: m.sport as "football" | "tennis", league: m.league, leagueCode: m.leagueCode,
      homeName: m.homeName, awayName: m.awayName, homeRank: m.homeRank ?? null,
      awayRank: m.awayRank ?? null, startTime: m.startTime, status: m.status,
      surface: m.surface ?? null, venue: m.venue ?? null, round: m.round ?? null,
    };
    const rng = mulberry32(hashSeed(m.espnEventId));
    const roll = rng();
    const f = m.sport === "football"
      ? buildFootballFactory(
          ctx,
          findTeamStat(standings, m.leagueCode, m.homeName),
          findTeamStat(standings, m.leagueCode, m.awayName),
          oddsByEvent.get(m.espnEventId) ?? m.refOdds ?? null,
          leagueAvg(standings[m.leagueCode]),
        )
      : buildTennisFactory(ctx);
    // Primary pick: live-gate single → soft paper pick (EV ≥ 0 vs REAL closing
    // odds — the backfill keeps every edge the model saw, not just deep value)
    // → anchor fallback. Supervisor selectivity applies via the coverage roll.
    const soft = bestSoftPick(f.quotes);
    const c = f.single ?? soft ?? f.anchors[0] ?? null;
    const keep = roll <= COVERAGE || (roll <= COVERAGE + ANCHOR_COVERAGE && f.anchors[0]);
    if (!keep || !c) continue;
    const push = (cand: typeof c) => {
      const evPct = "evPct" in cand && typeof cand.evPct === "number"
        ? cand.evPct
        : Math.round((cand.modelProb * cand.price - 1) * 1000) / 10;
      singles.push({
        matchId: id, espnEventId: m.espnEventId, sport: m.sport as "football" | "tennis",
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
    };
    push(c);
    // Occasional second (anchor) pick on the same fixture — mirrors live acca anchors.
    if (roll > COVERAGE && f.anchors[0] && f.anchors[0].marketKey !== c.marketKey) {
      push(f.anchors[0]);
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
      const stake = chooseStakeMode(prob, price, bank).stake;
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
      const row = await db.signal.create({
        data: {
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
        },
      });
      createdIds.push({ id: row.id, status, kind: "SIGNAL", title: legs.map((l) => l.label).join(" + ") });
      bank = round2(bank + net);
      accas++;
      if (status === "WON") won++;
      else if (status === "LOST") lost++;
      else void_++;
      i++; // consumed the second leg
      continue;
    }

    const { stake, stakeMode } = chooseStakeMode(leg.modelProb, leg.price, bank);
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
      matchInfo: leg.label, sport: leg.sport, line: "SINGLE_EV",
      marketKey: leg.marketKey, selection: leg.selection, price: leg.price,
      modelProb: leg.modelProb, evPct: leg.evPct, stake,
      issuedAt: leg.startTime.toISOString(),
    });
    const row = await db.signal.create({
      data: {
        matchId: leg.matchId, sport: leg.sport, line: "SINGLE_EV",
        marketKey: leg.marketKey, marketLabel: leg.marketLabel, selection: leg.selection,
        modelProb: leg.modelProb, trueProb: leg.trueProb, price: leg.price,
        evPct: leg.evPct, stake, stakeMode, shaHash: hash,
        status, netProfit: net, settledAt, dayKey: tehranDayKey(settledAt),
        createdAt: leg.startTime,
      },
    });
    createdIds.push({ id: row.id, status, kind: "SIGNAL", title: leg.label });
    bank = round2(bank + net);
    if (status === "WON") won++;
    else if (status === "LOST") lost++;
    else void_++;
  }

  let vetoCount = 0;
  for (const v of vetoes.slice(0, 14)) {
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
    fixturesFetched: pack.football.length + pack.tennis.length,
    matchesUpserted: pack.football.length + pack.tennis.length,
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
  if (flag && tennisSettled > 0) {
    return { skipped: true, reason: "30d tennis history already seeded", fixtures: 0, seeded: 0, won: 0, lost: 0, void: 0, ranAt };
  }

  const pack = await fetchTennisPastRange(TENNIS_RANGE[0], TENNIS_RANGE[1]);
  const finished = pack
    .filter((m) => m.status === "post" && m.homeScore != null && m.awayScore != null)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  let bank = round2(STARTING_BANK + await db.signal.aggregate({ _sum: { netProfit: true } }).then((a) => a._sum.netProfit ?? 0));
  let seeded = 0, won = 0, lost = 0, void_ = 0;

  for (const m of finished) {
    if (seeded >= TENNIS_BACKFILL_MAX) break;
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
    // v2.7.1 §2.5 — history picks use the same widening ladder as the veto
    // candidates (strict band EV≥0 → strongest in-band quote). No free
    // historical tennis odds exist anywhere, so the settled rows carry the
    // honest MODEL FAIR price (ESTIMATE provenance) — set scores, stakes and
    // results stay 100% REAL.
    const c = f.single ?? pickVetoCandidate(f.quotes) ?? f.anchors[0] ?? null;
    const keep = roll <= COVERAGE || (roll <= COVERAGE + ANCHOR_COVERAGE && f.anchors[0]);
    if (!keep || !c) continue;

    const evPct = "evPct" in c && typeof c.evPct === "number"
      ? c.evPct
      : Math.round((c.modelProb * c.price - 1) * 1000) / 10;
    const marketLabel = ("marketLabel" in c && c.marketLabel
      ? String(c.marketLabel)
      : getMarket(c.marketKey)?.label ?? c.marketKey);
    const { stake, stakeMode } = chooseStakeMode(c.modelProb, c.price, bank);
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
    await db.signal.create({
      data: {
        matchId: id, sport: "tennis", line: "SINGLE_EV",
        marketKey: c.marketKey, marketLabel, selection: c.selection,
        modelProb: c.modelProb, trueProb: c.trueProb, price: c.price,
        evPct, stake, stakeMode, shaHash: hash,
        status, netProfit: net, settledAt, dayKey: tehranDayKey(settledAt),
        createdAt: m.startTime,
      },
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

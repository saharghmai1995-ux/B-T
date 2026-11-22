/**
 * Ingest Service — the live sync orchestrator (server-only).
 * Feed → match upserts → settlement of finished fixtures → fresh quotes →
 * Line-1 singles + Line-2 accas + Line-3 real arb. Cold-start safe.
 */

import { db } from "@/lib/db";
import type { FeedMatch, MatchContext, TeamStat } from "@/core/types";
import { gatherFeed, findTeamStat, leagueAverageGoals, type GatheredPack } from "./feed-gatherer";
import { fetchEspnPublicEventOdds } from "@/core/bookmakers/odds-feed";
import { buildFootballFactory, buildTennisFactory } from "./signal-factory";
import { lockSignal } from "@/core/ledger/sha256-chain";
import { resolveSelection } from "@/core/ledger/settlement-engine";
import { accaPrice, chooseStakeMode } from "@/core/math/kelly";
import { round2 } from "@/core/math/devig";
import { runRcaVetoes } from "./rca-veto";

export interface IngestSummary {
  matchesUpserted: number;
  quotesUpserted: number;
  signalsCreated: number;
  settledCount: number;
  accasCreated: number;
  degraded: boolean;
  notes: string[];
  ranAt: string;
}

/** Tehran-locale day key (free-signal accounting + settlement grouping). */
export function tehranDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d);
}

async function upsertMatch(m: FeedMatch): Promise<string> {
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
      detail: m.detail ?? null, startTime: m.startTime,
      homeLogo: m.homeLogo ?? undefined, awayLogo: m.awayLogo ?? undefined,
    },
  });
  return row.id;
}

const ctxOf = (m: FeedMatch, id: string): MatchContext => ({
  id, sport: m.sport, league: m.league, leagueCode: m.leagueCode,
  homeName: m.homeName, awayName: m.awayName, homeRank: m.homeRank, awayRank: m.awayRank,
  startTime: m.startTime, status: m.status, surface: m.surface, venue: m.venue, round: m.round,
});

/** Settle every OPEN signal of finished fixtures (honest accounting). */
async function settleFinished(
  pack: GatheredPack,
  idByEspn: Map<string, { id: string; sport: string }>,
): Promise<number> {
  const finished = [...pack.football, ...pack.tennis].filter(
    (m) => m.status === "post" && m.homeScore != null && m.awayScore != null,
  );
  let settled = 0;
  for (const m of finished) {
    const ref = idByEspn.get(m.espnEventId);
    if (!ref) continue;
    const open = await db.signal.findMany({ where: { matchId: ref.id, status: "OPEN" } });
    if (open.length === 0) continue;
    const fixture = {
      sport: ref.sport, homeScore: m.homeScore!, awayScore: m.awayScore!,
      retired: m.retired === true,
      detail: m.detail ?? null, // v2.7.2 — set scores feed tot_games/gamehand settlement
    };
    for (const sig of open) {
      if (sig.line === "ACCA2") {
        const done = await settleAcca(sig.id);
        settled += done ? 1 : 0;
        continue;
      }
      if (sig.line === "ARB") {
        settled += await settleArb(sig, fixture);
        continue;
      }
      const v = resolveSelection(sig.marketKey, sig.selection, fixture);
      const stakeUsed = sig.stake;
      const net = round2(v.status === "WON" ? stakeUsed * v.factor * (sig.price - 1)
        : v.status === "LOST" ? -stakeUsed : 0);
      const status = net > 0 && v.status === "WON" ? "WON" : v.status === "LOST" ? "LOST"
        : net === 0 && v.status === "WON" ? "VOID" : v.status;
      await db.signal.update({
        where: { id: sig.id },
        data: { status, netProfit: net, settledAt: new Date() },
      });
      settled++;
    }
  }
  return settled;
}

/** ACCA settlement — all legs must win; void leg degrades leg price to 1.0. */
async function settleAcca(signalId: string): Promise<boolean> {
  const sig = await db.signal.findUnique({ where: { id: signalId } });
  if (!sig || !sig.legs) return false;
  const legs = JSON.parse(sig.legs) as Array<{
    espnEventId: string; marketKey: string; selection: string; price: number; label: string;
  }>;
  const statuses: Array<"WON" | "LOST" | "VOID"> = [];
  let livePrice = 1;
  for (const leg of legs) {
    const m = await db.match.findUnique({ where: { espnEventId: leg.espnEventId } });
    if (!m || m.status !== "post" || m.homeScore == null) return false;
    const v = resolveSelection(leg.marketKey, leg.selection, {
      sport: m.sport, homeScore: m.homeScore, awayScore: m.awayScore!, retired: false,
    });
    statuses.push(v.status);
    if (v.status === "WON") livePrice *= leg.price;
    if (v.status === "VOID") livePrice *= 1.0;
  }
  if (statuses.some((s) => s === "LOST")) {
    await db.signal.update({
      where: { id: signalId },
      data: { status: "LOST", netProfit: round2(-sig.stake), settledAt: new Date() },
    });
    return true;
  }
  if (statuses.every((s) => s === "WON" || s === "VOID")) {
    const eff = round2(livePrice);
    const net = round2(sig.stake * (eff - 1));
    const status = net > 0 ? "WON" : "VOID";
    await db.signal.update({
      where: { id: signalId },
      data: { status, netProfit: net, settledAt: new Date() },
    });
    return true;
  }
  return false;
}

/** ARB settlement — two opposite sides, half stake each. */
async function settleArb(sig: { id: string; stake: number; arbBooks: string | null }, fixture: { sport: string; homeScore: number; awayScore: number; retired: boolean }): Promise<number> {
  if (!sig.arbBooks) return 0;
  const books = JSON.parse(sig.arbBooks) as Array<{ book: string; selection: string; price: number }>;
  if (books.length !== 2) return 0;
  const v0 = resolveSelection("1x2", books[0].selection, fixture);
  const winner = v0.status === "WON" ? books[0] : books[1];
  // Honest arb PnL: half stake on each side — profit = 0.5*s*winPrice - s
  const profit = round2(0.5 * sig.stake * winner.price - sig.stake);
  await db.signal.update({
    where: { id: sig.id },
    data: { status: profit > 0 ? "WON" : "VOID", netProfit: profit, settledAt: new Date() },
  });
  return 1;
}

/** Generate quotes + Line-1 signals for upcoming fixtures. */
async function generateSignals(pack: GatheredPack): Promise<{ quotes: number; singles: number }> {
  const preAll = [...pack.football, ...pack.tennis].filter((m) => m.status === "pre");
  // v2.7.1 hotfix §2.5 — dedicated tennis budget: the old shared slice(0, 90)
  // was consumed by football alone (899 tennis pre fixtures sat beyond the
  // cap forever), so the 17 upcoming pre ties never reached the selector.
  const footballUp = preAll.filter((m) => m.sport === "football").slice(0, 60);
  const tennisUp = preAll
    .filter((m) => m.sport === "tennis")
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .slice(0, 50);
  const upcoming = [...footballUp, ...tennisUp];
  let quotes = 0;
  let singles = 0;
  const existing = await db.signal.findMany({
    where: { status: "OPEN", line: { in: ["SINGLE_EV"] } },
    select: { matchId: true, marketKey: true, selection: true },
  });
  const have = new Set(existing.map((s) => `${s.matchId}|${s.marketKey}|${s.selection}`));
  const bank = await currentBankroll();
  let espnTennisOddsFetches = 0; // v2.7.1 — layer-3 public-odds budget per run

  for (const m of upcoming.slice(0, 90)) {
    const id = await upsertMatch(m);
    const ctx = ctxOf(m, id);
    if (m.sport === "football") {
      const sh = findTeamStat(pack.standings, m.leagueCode, m.homeName);
      const sa = findTeamStat(pack.standings, m.leagueCode, m.awayName);
      const avg = leagueAverageGoals(pack.standings[m.leagueCode]);
      // v2.7 Layer 3 — keyless ESPN Core public odds: when the scoreboard
      // carries no reference book (and Layers 1/2 missed this fixture), the
      // public per-event odds endpoint keeps the market anchor alive.
      let ref = m.refOdds ?? null;
      if (!ref) {
        const pub = await fetchEspnPublicEventOdds("soccer", m.leagueCode, m.espnEventId);
        if (pub?.homeOdds != null && pub.awayOdds != null) {
          ref = { home: pub.homeOdds, away: pub.awayOdds, draw: pub.drawOdds };
        }
      }
      const f = buildFootballFactory(ctx, sh, sa, ref, avg);
      quotes += await persistQuotes(id, f.quotes);
      if (f.single && !have.has(`${id}|${f.single.marketKey}|${f.single.selection}`)) {
        singles += await persistSingle(f.single, bank);
      }
    } else {
      // v2.7.1 hotfix §2.5 — keyless ESPN Core PUBLIC per-event odds feed the
      // tennis selector directly (layer 3): when Layers 1/2 carry no row for
      // this pairing, the public market anchor still produces LIVE-priced
      // quotes — the 17 pre fixtures stop being a dead tab.
      let odds = pack.liveOdds;
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const pair = [norm(m.homeName), norm(m.awayName)].sort().join("|");
      const hasRow =
        odds.get(`${pair}|1XBET_LIVE`) ?? odds.get(`${pair}|PINNACLE`) ?? odds.get(`${pair}|ESPN_PUBLIC`);
      if (!hasRow && espnTennisOddsFetches < 30) {
        espnTennisOddsFetches++;
        const pub = await fetchEspnPublicEventOdds("tennis", m.leagueCode, m.espnEventId);
        if (pub?.homeOdds != null && pub.awayOdds != null) {
          odds = new Map(odds);
          odds.set(`${pair}|ESPN_PUBLIC`, {
            book: "ESPN_PUBLIC",
            home: pub.homeOdds,
            away: pub.awayOdds,
            homeName: m.homeName,
            awayName: m.awayName,
          });
        }
      }
      const f = buildTennisFactory(ctx, odds);
      quotes += await persistQuotes(id, f.quotes);
      if (f.single && !have.has(`${id}|${f.single.marketKey}|${f.single.selection}`)) {
        singles += await persistSingle(f.single, bank);
      }
    }
  }
  return { quotes, singles };
}

async function persistQuotes(matchId: string, quotes: FactoryQuotes): Promise<number> {
  if (quotes.length === 0) return 0;
  await db.oddsQuote.deleteMany({ where: { matchId, bookmaker: "1XBET_EST" } });
  await db.oddsQuote.createMany({
    data: quotes.map((q) => ({
      matchId, bookmaker: "1XBET_EST", marketKey: q.marketKey, selection: q.selection,
      price: q.price, trueProb: q.trueProb, source: q.source === "LIVE" ? "LIVE_REF" : "ESTIMATE",
    })),
  });
  return quotes.length;
}

type FactoryQuotes = ReturnType<typeof buildFootballFactory>["quotes"];

async function persistSingle(c: NonNullable<ReturnType<typeof buildFootballFactory>["single"]>, bank: number): Promise<number> {
  const { stake, stakeMode } = chooseStakeMode(c.modelProb, c.price, bank);
  // v2.7.2 §1 — stake 0 means raw Kelly <= 0: the candidate is never issued.
  if (stake <= 0) return 0;
  const hash = lockSignal({
    matchInfo: `${c.match.homeName} vs ${c.match.awayName}`,
    sport: c.match.sport, line: c.line, marketKey: c.marketKey, selection: c.selection,
    price: c.price, modelProb: c.modelProb, evPct: c.evPct, stake,
    issuedAt: new Date().toISOString(),
  });
  await db.signal.create({
    data: {
      matchId: c.match.id, sport: c.match.sport, line: c.line, marketKey: c.marketKey,
      marketLabel: c.marketLabel, selection: c.selection, modelProb: c.modelProb,
      trueProb: c.trueProb, price: c.price, evPct: c.evPct, stake, stakeMode,
      shaHash: hash, dayKey: tehranDayKey(new Date()),
    },
  });
  return 1;
}

async function currentBankroll(): Promise<number> {
  const agg = await db.signal.aggregate({ _sum: { netProfit: true } });
  return round2(1000 + (agg._sum.netProfit ?? 0));
}

/** Line 2 — build the best 2-leg acca from fresh anchors (independent matches). */
async function buildAccas(pack: GatheredPack): Promise<number> {
  const anchors: Array<{ matchId: string; espnEventId: string; label: string; marketKey: string; selection: string; price: number; prob: number }> = [];
  const preAll = [...pack.football, ...pack.tennis].filter((m) => m.status === "pre");
  const footballUp = preAll.filter((m) => m.sport === "football").slice(0, 40);
  const tennisUp = preAll
    .filter((m) => m.sport === "tennis")
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .slice(0, 30);
  const upcoming = [...footballUp, ...tennisUp];
  for (const m of upcoming) {
    const id = await db.match.findUnique({ where: { espnEventId: m.espnEventId }, select: { id: true } });
    if (!id) continue;
    const ctx = ctxOf(m, id.id);
    const avg = leagueAverageGoals(pack.standings[m.leagueCode]);
    const f = m.sport === "football"
      ? buildFootballFactory(ctx, findTeamStat(pack.standings, m.leagueCode, m.homeName), findTeamStat(pack.standings, m.leagueCode, m.awayName), m.refOdds ?? null, avg)
      : buildTennisFactory(ctx, pack.liveOdds);
    for (const a of f.anchors.slice(0, 1)) {
      anchors.push({
        matchId: id.id, espnEventId: m.espnEventId,
        label: `${m.homeName} vs ${m.awayName} — ${a.marketKey} ${a.selection}`,
        marketKey: a.marketKey, selection: a.selection, price: a.price, prob: a.modelProb,
      });
    }
  }
  anchors.sort((a, b) => b.prob * b.price - a.prob * a.price);
  const openAccas = await db.signal.count({ where: { status: "OPEN", line: "ACCA2" } });
  if (openAccas >= 2 || anchors.length < 2) return 0;
  const [l1, l2] = [anchors[0], anchors.find((a) => a.matchId !== anchors[0].matchId)];
  if (!l2) return 0;
  const legs = [l1, l2].map((l) => ({
    espnEventId: l.espnEventId, label: l.label, marketKey: l.marketKey,
    selection: l.selection, price: l.price, prob: l.prob,
  }));
  const price = accaPrice(legs.map((l) => l.price));
  const prob = legs.reduce((acc, l) => acc * l.prob, 1);
  const matchId = l1.matchId;
  // v2.5 unified staking — ACCA stakes with the SAME Quarter-Kelly rule.
  const bank = await currentBankroll();
  const accaStake = chooseStakeMode(prob, price, bank).stake;
  const hash = lockSignal({
    matchInfo: legs.map((l) => l.label).join(" + "), sport: "multi", line: "ACCA2",
    marketKey: "acca2", selection: "ACCA", price, modelProb: prob, evPct: prob * price - 1,
    stake: accaStake, issuedAt: new Date().toISOString(),
  });
  await db.signal.create({
    data: {
      matchId, sport: "football", line: "ACCA2", marketKey: "acca2",
      marketLabel: "2-Leg Smart Accumulator", selection: "ACCA",
      modelProb: prob, trueProb: prob, price, evPct: round2(prob * price - 1),
      stake: accaStake, stakeMode: "KELLY_025", legs: JSON.stringify(legs),
      shaHash: hash, dayKey: tehranDayKey(new Date()),
    },
  });
  return 1;
}

/** Full ingest run — injectable feed for tests. */
export async function runIngest(opts?: { feed?: GatheredPack }): Promise<IngestSummary> {
  const pack = opts?.feed ?? await gatherFeed();
  const all = [...pack.football, ...pack.tennis];

  // v2.0 ZERO-MOCK legacy purge: any simulated fixture left over from the
  // removed sim-feed era is wiped once (cascade removes its SIM signals too).
  const simPurge = await db.match.deleteMany({ where: { source: "SIM" } });
  const purged = simPurge.count;

  const idByEspn = new Map<string, { id: string; sport: string }>();
  for (const m of all) {
    idByEspn.set(m.espnEventId, { id: await upsertMatch(m), sport: m.sport });
  }
  const settledCount = await settleFinished(pack, idByEspn);
  const { quotes, singles } = await generateSignals(pack);
  const accasCreated = await buildAccas(pack);
  await runRcaVetoes();
  const summary: IngestSummary = {
    matchesUpserted: all.length, quotesUpserted: quotes,
    signalsCreated: singles, settledCount, accasCreated,
    degraded: pack.degraded, notes: pack.notes, ranAt: new Date().toISOString(),
  };
  if (purged > 0) summary.notes.push(`Legacy SIM rows purged: ${purged}`);
  await db.ingestState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastRun: new Date(), lastSummary: JSON.stringify(summary) },
    update: { lastRun: new Date(), lastSummary: JSON.stringify(summary) },
  });
  return summary;
}

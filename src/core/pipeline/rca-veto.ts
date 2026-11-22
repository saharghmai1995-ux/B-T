/**
 * RCA Veto Pipeline — turns HIGH-severity causal findings into shadow-ledger
 * vetoes. Vetoed groups never touch the bank; they are surfaced in the UI.
 * v2.0: every group veto carries its REAL representative fixture with the
 * REAL FT score, so the Shadow Ledger Tracker can prove the veto prevents
 * continued losses.
 * v2.7 (patch §5): the representative fixture is the group's most recent
 * SETTLED row — WON or LOST — and BOTH verdicts are computed honestly:
 *   • SAVED_LOSS (+Xu) — the engine selection LOST; the veto saved the stake.
 *   • MISSED_WIN (−Xu) — the engine selection WON; the veto missed that profit.
 * The tracker's Net Shadow Impact sums both signs transparently.
 */

import { db } from "@/lib/db";
import { runRca, type QqlRow } from "@/core/rca/qql-rca-engine";
import { getMarket, TOXIC_LEAGUES } from "@/core/bookmakers/market-whitelist";
import type { TeamStat } from "@/core/types";
import { buildFootballFactory } from "./signal-factory";
import { findTeamStat, leagueAverageGoals } from "./feed-gatherer";
import { fetchFootballStandings } from "@/core/bookmakers/odds-feed";
import { pickVetoCandidate } from "./real-history-backfill";
import { resolveSelection } from "@/core/ledger/settlement-engine";
import { calculateSafeQuarterKellyStake, MIN_STAKE } from "@/core/math/kelly";
import { round2 } from "@/core/math/devig";

function toQqlRows(rows: Array<Record<string, unknown>>): QqlRow[] {
  return rows.map((r) => ({
    id: String(r.id), sport: String(r.sport), league: String(r.league),
    line: String(r.line), marketLabel: String(r.marketLabel), selection: String(r.selection),
    status: String(r.status), price: Number(r.price), evPct: Number(r.evPct),
    stake: Number(r.stake), netProfit: Number(r.netProfit), matchInfo: String(r.matchInfo),
  }));
}

/** Analyze recent settled rows and persist new HIGH-severity vetoes. */
export async function runRcaVetoes(): Promise<number> {
  const settled = await db.signal.findMany({
    where: { status: { in: ["WON", "LOST"] } },
    include: {
      match: {
        select: {
          homeName: true, awayName: true, league: true,
          homeScore: true, awayScore: true, status: true, startTime: true,
        },
      },
    },
    orderBy: { settledAt: "desc" },
    take: 120,
  });
  if (settled.length < 6) return 0;
  const qqlRows: QqlRow[] = settled.map((s) => ({
    id: s.id, sport: s.sport, league: s.match.league, line: s.line,
    marketLabel: s.marketLabel, selection: s.selection, status: s.status,
    price: s.price, evPct: s.evPct, stake: s.stake, netProfit: s.netProfit ?? 0,
    matchInfo: `${s.match.homeName} vs ${s.match.awayName}`,
  }));
  const findings = [...runRca(qqlRows, "league"), ...runRca(qqlRows, "line")];
  const high = findings.filter((f) => f.severity === "HIGH");
  let created = 0;
  for (const f of high) {
    const reason = `${f.hypothesis} | ${f.recommendation}`;
    const exists = await db.shadowVeto.findFirst({
      where: { signalRef: f.group, category: "league" },
    });
    if (exists) continue;
    // v2.7 — representative REAL fixture: the group's most recent settled row,
    // LOST (veto saved the stake) or WON (veto missed a real win). Both sides
    // are computed from the SAME honest row, never invented.
    const groupRows = settled.filter(
      (s) => s.match.league === f.group || s.line === f.group,
    );
    const rep = groupRows[0] ?? null;
    const won = rep?.status === "WON";
    await db.shadowVeto.create({
      data: {
        signalRef: f.group,
        reason: rep
          ? `${reason} | نماینده واقعی: ${rep.match.homeName} vs ${rep.match.awayName}`
          : reason,
        category: "league",
        sport: rep?.sport ?? null,
        league: rep?.match.league ?? (groupRows.length ? f.group : null),
        repMatch: rep ? `${rep.match.homeName} vs ${rep.match.awayName}` : null,
        marketLabel: rep ? getMarket(rep.marketKey)?.label ?? rep.marketLabel : null,
        selection: rep?.selection ?? null,
        price: rep?.price ?? null,
        modelProb: rep?.modelProb ?? null,
        ftScore:
          rep && rep.match.homeScore != null && rep.match.awayScore != null
            ? `${rep.match.homeScore}-${rep.match.awayScore}`
            : null,
        // Honest signed impact:
        //   LOST → saved stake is POSITIVE (bank protected).
        //   WON → missed netProfit is NEGATIVE (opportunity cost).
        savedUnits: rep ? (won ? -(rep.netProfit ?? 0) : rep.stake) : null,
        verdict: rep ? (won ? "MISSED_WIN" : "SAVED_LOSS") : null,
        decidedAt: rep?.settledAt ?? null,
        startTime: rep?.match.startTime ?? null,
      },
    });
    created++;
  }
  return created;
}

export { toQqlRows };

export interface ShadowBackfillResult {
  purged: number;
  created: number;
  total: number;
}

/**
 * v2.7.1 hotfix §2.2 — Shadow Ledger Tracker must show 14 COMPLETE rows.
 * Legacy installs carry verdict=null / marketLabel=null / verdict=UNKNOWN
 * records (the old `wouldHaveBeen=null` path). This load-time guard:
 *   1) purges every incomplete row,
 *   2) rebuilds up to 14 rows from the REAL finished toxic-league fixtures
 *      already stored in the matches table — engine pre-veto selection via
 *      the same football factory, official market key, real margin odds,
 *      Quarter-Kelly reference stake, REAL FT score, honest SAVED_LOSS /
 *      MISSED_WIN verdict and the signed Net Shadow Impact.
 * Idempotent: complete rows are never touched.
 */
export async function backfillShadowVetoes(): Promise<ShadowBackfillResult> {
  const purged = await db.shadowVeto.deleteMany({
    where: { OR: [{ verdict: null }, { marketLabel: null }, { verdict: "UNKNOWN" }] },
  });
  const existing = await db.shadowVeto.findMany({ select: { signalRef: true } });
  const knownRefs = new Set(existing.map((v) => v.signalRef));
  const target = Math.max(0, 14 - existing.length);
  if (target === 0) {
    return { purged: purged.count, created: 0, total: existing.length };
  }

  const toxic = await db.match.findMany({
    where: {
      sport: "football",
      leagueCode: { in: [...TOXIC_LEAGUES] },
      status: "post",
      homeScore: { not: null },
      awayScore: { not: null },
    },
    orderBy: { startTime: "desc" },
    take: 80,
  });

  const leagues = [...new Set(toxic.map((m) => m.leagueCode))];
  const standings: Record<string, TeamStat[]> = {};
  const CHUNK = 4;
  for (let i = 0; i < leagues.length; i += CHUNK) {
    await Promise.all(leagues.slice(i, i + CHUNK).map(async (lg) => {
      const rows = await fetchFootballStandings(lg);
      if (rows.length) standings[lg] = rows;
    }));
  }

  let created = 0;
  for (const m of toxic) {
    if (created >= target) break;
    const ref = `${m.homeName} vs ${m.awayName}`;
    if (knownRefs.has(ref)) continue;
    const ctx = {
      id: m.id, sport: "football" as const, league: m.league, leagueCode: m.leagueCode,
      homeName: m.homeName, awayName: m.awayName, homeRank: m.homeRank,
      awayRank: m.awayRank, startTime: m.startTime, status: m.status,
      surface: m.surface, venue: m.venue, round: m.round,
    };
    const f = buildFootballFactory(
      ctx,
      findTeamStat(standings, m.leagueCode, m.homeName),
      findTeamStat(standings, m.leagueCode, m.awayName),
      null,
      leagueAverageGoals(standings[m.leagueCode]),
    );
    const pick = pickVetoCandidate(f.quotes);
    if (!pick) continue;
    const refStake = calculateSafeQuarterKellyStake(pick.modelProb, pick.price).stakeUnits || MIN_STAKE;
    const verdict_ = resolveSelection(pick.marketKey, pick.selection, {
      sport: "football", homeScore: m.homeScore!, awayScore: m.awayScore!, retired: false,
    });
    const won = verdict_.status === "WON";
    const decided = new Date(Math.min(
      m.startTime.getTime() + 2 * 3_600_000,
      Date.now() - 60_000,
    ));
    await db.shadowVeto.create({
      data: {
        signalRef: ref,
        reason: `Supervisor blacklist: league ${m.leagueCode} excluded pre-match (data-integrity risk) | نماینده واقعی: ${ref}`,
        category: "league",
        sport: "football",
        league: m.league,
        repMatch: ref,
        startTime: m.startTime,
        marketLabel: pick.marketKey,
        selection: pick.selection,
        price: pick.price,
        modelProb: pick.modelProb,
        ftScore: `${m.homeScore}-${m.awayScore}`,
        savedUnits: won
          ? round2(-refStake * (pick.price - 1)) // honest opportunity cost
          : verdict_.status === "LOST" ? refStake : 0,
        verdict: won ? "MISSED_WIN" : verdict_.status === "LOST" ? "SAVED_LOSS" : "PENDING",
        decidedAt: decided,
      },
    });
    knownRefs.add(ref);
    created++;
  }
  return { purged: purged.count, created, total: existing.length + created };
}

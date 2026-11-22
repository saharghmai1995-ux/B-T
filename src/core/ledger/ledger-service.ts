/**
 * Ledger Service — Single Source of Truth.
 * ALL header KPIs, category breakdowns, per-sport gyroscope stats, per-market
 * analytics, daily PnL bars and the equity curve are derived from ONE
 * function (computeMasterMetrics). The invariant
 * sum(categoryProfits) === bankroll - STARTING_BANK holds by construction.
 */

import type { MasterMetrics, SettledRow } from "@/core/types";
import { STARTING_BANK } from "@/core/math/kelly";
import { round2 } from "@/core/math/devig";
import { computeUnifiedBankrollMetrics } from "@/core/math/ledger-metrics";
import { marketFamily } from "@/core/bookmakers/market-family";

const WIN = "WON" as const;

export interface StatBucket { wins: number; losses: number; profit: number; winRate: number; settled: number }

/**
 * Master metrics over settled rows only.
 * - Win === positive profit (a settled row is WON iff netProfit > 0).
 * - Losses are honest: netProfit is exactly -(stake) for a full loss.
 * - Category maps sum EXACTLY to totalProfit (same rows, same rounding).
 * - sportStats/marketStats/leagueStats power the gyroscope + ledger charts.
 * - savedCapital comes from the REAL shadow ledger (supervisor vetoes).
 */
export function computeMasterMetrics(
  settledRows: SettledRow[],
  openRows: Array<{ stake: number }> = [],
  opts?: { savedCapital?: number; savedCount?: number },
): MasterMetrics {
  const byLine: Record<string, number> = {};
  const bySport: Record<string, number> = {};
  const byLeague: Record<string, number> = {};

  let totalProfit = 0;
  let totalStake = 0;
  let wins = 0, losses = 0, voids = 0;

  const sportStats: Record<string, StatBucket> = {};
  const marketStats: Record<string, StatBucket> = {};
  const leagueStats: Record<string, StatBucket> = {};

  const bump = (map: Record<string, StatBucket>, key: string, r: SettledRow, p: number) => {
    const b = map[key] ?? { wins: 0, losses: 0, profit: 0, winRate: 0, settled: 0 };
    b.settled++;
    b.profit = round2(b.profit + p);
    if (r.status === WIN) b.wins++;
    else if (r.status === "LOST") b.losses++;
    const decided = b.wins + b.losses;
    b.winRate = decided > 0 ? round2((b.wins / decided) * 100) : 0;
    map[key] = b;
  };

  const chron = settledRows
    .filter((r) => r.status !== "OPEN" && r.settledAt)
    .sort((a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0));

  // Daily PnL split by sport (last 30 days window built client-side from this).
  const dailyPnl: Array<{ date: string; football: number; tennis: number }> = [];
  const dailyIndex = new Map<string, number>();

  // Equity curve from the same chronology — day-keyed running bankroll with
  // football/tennis split running banks for the 3D glowing area chart.
  const curve: Array<{ date: string; bankroll: number; football: number; tennis: number }> = [];
  let running = STARTING_BANK;
  let runFootball = STARTING_BANK;
  let runTennis = STARTING_BANK;
  let dayBuf: string | null = null;

  for (const r of chron) {
    const p = round2(r.netProfit);
    totalProfit = round2(totalProfit + p);
    totalStake += r.stake;
    if (r.status === WIN) wins++;
    else if (r.status === "LOST") losses++;
    else if (r.status === "VOID") voids++;
    byLine[r.line] = round2((byLine[r.line] ?? 0) + p);
    bySport[r.sport] = round2((bySport[r.sport] ?? 0) + p);
    byLeague[r.league] = round2((byLeague[r.league] ?? 0) + p);
    bump(sportStats, r.sport, r, p);
    bump(marketStats, marketFamily(r.marketKey), r, p);
    bump(leagueStats, r.league, r, p);

    const d = r.settledAt ? dayKeyOf(r.settledAt) : "unknown";
    const di = dailyIndex.get(d);
    if (di == null) {
      dailyIndex.set(d, dailyPnl.length);
      dailyPnl.push({ date: d, football: r.sport === "football" ? p : 0, tennis: r.sport === "tennis" ? p : 0 });
    } else {
      const row = dailyPnl[di];
      if (r.sport === "football") row.football = round2(row.football + p);
      else row.tennis = round2(row.tennis + p);
    }

    running = round2(running + r.netProfit);
    if (r.sport === "football") runFootball = round2(runFootball + r.netProfit);
    else if (r.sport === "tennis") runTennis = round2(runTennis + r.netProfit);
    if (d !== dayBuf) {
      curve.push({ date: d, bankroll: running, football: runFootball, tennis: runTennis });
      dayBuf = d;
    } else if (curve.length) {
      const last = curve[curve.length - 1];
      last.bankroll = running;
      last.football = runFootball;
      last.tennis = runTennis;
    }
  }

  // Max drawdown over the running curve.
  let peak = STARTING_BANK;
  let maxDd = 0;
  for (const pt of curve) {
    peak = Math.max(peak, pt.bankroll);
    maxDd = round2(Math.max(maxDd, peak - pt.bankroll));
  }

  const openStake = round2(openRows.reduce((a, r) => a + r.stake, 0));

  // v2.7 — headline numbers now come from the patch's unified arithmetic
  // (single source of truth shared by Overview and Verified Ledger).
  const unified = computeUnifiedBankrollMetrics(
    [...settledRows.map((r) => ({ status: r.status, stakeUnits: r.stake, profitUnits: r.netProfit })),
     ...openRows.map((r) => ({ status: "PENDING", stakeUnits: r.stake, profitUnits: 0 }))],
    STARTING_BANK,
  );
  const bankroll = unified.currentBankroll;
  const roi = unified.roiPercent;
  const winRate = unified.winRatePercent;

  // Invariant: byLine + bySport maps both sum to totalProfit (same rows).
  const categoryProfits = { byLine, bySport, byLeague };
  return {
    bankroll,
    startingBank: STARTING_BANK,
    totalProfit,
    roi,
    winRate,
    maxDrawdown: maxDd,
    wins, losses, voids,
    openCount: openRows.length,
    openStake,
    categoryProfits,
    sportStats,
    marketStats,
    leagueStats,
    dailyPnl,
    equityCurve: curve,
    bankrollToday: bankroll,
    savedCapital: round2(opts?.savedCapital ?? 0),
    savedCount: opts?.savedCount ?? 0,
  };
}

function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Settle accounting — honest net profit for a closed position.
 * WON  = +stake*(price-1)   (must be > 0 to be called WON)
 * LOST = -stake             (full honest loss, no artificial stop)
 * VOID = 0                  (push / refund, e.g. DNB draw, retirement)
 */
export function settleNetProfit(
  status: "WON" | "LOST" | "VOID",
  stake: number,
  price: number,
): number {
  if (status === "WON") return round2(stake * (price - 1));
  if (status === "LOST") return round2(-stake);
  return 0;
}

/** Status guard — never label a non-positive profit as WON. */
export function statusFromProfit(netProfit: number, intended: "WON" | "LOST" | "VOID"): SettledRow["status"] {
  if (intended === "WON" && netProfit <= 0) {
    return netProfit === 0 ? "VOID" : "LOST";
  }
  return intended;
}

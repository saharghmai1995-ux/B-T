/**
 * Ledger Service — Single Source of Truth.
 * ALL header KPIs, category breakdowns and the equity curve are derived from
 * ONE function (computeMasterMetrics). The invariant
 * sum(categoryProfits) === bankroll - STARTING_BANK holds by construction.
 */

import type { MasterMetrics, SettledRow } from "@/core/types";
import { STARTING_BANK } from "@/core/math/kelly";
import { round2 } from "@/core/math/devig";

const WIN = "WON" as const;

/**
 * Master metrics over settled rows only.
 * - Win === positive profit (a settled row is WON iff netProfit > 0).
 * - Losses are honest: netProfit is exactly -(stake) for a full loss.
 * - Category maps sum EXACTLY to totalProfit (same rows, same rounding).
 */
export function computeMasterMetrics(
  settledRows: SettledRow[],
  openRows: Array<{ stake: number }> = [],
): MasterMetrics {
  const byLine: Record<string, number> = {};
  const bySport: Record<string, number> = {};
  const byLeague: Record<string, number> = {};

  let totalProfit = 0;
  let totalStake = 0;
  let wins = 0, losses = 0, voids = 0;

  const chron = settledRows
    .filter((r) => r.status !== "OPEN" && r.settledAt)
    .sort((a, b) => (a.settledAt?.getTime() ?? 0) - (b.settledAt?.getTime() ?? 0));

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
  }

  // Equity curve from the same chronology — day-keyed running bankroll.
  const curve: Array<{ date: string; bankroll: number }> = [];
  let running = STARTING_BANK;
  let dayBuf: string | null = null;
  for (const r of chron) {
    running = round2(running + r.netProfit);
    const d = r.settledAt ? dayKeyOf(r.settledAt) : "unknown";
    if (d !== dayBuf) {
      curve.push({ date: d, bankroll: running });
      dayBuf = d;
    } else if (curve.length) {
      curve[curve.length - 1].bankroll = running;
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
  const bankroll = round2(STARTING_BANK + totalProfit);
  const decided = wins + losses;
  const roi = totalStake > 0 ? round2((totalProfit / totalStake) * 100) : 0;
  const winRate = decided > 0 ? round2((wins / decided) * 100) : 0;

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
    equityCurve: curve,
    bankrollToday: bankroll,
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

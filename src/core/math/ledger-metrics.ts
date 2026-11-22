/**
 * Unified Ledger Metrics (v2.7) — the patch's single arithmetic source for
 * bankroll / net profit / ROI / win-rate. Both the Overview and the Verified
 * Ledger consume the SAME output through computeMasterMetrics, so no
 * contradiction (e.g. the audited 20.0u gap) can ever appear between tabs.
 */

export interface UnifiedLedgerMetrics {
  initialBankroll: number;
  currentBankroll: number;
  netProfitUnits: number;
  totalStakedUnits: number;
  roiPercent: number;
  winRatePercent: number;
  wins: number;
  losses: number;
  pending: number;
  voids: number;
}

export interface UnifiedRowInput {
  status: string;
  stakeUnits: number;
  profitUnits: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeUnifiedBankrollMetrics(
  signals: UnifiedRowInput[],
  initialBankroll = 1000,
): UnifiedLedgerMetrics {
  const settled = signals.filter((s) => s.status === "WON" || s.status === "LOST");
  const wins = settled.filter((s) => s.status === "WON").length;
  const losses = settled.filter((s) => s.status === "LOST").length;
  const pending = signals.filter((s) => s.status === "PENDING").length;
  const voids = signals.filter((s) => s.status === "VOID").length;

  const netProfitUnits = r2(settled.reduce((acc, s) => acc + (s.profitUnits || 0), 0));
  const totalStakedUnits = r2(settled.reduce((acc, s) => acc + (s.stakeUnits || 0), 0));
  const currentBankroll = r2(initialBankroll + netProfitUnits);
  // v2.7.1 — Number(toFixed()) keeps the SHORTEST float repr: the raw
  // r2(...)/10 division printed 51.282000000000004% on the ledger header.
  const roiPercent = totalStakedUnits > 0 ? Number(((netProfitUnits / totalStakedUnits) * 100).toFixed(2)) : 0;
  const winRatePercent = settled.length > 0 ? Number(((wins / settled.length) * 100).toFixed(2)) : 0;

  return {
    initialBankroll,
    currentBankroll,
    netProfitUnits,
    totalStakedUnits,
    roiPercent,
    winRatePercent,
    wins,
    losses,
    pending,
    voids,
  };
}

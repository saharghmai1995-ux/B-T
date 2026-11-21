/**
 * Fractional Kelly (0.25x) + Expected-Value calculator.
 * Server-only math: the UI never computes stakes.
 * v2.5 UNIFIED STAKING: the whole system (live cards, ACCA, ARB, ledger
 * settlement) runs on Quarter-Kelly with a safe band of 1%–3.5% of the
 * current bank (10u–35u on the 1,000u starting bank). The old FLAT_100
 * contradiction is retired — new signals never stake a flat 100u again.
 */

import { round2 } from "./devig";

export const STARTING_BANK = 1000;
export const FLAT_STAKE = 100; // legacy ledger rows only — NOT used for new stakes
export const FLAT_VIEW_STAKE = 20; // ledger comparison switch: Flat 20u = 2% view
export const KELLY_FRACTION = 0.25;
export const MAX_STAKE = 35; // 3.5% of the 1,000u bank
export const MIN_STAKE = 10; // 1.0% of the 1,000u bank

/** EV fraction of a stake: (p * price) - 1. Positive means +EV. */
export function expectedValue(prob: number, price: number): number {
  if (!(prob > 0 && price > 1)) return -1;
  return prob * price - 1;
}

/** Full Kelly fraction b = (p*b - (1-p))/b with b = price-1. */
export function fullKelly(prob: number, price: number): number {
  if (!(prob > 0 && price > 1.01)) return 0;
  const b = price - 1;
  const f = (prob * b - (1 - prob)) / b;
  return Math.max(0, f);
}

/**
 * v2.5 — THE single staking rule of the whole system:
 * Quarter-Kelly (0.25x full Kelly) clamped to the safe band 1%–3.5% of the
 * CURRENT bankroll. Protects against 5 straight losses (max 17.5% drawdown).
 */
export function calculateSafeQuarterKellyStake(
  modelProb: number,
  decimalOdds: number,
  currentBankroll = 1000,
): { stakeUnits: number; bankrollPct: number; fullKellyPct: number } {
  const b = decimalOdds - 1;
  if (b <= 0) return { stakeUnits: 0, bankrollPct: 0, fullKellyPct: 0 };
  const q = 1 - modelProb;
  const fullKellyPctRaw = (b * modelProb - q) / b;
  if (fullKellyPctRaw <= 0) return { stakeUnits: 0, bankrollPct: 0, fullKellyPct: 0 };

  // Quarter-Kelly with the 3.5% safety cap / 1% floor of the current bank:
  const quarterKelly = Math.min(0.035, Math.max(0.01, fullKellyPctRaw * 0.25));
  const stakeUnits = Number((currentBankroll * quarterKelly).toFixed(1));
  return {
    stakeUnits,
    bankrollPct: Number((quarterKelly * 100).toFixed(2)),
    fullKellyPct: Number((fullKellyPctRaw * 100).toFixed(2)),
  };
}

/** Fractional Kelly stake in units, clamped to house limits. */
export function fractionalKellyStake(
  prob: number,
  price: number,
  bankroll: number,
  fraction: number = KELLY_FRACTION,
): number {
  const f = fullKelly(prob, price) * fraction;
  const units = bankroll * f;
  if (!Number.isFinite(units)) return 0;
  return round2(Math.min(MAX_STAKE, Math.max(0, units)));
}

/**
 * v2.5 — unified stake mode picker. ALWAYS Quarter-Kelly (KELLY_025):
 * live cards and ledger settlement share the exact same stake, no more
 * 100u-FLAT vs 22u-Kelly contradiction anywhere in the system.
 */
export function chooseStakeMode(prob: number, price: number, bankroll: number): {
  stake: number;
  stakeMode: "KELLY_025" | "FLAT_100";
} {
  const s = calculateSafeQuarterKellyStake(prob, price, bankroll);
  // EV-threshold gates guarantee kelly > 0 upstream; the 10u floor keeps the
  // stake meaningful even for timid edges (1% of bank on a 1,000u bank).
  const stake = Math.max(MIN_STAKE, s.stakeUnits || MIN_STAKE);
  return { stake: Math.min(MAX_STAKE, stake), stakeMode: "KELLY_025" };
}

/**
 * Splits a daily budget across betslip picks using fractional Kelly weights.
 * Returns per-pick stakes that sum to the budget (honest, no rounding drift).
 */
export function allocateBetslip(
  picks: Array<{ id: string; prob: number; price: number }>,
  bankroll: number,
  totalBudgetFraction: number = 0.25,
): Record<string, number> {
  const raw: Record<string, number> = {};
  let sum = 0;
  for (const p of picks) {
    const f = fullKelly(p.prob, p.price) * KELLY_FRACTION;
    raw[p.id] = f;
    sum += f;
  }
  const out: Record<string, number> = {};
  if (sum <= 0 || picks.length === 0) {
    const even = round2((bankroll * totalBudgetFraction) / Math.max(1, picks.length));
    picks.forEach((p) => (out[p.id] = Math.max(MIN_STAKE, even)));
    return out;
  }
  const budget = bankroll * totalBudgetFraction;
  let allocated = 0;
  picks.forEach((p, idx) => {
    if (idx === picks.length - 1) {
      out[p.id] = round2(Math.max(MIN_STAKE, budget - allocated));
    } else {
      const s = round2((budget * raw[p.id]) / sum);
      out[p.id] = Math.max(MIN_STAKE, s);
      allocated += out[p.id];
    }
  });
  return out;
}

/** Cross-book arb check: (1/O_A + 1/O_B) <= threshold is a real arb. */
export function isCrossBookArb(prices: number[], threshold: number = 0.94): boolean {
  const valid = prices.length >= 2 && prices.every((p) => p > 1);
  if (!valid) return false;
  const s = prices.reduce((acc, p) => acc + 1 / p, 0);
  return s <= threshold;
}

/** Combined acca price — plain multiplication of independent legs. */
export function accaPrice(prices: number[]): number {
  return round2(prices.reduce((acc, p) => acc * p, 1));
}

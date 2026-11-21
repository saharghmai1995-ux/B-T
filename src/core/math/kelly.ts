/**
 * Fractional Kelly (0.25x) + Expected-Value calculator.
 * Server-only math: the UI never computes stakes.
 */

import { round2 } from "./devig";

export const STARTING_BANK = 1000;
export const FLAT_STAKE = 100;
export const KELLY_FRACTION = 0.25;
export const MAX_STAKE = 200;
export const MIN_STAKE = 10;

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

/** Pick stake mode: flat 100u when Kelly is timid, Kelly when it bites. */
export function chooseStakeMode(prob: number, price: number, bankroll: number): {
  stake: number;
  stakeMode: "FLAT_100" | "KELLY_025";
} {
  const k = fractionalKellyStake(prob, price, bankroll);
  if (k >= MIN_STAKE) return { stake: k, stakeMode: "KELLY_025" };
  return { stake: FLAT_STAKE, stakeMode: "FLAT_100" };
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

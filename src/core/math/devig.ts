/**
 * Shin De-Vig — extract true market probabilities from bookmaker prices.
 * Shin (1993) models insider-trading margin; more honest than naive normalization.
 * Reference: the real reference-market prices (ESPN provider / Pinnacle / 1xBet live).
 */

/** American (-115, +235) → decimal price. */
export function americanToDecimal(am: number): number {
  if (!Number.isFinite(am) || am === 0) return 0;
  return am < 0 ? 1 + 100 / Math.abs(am) : 1 + am / 100;
}

/** Round to 2 decimals (display + storage precision). */
export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Naive overround normalization (fallback when Shin cannot converge). */
export function proportionalDevig(prices: number[]): number[] {
  const inv = prices.map((p) => (Number.isFinite(p) && p > 1 ? 1 / p : NaN));
  if (inv.some((v) => !Number.isFinite(v))) {
    // cannot de-vig an incomplete book honestly → uniform fallback
    return prices.map(() => 1 / prices.length);
  }
  const s = inv.reduce((a, b) => a + b, 0);
  if (s <= 0) return prices.map(() => 1 / prices.length);
  return inv.map((v) => v / s);
}

/**
 * Shin probabilities for 2-way and 3-way books.
 * Solves for insider proportion z so that sum(shinPrice(p, z)) === overround.
 * Bisection: z is monotonic in overround, converges fast and deterministically.
 */
export function shinDevig(prices: number[]): number[] {
  const valid = prices.every((p) => Number.isFinite(p) && p > 1);
  if (!valid || prices.length < 2) return proportionalDevig(prices);
  const inv = prices.map((p) => 1 / p);
  const bookSum = inv.reduce((a, b) => a + b, 0);
  if (bookSum <= 1) return proportionalDevig(prices);

  const shinSum = (z: number, pi: number[]): number =>
    pi.reduce((acc, p) => {
      const root = Math.sqrt(z * z + 4 * (1 - z) * ((p * p) / (z + p * (1 - z))));
      return acc + (root - z) / (2 * (1 - z));
    }, 0);

  // bisection on z in (1e-6, 0.35)
  let lo = 1e-6;
  let hi = 0.35;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (shinSum(mid, inv) > bookSum) lo = mid;
    else hi = mid;
  }
  const z = (lo + hi) / 2;
  const raw = inv.map((p) => {
    const root = Math.sqrt(z * z + 4 * (1 - z) * ((p * p) / (z + p * (1 - z))));
    return (root - z) / (2 * (1 - z));
  });
  const s = raw.reduce((a, b) => a + b, 0);
  const out = raw.map((v) => v / s);
  // guard: probabilities must be positive and sum to ~1
  if (out.some((v) => !(v > 0 && v < 1))) return proportionalDevig(prices);
  return out;
}

/** De-vig helper for a football 1X2 book. */
export function devig1x2(home: number, draw: number, away: number) {
  const [ph, pd, pa] = shinDevig([home, draw, away]);
  return { home: ph, draw: pd, away: pa };
}

/** De-vig helper for an Over/Under two-sided book at the same line. */
export function devigTwoWay(over: number, under: number) {
  const [po, pu] = shinDevig([over, under]);
  return { over: po, under: pu };
}

/** Implied probability with margin, e.g. price = 1 / (prob * margin). */
export function marginPrice(prob: number, margin: number): number {
  if (!(prob > 0.005 && prob < 0.995)) return 0;
  return round2(1 / (prob * margin));
}

/** Real 1xBet-style margin per sport (public long-run average). */
export const BOOK_MARGIN: Record<"football" | "tennis", number> = {
  football: 1.055,
  tennis: 1.052,
};

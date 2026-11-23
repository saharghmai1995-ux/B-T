/**
 * NeoBet Quant Pro v3.1 — Optional Sharp-Market Prior Sensor
 * Reads REAL bookmaker odds ONLY when genuinely available, de-vigs them to
 * P_market, and flags divergence > 16pp vs the model pick (probable late
 * injury / lineup leak). NEVER invents 1.90 fallback prices and NEVER blocks
 * signal generation when the market is absent (weight = 0 → model-only blend).
 */

export interface SharpMarketPrior {
  available: boolean;
  source?: "ESPN_CORE_PUBLIC" | "THE_ODDS_API" | "ODDSPAPI";
  impliedWinProb?: number; // Normalized de-vigged probability (0..1)
  sharpDivergenceAlert: boolean; // True if sharp market strongly opposes our pick (>16pp)
}

/**
 * Non-blocking Sharp-Market Prior Sensor.
 * - Uses real bookmaker odds ONLY when genuinely available.
 * - NEVER invents 1.90 fallback prices and NEVER blocks signal generation when unavailable.
 */
export function evaluateSharpMarketPrior(
  modelNoLossProb: number,
  realMarketProb: number | null | undefined,
  source?: SharpMarketPrior["source"],
): SharpMarketPrior {
  if (
    typeof realMarketProb !== "number" ||
    !Number.isFinite(realMarketProb) ||
    realMarketProb <= 0.05 ||
    realMarketProb >= 0.98
  ) {
    return { available: false, sharpDivergenceAlert: false };
  }
  // If sharp market thinks our pick is >16% less likely than our model → probable late injury/lineup leak
  const divergence = modelNoLossProb - realMarketProb;
  return {
    available: true,
    source,
    impliedWinProb: realMarketProb,
    sharpDivergenceAlert: divergence > 0.16,
  };
}

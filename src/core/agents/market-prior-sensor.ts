/**
 * NeoBet Quant Pro v3.3.1 — Sharp-Market Prior Sensor
 * Reads REAL bookmaker odds ONLY when genuinely available, de-vigs them to
 * P_market, and flags divergence > 16pp vs the model pick (probable late
 * injury / lineup leak). NEVER invents 1.90 fallback prices and NEVER blocks
 * signal generation when the market is absent (weight = 0 → model-only blend).
 *
 * v3.3.1 hotfix §2 — `fetchPublicEspnMarketPrior` wires the free, keyless
 * ESPN Core API v2 per-event odds endpoint straight into the sensor so
 * `w_market (20%)` activates with ZERO API keys (the old NBA path passed
 * `null` and SHARP MARKET PRIOR stayed 0% / STANDBY forever).
 */

export interface SharpMarketPrior {
  available: boolean;
  source?: "ESPN_CORE_PUBLIC" | "THE_ODDS_API" | "ODDSPAPI";
  impliedWinProb?: number; // Normalized de-vigged probability (0..1)
  sharpDivergenceAlert: boolean; // True if sharp market strongly opposes our pick (>16pp)
}

/** American moneyline (+150 / −130) → raw implied probability (0..1). */
export function americanToImplied(ml: number | null | undefined): number | null {
  if (typeof ml !== "number" || !Number.isFinite(ml) || ml === 0) return null;
  return ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
}

/**
 * v3.3.1 hotfix §2 — Fetch de-vigged Sharp Market Prior from ESPN Core API
 * v2 (100% Public, Zero API Key). 4s hard timeout; any failure returns
 * `{ available: false }` — the ensemble silently stays model-only.
 * sport: "basketball" (league: "nba") | "soccer" (league: "eng.1", "esp.1", "ita.1", "bra.1", ...)
 */
export async function fetchPublicEspnMarketPrior(
  sport: "basketball" | "soccer",
  leagueSlug: string,
  eventId: string,
  pickSide: "HOME" | "AWAY",
): Promise<{ available: boolean; impliedProb?: number; provider?: string }> {
  const url = `https://sports.core.api.espn.com/v2/sports/${sport}/leagues/${leagueSlug}/events/${eventId}/competitions/${eventId}/odds`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "NeoBetQuantPro/3.3.1" },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) return { available: false };
    const data = (await res.json()) as {
      items?: Array<{
        homeTeamOdds?: { moneyLine?: number };
        awayTeamOdds?: { moneyLine?: number };
        drawOdds?: { moneyLine?: number };
        provider?: { name?: string };
      }>;
    };
    const item = data?.items?.[0];
    if (!item) return { available: false };

    const pHomeRaw = americanToImplied(item?.homeTeamOdds?.moneyLine);
    const pAwayRaw = americanToImplied(item?.awayTeamOdds?.moneyLine);
    const pDrawRaw = sport === "soccer" ? (americanToImplied(item?.drawOdds?.moneyLine) ?? 0) : 0;

    if (!pHomeRaw || !pAwayRaw) return { available: false };
    const total = pHomeRaw + pAwayRaw + pDrawRaw;
    if (total <= 0) return { available: false };
    const pHome = pHomeRaw / total;
    const pAway = pAwayRaw / total;

    return {
      available: true,
      impliedProb: pickSide === "HOME" ? pHome : pAway,
      provider: item?.provider?.name || "ESPN Market Consensus",
    };
  } catch {
    return { available: false };
  }
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

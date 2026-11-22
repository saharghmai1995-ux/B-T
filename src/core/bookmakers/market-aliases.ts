/**
 * Bookmaker Market Aliases (v2.7) — real 1xBet / BetForward navigation paths
 * for every whitelisted market, so each settlement row (and each signal card)
 * shows exactly where the identical official button lives on both books.
 */

export interface BookmakerMarketAlias {
  standardLabel: string;
  onexbetPath: string;
  betforwardPath: string;
}

export function resolveBookmakerAliases(marketKey: string, selection: string): BookmakerMarketAlias {
  const key = `${marketKey}:${selection}`.toUpperCase();
  if (key.includes("1X2") && key.includes("HOME")) {
    return { standardLabel: "1X2 Full-Time Result — HOME", onexbetPath: "1xBet: 1X2 → W1", betforwardPath: "BetForward: Match Result → 1" };
  }
  if (key.includes("1X2") && key.includes("AWAY")) {
    return { standardLabel: "1X2 Full-Time Result — AWAY", onexbetPath: "1xBet: 1X2 → W2", betforwardPath: "BetForward: Match Result → 2" };
  }
  if (key.includes("DNB") && key.includes("HOME")) {
    return { standardLabel: "Draw No Bet — HOME", onexbetPath: "1xBet: Handicap → 1 (0)", betforwardPath: "BetForward: Draw No Bet → 1" };
  }
  if (key.includes("DNB") && key.includes("AWAY")) {
    return { standardLabel: "Draw No Bet — AWAY", onexbetPath: "1xBet: Handicap → 2 (0)", betforwardPath: "BetForward: Draw No Bet → 2" };
  }
  if (key.includes("DC") && key.includes("1X")) {
    return { standardLabel: "Double Chance — 1X", onexbetPath: "1xBet: Double Chance → 1X", betforwardPath: "BetForward: Double Chance → 1X" };
  }
  return {
    standardLabel: `${marketKey} — ${selection}`,
    onexbetPath: `1xBet: ${marketKey} (${selection})`,
    betforwardPath: `BetForward: ${marketKey} (${selection})`,
  };
}

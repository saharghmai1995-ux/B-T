/**
 * Market Family — groups whitelisted market keys into the official 1xBet-style
 * families shown in the ledger analytics (1X2 / Asian Handicap / Double Chance /
 * Totals / Set Betting / …). Server-safe, import-free (no client leak).
 */

export function marketFamily(marketKey: string): string {
  if (marketKey === "1x2") return "1X2 Result";
  if (marketKey === "acca2") return "Accumulator";
  if (marketKey === "dnb") return "Draw No Bet";
  if (marketKey === "btts") return "Both Teams To Score";
  if (marketKey.startsWith("dc_")) return "Double Chance";
  if (marketKey.startsWith("ah_")) return "Asian Handicap";
  if (marketKey.startsWith("ou_")) return "Total Goals";
  if (marketKey.startsWith("tt_")) return "Team Totals";
  if (marketKey.startsWith("combo_")) return "Official Combo";
  if (marketKey.startsWith("setbet_")) return "Set Betting";
  if (marketKey.startsWith("sethand_")) return "Set Handicap";
  if (marketKey.startsWith("tot_sets")) return "Total Sets";
  if (marketKey.startsWith("tot_games")) return "Total Games";
  if (marketKey.startsWith("gamehand_")) return "Game Handicap";
  if (marketKey === "winner") return "Match Winner";
  return marketKey;
}

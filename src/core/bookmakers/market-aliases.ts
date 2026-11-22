/**
 * Bookmaker Market Aliases (v2.7.1 hotfix §1) — the audit's raw formats
 * (`1X2 Full-Time Result◆AWAY`, the ◆ symbol, generic HOME/AAY words) are
 * gone forever. Every surface — Signal Center, dashboard, track record,
 * shadow ledger and the Telegram poster — now renders the OFFICIAL
 * bookmaker market name plus the REAL team/player name.
 */

import { getMarket, MARKET_WHITELIST } from "./market-whitelist";

export type BookmakerMode = "1XBET" | "BETFORWARD";

export interface CleanMarketLabel {
  onexbet: string;
  betforward: string;
  posterLabel: string; // 100% English, crisp, no ◆ symbol
}

export function formatOfficialBookmakerMarket(
  marketKey: string,
  selection: string,
  homeTeam: string,
  awayTeam: string
): CleanMarketLabel {
  const k = `${marketKey}:${selection}`.toUpperCase();

  // 1X2 Full-Time Result
  if (k.includes("1X2") && (k.includes("HOME") || k.endsWith(":1"))) {
    return {
      onexbet: `1X2: W1 (${homeTeam})`,
      betforward: `Match Result: 1 (${homeTeam})`,
      posterLabel: `1X2 — W1 (${homeTeam})`,
    };
  }
  if (k.includes("1X2") && (k.includes("AWAY") || k.endsWith(":2"))) {
    return {
      onexbet: `1X2: W2 (${awayTeam})`,
      betforward: `Match Result: 2 (${awayTeam})`,
      posterLabel: `1X2 — W2 (${awayTeam})`,
    };
  }
  if (k.includes("1X2") && (k.includes("DRAW") || k.endsWith(":X"))) {
    return {
      onexbet: `1X2: X (Draw)`,
      betforward: `Match Result: X (Draw)`,
      posterLabel: `1X2 — X (Draw)`,
    };
  }

  // Draw No Bet / Asian Handicap 0
  if ((k.includes("DNB") || k.includes("DRAW_NO_BET")) && k.includes("HOME")) {
    return {
      onexbet: `Handicap 1 (0) — ${homeTeam}`,
      betforward: `Draw No Bet: 1 (${homeTeam})`,
      posterLabel: `Handicap 1 (0) / DNB — ${homeTeam}`,
    };
  }
  if ((k.includes("DNB") || k.includes("DRAW_NO_BET")) && k.includes("AWAY")) {
    return {
      onexbet: `Handicap 2 (0) — ${awayTeam}`,
      betforward: `Draw No Bet: 2 (${awayTeam})`,
      posterLabel: `Handicap 2 (0) / DNB — ${awayTeam}`,
    };
  }

  // Double Chance
  if (k.includes("DC") || k.includes("DOUBLE_CHANCE")) {
    if (k.includes("1X")) {
      return {
        onexbet: `Double Chance: 1X (${homeTeam} or Draw)`,
        betforward: `Double Chance: 1X (${homeTeam} or Draw)`,
        posterLabel: `Double Chance — 1X (${homeTeam} or Draw)`,
      };
    }
    if (k.includes("X2")) {
      return {
        onexbet: `Double Chance: X2 (${awayTeam} or Draw)`,
        betforward: `Double Chance: X2 (${awayTeam} or Draw)`,
        posterLabel: `Double Chance — X2 (${awayTeam} or Draw)`,
      };
    }
  }

  // Combo: 1X & Under 3.5 / X2 & Under 3.5
  if (k.includes("1X") && k.includes("3.5")) {
    return {
      onexbet: `1X and Total Under 3.5`,
      betforward: `Double Chance & Total: 1X & Under 3.5`,
      posterLabel: `1X & Under 3.5 Goals`,
    };
  }

  // Tennis Match Winner
  if (k.includes("ML") || k.includes("WINNER") || k.includes("H2H")) {
    const pickTeam = k.includes("AWAY") || k.endsWith(":2") ? awayTeam : homeTeam;
    const code = k.includes("AWAY") || k.endsWith(":2") ? "W2" : "W1";
    const bfCode = code === "W2" ? "2" : "1";
    return {
      onexbet: `Match Winner: ${code} (${pickTeam})`,
      betforward: `Match Result: ${bfCode} (${pickTeam})`,
      posterLabel: `Match Winner — ${code} (${pickTeam})`,
    };
  }

  // Fallback — official whitelist label with the real side name. Generic
  // HOME/AWAY machine words never survive to the UI (hotfix §1).
  const base = getMarket(marketKey)?.label ?? marketKey;
  const selU = selection.toUpperCase();
  if (selU === "HOME") {
    return {
      onexbet: `${base} — ${homeTeam}`,
      betforward: `${base} — ${homeTeam}`,
      posterLabel: `${base} — ${homeTeam}`,
    };
  }
  if (selU === "AWAY") {
    return {
      onexbet: `${base} — ${awayTeam}`,
      betforward: `${base} — ${awayTeam}`,
      posterLabel: `${base} — ${awayTeam}`,
    };
  }
  return {
    onexbet: `${base} — ${selection}`,
    betforward: `${base} — ${selection}`,
    posterLabel: `${base} — ${selection}`,
  };
}

/**
 * Team-aware selection caption for posters / capsules: the pick expressed
 * with W1/W2 codes and the real club or player name (no raw HOME/AWAY).
 */
export function cleanSelectionLabel(
  marketKey: string,
  selection: string,
  homeTeam: string,
  awayTeam: string,
): string {
  const k = `${marketKey}:${selection}`.toUpperCase();
  if (k.includes("1X2") && k.includes("HOME")) return `W1 — ${homeTeam}`;
  if (k.includes("1X2") && k.includes("AWAY")) return `W2 — ${awayTeam}`;
  if ((k.includes("WINNER") || k.includes("ML") || k.includes("H2H")) && k.includes("AWAY")) {
    return `W2 — ${awayTeam}`;
  }
  if (k.includes("WINNER") || k.includes("ML") || k.includes("H2H")) return `W1 — ${homeTeam}`;
  if ((k.includes("DNB") || k.includes("DRAW_NO_BET")) && k.includes("AWAY")) return awayTeam;
  if (k.includes("DNB")) return homeTeam;
  if (sel_is_away(selection)) return awayTeam;
  if (sel_is_home(selection)) return homeTeam;
  return selection;
}

const sel_is_away = (selection: string): boolean => selection.trim().toUpperCase() === "AWAY";
const sel_is_home = (selection: string): boolean => selection.trim().toUpperCase() === "HOME";

/**
 * Resolve a STORED shadow-ledger market reference (either a machine key like
 * `1x2` or an official label like `1X2 Full-Time Result`) into a clean
 * team-aware display label. Kills the audit's empty/broken bet lines.
 */
export function formatStoredMarketLabel(
  storedLabel: string | null | undefined,
  selection: string | null | undefined,
  homeTeam: string,
  awayTeam: string,
): string {
  const sel = selection ?? "";
  if (!storedLabel) return sel || "—";
  // Case 1: the stored value is a whitelist machine key.
  if (getMarket(storedLabel)) {
    return formatOfficialBookmakerMarket(storedLabel, sel, homeTeam, awayTeam).posterLabel;
  }
  // Case 2: stored value is an official label — find its key by reverse map.
  const keyByLabel = REVERSE_LABEL.get(storedLabel.trim().toLowerCase());
  if (keyByLabel) {
    return formatOfficialBookmakerMarket(keyByLabel, sel, homeTeam, awayTeam).posterLabel;
  }
  // Case 3: unknown — display as-is, stripped of any ◆ artifacts.
  return `${storedLabel.replace(/◆/g, "—").trim()}${sel ? ` — ${sel}` : ""}`;
}

/** Official English label → machine key (shadow-ledger stored labels). */
const REVERSE_LABEL = new Map<string, string>(
  MARKET_WHITELIST.map((m) => [m.label.trim().toLowerCase(), m.key] as [string, string]),
);

export interface BookmakerMarketAlias {
  standardLabel: string;
  onexbetPath: string;
  betforwardPath: string;
}

/** Team-aware navigation paths (dashboard settlement drawer + audit rows). */
export function resolveBookmakerAliases(
  marketKey: string,
  selection: string,
  homeTeam = "",
  awayTeam = "",
): BookmakerMarketAlias {
  const clean = formatOfficialBookmakerMarket(marketKey, selection, homeTeam || "Home", awayTeam || "Away");
  const k = `${marketKey}:${selection}`.toUpperCase();
  if (k.includes("1X2") && k.includes("HOME")) {
    return { standardLabel: clean.posterLabel, onexbetPath: `1xBet: 1X2 → W1 (${homeTeam})`, betforwardPath: `BetForward: Match Result → 1 (${homeTeam})` };
  }
  if (k.includes("1X2") && k.includes("AWAY")) {
    return { standardLabel: clean.posterLabel, onexbetPath: `1xBet: 1X2 → W2 (${awayTeam})`, betforwardPath: `BetForward: Match Result → 2 (${awayTeam})` };
  }
  if (k.includes("DNB") && k.includes("HOME")) {
    return { standardLabel: clean.posterLabel, onexbetPath: `1xBet: Handicap → 1 (0) — ${homeTeam}`, betforwardPath: `BetForward: Draw No Bet → 1 (${homeTeam})` };
  }
  if (k.includes("DNB") && k.includes("AWAY")) {
    return { standardLabel: clean.posterLabel, onexbetPath: `1xBet: Handicap → 2 (0) — ${awayTeam}`, betforwardPath: `BetForward: Draw No Bet → 2 (${awayTeam})` };
  }
  if (k.includes("DC") && k.includes("1X")) {
    return { standardLabel: clean.posterLabel, onexbetPath: `1xBet: Double Chance → 1X (${homeTeam} or Draw)`, betforwardPath: `BetForward: Double Chance → 1X` };
  }
  if (k.includes("WINNER") && k.includes("AWAY")) {
    return { standardLabel: clean.posterLabel, onexbetPath: `1xBet: Match Winner → W2 (${awayTeam})`, betforwardPath: `BetForward: Match Result → 2 (${awayTeam})` };
  }
  if (k.includes("WINNER")) {
    return { standardLabel: clean.posterLabel, onexbetPath: `1xBet: Match Winner → W1 (${homeTeam})`, betforwardPath: `BetForward: Match Result → 1 (${homeTeam})` };
  }
  return {
    standardLabel: clean.posterLabel,
    onexbetPath: `1xBet: ${clean.onexbet.replace(/^.*?:\s*/, "")}`,
    betforwardPath: `BetForward: ${clean.betforward.replace(/^.*?:\s*/, "")}`,
  };
}

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
  /** v3.3.2 §2 — readable Persian subtitle (web cards + Telegram caption).
   *  The poster itself stays 100% English. */
  subtitleFa: string;
}

/** Parse an NBA handicap selection `NBA_HCP_±N_SIDE`. */
function parseNbaHcp(selection: string): { line: string; num: number; side: "HOME" | "AWAY" } | null {
  const m = selection.match(/^NBA_HCP_([+-]?\d+(?:\.\d+)?)_(HOME|AWAY)$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  return { line: m[1].startsWith("-") ? m[1] : `+${m[1].replace("+", "")}`, num, side: m[2] as "HOME" | "AWAY" };
}

export function formatOfficialBookmakerMarket(
  marketKey: string,
  selection: string,
  homeTeam: string,
  awayTeam: string
): CleanMarketLabel {
  const k = `${marketKey}:${selection}`.toUpperCase();

  // ------------------------------------------------------------------
  // v3.3.2 §2 — REAL bookmaker NBA vocabulary (patch table, readable
  // generic terms — no raw machine codes on any surface).
  // ------------------------------------------------------------------
  if (marketKey === "NBA_ML" || k.startsWith("NBA_ML:")) {
    const pickTeam = selection.endsWith("AWAY") ? awayTeam : homeTeam;
    return {
      onexbet: `Winner (Incl. OT): ${selection.endsWith("AWAY") ? "W2" : "W1"} (${pickTeam})`,
      betforward: `Moneyline: ${pickTeam}`,
      posterLabel: `Match Winner — ${pickTeam}`,
      subtitleFa: `برد تیم با هر اختلافی (شامل وقت اضافه)`,
    };
  }
  const nbaHcp = parseNbaHcp(selection);
  if (marketKey.startsWith("NBA_HCP") && nbaHcp) {
    const pickTeam = nbaHcp.side === "HOME" ? homeTeam : awayTeam;
    const favLine = nbaHcp.num < 0;
    return {
      onexbet: `Handicap ${nbaHcp.side === "HOME" ? "1" : "2"} (${nbaHcp.line}) — ${pickTeam}`,
      betforward: `Points Handicap: ${pickTeam} ${nbaHcp.line}`,
      posterLabel: `Points Handicap (${nbaHcp.line}) — ${pickTeam}`,
      subtitleFa: favLine
        ? `برد با ${Math.abs(nbaHcp.num) + 1}+ امتیاز = برد · برد با دقیقاً ${Math.abs(nbaHcp.num)} امتیاز = سربه‌سر`
        : `برد یا باخت زیر ${Math.abs(nbaHcp.num)} امتیاز = برد · باخت دقیقاً ${Math.abs(nbaHcp.num)} امتیاز = سربه‌سر`,
    };
  }
  if (marketKey === "NBA_ALT_SPREAD" || k.includes("NBA_ALT_+4.5")) {
    const pickTeam = selection.includes("AWAY") ? awayTeam : homeTeam;
    return {
      onexbet: `Handicap ${selection.includes("AWAY") ? "2" : "1"} (+4.5) — ${pickTeam}`,
      betforward: `Alt Spread: ${pickTeam} +4.5`,
      posterLabel: `Alt Spread +4.5 — ${pickTeam}`,
      subtitleFa: `سپر برد یا باخت زیر ۵ امتیاز (بازار قدیمی v3.3.1)`,
    };
  }

  // ------------------------------------------------------------------
  // v3.3.2 §2 — Push-Shield vocabulary (patch table).
  // ------------------------------------------------------------------
  if (marketKey === "DNB_AH0") {
    const pickTeam = selection === "AWAY" ? awayTeam : homeTeam;
    const side = selection === "AWAY" ? "2" : "1";
    return {
      onexbet: `Handicap ${side} (0) — ${pickTeam}`,
      betforward: `Draw No Bet: ${side} (${pickTeam})`,
      posterLabel: `Draw No Bet (0.0) — ${pickTeam}`,
      subtitleFa: `برد = برد · مساوی = سربه‌سر (بدون باخت)`,
    };
  }
  if (marketKey === "AH_PLUS_025") {
    const pickTeam = selection.startsWith("AWAY") ? awayTeam : homeTeam;
    const side = selection.startsWith("AWAY") ? "2" : "1";
    return {
      onexbet: `Asian Handicap ${side} (+0.25) — ${pickTeam}`,
      betforward: `Asian Handicap: ${pickTeam} +0.25`,
      posterLabel: `Asian Handicap +0.25 — ${pickTeam}`,
      subtitleFa: `مساوی = نصف برد + نصف بازگشت استیک`,
    };
  }
  if (marketKey === "DOUBLE_CHANCE") {
    const dc = selection.includes("X2") ? "X2" : "1X";
    const pickTeam = dc === "1X" ? homeTeam : awayTeam;
    return {
      onexbet: `Double Chance: ${dc} (${pickTeam} or Draw)`,
      betforward: `Double Chance: ${dc} (${pickTeam} or Draw)`,
      posterLabel: `Double Chance (${dc}) — ${pickTeam} or Draw`,
      subtitleFa: `برد یا مساوی تیم منتخب`,
    };
  }
  if (marketKey === "OVER_2_0") {
    return {
      onexbet: `Total Over (2.0) Goals`,
      betforward: `Asian Total: Over 2.0 Goals`,
      posterLabel: `Total Goals: Over 2.0`,
      subtitleFa: `۳+ گل = برد · دقیقاً ۲ گل = سربه‌سر`,
    };
  }
  if (marketKey === "UNDER_3_0") {
    return {
      onexbet: `Total Under (3.0) Goals`,
      betforward: `Asian Total: Under 3.0 Goals`,
      posterLabel: `Total Goals: Under 3.0`,
      subtitleFa: `۰ تا ۲ گل = برد · دقیقاً ۳ گل = سربه‌سر`,
    };
  }
  if (marketKey === "TENNIS_SET_PLUS_15") {
    const pickPlayer = selection.startsWith("AWAY") ? awayTeam : homeTeam;
    return {
      onexbet: `Set Handicap ${selection.startsWith("AWAY") ? "2" : "1"} (+1.5) — ${pickPlayer}`,
      betforward: `Set Handicap: ${pickPlayer} +1.5`,
      posterLabel: `Win at Least 1 Set — ${pickPlayer}`,
      subtitleFa: `کسب حداقل یک ست (هندیکپ +۱.۵ ست)`,
    };
  }
  if (marketKey === "TENNIS_ML") {
    const pickPlayer = selection === "AWAY" ? awayTeam : homeTeam;
    return {
      onexbet: `Match Winner: ${selection === "AWAY" ? "W2" : "W1"} (${pickPlayer})`,
      betforward: `Match Winner: ${pickPlayer}`,
      posterLabel: `Match Winner — ${pickPlayer}`,
      subtitleFa: `برد مستقیم بازیکن`,
    };
  }
  if (marketKey === "TENNIS_GAME_HCP") {
    const m = selection.match(/^HOME_([+-]?\d+(?:\.\d+)?)$|^AWAY_([+-]?\d+(?:\.\d+)?)$/i);
    const line = m ? (m[1] ?? m[2]) : "±3.5";
    const pickPlayer = selection.startsWith("AWAY") ? awayTeam : homeTeam;
    return {
      onexbet: `Games Handicap ${selection.startsWith("AWAY") ? "2" : "1"} (${line}) — ${pickPlayer}`,
      betforward: `Games Handicap: ${pickPlayer} ${line}`,
      posterLabel: `Games Handicap (${line}) — ${pickPlayer}`,
      subtitleFa: `اختلاف گیم‌ها با خط ${line} (پوشش گیم‌های بیشتر)`,
    };
  }

  // 1X2 Full-Time Result — v3.3.2 §2 patch wording (generic, readable).
  if (k.includes("1X2") && (k.includes("HOME") || k.endsWith(":1"))) {
    return {
      onexbet: `1X2: W1 (${homeTeam})`,
      betforward: `Match Result: 1 (${homeTeam})`,
      posterLabel: `Match Winner — ${homeTeam}`,
      subtitleFa: `برد تیم در ۹۰ دقیقه`,
    };
  }
  if (k.includes("1X2") && (k.includes("AWAY") || k.endsWith(":2"))) {
    return {
      onexbet: `1X2: W2 (${awayTeam})`,
      betforward: `Match Result: 2 (${awayTeam})`,
      posterLabel: `Match Winner — ${awayTeam}`,
      subtitleFa: `برد تیم در ۹۰ دقیقه`,
    };
  }
  if (k.includes("1X2") && (k.includes("DRAW") || k.endsWith(":X"))) {
    return {
      onexbet: `1X2: X (Draw)`,
      betforward: `Match Result: X (Draw)`,
      posterLabel: `1X2 — X (Draw)`,
      subtitleFa: `نتیجه مساوی در ۹۰ دقیقه`,
    };
  }

  // Draw No Bet / Asian Handicap 0
  if ((k.includes("DNB") || k.includes("DRAW_NO_BET")) && k.includes("HOME")) {
    return {
      onexbet: `Handicap 1 (0) — ${homeTeam}`,
      betforward: `Draw No Bet: 1 (${homeTeam})`,
      posterLabel: `Draw No Bet (0.0) — ${homeTeam}`,
      subtitleFa: `برد = برد · مساوی = سربه‌سر (بدون باخت)`,
    };
  }
  if ((k.includes("DNB") || k.includes("DRAW_NO_BET")) && k.includes("AWAY")) {
    return {
      onexbet: `Handicap 2 (0) — ${awayTeam}`,
      betforward: `Draw No Bet: 2 (${awayTeam})`,
      posterLabel: `Draw No Bet (0.0) — ${awayTeam}`,
      subtitleFa: `برد = برد · مساوی = سربه‌سر (بدون باخت)`,
    };
  }

  // Double Chance
  if (k.includes("DC") || k.includes("DOUBLE_CHANCE")) {
    if (k.includes("1X")) {
      return {
        onexbet: `Double Chance: 1X (${homeTeam} or Draw)`,
        betforward: `Double Chance: 1X (${homeTeam} or Draw)`,
        posterLabel: `Double Chance (1X) — ${homeTeam} or Draw`,
        subtitleFa: `برد یا مساوی تیم منتخب`,
      };
    }
    if (k.includes("X2")) {
      return {
        onexbet: `Double Chance: X2 (${awayTeam} or Draw)`,
        betforward: `Double Chance: X2 (${awayTeam} or Draw)`,
        posterLabel: `Double Chance (X2) — ${awayTeam} or Draw`,
        subtitleFa: `برد یا مساوی تیم منتخب`,
      };
    }
  }

  // Combo: 1X & Under 3.5 / X2 & Under 3.5
  if (k.includes("1X") && k.includes("3.5")) {
    return {
      onexbet: `1X and Total Under 3.5`,
      betforward: `Double Chance & Total: 1X & Under 3.5`,
      posterLabel: `1X & Under 3.5 Goals`,
      subtitleFa: `برد یا مساوی میزبان و کل گل زیر ۳.۵`,
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
      posterLabel: `Match Winner — ${pickTeam}`,
      subtitleFa: `برد مستقیم بازیکن`,
    };
  }

  // Fallback — official whitelist label with the real side name. Generic
  // HOME/AWAY machine words never survive to the UI (hotfix §1).
  const base = getMarket(marketKey)?.label ?? marketKey;
  const fallbackFa = getMarket(marketKey)?.labelFa ?? "شرط منتخب روی این بازار رسمی";
  const selU = selection.toUpperCase();
  if (selU === "HOME") {
    return {
      onexbet: `${base} — ${homeTeam}`,
      betforward: `${base} — ${homeTeam}`,
      posterLabel: `${base} — ${homeTeam}`,
      subtitleFa: fallbackFa,
    };
  }
  if (selU === "AWAY") {
    return {
      onexbet: `${base} — ${awayTeam}`,
      betforward: `${base} — ${awayTeam}`,
      posterLabel: `${base} — ${awayTeam}`,
      subtitleFa: fallbackFa,
    };
  }
  return {
    onexbet: `${base} — ${selection}`,
    betforward: `${base} — ${selection}`,
    posterLabel: `${base} — ${selection}`,
    subtitleFa: fallbackFa,
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
  // v3.3.2 §2 — NBA real-bookmaker selections render the real team name.
  const nbaHcp = parseNbaHcp(selection);
  if ((marketKey.startsWith("NBA_HCP") || selection.startsWith("NBA_HCP_")) && nbaHcp) {
    const pickTeam = nbaHcp.side === "HOME" ? homeTeam : awayTeam;
    return `HCP ${nbaHcp.line} — ${pickTeam}`;
  }
  if (marketKey === "NBA_ML" || selection === "NBA_ML_HOME" || selection === "NBA_ML_AWAY") {
    return selection.endsWith("AWAY") ? awayTeam : homeTeam;
  }
  if (selection.startsWith("NBA_ALT_+4.5")) {
    return `+4.5 — ${selection.endsWith("AWAY") ? awayTeam : homeTeam}`;
  }
  if (marketKey === "TENNIS_SET_PLUS_15") {
    const pickPlayer = selection.startsWith("AWAY") ? awayTeam : homeTeam;
    return `+1.5 Sets — ${pickPlayer}`;
  }
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

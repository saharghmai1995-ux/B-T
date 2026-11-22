/**
 * Market Whitelist — the ONLY markets allowed to be exported as signals.
 * Every entry is a real single official button in the 1xBet pre-match menu
 * and BetForward (BetConstruct). No related-contingency multiplication ever.
 */

export type MarketKind =
  | "1X2"
  | "DOUBLE_CHANCE"
  | "DNB"
  | "AH"
  | "TOTAL_GOALS"
  | "BTTS"
  | "TEAM_TOTAL"
  | "OFFICIAL_COMBO"
  | "TENNIS_WINNER"
  | "SET_BETTING"
  | "TOTAL_SETS"
  | "SET_HANDICAP"
  | "TOTAL_GAMES"
  | "GAME_HANDICAP";

export interface MarketDef {
  key: string; // stable machine key
  label: string; // official English label in 1xBet/BetForward menu
  labelFa: string;
  kind: MarketKind;
  sport: "football" | "tennis";
  selections: string[];
}

const FOOTBALL: MarketDef[] = [
  { key: "1x2", label: "1X2 Full-Time Result", labelFa: "نتیجه نهایی ۹۰ دقیقه", kind: "1X2", sport: "football", selections: ["HOME", "DRAW", "AWAY"] },
  { key: "dc_1x", label: "Double Chance 1X", labelFa: "شانس دوبل 1X", kind: "DOUBLE_CHANCE", sport: "football", selections: ["YES"] },
  { key: "dc_x2", label: "Double Chance X2", labelFa: "شانس دوبل X2", kind: "DOUBLE_CHANCE", sport: "football", selections: ["YES"] },
  { key: "dnb", label: "Draw No Bet", labelFa: "برگشت مساوی (DNB)", kind: "DNB", sport: "football", selections: ["HOME", "AWAY"] },
  { key: "ah_home_-0.5", label: "Asian Handicap Home -0.5", labelFa: "هندیکپ آسیایی میزبان ۰.۵-", kind: "AH", sport: "football", selections: ["HOME"] },
  { key: "ah_home_-0.75", label: "Asian Handicap Home -0.75", labelFa: "هندیکپ آسیایی میزبان ۰.۷۵-", kind: "AH", sport: "football", selections: ["HOME"] },
  { key: "ah_home_-1.0", label: "Asian Handicap Home -1.0", labelFa: "هندیکپ آسیایی میزبان ۱-", kind: "AH", sport: "football", selections: ["HOME"] },
  { key: "ah_away_-0.5", label: "Asian Handicap Away -0.5", labelFa: "هندیکپ آسیایی مهمان ۰.۵-", kind: "AH", sport: "football", selections: ["AWAY"] },
  { key: "ah_away_-0.75", label: "Asian Handicap Away -0.75", labelFa: "هندیکپ آسیایی مهمان ۰.۷۵-", kind: "AH", sport: "football", selections: ["AWAY"] },
  { key: "ah_away_-1.0", label: "Asian Handicap Away -1.0", labelFa: "هندیکپ آسیایی مهمان ۱-", kind: "AH", sport: "football", selections: ["AWAY"] },
  { key: "ou_1.5", label: "Total Goals Over/Under 1.5", labelFa: "گل کل ۱.۵", kind: "TOTAL_GOALS", sport: "football", selections: ["OVER", "UNDER"] },
  { key: "ou_2.5", label: "Total Goals Over/Under 2.5", labelFa: "گل کل ۲.۵", kind: "TOTAL_GOALS", sport: "football", selections: ["OVER", "UNDER"] },
  { key: "ou_3.5", label: "Total Goals Over/Under 3.5", labelFa: "گل کل ۳.۵", kind: "TOTAL_GOALS", sport: "football", selections: ["OVER", "UNDER"] },
  { key: "btts", label: "Both Teams To Score", labelFa: "گلزنی هر دو تیم", kind: "BTTS", sport: "football", selections: ["YES", "NO"] },
  { key: "tt_home_o1.5", label: "Home Team Total Over 1.5", labelFa: "گل میزبان بالای ۱.۵", kind: "TEAM_TOTAL", sport: "football", selections: ["OVER"] },
  { key: "tt_away_o1.5", label: "Away Team Total Over 1.5", labelFa: "گل مهمان بالای ۱.۵", kind: "TEAM_TOTAL", sport: "football", selections: ["OVER"] },
  { key: "combo_1x_u3.5", label: "1X & Under 3.5 (Official Combo)", labelFa: "کمبو رسمی 1X و زیر ۳.۵", kind: "OFFICIAL_COMBO", sport: "football", selections: ["YES"] },
  { key: "combo_home_o1.5", label: "Home Win & Over 1.5 (Official Combo)", labelFa: "کمبو رسمی برد میزبان و بالای ۱.۵", kind: "OFFICIAL_COMBO", sport: "football", selections: ["YES"] },
];

const TENNIS: MarketDef[] = [
  { key: "winner", label: "Match Winner", labelFa: "برنده مسابقه", kind: "TENNIS_WINNER", sport: "tennis", selections: ["HOME", "AWAY"] },
  { key: "setbet_2_0", label: "Set Betting 2-0", labelFa: "نتیجه ست ۲-۰", kind: "SET_BETTING", sport: "tennis", selections: ["HOME", "AWAY"] },
  { key: "setbet_2_1", label: "Set Betting 2-1", labelFa: "نتیجه ست ۲-۱", kind: "SET_BETTING", sport: "tennis", selections: ["HOME", "AWAY"] },
  { key: "tot_sets_o2.5", label: "Total Sets Over 2.5", labelFa: "ست کل بالای ۲.۵", kind: "TOTAL_SETS", sport: "tennis", selections: ["OVER", "UNDER"] },
  { key: "sethand_home_+1.5", label: "Set Handicap Home +1.5", labelFa: "هندیکپ ست بازیکن اول +۱.۵", kind: "SET_HANDICAP", sport: "tennis", selections: ["HOME"] },
  { key: "sethand_away_+1.5", label: "Set Handicap Away +1.5", labelFa: "هندیکپ ست بازیکن دوم +۱.۵", kind: "SET_HANDICAP", sport: "tennis", selections: ["AWAY"] },
  { key: "sethand_home_-1.5", label: "Set Handicap Home -1.5", labelFa: "هندیکپ ست بازیکن اول -۱.۵", kind: "SET_HANDICAP", sport: "tennis", selections: ["HOME"] },
  { key: "sethand_away_-1.5", label: "Set Handicap Away -1.5", labelFa: "هندیکپ ست بازیکن دوم -۱.۵", kind: "SET_HANDICAP", sport: "tennis", selections: ["AWAY"] },
  { key: "tot_games_o20.5", label: "Total Games Over 20.5", labelFa: "گیم کل بالای ۲۰.۵", kind: "TOTAL_GAMES", sport: "tennis", selections: ["OVER", "UNDER"] },
  { key: "tot_games_o21.5", label: "Total Games Over 21.5", labelFa: "گیم کل بالای ۲۱.۵", kind: "TOTAL_GAMES", sport: "tennis", selections: ["OVER", "UNDER"] },
  { key: "tot_games_o22.5", label: "Total Games Over 22.5", labelFa: "گیم کل بالای ۲۲.۵", kind: "TOTAL_GAMES", sport: "tennis", selections: ["OVER", "UNDER"] },
  { key: "gamehand_home_-3.5", label: "Game Handicap Home -3.5", labelFa: "هندیکپ گیم بازیکن اول -۳.۵", kind: "GAME_HANDICAP", sport: "tennis", selections: ["HOME"] },
  { key: "gamehand_home_+3.5", label: "Game Handicap Home +3.5", labelFa: "هندیکپ گیم بازیکن اول +۳.۵", kind: "GAME_HANDICAP", sport: "tennis", selections: ["HOME"] },
  { key: "gamehand_away_-3.5", label: "Game Handicap Away -3.5", labelFa: "هندیکپ گیم بازیکن دوم -۳.۵", kind: "GAME_HANDICAP", sport: "tennis", selections: ["AWAY"] },
  { key: "gamehand_away_+3.5", label: "Game Handicap Away +3.5", labelFa: "هندیکپ گیم بازیکن دوم +۳.۵", kind: "GAME_HANDICAP", sport: "tennis", selections: ["AWAY"] },
];

export const MARKET_WHITELIST: MarketDef[] = [...FOOTBALL, ...TENNIS];

const BY_KEY = new Map(MARKET_WHITELIST.map((m) => [m.key, m]));

export function getMarket(key: string): MarketDef | undefined {
  return BY_KEY.get(key);
}

/** Assert a market+selection pair is 100% whitelisted (guard before export). */
export function assertMarketAllowed(key: string, selection: string): boolean {
  const m = BY_KEY.get(key);
  if (!m) return false;
  return m.selections.includes(selection);
}

export function marketsFor(sport: "football" | "tennis"): MarketDef[] {
  return MARKET_WHITELIST.filter((m) => m.sport === sport);
}

/** Toxic leagues never signalled (hard supervisor blacklist). */
export const TOXIC_LEAGUES = new Set(["esp.2", "usa.1", "fifa.friendly"]);

/**
 * v2.7 — Elite tennis tournament guard (inclusive per the v2.7 patch):
 * ATP / WTA main tour, Grand Slams, Davis Cup, Billie Jean King Cup,
 * United Cup, Challengers and all *Finals* events qualify. Only the pure
 * ITF circuit (15K/25K/40K/60K/80K/100K without Finals naming) stays out.
 */
export function isEliteTennisTournament(leagueName: string): boolean {
  const norm = (leagueName || "").toLowerCase();
  return (
    norm.includes("atp") ||
    norm.includes("wta") ||
    norm.includes("grand slam") ||
    norm.includes("australian open") ||
    norm.includes("roland garros") ||
    norm.includes("wimbledon") ||
    norm.includes("us open") ||
    norm.includes("davis cup") ||
    norm.includes("billie jean king") ||
    norm.includes("united cup") ||
    norm.includes("challenger") ||
    norm.includes("finals")
  );
}

/**
 * Zero Related Contingency guard: a single-match signal card must never
 * multiply two markets of the same match with "×". Accas combine DIFFERENT
 * independent matches only.
 */
export function assertNoRelatedContingency(keys: string[]): boolean {
  const marketKeys = keys.map((k) => k.split("@")[0]);
  return new Set(marketKeys).size === keys.length;
}

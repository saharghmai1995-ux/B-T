"use client";

/**
 * Official Market Names — client-safe mirror of the server whitelist.
 * Every signal card shows the FULL official English market name exactly as it
 * appears in the 1xBet / BetForward menus, with a short Persian explanation
 * below it. Raw machine codes (ah_away_-0.5, 1X, X2) never reach the UI.
 */

export interface MarketNames {
  /** Official English label (1xBet / BetForward menu). */
  en: string;
  /** Short Persian explanation shown under the English label. */
  fa: string;
  /** Settlement rule label for the sport/market. */
  settle: string;
}

const FOOTBALL_SETTLE = "تسویه: ۹۰ دقیقه زمان قانونی";
const TENNIS_SETTLE = "تسویه: تکمیل کامل مسابقه (Retirement = ابطال)";

const MAP: Record<string, MarketNames> = {
  "1x2": { en: "1X2 Full-Time Result", fa: "نتیجه نهایی ۹۰ دقیقه: برد میزبان / مساوی / برد مهمان", settle: FOOTBALL_SETTLE },
  dc_1x: { en: "Double Chance: 1X (Home or Draw)", fa: "شانس دوبل: برد میزبان یا مساوی", settle: FOOTBALL_SETTLE },
  dc_x2: { en: "Double Chance: X2 (Draw or Away)", fa: "شانس دوبل: مساوی یا برد مهمان", settle: FOOTBALL_SETTLE },
  dnb: { en: "Draw No Bet", fa: "برگشت مساوی: در صورت تساوی، استیک بازگردانده می‌شود", settle: FOOTBALL_SETTLE },
  "ah_home_-0.5": { en: "Asian Handicap: Home -0.5", fa: "هندیکپ آسیایی: برد میزبان با هر نتیجه‌ای جز تساوی", settle: FOOTBALL_SETTLE },
  "ah_home_-0.75": { en: "Asian Handicap: Home -0.75", fa: "هندیکپ آسیایی میزبان ۰.۷۵-: برد ۲گل = برد کامل، برد ۱گل = نصف برد", settle: FOOTBALL_SETTLE },
  "ah_home_-1.0": { en: "Asian Handicap: Home -1.0", fa: "هندیکپ آسیایی میزبان ۱-: برد با ۲ گل یا بیشتر، برد ۱ گل = بازگشت استیک", settle: FOOTBALL_SETTLE },
  "ah_away_-0.5": { en: "Asian Handicap: Away -0.5", fa: "هندیکپ آسیایی: برد تیم میهمان با هر نتیجه‌ای جز تساوی", settle: FOOTBALL_SETTLE },
  "ah_away_-0.75": { en: "Asian Handicap: Away -0.75", fa: "هندیکپ آسیایی مهمان ۰.۷۵-: برد ۲گل = برد کامل، برد ۱گل = نصف برد", settle: FOOTBALL_SETTLE },
  "ah_away_-1.0": { en: "Asian Handicap: Away -1.0", fa: "هندیکپ آسیایی مهمان ۱-: برد با ۲ گل یا بیشتر، برد ۱ گل = بازگشت استیک", settle: FOOTBALL_SETTLE },
  "ou_1.5": { en: "Total Goals: Over/Under 1.5 Goals", fa: "مجموع گل‌های مسابقه: بالای یا پایین ۱.۵ گل", settle: FOOTBALL_SETTLE },
  "ou_2.5": { en: "Total Goals: Over/Under 2.5 Goals", fa: "مجموع گل‌های مسابقه: بالای یا پایین ۲.۵ گل", settle: FOOTBALL_SETTLE },
  "ou_3.5": { en: "Total Goals: Over/Under 3.5 Goals", fa: "مجموع گل‌های مسابقه: بالای یا پایین ۳.۵ گل", settle: FOOTBALL_SETTLE },
  btts: { en: "Both Teams To Score: Yes / No", fa: "گلزنی هر دو تیم: بله یا خیر", settle: FOOTBALL_SETTLE },
  "tt_home_o1.5": { en: "Home Team Total: Over 1.5 Goals", fa: "گل میزبان: بالای ۱.۵ گل از سوی تیم میزبان", settle: FOOTBALL_SETTLE },
  "tt_away_o1.5": { en: "Away Team Total: Over 1.5 Goals", fa: "گل مهمان: بالای ۱.۵ گل از سوی تیم مهمان", settle: FOOTBALL_SETTLE },
  "combo_1x_u3.5": { en: "1X & Under 3.5 (Official Combo)", fa: "کمبو رسمی: برد میزبان یا مساوی و کل گل زیر ۳.۵", settle: FOOTBALL_SETTLE },
  "combo_home_o1.5": { en: "Home Win & Over 1.5 (Official Combo)", fa: "کمبو رسمی: برد میزبان و مجموع گل بالای ۱.۵", settle: FOOTBALL_SETTLE },
  winner: { en: "Match Winner", fa: "برنده مسابقه تنیس", settle: TENNIS_SETTLE },
  "setbet_2_0": { en: "Set Betting: Winner 2-0", fa: "نتیجه دقیق ست‌ها: برد ۲ بر ۰", settle: TENNIS_SETTLE },
  "setbet_2_1": { en: "Set Betting: Winner 2-1", fa: "نتیجه دقیق ست‌ها: برد ۲ بر ۱", settle: TENNIS_SETTLE },
  "tot_sets_o2.5": { en: "Total Sets: Over/Under 2.5 Sets", fa: "مجموع ست‌های مسابقه: بالای یا پایین ۲.۵ ست", settle: TENNIS_SETTLE },
  "sethand_home_+1.5": { en: "Set Handicap: Player A +1.5 Sets", fa: "هندیکپ ست بازیکن اول: +۱.۵ ست", settle: TENNIS_SETTLE },
  "sethand_away_+1.5": { en: "Set Handicap: Player B +1.5 Sets", fa: "هندیکپ ست بازیکن دوم: +۱.۵ ست", settle: TENNIS_SETTLE },
  "sethand_home_-1.5": { en: "Set Handicap: Player A -1.5 Sets", fa: "هندیکپ ست بازیکن اول: ۱.۵- ست", settle: TENNIS_SETTLE },
  "sethand_away_-1.5": { en: "Set Handicap: Player B -1.5 Sets", fa: "هندیکپ ست بازیکن دوم: ۱.۵- ست", settle: TENNIS_SETTLE },
  "tot_games_o20.5": { en: "Total Games: Over 20.5 Games", fa: "مجموع گیم‌های مسابقه: بالای ۲۰.۵ گیم", settle: TENNIS_SETTLE },
  "tot_games_o21.5": { en: "Total Games: Over 21.5 Games", fa: "مجموع گیم‌های مسابقه: بالای ۲۱.۵ گیم", settle: TENNIS_SETTLE },
  "tot_games_o22.5": { en: "Total Games: Over 22.5 Games", fa: "مجموع گیم‌های مسابقه: بالای ۲۲.۵ گیم", settle: TENNIS_SETTLE },
  "gamehand_home_-3.5": { en: "Game Handicap: Player A -3.5 Games", fa: "هندیکپ گیم بازیکن اول: ۳.۵- گیم", settle: TENNIS_SETTLE },
  "gamehand_home_+3.5": { en: "Game Handicap: Player A +3.5 Games", fa: "هندیکپ گیم بازیکن اول: +۳.۵ گیم", settle: TENNIS_SETTLE },
  "gamehand_away_-3.5": { en: "Game Handicap: Player B -3.5 Games", fa: "هندیکپ گیم بازیکن دوم: ۳.۵- گیم", settle: TENNIS_SETTLE },
  "gamehand_away_+3.5": { en: "Game Handicap: Player B +3.5 Games", fa: "هندیکپ گیم بازیکن دوم: +۳.۵ گیم", settle: TENNIS_SETTLE },
  acca2: { en: "2-Leg Smart Accumulator", fa: "میکس ۲ پایه‌ای از دو مسابقه مستقل", settle: "تسویه: هر دو پایه باید برنده شوند" },
};

const SELECTION_EN: Record<string, string> = {
  HOME: "HOME",
  AWAY: "AWAY",
  DRAW: "DRAW",
  OVER: "OVER",
  UNDER: "UNDER",
  YES: "YES",
  NO: "NO",
  ACCA: "ACCA",
};

/**
 * The full official English bet line for a signal, e.g.
 * "Asian Handicap: Away -0.5 — AWAY". Falls back to the stored marketLabel.
 */
export function officialBetLine(
  marketKey: string,
  selection: string,
  storedLabel?: string,
): string {
  const m = MAP[marketKey];
  if (!m) return storedLabel ?? marketKey;
  if (marketKey === "acca2") return m.en;
  const sel = SELECTION_EN[selection] ?? selection;
  if (["1x2", "dnb", "winner", "btts", "ou_1.5", "ou_2.5", "ou_3.5", "tot_sets_o2.5", "tot_games_o20.5", "tot_games_o21.5", "tot_games_o22.5"].includes(marketKey)) {
    return `${m.en} — ${sel}`;
  }
  return m.en;
}

/** Persian explanation for the market (falls back to the key). */
export function marketFa(marketKey: string): string {
  return MAP[marketKey]?.fa ?? marketKey;
}

/** Settlement rule text. */
export function settlementRule(sport: string, marketKey: string): string {
  return MAP[marketKey]?.settle ?? (sport === "tennis" ? TENNIS_SETTLE : FOOTBALL_SETTLE);
}

/** Family bucket for analytics grouping. */
export function marketFamilyKey(marketKey: string): string {
  if (marketKey === "1x2") return "1X2";
  if (marketKey === "acca2") return "Accumulator";
  if (marketKey === "dnb") return "Draw No Bet";
  if (marketKey === "btts") return "BTTS";
  if (marketKey.startsWith("dc_")) return "Double Chance";
  if (marketKey.startsWith("ah_")) return "Asian Handicap";
  if (marketKey.startsWith("ou_")) return "Totals";
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

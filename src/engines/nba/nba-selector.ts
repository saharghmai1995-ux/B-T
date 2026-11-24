/**
 * NeoBet Quant Pro v3.3.2 — Engine 3: NBA Basketball Selector (REAL BOOKMAKER)
 * Patch `neobet_v332_bookmaker_realism_and_rca_patch.md` §1 — golden rule of
 * the real books (BetForward & 1xBet):
 *   • A FAVOURITE NEVER gets a plus handicap — the v3.3.1 `Alt Spread +4.5`
 *     on the favourite is STRUCTURALLY DEAD. A strong favourite (winProb
 *     ≥ 0.68 AND season win% ≥ 45%) offers ONLY `Match Winner (Incl. OT)` or
 *     a whole-number `Points Handicap (-2)/(-3)` with a FULL PUSH SHIELD on
 *     the exact 2/3-point win.
 *   • Plus handicaps (+5)/(+6) exist ONLY for the UNDERDOG in close matchups
 *     (fav margin ≤ 3.8), with a push shield on the exact 5/6-point loss.
 *   • Bottom-table teams (season win% < 45%) NEVER receive a Match Winner
 *     signal — the engine stays silent instead (honest no-pick).
 *   • Whole-number lines push honestly: resolveNbaSelection returns
 *     "WON" | "PUSH" | "LOST" (push = stake returned — never a loss, never a
 *     fake win).
 * Calibration carried over from v3.3.1 (still exact):
 *   • Per-game point differential STRICTLY clamped to [-12, +12].
 *   • 70/30 blend with win% strength; margin clamped [-14, +14]; SIGMA 12.2.
 * Zero-Mock: every feature is REAL data or an honest absence (false/0).
 */

import type { ProtectedMarketCandidate } from "@/core/agents/push-shield-selector";

export interface NbaMatchFeatures {
  homeTeam: string;
  awayTeam: string;
  /** Per-game point differential proxy (ESPN NetRtg or rolling form mean). */
  homeNetRating: number;
  awayNetRating: number;
  /** Optional REAL win% (0..1) from ESPN standings — dampens small samples. */
  homeWinPct?: number;
  awayWinPct?: number;
  homeBackToBack: boolean;
  awayBackToBack: boolean;
  homeRestDays: number;
  awayRestDays: number;
  homeStarOut: boolean;
  awayStarOut: boolean;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Standard Normal CDF approximation for the NBA margin distribution. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export interface NbaCalibratedView {
  pHomeWin: number;
  pAwayWin: number;
  expectedHomeMargin: number;
  favIsHome: boolean;
  favWinProb: number;
}

/**
 * v3.3.1 §1a — calibrated core of the NBA margin model (kept for the ensemble
 * quant view; the pick builder below uses the same math patch-exact).
 */
function calibratedNbaView(f: NbaMatchFeatures): NbaCalibratedView {
  // 1. Per-game point differential strictly clamped to realistic NBA range [-12, +12]
  const homeDiff = clamp(f.homeNetRating, -12, 12);
  const awayDiff = clamp(f.awayNetRating, -12, 12);

  // 2. Blend per-game diff with win% strength (missing win% → neutral 0.5)
  const homeWinPct = clamp(f.homeWinPct ?? 0.5, 0, 1);
  const awayWinPct = clamp(f.awayWinPct ?? 0.5, 0, 1);
  const homeStrength = homeDiff * 0.7 + (homeWinPct - 0.5) * 14 * 0.3;
  const awayStrength = awayDiff * 0.7 + (awayWinPct - 0.5) * 14 * 0.3;

  // 3. Expected home margin (clamped [-14, +14] so probabilities stay calibrated)
  let expectedHomeMargin = homeStrength - awayStrength + 2.2; // +2.2 pts Home Court
  if (f.homeBackToBack) expectedHomeMargin -= 1.8;
  if (f.awayBackToBack) expectedHomeMargin += 1.8;
  if (f.homeStarOut) expectedHomeMargin -= 3.2;
  if (f.awayStarOut) expectedHomeMargin += 3.2;
  expectedHomeMargin = clamp(expectedHomeMargin, -14, 14);

  const SIGMA = 12.2; // Empirical NBA single-game margin std dev
  const pHomeWin = clamp(normalCdf(expectedHomeMargin / SIGMA), 0.12, 0.88);
  const pAwayWin = 1 - pHomeWin;
  const favIsHome = pHomeWin >= pAwayWin;
  const favWinProb = favIsHome ? pHomeWin : pAwayWin;
  return { pHomeWin, pAwayWin, expectedHomeMargin, favIsHome, favWinProb };
}

/* -------------------------------------------------------------------------
 * v3.3.2 §1 — REAL bookmaker market pick (patch-exact interface + math).
 * ---------------------------------------------------------------------- */

export type NbaRealMarketKey =
  | "NBA_ML"
  | "NBA_HCP_MINUS_2"
  | "NBA_HCP_MINUS_3"
  | "NBA_HCP_PLUS_5"
  | "NBA_HCP_PLUS_6";

export interface NbaRealMarketPick {
  marketKey: NbaRealMarketKey;
  selection: string;
  displayLabelEn: string;
  subtitleFa: string;
  posterLabel: string;
  winProb: number;
  pushProb: number;
  noLossProb: number;
  shieldType: "DIRECT_WIN" | "FULL_PUSH_SHIELD";
}

/**
 * Build the ONE legal bookmaker pick for the fixture (or null — honest
 * silence when no real market fits the matchup shape).
 */
export function buildRealBookmakerNbaPick(params: {
  homeTeam: string;
  awayTeam: string;
  homePointsForPerGame: number;
  homePointsAgainstPerGame: number;
  awayPointsForPerGame: number;
  awayPointsAgainstPerGame: number;
  homeWinPct: number;
  awayWinPct: number;
  homeB2B?: boolean;
  awayB2B?: boolean;
}): NbaRealMarketPick | null {
  const homeDiff = clamp(params.homePointsForPerGame - params.homePointsAgainstPerGame, -12, 12);
  const awayDiff = clamp(params.awayPointsForPerGame - params.awayPointsAgainstPerGame, -12, 12);
  const homeStrength = homeDiff * 0.7 + (params.homeWinPct - 0.5) * 14 * 0.3;
  const awayStrength = awayDiff * 0.7 + (params.awayWinPct - 0.5) * 14 * 0.3;

  let expectedHomeMargin = homeStrength - awayStrength + 2.2;
  if (params.homeB2B) expectedHomeMargin -= 1.8;
  if (params.awayB2B) expectedHomeMargin += 1.8;
  expectedHomeMargin = clamp(expectedHomeMargin, -14, 14);

  const SIGMA = 12.2;
  const pHomeWin = clamp(normalCdf(expectedHomeMargin / SIGMA), 0.14, 0.86);
  const pAwayWin = 1 - pHomeWin;

  const favIsHome = pHomeWin >= pAwayWin;
  const favTeam = favIsHome ? params.homeTeam : params.awayTeam;
  const dogTeam = favIsHome ? params.awayTeam : params.homeTeam;
  const favWinPctSeason = clamp(favIsHome ? params.homeWinPct : params.awayWinPct, 0, 1);
  const favWinProb = favIsHome ? pHomeWin : pAwayWin;
  const favMargin = Math.abs(expectedHomeMargin);
  const favSide = favIsHome ? "HOME" : "AWAY";
  const dogSide = favIsHome ? "AWAY" : "HOME";

  // 1. Strong favourite (and NEVER a bottom-table team with <45% season win%)
  if (favWinProb >= 0.68 && favWinPctSeason >= 0.45) {
    // Very strong margin (≥ 9.5 pts) → Push-Protected Points Handicap (-3):
    // win by 4+ = win · win by EXACTLY 3 = push (stake returned).
    if (favMargin >= 9.5) {
      const pWinMinus3 = clamp(normalCdf((favMargin - 3.5) / SIGMA), 0.50, 0.84);
      const pExact3 = clamp(normalCdf((favMargin - 2.5) / SIGMA) - pWinMinus3, 0.02, 0.06);
      return {
        marketKey: "NBA_HCP_MINUS_3",
        selection: `NBA_HCP_-3_${favSide}`,
        displayLabelEn: `Points Handicap (-3) — ${favTeam}`,
        subtitleFa: `برد با ۴+ امتیاز = برد · برد با دقیقاً ۳ امتیاز = سربه‌سر`,
        posterLabel: `Points Handicap (-3) — ${favTeam}`,
        winProb: pWinMinus3,
        pushProb: pExact3,
        noLossProb: clamp(pWinMinus3 + pExact3, 0.52, 0.86),
        shieldType: "FULL_PUSH_SHIELD",
      };
    }
    // Strong margin (≥ 7.5 pts) → Push-Protected Points Handicap (-2):
    // win by 3+ = win · win by EXACTLY 2 = push (stake returned).
    if (favMargin >= 7.5) {
      const pWinMinus2 = clamp(normalCdf((favMargin - 2.5) / SIGMA), 0.50, 0.84);
      const pExact2 = clamp(normalCdf((favMargin - 1.5) / SIGMA) - pWinMinus2, 0.02, 0.06);
      return {
        marketKey: "NBA_HCP_MINUS_2",
        selection: `NBA_HCP_-2_${favSide}`,
        displayLabelEn: `Points Handicap (-2) — ${favTeam}`,
        subtitleFa: `برد با ۳+ امتیاز = برد · برد با دقیقاً ۲ امتیاز = سربه‌سر`,
        posterLabel: `Points Handicap (-2) — ${favTeam}`,
        winProb: pWinMinus2,
        pushProb: pExact2,
        noLossProb: clamp(pWinMinus2 + pExact2, 0.52, 0.86),
        shieldType: "FULL_PUSH_SHIELD",
      };
    }
    // Moderate favourite → direct Match Winner (Incl. OT).
    return {
      marketKey: "NBA_ML",
      selection: `NBA_ML_${favSide}`,
      displayLabelEn: `Match Winner — ${favTeam}`,
      subtitleFa: `برد تیم با هر اختلافی (شامل وقت اضافه)`,
      posterLabel: `Match Winner — ${favTeam}`,
      winProb: favWinProb,
      pushProb: 0,
      noLossProb: favWinProb,
      shieldType: "DIRECT_WIN",
    };
  }

  // 2. Competitive matchups: UNDERDOG ONLY gets a plus handicap with push on
  //    the exact loss margin (+5; +6 as the ultra-close fallback).
  if (favMargin <= 3.8 && favWinPctSeason < 0.65) {
    const pDogCovers5 = clamp(normalCdf((4.5 - favMargin) / SIGMA), 0.50, 0.78);
    const pExact5 = clamp(normalCdf((5.5 - favMargin) / SIGMA) - pDogCovers5, 0.02, 0.06);
    if (pDogCovers5 + pExact5 >= 0.68) {
      return {
        marketKey: "NBA_HCP_PLUS_5",
        selection: `NBA_HCP_+5_${dogSide}`,
        displayLabelEn: `Points Handicap (+5) — ${dogTeam}`,
        subtitleFa: `برد یا باخت زیر ۵ امتیاز = برد · باخت دقیقاً ۵ امتیاز = سربه‌سر`,
        posterLabel: `Points Handicap (+5) — ${dogTeam}`,
        winProb: pDogCovers5,
        pushProb: pExact5,
        noLossProb: clamp(pDogCovers5 + pExact5, 0.52, 0.82),
        shieldType: "FULL_PUSH_SHIELD",
      };
    }
    // v3.3.2 — ultra-close matchup: +6 fallback under the same guardrails.
    if (favMargin <= 2.0) {
      const pDogCovers6 = clamp(normalCdf((5.5 - favMargin) / SIGMA), 0.50, 0.80);
      const pExact6 = clamp(normalCdf((6.5 - favMargin) / SIGMA) - pDogCovers6, 0.02, 0.06);
      if (pDogCovers6 + pExact6 >= 0.68) {
        return {
          marketKey: "NBA_HCP_PLUS_6",
          selection: `NBA_HCP_+6_${dogSide}`,
          displayLabelEn: `Points Handicap (+6) — ${dogTeam}`,
          subtitleFa: `برد یا باخت زیر ۶ امتیاز = برد · باخت دقیقاً ۶ امتیاز = سربه‌سر`,
          posterLabel: `Points Handicap (+6) — ${dogTeam}`,
          winProb: pDogCovers6,
          pushProb: pExact6,
          noLossProb: clamp(pDogCovers6 + pExact6, 0.52, 0.82),
          shieldType: "FULL_PUSH_SHIELD",
        };
      }
    }
  }

  // Honest silence — coin-flip matchups and bottom-table favourites get NO pick.
  return null;
}

/**
 * v3.3.2 — map engine features to the patch's real-bookmaker params. ESPN
 * standings expose the per-game DIFFERENTIAL; the for/against split around
 * the league mean reproduces exactly that differential (PF − PA = netRating),
 * so the patch math stays bit-identical while its interface is honoured.
 */
const NBA_LEAGUE_MEAN_PTS = 110; // empirical NBA per-team per-game mean

function nbaFeatureParams(f: NbaMatchFeatures): Parameters<typeof buildRealBookmakerNbaPick>[0] {
  return {
    homeTeam: f.homeTeam,
    awayTeam: f.awayTeam,
    homePointsForPerGame: NBA_LEAGUE_MEAN_PTS + f.homeNetRating / 2,
    homePointsAgainstPerGame: NBA_LEAGUE_MEAN_PTS - f.homeNetRating / 2,
    awayPointsForPerGame: NBA_LEAGUE_MEAN_PTS + f.awayNetRating / 2,
    awayPointsAgainstPerGame: NBA_LEAGUE_MEAN_PTS - f.awayNetRating / 2,
    homeWinPct: clamp(f.homeWinPct ?? 0.5, 0, 1),
    awayWinPct: clamp(f.awayWinPct ?? 0.5, 0, 1),
    homeB2B: f.homeBackToBack,
    awayB2B: f.awayBackToBack,
  };
}

/** Push-Shield pipeline adapter — the ONE legal pick in the shared vocabulary. */
export function buildNbaProtectedCandidates(f: NbaMatchFeatures): ProtectedMarketCandidate[] {
  const pick = buildRealBookmakerNbaPick(nbaFeatureParams(f));
  if (!pick) return [];
  return [
    {
      marketKey: pick.marketKey,
      selection: pick.selection,
      onexbetLabel: `Winner (Incl. OT): ${pick.selection.endsWith("HOME") ? "W1" : "W2"} (${pick.displayLabelEn.split(" — ")[1] ?? ""})`,
      betforwardLabel: pick.displayLabelEn,
      posterLabel: pick.posterLabel,
      winProb: pick.winProb,
      pushProb: pick.pushProb,
      lossProb: Math.max(0, 1 - pick.noLossProb),
      noLossProb: pick.noLossProb,
      shieldType: pick.shieldType,
    },
  ];
}

/** v3.3.1 — calibrated raw NBA win probabilities for the ensemble agents. */
export function nbaWinProbabilities(f: NbaMatchFeatures): {
  pHomeWin: number;
  pAwayWin: number;
  expectedMargin: number;
} {
  const v = calibratedNbaView(f);
  return { pHomeWin: v.pHomeWin, pAwayWin: v.pAwayWin, expectedMargin: v.expectedHomeMargin };
}

/**
 * v3.3.2 §1 — Exact NBA settlement supporting whole-number Push (-2, -3, +5, +6).
 * The legacy v3.3.1 half-point alt spread (+4.5) can NEVER push and is kept
 * only so already-settled ledger rows never flip status.
 */
export function resolveNbaSelection(
  selection: string,
  homeScore: number,
  awayScore: number,
): "WON" | "PUSH" | "LOST" {
  const diffHome = homeScore - awayScore;
  if (selection === "NBA_ML_HOME") return diffHome > 0 ? "WON" : "LOST";
  if (selection === "NBA_ML_AWAY") return diffHome < 0 ? "WON" : "LOST";
  // Legacy v3.3.1 favourite +4.5 spread (half-point — push impossible).
  if (selection === "NBA_ALT_+4.5_HOME") return homeScore + 4.5 > awayScore ? "WON" : "LOST";
  if (selection === "NBA_ALT_+4.5_AWAY") return awayScore + 4.5 > homeScore ? "WON" : "LOST";

  const match = selection.match(/^NBA_HCP_([+-]?\d+(?:\.\d+)?)_(HOME|AWAY)$/);
  if (match) {
    const line = parseFloat(match[1]);
    const side = match[2];
    const adjusted = (side === "HOME" ? diffHome : -diffHome) + line;
    if (adjusted > 0) return "WON";
    if (adjusted === 0) return "PUSH";
    return "LOST";
  }
  return "LOST";
}

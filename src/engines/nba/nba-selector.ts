/**
 * NeoBet Quant Pro v3.3.1 — Engine 3: NBA Basketball Selector (CALIBRATED)
 * Hotfix `neobet_v331_nba_market_hotfix.md` §1:
 *   • Per-game point differential STRICTLY clamped to [-12, +12] (ESPN
 *     standings "differential" is already per-game; the old model fed raw
 *     net-rating swings straight into normalCdf → 98.6% / 99.1% garbage).
 *   • 70/30 blend with win% strength to damp small-sample spikes.
 *   • Expected home margin clamped to [-14, +14] so probabilities stay
 *     calibrated; SIGMA raised to the empirical 12.2 pts.
 *   • HARD probability caps: pWin ≤ 0.88, Alt +4.5 shield ∈ [0.50, 0.88]
 *     — the "Overconfidence 99.1%" bug is structurally dead.
 *   • Dedicated market keys NBA_ML / NBA_ALT_SPREAD (NEVER the football
 *     1X2 / AH_PLUS_025 vocabulary again).
 *   • Pick policy: Moneyline for ≥68% favourites, +4.5 Shield for 58%–67%
 *     favourites, NOTHING below 58% (coin-flips are never issued).
 * Zero-Mock: every feature is REAL data or an honest absence (false/0).
 * NBA has no draws → pushProb = 0 everywhere; a half-point +4.5 line can
 * NEVER push.
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
  pAltPlus45: number;
}

/**
 * v3.3.1 §1a — calibrated core of the NBA margin model (hotfix-exact math).
 * Shared by the pick builder AND the raw ensemble probability view so the
 * two can never diverge again.
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
  const favMargin = Math.abs(expectedHomeMargin);

  // Alt Spread +4.5 Shield probability (clamped ≤ 0.88 — NEVER 99% overconfidence)
  const pAltPlus45 = clamp(normalCdf((favMargin + 4.5) / SIGMA), 0.50, 0.88);

  return { pHomeWin, pAwayWin, expectedHomeMargin, favIsHome, favWinProb, pAltPlus45 };
}

/**
 * v3.3.1 §1a — hotfix-exact pick builder.
 *   favWinProb ≥ 0.68            → NBA Moneyline pick
 *   0.58 ≤ favWinProb < 0.68 AND pAltPlus45 ≥ 0.74 → NBA Alt Spread +4.5 pick
 *   otherwise                    → NO pick (honest silence, never a forced coin-flip)
 */
export function buildCalibratedNbaPicks(f: NbaMatchFeatures): Array<{
  marketKey: "NBA_ML" | "NBA_ALT_SPREAD";
  selection: string;
  onexbetLabel: string;
  betforwardLabel: string;
  posterLabel: string;
  winProb: number;
  pushProb: 0;
  noLossProb: number;
  shieldType: "DIRECT_WIN" | "DOUBLE_OUTCOME_SHIELD";
}> {
  const { pHomeWin, favIsHome, favWinProb, pAltPlus45 } = calibratedNbaView(f);
  const favTeam = favIsHome ? f.homeTeam : f.awayTeam;
  const sideNum = favIsHome ? "1" : "2";

  const picks: Array<{
    marketKey: "NBA_ML" | "NBA_ALT_SPREAD";
    selection: string;
    onexbetLabel: string;
    betforwardLabel: string;
    posterLabel: string;
    winProb: number;
    pushProb: 0;
    noLossProb: number;
    shieldType: "DIRECT_WIN" | "DOUBLE_OUTCOME_SHIELD";
  }> = [];

  if (favWinProb >= 0.68) {
    picks.push({
      marketKey: "NBA_ML", // Dedicated NBA Moneyline key (NOT football 1X2)
      selection: favIsHome ? "NBA_ML_HOME" : "NBA_ML_AWAY",
      onexbetLabel: `Winner (Incl. OT): W${sideNum} (${favTeam})`,
      betforwardLabel: `Moneyline: ${favTeam}`,
      posterLabel: `NBA Moneyline — ${favTeam}`,
      winProb: favWinProb,
      pushProb: 0,
      noLossProb: favWinProb,
      shieldType: "DIRECT_WIN",
    });
  } else if (favWinProb >= 0.58 && pAltPlus45 >= 0.74) {
    picks.push({
      marketKey: "NBA_ALT_SPREAD", // Dedicated NBA Spread key (NEVER football AH_PLUS_025!)
      selection: favIsHome ? "NBA_ALT_+4.5_HOME" : "NBA_ALT_+4.5_AWAY",
      onexbetLabel: `Handicap ${sideNum} (+4.5) — ${favTeam}`,
      betforwardLabel: `Alt Spread: ${favTeam} +4.5`,
      posterLabel: `NBA Alt Spread +4.5 — ${favTeam}`,
      winProb: pAltPlus45,
      pushProb: 0,
      noLossProb: pAltPlus45,
      shieldType: "DOUBLE_OUTCOME_SHIELD",
    });
  }

  return picks;
}

/** Push-Shield pipeline adapter — calibrated picks in the shared vocabulary. */
export function buildNbaProtectedCandidates(f: NbaMatchFeatures): ProtectedMarketCandidate[] {
  return buildCalibratedNbaPicks(f).map((p) => ({
    ...p,
    lossProb: Math.max(0, 1 - p.noLossProb),
  }));
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
 * v3.3.1 §1b — Dedicated NBA settlement (hotfix-exact).
 * A half-point +4.5 line can NEVER push. Settles the dedicated NBA keys
 * independently of every football branch.
 */
export function resolveNbaSelection(
  selection: string,
  homeScore: number,
  awayScore: number,
): "WON" | "LOST" {
  if (selection === "NBA_ML_HOME") return homeScore > awayScore ? "WON" : "LOST";
  if (selection === "NBA_ML_AWAY") return awayScore > homeScore ? "WON" : "LOST";
  if (selection === "NBA_ALT_+4.5_HOME") return homeScore + 4.5 > awayScore ? "WON" : "LOST";
  if (selection === "NBA_ALT_+4.5_AWAY") return awayScore + 4.5 > homeScore ? "WON" : "LOST";
  return "LOST";
}

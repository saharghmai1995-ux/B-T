/**
 * NeoBet Quant Pro v3.3 — Engine 3: NBA Basketball Selector
 * Pure normal-CDF margin model over REAL ESPN NetRtg-per-game differentials
 * (points for − points against / games from the free standings feed).
 * Zero-Mock: every feature is REAL data or an honest absence (false/0).
 * NBA has no draws → pushProb = 0 everywhere; the +4.5 alt spread is the
 * DOUBLE_OUTCOME_SHIELD (favourite can lose by up to 4 and still WIN).
 */

import type { ProtectedMarketCandidate } from "@/core/agents/push-shield-selector";

export interface NbaMatchFeatures {
  homeTeam: string;
  awayTeam: string;
  homeNetRating: number; // ORTG - DRTG per 100 possessions (per-game diff proxy)
  awayNetRating: number;
  homeBackToBack: boolean;
  awayBackToBack: boolean;
  homeRestDays: number;
  awayRestDays: number;
  homeStarOut: boolean;
  awayStarOut: boolean;
}

/** Standard Normal CDF approximation for NBA margin distribution (sigma = 11.8 pts) */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function buildNbaProtectedCandidates(f: NbaMatchFeatures): ProtectedMarketCandidate[] {
  const HOME_COURT_ADV = 2.4;
  const B2B_PENALTY = 2.1;
  const STAR_OUT_PENALTY = 3.2;
  const SIGMA_MARGIN = 11.8;

  // Expected home margin in points
  let expectedMargin = (f.homeNetRating - f.awayNetRating) + HOME_COURT_ADV;
  if (f.homeBackToBack) expectedMargin -= B2B_PENALTY;
  if (f.awayBackToBack) expectedMargin += B2B_PENALTY;
  if (f.homeStarOut) expectedMargin -= STAR_OUT_PENALTY;
  if (f.awayStarOut) expectedMargin += STAR_OUT_PENALTY;

  const pHomeWin = normalCdf(expectedMargin / SIGMA_MARGIN);
  const pAwayWin = 1 - pHomeWin;
  const favIsHome = pHomeWin >= pAwayWin;
  const favTeam = favIsHome ? f.homeTeam : f.awayTeam;
  const favMargin = Math.abs(expectedMargin);
  const favWinProb = favIsHome ? pHomeWin : pAwayWin;

  // Alt Handicap +4.5 Shield (favorite can even lose by up to 4 points and still WIN!)
  const pAltPlus45 = normalCdf((favMargin + 4.5) / SIGMA_MARGIN);
  const sideNum = favIsHome ? "1" : "2";

  const out: ProtectedMarketCandidate[] = [
    {
      marketKey: "1X2",
      selection: favIsHome ? "NBA_ML_HOME" : "NBA_ML_AWAY",
      onexbetLabel: `Winner (Incl. OT): W${sideNum} (${favTeam})`,
      betforwardLabel: `Moneyline: ${favTeam}`,
      posterLabel: `NBA Moneyline — ${favTeam}`,
      winProb: favWinProb,
      pushProb: 0,
      lossProb: 1 - favWinProb,
      noLossProb: favWinProb,
      shieldType: "DIRECT_WIN",
    },
    {
      marketKey: "AH_PLUS_025",
      selection: favIsHome ? "NBA_ALT_+4.5_HOME" : "NBA_ALT_+4.5_AWAY",
      onexbetLabel: `Handicap ${sideNum} (+4.5) — ${favTeam}`,
      betforwardLabel: `Alt Spread: ${favTeam} +4.5`,
      posterLabel: `NBA Alt Spread +4.5 — ${favTeam}`,
      winProb: pAltPlus45,
      pushProb: 0,
      lossProb: 1 - pAltPlus45,
      noLossProb: pAltPlus45,
      shieldType: "DOUBLE_OUTCOME_SHIELD",
    },
  ];

  return out
    .filter((c) => c.noLossProb >= 0.72)
    .sort((a, b) => b.noLossProb - a.noLossProb);
}

/** v3.3 — raw NBA win probabilities for the ensemble agents (same margin math). */
export function nbaWinProbabilities(f: NbaMatchFeatures): {
  pHomeWin: number;
  pAwayWin: number;
  expectedMargin: number;
} {
  const HOME_COURT_ADV = 2.4;
  const B2B_PENALTY = 2.1;
  const STAR_OUT_PENALTY = 3.2;
  const SIGMA_MARGIN = 11.8;

  let expectedMargin = (f.homeNetRating - f.awayNetRating) + HOME_COURT_ADV;
  if (f.homeBackToBack) expectedMargin -= B2B_PENALTY;
  if (f.awayBackToBack) expectedMargin += B2B_PENALTY;
  if (f.homeStarOut) expectedMargin -= STAR_OUT_PENALTY;
  if (f.awayStarOut) expectedMargin += STAR_OUT_PENALTY;

  const pHomeWin = normalCdf(expectedMargin / SIGMA_MARGIN);
  return { pHomeWin, pAwayWin: 1 - pHomeWin, expectedMargin };
}

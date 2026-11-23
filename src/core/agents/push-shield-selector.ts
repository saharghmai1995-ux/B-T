/**
 * NeoBet Quant Pro v3.1 — Push-Shield Selector
 * Selects the optimal LOW-LOSS / PUSH-PROTECTED market for every fixture.
 * The engine maximises noLossProb = winProb + pushProb (stake returned = no loss)
 * while keeping a genuine win probability. NO dependency on EV%, Kelly or bankroll.
 *
 * Football inputs derive from the Dixon-Coles quote board (1x2 + O/U ladders);
 * tennis inputs derive from the Markov-Copula quote board (winner, set-betting,
 * game handicap). All probabilities are REAL model outputs — never invented.
 */

import type { Sport } from "@/core/types";

export type ShieldType =
  | "DIRECT_WIN"
  | "FULL_PUSH_SHIELD"
  | "HALF_PUSH_SHIELD"
  | "DOUBLE_OUTCOME_SHIELD";

export type ShieldMarketKey =
  | "1X2"
  | "DNB_AH0"
  | "AH_PLUS_025"
  | "DOUBLE_CHANCE"
  | "OVER_2_0"
  | "UNDER_3_0"
  | "TENNIS_ML"
  | "TENNIS_SET_PLUS_15"
  | "TENNIS_GAME_HCP";

export interface ProtectedMarketCandidate {
  marketKey: ShieldMarketKey;
  selection: string;
  onexbetLabel: string;     // Exact clean 1xBet name + team/player (NO ◆ symbol)
  betforwardLabel: string;  // Exact clean BetForward name + team/player
  posterLabel: string;      // 100% English concise label for Telegram poster
  winProb: number;          // Probability of full WIN
  pushProb: number;         // Probability of PUSH / VOID (stake returned, no loss)
  lossProb: number;         // 1 - winProb - pushProb
  noLossProb: number;       // winProb + pushProb
  shieldType: ShieldType;
}

export interface FootballShieldInputs {
  homeTeam: string;
  awayTeam: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver2: number;   // P(total >= 3)
  pExact2: number;  // P(total == 2)
  pUnder3: number;  // P(total <= 2)
  pExact3: number;  // P(total == 3)
}

/**
 * Football Poisson-matrix evaluator for Push-Protected & Low-Loss options.
 * Derives every candidate from the SAME Dixon-Coles probability mass that
 * feeds the quote board — no second model, no contradiction risk.
 */
export function buildFootballProtectedCandidates(
  params: FootballShieldInputs,
): ProtectedMarketCandidate[] {
  const { homeTeam, awayTeam, pHome, pDraw, pAway, pOver2, pExact2, pUnder3, pExact3 } = params;
  const favIsHome = pHome >= pAway;
  const favTeam = favIsHome ? homeTeam : awayTeam;
  const favWin = favIsHome ? pHome : pAway;
  const dogWin = favIsHome ? pAway : pHome;
  const dcCode = favIsHome ? "1X" : "X2";
  const sideNum = favIsHome ? "1" : "2";

  const list: ProtectedMarketCandidate[] = [
    // 1. Handicap 0.0 / Draw No Bet (Draw = PUSH, Zero Loss on Draw)
    {
      marketKey: "DNB_AH0",
      selection: favIsHome ? "HOME" : "AWAY",
      onexbetLabel: `Handicap ${sideNum} (0) — ${favTeam}`,
      betforwardLabel: `Draw No Bet: ${sideNum} (${favTeam})`,
      posterLabel: `Handicap ${sideNum} (0) / DNB — ${favTeam}`,
      winProb: favWin,
      pushProb: pDraw,
      lossProb: dogWin,
      noLossProb: favWin + pDraw,
      shieldType: "FULL_PUSH_SHIELD",
    },
    // 2. Asian Handicap +0.25 (Draw = Half-Win + Half-Push)
    {
      marketKey: "AH_PLUS_025",
      selection: favIsHome ? "HOME_+0.25" : "AWAY_+0.25",
      onexbetLabel: `Asian Handicap ${sideNum} (+0.25) — ${favTeam}`,
      betforwardLabel: `Asian Handicap: ${favTeam} +0.25`,
      posterLabel: `Asian Handicap +0.25 — ${favTeam}`,
      winProb: favWin + pDraw * 0.5,
      pushProb: pDraw * 0.5,
      lossProb: dogWin,
      noLossProb: favWin + pDraw,
      shieldType: "HALF_PUSH_SHIELD",
    },
    // 3. Double Chance 1X / X2 (Highest Hit Rate for Tier S)
    {
      marketKey: "DOUBLE_CHANCE",
      selection: dcCode,
      onexbetLabel: `Double Chance: ${dcCode} (${favTeam} or Draw)`,
      betforwardLabel: `Double Chance: ${dcCode} (${favTeam} or Draw)`,
      posterLabel: `Double Chance ${dcCode} — ${favTeam} or Draw`,
      winProb: favWin + pDraw,
      pushProb: 0,
      lossProb: dogWin,
      noLossProb: favWin + pDraw,
      shieldType: "DOUBLE_OUTCOME_SHIELD",
    },
    // 4. Asian Total Over 2.0 Goals (Exact 2 goals = PUSH)
    {
      marketKey: "OVER_2_0",
      selection: "OVER_2.0",
      onexbetLabel: `Total Over (2.0) Goals`,
      betforwardLabel: `Asian Total: Over 2.0 Goals`,
      posterLabel: `Over 2.0 Goals (Push on 2)`,
      winProb: pOver2,
      pushProb: pExact2,
      lossProb: Math.max(0, 1 - pOver2 - pExact2),
      noLossProb: pOver2 + pExact2,
      shieldType: "FULL_PUSH_SHIELD",
    },
    // 5. Asian Total Under 3.0 Goals (Exact 3 goals = PUSH)
    {
      marketKey: "UNDER_3_0",
      selection: "UNDER_3.0",
      onexbetLabel: `Total Under (3.0) Goals`,
      betforwardLabel: `Asian Total: Under 3.0 Goals`,
      posterLabel: `Under 3.0 Goals (Push on 3)`,
      winProb: pUnder3,
      pushProb: pExact3,
      lossProb: Math.max(0, 1 - pUnder3 - pExact3),
      noLossProb: pUnder3 + pExact3,
      shieldType: "FULL_PUSH_SHIELD",
    },
  ];

  // Prefer high No-Loss probability (>= 72%) while keeping genuine Win probability (>= 52%)
  return list
    .filter((c) => c.noLossProb >= 0.72 && c.winProb >= 0.52)
    .sort((a, b) => (b.noLossProb * 0.65 + b.winProb * 0.35) - (a.noLossProb * 0.65 + a.winProb * 0.35));
}

export interface TennisShieldInputs {
  homePlayer: string;
  awayPlayer: string;
  /** v3.2 §3 — REAL ATP/WTA rankings when available (Elo-1500 rejection). */
  homeRank?: number | null;
  awayRank?: number | null;
  /** Markov-Copula quote-board probabilities (key@selection vocabulary). */
  winnerHome: number;
  winnerAway: number;
  setBet20Home: number;   // P(home wins 2-0)
  setBet20Away: number;   // P(away wins 2-0)
  gameHandHomePlus35: number | null;  // P(home games + 3.5 covers)
  gameHandAwayPlus35: number | null;  // P(away games + 3.5 covers)
  gameHandHomeMinus35: number | null; // P(home games - 3.5 covers)
  gameHandAwayMinus35: number | null; // P(away games - 3.5 covers)
}

/**
 * Tennis protected candidates from the Markov-Copula board.
 * - TENNIS_ML: favourite money line (DIRECT_WIN, no push in a completed match).
 * - TENNIS_SET_PLUS_15: +1.5 sets on a side — covers when that side takes at
 *   least one set (best-of-3); loses only on a 2-0 sweep by the opponent.
 *   Derived honestly: winProb = 1 − P(opponent wins 2-0).
 * - TENNIS_GAME_HCP: ±3.5 games handicap quote from the Monte-Carlo board.
 */
export function buildTennisProtectedCandidates(
  params: TennisShieldInputs,
): ProtectedMarketCandidate[] {
  const { homePlayer, awayPlayer, winnerHome, winnerAway, setBet20Home, setBet20Away } = params;

  // v3.2 §3 — HARD Elo-1500 rejection: any match where BOTH players carry the
  // default 1500 rating with NO real ATP/WTA ranking is an unrated coin-flip
  // and is rejected IMMEDIATELY (never a candidate, never a veto pick).
  const bothUnrated = params.homeRank == null && params.awayRank == null;
  const defaultEloCoinFlip = Math.abs(winnerHome - winnerAway) < 0.02;
  if (bothUnrated && defaultEloCoinFlip) return [];
  const favIsHome = winnerHome >= winnerAway;
  const favTeam = favIsHome ? homePlayer : awayPlayer;
  const dogTeam = favIsHome ? awayPlayer : homePlayer;
  const favWin = favIsHome ? winnerHome : winnerAway;
  const dogWin = favIsHome ? winnerAway : winnerHome;
  // +1.5 sets cover probability = 1 − P(opponent sweeps 2-0)
  const favSetCover = 1 - (favIsHome ? setBet20Away : setBet20Home);
  const dogSetCover = 1 - (favIsHome ? setBet20Home : setBet20Away);

  const list: ProtectedMarketCandidate[] = [
    {
      marketKey: "TENNIS_ML",
      selection: favIsHome ? "HOME" : "AWAY",
      onexbetLabel: `Match Winner — ${favTeam}`,
      betforwardLabel: `Match Winner: ${favTeam}`,
      posterLabel: `ML — ${favTeam}`,
      winProb: favWin,
      pushProb: 0,
      lossProb: Math.max(0, 1 - favWin),
      noLossProb: favWin,
      shieldType: "DIRECT_WIN",
    },
    {
      // Set handicap +1.5 on the DOG (covers with one set won) — emit both
      // sides and let the quality filter pick the strongest.
      marketKey: "TENNIS_SET_PLUS_15",
      selection: favIsHome ? "AWAY_+1.5" : "HOME_+1.5",
      onexbetLabel: `Set Handicap +1.5 — ${dogTeam}`,
      betforwardLabel: `Set Handicap: ${dogTeam} +1.5`,
      posterLabel: `Set HCP +1.5 — ${dogTeam}`,
      winProb: dogSetCover,
      pushProb: 0,
      lossProb: Math.max(0, 1 - dogSetCover),
      noLossProb: dogSetCover,
      shieldType: "DIRECT_WIN",
    },
    {
      // Favourite set cover (+1.5) — high no-loss for a dominant favourite.
      marketKey: "TENNIS_SET_PLUS_15",
      selection: favIsHome ? "HOME_+1.5" : "AWAY_+1.5",
      onexbetLabel: `Set Handicap +1.5 — ${favTeam}`,
      betforwardLabel: `Set Handicap: ${favTeam} +1.5`,
      posterLabel: `Set HCP +1.5 — ${favTeam}`,
      winProb: favSetCover,
      pushProb: 0,
      lossProb: Math.max(0, 1 - favSetCover),
      noLossProb: favSetCover,
      shieldType: "DIRECT_WIN",
    },
  ];

  if (params.gameHandHomePlus35 != null && params.gameHandAwayPlus35 != null) {
    const dogKey = favIsHome ? params.gameHandAwayPlus35 : params.gameHandHomePlus35;
    const favKey = favIsHome ? params.gameHandHomeMinus35 : params.gameHandAwayMinus35;
    list.push({
      marketKey: "TENNIS_GAME_HCP",
      selection: favIsHome ? "AWAY_+3.5" : "HOME_+3.5",
      onexbetLabel: `Games Handicap +3.5 — ${dogTeam}`,
      betforwardLabel: `Games Handicap: ${dogTeam} +3.5`,
      posterLabel: `Games HCP +3.5 — ${dogTeam}`,
      winProb: dogKey,
      pushProb: 0,
      lossProb: Math.max(0, 1 - dogKey),
      noLossProb: dogKey,
      shieldType: "DIRECT_WIN",
    });
    if (favKey != null) {
      list.push({
        marketKey: "TENNIS_GAME_HCP",
        selection: favIsHome ? "HOME_-3.5" : "AWAY_-3.5",
        onexbetLabel: `Games Handicap -3.5 — ${favTeam}`,
        betforwardLabel: `Games Handicap: ${favTeam} -3.5`,
        posterLabel: `Games HCP -3.5 — ${favTeam}`,
        winProb: favKey,
        pushProb: 0,
        lossProb: Math.max(0, 1 - favKey),
        noLossProb: favKey,
        shieldType: "DIRECT_WIN",
      });
    }
  }

  // v3.2 §3 — REAL tennis market diversity ladder (no more ML-only board):
  //   TENNIS_ML          → only for a clear favourite (win prob >= 68%)
  //   TENNIS_SET_PLUS_15 → dog +1.5 side ONLY for close matches (fav 52–67%);
  //                        favourite +1.5 keeps the >= 72% no-loss bar
  //   TENNIS_GAME_HCP    → keeps the hard bar (No-Loss >= 72%, win >= 52%)
  const kept = list.filter((c) => {
    if (c.marketKey === "TENNIS_ML") return c.winProb >= 0.68;
    if (c.marketKey === "TENNIS_SET_PLUS_15") {
      const isDogSide = c.selection === (favIsHome ? "AWAY_+1.5" : "HOME_+1.5");
      if (isDogSide) return favWin >= 0.52 && favWin <= 0.67 && c.noLossProb >= 0.72;
      return c.noLossProb >= 0.72 && c.winProb >= 0.52;
    }
    return c.noLossProb >= 0.72 && c.winProb >= 0.52;
  });
  return kept
    .sort((a, b) => (b.noLossProb * 0.65 + b.winProb * 0.35) - (a.noLossProb * 0.65 + a.winProb * 0.35));
}

/** v3.1 tier ladder from the spec (No-Loss Prob + Consensus gates). */
export type ConfidenceTier = "TIER_S" | "TIER_A" | "TIER_B";

export function assignConfidenceTier(
  noLossProb: number,
  consensusPct: number,
): ConfidenceTier | null {
  if (noLossProb >= 0.82 && consensusPct >= 85) return "TIER_S";
  if (noLossProb >= 0.74 && noLossProb <= 0.8199 && consensusPct >= 78) return "TIER_A";
  if (noLossProb >= 0.68 && noLossProb <= 0.7399 && consensusPct >= 72) return "TIER_B";
  return null;
}

export const shieldSport = (marketKey: ShieldMarketKey): Sport =>
  marketKey.startsWith("TENNIS_") ? "tennis" : "football";

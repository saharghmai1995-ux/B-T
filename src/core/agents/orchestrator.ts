/**
 * NeoBet Quant Pro v3.1 — Ensemble Consensus, Push-Shield Selector &
 * Veto Orchestrator.
 *
 * Runs the parallel superagent blend over ONE fixture:
 *   SuperAgent 1 (Quant Analyst)   → raw probs + data completeness
 *   SuperAgent 2 (Tactical Coach)  → tactical delta + veto flags
 *   Sharp-Market Prior Sensor      → optional non-blocking P_market
 * then blends (adaptive weights), applies SuperAgent 3 Platt calibration,
 * picks the optimal Push-Protected market and assigns Tier S / A / B.
 *
 * Deterministic, pure and synchronous — the network (odds feeds) already
 * happened upstream. Nothing here can block or crash the dashboard.
 */

import type { MatchContext, TeamStat } from "@/core/types";
import { devig1x2, devigTwoWay, marginPrice, BOOK_MARGIN } from "@/core/math/devig";
import { FLAT_VIEW_STAKE } from "@/core/math/kelly";
import {
  buildFootballProtectedCandidates,
  buildTennisProtectedCandidates,
  assignConfidenceTier,
  type ProtectedMarketCandidate,
  type ConfidenceTier,
} from "./push-shield-selector";
import { evaluateSharpMarketPrior, type SharpMarketPrior } from "./market-prior-sensor";
import { applyPlatt, type PlattParams, type EnsembleWeights } from "./calibration";

export type { ProtectedMarketCandidate, ConfidenceTier };

/** One quote-board entry (key@selection vocabulary of the engines). */
export interface EnsembleQuote {
  marketKey: string;
  selection: string;
  modelProb: number;
  trueProb: number;
  price: number;
  source: string; // "LIVE" | "ESTIMATE"
}

/** Real market prior inputs — passed ONLY when a genuine feed row exists. */
export interface MarketPriorInput {
  /** De-vigged P(favourite) from a REAL 1X2 / winner feed row. */
  favouriteProb: number;
  source: SharpMarketPrior["source"];
}

export interface QuantView {
  pHome: number;
  pDraw: number;
  pAway: number;
  /** Score-mass derived totals (football only). */
  pOver2: number;
  pExact2: number;
  pUnder3: number;
  pExact3: number;
  /** 0..1 — how complete the data behind the quant view is. */
  completeness: number;
  rejects: string[];
}

export interface CoachView {
  /** Bounded tactical adjustment (−0.08..+0.08) on the blended no-loss prob. */
  tacticalDelta: number;
  vetoFlags: string[];
  notes: string[];
}

export interface EnsembleVerdict {
  candidate: ProtectedMarketCandidate;
  tier: ConfidenceTier | null;
  consensusPct: number;
  noLossProb: number;      // blended + coach delta + Platt calibrated
  quantNoLoss: number;
  coachNoLoss: number;
  sharp: SharpMarketPrior;
  vetoReason: string | null;
  completeness: number;
  price: number;
}

const W = (p: number) => Math.min(1, Math.max(0, p));
const pct = (x: number) => Math.round(x * 1000) / 10;

/**
 * SuperAgent 1 — Quant Analyst. Derives the raw probability view and the
 * data-completeness score straight from the existing quote board.
 * Rejects Elo 1500 vs 1500 (unrated coin-flips) by completeness < 0.65.
 */
export function runQuantAgent(
  match: MatchContext,
  quotes: EnsembleQuote[],
  statHome: TeamStat | null,
  statAway: TeamStat | null,
): QuantView | null {
  const q = (key: string, sel: string) => quotes.find((x) => x.marketKey === key && x.selection === sel);

  if (match.sport === "football") {
    const home = q("1x2", "HOME");
    const draw = q("1x2", "DRAW");
    const away = q("1x2", "AWAY");
    if (!home || !draw || !away) return null;
    const pHome = W(home.modelProb);
    const pDraw = W(draw.modelProb);
    const pAway = W(away.modelProb);
    // Score-mass ladder: ou_1.5 → P(≥2), ou_2.5 → P(≥3), ou_3.5 → P(≥4)
    const o15 = q("ou_1.5", "OVER")?.modelProb;
    const o25 = q("ou_2.5", "OVER")?.modelProb;
    const o35 = q("ou_3.5", "OVER")?.modelProb;
    const pOver25 = o25 != null ? W(o25) : null;
    const pExact2 = o15 != null && o25 != null ? W(o15) - W(o25) : null;
    const pExact3 = o25 != null && o35 != null ? W(o25) - W(o35) : null;
    const pOver2 = pOver25 ?? null;
    const pUnder3 = pOver25 != null ? 1 - pOver25 : null;

    const rejects: string[] = [];
    if (pOver2 == null || pExact2 == null || pUnder3 == null || pExact3 == null) {
      rejects.push("totals ladder incomplete");
    }
    // Completeness: standings + real odds anchor + non-degenerate 1x2 mass.
    const hasStats = !!(statHome && statAway && statHome.played > 0 && statAway.played > 0);
    const hasOddsAnchor = quotes.some((x) => x.source === "LIVE");
    let completeness = 0.5;
    if (hasStats) completeness += 0.25;
    if (hasOddsAnchor) completeness += 0.2;
    if (Math.abs(pHome + pDraw + pAway - 1) > 0.02) {
      completeness -= 0.2;
      rejects.push("1x2 mass not normalised");
    }

    if (pOver2 == null || pExact2 == null || pUnder3 == null || pExact3 == null) return null;
    return {
      pHome, pDraw, pAway,
      pOver2: Math.max(0, pOver2),
      pExact2: Math.max(0, pExact2),
      pUnder3: Math.max(0, pUnder3),
      pExact3: Math.max(0, pExact3),
      completeness: W(completeness),
      rejects,
    };
  }

  // Tennis — Markov-Copula board.
  const wh = q("winner", "HOME");
  const wa = q("winner", "AWAY");
  const s20h = q("setbet_2_0", "HOME");
  const s20a = q("setbet_2_0", "AWAY");
  if (!wh || !wa || !s20h || !s20a) return null;
  const gameHand = (side: "home" | "away", sign: "+3.5" | "-3.5") =>
    q(`gamehand_${side}_${sign}`, side === "home" ? "HOME" : "AWAY")?.modelProb ?? null;

  const rejects: string[] = [];
  const bothDefaultElo =
    Math.abs(wh.modelProb - wa.modelProb) < 0.02 &&
    match.homeRank == null && match.awayRank == null;
  let completeness = 0.45;
  if (match.homeRank != null && match.awayRank != null) completeness += 0.3;
  else if (match.homeRank != null || match.awayRank != null) completeness += 0.12;
  if (quotes.some((x) => x.source === "LIVE")) completeness += 0.2;
  if (bothDefaultElo) {
    completeness -= 0.25;
    rejects.push("Elo 1500 vs 1500 — unrated coin-flip rejected");
  }

  return {
    pHome: W(wh.modelProb),
    pDraw: 0,
    pAway: W(wa.modelProb),
    pOver2: 0, pExact2: 0, pUnder3: 0, pExact3: 0,
    completeness: W(completeness),
    rejects,
  };
}

/**
 * SuperAgent 2 — Tactical Coach. Deterministic domain rules:
 * tennis rank-gap confidence, surface familiarity, football standings gap,
 * home venue and form streaks. NEVER invents news — flags only measurable
 * tactical factors; late-injury detection is the sharp sensor's job.
 */
export function runCoachAgent(
  match: MatchContext,
  quant: QuantView,
  statHome: TeamStat | null,
  statAway: TeamStat | null,
): CoachView {
  const notes: string[] = [];
  const vetoFlags: string[] = [];
  let delta = 0;

  if (match.sport === "tennis") {
    const gap = Math.abs((match.homeRank ?? 500) - (match.awayRank ?? 500));
    if (quant.completeness < 0.65) {
      vetoFlags.push("Low completeness — unrated pairing (Elo 1500 vs 1500)");
    }
    if (gap >= 120) {
      delta += 0.04;
      notes.push(`Rank gap ${gap} — clear favourite`);
    } else if (gap < 30) {
      delta -= 0.03;
      notes.push(`Rank gap ${gap} — near coin-flip`);
    }
    if (match.surface === "Clay") {
      delta += 0.01;
      notes.push("Clay — fewer tie-break swings, steadier spreads");
    }
  } else {
    if (statHome && statAway && statHome.played > 3 && statAway.played > 3) {
      const ppg = (s: TeamStat) => (s.played > 0 ? (s.won * 3 + s.drawn) / s.played : 0);
      const gap = Math.abs(ppg(statHome) - ppg(statAway));
      if (gap >= 0.9) {
        delta += 0.03;
        notes.push(`Standings PPG gap ${gap.toFixed(2)} — class gap`);
      } else if (gap < 0.15) {
        delta -= 0.02;
        notes.push("Even standings — draw risk up");
      }
      const formStreak = (s: TeamStat | null) => {
        const f = (s?.form ?? "").toUpperCase();
        let n = 0;
        for (let i = f.length - 1; i >= 0 && f[i] === "W"; i--) n++;
        return n;
      };
      const favIsHome = quant.pHome >= quant.pAway;
      const favStreak = formStreak(favIsHome ? statHome : statAway);
      if (favStreak >= 3) {
        delta += 0.02;
        notes.push(`Favourite ${favStreak}-match win streak`);
      }
    } else {
      notes.push("No standings data — quant view carries the match alone");
    }
    if (quant.pDraw >= 0.34) {
      delta -= 0.01;
      notes.push("Draw mass elevated — prefer FULL_PUSH_SHIELD markets");
    }
  }

  return {
    tacticalDelta: Math.min(0.08, Math.max(-0.08, delta)),
    vetoFlags,
    notes,
  };
}

/**
 * Full parallel ensemble for ONE fixture.
 * `marketPrior` is passed ONLY when a REAL de-vigged favourite probability
 * exists (ESPN Core / The Odds API / OddsPapi) — otherwise weight = 0.
 */
export function runEnsemble(
  match: MatchContext,
  quant: QuantView,
  coach: CoachView,
  platt: PlattParams,
  weights: EnsembleWeights,
  marketPrior: MarketPriorInput | null,
  candidates: ProtectedMarketCandidate[],
): EnsembleVerdict | null {
  if (candidates.length === 0) return null;

  // Quant no-loss view for the favourite-side candidate mass.
  const quantNoLossOf = (c: ProtectedMarketCandidate) => {
    if (match.sport === "football") {
      // Candidates already carry exact win/push masses from the SAME matrix.
      return c.noLossProb;
    }
    return c.noLossProb;
  };

  // Coach-adjusted no-loss for the SAME candidate (delta is side-agnostic
  // here because candidates all back the same fixture favourite direction).
  const coachNoLossOf = (c: ProtectedMarketCandidate) =>
    W(quantNoLossOf(c) + coach.tacticalDelta);

  // Sharp prior compares our no-loss view to the REAL de-vigged favourite prob.
  const sharp = marketPrior
    ? evaluateSharpMarketPrior(quantNoLossOf(candidates[0]), marketPrior.favouriteProb, marketPrior.source)
    : { available: false as const, sharpDivergenceAlert: false };

  // Blend: quant (Platt-calibrated) + coach + optional sharp prior.
  const blendNoLoss = (c: ProtectedMarketCandidate) => {
    const pQuant = applyPlatt(coachNoLossOf(c), platt);
    if (weights.marketAvailable && sharp.available && sharp.impliedWinProb != null) {
      const pSharp = W(sharp.impliedWinProb);
      return W(weights.wQuant * pQuant + weights.wCoach * coachNoLossOf(c) + weights.wMarket * pSharp);
    }
    return W(weights.wQuant * pQuant + weights.wCoach * coachNoLossOf(c));
  };

  // Consensus: agreement across the agent views (quant vs coach vs sharp).
  const consensusOf = (c: ProtectedMarketCandidate) => {
    const pQ = quantNoLossOf(c);
    const pC = coachNoLossOf(c);
    let maxDiv = Math.abs(pQ - pC);
    if (sharp.available && sharp.impliedWinProb != null) {
      maxDiv = Math.max(maxDiv, Math.abs(pQ - sharp.impliedWinProb));
    }
    return Math.round(Math.min(100, Math.max(0, 100 - maxDiv * 150)) * 10) / 10;
  };

  // Veto: hidden-news divergence, coach flags, low completeness.
  let vetoReason: string | null = null;
  if (sharp.sharpDivergenceAlert) {
    vetoReason = `Sharp divergence > 16pp vs P_market (${sharp.source ?? "market"}) — probable hidden news`;
  } else if (coach.vetoFlags.length > 0) {
    vetoReason = coach.vetoFlags[0];
  } else if (quant.completeness < 0.65) {
    vetoReason = `Data completeness ${(quant.completeness * 100).toFixed(0)}% < 65%`;
  }

  let best: (ProtectedMarketCandidate & { tier: ConfidenceTier | null; consensusPct: number; noLossProb: number }) | null = null;
  for (const c of candidates) {
    const noLossProb = blendNoLoss(c);
    const consensusPct = consensusOf(c);
    const tier = assignConfidenceTier(noLossProb, consensusPct);
    if (!tier) continue; // below the v3.1 quality ladder — not issued
    const score = noLossProb * 0.65 + c.winProb * 0.35;
    const bestScore = best ? best.noLossProb * 0.65 + best.winProb * 0.35 : -1;
    if (!best || score > bestScore) {
      best = { ...c, tier, consensusPct, noLossProb };
    }
  }

  if (!best) {
    // Candidates existed but none cleared the tier ladder — veto to shadow.
    return {
      candidate: candidates[0],
      tier: null,
      consensusPct: consensusOf(candidates[0]),
      noLossProb: blendNoLoss(candidates[0]),
      quantNoLoss: quantNoLossOf(candidates[0]),
      coachNoLoss: coachNoLossOf(candidates[0]),
      sharp,
      vetoReason: vetoReason ?? "No candidate cleared the Tier S/A/B ladder",
      completeness: quant.completeness,
      price: marginPrice(candidates[0].winProb, match.sport === "football" ? BOOK_MARGIN.football : BOOK_MARGIN.tennis),
    };
  }

  const price = marginPrice(
    best.winProb,
    match.sport === "football" ? BOOK_MARGIN.football : BOOK_MARGIN.tennis,
  );

  return {
    candidate: best,
    tier: best.tier,
    consensusPct: best.consensusPct,
    noLossProb: best.noLossProb,
    quantNoLoss: quantNoLossOf(best),
    coachNoLoss: coachNoLossOf(best),
    sharp,
    vetoReason,
    completeness: quant.completeness,
    price,
  };
}

/** Football real market prior from reference 1x2 odds (de-vigged favourite). */
export function footballMarketPrior(
  refOdds: { home?: number; draw?: number; away?: number } | null | undefined,
): MarketPriorInput | null {
  if (!refOdds?.home || !refOdds.away || !refOdds.draw) return null;
  const fair = devig1x2(refOdds.home, refOdds.draw, refOdds.away);
  const favProb = Math.max(fair.home, fair.away);
  return { favouriteProb: favProb, source: "ESPN_CORE_PUBLIC" };
}

/** Tennis real market prior from a LIVE winner quote pair (de-vigged). */
export function tennisMarketPrior(
  quotes: EnsembleQuote[],
): MarketPriorInput | null {
  const h = quotes.find((x) => x.marketKey === "winner" && x.selection === "HOME" && x.source === "LIVE");
  const a = quotes.find((x) => x.marketKey === "winner" && x.selection === "AWAY" && x.source === "LIVE");
  if (!h || !a || h.price <= 1.01 || a.price <= 1.01) return null;
  const fair = devigTwoWay(h.price, a.price);
  const favProb = Math.max(fair.over, fair.under);
  const source: SharpMarketPrior["source"] =
    (h as unknown as { book?: string }).book === "ODDSPAPI" ? "ODDSPAPI" : "THE_ODDS_API";
  return { favouriteProb: favProb, source };
}

export const consensusPctOf = pct;
export const SHIELD_STAKE = FLAT_VIEW_STAKE; // constant-risk flat staking — NO Kelly dependency

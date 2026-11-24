/**
 * Signal Factory — builds quotes + candidate signals per fixture
 * (football Dixon-Coles, tennis Markov-Copula) with supervisor vetoes.
 */

import type { CandidateSignal, MatchContext, TeamStat } from "@/core/types";
import type { LiveOddsRow } from "@/core/bookmakers/odds-feed";
import { buildFootballQuotes, pickSingleEv, pickAnchors, type FootballQuote } from "@/engines/football/football-selector";
import { buildTennisQuotes, pickSingleEvTennis, pickAnchorsTennis, type TennisQuote } from "@/engines/tennis/tennis-selector";

export interface FactoryOutput {
  quotes: Array<{ marketKey: string; selection: string; modelProb: number; trueProb: number; price: number; source: string }>;
  single: CandidateSignal | null;
  anchors: Array<{ marketKey: string; selection: string; modelProb: number; trueProb: number; price: number }>;
  matrix?: number[][];
  /** v3.3.2 §4.1 — fitted Dixon-Coles lambdas (football only) feeding the
   *  OVER_2_0 real-market gate (lambdaHome + lambdaAway >= 2.85). */
  lambdas?: { lh: number; la: number };
  elo?: { a: number; b: number };
}

export function buildFootballFactory(
  match: MatchContext,
  statHome: TeamStat | null,
  statAway: TeamStat | null,
  refOdds: { home?: number; draw?: number; away?: number; over?: number; under?: number; totalLine?: number } | null,
  leagueAvgGoals = 1.35,
): FactoryOutput {
  const { quotes, matrix, lambdas } = buildFootballQuotes(match, statHome, statAway, refOdds, leagueAvgGoals);
  const single = pickSingleEv(match, quotes);
  const anchors = pickAnchors(match, quotes);
  return {
    quotes: quotes.map((q: FootballQuote) => ({
      marketKey: q.marketKey, selection: q.selection, modelProb: q.modelProb,
      trueProb: q.trueProb, price: q.price, source: q.source,
    })),
    single, matrix, lambdas,
    anchors: anchors.map((q) => ({
      marketKey: q.marketKey, selection: q.selection,
      modelProb: q.modelProb, trueProb: q.trueProb, price: q.price,
    })),
  };
}

export function buildTennisFactory(
  match: MatchContext,
  liveOdds?: Map<string, LiveOddsRow>,
): FactoryOutput {
  const { quotes, elo } = buildTennisQuotes(match, liveOdds);
  // v2.7.2 §1 — the hard W1/W2 gate needs the ENGINE Elo (protected floors +
  // surface corrections) to reject unrated 1500-vs-1500 coin-flips.
  const single = pickSingleEvTennis(match, quotes, elo);
  const anchors = pickAnchorsTennis(match, quotes);
  return {
    quotes: quotes.map((q: TennisQuote) => ({
      marketKey: q.marketKey, selection: q.selection, modelProb: q.modelProb,
      trueProb: q.trueProb, price: q.price, source: q.source,
    })),
    single, elo,
    anchors: anchors.map((q) => ({
      marketKey: q.marketKey, selection: q.selection,
      modelProb: q.modelProb, trueProb: q.trueProb, price: q.price,
    })),
  };
}

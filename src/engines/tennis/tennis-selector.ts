/**
 * Tennis Signal Selector — Top-100 filter, elite-tournament guard,
 * protected-Elo favorites and the same three production lines as football.
 */

import type { CandidateSignal, MatchContext } from "@/core/types";
import { marginPrice, BOOK_MARGIN } from "@/core/math/devig";
import { isEliteTennisTournament } from "@/core/bookmakers/market-whitelist";
import { runMarkovCopula } from "./markov-copula";

export interface TennisQuote {
  marketKey: string;
  selection: string;
  modelProb: number;
  trueProb: number;
  price: number;
  source: "LIVE" | "ESTIMATE";
}

const EV_THRESHOLD = 0.045;
const PRICE_MIN = 1.72;
const PRICE_MAX = 2.2;
const ANCHOR_PROB = 0.79;
const ANCHOR_PRICE_MIN = 1.34;
const ANCHOR_PRICE_MAX = 1.5;
const TOP_RANK = 100;

export function buildTennisQuotes(match: MatchContext): {
  quotes: TennisQuote[];
  elo: { a: number; b: number };
} {
  const surface = (match.surface as "Hard" | "Clay" | "Grass") ?? "Hard";
  const elite = isEliteTennisTournament(match.league);
  const res = runMarkovCopula({
    rankA: match.homeRank ?? null,
    rankB: match.awayRank ?? null,
    surface, nameA: match.homeName, nameB: match.awayName, eliteTournament: elite,
  }, 77);

  // Consensus = rank-only Elo without surface/protected corrections (market view).
  const consensus = runMarkovCopula({
    rankA: match.homeRank ?? null,
    rankB: match.awayRank ?? null,
    surface: "Hard", nameA: match.homeName, nameB: match.awayName, eliteTournament: elite,
  }, 991);

  const quotes: TennisQuote[] = [];
  const margin = BOOK_MARGIN.tennis;
  for (const [keySel, modelProb] of Object.entries(res.probs)) {
    const at = keySel.lastIndexOf("@");
    const marketKey = keySel.slice(0, at);
    const selection = keySel.slice(at + 1);
    const trueProb = consensus.probs[keySel] ?? modelProb;
    const price = marginPrice(trueProb, margin);
    if (price > 1.01) {
      quotes.push({ marketKey, selection, modelProb, trueProb, price, source: "ESTIMATE" });
    }
  }
  return { quotes, elo: { a: res.eloA, b: res.eloB } };
}

/** Line 1 — best single +EV pick of the fixture (Top-100 + elite tournaments). */
export function pickSingleEvTennis(match: MatchContext, quotes: TennisQuote[]): CandidateSignal | null {
  const ranks = [match.homeRank, match.awayRank].filter((r): r is number => !!r);
  if (ranks.some((r) => r > TOP_RANK)) return null; // Top-100 filter
  if (!isEliteTennisTournament(match.league)) return null;
  let best: TennisQuote | null = null;
  let bestEv = -Infinity;
  for (const q of quotes) {
    const ev = q.modelProb * q.price - 1;
    if (ev >= EV_THRESHOLD && q.price >= PRICE_MIN && q.price <= PRICE_MAX && ev > bestEv) {
      best = q;
      bestEv = ev;
    }
  }
  if (!best) return null;
  return {
    match, line: "SINGLE_EV", marketKey: best.marketKey, marketLabel: best.marketKey,
    selection: best.selection, modelProb: best.modelProb, trueProb: best.trueProb,
    price: best.price, evPct: Math.round(bestEv * 1000) / 10,
    stake: 100, stakeMode: "FLAT_100",
  };
}

/** Line 2 — protected-Elo ultra-safe anchors. */
export function pickAnchorsTennis(match: MatchContext, quotes: TennisQuote[]): TennisQuote[] {
  const ranks = [match.homeRank, match.awayRank].filter((r): r is number => !!r);
  if (ranks.some((r) => r > TOP_RANK)) return [];
  if (!isEliteTennisTournament(match.league)) return [];
  return quotes
    .filter((q) => q.modelProb >= ANCHOR_PROB && q.price >= ANCHOR_PRICE_MIN && q.price <= ANCHOR_PRICE_MAX)
    .sort((a, b) => b.modelProb - a.modelProb)
    .slice(0, 2);
}

export function supervisorVetoTennis(match: MatchContext, q: TennisQuote): string | null {
  if (!isEliteTennisTournament(match.league)) return "Non-Main-Tour tournament (ITF/Challenger)";
  if (q.modelProb >= 0.955) return "Model saturation (prob >= 95.5%)";
  return null;
}

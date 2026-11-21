/**
 * Football Signal Selector — supervisor + production lines.
 * Line 1: single deep-value +EV pick (EV >= +4.5%, price 1.72-2.20).
 * Line 2: two ultra-safe anchors (prob >= 79%, price 1.34-1.50) for accas.
 * Line 3: real cross-book arb — only when LIVE books satisfy <= 0.94.
 */

import type { CandidateSignal, MatchContext, TeamStat } from "@/core/types";
import { devig1x2, devigTwoWay, marginPrice, BOOK_MARGIN } from "@/core/math/devig";
import { TOXIC_LEAGUES, assertMarketAllowed, getMarket } from "@/core/bookmakers/market-whitelist";
import { runDixonColes, stats1x2From, type TeamLite } from "./dixon-coles";
export interface FootballQuote {
  marketKey: string;
  selection: string;
  modelProb: number;
  trueProb: number;
  price: number; // 1xBet-style estimate (honest margin) or LIVE price
  source: "LIVE" | "ESTIMATE";
}

const EV_THRESHOLD = 0.045;
const PRICE_MIN = 1.72;
const PRICE_MAX = 2.2;
const ANCHOR_PROB = 0.79;
const ANCHOR_PRICE_MIN = 1.34;
const ANCHOR_PRICE_MAX = 1.5;

const LITE = (s?: TeamStat | null): TeamLite | null =>
  s ? { played: s.played, won: s.won, drawn: s.drawn, lost: s.lost, goalsFor: s.goalsFor, goalsAgainst: s.goalsAgainst, form: s.form } : null;

/** Build every whitelisted quote for one football fixture. */
export function buildFootballQuotes(
  match: MatchContext,
  statHome: TeamStat | null,
  statAway: TeamStat | null,
  refOdds: { home?: number; draw?: number; away?: number; over?: number; under?: number; totalLine?: number } | null,
  leagueAvgGoals = 1.35,
): { quotes: FootballQuote[]; lambdas: { lh: number; la: number }; matrix: number[][] } {
  const market1x2 = refOdds?.home && refOdds?.away && refOdds?.draw
    ? devig1x2(refOdds.home, refOdds.draw, refOdds.away)
    : null;
  const line = refOdds?.totalLine ?? 2.5;
  const marketTotal = refOdds?.over && refOdds?.under
    ? { line, ...devigTwoWay(refOdds.over, refOdds.under) }
    : null;
  const st = stats1x2From(LITE(statHome), LITE(statAway), leagueAvgGoals);
  const statsView = { home: st.home, draw: st.draw, away: st.away };
  const hasStats = !!(statHome && statAway && statHome.played > 0 && statAway.played > 0);
  const res = runDixonColes(
    { market1x2, marketTotal, stats1x2: statsView, hasStats, mode: "model" },
    LITE(statHome), LITE(statAway),
  );

  // Consensus (true) probability: pure market view when real odds exist,
  // otherwise the SAME standings stats (identical to the model → EV ≈ -margin,
  // honest: no synthetic alpha can be manufactured without a market anchor).
  const consensusMatrix = runDixonColes(
    { market1x2, marketTotal, stats1x2: statsView, hasStats, mode: "consensus" },
    LITE(statHome), LITE(statAway),
  );
  const quotes: FootballQuote[] = [];
  const margin = BOOK_MARGIN.football;
  for (const [keySel, modelProb] of Object.entries(res.probs)) {
    const at = keySel.lastIndexOf("@");
    const marketKey = keySel.slice(0, at);
    const selection = keySel.slice(at + 1);
    if (!assertMarketAllowed(marketKey, selection)) continue;
    const trueProb = consensusMatrix.probs[keySel] ?? modelProb;
    const price = marginPrice(trueProb, margin);
    if (price > 1.01) {
      quotes.push({ marketKey, selection, modelProb, trueProb, price, source: "ESTIMATE" });
    }
  }
  return { quotes, lambdas: { lh: res.lambdaHome, la: res.lambdaAway }, matrix: res.matrix };
}

/** Line 1 — best single +EV pick of the fixture (or null). */
export function pickSingleEv(
  match: MatchContext,
  quotes: FootballQuote[],
): CandidateSignal | null {
  if (TOXIC_LEAGUES.has(match.leagueCode)) return null;
  let best: FootballQuote | null = null;
  let bestEv = -Infinity;
  for (const q of quotes) {
    const ev = q.modelProb * q.price - 1;
    if (ev >= EV_THRESHOLD && q.price >= PRICE_MIN && q.price <= PRICE_MAX && ev > bestEv) {
      best = q;
      bestEv = ev;
    }
  }
  if (!best) return null;
  const ev = best.modelProb * best.price - 1;
  return {
    match, line: "SINGLE_EV", marketKey: best.marketKey,
    marketLabel: getMarket(best.marketKey)?.label ?? best.marketKey, selection: best.selection,
    modelProb: best.modelProb, trueProb: best.trueProb, price: best.price,
    evPct: Math.round(ev * 1000) / 10, stake: 100, stakeMode: "FLAT_100",
  };
}

/** Line 2 — ultra-safe anchors for 2-leg smart accumulators. */
export function pickAnchors(match: MatchContext, quotes: FootballQuote[]): FootballQuote[] {
  if (TOXIC_LEAGUES.has(match.leagueCode)) return [];
  return quotes
    .filter((q) => q.modelProb >= ANCHOR_PROB && q.price >= ANCHOR_PRICE_MIN && q.price <= ANCHOR_PRICE_MAX)
    .sort((a, b) => b.modelProb - a.modelProb)
    .slice(0, 2);
}

/** Line 3 — real cross-book arb (LIVE books only; estimates never qualify). */
export function pickCrossBookArb(
  match: MatchContext,
  books: Array<{ book: string; home: number; away: number }>,
): CandidateSignal | null {
  if (books.length < 2) return null;
  for (const sel of ["HOME", "AWAY"] as const) {
    const a = books[0], b = books[1];
    const pa = sel === "HOME" ? a.home : a.away;
    const pb = sel === "HOME" ? b.away : b.home;
    if (!pa || !pb) continue;
    if (1 / pa + 1 / pb <= 0.94) {
      return {
        match, line: "ARB", marketKey: "1x2", marketLabel: "1X2 Full-Time Result",
        selection: sel, modelProb: 1 / pa / (1 / pa + 1 / pb), trueProb: 1 / pa / (1 / pa + 1 / pb),
        price: pa, evPct: 0, stake: 100, stakeMode: "FLAT_100",
        arbBooks: [
          { book: a.book, selection: sel, price: pa },
          { book: b.book, selection: sel === "HOME" ? "AWAY" : "HOME", price: pb },
        ],
      };
    }
  }
  return null;
}

/** Supervisor verdict — veto reasons for the shadow ledger. */
export function supervisorVeto(match: MatchContext, q: FootballQuote): string | null {
  if (TOXIC_LEAGUES.has(match.leagueCode)) return `Toxic league ${match.leagueCode}`;
  if (q.modelProb >= 0.955) return "Model saturation (prob >= 95.5%) — market already priced";
  if (q.price < 1.05) return "Price below rounding floor";
  return null;
}

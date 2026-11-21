/**
 * Tennis Signal Selector — Top-100 filter, elite-tournament guard,
 * protected-Elo favorites and the same three production lines as football.
 */

import type { CandidateSignal, MatchContext } from "@/core/types";
import { devigTwoWay, marginPrice, BOOK_MARGIN } from "@/core/math/devig";
import { isEliteTennisTournament, getMarket } from "@/core/bookmakers/market-whitelist";
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
/** Live-1xBet rule (v2.5): end-of-season WTA 125K / Challenger events stay
 * active — a LIVE 1xBet price with EV >= +4.0% is signalable even when the
 * tournament is not elite. */
export const LIVE_EV_THRESHOLD = 0.04;
const PRICE_MIN = 1.72;
const PRICE_MAX = 2.2;
const ANCHOR_PROB = 0.79;
const ANCHOR_PRICE_MIN = 1.34;
const ANCHOR_PRICE_MAX = 1.5;
const TOP_RANK = 100;

/** Normalized name key — mirrors the odds-feed map keys. */
export const tennisOddsKey = (home: string, away: string) =>
  `${home.toLowerCase().replace(/[^a-z]/g, "")}|${away.toLowerCase().replace(/[^a-z]/g, "")}`;

/** Build every whitelisted quote for one tennis fixture. */
export function buildTennisQuotes(
  match: MatchContext,
  liveOdds?: Map<string, { book: "1XBET_LIVE" | "PINNACLE"; home?: number; away?: number }>,
): {
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

  // v2.5 — attach REAL 1xBet (preferred) or Pinnacle winner prices when the
  // live feed carries this matchup. The 2-way de-vig gives the market truth.
  if (liveOdds) {
    const key = tennisOddsKey(match.homeName, match.awayName);
    const row = liveOdds.get(`${key}|1XBET_LIVE`) ?? liveOdds.get(`${key}|PINNACLE`);
    if (row?.home && row?.away && row.home > 1.01 && row.away > 1.01) {
      const [pH] = devigTwoWay(row.home, row.away);
      const liveWinner: TennisQuote = {
        marketKey: "winner", selection: "HOME",
        modelProb: res.probs["winner@HOME"] ?? consensus.probs["winner@HOME"] ?? pH,
        trueProb: pH, price: row.home, source: "LIVE",
      };
      const liveAway: TennisQuote = {
        marketKey: "winner", selection: "AWAY",
        modelProb: res.probs["winner@AWAY"] ?? consensus.probs["winner@AWAY"] ?? (1 - pH),
        trueProb: 1 - pH, price: row.away, source: "LIVE",
      };
      // LIVE rows replace their ESTIMATE twin so provenance stays honest.
      const filtered = quotes.filter(
        (q) => !(q.marketKey === "winner" && (q.selection === "HOME" || q.selection === "AWAY")),
      );
      quotes.length = 0;
      quotes.push(...filtered, liveWinner, liveAway);
    }
  }

  return { quotes, elo: { a: res.eloA, b: res.eloB } };
}

/** Line 1 — best single +EV pick of the fixture (Top-100 + elite tournaments,
 * relaxed to EV >= +4% for LIVE-1xBet matches so off-season WTA 125K stays alive). */
export function pickSingleEvTennis(match: MatchContext, quotes: TennisQuote[]): CandidateSignal | null {
  const ranks = [match.homeRank, match.awayRank].filter((r): r is number => !!r);
  const hasLive = quotes.some((q) => q.source === "LIVE");
  if (!hasLive && ranks.some((r) => r > TOP_RANK)) return null; // Top-100 filter (estimates only)
  if (!hasLive && !isEliteTennisTournament(match.league)) return null;
  let best: TennisQuote | null = null;
  let bestEv = -Infinity;
  for (const q of quotes) {
    const ev = q.modelProb * q.price - 1;
    const threshold = q.source === "LIVE" ? LIVE_EV_THRESHOLD : EV_THRESHOLD;
    const priceOk = q.source === "LIVE"
      ? q.price >= 1.45 && q.price <= 2.6
      : q.price >= PRICE_MIN && q.price <= PRICE_MAX;
    if (ev >= threshold && priceOk && ev > bestEv) {
      best = q;
      bestEv = ev;
    }
  }
  if (!best) return null;
  return {
    match, line: "SINGLE_EV", marketKey: best.marketKey,
    marketLabel: getMarket(best.marketKey)?.label ?? best.marketKey,
    selection: best.selection, modelProb: best.modelProb, trueProb: best.trueProb,
    price: best.price, evPct: Math.round(bestEv * 1000) / 10,
    stake: 20, stakeMode: "KELLY_025",
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

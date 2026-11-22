/**
 * Tennis Signal Selector — Top-100 filter, elite-tournament guard,
 * protected-Elo favorites and the same three production lines as football.
 *
 * v2.7.2 HOTFIX (tennis engine):
 *  §1 Hard +EV lock — the symmetric W1/W2 gate (selectSafeTennisMatchWinner)
 *     rejects unrated coin-flips, artificial flat estimate prices and every
 *     candidate whose raw Kelly is <= 0. NO tennis signal with EV < +4.0%
 *     can reach the signal center or the ledger again, and the 10u MIN_STAKE
 *     floor is applied ONLY when EV >= +4.0% AND Kelly > 0 (a <=0-EV candidate
 *     stakes 0 and is nulled — the forced-stake bug is dead).
 *  §2 Total Sets Over/Under 2.5 is COMPLETELY disabled on estimated prices
 *     (the market produced -52.8u of the -77.3u tennis tab). It only fires
 *     with a REAL bookmaker price + real (non-1500) Elo on both players and
 *     EV >= +4.5%.
 */

import type { CandidateSignal, MatchContext } from "@/core/types";
import type { LiveOddsRow } from "@/core/bookmakers/odds-feed";
import { devigTwoWay, marginPrice, BOOK_MARGIN } from "@/core/math/devig";
import {
  calculateSafeQuarterKellyStake, MAX_STAKE, MIN_STAKE, fullKelly,
} from "@/core/math/kelly";
import { isEliteTennisTournament, getMarket } from "@/core/bookmakers/market-whitelist";
import { runMarkovCopula, eloFromRank } from "./markov-copula";

/* -------------------------------------------------------------------------
 * v2.7.2 §1 — Hard +EV, Non-Default Elo & Symmetric W1/W2 Gate
 * (exact hotfix spec: symmetric EV check fixes the 100% W2 selection bias,
 * every accepted candidate carries a strictly positive raw Kelly)
 * ---------------------------------------------------------------------- */

export type TennisOddsSource = "THE_ODDS_API" | "ODDSPAPI" | "ESPN_CORE_PUBLIC" | "ESTIMATE";

export interface TennisQuote {
  marketKey: string;
  selection: string;
  modelProb: number;
  trueProb: number;
  price: number;
  source: "LIVE" | "ESTIMATE";
  /** v2.7.2 — the REAL feed book behind a LIVE row (provenance for the hard gate). */
  book?: "1XBET_LIVE" | "PINNACLE" | "ESPN_PUBLIC" | "ODDSPAPI";
}

export interface TennisCandidateInput {
  homePlayer: string;
  awayPlayer: string;
  homeElo: number;
  awayElo: number;
  homeRank?: number | null;
  awayRank?: number | null;
  homeProb: number;
  awayProb: number;
  homeOdds: number;
  awayOdds: number;
  oddsSource: TennisOddsSource;
}

export function selectSafeTennisMatchWinner(input: TennisCandidateInput) {
  // 1. Reject unrated coin-flips (Elo 1500 vs 1500 without real ATP/WTA rankings)
  const bothDefaultElo = Math.abs(input.homeElo - 1500) < 0.5 && Math.abs(input.awayElo - 1500) < 0.5;
  const hasRealRanks = Boolean(input.homeRank && input.awayRank);
  if (bothDefaultElo && !hasRealRanks) {
    return null;
  }

  // 2. Reject artificial flat estimated prices (~1.90-1.97) that have no real bookmaker edge
  if (input.oddsSource === "ESTIMATE") {
    return null;
  }

  // 3. Symmetric EV check for BOTH W1 and W2 (fixes the 100% W2 selection bias bug)
  const evHome = input.homeProb * input.homeOdds - 1;
  const evAway = input.awayProb * input.awayOdds - 1;

  const MIN_TENNIS_EV = 0.04; // Strict +4.0% minimum edge
  let side: "W1" | "W2" | null = null;
  let prob = 0;
  let odds = 0;
  let ev = -1;

  if (evHome >= MIN_TENNIS_EV && evHome >= evAway) {
    side = "W1";
    prob = input.homeProb;
    odds = input.homeOdds;
    ev = evHome;
  } else if (evAway >= MIN_TENNIS_EV && evAway > evHome) {
    side = "W2";
    prob = input.awayProb;
    odds = input.awayOdds;
    ev = evAway;
  }

  if (!side || ev < MIN_TENNIS_EV) return null;

  // 4. Quarter-Kelly stake — strictly return null if Kelly <= 0 (NEVER force 10u on <=0 EV)
  const b = odds - 1;
  const fullKelly = (prob * b - (1 - prob)) / b;
  if (fullKelly <= 0) return null;

  return {
    side,
    player: side === "W1" ? input.homePlayer : input.awayPlayer,
    prob,
    odds,
    ev,
    quarterKellyFraction: Math.min(Math.max(fullKelly * 0.25, 0.01), 0.035),
  };
}

/** The hard +4.0% tennis floor every issued candidate must clear. */
export const MIN_TENNIS_EV = 0.04;
/** v2.7.2 §2 — Total Sets minimum EV even on a REAL price. */
export const TOTAL_SETS_MIN_EV = 0.045;

/** Real (non-default 1500) Elo test — §2's "real ranking/Elo" requirement. */
function isRealElo(elo: number | null | undefined): boolean {
  return typeof elo === "number" && Number.isFinite(elo) && Math.abs(elo - 1500) >= 0.5;
}

const EV_THRESHOLD = 0.045;
/** Live-1xBet rule (v2.5): end-of-season WTA 125K / Challenger events stay
 * active — a LIVE 1xBet price with EV >= +4.0% is signalable even when the
 * tournament is not elite. */
export const LIVE_EV_THRESHOLD = 0.04;
/** v2.7.1 hotfix §2.5 — tennis singles REQUIRE a real market price. During
 * tour breaks NO source publishes tennis prices (The Odds API: zero active
 * tennis keys; ESPN core odds: no items; OddsPapi: tennis unsupported), and
 * model-fair estimate prices carry the full 5.5% margin — a measured max
 * model-vs-consensus divergence of just 2.1pp can NEVER produce an honest
 * +EV pick, only margin-artifact noise (audited +2.8% longshots at 1pp
 * divergence). So the estimate gate stays at the strict +4.5% bar: it only
 * fires on genuine divergences, and LIVE rows (layers 1/3, wired into this
 * selector) keep the +4.0% bar. The tennis line fills automatically the
 * moment any market source publishes prices again.
 *
 * v2.7.2 §1 — the estimate floor now sits ON TOP of the hard +4.0% lock and
 * the winner market additionally passes selectSafeTennisMatchWinner, so the
 * audited -77.3u tab (flat 1.90-1.97 estimate prices, 100% W2 bias, forced
 * 10u stakes) can never be reproduced. */
export const ESTIMATE_EV_FLOOR = 0.045;
/** Model-vs-market honesty guard (v2.7): divergence tolerance raised from
 * 12pp to 18pp so live edges are not over-filtered — the guard still blocks
 * saturated rank-noise "edges" while letting real live value through. */
export const LIVE_MAX_MODEL_MARKET_DIVERGENCE = 0.18;
const PRICE_MIN = 1.72;
const PRICE_MAX = 2.2;
const ANCHOR_PROB = 0.79;
const ANCHOR_PRICE_MIN = 1.34;
const ANCHOR_PRICE_MAX = 1.5;
const TOP_RANK = 150; // v2.7: raised from 100 — Challenger / Davis Cup coverage

/** Build every whitelisted quote for one tennis fixture. */
export function buildTennisQuotes(
  match: MatchContext,
  liveOdds?: Map<string, LiveOddsRow>,
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
    // v2.7.2 §2 — Total Sets O/U 2.5 is COMPLETELY disabled on estimated
    // prices: no estimate quote for this market is ever built (so no quote
    // board row, no anchor and no Line-1 candidate can exist).
    if (marketKey === "tot_sets_o2.5") continue;
    const trueProb = consensus.probs[keySel] ?? modelProb;
    const price = marginPrice(trueProb, margin);
    if (price > 1.01) {
      quotes.push({ marketKey, selection, modelProb, trueProb, price, source: "ESTIMATE" });
    }
  }

  // v2.5 — attach REAL winner prices when a live feed carries this matchup.
  // v2.7.1 — priority: 1xBet → Pinnacle → ESPN Core PUBLIC per-event odds
  // (keyless layer 3, hotfix §2.5: the tennis engine must never fall back to
  // bare model-fair prices while any public market source is reachable).
  // Matching is ORDER-INDEPENDENT: ESPN and the book may disagree on who is
  // "home", so the pair key is name-sorted and prices are re-aligned to ESPN's
  // home/away by comparing player names.
  if (liveOdds) {
    const normName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    const nh = normName(match.homeName);
    const na = normName(match.awayName);
    const pair = [nh, na].sort().join("|");
    const found = liveOdds.get(`${pair}|1XBET_LIVE`)
      ?? liveOdds.get(`${pair}|PINNACLE`)
      ?? liveOdds.get(`${pair}|ESPN_PUBLIC`);
    if (found?.home && found?.away && found.home > 1.01 && found.away > 1.01) {
      // Re-align book prices to THIS fixture's home/away sides.
      const bookHome = normName(found.homeName ?? "");
      const priceForHome = bookHome && bookHome === nh ? found.home : found.away;
      const priceForAway = priceForHome === found.home ? found.away : found.home;
      if (priceForHome > 1.01 && priceForAway > 1.01) {
        const fair = devigTwoWay(priceForHome, priceForAway);
        const pH = fair.over; // first input (home) fair probability
        const pA = fair.under;
        const liveWinner: TennisQuote = {
          marketKey: "winner", selection: "HOME",
          modelProb: res.probs["winner@HOME"] ?? consensus.probs["winner@HOME"] ?? pH,
          trueProb: pH, price: priceForHome, source: "LIVE", book: found.book,
        };
        const liveAway: TennisQuote = {
          marketKey: "winner", selection: "AWAY",
          modelProb: res.probs["winner@AWAY"] ?? consensus.probs["winner@AWAY"] ?? pA,
          trueProb: pA, price: priceForAway, source: "LIVE", book: found.book,
        };
        // LIVE rows replace their ESTIMATE twin so provenance stays honest.
        const filtered = quotes.filter(
          (q) => !(q.marketKey === "winner" && (q.selection === "HOME" || q.selection === "AWAY")),
        );
        quotes.length = 0;
        quotes.push(...filtered, liveWinner, liveAway);
      }
    }
  }

  return { quotes, elo: { a: res.eloA, b: res.eloB } };
}

/**
 * Line 1 — best single +EV pick of the fixture under the v2.7.2 HARD rules:
 *  - EVERY candidate: EV >= +4.0% (LIVE) / +4.5% (ESTIMATE), raw Kelly > 0,
 *    stake = Quarter-Kelly clamped to the 10u-35u safe band (10u floor ONLY
 *    because the EV+Kelly gates passed — a <=0-EV candidate returns null).
 *  - Winner market: selectSafeTennisMatchWinner (symmetric W1/W2, non-default
 *    Elo, REAL bookmaker prices only — estimates are rejected).
 *  - Total Sets O/U 2.5: REAL price + real Elo + EV >= +4.5% only (§2).
 */
export function pickSingleEvTennis(
  match: MatchContext,
  quotes: TennisQuote[],
  elo?: { a: number; b: number },
): CandidateSignal | null {
  const ranks = [match.homeRank, match.awayRank].filter((r): r is number => !!r);
  const hasLive = quotes.some((q) => q.source === "LIVE");
  if (!hasLive && ranks.some((r) => r > TOP_RANK)) return null; // Top-100 filter (estimates only)
  if (!hasLive && !isEliteTennisTournament(match.league)) return null;

  // §2 — Total Sets belt-and-braces gate (quotes are already filtered at
  // build time; a LIVE tot_sets quote still needs real Elo + EV >= +4.5%).
  const tradable = quotes.filter((q) => {
    if (q.marketKey !== "tot_sets_o2.5") return true;
    if (q.source !== "LIVE") return false;
    if (!isRealElo(elo?.a) || !isRealElo(elo?.b)) return false;
    return q.modelProb * q.price - 1 >= TOTAL_SETS_MIN_EV;
  });

  // Winner market — the symmetric W1/W2 hard gate runs ONCE per fixture with
  // BOTH sides (the gate itself picks the better side and enforces EV >= 4%,
  // non-default Elo, REAL prices and Kelly > 0).
  const qHome = tradable.find((q) => q.marketKey === "winner" && q.selection === "HOME");
  const qAway = tradable.find((q) => q.marketKey === "winner" && q.selection === "AWAY");
  let winnerQuote: TennisQuote | null = null;
  let winnerEv = -Infinity;
  if (qHome && qAway) {
    // v2.7.2 §1 — provenance decides the gate's oddsSource: an ESTIMATE row is
    // ALWAYS mapped to "ESTIMATE" (rejected by the gate), ESPN Core PUBLIC →
    // ESPN_CORE_PUBLIC, OddsPapi → ODDSPAPI, every other LIVE book arrives via
    // The Odds API v4.
    const oddsSource: TennisOddsSource = qHome.source === "ESTIMATE" || qAway.source === "ESTIMATE"
      ? "ESTIMATE"
      : qHome.book === "ESPN_PUBLIC"
        ? "ESPN_CORE_PUBLIC"
        : qHome.book === "ODDSPAPI"
          ? "ODDSPAPI"
          : "THE_ODDS_API"; // 1XBET_LIVE / PINNACLE rows arrive via The Odds API v4
    const gated = selectSafeTennisMatchWinner({
      homePlayer: match.homeName,
      awayPlayer: match.awayName,
      homeElo: elo?.a ?? eloFromRank(match.homeRank ?? null),
      awayElo: elo?.b ?? eloFromRank(match.awayRank ?? null),
      homeRank: match.homeRank ?? null,
      awayRank: match.awayRank ?? null,
      homeProb: qHome.modelProb,
      awayProb: qAway.modelProb,
      homeOdds: qHome.price,
      awayOdds: qAway.price,
      oddsSource,
    });
    if (gated) {
      winnerQuote = gated.side === "W1" ? qHome : qAway;
      winnerEv = winnerQuote.modelProb * winnerQuote.price - 1;
    }
  }

  // Non-winner markets — hard +EV ladder (EV threshold + price band + Kelly).
  let best: TennisQuote | null = null;
  let bestEv = -Infinity;
  for (const q of tradable) {
    if (q.marketKey === "winner") continue; // handled by the symmetric gate above
    const ev = q.modelProb * q.price - 1;
    const threshold = q.source === "LIVE" ? LIVE_EV_THRESHOLD : ESTIMATE_EV_FLOOR;
    const priceOk = q.source === "LIVE"
      ? q.price >= 1.45 && q.price <= 2.6
      : q.price >= PRICE_MIN && q.price <= PRICE_MAX;
    // LIVE honesty guard: skip saturated model-vs-market divergences.
    const divergenceOk = q.source !== "LIVE" || q.modelProb - q.trueProb <= LIVE_MAX_MODEL_MARKET_DIVERGENCE;
    // v2.7.2 §1 — raw Kelly MUST be positive (never issue a <=0-EV candidate).
    if (ev < threshold || !priceOk || !divergenceOk || fullKelly(q.modelProb, q.price) <= 0) continue;
    if (ev > bestEv) {
      best = q;
      bestEv = ev;
    }
  }
  if (winnerQuote && winnerEv > bestEv) {
    best = winnerQuote;
    bestEv = winnerEv;
  }
  if (!best) return null;

  // §1 stake rule — MIN_STAKE=10u applies ONLY because ev >= +4.0% AND raw
  // Kelly > 0 both passed above; the Quarter-Kelly output is clamped to the
  // 10u-35u safe band of the bank.
  const qk = calculateSafeQuarterKellyStake(best.modelProb, best.price);
  if (bestEv < MIN_TENNIS_EV || qk.stakeUnits <= 0) return null;
  const stake = Math.min(MAX_STAKE, Math.max(MIN_STAKE, qk.stakeUnits));
  return {
    match, line: "SINGLE_EV", marketKey: best.marketKey,
    marketLabel: getMarket(best.marketKey)?.label ?? best.marketKey,
    selection: best.selection, modelProb: best.modelProb, trueProb: best.trueProb,
    price: best.price, evPct: Math.round(bestEv * 1000) / 10,
    stake, stakeMode: "KELLY_025",
  };
}

/** Line 2 — protected-Elo ultra-safe anchors (LIVE prices only in practice:
 * an estimate price for prob >= 0.79 lands below the 1.34 band floor). */
export function pickAnchorsTennis(match: MatchContext, quotes: TennisQuote[]): TennisQuote[] {
  const ranks = [match.homeRank, match.awayRank].filter((r): r is number => !!r);
  if (ranks.some((r) => r > TOP_RANK)) return [];
  if (!isEliteTennisTournament(match.league)) return [];
  return quotes
    .filter((q) => {
      // §2 defensive guard — Total Sets can never anchor on an estimate price.
      if (q.marketKey === "tot_sets_o2.5" && q.source !== "LIVE") return false;
      return q.modelProb >= ANCHOR_PROB && q.price >= ANCHOR_PRICE_MIN && q.price <= ANCHOR_PRICE_MAX;
    })
    .sort((a, b) => b.modelProb - a.modelProb)
    .slice(0, 2);
}

export function supervisorVetoTennis(match: MatchContext, q: TennisQuote): string | null {
  if (!isEliteTennisTournament(match.league) && q.source !== "LIVE") return "Non-Main-Tour tournament (ITF only)";
  if (q.modelProb >= 0.955) return "Model saturation (prob >= 95.5%)";
  if (q.source === "LIVE" && q.modelProb - q.trueProb > LIVE_MAX_MODEL_MARKET_DIVERGENCE) {
    return "Model-market divergence > 18pp — edge is model noise, not value";
  }
  if (q.modelProb * q.price - 1 < MIN_TENNIS_EV) {
    return "v2.7.2 hard +EV lock: EV below +4.0% (tennis hotfix §1)";
  }
  return null;
}

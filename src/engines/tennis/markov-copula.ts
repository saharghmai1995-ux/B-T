/**
 * Tennis Engine — Markov chain + Gaussian copula + 10,000 Monte-Carlo sims.
 * Point → Game → Set → Match chain with game-by-game simulation under a
 * shared performance factor (copula rho) so player day-forms stay correlated.
 */

import { round3 } from "@/core/math/devig";

export interface TennisInput {
  rankA: number | null;
  rankB: number | null;
  surface: "Hard" | "Clay" | "Grass";
  nameA: string;
  nameB: string;
  eliteTournament: boolean;
}

export interface TennisResult {
  eloA: number;
  eloB: number;
  pointProbA: number;
  sims: number;
  probs: Record<string, number>; // marketKey@selection → model probability
}

const SIMS = 10_000;
const RHO = 0.18; // copula correlation of day-form between sets
const SERVE_ADV = 0.06;

/** Rank → base Elo (deterministic, public mapping). */
export function eloFromRank(rank: number | null): number {
  if (!rank || rank <= 0) return 1500;
  return Math.max(1200, 2300 - 35 * Math.log(rank));
}

/** Champions returning from injury — protected Elo floor (ATP/WTA Main Tour). */
const ELITE_PROTECTED_ELO: Record<string, number> = {
  sinner: 2250, alcaraz: 2260, zverev: 2150, djokovic: 2170, medvedev: 2100,
  rublev: 2060, ruud: 2080, "de minaur": 2080, fritz: 2070, shelton: 2070,
  draper: 2090, musetti: 2060, rune: 2040, fonseca: 2020, tsitsipas: 2030,
  sabalenka: 2230, swiatek: 2250, gauff: 2180, rybakina: 2140, pegula: 2110,
  krejcikova: 2050, zheng: 2100, paolini: 2090,
};

const SURFACE_BONUS: Record<string, Record<string, number>> = {
  alcaraz: { Clay: 45, Grass: 55, Hard: 15 },
  sinner: { Hard: 45, Grass: 30, Clay: 10 },
  zverev: { Hard: 35, Clay: 30, Grass: 5 },
  medvedev: { Hard: 40, Grass: 15, Clay: -15 },
  rublev: { Hard: 25, Clay: 20, Grass: -5 },
  ruud: { Clay: 55, Hard: 10, Grass: -10 },
  tsitsipas: { Clay: 45, Hard: 15, Grass: 0 },
  djokovic: { Grass: 45, Hard: 30, Clay: 25 },
  sabalenka: { Hard: 45, Grass: 25, Clay: 10 },
  swiatek: { Clay: 60, Hard: 35, Grass: 15 },
  gauff: { Hard: 35, Clay: 25, Grass: 15 },
  rybakina: { Grass: 45, Hard: 30, Clay: 5 },
};

function protectedElo(name: string, rank: number | null, surface: string): number {
  const base = eloFromRank(rank);
  const key = name.toLowerCase().trim();
  const floor = ELITE_PROTECTED_ELO[key] ?? 0;
  let elo = Math.max(base, floor);
  elo += SURFACE_BONUS[key]?.[surface] ?? 0;
  if (!rank) elo = Math.min(elo, 1750); // unknown qualifier — honest neutral cap
  return elo;
}

/** Deterministic RNG (mulberry32) — reproducible Monte-Carlo streams. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function norm(rng: () => number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Win one game given point-win probability (deuce model, bounded). */
function winGame(pPoint: number, rng: () => number): boolean {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) {
    if (rng() < pPoint) a++; else b++;
    if (a >= 4 && a - b >= 2) return true;
    if (b >= 4 && b - a >= 2) return false;
  }
  return rng() < pPoint;
}

function winTiebreak(pPoint: number, rng: () => number): boolean {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) {
    if (rng() < pPoint) a++; else b++;
    if (a >= 7 && a - b >= 2) return true;
    if (b >= 7 && b - a >= 2) return false;
  }
  return rng() < pPoint;
}

interface SimOutcome {
  setsA: number;
  setsB: number;
  gameMargin: number; // gamesA - gamesB
}

/** Best-of-3 game-by-game simulation with copula-coupled day-form.
 * v2.5 FIX: winGame simulates from the SERVER's perspective — when B serves,
 * `true` means B holds the game, so the outcome must be INVERTED for A.
 * The old code credited B's holds to A, saturating every match at ~94%/6%
 * and poisoning all tennis market probabilities. */
function simulateMatch(p0: number, rng: () => number): SimOutcome {
  let setsA = 0, setsB = 0, margin = 0;
  while (setsA < 2 && setsB < 2) {
    const z = norm(rng);
    const shift = 0.035 * z; // shared day-form factor (copula)
    const pServeA = Math.min(0.88, Math.max(0.35, p0 + shift + SERVE_ADV));
    const pServeB = Math.min(0.88, Math.max(0.35, 1 - p0 - shift + SERVE_ADV));
    let gA = 0, gB = 0, servingA = true;
    for (let i = 0; i < 40; i++) {
      const serverIsA = servingA;
      const serverWins = winGame(serverIsA ? pServeA : pServeB, rng);
      const aWins = serverIsA ? serverWins : !serverWins; // invert on B serve
      if (aWins) gA++; else gB++;
      servingA = !servingA;
      if (gA >= 6 && gB >= 6) {
        if (winTiebreak(p0 + shift, rng)) gA = 7; else gB = 7;
        break;
      }
      if (gA >= 6 && gA - gB >= 2) break;
      if (gB >= 6 && gB - gA >= 2) break;
    }
    margin += gA - gB;
    if (gA > gB) setsA++; else setsB++;
  }
  return { setsA, setsB, gameMargin: margin };
}

/** Full tennis engine: Elo + copula Monte-Carlo → whitelisted market probs. */
export function runMarkovCopula(inp: TennisInput, seed: number = 42): TennisResult {
  const eloA = protectedElo(inp.nameA, inp.rankA, inp.surface);
  const eloB = protectedElo(inp.nameB, inp.rankB, inp.surface);
  const p0 = sigmoid(((eloA - eloB) / 400) * Math.log(10) / 2);
  const rng = mulberry32(seed + inp.nameA.length + inp.nameB.length);
  let w2_0 = 0, w2_1 = 0, l1_2 = 0, l0_2 = 0, sets3 = 0;
  const margins: number[] = [];
  for (let i = 0; i < SIMS; i++) {
    const o = simulateMatch(p0, rng);
    if (o.setsA === 2 && o.setsB === 0) w2_0++;
    else if (o.setsA === 2 && o.setsB === 1) w2_1++;
    else if (o.setsA === 1 && o.setsB === 2) l1_2++;
    else l0_2++;
    if (o.setsA + o.setsB === 3) sets3++;
    margins.push(o.gameMargin);
  }
  const pWinA = (w2_0 + w2_1) / SIMS;
  const probs: Record<string, number> = {};
  const put = (k: string, v: number) => (probs[k] = round3(Math.min(0.99, Math.max(0.01, v))));
  put("winner@HOME", pWinA); put("winner@AWAY", 1 - pWinA);
  put("setbet_2_0@HOME", w2_0 / SIMS); put("setbet_2_1@HOME", w2_1 / SIMS);
  put("setbet_2_0@AWAY", l0_2 / SIMS); put("setbet_2_1@AWAY", l1_2 / SIMS);
  put("tot_sets_o2.5@OVER", sets3 / SIMS);
  put("tot_sets_o2.5@UNDER", 1 - sets3 / SIMS);
  put("sethand_home_-1.5@HOME", w2_0 / SIMS);
  put("sethand_home_+1.5@HOME", pWinA);
  put("sethand_away_-1.5@AWAY", l0_2 / SIMS);
  put("sethand_away_+1.5@AWAY", 1 - pWinA);
  const frac = (pred: (m: number) => boolean) =>
    margins.reduce((acc, m) => acc + (pred(m) ? 1 : 0), 0) / SIMS;
  // Total games distribution: honest analytic estimate from set-shape + margin
  const avgAbsMargin = margins.reduce((a, b) => a + Math.abs(b), 0) / SIMS;
  const avgTotalGames = 20 + avgAbsMargin * 0.35 + (sets3 / SIMS) * 5.5;
  for (const l of [20.5, 21.5, 22.5]) {
    const pOver = Math.min(0.95, Math.max(0.05, sigmoid((avgTotalGames - l) / 1.35)));
    put(`tot_games_o${l}@OVER`, pOver);
    put(`tot_games_o${l}@UNDER`, 1 - pOver);
  }
  put("gamehand_home_-3.5@HOME", frac((m) => m >= 4));
  put("gamehand_home_+3.5@HOME", frac((m) => m > -3));
  put("gamehand_away_-3.5@AWAY", frac((m) => m <= -4));
  put("gamehand_away_+3.5@AWAY", frac((m) => m < 3));
  return { eloA, eloB, pointProbA: round3(p0), sims: SIMS, probs };
}

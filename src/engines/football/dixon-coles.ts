/**
 * Dixon-Coles Football Engine — server-only math.
 * 6x6 score-density matrix with DC low-score tau correction, and
 * Reverse-Poisson fitting of lambdas to the (65% market + 35% standings)
 * blended target. No artificial inflation anywhere: probabilities are honest.
 */

import { round3 } from "@/core/math/devig";

export interface DCInput {
  market1x2?: { home: number; draw: number; away: number } | null; // de-vigged consensus
  marketTotal?: { line: number; over: number; under: number } | null;
  stats1x2?: { home: number; draw: number; away: number } | null;
  hasStats?: boolean; // true only when BOTH teams have real standings rows
  mode?: "consensus" | "model";
}

export interface DCResult {
  lambdaHome: number;
  lambdaAway: number;
  matrix: number[][];
  probs: Record<string, number>; // marketKey@selection → model probability
}

export interface TeamLite {
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; form?: string;
}

const MAXG = 6;
const RHO = -0.13;

const FACT = [1, 1, 2, 6, 24, 120];
const pois = (k: number, lambda: number): number =>
  (Math.exp(-lambda) * Math.pow(lambda, k)) / FACT[Math.min(k, 5)];

function tau(x: number, y: number, lx: number, ly: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lx * ly * rho;
  if (x === 0 && y === 1) return 1 + lx * rho;
  if (x === 1 && y === 0) return 1 + ly * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/** 6x6 Dixon-Coles score-density matrix, normalized to sum 1. */
export function buildScoreMatrix(lh: number, la: number, rho: number = RHO): number[][] {
  const m: number[][] = [];
  let s = 0;
  for (let h = 0; h < MAXG; h++) {
    m.push([]);
    for (let a = 0; a < MAXG; a++) {
      const v = Math.max(0, pois(h, lh) * pois(a, la) * tau(h, a, lh, la, rho));
      m[h].push(v);
      s += v;
    }
  }
  for (let h = 0; h < MAXG; h++) for (let a = 0; a < MAXG; a++) m[h][a] /= s;
  return m;
}

export interface MatrixSummary {
  home: number; draw: number; away: number; btts: number;
  overLine: (line: number) => number;
  homeOver: (line: number) => number;
  awayOver: (line: number) => number;
}

export function summarizeMatrix(m: number[][]): MatrixSummary {
  let home = 0, draw = 0, away = 0, btts = 0;
  const totalGoals: number[] = new Array(2 * MAXG).fill(0);
  const homeGoals: number[] = new Array(MAXG).fill(0);
  const awayGoals: number[] = new Array(MAXG).fill(0);
  for (let h = 0; h < MAXG; h++)
    for (let a = 0; a < MAXG; a++) {
      const p = m[h][a];
      if (h > a) home += p; else if (h === a) draw += p; else away += p;
      if (h > 0 && a > 0) btts += p;
      totalGoals[h + a] += p;
      homeGoals[h] += p;
      awayGoals[a] += p;
    }
  const gt = (arr: number[], line: number) =>
    arr.reduce((acc, p, g) => acc + (g > line ? p : 0), 0);
  return {
    home, draw, away, btts,
    overLine: (l) => gt(totalGoals, l),
    homeOver: (l) => gt(homeGoals, l),
    awayOver: (l) => gt(awayGoals, l),
  };
}

function oneX2FromLambdas(lh: number, la: number) {
  const s = summarizeMatrix(buildScoreMatrix(lh, la));
  return { home: s.home, draw: s.draw, away: s.away, over2: s.overLine(2.5) };
}

/**
 * Two-stage Reverse-Poisson fit — numerically stable nested bisection.
 *  Outer: solve total goals volume T from the DRAW target (draw is monotone
 *         decreasing in T for a fixed home/away split).
 *  Inner: solve the home/away split from the (home − away) difference target
 *         (monotone increasing in the split share s).
 *  Stage 2 (optional): scale the volume to hit the O2.5 target, preserving the
 *  ratio. Every step is a monotone 1-D root solve — never explodes.
 */
export function fitLambdas(target: { home: number; draw: number; away: number; over2?: number }): { lh: number; la: number } {
  const tDiff = Math.max(-0.9, Math.min(0.9, target.home - target.away));
  const tDraw = Math.max(0.03, Math.min(0.5, target.draw));
  let loT = 0.15, hiT = 5.0;
  let s = 0.5;
  for (let i = 0; i < 26; i++) {
    const T = (loT + hiT) / 2;
    let loS = 0.03, hiS = 0.97;
    for (let j = 0; j < 22; j++) {
      const sj = (loS + hiS) / 2;
      const m = oneX2FromLambdas(T * sj, T * (1 - sj));
      if (m.home - m.away < tDiff) loS = sj;
      else hiS = sj;
    }
    s = (loS + hiS) / 2;
    const m = oneX2FromLambdas(T * s, T * (1 - s));
    if (m.draw > tDraw) loT = T;
    else hiT = T;
  }
  const T = (loT + hiT) / 2;
  let lh = Math.min(3.6, Math.max(0.08, T * s));
  let la = Math.min(3.6, Math.max(0.08, T * (1 - s)));
  if (typeof target.over2 === "number" && target.over2 > 0.02 && target.over2 < 0.98) {
    let loK = 0.4, hiK = 2.2;
    for (let i = 0; i < 16; i++) {
      const k = (loK + hiK) / 2;
      const m = oneX2FromLambdas(lh * k, la * k);
      if (m.over2 < target.over2) loK = k;
      else hiK = k;
    }
    const k = (loK + hiK) / 2;
    lh = Math.min(3.8, Math.max(0.08, lh * k));
    la = Math.min(3.8, Math.max(0.08, la * k));
  }
  return { lh: round3(lh), la: round3(la) };
}

/**
 * Target resolution — the honesty core of the engine.
 * - consensus mode: market view when real odds exist, otherwise the SAME
 *   standings stats the model uses (never a neutral dummy).
 * - model mode: 65% market / 35% standings blend ONLY when BOTH a real market
 *   anchor AND real standings stats exist. Blending a neutral dummy into
 *   extreme market prices would fabricate alpha — forbidden.
 */
export function resolveTargets(
  inp: DCInput,
  statsView: { home: number; draw: number; away: number },
  statsOver2: number,
): { home: number; draw: number; away: number; over2: number } {
  const mk = inp.market1x2;
  const st = inp.hasStats ? statsView : null;
  const norm = (t: { home: number; draw: number; away: number }) => {
    const s = t.home + t.draw + t.away;
    return { home: t.home / s, draw: t.draw / s, away: t.away / s };
  };
  const over2 = inp.marketTotal?.over ?? statsOver2;
  if (inp.mode === "consensus") {
    return mk ? { ...norm(mk), over2: inp.marketTotal?.over ?? statsOver2 } : { ...norm(st ?? statsView), over2 };
  }
  if (!mk) return { ...norm(st ?? statsView), over2 };
  if (!st) return { ...norm(mk), over2 }; // no real stats → pure market, EV = -margin
  const m = norm(mk);
  const home = 0.65 * m.home + 0.35 * st.home;
  const draw = 0.65 * m.draw + 0.35 * st.draw;
  const away = 0.65 * m.away + 0.35 * st.away;
  const s = home + draw + away;
  return { home: home / s, draw: draw / s, away: away / s, over2 };
}

/** Standings → honest stats-based 1X2 + lambdas (market-independent view). */
export function stats1x2From(
  statHome: TeamLite | null, statAway: TeamLite | null, leagueAvgGoals = 1.35,
): { home: number; draw: number; away: number; lh: number; la: number } {
  const attack = (s: TeamLite | null) =>
    s && s.played > 0 ? s.goalsFor / s.played / leagueAvgGoals : 1;
  const defense = (s: TeamLite | null) =>
    s && s.played > 0 ? s.goalsAgainst / s.played / leagueAvgGoals : 1;
  const HOME_BOOST = 1.12, AWAY_DAMP = 0.94;
  const lh = Math.min(3.8, Math.max(0.25, leagueAvgGoals * attack(statHome) * defense(statAway) * HOME_BOOST));
  const la = Math.min(3.8, Math.max(0.25, leagueAvgGoals * attack(statAway) * defense(statHome) * AWAY_DAMP));
  const s = summarizeMatrix(buildScoreMatrix(lh, la));
  return { home: s.home, draw: s.draw, away: s.away, lh, la };
}

/** Asian handicap probability for half/quarter lines (with half-win/push mass). */
function ahProb(m: number[][], line: number, side: "HOME" | "AWAY"): number {
  let acc = 0;
  for (let h = 0; h < MAXG; h++)
    for (let a = 0; a < MAXG; a++) {
      const x = side === "HOME" ? h : a;
      const y = side === "HOME" ? a : h;
      const margin = x - y + line;
      const pp = m[h][a];
      if (margin > 0) acc += pp;
      else if (margin === 0 || margin === -0.5) acc += pp * 0.5;
    }
  return acc;
}

/** Full engine run: fitted matrix + every whitelisted football market prob.
 *  v3.3.2 §4.1 — `opts.lambdaScale` dampens the fitted lambdas (0.88x for
 *  defensive/low-scoring leagues) BEFORE the score matrix is built, so every
 *  downstream probability (1x2, totals ladder, shield masses) sees the
 *  dampened goal volume consistently. */
export function runDixonColes(
  inp: DCInput,
  statHome: TeamLite | null,
  statAway: TeamLite | null,
  opts?: { lambdaScale?: number },
): DCResult {
  const st = stats1x2From(statHome, statAway);
  const statsView = inp.stats1x2 ?? { home: st.home, draw: st.draw, away: st.away };
  const statsO2 = summarizeMatrix(buildScoreMatrix(st.lh, st.la)).overLine(2.5);
  const target = resolveTargets(inp, statsView, statsO2);
  const fitted = fitLambdas(target);
  const scale = opts?.lambdaScale ?? 1;
  const lh = Math.min(3.8, Math.max(0.08, fitted.lh * scale));
  const la = Math.min(3.8, Math.max(0.08, fitted.la * scale));
  const matrix = buildScoreMatrix(lh, la);
  const s = summarizeMatrix(matrix);
  const probs: Record<string, number> = {};
  const put = (k: string, v: number) =>
    (probs[k] = round3(Math.min(0.99, Math.max(0.01, v))));
  put("1x2@HOME", s.home); put("1x2@DRAW", s.draw); put("1x2@AWAY", s.away);
  put("dc_1x@YES", s.home + s.draw); put("dc_x2@YES", s.draw + s.away);
  const dnbH = s.home / (s.home + s.away);
  put("dnb@HOME", dnbH); put("dnb@AWAY", 1 - dnbH);
  put("ah_home_-0.5@HOME", ahProb(matrix, -0.5, "HOME"));
  put("ah_home_-0.75@HOME", (ahProb(matrix, -1, "HOME") + ahProb(matrix, -0.5, "HOME")) / 2);
  put("ah_home_-1.0@HOME", ahProb(matrix, -1, "HOME") + s.draw);
  put("ah_away_-0.5@AWAY", ahProb(matrix, -0.5, "AWAY"));
  put("ah_away_-0.75@AWAY", (ahProb(matrix, -1, "AWAY") + ahProb(matrix, -0.5, "AWAY")) / 2);
  put("ah_away_-1.0@AWAY", ahProb(matrix, -1, "AWAY") + s.draw);
  for (const l of [1.5, 2.5, 3.5]) {
    put(`ou_${l}@OVER`, s.overLine(l));
    put(`ou_${l}@UNDER`, 1 - s.overLine(l));
  }
  put("btts@YES", s.btts); put("btts@NO", 1 - s.btts);
  put("tt_home_o1.5@OVER", s.homeOver(1.5));
  put("tt_away_o1.5@OVER", s.awayOver(1.5));
  put("combo_1x_u3.5@YES", (s.home + s.draw) * (1 - s.overLine(3.5)));
  put("combo_home_o1.5@YES", s.home * s.homeOver(1.5));
  return { lambdaHome: lh, lambdaAway: la, matrix, probs };
}

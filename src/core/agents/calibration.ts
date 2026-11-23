/**
 * NeoBet Quant Pro v3.1 — SuperAgent 3: Outcome & Calibration Scientist
 * Tracks Pure Win Rate + No-Loss Rate, computes Brier Score, Log-Loss,
 * ECE & Reliability Bins, auto-tunes ensemble weights + Platt scaling (a, b)
 * and audits the Shadow Ledger → Shadow Win-Rate Lift %.
 *
 * Pure functions over settled rows + shadow vetoes — deterministic, no timers,
 * safe to call on every bootstrap (≤400 rows, microsecond math).
 */

export interface CalibrationRow {
  /** Model no-loss probability at lock time (winProb + pushProb). */
  modelProb: number;
  /** Optional sharp-market probability at lock time (de-vigged). */
  trueProb?: number | null;
  status: "WON" | "LOST" | "VOID";
  stake: number;
  netProfit: number;
  sport: string;
  tier?: string | null;
}

export interface ReliabilityBin {
  binStart: number; // e.g. 0.6
  binEnd: number;   // e.g. 0.7
  count: number;
  avgPredicted: number; // mean predicted prob in bin
  avgOutcome: number;   // empirical win rate in bin (WON = 1)
}

export interface CalibrationMetrics {
  brier: number;          // mean (p − outcome)² over decided rows — lower is better
  logLoss: number;        // mean −[y·ln(p) + (1−y)·ln(1−p)] over decided rows
  ece: number;            // expected calibration error (0..1, lower is better)
  reliabilityBins: ReliabilityBin[];
  pureWinRate: number;    // WON / decided
  noLossRate: number;     // (WON + VOID) / total settled — the shield metric
  decidedCount: number;
  settledCount: number;
}

export interface PlattParams {
  a: number;
  b: number;
  trainedOn: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const safeLogit = (p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Outcome label: WON → 1, LOST → 0, VOID → excluded from scoring. */
function outcomeY(status: CalibrationRow["status"]): number | null {
  if (status === "WON") return 1;
  if (status === "LOST") return 0;
  return null;
}

/** Brier + LogLoss + ECE + 10 reliability bins over decided rows. */
export function computeCalibration(rows: CalibrationRow[]): CalibrationMetrics {
  const decided = rows.filter((r) => outcomeY(r.status) !== null);
  const settled = rows.length;
  const wins = rows.filter((r) => r.status === "WON").length;
  const voids = rows.filter((r) => r.status === "VOID").length;

  if (decided.length === 0) {
    return {
      brier: 0, logLoss: 0, ece: 0, reliabilityBins: [],
      pureWinRate: 0, noLossRate: settled > 0 ? (wins + voids) / settled : 0,
      decidedCount: 0, settledCount: settled,
    };
  }

  let brierSum = 0;
  let logLossSum = 0;
  const bins: ReliabilityBin[] = Array.from({ length: 10 }, (_, i) => ({
    binStart: i / 10,
    binEnd: (i + 1) / 10,
    count: 0,
    avgPredicted: 0,
    avgOutcome: 0,
  }));

  for (const r of decided) {
    const y = outcomeY(r.status)!;
    const p = clamp01(r.modelProb);
    brierSum += (p - y) ** 2;
    const q = Math.min(0.9999, Math.max(0.0001, p));
    logLossSum += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
    const idx = Math.min(9, Math.max(0, Math.floor(p * 10)));
    bins[idx].count += 1;
    bins[idx].avgPredicted += p;
    bins[idx].avgOutcome += y;
  }

  const reliabilityBins = bins
    .map((b) => ({
      ...b,
      avgPredicted: b.count > 0 ? b.avgPredicted / b.count : (b.binStart + b.binEnd) / 2,
      avgOutcome: b.count > 0 ? b.avgOutcome / b.count : 0,
    }))
    .filter((b) => b.count > 0);

  // ECE = Σ (n_b / N) · |acc_b − conf_b|
  const ece = reliabilityBins.reduce(
    (acc, b) => acc + (b.count / decided.length) * Math.abs(b.avgOutcome - b.avgPredicted),
    0,
  );

  return {
    brier: brierSum / decided.length,
    logLoss: logLossSum / decided.length,
    ece,
    reliabilityBins,
    pureWinRate: wins / decided.length,
    noLossRate: settled > 0 ? (wins + voids) / settled : 0,
    decidedCount: decided.length,
    settledCount: settled,
  };
}

/**
 * Platt scaling — logistic regression of outcome on logit(p).
 * Deterministic gradient descent (600 iters, lr 0.08 with decay).
 * Returns calibrated(p) = sigmoid(a·logit(p) + b) so SuperAgent 3 can
 * re-map the ensemble probability before tier assignment.
 */
export function trainPlatt(rows: CalibrationRow[]): PlattParams {
  const decided = rows.filter((r) => outcomeY(r.status) !== null);
  if (decided.length < 12) return { a: 1, b: 0, trainedOn: decided.length };

  const xs = decided.map((r) => safeLogit(clamp01(r.modelProb)));
  const ys = decided.map((r) => outcomeY(r.status)!);
  let a = 1;
  let b = 0;
  const lr0 = 0.08;
  for (let it = 0; it < 600; it++) {
    const lr = lr0 / (1 + it * 0.005);
    let ga = 0;
    let gb = 0;
    for (let i = 0; i < xs.length; i++) {
      const p = sigmoid(a * xs[i] + b);
      const err = p - ys[i];
      ga += err * xs[i];
      gb += err;
    }
    a -= (lr * ga) / xs.length;
    b -= (lr * gb) / xs.length;
    // Stability guard — bounded Platt maps keep calibration honest.
    a = Math.min(4, Math.max(0.1, a));
    b = Math.min(3, Math.max(-3, b));
  }
  return { a, b, trainedOn: decided.length };
}

export function applyPlatt(p: number, platt: PlattParams): number {
  if (platt.trainedOn < 12) return clamp01(p);
  return clamp01(sigmoid(platt.a * safeLogit(clamp01(p)) + platt.b));
}

export interface StreakInfo {
  streak: number;      // current consecutive WON (0 when last row is not WON)
  lastStatuses: Array<"WON" | "LOST" | "VOID">; // most recent first, max 8
}

/** Current win streak over decided rows. Caller passes rows NEWEST-FIRST. */
export function computeWinStreak(rows: CalibrationRow[]): StreakInfo {
  const decided = rows.filter((r) => outcomeY(r.status) !== null);
  let streak = 0;
  const lastStatuses: Array<"WON" | "LOST" | "VOID"> = [];
  for (const r of decided.slice(0, 8)) {
    lastStatuses.push(r.status);
  }
  for (const r of decided) {
    if (r.status === "WON") streak++;
    else break;
  }
  return { streak, lastStatuses };
}

export interface ShadowAudit {
  savedLossCount: number;
  savedLossUnits: number;
  missedWinCount: number;
  missedWinUnits: number;
  /** Win-rate the ledger would show had vetoed picks been taken. */
  winRateWithoutVeto: number;
  /** Real win rate with vetoes active. */
  winRateWithVeto: number;
  /** Shadow Win-Rate Lift % (pp gained by the veto policy). */
  shadowLiftPct: number;
}

export interface VetoRowLite {
  verdict?: string | null;   // SAVED_LOSS | MISSED_WIN | PENDING | UNKNOWN
  savedUnits?: number | null;
}

/** Shadow Ledger audit — the exact "SAVED LOSS / MISSED WIN" economics. */
export function auditShadowLedger(
  settledRows: CalibrationRow[],
  vetoes: VetoRowLite[],
): ShadowAudit {
  const decided = settledRows.filter((r) => outcomeY(r.status) !== null);
  const saved = vetoes.filter((v) => v.verdict === "SAVED_LOSS");
  const missed = vetoes.filter((v) => v.verdict === "MISSED_WIN");
  const savedLossUnits = saved.reduce((a, v) => a + Math.max(0, v.savedUnits ?? 0), 0);
  const missedWinUnits = missed.reduce((a, v) => a + Math.abs(Math.min(0, v.savedUnits ?? 0)), 0);
  const wins = decided.filter((r) => r.status === "WON").length;
  const winRateWithVeto = decided.length > 0 ? wins / decided.length : 0;
  const totalPicks = decided.length + missed.length;
  const winRateWithoutVeto = totalPicks > 0 ? (wins + missed.length) / totalPicks : 0;
  const shadowLiftPct = (winRateWithVeto - winRateWithoutVeto) * 100;
  return {
    savedLossCount: saved.length,
    savedLossUnits,
    missedWinCount: missed.length,
    missedWinUnits,
    winRateWithoutVeto,
    winRateWithVeto,
    shadowLiftPct,
  };
}

export interface EnsembleWeights {
  wQuant: number;
  wCoach: number;
  wMarket: number;
  marketAvailable: boolean;
  platt: PlattParams;
}

/**
 * Adaptive blending weights per the v3.1 spec:
 *  - sharp prior available → 0.50 · Quant + 0.30 · Coach + 0.20 · SharpPrior
 *  - prior absent → 0.65 · Quant + 0.35 · Coach (market weight = 0)
 * ECE-aware damping: a badly calibrated quant view (>0.12 ECE) shifts 0.05
 * toward the coach — deterministic, auditable.
 */
export function computeEnsembleWeights(
  calibration: CalibrationMetrics,
  marketAvailable: boolean,
  platt: PlattParams,
): EnsembleWeights {
  let wQuant = marketAvailable ? 0.5 : 0.65;
  let wCoach = marketAvailable ? 0.3 : 0.35;
  const wMarket = marketAvailable ? 0.2 : 0;
  if (calibration.decidedCount >= 30 && calibration.ece > 0.12) {
    wQuant -= 0.05;
    wCoach += 0.05;
  }
  return { wQuant, wCoach, wMarket, marketAvailable, platt };
}

/**
 * v3.3 §3.2 — Calibration Scientist league auto-veto (HARD GATE).
 * No league may enter `autoVetoLeagues` unless it holds AT LEAST 12 settled
 * matches AND a win rate below 62%. This replaces the old aggressive
 * loss-share heuristic that caused the −6.9pp shadow lift (31 missed wins
 * vs 20 saved losses): small samples can never veto again.
 */
export interface LeagueSettledRow {
  league: string;
  status: "WON" | "LOST" | "VOID";
}

export const AUTO_VETO_MIN_SETTLED = 12;
export const AUTO_VETO_MAX_WIN_RATE = 0.62;

export function computeAutoVetoLeagues(
  rows: LeagueSettledRow[],
  minSettled: number = AUTO_VETO_MIN_SETTLED,
  maxWinRate: number = AUTO_VETO_MAX_WIN_RATE,
): Array<{ league: string; settled: number; winRatePct: number }> {
  const byLeague = new Map<string, { settled: number; wins: number }>();
  for (const r of rows) {
    if (!r.league) continue;
    const e = byLeague.get(r.league) ?? { settled: 0, wins: 0 };
    if (r.status !== "VOID") e.settled += 1;
    if (r.status === "WON") e.wins += 1;
    byLeague.set(r.league, e);
  }
  return [...byLeague.entries()]
    .filter(([, e]) => e.settled >= minSettled && e.wins / e.settled < maxWinRate)
    .map(([league, e]) => ({
      league,
      settled: e.settled,
      winRatePct: Math.round((e.wins / e.settled) * 1000) / 10,
    }))
    .sort((a, b) => a.winRatePct - b.winRatePct);
}

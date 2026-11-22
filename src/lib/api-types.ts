"use client";

/**
 * Shared client-side API contracts (types only — no server imports).
 * Mirrors src/core/pipeline/bootstrap-service.ts response shapes.
 */

export interface MasterMetrics {
  bankroll: number;
  startingBank: number;
  totalProfit: number;
  roi: number;
  winRate: number;
  maxDrawdown: number;
  wins: number;
  losses: number;
  voids: number;
  openCount: number;
  openStake: number;
  categoryProfits: {
    byLine: Record<string, number>;
    bySport: Record<string, number>;
    byLeague: Record<string, number>;
  };
  sportStats: Record<string, { wins: number; losses: number; profit: number; winRate: number; settled: number }>;
  marketStats: Record<string, { wins: number; losses: number; profit: number; winRate: number; settled: number }>;
  leagueStats: Record<string, { wins: number; losses: number; profit: number; winRate: number; settled: number }>;
  dailyPnl: Array<{ date: string; football: number; tennis: number }>;
  equityCurve: Array<{ date: string; bankroll: number; football: number; tennis: number }>;
  bankrollToday: number;
  savedCapital: number;
  savedCount: number;
}

export interface AppSignal {
  id: string;
  matchId: string;
  matchInfo: string;
  league: string;
  sport: string;
  line: string;
  marketKey: string;
  marketLabel: string;
  selection: string;
  modelProb: number;
  trueProb: number;
  price: number;
  evPct: number;
  stake: number;
  stakeMode: string;
  status: string;
  netProfit: number | null;
  shaHash: string;
  dayKey: string;
  startTime: string;
  lockedAt: string; // REAL pre-match lock timestamp
  legs?: Array<{ label: string; price: number; prob: number }> | null;
  espnUrl: string;
  settledAt: string | null;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  venue: string | null;
  surface: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface AppMatch {
  id: string;
  espnEventId: string;
  sport: "football" | "tennis";
  league: string;
  leagueCode: string;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeRank?: number | null;
  awayRank?: number | null;
  startTime: string;
  status: string;
  surface?: string | null;
  venue?: string | null;
  round?: string | null;
  scores: { home: number | null; away: number | null };
  quotes: Array<{ marketKey: string; selection: string; price: number; trueProb: number; source: string }>;
}

export interface AppVeto {
  id: string;
  signalRef: string;
  reason: string;
  category: string;
  sport: string | null;
  league: string | null;
  marketLabel: string | null;
  selection: string | null;
  price: number | null;
  modelProb: number | null;
  ftScore: string | null;
  savedUnits: number | null;
  verdict: string | null; // SAVED_LOSS | MISSED_WIN | PENDING | UNKNOWN
  decidedAt: string | null;
  createdAt: string;
}

export interface AppStatePayload {
  metrics: MasterMetrics;
  matches: AppMatch[];
  openSignals: AppSignal[];
  settledSignals: AppSignal[];
  shadowVetoes: AppVeto[];
  settings: Record<string, string>;
  health: {
    espn: boolean; oddsApi: boolean; oddsApiIo: boolean;
    lastIngest: string | null; degraded: boolean; mode?: "LIVE" | "OFFLINE";
    historySeed: string | null;
    /* v2.5 — The Odds API v4 credit shield telemetry */
    oddsApiCredits?: string | null;
    oddsApiCachedAt?: string | null;
    oddsApiSportKeys?: string[];
    oddsApiError?: string | null;
    oddsApiKeyFromEnv?: boolean;
  };
  ingestSummary: {
    matchesUpserted: number;
    signalsCreated: number;
    settledCount: number;
    accasCreated: number;
    degraded: boolean;
    notes: string[];
    ranAt: string;
  } | null;
  historySeed: HistorySeedSummary | null;
  generatedAt: string;
}

export interface HistorySeedSummary {
  skipped: boolean;
  fixturesFetched: number;
  matchesUpserted: number;
  signalsSeeded: number;
  won: number;
  lost: number;
  void: number;
  accas: number;
  vetoes: number;
  posters: number;
  notes: string[];
  seededAt: string;
}

export interface IngestSummary {
  matchesUpserted: number;
  quotesUpserted: number;
  signalsCreated: number;
  settledCount: number;
  accasCreated: number;
  degraded: boolean;
  notes: string[];
  ranAt: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  description: string;
  published: string;
  link: string;
  image: string | null;
  source: string;
}

export interface ScheduleSlot {
  id: string;
  slotTitle: string;
  time: string;
  channel: "PUBLIC" | "VIP";
  kind: "RADAR" | "SIGNAL" | "EDUCATION" | "NEWS" | "REPORT";
  enabled: boolean;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const fmtUnits = (n: number, d = 1) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtPrice = (n: number) => n.toFixed(2);

export const lineLabel = (line: string): string =>
  ({
    SINGLE_EV: "تک‌شرط ارزش عمیق",
    ACCA2: "میکس ۲ تایی هوشمند",
    ARB: "آربیتراژ دو بوک‌میکر",
  })[line] ?? line;

export const statusColor = (status: string): string =>
  ({
    WON: "text-emerald-400",
    LOST: "text-red-400",
    VOID: "text-slate-400",
    OPEN: "text-amber-300",
  })[status] ?? "text-slate-300";

/** Safe readable date — NEVER renders 0000/0/00; invalid/zero values → "—". */
export function fmtDateTimeFa(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime()) || d.getFullYear() < 2020) return "—";
  try {
    // v2.7 — Latin (en-GB) date/time with Tehran timezone. Persian-calendar
    // digits printed `0000/00/00`-class glitches on some browser stacks;
    // the Latin format is stable on every engine, forever.
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tehran",
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    }).format(d);
  } catch {
    return "—";
  }
}

/** Live clock formatting (24h, locale-stable, used by the header/footer). */
export function fmtClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

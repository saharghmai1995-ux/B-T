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
  equityCurve: Array<{ date: string; bankroll: number }>;
  bankrollToday: number;
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
  price: number;
  evPct: number;
  stake: number;
  stakeMode: string;
  status: string;
  netProfit: number | null;
  shaHash: string;
  dayKey: string;
  startTime: string;
  legs?: Array<{ label: string; price: number; prob: number }> | null;
  espnUrl: string;
  settledAt: string | null;
}

export interface AppMatch {
  id: string;
  espnEventId: string;
  sport: "football" | "tennis";
  league: string;
  leagueCode: string;
  homeName: string;
  awayName: string;
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

export interface AppStatePayload {
  metrics: MasterMetrics;
  matches: AppMatch[];
  openSignals: AppSignal[];
  settledSignals: AppSignal[];
  shadowVetoes: Array<{ id: string; signalRef: string; reason: string; createdAt: string }>;
  settings: Record<string, string>;
  health: { espn: boolean; oddsApi: boolean; lastIngest: string | null; degraded: boolean; historySeed: string | null };
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

export const marketLabelFa = (key: string): string =>
  ({
    "1x2": "نتیجه نهایی",
    dc_1x: "شانس دوبل 1X",
    dc_x2: "شانس دوبل X2",
    dnb: "برگشت مساوی",
    btts: "گلزنی هر دو تیم",
    "ou_1.5": "گل کل ۱.۵",
    "ou_2.5": "گل کل ۲.۵",
    "ou_3.5": "گل کل ۳.۵",
    "tt_home_o1.5": "گل میزبان ۱.۵+",
    "tt_away_o1.5": "گل مهمان ۱.۵+",
    "combo_1x_u3.5": "کمبو 1X و زیر ۳.۵",
    "combo_home_o1.5": "کمبو برد میزبان و ۱.۵+",
    winner: "برنده مسابقه",
    setbet_2_0: "نتیجه ست ۲-۰",
    setbet_2_1: "نتیجه ست ۲-۱",
    "tot_sets_o2.5": "ست کل ۲.۵+",
    "tot_games_o20.5": "گیم کل ۲۰.۵+",
    "tot_games_o21.5": "گیم کل ۲۱.۵+",
    "tot_games_o22.5": "گیم کل ۲۲.۵+",
    acca2: "میکس ۲ پایه",
  })[key] ?? key;

export const selectionLabel = (s: string): string =>
  ({
    HOME: "میزبان",
    AWAY: "مهمان",
    DRAW: "مساوی",
    OVER: "بالای خط",
    UNDER: "زیر خط",
    YES: "بله",
    NO: "خیر",
    ACCA: "ترکیب ۲ پایه",
  })[s] ?? s;

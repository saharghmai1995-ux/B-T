/**
 * NeoBet Quant Pro — shared server-side domain types.
 * Single vocabulary used by engines, ledger, pipeline and API responses.
 */

export type Sport = "football" | "tennis";
export type ProductionLine = "SINGLE_EV" | "ACCA2" | "ARB";
export type SignalStatus = "OPEN" | "WON" | "LOST" | "VOID";
export type PriceSource = "LIVE_REF" | "ESTIMATE";

/** A priced market selection stored in the odds store. */
export interface QuoteRow {
  matchId: string;
  bookmaker: string; // ESPN_DK_REF | 1XBET_EST | 1XBET_LIVE | BETFORWARD_EST
  marketKey: string;
  selection: string;
  price: number;
  trueProb: number;
  source: PriceSource;
}

/** Fixture-level model view handed to selectors. */
export interface MatchContext {
  id: string;
  sport: Sport;
  league: string;
  leagueCode: string;
  homeName: string;
  awayName: string;
  homeRank?: number | null;
  awayRank?: number | null;
  startTime: Date;
  status: string;
  surface?: string | null;
  venue?: string | null;
  round?: string | null;
}

/** Stat pack used by engines (from ESPN standings / scoreboard records). */
export interface TeamStat {
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  form?: string; // e.g. "DLWLW"
}

/** Market probability snapshot produced by engines. */
export interface MarketProb {
  marketKey: string;
  selection: string;
  modelProb: number;
  trueProb: number; // market consensus probability
}

/** A candidate signal produced by a selector before ledger locking. */
export interface CandidateSignal {
  match: MatchContext;
  line: ProductionLine;
  marketKey: string;
  marketLabel: string;
  selection: string;
  modelProb: number;
  trueProb: number;
  price: number;
  evPct: number;
  stake: number;
  stakeMode: "FLAT_100" | "KELLY_025";
  legs?: Array<{ label: string; price: number; prob: number }>;
  arbBooks?: Array<{ book: string; selection: string; price: number }>;
}

/** Settled row vocabulary used by the ledger service. */
export interface SettledRow {
  id: string;
  sport: string;
  league: string;
  line: string;
  marketKey: string;
  marketLabel: string;
  selection: string;
  status: SignalStatus;
  netProfit: number;
  stake: number;
  price: number;
  evPct: number;
  settledAt: Date | null;
  matchInfo: string;
}

/** Master metrics — the ONLY source of header/table/chart numbers. */
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

/** Feed payload produced by bookmakers/odds-feed (network boundary). */
export interface FeedMatch {
  espnEventId: string;
  sport: Sport;
  league: string;
  leagueCode: string;
  homeName: string;
  awayName: string;
  homeRank?: number | null;
  awayRank?: number | null;
  startTime: Date;
  status: string;
  homeScore?: number | null;
  awayScore?: number | null;
  detail?: string | null;
  surface?: string | null;
  round?: string | null;
  venue?: string | null;
  retired?: boolean | null;
  refOdds?: {
    home?: number; // decimal prices from the reference market (ESPN provider)
    draw?: number;
    away?: number;
    over?: number;
    under?: number;
    totalLine?: number;
  } | null;
  playerEloHint?: Array<{ name: string; rank: number | null }> | null;
}

export interface FeedPack {
  fetchedAt: Date;
  football: FeedMatch[];
  tennis: FeedMatch[];
  degraded: boolean; // true when network partially failed
  notes: string[];
}

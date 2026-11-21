/**
 * SIM Feed — deterministic offline fallback feed (server-only).
 *
 * When the real ESPN network boundary is unreachable (geo-blocks, sanctions,
 * firewalls, total outage), the dashboard would cold-start COMPLETELY EMPTY:
 * zero matches, zero signals, zero ledger history. This module guarantees the
 * platform stays fully operable by generating a deterministic, reproducible
 * simulation pack shaped exactly like the real FeedMatch vocabulary.
 *
 * Honesty rules:
 *  - Every SIM row carries espnEventId prefix "sim-" and is stored with
 *    Match.source = "SIM" — never mixed up with real ESPN rows.
 *  - The UI labels the app state as "SIM mode" whenever the last ingest ran
 *    degraded, so simulated data is never presented as live market data.
 *  - Scores, standings and reference prices are produced by the SAME margin
 *    math as the live book (de-vig friendly, overround ~5.5%).
 *  - Deterministic PRNG (hash-seeded mulberry32): same day -> same pack, so
 *    snapshots, screenshots and shares are stable.
 */

import type { FeedMatch, TeamStat } from "@/core/types";
import { LEAGUE_NAMES } from "@/core/bookmakers/odds-feed";

/** Force the SIM feed regardless of network reachability (demo/offline mode). */
export const SIM_FORCED = process.env.BET_SIM_FORCE === "1";

/** Deterministic PRNG from a string seed (fixture-stable). */
export function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** Seedable PRNG in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth Poisson sampler for goal counts. */
function poisson(rng: () => number, lambda: number): number {
  const L = Math.exp(-Math.max(0.05, lambda));
  let k = 0;
  let p = 1;
  do { k++; p *= rng(); } while (p > L && k < 12);
  return k - 1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 10 monitored leagues (all non-blacklisted, display names from the live map). */
export const SIM_LEAGUES = [
  "eng.1", "esp.1", "ita.1", "ger.1", "fra.1",
  "ned.1", "por.1", "bra.1", "mex.1", "bel.1",
] as const;

const SIM_TEAMS: Record<string, string[]> = {
  "eng.1": ["Arsenal", "Manchester City", "Liverpool", "Chelsea", "Tottenham", "Manchester United", "Newcastle United", "Aston Villa", "Brighton", "West Ham United"],
  "esp.1": ["Real Madrid", "FC Barcelona", "Atletico Madrid", "Athletic Bilbao", "Real Sociedad", "Villarreal", "Real Betis", "Sevilla", "Valencia", "Girona"],
  "ita.1": ["Inter Milan", "Juventus", "AC Milan", "Napoli", "Atalanta", "AS Roma", "Lazio", "Fiorentina", "Bologna", "Torino"],
  "ger.1": ["Bayern Munich", "Bayer Leverkusen", "RB Leipzig", "Borussia Dortmund", "VfB Stuttgart", "Eintracht Frankfurt", "TSG Hoffenheim", "SC Freiburg", "VfL Wolfsburg", "Union Berlin"],
  "fra.1": ["Paris Saint-Germain", "AS Monaco", "Marseille", "Lille", "Olympique Lyonnais", "Nice", "Lens", "Rennes", "Toulouse", "Stade de Reims"],
  "ned.1": ["Ajax", "PSV Eindhoven", "Feyenoord", "AZ Alkmaar", "FC Twente", "FC Utrecht", "Heerenveen", "NEC Nijmegen", "Sparta Rotterdam", "Go Ahead Eagles"],
  "por.1": ["Benfica", "FC Porto", "Sporting CP", "SC Braga", "Vitoria Guimaraes", "Famalicao", "Boavista", "Estoril", "Rio Ave", "Gil Vicente"],
  "bra.1": ["Flamengo", "Palmeiras", "Botafogo", "Gremio", "Internacional", "Sao Paulo", "Corinthians", "Fluminense", "Athletico Paranaense", "Cruzeiro"],
  "mex.1": ["Club America", "Chivas Guadalajara", "Cruz Azul", "Pumas UNAM", "Tigres UANL", "Monterrey", "Toluca", "Pachuca", "Club Leon", "Santos Laguna"],
  "bel.1": ["Club Brugge", "Anderlecht", "Union Saint-Gilloise", "Genk", "Royal Antwerp", "Gent", "Standard Liege", "KV Mechelen", "Cercle Brugge", "OH Leuven"],
};

const ATP_EVENT = { name: "ATP · Metz Open", surface: "Hard", venue: "Metz, France" };
const WTA_EVENT = { name: "WTA · Jiujiang Open", surface: "Hard", venue: "Jiujiang, China" };

const ATP_PLAYERS = [
  "Jannik Sinner", "Carlos Alcaraz", "Novak Djokovic", "Daniil Medvedev", "Alexander Zverev",
  "Andrey Rublev", "Taylor Fritz", "Holger Rune", "Alex de Minaur", "Hubert Hurkacz",
  "Stefanos Tsitsipas", "Casper Ruud",
];
const WTA_PLAYERS = [
  "Iga Swiatek", "Aryna Sabalenka", "Coco Gauff", "Elena Rybakina", "Jessica Pegula",
  "Ons Jabeur", "Zheng Qinwen", "Maria Sakkari", "Marketa Vondrousova", "Barbora Krejcikova",
  "Jasmine Paolini", "Caroline Garcia",
];

/** Deterministic team strength in [0.15, 0.85]. */
function strength(name: string): number {
  return 0.15 + 0.7 * ((hashSeed(`sim-strength:${name}`) % 1000) / 1000);
}

/** Simulated season table for a league (played/drawn consistent, goals sane). */
export function simStandingsFor(leagueCode: string): TeamStat[] {
  const teams = SIM_TEAMS[leagueCode];
  if (!teams) return [];
  return teams.map((name) => {
    const s = strength(name);
    const played = 14;
    const won = Math.max(1, Math.min(11, Math.round(s * 11)));
    const drawn = Math.max(1, Math.min(6, Math.round(5 - Math.abs(s - 0.5) * 6)));
    const lost = Math.max(0, played - won - drawn);
    const goalsFor = Math.round(s * 26) + 9;
    const goalsAgainst = Math.round((1 - s) * 20) + 10;
    return { name, played, won, drawn, lost, goalsFor, goalsAgainst };
  });
}

/** Standings map for every monitored SIM league. */
export function simStandings(): Record<string, TeamStat[]> {
  const out: Record<string, TeamStat[]> = {};
  for (const lg of SIM_LEAGUES) out[lg] = simStandingsFor(lg);
  return out;
}

/** Honest book prices from probabilities with a 5.5% overround on 1X2. */
function priceFromProb(p: number, margin = 1.055): number {
  return round2(Math.max(1.01, 1 / Math.max(0.02, p * margin)));
}

/** Reference 1X2 + O/U 2.5 market derived from the simulated lambdas. */
function simRefOdds(rng: () => number, lambdaHome: number, lambdaAway: number): FeedMatch["refOdds"] {
  const lambdaT = lambdaHome + lambdaAway;
  const pDraw = Math.min(0.34, Math.max(0.14, 0.27 - 0.09 * Math.abs(lambdaHome - lambdaAway)));
  const skew = Math.pow(lambdaHome / Math.max(0.2, lambdaT), 1.45);
  const pHome = (1 - pDraw) * Math.min(0.92, Math.max(0.08, skew));
  const pAway = Math.max(0.05, 1 - pDraw - pHome);
  const pOver = Math.min(0.7, Math.max(0.3, 0.4 + 0.18 * (lambdaT - 2.6) + 0.05 * (rng() - 0.5)));
  return {
    home: priceFromProb(pHome),
    draw: priceFromProb(pDraw),
    away: priceFromProb(pAway),
    over: priceFromProb(pOver, 1.05),
    under: priceFromProb(1 - pOver, 1.05),
    totalLine: 2.5,
  };
}

const KICKOFF_HOURS_UTC = [11.5, 13, 15, 17, 18.75, 20, 21.75];

function kickoffAt(dayStart: Date, slot: number): Date {
  const h = KICKOFF_HOURS_UTC[slot % KICKOFF_HOURS_UTC.length];
  return new Date(dayStart.getTime() + Math.round(h * 3600_000));
}

const compact = (d: Date): string => d.toISOString().slice(0, 10).replaceAll("-", "");

/** Final score for a simulated fixture (history/settlement). */
function simScore(rng: () => number, sh: number, sa: number): { home: number; away: number } {
  const lambdaHome = Math.min(2.9, Math.max(0.3, 0.95 + 1.2 * sh - 0.55 * sa + 0.22));
  const lambdaAway = Math.min(2.9, Math.max(0.3, 0.7 + 1.05 * sa - 0.5 * sh));
  return { home: poisson(rng, lambdaHome), away: poisson(rng, lambdaAway) };
}

/**
 * SIM football fixtures for ONE calendar day.
 * offset 0 -> mixed post/in/pre (live-day texture), offsets 1..3 -> pre,
 * offsets < 0 -> post with final scores (history).
 */
function simFootballDay(dayStart: Date, offset: number): FeedMatch[] {
  const dateTag = compact(dayStart);
  const out: FeedMatch[] = [];
  for (const lg of SIM_LEAGUES) {
    const rng = mulberry32(hashSeed(`sim-fb:${dateTag}:${lg}`));
    const teams = SIM_TEAMS[lg];
    // deterministic rotation of the pairing wheel per league-day
    const rot = hashSeed(`sim-rot:${lg}:${dateTag}`) % teams.length;
    for (let i = 0; i < 2; i++) {
      const home = teams[(rot + i * 3) % teams.length];
      const away = teams[(rot + i * 3 + 2 + i) % teams.length];
      if (home === away) continue;
      const sh = strength(home);
      const sa = strength(away);
      const slot = (hashSeed(`sim-slot:${lg}:${i}:${dateTag}`) % KICKOFF_HOURS_UTC.length);
      const startTime = kickoffAt(dayStart, slot);
      const id = `sim-fb-${dateTag}-${lg}-${i}`;
      let status = "pre";
      let homeScore: number | null = null;
      let awayScore: number | null = null;
      const now = Date.now();
      const isPast = startTime.getTime() + 105 * 60_000 < now;
      const isLive = !isPast && startTime.getTime() < now;
      if (offset < 0 || isPast) {
        status = "post";
        const s = simScore(rng, sh, sa);
        homeScore = s.home;
        awayScore = s.away;
      } else if (isLive && i === 0) {
        status = "in";
        const s = simScore(rng, sh, sa);
        homeScore = Math.min(s.home, 1);
        awayScore = Math.min(s.away, 1);
      }
      out.push({
        espnEventId: id,
        sport: "football",
        league: LEAGUE_NAMES[lg] ?? lg,
        leagueCode: lg,
        homeName: home,
        awayName: away,
        startTime,
        status,
        homeScore,
        awayScore,
        round: `Matchday ${(hashSeed(id) % 12) + 14}`,
        venue: `${home} Arena`,
        refOdds: simRefOdds(rng, sh, sa),
      });
    }
  }
  return out;
}

/** SIM tennis fixtures for one day (ATP + WTA singles). */
function simTennisDay(dayStart: Date, offset: number): FeedMatch[] {
  const dateTag = compact(dayStart);
  const out: FeedMatch[] = [];
  const tours = [
    { tour: "atp" as const, players: ATP_PLAYERS, ev: ATP_EVENT },
    { tour: "wta" as const, players: WTA_PLAYERS, ev: WTA_EVENT },
  ];
  for (const { tour, players, ev } of tours) {
    const rng = mulberry32(hashSeed(`sim-tn:${dateTag}:${tour}`));
    const rot = hashSeed(`sim-tn-rot:${tour}:${dateTag}`) % players.length;
    for (let i = 0; i < 3; i++) {
      const a = players[(rot + i * 2) % players.length];
      const b = players[(rot + i * 2 + 5) % players.length];
      if (a === b) continue;
      const startTime = kickoffAt(dayStart, (i * 2 + 1) % KICKOFF_HOURS_UTC.length);
      const id = `sim-tn-${dateTag}-${tour}-${i}`;
      const now = Date.now();
      const isPast = startTime.getTime() + 100 * 60_000 < now;
      const rankA = 4 + (hashSeed(`rk:${a}`) % 62);
      const rankB = 4 + (hashSeed(`rk:${b}`) % 62);
      let status = "pre";
      let homeScore: number | null = null;
      let awayScore: number | null = null;
      let detail: string | null = null;
      if (offset < 0 || isPast) {
        status = "post";
        const favA = rankA <= rankB ? 0.68 : 0.42;
        const upset = rng() > favA;
        const winnerA = rankA <= rankB ? !upset : upset;
        const straight = rng() < 0.62;
        const hs = winnerA ? 2 : straight ? 0 : 1;
        const as = winnerA ? (straight ? 0 : 2) : 2;
        homeScore = hs;
        awayScore = as;
        detail = `${hs}-${as}: ${straight ? "straight sets" : "three sets"}`;
      }
      out.push({
        espnEventId: id,
        sport: "tennis",
        league: ev.name,
        leagueCode: tour,
        homeName: a,
        awayName: b,
        homeRank: rankA,
        awayRank: rankB,
        startTime,
        status,
        homeScore,
        awayScore,
        detail,
        surface: ev.surface,
        round: ev.name,
        venue: ev.venue,
      });
    }
  }
  return out;
}

const dayStartOf = (offsetDays: number): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * 86400_000);
};

/**
 * Forward pack (today .. +3d) — the SIM substitute for gatherFeed().
 * Day 0 carries post/in/pre texture; later days are pre-only markets.
 */
export function buildSimForwardPack(): { football: FeedMatch[]; tennis: FeedMatch[] } {
  const football: FeedMatch[] = [];
  const tennis: FeedMatch[] = [];
  for (const offset of [0, 1, 2, 3]) {
    football.push(...simFootballDay(dayStartOf(offset), offset));
    tennis.push(...simTennisDay(dayStartOf(offset), offset));
  }
  return { football, tennis };
}

/**
 * History pack (past 14 days, post-state only) — the SIM substitute for
 * seedHistoricalLedger's fetchHistoryPack(), with ready-made standings so the
 * model factories run with full context even offline.
 */
export function buildSimHistoryPack(): {
  football: FeedMatch[];
  tennis: FeedMatch[];
  standings: Record<string, TeamStat[]>;
} {
  const football: FeedMatch[] = [];
  const tennis: FeedMatch[] = [];
  for (const offset of [-14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1]) {
    football.push(...simFootballDay(dayStartOf(offset), offset));
    tennis.push(...simTennisDay(dayStartOf(offset), offset));
  }
  return { football, tennis, standings: simStandings() };
}

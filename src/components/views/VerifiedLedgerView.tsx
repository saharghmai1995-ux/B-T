"use client";

/**
 * View 4 — VerifiedLedgerView (v3.2 Pure Hit-Rate): SHA-256 verified settlement
 * ledger.
 *
 * v3.2 Zero-Bankroll Purge — this view is 100% bankroll-free:
 *  - Header «کارنامه تأییدشده — Pure Hit-Rate» with 4 stat tiles:
 *    Pure Win-Rate % / No-Loss Rate % / WON·PUSH·LOST counters / Brier+ECE.
 *  - The KELLY/FLAT policy toggle, the stake replay engine, the equity curve,
 *    ROI/bank/units headline chips and every unit-priced column are REMOVED.
 *  - Three bankroll-free analytic charts: cumulative Win-Rate & No-Loss-Rate
 *    trend, per-shield-type bar chart (+ per-market hit-rate list), and the
 *    Tier S/A/B accuracy comparison — all fed by lab stats with a direct
 *    settledSignals fallback.
 *  - Ledger rows are static rich rows (no expansion that references money):
 *    مسابقه | ورزش و لیگ | بازار محافظت‌شده | Tier | احتمال کالیبره % |
 *    نتیجه (WON/PUSH/LOST) | FT | تاریخ تسویه.
 *  - Shadow Tracker is count-based (no units anywhere).
 */

import { useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyState, TeamAvatar, AnimatedNumber, HashChip, TierBadge, ShieldBadge,
} from "@/components/shared/primitives";
import { fmtDateTimeFa } from "@/lib/api-types";
import { formatSafeDateTime } from "@/lib/format";
import type { AppStatePayload, AppSignal, AppVeto } from "@/lib/api-types";
import { officialBetLine } from "@/lib/markets";
import { formatStoredMarketLabel } from "@/core/bookmakers/market-aliases";
import { Search, Download, ShieldCheck, ExternalLink, ShieldAlert, TrendingUp, Layers } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ---------- helpers ---------- */

const sportGlyph = (sport: string | null): string =>
  sport === "tennis" ? "🎾" : sport === "football" ? "⚽" : sport === "basketball" ? "🏀" : "—";

/**
 * Normalize a 0–1 fraction rate to percent (defensive: values already
 * stored on a 0–100 scale pass through untouched).
 */
const pct0 = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return v <= 1 ? v * 100 : v;
};

const fmtPct = (v: number, d = 1): string => `${pct0(v).toFixed(d)}%`;

/** v3.1 — Sharp-divergence veto detector (reason carries "Sharp*" / "واگرایی"). */
const isSharpDivergence = (reason: string | null | undefined): boolean =>
  !!reason && /sharp|واگرایی/i.test(reason);

/** v3.1 — verdict → compact English tag (SAVED LOSS / MISSED WIN / PENDING / UNKNOWN). */
function verdictTag(v: AppVeto): { text: string; cls: string } {
  switch (v.verdict) {
    case "SAVED_LOSS":
      return { text: "SAVED LOSS", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
    case "MISSED_WIN":
      return { text: "MISSED WIN", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" };
    case "PENDING":
      return { text: "PENDING", cls: "border-slate-600/70 bg-slate-500/10 text-slate-300" };
    default:
      return { text: "UNKNOWN", cls: "border-slate-700/80 bg-secondary text-slate-400" };
  }
}

/** v3.1 — confidence tier display order. */
const TIER_ORDER = ["TIER_S", "TIER_A", "TIER_B"] as const;

/** v3.2 — shield-type display order + Persian humanization (chart + tables). */
const SHIELD_KEYS = ["DIRECT_WIN", "FULL_PUSH_SHIELD", "HALF_PUSH_SHIELD", "DOUBLE_OUTCOME_SHIELD"] as const;

const SHIELD_FA: Record<string, string> = {
  DIRECT_WIN: "برد مستقیم",
  FULL_PUSH_SHIELD: "سپر کامل پوش",
  HALF_PUSH_SHIELD: "نیم‌پوش",
  DOUBLE_OUTCOME_SHIELD: "سپر دو نتیجه",
};
const shieldFa = (k: string): string => SHIELD_FA[k] ?? k;

const SHIELD_BUCKETS: Record<string, string> = {
  DIRECT_WIN: "Match Winner · Set +1.5",
  FULL_PUSH_SHIELD: "Draw No Bet · Asian Total Over 2.0",
  HALF_PUSH_SHIELD: "Asian Handicap +0.25 · Asian Total Under 3.0",
  DOUBLE_OUTCOME_SHIELD: "Double Chance",
};

const TIER_FA: Record<string, string> = {
  TIER_S: "تایر S",
  TIER_A: "تایر A",
  TIER_B: "تایر B",
};
const tierFa = (k: string): string => TIER_FA[k] ?? k;

/** Hit-rate bucket (bankroll-free): wins/losses/voids + pure rates. */
interface HitBucket {
  wins: number;
  losses: number;
  voids: number;
  winRate: number;
  noLossRate: number;
  settled: number;
}

/** v3.2 fallback — group settled signals into hit-rate buckets (no lab needed). */
function groupHitStats(
  signals: AppSignal[],
  keyOf: (s: AppSignal) => string | null,
): Record<string, HitBucket> {
  const out: Record<string, HitBucket> = {};
  for (const s of signals) {
    if (s.status === "OPEN") continue;
    const k = keyOf(s);
    if (!k) continue;
    const b = (out[k] ??= { wins: 0, losses: 0, voids: 0, winRate: 0, noLossRate: 0, settled: 0 });
    b.settled++;
    if (s.status === "WON") b.wins++;
    else if (s.status === "LOST") b.losses++;
    else b.voids++;
  }
  for (const b of Object.values(out)) {
    const decided = b.wins + b.losses;
    b.winRate = decided > 0 ? b.wins / decided : 0;
    b.noLossRate = b.settled > 0 ? (b.wins + b.voids) / b.settled : 0;
  }
  return out;
}

/** Compact rate bar used by the tier cards. */
function RateBar({ label, value, tone }: { label: string; value: number; tone: "emerald" | "cyan" }) {
  const pct = Math.min(100, Math.max(0, pct0(value)));
  return (
    <div className="flex items-center gap-2">
      <span className="w-[76px] shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className={cn("h-full rounded-full", tone === "emerald" ? "bg-emerald-400" : "bg-cyan-400")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        dir="ltr"
        className={cn(
          "num w-12 shrink-0 text-left text-[10px] font-bold",
          tone === "emerald" ? "text-emerald-300" : "text-cyan-300",
        )}
      >
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

const STATUSES = [
  ["all", "همه"],
  ["WON", "برد"],
  ["LOST", "باخت"],
  ["VOID", "ابطال"],
] as const;

/** LOCAL sport chips — deliberately independent of the global store sportFilter. */
const SPORTS = [
  ["all", "همه"],
  ["football", "⚽ فوتبال"],
  ["tennis", "🎾 تنیس"],
] as const;

const RANGES = [
  ["all", "همه"],
  ["7", "۷ روز"],
  ["30", "۳۰ روز"],
] as const;

/** Settlement result badge — v3.2: WON / PUSH / LOST (no money). */
function resultBadge(status: string): { text: string; cls: string } {
  if (status === "WON") return { text: "WON", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
  if (status === "LOST") return { text: "LOST", cls: "border-red-500/40 bg-red-500/10 text-red-300" };
  return { text: "PUSH", cls: "border-slate-600/70 bg-slate-500/10 text-slate-300" };
}

export default function VerifiedLedgerView({ state }: { state: AppStatePayload }) {
  const m = state.metrics;
  const lab = state.agentLab;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "WON" | "LOST" | "VOID">("all");
  const [sport, setSport] = useState<"all" | "football" | "tennis">("all");
  const [league, setLeague] = useState("all");
  const [range, setRange] = useState<"all" | "7" | "30">("all");
  const [verify, setVerify] = useState<AppSignal | null>(null);

  /* Unique leagues from settled signals → league dropdown */
  const leagues = useMemo(
    () =>
      Array.from(new Set(state.settledSignals.map((s) => s.league).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [state.settledSignals],
  );

  /* Filtered ledger rows */
  const rows = useMemo(() => {
    let r = state.settledSignals;
    if (sport !== "all") r = r.filter((s) => s.sport === sport);
    if (status !== "all") r = r.filter((s) => s.status === status);
    if (league !== "all") r = r.filter((s) => s.league === league);
    if (range !== "all") {
      const days = Number(range);
      const cutoff = Date.now() - days * 86400_000;
      r = r.filter((s) => !!s.settledAt && new Date(s.settledAt).getTime() >= cutoff);
    }
    const t = q.trim().toLowerCase();
    if (t) {
      r = r.filter(
        (s) =>
          s.matchInfo.toLowerCase().includes(t) ||
          s.league.toLowerCase().includes(t) ||
          s.marketLabel.toLowerCase().includes(t) ||
          s.selection.toLowerCase().includes(t) ||
          s.shaHash.toLowerCase().includes(t),
      );
    }
    return r;
  }, [state.settledSignals, sport, status, league, range, q]);

  /* v3.2 header tiles — pure hit-rate numbers (lab preferred, metrics fallback) */
  const pureWinRate = lab ? pct0(lab.pureWinRate) : pct0(m.winRate);
  const noLossDenom = m.wins + m.losses + m.voids;
  const noLossRate = lab ? pct0(lab.noLossRate) : noLossDenom > 0 ? ((m.wins + m.voids) / noLossDenom) * 100 : 0;

  /* v3.1/v3.2 — cumulative Win-Rate + No-Loss Rate trend over the settled
   * history, one point per settlement (settledAt ascending) — the SAME
   * arithmetic as the Overview tab:
   *   winRate    = WON / decided(WON+LOST) so far
   *   noLossRate = (WON + VOID) / settled so far — the shield metric. */
  const trend = useMemo(() => {
    const ordered = [...state.settledSignals]
      .filter((s) => s.status !== "OPEN")
      .sort(
        (a, b) =>
          new Date(a.settledAt ?? a.lockedAt).getTime() -
          new Date(b.settledAt ?? b.lockedAt).getTime(),
      );
    let won = 0;
    let lost = 0;
    let voids = 0;
    const pts = ordered.map((s, i) => {
      if (s.status === "WON") won++;
      else if (s.status === "LOST") lost++;
      else voids++;
      const decided = won + lost;
      const settled = decided + voids;
      return {
        idx: i + 1,
        label: (s.settledAt ?? s.lockedAt).slice(5, 10),
        winRate: decided > 0 ? Math.round((won / decided) * 1000) / 10 : 0,
        noLossRate: settled > 0 ? Math.round(((won + voids) / settled) * 1000) / 10 : 0,
      };
    });
    return { pts, decided: won + lost, settled: pts.length };
  }, [state.settledSignals]);
  const lastTrend = trend.pts.length > 0 ? trend.pts[trend.pts.length - 1] : null;

  /* Per-tier + per-shield aggregates — lab stats preferred, direct fallback. */
  const tierAgg = useMemo<Record<string, HitBucket>>(
    () =>
      lab?.tierStats && Object.keys(lab.tierStats).length > 0
        ? lab.tierStats
        : groupHitStats(state.settledSignals, (s) => s.tier),
    [lab, state.settledSignals],
  );
  const shieldAgg = useMemo<Record<string, HitBucket>>(
    () =>
      lab?.shieldStats && Object.keys(lab.shieldStats).length > 0
        ? lab.shieldStats
        : groupHitStats(state.settledSignals, (s) => s.shieldType),
    [lab, state.settledSignals],
  );

  const tierRows = TIER_ORDER.map((key) => ({ key, st: tierAgg[key] as HitBucket | undefined }));
  const tierHasData = TIER_ORDER.some((k) => !!tierAgg[k]);

  /* Known shield keys first, unknown extras appended. */
  const shieldRows = useMemo(() => {
    const known = SHIELD_KEYS.filter((k) => !!shieldAgg[k]).map((k) => ({ key: k as string, st: shieldAgg[k] }));
    const extras = Object.keys(shieldAgg)
      .filter((k) => !(SHIELD_KEYS as readonly string[]).includes(k))
      .map((k) => ({ key: k, st: shieldAgg[k] }));
    return [...known, ...extras];
  }, [shieldAgg]);
  const shieldHasData = shieldRows.length > 0;

  /* Chart b data — winRate*100 vs noLossRate*100 per shield type. */
  const shieldChartData = useMemo(
    () =>
      shieldRows.map(({ key, st }) => ({
        name: shieldFa(key),
        winRate: pct0(st.winRate),
        noLossRate: pct0(st.noLossRate),
      })),
    [shieldRows],
  );

  /* Chart c data — Tier S / A / B accuracy comparison. */
  const tierChartData = useMemo(
    () =>
      TIER_ORDER.filter((k) => !!tierAgg[k]).map((k) => ({
        name: tierFa(k),
        winRate: pct0(tierAgg[k].winRate),
        noLossRate: pct0(tierAgg[k].noLossRate),
      })),
    [tierAgg],
  );

  /* «عملکرد بازارها» — top-6 markets by settled count, grouped by marketLabel. */
  const marketRows = useMemo(() => {
    const g = groupHitStats(state.settledSignals, (s) => s.marketLabel || null);
    return Object.entries(g)
      .map(([label, st]) => ({ label, ...st }))
      .sort((a, b) => b.settled - a.settled || b.wins - a.wins)
      .slice(0, 6);
  }, [state.settledSignals]);

  /* Shadow Ledger counts (v3.2 — count-based, no units). Prefer the AgentLab
   * audit; fall back to a direct scan of the veto cards. */
  const shadowFallback = useMemo(() => {
    let savedLossCount = 0;
    let missedWinCount = 0;
    for (const v of state.shadowVetoes) {
      if (v.verdict === "SAVED_LOSS") savedLossCount++;
      else if (v.verdict === "MISSED_WIN") missedWinCount++;
    }
    return { savedLossCount, missedWinCount };
  }, [state.shadowVetoes]);
  const shadowLift = lab?.shadow.shadowLiftPct ?? null;
  const withVeto = lab?.shadow.winRateWithVeto ?? 0;
  const withoutVeto = lab?.shadow.winRateWithoutVeto ?? 0;
  const savedLossCount = lab?.shadow.savedLossCount ?? shadowFallback.savedLossCount;
  const missedWinCount = lab?.shadow.missedWinCount ?? shadowFallback.missedWinCount;
  const netShadowCount = savedLossCount - missedWinCount;
  const hasLift = shadowLift != null;

  /* CSV / JSON audit export (includes lockedAt + ensemble metadata) */
  function download(kind: "csv" | "json") {
    const data = rows.map((s) => ({
      id: s.id, match: s.matchInfo, league: s.league, sport: s.sport, line: s.line,
      tier: s.tier ?? "", shieldType: s.shieldType ?? "", noLossProb: s.noLossProb ?? "",
      market: s.marketLabel, selection: s.selection, price: s.price, evPct: s.evPct,
      stake: s.stake, stakeMode: s.stakeMode, status: s.status, netProfit: s.netProfit,
      setResult: s.sport === "tennis" ? (s.setResult ?? "") : (s.homeScore != null && s.awayScore != null ? `${s.homeScore}-${s.awayScore}` : ""),
      sha256: s.shaHash, lockedAt: s.lockedAt, settledAt: s.settledAt, espn: s.espnUrl,
    }));
    const blob = kind === "json"
      ? new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      : new Blob([
          [
            "id", "match", "league", "sport", "line", "tier", "shieldType", "market", "selection", "price", "ev%",
            "stake", "stakeMode", "status", "netProfit", "setResult", "sha256", "lockedAt", "settledAt", "espn",
          ].join(","),
          "\n",
          ...data.map((d) =>
            [
              d.id, `"${d.match}"`, `"${d.league}"`, d.sport, d.line, d.tier, d.shieldType,
              `"${d.market}"`, d.selection, d.price, d.evPct, d.stake, d.stakeMode, d.status, d.netProfit,
              `"${d.setResult}"`, d.sha256, d.lockedAt, d.settledAt, d.espn,
            ].join(","),
          ),
        ], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neobet-audit-${Date.now()}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`خروجی ${kind.toUpperCase()} ممیزی دانلود شد`);
  }

  const tooltipStyle = {
    contentStyle: { background: "#0C1220", border: "1px solid #1B2537", borderRadius: 12, fontSize: 11 },
    labelStyle: { color: "#8FA3BF" },
  } as const;

  return (
    <div className="space-y-4" data-testid="ledger-view">
      {/* ── 0. v3.2 Pure Hit-Rate header — 4 stat tiles ──────────────────── */}
      <Card className="glass p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-emerald-200">
            <ShieldCheck className="size-4 text-emerald-400" />
            کارنامه تأییدشده — Pure Hit-Rate
          </h2>
          <span className="num rounded-md border border-slate-700 bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground" dir="ltr">
            {noLossDenom} settled · {m.openCount} open
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {/* Pure Win Rate % */}
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
            <div className="text-[10px] text-muted-foreground">وین‌ریت خالص (Pure Win Rate %)</div>
            <AnimatedNumber
              value={pureWinRate}
              decimals={1}
              suffix="%"
              className="mt-1 block text-2xl font-extrabold text-emerald-300"
            />
            <div className="mt-1 text-[10px] leading-4 text-muted-foreground">
              WON ÷ (WON + LOST)
            </div>
          </div>
          {/* No-Loss Rate % */}
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3">
            <div className="text-[10px] text-muted-foreground">نرخ بدون‌باخت (No-Loss Rate %)</div>
            <AnimatedNumber
              value={noLossRate}
              decimals={1}
              suffix="%"
              className="mt-1 block text-2xl font-extrabold text-cyan-300"
            />
            <div className="mt-1 text-[10px] leading-4 text-muted-foreground">
              (WON + PUSH) ÷ تسویه‌شده
            </div>
          </div>
          {/* WON / PUSH / LOST counters */}
          <div className="rounded-xl border border-slate-700/40 bg-secondary/30 p-3">
            <div className="text-[10px] text-muted-foreground">حساب کل نتایج (WON / PUSH / LOST)</div>
            <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
              <div>
                <AnimatedNumber value={m.wins} className="num block text-xl font-extrabold text-emerald-300" />
                <div className="mt-0.5 text-[9px] font-bold text-emerald-200/80">WON</div>
              </div>
              <div>
                <AnimatedNumber value={m.voids} className="num block text-xl font-extrabold text-slate-300" />
                <div className="mt-0.5 text-[9px] font-bold text-slate-400">PUSH</div>
              </div>
              <div>
                <AnimatedNumber value={m.losses} className="num block text-xl font-extrabold text-red-300" />
                <div className="mt-0.5 text-[9px] font-bold text-red-200/80">LOST</div>
              </div>
            </div>
          </div>
          {/* Brier Score + ECE */}
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-3">
            <div className="text-[10px] text-muted-foreground">امتیاز بریر (Brier Score)</div>
            {lab ? (
              <>
                <AnimatedNumber
                  value={lab.brier}
                  decimals={3}
                  className="mt-1 block text-2xl font-extrabold text-violet-300"
                />
                <div className="num mt-1 text-[10px] text-violet-200/80" dir="ltr">
                  ECE {(lab.ece * 100).toFixed(1)}%
                </div>
              </>
            ) : (
              <div className="mt-2 text-[11px] text-muted-foreground">بدون داده</div>
            )}
          </div>
        </div>
      </Card>

      {/* ── 1. Bankroll-free analytic charts ─────────────────────────────── */}
      <Card className="glass p-4" data-testid="ledger-charts">
        <h2 className="mb-3 text-sm font-bold text-cyan-200">📊 نمودارهای تحلیلی Pure Hit-Rate</h2>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {/* a) Cumulative Win-Rate + No-Loss Rate trend */}
          <div
            className="rounded-xl border border-slate-800/80 bg-secondary/20 p-3 xl:col-span-3"
            data-testid="ledger-trend-chart"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
                <TrendingUp className="size-3.5 text-emerald-400" />
                روند تجمعی Win Rate و No-Loss Rate (%)
              </span>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                  Win Rate: <span className="num font-bold" dir="ltr">{lastTrend ? lastTrend.winRate.toFixed(1) : "0.0"}%</span>
                </span>
                <span className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">
                  No-Loss Rate: <span className="num font-bold" dir="ltr">{lastTrend ? lastTrend.noLossRate.toFixed(1) : "0.0"}%</span>
                </span>
                <span className="num text-muted-foreground" dir="ltr">
                  {trend.settled} تسویه · {trend.decided} تعیین‌شده
                </span>
              </div>
            </div>
            {trend.pts.length === 0 ? (
              <EmptyState
                icon="📈"
                title="داده‌ای برای روند تجمعی ثبت نشده است"
                sub="پس از نخستین تسویه، وین‌ریت خالص و نرخ بدون‌باخت تجمعی همین‌جا رسم می‌شوند."
              />
            ) : (
              <div className="h-56" dir="ltr" style={{ filter: "drop-shadow(0 0 8px rgba(0, 229, 255, 0.12))" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend.pts} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1B2537" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#8FA3BF", fontSize: 9 }}
                      minTickGap={24}
                    />
                    <YAxis
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tick={{ fill: "#8FA3BF", fontSize: 9 }}
                      width={38}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip {...tooltipStyle} formatter={(v, n) => [`${Number(v).toFixed(1)}%`, String(n)]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                    <Line
                      type="monotone"
                      dataKey="winRate"
                      name="وین‌ریت خالص تجمعی (Win Rate = WON/تعیین‌شده)"
                      stroke="#34D399"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="noLossRate"
                      name="نرخ بدون‌باخت تجمعی (No-Loss = (WON+PUSH)/تسویه)"
                      stroke="#00E5FF"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* b) Per-shield-type performance bar chart */}
          <div className="rounded-xl border border-slate-800/80 bg-secondary/20 p-3 xl:col-span-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-200">عملکرد هر نوع سپر و بازار</span>
              <span className="text-[9px] text-muted-foreground">معادل مارکتی: DNB · AH +0.25 · دو نتیجه · توتال آسیایی</span>
            </div>
            {shieldChartData.length === 0 ? (
              <EmptyState
                icon="🛡️"
                title="آمار سپرها ثبت نشده است"
                sub="پس از تسویه سیگنال‌های سپر، وین‌ریت و نرخ بدون‌باخت هر نوع سپر همین‌جا رسم می‌شود."
              />
            ) : (
              <div className="h-52" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={shieldChartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1B2537" strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fill: "#8FA3BF", fontSize: 9 }} interval={0} />
                    <YAxis
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tick={{ fill: "#8FA3BF", fontSize: 9 }}
                      width={38}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip {...tooltipStyle} formatter={(v, n) => [`${Number(v).toFixed(1)}%`, String(n)]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                    <Bar dataKey="winRate" name="Win Rate %" fill="#34D399" radius={[4, 4, 0, 0]} maxBarSize={38} />
                    <Bar dataKey="noLossRate" name="No-Loss Rate %" fill="#00E5FF" radius={[4, 4, 0, 0]} maxBarSize={38} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* b-appendix) «عملکرد بازارها» — top-6 markets by settled count */}
          <div className="rounded-xl border border-slate-800/80 bg-secondary/20 p-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">عملکرد بازارها</div>
            {marketRows.length === 0 ? (
              <EmptyState
                icon="📋"
                title="آمار مارکتی برای نمایش نیست"
                sub="پس از تسویه سیگنال‌ها، شش بازار پرتسویه با نرخ برد و نرخ بدون‌باخت همین‌جا فهرست می‌شوند."
              />
            ) : (
              <div className="flex flex-col justify-center gap-2">
                {marketRows.map((r) => (
                  <div key={r.label} className="rounded-lg border border-slate-800/70 bg-[#0A0F1C]/50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        dir="ltr"
                        className="min-w-0 truncate text-[10px] font-bold text-slate-200"
                        title={r.label}
                      >
                        {r.label}
                      </span>
                      <span className="num shrink-0 text-[9px] text-slate-400" dir="ltr">
                        {r.settled} تسویه
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="w-8 shrink-0 text-[9px] text-emerald-300/80">برد</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-emerald-400"
                          style={{ width: `${Math.min(100, Math.max(0, pct0(r.winRate)))}%` }}
                        />
                      </div>
                      <span dir="ltr" className="num w-11 shrink-0 text-left text-[9px] font-bold text-emerald-300">
                        {pct0(r.winRate).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="w-8 shrink-0 text-[9px] text-cyan-300/80">پوش</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-cyan-400"
                          style={{ width: `${Math.min(100, Math.max(0, pct0(r.noLossRate)))}%` }}
                        />
                      </div>
                      <span dir="ltr" className="num w-11 shrink-0 text-left text-[9px] font-bold text-cyan-300">
                        {pct0(r.noLossRate).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* c) Tier S / A / B accuracy comparison */}
          <div className="rounded-xl border border-slate-800/80 bg-secondary/20 p-3 xl:col-span-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">مقایسه دقت واقعی Tier S / A / B</div>
            {tierChartData.length === 0 ? (
              <EmptyState
                icon="🏅"
                title="آمار تایرها ثبت نشده است"
                sub="پس از تسویه سیگنال‌های تایر S/A/B، دقت واقعی هر تایر همین‌جا رسم می‌شود."
              />
            ) : (
              <div className="h-52" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tierChartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1B2537" strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fill: "#8FA3BF", fontSize: 9 }} interval={0} />
                    <YAxis
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tick={{ fill: "#8FA3BF", fontSize: 9 }}
                      width={38}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <Tooltip {...tooltipStyle} formatter={(v, n) => [`${Number(v).toFixed(1)}%`, String(n)]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                    <Bar dataKey="winRate" name="Win Rate %" fill="#F5B940" radius={[4, 4, 0, 0]} maxBarSize={38} />
                    <Bar dataKey="noLossRate" name="No-Loss Rate %" fill="#8B5CF6" radius={[4, 4, 0, 0]} maxBarSize={38} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── 2. Agent Lab — per-tier & per-shield breakdown ───────────────── */}
      <Card className="glass p-4" data-testid="agentlab-breakdown">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-violet-300">
            <Layers className="size-4 text-violet-400" />
            تفکیک عملکرد تایرها و انواع سپر (SuperAgent v3.2)
          </h2>
          <span className="rounded-md border border-slate-700 bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
            وین‌ریت = WON/تعیین‌شده · نرخ بدون‌باخت = (WON+PUSH)/تسویه
          </span>
        </div>

        {/* a) Confidence tiers */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="tier-breakdown">
          {tierRows.map(({ key, st }) => (
            <div key={key} className="rounded-xl border border-slate-800/80 bg-secondary/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <TierBadge tier={key} />
                <span className="num text-[10px] text-slate-400" dir="ltr">
                  {st ? `${st.settled} settled` : "—"}
                </span>
              </div>
              {st ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                    <span className="text-emerald-300">برد <span className="num font-bold" dir="ltr">{st.wins}</span></span>
                    <span className="text-red-300">باخت <span className="num font-bold" dir="ltr">{st.losses}</span></span>
                    <span className="text-slate-400">پوش <span className="num font-bold" dir="ltr">{st.voids}</span></span>
                  </div>
                  <RateBar label="وین‌ریت خالص" value={st.winRate} tone="emerald" />
                  <RateBar label="نرخ بدون‌باخت" value={st.noLossRate} tone="cyan" />
                </div>
              ) : (
                <div className="grid h-[62px] place-items-center rounded-lg border border-dashed border-slate-700/60 bg-secondary/30 text-[11px] text-muted-foreground">
                  بدون داده
                </div>
              )}
            </div>
          ))}
        </div>
        {!tierHasData && (
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            آمار تایرها هنوز ثبت نشده است — پس از تسویه سیگنال‌های تایر S/A/B، همین‌جا ظاهر می‌شود.
          </p>
        )}

        {/* b) Push-Shield types */}
        <div className="mt-4 rounded-xl border border-slate-800/80 bg-secondary/20 p-3" data-testid="shield-breakdown">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-200">عملکرد به تفکیک نوع سپر (Push-Shield Engine)</span>
            <span className="text-[9px] text-muted-foreground">معادل مارکتی: DNB · AH +0.25 · دو نتیجه · توتال آسیایی</span>
          </div>
          {!shieldHasData ? (
            <div className="grid h-16 place-items-center rounded-lg border border-dashed border-slate-700/60 bg-secondary/30 text-[11px] text-muted-foreground">
              بدون داده
            </div>
          ) : (
            <table className="w-full border-collapse text-right text-[11px]">
              <thead>
                <tr>
                  {[
                    ["نوع سپر", ""],
                    ["برد", ""],
                    ["باخت", "hidden sm:table-cell"],
                    ["پوش", "hidden sm:table-cell"],
                    ["وین‌ریت خالص", ""],
                    ["نرخ بدون‌باخت", ""],
                    ["تسویه", "hidden md:table-cell"],
                  ].map(([h, hideCls]) => (
                    <th
                      key={h}
                      className={cn(
                        "whitespace-nowrap border-b border-slate-800 px-2 py-1.5 text-[10px] font-semibold text-muted-foreground",
                        hideCls,
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shieldRows.map(({ key, st }) => (
                  <tr key={key} className="transition-colors hover:bg-secondary/40">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <ShieldBadge shieldType={key} />
                        {key === shieldFa(key) && <span className="text-[10px] text-slate-300" dir="ltr">{key}</span>}
                      </div>
                      {SHIELD_BUCKETS[key] && (
                        <div className="num mt-0.5 text-[9px] text-slate-500" dir="ltr">{SHIELD_BUCKETS[key]}</div>
                      )}
                    </td>
                    <td className="num px-2 py-1.5 font-bold text-emerald-300">{st?.wins ?? 0}</td>
                    <td className="num hidden px-2 py-1.5 font-bold text-red-300 sm:table-cell">{st?.losses ?? 0}</td>
                    <td className="num hidden px-2 py-1.5 font-bold text-slate-400 sm:table-cell">{st?.voids ?? 0}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, Math.max(0, st ? pct0(st.winRate) : 0))}%` }} />
                        </div>
                        <span className="num text-[10px] font-bold text-emerald-300" dir="ltr">{st ? fmtPct(st.winRate) : "—"}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, Math.max(0, st ? pct0(st.noLossRate) : 0))}%` }} />
                        </div>
                        <span className="num text-[10px] font-bold text-cyan-300" dir="ltr">{st ? fmtPct(st.noLossRate) : "—"}</span>
                      </div>
                    </td>
                    <td className="num hidden px-2 py-1.5 text-slate-400 md:table-cell">{st?.settled ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ── 3. Advanced filters ──────────────────────────────────────────── */}
      <Card className="glass p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* search: match / league / market / hash */}
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جستجو: بازی / لیگ / مارکت / هش…"
              className="h-9 border-slate-800 bg-secondary/50 pr-9 text-xs"
            />
          </div>

          {/* status chips */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {STATUSES.map(([k, l]) => (
              <button
                key={k}
                onClick={() => setStatus(k)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  status === k ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* sport chips — local state, NOT the global store filter */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {SPORTS.map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSport(k)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  sport === k ? "bg-cyan-500/15 text-cyan-300" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* league dropdown built from unique settled leagues */}
          <select
            value={league}
            onChange={(e) => setLeague(e.target.value)}
            aria-label="فیلتر لیگ"
            className="h-9 w-56 rounded-md border border-slate-800 bg-secondary/50 px-2 text-xs text-foreground outline-none transition-colors focus:border-cyan-500/50"
          >
            <option value="all">همه لیگ‌ها</option>
            {leagues.map((lg) => (
              <option key={lg} value={lg}>{lg}</option>
            ))}
          </select>

          {/* time-range chips — settledAt cutoff */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {RANGES.map(([k, l]) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  range === k ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* audit exports */}
          <Button variant="outline" size="sm" className="gap-1.5 border-slate-700 text-xs" onClick={() => download("csv")}>
            <Download className="size-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 border-slate-700 text-xs" onClick={() => download("json")}>
            <Download className="size-3.5" /> JSON
          </Button>
        </div>
      </Card>

      {/* ── 4. Verified ledger rows — static rich rows (bankroll-free) ───── */}
      {rows.length === 0 ? (
        <EmptyState
          icon="🔐"
          title="رکورد تسویه‌شده‌ای در این فیلتر نیست"
          sub="پس از پایان هر مسابقه، موتور تسویه نتیجه ESPN را با قوانین ۹۰ دقیقه فوتبال / تکمیل کامل تنیس ثبت و هش می‌کند."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-right text-[11px]">
            <thead>
              <tr>
                {[
                  "مسابقه",
                  "ورزش و لیگ",
                  "بازار محافظت‌شده",
                  "Tier",
                  "احتمال کالیبره",
                  "نتیجه",
                  "FT",
                  "تاریخ تسویه",
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border-b border-slate-800 px-2 py-2 text-[10px] font-semibold text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const calProbRaw = (s.noLossProb ?? s.modelProb) * 100;
                const calProb = Number.isFinite(calProbRaw) ? `${calProbRaw.toFixed(1)}%` : "—";
                const ftText =
                  s.sport === "tennis"
                    ? (s.setResult ?? "—")
                    : s.homeScore != null && s.awayScore != null
                      ? `${s.homeScore}-${s.awayScore}`
                      : "—";
                const res = resultBadge(s.status);
                return (
                  <tr
                    key={s.id}
                    className="border-b border-slate-800/60 align-middle transition-colors hover:bg-secondary/40"
                    data-testid="ledger-row"
                  >
                    {/* مسابقه */}
                    <td className="max-w-[220px] px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{s.sport === "tennis" ? "🎾" : "⚽"}</span>
                        <TeamAvatar name={s.homeName || s.matchInfo} logo={s.homeLogo} size={22} />
                        <TeamAvatar name={s.awayName || s.matchInfo} logo={s.awayLogo} size={22} />
                        <span className="truncate font-bold text-slate-100" title={s.matchInfo}>
                          {s.matchInfo}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <HashChip hash={s.shaHash} onClick={() => setVerify(s)} />
                        {s.espnUrl ? (
                          <a
                            href={s.espnUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 rounded-md border border-slate-700 px-1.5 py-0.5 text-[9px] text-slate-300 transition-colors hover:border-cyan-500/40"
                            title="مشاهده در ESPN"
                          >
                            <ExternalLink className="size-3" /> espn.com
                          </a>
                        ) : null}
                      </div>
                    </td>
                    {/* ورزش و لیگ */}
                    <td className="max-w-[160px] px-2 py-2">
                      <div className="flex items-center gap-1 text-slate-200">
                        <span aria-hidden>{sportGlyph(s.sport)}</span>
                        <span className="truncate" title={s.league}>{s.league}</span>
                      </div>
                    </td>
                    {/* بازار محافظت‌شده */}
                    <td className="max-w-[260px] px-2 py-2">
                      <div className="truncate text-slate-300" dir="ltr" title={officialBetLine(s.marketKey, s.selection, s.marketLabel, s.homeName, s.awayName)}>
                        {officialBetLine(s.marketKey, s.selection, s.marketLabel, s.homeName, s.awayName)}
                      </div>
                      {s.shieldType && (
                        <div className="mt-1">
                          <ShieldBadge shieldType={s.shieldType} />
                        </div>
                      )}
                    </td>
                    {/* Tier */}
                    <td className="whitespace-nowrap px-2 py-2">
                      {s.tier ? <TierBadge tier={s.tier} /> : <span className="num text-slate-500">—</span>}
                    </td>
                    {/* احتمال کالیبره */}
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className="num font-bold text-cyan-300" dir="ltr">{calProb}</span>
                    </td>
                    {/* نتیجه */}
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className={cn("inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-bold", res.cls)}>
                        {res.text}
                      </span>
                    </td>
                    {/* FT */}
                    <td className="whitespace-nowrap px-2 py-2">
                      <span
                        className="num inline-block rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300"
                        dir="ltr"
                        title="نتیجه واقعی از فید ESPN (ست‌های تنیس / نتیجه نهایی فوتبال)"
                      >
                        {ftText}
                      </span>
                    </td>
                    {/* تاریخ تسویه */}
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className="num text-slate-300" dir="ltr">{formatSafeDateTime(s.settledAt)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 5. Shadow Ledger Tracker (count-based, v3.2) ─────────────────── */}
      <Card className="glass border-red-500/20 p-4" data-testid="shadow-tracker">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-red-300">
            <ShieldAlert className="size-4 text-red-400" />
            🛡️ پیگیری وضعیت کارت‌های دفتر سایه (Shadow Ledger Tracker)
          </h2>
          <span className="rounded-md border border-slate-700 bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
            {state.shadowVetoes.length} کارت وتو
          </span>
        </div>

        {/* v3.2 summary — Shadow Win-Rate Lift headline + veto counters (no units) */}
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3" data-testid="shadow-lift">
            <div className="text-[10px] text-muted-foreground">ارتفاع وین‌ریت سایه (Shadow Win-Rate Lift)</div>
            {hasLift ? (
              <>
                <AnimatedNumber
                  value={shadowLift}
                  decimals={1}
                  prefix={shadowLift >= 0 ? "+" : ""}
                  suffix="pp"
                  className="mt-1 block text-xl font-extrabold neon-cyan"
                />
                <div className="num mt-1 text-[10px] text-slate-400" dir="ltr">
                  with-veto {fmtPct(withVeto)} · without-veto {fmtPct(withoutVeto)}
                </div>
              </>
            ) : (
              <div className="mt-2 text-[11px] text-muted-foreground">بدون داده</div>
            )}
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
            <div className="text-[10px] text-muted-foreground">Saved Losses — وتوی نجات‌دهنده</div>
            <AnimatedNumber
              value={savedLossCount}
              decimals={0}
              className="mt-1 block text-xl font-extrabold neon-emerald"
            />
            <div className="mt-1 text-[10px] text-emerald-200/80">
              تعداد وتوهایی که یک باخت قطعی را حذف کردند
            </div>
          </div>
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
            <div className="text-[10px] text-muted-foreground">Missed Wins — فرصت ازدست‌رفته</div>
            <AnimatedNumber
              value={missedWinCount}
              decimals={0}
              className="mt-1 block text-xl font-extrabold text-amber-300"
            />
            <div className="mt-1 text-[10px] text-amber-200/80">
              تعداد برد‌هایی که بدون وتو از دست می‌رفت
            </div>
          </div>
          <div className="rounded-xl border border-slate-700/40 bg-secondary/30 p-3">
            <div className="text-[10px] text-muted-foreground">برآیند خالص وتو (تفاضل شمارش)</div>
            <AnimatedNumber
              value={netShadowCount}
              decimals={0}
              prefix={netShadowCount >= 0 ? "+" : ""}
              className={cn("mt-1 block text-xl font-extrabold", netShadowCount >= 0 ? "neon-cyan" : "text-red-300")}
            />
            <div className="mt-1 text-[10px] text-slate-400">
              تعداد نجات منهای فرصت ازدست‌رفته
            </div>
          </div>
        </div>

        {state.shadowVetoes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700/80 bg-secondary/20 p-4 text-center text-[11px] leading-6 text-muted-foreground">
            کارت وتویی در دفتر سایه ثبت نشده است — هر سیگنالی که لایه RCA رد می‌کند، با دلیل کامل و نتیجه واقعی همین‌جا آرشیو می‌شود.
          </div>
        ) : (
          <div className="scroll-slim max-h-96 overflow-y-auto overscroll-contain rounded-xl border border-slate-800/80">
            <table className="w-full border-collapse text-right text-[11px]">
              <thead>
                <tr>
                  {[
                    ["مسابقه و لیگ + تاریخ شروع", ""],
                    ["انتخاب موتور پیش از وتو", ""],
                    ["دلیل وتو", "hidden lg:table-cell"],
                    ["نتیجه واقعی بازی", ""],
                    ["برچسب نتیجه وتو", ""],
                    ["زمان تعیین تکلیف", "hidden xl:table-cell"],
                  ].map(([h, hideCls]) => (
                    <th
                      key={h}
                      className={cn(
                        "sticky top-0 z-10 whitespace-nowrap border-b border-slate-800 bg-[#0C1220] px-3 py-2 text-[10px] font-semibold text-muted-foreground",
                        hideCls,
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.shadowVetoes.map((v) => {
                  const tag = verdictTag(v);
                  const sharp = isSharpDivergence(v.reason);
                  // v2.7.1 §1 — the tracker renders the engine's PRE-VETO pick
                  // with the official bookmaker name and the REAL team names
                  // (from the representative fixture).
                  const [repHome, repAway] = (v.repMatch ?? "").includes(" vs ")
                    ? (v.repMatch ?? "").split(" vs ")
                    : ["Home", "Away"];
                  const betline = formatStoredMarketLabel(v.marketLabel, v.selection, repHome || "Home", repAway || "Away");
                  return (
                    <tr
                      key={v.id}
                      className={cn("transition-colors hover:bg-secondary/40", sharp && "bg-cyan-500/[0.06]")}
                    >
                      <td className="max-w-[220px] px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-bold text-slate-200" title={v.repMatch ?? v.signalRef}>
                            {v.repMatch ?? v.signalRef}
                          </span>
                          {/* v3.1 — Push-Shield Engine provenance badge */}
                          {v.category === "SHIELD_ENGINE" && (
                            <span
                              className="shrink-0 rounded border border-violet-400/40 bg-violet-400/10 px-1 py-0.5 text-[9px] font-bold text-violet-300"
                              dir="ltr"
                              title="صادرشده توسط موتور سپر v3.1"
                            >
                              v3.1
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-slate-400">
                          <span className="truncate">{v.league ?? "—"}</span>
                          <span className="num" dir="ltr">{sportGlyph(v.sport)} {fmtDateTimeFa(v.startTime, false)}</span>
                        </div>
                      </td>
                      <td className="max-w-[230px] px-2 py-2">
                        <div className="truncate text-slate-300" dir="ltr" title={betline}>
                          {betline}
                        </div>
                        {/* v3.3 §3.3 — the odds display "@ 2.86" is BANNED from the
                            Shadow Ledger table: it showed 1xBet-estimated prices as if
                            they were real. Calibrated probability + verdict + FT only. */}
                        <div className="num mt-0.5 text-[9px] text-slate-500" dir="ltr">
                          CAL PROB {v.modelProb != null ? `${(v.modelProb * 100).toFixed(1)}%` : "—"}
                        </div>
                      </td>
                      <td className="hidden max-w-[230px] px-2 py-2 lg:table-cell" title={v.reason}>
                        <div className={cn("truncate", sharp ? "text-cyan-200" : "text-slate-300")}>{v.reason}</div>
                        {/* v3.1 — sharp-divergence veto tag (tactical vetoes stay untagged) */}
                        {sharp && (
                          <span
                            className="mt-0.5 inline-block rounded border border-cyan-400/40 bg-cyan-400/10 px-1 py-0.5 text-[9px] font-bold tracking-wide text-cyan-300"
                            dir="ltr"
                          >
                            SHARP DIVERGENCE
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {v.ftScore ? (
                          <span
                            className="num inline-block rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300"
                            dir="ltr"
                          >
                            {v.ftScore}
                          </span>
                        ) : (
                          <span className="inline-block rounded-md border border-slate-700 bg-secondary px-1.5 py-0.5 text-[10px] text-slate-400">
                            در انتظار
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={cn("inline-block whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold", tag.cls)}
                        >
                          {tag.text}
                        </span>
                      </td>
                      <td className="num hidden whitespace-nowrap px-2 py-2 text-slate-400 xl:table-cell" dir="ltr">
                        {formatSafeDateTime(v.decidedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Hash-verify dialog */}
      <Dialog open={!!verify} onOpenChange={(o) => !o && setVerify(null)}>
        <DialogContent className="border-slate-800 bg-[#0C1220]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-emerald-400" />
              راستی‌آزمایی قفل پیش‌ازبازی (Pre-Match Lock)
            </DialogTitle>
          </DialogHeader>
          {verify && (
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                هش زیر پیش از شروع مسابقه روی {verify.matchInfo} قفل شده است. برای ممیزی مستقل، payload سیگنال
                (matchInfo + market + probability + issuedAt) را با همین هش بازتولید کنید.
              </p>
              <div className="num break-all rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-left text-[10px] text-emerald-300" dir="ltr">
                {verify.shaHash}
              </div>
              <div className="text-[10px] text-slate-400">
                مارکت: <span dir="ltr">{officialBetLine(verify.marketKey, verify.selection, verify.marketLabel, verify.homeName, verify.awayName)}</span>
                {" "}· احتمال کالیبره{" "}
                <span className="num" dir="ltr">
                  {Number.isFinite((verify.noLossProb ?? verify.modelProb) * 100)
                    ? `${((verify.noLossProb ?? verify.modelProb) * 100).toFixed(1)}%`
                    : "—"}
                </span>
              </div>
              <div className="text-[10px] text-slate-400">
                زمان قفل پیش‌ازبازی: <span className="num text-violet-300" dir="ltr">{formatSafeDateTime(verify.lockedAt)}</span> · زمان تسویه:{" "}
                <span className="num text-cyan-300" dir="ltr">{formatSafeDateTime(verify.settledAt)}</span>
              </div>
              <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2 text-[10px] leading-5 text-slate-300">
                زنجیره: هر گره شامل prevHash گره قبلی است — دستکاری هر ردیف زنجیره ممیزی را می‌شکند.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

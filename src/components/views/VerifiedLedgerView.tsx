"use client";

/**
 * View 4 — VerifiedLedgerView (v3.1): SHA-256 verified settlement ledger.
 *
 * v2.0 base: 3 analytical charts (equity curve / winrate & profit by sport /
 * profit by market family), advanced filters bar (search, status, sport,
 * league, time-range, CSV/JSON audit export), expandable verified rows with
 * REAL pre-match lock + settlement timestamps, and the Shadow Ledger Tracker.
 *
 * v3.1 layer (SuperAgent Push-Shield Hit-Rate Engine):
 *  - Cumulative Win-Rate (pure) + No-Loss Rate dual-line trend chart
 *  - Per-tier performance breakdown (TIER_S / TIER_A / TIER_B)
 *  - Per-shield-type breakdown (FULL_PUSH / HALF_PUSH / DOUBLE_OUTCOME / DIRECT_WIN)
 *  - Shadow Ledger Tracker upgrade: Shadow Win-Rate Lift headline, signed units,
 *    SHARP DIVERGENCE cyan tags, v3.1 SHIELD_ENGINE badges
 *  - Tier/Shield badges on settled rows + full FT/sets detail in the expansion
 */

import { useMemo, useState } from "react";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyState, TeamAvatar, AnimatedNumber, HashChip, TierBadge, ShieldBadge, NoLossChip,
} from "@/components/shared/primitives";
import { lineLabel, statusColor, fmtPrice, fmtUnits, fmtDateTimeFa } from "@/lib/api-types";
import { formatSafeDateTime } from "@/lib/format";
import { calculateSafeQuarterKellyStake } from "@/core/math/kelly";
import type { AppStatePayload, AppSignal, AppVeto } from "@/lib/api-types";
import { officialBetLine } from "@/lib/markets";
import { formatStoredMarketLabel } from "@/core/bookmakers/market-aliases";
import { Search, Download, ChevronDown, ShieldCheck, ExternalLink, ShieldAlert, TrendingUp, Layers } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ---------- helpers ---------- */

const sportGlyph = (sport: string | null): string =>
  sport === "tennis" ? "🎾" : sport === "football" ? "⚽" : "—";

/**
 * v3.1 — normalize a 0–1 fraction rate to percent (defensive: values already
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

/** v3.1 — signed units for the Shadow Tracker: saved capital is positive, missed opportunity is negative. */
function signedUnits(v: AppVeto): { text: string; cls: string; title: string } {
  const u = Math.abs(v.savedUnits ?? 0);
  if (v.verdict === "SAVED_LOSS") {
    return { text: `+${fmtUnits(u, 1)}u`, cls: "text-emerald-300", title: "سرمایه نجات‌یافته از باخت" };
  }
  if (v.verdict === "MISSED_WIN") {
    return { text: `-${fmtUnits(u, 1)}u`, cls: "text-amber-300", title: "سود ازدست‌رفته (هزینه فرصت)" };
  }
  return { text: "—", cls: "text-slate-500", title: "" };
}

/** v3.1 — confidence tier display order. */
const TIER_ORDER = ["TIER_S", "TIER_A", "TIER_B"] as const;

/** v3.1 — shield-type display order + Persian labels + equivalent market-family buckets. */
const SHIELD_ORDER: Array<{ key: string; label: string; buckets: string }> = [
  { key: "FULL_PUSH_SHIELD", label: "سپر کامل", buckets: "Draw No Bet · Asian Total Over 2.0" },
  { key: "HALF_PUSH_SHIELD", label: "نیمه‌برگشت", buckets: "Asian Handicap +0.25 · Asian Total Under 3.0" },
  { key: "DOUBLE_OUTCOME_SHIELD", label: "دو نتیجه", buckets: "Double Chance" },
  { key: "DIRECT_WIN", label: "برد مستقیم", buckets: "Match Winner · Set +1.5" },
];

/** Compact rate bar used by the tier cards and shield table. */
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

type TierBucket = { wins: number; losses: number; voids: number; winRate: number; noLossRate: number; settled: number };

export default function VerifiedLedgerView({ state }: { state: AppStatePayload }) {
  const m = state.metrics;
  const lab = state.agentLab;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "WON" | "LOST" | "VOID">("all");
  const [sport, setSport] = useState<"all" | "football" | "tennis">("all");
  const [league, setLeague] = useState("all");
  const [range, setRange] = useState<"all" | "7" | "30">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [verify, setVerify] = useState<AppSignal | null>(null);
  /* v2.5 — stake-policy comparison switch: view the WHOLE settled history
   * replayed under Quarter-Kelly (1%–3.5% of running bank, recommended) or
   * under a uniform Flat 20u (= 2% of the 1,000u bank). */
  const [stakeView, setStakeView] = useState<"KELLY" | "FLAT20">("KELLY");

  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

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

  /* v2.5 — chronological replay of the settled history under the selected
   * staking policy. Honest math: each bet stakes the policy amount of the
   * RUNNING bank before that bet; WON/LOST/VOID verdicts never change. */
  const policyView = useMemo(() => {
    const ordered = [...state.settledSignals]
      .filter((s) => s.status !== "OPEN")
      .sort(
        (a, b) =>
          new Date(a.settledAt ?? a.lockedAt).getTime() -
          new Date(b.settledAt ?? b.lockedAt).getTime(),
      );
    let bank = 1000;
    const rowsMap = new Map<string, { stake: number; netProfit: number }>();
    const curve: Array<{ date: string; bankroll: number }> = [];
    for (const s of ordered) {
      const stake = stakeView === "KELLY"
        ? (calculateSafeQuarterKellyStake(s.modelProb, s.price, bank).stakeUnits || 10)
        : 20; // Flat 20u = 2% of the starting bank
      const net = s.status === "WON"
        ? Math.round(stake * (s.price - 1) * 100) / 100
        : s.status === "LOST"
          ? -stake
          : 0;
      bank = Math.round((bank + net) * 100) / 100;
      rowsMap.set(s.id, { stake, netProfit: net });
      curve.push({ date: (s.settledAt ?? s.lockedAt).slice(0, 10), bankroll: bank });
    }
    const pnl = Math.round((bank - 1000) * 100) / 100;
    const stakedTotal = ordered.reduce((acc, s) => acc + (rowsMap.get(s.id)?.stake ?? 0), 0);
    return {
      rowsMap, curve, endBank: bank, pnl,
      roi: stakedTotal > 0 ? Math.round((pnl / stakedTotal) * 1000) / 10 : 0,
      count: ordered.length,
    };
  }, [state.settledSignals, stakeView]);

  /* v3.1 — cumulative Win-Rate + No-Loss Rate trend over the settled history,
   * one point per settlement (settledAt ascending):
   *   pureWinRate = WON / decided(WON+LOST) so far
   *   noLossRate  = (WON + VOID) / settled so far — the shield metric. */
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

  /* v3.1 — per-tier breakdown (TIER_S / TIER_A / TIER_B), "بدون داده" when absent. */
  const tierStats = lab?.tierStats ?? {};
  const tierRows = TIER_ORDER.map((key) => ({ key, st: tierStats[key] as TierBucket | undefined }));
  const tierHasData = TIER_ORDER.some((k) => !!tierStats[k]);

  /* v3.1 — per-shield-type breakdown (known keys first, unknown extras appended). */
  const shieldStats = lab?.shieldStats ?? {};
  const shieldRows = useMemo(() => {
    const known = SHIELD_ORDER.map((o) => ({ ...o, st: shieldStats[o.key] as TierBucket | undefined }));
    const extras = Object.keys(shieldStats)
      .filter((k) => !SHIELD_ORDER.some((o) => o.key === k))
      .map((k) => ({ key: k, label: k, buckets: "", st: shieldStats[k] as TierBucket | undefined }));
    return [...known, ...extras];
  }, [shieldStats]);
  const shieldHasData = Object.keys(shieldStats).length > 0;

  /* v3.1 — Shadow Ledger economics. Prefer the AgentLab audit; fall back to a
   * direct scan of the veto cards when the lab block is absent. */
  const shadowFallback = useMemo(() => {
    let savedLossCount = 0, savedLossUnits = 0, missedWinCount = 0, missedWinUnits = 0;
    for (const v of state.shadowVetoes) {
      if (v.verdict === "SAVED_LOSS") {
        savedLossCount++;
        savedLossUnits += Math.max(0, v.savedUnits ?? 0);
      } else if (v.verdict === "MISSED_WIN") {
        missedWinCount++;
        missedWinUnits += Math.abs(Math.min(0, v.savedUnits ?? 0));
      }
    }
    return { savedLossCount, savedLossUnits, missedWinCount, missedWinUnits };
  }, [state.shadowVetoes]);
  const shadow = lab?.shadow ?? { ...shadowFallback, shadowLiftPct: 0, winRateWithVeto: 0, winRateWithoutVeto: 0 };
  const hasLift = !!lab;
  const netShadowImpact = hasLift
    ? Math.round((shadow.savedLossUnits - shadow.missedWinUnits) * 100) / 100
    : m.savedCapital;

  /* CSV / JSON audit export (includes lockedAt + v3.1 ensemble metadata) */
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

  /* Chart c — profit by market family (top 8 by |profit|) */
  const marketRows = useMemo(
    () =>
      Object.entries(m.marketStats)
        .map(([family, s]) => ({ family, profit: s.profit, wins: s.wins, losses: s.losses }))
        .sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit))
        .slice(0, 8),
    [m.marketStats],
  );
  const maxAbsMarket = Math.max(1, ...marketRows.map((r) => Math.abs(r.profit)));

  /* Chart b — winrate & profit per sport */
  const sportRows = (["football", "tennis"] as const).map((k) => {
    const s = m.sportStats[k];
    return {
      key: k,
      label: k === "football" ? "⚽ فوتبال" : "🎾 تنیس",
      winRate: s?.winRate ?? 0,
      wins: s?.wins ?? 0,
      losses: s?.losses ?? 0,
      profit: s?.profit ?? 0,
      settled: s?.settled ?? 0,
    };
  });

  const lastEq = policyView.curve.length > 0
    ? policyView.curve[policyView.curve.length - 1]
    : null;
  const equityData = policyView.curve.length > 0 ? policyView.curve : m.equityCurve;

  return (
    <div className="space-y-4" data-testid="ledger-view">
      {/* ── 1. Analytical charts ─────────────────────────────────────────── */}
      <Card className="glass p-4" data-testid="ledger-charts">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-cyan-200">📊 نمودارهای تحلیلی کارنامه</h2>
          {/* v2.5 — stake-policy comparison switch */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            <button
              onClick={() => setStakeView("KELLY")}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[11px] transition-colors",
                stakeView === "KELLY" ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground hover:text-foreground",
              )}
              title="بازپخش کل تاریخچه با کلِی یک‌چهارم ۱٪ تا ۳.۵٪ بانک جاری — پیشنهادی"
            >
              🛡️ کلِی یک‌چهارم (۱٪–۳.۵٪ بانک — پیشنهادی)
            </button>
            <button
              onClick={() => setStakeView("FLAT20")}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[11px] transition-colors",
                stakeView === "FLAT20" ? "bg-violet-500/15 text-violet-300" : "text-muted-foreground hover:text-foreground",
              )}
              title="بازپخش کل تاریخچه با استیک یکسان ۲۰ واحد (۲٪ بانک ۱۰۰۰ واحدی)"
            >
              📊 استیک یکسان (Flat 20u = 2% بانک)
            </button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
          {/* v2.7.1 hotfix §2.3 — these headline chips read the SAME unified
              arithmetic as the Overview tab (computeUnifiedBankrollMetrics via
              computeMasterMetrics): bank, net profit and ROI are 100% identical
              on both pages — the audited 20.0u contradiction is impossible. */}
          <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
            بانک رسمی (پایه ۱٬۰۰۰u): <span className="num font-bold text-emerald-300" dir="ltr">{fmtUnits(m.bankroll, 1)}u</span>
          </span>
          <span className="rounded-lg border border-slate-800 bg-secondary/40 px-2.5 py-1 text-slate-300">
            سود خالص رسمی: <span className={cn("num font-bold", m.totalProfit >= 0 ? "text-emerald-300" : "text-red-300")} dir="ltr">{m.totalProfit >= 0 ? "+" : ""}{fmtUnits(m.totalProfit, 1)}u</span>
          </span>
          <span className="rounded-lg border border-slate-800 bg-secondary/40 px-2.5 py-1 text-slate-300">
            ROI: <span className="num font-bold text-cyan-300" dir="ltr">{m.roi >= 0 ? "+" : ""}{m.roi}%</span>
          </span>
          <span className="rounded-lg border border-slate-800 bg-secondary/40 px-2.5 py-1 text-slate-400">
            وین‌ریت: <span className="num font-bold text-violet-300" dir="ltr">{fmtUnits(m.winRate, 1)}%</span>
          </span>
          <span className="text-[10px] text-muted-foreground">
            (بازپخش سیاست استیک جدا محاسبه می‌شود — فقط برای مقایسه؛ بازپخش {policyView.count} تسویه → بانک {fmtUnits(policyView.endBank, 1)}u)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {/* a) Equity curve */}
          <div className="flex min-h-[232px] flex-col rounded-xl border border-slate-800/80 bg-secondary/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-200">منحنی رشد سرمایه (Equity Curve)</span>
              <span className="num text-[10px] font-bold text-emerald-300" dir="ltr">
                {lastEq ? `${fmtUnits(lastEq.bankroll, 1)}u` : "—"}
              </span>
            </div>
            {equityData.length === 0 ? (
              <div className="grid flex-1 place-items-center text-[11px] text-muted-foreground">
                داده‌ای برای منحنی سرمایه ثبت نشده است
              </div>
            ) : (
              <div className="h-44" dir="ltr" style={{ filter: "drop-shadow(0 0 8px rgba(52, 211, 153, 0.18))" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ledgerEquity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34D399" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#34D399" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1B2537" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#8FA3BF", fontSize: 9 }}
                      tickFormatter={(d: string) => String(d).slice(5)}
                      minTickGap={20}
                    />
                    <YAxis tick={{ fill: "#8FA3BF", fontSize: 9 }} width={46} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#0C1220", border: "1px solid #1B2537", borderRadius: 12, fontSize: 11 }}
                      labelStyle={{ color: "#8FA3BF" }}
                      formatter={(v) => [`${fmtUnits(Number(v), 1)}u`, "بانک"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="bankroll"
                      stroke="#34D399"
                      strokeWidth={2}
                      fill="url(#ledgerEquity)"
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* b) Winrate & profit by sport */}
          <div className="flex min-h-[232px] flex-col rounded-xl border border-slate-800/80 bg-secondary/20 p-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">وین‌ریت و سود به تفکیک ورزش</div>
            <div className="flex flex-1 flex-col justify-center gap-3">
              {sportRows.map((sp) => (
                <div key={sp.key} className="rounded-xl border border-slate-800/80 bg-[#0A0F1C]/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-200">{sp.label}</span>
                    <span
                      dir="ltr"
                      className={cn("num text-[11px] font-bold", sp.profit >= 0 ? "text-emerald-300" : "text-red-300")}
                    >
                      {sp.profit >= 0 ? "+" : ""}{fmtUnits(sp.profit, 1)}u
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          sp.key === "football"
                            ? "bg-gradient-to-r from-cyan-400 to-cyan-300/60"
                            : "bg-gradient-to-r from-violet-400 to-violet-300/60",
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, sp.winRate))}%` }}
                      />
                    </div>
                    <span
                      dir="ltr"
                      className={cn("num w-12 shrink-0 text-left text-[10px] font-bold", sp.key === "football" ? "text-cyan-300" : "text-violet-300")}
                    >
                      {sp.winRate.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1.5 text-[10px] text-muted-foreground">
                    {sp.wins} برد · {sp.losses} باخت · {sp.settled} تسویه‌شده
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* c) Profit by market family */}
          <div className="flex min-h-[232px] flex-col rounded-xl border border-slate-800/80 bg-secondary/20 p-3">
            <div className="mb-2 text-[11px] font-bold text-slate-200">سود به تفکیک خانواده مارکت (Top 8)</div>
            {marketRows.length === 0 ? (
              <div className="grid flex-1 place-items-center text-[11px] text-muted-foreground">
                آمار مارکتی برای نمایش نیست
              </div>
            ) : (
              <div className="flex flex-1 flex-col justify-center gap-1.5">
                {marketRows.map((r) => {
                  const pct = Math.max(2, Math.round((Math.abs(r.profit) / maxAbsMarket) * 100));
                  const pos = r.profit >= 0;
                  return (
                    <div
                      key={r.family}
                      className="flex items-center gap-2 text-[11px]"
                      title={`${r.family} — ${r.wins}W/${r.losses}L — ${fmtUnits(r.profit, 1)}u`}
                    >
                      <span dir="ltr" className="w-28 shrink-0 truncate text-right text-slate-300">{r.family}</span>
                      <div dir="ltr" className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800/80">
                        <div
                          className={cn(
                            "absolute inset-y-0 left-0 rounded-full",
                            pos
                              ? "bg-gradient-to-r from-emerald-400/90 to-emerald-400/25"
                              : "bg-gradient-to-r from-red-400/90 to-red-400/25",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span
                        dir="ltr"
                        className={cn("num w-16 shrink-0 text-left text-[10px] font-bold", pos ? "text-emerald-300" : "text-red-300")}
                      >
                        {fmtUnits(r.profit, 1)}u
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* v3.1 — d) Cumulative Win-Rate (pure) + No-Loss Rate dual-line trend */}
        <div className="mt-3 rounded-xl border border-slate-800/80 bg-secondary/20 p-3" data-testid="ledger-trend-chart">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
              <TrendingUp className="size-3.5 text-emerald-400" />
              روند تجمعی وین‌ریت خالص و نرخ سربه‌سر (بدون باخت)
            </span>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                وین‌ریت خالص: <span className="num font-bold" dir="ltr">{lastTrend ? lastTrend.winRate.toFixed(1) : "0.0"}%</span>
              </span>
              <span className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">
                نرخ سربه‌سر: <span className="num font-bold" dir="ltr">{lastTrend ? lastTrend.noLossRate.toFixed(1) : "0.0"}%</span>
              </span>
              <span className="num text-muted-foreground" dir="ltr">
                {trend.settled} تسویه · {trend.decided} تعیین‌شده
              </span>
            </div>
          </div>
          {trend.pts.length === 0 ? (
            <div className="grid h-44 place-items-center text-[11px] text-muted-foreground">
              رکورد تسویه‌شده‌ای برای رسم روند تجمعی ثبت نشده است
            </div>
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
                  <Tooltip
                    contentStyle={{ background: "#0C1220", border: "1px solid #1B2537", borderRadius: 12, fontSize: 11 }}
                    labelStyle={{ color: "#8FA3BF" }}
                    formatter={(v, n) => [`${Number(v).toFixed(1)}%`, String(n)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <Line
                    type="monotone"
                    dataKey="winRate"
                    name="وین‌ریت خالص تجمعی (WON/تعیین‌شده)"
                    stroke="#34D399"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="noLossRate"
                    name="نرخ سربه‌سر تجمعی ((WON+VOID)/تسویه)"
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
      </Card>

      {/* ── 2. v3.1 Agent Lab — per-tier & per-shield breakdown ─────────── */}
      <Card className="glass p-4" data-testid="agentlab-breakdown">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-violet-300">
            <Layers className="size-4 text-violet-400" />
            تفکیک عملکرد تایرها و انواع سپر (SuperAgent v3.1)
          </h2>
          <span className="rounded-md border border-slate-700 bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
            وین‌ریت = WON/تعیین‌شده · نرخ سربه‌سر = (WON+VOID)/تسویه
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
                    <span className="text-slate-400">ابطال <span className="num font-bold" dir="ltr">{st.voids}</span></span>
                  </div>
                  <RateBar label="وین‌ریت خالص" value={st.winRate} tone="emerald" />
                  <RateBar label="نرخ سربه‌سر" value={st.noLossRate} tone="cyan" />
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
            بلوک Agent Lab هنوز برای این payload فعال نیست — پس از اولین اجرای موتور v3.1، آمار تایرها همین‌جا ظاهر می‌شود.
          </p>
        )}

        {/* b) Push-Shield types */}
        <div className="mt-4 rounded-xl border border-slate-800/80 bg-secondary/20 p-3" data-testid="shield-breakdown">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-200">عملکرد به تفکیک نوع سپر (Push-Shield Engine)</span>
            <span className="text-[9px] text-muted-foreground">معادل مارکتی: DNB · AH +0.25 · دو نتیجه · توتال آسیایی</span>
          </div>
          {shieldRows.length === 0 || !shieldHasData ? (
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
                    ["ابطال", "hidden sm:table-cell"],
                    ["وین‌ریت خالص", ""],
                    ["نرخ سربه‌سر", ""],
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
                {shieldRows.map(({ key, label, buckets, st }) => (
                  <tr key={key} className="transition-colors hover:bg-secondary/40">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <ShieldBadge shieldType={key} />
                        {key === label && <span className="text-[10px] text-slate-300">{label}</span>}
                      </div>
                      {buckets && (
                        <div className="num mt-0.5 text-[9px] text-slate-500" dir="ltr">{buckets}</div>
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

      {/* ── 4. Verified ledger rows ──────────────────────────────────────── */}
      {rows.length === 0 ? (
        <EmptyState
          icon="🔐"
          title="رکورد تسویه‌شده‌ای در این فیلتر نیست"
          sub="پس از پایان هر مسابقه، موتور تسویه نتیجه ESPN را با قوانین ۹۰ دقیقه فوتبال / تکمیل کامل تنیس ثبت و هش می‌کند."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((s) => (
            <div key={s.id} className="glass overflow-hidden" data-testid="ledger-row">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded === s.id}
                onClick={() => toggle(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(s.id);
                  }
                }}
                className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-right transition-colors hover:bg-secondary/40"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-base">{s.sport === "tennis" ? "🎾" : "⚽"}</span>
                  <TeamAvatar name={s.homeName || s.matchInfo} logo={s.homeLogo} size={24} />
                  <TeamAvatar name={s.awayName || s.matchInfo} logo={s.awayLogo} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-xs font-bold text-slate-100">{s.matchInfo}</span>
                      {/* v2.7.2 §3 — FT column: REAL set scores from the ESPN
                          linescores feed, shown on every tennis ledger row. */}
                      {s.sport === "tennis" && s.setResult && (
                        <span
                          className="num rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300"
                          dir="ltr"
                          title="نتیجه واقعی ست‌ها از فید ESPN (linescores)"
                        >
                          FT {s.setResult}
                        </span>
                      )}
                      <span dir="ltr" className={cn("num text-[11px] font-bold", statusColor(s.status))}>
                        {s.status === "WON"
                          ? `+${fmtUnits(s.netProfit ?? 0)}`
                          : s.status === "LOST"
                            ? fmtUnits(s.netProfit ?? 0)
                            : s.status === "VOID"
                              ? "ابطال"
                              : s.status}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                      <span className="truncate">{s.league}</span>
                      <span>·</span>
                      <span className="truncate" dir="ltr">{officialBetLine(s.marketKey, s.selection, s.marketLabel, s.homeName, s.awayName)}</span>
                      <span>@</span>
                      <span className="num" dir="ltr">{fmtPrice(s.price)}</span>
                    </div>
                  </div>
                </div>
                {/* v3.1 — confidence tier + push-shield badges (desktop only;
                    on mobile they render inside the expanded detail panel). */}
                <div
                  className="hidden shrink-0 items-center gap-1 md:flex"
                  onClick={(e) => e.stopPropagation()}
                >
                  <TierBadge tier={s.tier} />
                  <ShieldBadge shieldType={s.shieldType} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span onClick={(e) => e.stopPropagation()}>
                    <HashChip hash={s.shaHash} onClick={() => setVerify(s)} />
                  </span>
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded === s.id && "rotate-180")} />
                </div>
              </div>

              {expanded === s.id && (
                <div className="border-t border-slate-800/70 bg-secondary/30 p-3">
                  {/* v3.1 — SuperAgent ensemble metadata */}
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <TierBadge tier={s.tier} />
                    <ShieldBadge shieldType={s.shieldType} />
                    {s.noLossProb != null && (
                      <span className="rounded-md border border-slate-700 bg-secondary px-1.5 py-0.5 text-[10px] text-slate-300">
                        احتمال سربه‌سر: <NoLossChip value={s.noLossProb} />
                      </span>
                    )}
                    {s.consensusPct != null && (
                      <span
                        className="num rounded-md border border-slate-700 bg-secondary px-1.5 py-0.5 text-[10px] text-slate-300"
                        dir="ltr"
                        title="اجماع انسامبل SuperAgent"
                      >
                        consensus {s.consensusPct}%
                      </span>
                    )}
                    {s.sharpAlert && (
                      <span
                        className="rounded-md border border-red-400/40 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-bold text-red-300"
                        dir="ltr"
                        title="هشدار واگرایی شارپ‌ها"
                      >
                        SHARP ALERT
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">خط تولید:</span>{" "}
                      <span className="font-bold text-slate-200">{lineLabel(s.line)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">استیک ثبت‌شده:</span>{" "}
                      <span className="num" dir="ltr">{fmtUnits(s.stake, 0)}u</span>{" "}
                      <span className="text-[10px] text-slate-400">({s.stakeMode})</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">استیک نمای سیاست:</span>{" "}
                      <span className="num text-amber-300" dir="ltr">
                        {fmtUnits(policyView.rowsMap.get(s.id)?.stake ?? s.stake, 1)}u
                      </span>{" "}
                      <span className="text-[10px] text-slate-400">
                        ({stakeView === "KELLY" ? "Quarter-Kelly" : "Flat 20u"} · سود: {fmtUnits(policyView.rowsMap.get(s.id)?.netProfit ?? 0, 1)}u)
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">احتمال مدل:</span>{" "}
                      <span className="num" dir="ltr">{(s.modelProb * 100).toFixed(1)}%</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">زمان قفل پیش‌ازبازی:</span>{" "}
                      <span className="num text-violet-300" dir="ltr">{formatSafeDateTime(s.lockedAt)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">زمان تسویه:</span>{" "}
                      <span className="num text-cyan-300" dir="ltr">{formatSafeDateTime(s.settledAt)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">EV:</span>{" "}
                      <span className="num" dir="ltr">
                        {s.evPct >= 0 ? "+" : ""}{s.evPct.toFixed(1)}%
                      </span>
                    </div>
                    {/* v3.1 — unified FT/sets display: tennis = ESPN set scores,
                        football = final ESPN scoreline "H-A". */}
                    <div>
                      <span className="text-muted-foreground">نتیجه نهایی (FT):</span>{" "}
                      {s.sport === "tennis" ? (
                        s.setResult ? (
                          <span
                            className="num inline-block rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300"
                            dir="ltr"
                            title="نتیجه واقعی ست‌ها از فید ESPN (linescores)"
                          >
                            {s.setResult}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500">از فید ESPN در دسترس نیست</span>
                        )
                      ) : s.homeScore != null && s.awayScore != null ? (
                        <span
                          className="num inline-block rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300"
                          dir="ltr"
                          title="نتیجه نهایی از فید ESPN"
                        >
                          {s.homeScore}-{s.awayScore}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">از فید ESPN در دسترس نیست</span>
                      )}
                    </div>
                  </div>

                  {s.legs && s.legs.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[10px] text-slate-400">
                      {s.legs.map((l, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <span className="text-emerald-400">·</span>
                          <span className="truncate" dir="ltr">{l.label}</span>
                          <span className="num shrink-0" dir="ltr">
                            @ {fmtPrice(l.price)} ({(l.prob * 100).toFixed(0)}%)
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {/* full SHA-256 chip — click to verify */}
                    <button
                      type="button"
                      onClick={() => setVerify(s)}
                      title="کلیک = راستی‌آزمایی هش"
                      dir="ltr"
                      className="num break-all rounded-md border border-slate-700 bg-[#0A0F1C] px-2 py-1 text-[10px] text-emerald-300 transition-colors hover:border-emerald-500/50"
                    >
                      SHA-256 {s.shaHash}
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 border-emerald-500/40 text-[10px] text-emerald-300"
                      onClick={() => setVerify(s)}
                    >
                      <ShieldCheck className="size-3" /> راستی‌آزمایی هش
                    </Button>
                    <a
                      href={s.espnUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-7 items-center gap-1 rounded-md border border-slate-700 px-2 text-[10px] text-slate-300 transition-colors hover:border-cyan-500/40"
                    >
                      <ExternalLink className="size-3" /> espn.com
                    </a>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 5. Shadow Ledger Tracker (v3.1) ──────────────────────────────── */}
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

        {/* v3.1 summary — Shadow Win-Rate Lift headline + saved/missed economics */}
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3" data-testid="shadow-lift">
            <div className="text-[10px] text-muted-foreground">ارتفاع وین‌ریت سایه (Shadow Win-Rate Lift)</div>
            {hasLift ? (
              <>
                <AnimatedNumber
                  value={shadow.shadowLiftPct}
                  decimals={1}
                  prefix={shadow.shadowLiftPct >= 0 ? "+" : ""}
                  suffix="pp"
                  className="mt-1 block text-xl font-extrabold neon-cyan"
                />
                <div className="num mt-1 text-[10px] text-slate-400" dir="ltr">
                  with-veto {fmtPct(shadow.winRateWithVeto)} · without-veto {fmtPct(shadow.winRateWithoutVeto)}
                </div>
              </>
            ) : (
              <div className="mt-2 text-[11px] text-muted-foreground">بدون داده</div>
            )}
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
            <div className="text-[10px] text-muted-foreground">Saved Losses — وتوی نجات‌دهنده</div>
            <AnimatedNumber
              value={shadow.savedLossCount}
              decimals={0}
              className="mt-1 block text-xl font-extrabold neon-emerald"
            />
            <div className="num mt-1 text-[10px] text-emerald-200/80" dir="ltr">
              {fmtUnits(shadow.savedLossUnits, 1)}u سرمایه نجات‌یافته
            </div>
          </div>
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
            <div className="text-[10px] text-muted-foreground">Missed Wins — فرصت ازدست‌رفته</div>
            <AnimatedNumber
              value={shadow.missedWinCount}
              decimals={0}
              className="mt-1 block text-xl font-extrabold text-amber-300"
            />
            <div className="num mt-1 text-[10px] text-amber-200/80" dir="ltr">
              {fmtUnits(shadow.missedWinUnits, 1)}u سود ازدست‌رفته
            </div>
          </div>
          <div className="rounded-xl border border-slate-700/40 bg-secondary/30 p-3">
            <div className="text-[10px] text-muted-foreground">برآیند خالص وتو (Net Shadow Impact)</div>
            <AnimatedNumber
              value={netShadowImpact}
              decimals={1}
              suffix="u"
              className={cn("mt-1 block text-xl font-extrabold", netShadowImpact >= 0 ? "neon-cyan" : "text-red-300")}
            />
            <div className="mt-1 text-[10px] text-slate-400">
              نجات منهای فرصت ازدست‌رفته
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
                    ["واحدها", ""],
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
                  const units = signedUnits(v);
                  const sharp = isSharpDivergence(v.reason);
                  // v2.7.1 §1 — the tracker renders the engine's PRE-VETO pick
                  // with the official bookmaker name and the REAL team names
                  // (from the representative fixture), odds and reference stake.
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
                        <div className="num mt-0.5 text-[9px] text-slate-500" dir="ltr">
                          @ {v.price != null ? v.price.toFixed(2) : "—"} · Ref Stake{" "}
                          {v.savedUnits != null && v.savedUnits > 0 ? v.savedUnits.toFixed(0) : "—"}u
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
                      <td className="num whitespace-nowrap px-2 py-2 font-bold" dir="ltr" title={units.title}>
                        <span className={units.cls}>{units.text}</span>
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
                (matchInfo + market + price + prob + stake + issuedAt) را با همین هش بازتولید کنید.
              </p>
              <div className="num break-all rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-left text-[10px] text-emerald-300" dir="ltr">
                {verify.shaHash}
              </div>
              <div className="text-[10px] text-slate-400">
                مارکت: <span dir="ltr">{officialBetLine(verify.marketKey, verify.selection, verify.marketLabel, verify.homeName, verify.awayName)}</span> · ضریب{" "}
                <span className="num" dir="ltr">{fmtPrice(verify.price)}</span> · استیک{" "}
                <span className="num" dir="ltr">{fmtUnits(verify.stake, 0)}u</span>
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

"use client";

/**
 * View 4 — VerifiedLedgerView (v2.0): SHA-256 verified settlement ledger.
 * Top: 3 analytical charts (equity curve / winrate & profit by sport / profit by market family).
 * Then: advanced filters bar (search, status, sport, league, time-range, CSV/JSON audit export),
 * expandable verified rows with REAL pre-match lock + settlement timestamps,
 * and the Shadow Ledger Tracker module (veto KPIs + full verdict table).
 */

import { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, TeamAvatar, AnimatedNumber, HashChip } from "@/components/shared/primitives";
import { lineLabel, statusColor, fmtPrice, fmtUnits, fmtDateTimeFa } from "@/lib/api-types";
import { formatSafeDateTime } from "@/lib/format";
import { calculateSafeQuarterKellyStake } from "@/core/math/kelly";
import type { AppStatePayload, AppSignal, AppVeto } from "@/lib/api-types";
import { officialBetLine } from "@/lib/markets";
import { Search, Download, ChevronDown, ShieldCheck, ExternalLink, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ---------- helpers ---------- */

const sportGlyph = (sport: string | null): string =>
  sport === "tennis" ? "🎾" : sport === "football" ? "⚽" : "—";

/** Verdict → badge text/classes (SAVED_LOSS | MISSED_WIN | PENDING | UNKNOWN | null). */
function verdictBadge(v: AppVeto): { text: string; cls: string } {
  switch (v.verdict) {
    case "SAVED_LOSS":
      return {
        text: `✅ وتوی موفق — نجات ${fmtUnits(v.savedUnits ?? 0, 1)}u`,
        cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      };
    case "MISSED_WIN":
      return {
        text: `⚠️ فرصت ازدست‌رفته ${fmtUnits(v.savedUnits ?? 0, 1)}u`,
        cls: "border-amber-400/40 bg-amber-400/10 text-amber-300",
      };
    case "PENDING":
      return {
        text: "در انتظار نتیجه",
        cls: "border-slate-600/70 bg-slate-500/10 text-slate-300",
      };
    default:
      return {
        text: "نامشخص",
        cls: "border-slate-700/80 bg-secondary text-slate-400",
      };
  }
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

export default function VerifiedLedgerView({ state }: { state: AppStatePayload }) {
  const m = state.metrics;
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

  /* CSV / JSON audit export (includes lockedAt) */
  function download(kind: "csv" | "json") {
    const data = rows.map((s) => ({
      id: s.id, match: s.matchInfo, league: s.league, sport: s.sport, line: s.line,
      market: s.marketLabel, selection: s.selection, price: s.price, evPct: s.evPct,
      stake: s.stake, stakeMode: s.stakeMode, status: s.status, netProfit: s.netProfit,
      sha256: s.shaHash, lockedAt: s.lockedAt, settledAt: s.settledAt, espn: s.espnUrl,
    }));
    const blob = kind === "json"
      ? new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      : new Blob([
          [
            "id", "match", "league", "sport", "line", "market", "selection", "price", "ev%",
            "stake", "stakeMode", "status", "netProfit", "sha256", "lockedAt", "settledAt", "espn",
          ].join(","),
          "\n",
          ...data.map((d) =>
            [
              d.id, `"${d.match}"`, `"${d.league}"`, d.sport, d.line, `"${d.market}"`, d.selection,
              d.price, d.evPct, d.stake, d.stakeMode, d.status, d.netProfit, d.sha256, d.lockedAt,
              d.settledAt, d.espn,
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
          <span className="rounded-lg border border-slate-800 bg-secondary/40 px-2.5 py-1 text-slate-300">
            بانک پایانی بازپخش: <span className="num font-bold text-emerald-300" dir="ltr">{fmtUnits(policyView.endBank, 1)}u</span>
          </span>
          <span className="rounded-lg border border-slate-800 bg-secondary/40 px-2.5 py-1 text-slate-300">
            سود/زیان کل: <span className={cn("num font-bold", policyView.pnl >= 0 ? "text-emerald-300" : "text-red-300")} dir="ltr">{policyView.pnl >= 0 ? "+" : ""}{fmtUnits(policyView.pnl, 1)}u</span>
          </span>
          <span className="rounded-lg border border-slate-800 bg-secondary/40 px-2.5 py-1 text-slate-300">
            ROI: <span className="num font-bold text-cyan-300" dir="ltr">{policyView.roi >= 0 ? "+" : ""}{policyView.roi}%</span>
          </span>
          <span className="text-[10px] text-muted-foreground">
            بازپخش صادقانه {policyView.count} تسویه به‌ترتیب زمانی — برد/باخت ثابت، فقط استیک با سیاست انتخابی محاسبه می‌شود
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
      </Card>

      {/* ── 2. Advanced filters ──────────────────────────────────────────── */}
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

      {/* ── 3. Verified ledger rows ──────────────────────────────────────── */}
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
                      <span className="truncate" dir="ltr">{officialBetLine(s.marketKey, s.selection, s.marketLabel)}</span>
                      <span>@</span>
                      <span className="num" dir="ltr">{fmtPrice(s.price)}</span>
                    </div>
                  </div>
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

      {/* ── 4. Shadow Ledger Tracker ─────────────────────────────────────── */}
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

        {/* v2.7 summary cards — Saved Losses / Missed Wins / Net Impact */}
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
            <div className="text-[10px] text-muted-foreground">تعداد Saved Losses (وتوی نجات‌دهنده)</div>
            <AnimatedNumber
              value={m.savedCount}
              decimals={0}
              className="mt-1 block text-xl font-extrabold neon-emerald"
            />
          </div>
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
            <div className="text-[10px] text-muted-foreground">تعداد Missed Wins (فرصت ازدست‌رفته)</div>
            <AnimatedNumber
              value={m.missedWinCount}
              decimals={0}
              className="mt-1 block text-xl font-extrabold text-amber-300"
            />
          </div>
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3">
            <div className="text-[10px] text-muted-foreground">برآیند خالص وتو (Net Shadow Impact)</div>
            <AnimatedNumber
              value={m.savedCapital}
              decimals={1}
              suffix="u"
              className={cn("mt-1 block text-xl font-extrabold", m.savedCapital >= 0 ? "neon-cyan" : "text-red-300")}
            />
          </div>
        </div>

        {state.shadowVetoes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700/80 bg-secondary/20 p-4 text-center text-[11px] leading-6 text-muted-foreground">
            کارت وتویی در دفتر سایه ثبت نشده است — هر سیگنالی که لایه RCA رد می‌کند، با دلیل کامل و نتیجه واقعی همین‌جا آرشیو می‌شود.
          </div>
        ) : (
          <div className="scroll-slim max-h-96 overflow-auto overscroll-contain rounded-xl border border-slate-800/80">
            <table className="w-full min-w-[860px] border-collapse text-right text-[11px]">
              <thead>
                <tr>
                  {[
                    "مسابقه و لیگ + تاریخ شروع",
                    "انتخاب موتور پیش از وتو",
                    "دلیل وتو",
                    "نتیجه واقعی بازی",
                    "برچسب نتیجه وتو",
                    "زمان تعیین تکلیف",
                  ].map((h) => (
                    <th
                      key={h}
                      className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-800 bg-[#0C1220] px-3 py-2 text-[10px] font-semibold text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.shadowVetoes.map((v) => {
                  const badge = verdictBadge(v);
                  const betline = officialBetLine(v.marketLabel ?? "", v.selection ?? "", "");
                  return (
                    <tr key={v.id} className="transition-colors hover:bg-secondary/40">
                      <td className="max-w-[220px] px-3 py-2">
                        <div className="truncate font-bold text-slate-200" title={v.repMatch ?? v.signalRef}>
                          {v.repMatch ?? v.signalRef}
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
                      <td className="max-w-[230px] truncate px-2 py-2 text-slate-300" title={v.reason}>
                        {v.reason}
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
                          className={cn("inline-block whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold", badge.cls)}
                        >
                          {badge.text}
                        </span>
                      </td>
                      <td className="num whitespace-nowrap px-2 py-2 text-slate-400" dir="ltr">{formatSafeDateTime(v.decidedAt)}</td>
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
                مارکت: <span dir="ltr">{officialBetLine(verify.marketKey, verify.selection, verify.marketLabel)}</span> · ضریب{" "}
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

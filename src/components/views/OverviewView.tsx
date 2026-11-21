"use client";

/**
 * View 1 — OverviewView: executive dashboard.
 * 4 KPI tiles + interactive equity area chart + Pick of the Day + recent settlements.
 * All numbers come from computeMasterMetrics() on the server — zero UI math.
 */

import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/shared/primitives";
import { useAppStore } from "@/lib/store";
import { lineLabel, marketLabelFa, selectionLabel, statusColor, fmtUnits, fmtPrice } from "@/lib/api-types";
import type { AppStatePayload, AppSignal } from "@/lib/api-types";
import { TrendingUp, Wallet, Percent, Activity, Crown, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const RANGES = [
  { key: "7", label: "۷ روزه" },
  { key: "30", label: "۳۰ روزه" },
  { key: "all", label: "کل" },
] as const;

export default function OverviewView({ state }: { state: AppStatePayload }) {
  const m = state.metrics;
  const setView = useAppStore((s) => s.setView);
  const setSportFilter = useAppStore((s) => s.setSportFilter);
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");

  const curve = (() => {
    const all = m.equityCurve;
    if (range === "all" || all.length === 0) return all;
    const days = Number(range);
    const cutoff = Date.now() - days * 86400_000;
    const filtered = all.filter((p) => new Date(p.date).getTime() >= cutoff);
    return filtered.length > 0 ? filtered : all.slice(-days);
  })();

  const pickOfTheDay = pickBestToday(state.openSignals);
  const recent = state.settledSignals.slice(0, 6);

  return (
    <div className="space-y-4" data-testid="overview-view">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="موجودی بانک (واحد)"
          value={fmtUnits(m.bankroll, 1)}
          sub={`شروع: ${fmtUnits(m.startingBank, 0)}u · سود خالص: ${fmtUnits(m.totalProfit, 1)}u`}
          accent={m.totalProfit >= 0 ? "emerald" : "red"}
          icon={<Wallet className="size-4 text-emerald-400" />}
        />
        <StatTile
          label="ROI واقعی"
          value={`${m.roi.toFixed(1)}%`}
          sub={`بر مبنای ${fmtUnits(m.wins + m.losses > 0 ? sumStakes(state) : 0, 0)}u استیک تسویه‌شده`}
          accent="gold"
          icon={<Percent className="size-4 text-amber-300" />}
        />
        <StatTile
          label="وین‌ریت هسته"
          value={`${m.winRate.toFixed(0)}%`}
          sub={`${m.wins} برد · ${m.losses} باخت · ${m.voids} ابطال`}
          accent="emerald"
          icon={<Activity className="size-4 text-emerald-400" />}
        />
        <StatTile
          label="حداکثر افت سرمایه"
          value={fmtUnits(m.maxDrawdown, 1)}
          sub={`سیگنال باز: ${m.openCount} (${fmtUnits(m.openStake, 0)}u در ریسک)`}
          accent={m.maxDrawdown > 150 ? "red" : "slate"}
          icon={<TrendingUp className="size-4 text-slate-300" />}
        />
      </div>

      {/* Equity curve */}
      <Card className="glass p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">منحنی رشد سرمایه (Bankroll Curve)</h2>
          <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-secondary/60 p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px] transition-colors",
                  range === r.key ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-56" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={curve} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#34D399" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1B2537" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: "#8FA3BF", fontSize: 10 }} tickFormatter={(d) => String(d).slice(5)} />
              <YAxis tick={{ fill: "#8FA3BF", fontSize: 10 }} width={52} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ background: "#0C1220", border: "1px solid #1B2537", borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: "#8FA3BF" }}
                formatter={(v: number) => [`${fmtUnits(v, 1)}u`, "Bankroll"]}
              />
              <Area type="monotone" dataKey="bankroll" stroke="#34D399" strokeWidth={2} fill="url(#eq)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Pick of the day + recent settlements */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="glass glass-hover relative overflow-hidden p-4 xl:col-span-2">
          <div className="absolute -left-10 -top-10 size-36 rounded-full bg-amber-400/10 blur-2xl" />
          <div className="flex items-center gap-2">
            <Crown className="size-4 text-amber-300" />
            <h2 className="text-sm font-bold text-amber-200">بهترین سیگنال امروز (Pick of the Day)</h2>
          </div>
          {pickOfTheDay ? (
            <div className="mt-3 space-y-2">
              <div className="text-sm font-bold">{pickOfTheDay.matchInfo}</div>
              <div className="text-xs text-muted-foreground">
                {pickOfTheDay.league} · {marketLabelFa(pickOfTheDay.marketKey)} {selectionLabel(pickOfTheDay.selection)}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="num rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-lg font-extrabold text-emerald-300">
                  {fmtPrice(pickOfTheDay.price)}
                </span>
                <span className="num rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-300">
                  +EV {pickOfTheDay.evPct.toFixed(1)}%
                </span>
                <span className="num rounded-lg border border-slate-700 bg-secondary px-2.5 py-1 text-xs">
                  استیک {fmtUnits(pickOfTheDay.stake, 0)}u
                </span>
              </div>
              <div className="num text-[10px] text-slate-500">SHA-256 {pickOfTheDay.shaHash.slice(0, 18)}…</div>
              <Button
                size="sm"
                variant="outline"
                className="mt-1 border-emerald-500/40 text-emerald-300"
                onClick={() => { setSportFilter(pickOfTheDay.sport === "tennis" ? "tennis" : "football"); setView("signals"); }}
              >
                مشاهده در مرکز سیگنال‌ها
                <ArrowLeft className="size-3.5" />
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              سیگنال +EV واجد شرایطی برای امروز ثبت نشده — موتورها در حال پایش بازار زنده هستند.
            </p>
          )}
        </Card>

        <Card className="glass p-4 xl:col-span-3">
          <h2 className="text-sm font-bold">آخرین تسویه‌های واقعی</h2>
          <div className="mt-3 space-y-2">
            {recent.length === 0 && (
              <p className="text-xs text-muted-foreground">
                هنوز مسابقه‌ای تسویه نشده — پس از پایان دیدارها، موتور FT نتایج ESPN را ثبت می‌کند.
              </p>
            )}
            {recent.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/70 bg-secondary/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{s.matchInfo}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {lineLabel(s.line)} · {marketLabelFa(s.marketKey)} {selectionLabel(s.selection)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("num text-[11px] font-bold", statusColor(s.status))}>
                    {s.status === "WON" ? `+${fmtUnits(s.netProfit ?? 0)}` : s.status === "LOST" ? fmtUnits(s.netProfit ?? 0) : s.status}
                  </span>
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                    s.status === "WON" ? "bg-emerald-500/15 text-emerald-300" :
                    s.status === "LOST" ? "bg-red-500/15 text-red-300" :
                    s.status === "VOID" ? "bg-slate-500/15 text-slate-300" : "bg-amber-400/15 text-amber-300")}>
                    {s.status === "WON" ? "برد" : s.status === "LOST" ? "باخت" : s.status === "VOID" ? "ابطال" : "باز"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function pickBestToday(open: AppSignal[]): AppSignal | null {
  const today = new Date().toISOString().slice(0, 10);
  const todays = open.filter((s) => s.dayKey === today);
  if (todays.length === 0) return open[0] ?? null;
  return todays.reduce((best, s) => (s.evPct > best.evPct ? s : best), todays[0]);
}

function sumStakes(state: AppStatePayload): number {
  return state.settledSignals.reduce((a, s) => a + s.stake, 0);
}

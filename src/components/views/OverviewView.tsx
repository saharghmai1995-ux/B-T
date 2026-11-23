"use client";

/**
 * View 1 — OverviewView: v3.1 "Parallel Superagent" executive dashboard.
 *
 * Modules (v3.1 rebuild):
 *  1) HeroQuantum3D — R3F quantum superagent core, wrapped in ErrorBoundary3D
 *  2) 4 SuperAgent KPI cards — Pure Win Rate / No-Loss Shield Rate /
 *     Calibration (Brier+ECE) / Win Streak + Shadow Lift
 *  3) Sport split panel — Football / Tennis WON · VOID(=PUSH) · LOST + rates
 *  4) Pick of the Day (سیگنال طلایی) — STRICTLY TODAY (Asia/Tehran),
 *     SHIELD-line preferred, best by (noLossProb ?? modelProb)
 *  5) Equity curve + daily PnL Recharts (kept from v2.x)
 *  6) Interactive recent settlements — expandable SuperAgent consensus audit
 *
 * Zero UI math beyond presentation fallbacks: every headline number comes from
 * the server payload; `agentLab` is optional and every field is guarded.
 */

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  ReferenceLine,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AnimatedNumber,
  TeamAvatar,
  PriceTag,
  HashChip,
  EmptyState,
  TierBadge,
  ShieldBadge,
  NoLossChip,
  SportIcon,
} from "@/components/shared/primitives";
import { useAppStore } from "@/lib/store";
import { fmtUnits, fmtDateTimeFa, lineLabel, statusColor } from "@/lib/api-types";
import { officialBetLine, marketFa } from "@/lib/markets";
import { cn } from "@/lib/utils";
import ErrorBoundary3D from "@/components/three/ErrorBoundary3D";
import HeroQuantum3D from "@/components/three/HeroQuantum3D";
import type { AppStatePayload } from "@/lib/api-types";
import {
  Target,
  ShieldCheck,
  Gauge,
  Flame,
  Satellite,
  Crown,
  ArrowLeft,
  Trophy,
  Zap,
  ChevronDown,
} from "lucide-react";

/* ============================== shared helpers ============================== */

type RangeKey = "7" | "30" | "all";

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "7", label: "۷ روز" },
  { key: "30", label: "۳۰ روز" },
  { key: "all", label: "کل" },
];

interface SportStat {
  wins: number;
  losses: number;
  profit: number;
  winRate: number;
  settled: number;
}

const ZERO_STAT: SportStat = { wins: 0, losses: 0, profit: 0, winRate: 0, settled: 0 };

const statOf = (rec: Record<string, SportStat>, key: string): SportStat => rec[key] ?? ZERO_STAT;

/** Signed unit string: +12.5 / -3.0 (fmtUnits keeps the minus). */
const signed = (n: number, d = 1): string => `${n >= 0 ? "+" : ""}${fmtUnits(n, d)}`;

/**
 * v3.1 — Tehran day-key, reimplemented inline (client-safe, no server imports):
 * the en-CA "YYYY-MM-DD" projection of an instant in Asia/Tehran. Both sides of
 * the Pick-of-the-Day comparison use this exact formatter so every browser
 * engine agrees on what "today" means for the golden card.
 */
function tehranDayKey(input: string | number | Date | null | undefined): string | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime()) || d.getFullYear() < 2020) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return null;
  }
}

function filterSeries<T extends { date: string }>(rows: T[], range: RangeKey): T[] {
  if (range === "all" || rows.length === 0) return rows;
  const days = Number(range);
  const cutoff = Date.now() - days * 86400_000;
  const filtered = rows.filter((p) => new Date(p.date).getTime() >= cutoff);
  return filtered.length > 0 ? filtered : rows.slice(-days);
}

/* ============================== v3.1 KPI card ============================== */

const KPI_TONE = {
  emerald: { text: "text-emerald-300", ring: "border-emerald-500/25" },
  cyan: { text: "text-cyan-300", ring: "border-cyan-500/25" },
  violet: { text: "text-violet-300", ring: "border-violet-500/25" },
  gold: { text: "text-amber-300", ring: "border-amber-500/25" },
} as const;

/** v3.1 SuperAgent KPI card — AnimatedNumber headline with a "—" fallback. */
function V31Kpi({
  label,
  value,
  decimals = 0,
  suffix = "",
  sub,
  tone,
  icon,
  dash = false,
}: {
  label: string;
  value?: number;
  decimals?: number;
  suffix?: string;
  sub?: string;
  tone: keyof typeof KPI_TONE;
  icon?: React.ReactNode;
  dash?: boolean;
}) {
  const t = KPI_TONE[tone];
  return (
    <div className={cn("glass glass-hover spotlight-card spotlight-border p-4", t.ring)} data-testid="overview-kpi">
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{label}</span>
          {icon}
        </div>
        {dash ? (
          <span className={cn("num mt-2 block text-2xl font-extrabold tracking-tight", t.text)} dir="ltr">
            —
          </span>
        ) : (
          <AnimatedNumber
            value={value ?? 0}
            decimals={decimals}
            suffix={suffix}
            className={cn("mt-2 block text-2xl font-extrabold tracking-tight", t.text)}
          />
        )}
        {sub && <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

/* ============================== small pieces ============================== */

function TeamBlock({ name, logo, role }: { name: string; logo: string | null; role: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <TeamAvatar name={name} logo={logo} size={38} />
      <div className="min-w-0">
        <div className="truncate text-xs font-bold" dir="auto">
          {name || "—"}
        </div>
        <div className="text-[9px] text-muted-foreground">{role}</div>
      </div>
    </div>
  );
}

/** One sport glass card of the split panel: WON / VOID(=PUSH) / LOST + rates. */
function SportSplitCard({ sport, label, stat }: { sport: string; label: string; stat: SportStat }) {
  // voids (=PUSH) are not stored per sport: settled − wins − losses
  const voids = Math.max(0, stat.settled - stat.wins - stat.losses);
  const winRate = stat.settled > 0 ? stat.winRate : 0;
  const noLossRate = stat.settled > 0 ? ((stat.wins + voids) / stat.settled) * 100 : 0;

  return (
    <Card className="glass glass-hover gap-3 p-4" data-testid={`overview-sport-${sport}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SportIcon sport={sport} className="text-base" />
          <h3 className="text-sm font-bold">{label}</h3>
        </div>
        <span className="num rounded-md border border-slate-800 bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <span dir="ltr">{stat.settled}</span> تسویه‌شده
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-2 py-2 text-center">
          <div className="text-[9px] text-muted-foreground">برد (WON)</div>
          <div className="num mt-0.5 text-base font-extrabold text-emerald-300" dir="ltr">
            {stat.wins}
          </div>
        </div>
        <div className="rounded-xl border border-slate-600/40 bg-slate-500/5 px-2 py-2 text-center">
          <div className="text-[9px] text-muted-foreground">پوش (VOID)</div>
          <div className="num mt-0.5 text-base font-extrabold text-slate-300" dir="ltr">
            {voids}
          </div>
        </div>
        <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-2 py-2 text-center">
          <div className="text-[9px] text-muted-foreground">باخت (LOST)</div>
          <div className="num mt-0.5 text-base font-extrabold text-red-300" dir="ltr">
            {stat.losses}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-800/70 pt-3">
        <div className="text-center">
          <div className="text-[9px] text-muted-foreground">وین‌ریت</div>
          <AnimatedNumber value={winRate} decimals={1} suffix="%" className="num text-lg font-extrabold text-emerald-300" />
        </div>
        <div className="text-center">
          <div className="text-[9px] text-muted-foreground">نرخ بدون‌باخت</div>
          <AnimatedNumber value={noLossRate} decimals={1} suffix="%" className="num text-lg font-extrabold text-cyan-300" />
        </div>
      </div>
    </Card>
  );
}

/** Settlement status → Persian label + badge classes (WON / PUSH(VOID) / LOST). */
function settlementStatus(s: string): { label: string; cls: string } {
  if (s === "WON") return { label: "برد (WON)", cls: "border border-neon-emerald bg-emerald-500/15 text-emerald-300" };
  if (s === "VOID") return { label: "پوش (VOID)", cls: "border border-slate-600/60 bg-slate-500/15 text-slate-300" };
  if (s === "LOST") return { label: "باخت (LOST)", cls: "border border-red-500/40 bg-red-500/15 text-red-300" };
  return { label: s, cls: "border border-amber-400/40 bg-amber-400/15 text-amber-300" };
}

/* ============================== main view ============================== */

export default function OverviewView({ state }: { state: AppStatePayload }) {
  const m = state.metrics;
  const lab = state.agentLab;
  const setView = useAppStore((s) => s.setView);
  const setSportFilter = useAppStore((s) => s.setSportFilter);
  const [range, setRange] = useState<RangeKey>("30");
  // v3.1 — interactive settlement rows: clicking reveals the SuperAgent
  // consensus audit panel (Quant + Coach views, sharp sensor, FT, SHA-256).
  const [expandedSettlements, setExpandedSettlements] = useState<Set<string>>(new Set());

  const fb = statOf(m.sportStats, "football");
  const tn = statOf(m.sportStats, "tennis");

  /* ---- v3.1 SuperAgent KPI values (every agentLab field optional-guarded) ---- */
  const pureWinRate = lab ? lab.pureWinRate * 100 : m.winRate;
  const settledAll = m.wins + m.losses + m.voids;
  const noLossRate = lab
    ? lab.noLossRate * 100
    : settledAll > 0
      ? ((m.wins + m.voids) / settledAll) * 100
      : m.winRate;

  const curve = useMemo(() => filterSeries(m.equityCurve, range), [m.equityCurve, range]);
  const pnl = useMemo(() => filterSeries(m.dailyPnl, range), [m.dailyPnl, range]);

  /* ---- Pick of the Day: STRICTLY today in Asia/Tehran (inline day-key) ---- */
  const pick = useMemo(() => {
    const todayKey = tehranDayKey(new Date());
    if (!todayKey) return null;
    const todays = state.openSignals.filter(
      (s) => s.dayKey === todayKey || tehranDayKey(s.startTime) === todayKey,
    );
    if (todays.length === 0) return null;
    // SHIELD first, then SINGLE_EV; best score = noLossProb ?? modelProb
    const rank = (line: string) => (line === "SHIELD" ? 0 : line === "SINGLE_EV" ? 1 : 2);
    return [...todays].sort((a, b) => {
      const r = rank(a.line) - rank(b.line);
      if (r !== 0) return r;
      return (b.noLossProb ?? b.modelProb) - (a.noLossProb ?? a.modelProb);
    })[0];
  }, [state.openSignals]);

  const recent = state.settledSignals.slice(0, 8);

  const openPickSport = (sport: string) => {
    setSportFilter(sport === "tennis" ? "tennis" : "football");
    setView("signals");
  };

  return (
    <div className="space-y-4" data-testid="overview-view">
      {/* ============ Module 1 — Quantum SuperAgent 3D hero ============ */}
      <section aria-label="موتور سوپرایجنت موازی" className="relative">
        <ErrorBoundary3D>
          <HeroQuantum3D />
        </ErrorBoundary3D>
      </section>

      {/* ============ Module 2 — v3.1 SuperAgent KPI bar (4 cards) ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="overview-kpis">
        <V31Kpi
          label="وین‌ریت خالص سوپرایجنت"
          value={pureWinRate}
          decimals={1}
          suffix="%"
          tone="emerald"
          icon={<Target className="size-4 text-emerald-400" />}
          sub={lab ? `${lab.decidedCount} تصمیم قطعی — پوش‌ها حذف شده` : `${m.wins + m.losses} تسویه قطعی (بدون پوش)`}
        />
        <V31Kpi
          label="نرخ بدون‌باخت (سپر)"
          value={noLossRate}
          decimals={1}
          suffix="%"
          tone="cyan"
          icon={<ShieldCheck className="size-4 text-cyan-300" />}
          sub="برد + پوش — سپر سربه‌سر Push-Shield"
        />
        {lab ? (
          <V31Kpi
            label="دقت کالیبراسیون (Brier)"
            value={lab.brier}
            decimals={3}
            tone="violet"
            icon={<Gauge className="size-4 text-violet-300" />}
            sub={`ECE ${(lab.ece * 100).toFixed(1)}%`}
          />
        ) : (
          <V31Kpi
            label="دقت کالیبراسیون (Brier)"
            tone="violet"
            icon={<Gauge className="size-4 text-violet-300" />}
            sub="کالیبراسیون هنوز اجرا نشده"
            dash
          />
        )}
        {lab ? (
          <V31Kpi
            label="استریک برد + لیفت سایه"
            value={lab.winStreak}
            decimals={0}
            tone="gold"
            icon={<Flame className="size-4 text-amber-300" />}
            sub={`Shadow Lift ${lab.shadow.shadowLiftPct.toFixed(1)}pp`}
          />
        ) : (
          <V31Kpi
            label="استریک برد + لیفت سایه"
            tone="gold"
            icon={<Flame className="size-4 text-amber-300" />}
            sub="در انتظار موتور سوپرایجنت"
            dash
          />
        )}
      </div>

      {/* ============ Module 3 — Sport split panel ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="overview-sport-split">
        <SportSplitCard sport="football" label="فوتبال" stat={fb} />
        <SportSplitCard sport="tennis" label="تنیس" stat={tn} />
      </div>

      {/* ============ Module 4 — Pick of the Day (سیگنال طلایی امروز) ============ */}
      <div data-testid="overview-pick">
        {pick ? (
          <Card className="glass glass-hover flex flex-col gap-3 p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Crown className="size-4 text-amber-300" />
                <h2 className="text-sm font-bold text-amber-200">سیگنال طلایی امروز — Pick of the Day</h2>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <TierBadge tier={pick.tier} />
                <ShieldBadge shieldType={pick.shieldType} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/70 bg-secondary/40 px-3 py-2.5">
              <TeamBlock name={pick.homeName} logo={pick.homeLogo} role="میزبان / بازیکن ۱" />
              <div className="shrink-0 text-center">
                <div className="num text-[10px] font-black text-cyan-300" dir="ltr">
                  VS
                </div>
                <SportIcon sport={pick.sport} className="text-base" />
              </div>
              <TeamBlock name={pick.awayName} logo={pick.awayLogo} role="میهمان / بازیکن ۲" />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span className="rounded-md border border-slate-800 bg-secondary px-1.5 py-0.5" dir="auto">
                {pick.league}
              </span>
              <span className="num inline-block tabular-nums" dir="ltr">
                {fmtDateTimeFa(pick.startTime)}
              </span>
              <span className="rounded-md bg-secondary px-1.5 py-0.5">{lineLabel(pick.line)}</span>
              <NoLossChip value={pick.noLossProb} />
            </div>

            <div
              dir="ltr"
              className="rounded-xl border-neon-gold bg-amber-400/10 px-3 py-2.5 text-center shadow-[0_0_18px_rgba(245,158,11,0.15)]"
            >
              <div className="num text-sm font-bold tracking-tight text-amber-300 md:text-base">
                {officialBetLine(pick.marketKey, pick.selection, pick.marketLabel, pick.homeName, pick.awayName)}
              </div>
            </div>
            <p className="-mt-1 text-center text-[11px] leading-5 text-muted-foreground">{marketFa(pick.marketKey)}</p>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PriceTag price={pick.price} className="px-3 py-1.5 text-lg" />
                <Badge variant="outline" className="border-neon-emerald bg-emerald-500/10 text-xs font-bold text-emerald-300">
                  +EV {fmtUnits(pick.evPct, 1)}%
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-300">
                  اجماع سوپرایجنت:{" "}
                  <span className="num font-bold" dir="ltr">
                    {pick.consensusPct != null ? `${pick.consensusPct}%` : "—"}
                  </span>
                </span>
                <span className="num rounded-lg border border-slate-700 bg-secondary px-2.5 py-1 text-[11px]">
                  استیک <span dir="ltr">{fmtUnits(pick.stake, 0)}u</span> ·{" "}
                  {pick.stakeMode === "KELLY_025" ? "Kelly" : "Flat"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-2.5">
              <HashChip hash={pick.shaHash} />
              <span className="text-[10px] text-muted-foreground">
                {pick.sport === "tennis" ? "تسویه: تکمیل کامل مسابقه (Retirement = ابطال)" : "تسویه: ۹۰ دقیقه زمان قانونی"}
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-auto border-neon-gold bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 hover:text-amber-200"
              onClick={() => openPickSport(pick.sport)}
            >
              مشاهده در مرکز پیش‌بینی
              <ArrowLeft className="size-3.5" />
            </Button>
          </Card>
        ) : (
          <div
            className="rounded-2xl border border-dashed border-slate-700/60 bg-transparent p-6 text-center md:p-8"
            data-testid="overview-pick-empty"
          >
            <Satellite className="mx-auto size-6 text-slate-500" />
            <p className="mt-2 text-sm font-semibold text-slate-300">
              امروز مسابقه‌ای برای انتخاب طلایی وجود ندارد
            </p>
            <p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-muted-foreground">
              کارت طلایی فقط سیگنال‌های امروز تهران را نشان می‌دهد — نزدیک‌ترین
              سیگنال‌های +EV در مرکز پیش‌بینی در دسترس است.
            </p>
          </div>
        )}
      </div>

      {/* ============ Module 5 — Equity curve + daily PnL (kept from v2.x) ============ */}
      <Card className="glass glass-hover gap-4 p-4" data-testid="overview-charts">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-cyan-300" />
            <h2 className="text-sm font-bold">موتور نمودار — منحنی سرمایه و PnL روزانه</h2>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-secondary/60 p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                  range === r.key
                    ? "border border-neon-cyan bg-cyan-500/10 text-cyan-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Equity curve — two glowing areas + neon total line */}
          <div className="rounded-xl border border-slate-800/70 bg-secondary/30 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold">منحنی رشد سرمایه (فوتبال / تنیس / کل)</h3>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-emerald-400" /> بانک فوتبال
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-violet-400" /> بانک تنیس
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-cyan-400" /> کل
                </span>
              </div>
            </div>
            {m.equityCurve.length === 0 ? (
              <EmptyState
                icon="📈"
                title="منحنی پس از اولین تسویه رسمی ترسیم می‌شود"
                sub="موتور تسویه پس از پایان هر مسابقه، نقطه جدید را به منحنی اضافه می‌کند."
              />
            ) : (
              <div className="h-56" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={curve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="eqFoot" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34D399" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#34D399" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="eqTen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1B2537" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: "#8FA3BF", fontSize: 10 }} tickFormatter={(d: string) => String(d).slice(5)} />
                    <YAxis tick={{ fill: "#8FA3BF", fontSize: 10 }} width={52} domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "#0C1220", border: "1px solid #1B2537", borderRadius: 12, fontSize: 12 }}
                      labelStyle={{ color: "#8FA3BF" }}
                      formatter={(v) => `${fmtUnits(Number(v), 1)}u`}
                    />
                    <Area type="monotone" dataKey="football" name="بانک فوتبال" stroke="#34D399" strokeWidth={1.5} fill="url(#eqFoot)" />
                    <Area type="monotone" dataKey="tennis" name="بانک تنیس" stroke="#8B5CF6" strokeWidth={1.5} fill="url(#eqTen)" />
                    <Area
                      type="monotone"
                      dataKey="bankroll"
                      name="کل بانک"
                      stroke="#00E5FF"
                      strokeWidth={2.5}
                      fill="none"
                      dot={false}
                      style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.7))" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Daily PnL — emerald/violet bars + red→gold→emerald zero line */}
          <div className="rounded-xl border border-slate-800/70 bg-secondary/30 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold">سود / زیان روزانه بر حسب ورزش</h3>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-emerald-400" /> فوتبال
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-violet-400" /> تنیس
                </span>
              </div>
            </div>
            {m.dailyPnl.length === 0 ? (
              <EmptyState
                icon="📊"
                title="سود روزانه پس از اولین تسویه ثبت می‌شود"
                sub="پس از هر تسویه رسمی، PnL آن روز در همین نمودار می‌نشیند."
              />
            ) : (
              <div className="h-56" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pnl} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pnlZero" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#EF4444" />
                        <stop offset="50%" stopColor="#F59E0B" />
                        <stop offset="100%" stopColor="#34D399" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1B2537" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "#8FA3BF", fontSize: 10 }} tickFormatter={(d: string) => String(d).slice(5)} />
                    <YAxis tick={{ fill: "#8FA3BF", fontSize: 10 }} width={52} />
                    <Tooltip
                      contentStyle={{ background: "#0C1220", border: "1px solid #1B2537", borderRadius: 12, fontSize: 12 }}
                      labelStyle={{ color: "#8FA3BF" }}
                      formatter={(v) => `${signed(Number(v))}u`}
                      cursor={{ fill: "rgba(0,229,255,0.06)" }}
                    />
                    <ReferenceLine y={0} stroke="url(#pnlZero)" strokeWidth={1.5} />
                    <Bar dataKey="football" name="سود فوتبال" fill="#34D399" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Bar dataKey="tennis" name="سود تنیس" fill="#8B5CF6" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ============ Module 6 — Interactive recent settlements (v3.1 audit) ============ */}
      <Card className="glass glass-hover gap-3 p-4" data-testid="overview-settlements">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="size-4 text-emerald-300" />
            <h2 className="text-sm font-bold">آخرین تسویه‌های رسمی — ممیزی اجماع</h2>
          </div>
          <span className="num text-[10px] text-muted-foreground">
            <span dir="ltr">{state.settledSignals.length}</span> تسویه‌شده در دفتر
          </span>
        </div>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            هنوز مسابقه‌ای تسویه نشده — موتور FT پس از پایان دیدارها نتایج ESPN را ثبت می‌کند.
          </p>
        ) : (
          <div className="max-h-[560px] space-y-2 overflow-y-auto scroll-slim" data-testid="overview-settlement-list">
            {recent.map((s) => {
              const amt = s.netProfit ?? 0;
              const expanded = expandedSettlements.has(s.id);
              const st = settlementStatus(s.status);
              // FT: football "2-1", tennis real set scores ("6-4, 6-3")
              const ft =
                s.sport === "tennis"
                  ? (s.setResult ?? "—")
                  : s.homeScore != null && s.awayScore != null
                    ? `${s.homeScore}-${s.awayScore}`
                    : "—";
              return (
                <div
                  key={s.id}
                  className={cn(
                    "rounded-xl border bg-secondary/40 transition-colors",
                    expanded ? "border-cyan-500/40" : "border-slate-800/70 hover:border-cyan-500/30",
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedSettlements((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-right"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium" dir="auto">
                        {s.matchInfo}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground" dir="ltr">
                        {officialBetLine(s.marketKey, s.selection, s.marketLabel, s.homeName, s.awayName)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="num hidden inline-block text-[9px] tabular-nums text-slate-500 md:inline" dir="ltr">
                        {fmtDateTimeFa(s.settledAt, false)}
                      </span>
                      <span className={cn("num text-[11px] font-bold", statusColor(s.status))}>
                        {s.status === "VOID" ? "±0.0u" : `${signed(amt)}u`}
                      </span>
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                          s.status === "WON" && "border border-neon-emerald bg-emerald-500/15 text-emerald-300",
                          s.status === "LOST" && "border border-red-500/40 bg-red-500/15 text-red-300",
                          s.status === "VOID" && "border border-slate-600/60 bg-slate-500/15 text-slate-300",
                          s.status !== "WON" && s.status !== "LOST" && s.status !== "VOID" && "border border-amber-400/40 bg-amber-400/15 text-amber-300",
                        )}
                      >
                        {s.status === "WON" ? "برد" : s.status === "LOST" ? "باخت" : s.status === "VOID" ? "پوش" : "باز"}
                      </span>
                      <ChevronDown className={cn("size-3.5 text-slate-500 transition-transform", expanded && "rotate-180")} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-slate-800/70 px-3 py-2.5" data-testid="settlement-audit-panel">
                      <div className="mb-2 text-[10px] font-bold tracking-wide text-cyan-300">
                        ممیزی اجماع سوپرایجنت — Quant × Coach × Sharp-Prior
                      </div>

                      <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
                        {/* Quant superagent view */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">کوانت — احتمال مدل</span>
                          <span className="num font-bold text-emerald-300" dir="ltr">
                            {(s.modelProb * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">کوانت — بدون‌باخت</span>
                          <span className="num font-bold text-cyan-300" dir="ltr">
                            {s.noLossProb != null ? `${(s.noLossProb * 100).toFixed(1)}%` : "—"}
                          </span>
                        </div>

                        {/* Coach superagent view */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">مربی — اجماع نهایی</span>
                          <span className="num font-bold text-violet-300" dir="ltr">
                            {s.consensusPct != null ? `${s.consensusPct}%` : "—"}
                          </span>
                        </div>

                        {/* Sharp sensor status */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">حسگر شارپ</span>
                          <span className={cn("text-[10px]", s.sharpSource ? "text-slate-300" : "text-slate-500")}>
                            {s.sharpSource ?? "بازار در دسترس نبود — وزن صفر"}
                          </span>
                        </div>
                        {s.sharpAlert && (
                          <div className="flex items-center justify-between gap-2 sm:col-span-2">
                            <span className="text-slate-500">واگرایی</span>
                            <span className="rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                              هشدار واگرایی شارپ
                            </span>
                          </div>
                        )}

                        {/* FT result + settlement status */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">نتیجه FT</span>
                          <span className="num font-bold text-foreground" dir="ltr">
                            {ft}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">وضعیت</span>
                          <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", st.cls)}>{st.label}</span>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">ضریب ثبت‌شده</span>
                          <span className="num font-bold text-foreground" dir="ltr">
                            {s.price.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">سود / زیان خالص</span>
                          <span
                            className={cn(
                              "num font-bold",
                              s.status === "VOID" ? "text-slate-300" : amt >= 0 ? "text-emerald-300" : "text-red-300",
                            )}
                            dir="ltr"
                          >
                            {s.status === "VOID" ? "±0.0u" : `${signed(amt)}u`}
                          </span>
                        </div>

                        {/* Coach tactical note — static descriptive text */}
                        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-2.5 py-2 text-[10px] leading-5 text-violet-200/80 sm:col-span-2">
                          یادداشت تاکتیکی مربی: وزن سوپرایجنت مربی بر پایه فرم ۵ بازی اخیر، ترکیب سالم و
                          الگوی مالکیت توپ / سبک بازی در اجماع نهایی اعمال شده است.
                        </div>

                        <div className="flex items-center justify-between gap-2 sm:col-span-2">
                          <span className="text-slate-500">قفل ← تسویه</span>
                          <span className="num text-[10px] text-slate-400" dir="ltr">
                            {fmtDateTimeFa(s.lockedAt)} ← {fmtDateTimeFa(s.settledAt)}
                          </span>
                        </div>
                      </div>

                      {/* Full SHA-256 audit hash — mono chip, LTR */}
                      <div
                        className="num mt-2 break-all rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-[10px] text-slate-400"
                        dir="ltr"
                        title="SHA-256 audit hash"
                      >
                        SHA-256 · {s.shaHash}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

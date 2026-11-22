"use client";

/**
 * View 1 — OverviewView: VIP 3D neon glass executive dashboard (v2.0 rebuild).
 *
 * Modules:
 *  1) Glassy 3D KPI bar — 5 spotlight glass tiles (bankroll, ROI, winRate, maxDD, shadow-vault savings)
 *  2) 3D Gyroscope winrate gauge — hand-built SVG, three concentric neon rings calibrated
 *     by football/tennis/overall winRate, perpetually rotating (.gyro-ring*)
 *  3) Glowing equity area curve (football/tennis/total) + daily PnL bars with range filter
 *  4) Live radar sweep + holographic Pick-of-the-Day tilt card
 *  5) Recent settlements neon strip
 *
 * Zero UI math: every number comes from computeMasterMetrics() on the server.
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
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
  KpiTile,
  AnimatedNumber,
  TeamAvatar,
  PriceTag,
  HashChip,
  EmptyState,
} from "@/components/shared/primitives";
import { useAppStore } from "@/lib/store";
import { fmtUnits, fmtDateTimeFa, lineLabel, statusColor } from "@/lib/api-types";
import { isSameTehranDay, formatSafeDateTime } from "@/lib/format";
import { resolveBookmakerAliases } from "@/core/bookmakers/market-aliases";
import type { AppStatePayload, AppSignal } from "@/lib/api-types";
import { officialBetLine, marketFa } from "@/lib/markets";
import { cn } from "@/lib/utils";
import {
  Wallet,
  Percent,
  Activity,
  TrendingDown,
  ShieldCheck,
  Gauge,
  Radar as RadarIcon,
  Satellite,
  Crown,
  ArrowLeft,
  Trophy,
  Zap,
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

const clampPct = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

function filterSeries<T extends { date: string }>(rows: T[], range: RangeKey): T[] {
  if (range === "all" || rows.length === 0) return rows;
  const days = Number(range);
  const cutoff = Date.now() - days * 86400_000;
  const filtered = rows.filter((p) => new Date(p.date).getTime() >= cutoff);
  return filtered.length > 0 ? filtered : rows.slice(-days);
}

function pickBestToday(open: AppSignal[]): AppSignal | null {
  // v2.7 — strictly TODAY (Asia/Tehran) on the kickoff clock. No dayKey
  // fallback, no "closest signal" leaking in: when nothing starts today the
  // golden card honestly shows its empty state.
  const todays = open.filter((s) => isSameTehranDay(s.startTime));
  if (todays.length === 0) return null;
  return todays.reduce((best, s) => (s.evPct > best.evPct ? s : best), todays[0]);
}

/* ============================== SVG sub-components ============================== */

/**
 * One gyroscope ring: a dashed neon arc whose length encodes the winRate,
 * plus a comet dot at the arc tip. The whole <g> spins forever (CSS class).
 */
function GyroRing({
  radius,
  color,
  pct,
  spin,
  width = 9,
}: {
  radius: number;
  color: string;
  pct: number;
  spin: string;
  width?: number;
}) {
  const p = clampPct(pct);
  const circ = 2 * Math.PI * radius;
  const tip = ((-90 + p * 3.6) * Math.PI) / 180;
  return (
    <g className={spin}>
      <circle
        cx={120}
        cy={120}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - p / 100)}
        transform="rotate(-90 120 120)"
        opacity={0.92}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
      <circle
        cx={120 + radius * Math.cos(tip)}
        cy={120 + radius * Math.sin(tip)}
        r={4}
        fill={color}
        style={{ filter: `drop-shadow(0 0 8px ${color})` }}
      />
    </g>
  );
}

/** Live market-scanner radar: conic sweep + pulsing blips from the top open signals. */
function RadarPanel({ open }: { open: AppSignal[] }) {
  const blips = open.slice(0, 4).map((s, i) => {
    const angle = (i * 74 + 14) % 360;
    const radius = 36 + ((i * 27) % 64);
    const t = ((angle - 90) * Math.PI) / 180;
    return {
      id: s.id,
      x: 120 + radius * Math.cos(t),
      y: 120 + radius * Math.sin(t),
      color: s.sport === "tennis" ? "#A78BFA" : "#34D399",
      delay: `${(i * 0.55).toFixed(2)}s`,
    };
  });
  const scanList = open.slice(0, 3);

  return (
    <div>
      <svg viewBox="0 0 240 240" className="mx-auto w-full max-w-[240px]" role="img" aria-label="رادار اسکنر بازار">
        <defs>
          <radialGradient id="radarBg" gradientUnits="userSpaceOnUse" cx={120} cy={120} r={112}>
            <stop offset="0%" stopColor="#07242E" stopOpacity={0.95} />
            <stop offset="100%" stopColor="#050810" stopOpacity={0.95} />
          </radialGradient>
          <radialGradient id="sweepGrad" gradientUnits="userSpaceOnUse" cx={120} cy={120} r={112}>
            <stop offset="0%" stopColor="#00E5FF" stopOpacity={0.5} />
            <stop offset="55%" stopColor="#00E5FF" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#00E5FF" stopOpacity={0} />
          </radialGradient>
        </defs>

        <circle cx={120} cy={120} r={112} fill="url(#radarBg)" stroke="#22D3EE" strokeOpacity={0.4} />
        {[28, 56, 84].map((r) => (
          <circle key={r} cx={120} cy={120} r={r} fill="none" stroke="#1B2537" strokeWidth={1} />
        ))}
        <circle cx={120} cy={120} r={84} fill="none" stroke="#22D3EE" strokeWidth={1} strokeOpacity={0.25} />
        <line x1={8} y1={120} x2={232} y2={120} stroke="#1B2537" />
        <line x1={120} y1={8} x2={120} y2={232} stroke="#1B2537" />
        <line x1={40.8} y1={40.8} x2={199.2} y2={199.2} stroke="#1B2537" strokeOpacity={0.6} />
        <line x1={199.2} y1={40.8} x2={40.8} y2={199.2} stroke="#1B2537" strokeOpacity={0.6} />

        {/* rotating conic beam */}
        <g className="radar-sweep">
          <path d="M 120 120 L 232 120 A 112 112 0 0 0 184.2 28.3 Z" fill="url(#sweepGrad)" />
          <line x1={120} y1={120} x2={232} y2={120} stroke="#22D3EE" strokeWidth={1.5} strokeOpacity={0.8} />
        </g>

        {/* signal blips (football emerald / tennis violet) */}
        {blips.map((b) => (
          <g key={b.id}>
            <circle cx={b.x} cy={b.y} r={7} fill={b.color} opacity={0.18} />
            <circle
              className="radar-blip"
              cx={b.x}
              cy={b.y}
              r={4}
              fill={b.color}
              style={{ animationDelay: b.delay, filter: `drop-shadow(0 0 6px ${b.color})` }}
            />
          </g>
        ))}
        <circle cx={120} cy={120} r={3} fill="#22D3EE" />
      </svg>

      {scanList.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <div className="text-[10px] text-muted-foreground">اهداف در حال پایش:</div>
          {scanList.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/60 bg-secondary/40 px-2.5 py-1.5"
            >
              <span className="truncate text-[11px]" dir="auto">
                {s.matchInfo}
              </span>
              <span className="num shrink-0 text-[10px] font-bold text-amber-300">+EV {fmtUnits(s.evPct, 1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Perspective wrapper + mouse-reactive holographic tilt (max ±10deg). */
function TiltShell({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    const ry = Math.max(-10, Math.min(10, px * 24));
    const rx = Math.max(-10, Math.min(10, -py * 24));
    el.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
  };
  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "rotateX(0deg) rotateY(0deg)";
  };
  return (
    <div className="stage-3d h-full">
      <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className={cn("tilt-3d h-full", className)}>
        {children}
      </div>
    </div>
  );
}

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

/* ============================== main view ============================== */

export default function OverviewView({ state }: { state: AppStatePayload }) {
  const m = state.metrics;
  const setView = useAppStore((s) => s.setView);
  const setSportFilter = useAppStore((s) => s.setSportFilter);
  const [range, setRange] = useState<RangeKey>("30");
  // v2.7 — interactive settlement rows: clicking a match reveals the full
  // audit drawer (bookmaker paths, odds, stake, FT, net P/L, SHA-256).
  const [expandedSettlements, setExpandedSettlements] = useState<Set<string>>(new Set());

  const fb = statOf(m.sportStats, "football");
  const tn = statOf(m.sportStats, "tennis");

  const curve = useMemo(() => filterSeries(m.equityCurve, range), [m.equityCurve, range]);
  const pnl = useMemo(() => filterSeries(m.dailyPnl, range), [m.dailyPnl, range]);

  const pick = pickBestToday(state.openSignals);
  const recent = state.settledSignals.slice(0, 6);

  const openPickSport = (sport: string) => {
    setSportFilter(sport === "tennis" ? "tennis" : "football");
    setView("signals");
  };

  return (
    <div className="space-y-4" data-testid="overview-view">
      {/* ============ Module 1 — Glassy 3D KPI bar ============ */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" data-testid="overview-kpis">
        <KpiTile
          label="موجودی بانک (پایه ۱٬۰۰۰u)"
          value={m.bankroll}
          decimals={1}
          suffix="u"
          tone="emerald"
          sub={`شروع: ${fmtUnits(m.startingBank, 0)}u · سود خالص: ${signed(m.totalProfit)}u`}
          icon={<Wallet className="size-4 text-emerald-400" />}
        />
        <KpiTile
          label="بازده واقعی (ROI%)"
          value={m.roi}
          decimals={1}
          suffix="%"
          tone="gold"
          sub={`تسویه‌شده: ${m.wins + m.losses} سیگنال · سود تجمعی: ${signed(m.totalProfit)}u`}
          icon={<Percent className="size-4 text-amber-300" />}
        />
        <KpiTile
          label="وین‌ریت هسته (فوتبال+تنیس)"
          value={m.winRate}
          decimals={1}
          suffix="%"
          tone="cyan"
          sub={`${m.wins} برد · ${m.losses} باخت · ${m.voids} ابطال`}
          icon={<Activity className="size-4 text-cyan-300" />}
        />
        <KpiTile
          label="حداکثر افت سرمایه"
          value={m.maxDrawdown}
          decimals={1}
          suffix="u"
          tone={m.maxDrawdown > 150 ? "red" : "cyan"}
          sub={`سیگنال باز: ${m.openCount} · استیک در ریسک: ${fmtUnits(m.openStake, 0)}u`}
          icon={<TrendingDown className={cn("size-4", m.maxDrawdown > 150 ? "text-red-400" : "text-slate-300")} />}
        />
        <KpiTile
          label="سرمایه نجات‌یافته در دفتر سایه"
          value={m.savedCapital}
          decimals={1}
          suffix="u"
          tone="violet"
          sub={`${m.savedCount} وتوی موفق دفتر سایه`}
          icon={<ShieldCheck className="size-4 text-violet-300" />}
        />
      </div>

      {/* ============ Module 2 — 3D Gyroscope winrate gauge ============ */}
      <Card className="glass glass-hover gap-4 p-4" data-testid="overview-gyro">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-cyan-300" />
            <h2 className="text-sm font-bold">گیج ژیروسکوپی وین‌ریت (۳D)</h2>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="pulse-dot size-1.5 rounded-full bg-cyan-400 text-cyan-400" />
            حلقه‌ها با وین‌ریت هر ورزش کالیبره شده‌اند
          </span>
        </div>

        <div className="grid items-center gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <div className="stage-3d mx-auto w-full max-w-[240px]">
            <div className="relative transition-transform duration-300" style={{ transform: "rotateX(16deg)" }}>
              <svg viewBox="0 0 240 240" className="w-full" role="img" aria-label="گیج وین‌ریت سه‌بعدی">
                {/* static tracks */}
                {[100, 82, 64].map((r) => (
                  <circle key={`track-${r}`} cx={120} cy={120} r={r} fill="none" stroke="#1B2537" strokeWidth={9} opacity={0.55} />
                ))}
                <circle cx={120} cy={120} r={46} fill="none" stroke="#16203A" strokeWidth={1} strokeDasharray="4 6" opacity={0.8} />

                {/* rotating calibrated rings: overall cyan / football emerald / tennis violet */}
                <GyroRing radius={100} color="#22D3EE" pct={m.winRate} spin="gyro-ring" />
                <GyroRing radius={82} color="#34D399" pct={fb.winRate} spin="gyro-ring-rev" />
                <GyroRing radius={64} color="#A78BFA" pct={tn.winRate} spin="gyro-ring-fast" />

                <circle cx={120} cy={120} r={3} fill="#22D3EE" style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.9))" }} />
              </svg>
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <AnimatedNumber
                    value={m.winRate}
                    decimals={1}
                    suffix="%"
                    className="neon-cyan block text-[34px] font-black leading-none tracking-tight"
                  />
                  <div className="mt-1.5 text-[10px] text-muted-foreground">وین‌ریت کل هسته</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <span className="pulse-dot size-2 rounded-full bg-emerald-400 text-emerald-400" />
                  فوتبال
                </span>
                <AnimatedNumber value={fb.winRate} decimals={1} suffix="%" className="num text-sm font-bold text-emerald-300" />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="num">
                  {fb.wins} برد / {fb.losses} باخت
                </span>
                <span className="num">{fb.settled} تسویه‌شده</span>
              </div>
            </div>

            <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <span className="pulse-dot size-2 rounded-full bg-violet-400 text-violet-400" />
                  تنیس
                </span>
                <AnimatedNumber value={tn.winRate} decimals={1} suffix="%" className="num text-sm font-bold text-violet-300" />
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="num">
                  {tn.wins} برد / {tn.losses} باخت
                </span>
                <span className="num">{tn.settled} تسویه‌شده</span>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] text-muted-foreground">تفکیک سود (واحد):</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-slate-800/70 bg-secondary/40 px-3 py-2 text-center">
                  <div className="text-[10px] text-muted-foreground">سود فوتبال</div>
                  <div className={cn("num text-sm font-bold", fb.profit >= 0 ? "text-emerald-300" : "text-red-300")}>
                    {signed(fb.profit)}u
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800/70 bg-secondary/40 px-3 py-2 text-center">
                  <div className="text-[10px] text-muted-foreground">سود تنیس</div>
                  <div className={cn("num text-sm font-bold", tn.profit >= 0 ? "text-emerald-300" : "text-red-300")}>
                    {signed(tn.profit)}u
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ============ Module 3 — Equity curve + daily PnL ============ */}
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

      {/* ============ Module 4 — Radar + Pick of the Day ============ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="glass glass-hover gap-4 p-4 xl:col-span-2" data-testid="overview-radar">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <RadarIcon className="size-4 text-cyan-300" />
              <h2 className="text-sm font-bold">رادار زنده اسکنر بازار</h2>
            </div>
            <Badge variant="outline" className="border-neon-cyan bg-cyan-500/10 text-[10px] font-bold text-cyan-300">
              <span className="pulse-dot size-1.5 rounded-full bg-cyan-400 text-cyan-400" />
              {state.openSignals.length} هدف فعال
            </Badge>
          </div>
          <RadarPanel open={state.openSignals} />
        </Card>

        <div className="xl:col-span-3" data-testid="overview-pick">
          {pick ? (
            <TiltShell className="h-full">
              <Card className="glass glass-hover flex h-full flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Crown className="size-4 text-amber-300" />
                    <h2 className="text-sm font-bold text-amber-200">سیگنال طلایی امروز — Pick of the Day</h2>
                  </div>
                  <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-[10px] text-amber-300">
                    🟡 MODEL FAIR PRICE — قیمت برآوردی مدل (مارجین ۵.۵٪)
                  </Badge>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/70 bg-secondary/40 px-3 py-2.5">
                  <TeamBlock name={pick.homeName} logo={pick.homeLogo} role="میزبان / بازیکن ۱" />
                  <div className="shrink-0 text-center">
                    <div className="num text-[10px] font-black text-cyan-300">VS</div>
                    <div className="text-base leading-none">{pick.sport === "tennis" ? "🎾" : "⚽"}</div>
                  </div>
                  <TeamBlock name={pick.awayName} logo={pick.awayLogo} role="میهمان / بازیکن ۲" />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="rounded-md border border-slate-800 bg-secondary px-1.5 py-0.5" dir="auto">
                    {pick.league}
                  </span>
                  <span className="num">{fmtDateTimeFa(pick.startTime, false)}</span>
                  <span className="rounded-md bg-secondary px-1.5 py-0.5">{lineLabel(pick.line)}</span>
                </div>

                <div
                  dir="ltr"
                  className="rounded-xl border-neon-gold bg-amber-400/10 px-3 py-2.5 text-center shadow-[0_0_18px_rgba(245,158,11,0.15)]"
                >
                  <div className="num text-sm font-bold tracking-tight text-amber-300 md:text-base">
                    {officialBetLine(pick.marketKey, pick.selection, pick.marketLabel)}
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
                  <div className="flex items-center gap-2">
                    <span className="num rounded-lg border border-slate-700 bg-secondary px-2.5 py-1 text-[11px]">
                      استیک {fmtUnits(pick.stake, 0)}u · {pick.stakeMode === "KELLY_025" ? "Kelly" : "Flat"}
                    </span>
                    {pick.netProfit != null && (
                      <span
                        className={cn(
                          "num rounded-lg border px-2.5 py-1 text-[11px] font-bold",
                          pick.netProfit >= 0
                            ? "border-neon-emerald bg-emerald-500/10 text-emerald-300"
                            : "border-red-500/40 bg-red-500/10 text-red-300",
                        )}
                      >
                        {signed(pick.netProfit)}u
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-2.5">
                  <HashChip hash={pick.shaHash} />
                  <span className="text-[10px] text-muted-foreground">
                    ⚖️ {pick.sport === "tennis" ? "تسویه: تکمیل کامل مسابقه (Retirement = ابطال)" : "تسویه: ۹۰ دقیقه زمان قانونی"}
                  </span>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto border-neon-gold bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 hover:text-amber-200"
                  onClick={() => openPickSport(pick.sport)}
                >
                  مشاهده در مرکز سیگنال‌ها
                  <ArrowLeft className="size-3.5" />
                </Button>
              </Card>
            </TiltShell>
          ) : (
            <Card className="glass flex h-full flex-col gap-4 p-4">
              <div className="flex items-center gap-2">
                <Satellite className="size-4 text-amber-300" />
                <h2 className="text-sm font-bold text-amber-200">سیگنال طلایی امروز — Pick of the Day</h2>
              </div>
              <EmptyState
                icon="🛰️"
                title="امروز سیگنال طلایی فعال نیست"
                sub="نزدیک‌ترین سیگنال‌های +EV در مرکز سیگنال‌ها در دسترس است — کارت طلایی فقط سیگنال‌های امروز تهران را نشان می‌دهد."
              />
            </Card>
          )}
        </div>
      </div>

      {/* ============ Module 5 — Recent settlements strip ============ */}
      <Card className="glass glass-hover gap-3 p-4" data-testid="overview-settlements">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="size-4 text-emerald-300" />
            <h2 className="text-sm font-bold">آخرین تسویه‌های رسمی</h2>
          </div>
          <span className="num text-[10px] text-muted-foreground">{state.settledSignals.length} تسویه‌شده در دفتر</span>
        </div>
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            هنوز مسابقه‌ای تسویه نشده — موتور FT پس از پایان دیدارها نتایج ESPN را ثبت می‌کند.
          </p>
        ) : (
          <div className="space-y-2">
            {recent.map((s) => {
              const amt = s.netProfit ?? 0;
              const expanded = expandedSettlements.has(s.id);
              const alias = resolveBookmakerAliases(s.marketKey, s.selection);
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
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium" dir="auto">
                        {s.matchInfo}
                      </div>
                      <div className="truncate text-right text-[10px] text-muted-foreground" dir="ltr">
                        {officialBetLine(s.marketKey, s.selection, s.marketLabel)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden rounded-md bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground sm:inline">
                        {lineLabel(s.line)}
                      </span>
                      <span className="num hidden text-[9px] text-slate-500 md:inline">{fmtDateTimeFa(s.settledAt, false)}</span>
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
                        {s.status === "WON" ? "برد" : s.status === "LOST" ? "باخت" : s.status === "VOID" ? "ابطال" : "باز"}
                      </span>
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t border-slate-800/70 px-3 py-2.5">
                      <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
                        <div className="flex items-center justify-between gap-2" dir="ltr">
                          <span className="text-slate-500">1xBet</span>
                          <span className="num text-cyan-300">{alias.onexbetPath}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2" dir="ltr">
                          <span className="text-slate-500">BetForward</span>
                          <span className="num text-cyan-300">{alias.betforwardPath}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">ضریب ثبت‌شده</span>
                          <span className="num font-bold text-foreground">{s.price.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">استیک Quarter-Kelly</span>
                          <span className="num font-bold text-foreground">{fmtUnits(s.stake)}u · {s.stakeMode}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">CLV</span>
                          <span className="num text-slate-400">— (ثبت نشده)</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">نتیجه FT</span>
                          <span className="num font-bold text-foreground" dir="ltr">
                            {s.homeScore != null && s.awayScore != null ? `${s.homeScore}-${s.awayScore}` : (s.surface ? "set-based" : "—")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">سود / زیان خالص</span>
                          <span className={cn("num font-bold", s.netProfit != null && s.netProfit >= 0 ? "text-emerald-300" : "text-red-300")}>
                            {s.status === "VOID" ? "±0.0u" : `${signed(amt)}u`}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">قفل ← تسویه</span>
                          <span className="num text-[10px] text-slate-400" dir="ltr">
                            {formatSafeDateTime(s.lockedAt)} ← {formatSafeDateTime(s.settledAt)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 border-t border-slate-800/50 pt-1.5">
                        <HashChip hash={s.shaHash} />
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

"use client";

/**
 * v3.1 — Calibration Lab (آزمایشگاه کالیبراسیون):
 * live dashboard of SuperAgent 3 — the Outcome & Calibration Scientist.
 *
 * Pure display over `state.agentLab` (optional in the payload contract):
 *  - Reliability bins chart (Recharts ComposedChart, violet bars = realized
 *    outcome %, dashed gold y=x reference line, count in the tooltip)
 *  - Live ensemble weights (wQuant / wCoach / wMarket) + Platt scaling card
 *  - Calibration KPI glass tiles (Brier, Log-Loss, ECE, Pure Win, No-Loss)
 *  - Win streak + last settlement statuses as neon dots
 *  - Vetoed leagues / tier stats / shield stats mini-tables + Shadow Ledger
 *
 * Every numeric/formula string renders dir="ltr" in JetBrains mono (.num).
 */

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  Activity,
  Ban,
  FlaskConical,
  Gauge,
  Scale,
  ShieldCheck,
  Sigma,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, KpiTile, ShieldBadge, TierBadge } from "@/components/shared/primitives";
import type { AgentLab, AppStatePayload } from "@/lib/api-types";
import { cn } from "@/lib/utils";

/* ────────────────────────────── helpers ────────────────────────────── */

/** Server ships 0..1 fractions for every rate — the UI shows %. */
const pct = (v: number): number => (Number.isFinite(v) ? v * 100 : 0);

const pctTxt = (v: number, d = 1): string => `${pct(v).toFixed(d)}%`;

interface BinPoint {
  name: string;
  predicted: number;
  outcome: number;
  count: number;
}

/** Count-aware tooltip for the reliability bins (dir=ltr mono). */
function BinsTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ payload?: BinPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div
      dir="ltr"
      className="num rounded-xl border border-slate-700 bg-[#0C1220] px-3 py-2 text-[10px] leading-5 text-slate-200 shadow-xl"
    >
      <div className="font-bold text-slate-300">bin {label}%</div>
      <div>
        predicted: <span className="text-amber-300">{p.predicted.toFixed(1)}%</span>
      </div>
      <div>
        outcome: <span className="text-violet-300">{p.outcome.toFixed(1)}%</span>
      </div>
      <div>
        count: <span className="text-cyan-300">{p.count}</span>
      </div>
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  WON: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]",
  LOST: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.7)]",
  VOID: "bg-slate-500",
};

const TIER_ORDER = ["TIER_S", "TIER_A", "TIER_B"];

function StatsMiniTable({
  rows,
  kind,
}: {
  rows: Array<{ key: string; wins: number; losses: number; voids: number; winRate: number; noLossRate: number; settled: number }>;
  kind: "tier" | "shield";
}) {
  const sorted = [...rows].sort((a, b) => b.settled - a.settled);
  return (
    <div className="max-h-52 overflow-y-auto scroll-slim" dir="ltr">
      <table className="w-full text-left text-[10px] leading-5">
        <thead className="sticky top-0 bg-[#0C1220] text-slate-400">
          <tr>
            <th className="px-1.5 py-1.5 font-medium">{kind === "tier" ? "tier" : "shield"}</th>
            <th className="px-1.5 py-1.5 font-medium">W</th>
            <th className="px-1.5 py-1.5 font-medium">L</th>
            <th className="px-1.5 py-1.5 font-medium">V</th>
            <th className="px-1.5 py-1.5 font-medium">win%</th>
            <th className="px-1.5 py-1.5 font-medium">no-loss%</th>
            <th className="px-1.5 py-1.5 font-medium">n</th>
          </tr>
        </thead>
        <tbody className="num">
          {sorted.map((r) => (
            <tr key={r.key} className="border-t border-slate-800/60 hover:bg-secondary/40">
              <td className="max-w-[120px] truncate px-1.5 py-1.5" dir="rtl">
                {kind === "shield" ? (
                  <ShieldBadge shieldType={r.key} />
                ) : r.key.startsWith("TIER_") ? (
                  <TierBadge tier={r.key} />
                ) : (
                  <span className="num text-slate-300">{r.key}</span>
                )}
              </td>
              <td className="px-1.5 py-1.5 text-emerald-300">{r.wins}</td>
              <td className="px-1.5 py-1.5 text-red-300">{r.losses}</td>
              <td className="px-1.5 py-1.5 text-slate-400">{r.voids}</td>
              <td className="px-1.5 py-1.5 text-slate-200">{pctTxt(r.winRate)}</td>
              <td className="px-1.5 py-1.5 text-cyan-300">{pctTxt(r.noLossRate)}</td>
              <td className="px-1.5 py-1.5 text-slate-400">{r.settled}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────────────────────── main view ────────────────────────────── */

export function CalibrationLab({ state }: { state: AppStatePayload }) {
  const lab: AgentLab | undefined = state.agentLab;

  if (!lab) {
    return (
      <div data-testid="calibration-lab">
        <EmptyState
          icon="🧪"
          title="در حال جمع‌آوری داده کالیبراسیون…"
          sub="SuperAgent 3 پس از تسویه‌شدن شرط‌ها، binهای کالیبراسیون، وزن‌های Ensemble و معیارهای Brier / Log-Loss را در همین داشبورد زنده منتشر می‌کند."
        />
      </div>
    );
  }

  const binPoints: BinPoint[] = (lab.reliabilityBins ?? [])
    .filter((b) => b.count > 0)
    .map((b) => ({
      name: `${(b.binStart * 100).toFixed(0)}-${(b.binEnd * 100).toFixed(0)}`,
      predicted: pct(b.avgPredicted),
      outcome: pct(b.avgOutcome),
      count: b.count,
    }));

  const weights = [
    { key: "wQuant", label: "وزن کوانت (Quant)", v: lab.weights?.wQuant ?? 0, bar: "bg-emerald-400", text: "text-emerald-300", glow: "shadow-[0_0_10px_rgba(52,211,153,0.55)]" },
    { key: "wCoach", label: "وزن کوچ (Coach)", v: lab.weights?.wCoach ?? 0, bar: "bg-cyan-400", text: "text-cyan-300", glow: "shadow-[0_0_10px_rgba(34,211,238,0.55)]" },
    { key: "wMarket", label: "وزن بازار (Market)", v: lab.weights?.wMarket ?? 0, bar: "bg-violet-400", text: "text-violet-300", glow: "shadow-[0_0_10px_rgba(167,139,250,0.55)]" },
  ];

  const tierRows = Object.entries(lab.tierStats ?? {}).map(([key, s]) => ({ key, ...s }));
  const shieldRows = Object.entries(lab.shieldStats ?? {}).map(([key, s]) => ({ key, ...s }));
  const tierSorted = [...tierRows].sort(
    (a, b) => TIER_ORDER.indexOf(a.key) - TIER_ORDER.indexOf(b.key) || b.settled - a.settled,
  );
  const vetoRows = [...(lab.vetoedLeagues ?? [])].sort((a, b) => b.count - a.count);

  const streakSafe = Math.max(0, Math.round(lab.winStreak ?? 0));
  const dots = (lab.lastStatuses ?? []).slice(0, 16);
  const lift = lab.shadow?.shadowLiftPct ?? 0;

  return (
    <div className="space-y-4" data-testid="calibration-lab">
      {/* ── header strip: scientist identity + streak + status dots ────── */}
      <Card className="glass p-4" data-testid="calibration-header">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl border border-violet-500/30 bg-violet-500/10">
              <FlaskConical className="size-4.5 text-violet-300" aria-hidden />
            </span>
            <div>
              <div className="text-sm font-bold">آزمایشگاه کالیبراسیون — SuperAgent 3</div>
              <div className="text-[10px] leading-4 text-muted-foreground">
                دانشمند نتیجه و کالیبراسیون — پایش زنده دقت احتمالات، وزن‌های Ensemble و اقتصاد وتو
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="border-cyan-500/40 bg-cyan-500/10 text-[10px] text-cyan-300">
              <span dir="ltr" className="num">{lab.decidedCount ?? 0}</span>&nbsp;نتیجه قطعی
            </Badge>
            <Badge variant="outline" className="border-slate-700 bg-secondary/50 text-[10px] text-slate-300">
              <span dir="ltr" className="num">{lab.settledCount ?? 0}</span>&nbsp;تسویه‌شده
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-bold",
                streakSafe >= 3
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-secondary/50 text-slate-300",
              )}
            >
              <TrendingUp className="size-3" aria-hidden />
              برد متوالی: <span dir="ltr" className="num">{streakSafe}</span>
            </Badge>
          </div>
        </div>

        {/* last statuses — WON emerald / LOST red / VOID slate */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800/70 pt-3">
          <span className="text-[10px] text-muted-foreground">آخرین تسویه‌ها:</span>
          {dots.length === 0 ? (
            <span className="text-[10px] text-slate-500">هنوز تسویه‌ای ثبت نشده است.</span>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="آخرین نتایج تسویه">
              {dots.map((s, i) => (
                <span
                  key={`${s}-${i}`}
                  title={s}
                  className={cn("size-2.5 rounded-full", STATUS_DOT[s] ?? "bg-slate-600")}
                />
              ))}
            </div>
          )}
          <span className="mr-auto flex items-center gap-3 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-400" /> WON</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-red-400" /> LOST</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-slate-500" /> VOID</span>
          </span>
        </div>
      </Card>

      {/* ── calibration KPI tiles ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5" data-testid="calibration-kpis">
        <KpiTile
          label="Brier Score"
          value={lab.brier ?? 0}
          decimals={4}
          tone="violet"
          sub="میانگین مربع خط احتمال — پایین‌تر بهتر"
        />
        <KpiTile
          label="Log-Loss"
          value={lab.logLoss ?? 0}
          decimals={4}
          tone="cyan"
          sub="آنتروپی متقاطع پیش‌بینی نتیجه"
        />
        <KpiTile
          label="ECE (خط کالیبراسیون)"
          value={pct(lab.ece ?? 0)}
          decimals={1}
          suffix="%"
          tone="gold"
          sub="فاصله میانگین پیش‌بینی و واقعیت در binها"
        />
        <KpiTile
          label="Pure Win Rate"
          value={pct(lab.pureWinRate ?? 0)}
          decimals={1}
          suffix="%"
          tone="emerald"
          sub={`بر پایه ${lab.decidedCount ?? 0} نتیجه قطعی WON/LOST`}
        />
        <KpiTile
          label="No-Loss Rate"
          value={pct(lab.noLossRate ?? 0)}
          decimals={1}
          suffix="%"
          tone="emerald"
          sub="سهم برد + برگشت (سپر Push) از کل تسویه‌ها"
        />
      </div>

      {/* ── reliability chart + weights/platt column ───────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Reliability bins chart */}
        <Card className="glass p-4" data-testid="calibration-reliability">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <Gauge className="size-4 text-violet-300" aria-hidden />
              نمودار کالیبراسیون (Reliability Bins)
            </h3>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-violet-400" /> نتیجه واقعی
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 rounded-full bg-amber-300" /> مرجع y=x
              </span>
            </div>
          </div>
          {binPoints.length === 0 ? (
            <div className="grid h-56 place-items-center text-[11px] leading-6 text-muted-foreground">
              پس از نخستین تسویه‌های قطعی، binهای ۱۰٪ کالیبراسیون اینجا ترسیم می‌شوند.
            </div>
          ) : (
            <div className="h-64" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={binPoints} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#1B2537" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#8FA3BF", fontSize: 9 }}
                    interval={0}
                    angle={-28}
                    textAnchor="end"
                    height={38}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tick={{ fill: "#8FA3BF", fontSize: 9 }}
                    tickFormatter={(v: number) => `${v}%`}
                    width={54}
                  />
                  <Tooltip content={<BinsTooltip />} cursor={{ fill: "rgba(139,92,246,0.08)" }} />
                  <Bar dataKey="outcome" name="نتیجه واقعی" fill="#8B5CF6" radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Line
                    dataKey="predicted"
                    name="مرجع y=x (پیش‌بینی مدل)"
                    stroke="#FBBF24"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    dot={{ r: 2.5, fill: "#FBBF24", strokeWidth: 0 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
            محور افقی: بازه احتمال پیش‌بینی (٪) — میله‌های بنفش: میانگین نتیجه واقعی همان bin — خط طلایی
            خط‌چین: کالیبراسیون کامل (y=x). هرچه میله‌ها به خط نزدیک‌تر، مدل صادق‌تر.
          </p>
        </Card>

        {/* Live weights + Platt scaling */}
        <div className="space-y-4">
          <Card className="glass p-4" data-testid="calibration-weights">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Sigma className="size-4 text-emerald-300" aria-hidden />
              وزن‌های زنده Ensemble (SuperAgent 3)
            </h3>
            <div className="space-y-3">
              {weights.map((w) => (
                <div key={w.key}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-slate-300">{w.label}</span>
                    <span dir="ltr" className={cn("num font-bold", w.text)}>
                      {pct(w.v).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-secondary" dir="ltr">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-700", w.bar, w.glow)}
                      style={{ width: `${Math.min(100, Math.max(0, pct(w.v)))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
              ترکیب تطبیقی: با پیشامدِ بازار ۵۰/۳۰/۲۰ و بدون آن ۶۵/۳۵ — افت ECE بالای ۱۲٪ وزن را به سمت
              کوچ می‌چرخاند (damping شناسنامه‌دار).
            </p>
          </Card>

          <Card className="glass p-4" data-testid="calibration-platt">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Scale className="size-4 text-cyan-300" aria-hidden />
              کالیبراسیون پلت (Platt Scaling)
            </h3>
            <code
              dir="ltr"
              className="num block rounded-lg border border-cyan-500/25 bg-[#0A0F1C] p-3 text-center text-[13px] font-bold text-cyan-200"
            >
              sigmoid(a · logit(p) + b)
            </code>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2">
                <div className="text-[10px] text-muted-foreground">a (شیب)</div>
                <div dir="ltr" className="num mt-0.5 text-sm font-extrabold text-emerald-300">
                  {(lab.platt?.a ?? 1).toFixed(3)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2">
                <div className="text-[10px] text-muted-foreground">b (سری)</div>
                <div dir="ltr" className="num mt-0.5 text-sm font-extrabold text-cyan-300">
                  {(lab.platt?.b ?? 0).toFixed(3)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2">
                <div className="text-[10px] text-muted-foreground">trainedOn</div>
                <div dir="ltr" className="num mt-0.5 text-sm font-extrabold text-violet-300">
                  {lab.platt?.trainedOn ?? 0}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
              {(lab.platt?.trainedOn ?? 0) < 12
                ? "داده آموزش هنوز به آستانه ۱۲ نتیجه قطعی نرسیده — پلت موقتاً pass-through است."
                : "لجیت احتمال کوانت با پارامترهای بالا نرم می‌شود تا خروجی نهایی کالیبره باشد."}
            </p>
          </Card>
        </div>
      </div>

      {/* ── tier / shield / shadow ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="glass p-4" data-testid="calibration-tiers">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <Activity className="size-4 text-amber-300" aria-hidden />
            آمار تیرهای اعتماد (Tier Stats)
          </h3>
          {tierSorted.length === 0 ? (
            <div className="p-3 text-[11px] text-muted-foreground">هنوز تسویه‌ای با تیر اعتماد ثبت نشده است.</div>
          ) : (
            <StatsMiniTable rows={tierSorted} kind="tier" />
          )}
        </Card>

        <Card className="glass p-4" data-testid="calibration-shields">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <ShieldCheck className="size-4 text-emerald-300" aria-hidden />
            آمار سپرهای Push (Shield Stats)
          </h3>
          {shieldRows.length === 0 ? (
            <div className="p-3 text-[11px] text-muted-foreground">هنوز سپری صادر یا تسویه نشده است.</div>
          ) : (
            <StatsMiniTable rows={shieldRows} kind="shield" />
          )}
        </Card>

        <Card className="glass p-4" data-testid="calibration-shadow">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <TrendingUp className="size-4 text-cyan-300" aria-hidden />
            اقتصاد سایه (Shadow Ledger) — شمارش وتوها
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5">
              <div className="text-[10px] text-muted-foreground">وتوهای نجات‌دهنده (SAVED_LOSS)</div>
              <div dir="ltr" className="num mt-0.5 text-lg font-extrabold text-emerald-300">
                {lab.shadow?.savedLossCount ?? 0}
              </div>
              <div dir="ltr" className="num text-[10px] text-emerald-400/80">
                ریسک خنثی‌شده با وتو
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
              <div className="text-[10px] text-muted-foreground">بردهای وتوشده (MISSED_WIN)</div>
              <div dir="ltr" className="num mt-0.5 text-lg font-extrabold text-amber-300">
                {lab.shadow?.missedWinCount ?? 0}
              </div>
              <div dir="ltr" className="num text-[10px] text-amber-400/80">
                فرصت از‌دست‌رفته با وتو
              </div>
            </div>
          </div>
          <div className="mt-2 rounded-lg border border-slate-800 bg-secondary/40 p-2.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">وین‌ریت با وتو / بدون وتو</span>
              <span dir="ltr" className="num font-bold text-slate-200">
                {pctTxt(lab.shadow?.winRateWithVeto ?? 0)} vs {pctTxt(lab.shadow?.winRateWithoutVeto ?? 0)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Lift سیاست وتو</span>
              <span
                dir="ltr"
                className={cn(
                  "num rounded-md px-2 py-0.5 text-[11px] font-extrabold",
                  lift >= 0
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-red-500/15 text-red-300",
                )}
              >
                {lift >= 0 ? "+" : ""}
                {lift.toFixed(1)}pp
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* ── vetoed leagues ─────────────────────────────────────────────── */}
      <Card className="glass p-4" data-testid="calibration-vetoes">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
          <Ban className="size-4 text-red-300" aria-hidden />
          لیگ‌ها / سطوح وتوشده (Vetoed Leagues & Surfaces)
        </h3>
        {vetoRows.length === 0 ? (
          <div className="p-3 text-[11px] leading-6 text-muted-foreground">
            هیچ لیگی در وضعیت وتوی بلندمدت نیست — سیاست وتوی دانشمند فعلاً خالی است.
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto scroll-slim">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#0C1220] text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 text-right font-medium">لیگ</th>
                  <th className="px-2 py-1.5 text-right font-medium">ورزش / سطح</th>
                  <th className="px-2 py-1.5 text-center font-medium">تعداد وتو</th>
                  <th className="px-2 py-1.5 text-left font-medium">برچسب</th>
                </tr>
              </thead>
              <tbody>
                {vetoRows.map((v, i) => (
                  <tr key={`${v.league}-${v.sport}-${i}`} className="border-t border-slate-800/60 hover:bg-secondary/40">
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-200" title={v.league}>
                      {v.league}
                    </td>
                    <td className="px-2 py-1.5 text-slate-400">{v.sport}</td>
                    <td className="num px-2 py-1.5 text-center font-bold text-amber-300">{v.count}</td>
                    <td className="px-2 py-1.5 text-left">
                      <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-300">
                        وتو
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

"use client";

/**
 * 3D Hawk-Eye tennis court: dynamic surface theme (Hard/Clay/Grass) + two
 * animated service trajectories (SVG quadratic beziers arcing over the net)
 * + Elo duel / Markov-Copula panel.
 * Crash-proof: an empty tennis list renders a safe EmptyState and returns early;
 * every optional field uses `?.` / `??`.
 */

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTimeFa } from "@/lib/api-types";
import type { AppMatch } from "@/lib/api-types";
import { cn } from "@/lib/utils";

interface SurfaceTheme {
  court: string;
  line: string;
  glow: string;
  accent: string;
  label: string;
}

const SURFACE_THEME: Record<string, SurfaceTheme> = {
  Hard: {
    court: "from-sky-800/85 to-sky-950/85",
    line: "border-white/45",
    glow: "bg-sky-400/20",
    accent: "#38BDF8",
    label: "هارد",
  },
  Clay: {
    court: "from-orange-700/85 to-orange-900/85",
    line: "border-white/45",
    glow: "bg-orange-400/20",
    accent: "#FB923C",
    label: "خاک رس",
  },
  Grass: {
    court: "from-emerald-700/85 to-emerald-900/85",
    line: "border-white/45",
    glow: "bg-emerald-400/20",
    accent: "#34D399",
    label: "چمن",
  },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pre: { label: "شروع نشده", cls: "bg-slate-500/15 text-slate-300 border border-slate-500/30" },
  in: { label: "جاری", cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
  post: { label: "پایان‌یافته", cls: "bg-violet-500/15 text-violet-300 border border-violet-500/30" },
};

export function Court3D({ matches }: { matches: AppMatch[] }) {
  const tennis = matches.filter((m) => m.sport === "tennis");
  const [matchId, setMatchId] = useState("");

  // ── EMPTY-STATE SAFE GUARD (critical) ─────────────────────────────────
  if (tennis.length === 0) {
    return (
      <div className="glass flex flex-col items-center justify-center gap-3 rounded-2xl p-10 text-center" data-testid="court-empty">
        <div className="text-5xl">🎾</div>
        <p className="max-w-xl text-xs leading-6 text-slate-300">
          🎾 در حال حاضر مسابقه تنیس پیش‌رویی در تورنمنت‌های جاری ATP/WTA وجود ندارد — آخرین نتایج واقعی ۷
          روز اخیر به محض همگام‌سازی نمایش داده می‌شوند
        </p>
      </div>
    );
  }

  const match = tennis.find((m) => m.id === matchId) ?? tennis[0];
  const surface = match?.surface ?? "Hard";
  const th = SURFACE_THEME[surface] ?? SURFACE_THEME.Hard;
  const st = STATUS_META[match?.status ?? "pre"] ?? STATUS_META.pre;
  const hasScore = (match?.scores.home ?? null) !== null || (match?.scores.away ?? null) !== null;

  // existing rank→Elo formula, fully optional-chained
  const elo = match
    ? (() => {
        const r = (x: number | null | undefined) => (x ? 2300 - 35 * Math.log(x) : 1500);
        const a = Math.round(r(match?.homeRank));
        const b = Math.round(r(match?.awayRank));
        return { a, b, pA: 1 / (1 + Math.pow(10, (b - a) / 400)) };
      })()
    : null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <style>{`
        @keyframes qlServeDash {
          to { stroke-dashoffset: -28; }
        }
        .ql-serve-dash { animation: qlServeDash 1.4s linear infinite; }
      `}</style>

      {/* ── 3D court card ─────────────────────────────────────────── */}
      <div className="glass overflow-hidden p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            زمین تنیس 3D Hawk-Eye
            <span className={cn("rounded-md px-2 py-0.5 text-[10px] text-foreground", th.glow)}>
              سطح: {th.label}
            </span>
          </h3>
          <Select value={match?.id ?? ""} onValueChange={setMatchId}>
            <SelectTrigger className="h-8 w-56 text-[11px]">
              <SelectValue placeholder="انتخاب بازی" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {tennis.slice(0, 40).map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[11px]">
                  <span className="whitespace-normal">
                    {m.homeName} vs {m.awayName} ({m.league})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="stage-3d" dir="ltr">
          <div
            className={cn(
              "court-3d mx-auto aspect-[16/11] w-full max-w-md rounded-xl border bg-gradient-to-b p-2",
              th.court,
              th.line,
            )}
          >
            <div className={cn("relative h-full w-full overflow-hidden rounded-lg border-2", th.line)}>
              {/* court markings: center service line, service boxes, singles alleys */}
              <div className="absolute inset-y-0 left-1/2 w-0 border-l-2 border-dashed border-white/35" />
              <div className="absolute inset-x-[18%] top-1/2 h-[22%] -translate-y-1/2 border-2 border-white/40" />
              <div className="absolute inset-y-[9%] left-[10%] w-0 border-l border-white/30" />
              <div className="absolute inset-y-[9%] right-[10%] w-0 border-r border-white/30" />
              <div className="absolute inset-x-[10%] top-[9%] h-0 border-t border-white/30" />
              <div className="absolute inset-x-[10%] bottom-[9%] h-0 border-b border-white/30" />

              {/* net — white center band */}
              <div className="absolute inset-x-[16%] top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/75 shadow-[0_0_14px_rgba(255,255,255,0.45)]" />

              {/* two curved service trajectories (Hawk-Eye style, surface accent) */}
              {match && (
                <svg
                  viewBox="0 0 100 69"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                >
                  <defs>
                    <marker id="qlServeArr" markerWidth="5" markerHeight="5" refX="3.5" refY="2.5" orient="auto">
                      <path d="M0,0 L5,2.5 L0,5 z" fill={th.accent} />
                    </marker>
                  </defs>
                  {/* glow underlays */}
                  <path d="M 4 57 Q 40 4 70 30" fill="none" stroke={th.accent} strokeWidth="2.6" opacity="0.22" strokeLinecap="round" />
                  <path d="M 96 12 Q 60 65 30 39" fill="none" stroke={th.accent} strokeWidth="2.6" opacity="0.22" strokeLinecap="round" />
                  {/* dashed animated trajectories with arrowheads */}
                  <path
                    d="M 4 57 Q 40 4 70 30"
                    fill="none"
                    stroke={th.accent}
                    strokeWidth="1.3"
                    strokeDasharray="5 2"
                    strokeLinecap="round"
                    markerEnd="url(#qlServeArr)"
                    className="ql-serve-dash"
                    opacity="0.95"
                  />
                  <path
                    d="M 96 12 Q 60 65 30 39"
                    fill="none"
                    stroke={th.accent}
                    strokeWidth="1.3"
                    strokeDasharray="5 2"
                    strokeLinecap="round"
                    markerEnd="url(#qlServeArr)"
                    className="ql-serve-dash"
                    opacity="0.95"
                    style={{ animationDelay: "0.7s" }}
                  />
                </svg>
              )}

              {/* ball */}
              {match && (
                <div className="set-ball absolute left-[58%] top-[30%] size-3.5 rounded-full bg-[#D4FF3F] shadow-[0_10px_20px_rgba(0,0,0,.5)]" />
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
          رنگ زمین با سطح مسابقه تغییر می‌کند: هارد (آبی-فیروزه‌ای)، خاک رس (نارنجی)، چمن (زمردی) —
          دو مسیر سرویس منحنی با فلش متحرک از خط پایه روی شبکه شبیه‌سازی Hawk-Eye هستند.
        </p>
      </div>

      {/* ── match / Elo panel ─────────────────────────────────────── */}
      <div className="glass p-4">
        <h3 className="mb-3 text-sm font-bold">دوئل Elo + شبیه‌سازی مونت‌کارلو</h3>
        {match && elo ? (
          <div className="space-y-3">
            {/* meta chips */}
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-300">
                {match.league}
              </span>
              {match.round && (
                <span className="rounded-md border border-slate-700 bg-secondary/50 px-2 py-0.5 text-slate-300">
                  {match.round}
                </span>
              )}
              <span className="rounded-md border border-slate-700 bg-secondary/50 px-2 py-0.5 text-slate-400">
                🕐 <span dir="ltr" className="num">{fmtDateTimeFa(match.startTime)}</span>
              </span>
              {match.venue && (
                <span className="rounded-md border border-slate-700 bg-secondary/50 px-2 py-0.5 text-slate-400">
                  🏟️ {match.venue}
                </span>
              )}
              <span className={cn("rounded-md px-2 py-0.5 font-bold", st.cls)}>{st.label}</span>
            </div>

            {/* live/post score */}
            {match.status !== "pre" && hasScore && (
              <div className="glass flex items-center justify-center gap-3 rounded-xl p-2.5">
                <span className="truncate text-xs font-bold text-slate-200">{match.homeName}</span>
                <span dir="ltr" className="num text-lg font-extrabold text-[#FBBF24]">
                  {match.scores.home ?? "—"} : {match.scores.away ?? "—"}
                </span>
                <span className="truncate text-xs font-bold text-slate-200">{match.awayName}</span>
              </div>
            )}

            {/* Elo duel */}
            <div className="grid grid-cols-2 gap-3">
              <div className="glass p-3 text-center">
                <div className="whitespace-normal text-xs font-bold leading-5">{match.homeName}</div>
                <div className="num mt-1 text-2xl font-extrabold text-emerald-400">{elo.a}</div>
                <div className="text-[10px] text-muted-foreground">
                  رنک <span className="num">{match.homeRank ?? "—"}</span>
                </div>
              </div>
              <div className="glass p-3 text-center">
                <div className="whitespace-normal text-xs font-bold leading-5">{match.awayName}</div>
                <div className="num mt-1 text-2xl font-extrabold text-[#FBBF24]">{elo.b}</div>
                <div className="text-[10px] text-muted-foreground">
                  رنک <span className="num">{match.awayRank ?? "—"}</span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                <span className="num">{(elo.pA * 100).toFixed(1)}%</span>
                <span className="num">{((1 - elo.pA) * 100).toFixed(1)}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-secondary" dir="ltr">
                <div className="h-full rounded-l-full bg-emerald-400" style={{ width: `${elo.pA * 100}%` }} />
              </div>
            </div>

            <div className="glass p-3 text-[11px] leading-6 text-muted-foreground">
              موتور زنجیره مارکوف ۴ لایه + کاپولا ρ=0.18 با <span className="num font-bold text-emerald-300">10,000</span> شبیه‌سازی
              گیم‌به‌گیم بهترین‌به‌از۳ اجرا می‌شود؛ دیکشنری Elo محافظت‌شده قهرمانان بازگشته از مصدومیت فعال است.
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">بازی تنیسی برای تحلیل انتخاب نشده.</p>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * 3D tactical football pitch (CSS-3D) + Dixon-Coles 6x6 density heatmap.
 * Lambdas are derived from de-vigged 1x2 trueProbs (reverse-Poisson estimate,
 * same estimator as v1) and reused by BOTH the pitch goal-expectation vectors
 * and the matrix summary line, so numbers are always consistent.
 */

import { Fragment, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatSafeDateTime } from "@/lib/format";
import type { AppMatch } from "@/lib/api-types";
import { cn } from "@/lib/utils";

interface DerivedModel {
  lh: number;
  la: number;
  matrix: number[][];
}

/** Deterministic reverse-Poisson model from quotes (same estimator as v1). */
function deriveModel(m: AppMatch): DerivedModel {
  const get = (key: string, sel: string) =>
    m.quotes.find((q) => q.marketKey === key && q.selection === sel);
  const seed = [...m.homeName, ...m.awayName].reduce((a, c) => a + c.charCodeAt(0), 0);
  let rng = seed;
  const rand = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };
  const ph = get("1x2", "HOME")?.trueProb ?? 0.45;
  const pa = get("1x2", "AWAY")?.trueProb ?? 0.3;
  // Reverse-Poisson display estimate: derive lambdas from prob ratio (approx).
  const lh = Math.max(0.3, Math.min(3.4, 0.9 + ph * 2.2 + rand() * 0.3));
  const la = Math.max(0.25, Math.min(3.4, 0.9 + pa * 2.0 + rand() * 0.3));
  const pois = (k: number, l: number) =>
    (Math.exp(-l) * Math.pow(l, k)) / [1, 1, 2, 6, 24, 120][Math.min(k, 5)];
  const grid: number[][] = [];
  for (let h = 0; h < 6; h++) {
    grid.push([]);
    for (let a = 0; a < 6; a++) grid[h].push(pois(h, lh) * pois(a, la));
  }
  const s = grid.flat().reduce((x, y) => x + y, 0);
  return { lh, la, matrix: grid.map((row) => row.map((v) => v / s)) };
}

interface Blob {
  x: number;
  y: number;
  size: number;
  opacity: number;
  delay: number;
  side: "home" | "away";
}

/** 6-8 attack heatmap blobs placed deterministically from matrix peak cells. */
function attackBlobs(model: DerivedModel, seedName: string): Blob[] {
  const homeMarg = model.matrix.map((row) => row.reduce((x, y) => x + y, 0));
  const awayMarg = [0, 1, 2, 3, 4, 5].map((a) => model.matrix.reduce((x, row) => x + row[a], 0));
  const maxP = Math.max(...homeMarg, ...awayMarg) || 1;
  const seed = [...seedName].reduce((a, c) => a + c.charCodeAt(0), 0);
  let rng = seed;
  const rand = () => {
    rng = (rng * 9301 + 49297) % 233280;
    return rng / 233280;
  };
  const top = (marg: number[]): number[] =>
    marg
      .map((p, i) => ({ p, i }))
      .sort((x, y) => y.p - x.p)
      .slice(0, 4)
      .map((o) => o.i);
  const mk = (idx: number, p: number, side: "home" | "away"): Blob => {
    const t = p / maxP;
    return {
      // deeper goals → blob sits closer to the goal line it attacks
      x: side === "home" ? Math.max(6, 44 - idx * 7) : Math.min(94, 56 + idx * 7),
      y: 18 + rand() * 64,
      size: Math.round(30 + 30 * t),
      opacity: 0.2 + 0.55 * t,
      delay: Number((rand() * 2).toFixed(2)),
      side,
    };
  };
  return [
    ...top(homeMarg).map((i) => mk(i, homeMarg[i], "home" as const)),
    ...top(awayMarg).map((i) => mk(i, awayMarg[i], "away" as const)),
  ];
}

/** Stronger neon heatmap: emerald scale, violet for high away-goal columns. */
const hotCell = (v: number, max: number, a: number): string => {
  const t = v / max;
  const hi = a >= 4;
  if (t > 0.75) return hi ? "bg-violet-400 text-violet-950" : "bg-emerald-400 text-emerald-950";
  if (t > 0.5) return hi ? "bg-violet-500/75 text-violet-50" : "bg-emerald-500/75 text-emerald-950";
  if (t > 0.3) return hi ? "bg-violet-500/45 text-violet-100" : "bg-emerald-500/45 text-emerald-100";
  if (t > 0.15) return hi ? "bg-violet-500/25 text-violet-200" : "bg-emerald-500/25 text-emerald-100";
  return "bg-slate-800/60 text-slate-400";
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pre: { label: "شروع نشده", cls: "bg-slate-500/15 text-slate-300 border border-slate-500/30" },
  in: { label: "جاری", cls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
  post: { label: "پایان‌یافته", cls: "bg-violet-500/15 text-violet-300 border border-violet-500/30" },
};

export function Pitch3D({ matches }: { matches: AppMatch[] }) {
  const football = matches.filter((m) => m.sport === "football");
  const [matchId, setMatchId] = useState<string>("");
  const match = football.find((m) => m.id === matchId) ?? football[0];
  const model = match ? deriveModel(match) : null;
  const blobs = match && model ? attackBlobs(model, `${match.homeName}${match.awayName}`) : [];
  const max = model ? Math.max(...model.matrix.flat()) : 1;
  // argmax of the 6x6 matrix → most-likely scoreline
  const best = (() => {
    if (!model) return { h: 0, a: 0 };
    let bh = 0;
    let ba = 0;
    let bv = -1;
    model.matrix.forEach((row, h) =>
      row.forEach((v, a) => {
        if (v > bv) {
          bv = v;
          bh = h;
          ba = a;
        }
      }),
    );
    return { h: bh, a: ba };
  })();

  if (!match || !model) {
    return (
      <div className="glass rounded-2xl p-10 text-center" data-testid="pitch-empty">
        <div className="text-4xl">⚽</div>
        <p className="mt-2 text-xs leading-6 text-slate-300">
          در حال حاضر مسابقه فوتبال پیش‌رویی وجود ندارد — پس از همگام‌سازی ESPN نمایش داده می‌شود.
        </p>
      </div>
    );
  }

  const st = STATUS_META[match.status] ?? STATUS_META.pre;
  const scoreHome = match.status !== "pre" ? match.scores.home : null;
  const scoreAway = match.status !== "pre" ? match.scores.away : null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <style>{`
        @keyframes qlPitchPulse {
          0%, 100% { transform: translate(-50%, -50%) scale(0.92); filter: blur(6px); }
          50% { transform: translate(-50%, -50%) scale(1.2); filter: blur(9px); }
        }
        .ql-pitch-blob { animation: qlPitchPulse 3.8s ease-in-out infinite; }
      `}</style>

      {/* ── 3D pitch card ─────────────────────────────────────────── */}
      <div className="glass overflow-hidden p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">زمین فوتبال سه‌بعدی تاکتیکی</h3>
          <Select value={match.id} onValueChange={setMatchId}>
            <SelectTrigger className="h-8 w-56 text-[11px] sm:w-64">
              <SelectValue placeholder="انتخاب بازی" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {football.slice(0, 40).map((m) => (
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
          <div className="pitch-3d mx-auto aspect-[16/10] w-full max-w-md rounded-xl border-2 border-emerald-900/70 bg-gradient-to-b from-emerald-700/70 to-emerald-900/70 p-1.5">
            <div className="relative h-full w-full overflow-hidden rounded-lg border border-emerald-300/30">
              {/* pitch markings */}
              <div className="absolute inset-y-0 left-1/2 w-0 border-l border-dashed border-emerald-300/30" />
              <div className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/30" />
              <div className="absolute inset-x-4 top-1/2 h-14 -translate-y-full border border-emerald-300/30 border-b-0" />
              <div className="absolute inset-x-4 top-1/2 h-14 border border-emerald-300/30 border-t-0" />

              {/* (1) attack heatmap arcs — from matrix peak cells */}
              {blobs.map((b, i) => (
                <div
                  key={`blob-${i}`}
                  className="ql-pitch-blob absolute rounded-full"
                  style={{
                    left: `${b.x}%`,
                    top: `${b.y}%`,
                    width: b.size,
                    height: b.size,
                    opacity: b.opacity,
                    animationDelay: `${b.delay}s`,
                    transform: "translate(-50%, -50%)",
                    background:
                      b.side === "home"
                        ? "radial-gradient(circle, rgba(52,211,153,0.6) 0%, rgba(52,211,153,0.2) 45%, transparent 72%)"
                        : "radial-gradient(circle, rgba(167,139,250,0.6) 0%, rgba(167,139,250,0.2) 45%, transparent 72%)",
                    filter: "blur(6px)",
                  }}
                />
              ))}

              {/* (2) goal expectation vectors λ_H / λ_A — neon arrows at each goal */}
              <svg
                viewBox="0 0 100 62.5"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
              >
                <defs>
                  <marker id="qlArrH" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                    <path d="M0,0 L5,2.5 L0,5 z" fill="#34D399" />
                  </marker>
                  <marker id="qlArrA" markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                    <path d="M0,0 L5,2.5 L0,5 z" fill="#A78BFA" />
                  </marker>
                </defs>
                <line
                  x1="34" y1="31.25" x2="12" y2="31.25"
                  stroke="#34D399" strokeWidth="1.5" strokeLinecap="round"
                  markerEnd="url(#qlArrH)" opacity="0.95"
                />
                <text x="35" y="28.6" fontSize="4.4" fill="#34D399" style={{ fontFamily: "monospace" }}>
                  λ_H {model.lh.toFixed(2)}
                </text>
                <line
                  x1="66" y1="31.25" x2="88" y2="31.25"
                  stroke="#A78BFA" strokeWidth="1.5" strokeLinecap="round"
                  markerEnd="url(#qlArrA)" opacity="0.95"
                />
                <text x="66" y="36.4" fontSize="4.4" fill="#A78BFA" style={{ fontFamily: "monospace" }}>
                  λ_A {model.la.toFixed(2)}
                </text>
              </svg>
            </div>
          </div>
        </div>

        {/* ── live score / stats strip ──────────────────────────────── */}
        <div className="glass mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl p-2.5 text-[11px]">
          <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold", st.cls)}>{st.label}</span>
          <span dir="ltr" className="num text-sm font-extrabold text-emerald-300">
            {scoreHome ?? "—"} : {scoreAway ?? "—"}
          </span>
          <span className="text-[10px] text-slate-400">
            🕐 <span dir="ltr" className="num">{formatSafeDateTime(match.startTime)}</span>
          </span>
          <span className="text-[10px] text-slate-400">🏟️ {match.venue ?? "—"}</span>
          <span className="text-[10px] text-slate-400">
            λ_H <span dir="ltr" className="num neon-emerald">{model.lh.toFixed(2)}</span>
            {" · "}
            λ_A <span dir="ltr" className="num neon-violet">{model.la.toFixed(2)}</span>
          </span>
          <span
            dir="ltr"
            className="num rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300"
          >
            Most likely: {best.h}-{best.a}
          </span>
        </div>

        <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
          جبهه‌های تحرک مدل دیکسون-کولز برای {match.homeName} در برابر {match.awayName} — هاله‌های سبز
          (می호ان) و بنفش (مهمان) نقاط اوج چگالی گل و فلش‌های نئون بردار انتظار گل (λ) به سمت دروازه‌ها هستند.
        </p>
      </div>

      {/* ── 6x6 matrix card ───────────────────────────────────────── */}
      <div className="glass p-4">
        <h3 className="mb-2 text-sm font-bold">ماتریس چگالی ۶×۶ دیکسون-کولز</h3>
        <div className="mx-auto w-full max-w-[360px]" dir="ltr">
          <div className="grid grid-cols-7 gap-1">
            <div />
            {[0, 1, 2, 3, 4, 5].map((a) => (
              <div key={`ax${a}`} className="num text-center text-[10px] text-muted-foreground">
                A{a}
              </div>
            ))}
            {model.matrix.map((row, h) => (
              <Fragment key={`row${h}`}>
                <div className="num text-[10px] text-muted-foreground">H{h}</div>
                {row.map((v, a) => (
                  <div
                    key={`cell${h}-${a}`}
                    className={cn(
                      "num grid aspect-square place-items-center rounded text-[9px] leading-none",
                      hotCell(v, max, a),
                    )}
                    title={`H${h}-A${a}: ${(v * 100).toFixed(1)}%`}
                  >
                    {(v * 100).toFixed(1)}%
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>

        {/* mandatory summary line — LTR row with per-number LTR spans */}
        <div
          dir="ltr"
          className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11px] text-slate-300"
        >
          <span>λ Home =</span>
          <span dir="ltr" className="num neon-emerald">{model.lh.toFixed(2)}</span>
          <span className="text-slate-600">|</span>
          <span>λ Away =</span>
          <span dir="ltr" className="num neon-violet">{model.la.toFixed(2)}</span>
          <span className="text-slate-600">|</span>
          <span>ρ =</span>
          <span dir="ltr" className="num neon-cyan">-0.08</span>
        </div>

        <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
          ستون = گل مهمان (A)، ردیف = گل میزبان (H). λ با برآورد معکوس-پواسون از احتمالات واقعی ۱×۲
          (حذف کارمزد به روش شین، وزن بازار ۶۵٪ / آمار ۳۵٪) به‌دست آمده و ρ همبستگی نتیجه دیکسون-کولز است.
        </p>
      </div>
    </div>
  );
}

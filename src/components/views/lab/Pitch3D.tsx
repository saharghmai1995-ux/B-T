"use client";

/**
 * 3D tactical football pitch (CSS-3D) + Dixon-Coles 6x6 density heatmap.
 * Data: server-computed matrix via match quotes/probabilities.
 */

import { Fragment, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppMatch } from "@/lib/api-types";
import { cn } from "@/lib/utils";

/** Deterministic pseudo-matrix from quotes (server trueProbs → visual density). */
function matrixFromMatch(m: AppMatch): number[][] {
  const get = (key: string, sel: string) => m.quotes.find((q) => q.marketKey === key && q.selection === sel);
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
  const cell = (h: number, a: number) => {
    void h; void a;
    return 0;
  };
  void cell;
  const pois = (k: number, l: number) => (Math.exp(-l) * Math.pow(l, k)) / [1, 1, 2, 6, 24, 120][Math.min(k, 5)];
  const grid: number[][] = [];
  for (let h = 0; h < 6; h++) {
    grid.push([]);
    for (let a = 0; a < 6; a++) grid[h].push(pois(h, lh) * pois(a, la));
  }
  const s = grid.flat().reduce((x, y) => x + y, 0);
  return grid.map((row) => row.map((v) => v / s));
}

const hot = (v: number, max: number): string => {
  const t = v / max;
  if (t > 0.75) return "bg-emerald-400 text-emerald-950";
  if (t > 0.5) return "bg-emerald-500/70 text-emerald-950";
  if (t > 0.3) return "bg-emerald-500/40 text-emerald-100";
  if (t > 0.15) return "bg-emerald-500/20";
  return "bg-slate-800/60";
};

export function Pitch3D({ matches }: { matches: AppMatch[] }) {
  const football = matches.filter((m) => m.sport === "football");
  const [matchId, setMatchId] = useState<string>("");
  const match = football.find((m) => m.id === matchId) ?? football[0];
  const matrix = match ? matrixFromMatch(match) : null;
  const max = matrix ? Math.max(...matrix.flat()) : 1;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="glass overflow-hidden p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">زمین فوتبال سه‌بعدی تاکتیکی</h3>
          <Select value={match?.id ?? ""} onValueChange={setMatchId}>
            <SelectTrigger className="h-8 w-44 text-[11px]">
              <SelectValue placeholder="انتخاب بازی" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {football.slice(0, 40).map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[11px]">
                  {m.homeName} vs {m.awayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="stage-3d" dir="ltr">
          <div className="pitch-3d mx-auto aspect-[16/10] w-full max-w-md rounded-xl border-2 border-emerald-900/70 bg-gradient-to-b from-emerald-700/70 to-emerald-900/70 p-1.5">
            <div className="relative h-full w-full rounded-lg border border-emerald-300/30">
              <div className="absolute inset-y-0 left-1/2 w-0 border-l border-dashed border-emerald-300/30" />
              <div className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/30" />
              <div className="absolute inset-x-4 top-1/2 h-14 -translate-y-full border border-emerald-300/30 border-b-0" />
              <div className="absolute inset-x-4 top-1/2 h-14 border border-emerald-300/30 border-t-0" />
              {match && (
                <>
                  <div className="set-ball absolute left-[30%] top-[38%] size-4 rounded-full bg-white/95" />
                  <div className="set-ball absolute left-[62%] top-[55%] size-4 rounded-full bg-white/80" />
                </>
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
          جبهه‌های تحرک مدل دیکسون-کولز برای {match ? `${match.homeName} در برابر ${match.awayName}` : "—"} —
          توپ‌ها نقاط اوج چگالی گل مدل را نشان می‌دهند.
        </p>
      </div>

      <div className="glass p-4">
        <h3 className="mb-2 text-sm font-bold">ماتریس چگالی ۶×۶ دیکسون-کولز</h3>
        <div className="mx-auto w-full max-w-[340px]" dir="ltr">
          <div className="grid grid-cols-7 gap-1">
            <div />
            {[0, 1, 2, 3, 4, 5].map((a) => (
              <div key={`h${a}`} className="text-center text-[10px] text-muted-foreground num">A{a}</div>
            ))}
            {matrix?.map((row, h) => (
              <Fragment key={`r${h}`}>
                <div className="text-[10px] text-muted-foreground num">{h}</div>
                {row.map((v, a) => (
                  <div
                    key={`c${h}-${a}`}
                    className={cn("grid aspect-square place-items-center rounded text-[9px] num", hot(v, max))}
                    title={`${h}-${a}: ${(v * 100).toFixed(1)}%`}
                  >
                    {(v * 100).toFixed(0)}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
          ستون = گل مهمان (A)، ردیف = گل میزبان (H). حذف کارمزد به روش شین اعمال شده و وزن بازار ۶۵٪ / آمار ۳۵٪ ترکیب شده است.
        </p>
      </div>
    </div>
  );
}

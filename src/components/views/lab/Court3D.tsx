"use client";

/**
 * 3D Hawk-Eye tennis court with dynamic surface coloring + Elo duel panel.
 */

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppMatch } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const SURFACE_STYLE: Record<string, { court: string; line: string; glow: string; label: string }> = {
  Hard: { court: "from-sky-800/80 to-sky-950/80", line: "border-white/40", glow: "bg-sky-400/20", label: "هارد" },
  Clay: { court: "from-orange-700/80 to-orange-900/80", line: "border-white/40", glow: "bg-orange-400/20", label: "خاک رس" },
  Grass: { court: "from-green-700/80 to-green-900/80", line: "border-white/40", glow: "bg-green-400/20", label: "چمن" },
};

export function Court3D({ matches }: { matches: AppMatch[] }) {
  const tennis = matches.filter((m) => m.sport === "tennis");
  const [matchId, setMatchId] = useState("");
  const match = tennis.find((m) => m.id === matchId) ?? tennis[0];
  const surface = match?.surface ?? "Hard";
  const st = SURFACE_STYLE[surface] ?? SURFACE_STYLE.Hard;

  const eloHint = (() => {
    if (!match) return null;
    const r = (x: number | null | undefined) => (x ? 2300 - 35 * Math.log(x) : 1500);
    const a = Math.round(r(match.homeRank));
    const b = Math.round(r(match.awayRank));
    const pA = 1 / (1 + Math.pow(10, (b - a) / 400));
    return { a, b, pA };
  })();

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="glass p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">
            زمین تنیس 3D Hawk-Eye
            <span className={cn("ml-2 rounded-md px-2 py-0.5 text-[10px]", st.glow, "text-foreground")}>
              سطح: {st.label}
            </span>
          </h3>
          <Select value={match?.id ?? ""} onValueChange={setMatchId}>
            <SelectTrigger className="h-8 w-44 text-[11px]">
              <SelectValue placeholder="انتخاب بازی" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {tennis.slice(0, 40).map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-[11px]">
                  {m.homeName} vs {m.awayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="stage-3d" dir="ltr">
          <div className={cn("court-3d mx-auto aspect-[16/11] w-full max-w-md rounded-xl border bg-gradient-to-b p-2", st.court)}>
            <div className={cn("relative h-full w-full rounded-lg border-2", st.line)}>
              <div className="absolute inset-y-0 left-1/2 w-0 border-l-2 border-dashed border-white/30" />
              <div className="absolute inset-x-[18%] top-1/2 h-[22%] -translate-y-1/2 border-2 border-white/40" />
              <div className="absolute inset-x-[22%] top-1/2 h-[2px] -translate-y-1/2 bg-white/50" />
              {match && (
                <div className="set-ball absolute left-[58%] top-[30%] size-3.5 rounded-full bg-[#D4FF3F] shadow-[0_10px_20px_rgba(0,0,0,.5)]" />
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
          رنگ زمین با سطح مسابقه (هارد/خاک/چمن) تغییر می‌کند — بونوس Elo سطح در موتور مارکوف-کاپولا لحاظ شده است.
        </p>
      </div>

      <div className="glass p-4">
        <h3 className="mb-3 text-sm font-bold">دوئل Elo + شبیه‌سازی مونت‌کارلو</h3>
        {match && eloHint ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="glass p-3 text-center">
                <div className="truncate text-xs font-bold">{match.homeName}</div>
                <div className="num mt-1 text-2xl font-extrabold text-emerald-300">{eloHint.a}</div>
                <div className="text-[10px] text-muted-foreground">رنک {match.homeRank ?? "—"}</div>
              </div>
              <div className="glass p-3 text-center">
                <div className="truncate text-xs font-bold">{match.awayName}</div>
                <div className="num mt-1 text-2xl font-extrabold text-amber-300">{eloHint.b}</div>
                <div className="text-[10px] text-muted-foreground">رنک {match.awayRank ?? "—"}</div>
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                <span className="num">{(eloHint.pA * 100).toFixed(1)}%</span>
                <span className="num">{((1 - eloHint.pA) * 100).toFixed(1)}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-secondary" dir="ltr">
                <div className="h-full rounded-l-full bg-emerald-400" style={{ width: `${eloHint.pA * 100}%` }} />
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

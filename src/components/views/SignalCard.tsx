"use client";

/**
 * Signal card with Freemium/VIP paywall + betslip wiring.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HashChip, PriceTag, SourceBadge } from "@/components/shared/primitives";
import { useAppStore, type Tier } from "@/lib/store";
import { marketLabelFa, selectionLabel, lineLabel, fmtPrice, fmtUnits } from "@/lib/api-types";
import type { AppSignal } from "@/lib/api-types";
import { Plus, Crown, Lock, Layers3 } from "lucide-react";
import { cn } from "@/lib/utils";

const selectionText = (s: AppSignal): string => {
  if (s.selection === "HOME") return s.sport === "tennis" ? s.matchInfo.split(" vs ")[0] : "میزبان";
  if (s.selection === "AWAY") return s.sport === "tennis" ? s.matchInfo.split(" vs ")[1] : "مهمان";
  return selectionLabel(s.selection);
};

const sourceOf = (s: AppSignal): string => (s.line === "ACCA2" ? "ESTIMATE" : "ESTIMATE");

export function SignalCard({ s, locked, rank }: { s: AppSignal; locked: boolean; rank?: number }) {
  const addToBetslip = useAppStore((st) => st.addToBetslip);
  const setTier = useAppStore((st) => st.setTier);
  const isAcca = s.line === "ACCA2";

  const body = (
    <div className={cn("glass glass-hover p-4", locked && "select-none")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{s.sport === "tennis" ? "🎾" : "⚽"}</span>
            <span className="truncate text-sm font-bold">{s.matchInfo}</span>
            {rank === 0 && <Badge className="bg-amber-400 text-amber-950 text-[10px]">روز</Badge>}
          </div>
          <div className="text-[11px] text-muted-foreground">{s.league}</div>
        </div>
        <SourceBadge source={sourceOf(s)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PriceTag price={s.price} className="text-base" />
          <span className="num rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs font-bold text-amber-300">
            +EV {s.evPct.toFixed(1)}%
          </span>
          <span className="num rounded-lg border border-slate-700 bg-secondary px-2 py-1 text-[11px] text-slate-300">
            {fmtUnits(s.stake, 0)}u {s.stakeMode === "KELLY_025" ? "Kelly" : "Flat"}
          </span>
        </div>
        <HashChip hash={s.shaHash} />
      </div>

      <div className={cn("mt-3 rounded-xl border border-slate-800/70 bg-secondary/40 p-2.5", locked && "blur-sm")}>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{lineLabel(s.line)}</span>
          <span className="font-bold text-emerald-300">
            {isAcca ? "میکس ۲ تایی" : `${marketLabelFa(s.marketKey)} — ${selectionText(s)}`}
          </span>
        </div>
        {isAcca && s.legs && (
          <ul className="mt-1.5 space-y-1 text-[10px] text-slate-400">
            {s.legs.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">{l.label}</span>
                <span className="num">{fmtPrice(l.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {locked ? (
        <Button className="vip-gold mt-3 w-full gap-2 font-bold" onClick={() => setTier("PRO_VIP")}>
          <Crown className="size-4" />
          بازگشایی با اشتراک VIP
        </Button>
      ) : (
        <Button
          className="mt-3 w-full gap-2 border border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-300 hover:bg-emerald-500/20"
          variant="outline"
          onClick={() =>
            addToBetslip({
              signalId: s.id, matchInfo: s.matchInfo, league: s.league, sport: s.sport,
              marketKey: s.marketKey, marketLabel: marketLabelFa(s.marketKey), selection: s.selection,
              price: s.price, modelProb: s.modelProb, evPct: s.evPct,
              stake: s.stake, stakeMode: s.stakeMode, shaHash: s.shaHash,
            })
          }
        >
          {isAcca ? <Layers3 className="size-3.5" /> : <Plus className="size-3.5" />}
          افزودن به برگه شرط‌بندی
        </Button>
      )}
    </div>
  );

  if (!locked) return body;
  return (
    <div className="relative">
      <div className="pointer-events-none">{body}</div>
      <button
        type="button"
        onClick={() => setTier("PRO_VIP")}
        aria-label="بازگشایی با اشتراک VIP"
        className="absolute inset-0 grid cursor-pointer place-items-center rounded-2xl bg-[#06091140] backdrop-blur-md"
      >
        <span className="flex flex-col items-center gap-1.5 text-center">
          <Lock className="size-5 text-amber-300" />
          <span className="text-xs font-bold text-slate-200">سیگنال ویژه — قفل Freemium</span>
          <span className="max-w-[220px] text-[10px] text-muted-foreground">
            در حالت Free، تنها سیگنال اول هر روز رایگان است
          </span>
          <span className="vip-gold mt-1 rounded-xl px-3 py-1.5 text-[11px] font-bold">
            👑 بازگشایی با اشتراک VIP
          </span>
        </span>
      </button>
    </div>
  );
}

export function tierAllows(tier: Tier, index: number, todayKey: string, s: AppSignal): boolean {
  if (tier !== "FREE") return true;
  return index === 0 && s.dayKey === todayKey;
}

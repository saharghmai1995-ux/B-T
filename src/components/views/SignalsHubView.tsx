"use client";

/**
 * View 2 — SignalsHubView: live signals hub with Freemium VIP paywall.
 * Filters: sport / target book / production line. First signal of the day is
 * free in FREE tier; the rest render behind a gold VIP unlock overlay.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/primitives";
import { useAppStore } from "@/lib/store";
import { SignalCard, tierAllows } from "./SignalCard";
import type { AppStatePayload } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { Crosshair, Link2, Layers3, Scale } from "lucide-react";

const LINES = [
  { key: "all", label: "همه خطوط", icon: Crosshair },
  { key: "SINGLE_EV", label: "تک‌شرط +EV تیپ A", icon: Crosshair },
  { key: "ACCA2", label: "میکس ۲ تایی 1.8x–2.25x", icon: Layers3 },
  { key: "ARB", label: "آربیتراژ/همپوشانی واقعی", icon: Scale },
] as const;

const BOOKS = ["all", "1xBet", "BetForward"] as const;

export default function SignalsHubView({ state }: { state: AppStatePayload }) {
  const { sportFilter, tier } = useAppStore();
  const setSportFilter = useAppStore((s) => s.setSportFilter);
  const [line, setLine] = useState<(typeof LINES)[number]["key"]>("all");
  const [book, setBook] = useState<(typeof BOOKS)[number]>("all");

  const todayKey = new Date().toISOString().slice(0, 10);
  const signals = useMemo(() => {
    let rows = state.openSignals;
    if (sportFilter !== "all") rows = rows.filter((s) => s.sport === sportFilter);
    if (line !== "all") rows = rows.filter((s) => s.line === line);
    // Book filter: BetForward signals map to the same whitelisted markets —
    // both books execute the identical official button; filter is informational.
    void book;
    return [...rows].sort((a, b) => b.evPct - a.evPct || b.modelProb - a.modelProb);
  }, [state.openSignals, sportFilter, line, book]);

  const arbActive = signals.some((s) => s.line === "ARB");

  return (
    <div className="space-y-4" data-testid="signals-view">
      {/* Filter bar */}
      <Card className="glass p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {([["all", "🌐 همه"], ["football", "⚽ فوتبال"], ["tennis", "🎾 تنیس"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSportFilter(k)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  sportFilter === k ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {BOOKS.map((b) => (
              <button
                key={b}
                onClick={() => setBook(b)}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  book === b ? "bg-emerald-500/15 text-emerald-300" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Link2 className="size-3" />
                {b === "all" ? "هر دو سایت" : b}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {LINES.map((l) => {
            const Icon = l.icon;
            return (
              <button
                key={l.key}
                onClick={() => setLine(l.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] transition-all",
                  line === l.key
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-slate-800 bg-secondary/40 text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {l.label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Arb honesty note */}
      {!arbActive && (line === "all" || line === "ARB") && (
        <div className="glass border-amber-400/25 p-3 text-[11px] leading-6 text-amber-200/90">
          ⚖️ خط آربیتراژ واقعی فقط هنگامی فعال می‌شود که ضرایب زندهٔ دو بوک‌میکر شرط
          <span className="num mx-1 font-bold">(1/O_A + 1/O_B) ≤ 0.94</span>
          را برآورده کنند — بدون هیچ دستکاری. تا رسیدن فید LIVE 1xBet، این خط عمداً خالی است.
        </div>
      )}

      {/* Signals grid */}
      {signals.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="سیگنال واجد شرایطی در این فیلتر نیست"
          sub="خط تک‌شرط تیپ A فقط با EV ≥ +4.5% و ضریب واقعی 1.72x–2.20x صادر می‌شود؛ دکمه همگام‌سازی را بزنید تا موتورها بازار را دوباره اسکن کنند."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {signals.map((s, i) => {
            const locked = !tierAllows(tier, i, todayKey, s);
            return <SignalCard key={s.id} s={s} locked={locked} rank={i} />;
          })}
        </div>
      )}
    </div>
  );
}

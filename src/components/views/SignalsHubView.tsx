"use client";

/**
 * View 2 — SignalsHubView: live signals hub — VIP-only, ZERO paywall.
 * Every signal renders fully open (no locked prop, no blur, no tier gating).
 *
 * Filter bar: sport chips / production line chips / book chips (informational —
 * both books execute the identical official button).
 * Honesty note: reflects whether a real 1xBet odds key is configured in
 * تنظیمات — 🟡 MODEL FAIR PRICE until a key exists, 🟢 LIVE REAL ODDS after.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/primitives";
import { useAppStore, type SportFilter } from "@/lib/store";
import { SignalCard, type CardBookMode } from "./SignalCard";
import type { AppStatePayload } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { Activity, Crosshair, Layers3, Scale } from "lucide-react";

const SPORTS: Array<{ key: SportFilter; label: string }> = [
  { key: "all", label: "🌐 همه" },
  { key: "football", label: "⚽ فوتبال" },
  { key: "tennis", label: "🎾 تنیس" },
];

const LINES = [
  { key: "all", label: "همه خطوط", icon: Crosshair },
  { key: "SINGLE_EV", label: "تک‌شرط +EV تیپ A", icon: Crosshair },
  { key: "ACCA2", label: "میکس ۲ تایی 1.8x–2.25x", icon: Layers3 },
  { key: "ARB", label: "آربیتراژ/همپوشانی واقعی", icon: Scale },
] as const;

const BOOKS = ["all", "1xBet", "BetForward"] as const;

export default function SignalsHubView({ state }: { state: AppStatePayload }) {
  const sportFilter = useAppStore((s) => s.sportFilter);
  const setSportFilter = useAppStore((s) => s.setSportFilter);
  const [line, setLine] = useState<(typeof LINES)[number]["key"]>("all");
  const [book, setBook] = useState<(typeof BOOKS)[number]>("all");

  // A real 1xBet odds key is configured (either provider side).
  const liveKey = state.health.oddsApi || state.health.oddsApiIo;

  // v2.7.1 hotfix §1 — the 1xBet / BetForward switch drives the OFFICIAL
  // market wording on every card (onexbet ↔ betforward clean labels).
  const bookMode: CardBookMode = book === "1xBet" ? "1XBET" : book === "BetForward" ? "BETFORWARD" : "ALL";

  const signals = useMemo(() => {
    let rows = state.openSignals;
    if (sportFilter !== "all") rows = rows.filter((s) => s.sport === sportFilter);
    if (line !== "all") rows = rows.filter((s) => s.line === line);
    void book;
    // v2.7 — default order: soonest kickoff first (ascending start time).
    return [...rows].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime() || b.evPct - a.evPct,
    );
  }, [state.openSignals, sportFilter, line, book]);

  const arbActive = signals.some((s) => s.line === "ARB");

  return (
    <div className="space-y-4" data-testid="signals-view">
      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <Card className="glass p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Activity className="size-4 text-cyan-300" />
            هاب سیگنال‌های زنده
          </div>
          <span className="num rounded-lg border border-neon-cyan bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-300">
            {signals.length} سیگنال فعال
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sport chips */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {SPORTS.map((sp) => (
              <button
                key={sp.key}
                onClick={() => setSportFilter(sp.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  sportFilter === sp.key
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {sp.label}
              </button>
            ))}
          </div>

          {/* Book chips (informational) */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {BOOKS.map((b) => (
              <button
                key={b}
                onClick={() => setBook(b)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  book === b
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {b === "all" ? "هر دو سایت" : b}
              </button>
            ))}
          </div>
        </div>

        {/* Production line chips */}
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
                    ? "border-neon-emerald bg-emerald-500/10 text-emerald-300"
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

      {/* ── Odds provenance honesty note ───────────────────────────────────── */}
      {liveKey ? (
        <div className="glass border-emerald-500/25 p-3 text-[11px] leading-6 text-emerald-200/90">
          🟢 فید زنده 1xBet فعال است — ضریب‌های نمایش‌داده‌شده REAL ODDS واقعی بوک‌میکر هستند و همه کارت‌ها با برچسب
          <span className="num mx-1 font-bold text-emerald-300">LIVE 1xBet REAL ODDS</span>
          عرضه می‌شوند.
        </div>
      ) : (
        <div className="glass border-amber-400/25 p-3 text-[11px] leading-6 text-amber-200/90">
          🟡 تا زمانی که کلید Odds API در بخش
          <span className="mx-1 font-bold">تنظیمات</span>
          وارد نشده، ضریب‌ها به‌صورت
          <span className="num mx-1 font-bold text-amber-300">MODEL FAIR PRICE (1xBet Margin 5.5%)</span>
          نمایش داده می‌شوند؛ پس از وارد‌کردن کلید، همه کارت‌ها بلافاصله به
          <span className="mx-1 font-bold">🟢 LIVE 1xBet REAL ODDS</span>
          تغییر می‌کنند.
        </div>
      )}

      {/* ── Arb honesty note ───────────────────────────────────────────────── */}
      {!arbActive && (line === "all" || line === "ARB") && (
        <div className="glass border-amber-400/25 p-3 text-[11px] leading-6 text-amber-200/90">
          ⚖️ خط آربیتراژ واقعی فقط هنگامی فعال می‌شود که ضرایب زندهٔ دو بوک‌میکر شرط
          <span className="num mx-1 font-bold">(1/O_A + 1/O_B) ≤ 0.94</span>
          را برآورده کنند — بدون هیچ دستکاری. تا رسیدن فید LIVE 1xBet، این خط عمداً خالی است.
        </div>
      )}

      {/* ── Signals grid: every card fully open ───────────────────────────── */}
      {signals.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="سیگنال واجد شرایطی در این فیلتر نیست"
          sub="خط تک‌شرط تیپ A فقط با EV ≥ +4.5% و ضریب واقعی 1.72x–2.20x صادر می‌شود؛ دکمه همگام‌سازی را بزنید تا موتورها بازار را دوباره اسکن کنند."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {signals.map((s, i) => (
            <SignalCard key={s.id} s={s} rank={i} bookMode={bookMode} />
          ))}
        </div>
      )}
    </div>
  );
}

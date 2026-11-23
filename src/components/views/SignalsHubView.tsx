"use client";

/**
 * View 2 — SignalsHubView (v3.2 Pure Hit-Rate edition): live signals hub —
 * VIP-only, ZERO paywall. Every signal renders fully open.
 *
 * v3.2 spec:
 *  - Filter/toolbar rebuilt: sport pills (bound to the global zustand
 *    `sportFilter` so it syncs with the sidebar), Tier chips (همه / S / A / B),
 *    a «فقط سپر پوش» Push-Shield-Only toggle, and a two-option bookmaker
 *    naming switch «1xBet | BetForward» (local `naming` state).
 *  - REMOVED: price-band filter (1.8x–2.25x), EV sort toggle, «تک‌شرط +EV»
 *    production-line filter, the LIVE 1xBet REAL ODDS / MODEL FAIR PRICE
 *    honesty banner block, and every EV reference in the controls.
 *  - DEFAULT order = ascending kickoff time (`startTime` asc); signals whose
 *    match already kicked off, or that miss a valid startTime, go LAST
 *    (ties break by the highest No-Loss probability — never by EV).
 *  - The global `searchQuery` filters match/league/team names; empty result
 *    renders the EmptyState; the list is a max-height scroll region.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/primitives";
import { useAppStore, type SportFilter } from "@/lib/store";
import { SignalCard, type CardNaming } from "./SignalCard";
import type { AppStatePayload } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { Activity, ShieldCheck } from "lucide-react";

const SPORTS: Array<{ key: SportFilter; label: string }> = [
  { key: "all", label: "🌐 همه" },
  { key: "football", label: "⚽ فوتبال" },
  { key: "tennis", label: "🎾 تنیس" },
];

/** v3.2 — Tier chips filter on signal.tier (TIER_S / TIER_A / TIER_B). */
const TIERS = [
  { key: "all", label: "همه" },
  { key: "TIER_S", label: "S" },
  { key: "TIER_A", label: "A" },
  { key: "TIER_B", label: "B" },
] as const;

type TierKey = (typeof TIERS)[number]["key"];

/** v3.2 — bookmaker naming switch (two-option segmented control). */
const NAMINGS: Array<{ key: CardNaming; label: string }> = [
  { key: "1xbet", label: "1xBet" },
  { key: "betforward", label: "BetForward" },
];

/** Safe kickoff timestamp — null when missing/invalid (goes last). */
const kickoffTs = (iso: string): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

export default function SignalsHubView({ state }: { state: AppStatePayload }) {
  const sportFilter = useAppStore((s) => s.sportFilter);
  const setSportFilter = useAppStore((s) => s.setSportFilter);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const [tier, setTier] = useState<TierKey>("all");
  // v3.2 — Push-Shield Only: keep signals that carry a shieldType.
  const [pushOnly, setPushOnly] = useState(false);
  const [naming, setNaming] = useState<CardNaming>("1xbet");

  const signals = useMemo(() => {
    let rows = state.openSignals;
    if (sportFilter !== "all") rows = rows.filter((s) => s.sport === sportFilter);
    if (tier !== "all") rows = rows.filter((s) => s.tier === tier);
    if (pushOnly) rows = rows.filter((s) => !!s.shieldType);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) =>
        `${s.matchInfo} ${s.league} ${s.homeName} ${s.awayName}`.toLowerCase().includes(q),
      );
    }
    // Default order: ascending kickoff. Already-kicked-off fixtures
    // (startTime <= now) go after future ones; missing/invalid startTime goes
    // last. Ties break by No-Loss probability descending (deterministic).
    const now = Date.now();
    const band = (t: number | null) => (t == null ? 2 : t <= now ? 1 : 0);
    return [...rows].sort((a, b) => {
      const aT = kickoffTs(a.startTime);
      const bT = kickoffTs(b.startTime);
      const bnd = band(aT) - band(bT);
      if (bnd !== 0) return bnd;
      if (aT != null && bT != null && aT !== bT) return aT - bT;
      return (b.noLossProb ?? b.modelProb) - (a.noLossProb ?? a.modelProb);
    });
  }, [state.openSignals, sportFilter, tier, pushOnly, searchQuery]);

  return (
    <div className="space-y-4" data-testid="signals-view">
      {/* ── v3.2 Filter bar ────────────────────────────────────────────────── */}
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
          {/* Sport pills — bound to the global store sportFilter (sidebar sync) */}
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

          {/* Tier chips — همه / S / A / B */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            <span className="mx-1 text-[10px] font-bold text-slate-500">تیر:</span>
            {TIERS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTier(t.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  tier === t.key
                    ? "bg-amber-400/15 text-amber-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Push-Shield Only toggle */}
          <button
            type="button"
            onClick={() => setPushOnly((v) => !v)}
            aria-pressed={pushOnly}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] transition-all",
              pushOnly
                ? "border-neon-violet bg-violet-500/10 text-violet-300"
                : "border-slate-800 bg-secondary/40 text-muted-foreground hover:text-foreground",
            )}
          >
            <ShieldCheck className={cn("size-3.5", pushOnly && "text-violet-300")} />
            فقط سپر پوش
          </button>

          {/* Bookmaker naming switch — 1xBet | BetForward */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            {NAMINGS.map((n) => (
              <button
                key={n.key}
                onClick={() => setNaming(n.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  naming === n.key
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Signals grid: every card fully open, max-height scroll list ──── */}
      {signals.length === 0 ? (
        <EmptyState
          icon="🎯"
          title="سیگنال واجد شرایطی در این فیلتر نیست"
          sub="فیلترهای ورزش، تیر و سپر پوش را تغییر دهید یا دکمه همگام‌سازی را بزنید تا موتورها بازار را دوباره اسکن کنند."
        />
      ) : (
        <div className="scroll-slim max-h-[860px] overflow-y-auto overscroll-contain rounded-xl pr-1">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {signals.map((s, i) => (
              <SignalCard key={s.id} s={s} rank={i} naming={naming} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

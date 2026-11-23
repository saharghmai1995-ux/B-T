"use client";

/**
 * View 2 — SignalsHubView: live signals hub — VIP-only, ZERO paywall.
 * Every signal renders fully open (no locked prop, no blur, no tier gating).
 *
 * v3.1 spec:
 *  - DEFAULT sort = ascending kickoff time (`startTime` asc); signals whose
 *    match already kicked off, or that miss a valid startTime, go LAST.
 *    An optional "بیشترین EV" sort stays available; default never changes.
 *  - Production-line chips: all | SINGLE_EV | ACCA2 | SHIELD | ARB
 *    (SHIELD = سپر سربه‌سر via `lineLabel`).
 *  - Book switch 1xBet | BetForward | ALL drives the FULL official market
 *    wording (market name + full team/player name, no ◆, no clipping).
 *  - Sport chips stay bound to the global `sportFilter` zustand state; the
 *    global `searchQuery` filters match/league/team names.
 *  - Honesty banners kept: LIVE 1xBet REAL ODDS vs MODEL FAIR PRICE via
 *    SourceBadge on every card; SHIELD cards carry the honest (possibly
 *    negative) model-vs-market EV badge.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/primitives";
import { useAppStore, type SportFilter } from "@/lib/store";
import { SignalCard, type CardBookMode } from "./SignalCard";
import type { AppStatePayload } from "@/lib/api-types";
import { lineLabel } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { Activity, ArrowDownWideNarrow, Crosshair, Layers3, Scale, ShieldCheck } from "lucide-react";

const SPORTS: Array<{ key: SportFilter; label: string }> = [
  { key: "all", label: "🌐 همه" },
  { key: "football", label: "⚽ فوتبال" },
  { key: "tennis", label: "🎾 تنیس" },
];

const LINES = [
  { key: "all", label: "همه خطوط", icon: Crosshair },
  { key: "SINGLE_EV", label: "تک‌شرط +EV تیپ A", icon: Crosshair },
  { key: "ACCA2", label: "میکس ۲ تایی 1.8x–2.25x", icon: Layers3 },
  { key: "SHIELD", label: lineLabel("SHIELD"), icon: ShieldCheck },
  { key: "ARB", label: "آربیتراژ/همپوشانی واقعی", icon: Scale },
] as const;

const SORTS = [
  { key: "kickoff", label: "زمان شروع ↑" },
  { key: "ev", label: "بیشترین EV" },
] as const;

const BOOKS = ["all", "1xBet", "BetForward"] as const;

type SortKey = (typeof SORTS)[number]["key"];

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
  const [line, setLine] = useState<(typeof LINES)[number]["key"]>("all");
  const [book, setBook] = useState<(typeof BOOKS)[number]>("all");
  // v3.1 — DEFAULT sort is ascending kickoff; "بیشترین EV" is opt-in only.
  const [sort, setSort] = useState<SortKey>("kickoff");

  // A real 1xBet odds key is configured (either provider side).
  const liveKey = state.health.oddsApi || state.health.oddsApiIo;

  // v2.7.1 hotfix §1 — the 1xBet / BetForward switch drives the OFFICIAL
  // market wording on every card (onexbet ↔ betforward clean labels).
  const bookMode: CardBookMode = book === "1xBet" ? "1XBET" : book === "BetForward" ? "BETFORWARD" : "ALL";

  const signals = useMemo(() => {
    let rows = state.openSignals;
    if (sportFilter !== "all") rows = rows.filter((s) => s.sport === sportFilter);
    if (line !== "all") rows = rows.filter((s) => s.line === line);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) =>
        `${s.matchInfo} ${s.league} ${s.homeName} ${s.awayName}`.toLowerCase().includes(q),
      );
    }
    void book;
    if (sort === "ev") {
      return [...rows].sort((a, b) => b.evPct - a.evPct);
    }
    // v3.1 — default order: ascending kickoff. Already-kicked-off fixtures
    // (startTime <= now) go after future ones; missing/invalid startTime goes
    // last. Ties break by EV descending (deterministic + useful).
    const now = Date.now();
    const band = (t: number | null) => (t == null ? 2 : t <= now ? 1 : 0);
    return [...rows].sort((a, b) => {
      const aT = kickoffTs(a.startTime);
      const bT = kickoffTs(b.startTime);
      const bnd = band(aT) - band(bT);
      if (bnd !== 0) return bnd;
      if (aT != null && bT != null && aT !== bT) return aT - bT;
      return b.evPct - a.evPct;
    });
  }, [state.openSignals, sportFilter, line, book, searchQuery, sort]);

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

          {/* Sort chips — v3.1 default: ascending kickoff */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-secondary/60 p-1">
            <ArrowDownWideNarrow className="mx-1 size-3.5 shrink-0 text-slate-500" aria-hidden />
            {SORTS.map((so) => (
              <button
                key={so.key}
                onClick={() => setSort(so.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                  sort === so.key
                    ? "bg-violet-500/15 text-violet-300"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {so.label}
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

      {/* ── Shield honesty note (when the SHIELD production line is selected) */}
      {line === "SHIELD" && (
        <div className="glass flex items-start gap-2 border-violet-500/25 p-3 text-[11px] leading-6 text-violet-200/90">
          <ShieldCheck className="mt-1 size-3.5 shrink-0 text-violet-300" aria-hidden />
          <span>
            خط سپر سربه‌سر فقط از بازارهای محافظت‌شده (Handicap 0، AH +0.25، Double Chance، Asian Total 2.0/3.0) صادر
            می‌شود؛ نشان EV روی کارت‌های سپر مقدار صادقانه مدل در برابر بازار است و ممکن است منفی باشد — پنهان نمی‌شود.
          </span>
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {signals.map((s, i) => (
            <SignalCard key={s.id} s={s} rank={i} bookMode={bookMode} />
          ))}
        </div>
      )}
    </div>
  );
}

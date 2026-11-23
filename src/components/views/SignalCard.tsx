"use client";

/**
 * SignalCard — v3.1 SuperAgent ensemble (owner + members only): every card is
 * FULLY OPEN. No paywall, no lock, no blur — all model math, official bet
 * lines, odds provenance AND the four transparent v3.1 ensemble indicators
 * are visible to every member.
 *
 * Structure per card:
 *  1) Header: team avatars (FULL names, no clipping) + match info + rank badge
 *     + league/surface/venue + kickoff (dir="ltr" mono date)
 *  2) v3.1 indicator row (one compact flex-wrap line, 390px-safe):
 *     No-Loss % / Shield type / Tier / Agent Consensus (+ subtle
 *     SHARP PRIOR provenance badge + red-dot sharp divergence alert)
 *  3) Official English bet line (neon violet capsule, break-words, no ◆) +
 *     Persian explanation
 *  4) ACCA cards render their legs list under the market box
 *  5) Model vs Market implied probability split bar + EV badge — SINGLE_EV
 *     keeps the +EV Edge badge; SHIELD lines show the HONEST model-vs-market
 *     value (may be negative — displayed neutrally, never hidden)
 *  6) Numbers row: price / stake / expected net profit / settlement rule
 *  7) Footer: honest SourceBadge + SHA chip + espn.com link + betslip add
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HashChip,
  NoLossChip,
  PriceTag,
  ShieldBadge,
  SourceBadge,
  TeamAvatar,
  TierBadge,
} from "@/components/shared/primitives";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore } from "@/lib/store";
import { officialBetLine, marketFa, settlementRule } from "@/lib/markets";
import { fmtPrice, fmtUnits, fmtDateTimeFa, lineLabel } from "@/lib/api-types";
import { formatOfficialBookmakerMarket } from "@/core/bookmakers/market-aliases";
import type { AppSignal } from "@/lib/api-types";
import { ExternalLink, Layers3, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tennis surface chip — Hard/Clay/Grass → Persian label + neon tone. */
const SURFACE_CHIP: Record<string, { label: string; className: string }> = {
  Hard: { label: "هارد", className: "border-neon-cyan bg-cyan-500/10 text-cyan-300" },
  Clay: { label: "خاک", className: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  Grass: { label: "چمن", className: "border-neon-emerald bg-emerald-500/10 text-emerald-300" },
};

/** Safe 0–100 width percent for the split bar segments. */
const pct = (p: number): number =>
  Number.isFinite(p) ? Math.min(100, Math.max(0, p * 100)) : 0;

/** Safe "x.x" percent label — never renders NaN. */
const pctStr = (p: number): string =>
  Number.isFinite(p) ? (p * 100).toFixed(1) : "—";

/** Bookmaker display mode driven by the Signal-Center switch (hotfix §1). */
export type CardBookMode = "ALL" | "1XBET" | "BETFORWARD";

/** v3.1 — tiny dash fallback so every indicator slot stays visible. */
const DashVal = () => (
  <span className="num text-slate-500" dir="ltr" aria-hidden>
    —
  </span>
);

/** v3.1 — compact ensemble-indicator chip: muted Persian label + mono value. */
function IndChip({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-secondary/50 px-2 py-1 text-[10px] leading-none"
    >
      <span className="font-semibold text-slate-400">{label}</span>
      {children}
    </span>
  );
}

export function SignalCard({ s, rank, bookMode = "ALL" }: { s: AppSignal; rank?: number; bookMode?: CardBookMode }) {
  const addToBetslip = useAppStore((st) => st.addToBetslip);
  const isAcca = s.line === "ACCA2";
  const isShieldLine = s.line === "SHIELD";

  // 3) Official bet line — v2.7.1 + v3.1: the FULL official bookmaker market
  // name plus the REAL team/player name (no ◆ symbol, no truncation). The
  // switch on top of the Signal Center flips the card text between the 1xBet
  // wording and the BetForward wording.
  const clean = formatOfficialBookmakerMarket(s.marketKey, s.selection, s.homeName || "Home", s.awayName || "Away");
  const officialLine =
    bookMode === "1XBET" ? clean.onexbet
      : bookMode === "BETFORWARD" ? clean.betforward
        : officialBetLine(s.marketKey, s.selection, s.marketLabel, s.homeName, s.awayName);
  const dashIdx = officialLine.indexOf(" — ");
  const marketPart = dashIdx >= 0 ? officialLine.slice(0, dashIdx) : officialLine;
  const selectionPart = dashIdx >= 0 ? officialLine.slice(dashIdx + 3) : null;

  // 6) Expected net profit = stake × price × modelProb − stake (guarded).
  const expNet = s.stake * s.price * s.modelProb - s.stake;
  const expNetStr = Number.isFinite(expNet)
    ? `${expNet >= 0 ? "+" : ""}${expNet.toFixed(1)}u`
    : "—";

  const surface = s.sport === "tennis" && s.surface ? SURFACE_CHIP[s.surface] : undefined;
  const modelPct = pct(s.modelProb);
  const truePct = pct(s.trueProb);
  const evSafe = Number.isFinite(s.evPct) ? s.evPct : 0;

  return (
    <div className="glass glass-hover tilt-3d p-4">
      {/* ── 1) Header: avatars + match identity + kickoff ─────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <TeamAvatar name={s.homeName || "HOME"} logo={s.homeLogo} size={34} />
          <span className="num shrink-0 text-[9px] font-black text-slate-500">VS</span>
          <TeamAvatar name={s.awayName || "AWAY"} logo={s.awayLogo} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span aria-hidden className="text-base leading-none">
                {s.sport === "tennis" ? "🎾" : "⚽"}
              </span>
              <span className="break-words text-sm font-bold">{s.matchInfo}</span>
              {rank === 0 && (
                <Badge className="border-neon-gold bg-amber-400/15 text-[10px] text-amber-300">
                  برترین امروز
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="break-words">{s.league}</span>
              {surface && (
                <span className={cn("rounded-md border px-1.5 py-px text-[9px] font-bold", surface.className)}>
                  {surface.label}
                </span>
              )}
              {s.venue && <span className="break-words text-[10px]">📍 {s.venue}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            dir="ltr"
            className="num inline-block rounded-md border border-slate-800 bg-secondary/50 px-2 py-1 text-[10px] tabular-nums text-slate-300"
          >
            📅 {fmtDateTimeFa(s.startTime)}
          </span>
          <span className="text-[9px] text-muted-foreground">{lineLabel(s.line)}</span>
        </div>
      </div>

      {/* ── 2) v3.1 ensemble indicators — one compact row, mobile-safe ────── */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <IndChip label="بدون‌باخت" title="No-Loss Probability = Win + Push">
          {s.noLossProb != null && Number.isFinite(s.noLossProb) ? (
            <NoLossChip value={s.noLossProb} className="text-[11px]" />
          ) : (
            <DashVal />
          )}
        </IndChip>

        {s.shieldType ? (
          <ShieldBadge shieldType={s.shieldType} />
        ) : (
          <IndChip label="سپر">
            <DashVal />
          </IndChip>
        )}

        {s.tier ? (
          <TierBadge tier={s.tier} />
        ) : (
          <IndChip label="تیر">
            <DashVal />
          </IndChip>
        )}

        <IndChip label="اجماع" title="Agent Consensus — توافق نمایندگان کوانت / مربی / شارپ">
          {s.consensusPct != null && Number.isFinite(s.consensusPct) ? (
            <span className="num font-black text-violet-300" dir="ltr">
              {Math.round(s.consensusPct)}% MATCH
            </span>
          ) : (
            <DashVal />
          )}
        </IndChip>

        {s.sharpSource ? (
          <span
            dir="ltr"
            className="num inline-flex items-center rounded-md border border-cyan-500/25 bg-cyan-500/5 px-2 py-1 text-[9px] font-bold tracking-wider text-cyan-300/80"
            title="پیشِ‌شارپ: احتمال بازار از حسگر شارپ تزریق شده است"
          >
            SHARP PRIOR: {s.sharpSource}
          </span>
        ) : null}

        {s.sharpAlert === true && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="relative grid size-4 cursor-help place-items-center"
                role="img"
                aria-label="هشدار واگرایی شارپ"
              >
                <span className="absolute size-2.5 animate-pulse rounded-full bg-red-500/50" />
                <span className="size-2 rounded-full bg-red-500" />
              </span>
            </TooltipTrigger>
            <TooltipContent dir="rtl" className="border-red-500/30 bg-red-950/95 text-red-200">
              واگرایی شارپ &gt; 16pp — احتمال خبر پنهان
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* ── 3) Official market box (THE hero element) ─────────────────────── */}
      <div className="mt-3 rounded-xl border border-neon-violet bg-violet-500/10 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-violet-300/70">
            Official Bet Line
          </span>
          <span className="text-[9px] text-violet-300/70">
            {bookMode === "1XBET" ? "1xBet (official)" : bookMode === "BETFORWARD" ? "BetForward (official)" : "1xBet / BetForward"}
          </span>
        </div>
        <div dir="ltr" className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
          <span className="min-w-0 break-words text-[15px] font-extrabold leading-snug text-violet-100 md:text-base">
            {marketPart}
          </span>
          {selectionPart && (
            <>
              <span aria-hidden className="num text-[10px] text-violet-400">›</span>
              <span className="num neon-violet min-w-0 max-w-full break-words rounded-lg border border-neon-violet bg-violet-500/15 px-2 py-0.5 text-[13px] font-black tracking-wider">
                {selectionPart}
              </span>
            </>
          )}
        </div>
        <div dir="rtl" className="mt-1.5 text-center text-[10px] leading-5 text-muted-foreground">
          {marketFa(s.marketKey)}
        </div>
      </div>

      {/* ── 4) ACCA legs list (under the market box) ──────────────────────── */}
      {isAcca && s.legs && s.legs.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-xl border border-amber-400/25 bg-amber-400/5 p-2">
          {s.legs.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-2 text-[10px]">
              <span className="min-w-0 break-words text-slate-300">{l.label}</span>
              <span className="num shrink-0 font-bold text-amber-300">{fmtPrice(l.price)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── 5) Model vs Market implied probability bar + honest EV badge ──── */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-slate-400">مدل در برابر بازار</span>
          {isShieldLine ? (
            <Badge
              variant="outline"
              dir="ltr"
              title="EV صادقانه: بازده انتظاری مدل در برابر قیمت واقعی بازار — روی خط سپر ممکن است منفی باشد و پنهان نمی‌شود"
              className={cn(
                "num border text-[10px] font-bold",
                evSafe >= 0
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-600 bg-secondary/60 text-slate-300",
              )}
            >
              EV {evSafe >= 0 ? "+" : ""}
              {evSafe.toFixed(1)}%
            </Badge>
          ) : evSafe > 0 ? (
            <Badge variant="outline" className="num border-neon-emerald bg-emerald-500/10 text-[10px] text-emerald-300">
              +EV Edge +{evSafe.toFixed(1)}% EV
            </Badge>
          ) : null}
        </div>
        <div
          dir="ltr"
          className="mt-1.5 flex h-7 w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70"
        >
          <div
            style={{ width: `${modelPct}%` }}
            className="flex items-center justify-center bg-gradient-to-r from-cyan-500/45 to-cyan-400/20"
          >
            <span className="num truncate px-1 text-[9px] font-bold text-cyan-100">
              Model Prob {pctStr(s.modelProb)}%
            </span>
          </div>
          <div
            style={{ width: `${truePct}%` }}
            className="flex items-center justify-center bg-slate-600/50"
          >
            <span className="num truncate px-1 text-[9px] font-bold text-slate-300">
              Market Implied {pctStr(s.trueProb)}%
            </span>
          </div>
        </div>
      </div>

      {/* ── 6) Numbers row: price / stake / expected net / settlement rule ── */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <PriceTag price={s.price} />
        <span className="num rounded-lg border border-slate-700 bg-secondary/60 px-2 py-1 text-[11px] text-slate-300">
          {fmtUnits(s.stake, 0)}u {s.stakeMode === "KELLY_025" ? "Kelly 0.25×" : "Flat 100u"}
        </span>
        <span className="num rounded-lg border border-neon-emerald bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-300">
          سود خالص انتظاری {expNetStr}
        </span>
        <span className="w-full rounded-md border border-slate-800/80 bg-secondary/30 px-2 py-1 text-[10px] text-muted-foreground">
          ⚖️ {settlementRule(s.sport, s.marketKey)}
        </span>
      </div>

      {/* ── 7) Footer: provenance + hash + espn link + betslip add ────────── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <SourceBadge source={s.line === "ARB" ? "LIVE" : "ESTIMATE"} />
        <div className="flex items-center gap-1.5">
          <HashChip hash={s.shaHash} />
          {s.espnUrl ? (
            <a
              href={s.espnUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
              title="مشاهده در ESPN"
            >
              espn.com
              <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </div>
      <Button
        variant="outline"
        className="mt-3 w-full gap-2 border-cyan-500/40 bg-cyan-500/5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/15 hover:text-cyan-200"
        onClick={() =>
          addToBetslip({
            signalId: s.id,
            matchInfo: s.matchInfo,
            league: s.league,
            sport: s.sport,
            marketKey: s.marketKey,
            marketLabel: officialBetLine(s.marketKey, s.selection, s.marketLabel, s.homeName, s.awayName),
            selection: s.selection,
            price: s.price,
            modelProb: s.modelProb,
            evPct: s.evPct,
            stake: s.stake,
            stakeMode: s.stakeMode,
            shaHash: s.shaHash,
          })
        }
      >
        {isAcca ? <Layers3 className="size-4" /> : <Plus className="size-4" />}
        افزودن به برگه شرط‌بندی
      </Button>
    </div>
  );
}

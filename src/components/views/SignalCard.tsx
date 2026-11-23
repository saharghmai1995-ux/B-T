"use client";

/**
 * SignalCard — v3.2 Pure Hit-Rate edition (owner + members only): every card is
 * FULLY OPEN. No paywall, no lock, no blur.
 *
 * v3.2 Zero-Bankroll Purge: the +EV badge, stake/Kelly/Flat chip, expected-net
 * chip, bet-slip button, provenance banner and the price chip are GONE.
 * The card is a pure hit-rate brief:
 *
 * Structure per card:
 *  1) Header: team avatars (FULL names, no clipping) + match info + rank badge
 *     + league/surface/venue + kickoff (dir="ltr" mono date) + production line
 *  2) v3.2 hit-rate indicator row (one compact flex-wrap line, 390px-safe):
 *     Win % (emerald) / No-Loss % (cyan) / Shield type / Tier / SuperAgent
 *     consensus «Quant/Coach» (+ «+Market» when a sharp source is present)
 *     + subtle red-dot sharp divergence alert
 *  3) Official English bet line (neon violet capsule, break-words, no ◆) +
 *     Persian explanation — wording driven by the 1xBet | BetForward switch
 *  4) ACCA cards render their legs list under the market box
 *  5) Settlement rule line
 *  6) Footer: SHA chip + espn.com link
 */

import { Badge } from "@/components/ui/badge";
import {
  HashChip,
  ShieldBadge,
  TeamAvatar,
  TierBadge,
} from "@/components/shared/primitives";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { officialBetLine, marketFa, settlementRule } from "@/lib/markets";
import { fmtPrice, fmtDateTimeFa, lineLabel } from "@/lib/api-types";
import type { AppSignal } from "@/lib/api-types";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tennis surface chip — Hard/Clay/Grass → Persian label + neon tone. */
const SURFACE_CHIP: Record<string, { label: string; className: string }> = {
  Hard: { label: "هارد", className: "border-neon-cyan bg-cyan-500/10 text-cyan-300" },
  Clay: { label: "خاک", className: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  Grass: { label: "چمن", className: "border-neon-emerald bg-emerald-500/10 text-emerald-300" },
};

/** Bookmaker naming mode driven by the Signals-Hub switch (v3.2):
 *  "1xbet" → officialBetLine wording; "betforward" → the stored BetForward label. */
export type CardNaming = "1xbet" | "betforward";

/** v3.2 — tiny dash fallback so every indicator slot stays visible. */
const DashVal = () => (
  <span className="num text-slate-500" dir="ltr" aria-hidden>
    —
  </span>
);

/** v3.2 — compact hit-rate chip: muted Persian label + mono value. */
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

/** Safe "xx.x%" string from a 0–1 probability — null when missing/invalid. */
const probPct = (p: number | null | undefined): string | null =>
  p != null && Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : null;

export function SignalCard({ s, rank, naming = "1xbet" }: { s: AppSignal; rank?: number; naming?: CardNaming }) {
  // 3) Official bet line — v3.2: the hub's «1xBet | BetForward» switch picks
  // the wording. 1xBet mode = full official bookmaker market name + REAL
  // team/player name; BetForward mode = the stored clean label.
  const officialLine =
    naming === "1xbet"
      ? officialBetLine(s.marketKey, s.selection, s.marketLabel, s.homeName, s.awayName)
      : s.marketLabel;
  const dashIdx = officialLine.indexOf(" — ");
  const marketPart = dashIdx >= 0 ? officialLine.slice(0, dashIdx) : officialLine;
  const selectionPart = dashIdx >= 0 ? officialLine.slice(dashIdx + 3) : null;

  const surface = s.sport === "tennis" && s.surface ? SURFACE_CHIP[s.surface] : undefined;
  const winPct = probPct(s.modelProb);
  const noLossPct = probPct(s.noLossProb);

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
                {s.sport === "tennis" ? "🎾" : s.sport === "basketball" ? "🏀" : "⚽"}
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

      {/* ── 2) v3.2 Pure Hit-Rate indicators — one compact row, mobile-safe ─ */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <IndChip label="برد" title="Win Rate — احتمال کالیبره‌شده برد مدل">
          {winPct ? (
            <span className="num font-black text-emerald-300" dir="ltr">
              {winPct}
            </span>
          ) : (
            <DashVal />
          )}
        </IndChip>

        <IndChip label="بدون‌باخت" title="No-Loss Rate = برد + پوش">
          {noLossPct ? (
            <span className="num font-black text-cyan-300" dir="ltr">
              {noLossPct}
            </span>
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

        <IndChip label="اجماع سوپرایجنت" title="اجماع سوپرایجنت — ترکیب نمایندگان کوانت / مربی (+بازار شارپ در صورت ورود)">
          {s.consensusPct != null && Number.isFinite(s.consensusPct) ? (
            <>
              <span className="num font-black text-violet-300" dir="ltr">
                Quant/Coach {Math.round(s.consensusPct)}%
              </span>
              {s.sharpSource && (
                <span className="num text-[9px] font-bold text-cyan-300/80" dir="ltr">
                  +Market
                </span>
              )}
            </>
          ) : (
            <DashVal />
          )}
        </IndChip>

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
            {naming === "1xbet" ? "1xBet (official)" : "BetForward (official)"}
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
      {s.line === "ACCA2" && s.legs && s.legs.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-xl border border-amber-400/25 bg-amber-400/5 p-2">
          {s.legs.map((l, i) => (
            <li key={i} className="flex items-start justify-between gap-2 text-[10px]">
              <span className="min-w-0 break-words text-slate-300">{l.label}</span>
              <span className="num shrink-0 font-bold text-amber-300">{fmtPrice(l.price)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── 5) Settlement rule ────────────────────────────────────────────── */}
      <div className="mt-3 w-full rounded-md border border-slate-800/80 bg-secondary/30 px-2 py-1 text-[10px] text-muted-foreground">
        ⚖️ {settlementRule(s.sport, s.marketKey)}
      </div>

      {/* ── 6) Footer: hash + espn link ───────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
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
  );
}

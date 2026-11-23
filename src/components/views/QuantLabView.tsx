"use client";

/**
 * View 3 — QuantLabView: the SuperAgent Calibration Lab (v3.1 → v3.2).
 * 4 sub-tabs: کالیبراسیون (default) | زمین فوتبال 3D | زمین تنیس 3D | کنسول QQL.
 * Tabs are pure client state — the page never resets them.
 *
 * v3.1 hardening: the CSS-3D modules (Pitch3D / Court3D) are wrapped in a
 * local LabErrorBoundary so a render crash inside a 3D module can NEVER
 * reset the whole page — the boundary shows a glass "حالت امن" panel with a
 * retry button that remounts the child via a React key bump.
 *
 * v3.2 hardening: EVERY subtab (کالیبراسیون، زمین‌های 3D و کنسول QQL) is
 * additionally caged by SubtabErrorBoundary — a crash inside any single
 * subtab renders a compact glass card («خطا در زیرتب … — موتور اصلی
 * کالیبراسیون دست‌نخورده است») and the app never falls back to Overview.
 *
 * v3.2 data purge: the QQL console no longer talks to /api/qql (its rows
 * carried price / EV / stake / pnl). Rows are built HERE from
 * state.settledSignals with the pure hit-rate schema (calibrated probability,
 * tier, outcome WON/PUSH/LOST, Brier error, Persian RCA root cause) via
 * buildQqlRows() and handed to the console as props.
 */

import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pitch3D } from "./lab/Pitch3D";
import { Court3D } from "./lab/Court3D";
import { QqlConsole, buildQqlRows } from "./lab/QqlConsole";
import { CalibrationLab } from "./lab/CalibrationLab";
import { LabErrorBoundary } from "./lab/LabErrorBoundary";
import { SubtabErrorBoundary } from "./lab/SubtabErrorBoundary";
import type { AppStatePayload } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const TABS = [
  {
    key: "calibration",
    label: "آزمایشگاه کالیبراسیون",
    desc: "داشبورد زنده SuperAgent 3 — نمودار Reliability Bins، وزن‌های Ensemble، کالیبراسیون پلت، معیارهای Brier / Log-Loss / ECE و اقتصاد وتو",
    activeCls: "border border-amber-500/30 bg-amber-500/15 text-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.15)]",
  },
  {
    key: "pitch",
    label: "⚽ زمین فوتبال 3D",
    desc: "شبیه‌سازی دیکسون-کولز، نقشه حرارتی حملات و بردار انتظار گل (λ) روی زمین سه‌بعدی",
    activeCls: "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.15)]",
  },
  {
    key: "court",
    label: "🎾 زمین تنیس Hawk-Eye 3D",
    desc: "دوئل Elo، موتور مارکوف-کاپولا و مسیر سرویس منحنی با تم رنگی سطح زمین (هارد/خاک رس/چمن)",
    activeCls: "border border-cyan-500/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.15)]",
  },
  {
    key: "qql",
    label: "🧬 کنسول QQL & AI RCA",
    desc: "پرس‌وجوی تحلیلی QQL روی سیگنال‌ها و تحلیل ریشه‌ای علّی (AI Causal RCA) خوشه‌های زیان",
    activeCls: "border border-violet-500/30 bg-violet-500/15 text-violet-300 shadow-[0_0_18px_rgba(167,139,250,0.15)]",
  },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * v2.7 — Tennis Engine Feed status card (patch §2-آ):
 * discovered matches over the last 30 days, upcoming fixtures (incl. Davis
 * Cup-class events) and the ACTIVE odds source behind the tennis quotes.
 * Lives in the QuantLab since the Settings page is retired.
 */
function TennisFeedStatus({ state }: { state: AppStatePayload }) {
  const now = Date.now();
  const in30 = now - 30 * 86400_000;
  const tennis = state.matches.filter((m) => m.sport === "tennis");
  const last30 = tennis.filter((m) => new Date(m.startTime).getTime() >= in30).length;
  const upcoming = tennis.filter(
    (m) => m.status === "pre" && new Date(m.startTime).getTime() > now,
  );
  const davisCup = upcoming.filter((m) => /davis|finals|united cup|billie/i.test(m.league)).length;
  const activeSource = state.health.oddsApi
    ? "لایه ۱ — The Odds API v4 (1xBet + Pinnacle، کش ۴۵ دقیقه)"
    : state.health.oddsApiIo
      ? "لایه ۲ — OddsPapi v4 (پشتیبان رایگان)"
      : "لایه ۳ — ESPN Core عمومی (بدون کلید) + برآورد مدل";

  return (
    <Card className="glass p-3" data-testid="tennis-feed-status">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">🎾 وضعیت فید موتور تنیس (Tennis Engine Feed)</div>
        <Badge variant="outline" className="border-emerald-500/40 text-[9px] text-emerald-300">
          بازه تاریخچه: ۳۰ روز گذشته + ۱ روز آینده
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2.5">
          <div className="text-[10px] text-muted-foreground">کشف‌شده ۳۰ روز گذشته</div>
          <div className="num mt-0.5 text-lg font-extrabold neon-cyan">{last30}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2.5">
          <div className="text-[10px] text-muted-foreground">بازی آینده (pre)</div>
          <div className="num mt-0.5 text-lg font-extrabold text-slate-100">{upcoming.length}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2.5">
          <div className="text-[10px] text-muted-foreground">Davis Cup / Finals / United Cup</div>
          <div className="num mt-0.5 text-lg font-extrabold text-amber-300">{davisCup}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-secondary/40 p-2.5">
          <div className="text-[10px] text-muted-foreground">منبع ضرایب فعال تنیس</div>
          <div className="mt-0.5 text-[11px] font-bold leading-5 text-slate-200">{activeSource}</div>
        </div>
      </div>
    </Card>
  );
}

export default function QuantLabView({ state }: { state: AppStatePayload }) {
  const [tab, setTab] = useState<TabKey>("calibration");
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  /** v3.2 — pure hit-rate QQL rows, mapped client-side from the settled ledger. */
  const qqlRows = useMemo(() => buildQqlRows(state.settledSignals), [state.settledSignals]);

  return (
    <div className="space-y-4" data-testid="lab-view">
      <Card className="glass p-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="زیربخش‌های آزمایشگاه کوانتوم">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all",
                tab === t.key
                  ? t.activeCls
                  : "border border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.key === "calibration" && <FlaskConical className="size-3.5" aria-hidden />}
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 px-1 text-[10px] leading-5 text-muted-foreground">{current.desc}</p>
      </Card>

      {tab !== "calibration" && <TennisFeedStatus state={state} />}

      {tab === "calibration" && (
        <SubtabErrorBoundary subtab="آزمایشگاه کالیبراسیون">
          <CalibrationLab state={state} />
        </SubtabErrorBoundary>
      )}

      {tab === "pitch" && (
        <SubtabErrorBoundary subtab="زمین فوتبال 3D">
          <LabErrorBoundary label="زمین فوتبال 3D" testId="pitch-boundary">
            <Pitch3D matches={state.matches} />
          </LabErrorBoundary>
        </SubtabErrorBoundary>
      )}

      {tab === "court" && (
        <SubtabErrorBoundary subtab="زمین تنیس Hawk-Eye 3D">
          <LabErrorBoundary label="زمین تنیس Hawk-Eye 3D" testId="court-boundary">
            <Court3D matches={state.matches} />
          </LabErrorBoundary>
        </SubtabErrorBoundary>
      )}

      {tab === "qql" && (
        <SubtabErrorBoundary subtab="کنسول QQL & AI RCA">
          <QqlConsole rows={qqlRows} />
        </SubtabErrorBoundary>
      )}
    </div>
  );
}

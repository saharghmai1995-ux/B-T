"use client";

/**
 * View 3 — QuantLabView: 3D lab tabs (football pitch / tennis court / QQL).
 * Tabs are pure client state — the page never resets them.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pitch3D } from "./lab/Pitch3D";
import { Court3D } from "./lab/Court3D";
import { QqlConsole } from "./lab/QqlConsole";
import type { AppStatePayload } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const TABS = [
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
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pitch");
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="space-y-4" data-testid="lab-view">
      <Card className="glass p-2">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-xl px-3 py-2 text-xs font-medium transition-all",
                tab === t.key
                  ? t.activeCls
                  : "border border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 px-1 text-[10px] leading-5 text-muted-foreground">{current.desc}</p>
      </Card>

      <TennisFeedStatus state={state} />

      {tab === "pitch" && <Pitch3D matches={state.matches} />}
      {tab === "court" && <Court3D matches={state.matches} />}
      {tab === "qql" && <QqlConsole />}
    </div>
  );
}

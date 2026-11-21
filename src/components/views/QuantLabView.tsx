"use client";

/**
 * View 3 — QuantLabView: 3D lab tabs (football pitch / tennis court / QQL).
 * Tabs are pure client state — the page never resets them.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
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

      {tab === "pitch" && <Pitch3D matches={state.matches} />}
      {tab === "court" && <Court3D matches={state.matches} />}
      {tab === "qql" && <QqlConsole />}
    </div>
  );
}

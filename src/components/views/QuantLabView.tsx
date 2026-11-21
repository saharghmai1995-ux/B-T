"use client";

/**
 * View 3 — QuantLabView: 3D lab tabs (football pitch / tennis court / QQL).
 * Tabs are client state only — the page never resets.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Pitch3D } from "./lab/Pitch3D";
import { Court3D } from "./lab/Court3D";
import { QqlConsole } from "./lab/QqlConsole";
import type { AppStatePayload } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "pitch", label: "⚽ زمین فوتبال 3D" },
  { key: "court", label: "🎾 زمین تنیس Hawk-Eye 3D" },
  { key: "qql", label: "🧬 کنسول QQL & AI RCA" },
] as const;

export default function QuantLabView({ state }: { state: AppStatePayload }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pitch");

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
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "border border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      {tab === "pitch" && <Pitch3D matches={state.matches} />}
      {tab === "court" && <Court3D matches={state.matches} />}
      {tab === "qql" && <QqlConsole />}
    </div>
  );
}

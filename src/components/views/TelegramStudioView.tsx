"use client";

/**
 * View 5 — TelegramStudioView (@aineobet Studio).
 * Server-rendered 1080x1440 posters (SVG→PNG via sharp) drawn onto a canvas
 * preview. Honest schedule: future posts are never marked as "sent".
 */

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import type { AppStatePayload, AppSignal } from "@/lib/api-types";
import { fmtPrice, fmtUnits, marketLabelFa, selectionLabel, lineLabel } from "@/lib/api-types";
import { Loader2, Send, Download, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

type PosterKind = "SIGNAL" | "WIN" | "LOSS" | "TEASER";

const KINDS: Array<{ key: PosterKind; label: string; desc: string }> = [
  { key: "SIGNAL", label: "پوستر سیگنال", desc: "اعلام پیش‌ازبازی با هش قفل‌شده" },
  { key: "WIN", label: "پوستر WIN", desc: "تسویه برد با سود واحدی" },
  { key: "LOSS", label: "پوستر LOSS", desc: "شفافیت کامل باخت −۱۰۰u" },
  { key: "TEASER", label: "تیزر قفل‌شده", desc: "FOMO ویژه برای اشتراک VIP" },
];

export default function TelegramStudioView({ state }: { state: AppStatePayload }) {
  const tier = useAppStore((s) => s.tier);
  const [kind, setKind] = useState<PosterKind>("SIGNAL");
  const [signal, setSignal] = useState<AppSignal | null>(null);
  const [png, setPng] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const baseSignal: AppSignal =
    signal ?? state.openSignals[0] ?? state.settledSignals[0] ?? null as unknown as AppSignal;

  useEffect(() => {
    if (kind === "WIN" && state.settledSignals.some((s) => s.status === "WON")) {
      setSignal(state.settledSignals.find((s) => s.status === "WON")!);
    } else if (kind === "LOSS" && state.settledSignals.some((s) => s.status === "LOST")) {
      setSignal(state.settledSignals.find((s) => s.status === "LOST")!);
    } else if (signal) {
      setSignal(signal);
    }
  }, [kind]);

  async function render(send = false) {
    if (!baseSignal && kind !== "TEASER") {
      toast.warning("سیگنالی برای پوستر وجود ندارد");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, signalId: baseSignal && kind !== "TEASER" ? baseSignal.id : undefined, send,
          spec: kind === "TEASER"
            ? { matchInfo: "Locked VIP Signal", marketLabel: "Unlock inside @aineobet hub", selection: "VIP ONLY" }
            : undefined,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      setPng(j.poster.pngBase64);
      if (send) {
        if (j.sent) toast.success("پوستر با sendPhoto به کانال ارسال شد");
        else toast.info("پوستر ساخته شد (ارسال نیاز به Bot Token دارد)", { description: j.transport });
      } else {
        toast.success("پوستر 1080×1440 ساخته شد");
      }
    } catch (e) {
      toast.error("خطای رندر پوستر", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Draw the server PNG onto the visible canvas (parity with the 3:4 export).
  useEffect(() => {
    if (!png || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = 1080;
      c.height = 1440;
      const ctx = c.getContext("2d");
      ctx?.drawImage(img, 0, 0, 1080, 1440);
    };
    img.src = `data:image/png;base64,${png}`;
  }, [png]);

  // Honest schedule: statuses depend on wall-clock, never fake "sent" for future.
  const schedule = buildSchedule(state);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3" data-testid="telegram-view">
      <div className="space-y-3">
        <Card className="glass p-3">
          <h2 className="mb-2 text-sm font-bold">انواع پوستر انگلیسی ۱۰۰٪ (بدون آپلود قالب)</h2>
          <div className="space-y-1.5">
            {KINDS.map((k) => (
              <button
                key={k.key}
                onClick={() => setKind(k.key)}
                className={cn(
                  "w-full rounded-xl border px-3 py-2 text-right transition-all",
                  kind === k.key ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-800 bg-secondary/40 hover:border-emerald-500/30",
                )}
              >
                <div className="text-xs font-bold">{k.label}</div>
                <div className="text-[10px] text-muted-foreground">{k.desc}</div>
              </button>
            ))}
          </div>
          {baseSignal && kind !== "TEASER" && (
            <div className="mt-2 rounded-lg border border-slate-800 bg-secondary/40 p-2 text-[10px] text-slate-300">
              منبع: {baseSignal.matchInfo} — {lineLabel(baseSignal.line)} · {marketLabelFa(baseSignal.marketKey)} {selectionLabel(baseSignal.selection)} @ {fmtPrice(baseSignal.price)}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button onClick={() => render(false)} disabled={busy} className="gap-1.5 bg-emerald-500 text-xs text-emerald-950 hover:bg-emerald-400">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              رندر پوستر
            </Button>
            <Button variant="outline" onClick={() => render(true)} disabled={busy} className="gap-1.5 border-slate-700 text-xs">
              <Send className="size-3.5" />
              ارسال به @aineobet
            </Button>
          </div>
          {png && (
            <Button
              variant="outline"
              className="mt-2 w-full gap-1.5 border-slate-700 text-xs"
              onClick={() => {
                const a = document.createElement("a");
                a.href = `data:image/png;base64,${png}`;
                a.download = `neobet-poster-${Date.now()}.png`;
                a.click();
              }}
            >
              <Download className="size-3.5" /> دانلود PNG 1080×1440
            </Button>
          )}
        </Card>

        <Card className="glass p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold">
            <CalendarClock className="size-3.5 text-amber-300" />
            جدول زمان‌بندی پخش واقعی
          </div>
          <div className="max-h-64 space-y-1.5 overflow-y-auto scroll-slim">
            {schedule.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-secondary/40 px-2.5 py-1.5 text-[10px]">
                <span className="truncate">{r.title}</span>
                <span className={cn("rounded px-1.5 py-0.5 font-bold",
                  r.state === "sent" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-400/15 text-amber-300")}>
                  {r.state === "sent" ? "ارسال شد" : "زمان‌بندی‌شده"}
                </span>
              </div>
            ))}
            {schedule.length === 0 && <p className="text-[11px] text-muted-foreground">هیچ پستی در صف نیست.</p>}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            برای پست‌های آینده هرگز وضعیت «ارسال شد» درج نمی‌شود — فقط پس از پاسخ موفق sendPhoto ثبت می‌شود.
          </p>
        </Card>
      </div>

      <div className="xl:col-span-2">
        <Card className="glass flex flex-col items-center p-4">
          <div className="mb-2 flex items-center justify-between gap-2 self-stretch">
            <h2 className="text-sm font-bold">پیش‌نمایش زنده پوستر (Canvas)</h2>
            <span className="num rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">1080 × 1440 · 3:4</span>
          </div>
          <div className="relative w-full max-w-[380px] overflow-hidden rounded-xl border border-slate-800">
            <canvas
              ref={canvasRef}
              className={cn("h-auto w-full", !png && "shimmer")}
              style={{ aspectRatio: "3/4" }}
              aria-label="پیش‌نمایش پوستر تلگرام"
            />
            {!png && (
              <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                {busy ? "در حال رندر…" : "روی «رندر پوستر» بزنید"}
              </div>
            )}
          </div>
          {tier !== "FREE" && (
            <p className="mt-2 text-[10px] text-emerald-300">
              حالت اشتراک {tier} — پوسترهای تیزر با بج طلایی VIP ساخته می‌شوند.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

interface ScheduleRow { id: string; title: string; state: "sent" | "scheduled" }

function buildSchedule(state: AppStatePayload): ScheduleRow[] {
  const now = Date.now();
  const rows: ScheduleRow[] = [];
  for (const s of state.openSignals.slice(0, 4)) {
    const t = new Date(s.startTime).getTime();
    rows.push({
      id: `pre-${s.id}`,
      title: `پیش‌ازبازی: ${s.matchInfo} @ ${fmtPrice(s.price)}`,
      state: t < now ? "sent" : "scheduled",
    });
  }
  for (const s of state.settledSignals.slice(0, 4)) {
    const t = s.settledAt ? new Date(s.settledAt).getTime() : now;
    rows.push({
      id: `post-${s.id}`,
      title: `${s.status === "WON" ? "WIN" : "LOSS"}: ${s.matchInfo} (${fmtUnits(s.netProfit ?? 0)}u)`,
      state: t < now ? "sent" : "scheduled",
    });
  }
  return rows;
}

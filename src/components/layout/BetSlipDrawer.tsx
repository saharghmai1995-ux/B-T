"use client";

/**
 * BetSlipDrawer — floating Order-Ticket (opens from the LEFT in RTL).
 * Stakes are split by the SERVER's fractional-Kelly weights already stored
 * on each signal; this drawer only re-balances the daily budget visually.
 * Zero financial math is invented client-side beyond proportional display.
 */

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { useAppState } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtPrice, fmtUnits, marketLabelFa, selectionLabel } from "@/lib/api-types";
import { Trash2, Rocket, Copy, Layers, X } from "lucide-react";

export default function BetSlipDrawer() {
  const { betslip, betslipOpen, setBetslipOpen, removeFromBetslip, clearBetslip } = useAppStore();
  const { data: state } = useAppState();
  const [copied, setCopied] = useState(false);

  const bank = state?.metrics.bankroll ?? 1000;
  // Proportional Kelly re-balance for display only (weights from server stakes).
  const stakes = useMemo(() => {
    const totalW = betslip.reduce((a, b) => a + b.stake, 0);
    const budget = bank * 0.25;
    if (totalW <= 0) return {} as Record<string, number>;
    return Object.fromEntries(betslip.map((b) => [b.signalId, Math.max(10, Math.round((budget * b.stake) / totalW))]));
  }, [betslip, bank]);

  const totalStake = Object.values(stakes).reduce((a, b) => a + b, 0);
  const combinedPrice = betslip.reduce((a, b) => a * b.price, 1);
  const canAcca = betslip.length === 2 && new Set(betslip.map((b) => b.matchInfo)).size === 2;

  async function copySummary() {
    const text = betslip
      .map((b, i) => `${i + 1}. ${b.matchInfo} | ${marketLabelFa(b.marketKey)} ${selectionLabel(b.selection)} @ ${fmtPrice(b.price)} | ${stakes[b.signalId] ?? b.stake}u`)
      .join("\n");
    await navigator.clipboard.writeText(`NeoBet Quant Pro — BetSlip\n${text}\nTotal: ${totalStake}u | Combined: ${fmtPrice(combinedPrice)}`);
    setCopied(true);
    toast.success("خلاصه برگه کپی شد");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Sheet open={betslipOpen} onOpenChange={setBetslipOpen}>
      <SheetContent
        side="left"
        className="flex w-full flex-col gap-3 border-slate-800 bg-[#080D18] p-4 sm:max-w-md"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="flex items-center justify-between text-right">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Layers className="size-4 text-emerald-400" />
              برگه شرط‌بندی (Order Ticket)
            </span>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setBetslipOpen(false)} aria-label="بستن">
              <X className="size-4" />
            </Button>
          </SheetTitle>
        </SheetHeader>

        {betslip.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <span className="text-3xl">🧾</span>
            برگه خالی است — از مرکز سیگنال‌ها افزودن کنید
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto scroll-slim pl-1" style={{ maxHeight: "calc(100vh - 260px)" }}>
              {betslip.map((b) => (
                <div key={b.signalId} className="glass p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{b.matchInfo}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {marketLabelFa(b.marketKey)} · {selectionLabel(b.selection)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-red-400 hover:text-red-300"
                      onClick={() => removeFromBetslip(b.signalId)}
                      aria-label={`حذف ${b.matchInfo}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="num rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-300">
                      {fmtPrice(b.price)}
                    </span>
                    <span className="num text-[11px] text-amber-300">+EV {b.evPct.toFixed(1)}%</span>
                    <span className="num rounded-lg border border-slate-700 bg-secondary px-2 py-0.5 text-xs">
                      {stakes[b.signalId] ?? b.stake}u {b.stakeMode === "KELLY_025" ? "(0.25×Kelly)" : "(Flat)"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <Separator className="bg-slate-800" />
            <div className="glass space-y-1.5 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">کل استیک روز (۲۵٪ بانک)</span>
                <span className="num font-bold text-emerald-300">{fmtUnits(totalStake, 0)}u</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ضریب ترکیبی</span>
                <span className="num font-bold">{fmtPrice(combinedPrice)}</span>
              </div>
              {canAcca && (
                <div className="text-[10px] text-amber-300/90">
                  دو پایه مستقل آماده تبدیل به میکس ۲ تایی هستند (ضریب هدف 1.80x–2.25x)
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={copySummary} className="gap-1.5 border-slate-700 text-xs">
                <Copy className="size-3.5" />
                {copied ? "کپی شد" : "کپی خلاصه برگه"}
              </Button>
              <Button
                onClick={() => {
                  clearBetslip();
                  toast.success("برگه پاک شد");
                }}
                variant="outline"
                className="gap-1.5 border-slate-700 text-xs text-red-300"
              >
                <Trash2 className="size-3.5" />
                پاک‌سازی
              </Button>
            </div>
            <Button
              className={cn("gap-2 bg-emerald-500 font-bold text-emerald-950 hover:bg-emerald-400")}
              onClick={() => window.open("https://1xbet.com", "_blank", "noopener,noreferrer")}
            >
              <Rocket className="size-4" />
              ثبت در 1xBet / BetForward
            </Button>
            <p className="text-center text-[10px] text-muted-foreground">
              لینک وابسته — مسئولیت اجرای شرط بر عهده کاربر است
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

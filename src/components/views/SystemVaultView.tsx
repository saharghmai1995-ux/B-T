"use client";

/**
 * View 6 — SystemVaultView: ⚙️ تنظیمات سیستم و کلیدهای API (System & API Vault).
 * The subscription/billing page is REMOVED — this web-app is VIP-only.
 * Here the owner configures: The Odds API v4 (1xBet/Pinnacle), Odds-API.io,
 * the Telegram bot token and the @aineobet channel id + live feed diagnostics.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAppState } from "@/components/layout/AppShell";
import { formatSafeDateTime } from "@/lib/format";
import type { AppStatePayload } from "@/lib/api-types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KeyRound, Loader2, RefreshCw, Bot, Wifi, WifiOff, ShieldCheck } from "lucide-react";

export default function SystemVaultView({ state }: { state: AppStatePayload }) {
  const [saving, setSaving] = useState(false);
  const { data: fresh, refetch, isFetching } = useAppState();
  const s: AppStatePayload = fresh ?? state;

  const [keys, setKeys] = useState({
    theOddsApiKey: "", oddsApiIoKey: "", telegramBotToken: "", telegramChatId: "",
  });

  const masked = useMemo(() => s.settings ?? {}, [s.settings]);

  async function saveKeys() {
    setSaving(true);
    try {
      const payload = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim()));
      if (Object.keys(payload).length === 0) {
        toast.info("چیزی برای ذخیره نیست — فیلدها را پر کنید");
        return;
      }
      const res = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      toast.success("کلیدها ذخیره شد — فید زنده 1xBet فعال می‌شود");
      setKeys({ theOddsApiKey: "", oddsApiIoKey: "", telegramBotToken: "", telegramChatId: "" });
      window.setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast.error("ذخیره ناموفق", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const feedLive = s.health.mode !== "OFFLINE" && s.health.espn;

  return (
    <div className="space-y-4" data-testid="vault-view">
      {/* Feed diagnostics */}
      <Card className="glass p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Wifi className={cn("size-4", feedLive ? "text-emerald-400" : "text-red-400")} />
            وضعیت فیدهای زنده (Zero-Mock)
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-8 gap-1.5 border-slate-700 text-[11px]"
            aria-label="بازخوانی وضعیت"
          >
            <RefreshCw className={cn("size-3", isFetching && "animate-spin")} />
            بازخوانی
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          <div className={cn("rounded-xl border px-3 py-2.5", feedLive ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5")}>
            <div className="flex items-center gap-1.5 font-bold">
              {feedLive ? <Wifi className="size-3.5 text-emerald-400" /> : <WifiOff className="size-3.5 text-red-400" />}
              ESPN Live
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {feedLive ? `${s.matches.length} مسابقه واقعی` : "قطع — نمایش داده ساختگی ممنوع"}
            </div>
          </div>
          <div className={cn("rounded-xl border px-3 py-2.5", s.health.oddsApi ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
            <div className="flex items-center justify-between gap-1 font-bold">
              <span>The Odds API v4</span>
              {s.health.oddsApiCredits && (
                <span className="num rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300" dir="ltr" title="اعتبار باقی‌مانده از سهمیه ۵۰۰ اعتباری ماهانه (x-requests-remaining)">
                  {s.health.oddsApiCredits}/500
                </span>
              )}
            </div>
            <div className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {s.health.oddsApi ? (
                <>
                  فعال — 1xBet/Pinnacle LIVE
                  {s.health.oddsApiKeyFromEnv && <span className="mx-1 text-cyan-300">(کلید از .env.local)</span>}
                  <br />
                  کش ۴۵ دقیقه‌ای:{" "}
                  <span className="num" dir="ltr">
                    {s.health.oddsApiCachedAt ? formatSafeDateTime(s.health.oddsApiCachedAt) : "در انتظار اولین واکشی"}
                  </span>
                  {typeof s.health.oddsApiSportKeys === "undefined" || (s.health.oddsApiSportKeys?.length ?? 0) === 0 ? null : (
                    <>
                      <br />
                      کلیدهای کش‌شده: <span className="num" dir="ltr">{s.health.oddsApiSportKeys.join(", ")}</span>
                    </>
                  )}
                  {s.health.oddsApiError && (
                    <>
                      <br />
                      <span className="text-red-300">آخرین خطا: <span className="num" dir="ltr">{s.health.oddsApiError}</span></span>
                    </>
                  )}
                </>
              ) : (
                "بدون کلید — حالت MODEL FAIR PRICE"
              )}
            </div>
          </div>
          <div className={cn("rounded-xl border px-3 py-2.5", s.health.oddsApiIo ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
            <div className="font-bold">Odds-API.io</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {s.health.oddsApiIo ? "فعال — 1xBet زنده" : "بدون کلید — غیرفعال"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700/50 bg-secondary/40 px-3 py-2.5">
            <div className="font-bold">تاریخچه واقعی ۷ روزه</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {s.health.historySeed ? `بک‌فیل واقعی: ${new Date(s.health.historySeed).toLocaleString("fa-IR")}` : "در انتظار بک‌فیل ESPN"}
            </div>
          </div>
        </div>
        <p className="mt-3 rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-3 py-2 text-[11px] leading-6 text-slate-300">
          🛡️ سیاست Zero-Mock: هیچ داده شبیه‌سازی یا ساختگی در سیستم وجود ندارد. اگر فید ESPN در دسترس نباشد،
          داشبورد صادقانه «آفلاین» نمایش داده می‌شود — به محض وارد شدن کلید 1xBet، برچسب کارت‌ها از
          <span className="num mx-1 text-amber-300">🟡 MODEL FAIR PRICE</span>
          به
          <span className="num mx-1 text-emerald-300">🟢 LIVE 1xBet REAL ODDS</span>
          تغییر می‌کند.
        </p>
      </Card>

      {/* API keys */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="glass p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold">
            <KeyRound className="size-4 text-cyan-400" />
            کلیدهای فید ضرایب
          </div>
          <div className="space-y-2.5">
            {([
              ["theOddsApiKey", "The Odds API v4 — bookmakers=onexbet,pinnacle"],
              ["oddsApiIoKey", "Odds-API.io — bookmaker=1xbet"],
            ] as const).map(([k, label]) => (
              <div key={k}>
                <label className="mb-1 block text-[10px] text-muted-foreground" dir="ltr">{label}</label>
                <Input
                  dir="ltr"
                  value={keys[k]}
                  onChange={(e) => setKeys((p) => ({ ...p, [k]: e.target.value }))}
                  placeholder={masked[k] ? `ذخیره‌شده: ${masked[k]}` : "کلید را وارد کنید…"}
                  className="num h-9 border-slate-800 bg-secondary/50 text-left text-xs"
                />
              </div>
            ))}
            <div className="rounded-xl border border-slate-800 bg-secondary/30 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
              بدون کلید، ضریب هر مارکت با فرمول مارجین شفاف
              <span className="num mx-1 text-cyan-300">1/(trueProb×1.055)</span>
              فوتبال و
              <span className="num mx-1 text-cyan-300">1/(trueProb×1.052)</span>
              تنیس ساخته می‌شود — هیچ ضریب جعلی وجود ندارد.
            </div>
          </div>
        </Card>

        <Card className="glass p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold">
            <Bot className="size-4 text-cyan-400" />
            ربات تلگرام و کانال @aineobet
          </div>
          <div className="space-y-2.5">
            {([
              ["telegramBotToken", "Telegram Bot Token (from @BotFather)"],
              ["telegramChatId", "Telegram Chat/Channel ID (@aineobet)"],
            ] as const).map(([k, label]) => (
              <div key={k}>
                <label className="mb-1 block text-[10px] text-muted-foreground" dir="ltr">{label}</label>
                <Input
                  dir="ltr"
                  value={keys[k]}
                  onChange={(e) => setKeys((p) => ({ ...p, [k]: e.target.value }))}
                  placeholder={masked[k] ? `ذخیره‌شده: ${masked[k]}` : "مقدار را وارد کنید…"}
                  className="num h-9 border-slate-800 bg-secondary/50 text-left text-xs"
                />
              </div>
            ))}
            <div className="rounded-xl border border-slate-800 bg-secondary/30 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
              با تنظیم توکن و شناسه کانال، دکمه «ارسال فوری به @aineobet» در استودیو تلگرام واقعاً پوستر را با sendPhoto ارسال می‌کند.
            </div>
          </div>
        </Card>
      </div>

      {/* Access policy */}
      <Card className="glass p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold">
          <ShieldCheck className="size-4 text-emerald-400" />
          سیاست دسترسی وب‌اپ
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-300">👑 VIP-Only</Badge>
          <span className="text-[11px] text-slate-300">
            این وب‌اپلیکیشن منحصراً برای مالک سیستم و اعضای تاییدشده VIP است — تمام کارت‌ها و بخش‌ها ۱۰۰٪ باز و بدون هیچ پایل‌وال یا افکت تار نمایش داده می‌شوند.
          </span>
        </div>
      </Card>
    </div>
  );
}

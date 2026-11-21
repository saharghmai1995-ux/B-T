"use client";

/**
 * View 6 — BillingApiView: VIP pricing, dual payment modal (USDT QR +
 * Iranian card-to-card), profile and API key configuration.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";
import { useAppState } from "@/components/layout/AppShell";
import type { AppStatePayload } from "@/lib/api-types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, Crown, Gem, KeyRound, Loader2, QrCode, CreditCard, Copy } from "lucide-react";

const PLANS = [
  { key: "FREE", name: "Free", price: "$0", period: "همیشه", features: ["۱ سیگنال رایگان روزانه", "کارنامه SHA-256", "دفتر سایه"], cta: "فعال" },
  { key: "WEEKEND", name: "Weekend Pass", price: "$7", period: "۴۸ ساعت", features: ["همه سیگنال‌ها آخر هفته", "میکس ۲ تایی", "پوش تلگرام"], cta: "خرید سریع" },
  { key: "PRO_VIP", name: "Pro VIP", price: "$29", period: "ماهانه", features: ["تمام سیگنال‌های +EV", "0.25× Kelly استیکینگ", "کنسول QQL و RCA", "پشتیبانی اولویت‌دار"], cta: "ارتقا به VIP" },
  { key: "ENTERPRISE", name: "Enterprise API", price: "$99", period: "ماهانه", features: ["REST API کامل", "فید ضرایب 1xBet/Pinnacle", "وبهوک سیگنال", "SLA ۹۹.۹٪"], cta: "اتصال API" },
] as const;

const USDT_ADDR = "TJ9xQZNeoBetQuantProDemoTRC20Addr888";
const CARD_NO = "6219-8610-0000-0000-0000-1";

export default function BillingApiView({ state }: { state: AppStatePayload }) {
  const { tier, setTier } = useAppStore();
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"USDT" | "CARD">("USDT");
  const [saving, setSaving] = useState(false);
  const { data: fresh } = useAppState();
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

  return (
    <div className="space-y-4" data-testid="billing-view">
      {/* Pricing */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const active = tier === p.key || (p.key === "PRO_VIP" && tier === "PRO_VIP");
          return (
            <Card key={p.key} className={cn("glass glass-hover flex flex-col p-4", p.key === "PRO_VIP" && "border-amber-400/40")}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">{p.name}</span>
                {p.key === "PRO_VIP" && <Badge className="vip-gold text-[10px]">محبوب</Badge>}
                {active && <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-300">فعال</Badge>}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="num text-2xl font-extrabold">{p.price}</span>
                <span className="text-[10px] text-muted-foreground">/ {p.period}</span>
              </div>
              <ul className="mt-3 flex-1 space-y-1.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                    <Check className="size-3 text-emerald-400" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-3 gap-1.5 text-xs"
                variant={p.key === "PRO_VIP" ? "default" : "outline"}
                disabled={p.key === "FREE" || active}
                onClick={() => setPayOpen(true)}
              >
                {p.key === "PRO_VIP" && <Crown className="size-3.5" />}
                {active ? "پلن جاری شما" : p.cta}
              </Button>
            </Card>
          );
        })}
      </div>

      {/* Payment modal */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="border-slate-800 bg-[#0C1220]">
          <DialogHeader>
            <DialogTitle className="text-sm">درگاه پرداخت دوگانه</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            {([["USDT", "تتر (TRC20/Polygon)"], ["CARD", "کارت‌به‌کارت ریالی"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setPayMethod(k)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition-all",
                  payMethod === k ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-800 text-muted-foreground",
                )}
              >
                {k === "USDT" ? <QrCode className="size-3.5" /> : <CreditCard className="size-3.5" />}
                {l}
              </button>
            ))}
          </div>
          {payMethod === "USDT" ? (
            <div className="space-y-2 text-xs">
              <div className="glass p-3">
                <div className="mb-1 text-[10px] text-muted-foreground">آدرس تتر TRC20</div>
                <div className="num break-all rounded-lg bg-secondary/60 p-2 text-left text-[10px]" dir="ltr">{USDT_ADDR}</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full gap-1.5 border-slate-700 text-[10px]"
                  onClick={() => { navigator.clipboard.writeText(USDT_ADDR); toast.success("آدرس کپی شد"); }}
                >
                  <Copy className="size-3" /> کپی آدرس
                </Button>
              </div>
              <p className="text-[10px] leading-5 text-muted-foreground">
                پس از واریز، TXID را برای پشتیبانی @aineobet ارسال کنید؛ اشتراک Pro VIP ظرف چند دقیقه فعال می‌شود.
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="glass p-3">
                <div className="mb-1 text-[10px] text-muted-foreground">کارت‌به‌کارت (سامان تجارت)</div>
                <div className="num rounded-lg bg-secondary/60 p-2 text-left text-sm tracking-widest" dir="ltr">{CARD_NO}</div>
                <div className="num mt-1 text-[11px] text-amber-300">مبلغ: ۲٬۹۰۰٬۰۰۰ ریال — به نام شرکت توسعه‌گران کوانت</div>
              </div>
              <p className="text-[10px] leading-5 text-muted-foreground">
                رسید واریز را همراه نام کاربری به @aineobet بفرستید.
              </p>
            </div>
          )}
          <Button
            className="w-full gap-1.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            onClick={() => { setPayOpen(false); setTier("PRO_VIP"); toast.success("حالت نمایش Pro VIP فعال شد (دمو پرداخت)"); }}
          >
            <Gem className="size-3.5" />
            تکمیل و فعال‌سازی نمایشی VIP
          </Button>
        </DialogContent>
      </Dialog>

      {/* API settings + profile */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="glass p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold">
            <KeyRound className="size-4 text-emerald-400" />
            تنظیمات API و فید ضرایب
          </div>
          <div className="space-y-2.5">
            {([
              ["theOddsApiKey", "The Odds API v4 (bookmakers=onexbet,pinnacle)"],
              ["oddsApiIoKey", "Odds-API.io (bookmaker=1xbet)"],
              ["telegramBotToken", "Telegram Bot Token"],
              ["telegramChatId", "Telegram Chat/Channel ID (@aineobet)"],
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
            <Button onClick={saveKeys} disabled={saving} className="w-full gap-1.5 bg-emerald-500 text-xs text-emerald-950 hover:bg-emerald-400">
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              ذخیره کلیدها
            </Button>
            <p className="text-[10px] leading-5 text-muted-foreground">
              بدون کلید، ضرایب در حالت شفاف «1xBet MARKET ESTIMATE» با فرمول مارجین واقعی
              <span className="num mx-1">1/(trueProb×1.055)</span>فوتبال و
              <span className="num mx-1">1/(trueProb×1.052)</span>تنیس ساخته می‌شوند — هیچ ضریب مصنوعی وجود ندارد.
            </p>
          </div>
        </Card>

        <Card className="glass p-4">
          <div className="mb-3 text-sm font-bold">پروفایل و وضعیت اشتراک</div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-secondary/40 px-3 py-2">
              <span className="text-muted-foreground">سطح فعلی (دمو)</span>
              <span className={cn("num font-bold", tier === "FREE" ? "text-slate-300" : tier === "PRO_VIP" ? "text-amber-300" : "text-violet-300")}>
                {tier}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-secondary/40 px-3 py-2">
              <span className="text-muted-foreground">موجودی بانک</span>
              <span className="num font-bold text-emerald-300">{s.metrics.bankroll.toFixed(1)}u</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-secondary/40 px-3 py-2">
              <span className="text-muted-foreground">سیگنال باز</span>
              <span className="num">{s.metrics.openCount}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-secondary/40 px-3 py-2">
              <span className="text-muted-foreground">وضعیت فید</span>
              <span className={cn("num", s.health.espn ? "text-emerald-300" : "text-red-300")}>
                {s.health.espn ? "ESPN زنده" : "فید قطع"} {s.health.oddsApi ? "· Odds API فعال" : "· ESTIMATE"}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-secondary/40 px-3 py-2 text-[10px] leading-5 text-muted-foreground">
              تست Paywall: سوییچ سطح اشتراک در نوار بالا، قفل سیگنال‌ها را در مرکز سیگنال‌ها تغییر می‌دهد.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

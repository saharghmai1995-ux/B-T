"use client";

/**
 * ChannelManagerCard (v2.6) — Telegram connection & PUBLIC/VIP lane manager.
 *
 * Live status of the bot (getMe) + both broadcast lanes (getChat validation),
 * inline lane configuration with real-time test sends, and the honest outbox
 * of the most recent delivery attempts. The bot token itself is never sent to
 * the client — only a masked indicator and the live connection verdict.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Bot,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Radio,
  Send,
  XCircle,
} from "lucide-react";

interface BotIdentity {
  configured: boolean;
  connected: boolean;
  botId?: number;
  username?: string;
  displayName?: string;
  error?: string;
}

interface LaneStatus {
  configured: boolean;
  reachable: boolean;
  chatId: string;
  title?: string;
  type?: string;
  username?: string;
  error?: string;
}

interface ChannelsResp {
  ok: boolean;
  bot?: BotIdentity;
  lanes?: { PUBLIC: LaneStatus; VIP: LaneStatus; DEFAULT: LaneStatus };
  recent?: Array<{ id: string; kind: string; title: string; sent: boolean; transport: string; createdAt: string }>;
  error?: string;
}

type Lane = "PUBLIC" | "VIP" | "DEFAULT";

export default function ChannelManagerCard() {
  const [data, setData] = useState<ChannelsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [pubInput, setPubInput] = useState("");
  const [vipInput, setVipInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Lane | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/telegram/channels", { cache: "no-store" });
      const j = (await res.json()) as ChannelsResp;
      if (!j.ok) throw new Error(j.error ?? "خطای وضعیت اتصال");
      setData(j);
    } catch (e) {
      if (!silent) toast.error("وضعیت کانال‌ها دریافت نشد", { description: (e as Error).message });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // keep the connection verdict fresh — light poll, silent
    const iv = window.setInterval(() => void load(true), 120_000);
    return () => window.clearInterval(iv);
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/telegram/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          publicChannelId: pubInput.trim(),
          vipChannelId: vipInput.trim(),
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; saved?: string[] };
      if (!j.ok) throw new Error(j.error ?? "ذخیره ناموفق بود");
      toast.success("شناسه کانال‌ها ذخیره شد", {
        description: j.saved?.join(" + ") || "—",
      });
      await load(true);
    } catch (e) {
      toast.error("ذخیره کانال‌ها ناموفق", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function testSend(lane: Lane) {
    setTesting(lane);
    try {
      const res = await fetch("/api/telegram/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", channel: lane }),
      });
      const j = (await res.json()) as { ok: boolean; sent?: boolean; transport?: string; error?: string };
      if (!j.ok) throw new Error(j.error ?? "تست ارسال ناموفق بود");
      if (j.sent) {
        toast.success(`کارت تست به کانال ${lane} ارسال شد`, { description: j.transport });
      } else {
        toast.error(`ارسال به ${lane} ناموفق`, { description: j.error ?? j.transport });
      }
      await load(true);
    } catch (e) {
      toast.error("تست ارسال خطا داد", { description: (e as Error).message });
    } finally {
      setTesting(null);
    }
  }

  const bot = data?.bot;
  const lanes = data?.lanes;

  const laneChip = (lane: LaneStatus) =>
    lane.reachable ? (
      <Badge className="border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-300">
        متصل{lane.title ? ` — ${lane.title.slice(0, 24)}` : ""}
      </Badge>
    ) : lane.configured ? (
      <Badge className="border-red-500/40 bg-red-500/10 text-[9px] text-red-300">
        خطا — {lane.error?.slice(0, 40) ?? "دسترس‌ناپذیر"}
      </Badge>
    ) : (
      <Badge variant="outline" className="border-slate-700 text-[9px] text-slate-500">
        تنظیم نشده
      </Badge>
    );

  return (
    <Card className="glass p-4" data-testid="channel-manager">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-cyan-300" />
          <h2 className="text-sm font-bold">🛰 مدیریت اتصال تلگرام — کانال عمومی و VIP</h2>
        </div>
        <div className="flex items-center gap-2">
          {bot?.connected ? (
            <Badge className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-300">
              <CheckCircle2 className="mr-1 size-3" /> بات متصل
              {bot.username ? ` — @${bot.username}` : ""}
            </Badge>
          ) : bot?.configured ? (
            <Badge className="border-red-500/40 bg-red-500/10 text-[10px] text-red-300">
              <XCircle className="mr-1 size-3" /> اتصال ناموفق — {bot.error?.slice(0, 30)}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-slate-700 text-[10px] text-slate-500">
              توکن بات تنظیم نشده
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            className="h-7 gap-1 border border-slate-800 px-2 text-[10px]"
            aria-label="بازخوانی وضعیت اتصال"
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          </Button>
        </div>
      </div>

      {/* lane config + status */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["PUBLIC", "VIP"] as const).map((lane) => {
          const st = lanes?.[lane];
          const value = lane === "PUBLIC" ? pubInput : vipInput;
          const setValue = lane === "PUBLIC" ? setPubInput : setVipInput;
          return (
            <div key={lane} className="rounded-xl border border-slate-800 bg-secondary/40 p-2.5">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                <span className={cn("text-[11px] font-bold", lane === "VIP" ? "text-amber-300" : "text-cyan-300")}>
                  {lane === "VIP" ? "👑 کانال VIP" : "📢 کانال عمومی"}
                </span>
                {st && laneChip(st)}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={st?.chatId || "@username یا -100..."}
                  dir="ltr"
                  className="h-8 border-slate-800 bg-secondary/60 text-left text-[11px]"
                  aria-label={`شناسه کانال ${lane}`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void testSend(lane)}
                  disabled={testing !== null || !bot?.connected || !st?.configured}
                  className="h-8 shrink-0 gap-1 border-cyan-500/40 bg-cyan-500/5 px-2 text-[10px] text-cyan-300 hover:bg-cyan-500/10"
                  title="ارسال کارت تست به این کانال"
                >
                  {testing === lane ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                  تست
                </Button>
              </div>
              {st?.reachable && st.title && (
                <div className="mt-1 text-[10px] text-slate-500" dir="ltr">
                  {st.type ?? "channel"} · {st.title}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={saving || (!pubInput.trim() && !vipInput.trim())}
          className="h-8 gap-1 bg-cyan-500 px-3 text-[11px] text-cyan-950 hover:bg-cyan-400"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <Radio className="size-3" />}
          ذخیره شناسه کانال‌ها
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void testSend("DEFAULT")}
          disabled={testing !== null || !bot?.connected}
          className="h-8 gap-1 border-slate-700 px-3 text-[11px] text-slate-300"
          title="ارسال تست به چت پیش‌فرض (تنظیمات قبلی)"
        >
          {testing === "DEFAULT" ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
          تست چت پیش‌فرض
        </Button>
        <span className="text-[10px] leading-4 text-muted-foreground">
          بات باید در هر دو کانال «Admin — Post Messages» باشد؛ در غیر این صورت تلگرام ارسال را رد می‌کند.
        </span>
      </div>

      {/* honest outbox */}
      {data?.recent && data.recent.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold text-slate-400">صندوق ارسال (آخرین تلاش‌های واقعی)</div>
          <div className="max-h-28 space-y-1 overflow-y-auto scroll-slim pr-1">
            {data.recent.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md border border-slate-800/70 bg-secondary/30 px-2 py-1"
              >
                <span className="truncate text-[10px] text-slate-300" dir="ltr">
                  {r.kind} · {r.title.slice(0, 42)}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="num text-[9px] text-slate-500" dir="ltr">
                    {r.transport.slice(0, 22)}
                  </span>
                  {r.sent ? (
                    <CheckCircle2 className="size-3 text-emerald-400" />
                  ) : (
                    <XCircle className="size-3 text-red-400" />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

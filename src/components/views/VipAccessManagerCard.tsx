"use client";

/**
 * VipAccessManagerCard (v3.4) — full management console of @Aineobet_bot
 * for the private "NeoBet VIP 👑" channel.
 *
 * Sections:
 *   • live gate status — channel, bot admin rights, member count, admins
 *   • dedicated invite-link minting (single-use / limited / expiring) + revoke
 *   • pending join requests with approve/decline + auto-approve switch
 *   • kick member by Telegram ID
 *   • live updater heartbeat + manual poll
 *   • honest event stream — only REAL Bot-API outcomes are ever displayed
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Copy,
  Crown,
  ExternalLink,
  Gavel,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserMinus,
  Users,
  XCircle,
  Zap,
} from "lucide-react";

interface VipStatus {
  bot: { connected: boolean; username?: string; displayName?: string; botId?: number; error?: string };
  channel: {
    configured: boolean;
    reachable: boolean;
    chatId: string;
    title?: string;
    type?: string;
    error?: string;
  };
  rights: { ok: boolean; status?: string; canInviteUsers?: boolean; canRestrictMembers?: boolean; canApproveMembers?: boolean; canPostMessages?: boolean; error?: string };
  memberCount: { ok: boolean; count?: number; error?: string };
  admins: { ok: boolean; rows?: Array<{ userId: number; status: string; username?: string; displayName?: string; isBot: boolean }>; error?: string };
  autoApprove: boolean;
}

interface VipLinkRow {
  id: string;
  label: string;
  link: string;
  memberLimit: number | null;
  expireAt: string | null;
  isRevoked: boolean;
  createdAt: string;
}

interface VipRequestRow {
  id: string;
  userId: number;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  status: string;
  handledBy?: string | null;
  createdAt: string;
}

interface VipEventRow {
  id: string;
  kind: string;
  userId?: number | null;
  username?: string | null;
  firstName?: string | null;
  detail?: string | null;
  createdAt: string;
}

interface VipResp {
  ok: boolean;
  error?: string;
  status?: VipStatus;
  links?: VipLinkRow[];
  requests?: VipRequestRow[];
  events?: VipEventRow[];
  updater?: {
    started: boolean;
    running: boolean;
    lastOkAt: string | null;
    processed: number;
    errors: number;
    lastError: string | null;
  };
}

const USES_OPTIONS = [
  { label: "۱ نفر", value: 1 },
  { label: "۵ نفر", value: 5 },
  { label: "۱۰ نفر", value: 10 },
  { label: "نامحدود", value: 0 },
];

const TTL_OPTIONS = [
  { label: "۲۴ ساعت", value: 24 },
  { label: "۷۲ ساعت", value: 72 },
  { label: "۷ روز", value: 168 },
  { label: "۳۰ روز", value: 720 },
  { label: "بدون انقضا", value: 0 },
];

function timeFa(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fa-IR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

const EVENT_STYLE: Record<string, { color: string; label: string }> = {
  JOIN_REQUEST: { color: "text-amber-300", label: "درخواست عضویت" },
  AUTO_APPROVED: { color: "text-emerald-300", label: "پذیرش خودکار" },
  MEMBER_JOINED: { color: "text-emerald-300", label: "عضو جدید" },
  MEMBER_LEFT: { color: "text-slate-400", label: "خروج عضو" },
  MEMBER_KICKED: { color: "text-red-300", label: "حذف عضو" },
  LINK_CREATED: { color: "text-cyan-300", label: "لینک ساخته شد" },
  LINK_REVOKED: { color: "text-red-300", label: "لینک لغو شد" },
  ADMIN_ACTION: { color: "text-violet-300", label: "اقدام ادمین" },
  ADMIN_ALERT: { color: "text-orange-300", label: "هشدار" },
  UPDATER: { color: "text-slate-400", label: "آپدیتر" },
};

export default function VipAccessManagerCard() {
  const [data, setData] = useState<VipResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // create-link form
  const [label, setLabel] = useState("");
  const [uses, setUses] = useState(1);
  const [ttl, setTtl] = useState(24);
  const [needsApproval, setNeedsApproval] = useState(false);

  // kick form
  const [kickId, setKickId] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/telegram/vip", { cache: "no-store" });
      const j = (await res.json()) as VipResp;
      if (!j.ok) throw new Error(j.error ?? "خطای وضعیت VIP");
      setData(j);
    } catch (e) {
      if (!silent) toast.error("وضعیت VIP دریافت نشد", { description: (e as Error).message });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const iv = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(iv);
  }, [load]);

  async function act(payload: Record<string, unknown>, busyKey: string, successMsg: string) {
    setBusy(busyKey);
    try {
      const res = await fetch("/api/telegram/vip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; processed?: number };
      if (!j.ok) throw new Error(j.error ?? "اکشن ناموفق بود");
      toast.success(successMsg, j.processed !== undefined ? { description: `processed: ${j.processed}` } : undefined);
      await load(true);
      return true;
    } catch (e) {
      toast.error("اکشن VIP ناموفق", { description: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createLink() {
    if (!label.trim()) {
      toast.info("برچسب لینک را بنویسید (مثلاً نام مشترک)");
      return;
    }
    const ok = await act(
      {
        action: "create_link",
        label: label.trim(),
        memberLimit: uses > 0 ? uses : undefined,
        expiresInHours: ttl > 0 ? ttl : undefined,
        createsJoinRequest: needsApproval,
      },
      "create",
      "لینک اختصاصی VIP ساخته شد ✅",
    );
    if (ok) setLabel("");
  }

  function copyLink(link: string) {
    void navigator.clipboard
      .writeText(link)
      .then(() => toast.success("لینک کپی شد", { description: link }))
      .catch(() => toast.error("کپی ناموفق بود"));
  }

  const st = data?.status;
  const updater = data?.updater;
  const pending = (data?.requests ?? []).filter((r) => r.status === "PENDING");

  const rightChip = (ok: boolean | undefined, text: string) =>
    ok === true ? (
      <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-300">
        <CheckCircle2 className="size-2.5" /> {text}
      </span>
    ) : (
      <span className="inline-flex items-center gap-0.5 text-[9px] text-red-300">
        <XCircle className="size-2.5" /> {text}
      </span>
    );

  return (
    <Card className="glass p-4" data-testid="vip-access-manager">
      {/* header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Crown className="size-4 text-amber-300" />
          <h2 className="text-sm font-bold">👑 دروازه VIP — مدیریت کامل @Aineobet_bot</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {updater?.started ? (
            <Badge
              className={cn(
                "border-emerald-500/40 bg-emerald-500/10 text-[9px] text-emerald-300",
                updater.running && "animate-pulse",
              )}
              title={updater.lastError ?? undefined}
            >
              آپدیتر زنده · {updater.processed} رویداد
            </Badge>
          ) : (
            <Badge variant="outline" className="border-slate-700 text-[9px] text-slate-500">
              آپدیتر خاموش
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            className="h-7 gap-1 border border-slate-800 px-2 text-[10px]"
            aria-label="بازخوانی وضعیت VIP"
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          </Button>
        </div>
      </div>

      {/* status strip */}
      {st && (
        <div className="mb-3 grid grid-cols-1 gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 sm:grid-cols-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-amber-200">کانال</div>
            <div className="truncate text-[11px] text-slate-200" dir="ltr">
              {st.channel.reachable ? `${st.channel.title ?? "—"} · ${st.channel.chatId}` : st.channel.error ?? "تنظیم نشده"}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[9px] text-slate-400">
              <Users className="size-3" />
              {st.memberCount.ok ? `${st.memberCount.count} عضو` : "—"}
              {st.admins.ok && st.admins.rows
                ? ` · ${st.admins.rows.filter((a) => !a.isBot).length} ادمین انسانی`
                : ""}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-amber-200">حقوق بات در کانال</div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5" dir="ltr">
              {rightChip(st.rights.ok && st.rights.canInviteUsers, "invite_links")}
              {rightChip(st.rights.ok && st.rights.canRestrictMembers, "restrict")}
              {/* In channels the join-request approval right rides can_invite_users;
                  can_approve_members only exists on supergroups. */}
              {rightChip(st.rights.ok && (st.rights.canApproveMembers === true || st.rights.canInviteUsers === true), "approve")}
            </div>
            <div className="text-[9px] text-slate-400" dir="ltr">
              {st.rights.status ?? st.rights.error ?? "unknown"}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-amber-200">ادمین‌های کانال</div>
            <div className="mt-0.5 space-y-0.5" dir="ltr">
              {st.admins.ok && st.admins.rows ? (
                st.admins.rows.map((a) => (
                  <div key={a.userId} className="truncate text-[10px] text-slate-300">
                    {a.isBot ? "🤖" : a.status === "creator" ? "👑" : "•"} {a.username ? `@${a.username}` : a.displayName} —{" "}
                    {a.status}
                  </div>
                ))
              ) : (
                <div className="text-[10px] text-slate-500">—</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* controls row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-secondary/40 px-2 py-1">
          <ShieldCheck className={cn("size-3.5", st?.autoApprove ? "text-emerald-300" : "text-slate-500")} />
          <span className="text-[10px] text-slate-300">پذیرش خودکار درخواست‌ها</span>
          <Switch
            checked={st?.autoApprove ?? false}
            onCheckedChange={(v) => void act({ action: "toggle_auto_approve", enabled: v }, "auto", v ? "پذیرش خودکار فعال شد" : "پذیرش خودکار خاموش شد")}
            disabled={busy === "auto"}
            aria-label="پذیرش خودکار درخواست عضویت"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void act({ action: "poll_now" }, "poll", "اسکن دستی به‌روزرسانی‌ها انجام شد")}
          disabled={busy === "poll" || !st?.bot.connected}
          className="h-7 gap-1 border-violet-500/40 bg-violet-500/5 px-2 text-[10px] text-violet-300 hover:bg-violet-500/10"
          title="خواندن فوری رویدادهای جدید بات از تلگرام"
        >
          {busy === "poll" ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
          اسکن فوری رویدادها
        </Button>
        <div className="flex items-center gap-1">
          <Input
            value={kickId}
            onChange={(e) => setKickId(e.target.value)}
            placeholder="UserID برای حذف از کانال"
            dir="ltr"
            className="h-7 w-40 border-slate-800 bg-secondary/60 text-left text-[10px]"
            aria-label="شناسه عددی کاربر برای حذف"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const uid = Number(kickId.trim());
              if (!Number.isFinite(uid) || uid <= 0) {
                toast.info("شناسه عددی معتبر وارد کنید");
                return;
              }
              void act({ action: "kick_member", userId: uid }, `kick-${uid}`, `عضو ${uid} حذف شد`);
            }}
            disabled={busy !== null || !kickId.trim()}
            className="h-7 shrink-0 gap-1 border-red-500/40 bg-red-500/5 px-2 text-[10px] text-red-300 hover:bg-red-500/10"
          >
            {busy?.startsWith("kick-") ? <Loader2 className="size-3 animate-spin" /> : <UserMinus className="size-3" />}
            حذف
          </Button>
        </div>
      </div>

      {/* pending join requests */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-300">
            درخواست‌های عضویت در انتظار
            {pending.length > 0 && (
              <Badge className="ml-1 border-amber-500/40 bg-amber-500/10 text-[9px] text-amber-300">{pending.length}</Badge>
            )}
          </span>
        </div>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-slate-800/70 bg-secondary/30 px-2 py-2 text-[10px] text-slate-500">
            درخواست در انتظاری وجود ندارد — با فعال‌کردن «Join Requests» در تنظیمات لینک، درخواست‌ها اینجا ظاهر می‌شوند.
          </div>
        ) : (
          <div className="max-h-32 space-y-1 overflow-y-auto scroll-slim pr-1">
            {pending.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1.5"
              >
                <div className="min-w-0 text-[10px] text-slate-200" dir="ltr">
                  <span className="font-bold">{r.firstName ?? ""} {r.lastName ?? ""}</span>
                  {r.username ? ` · @${r.username}` : ""} · ID <span className="num">{r.userId}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    onClick={() => void act({ action: "approve_request", id: r.id }, `ok-${r.id}`, "درخواست پذیرفته شد — عضو اضافه شد")}
                    disabled={busy !== null}
                    className="h-6 gap-1 bg-emerald-500 px-2 text-[10px] text-emerald-950 hover:bg-emerald-400"
                  >
                    {busy === `ok-${r.id}` ? <Loader2 className="size-2.5 animate-spin" /> : <CheckCircle2 className="size-2.5" />}
                    پذیرش
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void act({ action: "decline_request", id: r.id }, `no-${r.id}`, "درخواست رد شد")}
                    disabled={busy !== null}
                    className="h-6 gap-1 border-slate-700 px-2 text-[10px] text-slate-300"
                  >
                    {busy === `no-${r.id}` ? <Loader2 className="size-2.5 animate-spin" /> : <XCircle className="size-2.5" />}
                    رد
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* dedicated link minting */}
      <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Link2 className="size-3.5 text-cyan-300" />
          <span className="text-[11px] font-bold text-cyan-200">ساخت لینک اختصاصی VIP</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="برچسب — نام مشترک / سفارش"
            className="h-8 min-w-36 flex-1 border-slate-800 bg-secondary/60 text-[11px]"
            aria-label="برچسب لینک اختصاصی"
          />
          <div className="flex items-center gap-1" role="group" aria-label="سقف استفاده">
            {USES_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setUses(o.value)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[10px] transition-all",
                  uses === o.value
                    ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200"
                    : "border-slate-800 bg-secondary/40 text-slate-400 hover:border-slate-600",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="مدت اعتبار">
            {TTL_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setTtl(o.value)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[10px] transition-all",
                  ttl === o.value
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-200"
                    : "border-slate-800 bg-secondary/40 text-slate-400 hover:border-slate-600",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-slate-300">
            <Switch
              checked={needsApproval}
              onCheckedChange={setNeedsApproval}
              aria-label="نیاز به تأیید ادمین برای عضویت"
            />
            با تأیید ادمین
          </label>
          <Button
            size="sm"
            onClick={() => void createLink()}
            disabled={busy === "create"}
            className="h-8 gap-1 bg-cyan-500 px-3 text-[11px] text-cyan-950 hover:bg-cyan-400"
          >
            {busy === "create" ? <Loader2 className="size-3 animate-spin" /> : <Link2 className="size-3" />}
            ساخت لینک
          </Button>
        </div>
      </div>

      {/* links ledger */}
      <div className="mb-3">
        <div className="mb-1 text-[10px] font-bold text-slate-300">دفتر لینک‌های اختصاصی ({data?.links?.length ?? 0})</div>
        {!data?.links || data.links.length === 0 ? (
          <div className="rounded-lg border border-slate-800/70 bg-secondary/30 px-2 py-2 text-[10px] text-slate-500">
            هنوز لینکی ساخته نشده است.
          </div>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto scroll-slim pr-1">
            {data.links.map((l) => (
              <div
                key={l.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-1.5 rounded-md border px-2 py-1.5",
                  l.isRevoked
                    ? "border-slate-800/60 bg-secondary/20 opacity-60"
                    : "border-slate-800/70 bg-secondary/30",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-bold text-slate-200">
                    {l.label}
                    {l.isRevoked && <Badge className="ml-1 border-red-500/40 bg-red-500/10 text-[8px] text-red-300">لغو شده</Badge>}
                  </div>
                  <div className="num truncate text-[9px] text-slate-500" dir="ltr">
                    {l.link}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[9px] text-slate-400">
                  <span>{l.memberLimit ? `سقف ${l.memberLimit} نفر` : "نامحدود"}</span>
                  <span>·</span>
                  <span dir="rtl">انقضا {l.expireAt ? timeFa(l.expireAt) : "—"}</span>
                  <span>·</span>
                  <span>{timeFa(l.createdAt)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 border border-slate-800 p-0"
                    onClick={() => copyLink(l.link)}
                    aria-label="کپی لینک"
                    title="کپی لینک"
                  >
                    <Copy className="size-2.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 border border-slate-800 p-0"
                    onClick={() => window.open(l.link, "_blank", "noopener")}
                    aria-label="باز کردن لینک"
                    title="باز کردن در تلگرام"
                  >
                    <ExternalLink className="size-2.5" />
                  </Button>
                  {!l.isRevoked && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void act({ action: "revoke_link", id: l.id }, `rev-${l.id}`, "لینک لغو شد — دیگر هیچ‌کس وارد نمی‌شود")}
                      disabled={busy !== null}
                      className="h-6 gap-1 border border-red-500/40 bg-red-500/5 px-1.5 text-[9px] text-red-300 hover:bg-red-500/10"
                    >
                      {busy === `rev-${l.id}` ? <Loader2 className="size-2.5 animate-spin" /> : <Gavel className="size-2.5" />}
                      لغو
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* event stream */}
      <div>
        <div className="mb-1 text-[10px] font-bold text-slate-300">جریان رخدادهای دروازه (فقط واقعی)</div>
        {!data?.events || data.events.length === 0 ? (
          <div className="rounded-lg border border-slate-800/70 bg-secondary/30 px-2 py-2 text-[10px] text-slate-500">
            هنوز رخدادی ثبت نشده است.
          </div>
        ) : (
          <div className="max-h-32 space-y-1 overflow-y-auto scroll-slim pr-1">
            {data.events.map((ev) => {
              const s = EVENT_STYLE[ev.kind] ?? { color: "text-slate-400", label: ev.kind };
              return (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-800/70 bg-secondary/30 px-2 py-1"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("shrink-0 text-[9px] font-bold", s.color)}>{s.label}</span>
                    <span className="truncate text-[10px] text-slate-300" dir="ltr">
                      {ev.firstName ?? ""} {ev.username ? `@${ev.username}` : ""} {ev.userId ? `· ${ev.userId}` : ""}{" "}
                      {ev.detail ? `· ${ev.detail}` : ""}
                    </span>
                  </div>
                  <span className="shrink-0 text-[9px] text-slate-500">{timeFa(ev.createdAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

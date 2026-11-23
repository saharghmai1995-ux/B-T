"use client";

/**
 * View 5 — TelegramStudioView v2.0 (@aineobet Broadcast Studio).
 *
 * Flagship: client-side Canvas 2D poster engine (1080x1350) that paints the
 * full poster SYNCHRONOUSLY on mount (logos resolve later and re-paint —
 * the canvas is never black while waiting on any network call).
 *
 * Modules:
 *   ب) Educational posts studio (Kelly / Shin / CLV / Dixon-Coles presets)
 *   الف) Broadcast schedule board (honest send statuses — future slots are
 *       never auto-marked "sent") — GET/POST /api/broadcast
 *   ج) Live ESPN news radar (auto refresh 120s) → news poster variant
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { officialBetLine, marketFa } from "@/lib/markets";
import {
  fmtDateTimeFa,
  fmtClock,
  statusColor,
} from "@/lib/api-types";
import type {
  AppStatePayload,
  AppSignal,
  NewsItem,
  ScheduleSlot,
} from "@/lib/api-types";
import ChannelManagerCard from "@/components/views/ChannelManagerCard";
import { NoLossChip, ShieldBadge, TierBadge } from "@/components/shared/primitives";
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  GraduationCap,
  Loader2,
  Newspaper,
  Palette,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Constants & types                                                   */
/* ------------------------------------------------------------------ */

const POSTER_W = 1080;
const POSTER_H = 1350;

const CYAN = "#22D3EE";
const EMERALD = "#34D399";
const VIOLET = "#A78BFA";
const GOLD = "#FBBF24";
const RED = "#F87171";

type PosterMode = "SIGNAL" | "WIN" | "LOSS";

const MODE_ACCENT: Record<PosterMode, string> = {
  SIGNAL: CYAN,
  WIN: EMERALD,
  LOSS: RED,
};

const MODE_TAGLINE: Record<PosterMode, string> = {
  SIGNAL: "NEW SIGNAL — PRE-MATCH LOCKED",
  WIN: "WIN — SETTLED & VERIFIED",
  LOSS: "LOSS — FULL TRANSPARENCY",
};

interface PosterSpec {
  home: string;
  away: string;
  homeLogo: string | null;
  awayLogo: string | null;
  competition: string;
  marketEn: string;
  marketFa: string;
  marketKey: string;
  kickoffIso: string;
  venue: string | null;
  hash: string;
  mode: PosterMode;
  scoreLine: string | null;
  sport: string;
  /* v3.1 — SuperAgent ensemble metadata for the shield metric row. */
  status: string;
  shieldType: string | null;
  tier: string | null;
  noLossProb: number | null; // fraction 0..1 (win + push mass)
  consensusPct: number | null; // 0..100 agent consensus
  modelProb: number; // fallback source for no-loss / consensus values
}

/* v3.1 — English-only shield/tier naming for the poster metric row
   (the poster canvas is 100% English LTR; Persian lives in captions). */
const SHIELD_EN: Record<string, string> = {
  FULL_PUSH_SHIELD: "PUSH SHIELD",
  HALF_PUSH_SHIELD: "HALF PUSH",
  DOUBLE_OUTCOME_SHIELD: "DOUBLE CHANCE",
  DIRECT_WIN: "DIRECT WIN",
};
const TIER_EN: Record<string, string> = {
  TIER_S: "S",
  TIER_A: "A",
  TIER_B: "B",
};

/* v3.2 — the three pure hit-rate poster indices. The preview text above the
   canvas AND the canvas metric row BOTH read through these helpers, so
   preview == poster. There is NO @price / EDGE / STAKE fragment anywhere in
   the studio anymore — only NO-LOSS PROB / SHIELD-TIER / AGENT CONSENSUS. */
function noLossPctOf(noLossProb: number | null, modelProb: number): number {
  return Math.round(Math.min(1, Math.max(0, noLossProb ?? modelProb)) * 100);
}

function consensusPctOf(
  consensusPct: number | null,
  noLossProb: number | null,
  modelProb: number,
): number {
  return Math.round(consensusPct ?? Math.min(1, Math.max(0, noLossProb ?? modelProb)) * 100);
}

function shieldHumanOf(shieldType: string | null, marketKey: string): string {
  return shieldType == null
    ? "SHIELD"
    : marketKey.toUpperCase().startsWith("DNB") && shieldType === "FULL_PUSH_SHIELD"
      ? "DNB PUSH"
      : (SHIELD_EN[shieldType] ?? "SHIELD");
}

function tierShortOf(tier: string | null): string {
  if (!tier) return "";
  return TIER_EN[tier] ?? tier.replace(/^TIER_/, "");
}

/** Persian shield naming for the FA caption mirror of the same three indices. */
const SHIELD_FA: Record<string, string> = {
  FULL_PUSH_SHIELD: "سپر کامل برگشت",
  HALF_PUSH_SHIELD: "سپر نیمه‌برگشت",
  DOUBLE_OUTCOME_SHIELD: "سپر دو نتیجه",
  DIRECT_WIN: "برد مستقیم",
};

function shieldFaOf(shieldType: string | null): string {
  return shieldType == null ? "سپر" : (SHIELD_FA[shieldType] ?? "سپر");
}

interface EduTopic {
  id: string;
  index: string;
  fa: string;
  enTag: string;
  en: string;
  faBody: string;
  accent: string;
}

interface BroadcastStats {
  total: number;
  sent: number;
  pending: number;
  lastSentAt: string | null;
}

interface BroadcastResp {
  ok: boolean;
  slots?: ScheduleSlot[];
  stats?: BroadcastStats;
  error?: string;
}

interface TelegramResp {
  ok: boolean;
  sent?: boolean;
  transport?: string;
  error?: string;
  lane?: string;
}

interface NewsResp {
  ok: boolean;
  items?: NewsItem[];
}

type PosterVariant =
  | { type: "match" }
  | { type: "edu"; topicId: string }
  | { type: "news"; itemId: string };

/* ------------------------------------------------------------------ */
/* Educational preset library (real content — no lorem)                */
/* ------------------------------------------------------------------ */

const EDU_TOPICS: EduTopic[] = [
  {
    id: "kelly",
    index: "01",
    accent: CYAN,
    fa: "مدیریت سرمایه با معیار کلِی",
    enTag: "KELLY CRITERION (0.25x FRACTIONAL)",
    en: "The Kelly Criterion sizes every stake to maximise long-run bankroll growth instead of raw win count. Full Kelly is aggressive, so our engine bets fractional Kelly (25% of the optimal fraction): stake = (p x odds - 1) / (odds - 1), then a hard ceiling of 5 units per play. The maths survives variance — and so does your bankroll.",
    faBody: "کلِی نسبت شرط را طوری تعیین می‌کند که رشد بلندمدت سرمایه بیشینه شود، نه تعداد برد ظاهری. ما ۲۵٪ کسرشدهٔ کلِی با سقف سخت ۵ واحد شرط می‌بندیم تا یک رشتهٔ باخت، حساب را نابود نکند.",
  },
  {
    id: "shin",
    index: "02",
    accent: EMERALD,
    fa: "حذف کارمزد بوک‌میکر با روش شین",
    enTag: "SHIN DE-VIG & TRUE PROBABILITY",
    en: "Bookmaker prices hide a silent tax: the overround. The Shin method (1998) assumes insider trading creates that margin and solves for the true implied probabilities, de-vigging far more accurately than naive normalisation. Every price we compare starts as a Shin-cleaned probability before our model fights the book.",
    faBody: "ضرایب بوک‌میکر حاشیهٔ پنهان دارند که مالیات پشت‌پردهٔ هر شرط است. روش شین با فرض معامله‌گران آگاه این حاشیه را حل می‌کند و احتمال واقعی را دقیق‌تر از تقسیم ساده استخراج می‌کند.",
  },
  {
    id: "clv",
    index: "03",
    accent: GOLD,
    fa: "ارزش خط پایانی (CLV) چیست",
    enTag: "CLOSING LINE VALUE (CLV)",
    en: "Closing Line Value asks one question: did you beat the market? Compare the price you locked pre-match against the final closing line seconds before kickoff. Consistently positive CLV proves your model finds value before the sharpest money does — the single most predictive KPI of long-term profit, far more reliable than short-term win rate.",
    faBody: "CLV یعنی آیا از خط پایانی بازار بهتر شرط بستید یا نه. CLV مثبتِ پایدار، پیش‌بین‌ترین شاخص سود بلندمدت است و از برد و باخت کوتاه‌مدت معنادارتر است.",
  },
  {
    id: "dixon",
    index: "04",
    accent: VIOLET,
    fa: "دیکسون-کولز در برابر زنجیره مارکوف",
    enTag: "DIXON-COLES POISSON MODELING",
    en: "Dixon-Coles models football scores with Poisson attack/defence rates plus a low-score correction term, excelling on full-season data. The Markov-chain engine instead tracks in-play state transitions and shines for live trading. We run both: Dixon-Coles for pre-match value, Markov as the live sanity check — their disagreement is itself a signal.",
    faBody: "دیکسون-کولز گل‌ها را با نرخ حمله و دفاع پواسون و تصحیح نتایج کم‌گل مدل می‌کند؛ زنجیرهٔ مارکوف گذارهای لحظه‌ای بازی را دنبال می‌گیرد. ما هر دو را اجرا می‌کنیم و اختلافشان خودش یک سیگنال است.",
  },
  {
    id: "ev",
    index: "05",
    accent: CYAN,
    fa: "ریاضیات ارزش مورد انتظار (+EV)",
    enTag: "EXPECTED VALUE (+EV) MATHEMATICS",
    en: "Expected Value is the north star: EV = (model probability x decimal odds) - 1. A price only becomes a signal when the model probability beats the market's implied probability by enough that the price still pays. Our production gate demands EV >= +4% on LIVE book prices and >= +4.5% on model estimates — below that, the 'edge' is noise, not value.",
    faBody: "EV یعنی (احتمال مدل × ضریب اعشاری) − ۱. فقط وقتی احتمال مدل از احتمال ضمنی بازار به‌اندازهٔ کافی بیشتر باشد، قیمت ارزش دارد. دروازهٔ تولید ما EV ≥ +۴٪ روی ضرایب زنده است؛ کمتر از آن نویز است نه ارزش.",
  },
  {
    id: "ah-dnb",
    index: "06",
    accent: EMERALD,
    fa: "هندیکپ آسیایی صفر در برابر برد بدون مساوی",
    enTag: "ASIAN HANDICAP (0.0) VS DRAW NO BET",
    en: "Asian Handicap 0.0 and Draw No Bet look identical — stake refunded on a draw — but they differ in mechanics and availability. AH 0.0 splits settlement across books with void logic, while DNB is a clean 1X2 derivative. Knowing which market carries the better price for the SAME probability is free edge: same risk, different number.",
    faBody: "AH 0.0 و DNB هر دو در تساوی برگشت سرمایه دارند اما مکانیک و قیمت‌شان متفاوت است. یافتن اینکه کدام مارکت برای همان احتمال ضریب بهتری می‌دهد، یک لبهٔ رایگان است: ریسک یکسان، عدد متفاوت.",
  },
  {
    id: "variance",
    index: "07",
    accent: GOLD,
    fa: "واریانس، رشته‌های سرد و کنترل افت سرمایه",
    enTag: "VARIANCE, COLD STREAKS & DRAWDOWN CONTROL",
    en: "Even a genuine 55% edge loses 45% of the time — a 10-bet cold streak happens to every profitable bettor every season. Drawdown control is architectural: quarter-Kelly stakes keep single-bet exposure tiny, unit accounting flattens variance into a curve you can survive, and no result ever changes the sizing rule. Emotion is not an input.",
    faBody: "حتی لبهٔ واقعی ۵۵٪ هم ۴۵٪ می‌بازد؛ رشتهٔ ۱۰باختی برای هر شرط‌بند سوددِه اتفاق می‌افتد. کنترل افت سرمایه معماری است: استیک کلِی‌چهارم، حساب واحدی، و قانون ثابت اندازه — هیجان هرگز ورودی نیست.",
  },
  {
    id: "vig",
    index: "08",
    accent: VIOLET,
    fa: "حاشیه بوک‌میکر (اورراند) چقدر است",
    enTag: "BOOKMAKER MARGIN (OVERROUND / VIG)",
    en: "Sum the implied probabilities of a 1X2 book: it always exceeds 100%. That excess is the vig — the book's built-in tax, typically 5-8% on football. Pinnacle often runs the lowest margin (~2-4%), which is why its line is treated as the market consensus. Beating a high-vig book means your model must first overcome the tax before finding value.",
    faBody: "مجموع احتمال‌های ضمنی یک کتاب 1X2 همیشه بیش از ۱۰۰٪ است؛ همین اضافه «ویگ» است — مالیات داخلی بوک‌میکر. خط پیناکل با کمترین حاشیه مرجع بازار است؛ مدل ما باید اول از این مالیات عبور کند تا ارزش پیدا شود.",
  },
  {
    id: "sharp",
    index: "09",
    accent: CYAN,
    fa: "حرکت خط و پول پیناکل (شارپ مانی)",
    enTag: "LINE MOVEMENT & SHARP MONEY (PINNACLE)",
    en: "Lines move because sharp money arrives. Pinnacle's closing line is the most efficient public number in sport, so line movement toward your side before kickoff is a validation signal — and drift against you is a warning. We snapshot the live price at lock time so every card can be audited against what the sharp market did next.",
    faBody: "خط‌ها به‌خاطر پول شارپ حرکت می‌کنند. خط پایانی پیناکل کارآمدترین عدد عمومی ورزش است؛ حرکت خط به سمت شما پیش از شروع، تأییدیه است و حرکت معکوس، هشدار. ما ضریب لحظهٔ قفل را ثبت می‌کنیم تا هر کارت قابل ممیزی باشد.",
  },
  {
    id: "shadow",
    index: "10",
    accent: EMERALD,
    fa: "دفتر سایه و انضباط وتوی پیش‌ازبازی",
    enTag: "SHADOW LEDGER & PRE-MATCH VETO DISCIPLINE",
    en: "The Shadow Ledger archives every signal the supervisor layer refused to let reach the bank — with the REAL fixture, the REAL final score and an honest signed verdict: SAVED LOSS when the pick would have lost, MISSED WIN when it would have won. The net impact proves whether the veto layer adds value or just subtracts opportunity.",
    faBody: "دفتر سایه آرشیو هر سیگنالی است که لایه ناظر اجازهٔ رسیدن به بانک را نداد — با مسابقه واقعی، نتیجه واقعی و برچسب صادق: SAVED LOSS یا MISSED WIN. برآیند خالص نشان می‌دهد وتو ارزش می‌آفریند یا فقط فرصت حذف می‌کند.",
  },
  {
    id: "markov",
    index: "11",
    accent: GOLD,
    fa: "زنجیره مارکوف تنیس و احتمال حفظ سرویس",
    enTag: "TENNIS MARKOV CHAINS & SERVE HOLD PROBABILITY",
    en: "Tennis is a chain of serve points: model each player's hold probability from rank, surface and recent form, then propagate the state machine point-by-point through games and sets. The result is a full probability distribution over every scoreline — which is how our engine prices winner markets and spots saturated books that forgot a surface shift.",
    faBody: "تنیس زنجیره‌ای از سرویس‌هاست: احتمال حفظ سرویس هر بازیکن از رنکینگ، سطح و فرم مدل می‌شود و ماشین حالت نقطه‌به‌نقطه تا ست‌ها پیش می‌رود. خروجی، توزیع کامل اسکورلاین‌ها است — همان چیزی که مارکت برنده را قیمت‌گذاری می‌کند.",
  },
  {
    id: "surface-elo",
    index: "12",
    accent: VIOLET,
    fa: "الوی سطح و مدل خستگی در ATP/WTA",
    enTag: "SURFACE ELO & FATIGUE MODELING IN ATP/WTA",
    en: "A clay-court rating and a hard-court rating are two different players. Surface Elo splits each athlete's strength per surface and decays with inactivity; fatigue adds match load — long three-set battles and back-to-back days compress hold probabilities measurably. Our Markov engine blends both so a tired favourite on the wrong surface is never priced as fresh.",
    faBody: "رنکینگ روی خاک و سخت دو بازیکن متفاوت است. الوی سطح قدرت هر بازیکن را به تفکیک سطح مدل و با افت زمانی تنظیم می‌کند و خستگی (بازی‌های سه‌ستهای پشت‌سرهم) احتمال حفظ سرویس را واقعاً کم می‌کند — فاوریت خسته روی سطح اشتباه هرگز تازه قیمت‌گذاری نمی‌شود.",
  },
];

/* ------------------------------------------------------------------ */
/* Canvas drawing helpers (module-level, React-free)                   */
/* ------------------------------------------------------------------ */

function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function ellipseFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function trunc(s: string, n: number): string {
  const t = (s ?? "").toString();
  return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t;
}

function hashHue(name: string): number {
  let acc = 0;
  for (let i = 0; i < name.length; i++) acc = (acc * 31 + name.charCodeAt(i)) % 360;
  return acc;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "NB";
}

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  start: number,
  min: number,
): number {
  let size = start;
  while (size > min) {
    ctx.font = `bold ${size}px Arial`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function wrapByWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const cand = cur ? `${cur} ${wd}` : wd;
    if (!cur || ctx.measureText(cand).width <= maxWidth) cur = cand;
    else {
      lines.push(cur);
      cur = wd;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapByChars(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const cand = cur ? `${cur} ${wd}` : wd;
    if (!cur || cand.length <= maxChars) cur = cand;
    else {
      lines.push(cur);
      cur = wd;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  const cached = imgCache.get(src);
  if (cached) return cached;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imgCache.set(src, p);
  return p;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  beamA: string,
  beamB: string,
) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#0A1B3D");
  g.addColorStop(0.55, "#071026");
  g.addColorStop(1, "#04070F");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 7; i++) {
    ctx.save();
    ctx.globalAlpha = 0.04 + (i % 3) * 0.015;
    ctx.fillStyle = i % 2 === 0 ? beamA : beamB;
    const x = -90 + i * 200;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 150, 0);
    ctx.lineTo(x + 340, h);
    ctx.lineTo(x + 190, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawTopChrome(
  ctx: CanvasRenderingContext2D,
  w: number,
  accent: string,
  tagline: string,
) {
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, w, 10);
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  // v3.1 — brand block raised (title/tagline baselines 64/94) so the centered
  // status capsule row at y≈112 sits fully BELOW the NEOBET QUANT PRO title
  // with zero overlap on the 1080x1350 canvas.
  ctx.font = "bold 40px Arial";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText("NEOBET QUANT PRO", 72, 64);
  ctx.textAlign = "right";
  ctx.font = "bold 30px Arial";
  ctx.fillStyle = CYAN;
  ctx.fillText("@aineobet", w - 72, 64);
  ctx.textAlign = "left";
  ctx.font = "bold 22px Arial";
  ctx.fillStyle = accent;
  ctx.fillText(tagline, 72, 94);
}

function drawTelemetry(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  line: string,
  accent: string,
) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = accent;
  ctx.fillRect(72, h - 34, w - 144, 3);
  ctx.restore();
  ctx.direction = "ltr";
  ctx.font = "bold 20px 'Courier New', monospace";
  ctx.fillStyle = "#7C8BA1";
  ctx.textAlign = "left";
  ctx.fillText(line, 72, h - 48);
  ctx.textAlign = "right";
  ctx.fillStyle = CYAN;
  ctx.fillText("@aineobet", w - 72, h - 48);
}

function drawReflectionBar(
  ctx: CanvasRenderingContext2D,
  w: number,
  color: string,
) {
  const bar = ctx.createLinearGradient(72, 0, w - 72, 0);
  bar.addColorStop(0, hexToRgba(color, 0.75));
  bar.addColorStop(0.5, hexToRgba(VIOLET, 0.75));
  bar.addColorStop(1, hexToRgba(color, 0.75));
  ctx.save();
  ctx.shadowColor = hexToRgba(color, 0.5);
  ctx.shadowBlur = 14;
  rr(ctx, 72, 1236, w - 144, 5, 3);
  ctx.fillStyle = bar;
  ctx.fill();
  ctx.restore();
}

function drawStadium(ctx: CanvasRenderingContext2D, w: number) {
  // light glow
  const glow = ctx.createRadialGradient(w / 2, 1085, 30, w / 2, 1085, 330);
  glow.addColorStop(0, "rgba(186,230,253,0.16)");
  glow.addColorStop(1, "rgba(186,230,253,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 1000, w, 300);

  // dark stands
  ctx.fillStyle = "#0A1120";
  ellipseFill(ctx, w / 2, 1150, 470, 105);
  // brighter inner bowl
  ctx.fillStyle = "#152238";
  ellipseFill(ctx, w / 2, 1148, 372, 72);
  // pitch
  ctx.fillStyle = "#0F2C1D";
  ellipseFill(ctx, w / 2, 1160, 300, 40);
  // pitch line
  ctx.strokeStyle = "rgba(52,211,153,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 300, 1160);
  ctx.lineTo(w / 2 + 300, 1160);
  ctx.stroke();
}

function drawBallIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  sport: string,
) {
  // v2.7 — distinct balls: tennis = neon-yellow with curved seams;
  // football = classic white ball with black pentagon spots.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = sport === "tennis" ? "#B7F264" : "#F1F5F9";
  ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  if (sport === "tennis") {
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x - r * 0.85, y - r * 0.5, r * 0.9, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.85, y + r * 0.5, r * 0.9, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else if (sport === "basketball") {
    // v3.3 §4 — basketball = orange ball with the classic crossed seams.
    ctx.fillStyle = "#E8722C";
    ctx.fill();
    ctx.strokeStyle = "rgba(15,23,42,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - r * 1.45, r * 1.15, Math.PI * 0.3, Math.PI * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + r * 1.45, r * 1.15, Math.PI * 1.3, Math.PI * 1.7);
    ctx.stroke();
  } else {
    // central pentagon + five spokes — classic football look
    ctx.fillStyle = "rgba(15,23,42,0.82)";
    const pr = r * 0.34;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const px = x + pr * Math.cos(a);
      const py = y + pr * Math.sin(a);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(15,23,42,0.75)";
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5 + Math.PI / 5;
      ctx.beginPath();
      ctx.moveTo(x + pr * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5), y + pr * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5));
      ctx.lineTo(x + r * 0.95 * Math.cos(a), y + r * 0.95 * Math.sin(a));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawClubCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  name: string,
  img: HTMLImageElement | null,
) {
  const stroke = `hsl(${hashHue(name)} 85% 62%)`;
  ctx.save();
  ctx.shadowColor = stroke;
  ctx.shadowBlur = 34;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#0B1526";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 9, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(226,232,240,0.14)";
  ctx.lineWidth = 2;
  ctx.stroke();
  if (img) {
    ctx.beginPath();
    ctx.arc(cx, cy, r - 12, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.max((r * 2) / img.width, (r * 2) / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.font = "bold 56px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = "#DCE4F0";
    ctx.fillText(initials(name), cx, cy + 20);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Poster renderers                                                    */
/* ------------------------------------------------------------------ */

/** Match poster — 1080x1350. Paints fully synchronously; `imgs` optional. */
function drawPoster(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: PosterSpec,
  imgs?: { home: HTMLImageElement | null; away: HTMLImageElement | null },
) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  const accent = MODE_ACCENT[spec.mode];

  // 1) background + beams
  drawBackground(ctx, w, h, CYAN, GOLD);

  // 2) top chrome
  drawTopChrome(ctx, w, accent, MODE_TAGLINE[spec.mode]);

  // v3.1 — centered status capsule ROW at y≈112 (top edge 112, below the
  // title baseline 64 and tagline baseline 94 — zero overlap). Text set:
  // HIGH PROBABILITY PICK / WON / PUSH — REFUNDED / LOST. A settled VOID
  // (push) shield signal is honestly labelled PUSH — REFUNDED in gold.
  const isPush = spec.status === "VOID";
  const badgeText =
    spec.mode === "SIGNAL"
      ? "HIGH PROBABILITY PICK"
      : isPush
        ? "PUSH — REFUNDED"
        : spec.mode === "WIN"
          ? "WON"
          : "LOST";
  const badgeColor = isPush
    ? GOLD
    : spec.mode === "SIGNAL"
      ? "#22D3EE"
      : spec.mode === "WIN"
        ? "#10B981"
        : "#F43F5E";
  {
    ctx.save();
    ctx.font = "900 40px Arial";
    const tw = ctx.measureText(badgeText).width;
    const bw = tw + 72;
    const bx = w / 2 - bw / 2;
    const by = 112;
    const bh = 56;
    const bGrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    bGrad.addColorStop(0, hexToRgba(badgeColor, 0.22));
    bGrad.addColorStop(1, hexToRgba(badgeColor, 0.08));
    rr(ctx, bx, by, bw, bh, 28);
    ctx.fillStyle = bGrad;
    ctx.fill();
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.shadowColor = hexToRgba(badgeColor, 0.55);
    ctx.shadowBlur = 22;
    ctx.textAlign = "center";
    ctx.fillStyle = badgeColor;
    ctx.fillText(badgeText, w / 2, by + 40);
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.font = "bold 22px Arial";
  ctx.fillStyle = GOLD;
  // v3.1 — pushed below the status capsule (capsule spans 112-168).
  ctx.fillText(trunc(spec.competition.toUpperCase(), 44), w / 2, 190);

  // 3) face-off zone (y ~200-470)
  const cy = 316;
  const r = 112;
  drawClubCircle(ctx, 300, cy, r, spec.home, imgs?.home ?? null);
  drawClubCircle(ctx, w - 300, cy, r, spec.away, imgs?.away ?? null);

  // metallic VS
  const vsGrad = ctx.createLinearGradient(0, cy - 32, 0, cy + 32);
  vsGrad.addColorStop(0, "#F8FAFC");
  vsGrad.addColorStop(0.45, "#8B95A5");
  vsGrad.addColorStop(0.6, "#DDE3EC");
  vsGrad.addColorStop(1, "#94A3B8");
  ctx.save();
  ctx.shadowColor = "rgba(226,232,240,0.35)";
  ctx.shadowBlur = 18;
  ctx.font = "bold 64px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = vsGrad;
  ctx.fillText("VS", w / 2, cy + 22);
  ctx.restore();

  // ball icon above VS
  drawBallIcon(ctx, w / 2, 226, 20, spec.sport);

  // settled score line
  if (spec.scoreLine) {
    ctx.font = "bold 44px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD;
    ctx.fillText(spec.scoreLine, w / 2, cy + 100);
  }

  // names under circles
  ctx.font = "bold 26px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = "#E2E8F0";
  ctx.fillText(trunc(spec.home.toUpperCase(), 18), 300, cy + r + 38);
  ctx.fillText(trunc(spec.away.toUpperCase(), 18), w - 300, cy + r + 38);

  // 4) market capsule (y ~500-620)
  ctx.save();
  rr(ctx, 90, 500, w - 180, 118, 59);
  ctx.fillStyle = "rgba(34,211,238,0.06)";
  ctx.fill();
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  const mSize = fitFont(ctx, spec.marketEn, w - 240, 40, 28);
  ctx.font = `bold ${mSize}px Arial`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(spec.marketEn, w / 2, 556);
  // v2.7 — the image is 100% English; Persian explanation lives ONLY in the
  // Telegram message caption (see sendNow / dispatcher caption builders).
  ctx.direction = "ltr";

  // 5) middle band (y ~660-860)
  const boxW = Math.floor((w - 144 - 40) / 3);
  const boxY = 665;
  const boxH = 190;
  // v3.2 — EVERY match poster carries the three pure hit-rate metric cards.
  // NO odds / NO edge / NO stake number exists anywhere on the poster: the
  // preview text above the canvas reads the exact same helper values, so the
  // preview indices and the poster indices are always identical.
  const shieldHuman = shieldHumanOf(spec.shieldType, spec.marketKey);
  const tierShort = tierShortOf(spec.tier);
  const shieldTierValue = tierShort ? `${shieldHuman} - TIER ${tierShort}` : shieldHuman;
  const metricCards: Array<{ label: string; value: string; color: string }> = [
    {
      label: "NO-LOSS PROB",
      value: `${noLossPctOf(spec.noLossProb, spec.modelProb)}%`,
      color: EMERALD,
    },
    { label: "SHIELD / TIER", value: shieldTierValue, color: GOLD },
    {
      label: "AGENT CONSENSUS",
      value: `${consensusPctOf(spec.consensusPct, spec.noLossProb, spec.modelProb)}%`,
      color: VIOLET,
    },
  ];
  // one uniform value size across the three cards (fitFont per string, min wins)
  let metricSize = 54;
  for (const c of metricCards) {
    metricSize = Math.min(metricSize, fitFont(ctx, c.value, boxW - 24, 54, 16));
  }
  metricCards.forEach((b, i) => {
    const x = 72 + i * (boxW + 20);
    rr(ctx, x, boxY, boxW, boxH, 18);
    ctx.fillStyle = hexToRgba(b.color, 0.08);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(b.color, 0.45);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.direction = "ltr";
    ctx.fillStyle = "#7C8BA1";
    ctx.fillText(b.label, x + boxW / 2, boxY + 46);
    ctx.font = `bold ${metricSize}px Arial`;
    ctx.fillStyle = b.color;
    ctx.fillText(b.value, x + boxW / 2, boxY + 140);
  });
  ctx.direction = "ltr";

  // 6) info bar (y ~900-1000)
  const d = new Date(spec.kickoffIso);
  const validDate = Number.isFinite(d.getTime()) && d.getTime() > 0;
  const infoBoxes: Array<{ label: string; value: string }> = [
    {
      label: "📅 DATE",
      value: validDate
        ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "TBD",
    },
    {
      label: "⏰ KICKOFF",
      value: validDate
        ? `${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })} UTC`
        : "TBD",
    },
    { label: "🏟️ VENUE", value: trunc((spec.venue ?? "OFFICIAL VENUE").toUpperCase(), 22) },
  ];
  infoBoxes.forEach((f, i) => {
    const x = 72 + i * (boxW + 20);
    rr(ctx, x, 905, boxW, 92, 16);
    ctx.fillStyle = "rgba(10,20,38,0.6)";
    ctx.fill();
    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = "18px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = "#7C8BA1";
    ctx.fillText(f.label, x + boxW / 2, 938);
    const fSize = fitFont(ctx, f.value, boxW - 24, 26, 17);
    ctx.font = `bold ${fSize}px Arial`;
    ctx.fillStyle = "#E2E8F0";
    ctx.fillText(f.value, x + boxW / 2, 976);
  });

  // 7) night stadium (y ~1040-1250)
  drawStadium(ctx, w);
  drawReflectionBar(ctx, w, accent);
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = "#64748B";
  ctx.fillText("O F F I C I A L   S T A D I U M   N I G H T   V I E W", w / 2, 1276);

  // 8) telemetry bar (y ~1290-1330)
  drawTelemetry(
    ctx,
    w,
    h,
    `NEOBET QUANT PRO • @AINEOBET • SHA-256 LOCKED ${spec.hash.slice(0, 10) || "0000000000"}…`,
    accent,
  );
  ctx.restore();
}

/** Simplified educational poster variant on the same canvas. */
function drawEducationalPoster(ctx: CanvasRenderingContext2D, topic: EduTopic) {
  ctx.save();
  ctx.clearRect(0, 0, POSTER_W, POSTER_H);
  drawBackground(ctx, POSTER_W, POSTER_H, VIOLET, GOLD);
  drawTopChrome(ctx, POSTER_W, topic.accent, "EDUCATION — QUANT KNOWLEDGE BASE");

  // ghost numeral
  ctx.font = "bold 300px Arial";
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(148,163,184,0.07)";
  ctx.fillText(topic.index, POSTER_W - 40, 470);

  // Persian title
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  const tSize = fitFont(ctx, topic.fa, POSTER_W - 200, 46, 30);
  ctx.font = `bold ${tSize}px Tahoma, Arial, sans-serif`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(topic.fa, POSTER_W / 2, 250);

  // EN tag chip
  ctx.direction = "ltr";
  ctx.font = "bold 24px Arial";
  const tagW = ctx.measureText(topic.enTag).width + 56;
  rr(ctx, POSTER_W / 2 - tagW / 2, 286, tagW, 52, 26);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fill();
  ctx.strokeStyle = topic.accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = topic.accent;
  ctx.textAlign = "center";
  ctx.fillText(topic.enTag, POSTER_W / 2, 320);

  // EN body — wrapped ~46 chars
  ctx.font = "26px Arial";
  ctx.textAlign = "left";
  ctx.fillStyle = "#C7D2E1";
  const enLines = wrapByChars(topic.en, 46).slice(0, 14);
  let y = 408;
  for (const line of enLines) {
    ctx.fillText(line, 100, y);
    y += 42;
  }

  // divider
  const divY = Math.max(y + 14, 1010);
  ctx.strokeStyle = "rgba(148,163,184,0.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(100, divY);
  ctx.lineTo(POSTER_W - 100, divY);
  ctx.stroke();

  // FA body (RTL)
  ctx.direction = "rtl";
  ctx.font = "22px Tahoma, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "#8FA0B8";
  const faLines = wrapByChars(topic.faBody, 50).slice(0, 5);
  let fy = divY + 44;
  for (const line of faLines) {
    ctx.fillText(line, POSTER_W - 100, fy);
    fy += 38;
  }
  ctx.direction = "ltr";

  ctx.font = "bold 18px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = "#64748B";
  ctx.fillText("NEOBET QUANT ACADEMY • EDUCATIONAL ONLY — NOT FINANCIAL ADVICE", POSTER_W / 2, POSTER_H - 96);

  drawReflectionBar(ctx, POSTER_W, topic.accent);
  drawTelemetry(
    ctx,
    POSTER_W,
    POSTER_H,
    `NEOBET QUANT PRO • @AINEOBET • ACADEMY ${topic.enTag.slice(0, 12)}…`,
    topic.accent,
  );
  ctx.restore();
}

/** Breaking-news poster variant on the same canvas. */
function drawNewsPoster(ctx: CanvasRenderingContext2D, item: NewsItem) {
  ctx.save();
  ctx.clearRect(0, 0, POSTER_W, POSTER_H);
  drawBackground(ctx, POSTER_W, POSTER_H, RED, GOLD);
  drawTopChrome(ctx, POSTER_W, RED, "BREAKING NEWS — LIVE ESPN WIRE");

  // breaking chip
  ctx.font = "bold 26px Arial";
  const chip = "🚨 BREAKING NEWS";
  const cw = ctx.measureText(chip).width + 48;
  rr(ctx, 72, 186, cw, 54, 27);
  ctx.fillStyle = "rgba(248,113,113,0.14)";
  ctx.fill();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = RED;
  ctx.textAlign = "left";
  ctx.fillText(chip, 96, 222);

  // headline (shrink until <= 4 lines)
  const headText = item.headline?.trim() || "Untitled wire update";
  let hSize = 52;
  while (hSize > 30) {
    ctx.font = `bold ${hSize}px Arial`;
    if (wrapByWidth(ctx, headText, POSTER_W - 160).length <= 4) break;
    hSize -= 4;
  }
  ctx.font = `bold ${hSize}px Arial`;
  const hLinesAll = wrapByWidth(ctx, headText, POSTER_W - 160);
  const hLines = hLinesAll.slice(0, 4);
  if (hLinesAll.length > 4 && hLines.length === 4) {
    hLines[3] = `${hLines[3]}…`;
  }
  let hy = 330;
  ctx.textAlign = "left";
  ctx.fillStyle = "#FFFFFF";
  for (const line of hLines) {
    ctx.fillText(line, 80, hy);
    hy += 64;
  }

  // description
  ctx.font = "26px Arial";
  ctx.fillStyle = "#9FB0C6";
  const descLinesAll = wrapByWidth(ctx, trunc(item.description ?? "", 420), POSTER_W - 170);
  const descLines = descLinesAll.slice(0, 8);
  if (descLinesAll.length > 8 && descLines.length === 8) {
    descLines[7] = `${descLines[7]}…`;
  }
  let dy = hy + 30;
  for (const line of descLines) {
    ctx.fillText(line, 80, dy);
    dy += 38;
  }

  // source + published row
  const srcY = Math.max(dy + 34, 1060);
  ctx.font = "bold 22px Arial";
  ctx.textAlign = "left";
  ctx.fillStyle = GOLD;
  ctx.fillText(`SOURCE: ${(item.source || "ESPN").toUpperCase()}`, 80, srcY);
  const pub = new Date(item.published);
  const pubTxt =
    Number.isFinite(pub.getTime()) && pub.getTime() > 0
      ? pub.toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "LIVE WIRE";
  ctx.font = "20px Arial";
  ctx.fillStyle = "#7C8BA1";
  ctx.textAlign = "right";
  ctx.fillText(`PUBLISHED: ${pubTxt}`, POSTER_W - 80, srcY);

  ctx.font = "bold 18px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = "#64748B";
  ctx.fillText("FULL STORY ON ESPN.COM — LINK IN CHANNEL POST", POSTER_W / 2, srcY + 56);

  drawReflectionBar(ctx, POSTER_W, RED);
  ctx.font = "bold 16px Arial";
  ctx.fillStyle = "#64748B";
  ctx.textAlign = "center";
  ctx.fillText("E S P N   W I R E   •   R E A L - T I M E   S P O R T S   N E W S", POSTER_W / 2, 1276);

  drawTelemetry(
    ctx,
    POSTER_W,
    POSTER_H,
    `NEOBET QUANT PRO • @AINEOBET • WIRE ID ${(item.id || "ESPN0000000").slice(0, 10).toUpperCase()}…`,
    RED,
  );
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Spec builder                                                        */
/* ------------------------------------------------------------------ */

function buildPosterSpec(s: AppSignal | null, mode: PosterMode): PosterSpec {
  if (!s) {
    return {
      home: "NEOBET",
      away: "QUANT",
      homeLogo: null,
      awayLogo: null,
      competition: "Live feed sync — fixture pending",
      marketEn: "Official market line unlocks with the next signal",
      marketFa: "در انتظار نخستین سیگنال زندهٔ موتور کوانت",
      marketKey: "",
      kickoffIso: new Date().toISOString(),
      venue: null,
      hash: "0000000000000000",
      mode,
      scoreLine: null,
      sport: "football",
      status: "OPEN",
      shieldType: null,
      tier: null,
      noLossProb: null,
      consensusPct: null,
      modelProb: 0,
    };
  }
  return {
    home: s.homeName || s.matchInfo || "HOME",
    away: s.awayName || "AWAY",
    homeLogo: s.homeLogo,
    awayLogo: s.awayLogo,
    competition: s.league || "NEOBET QUANT LEAGUE",
    // v2.7.1 §1 — official bookmaker naming with the REAL team names.
    marketEn: officialBetLine(s.marketKey, s.selection, s.marketLabel, s.homeName, s.awayName),
    marketFa: marketFa(s.marketKey),
    marketKey: s.marketKey,
    kickoffIso: s.startTime,
    venue: s.venue,
    hash: s.shaHash || "0000000000000000",
    mode,
    scoreLine:
      mode !== "SIGNAL" && s.homeScore != null && s.awayScore != null
        ? `${s.homeScore} - ${s.awayScore}`
        : null,
    sport: s.sport,
    status: s.status,
    shieldType: s.shieldType,
    tier: s.tier,
    noLossProb: s.noLossProb,
    consensusPct: s.consensusPct,
    modelProb: s.modelProb,
  };
}

function timeToMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 1500;
}

/**
 * v3.2 — Tehran wall-clock for schedule slots (root-cause fix).
 *
 * The old board rendered `slot.time` RAW, so any legacy/manual row in the
 * BroadcastSchedule table that carried a raw format token (e.g. "P -> HH:mm"
 * from a former date-fns `format("P -> HH:mm")` seeding) printed literally.
 * There is no date-fns usage left in this view (verified), so the display
 * layer now normalizes EVERY payload into a real HH:mm:
 *   - ISO/full-date timestamp → Intl.DateTimeFormat in Asia/Tehran (en-GB, 24h)
 *   - bare "H:mm"/"HH:mm" (also embedded in junk like "P -> 19:30") → re-padded
 *   - anything else (e.g. a literal "P -> HH:mm" token) → "—" (never leaks)
 */
const TEHRAN_HHMM_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tehran",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatSlotTime(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "—";
  // 1) ISO/full-date timestamp → convert to the real Tehran wall clock.
  if (/(?:\d{4}-\d{2}-\d{2}|Z$|[+-]\d{2}:?\d{2}$)/.test(t)) {
    const d = new Date(t);
    if (Number.isFinite(d.getTime())) {
      try {
        return TEHRAN_HHMM_FMT.format(d);
      } catch {
        /* invalid tz data — fall through to the wall-clock recovery */
      }
    }
  }
  // 2) wall-clock fragment (bare "HH:mm" or embedded in a legacy junk token)
  const hm = /(\d{1,2}):(\d{2})/.exec(t);
  if (hm) {
    const h = Math.min(23, Math.max(0, Number(hm[1])));
    const m = Math.min(59, Math.max(0, Number(hm[2])));
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return "—";
}

/* ------------------------------------------------------------------ */
/* Live clock chip (own interval — isolated re-render)                 */
/* ------------------------------------------------------------------ */

function ClockChip() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(new Date()));
    const iv = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(iv);
    };
  }, []);
  return (
    <span
      className="num rounded-md border border-slate-800 bg-secondary/60 px-2 py-0.5 text-[10px] text-slate-400"
      dir="ltr"
    >
      {now ? fmtClock(now) : "--:--:--"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

export default function TelegramStudioView({ state }: { state: AppStatePayload }) {
  const syncing = useAppStore((s) => s.syncing);
  const { openSignals, settledSignals } = state;

  const [mode, setMode] = useState<PosterMode>("SIGNAL");
  const [selectedSignalId, setSelectedSignalId] = useState<string>(
    openSignals[0]?.id ?? settledSignals[0]?.id ?? "",
  );
  const [variant, setVariant] = useState<PosterVariant>({ type: "match" });
  const [renderTick, setRenderTick] = useState(0);
  const [sending, setSending] = useState(false);
  const [eduOpen, setEduOpen] = useState<Record<string, boolean>>({});

  // MODULE الف — broadcast schedule
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [bStats, setBStats] = useState<BroadcastStats | null>(null);
  const [bLoading, setBLoading] = useState(true);
  const [bBusy, setBBusy] = useState(false);
  const [showAddForm, setShowAddForm] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("");
  // v2.7 strict routing — the kind drives the lane; channel is derived server-side.
  const [newKind, setNewKind] = useState<"SIGNAL" | "EDUCATION" | "NEWS" | "RADAR" | "REPORT">("SIGNAL");

  // MODULE ج — ESPN news radar
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posterWrapRef = useRef<HTMLDivElement>(null);
  const drawTokenRef = useRef(0);
  const signalRef = useRef<AppSignal | null>(null);
  const newsRef = useRef<NewsItem[]>([]);
  // v2.7 hard rule — a match card may only be SENT after BOTH club logos/
  // flags actually loaded into the canvas. Initials-fallback previews are
  // never allowed to reach a channel.
  const logosReadyRef = useRef(false);

  const pool = useMemo<Array<AppSignal>>(() => {
    if (mode === "SIGNAL") return openSignals.length ? openSignals : settledSignals;
    const won = settledSignals.filter((s) => s.status === "WON");
    const lost = settledSignals.filter((s) => s.status === "LOST");
    if (mode === "WIN") return won.length ? won : settledSignals;
    return lost.length ? lost : settledSignals;
  }, [mode, openSignals, settledSignals]);

  const selectedSignal = pool.find((s) => s.id === selectedSignalId) ?? pool[0] ?? null;
  signalRef.current = selectedSignal;
  newsRef.current = news;

  // keep the selection inside the current pool
  useEffect(() => {
    if (pool.length && !pool.some((s) => s.id === selectedSignalId)) {
      setSelectedSignalId(pool[0].id);
    }
  }, [pool, selectedSignalId]);

  /* ---------------- poster drawing (sync-first, never black) ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const token = ++drawTokenRef.current;

    if (variant.type === "edu") {
      const topic = EDU_TOPICS.find((t) => t.id === variant.topicId) ?? EDU_TOPICS[0];
      drawEducationalPoster(ctx, topic);
      logosReadyRef.current = true; // edu posters carry no club artwork
      return;
    }
    if (variant.type === "news") {
      const item = newsRef.current.find((n) => n.id === variant.itemId);
      if (item) drawNewsPoster(ctx, item);
      else drawPoster(ctx, POSTER_W, POSTER_H, buildPosterSpec(null, mode));
      logosReadyRef.current = true; // news posters carry no club artwork
      return;
    }

    // Match poster: full synchronous paint FIRST, then a single async
    // re-paint once the club logos settle (initials fallback on failure).
    const spec = buildPosterSpec(signalRef.current, mode);
    drawPoster(ctx, POSTER_W, POSTER_H, spec);
    const jobs: Array<Promise<HTMLImageElement | null>> = [
      spec.homeLogo ? loadImage(spec.homeLogo) : Promise.resolve(null),
      spec.awayLogo ? loadImage(spec.awayLogo) : Promise.resolve(null),
    ];
    void Promise.allSettled(jobs).then(([hRes, aRes]) => {
      if (token !== drawTokenRef.current) return;
      const homeImg = hRes.status === "fulfilled" ? hRes.value : null;
      const awayImg = aRes.status === "fulfilled" ? aRes.value : null;
      // v2.7 — send gate: BOTH real logos must exist AND have loaded.
      logosReadyRef.current = Boolean(spec.homeLogo && spec.awayLogo && homeImg && awayImg);
      drawPoster(ctx, POSTER_W, POSTER_H, spec, { home: homeImg, away: awayImg });
    });
     
  }, [variant, selectedSignalId, mode, renderTick, state.generatedAt]);

  /* ---------------- actions ---------------- */

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          toast.error("ساخت فایل PNG ناموفق بود");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `neobet-poster-${Date.now()}.png`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast.success("پوستر PNG دانلود شد", { description: "1080×1350 — آماده برای تلگرام" });
      }, "image/png");
    } catch (e) {
      toast.error("دانلود ناموفق بود", { description: (e as Error).message });
    }
  }

  async function sendNow() {
    if (!selectedSignal) {
      toast.warning("ابتدا یک مسابقه انتخاب کنید");
      return;
    }
    // v2.7 hard rule — no club artwork, no send. Honest refusal, no fallback.
    if (!selectedSignal.homeLogo || !selectedSignal.awayLogo || !logosReadyRef.current) {
      toast.error("ارسال مجاز نیست — لوگو/پرچم هر دو باشگاه باید بارگذاری شده باشد", {
        description: "قانون v2.7: کارت بدون artwork واقعی هرگز به کانال ارسال نمی‌شود.",
      });
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // v2.6: send=true finally wires the button to the real sendPhoto
        // pipeline, routed to the selected broadcast lane.
        body: JSON.stringify({ kind: mode, signalId: selectedSignal.id, send: true, channel: "VIP" }),
      });
      const j = (await res.json()) as TelegramResp;
      if (!j.ok) throw new Error(j.error ?? "پاسخ ناموفق از سرور");
      if (j.sent) toast.success(`کارت با sendPhoto به کانال VIP ارسال شد`);
      else
        toast.error("ارسال انجام نشد", {
          description: j.error ?? j.transport ?? "پوستر ساخته شد اما ارسال ناموفق بود",
        });
    } catch (e) {
      toast.error("خطای ارسال به تلگرام", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  /**
   * v2.7 — bilingual news send: NEWS poster + EN/FA caption to the PUBLIC
   * lane. News is transparency content, so the strict routing rule allows
   * (and requires) the public channel here.
   */
  async function sendBilingualNews(n: NewsItem) {
    setSending(true);
    try {
      const caption =
        `📰 ${n.headline}\n${n.description?.slice(0, 240) ?? ""}\n\n` +
        (n.headlineFa ? `🇮🇷 ${n.headlineFa}\n${n.descriptionFa?.slice(0, 240) ?? ""}\n\n` : "") +
        (n.link ? `🔗 ${n.link}` : "");
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "NEWS",
          send: true,
          channel: "PUBLIC",
          caption,
          spec: {
            kind: "NEWS",
            headline: n.headline,
            summary: n.description,
            link: n.link,
          },
        }),
      });
      const j = (await res.json()) as TelegramResp;
      if (!j.ok) throw new Error(j.error ?? "پاسخ ناموفق از سرور");
      if (j.sent) toast.success("خبر دوزبانه به کانال عمومی ارسال شد");
      else toast.error("ارسال خبر انجام نشد", { description: j.error ?? j.transport });
    } catch (e) {
      toast.error("خطای ارسال خبر", { description: (e as Error).message });
    } finally {
      setSending(false);
    }
  }

  async function copyEn(topic: EduTopic) {
    try {
      await navigator.clipboard.writeText(topic.en);
      toast.success("متن انگلیسی کپی شد", { description: topic.enTag });
    } catch {
      toast.error("دسترسی کلیپ‌بورد داده نشد");
    }
  }

  function scrollToPoster() {
    posterWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------------- MODULE الف: broadcast schedule ---------------- */

  const loadSchedule = useCallback(async (silent = false) => {
    if (!silent) setBLoading(true);
    try {
      const res = await fetch("/api/broadcast", { cache: "no-store" });
      const j = (await res.json()) as BroadcastResp;
      if (!j.ok) throw new Error(j.error ?? "دریافت زمان‌بندی ناموفق بود");
      setSlots(j.slots ?? []);
      if (j.stats) setBStats(j.stats);
    } catch (e) {
      if (!silent) toast.error("خطای جدول زمان‌بندی", { description: (e as Error).message });
    } finally {
      if (!silent) setBLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  async function mutateSlot(body: Record<string, unknown>, successMsg: string) {
    setBBusy(true);
    try {
      const res = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as BroadcastResp;
      if (!j.ok) throw new Error(j.error ?? "عملیات ناموفق بود");
      toast.success(successMsg);
      if (j.stats) setBStats(j.stats);
      await loadSchedule(true);
    } catch (e) {
      toast.error("خطای عملیات اسلات", { description: (e as Error).message });
    } finally {
      setBBusy(false);
    }
  }

  async function addSlot() {
    const title = newTitle.trim();
    const t = newTime.trim();
    if (!title) {
      toast.warning("عنوان اسلات را بنویسید");
      return;
    }
    if (!/^\d{1,2}:\d{2}$/.test(t)) {
      toast.warning("ساعت باید با قالب HH:mm باشد", { description: "مثلاً 19:30" });
      return;
    }
    await mutateSlot(
      { action: "create", slotTitle: title, time: t, kind: newKind },
      "اسلات جدید به صف پخش اضافه شد",
    );
    setNewTitle("");
    setNewTime("");
  }

  const sortedSlots = useMemo(
    () =>
      [...slots].sort(
        (a, b) => timeToMin(formatSlotTime(a.time)) - timeToMin(formatSlotTime(b.time)),
      ),
    [slots],
  );

  /* ---------------- MODULE ج: ESPN news radar ---------------- */

  const loadNews = useCallback(async (silent = false) => {
    if (!silent) setNewsLoading(true);
    try {
      const res = await fetch("/api/news", { cache: "no-store" });
      const j = (await res.json()) as NewsResp;
      if (!j.ok) throw new Error("وایر ESPN پاسخ نداد");
      setNews(j.items ?? []);
    } catch (e) {
      if (!silent) toast.error("خطای رادار اخبار", { description: (e as Error).message });
    } finally {
      if (!silent) setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNews();
    const iv = window.setInterval(() => {
      void loadNews(true);
    }, 120_000);
    return () => window.clearInterval(iv);
  }, [loadNews]);

  function newsToPoster(n: NewsItem) {
    setVariant({ type: "news", itemId: n.id });
    scrollToPoster();
    toast.info("پوستر خبری روی بوم رندر شد", { description: n.headline.slice(0, 60) });
  }

  /* ---------------- derived labels ---------------- */

  const variantLabel =
    variant.type === "match"
      ? "پوستر مسابقه"
      : variant.type === "edu"
        ? "پوستر آموزشی"
        : "پوستر خبری";

  // v3.2 — poster-consistent preview indices (the SAME helper values the
  // canvas metric row paints). NO @price / EDGE / STAKE / Kelly fragment —
  // the preview text and the Persian caption mirror only the three pure
  // hit-rate indices: NO-LOSS PROB · SHIELD/TIER · AGENT CONSENSUS.
  const selNoLoss = selectedSignal
    ? noLossPctOf(selectedSignal.noLossProb, selectedSignal.modelProb)
    : 0;
  const selCons = selectedSignal
    ? consensusPctOf(selectedSignal.consensusPct, selectedSignal.noLossProb, selectedSignal.modelProb)
    : 0;
  const selShield = selectedSignal
    ? shieldHumanOf(selectedSignal.shieldType, selectedSignal.marketKey)
    : "";
  const selTier = selectedSignal ? tierShortOf(selectedSignal.tier) : "";
  const selShieldFa = selectedSignal ? shieldFaOf(selectedSignal.shieldType) : "";

  /* ---------------- render ---------------- */

  return (
    <div
      className="grid w-full max-w-full min-w-0 grid-cols-1 gap-4 overflow-x-hidden xl:grid-cols-3"
      data-testid="telegram-view"
    >
      {/* ============ Column 1 — CHANNEL MANAGER + POSTER ENGINE + Edu studio ============ */}
      <div className="min-w-0 space-y-4 xl:col-span-2">
        {/* v2.6 — Telegram connection & PUBLIC/VIP lane manager */}
        <ChannelManagerCard />

        <Card className="glass glass-hover p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold">🖼 موتور پوستر کوانت — Canvas 1080×1350</h2>
              <Badge variant="outline" className="border-slate-700 text-[9px] text-slate-400">
                {variantLabel}
              </Badge>
              {syncing && (
                <Badge variant="outline" className="border-cyan-500/40 text-[9px] text-cyan-300">
                  همگام‌سازی…
                </Badge>
              )}
            </div>
            <ClockChip />
          </div>

          {/* mode chips */}
          <div className="mb-3 flex flex-wrap gap-2">
            {(["SIGNAL", "WIN", "LOSS"] as PosterMode[]).map((m) => {
              const active = mode === m && variant.type === "match";
              return (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setVariant({ type: "match" });
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-bold transition-all",
                    active
                      ? "border-transparent text-slate-950"
                      : "border-slate-800 bg-secondary/40 text-slate-300 hover:border-slate-600",
                  )}
                  style={active ? { backgroundColor: MODE_ACCENT[m] } : undefined}
                >
                  {m === "SIGNAL"
                    ? "سیگنال جدید (SIGNAL)"
                    : m === "WIN"
                      ? "پوستر برد (WIN)"
                      : "پوستر باخت (LOSS)"}
                </button>
              );
            })}
          </div>

          {/* signal selector chips */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-bold text-slate-400">
                مسابقه: {selectedSignal?.matchInfo ?? "—"}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{pool.length} گزینه</span>
            </div>
            <div className="mb-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto scroll-slim">
              {pool.map((s) => {
                const active = selectedSignalId === s.id && variant.type === "match";
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedSignalId(s.id);
                      setVariant({ type: "match" });
                    }}
                    title={s.matchInfo}
                    className={cn(
                      "flex min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-all",
                      active
                        ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200"
                        : "border-slate-800 bg-secondary/40 text-slate-400 hover:border-slate-600",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      مسابقه: {s.matchInfo}{" "}
                    </span>
                    <span className={cn("shrink-0", statusColor(s.status))}>({s.status})</span>
                    {/* v3.1 — ensemble chips next to the signal name */}
                    <NoLossChip value={s.noLossProb} className="shrink-0 text-[9px]" />
                    <TierBadge tier={s.tier} className="shrink-0" />
                    <ShieldBadge shieldType={s.shieldType} className="shrink-0" />
                  </button>
                );
              })}
              {pool.length === 0 && (
                <span className="text-[10px] text-muted-foreground">
                  هیچ سیگنالی در دسترس نیست — پوستر پیش‌فرض رندر می‌شود.
                </span>
              )}
            </div>
          </div>

          {selectedSignal && (
            <div className="mb-3 space-y-1.5" data-testid="poster-preview-indices">
              {/* v3.2 — EN indices: identical values to the poster canvas */}
              <div
                dir="ltr"
                className="min-w-0 break-words rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-1.5 text-left text-[10px] text-emerald-200"
              >
                {`NO-LOSS PROB ${selNoLoss}% · SHIELD ${selShield}${selTier ? ` / TIER ${selTier}` : ""} · AGENT CONSENSUS ${selCons}%`}
              </div>
              {/* v3.2 — the Persian caption mirrors the SAME three indices */}
              <div
                dir="rtl"
                className="min-w-0 break-words rounded-lg border border-slate-800/70 bg-secondary/40 px-2.5 py-1.5 text-right text-[10px] leading-5 text-slate-200"
              >
                {`احتمال بدون‌باخت ${selNoLoss}٪ · سپر و تیر: ${selShieldFa}${selTier ? ` / تیر ${selTier}` : ""} · اجماع سوپرایجنت ${selCons}٪`}
              </div>
            </div>
          )}

          {/* canvas preview */}
          <div
            ref={posterWrapRef}
            dir="ltr"
            className="mx-auto w-full max-w-[400px]"
            style={{ aspectRatio: "4 / 5" }}
          >
            <canvas
              ref={canvasRef}
              width={POSTER_W}
              height={POSTER_H}
              className="h-auto w-full max-w-[400px] rounded-xl border border-slate-800 bg-[#04070F]"
              aria-label="پیش‌نمایش پوستر"
            />
          </div>

          {/* action buttons */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* v2.7 strict routing — match/settlement cards ONLY go VIP.
                The other lanes stay visible but disabled for transparency. */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-secondary/40 p-1">
              <span className="rounded-md bg-amber-400 px-2.5 py-1 text-[10px] font-bold text-slate-950">
                👑 VIP
              </span>
              <span
                className="rounded-md px-2.5 py-1 text-[10px] text-slate-600 line-through"
                title="قانون v2.7: کارت سیگنال/تسویه به کانال عمومی ارسال نمی‌شود"
              >
                📢 عمومی
              </span>
              <span
                className="rounded-md px-2.5 py-1 text-[10px] text-slate-600 line-through"
                title="قانون v2.7: کارت سیگنال/تسویه فقط به VIP می‌رود"
              >
                💬 پیش‌فرض
              </span>
            </div>
            <Button
              onClick={downloadPng}
              className="bg-emerald-500 text-xs text-emerald-950 hover:bg-emerald-400"
            >
              <Download className="size-3.5" /> 📥 دانلود تصویر PNG
            </Button>
            <Button
              variant="outline"
              onClick={() => void sendNow()}
              disabled={sending || !selectedSignal || variant.type !== "match"}
              title={selectedSignal ? "ارسال پوستر مسابقه به کانال VIP" : "ابتدا یک مسابقه انتخاب کنید"}
              className="border-cyan-500/40 bg-cyan-500/5 text-xs text-cyan-300 hover:bg-cyan-500/10"
            >
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              ✈️ ارسال فوری کارت
            </Button>
            <Button
              variant="ghost"
              onClick={() => setRenderTick((t) => t + 1)}
              className="border border-slate-800 text-xs text-slate-300 hover:bg-secondary"
            >
              <RefreshCw className="size-3.5" /> رندر مجدد
            </Button>
          </div>

          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            پوستر ۱۰۰٪ سمت کلاینت با Canvas 2D رندر می‌شود — بلافاصله پس از ورود به صفحه نقاشی می‌شود و
            هرگز منتظر پاسخ سرور نمی‌ماند. لوگوی باشگاه‌ها پس از بارگذاری به‌صورت غیرهمزمان اضافه
            می‌شوند؛ در صورت خطا، حروف اول نام تیم‌ها جایگزین می‌شود. ارسال فقط با Bot Token ثبت‌شده
            انجام می‌گیرد؛ در غیر این صورت فقط پیش‌نمایش ساخته می‌شود.
          </p>
        </Card>

        {/* ============ MODULE ب — Educational posts studio ============ */}
        <Card className="glass p-4">
          <div className="mb-3 flex items-center gap-2">
            <GraduationCap className="size-4 text-violet-300" />
            <h2 className="text-sm font-bold">📚 استودیو پست‌های آموزشی کوانت</h2>
          </div>
          {/* v3.1 — quick-access education/tips chip strip. Single-row
              horizontal scroll — chips NEVER wrap to a second line:
              overflow-x-auto + shrink-0 + whitespace-nowrap, 44px touch target. */}
          <div
            className="mb-3 flex gap-2 overflow-x-auto scroll-slim pb-1"
            role="tablist"
            aria-label="دسترسی سریع تاپیک‌های آموزشی"
          >
            {EDU_TOPICS.map((t) => {
              const eduActive = variant.type === "edu" && variant.topicId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={eduActive}
                  title={t.enTag}
                  onClick={() => {
                    setEduOpen((o) => ({ ...o, [t.id]: true }));
                    setVariant({ type: "edu", topicId: t.id });
                    scrollToPoster();
                  }}
                  className={cn(
                    "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 text-xs font-bold transition-all",
                    eduActive
                      ? "border-violet-500/60 bg-violet-500/10 text-violet-200"
                      : "border-slate-800 bg-secondary/40 text-slate-300 hover:border-violet-500/40 hover:text-violet-200",
                  )}
                >
                  <span className="num text-[11px]" style={{ color: t.accent }}>
                    {t.index}
                  </span>
                  <span className="whitespace-nowrap">{t.fa}</span>
                </button>
              );
            })}
          </div>
          <div className="space-y-2">
            {EDU_TOPICS.map((t) => {
              const open = !!eduOpen[t.id];
              return (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-xl border p-3 transition-all",
                    open ? "border-violet-500/40 bg-violet-500/5" : "border-slate-800 bg-secondary/40",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      {/* v2.7 — 22px bold headline per the patch spec */}
                      <div className="truncate text-[22px] font-bold leading-8">{t.fa}</div>
                      <div className="num text-[11px] font-bold" style={{ color: t.accent }}>
                        {t.index} · {t.enTag}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEduOpen((o) => ({ ...o, [t.id]: !o[t.id] }))}
                        className="h-7 gap-1 border border-slate-800 px-2 text-[10px]"
                      >
                        <Eye className="size-3" /> {open ? "بستن پیش‌نمایش" : "👁️ پیش‌نمایش"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void copyEn(t)}
                        className="h-7 gap-1 border border-slate-800 px-2 text-[10px]"
                      >
                        <Copy className="size-3" /> 📋 کپی متن EN
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setVariant({ type: "edu", topicId: t.id });
                          scrollToPoster();
                        }}
                        className="h-7 gap-1 bg-violet-500 px-2 text-[10px] text-violet-950 hover:bg-violet-400"
                      >
                        <Palette className="size-3" /> 🎨 پوستر آموزشی
                      </Button>
                    </div>
                  </div>
                  {open && (
                    // v2.7 — FA (RTL) and EN (LTR) fully separated panels with
                    // 15-16px body text and readable line height.
                    <div className="mt-2 grid grid-cols-1 gap-2 border-t border-slate-800/70 pt-3 md:grid-cols-2">
                      <div dir="rtl" className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-3">
                        <div className="mb-1 text-[10px] font-bold text-violet-300">فارسی — نسخهٔ کپشن تلگرام</div>
                        <p className="text-[16px] leading-7 text-slate-100">{t.faBody}</p>
                      </div>
                      <div dir="ltr" className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3 text-left">
                        <div className="mb-1 text-[10px] font-bold text-cyan-300">ENGLISH — POSTER / CHANNEL TEXT</div>
                        <p className="text-[15px] leading-6 text-slate-200">{t.en}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ============ Column 2 — Schedule + News ============ */}
      <div className="min-w-0 space-y-4 xl:col-span-1">
        {/* MODULE الف — Broadcast schedule */}
        <Card className="glass min-w-0 overflow-hidden p-4">
          <div className="mb-2 flex flex-nowrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarClock className="size-4 shrink-0 text-amber-300" />
              <h2 className="min-w-0 truncate text-sm font-bold">📅 جدول زمان‌بندی ارسال پیام‌ها</h2>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void loadSchedule(false)}
              disabled={bLoading}
              className="size-7"
              title="بازخوانی جدول"
            >
              <RefreshCw className={cn("size-3.5", bLoading && "animate-spin")} />
            </Button>
          </div>

          <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
            <Badge variant="outline" className="border-slate-700 text-slate-300">
              کل: {bStats?.total ?? 0}
            </Badge>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
              ارسال‌شده: {bStats?.sent ?? 0}
            </Badge>
            <Badge variant="outline" className="border-amber-500/40 text-amber-300">
              در صف: {bStats?.pending ?? 0}
            </Badge>
            <Badge variant="outline" className="border-slate-700 text-slate-400">
              آخرین ارسال: {fmtDateTimeFa(bStats?.lastSentAt ?? null)}
            </Badge>
          </div>

          <div className="min-w-0 overflow-hidden rounded-lg border border-slate-800/70">
            <div className="grid min-w-0 flex-nowrap grid-cols-[42px_minmax(0,1fr)_58px_92px_60px] gap-1 border-b border-slate-800/70 bg-secondary/50 px-2 py-1.5 text-[10px] font-bold text-slate-400">
              <span>ساعت</span>
              <span>عنوان</span>
              <span>کانال</span>
              <span>وضعیت</span>
              <span className="text-left">عملیات</span>
            </div>
            <div className="max-h-80 overflow-y-auto scroll-slim">
              {bLoading && (
                <div className="p-3 text-[11px] text-muted-foreground">در حال دریافت زمان‌بندی…</div>
              )}
              {!bLoading && sortedSlots.length === 0 && (
                <div className="p-3 text-[11px] text-muted-foreground">هیچ اسلاتی ثبت نشده است.</div>
              )}
              {sortedSlots.map((s) => (
                <div
                  key={s.id}
                  className="grid min-w-0 flex-nowrap grid-cols-[42px_minmax(0,1fr)_58px_92px_60px] items-center gap-1 overflow-hidden border-b border-slate-800/50 px-2 py-1.5 text-[11px] last:border-0"
                >
                  <span className="num shrink-0 text-slate-200" dir="ltr">
                    {formatSlotTime(s.time)}
                  </span>
                  <span className="min-w-0 truncate" title={s.slotTitle}>
                    {s.slotTitle}
                  </span>
                  <span>
                    <Badge
                      className={cn(
                        "px-1.5 text-[9px]",
                        s.channel === "VIP"
                          ? "bg-amber-400/15 text-amber-300"
                          : "bg-cyan-500/15 text-cyan-300",
                      )}
                    >
                      {s.channel === "VIP" ? "VIP" : "چرخش عمومی"}
                    </Badge>
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate text-[10px] font-bold",
                      s.sentAt ? "text-emerald-400" : "text-amber-300",
                    )}
                  >
                    {s.sentAt ? "ارسال‌شده ✅" : "در صف انتظار ⏳"}
                  </span>
                  <span className="flex min-w-0 flex-nowrap justify-end gap-1">
                    {!s.sentAt && (
                      <button
                        disabled={bBusy}
                        aria-label="ثبت ارسال"
                        title="✅ ثبت ارسال"
                        onClick={() => {
                          if (window.confirm(`«${s.slotTitle}» به‌عنوان ارسال‌شده ثبت شود؟`)) {
                            void mutateSlot(
                              { action: "update", id: s.id, markSent: true },
                              "ارسال اسلات ثبت شد",
                            );
                          }
                        }}
                        className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10"
                      >
                        <CheckCircle2 className="size-3.5" />
                      </button>
                    )}
                    {s.sentAt && (
                      <button
                        disabled={bBusy}
                        aria-label="بازگردانی به صف"
                        title="⏪ بازگردانی به صف"
                        onClick={() => {
                          void mutateSlot(
                            { action: "update", id: s.id, markSent: false },
                            "اسلات به صف انتظار بازگشت",
                          );
                        }}
                        className="rounded p-1 text-amber-300 hover:bg-amber-500/10"
                      >
                        <Undo2 className="size-3.5" />
                      </button>
                    )}
                    <button
                      disabled={bBusy}
                      aria-label="حذف اسلات"
                      title="🗑 حذف"
                      onClick={() => {
                        if (window.confirm(`اسلات «${s.slotTitle}» حذف شود؟`)) {
                          void mutateSlot({ action: "delete", id: s.id }, "اسلات حذف شد");
                        }
                      }}
                      className="rounded p-1 text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* add form */}
          <div className="mt-3 min-w-0 overflow-hidden rounded-lg border border-slate-800/70 bg-secondary/30 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300">افزودن اسلات جدید</span>
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                نمایش فرم
                <Switch checked={showAddForm} onCheckedChange={setShowAddForm} />
              </label>
            </div>
            {showAddForm && (
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5 min-w-0">
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="عنوان اسلات — مثلاً سیگنال تنیس عصرگاهی"
                  className="col-span-3 h-8 min-w-0 border-slate-800 bg-secondary/50 text-xs"
                />
                <Input
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  dir="ltr"
                  placeholder="HH:mm"
                  className="h-8 min-w-0 border-slate-800 bg-secondary/50 text-center text-xs"
                />
                <select
                  value={newKind}
                  onChange={(e) => setNewKind(e.target.value as typeof newKind)}
                  className="h-8 min-w-0 rounded-md border border-slate-800 bg-secondary/50 px-2 text-xs text-slate-200 outline-none"
                  aria-label="نوع پست"
                >
                  <option value="SIGNAL">کارت سیگنال → VIP</option>
                  <option value="EDUCATION">آموزش → عمومی</option>
                  <option value="NEWS">خبر ESPN → عمومی</option>
                  <option value="RADAR">رادار بازار → عمومی</option>
                  <option value="REPORT">گزارش شفافیت → عمومی</option>
                </select>
                <Button
                  onClick={() => void addSlot()}
                  disabled={bBusy}
                  size="sm"
                  className="h-8 shrink-0 gap-1 whitespace-nowrap bg-cyan-500 text-[11px] text-cyan-950 hover:bg-cyan-400"
                >
                  <Plus className="size-3.5" /> ➕ افزودن اسلات
                </Button>
              </div>
            )}
          </div>

          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            صادقانه: اسلات‌های آینده هرگز به‌صورت خودکار «ارسال‌شده» علامت نمی‌خورند — ثبت ارسال فقط با
            اقدام دستی تأییدشده انجام می‌شود؛ وضعیت ⏳ حتی برای اسلات‌های گذشته دقیق است.
          </p>
        </Card>

        {/* MODULE ج — ESPN news radar */}
        <Card className="glass p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Newspaper className="size-4 text-cyan-300" />
              <h2 className="text-sm font-bold">📰 رادار اخبار ورزشی زنده (ESPN)</h2>
            </div>
            <Badge variant="outline" className="border-slate-700 text-[9px] text-slate-400">
              هر ۱۲۰ ثانیه
            </Badge>
          </div>

          <div className="max-h-96 space-y-2 overflow-y-auto scroll-slim">
            {newsLoading && news.length === 0 && (
              <>
                <div className="shimmer h-20 rounded-lg border border-slate-800/70 bg-secondary/40" />
                <div className="shimmer h-20 rounded-lg border border-slate-800/70 bg-secondary/40" />
                <div className="shimmer h-20 rounded-lg border border-slate-800/70 bg-secondary/40" />
              </>
            )}
            {!newsLoading && news.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-[11px] text-muted-foreground">
                خبری یافت نشد — وایر ESPN در دسترس نیست
              </div>
            )}
            {news.map((n) => (
              <div key={n.id} className="rounded-lg border border-slate-800/70 bg-secondary/40 p-2.5">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <h3
                    dir="ltr"
                    className="min-w-0 break-words text-left text-xs font-bold leading-5 text-slate-100"
                  >
                    {n.headline}
                  </h3>
                  <a
                    href={n.link}
                    target="_blank"
                    rel="noreferrer"
                    title="مشاهده در ESPN"
                    className="mt-0.5 shrink-0 text-cyan-400 hover:text-cyan-300"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
                {/* v2.7 — FA translation block (RTL), shown when available */}
                {n.headlineFa && (
                  <div dir="rtl" className="mt-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5">
                    <div className="text-right text-xs font-bold leading-5 text-emerald-200">{n.headlineFa}</div>
                    {n.descriptionFa && (
                      <p className="mt-1 line-clamp-2 text-right text-[11px] leading-5 text-emerald-100/80">{n.descriptionFa}</p>
                    )}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <Badge
                    variant="outline"
                    className="border-cyan-500/40 px-1.5 text-[9px] text-cyan-300"
                  >
                    {n.source}
                  </Badge>
                  <span className="text-slate-500">{fmtDateTimeFa(n.published)}</span>
                </div>
                {n.description && (
                  <p
                    dir="ltr"
                    className="mt-1 line-clamp-2 text-left text-[10px] leading-4 text-muted-foreground"
                  >
                    {n.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => newsToPoster(n)}
                    className="h-7 gap-1 border-slate-700 px-2 text-[10px] text-slate-300 hover:bg-secondary"
                  >
                    <Palette className="size-3" /> 🎨 تبدیل خبر به پوستر
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void sendBilingualNews(n)}
                    disabled={sending}
                    className="h-7 gap-1 border-emerald-500/40 bg-emerald-500/5 px-2 text-[10px] text-emerald-300 hover:bg-emerald-500/10"
                    title="ارسال کارت خبر با کپشن دوزبانه به کانال عمومی"
                  >
                    {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                    📢 ارسال دوزبانه به کانال عمومی
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            فقط اخبار واقعی وایر ESPN نمایش داده می‌شود — هیچ خبر جعلی یا وضعیت ارسال ساختگی وجود ندارد.
          </p>
        </Card>
      </div>
    </div>
  );
}

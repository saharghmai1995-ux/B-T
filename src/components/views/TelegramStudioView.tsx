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
  fmtPrice,
  fmtUnits,
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
  price: number;
  evPct: number;
  stake: number;
  kickoffIso: string;
  venue: string | null;
  hash: string;
  mode: PosterMode;
  profit: number | null;
  scoreLine: string | null;
  sport: string;
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
    enTag: "KELLY CRITERION",
    en: "The Kelly Criterion sizes every stake to maximise long-run bankroll growth instead of raw win count. Full Kelly is aggressive, so our engine bets fractional Kelly (25% of the optimal fraction): stake = (p x odds - 1) / (odds - 1), then a hard ceiling of 5 units per play. The maths survives variance — and so does your bankroll.",
    faBody: "کلِی نسبت شرط را طوری تعیین می‌کند که رشد بلندمدت سرمایه بیشینه شود، نه تعداد برد ظاهری. ما ۲۵٪ کسرشدهٔ کلِی با سقف سخت ۵ واحد شرط می‌بندیم تا یک رشتهٔ باخت، حساب را نابود نکند.",
  },
  {
    id: "shin",
    index: "02",
    accent: EMERALD,
    fa: "حذف کارمزد بوک‌میکر با روش شین",
    enTag: "SHIN DE-VIG",
    en: "Bookmaker prices hide a silent tax: the overround. The Shin method (1998) assumes insider trading creates that margin and solves for the true implied probabilities, de-vigging far more accurately than naive normalisation. Every price we compare starts as a Shin-cleaned probability before our model fights the book.",
    faBody: "ضرایب بوک‌میکر حاشیهٔ پنهان دارند که مالیات پشت‌پردهٔ هر شرط است. روش شین با فرض معامله‌گران آگاه این حاشیه را حل می‌کند و احتمال واقعی را دقیق‌تر از تقسیم ساده استخراج می‌کند.",
  },
  {
    id: "clv",
    index: "03",
    accent: GOLD,
    fa: "ارزش خط پایانی (CLV) چیست",
    enTag: "CLOSING LINE VALUE",
    en: "Closing Line Value asks one question: did you beat the market? Compare the price you locked pre-match against the final closing line seconds before kickoff. Consistently positive CLV proves your model finds value before the sharpest money does — the single most predictive KPI of long-term profit, far more reliable than short-term win rate.",
    faBody: "CLV یعنی آیا از خط پایانی بازار بهتر شرط بستید یا نه. CLV مثبتِ پایدار، پیش‌بین‌ترین شاخص سود بلندمدت است و از برد و باخت کوتاه‌مدت معنادارتر است.",
  },
  {
    id: "dixon",
    index: "04",
    accent: VIOLET,
    fa: "دیکسون-کولز در برابر زنجیره مارکوف",
    enTag: "DIXON-COLES VS MARKOV",
    en: "Dixon-Coles models football scores with Poisson attack/defence rates plus a low-score correction term, excelling on full-season data. The Markov-chain engine instead tracks in-play state transitions and shines for live trading. We run both: Dixon-Coles for pre-match value, Markov as the live sanity check — their disagreement is itself a signal.",
    faBody: "دیکسون-کولز گل‌ها را با نرخ حمله و دفاع پواسون و تصحیح نتایج کم‌گل مدل می‌کند؛ زنجیرهٔ مارکوف گذارهای لحظه‌ای بازی را دنبال می‌گیرد. ما هر دو را اجرا می‌کنیم و اختلافشان خودش یک سیگنال است.",
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
  ctx.font = "bold 40px Arial";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText("NEOBET QUANT PRO", 72, 96);
  ctx.textAlign = "right";
  ctx.font = "bold 30px Arial";
  ctx.fillStyle = CYAN;
  ctx.fillText("@aineobet", w - 72, 96);
  ctx.textAlign = "left";
  ctx.font = "bold 22px Arial";
  ctx.fillStyle = accent;
  ctx.fillText(tagline, 72, 140);
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

  // v2.7 — BIG status badge (42px ExtraBold, colored box) top-center:
  // NEW SIGNAL cyan / WON emerald / LOST rose.
  const badgeText = spec.mode === "SIGNAL" ? "NEW SIGNAL" : spec.mode === "WIN" ? "WON" : "LOST";
  const badgeColor = spec.mode === "SIGNAL" ? "#22D3EE" : spec.mode === "WIN" ? "#10B981" : "#F43F5E";
  {
    ctx.save();
    ctx.font = "900 42px Arial";
    const tw = ctx.measureText(badgeText).width;
    const bw = tw + 72;
    const bx = w / 2 - bw / 2;
    const by = 62;
    const bGrad = ctx.createLinearGradient(bx, by, bx + bw, by + 66);
    bGrad.addColorStop(0, hexToRgba(badgeColor, 0.22));
    bGrad.addColorStop(1, hexToRgba(badgeColor, 0.08));
    rr(ctx, bx, by, bw, 66, 33);
    ctx.fillStyle = bGrad;
    ctx.fill();
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.shadowColor = hexToRgba(badgeColor, 0.55);
    ctx.shadowBlur = 22;
    ctx.textAlign = "center";
    ctx.fillStyle = badgeColor;
    ctx.fillText(badgeText, w / 2, by + 47);
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.font = "bold 22px Arial";
  ctx.fillStyle = GOLD;
  ctx.fillText(trunc(spec.competition.toUpperCase(), 44), w / 2, 178);

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

  // 5) stat boxes (y ~660-860)
  const boxW = Math.floor((w - 144 - 40) / 3);
  const boxY = 665;
  const boxH = 190;
  const profit = spec.profit ?? 0;
  const statBoxes: Array<{ label: string; value: string; color: string }> = [
    { label: "ODDS (DECIMAL)", value: fmtPrice(spec.price), color: "#FFFFFF" },
    {
      label: spec.mode === "SIGNAL" ? "MODEL EDGE" : "NET PROFIT",
      value:
        spec.mode === "SIGNAL"
          ? `${spec.evPct >= 0 ? "+" : ""}${spec.evPct.toFixed(1)}%`
          : `${profit >= 0 ? "+" : ""}${fmtUnits(profit, 2)}u`,
      color: accent,
    },
    { label: "STAKE (UNITS)", value: `${fmtUnits(spec.stake, 2)}u`, color: "#FFFFFF" },
  ];
  statBoxes.forEach((b, i) => {
    const x = 72 + i * (boxW + 20);
    rr(ctx, x, boxY, boxW, boxH, 18);
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(148,163,184,0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = "#7C8BA1";
    ctx.fillText(b.label, x + boxW / 2, boxY + 46);
    const vSize = fitFont(ctx, b.value, boxW - 28, 84, 52);
    ctx.font = `bold ${vSize}px Arial`;
    ctx.fillStyle = b.color;
    ctx.fillText(b.value, x + boxW / 2, boxY + 140);
  });

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
      price: 0,
      evPct: 0,
      stake: 0,
      kickoffIso: new Date().toISOString(),
      venue: null,
      hash: "0000000000000000",
      mode,
      profit: null,
      scoreLine: null,
      sport: "football",
    };
  }
  return {
    home: s.homeName || s.matchInfo || "HOME",
    away: s.awayName || "AWAY",
    homeLogo: s.homeLogo,
    awayLogo: s.awayLogo,
    competition: s.league || "NEOBET QUANT LEAGUE",
    marketEn: officialBetLine(s.marketKey, s.selection, s.marketLabel),
    marketFa: marketFa(s.marketKey),
    price: s.price,
    evPct: s.evPct,
    stake: s.stake,
    kickoffIso: s.startTime,
    venue: s.venue,
    hash: s.shaHash || "0000000000000000",
    mode,
    profit: s.netProfit,
    scoreLine:
      mode !== "SIGNAL" && s.homeScore != null && s.awayScore != null
        ? `${s.homeScore} - ${s.awayScore}`
        : null,
    sport: s.sport,
  };
}

function timeToMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 1500;
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
  // v2.6 — broadcast lane of the manual card send (PUBLIC | VIP | legacy chat)
  const [sendLane, setSendLane] = useState<"DEFAULT" | "PUBLIC" | "VIP">("PUBLIC");

  // MODULE الف — broadcast schedule
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [bStats, setBStats] = useState<BroadcastStats | null>(null);
  const [bLoading, setBLoading] = useState(true);
  const [bBusy, setBBusy] = useState(false);
  const [showAddForm, setShowAddForm] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newChannel, setNewChannel] = useState<"PUBLIC" | "VIP">("PUBLIC");

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
        body: JSON.stringify({ kind: mode, signalId: selectedSignal.id, send: true, channel: sendLane }),
      });
      const j = (await res.json()) as TelegramResp;
      if (!j.ok) throw new Error(j.error ?? "پاسخ ناموفق از سرور");
      if (j.sent) toast.success(`کارت با sendPhoto به لاین ${j.lane ?? sendLane} ارسال شد`);
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
      { action: "create", slotTitle: title, time: t, channel: newChannel, kind: "SIGNAL" },
      "اسلات جدید به صف پخش اضافه شد",
    );
    setNewTitle("");
    setNewTime("");
  }

  const sortedSlots = useMemo(
    () => [...slots].sort((a, b) => timeToMin(a.time) - timeToMin(b.time)),
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

  /* ---------------- render ---------------- */

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3" data-testid="telegram-view">
      {/* ============ Column 1 — CHANNEL MANAGER + POSTER ENGINE + Edu studio ============ */}
      <div className="space-y-4 xl:col-span-2">
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
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto scroll-slim">
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
                      "max-w-full truncate rounded-md border px-2 py-1 text-[10px] transition-all",
                      active
                        ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200"
                        : "border-slate-800 bg-secondary/40 text-slate-400 hover:border-slate-600",
                    )}
                  >
                    مسابقه: {s.matchInfo}{" "}
                    <span className={statusColor(s.status)}>({s.status})</span>
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
            <div
              dir="ltr"
              className="mb-3 rounded-lg border border-slate-800/70 bg-secondary/40 px-2.5 py-1.5 text-left text-[10px] text-slate-300"
            >
              {officialBetLine(
                selectedSignal.marketKey,
                selectedSignal.selection,
                selectedSignal.marketLabel,
              )}{" "}
              @ {fmtPrice(selectedSignal.price)} · EDGE {selectedSignal.evPct.toFixed(1)}% · STAKE{" "}
              {fmtUnits(selectedSignal.stake)}u
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
            {/* v2.6 — lane selector chips */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-secondary/40 p-1">
              {(["PUBLIC", "VIP", "DEFAULT"] as const).map((lane) => {
                const active = sendLane === lane;
                return (
                  <button
                    key={lane}
                    onClick={() => setSendLane(lane)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[10px] font-bold transition-all",
                      active
                        ? lane === "VIP"
                          ? "bg-amber-400 text-slate-950"
                          : "bg-cyan-400 text-slate-950"
                        : "text-slate-400 hover:text-slate-200",
                    )}
                  >
                    {lane === "PUBLIC" ? "📢 عمومی" : lane === "VIP" ? "👑 VIP" : "💬 چت پیش‌فرض"}
                  </button>
                );
              })}
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
              title={selectedSignal ? `ارسال پوستر به لاین ${sendLane}` : "ابتدا یک مسابقه انتخاب کنید"}
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
          <div className="space-y-2">
            {EDU_TOPICS.map((t) => {
              const open = !!eduOpen[t.id];
              return (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-xl border p-2.5 transition-all",
                    open ? "border-violet-500/40 bg-violet-500/5" : "border-slate-800 bg-secondary/40",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold">{t.fa}</div>
                      <div className="num text-[10px]" style={{ color: t.accent }}>
                        {t.enTag}
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
                    <div className="mt-2 space-y-2 border-t border-slate-800/70 pt-2">
                      <p dir="ltr" className="text-left text-[11px] leading-5 text-slate-300">
                        {t.en}
                      </p>
                      <p dir="rtl" className="text-[11px] leading-5 text-muted-foreground">
                        {t.faBody}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ============ Column 2 — Schedule + News ============ */}
      <div className="space-y-4 xl:col-span-1">
        {/* MODULE الف — Broadcast schedule */}
        <Card className="glass p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-amber-300" />
              <h2 className="text-sm font-bold">📅 جدول زمان‌بندی ارسال پیام‌ها</h2>
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

          <div className="rounded-lg border border-slate-800/70">
            <div className="grid grid-cols-[52px_1fr_68px_100px_78px] gap-1 border-b border-slate-800/70 bg-secondary/50 px-2 py-1.5 text-[10px] font-bold text-slate-400">
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
                  className="grid grid-cols-[52px_1fr_68px_100px_78px] items-center gap-1 border-b border-slate-800/50 px-2 py-1.5 text-[11px] last:border-0"
                >
                  <span className="num text-slate-200" dir="ltr">
                    {s.time}
                  </span>
                  <span className="truncate" title={s.slotTitle}>
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
                      "text-[10px] font-bold",
                      s.sentAt ? "text-emerald-400" : "text-amber-300",
                    )}
                  >
                    {s.sentAt ? "ارسال‌شده ✅" : "در صف انتظار ⏳"}
                  </span>
                  <span className="flex justify-end gap-1">
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
          <div className="mt-3 rounded-lg border border-slate-800/70 bg-secondary/30 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300">افزودن اسلات جدید</span>
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                نمایش فرم
                <Switch checked={showAddForm} onCheckedChange={setShowAddForm} />
              </label>
            </div>
            {showAddForm && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_84px_112px_auto]">
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="عنوان اسلات — مثلاً سیگنال تنیس عصرگاهی"
                  className="h-8 border-slate-800 bg-secondary/50 text-xs"
                />
                <Input
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  dir="ltr"
                  placeholder="HH:mm"
                  className="h-8 border-slate-800 bg-secondary/50 text-center text-xs"
                />
                <select
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value as "PUBLIC" | "VIP")}
                  className="h-8 rounded-md border border-slate-800 bg-secondary/50 px-2 text-xs text-slate-200 outline-none"
                  aria-label="کانال"
                >
                  <option value="PUBLIC">چرخش عمومی</option>
                  <option value="VIP">VIP</option>
                </select>
                <Button
                  onClick={() => void addSlot()}
                  disabled={bBusy}
                  size="sm"
                  className="h-8 gap-1 bg-cyan-500 text-[11px] text-cyan-950 hover:bg-cyan-400"
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
                <div className="flex items-start justify-between gap-2">
                  <h3 dir="ltr" className="text-left text-xs font-bold leading-5 text-slate-100">
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => newsToPoster(n)}
                  className="mt-2 h-7 gap-1 border-slate-700 px-2 text-[10px] text-slate-300 hover:bg-secondary"
                >
                  <Palette className="size-3" /> 🎨 تبدیل خبر به پوستر
                </Button>
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

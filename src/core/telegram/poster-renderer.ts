/**
 * Telegram Poster Renderer — v2.0 UEFA Matchday broadcast style (1080x1350).
 * 100% English typography, drawn programmatically as SVG (no template upload,
 * no external image fetches — librsvg-safe club monograms with neon glows).
 * The Telegram route converts SVG→PNG via sharp and sends sendPhoto.
 */

export type PosterKind = "SIGNAL" | "WIN" | "LOSS" | "NEWS";

export interface PosterSpec {
  kind: PosterKind;
  matchInfo: string; // e.g. "Arsenal vs Brentford"
  competition?: string; // league / tournament display name
  sport?: "football" | "tennis"; // v2.7 — drives the ball icon above VS
  marketLabel?: string; // official English 1xBet market
  selection?: string;
  price?: number;
  evPct?: number;
  prob?: number;
  stake?: number;
  netProfit?: number;
  bankroll?: number;
  hash?: string;
  kickoffIso?: string; // ISO date used for the date/time info bar
  venue?: string; // stadium / court name
  homeName?: string;
  awayName?: string;
  headline?: string; // NEWS posters: article headline
  summary?: string; // NEWS posters: article description
  link?: string; // NEWS posters: espn.com link
}

const W = 1080;
const H = 1350;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmt = (n: number | undefined, d = 2) =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "—";

/** Neon monogram initials (max 2 letters) for a team/player name. */
function initialsOf(name: string): string {
  const words = (name || "??").replace(/[^A-Za-z\s]/g, "").trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0]?.slice(0, 2) ?? "??").toUpperCase();
}

/** Deterministic hue per team name so the two monograms always differ. */
function hueOf(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function kindTheme(kind: PosterKind): { beam: string; accent: string; tag: string } {
  switch (kind) {
    case "WIN": return { beam: "#10B981", accent: "#34D399", tag: "WIN — SETTLED & VERIFIED" };
    case "LOSS": return { beam: "#EF4444", accent: "#F87171", tag: "LOSS — FULL TRANSPARENCY" };
    case "NEWS": return { beam: "#F59E0B", accent: "#FBBF24", tag: "BREAKING — LIVE SPORTS NEWS" };
    default: return { beam: "#00E5FF", accent: "#22D3EE", tag: "NEW SIGNAL — PRE-MATCH LOCKED" };
  }
}

function dateBar(spec: PosterSpec): Array<{ icon: string; text: string }> {
  const d = spec.kickoffIso ? new Date(spec.kickoffIso) : null;
  const dateTxt = d && Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    : "MATCHDAY";
  const timeTxt = d && Number.isFinite(d.getTime())
    ? `${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`
    : "TBD";
  return [
    { icon: "DATE", text: dateTxt },
    { icon: "KICKOFF", text: timeTxt },
    { icon: "VENUE", text: (spec.venue ?? "OFFICIAL VENUE").slice(0, 30).toUpperCase() },
  ];
}

/** Render the UEFA-style poster as a standalone SVG string (1080x1350). */
export function renderPosterSvg(spec: PosterSpec): string {
  const th = kindTheme(spec.kind);
  const hash = spec.hash ?? "";
  const masked = hash ? `${hash.slice(0, 12)}••••••${hash.slice(-8)}` : "SHA-256 PENDING";
  const home = spec.homeName ?? spec.matchInfo.split(" vs ")[0] ?? "HOME";
  const away = spec.awayName ?? spec.matchInfo.split(" vs ")[1] ?? "AWAY";
  const info = dateBar(spec);

  const beams = Array.from({ length: 7 }, (_, i) => {
    const x = -200 + i * 260;
    return `<polygon points="${x},0 ${x + 130},0 ${x + 470},${H} ${x + 340},${H}" fill="${th.beam}" opacity="0.05"/>`;
  }).join("");

  const monogram = (name: string, cx: number, cy: number) => {
    const hue = hueOf(name);
    return `
    <circle cx="${cx}" cy="${cy}" r="118" fill="none" stroke="hsl(${hue} 90% 60%)" stroke-width="5" opacity="0.9"/>
    <circle cx="${cx}" cy="${cy}" r="100" fill="hsl(${hue} 70% 18%)"/>
    <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-family="Arial" font-size="72" font-weight="800" fill="hsl(${hue} 95% 72%)">${esc(initialsOf(name))}</text>`;
  };

  // v2.7 — sport-specific ball above the VS crosshair (football pentagon
  // pattern vs tennis seams), driven by spec.sport.
  const ballSvg = (() => {
    const bx = 540;
    const by = 209; // v2.7.1 — face-off zone starts exactly at y=185 (ball top edge)
    if (spec.sport === "tennis") {
      return `
  <g>
    <circle cx="${bx}" cy="${by}" r="24" fill="#B7F264" stroke="rgba(15,23,42,0.7)" stroke-width="2"/>
    <path d="M ${bx - 22} ${by - 12} Q ${bx} ${by + 2} ${bx - 22} ${by + 16}" fill="none" stroke="#FFFFFF" stroke-width="3"/>
    <path d="M ${bx + 22} ${by - 12} Q ${bx} ${by + 2} ${bx + 22} ${by + 16}" fill="none" stroke="#FFFFFF" stroke-width="3"/>
  </g>`;
    }
    const pr = 9;
    const pent = Array.from({ length: 5 }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      return `${bx + pr * Math.cos(a)},${by + pr * Math.sin(a)}`;
    }).join(" ");
    const spokes = Array.from({ length: 5 }, (_, i) => {
      const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const a1 = a0 + Math.PI / 5;
      return `<line x1="${(bx + pr * Math.cos(a0)).toFixed(1)}" y1="${(by + pr * Math.sin(a0)).toFixed(1)}" x2="${(bx + 22 * Math.cos(a1)).toFixed(1)}" y2="${(by + 22 * Math.sin(a1)).toFixed(1)}" stroke="rgba(15,23,42,0.75)" stroke-width="2.5"/>`;
    }).join("");
    return `
  <g>
    <circle cx="${bx}" cy="${by}" r="24" fill="#F1F5F9" stroke="rgba(15,23,42,0.7)" stroke-width="2"/>
    <polygon points="${pent}" fill="rgba(15,23,42,0.82)"/>
    ${spokes}
  </g>`;
  })();

  // v2.7.1 hotfix §2.1 — the status badge lives on its own DEDICATED centered
  // row at y=112 (rect 88–136). It never touches the brand row (y=52) or the
  // tag row (y=84) again — zero text overlap on the 1080x1350 canvas.
  const badgeText = spec.kind === "SIGNAL" ? "NEW SIGNAL" : spec.kind === "WIN" ? "WON" : spec.kind === "LOSS" ? "LOST" : "NEWS";
  const badgeColor = spec.kind === "SIGNAL" ? "#22D3EE" : spec.kind === "WIN" ? "#10B981" : spec.kind === "LOSS" ? "#F43F5E" : "#F59E0B";
  const badgeWidth = badgeText.length * 22 + 56;
  const badgeSvg = `
  <g>
    <rect x="${540 - badgeWidth / 2}" y="88" width="${badgeWidth}" height="48" rx="24" fill="${badgeColor}" fill-opacity="0.14" stroke="${badgeColor}" stroke-width="3"/>
    <text x="540" y="120" text-anchor="middle" font-family="Arial" font-size="30" font-weight="900" fill="${badgeColor}" letter-spacing="2">${esc(badgeText)}</text>
  </g>`;

  const infoBarY = 1015;
  const infoBar = info.map((it, i) => {
    const bx = 72 + i * 312;
    return `
    <rect x="${bx}" y="${infoBarY}" width="292" height="92" rx="18" fill="#0B1220" stroke="#1E2A3D"/>
    <text x="${bx + 20}" y="${infoBarY + 34}" font-family="Arial" font-size="20" fill="${th.accent}" letter-spacing="3">${esc(it.icon)}</text>
    <text x="${bx + 20}" y="${infoBarY + 70}" font-family="Arial" font-size="26" font-weight="700" fill="#FFFFFF">${esc(it.text.slice(0, 24))}</text>`;
  }).join("");

  const marketBlock = spec.kind === "NEWS"
    ? `<text x="72" y="530" font-family="Arial" font-size="26" fill="#8FA3BF" letter-spacing="2">LIVE REPORT — ESPN NEWS WIRE</text>
       <rect x="72" y="552" width="936" height="330" rx="24" fill="#0B1220" stroke="#1E2A3D"/>
       <foreignObject x="100" y="574" width="880" height="290">
         <div xmlns="http://www.w3.org/1999/xhtml" style="color:#FFFFFF;font-family:Arial;font-size:40px;font-weight:800;line-height:1.25;">${esc((spec.headline ?? "Sports headline").slice(0, 130))}</div>
       </foreignObject>`
    : `<text x="72" y="530" font-family="Arial" font-size="26" fill="#8FA3BF" letter-spacing="2">OFFICIAL 1xBET MARKET — ${esc((spec.competition ?? "").slice(0, 34))}</text>
       <rect x="72" y="552" width="936" height="112" rx="56" fill="#061620" stroke="${th.beam}" stroke-width="3"/>
       <text x="540" y="622" text-anchor="middle" font-family="Arial" font-size="42" font-weight="800" fill="#FFFFFF">${esc((spec.marketLabel ?? "Market pending").slice(0, 46))}</text>
       <text x="72" y="688" font-family="Arial" font-size="46" font-weight="800" fill="${th.accent}">${esc((spec.selection ?? "—").slice(0, 50))}</text>
       <rect x="72" y="712" width="452" height="218" rx="24" fill="#0B1220" stroke="#1E2A3D"/>
       <text x="96" y="764" font-family="Arial" font-size="26" fill="#8FA3BF" letter-spacing="2">ODDS (DECIMAL)</text>
       <text x="96" y="886" font-family="Arial" font-size="84" font-weight="800" fill="#FFFFFF">${fmt(spec.price)}</text>
       <rect x="556" y="712" width="452" height="218" rx="24" fill="#0B1220" stroke="#1E2A3D"/>
       <text x="580" y="764" font-family="Arial" font-size="26" fill="#8FA3BF" letter-spacing="2">${spec.kind === "SIGNAL" ? "EDGE (+EV) · STAKE" : spec.kind === "WIN" ? "PROFIT UNITS" : "RESULT UNITS"}</text>
       <text x="580" y="886" font-family="Arial" font-size="84" font-weight="800" fill="${th.accent}">${spec.kind === "SIGNAL" ? `+${fmt(spec.evPct, 1)}%` : spec.kind === "WIN" ? `+${fmt(spec.netProfit, 1)}u` : spec.kind === "LOSS" ? `${fmt(spec.netProfit, 1)}u` : "—"}</text>
       <text x="72" y="968" font-family="Arial" font-size="28" fill="#8FA3BF">Model probability ${fmt(spec.prob, 1)}%   ·   Stake ${fmt(spec.stake, 0)}u   ·   Settlement 90m Regular Time</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="#0A1B3D"/>
      <stop offset="55%" stop-color="#071026"/>
      <stop offset="100%" stop-color="#04070F"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F8FAFC"/><stop offset="45%" stop-color="#94A3B8"/><stop offset="100%" stop-color="#475569"/>
    </linearGradient>
    <linearGradient id="accentbar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${th.accent}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${th.accent}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="stadiumglow" cx="0.5" cy="0.25" r="0.75">
      <stop offset="0%" stop-color="${th.beam}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${th.beam}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${beams}
  <rect width="${W}" height="${H}" fill="url(#stadiumglow)"/>

  <!-- top chrome -->
  <rect x="0" y="0" width="${W}" height="10" fill="${th.accent}"/>
  <!-- v2.7.1 layout: brand y=52 → tag y=84 → dedicated status row y=112 -->
  <text x="72" y="52" font-family="Arial" font-size="40" font-weight="800" fill="#FFFFFF" letter-spacing="2">NEOBET QUANT PRO</text>
  <text x="1008" y="52" text-anchor="end" font-family="Arial" font-size="30" font-weight="700" fill="${th.accent}" letter-spacing="2">@aineobet</text>
  <text x="72" y="84" font-family="Arial" font-size="24" fill="#8FA3BF" letter-spacing="5">${esc(th.tag)}</text>
  ${badgeSvg}

  <!-- face-off zone (league + logos start at y=185 per hotfix §2.1) -->
  ${ballSvg}
  ${monogram(home, 262, 303)}
  ${monogram(away, 818, 303)}
  <circle cx="540" cy="293" r="40" fill="#0B1220" stroke="#1E2A3D"/>
  <circle cx="540" cy="293" r="16" fill="none" stroke="#FFFFFF" stroke-width="3"/>
  <line x1="540" y1="277" x2="540" y2="309" stroke="#FFFFFF" stroke-width="3"/>
  <line x1="524" y1="293" x2="556" y2="293" stroke="#FFFFFF" stroke-width="3"/>
  <text x="540" y="452" text-anchor="middle" font-family="Arial" font-size="64" font-weight="800" fill="url(#metal)" letter-spacing="6">VS</text>
  <text x="262" y="490" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="#FFFFFF">${esc(home.slice(0, 22))}</text>
  <text x="818" y="490" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="#FFFFFF">${esc(away.slice(0, 22))}</text>

  <!-- market capsule zone -->
  ${marketBlock}

  <!-- info bar -->
  ${infoBar}

  <!-- night stadium silhouette with light reflection -->
  <g transform="translate(0,1180)">
    <ellipse cx="540" cy="150" rx="620" ry="130" fill="#0A1322"/>
    <ellipse cx="540" cy="120" rx="540" ry="96" fill="#101C33"/>
    <ellipse cx="540" cy="96" rx="420" ry="62" fill="#16233D"/>
    <ellipse cx="540" cy="118" rx="470" ry="70" fill="${th.beam}" opacity="0.14"/>
    <rect x="70" y="118" width="940" height="3" fill="${th.accent}" opacity="0.7"/>
    <rect x="70" y="140" width="940" height="46" fill="#05080F"/>
    <text x="540" y="172" text-anchor="middle" font-family="Arial" font-size="22" fill="#5D7290" letter-spacing="4">OFFICIAL STADIUM NIGHT VIEW — NEON REFLECTION</text>
  </g>

  <!-- telemetry bar -->
  <rect x="0" y="1290" width="${W}" height="6" fill="url(#accentbar)"/>
  <text x="72" y="1330" font-family="Courier New" font-size="22" fill="#5D7290" letter-spacing="1">NEOBET QUANT PRO • SHA-256 ${esc(masked)}</text>
  <text x="1008" y="1330" text-anchor="end" font-family="Arial" font-size="26" font-weight="800" fill="#FFFFFF">@aineobet</text>
</svg>`;
}

/** The exact 1080x1350 dimensions — exported for canvas preview parity. */
export const POSTER_DIMENSIONS = { width: W, height: H };

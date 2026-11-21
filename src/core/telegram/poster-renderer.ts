/**
 * Telegram Poster Renderer — self-generating 1080x1440 (3:4) posters.
 * 100% English typography, drawn programmatically as SVG (no template upload).
 * The Telegram route converts SVG→PNG via sharp and sends sendPhoto (no caption).
 */

export type PosterKind = "SIGNAL" | "WIN" | "LOSS" | "TEASER";

export interface PosterSpec {
  kind: PosterKind;
  matchInfo: string; // e.g. "Arsenal vs Brentford — EPL"
  marketLabel: string;
  selection: string;
  price: number;
  evPct?: number;
  prob?: number;
  stake?: number;
  netProfit?: number;
  bankroll?: number;
  hash?: string;
  lockedTeaser?: string; // headline for locked teaser posters
}

const W = 1080;
const H = 1440;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmt = (n: number | undefined, d = 2) =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "—";

function kindTheme(kind: PosterKind): { bg1: string; bg2: string; accent: string; tag: string } {
  switch (kind) {
    case "WIN": return { bg1: "#04160C", bg2: "#060911", accent: "#22C55E", tag: "WIN — SETTLED" };
    case "LOSS": return { bg1: "#160404", bg2: "#060911", accent: "#EF4444", tag: "LOSS — SETTLED" };
    case "TEASER": return { bg1: "#141004", bg2: "#060911", accent: "#D4AF37", tag: "VIP LOCKED TEASER" };
    default: return { bg1: "#0A0F1C", bg2: "#060911", accent: "#34D399", tag: "NEW SIGNAL — PRE-MATCH" };
  }
}

/** Render the poster as a standalone SVG string (1080x1440). */
export function renderPosterSvg(spec: PosterSpec): string {
  const th = kindTheme(spec.kind);
  const hash = spec.hash ?? "";
  const masked = hash ? `${hash.slice(0, 14)}••••••••${hash.slice(-10)}` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${th.bg1}"/><stop offset="100%" stop-color="${th.bg2}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${th.accent}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${th.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${th.accent}"/>
  <text x="72" y="120" font-family="Arial, Helvetica" font-size="44" font-weight="800" fill="#FFFFFF" letter-spacing="2">NeoBet Quant Pro</text>
  <text x="72" y="164" font-family="Arial" font-size="26" fill="${th.accent}" letter-spacing="4">${esc(th.tag)}</text>
  <line x1="72" y1="200" x2="1008" y2="200" stroke="#1E2A3D" stroke-width="2"/>

  <text x="72" y="330" font-family="Arial" font-size="34" fill="#8FA3BF">MATCH</text>
  <text x="72" y="395" font-family="Arial" font-size="${spec.matchInfo.length > 34 ? 44 : 54}" font-weight="800" fill="#FFFFFF">${esc(spec.matchInfo.slice(0, 46))}</text>

  <text x="72" y="520" font-family="Arial" font-size="34" fill="#8FA3BF">MARKET — 1xBet / BetForward</text>
  <text x="72" y="585" font-family="Arial" font-size="48" font-weight="700" fill="#FFFFFF">${esc(spec.marketLabel.slice(0, 40))}</text>
  <text x="72" y="650" font-family="Arial" font-size="40" font-weight="700" fill="${th.accent}">${esc(spec.selection)}</text>

  ${
    spec.kind === "TEASER"
      ? `<rect x="72" y="740" width="936" height="360" rx="28" fill="#0B1220" stroke="#D4AF37" stroke-width="3"/>
         <text x="540" y="880" text-anchor="middle" font-family="Arial" font-size="44" font-weight="800" fill="#D4AF37">LOCKED — VIP ONLY</text>
         <text x="540" y="945" text-anchor="middle" font-family="Arial" font-size="30" fill="#B9C6D8">Unlock with @aineobet VIP membership</text>
         <text x="540" y="1000" text-anchor="middle" font-family="Arial" font-size="28" fill="#8FA3BF">Full pick, stake and price inside the hub</text>`
      : `<rect x="72" y="740" width="430" height="220" rx="24" fill="#0B1220" stroke="#1E2A3D"/>
         <text x="96" y="800" font-family="Arial" font-size="30" fill="#8FA3BF">ODDS (DECIMAL)</text>
         <text x="96" y="900" font-family="Arial" font-size="86" font-weight="800" fill="#FFFFFF">${fmt(spec.price)}</text>
         <rect x="578" y="740" width="430" height="220" rx="24" fill="#0B1220" stroke="#1E2A3D"/>
         <text x="602" y="800" font-family="Arial" font-size="30" fill="#8FA3BF">${spec.kind === "SIGNAL" ? "EDGE (+EV)" : spec.kind === "WIN" ? "PROFIT" : "RESULT"}</text>
         <text x="602" y="900" font-family="Arial" font-size="86" font-weight="800" fill="${th.accent}">${spec.kind === "SIGNAL" ? `+${fmt(spec.evPct, 1)}%` : spec.kind === "WIN" ? `+${fmt(spec.netProfit, 1)}u` : spec.kind === "LOSS" ? `${fmt(spec.netProfit, 1)}u` : "—"}</text>

         <text x="72" y="1040" font-family="Arial" font-size="32" fill="#8FA3BF">Model probability ${fmt(spec.prob, 1)}%   ·   Stake ${fmt(spec.stake, 0)}u   ·   Bank ${fmt(spec.bankroll, 0)}u</text>`
  }

  <rect x="0" y="1290" width="${W}" height="6" fill="url(#accent)"/>
  <text x="72" y="1355" font-family="Courier New" font-size="26" fill="#5D7290" letter-spacing="1">SHA-256 ${esc(masked || "PENDING")}</text>
  <text x="1008" y="1355" text-anchor="end" font-family="Arial" font-size="30" font-weight="800" fill="#FFFFFF">@aineobet</text>
</svg>`;
}

/** The exact 1080x1440 dimensions — exported for canvas preview parity. */
export const POSTER_DIMENSIONS = { width: W, height: H };

/**
 * NeoBet Quant Pro v3.2 — release invariants (work-order §5, checklist of 4).
 * These MUST pass before the new preview ships:
 *   1. settledFootball >= 10 AND settledTennis >= 10 (both sports alive).
 *   2. shadowVetoes >= 5 and NO record carries verdict === null.
 *   3. NO settled tennis row is an unrated coin-flip (Elo 1500 vs 1500 —
 *      both players without a real ATP/WTA ranking).
 *   4. The 5-tab render sources contain ZERO obsolete financial strings
 *      ("Equity Curve", "ROI", "Flat 20u", "Kelly 0.25", "918 u", "EV -5.2%").
 *
 * Tests 1–3 read the REAL dev ledger (db/custom.db) — READ-ONLY queries, the
 * dev database file is never written by this suite. Test 4 statically scans
 * the render sources (comments stripped) so the banned tokens can never be
 * printed by any of the five tabs.
 */

import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";

type DbClient = typeof import("@/lib/db")["db"];
let db: DbClient;

beforeAll(async () => {
  // Point Prisma at the REAL dev ledger before the client singleton is built.
  process.env.DATABASE_URL = `file:${path.resolve(process.cwd(), "db", "custom.db")}`;
  ({ db } = await import("@/lib/db"));
});

describe("v3.2 invariant 1 — both sports alive in the track record", () => {
  it("settledFootball >= 10 AND settledTennis >= 10", async () => {
    const settledFootball = await db.signal.count({
      where: { sport: "football", status: { not: "OPEN" } },
    });
    const settledTennis = await db.signal.count({
      where: { sport: "tennis", status: { not: "OPEN" } },
    });
    expect(settledFootball).toBeGreaterThanOrEqual(10);
    expect(settledTennis).toBeGreaterThanOrEqual(10);
  });
});

describe("v3.2 invariant 2 — Shadow Ledger holds only REAL verdicts", () => {
  it("shadowVetoes >= 5 and no record has verdict === null", async () => {
    const vetoes = await db.shadowVeto.findMany({
      select: { id: true, verdict: true, signalRef: true },
    });
    expect(vetoes.length).toBeGreaterThanOrEqual(5);
    for (const v of vetoes) {
      expect(v.verdict, `shadow veto ${v.id} (${v.signalRef}) has a null verdict`).not.toBeNull();
    }
  });
});

describe("v3.2 invariant 3 — zero unrated coin-flips in the tennis ledger", () => {
  it("no settled tennis row has BOTH players without a real ATP/WTA ranking", async () => {
    const rows = await db.signal.findMany({
      where: { sport: "tennis", status: { not: "OPEN" } },
      select: { id: true, marketKey: true, match: { select: { homeRank: true, awayRank: true } } },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const unratedPairing = r.match.homeRank == null && r.match.awayRank == null;
      expect(
        unratedPairing,
        `tennis signal ${r.id} (${r.marketKey}) is an unrated Elo-1500 pairing`,
      ).toBe(false);
    }
  });
});

describe("v3.2 invariant 4 — zero obsolete financial strings in the 5-tab render", () => {
  /** Every renderable source of the five dashboard tabs (v3.2 surface). */
  const TAB_SOURCES = [
    "src/components/layout/AppShell.tsx",
    "src/components/views/OverviewView.tsx",
    "src/components/views/SignalsHubView.tsx",
    "src/components/views/SignalCard.tsx",
    "src/components/views/VerifiedLedgerView.tsx",
    "src/components/views/QuantLabView.tsx",
    "src/components/views/lab/CalibrationLab.tsx",
    "src/components/views/lab/QqlConsole.tsx",
    "src/components/views/TelegramStudioView.tsx",
  ];

  const BANNED = ["Equity Curve", "ROI", "Flat 20u", "Kelly 0.25", "918 u", "EV -5.2%"];

  /** Strip block + line comments — approximates the RENDERED output surface. */
  const stripComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/[ \t]+\/\/.*$/gm, "");

  it("no banned string appears in any renderable line of the five tabs", () => {
    for (const rel of TAB_SOURCES) {
      const abs = path.resolve(process.cwd(), rel);
      expect(fs.existsSync(abs), `${rel} must exist`).toBe(true);
      const code = stripComments(fs.readFileSync(abs, "utf8"));
      for (const token of BANNED) {
        expect(code.includes(token), `${rel} renders the banned string "${token}"`).toBe(false);
      }
    }
  });
});

# Task 4-c — VerifiedLedgerView v3.1 rebuild (Verified Hit-Rate Ledger, Tab 3)

Agent: verified-ledger rebuild agent · File owned: `src/components/views/VerifiedLedgerView.tsx` (848 → 1289 lines)

## What was done

Kept intact from v2.0: data flow (`state: AppStatePayload` prop), local filters (search / status / sport / league / time-range), CSV+JSON audit export, Quarter-Kelly vs Flat-20u stake-policy replay, expandable verified rows with real lock + settlement timestamps, SHA-256 verify dialog.

### v3.1 additions

1. **Cumulative Win-Rate + No-Loss Rate trend chart** (`data-testid="ledger-trend-chart"`)
   - Full-width block inside the analytical charts card, below the 3-column grid.
   - `trend` useMemo: settled signals (OPEN filtered out) sorted by `settledAt asc`; one point per settlement:
     `winRate = WON/decided(WON+LOST) so far`, `noLossRate = (WON+VOID)/settled so far` (both ×100).
   - Recharts `LineChart`, emerald `#34D399` line (وین‌ریت خالص تجمعی), cyan `#00E5FF` line (نرخ سربه‌سر تجمعی),
     YAxis domain [0,100] with `%` ticks, Persian `Legend` + `Tooltip`, header chips with final values + settled/decided counts.
   - Empty state → "رکورد تسویه‌شده‌ای برای رسم روند تجمعی ثبت نشده است".

2. **Per-tier breakdown** (`data-testid="tier-breakdown"`): TIER_S / TIER_A / TIER_B cards from `state.agentLab?.tierStats`
   (TierBadge + settled count + W/L/V counts + RateBar for winRate & noLossRate). Missing tier → dashed "بدون داده" placeholder;
   whole block missing → explanatory note. Rates normalized via `pct0()` (0–1 fraction → %; backend stores fractions).

3. **Per-shield-type breakdown** (`data-testid="shield-breakdown"`): compact no-scroll table for
   FULL_PUSH_SHIELD (سپر کامل) / HALF_PUSH_SHIELD (نیمه‌برگشت) / DOUBLE_OUTCOME_SHIELD (دو نتیجه) / DIRECT_WIN (برد مستقیم),
   each with W/L/V counts, winRate %, noLossRate % mini-bars, settled count, and market-family equivalents subtitle
   (DNB · AH +0.25 · Double Chance · Asian Totals). Unknown shield keys from payload appended defensively. Empty → "بدون داده".

4. **Shadow Ledger Tracker upgrade** (`data-testid="shadow-tracker"`):
   - Summary cards (4): **Shadow Win-Rate Lift headline** (`agentLab.shadow.shadowLiftPct`, AnimatedNumber, "+12.5pp" style,
     neon-cyan, sub line `with-veto/without-veto` rates, "بدون داده" when lab absent), Saved Losses (count + units),
     Missed Wins (count + units), Net Shadow Impact (saved − missed; falls back to `metrics.savedCapital`).
     `shadowFallback` useMemo scans `shadowVetoes` when `agentLab` is absent.
   - Table: signed-units column (SAVED_LOSS → `+Xu` emerald, MISSED_WIN → `-Xu` amber, title tooltips), verdict tags
     SAVED LOSS / MISSED WIN / PENDING / UNKNOWN (emerald/amber/slate), **SHARP DIVERGENCE** cyan tag + subtle cyan row tint
     when reason matches `/sharp|واگرایی/i`, **v3.1 violet badge** on rows with `category === "SHIELD_ENGINE"`.
     Pre-veto pick (marketLabel+selection via `formatStoredMarketLabel`), ftScore, decidedAt kept.

5. **Tier/Shield columns on settled rows**: `TierBadge` + `ShieldBadge` group in each row header
   (`hidden md:flex`, stopPropagation so click doesn't toggle), always rendered inside the expanded detail panel for mobile.

6. **Settled detail expansion**: existing audit rows kept (line, stakes, modelProb, lockedAt, settledAt, EV, legs, full SHA-256 mono
   dir=ltr, verify button, espn link) + new unified FT block: tennis → `s.setResult` (ESPN set scores), football →
   `${s.homeScore}-${s.awayScore}`; plus v3.1 ensemble metadata row: TierBadge, ShieldBadge, `NoLossChip` (noLossProb),
   consensusPct chip, SHARP ALERT red tag when `sharpAlert`.

### CSV/JSON export

Extended: JSON gains `tier`, `shieldType`, `noLossProb`; CSV gains `tier`,`shieldType` columns (header+rows kept in sync);
`setResult` now also emits football `H-A` scoreline.

## Responsive strategy (no horizontal scroll anywhere)

- Settled ledger stays an expandable flex-wrap card list (no table) — badges hidden on mobile via `hidden md:flex`.
- Shield table: `w-full` + responsive column hiding (`باخت`/`ابطال` hidden sm, `تسویه` hidden md).
- Shadow table: rebuilt WITHOUT `min-w-[860px]`; reason column `hidden lg:table-cell`, decidedAt `hidden xl:table-cell`;
  container is `max-h-96 overflow-y-auto scroll-slim` (vertical scroll only, sticky header kept).
- All numbers/dates `dir="ltr"` mono (`num`), Persian RTL labels, p-3/p-4 paddings, gap-2/3/4, `.glass` cards,
  Obsidian palette only (emerald/cyan/violet/gold), no new emojis (existing ones preserved).

## Verification

- `bunx tsc --noEmit` → **zero errors in src/** (only pre-existing examples/ + skills/ errors remain).
- `bunx eslint src/components/views/VerifiedLedgerView.tsx` → **exit 0, clean**. (`bun run lint` full-project still flags the
  pre-existing `src/components/three/HeroQuantum3D.tsx` react-hooks error — not this file's territory.)
- `dev.log`: no compile errors mentioning VerifiedLedgerView; GET /api/bootstrap 200.
  NOTE for orchestrator: dev.log shows a **backend** error in `src/core/agents/v31-migration.ts:52` —
  Prisma `Unknown argument 'tier'` on `db.signal.findMany` (Signal model has no `tier` column yet → `bun run db:push` pending).
  Bootstrap degrades gracefully (API 200), so the ledger renders; tier/shield stats stay "بدون داده" until schema is pushed.

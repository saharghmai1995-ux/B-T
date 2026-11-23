# Task 4-b — Signals Hub (Tab 2) rebuild — SignalsHubView + SignalCard

Agent: 4-b | Scope: Tab 2 (Predictions Hub) v3.1 rebuild | Status: COMPLETE

## Files modified (only the two files I own)

| File | Lines | Change |
|---|---|---|
| `src/components/views/SignalCard.tsx` | 374 | v3.1 rebuild: 4 transparent ensemble indicators, sharp provenance/alert, honest SHIELD EV badge, break-words labels |
| `src/components/views/SignalsHubView.tsx` | 258 | v3.1 rebuild: default kickoff-asc sort with past/missing banding, SHIELD line chip, sort UI, searchQuery integration, md/xl grid |

No other files touched. Props contracts preserved: `SignalCard { s: AppSignal; rank?: number; bookMode?: "ALL"|"1XBET"|"BETFORWARD" }`, SignalsHubView receives `state: AppStatePayload` from AppShell.

## SignalCard — v3.1 changes

### The 4 indicators (DOM structure)
One compact row under the match header: `div.mt-3.flex.flex-wrap.items-center.gap-1.5` (390px-safe, wraps):

1. **No-Loss %** — `span.IndChip` (label "بدون‌باخت" + value). Value = `<NoLossChip value={s.noLossProb} className="text-[11px]"/>` (renders "84.2%"); null → `—` dash span.
2. **Shield type** — `<ShieldBadge shieldType={s.shieldType}/>` (labels برد مستقیم / سپر کامل برگشت / سپر نیمه‌برگشت / سپر دو نتیجه); null → IndChip "سپر" + "—".
3. **Tier** — `<TierBadge tier={s.tier}/>` (TIER_S gold / TIER_A emerald / TIER_B cyan); null → IndChip "تیر" + "—".
4. **Agent Consensus** — IndChip "اجماع" + mono `dir="ltr"` value `{Math.round(s.consensusPct)}% MATCH` (consensusPct is 0–100 scale per orchestrator/migration code); null → "—".

Plus:
- **Sharp provenance**: `s.sharpSource` → tiny mono badge `SHARP PRIOR: THE_ODDS_API` (dir ltr, cyan-500/25 border).
- **Sharp alert**: `s.sharpAlert === true` → red pulsing dot (radix Tooltip trigger) with tooltip "واگرایی شارپ > 16pp — احتمال خبر پنهان".

### Other card changes
- **Official market label**: kept bookMode switch (`formatOfficialBookmakerMarket` onexbet/betforward, `officialBetLine(...)` for ALL) — full market name + full team/player name, no ◆. Removed `truncate` from matchInfo/league/venue/marketPart/selectionPart/ACCA leg labels → `break-words` + `min-w-0` wrapping.
- **Honest EV badge**: `SHIELD` line → Badge always visible: `EV +x.x%` (emerald when ≥0, neutral slate when negative, title explains honesty). Other lines keep the existing `+EV Edge +x.x% EV` badge (shown when evPct > 0).
- Kept: SourceBadge footer (LIVE/ESTIMATE honesty), prob split bar, numbers row, settlement rule, HashChip, espn link, betslip add (store `addToBetslip` with `officialBetLine` label).

## SignalsHubView — v3.1 changes

### Default sort (kickoff asc)
```ts
band(t): future = 0, kicked-off (t <= now) = 1, missing/invalid startTime = 2
sort: band asc → startTime asc within band → evPct desc tiebreak
```
Optional sort chips: "زمان شروع ↑" (default) | "بیشترین EV" (opt-in only, never the default).

### Line chips
`همه خطوط | تک‌شرط +EV تیپ A | میکس ۲ تایی 1.8x–2.25x | شرط سپر سربه‌سر (SHIELD, ShieldCheck icon, label via lineLabel) | آربیتراژ/همپوشانی واقعی` — default filter = all.

### Kept / integrated
- Sport chips bound to global `sportFilter` zustand state (unchanged).
- Book chips `هر دو سایت | 1xBet | BetForward` → CardBookMode (unchanged behavior).
- `searchQuery` from zustand now filters matchInfo/league/home/away (was stored but unused).
- Honesty banners kept (LIVE 1xBet REAL ODDS / MODEL FAIR PRICE, arb note); added SHIELD honesty note when the SHIELD chip is active (explains possibly-negative EV).
- Grid per design language: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` (was lg/2xl).

## Verification
- `bunx tsc --noEmit`: **zero errors in my two files**. Only remaining src error is `src/components/views/lab/CalibrationLab.tsx(126,21)` TS2872 — NOT in my scope (another task's file; pre-existing to my run). `examples/` + `skills/` errors ignored per instructions.
- `bun run lint`: **zero errors** (clean output).
- `dev.log`: `✓ Compiled in 635ms` + `GET / 200` — no compile errors mentioning SignalsHubView/SignalCard.
- agent-browser NOT used (orchestrator does final verification).

## Notes for next agents
- `NoLossChip`, `ShieldBadge`, `TierBadge` in `primitives.tsx` return null on null input — SignalCard wraps them with a dash fallback so all 4 indicator slots are visible on every card.
- `consensusPct` is 0–100 (verified in `v31-migration.ts:42` and orchestrator); `noLossProb` is 0–1 fraction (NoLossChip multiplies by 100).
- SHIELD signals set `modelProb` = winProb and `trueProb` = noLossProb in shield-integration.ts, so the card's split bar shows model win vs no-loss mass — left untouched per contract.

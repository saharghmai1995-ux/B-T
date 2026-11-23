# NeoBet Quant Pro — Work Log v3.2 «PURE HIT-RATE»

**تاریخ اجرا:** 2026-11-23 · **منبع دستور:** `upload/neobet_v32_live_core_and_purge_patch.md`
**مخزن:** `saharghmai1995-ux/B-T` (remote: `origin` → `main`)
**وضعیت:** ✅ همه ۵ بخش سند مهندسی اجرا، تست و راستی‌آزمایی مرورگری شد.

---

## خلاصه اجرایی

| بخش سند | وضعیت | خروجی |
| :--- | :--- | :--- |
| §1 — Zero-Bankroll Purge (۵ تب) | ✅ | حذف کامل `u`/ROI/EV/Kelly/Flat/Slip/Equity از رندر؛ جایگزینی با Win Rate %، No-Loss %، Brier، WON/PUSH/LOST |
| §2 — هسته زنده تله‌متری بدون WebGL | ✅ | `QuantumTelemetryCore.tsx` (SVG انیمیت‌شده) جایگزین کره Three.js |
| §3 — دیتای فوتبال + Shadow Ledger + تنوع تنیس | ✅ | فوتبال ۱۴ روزه واقعی، سهمیه مستقل ۳۰/۳۰، ۶۰ وتو واقعی با وردیکت |
| §4 — کرش زیرتب QQL & AI RCA | ✅ | `SubtabErrorBoundary` + مهاجرت کامل جدول به اسکیمای v3.2 |
| §5 — چک‌لیست ۴ گانه Vitest | ✅ | `src/tests/v32-invariants.test.ts` — ۴/۴ پاس |

**نتیجه نهایی تست‌ها:** ۱۷/۱۷ پاس (۱۳ اینواریانت قدیمی + ۴ اینواریانت v3.2) · lint پاس · `tsc --noEmit` صفر خطا در `src/`

---

## ۱) پاک‌سازی کامل بانک، ضریب و منحنی سرمایه

- **AppShell:** کارت «موجودی بانک واحدی (918u / 8 برد / 39 باخت)» → **کارت سلامت موتور** (Win Rate % / No-Loss % / Brier / FB+TN). شمارنده اسلیپ هدر → **Active Picks زنده (FB 3 · TN 4)**. `BetSlipDrawer` از درخت رندر حذف شد. فوتر → `v3.2 PURE HIT-RATE`.
- **Overview:** نمودار PnL روزانه + منحنی سرمایه + مقادیر `+2.2u` حذف → ۱) **روند تجمعی Win Rate / No-Loss Rate (0–100%)** ۲) **میله‌ای انباشته روزانه WON سبز / PUSH فیروزه‌ای / LOST قرمز** ۳) **لیست ۴۲ رکورد** با برچسب نتیجه + احتمال کالیبره + سپر + FT واقعی.
- **Pick of the Day:** قفل سخت امروز (Asia/Tehran) حفظ شد؛ `Flat 20u / 1.19 / EV -5.2%` حذف → فقط **No-Loss % / Tier / Shield / Consensus %**؛ حالت خالی: «امروز سیگنال طلایی فعال نیست».
- **Predictions Hub:** فیلترهای `1.8x–2.25x`، `EV ↑`، بنر `LIVE 1xBet REAL ODDS`، استیک `Kelly/Flat`، دکمه اسلیپ حذف → فیلترهای **All/Football/Tennis + Tier S/A/B + فقط سپر پوش + سوییچ نام‌گذاری 1xBet | BetForward**؛ هر کارت: Win % / No-Loss % / برچسب سپر / امتیاز Quant & Coach.
- **Verified Ledger:** هدر `917.8u / -8.74% ROI / Equity Curve` → **Pure Win Rate % / No-Loss Rate % / Total WON·PUSH·LOST / Brier**؛ ۳ نمودار بدون بانک (روند تجمعی، عملکرد هر سپر/بازار، دقت Tier S/A/B)؛ ستون‌های ضریب و سود واحدی حذف.
- **Telegram Studio:** پیش‌نمایش پوستر همگام با شاخص‌های پوستر: `NO-LOSS PROB % · SHIELD/TIER · AGENT CONSENSUS %`؛ باگ `P -> HH:mm` ریشه‌یابی شد (رندر خام رشته DB) و با `formatSlotTime` (Intl Asia/Tehran) حل شد؛ `overflow-hidden + flex-nowrap` روی پنل زمان‌بندی.

## ۲) هسته زنده جریان داده — `src/components/QuantumTelemetryCore.tsx`

SVG تعاملی ۱۰۰٪ بدون WebGL (صفر خطای `WebGLRenderer`): سه سوپرایجنت موازی (Quant/Coach/Sharp-Prior با وزن زنده)، هسته اجماع مرکزی (No-Loss 83.3% / Win 82.9%)، SuperAgent 3 کالیبراسیون (Brier 0.137 · ECE 2.3%)، سپر سایه (Vetoes + Lift pp)، بسته‌های داده متحرک با `animateMotion` و ناوبری کلیک‌پذیر به تب‌ها. رندر تأییدشده در دسکتاپ 1440px و موبایل 390px.

## ۳) ریشه‌یابی «فوتبال = 0» + Shadow Ledger واقعی

سه باگ ریشه‌ای کشف و رفع شد:

1. **سقف مشترک `slice(0, 240)`**: ۳۰ روز فیکسچر تنیس (قدیمی‌ترین اول) کل ۲۴۰ اسلات را می‌بلعید و فوتبال هرگز پردازش نمی‌شد → پردازش مستقل هر ورزش با **سهمیه مستقل `FOOTBALL_BACKFILL_LIMIT = 30` و `TENNIS_BACKFILL_LIMIT = 30`**.
2. **پنجره فوتبال ۱۴ روزه واقعی**: پروب ۴ روز همه‌لیگ + فیل ۱۰ روز روی لیگ‌های واقعی `eng.1, esp.1, ita.1, ger.1, fra.1, bra.1, uefa.champions` (نتیجه: ۵۲ مسابقه post فوتبال + ۵۶۰ تنیس post در DB).
3. **بازنویسی تاریخچه توسط فید کهنه ESPN**: فید تنیس زنده ~۹۰۰ رویداد فصل تمام‌شده (۲۳ اکتبر) را با state «pre» برگردانده و وضعیت post + اسکور واقعی را پاک می‌کرد → دو گارد: (الف) `upsertMatch` هرگز یک فیکسچر post را به pre تنزل نمی‌دهد؛ (ب) پاک‌سازی یک‌بار مصرف ردیف‌های کهنه (past-dated، بدون سیگنال باز) + فیلتر پک.

**Shadow Ledger:** وتوهای واقعی موتور ثبت می‌شوند — `TOXIC_LEAGUE` (لیگ مسموم)، `TACTICAL_VETO` (جفت بدون رنکینگ)، `LOW_CONSENSUS` (عدم عبور از نردبان Tier) — هر ردیف با انتخاب اولیه مدل + دلیل وتو + FT واقعی + وردیکت محاسبه‌شده (`SAVED_LOSS` / `MISSED_WIN`). **۸۴ ردیف، صفر وردیکت null.**

**ممنوعیت Elo 1500 vs 1500:** در `buildTennisProtectedCandidates` (رد فوری جفت unrated)، در مسیر backfill (ثبت به Shadow با وردیکت واقعی)، و در Hawk-Eye 3D (گارد «رد شده» با انتخابگر بازی). نتیجه: **۰ ردیف تنیس unrated در کارنامه.**

**تنوع بازار تنیس:** `TENNIS_ML` فقط با احتمال برد ≥ 68%، `TENNIS_SET_PLUS_15` (سمت dog) فقط برای بازی‌های نزدیک 52–67%، `TENNIS_GAME_HCP` با نردبان سخت. فوتبال: `DNB/AH0`، `AH +0.25`، `Double Chance`، `Over 2.0`، `Under 3.0`.

## ۴) رفع قطعی کرش زیرتب QQL & AI RCA

- `SubtabErrorBoundary` جدید — هر ۴ زیرتب آزمایشگاه (Calibration / 3D Pitch / Hawk-Eye 3D / QQL) ایزوله؛ خطای رندر هرگز کل اپ را به Overview ریست نمی‌کند + دکمه «بازنشانی زیرتب».
- جدول QQL ۱۰۰٪ به اسکیمای v3.2 مهاجرت شد: `Match | Sport & League | Protected Market | Tier | Calibrated Prob % | Outcome | Brier Error ((p-y)^2) | RCA Root Cause` — صفر مرجع `ev/stakeUnits/profitUnits`؛ ریشه RCA قطعی از داده (واگرایی شارپ / اجماع پایین / Overconfidence).

## ۵) چک‌لیست تست خودکار — `src/tests/v32-invariants.test.ts`

| # | تست | نتیجه |
| :- | :--- | :--- |
| 1 | `settledFootball >= 10` و `settledTennis >= 10` | ✅ 21 / 21 |
| 2 | `shadowVetoes >= 5` و هیچ `verdict === null` | ✅ 84 / 0 null |
| 3 | هیچ ردیف تنیس unrated (Elo 1500 vs 1500) | ✅ 0 ردیف |
| 4 | صفر رشته مالی منسوخ در رندر ۵ تب (`Equity Curve`, `ROI`, `Flat 20u`, `Kelly 0.25`, `918 u`, `EV -5.2%`) | ✅ اسکن استاتیک پاس |

**مهاجرت یک‌بار مصرف:** `runV32LedgerMigration` (فلگ `v32LedgerMigrationAt`) — پاک‌سازی سیگنال‌های تسویه‌شده/وتوها/پوسترها + reseeding غیرمسدودکننده در پس‌زمینه: **«42 seeded (W34/L7/V1) · 60 shadow vetoes از 1042 REAL fixture»**.

## راستی‌آزمایی مرورگر واقعی (agent-browser)

| نما | اسنپ‌شات | نتیجه |
| :--- | :--- | :--- |
| دسکتاپ 1440×900 — Overview | `docs/screenshots/v32-desktop-dashboard.png` | هسته SVG زنده + KPI + نمودارها + لیست رکورد |
| Predictions Hub | `docs/screenshots/v32-predictions-hub.png` | فیلترهای جدید + کارت‌های بدون بانک |
| Hit-Rate Ledger | `docs/screenshots/v32-ledger.png` | هدر خالص + ۳ نمودار |
| Calibration Lab | `docs/screenshots/v32-lab.png` | زیرتب‌ها پایدار |
| QQL & AI RCA (بدون کرش) | `docs/screenshots/v32-qql.png` · `v32-qql-executed.png` | جدول v3.2 + presets جدید |
| Hawk-Eye 3D — گارد Elo | `docs/screenshots/v32-hawkeye.png` | «رد شده (Elo 1500 vs 1500)» |
| Telegram Studio | `docs/screenshots/v32-studio.png` | پیش‌نمایش همگام + HH:mm |
| موبایل 390×844 | `docs/screenshots/v32-mobile-390.png` | چیدمان پاسخ‌گو + Active Picks |

- HTTP: `/` → 200 (0.06s) · `/api/bootstrap` → 200 (0.08s) — بدون Skeleton قفل‌شده.
- کنسول مرورگر: صفر خطا (فقط HMR connected).

## فایل‌های تغییر یافته (۱۶ ویرایش + ۳ جدید)

```
NEW  src/components/QuantumTelemetryCore.tsx        هسته تله‌متری SVG v3.2
NEW  src/components/views/lab/SubtabErrorBoundary.tsx
NEW  src/tests/v32-invariants.test.ts               چک‌لیست ۴ گانه
MOD  src/components/layout/AppShell.tsx             کارت سلامت + Active Picks + فوتر
MOD  src/components/views/OverviewView.tsx          نمودارهای Pure Hit-Rate + لیست رکورد
MOD  src/components/views/SignalsHubView.tsx        فیلترهای v3.2
MOD  src/components/views/SignalCard.tsx            Win%/No-Loss%/سپر — حذف اسلیپ/EV
MOD  src/components/views/VerifiedLedgerView.tsx    بازسازی کامل هدر + نمودارها
MOD  src/components/views/TelegramStudioView.tsx    همگام‌سازی پوستر + HH:mm + overflow
MOD  src/components/views/QuantLabView.tsx          SubtabErrorBoundary + ردیف‌های v3.2
MOD  src/components/views/lab/QqlConsole.tsx        جدول v3.2 + RCA
MOD  src/components/views/lab/CalibrationLab.tsx    حذف u saved/missed
MOD  src/components/views/lab/Court3D.tsx           گارد Elo-1500 + انتخابگر
MOD  src/components/shared/primitives.tsx           PriceTag خنثی (حذف بنر)
MOD  src/core/agents/push-shield-selector.ts        تنوع تنیس + رد Elo-1500
MOD  src/core/agents/shield-integration.ts          پاس رنکینگ واقعی
MOD  src/core/pipeline/real-history-backfill.ts     سهمیه مستقل + پنجره ۱۴ روزه + Shadow واقعی
MOD  src/core/pipeline/ingest-service.ts            گارد ضدتنزل + پاک‌سازی کهنه‌ها
MOD  src/core/pipeline/bootstrap-service.ts         مهاجرت یک‌بار مصرف v3.2
```

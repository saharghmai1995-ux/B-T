# NeoBet Quant Pro — Work Log v3.3 «CINEMATIC QUANTUM + NBA ENGINE»

**تاریخ اجرا:** 2026-11-23 · **منبع دستور:** `upload/neobet_v33_cinematic_3d_nba_upgrade.md`
**مخزن:** `saharghmai1995-ux/B-T` (remote: `origin` → `main`)
**وضعیت:** ✅ هر ۴ بخش سند مهندسی اجرا، مهاجرت یک‌بار مصرف، و راستی‌آزمایی مرورگری شد.

---

## خلاصه اجرایی

| بخش سند | وضعیت | خروجی |
| :--- | :--- | :--- |
| §1 — هسته سه‌بعدی سینمایی واکنش‌گرا | ✅ | `CinematicQuantumCore3D.tsx` — پارالاکس موس/تاچ با `perspective: 1200px` + `preserve-3d`، رینگ‌های هولوگرافیک چرخان، جریان فوتون‌های نئون SVG، تغذیه رنگ/ضربان از `noLossRatePct` واقعی؛ جایگزین کامل `QuantumTelemetryCore` |
| §2 — Strict Pre-Match Gate | ✅ | `active-picks-service.ts` — `isStrictlyUpcoming` (kickoff > now + 5min) + `sweepStaleOpenPicks` (>4h → `PENDING_SETTLEMENT`) + گیت دوگانه Pick of the Day (`isSameTehranDay` && `isStrictlyUpcoming`) |
| §3 — کالیبراسیون وتوها | ✅ | وتوی اختلاف سوپرایجنت‌ها **0.15 → 0.22** در `orchestrator.ts` · گیت سخت لیگ (≥۱۲ بازی تسویه‌شده و وین‌ریت < 62%) در `computeAutoVetoLeagues` + اجرای پویا در ingest · حذف کامل `@ 2.86` از Shadow Ledger → `CAL PROB %` · فیکس برش `HH:mm` با گرید `grid-cols-[auto_1fr_auto]` |
| §4 — موتور سوم NBA | ✅ | `engines/nba/nba-selector.ts` (normal-CDF، σ=11.8، سقف سپر 72%) + فید بدون‌کلید ESPN (scoreboard + standings v2) + بک‌فیل **25/25/25** + مسیر لایو کامل + تسویه NBA + کارت/فیلتر/پوستر 🏀 |

**نتیجه نهایی تست‌ها:** 17/17 پاس · lint پاس · `tsc --noEmit` صفر خطا در `src/`

---

## ۱) هسته زنده سه‌بعدی سینمایی — `src/components/CinematicQuantumCore3D.tsx`

- **تعامل ۳بعدی واقعی:** چرخش صحنه با حرکت اشاره‌گر (`rotateX/rotateY` ±14°/±16°) روی کارت با `perspective: 1200px` و `transform-style: preserve-3d`؛ بازگشت نرم با `transition-transform duration-200`؛ لایه‌های شیشه‌ای در عمق Z (+26px ماهواره‌ها، +52px هسته، −20px جریان‌ها).
- **تغذیه از داده واقعی:** `coreHex` سبز (≥80%) / فیروزه‌ای (≥68%) / کهربایی از `noLossRatePct` زنده؛ شمارنده‌های `LIVE SCAN (⚽ · 🎾 · 🏀)` و `ACTIVE PRE-MATCH` از سیگنال‌های واقعی DB.
- **ایمنی صفر-Crash:** بدون WebGL (CSS 3D + SVG animate/animateMotion) — هیچ‌گاه `WebGLRenderer` خطا نمی‌دهد؛ رندر تأییدشده 60fps در دسکتاپ 1440 و موبایل 390.
- **ناوبری کلیک‌پذیر:** QUANT/COACH → Predictions Hub، CALIBRATOR → Calibration Lab، SHADOW VETO SHIELD → Hit-Rate Ledger.

## ۲) گیت سخت پیش‌ازبازی — `src/core/pipeline/active-picks-service.ts`

- `isStrictlyUpcoming(kickoffAt)`: فقط بازی‌هایی که شروعشان **بیش از ۵ دقیقه در آینده** است پیک فعال حساب می‌شوند (اشتراک client-safe در `lib/format` + re-export سرویس).
- `sweepStaleOpenPicks()`: پیک‌های OPEN با kickoff قدیمی‌تر از ۴ ساعت → `PENDING_SETTLEMENT` (یک bulk update؛ حلقه تسویه ingest این صف را هم می‌پوشاند).
- اتصال به `bootstrapState`: sweep قبل از snapshot وضعیت → داشبورد هرگز کارت تاریخ‌گذشته سرو نمی‌کند.
- **Pick of the Day:** گیت دوگانه سخت — `isSameTehranDay(startTime) && isStrictlyUpcoming(startTime)`؛ کارت خالی شفاف وقتی بازی پیش‌روی امروز نیست (هرگز بازی دیروز یا ۴ روز بعد).
- `SignalsHubView` فیلتر strict را سمت کلاینت هم اعمال می‌کند (کمربند+بند بالای sweep سرور).

## ۳) کالیبراسیون قوانین وتو — مسیر Lift مثبت

1. **آستانه اختلاف سوپرایجنت‌ها 0.15 → 0.22:** شرط وتوی Quant-vs-Coach در `runEnsemble` فقط وقتی `|pQ − pC| > 22pp` فعال می‌شود (ممیزی v3.2: −6.9pp لیف با وتوهای تهاجمی — 31 missed win در برابر 20 saved loss).
2. **گیت حداقلی لیگ (Calibration Scientist):** `computeAutoVetoLeagues` — هیچ لیگی وارد `autoVetoLeagues` نمی‌شود مگر با **حداقل ۱۲ بازی تسویه‌شده و وین‌ریت زیر 62%**؛ در هر run لایو اعمال می‌شود (skip صدور + یک ردیف سایه idempotent با کتگوری `AUTO_LEAGUE` و آمار واقعی).
3. **حذف `@ 2.86 / @ 2.81 / @ 2.90` از Shadow Ledger:** ستون ضریب حذف و `CAL PROB %` (احتمال کالیبره مدل) + Veto Reason + FT Score + تگ `SAVED LOSS / MISSED WIN` نمایش داده می‌شود. راستی‌آزمایی مرورگر: `@ 2.` صفر رخداد در DOM.
4. **فیکس برش `HH:mm` در Telegram Studio:** کانتینر فرم اسلات → `grid grid-cols-[auto_1fr_auto] items-center gap-1.5 min-w-0` (عنوان col-span-3؛ فیلد ساعت در ستون auto با عرض کامل — بدون برش روی لبه کارت؛ تأیید DOM: width=158px، NO-CLIP).

## ۴) موتور سوم NBA — `src/engines/nba/nba-selector.ts` + فید ESPN

- **سیلکتور verbatim سند:** expected margin از اختلاف NetRtg + مزیت میزان 2.4 + جریمه B2B 2.1 + جریمه مصدومیت ستاره 3.2 (بدون فید مصدومان رایگان → همیشه false، صفر ساختگی)؛ توزیع نرمال CDF با σ=11.8؛ دو کاندید `NBA_ML_*` (DIRECT_WIN) و `NBA_ALT_+4.5_*` (DOUBLE_OUTCOME_SHIELD) با کف سپر 72%.
- **فید ۱۰۰٪ رایگان بدون کلید — `nba-feed.ts`:** scoreboard روزانه (`site.api.espn.com/.../nba/scoreboard?dates=YYYYMMDD`) + standings v2 (آمار REAL `differential` به‌عنوان NetRtg-per-game) + نقشه آخرین بازی تیم‌ها برای B2B/rest؛ همه fetch ها سقف 5 ثانیه (الگوی v2.7.2).
- **بک‌فیل مستقل 25/25/25:** `FOOTBALL=25 (۱۴روز) + TENNIS=25 (۳۰روز) + NBA=25 (۱۴روز)`؛ فرم درون-پنجره‌ای (تفاضل امتیاز per-game از بازی‌های قبلیِ همان پنجره — بدون look-ahead)؛ جفت unrated → وتوی `TACTICAL_VETO` با would-have-been واقعی و وردیکت واقعی.
- **مسیر لایو کامل:** `gatherFeed` پک NBA (pre امروز+فردا) → شاخه basketball در `generateSignals` → `generateShieldForFixture` با QuantView مستقیم از `nbaWinProbabilities` → سیگنال SHIELD / وتوی سایه همان قرارداد فوتبال/تنیس.
- **تسویه:** `resolveBasketball` در settlement-engine — ML (برد سخت، OT در اسکور نهایی) و +4.5 alt spread (پوشش با باخت ≤4).
- **UI:** پیل `🏀 NBA` در هدر و Predictions Hub · کارت آماری سوم NBA در Overview (W/P/L + وین‌ریت) · چیپ و گلیف 🏀 در Verified Ledger · آیکون توپ بسکتبال نارنجی Canvas در پوستر 1080×1350 (تأیید بصری بین لوگوی Nuggets/Mavericks).

## مهاجرت یک‌بار مصرف v3.3

`runV33LedgerMigration` (فلگ `v33LedgerMigrationAt`) — پاک‌سازی لجر تسویه‌شده + وتوها + پوسترها، مهر فوری فلگ (ادامه الگوی ضد-تکرار v2.7.2)، reseed پس‌زمینه‌ای single-flight:

```
RESEED: 1145 REAL fixtures (FB 14d + TN 30d + NBA 14d)
signalsSeeded: 51 (W33 / L16 / V2) · vetoes: 60 · posters: 10
NBA: 29 سیگنال (12 OPEN پیش‌ازبازی + 17 تسویه‌شده با FT واقعی)
null verdicts: 0
```

## راستی‌آزمایی مرورگر واقعی (agent-browser)

| نما | اسنپ‌شات | نتیجه |
| :--- | :--- | :--- |
| دسکتاپ 1440×900 — Overview | `docs/screenshots/v33-desktop-dashboard.png` · `v33-desktop-final.png` | هسته ۳بعدی + ۳ کارت ورزشی + Pick of the Day TIER S |
| فیلتر NBA هدر | `v33-nba-filter.png` | ردیف‌های NBA با FT واقعی (107-137، 118-114، …) |
| Predictions Hub | `v33-predictions-hub.png` · `v33-hub-nba.png` | ۱۲ کارت NBA فعال TIER S + سپر +4.5 + SHA-256 |
| Hit-Rate Ledger | `v33-ledger.png` | CAL PROB جایگزین @odds · نمودار «NBA Alt Spread +4.5» |
| Telegram Studio | `v33-studio-form.png` · `v33-poster-preview.png` | فرم NO-CLIP · پوستر NBA با توپ 🏀 |
| Calibration Lab | `v33-lab.png` | زیرتب‌ها پایدار |
| موبایل 390×844 | `v33-mobile-390.png` | چیدمان تک‌ستونه هسته ۳بعدی |

- HTTP: `/` → 200 · `/api/bootstrap` → 200 (0.06s) — بدون Skeleton قفل‌شده.
- کنسول مرورگر: صفر خطا · صفر page error در دسکتاپ و موبایل.

## فایل‌های تغییر یافته

```
NEW  src/components/CinematicQuantumCore3D.tsx     هسته سه‌بعدی سینمایی v3.3
NEW  src/engines/nba/nba-selector.ts               موتور سوم NBA (verbatim سند)
NEW  src/core/bookmakers/nba-feed.ts               فید ESPN NBA (scoreboard+standings)
NEW  src/core/pipeline/active-picks-service.ts     گیت Strict Pre-Match + sweep
DEL  src/components/QuantumTelemetryCore.tsx       جایگزین‌شده با هسته سینمایی
MOD  src/components/views/OverviewView.tsx         سواپ هسته + کارت NBA + گیت POTD
MOD  src/components/views/SignalsHubView.tsx       فیلتر strict + پیل NBA
MOD  src/components/views/SignalCard.tsx           گلیف 🏀
MOD  src/components/views/VerifiedLedgerView.tsx   CAL PROB + چیپ NBA
MOD  src/components/views/TelegramStudioView.tsx   گرید فرم + توپ بسکتبال پوستر
MOD  src/components/layout/AppShell.tsx            پیل NBA + شمارنده سه‌ورزشی
MOD  src/components/shared/primitives.tsx          SportIcon 🏀
MOD  src/lib/store.ts · api-types.ts · format.ts   Sport union + isStrictlyUpcoming
MOD  src/core/agents/orchestrator.ts               وتوی اختلاف 22pp
MOD  src/core/agents/calibration.ts                computeAutoVetoLeagues (12/<62%)
MOD  src/core/agents/shield-integration.ts         شاخه NBA + استخراج persistShieldVerdict
MOD  src/core/bookmakers/nba-feed.ts (+feed-gatherer) پک NBA لایو + ویژگی‌ها
MOD  src/core/pipeline/ingest-service.ts           تسویه PENDING + NBA لایو + گیت لیگ
MOD  src/core/pipeline/bootstrap-service.ts        sweep + مهاجرت v3.3
MOD  src/core/pipeline/real-history-backfill.ts    سهمیه 25/25/25 + شاخه NBA
MOD  src/core/ledger/settlement-engine.ts          resolveBasketball
MOD  src/core/math/devig.ts                        BOOK_MARGIN.basketball
MOD  src/tests/invariants.test.ts                  ادعای bankroll مستقل از وضعیت DB
```

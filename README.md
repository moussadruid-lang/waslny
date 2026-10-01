# مشاوير — نوصلها لك 🛵

منصة توصيل متعددة الأطراف لجمهورية مصر العربية: عميل، مندوب، تشغيل، إدارة، وشركات/تجار.
العملة: **جنيه مصري (EGP)** · اللغة: **العربية (RTL)** · المنطقة الزمنية: **Africa/Cairo**

## الحالة الحالية

| الجزء | الحالة |
|---|---|
| محرك الدومين (تسعير، حالات الطلب، توزيع، عمولة، تحسين مسار) | ✅ + 16 اختبار ناجح |
| قاعدة البيانات (PostgreSQL / Prisma) — 45+ كيان | ✅ |
| Auth بالـ OTP + Refresh rotation + RBAC (8 أدوار) | ✅ |
| دورة الطلب الكاملة + Timeline + Optimistic locking + قبول ذري | ✅ + اختبار تزامن |
| توزيع بموجات، تتبع لحظي، إثبات تسليم، فشل/إرجاع، محافظ وعمولات، كوبونات، دعم، Admin/Business API | ✅ |
| رفع الصور (تحقق من النوع الحقيقي، تخزين قابل للتبديل) | ✅ المرحلة 2 |
| **تطبيق العميل** (Expo / React Native) | ✅ المرحلة 2 — راجع [`docs/MOBILE.md`](docs/MOBILE.md) |
| **تطبيق المندوب** (GPS في الخلفية + Offline queue + إثبات تسليم بالتوقيع) | ✅ المرحلة 2 |
| لوحة الإدارة + Live Ops + لوحة الشركات + صفحة التتبع العامة (Next.js) | ⏳ المرحلة 3 |
| بوابات دفع مصرية (Paymob / Fawry / محافظ) + إخفاء الأرقام | ⏳ المرحلة 4 (الـ architecture جاهزة) |

## التشغيل محليًا
```bash
docker compose up -d postgres redis
cp .env.example apps/api/.env      # عدّل القيم
npm install
cd apps/api && npx prisma db push && npm run db:seed && cd ../..
npm run dev        # API على :4000
npm run worker     # الـ background jobs (توزيع، إشعارات، SMS، webhooks، bulk)

# التطبيقات (dev build على أندرويد)
npx expo install --fix --cwd apps/mobile-customer && npx expo run:android --cwd apps/mobile-customer
npx expo install --fix --cwd apps/mobile-driver   && npx expo run:android --cwd apps/mobile-driver
```

## الاختبارات
```bash
npm run test:domain                         # منطق التسعير/الحالات/التوزيع — بدون DB
docker compose up -d postgres_test redis
DATABASE_URL=postgresql://mashawir:mashawir@localhost:5433/mashawir_test npm test -w @mashawir/api
npm run typecheck:mobile                    # TypeScript للتطبيقين
```
اختبار السيناريو الكامل `apps/api/test/e2e.lifecycle.test.ts`: عميل من **دمرو** يرسل طرد إلى **سيدي سالم** → تسعير → طلب → توزيع → قبول متزامن (واحد بس يكسب) → تتبع → استلام → OTP → دفع → عمولة → محفظة → تقييم → Admin → تقارير.
قائمة اختبار الأجهزة (Safe Area / RTL / Offline / GPS في الخلفية) في [`docs/MOBILE.md`](docs/MOBILE.md).

لتفعيل CI على GitHub: انقل `docs/ci.yml` إلى `.github/workflows/ci.yml`.

> ⚠️ إحداثيات دمرو/سيدي سالم/الحدادي في الـ seed **تقريبية** — راجعها من لوحة الإدارة قبل الإطلاق.

انظر [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) للتفاصيل والخطة الكاملة.

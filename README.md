# مشاوير — نوصلها لك 🛵

منصة توصيل متعددة الأطراف لجمهورية مصر العربية: عميل، مندوب، تشغيل، إدارة، وشركات/تجار.
العملة: **جنيه مصري (EGP)** · اللغة: **العربية (RTL)** · المنطقة الزمنية: **Africa/Cairo**

## الحالة الحالية — المرحلة 1 ✅ (Backend + محرك التشغيل)

| الجزء | الحالة |
|---|---|
| محرك الدومين (تسعير، حالات الطلب، توزيع، عمولة، تحسين مسار) | ✅ + 16 اختبار ناجح |
| قاعدة البيانات (PostgreSQL / Prisma) — 45+ كيان | ✅ |
| Auth بالـ OTP + Refresh rotation + RBAC (8 أدوار) | ✅ |
| دورة الطلب الكاملة + Timeline + Optimistic locking | ✅ |
| قبول ذري للطلب (مندوب واحد فقط يكسب) | ✅ + اختبار تزامن |
| توزيع على موجات بنطاق متوسع (BullMQ) | ✅ |
| تتبع لحظي (Socket.IO + Redis adapter) + رابط تتبع عام بدون بيانات حساسة | ✅ |
| إثبات التسليم (OTP / صورة / توقيع / اسم / GPS) حسب الإعدادات | ✅ |
| فشل التسليم + إرجاع + رسوم إرجاع | ✅ |
| محافظ (عميل/مندوب/منصة/شركة) + دفتر قيود + COD + تسويات | ✅ |
| كوبونات، إحالة، تقييمات، دعم فني، محادثة داخل الطلب | ✅ |
| لوحة إدارة API: طلبات، مندوبين، عملاء، مناطق، أسعار، إعدادات، Live Ops، تقارير، Audit | ✅ |
| Business: رفع Bulk، كشف حساب، API Keys، Webhooks موقعة HMAC | ✅ |
| تطبيق العميل + المندوب (Expo / React Native) | ⏳ المرحلة 2 |
| لوحة الإدارة + لوحة الشركات (Next.js) | ⏳ المرحلة 3 |
| بوابات دفع مصرية (Paymob / Fawry / محافظ) | ⏳ المرحلة 4 (الـ architecture جاهزة) |

## التشغيل محليًا
```bash
docker compose up -d postgres redis
cp .env.example apps/api/.env      # عدّل القيم
npm install
cd apps/api && npx prisma db push && npm run db:seed && cd ../..
npm run dev        # API على :4000
npm run worker     # الـ background jobs (توزيع، إشعارات، SMS، webhooks، bulk)
```

## الاختبارات
```bash
npm run test:domain                         # منطق التسعير/الحالات/التوزيع — بدون DB
docker compose up -d postgres_test redis
DATABASE_URL=postgresql://mashawir:mashawir@localhost:5433/mashawir_test npm test -w @mashawir/api
```
اختبار السيناريو الكامل `apps/api/test/e2e.lifecycle.test.ts`: عميل من **دمرو** يرسل طرد إلى **سيدي سالم** → تسعير → طلب → توزيع → قبول متزامن (واحد بس يكسب) → تتبع → استلام → OTP → دفع → عمولة → محفظة → تقييم → Admin → تقارير.

لتفعيل CI على GitHub: انقل `docs/ci.yml` إلى `.github/workflows/ci.yml`.

> ⚠️ إحداثيات دمرو/سيدي سالم/الحدادي في الـ seed **تقريبية** — راجعها من لوحة الإدارة قبل الإطلاق.

انظر [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) للتفاصيل والخطة الكاملة.

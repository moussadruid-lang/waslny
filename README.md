# مشاوير — نوصلها لك 🛵

منصة توصيل متعددة الأطراف لجمهورية مصر العربية: عميل، مندوب، تشغيل، إدارة، وشركات/تجار.
العملة: **جنيه مصري (EGP)** · اللغة: **العربية (RTL)** · المنطقة الزمنية: **Africa/Cairo**

## الحالة الحالية

| الجزء | الحالة |
|---|---|
| محرك الدومين والتسعير والحالات والتوزيع والعمولة | ✅ |
| API/Auth/RBAC/PostgreSQL/Redis/Socket.IO | ✅ |
| تطبيق العميل والمندوب (Expo) | ✅ المرحلة 2 |
| **Admin + Live Ops + Business + Public Tracking (Next.js)** | ✅ المرحلة 3 على `feat/phase-3-admin-ops` |
| بوابات الدفع المصرية | ⏳ المرحلة 4 |

## تشغيل المرحلة الثالثة
```bash
docker compose up -d postgres redis
cp .env.example apps/api/.env
npm install
cd apps/api && npx prisma db push && npm run db:seed && cd ../..
npm run dev
npm run worker
npm run dashboard
```

راجع [`docs/DASHBOARD.md`](docs/DASHBOARD.md) لتفاصيل BFF والتشغيل. قبل الإنتاج: ولّد baseline migration بدل الاعتماد على `prisma db push`، واضبط CORS والـ secrets وخرائط الإنتاج.

## الاختبارات
```bash
npm run test:domain
DATABASE_URL=postgresql://mashawir:mashawir@localhost:5433/mashawir_test npm test -w @mashawir/api
npm run typecheck:dashboard
```

**مهم:** لم تُشغّل npm install أو tsc أو lint أو build أو اختبارات E2E في بيئة التنفيذ الحالية، فلا يوجد ادعاء بأنها نجحت.

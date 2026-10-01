# لوحة المرحلة الثالثة

لوحة Next.js 14 RTL على `apps/dashboard`، تستخدم BFF cookies httpOnly (`msh_at`/`msh_rt`) وتوكّل طلبات `/api/v1/*` إلى الـ API. لوحة التشغيل تعرض البيانات من `/v1/admin/live`، والبيانات المالية والتقارير من SQL في الخادم، وصفحة التتبع لا تعرض أي PII.

```bash
npm install
npm run dev -w @mashawir/dashboard
```

ضع `NEXT_PUBLIC_API_URL` و `NEXT_PUBLIC_MAP_TILE_URL`، وأضف أصل اللوحة إلى `CORS_ORIGINS`. الاختبارات والبناء لم تُشغّل هنا لأن بيئة التنفيذ لا تحتوي npm أو الحزم.

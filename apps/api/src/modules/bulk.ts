import { z } from 'zod';
import type { GeoUnit } from '@prisma/client';
import { prisma } from '../lib/db.ts';
import { createOrder } from './orders.service.ts';
import { EgPhone } from './auth.ts';
import { loadActiveUnits, normAr, resolvePoint } from './geo.ts';

export const BULK_MAX_ROWS = 2000;

const blank = (v: unknown) => (v === '' || v === null || (typeof v === 'string' && !v.trim()) ? undefined : typeof v === 'string' ? v.trim() : v);
const optStr = (max: number) => z.preprocess((v) => blank(typeof v === 'number' ? String(v) : v), z.string().max(max).optional());
const optNum = z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(String(b).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.')); }, z.number().finite().optional());
/** Excel turns 01012345678 into the number 1012345678: put the leading zero back, accept Arabic digits. */
const phone = z.preprocess((v) => {
  let s = String(blank(v) ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s-]/g, '');
  if (/^1\d{9}$/.test(s)) s = '0' + s;
  return s;
}, EgPhone);

/** One spreadsheet row after header mapping (client maps Arabic/English headers to these keys). */
export const BulkRow = z.object({
  recipientName: z.preprocess(blank, z.string({ required_error: 'اسم المستلم مطلوب' }).min(2, 'اسم المستلم قصير').max(80)),
  recipientPhone: phone,
  address: z.preprocess(blank, z.string({ required_error: 'العنوان مطلوب' }).min(3, 'العنوان قصير').max(300)),
  governorate: optStr(60), city: optStr(60), district: optStr(80),
  lat: optNum, lng: optNum,
  packageSizeCode: z.preprocess((v) => (blank(v) as string | undefined)?.toUpperCase(), z.string().default('SMALL')),
  categoryCode: z.preprocess((v) => (blank(v) as string | undefined)?.toUpperCase(), z.string().default('OTHER')),
  vehicleTypeCode: z.preprocess((v) => (blank(v) as string | undefined)?.toUpperCase(), z.string().default('MOTORCYCLE')),
  weightKg: z.preprocess((v) => blank(v) ?? 1, z.coerce.number().positive('الوزن غير صالح').max(2000)),
  codAmountEgp: z.preprocess((v) => blank(v) ?? 0, z.coerce.number().min(0, 'مبلغ التحصيل غير صالح').max(1_000_000)),
  notes: optStr(500),
  branchId: optStr(40),
}).refine((r) => (r.lat == null) === (r.lng == null), { message: 'أدخل خط العرض والطول معًا', path: ['lat'] });
export type BulkRow = z.infer<typeof BulkRow>;

export interface ValidatedRow { row: number; ok: boolean; errors: string[]; area?: string; approximate?: boolean; data?: BulkRow & { lat: number; lng: number; branchId: string } }

const ZOD_FIELD_AR: Record<string, string> = { recipientName: 'اسم المستلم', recipientPhone: 'رقم الموبايل', address: 'العنوان', weightKg: 'الوزن', codAmountEgp: 'مبلغ التحصيل', lat: 'الإحداثيات', lng: 'الإحداثيات' };

/** Finds a geo unit by Arabic/English name among `pool` (normalized, tashkeel/hamza-insensitive). */
function byName(pool: GeoUnit[], name: string) {
  const n = normAr(name);
  return pool.find((u) => normAr(u.nameAr) === n || (u.nameEn && u.nameEn.trim().toLowerCase() === name.trim().toLowerCase()));
}

/**
 * Server-side dry run used by both the preview screen and the worker, so what the merchant previews is exactly
 * what gets created. Checks: schema, phone, branch ownership, catalog (size/category/vehicle + capacity),
 * and serviceability (GPS point or governorate→city→district names resolved against admin-defined areas).
 */
export async function validateBulkRows(businessId: string, rows: unknown[]): Promise<ValidatedRow[]> {
  const [branches, units, sizes, cats, vehicles] = await Promise.all([
    prisma.businessBranch.findMany({ where: { businessId } }),
    loadActiveUnits(),
    prisma.packageSize.findMany({ where: { active: true } }),
    prisma.packageCategory.findMany({ where: { active: true } }),
    prisma.vehicleType.findMany({ where: { active: true } }),
  ]);
  const out: ValidatedRow[] = [];
  for (const [idx, raw] of rows.entries()) {
    const row = idx + 2; // header is row 1 in the sheet
    const p = BulkRow.safeParse(raw);
    if (!p.success) {
      const f = p.error.flatten();
      out.push({ row, ok: false, errors: [...f.formErrors, ...Object.entries(f.fieldErrors).map(([k, v]) => `${ZOD_FIELD_AR[k] ?? k}: ${(v ?? []).join('، ')}`)] });
      continue;
    }
    const r = p.data; const errors: string[] = [];
    const branch = r.branchId ? branches.find((b) => b.id === r.branchId) : branches[0];
    if (!branch) errors.push(r.branchId ? 'الفرع غير موجود لدى الشركة' : 'أضف فرعًا للشركة أولًا كنقطة استلام');
    const size = sizes.find((s) => s.code === r.packageSizeCode);
    const vt = vehicles.find((v) => v.code === r.vehicleTypeCode);
    if (!size) errors.push(`حجم الشحنة غير معروف: ${r.packageSizeCode}`);
    if (!cats.some((c) => c.code === r.categoryCode)) errors.push(`نوع الشحنة غير معروف: ${r.categoryCode}`);
    if (!vt) errors.push(`نوع المركبة غير متاح: ${r.vehicleTypeCode}`);
    if (size && vt && (!vt.allowedSizes.includes(size.code) || r.weightKg > vt.maxKg || r.weightKg > size.maxKg)) errors.push('الوزن/الحجم لا يناسب المركبة');

    let point: { lat: number; lng: number } | null = r.lat != null ? { lat: r.lat, lng: r.lng! } : null;
    let approximate = false;
    if (point && (point.lat < 21 || point.lat > 32 || point.lng < 24 || point.lng > 37)) { errors.push('الإحداثيات خارج مصر'); point = null; }
    if (!point && r.lat == null) {
      if (!r.governorate || !r.city) errors.push('أدخل الإحداثيات أو المحافظة والمدينة');
      else {
        const gov = byName(units.filter((u) => u.level === 'GOVERNORATE'), r.governorate);
        const city = gov && byName(units.filter((u) => u.parentId === gov.id), r.city);
        const district = city && r.district ? byName(units.filter((u) => u.parentId === city.id), r.district) : undefined;
        const target = district ?? city;
        if (!gov) errors.push(`محافظة غير مخدومة: ${r.governorate}`);
        else if (!city) errors.push(`مدينة غير مخدومة: ${r.city}`);
        else if (r.district && !district) errors.push(`منطقة غير مخدومة: ${r.district}`);
        else if (target?.centerLat == null) errors.push('لا توجد إحداثيات مركزية لهذه المنطقة، أدخل الإحداثيات');
        else { point = { lat: target.centerLat, lng: target.centerLng! }; approximate = true; }
      }
    }
    let area: string | undefined;
    if (point) {
      const g = await resolvePoint(point, units);
      if (!g) errors.push('العنوان خارج نطاق الخدمة');
      else area = g.label;
    }
    out.push(errors.length || !point || !branch
      ? { row, ok: false, errors, area }
      : { row, ok: true, errors: [], area, approximate, data: { ...r, lat: point.lat, lng: point.lng, branchId: branch.id } });
  }
  return out;
}

/** Worker: revalidates (data may have changed since preview), then creates orders one by one with live progress. */
export async function processBulkUpload(uploadId: string, rows: unknown[], userId: string, businessId: string) {
  const up = await prisma.bulkUpload.findUnique({ where: { id: uploadId } });
  if (!up || up.status === 'DONE' || up.status === 'FAILED') return; // job replay safety
  await prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'PROCESSING', totalRows: rows.length } });
  try {
    const checked = await validateBulkRows(businessId, rows);
    const branches = await prisma.businessBranch.findMany({ where: { businessId } });
    const errors: { row: number; error: string }[] = checked.filter((c) => !c.ok).map((c) => ({ row: c.row, error: c.errors.join(' | ') }));
    const created: { row: number; orderId: string; code: string }[] = [];
    let ok = 0; let n = 0;
    for (const c of checked) {
      if (!c.ok || !c.data) continue;
      const d = c.data; const branch = branches.find((b) => b.id === d.branchId)!;
      try {
        const r = await createOrder({ customerId: userId, businessId, actor: { type: 'BUSINESS', id: userId },
          pickup: { lat: branch.lat, lng: branch.lng, formatted: branch.address ?? branch.name },
          dropoffs: [{ lat: d.lat, lng: d.lng, formatted: [d.address, d.district, d.city, d.governorate].filter(Boolean).join('، '), contactName: d.recipientName, contactPhone: d.recipientPhone, instructions: d.notes }],
          vehicleTypeCode: d.vehicleTypeCode, packageSizeCode: d.packageSizeCode, categoryCode: d.categoryCode, weightKg: d.weightKg,
          urgent: false, paymentMethod: 'CASH', codAmount: Math.round(d.codAmountEgp * 100), notes: d.notes });
        ok++; created.push({ row: c.row, orderId: r.order.id, code: r.order.code });
      } catch (e: any) { errors.push({ row: c.row, error: e?.messageAr ?? 'تعذر إنشاء الطلب' }); }
      if (++n % 10 === 0) await prisma.bulkUpload.update({ where: { id: uploadId }, data: { okRows: ok, errors: errors as any } });
    }
    errors.sort((a, b) => a.row - b.row);
    await prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'DONE', okRows: ok, errors: errors as any, fileUrl: up.fileUrl, finishedAt: new Date() } });
    return { ok, created, errors };
  } catch (e) {
    await prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'FAILED', errors: [{ row: 0, error: 'تعذرت معالجة الملف' }], finishedAt: new Date() } });
    throw e;
  }
}

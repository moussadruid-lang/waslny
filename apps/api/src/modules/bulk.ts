import { z } from 'zod';
import { prisma } from '../lib/db.ts';
import { createOrder } from './orders.service.ts';
import { EgPhone } from './auth.ts';

/** One row of a merchant CSV/Excel upload (parsed client-side or by the upload endpoint). */
export const BulkRow = z.object({
  recipientName: z.string().min(2), recipientPhone: EgPhone, address: z.string().min(3),
  lat: z.coerce.number(), lng: z.coerce.number(), packageSizeCode: z.string().default('SMALL'), categoryCode: z.string().default('OTHER'),
  weightKg: z.coerce.number().positive().default(1), codAmountEgp: z.coerce.number().min(0).default(0), notes: z.string().optional(),
});

export async function processBulkUpload(uploadId: string, rows: unknown[], userId: string, businessId: string) {
  const biz = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { branches: true } });
  const branch = biz.branches[0];
  const errors: { row: number; error: string }[] = []; let ok = 0;
  await prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'PROCESSING', totalRows: rows.length } });
  if (!branch) { await prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'FAILED', errors: [{ row: 0, error: 'أضف فرعًا للشركة أولًا كنقطة استلام' }] } }); return; }
  for (const [idx, raw] of rows.entries()) {
    const p = BulkRow.safeParse(raw);
    if (!p.success) { errors.push({ row: idx + 2, error: Object.values(p.error.flatten().fieldErrors).flat().join(', ') }); continue; }
    try {
      await createOrder({ customerId: userId, businessId, pickup: { lat: branch.lat, lng: branch.lng, formatted: branch.address ?? branch.name },
        dropoffs: [{ lat: p.data.lat, lng: p.data.lng, formatted: p.data.address, contactName: p.data.recipientName, contactPhone: p.data.recipientPhone, instructions: p.data.notes }],
        vehicleTypeCode: 'MOTORCYCLE', packageSizeCode: p.data.packageSizeCode, categoryCode: p.data.categoryCode, weightKg: p.data.weightKg,
        urgent: false, paymentMethod: 'CASH', codAmount: Math.round(p.data.codAmountEgp * 100) });
      ok++;
    } catch (e: any) { errors.push({ row: idx + 2, error: e.messageAr ?? 'تعذر إنشاء الطلب' }); }
  }
  await prisma.bulkUpload.update({ where: { id: uploadId }, data: { status: 'DONE', okRows: ok, errors } });
}

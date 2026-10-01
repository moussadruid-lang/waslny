/**
 * Seeds REFERENCE data only (roles, permissions, catalog, starter pricing, geography).
 * No fake drivers/orders/payments. Geo coordinates are approximate: verify in Admin › Areas before launch.
 *
 * Role permissions are only (re)assigned for roles that have none yet, so changes made from the dashboard
 * survive re-seeding. Set SEED_RESET_ROLE_PERMS=1 to force the defaults back.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const egp = (n: number) => Math.round(n * 100);

export const PERMS = ['orders.read_all', 'orders.cancel', 'orders.reassign', 'orders.chat_read', 'ops.live', 'drivers.read', 'drivers.manage', 'customers.read', 'customers.manage',
  'businesses.read', 'businesses.manage', 'apikeys.manage', 'roles.manage', 'geo.read', 'geo.write', 'pricing.read', 'pricing.write', 'coupons.read', 'coupons.write',
  'finance.read', 'finance.commission', 'finance.settle', 'finance.adjust', 'settings.read', 'settings.write', 'support.read', 'support.write', 'reports.read',
  'audit.read', 'notifications.send', 'system.read'];
export const ROLES: Record<string, { nameAr: string; perms: string[] }> = {
  SUPER_ADMIN: { nameAr: 'مدير عام', perms: PERMS },
  ADMIN: { nameAr: 'مدير', perms: PERMS.filter((p) => p !== 'roles.manage') },
  OPERATIONS: { nameAr: 'تشغيل', perms: ['orders.read_all', 'orders.cancel', 'orders.reassign', 'ops.live', 'drivers.read', 'drivers.manage', 'customers.read', 'businesses.read', 'geo.read', 'pricing.read', 'coupons.read', 'support.read', 'support.write', 'reports.read', 'notifications.send'] },
  FINANCE: { nameAr: 'مالية', perms: ['orders.read_all', 'drivers.read', 'customers.read', 'businesses.read', 'finance.read', 'finance.commission', 'finance.settle', 'finance.adjust', 'reports.read', 'pricing.read', 'audit.read'] },
  SUPPORT: { nameAr: 'دعم فني', perms: ['orders.read_all', 'orders.chat_read', 'customers.read', 'drivers.read', 'businesses.read', 'support.read', 'support.write'] },
  DRIVER: { nameAr: 'مندوب', perms: [] }, CUSTOMER: { nameAr: 'عميل', perms: [] }, BUSINESS: { nameAr: 'شركة/تاجر', perms: [] },
};

async function main() {
  for (const code of PERMS) await prisma.permission.upsert({ where: { code }, update: {}, create: { code } });
  const reset = process.env.SEED_RESET_ROLE_PERMS === '1';
  for (const [code, r] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({ where: { code }, update: { nameAr: r.nameAr }, create: { code, nameAr: r.nameAr } });
    const has = await prisma.rolePermission.count({ where: { roleId: role.id } });
    // SUPER_ADMIN always gets every permission (new permissions included); others only when empty or reset requested.
    if (code !== 'SUPER_ADMIN' && has && !reset) continue;
    const perms = await prisma.permission.findMany({ where: { code: { in: r.perms } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  }

  const sizes = [['DOCUMENTS', 'مستندات', 0, 10000, 1], ['ENVELOPE', 'ظرف', 0, 10000, 2], ['SMALL', 'طرد صغير', egp(5), 10000, 5], ['MEDIUM', 'طرد متوسط', egp(10), 11000, 15], ['LARGE', 'طرد كبير', egp(25), 13000, 50]] as const;
  for (const [code, nameAr, fee, multiplierBp, maxKg] of sizes) await prisma.packageSize.upsert({ where: { code }, update: {}, create: { code, nameAr, fee, multiplierBp, maxKg } });
  const cats = [['DOCUMENTS', 'مستندات'], ['ENVELOPE', 'ظرف'], ['CLOTHES', 'ملابس'], ['PERSONAL', 'أغراض شخصية'], ['FOOD', 'طعام'], ['ELECTRONICS', 'إلكترونيات'], ['OTHER', 'أخرى']];
  for (const [code, nameAr] of cats) await prisma.packageCategory.upsert({ where: { code }, update: {}, create: { code, nameAr } });
  const vehicles = [['MOTORCYCLE', 'موتوسيكل', 20, 35, ['DOCUMENTS', 'ENVELOPE', 'SMALL', 'MEDIUM']], ['TUKTUK', 'توك توك', 100, 25, ['DOCUMENTS', 'ENVELOPE', 'SMALL', 'MEDIUM', 'LARGE']],
    ['CAR', 'سيارة', 150, 40, ['DOCUMENTS', 'ENVELOPE', 'SMALL', 'MEDIUM', 'LARGE']], ['VAN', 'فان', 800, 35, ['SMALL', 'MEDIUM', 'LARGE']], ['TRUCK', 'نقل', 3000, 30, ['MEDIUM', 'LARGE']]] as const;
  for (const [code, nameAr, maxKg, avgSpeedKmh, allowedSizes] of vehicles) await prisma.vehicleType.upsert({ where: { code }, update: {}, create: { code, nameAr, maxKg, avgSpeedKmh, allowedSizes: [...allowedSizes] } });

  const reasons = [['CUSTOMER_ABSENT', 'العميل غير موجود', false, 'RETRY', 'FAILED_DELIVERY'], ['REFUSED', 'المستلم رفض الاستلام', false, 'RETURN', 'FAILED_DELIVERY'], ['PHONE_OFF', 'الهاتف مغلق', false, 'RETRY', 'FAILED_DELIVERY'],
    ['WRONG_ADDRESS', 'العنوان خطأ', false, 'CONTACT_SUPPORT', 'FAILED_DELIVERY'], ['UNREACHABLE', 'لا يمكن الوصول', false, 'CONTACT_SUPPORT', 'FAILED_DELIVERY'], ['MISMATCH', 'الشحنة غير مطابقة', true, 'RETURN', 'FAILED_DELIVERY'],
    ['DAMAGED', 'الشحنة تالفة', true, 'RETURN', 'FAILED_DELIVERY'], ['DRIVER_ISSUE', 'مشكلة لدى المندوب', false, 'CONTACT_SUPPORT', 'FAILED_DELIVERY']] as const;
  for (const [code, nameAr, requiresPhoto, nextAction, appliesTo] of reasons) await prisma.failureReason.upsert({ where: { code }, update: {}, create: { code, nameAr, requiresPhoto, nextAction, appliesTo } });

  // Geography: all 27 governorates as top-level units (admins add cities/villages from the dashboard).
  const govs: [string, string, number, number][] = [['القاهرة', 'Cairo', 30.0444, 31.2357], ['الجيزة', 'Giza', 30.0131, 31.2089], ['الإسكندرية', 'Alexandria', 31.2001, 29.9187], ['القليوبية', 'Qalyubia', 30.3292, 31.2168],
    ['كفر الشيخ', 'Kafr El Sheikh', 31.1107, 30.9388], ['البحيرة', 'Beheira', 30.8481, 30.3436], ['الغربية', 'Gharbia', 30.8754, 31.0335], ['الدقهلية', 'Dakahlia', 31.0409, 31.3785], ['المنوفية', 'Monufia', 30.5972, 30.9876],
    ['الشرقية', 'Sharqia', 30.7327, 31.7195], ['دمياط', 'Damietta', 31.4175, 31.8144], ['بورسعيد', 'Port Said', 31.2653, 32.3019], ['الإسماعيلية', 'Ismailia', 30.5965, 32.2715], ['السويس', 'Suez', 29.9668, 32.5498],
    ['الفيوم', 'Faiyum', 29.3084, 30.8428], ['بني سويف', 'Beni Suef', 29.0661, 31.0994], ['المنيا', 'Minya', 28.0871, 30.7618], ['أسيوط', 'Asyut', 27.1783, 31.1859], ['سوهاج', 'Sohag', 26.5591, 31.6957],
    ['قنا', 'Qena', 26.1551, 32.716], ['الأقصر', 'Luxor', 25.6872, 32.6396], ['أسوان', 'Aswan', 24.0889, 32.8998], ['البحر الأحمر', 'Red Sea', 27.2579, 33.8116], ['الوادي الجديد', 'New Valley', 25.4519, 30.5464],
    ['مطروح', 'Matrouh', 31.3543, 27.2373], ['شمال سيناء', 'North Sinai', 31.1316, 33.7984], ['جنوب سيناء', 'South Sinai', 28.2361, 33.6254]];
  const ids: Record<string, string> = {};
  for (const [nameAr, nameEn, lat, lng] of govs) {
    const g = await prisma.geoUnit.findFirst({ where: { level: 'GOVERNORATE', nameEn } }) ??
      await prisma.geoUnit.create({ data: { level: 'GOVERNORATE', nameAr, nameEn, centerLat: lat, centerLng: lng, radiusKm: 60, active: nameEn === 'Kafr El Sheikh' } });
    ids[nameEn] = g.id;
  }
  // Launch area: Kafr El Sheikh › Sidi Salem › Damro / El Haddadi (approximate centers)
  const mk = async (level: any, nameAr: string, nameEn: string, parentId: string, lat: number, lng: number, radiusKm: number) =>
    (await prisma.geoUnit.findFirst({ where: { nameEn, parentId } })) ?? prisma.geoUnit.create({ data: { level, nameAr, nameEn, parentId, centerLat: lat, centerLng: lng, radiusKm } });
  await mk('CITY', 'كفر الشيخ', 'Kafr El Sheikh City', ids['Kafr El Sheikh'], 31.1107, 30.9388, 8);
  const sidiSalem = await mk('CITY', 'سيدي سالم', 'Sidi Salem', ids['Kafr El Sheikh'], 31.2692, 30.7869, 10);
  await mk('VILLAGE', 'دمرو', 'Damro', sidiSalem.id, 31.205, 30.842, 3);
  await mk('VILLAGE', 'الحدادي', 'El Haddadi', sidiSalem.id, 31.235, 30.815, 3);

  if (!(await prisma.pricingRule.count())) {
    await prisma.pricingRule.create({ data: { name: 'افتراضي - مصر', baseFare: egp(25), perKm: egp(5), includedKm: 2, minimumFare: egp(30), perKgOverIncluded: egp(2), includedKg: 5,
      urgentFee: egp(20), scheduledFee: egp(5), extraStopFee: egp(10), waitingPerMinute: egp(1), freeWaitingMinutes: 10, returnFeePercent: 50 } });
  }
  if (!(await prisma.commissionRule.count())) await prisma.commissionRule.create({ data: { type: 'PERCENT', percent: 10, fixed: 0 } });
  await prisma.wallet.upsert({ where: { ownerType_ownerId: { ownerType: 'PLATFORM', ownerId: 'platform' } }, update: {}, create: { ownerType: 'PLATFORM', ownerId: 'platform' } });

  // Bootstrap super admin from env (no hardcoded credentials).
  const phone = process.env.SUPER_ADMIN_PHONE;
  if (phone) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
    const u = await prisma.user.upsert({ where: { phone }, update: {}, create: { phone, name: 'Super Admin', referralCode: 'MSHADMIN' } });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: u.id, roleId: role.id } }, update: {}, create: { userId: u.id, roleId: role.id } });
  }
  console.log('✅ مشاوير seed done');
}
main().finally(() => prisma.$disconnect());

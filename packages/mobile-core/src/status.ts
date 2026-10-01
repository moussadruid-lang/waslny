import { theme } from './theme';

export type OrderStatus = 'NEW' | 'SEARCHING_DRIVER' | 'DRIVER_ASSIGNED' | 'DRIVER_GOING_TO_PICKUP' | 'DRIVER_ARRIVED_PICKUP' | 'PACKAGE_PICKED_UP'
  | 'IN_DELIVERY' | 'DRIVER_ARRIVED_DESTINATION' | 'DELIVERED' | 'CANCELLED' | 'FAILED_DELIVERY' | 'RETURNING' | 'RETURNED';

/** Mirrors packages/domain STATUS_MESSAGES_AR (kept local so Metro doesn't bundle server code). */
export const STATUS_AR: Record<OrderStatus, string> = {
  NEW: 'تم إنشاء طلبك بنجاح',
  SEARCHING_DRIVER: 'جارٍ البحث عن مندوب قريب منك',
  DRIVER_ASSIGNED: 'تم تعيين المندوب',
  DRIVER_GOING_TO_PICKUP: 'المندوب في الطريق لنقطة الاستلام',
  DRIVER_ARRIVED_PICKUP: 'وصل المندوب إلى نقطة الاستلام',
  PACKAGE_PICKED_UP: 'تم استلام الشحنة',
  IN_DELIVERY: 'الشحنة في الطريق',
  DRIVER_ARRIVED_DESTINATION: 'وصل المندوب إلى نقطة التسليم',
  DELIVERED: 'تم تسليم الطلب بنجاح',
  CANCELLED: 'تم إلغاء الطلب',
  FAILED_DELIVERY: 'تعذر تسليم الطلب',
  RETURNING: 'جارٍ إرجاع الشحنة',
  RETURNED: 'تم إرجاع الشحنة',
};

export const STATUS_SHORT: Record<OrderStatus, string> = {
  NEW: 'جديد', SEARCHING_DRIVER: 'بحث عن مندوب', DRIVER_ASSIGNED: 'تم التعيين', DRIVER_GOING_TO_PICKUP: 'في الطريق للاستلام',
  DRIVER_ARRIVED_PICKUP: 'عند الاستلام', PACKAGE_PICKED_UP: 'تم الاستلام', IN_DELIVERY: 'جارٍ التوصيل', DRIVER_ARRIVED_DESTINATION: 'عند التسليم',
  DELIVERED: 'تم التسليم', CANCELLED: 'ملغي', FAILED_DELIVERY: 'فشل التسليم', RETURNING: 'جارٍ الإرجاع', RETURNED: 'مرتجع',
};

export function statusColor(s: string): { fg: string; bg: string } {
  if (s === 'DELIVERED') return { fg: theme.success, bg: theme.successSoft };
  if (s === 'CANCELLED' || s === 'FAILED_DELIVERY') return { fg: theme.danger, bg: theme.dangerSoft };
  if (s === 'RETURNING' || s === 'RETURNED') return { fg: theme.warning, bg: theme.warningSoft };
  if (s === 'NEW' || s === 'SEARCHING_DRIVER') return { fg: theme.accent, bg: '#FEF3C7' };
  return { fg: theme.info, bg: theme.infoSoft };
}

export const ACTIVE_STATUSES: OrderStatus[] = ['NEW', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'FAILED_DELIVERY', 'RETURNING'];
export const TERMINAL_STATUSES: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'RETURNED'];
/** Customer-visible progress steps. */
export const PROGRESS: OrderStatus[] = ['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DELIVERED'];
export function progressIndex(s: OrderStatus) {
  const order: OrderStatus[] = ['NEW', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'DELIVERED'];
  const i = order.indexOf(s); if (i < 0) return -1;
  let best = 0; PROGRESS.forEach((p, n) => { if (order.indexOf(p) <= i) best = n; });
  return best;
}
/** Driver is moving and the map should show them (same rule the public tracking API uses). */
export const showsDriver = (s: string) => ['DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'RETURNING'].includes(s);
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ['NEW', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP'];

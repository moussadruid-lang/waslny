export const ORDER_STATUSES = [
  'NEW', 'SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP',
  'PACKAGE_PICKED_UP', 'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'DELIVERED',
  'CANCELLED', 'FAILED_DELIVERY', 'RETURNING', 'RETURNED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type Actor = 'CUSTOMER' | 'DRIVER' | 'SYSTEM' | 'OPERATIONS' | 'BUSINESS';

interface Rule { to: OrderStatus; actors: Actor[] }

const T: Record<OrderStatus, Rule[]> = {
  NEW: [
    { to: 'SEARCHING_DRIVER', actors: ['SYSTEM', 'OPERATIONS'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'BUSINESS', 'SYSTEM', 'OPERATIONS'] },
  ],
  SEARCHING_DRIVER: [
    { to: 'DRIVER_ASSIGNED', actors: ['DRIVER', 'OPERATIONS'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'BUSINESS', 'SYSTEM', 'OPERATIONS'] },
  ],
  DRIVER_ASSIGNED: [
    { to: 'DRIVER_GOING_TO_PICKUP', actors: ['DRIVER'] },
    { to: 'SEARCHING_DRIVER', actors: ['DRIVER', 'OPERATIONS', 'SYSTEM'] }, // driver dropped / reassign
    { to: 'CANCELLED', actors: ['CUSTOMER', 'BUSINESS', 'OPERATIONS'] },
  ],
  DRIVER_GOING_TO_PICKUP: [
    { to: 'DRIVER_ARRIVED_PICKUP', actors: ['DRIVER'] },
    { to: 'SEARCHING_DRIVER', actors: ['DRIVER', 'OPERATIONS'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'BUSINESS', 'OPERATIONS'] },
  ],
  DRIVER_ARRIVED_PICKUP: [
    { to: 'PACKAGE_PICKED_UP', actors: ['DRIVER'] },
    { to: 'SEARCHING_DRIVER', actors: ['OPERATIONS'] },
    { to: 'CANCELLED', actors: ['CUSTOMER', 'BUSINESS', 'DRIVER', 'OPERATIONS'] }, // e.g. package mismatch
  ],
  PACKAGE_PICKED_UP: [
    { to: 'IN_DELIVERY', actors: ['DRIVER'] },
    { to: 'RETURNING', actors: ['OPERATIONS'] },
  ],
  IN_DELIVERY: [
    { to: 'DRIVER_ARRIVED_DESTINATION', actors: ['DRIVER'] },
    { to: 'FAILED_DELIVERY', actors: ['DRIVER', 'OPERATIONS'] },
  ],
  DRIVER_ARRIVED_DESTINATION: [
    { to: 'DELIVERED', actors: ['DRIVER'] }, // only via proof-of-delivery flow
    { to: 'FAILED_DELIVERY', actors: ['DRIVER', 'OPERATIONS'] },
  ],
  FAILED_DELIVERY: [
    { to: 'IN_DELIVERY', actors: ['DRIVER', 'OPERATIONS'] }, // retry attempt
    { to: 'RETURNING', actors: ['DRIVER', 'OPERATIONS', 'SYSTEM'] },
  ],
  RETURNING: [{ to: 'RETURNED', actors: ['DRIVER', 'OPERATIONS'] }],
  DELIVERED: [],
  CANCELLED: [],
  RETURNED: [],
};

export const TERMINAL: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'RETURNED'];
export const ACTIVE_DRIVER_STATUSES: OrderStatus[] = [
  'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'DRIVER_ARRIVED_PICKUP', 'PACKAGE_PICKED_UP',
  'IN_DELIVERY', 'DRIVER_ARRIVED_DESTINATION', 'FAILED_DELIVERY', 'RETURNING',
];

export class InvalidTransitionError extends Error {
  readonly from: OrderStatus; readonly to: OrderStatus; readonly actor: Actor;
  constructor(from: OrderStatus, to: OrderStatus, actor: Actor) {
    super(`Transition ${from} -> ${to} not allowed for ${actor}`);
    this.from = from; this.to = to; this.actor = actor;
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return T[from].some((r) => r.to === to && r.actors.includes(actor));
}

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) throw new InvalidTransitionError(from, to, actor);
}

export function nextStatuses(from: OrderStatus, actor: Actor): OrderStatus[] {
  return T[from].filter((r) => r.actors.includes(actor)).map((r) => r.to);
}

/** Arabic user-facing messages per status (used by notifications + timeline). */
export const STATUS_MESSAGES_AR: Record<OrderStatus, string> = {
  NEW: 'تم إنشاء طلبك بنجاح',
  SEARCHING_DRIVER: 'جارٍ البحث عن مندوب قريب منك',
  DRIVER_ASSIGNED: 'تم تعيين المندوب',
  DRIVER_GOING_TO_PICKUP: 'المندوب في الطريق لنقطة الاستلام',
  DRIVER_ARRIVED_PICKUP: 'وصل المندوب إلى نقطة الاستلام',
  PACKAGE_PICKED_UP: 'تم استلام الشحنة',
  IN_DELIVERY: 'الشحنة في الطريق إليك',
  DRIVER_ARRIVED_DESTINATION: 'وصل المندوب إلى نقطة التسليم',
  DELIVERED: 'تم تسليم الطلب بنجاح',
  CANCELLED: 'تم إلغاء الطلب',
  FAILED_DELIVERY: 'تعذر تسليم الطلب',
  RETURNING: 'جارٍ إرجاع الشحنة',
  RETURNED: 'تم إرجاع الشحنة',
};

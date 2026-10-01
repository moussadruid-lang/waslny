/** Money is integer piasters everywhere; format only at the edge. */
export function egp(piasters: number | null | undefined) {
  const v = (piasters ?? 0) / 100;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `${s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} جنيه`;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function fmtTime(d: string | number | Date) {
  const x = new Date(d); let h = x.getHours(); const ap = h >= 12 ? 'م' : 'ص'; h = h % 12 || 12;
  return `${h}:${pad(x.getMinutes())} ${ap}`;
}
export function fmtDate(d: string | number | Date) {
  const x = new Date(d); const now = new Date();
  const sameDay = x.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const t = new Date(now); t.setDate(now.getDate() + 1);
  if (sameDay) return `اليوم ${fmtTime(x)}`;
  if (x.toDateString() === y.toDateString()) return `أمس ${fmtTime(x)}`;
  if (x.toDateString() === t.toDateString()) return `غدًا ${fmtTime(x)}`;
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()} ${fmtTime(x)}`;
}
export const km = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 10) / 10} كم`);
export const mins = (n: number | null | undefined) => (n == null ? '—' : n < 60 ? `${Math.max(1, Math.round(n))} دقيقة` : `${Math.floor(n / 60)} س ${Math.round(n % 60)} د`);
/** +201012345678 -> 01012345678 */
export const localPhone = (p?: string | null) => (p ? p.replace(/^\+2/, '') : '');

export const WALLET_TX_AR: Record<string, string> = {
  DEPOSIT: 'إيداع', WITHDRAWAL: 'سحب', ORDER_HOLD: 'دفع طلب', DELIVERY_EARNING: 'أرباح توصيل', RETURN_EARNING: 'أرباح إرجاع',
  COD_CASH_COLLECTED: 'نقدية محصلة', COMMISSION: 'عمولة مشاوير', SETTLEMENT: 'تسوية', REFUND: 'استرداد', COUPON_SUBSIDY: 'دعم كوبون',
  REFERRAL_REWARD: 'مكافأة دعوة', ADJUSTMENT: 'تعديل', RETURN_FEE: 'رسوم إرجاع', CUSTOMER_PAYMENT_IN: 'دفع عميل', COD_RECEIVABLE: 'مستحقات تحصيل',
};

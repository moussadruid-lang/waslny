// All money is stored and computed as integer piasters (1 EGP = 100 piasters)
// to avoid floating point errors. Convert only at the presentation layer.
export type Piasters = number;

export const egp = (pounds: number): Piasters => Math.round(pounds * 100);
export const toEgp = (p: Piasters): number => p / 100;
export const formatEgp = (p: Piasters): string =>
  `${(p / 100).toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} جنيه`;

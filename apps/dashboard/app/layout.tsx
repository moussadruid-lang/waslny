import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
export const metadata: Metadata = { title: 'مشاوير | لوحة التحكم', description: 'إدارة وتشغيل منصة مشاوير' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ar" dir="rtl"><body><Providers>{children}</Providers></body></html>; }

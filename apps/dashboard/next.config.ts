import type { NextConfig } from 'next';
const nextConfig: NextConfig = { reactStrictMode: true, transpilePackages: ['@mashawir/dashboard-ui'], output: 'standalone' };
export default nextConfig;

import type { NextConfig } from 'next';

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  ...(process.env.POS_RELEASE_BUILD === '1' ? {
    output: 'standalone' as const,
    // A signed Windows release is immutable. Keep Next's bounded in-memory
    // response cache, but never promote runtime route seeds into its files.
    experimental: { isrFlushToDisk: false },
  } : {}),
  async headers() {
    return [{ source: '/sw.js', headers: [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
    ] }];
  },
} satisfies NextConfig;

export default nextConfig;

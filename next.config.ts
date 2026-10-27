import withPWAInit from 'next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Aquí puedes mantener otras configuraciones si las tuvieras en el futuro
  reactStrictMode: true,
};

export default withPWA(nextConfig);
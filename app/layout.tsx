import { posProfile } from '@/lib/pos-profile';
import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistration from './ServiceWorkerRegistration';
import SmoothiesRuntimeGate from './SmoothiesRuntimeGate';


export const metadata: Metadata = {
  title: posProfile.title,
  manifest: posProfile.manifest,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: posProfile.shortName,
  },
};

export const viewport: Viewport = {
  themeColor: posProfile.themeColor,
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-MX"
      className="h-full antialiased"
    >
      <body className={`min-h-full flex flex-col${posProfile.id === 'smoothies' ? ' smoothies-app' : ''}`}>
        {posProfile.id === 'smoothies' && process.env.NEXT_PUBLIC_SMOOTHIES_PORTABLE === '1'
          ? <SmoothiesRuntimeGate><ServiceWorkerRegistration />{children}</SmoothiesRuntimeGate>
          : <><ServiceWorkerRegistration />{children}</>}
      </body>
    </html>
  );
}

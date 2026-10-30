import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistration from './ServiceWorkerRegistration';


export const metadata: Metadata = {
  title: 'Cariñito Mío POS',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Cariñito Mío',
  },
};

export const viewport: Viewport = {
  themeColor: '#0071e3',
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
      <body className="min-h-full flex flex-col"><ServiceWorkerRegistration />{children}</body>
    </html>
  );
}

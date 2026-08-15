import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Figtree, Outfit } from 'next/font/google';
import { Providers } from '@/components/providers';

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-figtree',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
});

export const metadata: Metadata = {
  title: { default: 'CenaPronta — Suas câmeras viram conteúdo.', template: '%s · CenaPronta' },
  description: 'Geração automática de Reels para restaurantes a partir das câmeras da operação.',
  applicationName: 'CenaPronta',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'CenaPronta', statusBarStyle: 'black-translucent' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#005c2e',
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${figtree.variable} ${outfit.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

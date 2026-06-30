import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/providers';
import { AppShell } from '@/components/layout/app-shell';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Scadium — Proof-of-Play | Mine $SCAD on Solana',
    template: '%s · Scadium',
  },
  description:
    'Scadium is a non-custodial, provably-fair platform of on-chain games on Solana. Play-to-earn — playing mines $SCAD in hourly blocks. Connect your wallet and start.',
  keywords: [
    'Solana',
    'on-chain games',
    'play-to-earn',
    'proof-of-play',
    '$SCAD',
    'mine',
    'Web3',
    'provably fair',
    'non-custodial',
  ],
  metadataBase: new URL('https://scadium.io'),
  openGraph: {
    title: 'Scadium — Proof-of-Play on Solana',
    description: 'Non-custodial, provably-fair play-to-earn — mine $SCAD as you play.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0B0A14',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} dark`} suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

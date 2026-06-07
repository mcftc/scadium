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
    default: 'Scadium — Solana Casino | Crash, Coinflip, Blackjack',
    template: '%s · Scadium',
  },
  description:
    'Scadium is a non-custodial, provably-fair Solana casino. Play Crash, Coinflip, and Blackjack with instant on-chain settlement. Connect your wallet and start.',
  keywords: [
    'Solana',
    'casino',
    'crash',
    'coinflip',
    'blackjack',
    'Web3',
    'provably fair',
    'non-custodial',
  ],
  metadataBase: new URL('https://scadium.io'),
  openGraph: {
    title: 'Scadium — Solana Casino',
    description: 'Non-custodial, provably-fair Solana casino.',
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

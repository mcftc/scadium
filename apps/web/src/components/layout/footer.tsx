import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Logo } from '@/components/brand/logo';

const footerSections = [
  {
    title: 'Games',
    links: [
      { href: '/crash', label: 'Crash' },
      { href: '/coinflip', label: 'Coinflip' },
      { href: '/blackjack', label: 'Blackjack' },
      { href: '/jackpot', label: 'Jackpot' },
      { href: '/lottery', label: 'Lottery' },
    ],
  },
  {
    title: 'Features',
    links: [
      { href: '/affiliates', label: 'Affiliates' },
      { href: '/profile', label: 'Statistics' },
      { href: '/profile', label: 'Settings' },
      { href: '/token', label: '$SCAD' },
      { href: '/whitepaper', label: 'Whitepaper' },
    ],
  },
  {
    title: 'Rewards',
    links: [
      { href: '/airdrop', label: 'Daily Case' },
      { href: '/airdrop', label: 'Airdrop' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/fairness', label: 'Fairness' },
    ],
  },
  {
    title: 'Info',
    links: [
      { href: '/faq', label: 'Help' },
      { href: '/tos', label: 'TOS' },
      { href: '/about', label: 'About Us' },
      { href: '/aml', label: 'AML Policy' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/faq', label: 'FAQ' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/50 bg-surface/30">
      <Container>
        <div className="py-12 grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Logo />
            <p className="mt-4 text-sm text-foreground-muted max-w-xs">
              Non-custodial, provably-fair Solana casino. Play with instant on-chain settlement.
            </p>
          </div>
          {footerSections.map((section) => (
            <div key={section.title}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted mb-3">
                {section.title}
              </h4>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-foreground hover:text-primary-400 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-border/50 py-6 flex flex-col md:flex-row justify-between gap-4 text-xs text-foreground-muted">
          <p>
            © {new Date().getFullYear()} Scadium. For entertainment purposes. 18+. Play
            responsibly.
          </p>
          <p>Licensed &amp; regulated. Not available in restricted jurisdictions.</p>
        </div>
      </Container>
    </footer>
  );
}

import type { MetadataRoute } from 'next';

const BASE = 'https://scadium.com';

/** Public, indexable routes (marketing + game landings). Excludes authed pages. */
const ROUTES = [
  '',
  '/about',
  '/faq',
  '/crash',
  '/coinflip',
  '/blackjack',
  '/dice',
  '/limbo',
  '/hilo',
  '/mines',
  '/plinko',
  '/tower',
  '/wheel',
  '/jackpot',
  '/lottery',
  '/leaderboard',
  '/token',
  '/trade',
  '/fairness',
  '/responsible-gambling',
  '/tos',
  '/privacy',
  '/aml',
  '/whitepaper',
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: path === '' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.6,
  }));
}

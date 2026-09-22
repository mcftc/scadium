import type { MetadataRoute } from 'next';
import { GAMES } from '@/config/games';

const BASE = 'https://scadium.com';

/**
 * Public, indexable routes (marketing + game landings). Excludes authed pages.
 *
 * Game paths come from the registry (`GAMES`, not `ALL_GAMES`) so a disabled
 * game's now-404 route drops out of the sitemap automatically instead of
 * needing to be hand-removed here.
 */
const ROUTES = [
  '',
  '/about',
  '/faq',
  ...GAMES.map((g) => g.href),
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

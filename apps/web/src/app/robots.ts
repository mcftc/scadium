import type { MetadataRoute } from 'next';

const BASE = 'https://scadium.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Authenticated / non-marketing surfaces have no SEO value.
        disallow: ['/profile', '/settings', '/wallet', '/dev'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}

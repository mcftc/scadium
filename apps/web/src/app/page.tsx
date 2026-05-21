import { redirect } from 'next/navigation';

/**
 * Solpump-style game-first landing: visitors go straight to the flagship
 * crash game instead of a marketing page. The marketing content lives at
 * /about for SEO / organic traffic.
 */
export default function HomePage() {
  redirect('/crash');
}

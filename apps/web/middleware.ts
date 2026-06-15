import { NextResponse, type NextRequest } from 'next/server';
import { isBlockedCountry } from '@/lib/geo-block';

/**
 * Edge geo-block (#43): for game/wallet routes, resolve the request country from
 * the hosting platform's geo header and redirect blocked-country visitors to
 * `/restricted`. The API enforces the same blocklist authoritatively (GeoGuard);
 * this is the first, edge-level line.
 */
export function middleware(request: NextRequest) {
  const country =
    request.headers.get('x-vercel-ip-country') ?? request.headers.get('cf-ipcountry');
  if (isBlockedCountry(country)) {
    const url = request.nextUrl.clone();
    url.pathname = '/restricted';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/crash/:path*',
    '/coinflip/:path*',
    '/blackjack/:path*',
    '/jackpot/:path*',
    '/lottery/:path*',
    '/wallet/:path*',
  ],
};

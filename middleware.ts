import { NextResponse, type NextRequest } from 'next/server';

/**
 * Pro "custom domain hosting" (v1: manual provisioning).
 * Set CUSTOM_DOMAINS="folio.alice.dev=alice,stats.bob.io=bob" and point those
 * domains' DNS at this deployment. Requests to the domain's root render that user's widget page.
 */
function domainMap(): Record<string, string> {
  const map: Record<string, string> = Object.create(null);
  for (const pair of (process.env.CUSTOM_DOMAINS ?? '').split(',')) {
    const [host, user] = pair.split('=').map((s) => s?.trim().toLowerCase());
    if (host && user) map[host] = user;
  }
  return map;
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const user = domainMap()[host];
  if (user && req.nextUrl.pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = `/embed/${user}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/'] };

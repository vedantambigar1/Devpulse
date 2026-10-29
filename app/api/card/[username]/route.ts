import { getActivity } from '@/lib/github';
import { clientIp, CORS, errorResponse, preflight } from '@/lib/http';
import { rateLimit } from '@/lib/ratelimit';
import { parseOptions, resolveTheme } from '@/lib/options';
import { hasActiveLicense, recordView } from '@/lib/store';
import { hostOf } from '@/lib/format';
import { renderCardSvg } from '@/lib/svg';

export const dynamic = 'force-dynamic';

export const OPTIONS = preflight;

/** GET /api/card/:username.svg → static SVG card, usable as an <img> in READMEs, Notion, email. */
export async function GET(req: Request, props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  if (!rateLimit(`card:${clientIp(req)}`, 120)) return new Response('Too many requests', { status: 429, headers: CORS });
  const username = params.username.replace(/\.svg$/i, '');
  try {
    const data = await getActivity(username);
    const opts = parseOptions(new URL(req.url).searchParams);
    const pro = await hasActiveLicense(username);
    const svg = renderCardSvg(data, resolveTheme(opts, pro), {
      radius: opts.radius,
      transparent: opts.transparent,
      badge: !pro,
    });
    recordView(username, hostOf(req.headers.get('referer'))).catch(() => undefined);
    return new Response(svg, {
      headers: {
        ...CORS,
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

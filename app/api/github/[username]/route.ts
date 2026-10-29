import { getActivity } from '@/lib/github';
import { clientIp, errorResponse, json, preflight } from '@/lib/http';
import { rateLimit } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export const OPTIONS = preflight;

/** GET /api/github/:username → normalised activity JSON (streaks, graph, repos, languages). */
export async function GET(req: Request, props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  if (!rateLimit(`gh:${clientIp(req)}`, 60)) return json({ error: 'Too many requests' }, 429);
  try {
    const data = await getActivity(params.username);
    return json(data, 200, { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' });
  } catch (e) {
    return errorResponse(e);
  }
}

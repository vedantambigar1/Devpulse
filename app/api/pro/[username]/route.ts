import { json, preflight } from '@/lib/http';
import { USERNAME_RE } from '@/lib/github';
import { hasActiveLicense } from '@/lib/store';

export const dynamic = 'force-dynamic';

export const OPTIONS = preflight;

/** GET /api/pro/:username → { pro: boolean }. Lets the builder show whether Pro is active. */
export async function GET(_req: Request, props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  if (!USERNAME_RE.test(params.username)) return json({ pro: false }, 400);
  return json({ pro: await hasActiveLicense(params.username) }, 200, { 'Cache-Control': 'no-store' });
}

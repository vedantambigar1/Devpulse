import { json } from '@/lib/http';
import { getAnalytics } from '@/lib/store';
import { verifyLicense } from '@/lib/license';

export const dynamic = 'force-dynamic';

/** GET /api/analytics/:username — Pro only. Pass the license key as `x-license-key` header. */
export async function GET(req: Request, props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  const key = req.headers.get('x-license-key');
  const lic = await verifyLicense(key, params.username);
  if (!lic.valid) return json({ error: 'A valid Pro license key for this username is required' }, 401);
  return json(await getAnalytics(params.username), 200, { 'Cache-Control': 'no-store' });
}

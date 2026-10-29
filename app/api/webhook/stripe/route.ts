import crypto from 'crypto';
import { json } from '@/lib/http';
import { USERNAME_RE } from '@/lib/github';
import { issueKey } from '@/lib/license';
import { getLicenseBySession, revokeBySubscription, saveLicense } from '@/lib/store';
import type { Plan } from '@/lib/plans';

export const dynamic = 'force-dynamic';

/** Verifies Stripe's `Stripe-Signature` header (HMAC-SHA256 of `${t}.${rawBody}`, 5 min tolerance). */
function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts.t;
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => /^[a-f0-9]{64}$/.test(s) && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Webhook not configured' }, 503);

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get('stripe-signature'), secret)) return json({ error: 'Invalid signature' }, 400);

  let event: { type: string; data: { object: Record<string, any> } };
  try {
    event = JSON.parse(raw);
    if (!event || typeof event.type !== 'string' || !event.data?.object) throw new Error('Bad event');
  } catch {
    return json({ error: 'Invalid event' }, 400);
  }
  const obj = event.data.object;

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const username = String(obj.metadata?.username ?? obj.client_reference_id ?? '');
    const plan = obj.metadata?.plan as Plan;
    const validPlan = (plan === 'monthly' && obj.mode === 'subscription') || (plan === 'lifetime' && obj.mode === 'payment');
    const paid = obj.payment_status === 'paid' || obj.payment_status === 'no_payment_required';
    if (USERNAME_RE.test(username) && validPlan && paid && typeof obj.id === 'string' && obj.id.startsWith('cs_')) {
      if (await getLicenseBySession(obj.id)) return json({ received: true });
      const key = issueKey(username, plan);
      await saveLicense({ key, username, plan, sessionId: obj.id, subscriptionId: obj.subscription ?? undefined });
    }
  } else if (event.type === 'customer.subscription.deleted' ||
    (event.type === 'customer.subscription.updated' && ['canceled', 'unpaid', 'incomplete_expired'].includes(obj.status))) {
    await revokeBySubscription(String(obj.id));
  }

  return json({ received: true });
}

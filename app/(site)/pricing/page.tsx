import type { Metadata } from 'next';
import { PricingPlans } from '@/components/PricingPlans';

export const metadata: Metadata = { title: 'Pricing' };

export default async function PricingPage(props: { searchParams: Promise<{ u?: string }> }) {
  const searchParams = await props.searchParams;
  return (
    <div className="container section" style={{ paddingTop: 64 }}>
      <div className="center">
        <h1 className="page-title">Pricing</h1>
        <p className="sub" style={{ margin: '0 auto 32px' }}>
          Start free. Upgrade for custom themes, visitor analytics and custom domain hosting — $3/month or $5 one-time.
        </p>
      </div>
      <PricingPlans initialUsername={typeof searchParams.u === 'string' ? searchParams.u : ''} />
    </div>
  );
}

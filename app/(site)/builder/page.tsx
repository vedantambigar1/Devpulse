import type { Metadata } from 'next';
import { Builder } from '@/components/Builder';
import { normalizeUsername } from '@/lib/username';

export const metadata: Metadata = { title: 'Widget builder' };

export default async function BuilderPage(props: { searchParams: Promise<{ u?: string }> }) {
  const searchParams = await props.searchParams;
  const u = typeof searchParams.u === 'string' ? normalizeUsername(searchParams.u) : '';
  return (
    <>
      <div className="container" style={{ paddingTop: 48 }}>
        <h1 className="page-title">Widget builder</h1>
        <p className="muted" style={{ margin: '8px 0 0' }}>Customize your widget, preview it live, then copy the embed snippet.</p>
      </div>
      <Builder initialUsername={u} />
    </>
  );
}

import type { Metadata } from 'next';
import { getActivity } from '@/lib/github';
import { parseOptions, resolveTheme } from '@/lib/options';
import { hasActiveLicense } from '@/lib/store';
import { Widget } from '@/components/Widget';
import { EmbedBeacon } from '@/components/EmbedBeacon';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'GitHub activity widget', robots: { index: false } };

export default async function EmbedPage(
  props: {
    params: Promise<{ username: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const opts = parseOptions(searchParams);
  let content: React.ReactNode;

  try {
    const [data, pro] = await Promise.all([getActivity(params.username), hasActiveLicense(params.username)]);
    content = (
      <>
        <Widget data={data} theme={resolveTheme(opts, pro)} options={opts} badge={!pro} />
        <EmbedBeacon username={data.username} />
      </>
    );
  } catch (e) {
    content = <div className="embed-error">{e instanceof Error ? e.message : 'Something went wrong'}</div>;
  }

  return <div className="embed-root">{content}</div>;
}

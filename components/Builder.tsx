'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Widget } from '@/components/Widget';
import { CopyButton } from '@/components/CopyButton';
import { DEFAULT_OPTIONS, resolveTheme, SECTIONS, SECTION_LABELS, toQuery, type Section, type WidgetOptions } from '@/lib/options';
import { THEMES } from '@/lib/themes';
import type { ActivityData } from '@/lib/types';
import { normalizeUsername } from '@/lib/username';

type Tab = 'script' | 'iframe' | 'svg' | 'markdown' | 'notion';
const TABS: [Tab, string][] = [['script', 'Script'], ['iframe', 'iFrame'], ['svg', 'SVG image'], ['markdown', 'Markdown'], ['notion', 'Notion']];

const USER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function Builder({ initialUsername }: { initialUsername: string }) {
  const [input, setInput] = useState(initialUsername);
  const [username, setUsername] = useState(() => normalizeUsername(initialUsername));
  const [opts, setOpts] = useState<WidgetOptions>(DEFAULT_OPTIONS);
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [pro, setPro] = useState(false);
  const [tab, setTab] = useState<Tab>('script');
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_APP_URL || 'https://your-app.com');

  useEffect(() => setOrigin(window.location.origin), []);

  // Load activity for the chosen username.
  useEffect(() => {
    if (!username) return;
    if (!USER_RE.test(username)) {
      setError('That doesn’t look like a valid GitHub username.');
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setPro(false);
    setError('');
    fetch(`/api/github/${encodeURIComponent(username)}`, { signal: ctrl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (ctrl.signal.aborted) return;
        if (!r.ok) throw new Error(j.error || 'Failed to load');
        setData(j as ActivityData);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setData(null);
          setError(e.message);
        }
      })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });

    fetch(`/api/pro/${encodeURIComponent(username)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => { if (!ctrl.signal.aborted) setPro(Boolean(j.pro)); })
      .catch(() => { if (!ctrl.signal.aborted) setPro(false); });
    return () => ctrl.abort();
  }, [username, reload]);

  const set = <K extends keyof WidgetOptions>(k: K, v: WidgetOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const toggleSection = (s: Section) =>
    set('show', SECTIONS.filter((x) => (x === s ? !opts.show.includes(s) : opts.show.includes(x))));
  const setColor = (k: 'bg' | 'fg' | 'accent', hex: string) =>
    set('custom', { ...opts.custom, [k]: hex.replace('#', '').toLowerCase() });

  // The preview shows every theme; the embed falls back to free themes unless Pro is active.
  const theme = useMemo(() => resolveTheme(opts, true), [opts]);
  const selected = THEMES.find((t) => t.id === opts.theme);
  const usesProFeature = Boolean(selected?.pro || opts.custom.bg || opts.custom.fg || opts.custom.accent);
  const locked = usesProFeature && !pro;

  const q = toQuery(opts);
  const u = normalizeUsername(username) || 'your-username';
  const embedUrl = `${origin}/embed/${u}${q ? `?${q}` : ''}`;
  const svgUrl = `${origin}/api/card/${u}.svg${q ? `?${q}` : ''}`;

  const attrs = [
    opts.theme !== DEFAULT_OPTIONS.theme && `data-theme="${opts.theme}"`,
    opts.show.join(',') !== DEFAULT_OPTIONS.show.join(',') && `data-show="${opts.show.join(',')}"`,
    opts.repos !== DEFAULT_OPTIONS.repos && `data-repos="${opts.repos}"`,
    opts.transparent && 'data-transparent="1"',
    opts.radius !== DEFAULT_OPTIONS.radius && `data-radius="${opts.radius}"`,
    opts.custom.bg && `data-bg="${opts.custom.bg}"`,
    opts.custom.fg && `data-fg="${opts.custom.fg}"`,
    opts.custom.accent && `data-accent="${opts.custom.accent}"`,
  ].filter(Boolean) as string[];

  const snippets: Record<Tab, string> = {
    script: `<script src="${origin}/widget.js" data-username="${u}"${attrs.length ? '\n        ' + attrs.join('\n        ') : ''} async></script>`,
    iframe: `<iframe src="${embedUrl}" title="GitHub activity" width="100%" height="520" style="border:0;" loading="lazy"></iframe>`,
    svg: `<img src="${svgUrl}" alt="GitHub activity for ${u}" />`,
    markdown: `![GitHub activity](${svgUrl})`,
    notion: embedUrl,
  };

  const hints: Record<Tab, string> = {
    script: 'Paste anywhere in your HTML. The widget auto-resizes to its content.',
    iframe: 'Use when scripts are blocked (e.g. some CMSs). Set the height to fit your sections.',
    svg: 'A static card (profile, streaks, graph). Perfect for emails and anywhere that only allows images.',
    markdown: 'Put this in your GitHub profile README.',
    notion: 'In Notion type /embed, paste this URL and press “Embed link”.',
  };

  return (
    <div className="container">
      <div className="builder">
        {/* ---------- Controls ---------- */}
        <div>
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              const next = normalizeUsername(input);
              if (!next) {
                setError('Enter a valid GitHub username or profile URL.');
                setData(null);
                return;
              }
              setUsername(next);
              setReload((n) => n + 1);
            }}
          >
            <h3>GitHub username</h3>
            <div className="row">
              <input
                className="input"
                placeholder="octocat"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
                aria-label="GitHub username"
              />
              <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? '…' : 'Load'}</button>
            </div>
          </form>

          <div className="panel">
            <h3>Theme</h3>
            <div className="themes">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-btn${opts.theme === t.id ? ' on' : ''}`}
                  onClick={() => set('theme', t.id)}
                  style={{ background: t.bg, color: t.fg, borderColor: '#0b0b0f' }}
                >
                  {t.name}
                  {t.pro && <span className="pro">PRO</span>}
                  <div className="cells">{t.graph.map((c, i) => <i key={i} style={{ background: c }} />)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>Sections</h3>
            {SECTIONS.map((s) => (
              <label className="check" key={s}>
                <input type="checkbox" checked={opts.show.includes(s)} onChange={() => toggleSection(s)} />
                {SECTION_LABELS[s]}
              </label>
            ))}
            <div className="field" style={{ marginTop: 12 }}>
              <label className="lbl">Repositories shown: {opts.repos}</label>
              <input type="range" min={1} max={6} value={opts.repos} onChange={(e) => set('repos', Number(e.target.value))} />
            </div>
          </div>

          <div className="panel">
            <h3>Style</h3>
            <div className="field">
              <label className="lbl">Corner radius: {opts.radius}px</label>
              <input type="range" min={0} max={28} value={opts.radius} onChange={(e) => set('radius', Number(e.target.value))} />
            </div>
            <label className="check">
              <input type="checkbox" checked={opts.transparent} onChange={(e) => set('transparent', e.target.checked)} />
              Transparent background
            </label>
            <div className="field" style={{ marginTop: 12 }}>
              <label className="lbl">Custom colors <span className="accent">· Pro</span></label>
              <div className="colors">
                {(['bg', 'fg', 'accent'] as const).map((k) => (
                  <div key={k}>
                    <input
                      type="color"
                      aria-label={`${k} color`}
                      value={`#${opts.custom[k] ?? (k === 'bg' ? theme.bg.slice(1) : k === 'fg' ? theme.fg.slice(1) : theme.accent.slice(1))}`}
                      onChange={(e) => setColor(k, e.target.value)}
                    />
                    <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>{k === 'bg' ? 'Background' : k === 'fg' ? 'Text' : 'Accent'}</div>
                  </div>
                ))}
              </div>
              {(opts.custom.bg || opts.custom.fg || opts.custom.accent) && (
                <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => set('custom', {})}>Reset colors</button>
              )}
            </div>
          </div>
        </div>

        {/* ---------- Preview + embed ---------- */}
        <div>
          <div className="stage">
            {!username && <div className="muted center" style={{ padding: 60 }}>Enter a GitHub username to see your live widget.</div>}
            {error && <div className="notice err">{error}</div>}
            {loading && !data && <div className="muted center" style={{ padding: 60 }}>Loading…</div>}
            {data && !error && (
              <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity .15s' }}>
                <Widget data={data} theme={theme} options={opts} badge={!pro} />
              </div>
            )}
          </div>

          {data?.demo && (
            <div className="notice warn" style={{ marginTop: 12 }}>
              Demo mode: no <code>GITHUB_TOKEN</code> is configured, so this shows generated sample data. Add a token to see real activity.
            </div>
          )}

          {username && (
            <div style={{ marginTop: 12 }}>
              {pro ? (
                <div className="notice ok">Pro is active for @{username}: all themes, custom colors, no badge and analytics are live.</div>
              ) : locked ? (
                <div className="notice warn">
                  You’re previewing a Pro theme/colors. Until @{username} upgrades, the embedded widget falls back to the Dark theme.{' '}
                  <Link href={`/pricing?u=${encodeURIComponent(username)}`} className="accent">Unlock Pro →</Link>
                </div>
              ) : (
                <div className="notice">
                  Free plan includes a small “Powered by” badge. <Link href={`/pricing?u=${encodeURIComponent(username)}`} className="accent">Go Pro</Link> to remove it and unlock analytics.
                </div>
              )}
            </div>
          )}

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Embed</h3>
            <div className="tabs">
              {TABS.map(([id, label]) => (
                <button key={id} type="button" className={`tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            <div className="snippet-head">
              <span className="muted" style={{ fontSize: 13 }}>{hints[tab]}</span>
              <CopyButton text={snippets[tab]} />
            </div>
            <div className="code">{snippets[tab]}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

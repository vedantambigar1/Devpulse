/** Accept a username, @handle or GitHub profile URL; never fetch user-supplied URLs. */
export const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export function normalizeUsername(input: string): string {
  const value = input.trim();
  if (value.length > 512) return '';
  const handle = value.replace(/^@/, '');
  if (USERNAME_RE.test(handle)) return handle;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['https:', 'http:'].includes(url.protocol) || !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port) return '';
    const match = /^\/([^/]+)\/?$/.exec(url.pathname);
    return match && USERNAME_RE.test(match[1]) ? match[1] : '';
  } catch {
    return '';
  }
}

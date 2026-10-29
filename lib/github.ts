import type { ActivityData, Day, LangInfo, Level, RepoInfo } from './types';
import { computeStreaks } from './streak';
import { demoActivity } from './demo';

import { USERNAME_RE } from './username';
export { USERNAME_RE } from './username';

export class GitHubError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const TTL_MS = (Number(process.env.CACHE_TTL_SECONDS) || 900) * 1000;
const MAX_CACHE = 500;
const cache = new Map<string, { at: number; data: ActivityData }>();

const LEVELS: Record<string, Level> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const QUERY = /* GraphQL */ `
  query ($login: String!) {
    user(login: $login) {
      login
      name
      avatarUrl(size: 120)
      bio
      followers { totalCount }
      following { totalCount }
      repositories(ownerAffiliations: [OWNER], isFork: false, privacy: PUBLIC, first: 100, orderBy: { field: STARGAZERS, direction: DESC }) {
        totalCount
        nodes {
          name
          description
          url
          stargazerCount
          forkCount
          primaryLanguage { name color }
          languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
  }
`;

/** Returns activity for a user. Cached in memory; falls back to demo data without a token. */
export async function getActivity(username: string): Promise<ActivityData> {
  if (!USERNAME_RE.test(username)) throw new GitHubError('Invalid GitHub username', 400);

  const key = username.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const token = process.env.GITHUB_TOKEN;
  let data: ActivityData;
  if (!token) {
    data = demoActivity(username);
  } else {
    try {
      data = await fetchFromGitHub(username, token);
    } catch (e) {
      if (hit && !(e instanceof GitHubError && e.status === 404)) return hit.data;
      throw e;
    }
  }

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function fetchFromGitHub(username: string, token: string): Promise<ActivityData> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'devpulse-widget',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: username } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401) throw new GitHubError('GitHub token is invalid or expired', 502);
  if (res.status === 403 || res.status === 429) throw new GitHubError('GitHub rate limit reached, try again shortly', 503);
  if (!res.ok) throw new GitHubError(`GitHub responded with ${res.status}`, 502);

  const json = await res.json();
  if (json.errors?.some((e: { type?: string; path?: string[] }) => e.type === 'NOT_FOUND' && e.path?.[0] === 'user')) {
    throw new GitHubError(`GitHub user “${username}” not found`, 404);
  }
  if (json.errors?.length) throw new GitHubError('GitHub GraphQL error', 502);
  if (json.data?.user === null) throw new GitHubError(`GitHub user “${username}” not found`, 404);
  if (!json.data?.user) throw new GitHubError('Invalid response from GitHub', 502);

  const u = json.data.user;
  const cc = u.contributionsCollection;

  const weeks: Day[][] = cc.contributionCalendar.weeks.map(
    (w: { contributionDays: { date: string; contributionCount: number; contributionLevel: string }[] }) =>
      w.contributionDays.map((d) => ({
        date: d.date,
        count: d.contributionCount,
        level: LEVELS[d.contributionLevel] ?? 0,
      })),
  );
  const { current, longest } = computeStreaks(weeks.flat());

  type RawRepo = {
    name: string;
    description: string | null;
    url: string;
    stargazerCount: number;
    forkCount: number;
    primaryLanguage: { name: string; color: string | null } | null;
    languages: { edges: { size: number; node: { name: string; color: string | null } }[] };
  };
  const nodes: RawRepo[] = u.repositories.nodes ?? [];

  const topRepos: RepoInfo[] = nodes.slice(0, 6).map((r) => ({
    name: r.name,
    description: r.description,
    url: r.url,
    stars: r.stargazerCount,
    forks: r.forkCount,
    language: r.primaryLanguage?.name ?? null,
    languageColor: r.primaryLanguage?.color ?? null,
  }));

  const langBytes = new Map<string, { size: number; color: string }>();
  for (const r of nodes) {
    for (const e of r.languages.edges) {
      const cur = langBytes.get(e.node.name);
      langBytes.set(e.node.name, { size: (cur?.size ?? 0) + e.size, color: e.node.color ?? '#8b949e' });
    }
  }
  const totalBytes = [...langBytes.values()].reduce((s, l) => s + l.size, 0) || 1;
  const languages: LangInfo[] = [...langBytes.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 6)
    .map(([name, l]) => ({ name, color: l.color, percent: Math.round((l.size / totalBytes) * 1000) / 10 }));

  return {
    username: u.login,
    name: u.name || u.login,
    avatar: u.avatarUrl,
    bio: u.bio,
    followers: u.followers.totalCount,
    following: u.following.totalCount,
    publicRepos: u.repositories.totalCount,
    totalStars: nodes.reduce((s, r) => s + r.stargazerCount, 0),
    totalContributions: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions,
    pullRequests: cc.totalPullRequestContributions,
    issues: cc.totalIssueContributions,
    currentStreak: current,
    longestStreak: longest,
    weeks,
    topRepos,
    languages,
    demo: false,
    fetchedAt: new Date().toISOString(),
  };
}

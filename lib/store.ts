import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { Plan } from './plans';
import { todayISO } from './format';

/**
 * Datastore for analytics + licenses. Two interchangeable backends behind one interface:
 *
 *  - Upstash Redis (REST) — used automatically when UPSTASH_REDIS_REST_URL / _TOKEN
 *    (or Vercel's KV_REST_API_URL / _TOKEN) are set. Required on Vercel and other serverless hosts.
 *  - JSON file — zero-config fallback for local dev and single-server hosts with a persistent disk.
 *
 * Everything else in the app only calls the exported functions at the bottom of this file.
 */

export interface LicenseRecord {
  keyHash: string;
  key: string;
  username: string;
  plan: Plan;
  status: 'active' | 'revoked';
  sessionId?: string;
  subscriptionId?: string;
  createdAt: string;
}

export interface AnalyticsSummary {
  total: number;
  last30: { date: string; views: number }[];
  last30Total: number;
  referrers: { host: string; views: number }[];
}

type NewLicense = Omit<LicenseRecord, 'keyHash' | 'createdAt' | 'status'>;

export const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

const last30Days = () =>
  Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });

function summarise(total: number, byDay: Record<string, number>, refs: Record<string, number>): AnalyticsSummary {
  const last30 = last30Days().map((date) => ({ date, views: byDay[date] ?? 0 }));
  return {
    total,
    last30,
    last30Total: last30.reduce((s, d) => s + d.views, 0),
    referrers: Object.entries(refs)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8)
      .map(([host, views]) => ({ host, views })),
  };
}

const MAX_REFERRERS = 200;

/* ==========================================================================
   Backend 1: Upstash Redis over REST (no SDK needed, works on edge + serverless)
   ========================================================================== */

const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const useRedis = Boolean(REST_URL && REST_TOKEN);

type Cmd = (string | number)[];

async function rest<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${REST_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Upstash request failed (${res.status})`);
  return (await res.json()) as T;
}

async function cmd<T = unknown>(...args: Cmd): Promise<T> {
  const j = await rest<{ result: T; error?: string }>('', args);
  if (j.error) throw new Error(`Upstash: ${j.error}`);
  return j.result;
}

async function pipeline(cmds: Cmd[]): Promise<unknown[]> {
  const out = await rest<{ result?: unknown; error?: string }[]>('/pipeline', cmds);
  return out.map((o) => {
    if (o.error) throw new Error(`Upstash: ${o.error}`);
    return o.result;
  });
}

const pairs = (flat: unknown): Record<string, number> => {
  const o: Record<string, number> = Object.create(null);
  const a = (flat as string[] | null) ?? [];
  for (let i = 0; i < a.length; i += 2) o[a[i]] = Number(a[i + 1]);
  return o;
};

// Adds a referrer only if it already exists or there is still room (caps hash growth from spam).
const HINCR_CAPPED = `if redis.call('HEXISTS',KEYS[1],ARGV[1])==1 or redis.call('HLEN',KEYS[1])<tonumber(ARGV[2]) then return redis.call('HINCRBY',KEYS[1],ARGV[1],1) end return 0`;

// Reserve the session and write its license/indexes atomically across webhook retries/instances.
const SAVE_LICENSE = `
if ARGV[3]=='1' and redis.call('EXISTS',KEYS[3])==1 then return 0 end
redis.call('SET',KEYS[1],ARGV[1])
redis.call('SADD',KEYS[2],ARGV[2])
if ARGV[3]=='1' then redis.call('SET',KEYS[3],ARGV[2]) end
if ARGV[4]=='1' then redis.call('SADD',KEYS[4],ARGV[2]) end
return 1`;

const K = {
  total: (u: string) => `dp:a:${u}:total`,
  days: (u: string) => `dp:a:${u}:days`,
  refs: (u: string) => `dp:a:${u}:refs`,
  lic: (h: string) => `dp:l:${h}`,
  bySession: (s: string) => `dp:ls:${s}`,
  byUser: (u: string) => `dp:lu:${u}`,
  bySub: (s: string) => `dp:lsub:${s}`,
};

const redisStore = {
  async recordView(username: string, host: string) {
    const u = username.toLowerCase();
    await pipeline([
      ['INCR', K.total(u)],
      ['HINCRBY', K.days(u), todayISO(), 1],
      ['EXPIRE', K.days(u), 60 * 60 * 24 * 400],
      ['EVAL', HINCR_CAPPED, 1, K.refs(u), host, MAX_REFERRERS],
    ]);
  },

  async getAnalytics(username: string): Promise<AnalyticsSummary> {
    const u = username.toLowerCase();
    const [total, days, refs] = await pipeline([['GET', K.total(u)], ['HGETALL', K.days(u)], ['HGETALL', K.refs(u)]]);
    return summarise(Number(total ?? 0), pairs(days), pairs(refs));
  },

  async saveLicense(rec: NewLicense) {
    const keyHash = hashKey(rec.key);
    const full: LicenseRecord = { ...rec, username: rec.username.toLowerCase(), keyHash, status: 'active', createdAt: new Date().toISOString() };
    await cmd('EVAL', SAVE_LICENSE, 4, K.lic(keyHash), K.byUser(full.username),
      full.sessionId ? K.bySession(full.sessionId) : '', full.subscriptionId ? K.bySub(full.subscriptionId) : '',
      JSON.stringify(full), keyHash, full.sessionId ? '1' : '0', full.subscriptionId ? '1' : '0');
  },

  async getLicenseByHash(hash: string): Promise<LicenseRecord | undefined> {
    const raw = await cmd<string | null>('GET', K.lic(hash));
    return raw ? (JSON.parse(raw) as LicenseRecord) : undefined;
  },

  async getLicenseByKey(key: string) {
    return redisStore.getLicenseByHash(hashKey(key));
  },

  async getLicenseBySession(sessionId: string) {
    const hash = await cmd<string | null>('GET', K.bySession(sessionId));
    return hash ? redisStore.getLicenseByHash(hash) : undefined;
  },

  async hasActiveLicense(username: string) {
    const hashes = await cmd<string[]>('SMEMBERS', K.byUser(username.toLowerCase()));
    if (!hashes?.length) return false;
    const raws = await cmd<(string | null)[]>('MGET', ...hashes.map(K.lic));
    return raws.some((r) => r && (JSON.parse(r) as LicenseRecord).status === 'active');
  },

  async revokeBySubscription(subscriptionId: string) {
    const hashes = await cmd<string[]>('SMEMBERS', K.bySub(subscriptionId));
    if (!hashes?.length) return;
    const raws = await cmd<(string | null)[]>('MGET', ...hashes.map(K.lic));
    const sets: Cmd[] = [];
    raws.forEach((r, i) => {
      if (!r) return;
      const rec = JSON.parse(r) as LicenseRecord;
      rec.status = 'revoked';
      sets.push(['SET', K.lic(hashes[i]), JSON.stringify(rec)]);
    });
    if (sets.length) await pipeline(sets);
  },
};

/* ==========================================================================
   Backend 2: JSON file (local dev / single server with a persistent disk)
   ========================================================================== */

interface FileAnalytics { total: number; byDay: Record<string, number>; refs: Record<string, number> }
interface DB { analytics: Record<string, FileAnalytics>; licenses: Record<string, LicenseRecord> }

const dir = process.env.DATA_DIR || (process.env.VERCEL ? os.tmpdir() : path.join(process.cwd(), '.data'));
const file = path.join(dir, 'devpulse.json');

let cache: DB | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<DB> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(file, 'utf8')) as DB;
  } catch {
    cache = { analytics: {}, licenses: {} };
  }
  return cache;
}

/** Serialises read-modify-write cycles so concurrent requests don't clobber each other. */
function mutate<T>(fn: (db: DB) => T): Promise<T> {
  const run = queue.then(async () => {
    const db = await load();
    const result = fn(db);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(db));
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

const fileStore = {
  async recordView(username: string, host: string) {
    const u = username.toLowerCase();
    await mutate((db) => {
      const a = Object.prototype.hasOwnProperty.call(db.analytics, u)
        ? db.analytics[u]
        : (db.analytics[u] = { total: 0, byDay: {}, refs: {} });
      a.total += 1;
      const day = todayISO();
      a.byDay[day] = (a.byDay[day] ?? 0) + 1;
      const ownsRef = Object.prototype.hasOwnProperty.call(a.refs, host);
      if (ownsRef || Object.keys(a.refs).length < MAX_REFERRERS) {
        Object.defineProperty(a.refs, host, { value: (ownsRef ? a.refs[host] : 0) + 1, writable: true, enumerable: true, configurable: true });
      }
    });
  },

  async getAnalytics(username: string): Promise<AnalyticsSummary> {
    const analytics = (await load()).analytics;
    const u = username.toLowerCase();
    const a = Object.prototype.hasOwnProperty.call(analytics, u) ? analytics[u] : { total: 0, byDay: {}, refs: {} };
    return summarise(a.total, a.byDay, a.refs);
  },

  async saveLicense(rec: NewLicense) {
    await mutate((db) => {
      if (rec.sessionId && Object.values(db.licenses).some((l) => l.sessionId === rec.sessionId)) return;
      const keyHash = hashKey(rec.key);
      db.licenses[keyHash] = { ...rec, username: rec.username.toLowerCase(), keyHash, status: 'active', createdAt: new Date().toISOString() };
    });
  },

  async getLicenseByKey(key: string) {
    return (await load()).licenses[hashKey(key)];
  },

  async getLicenseBySession(sessionId: string) {
    return Object.values((await load()).licenses).find((l) => l.sessionId === sessionId);
  },

  async hasActiveLicense(username: string) {
    const u = username.toLowerCase();
    return Object.values((await load()).licenses).some((l) => l.username === u && l.status === 'active');
  },

  async revokeBySubscription(subscriptionId: string) {
    await mutate((db) => {
      for (const l of Object.values(db.licenses)) if (l.subscriptionId === subscriptionId) l.status = 'revoked';
    });
  },
};

/* ==========================================================================
   Public interface
   ========================================================================== */

if (!useRedis && process.env.VERCEL && process.env.NODE_ENV === 'production') {
  console.warn('[devpulse] No Upstash Redis configured: licenses and analytics will NOT persist on Vercel. See README.');
}

const backend = useRedis ? redisStore : fileStore;

export const recordView = (username: string, referrerHost: string) => backend.recordView(username, referrerHost);
export const getAnalytics = (username: string) => backend.getAnalytics(username);
export async function saveLicense(rec: NewLicense): Promise<void> {
  await backend.saveLicense(rec);
  forgetProCache(rec.username);
}
export const getLicenseByKey = (key: string) => backend.getLicenseByKey(key);
export const getLicenseBySession = (sessionId: string) => backend.getLicenseBySession(sessionId);
export async function revokeBySubscription(subscriptionId: string): Promise<void> {
  await backend.revokeBySubscription(subscriptionId);
  proCache.clear(); // we don't know which username(s) were affected
}

// hasActiveLicense runs on every widget render, so remember answers briefly. Revocations apply within a minute.
const PRO_TTL_MS = 60_000;
const proCache = new Map<string, { at: number; pro: boolean }>();

export async function hasActiveLicense(username: string): Promise<boolean> {
  const u = username.toLowerCase();
  const hit = proCache.get(u);
  if (hit && Date.now() - hit.at < PRO_TTL_MS) return hit.pro;
  const pro = await backend.hasActiveLicense(u);
  if (proCache.size > 2000) proCache.clear();
  proCache.set(u, { at: Date.now(), pro });
  return pro;
}

/** Call after issuing a license so the new Pro status is visible immediately on this instance. */
export function forgetProCache(username: string) {
  proCache.delete(username.toLowerCase());
}

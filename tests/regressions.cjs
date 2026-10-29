const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devpulse-tests-'));
process.env.DATA_DIR = tmp;
process.env.GITHUB_TOKEN = 'test-fixture-only';
process.env.LICENSE_SECRET = 'test-license-secret-with-32-characters';
process.env.STRIPE_WEBHOOK_SECRET = 'test-webhook-secret';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;
const originalFetch = global.fetch;
const modules = new Map();
function load(name) {
  const file = path.resolve(root, name);
  if (modules.has(file)) return modules.get(file).exports;
  const mod = { exports: {} };
  modules.set(file, mod);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const localRequire = id => {
    if (id.startsWith('@/') || id.startsWith('.')) {
      const p = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      return load(p + (path.extname(p) ? '' : '.ts'));
    }
    return require(id);
  };
  new Function('require', 'module', 'exports', source)(localRequire, mod, mod.exports);
  return mod.exports;
}
after(() => { global.fetch = originalFetch; fs.rmSync(tmp, { recursive: true, force: true }); });
const post = body => new Request('http://localhost/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fixtureUser = username => ({ login: username, name: 'Fixture User', avatarUrl: 'https://avatars.githubusercontent.com/u/1', bio: null,
  followers: { totalCount: 1 }, following: { totalCount: 2 }, repositories: { totalCount: 0, nodes: [] },
  contributionsCollection: { totalCommitContributions: 1, totalPullRequestContributions: 0, totalIssueContributions: 0,
    contributionCalendar: { totalContributions: 1, weeks: [{ contributionDays: [{ date: '2026-10-29', contributionCount: 1, contributionLevel: 'FIRST_QUARTILE' }] }] } } });
const github = load('lib/github.ts');

test('GitHub query uses the real ownerAffiliations argument and public repo filter', async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.github.com/graphql');
    const body = JSON.parse(options.body);
    assert.match(body.query, /ownerAffiliations:\s*\[OWNER\]/);
    assert.doesNotMatch(body.query, /ownerAffiliation:/);
    assert.match(body.query, /privacy: PUBLIC/);
    assert.equal(body.variables.login, 'ItzPranav61');
    return Response.json({ data: { user: fixtureUser('ItzPranav61') } });
  };
  const data = await github.getActivity('ItzPranav61');
  assert.equal(data.username, 'ItzPranav61');
  assert.equal(data.demo, false);
});

test('GraphQL validation/auth errors are not mislabeled as missing users', async () => {
  global.fetch = async () => Response.json({ errors: [{ message: 'Unexpected upstream details', extensions: { code: 'argumentNotAccepted' } }] });
  await assert.rejects(github.getActivity('validation-user'), e => e.status === 502 && !e.message.includes('not found') && !e.message.includes('upstream details'));
  global.fetch = async () => Response.json({ data: {} });
  await assert.rejects(github.getActivity('malformed-user'), e => e.status === 502);
});

test('a genuine missing GitHub user still returns 404', async () => {
  global.fetch = async () => Response.json({ data: { user: null }, errors: [{ type: 'NOT_FOUND', path: ['user'] }] });
  await assert.rejects(github.getActivity('missing-user'), e => e.status === 404);
});

test('GitHub HTTP failures retain service/auth statuses', async () => {
  for (const [status, expected] of [[401, 502], [403, 503], [429, 503], [500, 502]]) {
    global.fetch = async () => new Response('', { status });
    await assert.rejects(github.getActivity(`http-${status}`), e => e.status === expected);
  }
});

test('profile URLs and handles normalize safely; other hosts and injected snippets are rejected', () => {
  const { normalizeUsername } = load('lib/username.ts');
  for (const value of ['ItzPranav61', ' @ItzPranav61 ', 'https://github.com/ItzPranav61', 'github.com/ItzPranav61/', 'https://www.github.com/ItzPranav61?tab=repositories']) {
    assert.equal(normalizeUsername(value), 'ItzPranav61');
  }
  for (const value of ['https://github.com.evil.test/a', 'https://evil.test/a', 'https://github.com/a/repo', 'https://user:pass@github.com/a', 'a" onload="alert(1)', '<script>', 'a--b', '']) {
    assert.equal(normalizeUsername(value), '');
  }
});

test('checkout rejects malformed bodies, inherited plan names and non-string usernames', async () => {
  const { POST } = load('app/api/checkout/route.ts');
  for (const body of [null, [], { plan: 'constructor', username: 'octocat' }, { plan: '__proto__', username: 'octocat' }, { plan: 'monthly', username: {} }]) {
    assert.equal((await POST(post(body))).status, 400);
  }
});

test('prototype-name usernames and referrers cannot corrupt analytics', async () => {
  const store = load('lib/store.ts');
  for (const username of ['constructor', 'toString', 'hasOwnProperty']) {
    await store.recordView(username, 'constructor');
    await store.recordView(username, '__proto__');
    const stats = await store.getAnalytics(username);
    assert.equal(stats.total, 2);
    assert.deepEqual(stats.referrers.map(r => r.views), [1, 1]);
  }
  assert.equal(Object.prototype.total, undefined);
});

function webhookRequest(object, type = 'checkout.session.completed') {
  const raw = JSON.stringify({ type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return new Request('http://localhost/api/webhook/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw });
}
test('invalid Unicode webhook signatures return 400 without crashing', async () => {
  const { POST } = load('app/api/webhook/stripe/route.ts');
  const response = await POST(new Request('http://localhost/api/webhook/stripe', { method: 'POST', headers: { 'stripe-signature': `t=${Math.floor(Date.now()/1000)},v1=${'é'.repeat(64)}` }, body: '{}' }));
  assert.equal(response.status, 400);
});

test('Stripe fulfillment rejects unconfirmed payments and unknown/mismatched plans', async () => {
  const { POST } = load('app/api/webhook/stripe/route.ts');
  const store = load('lib/store.ts');
  const base = { id: 'cs_bad', metadata: { username: 'octocat', plan: 'lifetime' }, mode: 'payment' };
  for (const change of [{}, { payment_status: 'unpaid' }, { payment_status: 'paid', metadata: { username: 'octocat', plan: 'other' } }, { payment_status: 'paid', mode: 'subscription' }]) {
    assert.equal((await POST(webhookRequest({ ...base, ...change }))).status, 200);
    assert.equal(await store.getLicenseBySession(base.id), undefined);
  }
});

test('paid webhook retries preserve the same key; failed subscriptions revoke access', async () => {
  const { POST } = load('app/api/webhook/stripe/route.ts');
  const store = load('lib/store.ts');
  const license = load('lib/license.ts');
  const object = { id: 'cs_valid', metadata: { username: 'octocat', plan: 'monthly' }, mode: 'subscription', payment_status: 'paid', subscription: 'sub_fixture' };
  assert.equal((await POST(webhookRequest(object))).status, 200);
  const first = await store.getLicenseBySession(object.id);
  await POST(webhookRequest(object));
  assert.equal((await store.getLicenseBySession(object.id)).key, first.key);
  assert.equal((await license.verifyLicense(first.key, 'octocat')).valid, true);
  await POST(webhookRequest({ id: 'sub_fixture', status: 'unpaid' }, 'customer.subscription.updated'));
  assert.equal((await license.verifyLicense(first.key, 'octocat')).valid, false);
});

test('concurrent fulfillment cannot store multiple licenses for one session', async () => {
  const store = load('lib/store.ts');
  await Promise.all(['one', 'two'].map(key => store.saveLicense({ key, username: 'testuser', plan: 'lifetime', sessionId: 'cs_concurrent' })));
  const db = JSON.parse(fs.readFileSync(path.join(tmp, 'devpulse.json'), 'utf8'));
  assert.equal(Object.values(db.licenses).filter(l => l.sessionId === 'cs_concurrent').length, 1);
});

test('rate-limit map refuses new buckets at capacity and preserves existing budgets', () => {
  const { rateLimit } = load('lib/ratelimit.ts');
  assert.equal(rateLimit('existing', 1), true);
  for (let i = 0; i < 5500; i++) rateLimit(`flood:${i}`);
  assert.equal(rateLimit('extra'), false);
  assert.equal(rateLimit('existing', 1), false);
});

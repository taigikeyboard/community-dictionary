import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { entryKey, serializeEntry } from '../lib/entry.js';
import worker from '../worker/src/index.js';
import { clearTokenCache } from '../worker/src/github.js';
import { sign } from '../worker/src/session.js';
import { accentEntry, KEY } from './fixtures.js';

// Worker end to end against an in-memory GitHub: sign-in, new / edit / withdraw, caps, ownership.

const REPO = 'taigikeyboard/community-dictionary';
const SITE = 'https://taigikeyboard.tw';
const WORKER = 'https://dict-api.taigikeyboard.tw';
const USER = { id: 583231, login: 'octocat' };
const OTHER = { id: 1, login: 'someone' };

async function pkcs8Pem() {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`;
}

const env = {
  GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'secret',
  GITHUB_APP_PRIVATE_KEY: await pkcs8Pem(),
  SESSION_KEY: 'test-session-key',
  GITHUB_REPO: REPO,
  BASE_BRANCH: 'main',
  SITE_ORIGINS: SITE,
  SITE_URL: `${SITE}/community-dictionary/`,
  CAP_PER_CONTRIBUTOR: '5',
  CAP_TOTAL: '100',
};

// Branches hold whole file maps; a commit records its author. Enough of the REST API for the Worker.
function fakeGitHub() {
  const gh = {
    branches: new Map([['main', new Map()]]),
    commits: [],
    pulls: [],
    calls: [],
  };
  const blobs = new Map();
  const b64 = (text) => Buffer.from(text).toString('base64');
  const reply = (status, data) => new Response(data === undefined ? null : JSON.stringify(data), { status });
  const shaOf = (text) => `sha-${Buffer.from(text).toString('hex').slice(0, 40)}`;

  gh.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = url.pathname;
    gh.calls.push(`${method} ${path}`);

    if (url.host === 'github.com' && path === '/login/oauth/access_token') {
      return reply(200, body.code === 'good' && body.code_verifier ? { access_token: 'user-token' } : { error: 'bad_verification_code' });
    }
    if (path === '/user') return reply(200, init.headers.Authorization === 'Bearer user-token' ? USER : {});
    if (path === `/repos/${REPO}/installation`) return reply(200, { id: 42 });
    if (path === '/app/installations/42/access_tokens') {
      return reply(201, { token: 'inst-token', expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    assert.equal(init.headers.Authorization, 'Bearer inst-token', `${method} ${path} must use the installation token`);
    const rest = path.slice(`/repos/${REPO}`.length);

    if (rest === '/pulls' && method === 'GET') {
      const page = Number(url.searchParams.get('page'));
      return reply(200, gh.pulls.filter((p) => p.state === 'open').slice((page - 1) * 100, page * 100));
    }
    if (rest === '/pulls' && method === 'POST') {
      const pr = { number: gh.pulls.length + 1, state: 'open', title: body.title, body: body.body, html_url: `https://github.com/${REPO}/pull/${gh.pulls.length + 1}`, head: { ref: body.head, repo: { full_name: REPO } } };
      gh.pulls.push(pr);
      return reply(201, pr);
    }
    let m;
    if ((m = /^\/pulls\/(\d+)\/files$/.exec(rest))) {
      const pr = gh.pulls[Number(m[1]) - 1];
      const head = gh.branches.get(pr.head.ref);
      const base = gh.branches.get('main');
      const files = [];
      for (const p of new Set([...head.keys(), ...base.keys()])) {
        if (!base.has(p)) files.push({ filename: p, status: 'added' });
        else if (!head.has(p)) files.push({ filename: p, status: 'removed' });
        else if (base.get(p) !== head.get(p)) files.push({ filename: p, status: 'modified' });
      }
      return reply(200, files);
    }
    if ((m = /^\/git\/trees\/(.+)$/.exec(rest))) {
      const files = gh.branches.get(m[1]);
      return reply(200, {
        truncated: false,
        tree: [...files].map(([p, text]) => {
          blobs.set(shaOf(text), text);
          return { path: p, type: 'blob', sha: shaOf(text) };
        }),
      });
    }
    if ((m = /^\/git\/blobs\/(.+)$/.exec(rest))) return reply(200, { content: b64(blobs.get(m[1])) });
    if ((m = /^\/git\/refs?\/heads\/(.+)$/.exec(rest))) {
      if (method === 'GET') return reply(200, { object: { sha: `main@${gh.commits.length}` } });
      gh.branches.set(m[1], new Map(gh.branches.get('main')));
      return reply(200, {});
    }
    if (rest === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (gh.branches.has(name)) return reply(422, { message: 'Reference already exists' });
      gh.branches.set(name, new Map(gh.branches.get('main')));
      return reply(201, {});
    }
    if ((m = /^\/contents\/(.+)$/.exec(rest))) {
      const filePath = m[1];
      if (method === 'GET') {
        const text = gh.branches.get(url.searchParams.get('ref'))?.get(filePath);
        return text === undefined ? reply(404, { message: 'Not Found' }) : reply(200, { sha: shaOf(text), content: b64(text) });
      }
      const files = gh.branches.get(body.branch);
      if (files.has(filePath) && body.sha !== shaOf(files.get(filePath))) return reply(409, { message: 'sha mismatch' });
      if (method === 'PUT') files.set(filePath, Buffer.from(body.content, 'base64').toString());
      else files.delete(filePath);
      gh.commits.push({ branch: body.branch, method, path: filePath, author: body.author, message: body.message });
      return reply(200, {});
    }
    return reply(404, { message: `fake GitHub: no route ${method} ${path}` });
  };
  return gh;
}

let gh;
const realFetch = globalThis.fetch;
beforeEach(() => {
  gh = fakeGitHub();
  globalThis.fetch = gh.fetch;
  clearTokenCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function sessionCookie(user = USER) {
  return `session=${await sign(env.SESSION_KEY, { ...user, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
}

async function post(path, body, { origin = SITE, user = USER } = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  if (user) headers.Cookie = await sessionCookie(user);
  const res = await worker.fetch(new Request(`${WORKER}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json(), headers: res.headers };
}

const form = { accents: ['鹿港偏泉腔'], tags: ['食食'], place: '', meaning: '', example: '', note: '鹿港講 pueh。' };

describe('sign-in', () => {
  it('runs the PKCE flow and sets a session for the GitHub user', async () => {
    const start = await worker.fetch(new Request(`${WORKER}/login?return=%23%2Fsubmit`), env);
    assert.equal(start.status, 302);
    const authorize = new URL(start.headers.get('Location'));
    assert.equal(authorize.origin + authorize.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.get('code_challenge').length, 43);
    assert.equal(authorize.searchParams.get('redirect_uri'), `${WORKER}/callback`);
    const oauth = start.headers.get('Set-Cookie').split(';')[0];
    assert.match(start.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);

    const state = authorize.searchParams.get('state');
    const done = await worker.fetch(new Request(`${WORKER}/callback?code=good&state=${state}`, { headers: { Cookie: oauth } }), env);
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('Location'), `${SITE}/community-dictionary/#/submit`);
    const session = done.headers.getSetCookie().find((c) => c.startsWith('session=')).split(';')[0];

    const me = await worker.fetch(new Request(`${WORKER}/session`, { headers: { Cookie: session, Origin: SITE } }), env);
    assert.deepEqual(await me.json(), USER);
    assert.equal(me.headers.get('Access-Control-Allow-Origin'), SITE);
    assert.equal(me.headers.get('Access-Control-Allow-Credentials'), 'true');
  });

  it('ends signed out when the state does not match', async () => {
    const start = await worker.fetch(new Request(`${WORKER}/login`), env);
    const oauth = start.headers.get('Set-Cookie').split(';')[0];
    const done = await worker.fetch(new Request(`${WORKER}/callback?code=good&state=forged`, { headers: { Cookie: oauth } }), env);
    assert.equal(done.headers.get('Location'), `${SITE}/community-dictionary/#/`);
    assert.ok(!done.headers.getSetCookie().some((c) => c.startsWith('session=') && !c.startsWith('session=;')));
    assert.ok(!gh.calls.includes('POST /login/oauth/access_token'));
  });

  it('never returns to a page outside the site', async () => {
    const start = await worker.fetch(new Request(`${WORKER}/login?return=https://evil.example`), env);
    const oauth = start.headers.get('Set-Cookie').split(';')[0];
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const done = await worker.fetch(new Request(`${WORKER}/callback?code=good&state=${state}`, { headers: { Cookie: oauth } }), env);
    assert.equal(done.headers.get('Location'), `${SITE}/community-dictionary/#/`);
  });

  it('rejects a forged session', async () => {
    const res = await worker.fetch(new Request(`${WORKER}/session`, { headers: { Cookie: `session=${await sign('wrong-key', { ...USER, exp: 9e9 })}` } }), env);
    assert.equal(res.status, 401);
  });
});

describe('POST guards', () => {
  it('refuses other origins before anything else', async () => {
    const res = await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form }, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'forbidden_origin');
    assert.equal(gh.calls.length, 0);
  });

  it('refuses a signed-out contributor', async () => {
    const res = await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form }, { user: null });
    assert.equal(res.status, 401);
  });

  it('reports invalid fields without calling GitHub', async () => {
    const res = await post('/submit', { words: [{ hanji: '八', tl: '' }], ...form });
    assert.equal(res.status, 400);
    assert.deepEqual(res.data.errors, ['words[0].tl: required']);
    assert.equal(gh.calls.length, 0);
  });

  it('logs out by clearing the cookie', async () => {
    const res = await post('/logout', {});
    assert.match(res.headers.get('Set-Cookie'), /^session=; Path=\/; Max-Age=0/);
  });
});

describe('new submission', () => {
  it('commits one file per word as the contributor and opens one pull request', async () => {
    const res = await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }, { hanji: '', tl: 'sim-mih' }], ...form });
    assert.equal(res.status, 200);
    assert.equal(res.data.pullRequest.url, `https://github.com/${REPO}/pull/1`);

    const pr = gh.pulls[0];
    assert.equal(pr.title, 'add 2 words');
    assert.equal(pr.head.ref, `submit/${USER.id}/${KEY}`);
    assert.match(pr.body, /CC0 1\.0/);
    const branch = gh.branches.get(pr.head.ref);
    // The stored file equals the fixture entry, except the date the Worker stamps.
    const stored = JSON.parse(branch.get(`entries/octocat/${KEY}.json`));
    assert.equal(branch.get(`entries/octocat/${KEY}.json`), serializeEntry({ ...accentEntry(), submitted: stored.submitted }));
    assert.match(stored.submitted, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(branch.has(`entries/octocat/${await entryKey('', 'sim-mih')}.json`));
    assert.ok(gh.commits.every((c) => c.author.email === '583231+octocat@users.noreply.github.com'));
    assert.equal(gh.branches.get('main').size, 0);
  });

  it('takes identity from the session, not the form', async () => {
    await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form, contributor: 'mallory', contributor_id: 7 });
    const stored = JSON.parse(gh.branches.get(gh.pulls[0].head.ref).get(`entries/octocat/${KEY}.json`));
    assert.equal(stored.contributor_id, USER.id);
  });

  it('refuses a pair the contributor already holds, on main or in an open submission', async () => {
    await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form });
    const again = await post('/submit', { words: [{ hanji: '八', tl: 'Pueh' }], ...form });
    assert.equal(again.status, 409);
    assert.deepEqual(again.data, { error: 'already_submitted', keys: [KEY] });

    gh.branches.get('main').set(`entries/old-login/${KEY}.json`, serializeEntry(accentEntry()));
    gh.pulls[0].state = 'closed';
    const onMain = await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form });
    assert.equal(onMain.status, 409);
  });

  it('accepts the same pair from a second contributor', async () => {
    gh.branches.get('main').set(`entries/someone/${KEY}.json`, serializeEntry({ ...accentEntry(), contributor: 'someone', contributor_id: 1 }));
    const res = await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form });
    assert.equal(res.status, 200);
  });

  it('enforces the per-contributor and total caps', async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await post('/submit', { words: [{ hanji: '', tl: `tsit${i}` }], ...form })).status, 200);
    }
    const sixth = await post('/submit', { words: [{ hanji: '', tl: 'tsit9' }], ...form });
    assert.deepEqual([sixth.status, sixth.data.error], [429, 'cap_contributor']);

    const full = { ...env, CAP_TOTAL: '5' };
    const res = await worker.fetch(
      new Request(`${WORKER}/submit`, { method: 'POST', headers: { Origin: SITE, Cookie: await sessionCookie(OTHER) }, body: JSON.stringify({ words: [{ tl: 'a' }], ...form }) }),
      full,
    );
    assert.equal((await res.json()).error, 'cap_total');
  });

  it('reuses a leftover branch from a closed pull request', async () => {
    await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form });
    gh.pulls[0].state = 'closed';
    gh.branches.get(gh.pulls[0].head.ref).set('stale.txt', 'x');
    const res = await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form });
    assert.equal(res.status, 200);
    assert.ok(!gh.branches.get(gh.pulls[1].head.ref).has('stale.txt'));
  });
});

describe('edit and withdraw', () => {
  const path = `entries/octocat/${KEY}.json`;
  beforeEach(() => gh.branches.get('main').set(path, serializeEntry(accentEntry())));

  it('edits a field in place', async () => {
    const res = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: '鹿港講 peh。' });
    assert.equal(res.status, 200);
    const pr = gh.pulls[0];
    assert.equal(pr.title, 'edit 八 pueh');
    assert.equal(JSON.parse(gh.branches.get(pr.head.ref).get(path)).note, '鹿港講 peh。');
  });

  it('moves a changed pair to a new file, then deletes the old one', async () => {
    await post('/submit', { path, hanji: '捌', tl: 'pueh', ...form });
    const newPath = `entries/octocat/${await entryKey('捌', 'pueh')}.json`;
    assert.deepEqual(gh.commits.map((c) => [c.method, c.path]), [['PUT', newPath], ['DELETE', path]]);
  });

  it('adds a second edit to the open pull request', async () => {
    await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: 'one' });
    const res = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: 'two' });
    assert.equal(res.data.pullRequest.number, 1);
    assert.equal(gh.pulls.length, 1);
    assert.equal(JSON.parse(gh.branches.get(gh.pulls[0].head.ref).get(path)).note, 'two');
  });

  it('refuses an unchanged edit', async () => {
    const res = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form });
    assert.deepEqual([res.status, res.data.error], [400, 'unchanged']);
  });

  it('refuses edits and withdrawals of another contributor’s entry', async () => {
    const edit = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: 'x' }, { user: OTHER });
    const gone = await post('/withdraw', { path }, { user: OTHER });
    assert.deepEqual([edit.status, gone.status], [403, 403]);
    assert.equal(gh.commits.length, 0);
  });

  it('withdraws by deleting the file in a pull request', async () => {
    const res = await post('/withdraw', { path });
    assert.equal(res.status, 200);
    assert.equal(gh.pulls[0].title, 'withdraw 八 pueh');
    assert.ok(!gh.branches.get(gh.pulls[0].head.ref).has(path));
    assert.ok(gh.branches.get('main').has(path));
  });

  it('answers not_found for a missing file and invalid for a bad path', async () => {
    const missing = await post('/withdraw', { path: 'entries/octocat/ffffffffffffffff.json' });
    const bad = await post('/withdraw', { path: '../etc/passwd' });
    assert.deepEqual([missing.status, bad.status], [404, 400]);
  });
});

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { entryKey, serializeEntry } from '../lib/entry.js';
import worker from '../worker/src/index.js';
import { clearTokenCache } from '../worker/src/github.js';
import { sign } from '../worker/src/session.js';
import { accentEntry, KEY } from './fixtures.js';

// Worker end to end against an in-memory GitHub: sign-in, new / edit, caps, ownership, own submissions.

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

// Git objects in memory: refs → commits → trees (file maps). `gh.branches.get(name)` is the file
// map at a branch tip (mutate main's to seed it); `gh.commits` lists the commits the Worker made,
// each with the tree changes it carried. Enough of the REST API for the Worker.
function fakeGitHub() {
  const trees = new Map([['t0', new Map()]]);
  const objects = new Map([['c0', { tree: 't0', parents: [] }]]);
  const refs = new Map([['main', 'c0']]);
  const treeChanges = new Map();
  const gh = {
    branches: { get: (name) => (refs.has(name) ? trees.get(objects.get(refs.get(name)).tree) : undefined) },
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
      assert.ok(refs.has(body.head), `pull request head ${body.head} must exist`);
      const pr = { number: gh.pulls.length + 1, state: 'open', title: body.title, body: body.body, html_url: `https://github.com/${REPO}/pull/${gh.pulls.length + 1}`, head: { ref: body.head, repo: { full_name: REPO } } };
      gh.pulls.push(pr);
      return reply(201, pr);
    }
    let m;
    // one pull request, with how many commits its branch has on top of main
    if ((m = /^\/pulls\/(\d+)$/.exec(rest)) && method === 'GET') {
      const pr = gh.pulls[Number(m[1]) - 1];
      let commits = 0;
      for (let sha = refs.get(pr.head.ref); sha && sha !== refs.get('main'); sha = objects.get(sha).parents[0]) commits += 1;
      return reply(200, { ...pr, commits });
    }
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
    if (rest === '/git/trees' && method === 'POST') {
      const files = new Map(trees.get(body.base_tree));
      for (const item of body.tree) {
        if (item.sha === null) files.delete(item.path);
        else files.set(item.path, item.content);
      }
      const sha = `t${trees.size}`;
      trees.set(sha, files);
      treeChanges.set(sha, body.tree.map((item) => [item.sha === null ? 'delete' : 'write', item.path]));
      return reply(201, { sha });
    }
    if ((m = /^\/git\/trees\/(.+)$/.exec(rest))) {
      return reply(200, {
        truncated: false,
        tree: [...gh.branches.get(m[1])].map(([p, text]) => {
          blobs.set(shaOf(text), text);
          return { path: p, type: 'blob', sha: shaOf(text) };
        }),
      });
    }
    if ((m = /^\/git\/blobs\/(.+)$/.exec(rest))) return reply(200, { content: b64(blobs.get(m[1])) });
    if (rest === '/git/commits' && method === 'POST') {
      const sha = `c${objects.size}`;
      objects.set(sha, { tree: body.tree, parents: body.parents });
      gh.commits.push({ sha, message: body.message, author: body.author, parents: body.parents, changes: treeChanges.get(body.tree) });
      return reply(201, { sha });
    }
    if ((m = /^\/git\/commits\/(.+)$/.exec(rest))) return reply(200, { sha: m[1], tree: { sha: objects.get(m[1]).tree } });
    if ((m = /^\/git\/refs?\/heads\/(.+)$/.exec(rest))) {
      if (!refs.has(m[1])) return reply(404, { message: 'Not Found' });
      if (method === 'GET') return reply(200, { object: { sha: refs.get(m[1]) } });
      if (!body.force && objects.get(body.sha).parents[0] !== refs.get(m[1])) return reply(422, { message: 'Update is not a fast forward' });
      refs.set(m[1], body.sha);
      return reply(200, {});
    }
    if (rest === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (refs.has(name)) return reply(422, { message: 'Reference already exists' });
      refs.set(name, body.sha);
      return reply(201, {});
    }
    if ((m = /^\/contents\/(.+)$/.exec(rest)) && method === 'GET') {
      const text = gh.branches.get(url.searchParams.get('ref'))?.get(m[1]);
      return text === undefined ? reply(404, { message: 'Not Found' }) : reply(200, { sha: shaOf(text), content: b64(text) });
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
  return `__Host-session=${await sign(env.SESSION_KEY, '__Host-session', { ...user, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
}

async function post(path, body, { origin = SITE, user = USER } = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  if (user) headers.Cookie = await sessionCookie(user);
  const res = await worker.fetch(new Request(`${WORKER}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json(), headers: res.headers };
}

const form = { accents: ['鹿港偏泉腔'], tags: ['食食'], place: '', meaning: '', examples: [], note: '鹿港講 pueh。' };

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
    const session = done.headers.getSetCookie().find((c) => c.startsWith('__Host-session=')).split(';')[0];

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
    assert.ok(!done.headers.getSetCookie().some((c) => c.startsWith('__Host-session=') && !c.startsWith('__Host-session=;')));
    assert.ok(!gh.calls.includes('POST /login/oauth/access_token'));
  });

  it('ends signed out, on the site, when GitHub refuses the code', async () => {
    const start = await worker.fetch(new Request(`${WORKER}/login?return=%23%2Ftag%2F食食`), env);
    const oauth = start.headers.get('Set-Cookie').split(';')[0];
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const done = await worker.fetch(new Request(`${WORKER}/callback?code=junk&state=${state}`, { headers: { Cookie: oauth } }), env);
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('Location'), `${SITE}/community-dictionary/#/tag/%E9%A3%9F%E9%A3%9F`);
    assert.ok(!done.headers.getSetCookie().some((c) => c.startsWith('__Host-session=')));
  });

  it('never returns to a page outside the site', async () => {
    const start = await worker.fetch(new Request(`${WORKER}/login?return=https://evil.example`), env);
    const oauth = start.headers.get('Set-Cookie').split(';')[0];
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const done = await worker.fetch(new Request(`${WORKER}/callback?code=good&state=${state}`, { headers: { Cookie: oauth } }), env);
    assert.equal(done.headers.get('Location'), `${SITE}/community-dictionary/#/`);
  });

  it('never accepts the OAuth state cookie as a session', async () => {
    const start = await worker.fetch(new Request(`${WORKER}/login`), env);
    const oauthValue = start.headers.get('Set-Cookie').split(';')[0].slice('__Host-oauth='.length);
    const res = await worker.fetch(new Request(`${WORKER}/session`, { headers: { Cookie: `__Host-session=${oauthValue}` } }), env);
    assert.equal(res.status, 401);
    const submit = await worker.fetch(
      new Request(`${WORKER}/submit`, { method: 'POST', headers: { Origin: SITE, Cookie: `__Host-session=${oauthValue}` }, body: '{}' }),
      env,
    );
    assert.equal(submit.status, 401);
  });

  it('rejects a forged session', async () => {
    const res = await worker.fetch(new Request(`${WORKER}/session`, { headers: { Cookie: `__Host-session=${await sign('wrong-key', '__Host-session', { ...USER, exp: 9e9 })}` } }), env);
    assert.equal(res.status, 401);
  });
});

describe('transport', () => {
  it('sends plain HTTP to HTTPS before any route runs', async () => {
    const res = await worker.fetch(new Request('http://dict-api.taigikeyboard.tw/login?return=%23%2F'), env);
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('Location'), `${WORKER}/login?return=%23%2F`);
    assert.equal(res.headers.get('Set-Cookie'), null);
  });

  it('sets HSTS on every HTTPS response', async () => {
    const res = await worker.fetch(new Request(`${WORKER}/session`), env);
    assert.equal(res.headers.get('Strict-Transport-Security'), 'max-age=31536000; includeSubDomains');
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
    assert.deepEqual(res.data.issues, [{ field: 'words[0].tl', code: 'required' }]);
    assert.equal(gh.calls.length, 0);
  });

  it('refuses an oversized body before reading it', async () => {
    const res = await worker.fetch(
      new Request(`${WORKER}/submit`, { method: 'POST', headers: { Origin: SITE, Cookie: await sessionCookie(), 'Content-Length': '70000' }, body: '{}' }),
      env,
    );
    assert.equal(res.status, 413);
  });

  it('fails closed when a cap is not configured', async () => {
    const res = await worker.fetch(
      new Request(`${WORKER}/submit`, { method: 'POST', headers: { Origin: SITE, Cookie: await sessionCookie() }, body: JSON.stringify({ words: [{ tl: 'a' }], ...form }) }),
      { ...env, CAP_TOTAL: undefined },
    );
    assert.equal(res.status, 502);
    assert.equal(gh.pulls.length, 0);
  });

  it('logs out by clearing the cookie', async () => {
    const res = await post('/logout', {});
    assert.match(res.headers.get('Set-Cookie'), /^__Host-session=; Path=\/; Max-Age=0/);
  });
});

describe('new submission', () => {
  it('commits every word as one file in a single commit by the contributor, in one pull request', async () => {
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
    assert.equal(gh.commits.length, 1);
    assert.equal(gh.commits[0].author.email, '583231+octocat@users.noreply.github.com');
    assert.equal(gh.commits[0].message, 'add 2 words\n\n八 pueh\nsim-mih');
    assert.equal(gh.commits[0].changes.length, 2);
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

async function get(path, { user = USER } = {}) {
  const headers = { Origin: SITE };
  if (user) headers.Cookie = await sessionCookie(user);
  const res = await worker.fetch(new Request(`${WORKER}${path}`, { headers }), env);
  return { status: res.status, data: await res.json(), headers: res.headers };
}

describe('edit', () => {
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
    assert.deepEqual(gh.commits.map((c) => c.changes), [[['write', newPath], ['delete', path]]]);
  });

  it('adds a second edit to the open pull request', async () => {
    await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: 'one' });
    const res = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: 'two' });
    assert.equal(res.data.pullRequest.number, 1);
    assert.equal(gh.pulls.length, 1);
    assert.equal(JSON.parse(gh.branches.get(gh.pulls[0].head.ref).get(path)).note, 'two');
    // The second edit is one more commit on top of the first, on the same branch.
    assert.deepEqual(gh.commits[1].parents, [gh.commits[0].sha]);
  });

  it('refuses an unchanged edit', async () => {
    const res = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form });
    assert.deepEqual([res.status, res.data.error], [400, 'unchanged']);
  });

  it('refuses an edit of another contributor’s entry', async () => {
    const edit = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: 'x' }, { user: OTHER });
    assert.equal(edit.status, 403);
    assert.equal(gh.commits.length, 0);
  });

  it('answers not_found for a missing file and invalid for a bad path', async () => {
    const missing = await post('/submit', { path: 'entries/octocat/ffffffffffffffff.json', hanji: '八', tl: 'pueh', ...form });
    const bad = await post('/submit', { path: '../etc/passwd', hanji: '八', tl: 'pueh', ...form });
    assert.deepEqual([missing.status, bad.status], [404, 400]);
  });

  it('has no withdraw route', async () => {
    const res = await post('/withdraw', { path });
    assert.equal(res.status, 404);
  });

  it('refuses a 21st commit on one open submission', async () => {
    for (let n = 1; n <= 20; n += 1) {
      const res = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: `note ${n}` });
      assert.equal(res.status, 200, `edit ${n}`);
    }
    const over = await post('/submit', { path, hanji: '八', tl: 'pueh', ...form, note: 'note 21' });
    assert.deepEqual([over.status, over.data.error], [429, 'cap_contributor']);
    assert.equal(gh.commits.length, 20);
  });
});

describe('own submissions', () => {
  it('lists the signed-in contributor’s open entries only', async () => {
    await post('/submit', { words: [{ hanji: '八', tl: 'pueh' }], ...form });
    await post('/submit', { words: [{ hanji: '九', tl: 'káu' }], ...form }, { user: OTHER });
    const mine = await get('/mine');
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(mine.data.submissions.map((s) => [s.entry.hanji, s.pullRequest.number]), [['八', 1]]);
    assert.match(mine.data.submissions[0].path, /^entries\/octocat\/[0-9a-f]{16}\.json$/);
  });

  it('answers 401 signed out', async () => {
    const res = await get('/mine', { user: null });
    assert.deepEqual([res.status, res.data.error], [401, 'signed_out']);
  });
});

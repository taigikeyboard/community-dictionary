import assert from 'node:assert/strict';

// An in-memory GitHub for the Worker: the tests (test/worker.test.js) and the local mock Worker
// (scripts/mock-worker.js) run the real Worker against it.

export const REPO = 'taigikeyboard/community-dictionary';

// A throwaway GitHub App key: the fake GitHub accepts any signed JWT.
export async function pkcs8Pem() {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n`;
}

// Git objects in memory: refs → commits → trees (file maps). `gh.branches.get(name)` is the file
// map at a branch tip (mutate main's to seed it); `gh.commits` lists the commits the Worker made,
// each with the tree changes it carried. Enough of the REST API for the Worker.
// `user` is who GitHub's /user names for the OAuth token "user-token".
export function fakeGitHub(user = { id: 583231, login: 'octocat' }) {
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
    if (path === '/user') return reply(200, init.headers.Authorization === 'Bearer user-token' ? user : {});
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

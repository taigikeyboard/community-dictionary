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
// each with the tree changes it carried. Enough of the REST and GraphQL APIs for the Worker.
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
  const reply = (status, data) => new Response(data === undefined ? null : JSON.stringify(data), { status });
  const shaOf = (text) => `sha-${Buffer.from(text).toString('hex').slice(0, 40)}`;

  const commitNode = (sha) => ({ target: { oid: sha, tree: { oid: objects.get(sha).tree } } });
  // commits on a branch on top of main, as GitHub's commits.totalCount counts them for a pull request
  const commitCount = (branch) => {
    let count = 0;
    for (let sha = refs.get(branch); sha && sha !== refs.get('main'); sha = objects.get(sha).parents[0]) count += 1;
    return count;
  };
  // Answers the two operations the Worker sends (worker/src/submit.js), by operation name, from the
  // in-memory git state; `gh.pulls` entries may set `head.repo.full_name` to act as a fork.
  function graphql({ operationName, query, variables }) {
    assert.match(query, new RegExp(`^query ${operationName}\\b`), 'operationName must name the query');
    assert.deepEqual([variables.owner, variables.name], REPO.split('/'));
    if (operationName === 'Submissions') {
      assert.equal(variables.base, 'refs/heads/main');
      assert.match(query, /orderBy: \{ field: CREATED_AT, direction: DESC \}/);
      const open = gh.pulls.filter((pr) => pr.state === 'open').reverse();
      const start = Number(variables.after ?? 0);
      const nodes = open.slice(start, start + 100).map((pr) => ({
        number: pr.number,
        url: pr.html_url,
        body: pr.body,
        headRefName: pr.head.ref,
        isCrossRepository: pr.head.repo.full_name !== REPO,
        commits: { totalCount: commitCount(pr.head.ref) },
        headRef: refs.has(pr.head.ref) ? commitNode(refs.get(pr.head.ref)) : null,
      }));
      const hasNextPage = start + 100 < open.length;
      return { data: { repository: { base: commitNode(refs.get('main')), pullRequests: { pageInfo: { hasNextPage, endCursor: String(start + 100) }, nodes } } } };
    }
    if (operationName === 'Blobs') {
      const repository = {};
      for (const [name, expression] of Object.entries(variables)) {
        const m = /^e(\d+)$/.exec(name);
        if (!m) continue;
        // the alias, the variable and the field must all be in the query text
        assert.match(query, new RegExp(`f${m[1]}: object\\(expression: \\$e${m[1]}\\) \\{ \\.\\.\\. on Blob \\{ (text|oid) \\} \\}`));
        const [commit, ...rest] = expression.split(':');
        const text = trees.get(objects.get(commit)?.tree)?.get(rest.join(':'));
        repository[`f${m[1]}`] = text === undefined ? null : { text, oid: shaOf(text) };
      }
      return { data: { repository } };
    }
    return { errors: [{ message: `fake GitHub: unknown operation ${operationName}` }] };
  }

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

    if (path === '/graphql' && method === 'POST') return reply(200, graphql(body));
    if (rest === '/pulls' && method === 'POST') {
      assert.ok(refs.has(body.head), `pull request head ${body.head} must exist`);
      const pr = { number: gh.pulls.length + 1, state: 'open', title: body.title, body: body.body, html_url: `https://github.com/${REPO}/pull/${gh.pulls.length + 1}`, head: { ref: body.head, repo: { full_name: REPO } } };
      gh.pulls.push(pr);
      return reply(201, pr);
    }
    let m;
    if ((m = /^\/pulls\/(\d+)$/.exec(rest)) && method === 'PATCH') {
      gh.pulls[Number(m[1]) - 1].body = body.body;
      return reply(200, {});
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
    if (rest === '/git/commits' && method === 'POST') {
      const sha = `c${objects.size}`;
      objects.set(sha, { tree: body.tree, parents: body.parents });
      gh.commits.push({ sha, message: body.message, author: body.author, parents: body.parents, changes: treeChanges.get(body.tree) });
      return reply(201, { sha });
    }
    if ((m = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && method === 'PATCH') {
      if (!refs.has(m[1])) return reply(404, { message: 'Not Found' });
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
    return reply(404, { message: `fake GitHub: no route ${method} ${path}` });
  };
  return gh;
}

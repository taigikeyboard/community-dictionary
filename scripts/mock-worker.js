#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryKey, serializeEntry } from '../lib/entry.js';
import { fakeGitHub, pkcs8Pem, REPO } from '../test/fake-github.js';
import worker from '../worker/src/index.js';
import { sign } from '../worker/src/session.js';

// Local test of sign-in, 我的提交, 修改 and submitting, with fake data and no GitHub: the real
// Worker (worker/src) runs at http://127.0.0.1:8787 against the in-memory GitHub of the tests,
// /login signs in at once as the fake contributor `tester`, and dist/ is pointed at it, with two
// fake collected words added to dist/search.json. Nothing leaves this machine; restarting forgets
// every submission. Run after a build: `make preview-mock`.

const PORT = 8787;
const SITE = 'http://127.0.0.1:8000';
const USER = { id: 1000001, login: 'tester' };
const dist = fileURLToPath(new URL('../dist', import.meta.url));

const env = {
  GITHUB_CLIENT_ID: 'Iv1.mock',
  GITHUB_CLIENT_SECRET: 'mock',
  GITHUB_APP_PRIVATE_KEY: await pkcs8Pem(),
  SESSION_KEY: 'mock-session-key',
  GITHUB_REPO: REPO,
  BASE_BRANCH: 'main',
  SITE_ORIGINS: SITE,
  SITE_URL: `${SITE}/`,
  CAP_PER_CONTRIBUTOR: '5',
  CAP_TOTAL: '100',
};

// two collected words of the fake contributor, on the fake main branch and in dist/search.json
const FAKE_WORDS = [
  { hanji: '測試', tl: 'tshik-tshì', meaning: '假資料：試看覓', tags: ['讀冊'] },
  { hanji: '假資料', tl: 'ké tsu-liāu', meaning: '假資料：毋是真 ê 詞', tags: [] },
];
const gh = fakeGitHub(USER);
globalThis.fetch = gh.fetch;
const rows = JSON.parse(readFileSync(join(dist, 'search.json'), 'utf8'));
for (const word of FAKE_WORDS) {
  const entry = {
    hanji: word.hanji,
    tl: word.tl,
    accents: [],
    tags: word.tags,
    place: '',
    meaning: word.meaning,
    examples: [],
    note: '',
    contributor: USER.login,
    contributor_id: USER.id,
    submitted: '2026-11-27',
  };
  const key = await entryKey(entry.hanji, entry.tl);
  gh.branches.get('main').set(`entries/${USER.login}/${key}.json`, serializeEntry(entry));
  const { hanji, tl, ...attestation } = entry;
  rows.push({ key, hanji, tl, attestations: [attestation], poj: '', tps: '' });
}
writeFileSync(join(dist, 'search.json'), JSON.stringify(rows));
const config = join(dist, 'site', 'config.js');
writeFileSync(config, readFileSync(config, 'utf8').replace(/WORKER_URL = '[^']*'/, `WORKER_URL = 'http://127.0.0.1:${PORT}'`));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let response;
  if (url.pathname === '/login') {
    // no GitHub page: sign the fake contributor in and go straight back
    const session = await sign(env.SESSION_KEY, '__Host-session', { ...USER, exp: Math.floor(Date.now() / 1000) + 24 * 3600 });
    const back = url.searchParams.get('return') ?? '#/';
    response = new Response(null, {
      status: 302,
      headers: { Location: `${SITE}/${back}`, 'Set-Cookie': `__Host-session=${session}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax` },
    });
  } else {
    const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : await new Response(req).text();
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([, value]) => typeof value === 'string'));
    response = await worker.fetch(new Request(url, { method: req.method, headers, body }), env);
  }
  // every pull request the Worker opens or adds to, for checking against the page
  if (req.method === 'POST') console.log(`mock-worker: ${req.method} ${url.pathname} → ${response.status}; pull requests: ${gh.pulls.map((pr) => `#${pr.number} ${pr.title}`).join(', ') || 'none'}`);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log(`mock-worker: http://127.0.0.1:${PORT}/ (signed in as ${USER.login}; fake GitHub, nothing is sent)`));

await import('./serve.js');

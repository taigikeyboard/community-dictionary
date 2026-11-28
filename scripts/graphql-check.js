#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { blobsQuery, SUBMISSIONS_QUERY } from '../worker/src/submit.js';

// Sends the Worker's own GraphQL operations (worker/src/submit.js) to the live repository through
// `gh api graphql`, so a typo the in-memory fake would accept fails here. Uses the maintainer's gh
// token, not the App's installation token: a permission problem only shows with `make worker-dev`.

// the Worker's own settings (worker/wrangler.jsonc vars, written `"NAME": "value"`)
const wrangler = readFileSync(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
const setting = (name) => new RegExp(`"${name}": "([^"]+)"`).exec(wrangler)?.[1] ?? (() => { throw new Error(`worker/wrangler.jsonc: no ${name}`); })();
const [owner, name] = setting('GITHUB_REPO').split('/');

function run(operationName, query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `operationName=${operationName}`];
  for (const [key, value] of Object.entries({ owner, name, ...variables })) args.push('-f', `${key}=${value}`);
  const { data, errors } = JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
  if (errors?.length) throw new Error(`${operationName}: ${JSON.stringify(errors)}`);
  return data.repository;
}

const repository = run('Submissions', SUBMISSIONS_QUERY, { base: `refs/heads/${setting('BASE_BRANCH')}` });
const tip = repository.base.target;
console.log(`Submissions: base ${tip.oid.slice(0, 7)}, ${repository.pullRequests.nodes.length} open pull requests`);
// both field variants the Worker sends: text (reads) and oid (existence)
for (const field of ['text', 'oid']) {
  const blobs = run('Blobs', blobsQuery(2, field), { e0: `${tip.oid}:README.md`, e1: `${tip.oid}:entries/nobody/0000000000000000.json` });
  const ok = typeof blobs.f0?.[field] === 'string' && blobs.f1 === null;
  console.log(`Blobs (${field}): README.md ${blobs.f0?.[field] ? 'found' : 'MISSING'}, missing path ${blobs.f1 === null ? 'null' : 'NOT NULL'}`);
  if (!ok) process.exitCode = 1;
}

#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ENTRIES_DIR, isAccountId, nextEditors, NOREPLY_RE, parseEntryPath } from '../lib/entry.js';
import { checkTree } from './check-tree.js';

// CI gate: validates every entry file and, for a pull request, who may change entries/.
//
//   node scripts/validate.js                          # whole tree (push, local)
//   node scripts/validate.js --base <sha> --head <sha> # pull request; mode from the PR_* env
//
// Run from the base revision's checkout with the head checkout as the working directory, so a
// pull request cannot change the code that judges it.

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const ENTRIES_PREFIX = `${ENTRIES_DIR}/`;

// submission: opened by the GitHub App from a branch of this repository → ownership checks.
// member: opened by someone with write access → whole-tree check only, the merge is the review.
// outside: anyone else → may not change entries/ at all; entries come through the form.
export function pullRequestMode({ author, appLogin, association, headRepo, repo }) {
  if (appLogin && author === appLogin && headRepo === repo) return 'submission';
  if (TRUSTED_ASSOCIATIONS.has(association)) return 'member';
  return 'outside';
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

// `git … --name-status -z` output → [{ status, path }], renames split into delete + add.
function nameStatus(root, args) {
  const fields = git(root, [...args, '--name-status', '--no-renames', '-z']).split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i + 1 < fields.length; i += 2) changes.push({ status: fields[i][0], path: fields[i + 1] });
  return changes;
}

function entryAt(root, rev, path) {
  try {
    return JSON.parse(git(root, ['show', `${rev}:${path}`]));
  } catch {
    return undefined;
  }
}

// One submission commit by `author` ({ id, login }), against D11 (anyone may edit any entry,
// maintainer 2026-11-28). Every file the commit leaves behind is either new — then it is the
// author's own, under their directory, with no editors — or the next version of an entry: the same
// file modified, or a file it deletes in the same commit (a changed pair). A next version keeps the
// entry's contributor id and date (and its directory login, unless the owner refiles it under
// their current one), and its editors are the old list plus the author unless the author is the
// contributor or already listed. A file the commit only deletes must be the author's own.
function commitOwnershipErrors(root, sha, author, changes) {
  const errors = [];
  const at = (rev, path) => entryAt(root, rev, path);
  // enough of an entry to judge a change against (the full schema is checkTree's job)
  const readable = (entry) => isAccountId(entry?.contributor_id) && Array.isArray(entry.editors);
  const owner = (entry) => entry?.contributor_id ?? 'unknown';
  const deleted = changes.filter((c) => c.status === 'D').map((c) => ({ path: c.path, entry: at(`${sha}^`, c.path) }));
  for (const { status, path } of changes.filter((c) => c.status !== 'D')) {
    const entry = at(sha, path);
    // every status but an add (modify, type change, …) has a previous version to answer to
    let old = status === 'A' ? undefined : at(`${sha}^`, path);
    if (status !== 'A' && !readable(old)) {
      errors.push(`${sha}: ${path} replaces a file that is not a readable entry`);
      continue;
    }
    if (status === 'A') {
      const moved = deleted.findIndex((d) => readable(d.entry) && d.entry.contributor_id === entry?.contributor_id);
      if (moved !== -1) old = deleted.splice(moved, 1)[0].entry;
      if (parseEntryPath(path)?.login !== entry?.contributor) {
        errors.push(`${sha}: ${path} is not under the contributor's own directory ${ENTRIES_PREFIX}${entry?.contributor}/`);
      }
    }
    if (!old) {
      if (owner(entry) !== author.id) errors.push(`${sha}: ${path} belongs to contributor ${owner(entry)}, not commit author ${author.id}`);
      else if (entry.contributor !== author.login) errors.push(`${sha}: ${path} names contributor ${entry.contributor}, not commit author ${author.login}`);
      else if (entry.editors?.length !== 0) errors.push(`${sha}: ${path} is a new entry, so it lists no editors`);
      continue;
    }
    // the owner moving their entry files it under their current login
    const refiled = status === 'A' && old.contributor_id === author.id;
    const contributor = refiled ? author.login : old.contributor;
    if (!entry || entry.contributor_id !== old.contributor_id || entry.submitted !== old.submitted || entry.contributor !== contributor) {
      errors.push(`${sha}: ${path} changes who contributed contributor ${owner(old)}'s entry or when`);
      continue;
    }
    const expected = nextEditors(old, author);
    if (JSON.stringify(entry.editors) !== JSON.stringify(expected)) {
      errors.push(`${sha}: ${path} editors must be ${JSON.stringify(expected)}`);
    }
  }
  for (const { path, entry } of deleted) {
    if (owner(entry) !== author.id) errors.push(`${sha}: ${path} belongs to contributor ${owner(entry)}; only they may delete it`);
  }
  return errors;
}

// Pull request checks against the commit range base..head, per mode.
export function validatePullRequest(root, base, head, mode) {
  if (mode === 'member') return { errors: [], commits: 0 };
  const changed = nameStatus(root, ['diff', `${base}...${head}`]);

  if (mode === 'outside') {
    const errors = changed
      .filter(({ path }) => path.startsWith(ENTRIES_PREFIX))
      .map(({ path }) => `${path}: entries can only be changed through the submission form`);
    return { errors, commits: 0 };
  }

  const errors = changed
    .filter(({ path }) => !path.startsWith(ENTRIES_PREFIX))
    .map(({ path }) => `${path}: a submission may only change ${ENTRIES_PREFIX}`);
  // One line per commit, oldest first: sha, parent shas, author email.
  const commits = git(root, ['log', '--reverse', '--format=%H%x00%P%x00%ae', `${base}..${head}`])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\0'));
  for (const [sha, parents, email] of commits) {
    if (parents.includes(' ')) {
      errors.push(`${sha}: a submission may not contain merge commits`);
      continue;
    }
    const match = NOREPLY_RE.exec(email);
    if (!match) {
      errors.push(`${sha}: author ${email} is not a GitHub noreply address <id>+<login>@users.noreply.github.com`);
      continue;
    }
    const changes = nameStatus(root, ['diff-tree', '--no-commit-id', '-r', '--root', sha]);
    errors.push(...commitOwnershipErrors(root, sha, { id: Number(match[1]), login: match[2] }, changes));
  }
  return { errors, commits: commits.length };
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' } } });
  const root = process.cwd();
  const tree = await checkTree(root);
  const errors = [...tree.errors];
  let summary = `${tree.count} entry files`;

  if (values.base || values.head) {
    if (!values.base || !values.head) throw new Error('validate: --base and --head go together');
    const { env } = process;
    const mode = pullRequestMode({
      author: env.PR_AUTHOR,
      appLogin: env.SUBMIT_APP_LOGIN,
      association: env.PR_AUTHOR_ASSOCIATION,
      headRepo: env.PR_HEAD_REPO,
      repo: env.GITHUB_REPOSITORY,
    });
    const pr = validatePullRequest(root, values.base, values.head, mode);
    errors.push(...pr.errors);
    summary += `, ${mode} pull request, ${pr.commits} commits checked`;
  }

  for (const e of errors) console.error(`::error::${e}`);
  console.log(`${summary}: ${errors.length === 0 ? 'ok' : `${errors.length} errors`}`);
  process.exitCode = errors.length === 0 ? 0 : 1;
}

if (import.meta.main) await main();

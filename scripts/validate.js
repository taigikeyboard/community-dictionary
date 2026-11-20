#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ENTRIES_DIR, NOREPLY_RE, parseEntryPath } from '../lib/entry.js';
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

// Both sides of a change are checked, so a commit can neither take over nor give away another
// contributor's file; a new file must sit under the contributor's current login.
function ownershipErrors(root, sha, authorId, { status, path }) {
  const errors = [];
  const sides = [status !== 'D' && ['new', sha], status !== 'A' && ['old', `${sha}^`]].filter(Boolean);
  for (const [label, rev] of sides) {
    const entry = entryAt(root, rev, path);
    if (entry?.contributor_id !== authorId) {
      errors.push(`${sha}: ${path} (${label} version) belongs to contributor ${entry?.contributor_id ?? 'unknown'}, not commit author ${authorId}`);
    } else if (status === 'A' && parseEntryPath(path)?.login !== entry.contributor) {
      errors.push(`${sha}: ${path} is not under the contributor's own directory ${ENTRIES_PREFIX}${entry.contributor}/`);
    }
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
    for (const change of nameStatus(root, ['diff-tree', '--no-commit-id', '-r', '--root', sha])) {
      errors.push(...ownershipErrors(root, sha, Number(match[1]), change));
    }
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

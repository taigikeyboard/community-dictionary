import { entryKey, entryPath, parseEntryPath, prepareEntry, serializeEntry, ENTRIES_DIR } from '../../lib/entry.js';
import { api, apiOrNull, GitHubError, installationToken } from './github.js';

// New, edit and withdraw submissions: checks the contributor's rights and caps against GitHub
// state (no database), then writes on a `submit/<id>/<key>` branch and opens the pull request.

export const MAX_WORDS = 20;
const BRANCH_PREFIX = 'submit/';
const ENTRY_FIELDS = ['accents', 'tags', 'place', 'meaning', 'example', 'note'];

// A refusal the contributor sees; `code` is mapped to Taiwanese text by the site.
export class SubmitError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function utf8Base64(text) {
  let s = '';
  for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b);
  return btoa(s);
}

function decodeBase64Utf8(b64) {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
}

// The submission date in Taiwan, where the contributors are.
function taiwanDate(now = Date.now()) {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}

function author(user) {
  return { name: user.login, email: `${user.id}+${user.login}@users.noreply.github.com` };
}

function wordLabel(entry) {
  return [entry.hanji, entry.tl].filter(Boolean).join(' ');
}

// Shared fields from the form, plus one word; identity always comes from the session.
function draftEntry(body, word, identity) {
  const draft = { hanji: word?.hanji ?? '', tl: word?.tl ?? '' };
  for (const field of ENTRY_FIELDS) draft[field] = body[field] ?? (field === 'accents' || field === 'tags' ? [] : '');
  return prepareEntry({ ...draft, ...identity });
}

class Repo {
  constructor(env, token) {
    this.env = env;
    this.token = token;
    this.name = env.GITHUB_REPO;
    this.base = env.BASE_BRANCH || 'main';
  }

  call(method, path, body) {
    return api(this.token, method, `/repos/${this.name}${path}`, body);
  }

  // Open pull requests from this repository's submit/ branches.
  async openSubmissions() {
    const found = [];
    for (let page = 1; ; page++) {
      const batch = await this.call('GET', `/pulls?state=open&per_page=100&page=${page}`);
      found.push(...batch.filter((pr) => pr.head.repo?.full_name.toLowerCase() === this.name.toLowerCase() && pr.head.ref.startsWith(BRANCH_PREFIX)));
      if (batch.length < 100) return found;
    }
  }

  // filename → { pr, status } for every file in the contributor's open submissions.
  async filesOf(prs) {
    const files = new Map();
    for (const pr of prs) {
      for (const file of await this.call('GET', `/pulls/${pr.number}/files?per_page=100`)) {
        files.set(file.filename, { pr, status: file.status });
        // GitHub may pair a changed-pair edit's add + delete into one rename.
        if (file.status === 'renamed') files.set(file.previous_filename, { pr, status: 'removed' });
      }
    }
    return files;
  }

  // Keys among `keys` that this contributor already holds on the base branch, in any directory
  // (an account rename leaves older files under the old login).
  async ownedOnBase(userId, keys) {
    const tree = await this.call('GET', `/git/trees/${this.base}?recursive=1`);
    if (tree.truncated) throw new Error(`tree of ${this.base} is truncated; duplicate check impossible`);
    const owned = new Set();
    for (const item of tree.tree) {
      const location = item.type === 'blob' ? parseEntryPath(item.path) : null;
      if (!location || !keys.has(location.key)) continue;
      const blob = await this.call('GET', `/git/blobs/${item.sha}`);
      if (JSON.parse(decodeBase64Utf8(blob.content)).contributor_id === userId) owned.add(location.key);
    }
    return owned;
  }

  async readEntry(path, ref) {
    const file = await apiOrNull(this.token, 'GET', `/repos/${this.name}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    return file && { sha: file.sha, entry: JSON.parse(decodeBase64Utf8(file.content)) };
  }

  // Creates `name` (or `name-2`, … when an open pull request already uses it) at the base tip.
  // A leftover branch of a closed pull request is reset to the base tip.
  async createBranch(name, openPrs) {
    const used = new Set(openPrs.map((pr) => pr.head.ref));
    let branch = name;
    for (let n = 2; used.has(branch); n++) branch = `${name}-${n}`;
    const { object } = await this.call('GET', `/git/ref/heads/${this.base}`);
    try {
      await this.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: object.sha });
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 422)) throw err;
      await this.call('PATCH', `/git/refs/heads/${branch}`, { sha: object.sha, force: true });
    }
    return branch;
  }

  // Contents API writes run one after another: GitHub documents that parallel calls conflict.
  putEntry(path, entry, { branch, user, message, sha }) {
    return this.call('PUT', `/contents/${path}`, {
      message,
      content: utf8Base64(serializeEntry(entry)),
      branch,
      author: author(user),
      ...(sha && { sha }),
    });
  }

  deleteEntry(path, { branch, user, message, sha }) {
    return this.call('DELETE', `/contents/${path}`, { message, sha, branch, author: author(user) });
  }

  async openPullRequest(branch, title, body) {
    const pr = await this.call('POST', '/pulls', { title, head: branch, base: this.base, body });
    return { url: pr.html_url, number: pr.number };
  }
}

// A missing or malformed cap is a deployment error: fail closed rather than run uncapped.
function capValue(env, name) {
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} is not a whole number: ${env[name]}`);
  return value;
}

function checkCaps(env, user, openPrs) {
  const own = openPrs.filter((pr) => pr.head.ref.startsWith(`${BRANCH_PREFIX}${user.id}/`));
  if (own.length >= capValue(env, 'CAP_PER_CONTRIBUTOR')) throw new SubmitError(429, 'cap_contributor');
  if (openPrs.length >= capValue(env, 'CAP_TOTAL')) throw new SubmitError(429, 'cap_total');
}

function prBody(user, lines) {
  return [
    `Submitted by @${user.login} through the community dictionary form.`,
    '',
    ...lines,
    '',
    'Contributed under CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/).',
  ].join('\n');
}

// Everything the contributor's open submissions and the base branch say about their own keys.
async function loadState(repo, user) {
  const openPrs = await repo.openSubmissions();
  const ownPrs = openPrs.filter((pr) => pr.head.ref.startsWith(`${BRANCH_PREFIX}${user.id}/`));
  return { openPrs, ownFiles: await repo.filesOf(ownPrs) };
}

function heldInOpenSubmission(ownFiles, key) {
  for (const [filename, { status }] of ownFiles) {
    if (status !== 'removed' && parseEntryPath(filename)?.key === key) return true;
  }
  return false;
}

async function refuseHeldKeys(repo, user, ownFiles, keys) {
  const owned = await repo.ownedOnBase(user.id, keys);
  const held = [...keys].filter((key) => owned.has(key) || heldInOpenSubmission(ownFiles, key));
  if (held.length > 0) throw new SubmitError(409, 'already_submitted', { keys: held });
}

export async function submitNew(env, user, body, now = Date.now()) {
  const words = body.words;
  if (!Array.isArray(words) || words.length === 0 || words.length > MAX_WORDS) {
    throw new SubmitError(400, 'invalid', { errors: [`words: 1 to ${MAX_WORDS} words`] });
  }
  const identity = { contributor: user.login, contributor_id: user.id, submitted: taiwanDate(now) };
  const prepared = words.map((word) => draftEntry(body, word, identity));
  const errors = prepared.flatMap(({ errors: list }, i) => list.map((e) => `words[${i}].${e}`));
  if (errors.length > 0) throw new SubmitError(400, 'invalid', { errors });

  const entries = prepared.map(({ entry }) => entry);
  const keys = await Promise.all(entries.map((e) => entryKey(e.hanji, e.tl)));
  if (new Set(keys).size !== keys.length) throw new SubmitError(400, 'invalid', { errors: ['words: same word twice'] });

  const repo = new Repo(env, await installationToken(env));
  const { openPrs, ownFiles } = await loadState(repo, user);
  checkCaps(env, user, openPrs);
  await refuseHeldKeys(repo, user, ownFiles, new Set(keys));

  const branch = await repo.createBranch(`${BRANCH_PREFIX}${user.id}/${keys[0]}`, openPrs);
  for (const [i, entry] of entries.entries()) {
    await repo.putEntry(entryPath(user.login, keys[i]), entry, { branch, user, message: `add ${wordLabel(entry)}` });
  }
  const title = entries.length === 1 ? `add ${wordLabel(entries[0])}` : `add ${entries.length} words`;
  const lines = ['| Hanji | Tâi-lô |', '|---|---|', ...entries.map((e) => `| ${e.hanji} | ${e.tl} |`)];
  return repo.openPullRequest(branch, title, prBody(user, lines));
}

// The entry at `path` that this contributor owns, read from their open submission that touches
// it (so a second edit lands as one more commit there) or else from the base branch.
async function ownedTarget(repo, user, ownFiles, path) {
  const location = typeof path === 'string' ? parseEntryPath(path) : null;
  if (!location) throw new SubmitError(400, 'invalid', { errors: [`path: not of the form ${ENTRIES_DIR}/<login>/<key>.json`] });
  const open = ownFiles.get(path);
  if (open?.status === 'removed') throw new SubmitError(409, 'already_withdrawn');
  const ref = open ? open.pr.head.ref : repo.base;
  const file = await repo.readEntry(path, ref);
  if (!file) throw new SubmitError(404, 'not_found');
  if (file.entry.contributor_id !== user.id) throw new SubmitError(403, 'not_owner');
  return { ...file, location, pr: open?.pr };
}

export async function submitEdit(env, user, body) {
  const repo = new Repo(env, await installationToken(env));
  const { openPrs, ownFiles } = await loadState(repo, user);
  const target = await ownedTarget(repo, user, ownFiles, body.path);
  const old = target.entry;

  const draft = draftEntry(body, body, { contributor: old.contributor, contributor_id: user.id, submitted: old.submitted });
  if (draft.errors.length > 0) throw new SubmitError(400, 'invalid', { errors: draft.errors });
  let entry = draft.entry;
  const newKey = await entryKey(entry.hanji, entry.tl);
  const pairChanged = newKey !== target.location.key;
  if (!pairChanged && serializeEntry(entry) === serializeEntry(old)) throw new SubmitError(400, 'unchanged');
  // A changed pair is a new file, filed under the contributor's current login.
  if (pairChanged) {
    entry = { ...entry, contributor: user.login };
    await refuseHeldKeys(repo, user, ownFiles, new Set([newKey]));
  }

  if (!target.pr) checkCaps(env, user, openPrs);
  const branch = target.pr?.head.ref ?? (await repo.createBranch(`${BRANCH_PREFIX}${user.id}/${target.location.key}`, openPrs));
  const message = `edit ${wordLabel(old)}`;
  if (pairChanged) {
    await repo.putEntry(entryPath(user.login, newKey), entry, { branch, user, message });
    await repo.deleteEntry(body.path, { branch, user, message, sha: target.sha });
  } else {
    await repo.putEntry(body.path, entry, { branch, user, message, sha: target.sha });
  }
  if (target.pr) return { url: target.pr.html_url, number: target.pr.number };
  const lines = pairChanged ? [`${wordLabel(old)} → ${wordLabel(entry)}`] : [`\`${body.path}\``];
  return repo.openPullRequest(branch, message, prBody(user, lines));
}

export async function withdraw(env, user, body) {
  const repo = new Repo(env, await installationToken(env));
  const { openPrs, ownFiles } = await loadState(repo, user);
  const target = await ownedTarget(repo, user, ownFiles, body.path);

  if (!target.pr) checkCaps(env, user, openPrs);
  const branch = target.pr?.head.ref ?? (await repo.createBranch(`${BRANCH_PREFIX}${user.id}/${target.location.key}`, openPrs));
  const message = `withdraw ${wordLabel(target.entry)}`;
  await repo.deleteEntry(body.path, { branch, user, message, sha: target.sha });
  if (target.pr) return { url: target.pr.html_url, number: target.pr.number };
  return repo.openPullRequest(branch, message, prBody(user, [`\`${body.path}\``]));
}

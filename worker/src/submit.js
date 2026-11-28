import { entryKey, entryPath, issue, MAX_WORDS, nextEditors, parseEntryPath, prepareEntry, serializeEntry } from '../../lib/entry.js';
import { api, GitHubError, graphql, installationToken } from './github.js';

// New and edit submissions (any entry may be edited, D11), and the contributor's own open ones:
// checks duplicates and caps against GitHub state (no database), then writes one commit on a
// `submit/<id>/<key>` branch and opens the pull request. Every request makes a fixed handful of
// GitHub calls, whatever the number of entries or open submissions (Workers Free plan,
// roadmap § Worker budget).

const BRANCH_PREFIX = 'submit/';
// edits to one open submission land as commits on its branch; past this many it refuses more, so a
// signed-in account cannot keep writing to GitHub without limit (maintainer 2026-11-28)
const MAX_SUBMISSION_COMMITS = 20;
// open pull requests are read 100 to a GraphQL page; past this many pages (fork spam) the Worker
// refuses to work rather than miss a submission
const MAX_PULL_REQUEST_PAGES = 3;
const ENTRY_FIELDS = ['accents', 'tags', 'place', 'meaning', 'examples', 'note'];

// Every entry path a submission's commits have written or deleted, kept in its pull request body
// (GitHub's file listing would cost a call per pull request, and reports a changed pair as a rename
// without the old path).
const MARKER_NAME = 'community-dictionary-files';
const MARKER_RE = new RegExp(`<!-- ${MARKER_NAME} (.*?) -->`, 'g');
const marker = (paths) => `<!-- ${MARKER_NAME} ${JSON.stringify(paths)} -->`;

// The open pull requests, newest first, 100 to a page, with the base branch's tip.
export const SUBMISSIONS_QUERY = `query Submissions($owner: String!, $name: String!, $base: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    base: ref(qualifiedName: $base) { target { ... on Commit { oid tree { oid } } } }
    pullRequests(states: OPEN, first: 100, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        url
        body
        headRefName
        isCrossRepository
        commits { totalCount }
        headRef { target { ... on Commit { oid tree { oid } } } }
      }
    }
  }
}`;

// Files by `<commit>:<path>` expression (variables e0…), as their text or only their oid; a missing
// file is null.
export function blobsQuery(count, field) {
  const names = Array.from({ length: count }, (_, i) => `e${i}`);
  return `query Blobs($owner: String!, $name: String!, ${names.map((n) => `$${n}: String!`).join(', ')}) {
  repository(owner: $owner, name: $name) {
${names.map((n, i) => `    f${i}: object(expression: $${n}) { ... on Blob { ${field} } }`).join('\n')}
  }
}`;
}

// A refusal the contributor sees; `code` is mapped to Taiwanese text by the site.
export class SubmitError extends Error {
  constructor(status, code, details) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
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

// Words go into GitHub text, where "@login" notifies someone and "fixes #12" closes an issue; since
// Hanji and Tâi-lô take any text (2026-11-28), titles and commit messages get full-width ＠ and ＃
// and a cut at TITLE_WORD_LIMIT characters, and the pull request body shows words in a code block.
const TITLE_WORD_LIMIT = 60;
function safeLabel(entry) {
  const label = Array.from(wordLabel(entry).replace(/@/g, '＠').replace(/#/g, '＃'));
  return label.length > TITLE_WORD_LIMIT ? `${label.slice(0, TITLE_WORD_LIMIT - 1).join('')}…` : label.join('');
}

// Lines as a fenced code block whose fence is longer than any backtick run inside, so no line can
// close it early; GitHub links neither mentions nor issue numbers inside.
function codeBlock(lines) {
  const longest = Math.max(0, ...lines.flatMap((line) => (line.match(/`+/g) ?? []).map((run) => run.length)));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [fence, ...lines, fence];
}

// Shared fields from the form, plus one word; identity always comes from the session.
function draftEntry(body, word, identity) {
  const draft = { hanji: word?.hanji ?? '', tl: word?.tl ?? '' };
  for (const field of ENTRY_FIELDS) draft[field] = body[field] ?? (['accents', 'tags', 'examples'].includes(field) ? [] : '');
  return prepareEntry({ ...draft, ...identity });
}

// The paths in a pull request body's last marker; a body without one (or a broken one) touches
// nothing, so a hand edit cannot block the site.
function markerPaths(body, number) {
  const found = [...(body ?? '').matchAll(MARKER_RE)].at(-1);
  if (!found) return [];
  try {
    const paths = JSON.parse(found[1]);
    if (Array.isArray(paths)) return paths.filter((path) => typeof path === 'string' && parseEntryPath(path));
  } catch {
    // reported below
  }
  console.error(`worker: pull request #${number} has an unreadable ${MARKER_NAME} marker; treated as touching nothing`);
  return [];
}

const commitOf = (ref) => ref?.target && { oid: ref.target.oid, tree: ref.target.tree.oid };

class Repo {
  constructor(env, token) {
    this.token = token;
    this.owner = env.GITHUB_REPO.split('/')[0];
    this.name = env.GITHUB_REPO.split('/')[1];
    this.base = env.BASE_BRANCH || 'main';
  }

  call(method, path, body) {
    return api(this.token, method, `/repos/${this.owner}/${this.name}${path}`, body);
  }

  query(operationName, query, variables = {}) {
    return graphql(this.token, operationName, query, { owner: this.owner, name: this.name, ...variables });
  }

  // The base branch's tip and the open submissions (pull requests from this repository's submit/
  // branches): [{ number, url, body, branch, commits, head: { oid, tree }, paths }].
  async snapshot() {
    const submissions = [];
    let base = null;
    let after = null;
    for (let page = 1; ; page++) {
      const { repository } = await this.query('Submissions', SUBMISSIONS_QUERY, { base: `refs/heads/${this.base}`, after });
      base ??= commitOf(repository.base);
      const { nodes, pageInfo } = repository.pullRequests;
      for (const pr of nodes) {
        const head = commitOf(pr.headRef);
        if (pr.isCrossRepository || !pr.headRefName.startsWith(BRANCH_PREFIX) || !head) continue;
        submissions.push({ number: pr.number, url: pr.url, body: pr.body, branch: pr.headRefName, commits: pr.commits.totalCount, head, paths: markerPaths(pr.body, pr.number) });
      }
      if (!pageInfo.hasNextPage) break;
      if (page === MAX_PULL_REQUEST_PAGES) throw new Error(`more than ${MAX_PULL_REQUEST_PAGES * 100} open pull requests; close some before submissions can resume`);
      after = pageInfo.endCursor;
    }
    if (!base) throw new Error(`base branch ${this.base} not found`);
    return { base, submissions };
  }

  // `expressions` (`<commit>:<path>`) → each file's `field` ("text" or "oid"), or null when missing;
  // one GraphQL call for all of them.
  async blobs(expressions, field) {
    if (expressions.length === 0) return [];
    const variables = Object.fromEntries(expressions.map((expression, i) => [`e${i}`, expression]));
    const { repository } = await this.query('Blobs', blobsQuery(expressions.length, field), variables);
    return expressions.map((_, i) => repository[`f${i}`]?.[field] ?? null);
  }

  // One commit carrying every change of a submission (Git Data API: tree, commit), on top of
  // `parent` ({ oid, tree }); `changes` maps a path to an entry, or to null to delete it.
  async createCommit(parent, changes, message, user) {
    const items = [...changes].map(([path, entry]) =>
      entry === null
        ? { path, mode: '100644', type: 'blob', sha: null }
        : { path, mode: '100644', type: 'blob', content: serializeEntry(entry) },
    );
    const tree = await this.call('POST', '/git/trees', { base_tree: parent.tree, tree: items });
    const commit = await this.call('POST', '/git/commits', { message, tree: tree.sha, parents: [parent.oid], author: author(user) });
    return commit.sha;
  }

  // Fast-forward only: a concurrent write to the same branch fails instead of being lost.
  moveBranch(branch, sha) {
    return this.call('PATCH', `/git/refs/heads/${branch}`, { sha, force: false });
  }

  // A new branch `name` (or `name-2`, … when an open submission already uses it) at `sha`; a
  // leftover branch of a closed pull request is reset.
  async createBranch(name, sha, submissions) {
    const used = new Set(submissions.map((s) => s.branch));
    let branch = name;
    for (let n = 2; used.has(branch); n++) branch = `${name}-${n}`;
    try {
      await this.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha });
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 422)) throw err;
      await this.call('PATCH', `/git/refs/heads/${branch}`, { sha, force: true });
    }
    return branch;
  }

  async openPullRequest(branch, title, body) {
    const pr = await this.call('POST', '/pulls', { title, head: branch, base: this.base, body });
    return { url: pr.html_url, number: pr.number };
  }

  setBody(number, body) {
    return this.call('PATCH', `/pulls/${number}`, { body });
  }
}

// A missing or malformed cap is a deployment error: fail closed rather than run uncapped.
function capValue(env, name) {
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} is not a whole number: ${env[name]}`);
  return value;
}

// a contributor's submission branches are submit/<id>/<key of the first word or the edited entry>
const ownBranch = (user, key = '') => `${BRANCH_PREFIX}${user.id}/${key}`;
const isOwn = (user) => (submission) => submission.branch.startsWith(ownBranch(user));

function checkCaps(env, user, submissions) {
  if (submissions.filter(isOwn(user)).length >= capValue(env, 'CAP_PER_CONTRIBUTOR')) throw new SubmitError(429, 'cap_contributor');
  if (submissions.length >= capValue(env, 'CAP_TOTAL')) throw new SubmitError(429, 'cap_total');
}

function prBody(user, lines, paths) {
  return [
    `Submitted by @${user.login} through the community dictionary form.`,
    '',
    ...lines,
    '',
    'Contributed under CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/).',
    '',
    marker(paths),
  ].join('\n');
}

// One open pull request per entry file: an edit or a new word whose file another open submission
// (anyone's but `except`, the editor's own one being extended) already touches waits for that
// review, so two pull requests never fight over one file (maintainer 2026-11-28). Paths, not keys:
// the same contributor's key under an older login directory is not caught (needs an account
// rename; CI's duplicate-pair check on the pull request head reports it).
function refuseInReview(submissions, paths, except = null) {
  const busy = paths.filter((path) => submissions.some((s) => s !== except && s.paths.includes(path)));
  if (busy.length > 0) throw new SubmitError(409, 'in_review', { keys: [...new Set(busy.map((path) => parseEntryPath(path).key))] });
}

// D10: the file `entries/<login>/<key>.json` exists on the base branch, or one of `own` (the
// contributor's open submissions) touched that path. Existence only, whoever's file it is; a key
// under an older login directory after an account rename is left to CI's duplicate-pair check.
async function refuseHeldKeys(repo, base, login, own, keys) {
  const paths = keys.map((key) => entryPath(login, key));
  const found = await repo.blobs(paths.map((path) => `${base.oid}:${path}`), 'oid');
  const held = keys.filter((key, i) => found[i] !== null || own.some((s) => s.paths.includes(paths[i])));
  if (held.length > 0) throw new SubmitError(409, 'already_submitted', { keys: held });
}

export async function submitNew(env, user, body, now = Date.now()) {
  const words = body.words;
  if (!Array.isArray(words) || words.length === 0 || words.length > MAX_WORDS) {
    throw new SubmitError(400, 'invalid', { issues: [issue('words', 'word_count', { max: MAX_WORDS })] });
  }
  const identity = { contributor: user.login, contributor_id: user.id, submitted: taiwanDate(now), editors: [], itaigi_contributors: [] };
  const prepared = words.map((word) => draftEntry(body, word, identity));
  const issues = prepared.flatMap(({ issues: list }, i) => list.map((found) => ({ ...found, field: `words[${i}].${found.field}` })));
  if (issues.length > 0) throw new SubmitError(400, 'invalid', { issues });

  const entries = prepared.map(({ entry }) => entry);
  const keys = await Promise.all(entries.map((e) => entryKey(e.hanji, e.tl)));
  if (new Set(keys).size !== keys.length) throw new SubmitError(400, 'invalid', { issues: [issue('words', 'repeated_word')] });

  const repo = new Repo(env, await installationToken(env));
  const { base, submissions } = await repo.snapshot();
  checkCaps(env, user, submissions);
  const paths = keys.map((key) => entryPath(user.login, key));
  // one's own earlier word is "already submitted" before anyone's open submission is "in review"
  await refuseHeldKeys(repo, base, user.login, submissions.filter(isOwn(user)), keys);
  refuseInReview(submissions, paths);

  const title = entries.length === 1 ? `add ${safeLabel(entries[0])}` : `add ${entries.length} words`;
  const message = entries.length === 1 ? title : `${title}\n\n${entries.map(safeLabel).join('\n')}`;
  const sha = await repo.createCommit(base, new Map(entries.map((entry, i) => [paths[i], entry])), message, user);
  const branch = await repo.createBranch(ownBranch(user, keys[0]), sha, submissions);
  const lines = codeBlock(entries.map(wordLabel));
  return repo.openPullRequest(branch, title, prBody(user, lines, paths));
}

// The entry at `path`, whoever contributed it (D11): read from the editor's own open submission
// that touched it (so a second edit lands as one more commit there; gone from it after the
// editor's own pair change) or else from the base branch.
async function editTarget(repo, base, own, path) {
  const location = parseEntryPath(path);
  if (!location) throw new SubmitError(400, 'invalid', { issues: [issue('path', 'not_entry_path')] });
  const submission = own.find((s) => s.paths.includes(path)) ?? null;
  const [text] = await repo.blobs([`${(submission?.head ?? base).oid}:${path}`], 'text');
  if (text === null) throw new SubmitError(404, 'not_found');
  return { entry: JSON.parse(text), location, submission };
}

export async function submitEdit(env, user, body) {
  const repo = new Repo(env, await installationToken(env));
  const { base, submissions } = await repo.snapshot();
  const own = submissions.filter(isOwn(user));
  const target = await editTarget(repo, base, own, body.path);
  const old = target.entry;
  const isOwner = old.contributor_id === user.id;

  // the stored entry keeps its contributor and date; anyone else who edits joins its editors
  const identity = { contributor: old.contributor, contributor_id: old.contributor_id, submitted: old.submitted, itaigi_contributors: old.itaigi_contributors };
  const draft = draftEntry(body, body, { ...identity, editors: old.editors });
  if (draft.issues.length > 0) throw new SubmitError(400, 'invalid', { issues: draft.issues });
  let entry = draft.entry;
  const newKey = await entryKey(entry.hanji, entry.tl);
  const pairChanged = newKey !== target.location.key;
  if (!pairChanged && serializeEntry(entry) === serializeEntry(old)) throw new SubmitError(400, 'unchanged');
  // A changed pair is a new file in the contributor's directory: the owner's current login when
  // the owner edits, the stored one otherwise.
  entry = { ...entry, editors: nextEditors(old, user), contributor: isOwner && pairChanged ? user.login : old.contributor };
  const newPath = pairChanged ? entryPath(entry.contributor, newKey) : body.path;

  // the contributor's other open submissions count only when they are the editor
  if (pairChanged) await refuseHeldKeys(repo, base, entry.contributor, isOwner ? own : [], [newKey]);
  refuseInReview(submissions, [body.path, newPath], target.submission);
  if (!target.submission) checkCaps(env, user, submissions);
  else if (target.submission.commits >= MAX_SUBMISSION_COMMITS) throw new SubmitError(429, 'cap_contributor');

  const message = `edit ${safeLabel(old)}`;
  // A changed pair adds the new file and deletes the old one in the same commit.
  const changes = pairChanged ? new Map([[newPath, entry], [body.path, null]]) : new Map([[body.path, entry]]);
  const sha = await repo.createCommit(target.submission?.head ?? base, changes, message, user);
  const paths = [...changes.keys()];

  if (target.submission) {
    const { submission } = target;
    // the body's file list grows before the branch moves, so a request that dies in between leaves
    // the list too long (harmless) rather than too short; the submission was found through its
    // list, so the body holds one
    const all = [...new Set([...submission.paths, ...paths])];
    if (all.length !== submission.paths.length) await repo.setBody(submission.number, submission.body.replace(MARKER_RE, () => marker(all)));
    await repo.moveBranch(submission.branch, sha);
    return { url: submission.url, number: submission.number };
  }
  const branch = await repo.createBranch(ownBranch(user, target.location.key), sha, submissions);
  const lines = codeBlock(pairChanged ? [`${wordLabel(old)} → ${wordLabel(entry)}`] : [body.path]);
  return repo.openPullRequest(branch, message, prBody(user, lines, paths));
}

// The signed-in contributor's open submissions, entry by entry: what `search.json` cannot show yet.
// Only their own branches (submit/<id>/) are read: their new words and their edits of anyone's;
// a path their own later edit moved away is gone from the branch and skipped.
export async function listOwn(env, user) {
  const repo = new Repo(env, await installationToken(env));
  const { submissions } = await repo.snapshot();
  const files = submissions.filter(isOwn(user)).flatMap((s) => s.paths.map((path) => ({ path, submission: s })));
  const texts = await repo.blobs(files.map(({ path, submission }) => `${submission.head.oid}:${path}`), 'text');
  return files.flatMap(({ path, submission }, i) =>
    texts[i] === null ? [] : [{ path, entry: JSON.parse(texts[i]), pullRequest: { url: submission.url, number: submission.number } }],
  );
}

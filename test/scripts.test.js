import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { NOREPLY_RE, serializeEntry } from '../lib/entry.js';
import { checkTree } from '../scripts/check-tree.js';
import { groupEntries, toCsv } from '../scripts/compile.js';
import { pullRequestMode, validatePullRequest } from '../scripts/validate.js';
import { accentEntry, KEY } from './fixtures.js';

// Tests for the CI validator and the compile script, on throwaway git repositories.

const OCTOCAT = { name: 'octocat', email: '583231+octocat@users.noreply.github.com' };
const MALLORY = { name: 'mallory', email: '999+mallory@users.noreply.github.com' };

function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'community-dictionary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (args, author = OCTOCAT) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: 'app',
        GIT_COMMITTER_EMAIL: 'app@example.com',
      },
    }).trim();
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = (author, message) => {
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', message], author);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q', '-b', 'main']);
  write('README.md', 'x\n');
  write(`entries/octocat/${KEY}.json`, serializeEntry(accentEntry()));
  const base = commit(OCTOCAT, 'base');
  return { root, git, write, commit, base };
}

test('checkTree accepts a valid tree', async (t) => {
  const { root } = makeRepo(t);
  {
    const { errors, count } = await checkTree(root);
    assert.deepEqual({ errors, count }, { errors: [], count: 1 });
  }
});

test('checkTree: same contributor, same pair, two directories', async (t) => {
  const { root, write } = makeRepo(t);
  write(`entries/octocat-renamed/${KEY}.json`, serializeEntry({ ...accentEntry(), contributor: 'octocat-renamed' }));
  assert.deepEqual((await checkTree(root)).errors, [
    `entries/octocat/${KEY}.json: contributor 583231 already submitted this pair in entries/octocat-renamed/${KEY}.json`,
  ]);
});

test('checkTree: a second contributor attesting the same pair is fine', async (t) => {
  const { root, write } = makeRepo(t);
  write(`entries/mallory/${KEY}.json`, serializeEntry({ ...accentEntry(), contributor: 'mallory', contributor_id: 999 }));
  {
    const { errors, count } = await checkTree(root);
    assert.deepEqual({ errors, count }, { errors: [], count: 2 });
  }
});

test('checkTree: stray file and symlink', async (t) => {
  const { root, write } = makeRepo(t);
  write('entries/octocat/notes.txt', 'x');
  assert.deepEqual((await checkTree(root)).errors, ['entries/octocat/notes.txt: not of the form entries/<login>/<16 hex key>.json']);
  rmSync(join(root, 'entries/octocat/notes.txt'));
  symlinkSync('/etc/hosts', join(root, 'entries/octocat/link.json'));
  assert.deepEqual((await checkTree(root)).errors, ['entries/octocat/link.json: not a regular file']);
});

test('validatePullRequest (submission): owner edits and withdraws', async (t) => {
  const { root, write, commit, git, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/583231/x']);
  write(`entries/octocat/${KEY}.json`, serializeEntry({ ...accentEntry(), note: 'edited' }));
  commit(OCTOCAT, 'edit');
  rmSync(join(root, `entries/octocat/${KEY}.json`));
  const head = commit(OCTOCAT, 'withdraw');
  assert.deepEqual(validatePullRequest(root, base, head, 'submission'), { errors: [], commits: 2 });
});

test('validatePullRequest (submission): another contributor edits, takes over or deletes a file', async (t) => {
  const { root, write, commit, git, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/999/x']);
  write(`entries/octocat/${KEY}.json`, serializeEntry({ ...accentEntry(), contributor_id: 999 }));
  const takeover = commit(MALLORY, 'take over');
  rmSync(join(root, `entries/octocat/${KEY}.json`));
  const remove = commit(MALLORY, 'delete');
  // The delete passes on its own (the old version already says 999); the takeover is what fails.
  assert.deepEqual(validatePullRequest(root, base, remove, 'submission').errors, [
    `${takeover}: entries/octocat/${KEY}.json (old version) belongs to contributor 583231, not commit author 999`,
  ]);
});

test('validatePullRequest (submission): files outside entries/, foreign author, merge commit', async (t) => {
  const { root, write, commit, git } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/583231/x']);
  write('.github/workflows/evil.yml', 'x');
  const outside = commit(OCTOCAT, 'outside');
  const bot = commit({ name: 'someone', email: 'someone@example.com' }, 'empty');
  git(['checkout', '-q', 'main']);
  write('other.txt', 'x');
  // CI passes the pull request's base = current main tip, so main's own commits are excluded
  const base = commit(OCTOCAT, 'main moves');
  git(['checkout', '-q', 'submit/583231/x']);
  git(['merge', '-q', '--no-edit', 'main']);
  const merge = git(['rev-parse', 'HEAD']);
  assert.deepEqual(validatePullRequest(root, base, merge, 'submission').errors, [
    '.github/workflows/evil.yml: a submission may only change entries/',
    `${outside}: .github/workflows/evil.yml (new version) belongs to contributor unknown, not commit author 583231`,
    `${bot}: author someone@example.com is not a GitHub noreply address <id>+<login>@users.noreply.github.com`,
    `${merge}: a submission may not contain merge commits`,
  ]);
});

test('compile merges attestations of one pair into one row', async () => {
  const octocat = accentEntry();
  const mallory = { ...accentEntry(), contributor: 'mallory', contributor_id: 999, accents: ['三峽偏泉腔'], note: 'a, "b"', submitted: '2026-11-19' };
  const rows = groupEntries([
    { key: KEY, entry: octocat },
    { key: KEY, entry: mallory },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].attestations.map((a) => a.contributor), ['mallory', 'octocat']);
  assert.equal(
    toCsv(rows),
    'key,hanji,tl,categories,accents,place,meaning,source,note,contributors\r\n' +
      `${KEY},八,pueh,khiunn-khau,三峽偏泉腔; 鹿港偏泉腔,,,,"a, ""b""\n鹿港講 pueh。",mallory; octocat\r\n`,
  );
});

test('pullRequestMode', () => {
  const app = { appLogin: 'tk-submit[bot]', repo: 'o/r', headRepo: 'o/r' };
  assert.equal(pullRequestMode({ ...app, author: 'tk-submit[bot]', association: 'NONE' }), 'submission');
  // a fork cannot be a submission even when the author name matches
  assert.equal(pullRequestMode({ ...app, author: 'tk-submit[bot]', headRepo: 'x/r', association: 'NONE' }), 'outside');
  assert.equal(pullRequestMode({ ...app, author: 'owner', association: 'OWNER' }), 'member');
  assert.equal(pullRequestMode({ ...app, author: 'stranger', association: 'CONTRIBUTOR' }), 'outside');
  // until the App exists (SUBMIT_APP_LOGIN unset) nothing is a submission
  assert.equal(pullRequestMode({ ...app, appLogin: '', author: '', association: 'NONE' }), 'outside');
});

test('validatePullRequest (outside): entries/ is off limits, other files are not', async (t) => {
  const { write, commit, git, root, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'fix-typo']);
  write('README.md', 'y\n');
  write(`entries/octocat/${KEY}.json`, serializeEntry({ ...accentEntry(), note: 'x' }));
  const head = commit(MALLORY, 'edit');
  assert.deepEqual(validatePullRequest(root, base, head, 'outside').errors, [
    `entries/octocat/${KEY}.json: entries can only be changed through the submission form`,
  ]);
  assert.deepEqual(validatePullRequest(root, base, head, 'member').errors, []);
});

test('validatePullRequest (submission): new file in another login directory', async (t) => {
  const { write, commit, git, root, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/999/x']);
  write(`entries/octocat/e5a555f359c2404d.json`, serializeEntry({
    ...accentEntry(), hanji: '做khang-khuè', tl: 'tsò-khang-khuè', contributor: 'mallory', contributor_id: 999,
  }));
  const head = commit(MALLORY, 'squat');
  assert.deepEqual(validatePullRequest(root, base, head, 'submission').errors, [
    `${head}: entries/octocat/e5a555f359c2404d.json is not under the contributor's own directory entries/mallory/`,
  ]);
});

test('NOREPLY_RE rejects a zero-padded id', () => {
  assert.equal(NOREPLY_RE.exec('999+m@users.noreply.github.com')[1], '999');
  assert.equal(NOREPLY_RE.exec('0999+m@users.noreply.github.com'), null);
});

test('CSV neutralizes formula-like cells', () => {
  const rows = groupEntries([{ key: KEY, entry: { ...accentEntry(), note: '=HYPERLINK("x")' } }]);
  assert.match(toCsv(rows), /,"'=HYPERLINK\(""x""\)",octocat\r\n$/);
});

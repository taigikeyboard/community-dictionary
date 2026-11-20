import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { NOREPLY_RE, serializeEntry } from '../lib/entry.js';
import { checkTree } from '../scripts/check-tree.js';
import { groupEntries, toCsv } from '../scripts/compile.js';
import { foldTl, isPlaceCategory, parseAnswer } from '../scripts/import-itaigi.js';
import { buildSearchRows, parseItaigi } from '../scripts/itaigi.js';
import { TAG_NAMES } from '../site/tags.js';
import { romanize } from '../scripts/romanize.js';
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
  const mallory = { ...accentEntry(), contributor: 'mallory', contributor_id: 999, accents: ['三峽偏泉腔'], tags: ['食食', '𨑨迌'], note: 'a, "b"', submitted: '2026-11-19' };
  const rows = groupEntries([
    { key: KEY, entry: octocat },
    { key: KEY, entry: mallory },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].attestations.map((a) => a.contributor), ['mallory', 'octocat']);
  assert.equal(
    toCsv(rows),
    'key,hanji,tl,accents,tags,place,meaning,example,note,contributors\r\n' +
      `${KEY},八,pueh,三峽偏泉腔; 鹿港偏泉腔,食食; 𨑨迌,,,,"a, ""b""\n鹿港講 pueh。",mallory; octocat\r\n`,
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

test('parseItaigi: crowdsourced rows only, Tâi-lô cleaned, repeats and non-Tâi-lô dropped', () => {
  const json = JSON.stringify({
    資料: [
      { 華語: '討厭', 來源: 'Liz Lin', 漢字: '𤺪呢', 羅馬字: 'siān-neh' },
      // an identical row is dropped; the same word from another contributor is its own row
      { 華語: '討厭', 來源: 'Liz Lin', 漢字: '𤺪呢', 羅馬字: 'siān-neh' },
      { 華語: '討厭', 來源: '匿名', 漢字: '𤺪呢', 羅馬字: 'siān-neh' },
      // imported dictionaries are not iTaigi's own content
      { 華語: '討厭', 來源: '臺灣閩南語常用詞辭典', 漢字: '討厭', 羅馬字: 'thó-ià' },
      { 華語: '一場空', 來源: '台文華文線頂辭典', 漢字: '空', 羅馬字: 'khang' },
      // a full-width space between syllables becomes a plain one
      { 華語: '一人', 來源: '匿名', 漢字: '一人', 羅馬字: 'tsit8　lang5' },
      // Hanji typed in the Tâi-lô field, or nothing there, is not a reading
      { 華語: '洪荒之力', 來源: '匿名', 漢字: '洪荒之力', 羅馬字: '洪荒之力' },
      { 華語: '空', 來源: '匿名', 漢字: '空', 羅馬字: '' },
    ],
  });
  assert.deepEqual(parseItaigi(json), [
    ['𤺪呢', 'siān-neh', '討厭', 'Liz Lin'],
    ['𤺪呢', 'siān-neh', '討厭', '匿名'],
    ['一人', 'tsit8 lang5', '一人', '匿名'],
  ]);
  assert.throws(() => parseItaigi('{"rows":[]}'), /no 資料 array/);
});

test('romanize: POJ only where it differs from tl, TPS per "/" variant', () => {
  // trace: converter output for each reading, run 2026-11-21
  assert.deepEqual(romanize('siān-neh'), { poj: '', tps: 'ㄒㄧㄢ˫ ㄋㆤㆷ' });
  assert.deepEqual(romanize('tiám-lu-îng-bōo'), { poj: 'tiám-lu-êng-bō͘', tps: 'ㄉㄧㆰˋ ㄌㄨ ㄧㄥˊ ㆠㆦ˫' });
  assert.deepEqual(romanize('tshenn-hue/tshinn-hue'), { poj: 'chheⁿ-hoe/chhiⁿ-hoe', tps: 'ㄘㆥ ㄏㄨㆤ / ㄑㆪ ㄏㄨㆤ' });
  // trace: "thong,bān" gets a space so bān converts; "koo-chiáu" leaves "chiau2" unconverted → no tps;
  // "ti-kut / tu-kut" POJ equals the trimmed variants → no poj
  assert.deepEqual(romanize('it lí thong,bān lí thiat'), { poj: '', tps: 'ㄧㆵ ㄌㄧˋ ㄊㆲ，ㆠㄢ˫ ㄌㄧˋ ㄊㄧㄚㆵ' });
  assert.equal(romanize('koo-chiáu').tps, '');
  assert.equal(romanize('ti-kut / tu-kut').poj, '');
});

test('buildSearchRows: readings added, tags as indices, contributors kept, unknown tag fails', () => {
  const pairs = [
    ['𤺪呢', 'siān-neh', ['心情'], ['Liz Lin', '匿名']],
    ['閣', 'koh', [], ['匿名']],
  ];
  // trace: romanize('koh') → poj "" (same as tl), tps "ㄍㄛㆷ"
  assert.deepEqual(buildSearchRows(pairs), [
    ['𤺪呢', 'siān-neh', '', 'ㄒㄧㄢ˫ ㄋㆤㆷ', [TAG_NAMES.indexOf('心情')], ['Liz Lin', '匿名']],
    ['閣', 'koh', '', 'ㄍㄛㆷ', [], ['匿名']],
  ]);
  assert.throws(() => buildSearchRows([['閣', 'koh', ['華語'], []]]), /unknown tag "華語"/);
});

test('import-itaigi: reading fold, place categories, reply parsing', () => {
  // trace: tone marks drop, ⁿ and the POJ dot (U+0358) stay letters
  assert.equal(foldTl('Tsa̍p-pueh'), 'tsappueh');
  assert.notEqual(foldTl('to͘h'), foldTl('toh'));
  assert.notEqual(foldTl('chheⁿ'), foldTl('chhe'));
  assert.ok(isPlaceCategory('臺北捷運板南線') && isPlaceCategory('臺南市') && !isPlaceCategory('生活用品'));
  assert.deepEqual(parseAnswer('note {"0":["食食","華語"],"1":[]} done', 2), [['食食'], []]);
  assert.throws(() => parseAnswer('{"0":["食食"]}', 2), /no tag list for word 1/);
  assert.throws(() => parseAnswer('sorry, no JSON', 1), /reply is not JSON/);
});

test('data/itaigi.json: every row is [hanji, tl, [listed tag], [contributor]]', async () => {
  const data = JSON.parse(await readFile(new URL('../data/itaigi.json', import.meta.url), 'utf8'));
  for (const row of data) {
    const [hanji, tl, tags, contributors] = row;
    assert.equal(row.length, 4, JSON.stringify(row));
    assert.ok(typeof hanji === 'string' && /[A-Za-z]/.test(tl), JSON.stringify(row));
    for (const tag of tags) assert.ok(TAG_NAMES.includes(tag), `${hanji} ${tl}: ${tag}`);
    assert.ok(contributors.length > 0 && contributors.every((c) => typeof c === 'string' && c !== ''), JSON.stringify(row));
  }
});

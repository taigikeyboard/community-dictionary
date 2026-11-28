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
import { csvSource, parseCsv, rowsToEntries } from '../scripts/import-batch.js';
import { foldTl, isPlaceCategory, parseAnswer } from '../scripts/import-itaigi.js';
import { buildSearchRows, parseItaigi } from '../scripts/itaigi.js';
import { TAG_NAMES } from '../site/tags.js';
import { romanize } from '../scripts/romanize.js';
import { buildStats, LONGEST } from '../scripts/stats.js';
import { buildTagMap, sampleWords } from '../scripts/tag-map.js';
import { pullRequestMode, validatePullRequest } from '../scripts/validate.js';
import { accentEntry, KEY } from './fixtures.js';

// Tests for the build-time scripts: the CI validator and compile (on throwaway git repositories),
// the iTaigi import, romanization, the tag map and the statistics.

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
  const { errors, count } = await checkTree(root);
  assert.deepEqual({ errors, count }, { errors: [], count: 1 });
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
  const { errors, count } = await checkTree(root);
  assert.deepEqual({ errors, count }, { errors: [], count: 2 });
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

test('validatePullRequest (submission): another contributor edits, then moves the pair', async (t) => {
  const { root, write, commit, git, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/999/x']);
  const edited = { ...accentEntry(), note: 'edited', editors: [{ login: 'mallory', id: 999 }] };
  write(`entries/octocat/${KEY}.json`, serializeEntry(edited));
  commit(MALLORY, 'edit');
  rmSync(join(root, `entries/octocat/${KEY}.json`));
  write('entries/octocat/e5a555f359c2404d.json', serializeEntry({ ...edited, hanji: '做khang-khuè', tl: 'tsò-khang-khuè' }));
  const head = commit(MALLORY, 'move');
  assert.deepEqual(validatePullRequest(root, base, head, 'submission'), { errors: [], commits: 2 });
});

test('validatePullRequest (submission): another contributor takes over, skips the editors or deletes', async (t) => {
  const { root, write, commit, git, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/999/x']);
  write(`entries/octocat/${KEY}.json`, serializeEntry({ ...accentEntry(), contributor: 'mallory', contributor_id: 999 }));
  const takeover = commit(MALLORY, 'take over');
  git(['reset', '-q', '--hard', base]);
  write(`entries/octocat/${KEY}.json`, serializeEntry({ ...accentEntry(), note: 'x' }));
  const unlisted = commit(MALLORY, 'edit without editors');
  git(['reset', '-q', '--hard', base]);
  rmSync(join(root, `entries/octocat/${KEY}.json`));
  const remove = commit(MALLORY, 'delete');
  const errorsOf = (head) => validatePullRequest(root, base, head, 'submission').errors;
  assert.deepEqual(errorsOf(takeover), [`${takeover}: entries/octocat/${KEY}.json changes who contributed contributor 583231's entry or when`]);
  assert.deepEqual(errorsOf(unlisted), [`${unlisted}: entries/octocat/${KEY}.json editors must be [{"login":"mallory","id":999}]`]);
  assert.deepEqual(errorsOf(remove), [`${remove}: entries/octocat/${KEY}.json belongs to contributor 583231; only they may delete it`]);
});

test('validatePullRequest (submission): a symlink round trip cannot take over a file', async (t) => {
  const { root, write, commit, git, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/999/x']);
  const path = `entries/octocat/${KEY}.json`;
  rmSync(join(root, path));
  symlinkSync('{"contributor_id":999,"editors":[]}', join(root, path));
  const link = commit(MALLORY, 'to symlink');
  rmSync(join(root, path));
  write(path, serializeEntry({ ...accentEntry(), contributor: 'mallory', contributor_id: 999 }));
  const back = commit(MALLORY, 'back to file');
  assert.deepEqual(validatePullRequest(root, base, back, 'submission').errors, [
    `${link}: ${path} changes who contributed contributor 583231's entry or when`,
    `${back}: ${path} changes who contributed contributor 999's entry or when`,
  ]);
});

test('validatePullRequest (submission): no change answers to an unreadable previous version', async (t) => {
  const { root, write, commit, git, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/999/x']);
  const path = `entries/octocat/${KEY}.json`;
  write(path, '{"editors":[]}');
  const broken = commit(MALLORY, 'break');
  write(path, 'not json');
  const after = commit(MALLORY, 'after');
  rmSync(join(root, path));
  write('entries/mallory/e5a555f359c2404d.json', '{"editors":[]}');
  const moved = commit(MALLORY, 'move without id');
  assert.deepEqual(validatePullRequest(root, base, moved, 'submission').errors, [
    `${broken}: ${path} changes who contributed contributor 583231's entry or when`,
    `${after}: ${path} replaces a file that is not a readable entry`,
    `${moved}: entries/mallory/e5a555f359c2404d.json is not under the contributor's own directory entries/undefined/`,
    `${moved}: entries/mallory/e5a555f359c2404d.json belongs to contributor unknown, not commit author 999`,
    `${moved}: ${path} belongs to contributor unknown; only they may delete it`,
  ]);
});

test('validatePullRequest (submission): a new entry names its author as contributor', async (t) => {
  const { write, commit, git, base, root } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/999/x']);
  write('entries/octocat/e5a555f359c2404d.json', serializeEntry({
    ...accentEntry(), hanji: '做khang-khuè', tl: 'tsò-khang-khuè', contributor_id: 999,
  }));
  const head = commit(MALLORY, 'pose as octocat');
  assert.deepEqual(validatePullRequest(root, base, head, 'submission').errors, [`${head}: entries/octocat/e5a555f359c2404d.json names contributor octocat, not commit author mallory`]);
});

test('validatePullRequest (submission): iTaigi names stay with the entry', async (t) => {
  const { root, write, commit, git, base } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/999/x']);
  const path = `entries/octocat/${KEY}.json`;
  write(path, serializeEntry({ ...accentEntry(), itaigi_contributors: ['Liz Lin'], editors: [{ login: 'mallory', id: 999 }] }));
  const rename = commit(MALLORY, 'add a name');
  git(['reset', '-q', '--hard', base]);
  write('entries/mallory/e5a555f359c2404d.json', serializeEntry({
    ...accentEntry(), hanji: '做khang-khuè', tl: 'tsò-khang-khuè', contributor: 'mallory', contributor_id: 999, itaigi_contributors: ['Liz Lin'],
  }));
  const added = commit(MALLORY, 'new with names');
  const errorsOf = (head) => validatePullRequest(root, base, head, 'submission').errors;
  assert.deepEqual(errorsOf(rename), [`${rename}: ${path} changes who contributed contributor 583231's entry or when`]);
  assert.deepEqual(errorsOf(added), [`${added}: entries/mallory/e5a555f359c2404d.json is a new entry, so it has no iTaigi contributors`]);
});

test('validatePullRequest (submission): a new entry lists no editors', async (t) => {
  const { write, commit, git, base, root } = makeRepo(t);
  git(['checkout', '-q', '-b', 'submit/583231/x']);
  write('entries/octocat/e5a555f359c2404d.json', serializeEntry({
    ...accentEntry(), hanji: '做khang-khuè', tl: 'tsò-khang-khuè', editors: [{ login: 'mallory', id: 999 }],
  }));
  const head = commit(OCTOCAT, 'add');
  assert.deepEqual(validatePullRequest(root, base, head, 'submission').errors, [`${head}: entries/octocat/e5a555f359c2404d.json is a new entry, so it lists no editors`]);
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
    `${outside}: .github/workflows/evil.yml belongs to contributor unknown, not commit author 583231`,
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
    'key,hanji,tl,accents,tags,place,meaning,examples,note,contributors\r\n' +
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
      { 華語: '討厭', 來源: '阿明', 漢字: '𤺪呢', 羅馬字: 'siān-neh' },
      // an identical row is dropped; one from another contributor is kept (its credit)
      { 華語: '討厭', 來源: '阿明', 漢字: '𤺪呢', 羅馬字: 'siān-neh' },
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
  // trace: rows are distinct on all four fields, so the second 阿明 row goes and the 匿名 one stays
  assert.deepEqual(parseItaigi(json), [
    ['𤺪呢', 'siān-neh', '討厭', '阿明'],
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

test('buildSearchRows: readings added, tags as indices, contributors kept, bad rows fail', () => {
  const pairs = [
    ['𤺪呢', 'siān-neh', ['心情'], ['阿明']],
    ['閣', 'koh', [], ['阿明', '阿珠']],
  ];
  // trace: romanize('koh') → poj "" (same as tl), tps "ㄍㄛㆷ"
  assert.deepEqual(buildSearchRows(pairs), [
    ['𤺪呢', 'siān-neh', '', 'ㄒㄧㄢ˫ ㄋㆤㆷ', [TAG_NAMES.indexOf('心情')], ['阿明']],
    ['閣', 'koh', '', 'ㄍㄛㆷ', [], ['阿明', '阿珠']],
  ]);
  assert.throws(() => buildSearchRows([['閣', 'koh', ['華語'], ['阿明']]]), /unknown tag "華語"/);
  assert.throws(() => buildSearchRows([['閣', 'koh', []]]), /no contributor names/);
  assert.throws(() => buildSearchRows([['閣', 'koh', [], []]]), /no contributor names/);
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
    assert.ok(contributors.length > 0 && contributors.every((name) => typeof name === 'string' && name !== ''), JSON.stringify(row));
  }
});

test('tag-map sampleWords: 2 to 4 characters, no spaces, one per Hanji, a stable pick', () => {
  const rows = [
    { hanji: '食', tl: 'tsia̍h' },
    { hanji: '食飯', tl: 'tsia̍h-pn̄g' },
    { hanji: '食飯', tl: 'tsia̍h-png' },
    { hanji: '番薯葉仔', tl: 'han-tsî-hio̍h-á' },
    { hanji: '食飽未閣' + '啊', tl: 'x' },
    { hanji: '卵 包', tl: 'nn̄g pau' },
  ];
  // trace: 食 too short, 食飽未閣啊 too long, 卵 包 has a space, the second 食飯 a repeat
  assert.deepEqual(sampleWords(rows).map(([hanji]) => hanji).sort(), ['番薯葉仔', '食飯'].sort());
  assert.deepEqual(sampleWords(rows), sampleWords([...rows].reverse().filter((row) => row.tl !== 'tsia̍h-png')));
  assert.equal(sampleWords(rows, 1).length, 1);
});

test('tag-map buildTagMap: counts and samples are the words of the tag page', () => {
  const index = TAG_NAMES.indexOf('食食');
  const itaigi = [
    ['食飯', 'tsia̍h-pn̄g', '', '', [index]],
    ['米粉', 'bí-hún', '', '', [index, 0]],
    ['跤頭趺', 'kha-thâu-u', '', '', [0]],
  ];
  const community = [{ hanji: '鹹粿', tl: 'kiâm-kué', attestations: [{ tags: ['食食'] }] }];
  const food = buildTagMap(community, itaigi).find((tag) => tag.name === '食食');
  assert.equal(food.count, 3);
  assert.deepEqual(food.words.map(([hanji]) => hanji).sort(), ['米粉', '食飯', '鹹粿'].sort());
});

test('stats buildStats: counts from the served rows, both sources', () => {
  const [food, plant, body] = ['食食', '植物', '身軀'].map((name) => TAG_NAMES.indexOf(name));
  const itaigi = [
    ['青花', 'tshenn-hue/tshinn-hue', '', '', [food, plant], ['阿明']],
    ['米粉', 'bí-hún', '', '', [plant, food], ['阿明', '阿珠']],
    ['跤頭趺', 'kha-thâu-u', '', '', [body], ['阿明']],
    ['大人𤆬囡仔去𨑨迌', 'tuā-lâng tshuā gín-á khì tshit-thô', '', '', [], ['阿華']],
    ['一', 'it', '', '', [], ['匿名']],
    ['二', 'jī', '', '', [], ['匿名']],
    ['三', 'sann', '', '', [], ['匿名']],
    ['四', 'sì', '', '', [], ['匿名']],
  ];
  const community = [{ hanji: '鹹粿', tl: 'kiâm-kué', attestations: [{ tags: ['食食', '夜市仔'], contributor: 'octocat', contributor_id: 583231 }, { tags: ['食食'], contributor: 'octocat', contributor_id: 583231 }] },
    { hanji: '粿', tl: 'kué', attestations: [{ tags: [], contributor: 'hubot', contributor_id: 480938 }] },
    { hanji: '', tl: 'kué-á', attestations: [{ tags: [], contributor: 'octocat', contributor_id: 583231 }] },
  ];
  const tagMap = [{ name: '植物', tl: 'si̍t-bu̍t', count: 2 }, { name: '食食', tl: 'tsia̍h-si̍t', count: 3 }];
  const stats = buildStats(community, itaigi, tagMap);
  // trace: 11 words (8 iTaigi + 3 community); 鹹粿 counts once for octocat (two attestations); 米粉 credits 阿明 and 阿珠;
  // 匿名 counts as a contributor
  assert.equal(stats.words, 11);
  assert.equal(stats.contributors, 6);
  // trace: octocat gave 鹹粿 (twice, one word) and kué-á → 2; hubot 粿 → 1; iTaigi names never appear
  assert.deepEqual(stats.githubContributors, [{ name: 'octocat', id: 583231, count: 2 }, { name: 'hubot', id: 480938, count: 1 }]);
  // trace: 青花, 米粉 (two site tags each) and 鹹粿 (食食 + its own 夜市仔) carry more than one tag
  assert.equal(stats.multiTag, 3);
  // trace: the 食食/植物 pair on 青花 and 米粉, whatever order their tags came in; 夜市仔 is no site tag
  assert.deepEqual(stats.pairs, [{ tags: ['食食', '植物'], count: 2 }]);
  // trace: lengths 一二三四 粿 1, 青花 米粉 鹹粿 2, 跤頭趺 3, the 8-character phrase in the last bucket;
  // kué-á has no Hanji and no length
  assert.deepEqual(stats.lengths.map((b) => b.count), [5, 3, 1, 0, 0, 0, 0, 1]);
  assert.equal(stats.lengths.at(-1).length, LONGEST);
  assert.ok(stats.lengths.at(-1).orLonger);
  // tags by count, most first
  assert.deepEqual(stats.perTag.map((t) => t.name), ['食食', '植物']);
});

test('import-batch parses quoted CSV cells, CRLF and a BOM', () => {
  const rows = parseCsv('﻿hanji,tl\r\n"a, ""b""",x\r\n\r\n"two\nlines",y\n');
  assert.deepEqual(rows, [['hanji', 'tl'], ['a, "b"', 'x'], ['two\nlines', 'y']]);
});

test('import-batch turns the template CSV into entries credited to the contributor', async () => {
  const identity = { contributor: 'octocat', contributor_id: 583231, submitted: '2026-11-27', editors: [], itaigi_contributors: [] };
  const text = await readFile(new URL('../site/batch-template.csv', import.meta.url), 'utf8');
  const { entries, errors } = await rowsToEntries(parseCsv(text), identity);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].entry.tl, 'kóng--tsi̍t-siann');
  assert.deepEqual(entries[0].entry.tags, ['動作']);
  assert.equal(entries[0].entry.examples[0].tl, 'khui-tshia khah sè-lī--leh, kàu-uī ài kóng--tsi̍t-siann.');
  assert.equal(entries[0].entry.contributor_id, 583231);
});

test('import-batch reports every bad row by line and splits lists on ;', async () => {
  const identity = { contributor: 'octocat', contributor_id: 583231, submitted: '2026-11-27', editors: [], itaigi_contributors: [] };
  const csv = 'tl,accents,tags\nsiann,臺南混合腔；高雄混合腔,a;b\n,,\nsiann,,\nkhi,火星腔,\n';
  const { entries, errors } = await rowsToEntries(parseCsv(csv), identity);
  assert.deepEqual(entries[0].entry.accents, ['臺南混合腔', '高雄混合腔']);
  assert.deepEqual(entries[0].entry.tags, ['a', 'b']);
  assert.deepEqual(errors, ['line 3: same word as line 2', 'line 4: accents: unknown choice "火星腔"']);
  const header = await rowsToEntries(parseCsv('word,tl\nx,y\n'), identity);
  assert.match(header.errors[0], /unknown column word/);
});

test('import-batch finds the CSV attached or pasted in the issue body', () => {
  const attached = '### CSV\n\n[w.csv](https://github.com/user-attachments/files/123/w.csv)\n\n### 授權 Licence\n\n- [X] ok';
  assert.deepEqual(csvSource(attached), { url: 'https://github.com/user-attachments/files/123/w.csv' });
  assert.deepEqual(csvSource('### CSV\n\n```csv\ntl\nsiann\n```\n\n### 授權 Licence\n'), { text: 'tl\nsiann' });
  assert.equal(csvSource('### CSV\n\n_No response_\n'), null);
});

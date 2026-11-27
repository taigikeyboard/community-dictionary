import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupEntries } from '../scripts/compile.js';
import {
  checkBatch,
  checkForm,
  contributorRoute,
  editRoute,
  duplicateStatus,
  findExisting,
  foldSearch,
  formToRaw,
  indexItaigi,
  packCircles,
  searchItaigi,
  parseRoute,
  searchRows,
  tagCircles,
  tagRoute,
  wordRoute,
  wordsByContributor,
  wordsSpelled,
  wordsWithTag,
} from '../site/logic.js';
import { describeIssues, setLanguage, STRINGS, tagLabel, t } from '../site/strings.js';
import { TAG_NAMES } from '../site/tags.js';
import { accentEntry, KEY } from './fixtures.js';

// Tests for the browser-free site logic.

const rows = groupEntries([{ key: KEY, entry: accentEntry() }]);

test('foldSearch drops tone marks, digits, case and spacing', () => {
  assert.equal(foldSearch('Tsa̍p-pueh'), 'tsap-pueh');
  assert.equal(foldSearch(' tsap8  pueh4 '), 'tsap-pueh');
});

test('searchRows matches hanji or the start of a tl syllable', () => {
  assert.equal(searchRows(rows, '八').length, 1);
  assert.equal(searchRows(rows, 'pu').length, 1);
  assert.equal(searchRows(rows, 'ueh').length, 0);
  assert.equal(searchRows(rows, '  ').length, 0);
});

test('formToRaw keeps place only with the 其他 accent', () => {
  const identity = { login: 'octocat', id: 1, today: '2026-11-20' };
  const raw = formToRaw({ hanji: '手機', tl: 'tshiú-ki', accents: ['鹿港偏泉腔'], place: 'x', meaning: '手機', note: '' }, identity);
  assert.deepEqual([raw.accents, raw.place, raw.meaning], [['鹿港偏泉腔'], '', '手機']);
  assert.equal(formToRaw({ tl: 'a', accents: ['其他'], place: '澎湖' }, identity).place, '澎湖');
});

test('checkForm + describeIssues give Taiwanese messages per field', () => {
  const { issues } = checkForm({ hanji: '', tl: 'pueh!', accents: ['其他'], note: '' });
  assert.deepEqual(describeIssues(issues), [
    { field: 'tl', text: '台羅：干焦會當用台羅字母、調符、數字、空格佮「-」' },
    { field: 'place', text: '請填寫資料' },
  ]);
  const ok = checkForm({ hanji: ' 八', tl: 'pueh ', accents: ['鹿港偏泉腔'], note: '' });
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.entry.hanji, '八');
  // only Tâi-lô is required
  assert.deepEqual(checkForm({ tl: 'pueh' }).issues, []);
  // tags: listed and own tags alike, with Taiwanese messages naming the bad tag
  assert.deepEqual(checkForm({ tl: 'pueh', tags: ['食食', '夜市仔'] }).entry.tags, ['食食', '夜市仔']);
  assert.deepEqual(describeIssues(checkForm({ tl: 'pueh', tags: ['food!'] }).issues), [
    { field: 'tags', text: '標籤：「food!」干焦會當用漢字、假名、台羅字母佮「-」' },
  ]);
  assert.deepEqual(describeIssues(checkForm({ tl: 'pueh', tags: ['一', '二', '三', '四', '五', '六'] }).issues), [
    { field: 'tags', text: '標籤：上濟 5 个' },
  ]);
});

test('duplicateStatus: new, attested by others, mine', async () => {
  assert.equal((await duplicateStatus(rows, '九', 'kau')).status, 'new');
  const attested = await duplicateStatus(rows, '八', 'Pueh');
  assert.deepEqual([attested.status, attested.contributors], ['attested', ['octocat']]);
  assert.equal((await duplicateStatus(rows, '八', 'pueh', 583231)).status, 'mine');
});

test('findExisting: exact pair first, both fields searched', () => {
  assert.deepEqual(findExisting(rows, '八', 'pueh').map((f) => [f.row.key, f.exact]), [[KEY, true]]);
  assert.deepEqual(findExisting(rows, '', 'pu').map((f) => [f.row.key, f.exact]), [[KEY, false]]);
  assert.deepEqual(findExisting(rows, '九', 'kau'), []);
  assert.deepEqual(findExisting(rows, ' ', ''), []);
});

test('checkBatch: per-row errors, shared errors once, blank rows skipped, repeats flagged', async () => {
  const shared = { accents: ['其他'], place: '', meaning: '', note: '' };
  const { entries, errors } = await checkBatch(shared, [
    { hanji: '網紅', tl: 'bāng-âng' },
    { hanji: '', tl: '' },
    { hanji: '網紅', tl: 'Bāng âng' },
    { hanji: '!', tl: 'x' },
  ]);
  assert.deepEqual(entries, []);
  assert.deepEqual(errors, [
    { field: 'place', text: '請填寫資料' },
    { field: 'hanji', row: 3, text: '漢字、日語：干焦會當用漢字、假名、台羅字母佮「-」' },
  ]);

  const ok = await checkBatch({ ...shared, place: '澎湖' }, [
    { hanji: '網紅', tl: 'bāng-âng' },
    { hanji: '', tl: '' },
    { hanji: '網紅', tl: 'Bāng âng' },
  ]);
  assert.deepEqual(ok.errors, [{ field: 'tl', row: 2, text: '佮第 1 个詞仝款' }]);
  assert.deepEqual(ok.entries.map((e) => e.row), [0]);

  // a lone blank row still reports the missing Tâi-lô
  const blank = await checkBatch({ ...shared, place: '澎湖' }, [{ hanji: '', tl: '' }]);
  assert.deepEqual(blank.errors, [{ field: 'tl', row: 0, text: '請填寫資料' }]);
});

test('iTaigi rows: search order (exact, prefix, rest) and the card-page lookups', () => {
  const [food, plant, feeling] = ['食食', '植物', '心情'].map((name) => TAG_NAMES.indexOf(name));
  const index = indexItaigi([
    ['青花', 'tshenn-hue/tshinn-hue', 'chheⁿ-hoe/chhiⁿ-hoe', 'ㄘㆥ ㄏㄨㆤ / ㄑㆪ ㄏㄨㆤ', [food, plant], ['阿明']],
    ['花蕊', 'hue-luí', 'hoe-luí', 'ㄏㄨㆤ ㄌㄨㄧˋ', [plant], ['阿明', '阿珠']],
    ['花', 'hue', 'hoe', 'ㄏㄨㆤ', [plant], ['阿珠']],
    ['𤺪呢', 'siān-neh', '', 'ㄒㄧㄢ˫ ㄋㆤㆷ', [feeling], ['阿明']],
  ]);
  const hanji = (query) => searchItaigi(index, query).map((r) => r.hanji);
  assert.deepEqual(hanji('花'), ['花', '花蕊', '青花']);
  assert.deepEqual(hanji('hue'), ['花', '花蕊', '青花']);
  // a later variant typed in full, and the whole slash-joined reading, are exact matches
  assert.deepEqual(hanji('tshinn-hue'), ['青花']);
  assert.deepEqual(hanji('tshenn-hue/tshinn-hue'), ['青花']);
  assert.deepEqual(hanji(' '), []);
  // the Mandarin gloss is no longer published, so it matches nothing
  assert.deepEqual(hanji('討厭'), []);

  // a tag's page: community rows by tag name (the fixture carries 食食), iTaigi rows by tag index
  const tagged = wordsWithTag(rows, index, '植物');
  assert.deepEqual([tagged.community.length, tagged.itaigi.map((r) => r.hanji)], [0, ['青花', '花蕊', '花']]);
  assert.deepEqual(wordsWithTag(rows, index, '食食').community.map((r) => r.key), [KEY]);
  assert.deepEqual(wordsWithTag(rows, index, '食食').itaigi.map((r) => r.hanji), ['青花']);
  // a contributor's own tag matches no iTaigi row
  assert.deepEqual(wordsWithTag(rows, index, '夜市仔').itaigi, []);
  // a word's page: exact spelling only
  assert.deepEqual(wordsSpelled(rows, index, '花', 'hue').itaigi.map((r) => r.tl), ['hue']);
  assert.deepEqual(wordsSpelled(rows, index, '八', 'pueh').community.map((r) => r.key), [KEY]);
  assert.deepEqual(wordsSpelled(rows, index, '花', 'hoe').itaigi, []);
  // a contributor's page: community rows by login, iTaigi rows by the names itaigi.tw gives them
  assert.deepEqual(wordsByContributor(rows, index, 'octocat').community.map((r) => r.key), [KEY]);
  assert.deepEqual(wordsByContributor(rows, index, '阿明').itaigi.map((r) => r.hanji), ['青花', '花蕊', '𤺪呢']);
  assert.deepEqual(wordsByContributor(rows, index, '阿珠').itaigi.map((r) => r.hanji), ['花蕊', '花']);
  assert.deepEqual(wordsByContributor(rows, index, 'nobody'), { community: [], itaigi: [] });
});

test('routes: tag and word pages round-trip, anything else is the homepage', () => {
  assert.deepEqual(parseRoute('#/submit'), { page: 'submit' });
  assert.deepEqual(parseRoute('#/search'), { page: 'search' });
  assert.deepEqual(parseRoute('#/mine'), { page: 'mine' });
  assert.deepEqual(parseRoute(editRoute('octocat', KEY)), { page: 'edit', login: 'octocat', key: KEY });
  // only a login and a 16-hex key make an edit route
  for (const hash of ['#/edit/octocat/xyz', '#/edit/-bad-/0123456789abcdef', '#/edit/../0123456789abcdef']) assert.deepEqual(parseRoute(hash), { page: 'home' });
  // the 說明 page is gone (2026-11-26): its old link lands on the homepage
  assert.deepEqual(parseRoute('#/about'), { page: 'home' });
  assert.deepEqual(parseRoute(tagRoute('𨑨迌')), { page: 'tag', tag: '𨑨迌' });
  assert.deepEqual(parseRoute(contributorRoute('阿明')), { page: 'contributor', name: '阿明' });
  // a "/" inside a reading stays inside the tl part
  assert.deepEqual(parseRoute(wordRoute('青花', 'tshenn-hue/tshinn-hue')), { page: 'word', hanji: '青花', tl: 'tshenn-hue/tshinn-hue' });
  // community words may have no Hanji
  assert.deepEqual(parseRoute(wordRoute('', 'pueh')), { page: 'word', hanji: '', tl: 'pueh' });
  for (const hash of ['', '#/', '#/tag/', '#/tag/%E0', '#/word/x', '#/nothing']) assert.deepEqual(parseRoute(hash), { page: 'home' });
});

test('packCircles: no two circles overlap, the largest sits at the centre, same input → same layout', () => {
  const radii = [12, 40, 25, 25, 8, 30, 18, 22, 15, 10, 35, 20];
  const gap = 4;
  const centres = packCircles(radii, { aspect: 2, gap });
  assert.equal(centres.length, radii.length);
  for (let a = 0; a < radii.length; a += 1) {
    for (let b = a + 1; b < radii.length; b += 1) {
      const d = Math.hypot(centres[a].x - centres[b].x, centres[a].y - centres[b].y);
      assert.ok(d >= radii[a] + radii[b] + gap - 1e-6, `circles ${a} and ${b} overlap`);
    }
  }
  assert.deepEqual(centres[1], { x: 0, y: 0 });
  assert.deepEqual(packCircles(radii, { aspect: 2, gap }), centres);
});

test('tagCircles: area follows the count above the minimum radius, the box holds every circle', () => {
  const { box, circles } = tagCircles([400, 100, 1], 900, 450, { minRadius: 20 });
  // 4× the words → 2× the radius
  assert.ok(Math.abs(circles[0].r / circles[1].r - 2) < 1e-9);
  // trace: scale = sqrt(0.55·900·450 / (π·501)) ≈ 11.9, so 1 word → r ≈ 11.9, raised to the 20 floor
  assert.equal(circles[2].r, 20);
  for (const { x, y, r } of circles) {
    assert.ok(x - r >= box.left - 1e-9 && x + r <= box.right + 1e-9 && y - r >= box.top - 1e-9 && y + r <= box.bottom + 1e-9);
  }
});

test('strings: every language has every key; issues and tags follow the language', (context) => {
  context.after(() => setLanguage('nan'));
  for (const lang of ['ja', 'en']) assert.deepEqual(Object.keys(STRINGS[lang]).sort(), Object.keys(STRINGS.nan).sort(), lang);
  const issues = checkForm({ tl: 'pueh', tags: ['food!'] }).issues;
  setLanguage('en');
  assert.deepEqual(describeIssues(issues), [{ field: 'tags', text: 'Tags: "food!" only Hanji, kana, Tâi-lô letters and "-"' }]);
  assert.equal(t('story.wordCount', { count: 3 }), '3 words');
  // site tags get labels, a contributor's own tag keeps its name
  assert.deepEqual(['食食', '夜市仔'].map(tagLabel), ['Food', '夜市仔']);
  setLanguage('ja');
  assert.equal(tagLabel('𨑨迌'), '遊び');
  // an unknown stored value falls back to Taiwanese
  setLanguage('xx');
  assert.equal(tagLabel('食食'), '食食');
});

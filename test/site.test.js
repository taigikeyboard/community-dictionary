import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupEntries } from '../scripts/compile.js';
import {
  checkBatch,
  checkForm,
  describeErrors,
  duplicateStatus,
  findExisting,
  foldSearch,
  formToRaw,
  indexItaigi,
  searchItaigi,
  parseRoute,
  searchRows,
  tagRoute,
  wordRoute,
  wordsSpelled,
  wordsWithTag,
} from '../site/logic.js';
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
  const raw = formToRaw({ hanji: '手機', tl: 'tshiú-ki', accents: ['鹿港偏泉腔'], place: 'x', meaning: '手機', example: '', note: '' }, identity);
  assert.deepEqual([raw.accents, raw.place, raw.meaning], [['鹿港偏泉腔'], '', '手機']);
  assert.equal(formToRaw({ tl: 'a', accents: ['其他'], place: '澎湖' }, identity).place, '澎湖');
});

test('checkForm + describeErrors give Taiwanese messages per field', () => {
  const { errors } = checkForm({ hanji: '', tl: 'pueh!', accents: ['其他'], note: '' });
  assert.deepEqual(describeErrors(errors), [
    { field: 'tl', text: '台羅：干焦會當用台羅字母、調符、數字、空格佮「-」' },
    { field: 'place', text: '所在：愛填' },
  ]);
  const ok = checkForm({ hanji: ' 八', tl: 'pueh ', accents: ['鹿港偏泉腔'], note: '' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.entry.hanji, '八');
  // only Tâi-lô is required
  assert.deepEqual(checkForm({ tl: 'pueh' }).errors, []);
  // tags: listed and own tags alike, with Taiwanese messages naming the bad tag
  assert.deepEqual(checkForm({ tl: 'pueh', tags: ['食食', '夜市仔'] }).entry.tags, ['食食', '夜市仔']);
  assert.deepEqual(describeErrors(checkForm({ tl: 'pueh', tags: ['food!'] }).errors), [
    { field: 'tags', text: '標籤：「food!」干焦會當用漢字、假名、台羅字母佮「-」' },
  ]);
  assert.deepEqual(describeErrors(checkForm({ tl: 'pueh', tags: ['一', '二', '三', '四', '五', '六'] }).errors), [
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
  const shared = { accents: ['其他'], place: '', meaning: '', example: '', note: '' };
  const { entries, errors } = await checkBatch(shared, [
    { hanji: '網紅', tl: 'bāng-âng' },
    { hanji: '', tl: '' },
    { hanji: '網紅', tl: 'Bāng âng' },
    { hanji: '!', tl: 'x' },
  ]);
  assert.deepEqual(entries, []);
  assert.deepEqual(errors, [
    { field: 'place', text: '所在：愛填' },
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
  assert.deepEqual(blank.errors, [{ field: 'tl', row: 0, text: '台羅：愛填' }]);
});

test('searchItaigi: hanji, each variant reading; exact, then prefix, then the rest', () => {
  const [food, plant, feeling] = ['食食', '植物', '心情'].map((name) => TAG_NAMES.indexOf(name));
  const index = indexItaigi([
    ['青花', 'tshenn-hue/tshinn-hue', 'chheⁿ-hoe/chhiⁿ-hoe', 'ㄘㆥ ㄏㄨㆤ / ㄑㆪ ㄏㄨㆤ', [food, plant]],
    ['花蕊', 'hue-luí', 'hoe-luí', 'ㄏㄨㆤ ㄌㄨㄧˋ', [plant]],
    ['花', 'hue', 'hoe', 'ㄏㄨㆤ', [plant]],
    ['𤺪呢', 'siān-neh', '', 'ㄒㄧㄢ˫ ㄋㆤㆷ', [feeling]],
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
});

test('routes: tag and word pages round-trip, anything else is search', () => {
  assert.deepEqual(parseRoute('#/submit'), { page: 'submit' });
  assert.deepEqual(parseRoute(tagRoute('𨑨迌')), { page: 'tag', tag: '𨑨迌' });
  // a "/" inside a reading stays inside the tl part
  assert.deepEqual(parseRoute(wordRoute('青花', 'tshenn-hue/tshinn-hue')), { page: 'word', hanji: '青花', tl: 'tshenn-hue/tshinn-hue' });
  // community words may have no Hanji
  assert.deepEqual(parseRoute(wordRoute('', 'pueh')), { page: 'word', hanji: '', tl: 'pueh' });
  for (const hash of ['', '#/', '#/tag/', '#/tag/%E0', '#/word/x', '#/nothing']) assert.deepEqual(parseRoute(hash), { page: 'search' });
});

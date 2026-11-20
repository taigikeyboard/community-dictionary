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
  searchRows,
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

test('searchItaigi: hanji, each variant reading, tag filter; exact, then prefix, then the rest', () => {
  const [food, plant, feeling] = ['食食', '植物', '心情'].map((name) => TAG_NAMES.indexOf(name));
  const index = indexItaigi([
    ['青花', 'tshenn-hue/tshinn-hue', 'chheⁿ-hoe/chhiⁿ-hoe', 'ㄘㆥ ㄏㄨㆤ / ㄑㆪ ㄏㄨㆤ', [food, plant]],
    ['花蕊', 'hue-luí', 'hoe-luí', 'ㄏㄨㆤ ㄌㄨㄧˋ', [plant]],
    ['花', 'hue', 'hoe', 'ㄏㄨㆤ', [plant]],
    ['𤺪呢', 'siān-neh', '', 'ㄒㄧㄢ˫ ㄋㆤㆷ', [feeling]],
  ]);
  const hanji = (query, tag = null) => searchItaigi(index, query, 50, tag).map((r) => r.hanji);
  assert.deepEqual(hanji('花'), ['花', '花蕊', '青花']);
  assert.deepEqual(hanji('hue'), ['花', '花蕊', '青花']);
  // a later variant typed in full, and the whole slash-joined reading, are exact matches
  assert.deepEqual(hanji('tshinn-hue'), ['青花']);
  assert.deepEqual(hanji('tshenn-hue/tshinn-hue'), ['青花']);
  assert.deepEqual(hanji(' '), []);
  // the Mandarin gloss is no longer published, so it matches nothing
  assert.deepEqual(hanji('討厭'), []);
  // a tag alone lists its rows in file order; with a query it narrows the matches
  assert.deepEqual(hanji('', plant), ['青花', '花蕊', '花']);
  assert.deepEqual(hanji('花', food), ['青花']);
});

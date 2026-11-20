import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupEntries } from '../scripts/compile.js';
import { checkForm, describeErrors, duplicateStatus, foldSearch, formToRaw, searchRows } from '../site/logic.js';
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

test('formToRaw empties the fields of other categories', () => {
  const raw = formToRaw(
    { category: 'sin-su', hanji: '手機', tl: 'tshiú-ki', accents: ['鹿港偏泉腔'], variation_types: ['gi-im'], place: 'x', meaning: '手機', source: '', note: '' },
    { login: 'octocat', id: 1, today: '2026-11-20' },
  );
  assert.deepEqual([raw.accents, raw.variation_types, raw.place, raw.meaning], [[], [], '', '手機']);
});

test('checkForm + describeErrors give Taiwanese messages per field', () => {
  const { errors } = checkForm({ category: 'khiunn-khau', hanji: '', tl: 'pueh!', accents: [], variation_types: [], note: '' });
  assert.deepEqual(describeErrors(errors), [
    { field: 'variation_types', text: '腔口差類型：愛填' },
    { field: 'accents', text: '腔口：愛填' },
    { field: 'hanji', text: '漢字：愛填' },
    { field: 'tl', text: '台羅：干焦會當用台羅字母、調符、數字、空格佮「-」' },
  ]);
  const ok = checkForm({ category: 'khiunn-khau', hanji: ' 八', tl: 'pueh ', accents: ['鹿港偏泉腔'], variation_types: ['gi-im'], note: '' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.entry.hanji, '八');
  assert.deepEqual(describeErrors(checkForm({ category: '', hanji: '八', tl: 'pueh' }).errors), [{ field: 'category', text: '分類：愛揀' }]);
});

test('duplicateStatus: new, attested by others, mine', async () => {
  assert.equal((await duplicateStatus(rows, '九', 'kau')).status, 'new');
  const attested = await duplicateStatus(rows, '八', 'Pueh');
  assert.deepEqual([attested.status, attested.contributors], ['attested', ['octocat']]);
  assert.equal((await duplicateStatus(rows, '八', 'pueh', 583231)).status, 'mine');
});

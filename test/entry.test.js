import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkEntryFile,
  entryPath,
  entryKey,
  normalizeTl,
  parseEntryPath,
  prepareEntry,
  serializeEntry,
  validateEntry,
} from '../lib/entry.js';

import { accentEntry, KEY } from './fixtures.js';

// Tests for the shared entry schema, normalization and key.

const PATH = entryPath('octocat', KEY);
const withFields = (fields) => ({ ...accentEntry(), ...fields });
const errorsFor = (fields) => validateEntry(withFields(fields));

test('key: SHA-256 prefix over normalized hanji and tl', async () => {
  assert.equal(await entryKey('八', 'pueh'), KEY);
  assert.equal(await entryKey('八', ' Pueh '), KEY);
  // trace: "tsò khang khuè" → spaces to hyphens → "tsò-khang-khuè"
  assert.equal(await entryKey('做khang-khuè', 'tsò khang khuè'), 'e5a555f359c2404d');
  assert.equal(await entryKey('做khang-khuè', 'tsò-khang-khuè'), 'e5a555f359c2404d');
});

test('key: NFD and NFC spellings give the same key', async () => {
  assert.equal(await entryKey('八', 'pue\u0301h'), await entryKey('八', 'puéh'));
});

test('normalizeTl keeps the double hyphen of the neutral tone', () => {
  assert.equal(normalizeTl('Tsáu--khì'), 'tsáu--khì');
  assert.equal(normalizeTl('tsáu  khì'), 'tsáu-khì');
});

test('valid entries per category', () => {
  assert.deepEqual(validateEntry(accentEntry()), []);
  assert.deepEqual(errorsFor({ accents: ['其他'], place: '澎湖白沙' }), []);
  assert.deepEqual(errorsFor({ category: 'sin-su', accents: [], variation_types: [], meaning: '手機', source: '新聞' }), []);
  assert.deepEqual(errorsFor({ category: 'poo-tshiong', accents: [], variation_types: [], note: '' }), []);
  assert.deepEqual(errorsFor({ category: 'ki-thann', accents: [], variation_types: [] }), []);
  assert.deepEqual(errorsFor({ hanji: '做khang-khuè', tl: 'tsò-khang-khuè' }), []);
  assert.deepEqual(errorsFor({ tl: 'tsau2-khi3' }), []);
  assert.deepEqual(errorsFor({ tl: 'o\u0358' }), []);
  assert.deepEqual(errorsFor({ note: 'line one\nline two' }), []);
});

test('category rules', () => {
  assert.deepEqual(errorsFor({ category: 'other' }), ['category: must be one of khiunn-khau, sin-su, poo-tshiong, ki-thann']);
  assert.deepEqual(errorsFor({ accents: [] }), ['accents: required']);
  assert.deepEqual(errorsFor({ variation_types: [] }), ['variation_types: required']);
  assert.deepEqual(errorsFor({ variation_types: ['gi-im', 'su-lui'] }), []);
  assert.deepEqual(errorsFor({ variation_types: ['ki-thann'] }), []);
  assert.deepEqual(errorsFor({ variation_types: ['gi-im', 'ki-thann'] }), ['variation_types: ki-thann cannot be combined with other types']);
  assert.deepEqual(errorsFor({ variation_types: ['siann-tiau'] }), ['variation_types: unknown variation type "siann-tiau"']);
  assert.deepEqual(errorsFor({ variation_types: ['gi-im', 'gi-im'] }), ['variation_types: duplicate variation type']);
  assert.deepEqual(errorsFor({ variation_types: ['ki-thann', 'ki-thann'] }), ['variation_types: duplicate variation type']);
  assert.deepEqual(errorsFor({ variation_types: 'gi-im' }), ['variation_types: must be an array of strings']);
  assert.deepEqual(errorsFor({ category: 'sin-su', accents: [], meaning: '手機' }), ['variation_types: must be empty for sin-su']);
  assert.deepEqual(errorsFor({ accents: ['其他'] }), ['place: required']);
  assert.deepEqual(errorsFor({ place: '鹿港' }), ['place: only with accent 其他']);
  assert.deepEqual(errorsFor({ meaning: '八' }), ['meaning: must be empty for khiunn-khau']);
  assert.deepEqual(errorsFor({ category: 'sin-su', variation_types: [], meaning: '手機' }), ['accents: must be empty for sin-su']);
  assert.deepEqual(errorsFor({ category: 'sin-su', accents: [], variation_types: [] }), ['meaning: required']);
  assert.deepEqual(errorsFor({ accents: ['台北腔'] }), ['accents: unknown accent "台北腔"']);
  assert.deepEqual(errorsFor({ accents: ['鹿港偏泉腔', '鹿港偏泉腔'] }), ['accents: duplicate accent']);
});

test('character whitelists', () => {
  assert.deepEqual(errorsFor({ hanji: '八 八' }), ['hanji: only Han characters, Tâi-lô letters and hyphens are allowed']);
  assert.deepEqual(errorsFor({ hanji: '八1' }), ['hanji: only Han characters, Tâi-lô letters and hyphens are allowed']);
  assert.deepEqual(errorsFor({ tl: 'peh8' }), []);
  assert.deepEqual(errorsFor({ tl: 'pueh!' }), ['tl: only Latin letters, tone marks, tone digits, hyphens and spaces are allowed']);
  assert.deepEqual(errorsFor({ tl: 'pʉeh' }), ['tl: only Latin letters, tone marks, tone digits, hyphens and spaces are allowed']);
  assert.deepEqual(errorsFor({ tl: '8-8' }), ['tl: must contain a letter']);
  // ⼋ U+2F0B is the Kangxi radical that looks like 八
  assert.deepEqual(errorsFor({ hanji: '\u2F0B' }), ['hanji: only Han characters, Tâi-lô letters and hyphens are allowed']);
  assert.deepEqual(errorsFor({ hanji: '八\u0301' }), ['hanji: only Han characters, Tâi-lô letters and hyphens are allowed']);
  assert.deepEqual(errorsFor({ hanji: '-' }), ['hanji: must contain a Han character or a letter']);
  assert.deepEqual(errorsFor({ tl: '\u0301a' }), ['tl: only Latin letters, tone marks, tone digits, hyphens and spaces are allowed']);
  assert.deepEqual(errorsFor({ hanji: '〇' }), []);
});

test('limits count code points, not UTF-16 units', () => {
  // U+20000 is one code point, two UTF-16 units
  assert.deepEqual(errorsFor({ hanji: '\u{20000}'.repeat(20) }), []);
  assert.deepEqual(errorsFor({ hanji: '八'.repeat(21) }), ['hanji: longer than 20 characters']);
  assert.deepEqual(errorsFor({ note: 'a'.repeat(1001) }), ['note: longer than 1000 characters']);
});

test('text must be clean, single-line and free of control characters', () => {
  assert.deepEqual(errorsFor({ hanji: ' 八' }), [
    'hanji: not normalized (NFC, LF, trimmed)',
    'hanji: only Han characters, Tâi-lô letters and hyphens are allowed',
  ]);
  assert.deepEqual(errorsFor({ tl: 'pue\u0301h' }), ['tl: not normalized (NFC, LF, trimmed)']);
  assert.deepEqual(errorsFor({ accents: ['其他'], place: 'a\nb' }), ['place: must be one line']);
  assert.deepEqual(errorsFor({ note: 'a\r\nb' }), [
    'note: not normalized (NFC, LF, trimmed)',
    'note: contains a control character U+000D',
  ]);
  assert.deepEqual(errorsFor({ note: 'a\u202Eb' }), ['note: contains a control character U+202E']);
  assert.deepEqual(errorsFor({ meaning: 'a\u2028b', category: 'sin-su', accents: [], variation_types: [] }), ['meaning: contains a control character U+2028']);
  assert.deepEqual(errorsFor({ note: '👩\u200D💻' }), []);
});

test('shape: missing, unknown and mistyped fields', () => {
  const noNote = accentEntry();
  delete noNote.note;
  assert.deepEqual(validateEntry(noNote), ['note: missing', 'note: must be a string']);
  assert.deepEqual(errorsFor({ extra: 1 }), ['extra: unknown field']);
  assert.deepEqual(errorsFor({ contributor: '-bad' }), ['contributor: must be a GitHub login']);
  assert.deepEqual(errorsFor({ contributor_id: '583231' }), ['contributor_id: must be a positive integer']);
  assert.deepEqual(errorsFor({ submitted: '2026-02-30' }), ['submitted: must be a date YYYY-MM-DD']);
  assert.deepEqual(validateEntry([]), ['entry: must be a JSON object']);
});

test('prepareEntry cleans raw form input', () => {
  const raw = withFields({ hanji: ' 八 ', tl: 'pue\u0301h ', note: 'a\r\nb ', accents: ['鹿港偏泉腔', '鹿港偏泉腔'], variation_types: [' gi-im', 'gi-im', 'su-lui'] });
  const { entry: clean, errors } = prepareEntry(raw);
  assert.deepEqual(errors, []);
  assert.equal(clean.tl, 'puéh');
  assert.equal(clean.note, 'a\nb');
  assert.deepEqual(clean.variation_types, ['gi-im', 'su-lui']);
});

test('parseEntryPath', () => {
  assert.deepEqual(parseEntryPath(PATH), { login: 'octocat', key: KEY });
  assert.equal(parseEntryPath('entries/octocat/0A15EE4ADA350DF8.json'), null);
  assert.equal(parseEntryPath('entries/octocat/x/0a15ee4ada350df8.json'), null);
  assert.equal(parseEntryPath('entries/0a15ee4ada350df8.json'), null);
  assert.equal(parseEntryPath('entries/../0a15ee4ada350df8.json'), null);
});

test('checkEntryFile: key match and canonical format', async () => {
  const text = serializeEntry(accentEntry());
  assert.deepEqual((await checkEntryFile(PATH, text)).errors, []);
  assert.deepEqual((await checkEntryFile('entries/octocat/0000000000000000.json', text)).errors, [
    "entries/octocat/0000000000000000.json: file name does not match the entry's key 0a15ee4ada350df8",
  ]);
  assert.deepEqual((await checkEntryFile(PATH, JSON.stringify(accentEntry()))).errors, [
    `${PATH}: not in canonical format (field order, two-space indent, final newline)`,
  ]);
  assert.match((await checkEntryFile(PATH, '{')).errors[0], /invalid JSON/);
});

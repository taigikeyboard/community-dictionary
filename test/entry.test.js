import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkEntryFile,
  entryPath,
  credit,
  entryKey,
  nextEditors,
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

test('valid entries: every field but tl is optional', () => {
  assert.deepEqual(validateEntry(accentEntry()), []);
  assert.deepEqual(errorsFor({ accents: ['其他'], place: '澎湖白沙' }), []);
  // a missing word: Hanji and Tâi-lô only
  assert.deepEqual(errorsFor({ accents: [], note: '' }), []);
  // a new word that is also an accent variation
  assert.deepEqual(errorsFor({ meaning: '網紅', examples: [{ hanji: '伊是網紅。', tl: 'I sī bāng-âng.' }, { hanji: '', tl: 'Tsit-ê.' }] }), []);
  assert.deepEqual(errorsFor({ examples: [{ hanji: '', tl: 'I sī\nbāng-âng.' }] }), ['examples[0].tl: must be one line']);
  assert.deepEqual(errorsFor({ examples: [{ hanji: '', tl: '' }] }), ['examples[0]: empty']);
  assert.deepEqual(errorsFor({ examples: [{ tl: 'a', hanji: 'b' }] }), ['examples[0]: must be an object with hanji and tl, in that order']);
  assert.deepEqual(errorsFor({ hanji: '做khang-khuè', tl: 'tsò-khang-khuè' }), []);
  assert.deepEqual(errorsFor({ tl: 'tsau2-khi3' }), []);
  assert.deepEqual(errorsFor({ tl: 'o͘' }), []);
  assert.deepEqual(errorsFor({ note: 'line one\nline two' }), []);
});

test('accent and place rules', () => {
  assert.deepEqual(errorsFor({ tl: '' }), ['tl: required']);
  assert.deepEqual(errorsFor({ accents: ['其他'] }), ['place: required']);
  assert.deepEqual(errorsFor({ place: '鹿港' }), ['place: only with accent 其他']);
  assert.deepEqual(errorsFor({ accents: ['台北腔'] }), ['accents: unknown choice "台北腔"']);
  assert.deepEqual(errorsFor({ accents: ['鹿港偏泉腔', '鹿港偏泉腔'] }), ['accents: duplicate value']);
  assert.deepEqual(errorsFor({ accents: '鹿港偏泉腔' }), ['accents: must be an array of strings']);
});

test('tag rules: any tag in the Hanji script, at most 5, each at most 10 characters', () => {
  // a contributor's own tag is as valid as one from the site's list
  assert.deepEqual(errorsFor({ tags: [] }), []);
  assert.deepEqual(errorsFor({ tags: ['食食', '夜市仔', 'ラーメン', 'khang-khuè'] }), []);
  assert.deepEqual(errorsFor({ tags: ['一', '二', '三', '四', '五', '六'] }), ['tags: more than 5']);
  assert.deepEqual(errorsFor({ tags: ['食食', '食食'] }), ['tags: duplicate value']);
  assert.deepEqual(errorsFor({ tags: ['一二三四五六七八九十一'] }), ['tags: "一二三四五六七八九十一" longer than 10 characters']);
  assert.deepEqual(errorsFor({ tags: ['food!'] }), ['tags: "food!" only Han characters, kana, Tâi-lô letters and hyphens are allowed']);
  assert.deepEqual(errorsFor({ tags: [' 食食'] }), ['tags: " 食食" not normalized (NFC, LF, trimmed, not empty)']);
  assert.deepEqual(errorsFor({ tags: '食食' }), ['tags: must be an array of strings']);
  // prepareEntry trims, drops blanks and repeats
  assert.deepEqual(prepareEntry(withFields({ tags: [' 食食', '', '食食'] })).entry.tags, ['食食']);
});

test('Hanji and Tâi-lô take any one-line text (maintainer 2026-11-28)', () => {
  // iTaigi's proverbs, variants, mixed Hàn-lô and punctuation come in as written
  for (const fields of [
    { hanji: '台頂三分鐘，台跤十年功', tl: 'Tâi tíng sann hun-tsing, tâi kha tsa̍p nî kong' },
    { hanji: '潘 kèm-muh', tl: 'phuann kèm-muh' },
    { hanji: '青花', tl: 'tshenn-hue/tshinn-hue' },
    { hanji: '公雞', tl: '雞公仔' },
    { hanji: '八1', tl: '8-8' },
    { hanji: 'オートバイ', tl: 'oo-tó-bái' },
    { hanji: '' },
  ]) assert.deepEqual(errorsFor(fields), [], JSON.stringify(fields));
  assert.deepEqual(errorsFor({ tl: '' }), ['tl: required']);
});

test('garbled characters count as control characters', () => {
  assert.deepEqual(errorsFor({ tl: 'tshé-\uFFFDkiáu' }), ['tl: contains a control character U+FFFD']);
  assert.deepEqual(errorsFor({ hanji: '癩\u{FF5E7}' }), ['hanji: contains a control character U+FF5E7']);
  assert.deepEqual(errorsFor({ hanji: '\uE35C' }), ['hanji: contains a control character U+E35C']);
});

test('tags keep their character rule', () => {
  assert.deepEqual(errorsFor({ tags: ['食 食'] }), ['tags: "食 食" only Han characters, kana, Tâi-lô letters and hyphens are allowed']);
  // ⼋ U+2F0B is the Kangxi radical that looks like 八
  assert.deepEqual(errorsFor({ tags: ['\u2F0B'] }), ['tags: "\u2F0B" only Han characters, kana, Tâi-lô letters and hyphens are allowed']);
});

test('itaigi_contributors: distinct one-line names', () => {
  assert.deepEqual(errorsFor({ itaigi_contributors: ['Liz Lin', '匿名'] }), []);
  assert.deepEqual(errorsFor({ itaigi_contributors: 'Liz Lin' }), ['itaigi_contributors: must be an array of strings']);
  assert.deepEqual(errorsFor({ itaigi_contributors: ['a', 'a'] }), ['itaigi_contributors: duplicate value']);
  assert.deepEqual(errorsFor({ itaigi_contributors: [''] }), ['itaigi_contributors[0]: required']);
  assert.deepEqual(errorsFor({ itaigi_contributors: ['a\nb'] }), ['itaigi_contributors[0]: must be one line']);
});

test('credit names the iTaigi contributors, else the GitHub login', () => {
  assert.deepEqual(credit(accentEntry()), ['octocat']);
  assert.deepEqual(credit({ ...accentEntry(), contributor: 'taigikeyboard', itaigi_contributors: ['Liz Lin'] }), ['Liz Lin']);
});

test('limits count code points, not UTF-16 units', () => {
  // U+20000 is one code point, two UTF-16 units
  assert.deepEqual(errorsFor({ hanji: '\u{20000}'.repeat(50) }), []);
  assert.deepEqual(errorsFor({ hanji: '八'.repeat(51) }), ['hanji: longer than 50 characters']);
  assert.deepEqual(errorsFor({ tl: 'a'.repeat(201) }), ['tl: longer than 200 characters']);
  assert.deepEqual(errorsFor({ note: 'a'.repeat(1001) }), ['note: longer than 1000 characters']);
});

test('text must be clean, single-line and free of control characters', () => {
  assert.deepEqual(errorsFor({ hanji: ' 八' }), ['hanji: not normalized (NFC, LF, trimmed, not empty)']);
  assert.deepEqual(errorsFor({ tl: 'pue\u0301h' }), ['tl: not normalized (NFC, LF, trimmed, not empty)']);
  assert.deepEqual(errorsFor({ accents: ['其他'], place: 'a\nb' }), ['place: must be one line']);
  assert.deepEqual(errorsFor({ note: 'a\r\nb' }), [
    'note: not normalized (NFC, LF, trimmed, not empty)',
    'note: contains a control character U+000D',
  ]);
  assert.deepEqual(errorsFor({ note: 'a\u202Eb' }), ['note: contains a control character U+202E']);
  assert.deepEqual(errorsFor({ meaning: 'a\u2028b' }), ['meaning: contains a control character U+2028']);
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

test('editors: shape, duplicates, never the contributor', () => {
  const mallory = { login: 'mallory', id: 999 };
  assert.deepEqual(errorsFor({ editors: [mallory] }), []);
  assert.deepEqual(errorsFor({ editors: null }), ['editors: must be an array']);
  assert.deepEqual(errorsFor({ editors: [{ id: 999, login: 'mallory' }] }), ['editors[0]: must be an object with login and id, in that order']);
  assert.deepEqual(errorsFor({ editors: [mallory, mallory] }), ['editors: duplicate value']);
  assert.deepEqual(errorsFor({ editors: [{ login: 'octocat', id: 583231 }] }), ['editors[0].id: the contributor is not an editor of their own entry']);
});

test('nextEditors adds anyone but the contributor, once', () => {
  const entry = accentEntry();
  const mallory = { id: 999, login: 'mallory' };
  assert.deepEqual(nextEditors(entry, { id: 583231, login: 'octocat' }), []);
  const once = nextEditors(entry, mallory);
  assert.deepEqual(once, [{ login: 'mallory', id: 999 }]);
  assert.equal(nextEditors({ ...entry, editors: once }, { ...mallory, login: 'mallory-renamed' }), once);
});

test('prepareEntry cleans raw form input', () => {
  const raw = withFields({ hanji: ' 八 ', tl: 'pue\u0301h ', note: 'a\r\nb ', accents: ['鹿港偏泉腔', '鹿港偏泉腔'] });
  const { entry: clean, issues } = prepareEntry(raw);
  assert.deepEqual(issues, []);
  assert.equal(clean.tl, 'puéh');
  assert.equal(clean.note, 'a\nb');
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

// Entry schema, normalization, key and validation shared by the site, the Worker and CI
// (uses only WebCrypto and TextEncoder, which all three runtimes provide).

export const ENTRIES_DIR = 'entries';

// The ten accents of the Ministry of Education dictionary, plus 其他 (with `place`).
export const ACCENT_OTHER = '其他';
export const ACCENTS = Object.freeze([
  '鹿港偏泉腔',
  '三峽偏泉腔',
  '臺北偏泉腔',
  '宜蘭偏漳腔',
  '臺南混合腔',
  '高雄混合腔',
  '金門偏泉腔',
  '馬公偏泉腔',
  '新竹偏泉腔',
  '臺中偏漳腔',
  ACCENT_OTHER,
]);

// Text fields and their maximum length in Unicode code points, measured on the NFC form. Hanji and
// Tâi-lô take any one-line text (maintainer 2026-11-28: iTaigi's proverbs, slashes and punctuation
// come in as written; whether a word is good Taiwanese is the maintainer's call at review, D8).
export const LIMITS = Object.freeze({
  hanji: 50,
  tl: 200,
  place: 20,
  meaning: 100,
  note: 1000,
});
const TEXT_FIELDS = Object.keys(LIMITS);

// Semantic tags: the site offers its own list (site/tags.js) and lets a contributor add new ones,
// so any tag written in TAG_SCRIPT is accepted; whether it is good Taiwanese is the
// maintainer's call at review, as with Tâi-lô (D8).
const MAX_TAGS = 5;

// Example sentences: up to MAX_EXAMPLES, each a Hanji (or kana) line and a Tâi-lô line, either
// may be empty but not both.
export const MAX_EXAMPLES = 5;
const EXAMPLE_LIMIT = 300;
export const TAG_LIMIT = 10;

// One submission may carry several words; each becomes its own entry file in one pull request.
export const MAX_WORDS = 20;

// Every entry file has exactly these keys, in this order.
const FIELDS = Object.freeze([
  'hanji',
  'tl',
  'accents',
  'tags',
  'place',
  'meaning',
  'examples',
  'note',
  'contributor',
  'contributor_id',
  'submitted',
  'editors',
  'itaigi_contributors',
]);

// Multiple-choice fields (checkboxes on the form): allowed values.
const CHOICE_FIELDS = {
  accents: { allowed: ACCENTS },
};

// What validation finds is a list of issues { field, code, ...params }: the site words them in the
// reader's language (site/strings.js), CI and logs read the English below (issueText).
// `field` is a path such as "tl" or "examples[0].hanji".
const ISSUE_TEXT = {
  not_object: () => 'must be a JSON object',
  unknown_field: () => 'unknown field',
  missing_field: () => 'missing',
  not_string: () => 'must be a string',
  not_string_list: () => 'must be an array of strings',
  not_list: () => 'must be an array',
  required: () => 'required',
  unknown_choice: ({ value }) => `unknown choice "${value}"`,
  duplicate: () => 'duplicate value',
  too_many: ({ max }) => `more than ${max}`,
  not_normalized: () => 'not normalized (NFC, LF, trimmed, not empty)',
  too_long: ({ max }) => `longer than ${max} characters`,
  one_line: () => 'must be one line',
  control_character: ({ codePoint }) => `contains a control character U+${codePoint}`,
  hanji_script: () => 'only Han characters, kana, Tâi-lô letters and hyphens are allowed',
  example_shape: () => 'must be an object with hanji and tl, in that order',
  example_empty: () => 'empty',
  place_without_other: () => `only with accent ${ACCENT_OTHER}`,
  not_login: () => 'must be a GitHub login',
  not_positive_integer: () => 'must be a positive integer',
  not_date: () => 'must be a date YYYY-MM-DD',
  editor_shape: () => 'must be an object with login and id, in that order',
  editor_is_contributor: () => 'the contributor is not an editor of their own entry',
  // a submission as a whole (worker/src/submit.js)
  word_count: ({ max }) => `1 to ${max} words`,
  repeated_word: () => 'same word twice',
  not_entry_path: () => `not of the form ${ENTRIES_DIR}/<login>/<key>.json`,
};

export const issue = (field, code, params = {}) => ({ field, code, ...params });

// One issue as an English line, e.g. 'tags: "food!" only Han characters…'; a tag's issues name it.
export function issueText({ field, code, ...params }) {
  const tag = params.tag === undefined ? '' : `"${params.tag}" `;
  return `${field}: ${tag}${ISSUE_TEXT[code](params)}`;
}

// A tag's characters, checked on the NFD form: Han ideographs, kana, Tâi-lô letters (tone marks
// may only follow a letter) and hyphens. Han ∩ Ideographic leaves out the Kangxi and CJK radicals:
// ⼋ (U+2F0B) looks like 八 but NFC keeps it apart, so it would make a second tag.
const TAG_SCRIPT = {
  allowed: /^(?:[\p{Script=Han}&&\p{Ideographic}]|[\p{Script=Hiragana}\p{Script=Katakana}\u3099\u309A\u30FC]|[A-Za-z][\u0300\u0301\u0302\u0304\u030B\u030C\u030D\u0358]*|-)+$/v,
  needs: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u,
};

// Control, format and line/paragraph separator characters, except `\n` (checked separately)
// and ZWJ (keeps emoji sequences intact in free text); also garbled text: the replacement
// character U+FFFD and private-use characters (a font's own glyphs, blank or boxes elsewhere).
const CONTROL_RE = /[[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\uFFFD]--[\n\u200D]]/v;

// GitHub login: alphanumerics and single inner hyphens, at most 39 characters.
const LOGIN = '[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}';
export const LOGIN_RE = new RegExp(`^${LOGIN}$`);
// A GitHub account id: a positive integer.
export const isAccountId = (value) => Number.isSafeInteger(value) && value > 0;
// The commit author address GitHub assigns: <id>+<login>@users.noreply.github.com.
export const NOREPLY_RE = new RegExp(`^([1-9]\\d*)\\+(${LOGIN})@users\\.noreply\\.github\\.com$`);
const ENTRY_PATH_RE = new RegExp(`^${ENTRIES_DIR}/(${LOGIN})/([0-9a-f]{16})\\.json$`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINE_BREAK_RE = /\r\n?/g;

// Canonical stored form of a free-text value: NFC, CRLF → LF, trimmed.
function cleanText(value) {
  return value.replace(LINE_BREAK_RE, '\n').normalize('NFC').trim();
}

// Form input → canonical entry plus its issues. The site and the Worker use this; CI uses the
// strict `validateEntry`, which rejects text that is not already clean.
export function prepareEntry(raw) {
  const entry = { ...raw };
  for (const field of TEXT_FIELDS) {
    if (typeof entry[field] === 'string') entry[field] = cleanText(entry[field]);
  }
  for (const field of [...Object.keys(CHOICE_FIELDS), 'tags']) {
    if (Array.isArray(entry[field])) {
      entry[field] = [...new Set(entry[field].map((c) => (typeof c === 'string' ? cleanText(c) : c)))];
    }
  }
  if (Array.isArray(entry.tags)) entry.tags = entry.tags.filter((t) => t !== '');
  // blank example rows are dropped; anything that is not { hanji, tl } strings is left for
  // validateEntry to report
  if (Array.isArray(entry.examples)) {
    entry.examples = entry.examples
      .map((e) => (typeof e?.hanji === 'string' && typeof e?.tl === 'string' ? { hanji: cleanText(e.hanji), tl: cleanText(e.tl) } : e))
      .filter((e) => !(e?.hanji === '' && e?.tl === ''));
  }
  return { entry, issues: entryIssues(entry) };
}

// Normalization for the key only; the stored values keep their case and spacing.
export function normalizeHanji(hanji) {
  return hanji.normalize('NFC').trim();
}

export function normalizeTl(tl) {
  return tl.normalize('NFC').trim().toLowerCase().replace(/ +/g, '-').normalize('NFC');
}

// First 16 hex characters of SHA-256 over `hanji + "\n" + tl`, both normalized.
export async function entryKey(hanji, tl) {
  const bytes = new TextEncoder().encode(`${normalizeHanji(hanji)}\n${normalizeTl(tl)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function entryPath(login, key) {
  return `${ENTRIES_DIR}/${login}/${key}.json`;
}

// Splits `entries/<login>/<key>.json`; returns null for any other shape.
export function parseEntryPath(path) {
  const m = ENTRY_PATH_RE.exec(path);
  return m ? { login: m[1], key: m[2] } : null;
}

// The file content the Worker commits: fixed key order, two-space indent, final newline.
export function serializeEntry(entry) {
  const ordered = {};
  for (const field of FIELDS) ordered[field] = entry[field];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Returns the list when it is an array of strings; otherwise reports it and returns null.
function checkChoices(issues, field, value, { required }) {
  if (!Array.isArray(value) || !value.every((c) => typeof c === 'string')) {
    issues.push(issue(field, 'not_string_list'));
    return null;
  }
  const { allowed } = CHOICE_FIELDS[field];
  for (const c of value) if (!allowed.includes(c)) issues.push(issue(field, 'unknown_choice', { value: c }));
  if (new Set(value).size !== value.length) issues.push(issue(field, 'duplicate'));
  if (required && value.length === 0) issues.push(issue(field, 'required'));
  return value;
}

// Tags: up to MAX_TAGS distinct one-line strings, each at most TAG_LIMIT characters in TAG_SCRIPT.
function checkTags(issues, value) {
  if (!Array.isArray(value) || !value.every((t) => typeof t === 'string')) {
    issues.push(issue('tags', 'not_string_list'));
    return;
  }
  if (value.length > MAX_TAGS) issues.push(issue('tags', 'too_many', { max: MAX_TAGS }));
  if (new Set(value).size !== value.length) issues.push(issue('tags', 'duplicate'));
  const script = TAG_SCRIPT;
  for (const tag of value) {
    if (tag === '' || tag !== cleanText(tag)) issues.push(issue('tags', 'not_normalized', { tag }));
    else if (Array.from(tag).length > TAG_LIMIT) issues.push(issue('tags', 'too_long', { tag, max: TAG_LIMIT }));
    else if (!script.allowed.test(tag.normalize('NFD')) || !script.needs.test(tag.normalize('NFD'))) {
      issues.push(issue('tags', 'hanji_script', { tag }));
    }
  }
}

function checkExamples(issues, value) {
  if (!Array.isArray(value)) {
    issues.push(issue('examples', 'not_list'));
    return;
  }
  if (value.length > MAX_EXAMPLES) issues.push(issue('examples', 'too_many', { max: MAX_EXAMPLES }));
  value.forEach((example, i) => {
    const at = `examples[${i}]`;
    if (example === null || typeof example !== 'object' || Object.keys(example).join(',') !== 'hanji,tl') {
      issues.push(issue(at, 'example_shape'));
      return;
    }
    checkText(issues, `${at}.hanji`, example.hanji, { limit: EXAMPLE_LIMIT });
    checkText(issues, `${at}.tl`, example.tl, { limit: EXAMPLE_LIMIT });
    if (example.hanji === '' && example.tl === '') issues.push(issue(at, 'example_empty'));
  });
}

function checkText(issues, field, value, { required = false, multiline = false, limit = LIMITS[field] } = {}) {
  if (typeof value !== 'string') {
    issues.push(issue(field, 'not_string'));
    return;
  }
  if (value === '') {
    if (required) issues.push(issue(field, 'required'));
    return;
  }
  if (value !== cleanText(value)) issues.push(issue(field, 'not_normalized'));
  if (Array.from(value).length > limit) issues.push(issue(field, 'too_long', { max: limit }));
  if (!multiline && value.includes('\n')) issues.push(issue(field, 'one_line'));
  const control = CONTROL_RE.exec(value);
  if (control) {
    const codePoint = control[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    issues.push(issue(field, 'control_character', { codePoint }));
  }
}

// iTaigi contributor names (maintainer 2026-11-28): an entry brought over from iTaigi keeps the
// names itaigi.tw credits it to, distinct one-line texts; every other entry has none.
const NAME_LIMIT = 50;
function checkItaigiContributors(issues, value) {
  if (!Array.isArray(value) || !value.every((name) => typeof name === 'string')) {
    issues.push(issue('itaigi_contributors', 'not_string_list'));
    return;
  }
  value.forEach((name, i) => checkText(issues, `itaigi_contributors[${i}]`, name, { required: true, limit: NAME_LIMIT }));
  if (new Set(value).size !== value.length) issues.push(issue('itaigi_contributors', 'duplicate'));
}

// Who a card, the statistics, the CSV and a contributor's page credit for one attestation: the
// iTaigi names of an entry brought over from iTaigi, else the contributor's GitHub login.
export const credit = (attestation) => (attestation.itaigi_contributors.length > 0 ? attestation.itaigi_contributors : [attestation.contributor]);

// Editors: everyone other than the contributor who changed the entry, in order of their first
// edit, as { login, id } (D11, maintainer 2026-11-28).
function checkEditors(issues, value, contributorId) {
  if (!Array.isArray(value)) {
    issues.push(issue('editors', 'not_list'));
    return;
  }
  value.forEach((editor, i) => {
    const at = `editors[${i}]`;
    if (editor === null || typeof editor !== 'object' || Object.keys(editor).join(',') !== 'login,id') {
      issues.push(issue(at, 'editor_shape'));
      return;
    }
    if (typeof editor.login !== 'string' || !LOGIN_RE.test(editor.login)) issues.push(issue(`${at}.login`, 'not_login'));
    if (!isAccountId(editor.id)) issues.push(issue(`${at}.id`, 'not_positive_integer'));
    else if (editor.id === contributorId) issues.push(issue(`${at}.id`, 'editor_is_contributor'));
  });
  if (new Set(value.map((e) => e?.id)).size !== value.length) issues.push(issue('editors', 'duplicate'));
}

// The entry's editors after `user` ({ id, login }) edits it: the contributor and anyone already
// listed leave the list as it is; anyone else joins its end.
export function nextEditors(entry, user) {
  if (user.id === entry.contributor_id || entry.editors.some((e) => e.id === user.id)) return entry.editors;
  return [...entry.editors, { login: user.login, id: user.id }];
}

// Returns the entry's issues; an empty list means the entry is valid.
export function entryIssues(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [issue('entry', 'not_object')];
  const issues = [];
  const keys = Object.keys(entry);
  for (const k of keys) if (!FIELDS.includes(k)) issues.push(issue(k, 'unknown_field'));
  for (const f of FIELDS) if (!keys.includes(f)) issues.push(issue(f, 'missing_field'));

  // Only tl is required; accents, meaning, examples and note are optional for every word.
  const accents = checkChoices(issues, 'accents', entry.accents, { required: false });
  const hasOther = accents?.includes(ACCENT_OTHER) ?? false;
  checkTags(issues, entry.tags);

  checkText(issues, 'hanji', entry.hanji);
  checkText(issues, 'tl', entry.tl, { required: true });
  checkText(issues, 'place', entry.place, { required: hasOther });
  checkText(issues, 'meaning', entry.meaning);
  checkExamples(issues, entry.examples);
  checkText(issues, 'note', entry.note, { multiline: true });

  if (!hasOther && typeof entry.place === 'string' && entry.place !== '') issues.push(issue('place', 'place_without_other'));

  if (typeof entry.contributor !== 'string' || !LOGIN_RE.test(entry.contributor)) issues.push(issue('contributor', 'not_login'));
  if (!isAccountId(entry.contributor_id)) {
    issues.push(issue('contributor_id', 'not_positive_integer'));
  }
  if (typeof entry.submitted !== 'string' || !isValidDate(entry.submitted)) issues.push(issue('submitted', 'not_date'));
  checkEditors(issues, entry.editors, entry.contributor_id);
  checkItaigiContributors(issues, entry.itaigi_contributors);
  return issues;
}

// The entry's issues as English lines (CI, logs); an empty list means the entry is valid.
export const validateEntry = (entry) => entryIssues(entry).map(issueText);

// Checks one stored file: path shape, JSON, schema, canonical formatting and that the file
// name is the key of its own content. `entry` and `key` are set when they could be read.
export async function checkEntryFile(path, text) {
  const location = parseEntryPath(path);
  if (!location) return { errors: [`${path}: not of the form ${ENTRIES_DIR}/<login>/<16 hex key>.json`] };

  let entry;
  try {
    entry = JSON.parse(text);
  } catch (err) {
    return { errors: [`${path}: invalid JSON (${err.message})`] };
  }
  const errors = validateEntry(entry).map((e) => `${path}: ${e}`);
  if (errors.length > 0) return { entry, errors };

  const key = await entryKey(entry.hanji, entry.tl);
  if (key !== location.key) errors.push(`${path}: file name does not match the entry's key ${key}`);
  if (text !== serializeEntry(entry)) {
    errors.push(`${path}: not in canonical format (field order, two-space indent, final newline)`);
  }
  return { entry, key, errors };
}

// D10: one contributor may hold a (Hanji, Tâi-lô) key only once, across all directories
// (an account rename leaves older files under the old login). Takes valid checked files.
export function duplicatePairErrors(checked) {
  const seen = new Map();
  const errors = [];
  for (const { path, entry, key } of checked) {
    const owner = `${entry.contributor_id}/${key}`;
    if (seen.has(owner)) errors.push(`${path}: contributor ${entry.contributor_id} already submitted this pair in ${seen.get(owner)}`);
    else seen.set(owner, path);
  }
  return errors;
}

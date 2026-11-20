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

// Text fields and their maximum length in Unicode code points, measured on the NFC form.
export const LIMITS = Object.freeze({
  hanji: 20,
  tl: 80,
  place: 20,
  meaning: 100,
  example: 300,
  note: 1000,
});
const TEXT_FIELDS = Object.keys(LIMITS);

// Semantic tags: the site offers its own list (site/tags.js) and lets a contributor add new ones,
// so any tag written in the Hanji field's script is accepted; whether it is good Taiwanese is the
// maintainer's call at review, as with Tâi-lô (D8).
export const MAX_TAGS = 5;
export const TAG_LIMIT = 10;

// Every entry file has exactly these keys, in this order.
export const FIELDS = Object.freeze([
  'hanji',
  'tl',
  'accents',
  'tags',
  'place',
  'meaning',
  'example',
  'note',
  'contributor',
  'contributor_id',
  'submitted',
]);

// Multiple-choice fields (checkboxes on the form): allowed values, and the noun for messages.
const CHOICE_FIELDS = {
  accents: { allowed: ACCENTS, noun: 'accent' },
};

// Checked on the NFD form. Tâi-lô tone marks (grave, acute, circumflex, macron, double acute,
// caron, vertical line above, and the dot above right U+0358) may only follow a letter.
// Han ∩ Ideographic leaves out the Kangxi and CJK radicals: ⼋ (U+2F0B) looks like 八 but
// NFC keeps it apart, so it would give the same word a second key. Kana (with the prolonged
// sound mark ー, and the voiced marks U+3099/U+309A that NFD splits off) is for Japanese
// loanwords; the field may also be left empty, since many Taiwanese words have no Hanji.
const SCRIPT_RULES = {
  hanji: {
    allowed: /^(?:[\p{Script=Han}&&\p{Ideographic}]|[\p{Script=Hiragana}\p{Script=Katakana}\u3099\u309A\u30FC]|[A-Za-z][\u0300\u0301\u0302\u0304\u030B\u030C\u030D\u0358]*|-)+$/v,
    allowedMessage: 'only Han characters, kana, Tâi-lô letters and hyphens are allowed',
    needs: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/u,
    needsMessage: 'must contain a Han character, kana or a letter',
  },
  tl: {
    allowed: /^(?:[A-Za-z][\u0300\u0301\u0302\u0304\u030B\u030C\u030D\u0358]*|[0-9 \-])+$/v,
    allowedMessage: 'only Latin letters, tone marks, tone digits, hyphens and spaces are allowed',
    needs: /[A-Za-z]/,
    needsMessage: 'must contain a letter',
  },
};

// Control, format and line/paragraph separator characters, except `\n` (checked separately)
// and ZWJ (keeps emoji sequences intact in free text).
const CONTROL_RE = /[[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]--[\n\u200D]]/v;

// GitHub login: alphanumerics and single inner hyphens, at most 39 characters.
const LOGIN = '[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}';
export const LOGIN_RE = new RegExp(`^${LOGIN}$`);
// The commit author address GitHub assigns: <id>+<login>@users.noreply.github.com.
export const NOREPLY_RE = new RegExp(`^([1-9]\\d*)\\+(${LOGIN})@users\\.noreply\\.github\\.com$`);
const ENTRY_PATH_RE = new RegExp(`^${ENTRIES_DIR}/(${LOGIN})/([0-9a-f]{16})\\.json$`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINE_BREAK_RE = /\r\n?/g;

// Canonical stored form of a free-text value: NFC, CRLF → LF, trimmed.
export function cleanText(value) {
  return value.replace(LINE_BREAK_RE, '\n').normalize('NFC').trim();
}

// Form input → canonical entry plus its errors. The site and the Worker use this; CI uses the
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
  return { entry, errors: validateEntry(entry) };
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
function checkChoices(errors, field, value, { required }) {
  if (!Array.isArray(value) || !value.every((c) => typeof c === 'string')) {
    errors.push(`${field}: must be an array of strings`);
    return null;
  }
  const { allowed, noun } = CHOICE_FIELDS[field];
  for (const c of value) if (!allowed.includes(c)) errors.push(`${field}: unknown ${noun} "${c}"`);
  if (new Set(value).size !== value.length) errors.push(`${field}: duplicate ${noun}`);
  if (required && value.length === 0) errors.push(`${field}: required`);
  return value;
}

// Tags: up to MAX_TAGS distinct one-line strings, each at most TAG_LIMIT characters in the
// Hanji field's script (Han characters, kana, Tâi-lô letters, hyphens).
function checkTags(errors, value) {
  if (!Array.isArray(value) || !value.every((t) => typeof t === 'string')) {
    errors.push('tags: must be an array of strings');
    return;
  }
  if (value.length > MAX_TAGS) errors.push(`tags: more than ${MAX_TAGS} tags`);
  if (new Set(value).size !== value.length) errors.push('tags: duplicate tag');
  const script = SCRIPT_RULES.hanji;
  for (const tag of value) {
    if (tag === '' || tag !== cleanText(tag)) errors.push(`tags: "${tag}" not normalized (NFC, trimmed, not empty)`);
    else if (Array.from(tag).length > TAG_LIMIT) errors.push(`tags: "${tag}" longer than ${TAG_LIMIT} characters`);
    else if (!script.allowed.test(tag.normalize('NFD')) || !script.needs.test(tag.normalize('NFD'))) {
      errors.push(`tags: "${tag}" only Han characters, kana, Tâi-lô letters and hyphens are allowed`);
    }
  }
}

function checkText(errors, field, value, { required = false, multiline = false } = {}) {
  if (typeof value !== 'string') {
    errors.push(`${field}: must be a string`);
    return;
  }
  if (value === '') {
    if (required) errors.push(`${field}: required`);
    return;
  }
  if (value !== cleanText(value)) errors.push(`${field}: not normalized (NFC, LF, trimmed)`);
  if (Array.from(value).length > LIMITS[field]) errors.push(`${field}: longer than ${LIMITS[field]} characters`);
  if (!multiline && value.includes('\n')) errors.push(`${field}: must be one line`);
  const control = CONTROL_RE.exec(value);
  if (control) {
    const code = control[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    errors.push(`${field}: contains a control character U+${code}`);
  }
  const script = SCRIPT_RULES[field];
  if (script) {
    const nfd = value.normalize('NFD');
    if (!script.allowed.test(nfd)) errors.push(`${field}: ${script.allowedMessage}`);
    else if (!script.needs.test(nfd)) errors.push(`${field}: ${script.needsMessage}`);
  }
}

// Returns a list of human-readable errors; an empty list means the entry is valid.
export function validateEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['entry: must be a JSON object'];
  }
  const errors = [];
  const keys = Object.keys(entry);
  for (const k of keys) if (!FIELDS.includes(k)) errors.push(`${k}: unknown field`);
  for (const f of FIELDS) if (!keys.includes(f)) errors.push(`${f}: missing`);

  // Only tl is required; accents, meaning, example and note are optional for every word.
  const accents = checkChoices(errors, 'accents', entry.accents, { required: false });
  const hasOther = accents?.includes(ACCENT_OTHER) ?? false;
  checkTags(errors, entry.tags);

  checkText(errors, 'hanji', entry.hanji);
  checkText(errors, 'tl', entry.tl, { required: true });
  checkText(errors, 'place', entry.place, { required: hasOther });
  checkText(errors, 'meaning', entry.meaning);
  checkText(errors, 'example', entry.example);
  checkText(errors, 'note', entry.note, { multiline: true });

  if (!hasOther && typeof entry.place === 'string' && entry.place !== '') errors.push(`place: only with accent ${ACCENT_OTHER}`);

  if (typeof entry.contributor !== 'string' || !LOGIN_RE.test(entry.contributor)) {
    errors.push('contributor: must be a GitHub login');
  }
  if (!Number.isSafeInteger(entry.contributor_id) || entry.contributor_id <= 0) {
    errors.push('contributor_id: must be a positive integer');
  }
  if (typeof entry.submitted !== 'string' || !isValidDate(entry.submitted)) {
    errors.push('submitted: must be a date YYYY-MM-DD');
  }
  return errors;
}

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

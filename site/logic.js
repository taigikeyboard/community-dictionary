import {
  ACCENT_OTHER,
  CATEGORIES,
  entryKey,
  LIMITS,
  prepareEntry,
} from '../lib/entry.js';

// Browser-free site logic: search, form → entry, duplicate rules, Taiwanese error messages.

// Toneless, case-free search form: "Tsa\u030Dp-pueh" and "tsap pueh" both become "tsap-pueh".
export function foldSearch(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[0-9]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

// Rows from search.json whose hanji contains the query, or whose folded tl starts a syllable with it.
export function searchRows(rows, query, limit = 50) {
  const q = query.trim();
  if (q === '') return [];
  const folded = foldSearch(q);
  return rows
    .filter((row) => row.hanji.includes(q) || (folded !== '' && `-${foldSearch(row.tl)}`.includes(`-${folded}`)))
    .slice(0, limit);
}

// Form values → raw entry with every field present; fields of other categories stay empty so
// switching category on the form never leaves stale values behind.
export function formToRaw(values, identity) {
  const { category } = values;
  const accent = category === 'khiunn-khau';
  const newWord = category === 'sin-su';
  return {
    hanji: values.hanji ?? '',
    tl: values.tl ?? '',
    category,
    variation_types: accent ? (values.variation_types ?? []) : [],
    accents: accent ? (values.accents ?? []) : [],
    place: accent && values.accents?.includes(ACCENT_OTHER) ? (values.place ?? '') : '',
    meaning: newWord ? (values.meaning ?? '') : '',
    source: newWord ? (values.source ?? '') : '',
    note: values.note ?? '',
    contributor: identity.login,
    contributor_id: identity.id,
    submitted: identity.today,
  };
}

// The site validates before the Worker sees the form; the Worker fills in the real identity,
// so a placeholder one stands in until sign-in.
export const PLACEHOLDER_IDENTITY = Object.freeze({ login: 'placeholder', id: 1, today: '2000-01-01' });

export function checkForm(values, identity = PLACEHOLDER_IDENTITY) {
  return prepareEntry(formToRaw(values, identity));
}

// D10 on the form: one's own pair is refused; another contributor's pair is an attestation.
export async function duplicateStatus(rows, hanji, tl, contributorId) {
  const key = await entryKey(hanji, tl);
  const row = rows.find((r) => r.key === key);
  if (!row) return { status: 'new', key };
  if (contributorId && row.attestations.some((a) => a.contributor_id === contributorId)) {
    return { status: 'mine', key, row };
  }
  return { status: 'attested', key, row, contributors: row.attestations.map((a) => a.contributor) };
}

export const FIELD_LABELS = Object.freeze({
  hanji: '漢字',
  tl: '台羅',
  category: '分類',
  variation_types: '腔口差類型',
  accents: '腔口',
  place: '所在',
  meaning: '意思',
  source: '出處',
  note: '說明',
});

const MESSAGE_RULES = [
  [/: required$/, () => '愛填'],
  [/: longer than (\d+) characters$/, (m) => `傷長，上濟 ${m[1]} 字`],
  [/: must be one line$/, () => '袂當換逝'],
  [/: only Han characters/, () => '干焦會當用漢字、台羅字母佮「-」'],
  [/: only Latin letters/, () => '干焦會當用台羅字母、調符、數字、空格佮「-」'],
  [/: must contain a Han character or a letter$/, () => '愛有漢字抑是字母'],
  [/: must contain a letter$/, () => '愛有字母'],
  [/: cannot be combined with other types$/, () => '「其他」袂當佮別項做伙揀'],
  [/: only with accent /, () => '揀「其他」腔口才需要填所在'],
  [/: contains a control character/, () => '有袂當用的特殊字元'],
  [/^category: must be one of /, () => '愛揀'],
  [/: unknown /, () => '選項無效'],
];

// Validator messages → Taiwanese, keyed by field; unknown messages pass through unchanged.
export function describeErrors(errors) {
  return errors
    .filter((e) => !/^(contributor|contributor_id|submitted):/.test(e))
    .map((e) => {
      const field = e.slice(0, e.indexOf(':'));
      const rule = MESSAGE_RULES.find(([re]) => re.test(e));
      const text = rule ? rule[1](e.match(rule[0])) : e;
      return { field, text: `${FIELD_LABELS[field] ?? field}：${text}` };
    });
}

export { CATEGORIES, LIMITS };

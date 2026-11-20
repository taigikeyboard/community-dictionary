import {
  ACCENT_OTHER,
  entryKey,
  normalizeHanji,
  normalizeTl,
  prepareEntry,
} from '../lib/entry.js';
import { TAG_NAMES } from './tags.js';

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

// "/" joins variant readings in iTaigi; folding it to a syllable break lets each variant match.
const foldReading = (text) => `-${foldSearch(text.replaceAll('/', ' '))}`;

// The one contributor name every iTaigi word carries: iTaigi's own contributor names (often real
// names) are not republished (maintainer 2026-11-21).
export const ITAIGI_CONTRIBUTOR = 'itaigi';

// itaigi.json rows [hanji, tl, poj, tps, [tag index]] → search index, each credited to ITAIGI_CONTRIBUTOR; folding runs once here, not
// per keystroke. `variants` holds each "/"-joined reading on its own, `folded` the whole tl.
export function indexItaigi(rows) {
  return rows.map(([hanji, tl, poj, tps, tags]) => ({
    hanji,
    tl,
    poj,
    tps,
    tags,
    contributors: [ITAIGI_CONTRIBUTOR],
    variants: tl.split('/').map(foldReading),
    folded: foldReading(tl),
  }));
}

// iTaigi rows whose hanji contains the query, or whose tl starts a syllable with it; exact
// matches first, then those starting with the query, then the rest.
export function searchItaigi(index, query, limit = 50) {
  const q = query.trim();
  if (q === '') return [];
  const folded = foldReading(q);
  const hasTl = folded !== '-';
  const exact = [];
  const prefix = [];
  const rest = [];
  for (const row of index) {
    if (row.hanji === q || (hasTl && (row.folded === folded || row.variants.includes(folded)))) {
      exact.push(row);
    } else if (row.hanji.startsWith(q) || (hasTl && row.variants.some((v) => v.startsWith(folded)))) {
      prefix.push(row);
    } else if (row.hanji.includes(q) || (hasTl && row.folded.includes(folded))) {
      rest.push(row);
    }
  }
  return [...exact, ...prefix, ...rest].slice(0, limit);
}

// Every word carrying `tag` (a name: from the site's list or a contributor's own), for the tag's
// card page: community rows any of whose attestations has it, and iTaigi rows, which carry the
// site's tags only (by index), in file order.
export function wordsWithTag(rows, itaigi, tag) {
  const index = TAG_NAMES.indexOf(tag);
  return {
    community: rows.filter((row) => row.attestations.some((a) => a.tags.includes(tag))),
    itaigi: index === -1 ? [] : itaigi.filter((row) => row.tags.includes(index)),
  };
}

// Every word one contributor gave, for the contributor's card page: community rows any of whose
// attestations is theirs (GitHub login), and every iTaigi row for ITAIGI_CONTRIBUTOR.
export function wordsByContributor(rows, itaigi, name) {
  return {
    community: rows.filter((row) => row.attestations.some((a) => a.contributor === name)),
    itaigi: itaigi.filter((row) => row.contributors.includes(name)),
  };
}

// The community and iTaigi rows spelled exactly (hanji, tl), for a word's card page.
export function wordsSpelled(rows, itaigi, hanji, tl) {
  const same = (row) => row.hanji === hanji && row.tl === tl;
  return { community: rows.filter(same), itaigi: itaigi.filter(same) };
}

// Hash routes: #/ search, #/submit the form, #/tag/<name> a tag's cards, #/contributor/<name> a
// contributor's cards, #/word/<hanji>/<tl> one word's cards. Parts are URI-encoded, so a "/" inside a reading never splits the route.
export const tagRoute = (tag) => `#/tag/${encodeURIComponent(tag)}`;
export const contributorRoute = (name) => `#/contributor/${encodeURIComponent(name)}`;
export const wordRoute = (hanji, tl) => `#/word/${encodeURIComponent(hanji)}/${encodeURIComponent(tl)}`;

// location.hash → { page, ... }; anything unknown or undecodable is the search page.
export function parseRoute(hash) {
  if (hash === '#/submit') return { page: 'submit' };
  const parts = hash.split('/');
  try {
    if (parts[0] === '#' && parts[1] === 'tag' && parts.length === 3 && parts[2] !== '') {
      return { page: 'tag', tag: decodeURIComponent(parts[2]) };
    }
    if (parts[0] === '#' && parts[1] === 'contributor' && parts.length === 3 && parts[2] !== '') {
      return { page: 'contributor', name: decodeURIComponent(parts[2]) };
    }
    if (parts[0] === '#' && parts[1] === 'word' && parts.length === 4 && parts[3] !== '') {
      return { page: 'word', hanji: decodeURIComponent(parts[2]), tl: decodeURIComponent(parts[3]) };
    }
  } catch {
    // a malformed %-escape: fall through to search
  }
  return { page: 'search' };
}

// Tags on community entries that the site's own list lacks, in order of first appearance.
// Contributor names, most words first (ties keep first-seen order); each element of `lists` is
// one word's contributors. build-site ranks the homepage's contributor chips with it.
export function rankContributors(lists) {
  const count = new Map();
  for (const names of lists) for (const name of new Set(names)) count.set(name, (count.get(name) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
}

export function contributedTags(rows, listed) {
  const found = new Set();
  for (const row of rows) for (const a of row.attestations) for (const tag of a.tags) if (!listed.includes(tag)) found.add(tag);
  return [...found];
}

const pairKey = (hanji, tl) => `${normalizeHanji(hanji)}\n${normalizeTl(tl)}`;

// Community entries matching what the form's hanji and tl fields hold, each field searched;
// the exact (Hanji, Tâi-lô) pair comes first, the rest in search order.
export function findExisting(rows, hanji, tl, limit = 50) {
  const exactKey = hanji.trim() !== '' && tl.trim() !== '' ? pairKey(hanji, tl) : null;
  const seen = new Set();
  const found = [];
  for (const query of [hanji, tl]) {
    if (query.trim() === '') continue;
    for (const row of searchRows(rows, query, limit)) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      found.push({ row, exact: pairKey(row.hanji, row.tl) === exactKey });
    }
  }
  return found.sort((x, y) => Number(y.exact) - Number(x.exact)).slice(0, limit);
}

// Form values → raw entry with every field present; place stays empty unless 其他 is among the
// accents, so unticking it never leaves a stale place behind.
export function formToRaw(values, identity) {
  const accents = values.accents ?? [];
  return {
    hanji: values.hanji ?? '',
    tl: values.tl ?? '',
    accents,
    tags: values.tags ?? [],
    place: accents.includes(ACCENT_OTHER) ? (values.place ?? '') : '',
    meaning: values.meaning ?? '',
    example: values.example ?? '',
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

// One submission may carry several words; each becomes its own entry file in one pull request.
export const MAX_WORDS = 20;

const isBlankWord = (word) => word.hanji.trim() === '' && word.tl.trim() === '';

// Shared form values plus [{ hanji, tl }] → { entries, errors }. Errors on hanji or tl carry the
// word's row index; shared-field errors appear once. Blank extra rows are ignored; a pair
// repeated within the batch is an error on the later row.
export async function checkBatch(shared, words, identity = PLACEHOLDER_IDENTITY) {
  const entries = [];
  const errors = [];
  const firstRowOfKey = new Map();
  const filled = words.filter((word) => !isBlankWord(word));
  for (const [row, word] of words.entries()) {
    if (isBlankWord(word) && (filled.length > 0 || row > 0)) continue;
    const { entry, errors: raw } = checkForm({ ...shared, ...word }, identity);
    for (const error of describeErrors(raw)) {
      if (error.field === 'hanji' || error.field === 'tl') errors.push({ ...error, row });
      else if (!errors.some((e) => e.field === error.field)) errors.push(error);
    }
    if (raw.length > 0) continue;
    const key = await entryKey(entry.hanji, entry.tl);
    if (firstRowOfKey.has(key)) {
      errors.push({ field: 'tl', row, text: `佮第 ${firstRowOfKey.get(key) + 1} 个詞仝款` });
      continue;
    }
    firstRowOfKey.set(key, row);
    entries.push({ entry, key, row });
  }
  return { entries, errors };
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
  hanji: '漢字、日語',
  tl: '台羅',
  accents: '腔口',
  tags: '標籤',
  place: '所在',
  meaning: '意思',
  example: '例句',
  note: '說明',
});

const MESSAGE_RULES = [
  [/^tags: more than (\d+) tags$/, (m) => `上濟 ${m[1]} 个`],
  [/^tags: "(.+)" longer than (\d+) characters$/, (m) => `「${m[1]}」傷長，上濟 ${m[2]} 字`],
  [/^tags: "(.+)" only Han characters/, (m) => `「${m[1]}」干焦會當用漢字、假名、台羅字母佮「-」`],
  [/: required$/, () => '愛填'],
  [/: longer than (\d+) characters$/, (m) => `傷長，上濟 ${m[1]} 字`],
  [/: must be one line$/, () => '袂當換逝'],
  [/: only Han characters/, () => '干焦會當用漢字、假名、台羅字母佮「-」'],
  [/: only Latin letters/, () => '干焦會當用台羅字母、調符、數字、空格佮「-」'],
  [/: must contain a Han character, kana or a letter$/, () => '愛有漢字、假名抑是字母'],
  [/: must contain a letter$/, () => '愛有字母'],
  [/: only with accent /, () => '揀「其他」腔口才需要填所在'],
  [/: contains a control character/, () => '有袂當用的特殊字元'],
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


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

// itaigi.json rows [hanji, tl, poj, tps, [tag index], [contributor]] → search index, each word
// credited to its iTaigi contributors as itaigi.tw names them (maintainer 2026-11-26); folding runs
// once here, not per keystroke. `variants` holds each "/"-joined reading on its own, `folded` the
// whole tl.
export function indexItaigi(rows) {
  return rows.map(([hanji, tl, poj, tps, tags, contributors]) => ({
    hanji,
    tl,
    poj,
    tps,
    tags,
    contributors,
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

// Centres for circles of the given radii, packed around (0, 0), largest first: each circle goes
// where it touches two placed circles (or, second, beside the first) and lies nearest the centre
// on an ellipse `aspect` times as wide as tall, so the pack takes the shape of its box. Circles stay
// `gap` apart. Returns { x, y } in the order of `radii`.
export function packCircles(radii, { aspect = 1, gap = 0 } = {}) {
  const order = radii.map((_, i) => i).sort((a, b) => radii[b] - radii[a] || a - b);
  const placed = [];
  const fits = (x, y, r) => placed.every((c) => Math.hypot(x - c.x, y - c.y) >= c.r + r + gap - 1e-6);
  const distance = (x, y) => (x / aspect) ** 2 + y ** 2;
  for (const i of order) {
    const r = radii[i];
    const reach = r + gap;
    const candidates = [];
    if (placed.length === 0) candidates.push({ x: 0, y: 0 });
    if (placed.length === 1) candidates.push({ x: placed[0].r + reach, y: 0 }, { x: -(placed[0].r + reach), y: 0 });
    for (let a = 0; a < placed.length; a += 1) {
      for (let b = a + 1; b < placed.length; b += 1) candidates.push(...touching(placed[a], placed[b], reach));
    }
    let best = null;
    for (const p of candidates) if (fits(p.x, p.y, r) && (!best || distance(p.x, p.y) < distance(best.x, best.y))) best = p;
    placed.push({ ...best, r, i });
  }
  const centres = [];
  for (const { x, y, i } of placed) centres[i] = { x, y };
  return centres;
}

// The two centres at distance a.r + reach from a and b.r + reach from b (none when they cannot meet).
function touching(a, b, reach) {
  const da = a.r + reach;
  const db = b.r + reach;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > da + db || d < Math.abs(da - db)) return [];
  const along = (da * da - db * db + d * d) / (2 * d);
  const across = Math.sqrt(Math.max(0, da * da - along * along));
  const mx = a.x + (along * dx) / d;
  const my = a.y + (along * dy) / d;
  return [
    { x: mx + (across * dy) / d, y: my - (across * dx) / d },
    { x: mx - (across * dy) / d, y: my + (across * dx) / d },
  ];
}

// The homepage's tag circles for a width × height box (px): each circle's area follows its count
// (radius at least minRadius, so a small tag still holds its name), the circles fill about `fill`
// of the box and pack into its shape (packCircles). Returns the pack's bounding box and, per
// count, { r, x, y }.
export function tagCircles(counts, width, height, { fill = 0.55, gap = 6, minRadius = 22 } = {}) {
  const total = counts.reduce((sum, count) => sum + count, 0) || 1;
  const scale = Math.sqrt((fill * width * height) / (Math.PI * total));
  const radii = counts.map((count) => Math.max(minRadius, scale * Math.sqrt(count)));
  const centres = packCircles(radii, { aspect: width / height, gap });
  const circles = radii.map((r, i) => ({ r, ...centres[i] }));
  const box = {
    left: Math.min(...circles.map((c) => c.x - c.r)),
    top: Math.min(...circles.map((c) => c.y - c.r)),
    right: Math.max(...circles.map((c) => c.x + c.r)),
    bottom: Math.max(...circles.map((c) => c.y + c.r)),
  };
  return { box, circles };
}

// Hash routes: #/ search, #/submit the form, #/tag/<name> a tag's cards, #/contributor/<name> a
// contributor's cards, #/word/<hanji>/<tl> one word's cards. Parts are URI-encoded, so a "/" inside a reading never splits the route.
export const tagRoute = (tag) => `#/tag/${encodeURIComponent(tag)}`;
export const contributorRoute = (name) => `#/contributor/${encodeURIComponent(name)}`;
export const wordRoute = (hanji, tl) => `#/word/${encodeURIComponent(hanji)}/${encodeURIComponent(tl)}`;

// location.hash → { page, ... }; anything unknown or undecodable is the search page.
export function parseRoute(hash) {
  if (hash === '#/submit') return { page: 'submit' };
  // the 揣詞 page ('find': 'search' names the homepage, which once held the search box)
  if (hash === '#/search') return { page: 'find' };
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
    examples: values.examples ?? [],
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

export const isBlankWord = (word) => word.hanji.trim() === '' && word.tl.trim() === '';

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
      else if (!errors.some((e) => e.field === error.field && e.example === error.example)) errors.push(error);
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
  place: '其他腔口',
  meaning: '解說',
  examples: '例句',
  note: '說明',
});

const MESSAGE_RULES = [
  [/^tags: more than (\d+) tags$/, (m) => `上濟 ${m[1]} 个`],
  [/^tags: "(.+)" longer than (\d+) characters$/, (m) => `「${m[1]}」傷長，上濟 ${m[2]} 字`],
  [/^tags: "(.+)" only Han characters/, (m) => `「${m[1]}」干焦會當用漢字、假名、台羅字母佮「-」`],
  [/: longer than (\d+) characters$/, (m) => `傷長，上濟 ${m[1]} 字`],
  [/: must be one line$/, () => '袂當換逝'],
  [/: only Han characters/, () => '干焦會當用漢字、假名、台羅字母佮「-」'],
  [/: only Latin letters/, () => '干焦會當用台羅字母、調符、數字、空格佮「-」'],
  [/: must contain a Han character, kana or a letter$/, () => '愛有漢字、假名抑是字母'],
  [/: must contain a letter$/, () => '愛有字母'],
  [/: only with accent /, () => '揀「其他」腔口才需要填'],
  [/: contains a control character/, () => '有袂當用 ê 特殊字元'],
  [/: unknown /, () => '選項無效'],
];

// Validator messages → Taiwanese, keyed by field; unknown messages pass through unchanged.
export function describeErrors(errors) {
  return errors
    .filter((e) => !/^(contributor|contributor_id|submitted):/.test(e))
    .map((e) => {
      const field = e.slice(0, e.indexOf(':'));
      // a missing value reads 「請填寫資料」 alone: the line sits under the empty field
      if (/: required$/.test(e)) return { field, text: '請填寫資料' };
      const rule = MESSAGE_RULES.find(([re]) => re.test(e));
      const text = rule ? rule[1](e.match(rule[0])) : e;
      // one example's line: `example` is its index among the filled example rows
      const example = /^examples\[(\d+)\]\.(hanji|tl)$/.exec(field);
      if (example) return { field: example[2], example: Number(example[1]), text: `例句${FIELD_LABELS[example[2]]}：${text}` };
      return { field, text: `${FIELD_LABELS[field] ?? field}：${text}` };
    });
}


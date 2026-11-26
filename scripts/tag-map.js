import { indexItaigi, wordsWithTag } from '../site/logic.js';
import { TAGS } from '../site/tags.js';

// The homepage's tag bubble data: for each site tag, how many words carry it (the same words its
// card page lists) and a fixed sample of them, the small bubbles inside the tag's bubble. The
// sample is picked by a hash of each word, so it changes only when the data does.

// words kept per tag: the small bubbles a zoomed-in tag shows
export const SAMPLE_SIZE = 40;
// a sample word fits in a small bubble and reads as a word on its own: 2 to 4 characters, no spaces
const MIN_SAMPLE_LENGTH = 2;
const MAX_SAMPLE_LENGTH = 4;

// FNV-1a over the UTF-16 code units: a stable, well-spread order that does not follow file order.
function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

// rows: { hanji, tl } → up to `size` [hanji, tl] pairs, one per Hanji spelling.
export function sampleWords(rows, size = SAMPLE_SIZE) {
  const byHanji = new Map();
  for (const { hanji, tl } of rows) {
    const length = [...hanji].length;
    if (length >= MIN_SAMPLE_LENGTH && length <= MAX_SAMPLE_LENGTH && !/\s/.test(hanji) && !byHanji.has(hanji)) byHanji.set(hanji, tl);
  }
  return [...byHanji]
    .map((pair) => [hash(pair[0]), pair])
    .sort((a, b) => a[0] - b[0] || (a[1][0] < b[1][0] ? -1 : 1))
    .slice(0, size)
    .map(([, pair]) => pair);
}

// communityRows: dist/search.json; itaigiRows: dist/itaigi.json rows. → [{ name, tl, count, words }]
// in the site's tag order, words as [hanji, tl] pairs.
export function buildTagMap(communityRows, itaigiRows) {
  const itaigi = indexItaigi(itaigiRows);
  return TAGS.map(({ name, tl }) => {
    const words = wordsWithTag(communityRows, itaigi, name);
    const all = [...words.community, ...words.itaigi];
    return { name, tl, count: all.length, words: sampleWords(all) };
  });
}

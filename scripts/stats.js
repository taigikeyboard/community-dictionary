import { TAG_NAMES } from '../site/tags.js';

// The homepage's statistics (dist/stats.json), counted at build time from the same rows the site
// serves, so every number agrees with the search, the tag pages and the bubble map. Each word is one
// row: a community entry (dist/search.json) or an iTaigi pair (dist/itaigi.json).

// word lengths in Hanji, bucketed 1 … LONGEST, the last bucket holding everything longer
export const LONGEST = 8;
// how many tag pairs and contributors the page lists
export const TOP_PAIRS = 8;
export const TOP_CONTRIBUTORS = 10;

// One word's tag names and contributors, whichever source it comes from.
function wordFacts(row, fromItaigi) {
  if (fromItaigi) {
    const [hanji, tl, , , tags, contributors] = row;
    return { hanji, tl, tags: tags.map((index) => TAG_NAMES[index]), contributors };
  }
  return {
    hanji: row.hanji,
    tl: row.tl,
    tags: [...new Set(row.attestations.flatMap((a) => a.tags))],
    contributors: [...new Set(row.attestations.map((a) => a.contributor))],
  };
}

const ranked = (counts) => [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

// communityRows: dist/search.json; itaigiRows: dist/itaigi.json; tagMap: dist/tag-map.json (its
// per-tag counts, already those of the tag pages).
export function buildStats(communityRows, itaigiRows, tagMap) {
  const words = [...communityRows.map((row) => wordFacts(row, false)), ...itaigiRows.map((row) => wordFacts(row, true))];
  const lengths = new Array(LONGEST).fill(0);
  const pairs = new Map();
  const credits = new Map();
  let multiTag = 0;
  let variantReadings = 0;
  for (const word of words) {
    const length = [...word.hanji].length;
    if (length > 0) lengths[Math.min(length, LONGEST) - 1] += 1;
    if (word.tl.includes('/')) variantReadings += 1;
    const siteTags = word.tags.filter((name) => TAG_NAMES.includes(name)).sort((a, b) => TAG_NAMES.indexOf(a) - TAG_NAMES.indexOf(b));
    if (word.tags.length > 1) multiTag += 1;
    for (let a = 0; a < siteTags.length; a += 1) {
      for (let b = a + 1; b < siteTags.length; b += 1) {
        const key = `${siteTags[a]}\t${siteTags[b]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
    for (const name of word.contributors) credits.set(name, (credits.get(name) ?? 0) + 1);
  }
  const contributors = ranked(credits);
  const totalCredits = contributors.reduce((sum, [, n]) => sum + n, 0) || 1;
  const topCredits = contributors.slice(0, TOP_CONTRIBUTORS).reduce((sum, [, n]) => sum + n, 0);
  return {
    words: words.length,
    tags: tagMap.length,
    contributors: contributors.length,
    multiTag,
    variantReadings,
    perTag: tagMap.map(({ name, tl, hue, count }) => ({ name, tl, hue, count })).sort((a, b) => b.count - a.count),
    lengths: lengths.map((count, i) => ({ length: i + 1, count, orLonger: i + 1 === LONGEST })),
    pairs: ranked(pairs)
      .slice(0, TOP_PAIRS)
      .map(([key, count]) => ({ tags: key.split('\t'), count })),
    topContributors: contributors.slice(0, TOP_CONTRIBUTORS).map(([name, count]) => ({ name, count })),
    // share of all word credits (a word can credit several people) held by the top contributors
    topShare: topCredits / totalCredits,
    singleWordContributors: contributors.filter(([, n]) => n === 1).length,
  };
}

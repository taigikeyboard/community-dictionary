import { TAG_NAMES } from '../site/tags.js';

// The homepage's statistics (dist/stats.json), counted at build time from the same rows the site
// serves, so every number agrees with the search, the tag pages and the bubble map. Each word is one
// row: a community entry (dist/search.json) or an iTaigi pair (dist/itaigi.json).

// word lengths in Hanji, bucketed 1 … LONGEST, the last bucket holding everything longer
export const LONGEST = 8;
// how many tag pairs the page lists
export const TOP_PAIRS = 8;
// how many community contributors the homepage shows by their GitHub picture
export const TOP_GITHUB = 50;

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
  for (const word of words) {
    const length = [...word.hanji].length;
    if (length > 0) lengths[Math.min(length, LONGEST) - 1] += 1;
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
  // community contributors only (a GitHub login and account ID on every entry), by words given; the
  // ID names the picture, which survives a renamed login
  const githubCredits = new Map();
  const githubIds = new Map();
  for (const row of communityRows) {
    const people = new Map(row.attestations.map((a) => [a.contributor, a.contributor_id]));
    for (const [name, id] of people) {
      githubCredits.set(name, (githubCredits.get(name) ?? 0) + 1);
      githubIds.set(name, id);
    }
  }
  return {
    words: words.length,
    tags: tagMap.length,
    contributors: credits.size,
    multiTag,
    perTag: tagMap.map(({ name, tl, count }) => ({ name, tl, count })).sort((a, b) => b.count - a.count),
    lengths: lengths.map((count, i) => ({ length: i + 1, count, orLonger: i + 1 === LONGEST })),
    pairs: ranked(pairs)
      .slice(0, TOP_PAIRS)
      .map(([key, count]) => ({ tags: key.split('\t'), count })),
    githubContributors: ranked(githubCredits)
      .slice(0, TOP_GITHUB)
      .map(([name, count]) => ({ name, id: githubIds.get(name), count })),
  };
}

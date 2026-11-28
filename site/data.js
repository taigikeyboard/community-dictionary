import { indexRows } from './logic.js';

// The site's data files (built into dist/ by scripts/build-site.js), each fetched once and cached.

// Fetches and caches one JSON file; rejects on a network or HTTP failure, and a failed load is not
// cached, so the next call retries.
function cachedJson(path) {
  let promise;
  return () => {
    promise ??= fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        promise = undefined;
        throw err;
      });
    return promise;
  };
}

export const loadTagMap = cachedJson('tag-map.json');
export const loadStats = cachedJson('stats.json');
const loadSearch = cachedJson('search.json');

// Every word (community and iTaigi alike) with its search index (logic.js indexRows), built once
// from the first load.
export const loadRows = (() => {
  let index = null;
  return () => loadSearch().then((rows) => (index ??= indexRows(rows)));
})();

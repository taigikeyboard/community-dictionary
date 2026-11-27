import { indexItaigi } from './logic.js';

// The site's data files (built into dist/ by scripts/build-site.js), each fetched once and cached.

export const LOAD_ERROR = '資料載入失敗，請重新整理。';

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

export const loadRows = cachedJson('search.json');
export const loadTagMap = cachedJson('tag-map.json');
export const loadStats = cachedJson('stats.json');
const loadItaigi = cachedJson('itaigi.json');

// iTaigi's rows with their search index (logic.js indexItaigi), built once from the first load.
export const loadItaigiIndex = (() => {
  let index = null;
  return () => loadItaigi().then((rows) => (index ??= indexItaigi(rows)));
})();

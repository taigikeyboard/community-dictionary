import { TAG_NAMES } from '../site/tags.js';
import { romanize } from './romanize.js';

// iTaigi (CC0, per the iTaigi licence notice mirrored in ChhoeTaigi/iTaigiDataMirror): reading
// itaigi.tw's export, which scripts/import-itaigi.js turns into the committed snapshot
// data/itaigi.json, and building the site's dist/itaigi.json from that snapshot (build-site).
// iTaigi no longer changes, so deploys never download it.

export const ITAIGI_URL = encodeURI('https://itaigi.tw/匯出資料');

// The export also bundles two dictionaries iTaigi imported; they are not crowdsourced iTaigi
// content, so they are left out, as iTaigiDataMirror does.
export const IMPORTED_SOURCES = Object.freeze(['台文華文線頂辭典', '臺灣閩南語常用詞辭典']);

// The crowdsourced part holds about 20,000 rows; far fewer means a truncated or wrong file.
export const MIN_ROWS = 15000;

// A few contributors typed a full-width space between syllables; it is a plain space in Tâi-lô.
const cleanTl = (text) => text.replaceAll('\u3000', ' ').replace(/ {2,}/g, ' ').trim().normalize('NFC');

// itaigi.tw export JSON ({ 資料: [{ 華語, 來源, 漢字, 羅馬字 }] }) → distinct
// [[hanji, tl, meaning, contributor]] of crowdsourced rows (contributor: a name or 匿名). Rows whose Tâi-lô holds no Latin letter (empty, or Hanji typed in the
// wrong field) are dropped. Variant readings stay joined by "/" as contributors wrote them.
export function parseItaigi(json) {
  const data = JSON.parse(json)['資料'];
  if (!Array.isArray(data)) throw new Error('itaigi export: no 資料 array; check the export format at ' + ITAIGI_URL);
  const seen = new Set();
  const rows = [];
  for (const entry of data) {
    if (IMPORTED_SOURCES.includes(entry['來源'])) continue;
    const row = [(entry['漢字'] ?? '').trim().normalize('NFC'), cleanTl(entry['羅馬字'] ?? ''), (entry['華語'] ?? '').trim().normalize('NFC'), (entry['來源'] ?? '').trim().normalize('NFC')];
    const id = row.join('\n');
    if (!/[A-Za-z]/.test(row[1]) || seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  return rows;
}

// Snapshot pairs from data/itaigi.json ([[hanji, tl, [tag name], [contributor]]], written by
// scripts/import-itaigi.js) → the published rows
// [hanji, tl, poj, tps, [tag index into TAG_NAMES], [contributor]].
export function buildSearchRows(pairs) {
  return pairs.map(([hanji, tl, names, contributors]) => {
    const tags = names.map((name) => {
      const index = TAG_NAMES.indexOf(name);
      if (index === -1) {
        throw new Error(`data/itaigi.json: unknown tag "${name}" on ${hanji} ${tl}; restore it in site/tags.js or rerun scripts/import-itaigi.js`);
      }
      return index;
    });
    const { poj, tps } = romanize(tl);
    return [hanji, tl, poj, tps, tags, contributors];
  });
}

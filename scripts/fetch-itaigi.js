#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAG_NAMES } from '../site/tags.js';
import { romanize } from './romanize.js';

// Pulls the iTaigi dictionary from itaigi.tw's own export (CC0, per the iTaigi licence notice
// mirrored in ChhoeTaigi/iTaigiDataMirror) and writes dist/itaigi.json
// [[hanji, tl, poj, tps, [tag index]]] for the site's search, tags joined from the committed
// data/itaigi-tags.json (scripts/classify-itaigi.js). Run after build-site (which clears dist/).

export const ITAIGI_URL = encodeURI('https://itaigi.tw/匯出資料');

// The export also bundles two dictionaries iTaigi imported; they are not crowdsourced iTaigi
// content, so they are left out, as iTaigiDataMirror does.
export const IMPORTED_SOURCES = Object.freeze(['台文華文線頂辭典', '臺灣閩南語常用詞辭典']);

// The crowdsourced part holds about 20,000 rows; far fewer means a truncated or wrong file.
export const MIN_ROWS = 15000;

// A few contributors typed a full-width space between syllables; it is a plain space in Tâi-lô.
const cleanTl = (text) => text.replaceAll('　', ' ').replace(/ {2,}/g, ' ').trim().normalize('NFC');

// itaigi.tw export JSON ({ 資料: [{ 華語, 來源, 漢字, 羅馬字 }] }) → distinct [[hanji, tl, meaning]]
// of crowdsourced rows. Rows whose Tâi-lô holds no Latin letter (empty, or Hanji typed in the
// wrong field) are dropped. Variant readings stay joined by "/" as contributors wrote them.
export function parseItaigi(json) {
  const data = JSON.parse(json)['資料'];
  if (!Array.isArray(data)) throw new Error('itaigi export: no 資料 array; check the export format at ' + ITAIGI_URL);
  const seen = new Set();
  const rows = [];
  for (const entry of data) {
    if (IMPORTED_SOURCES.includes(entry['來源'])) continue;
    const row = [(entry['漢字'] ?? '').trim().normalize('NFC'), cleanTl(entry['羅馬字'] ?? ''), (entry['華語'] ?? '').trim().normalize('NFC')];
    const id = row.join('\n');
    if (!/[A-Za-z]/.test(row[1]) || seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  return rows;
}

// Parsed rows + data/itaigi-tags.json ({ "hanji\ttl": [tag name] }) → the published rows
// [hanji, tl, poj, tps, [tag index into TAG_NAMES]], one per (Hanji, Tâi-lô) pair. The Mandarin
// gloss is dropped (maintainer 2026-11-21: no Mandarin on the site); only the classifier reads it.
export function buildSearchRows(rows, tagsByPair) {
  const seen = new Set();
  const out = [];
  for (const [hanji, tl] of rows) {
    const key = `${hanji}\t${tl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tags = (tagsByPair[key] ?? []).map((name) => {
      const index = TAG_NAMES.indexOf(name);
      if (index === -1) throw new Error(`data/itaigi-tags.json: unknown tag "${name}" on ${JSON.stringify(key)}; restore it in site/tags.js or rerun scripts/classify-itaigi.js`);
      return index;
    });
    const { poj, tps } = romanize(tl);
    out.push([hanji, tl, poj, tps, tags]);
  }
  return out;
}

async function main() {
  const res = await fetch(ITAIGI_URL);
  if (!res.ok) throw new Error(`fetch-itaigi: ${ITAIGI_URL} → HTTP ${res.status}`);
  const rows = parseItaigi(await res.text());
  if (rows.length < MIN_ROWS) {
    throw new Error(`fetch-itaigi: only ${rows.length} rows (expected ≥ ${MIN_ROWS}); check ${ITAIGI_URL}`);
  }
  const tagsByPair = JSON.parse(await readFile(new URL('../data/itaigi-tags.json', import.meta.url), 'utf8'));
  const searchRows = buildSearchRows(rows, tagsByPair);
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'itaigi.json'), JSON.stringify(searchRows));
  const tagged = searchRows.filter((row) => row[4].length > 0).length;
  console.log(`fetch-itaigi: ${searchRows.length} rows (${tagged} tagged) → dist/itaigi.json`);
}

if (import.meta.main) await main();

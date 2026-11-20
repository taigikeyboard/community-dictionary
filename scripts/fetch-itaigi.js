#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TAG_NAMES } from '../site/tags.js';
import { romanize } from './romanize.js';

// Pulls the iTaigi 華台對照典 (CC0, per the ChhoeTaigiDatabase README) and writes
// dist/itaigi.json [[hanji, tl, poj, tps, [tag index]]] for the site's search, tags joined from
// the committed data/itaigi-tags.json (scripts/classify-itaigi.js). Run after build-site (which
// clears dist/).

export const ITAIGI_URL =
  'https://raw.githubusercontent.com/ChhoeTaigi/ChhoeTaigiDatabase/master/ChhoeTaigiDatabase/ChhoeTaigi_iTaigiHoataiTuichiautian.csv';

// Upstream holds about 19,800 rows; far fewer means a truncated or wrong file, not a smaller dictionary.
export const MIN_ROWS = 15000;

// RFC 4180 CSV text → array of records (arrays of fields); a leading BOM and blank lines are dropped.
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  const endRecord = () => {
    record.push(field);
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
    field = '';
  };
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      endRecord();
    } else field += c;
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

// ChhoeTaigi CSV → distinct [[hanji, tl, meaning]]; rows without Tâi-lô are dropped. Variant
// readings stay joined by "/" as upstream writes them.
export function parseItaigi(csv) {
  const [header, ...records] = parseCsv(csv);
  const column = (name) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`itaigi CSV: column "${name}" missing from header`);
    return index;
  };
  const hanjiAt = column('HanLoTaibunKip');
  const tlAt = column('KipUnicode');
  const meaningAt = column('HoaBun');
  const seen = new Set();
  const rows = [];
  for (const [i, fields] of records.entries()) {
    if (fields.length !== header.length) {
      throw new Error(`itaigi CSV record ${i + 2}: ${fields.length} fields, header has ${header.length}`);
    }
    const row = [fields[hanjiAt], fields[tlAt], fields[meaningAt]].map((text) => text.trim().normalize('NFC'));
    const id = row.join('\n');
    if (row[1] === '' || seen.has(id)) continue;
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

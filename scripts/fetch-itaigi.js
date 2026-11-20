#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { romanize } from './romanize.js';

// Pulls the iTaigi 華台對照典 (CC0, per the ChhoeTaigiDatabase README) and writes
// dist/itaigi.json [[hanji, tl, meaning, poj, tps]] for the site's search. Run after build-site
// (which clears dist/).

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

async function main() {
  const res = await fetch(ITAIGI_URL);
  if (!res.ok) throw new Error(`fetch-itaigi: ${ITAIGI_URL} → HTTP ${res.status}`);
  const rows = parseItaigi(await res.text());
  if (rows.length < MIN_ROWS) {
    throw new Error(`fetch-itaigi: only ${rows.length} rows (expected ≥ ${MIN_ROWS}); check ${ITAIGI_URL}`);
  }
  const withReadings = rows.map((row) => {
    const { poj, tps } = romanize(row[1]);
    return [...row, poj, tps];
  });
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'itaigi.json'), JSON.stringify(withReadings));
  console.log(`fetch-itaigi: ${rows.length} rows → dist/itaigi.json`);
}

if (import.meta.main) await main();

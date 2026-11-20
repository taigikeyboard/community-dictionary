#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Pulls the merged TaigiKeyboard dictionary and writes dist/dictionary.json for the site's search
// and the form's "already in a dictionary" notice. Run after build-site (which clears dist/).

export const DICTIONARY_URL =
  'https://raw.githubusercontent.com/taigikeyboard/taigikeyboard/main/dictionary/output/dictionary.csv';

// Source flag columns of dictionary.csv, in display order. Licences: taigikeyboard dictionary/LICENSE.
export const SOURCES = Object.freeze([
  ['kautian', '教典'],
  ['taijit', '台日大辭典'],
  ['taihoa', '台華線頂對照典'],
  ['itaigi', '華台對照典'],
  ['taigitv', '公視台語新詞'],
  ['stti', '學科術語辭典'],
  ['sitbut', '台灣植物名彙'],
  ['kungge', '台語工藝詞庫'],
  ['lkk', '漢羅合用建議用字'],
  ['khpoo', '齒盤補充辭典'],
  ['dev', '開發者補充辭典'],
  ['khiin', 'Khiin'],
]);

// CSV text → { sources: [{ key, label }], rows: [[hanji, tl, sourceBitmask]] }.
// dictionary.csv has no quoted fields; a row whose field count differs from the header is an error.
export function parseDictionary(csv) {
  const lines = csv.split(/\r?\n/).filter((line) => line !== '');
  const header = lines[0].split(',');
  const column = (name) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`dictionary.csv: column "${name}" missing from header`);
    return index;
  };
  const hanjiAt = column('hanzi');
  const tlAt = column('tl');
  const flagsAt = SOURCES.map(([key]) => column(key));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(',');
    if (fields.length !== header.length) {
      throw new Error(`dictionary.csv line ${i + 1}: ${fields.length} fields, header has ${header.length}`);
    }
    let mask = 0;
    flagsAt.forEach((at, bit) => {
      if (fields[at] === 'True') mask |= 1 << bit;
    });
    rows.push([fields[hanjiAt].normalize('NFC'), fields[tlAt].normalize('NFC'), mask]);
  }
  return { sources: SOURCES.map(([key, label]) => ({ key, label })), rows };
}

async function main() {
  const res = await fetch(DICTIONARY_URL);
  if (!res.ok) throw new Error(`fetch-dictionary: ${DICTIONARY_URL} → HTTP ${res.status}`);
  const index = parseDictionary(await res.text());
  const outDir = join(process.cwd(), 'dist');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'dictionary.json'), JSON.stringify(index));
  console.log(`fetch-dictionary: ${index.rows.length} rows → dist/dictionary.json`);
}

if (import.meta.main) await main();

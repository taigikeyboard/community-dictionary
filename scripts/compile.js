#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { credit, fromItaigi } from '../lib/entry.js';
import { foldSearch } from '../site/logic.js';
import { checkTree } from './check-tree.js';

// Compiles entries/ into dist/dictionary.csv and dist/search.json, one row per (Hanji, Tâi-lô)
// key listing every attesting contributor.

const CSV_HEADER = 'key,hanji,tl,accents,tags,place,meaning,examples,note,contributors';
const FORMULA_START_RE = /^[=+\-@\t\r]/;
const NEEDS_QUOTES_RE = /[",\n]/;

// Code-unit order, so the output is identical on every machine regardless of locale.
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Groups valid entries by key. Attestations are ordered by submission date, then login; the
// earliest one supplies the row's display spelling of hanji and tl.
export function groupEntries(checked) {
  const byKey = Map.groupBy(checked, (c) => c.key);
  const rows = [];
  for (const [key, group] of byKey) {
    const entries = group.map((c) => c.entry);
    entries.sort((a, b) => compare(a.submitted, b.submitted) || compare(a.contributor, b.contributor));
    const attestations = entries.map(({ hanji, tl, ...attestation }) => attestation);
    rows.push({ key, hanji: entries[0].hanji, tl: entries[0].tl, attestations });
  }
  // community words first (maintainer 2026-11-28: 「社群詞優先，再照台羅字母」), then by case- and
  // tone-free Tâi-lô, words starting with a letter before those starting with punctuation or Hanji
  const order = new Map(rows.map((row) => {
    const folded = foldSearch(row.tl);
    return [row, [row.attestations.every(fromItaigi) ? 1 : 0, /^[a-z]/.test(folded) ? 0 : 1, folded]];
  }));
  rows.sort((a, b) => {
    const [x, y] = [order.get(a), order.get(b)];
    return x[0] - y[0] || x[1] - y[1] || compare(x[2], y[2]) || compare(a.hanji, b.hanji) || compare(a.key, b.key);
  });
  return rows;
}

const unique = (values) => [...new Set(values.filter((v) => v !== ''))];

// A leading ' keeps spreadsheets from running contributor text that starts like a formula.
function csvCell(value) {
  const safe = FORMULA_START_RE.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES_RE.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// List-valued columns join with "; "; free-text columns join distinct values with a newline.
export function toCsv(rows) {
  const lines = [CSV_HEADER];
  for (const { key, hanji, tl, attestations } of rows) {
    const pick = (field) => attestations.map((a) => a[field]);
    const cells = [
      key,
      hanji,
      tl,
      unique(pick('accents').flat()).join('; '),
      unique(pick('tags').flat()).join('; '),
      unique(pick('place')).join('\n'),
      unique(pick('meaning')).join('\n'),
      // one line per example: Hanji / Tâi-lô
      unique(pick('examples').flat().map((e) => [e.hanji, e.tl].filter(Boolean).join(' / '))).join('\n'),
      unique(pick('note')).join('\n'),
      unique(attestations.flatMap(credit)).join('; '),
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// Writes dist/dictionary.csv and dist/search.json; returns false (after logging) on invalid entries.
// `romanize` (tl → { poj, tps }) adds display readings to search.json; build-site passes it; the
// command-line run (`npm run compile`) leaves it out and needs no vendor/ submodule.
export async function compile(root, { romanize } = {}) {
  const { checked, errors, count } = await checkTree(root);
  if (errors.length > 0) {
    for (const e of errors) console.error(e);
    console.error(`compile: ${errors.length} errors in entries/; run npm run validate`);
    return false;
  }
  const rows = groupEntries(checked);
  const outDir = join(root, 'dist');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'dictionary.csv'), toCsv(rows));
  const searchRows = romanize ? rows.map((row) => ({ ...row, ...romanize(row.tl) })) : rows;
  await writeFile(join(outDir, 'search.json'), `${JSON.stringify(searchRows)}\n`);
  console.log(`compile: ${count} entry files → ${rows.length} rows in dist/`);
  return true;
}

if (import.meta.main && !(await compile(process.cwd()))) process.exitCode = 1;

#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { entryKey, entryPath, issueText, prepareEntry, serializeEntry } from '../lib/entry.js';
import { ITAIGI_URL } from './itaigi.js';

// One-off (roadmap § iTaigi merge, deleted with the step that removes data/itaigi.json): turns the
// iTaigi snapshot, plus the export rows the snapshot's filter wrongly dropped, into ordinary
// entries under the organisation account. Rerunnable: it clears entries/taigikeyboard/ first.
//
// usage: node scripts/migrate-itaigi.js [--export <itaigi export .json>]

const ACCOUNT = { login: 'taigikeyboard', id: 241070258 };
const SUBMITTED = '2026-11-28';
// counts measured before the migration (pre-implementation review 2026-11-28); a different result
// means the inputs or the rules changed
const EXPECTED = { written: 17934, leftOut: 8 };

const IMPORTED_SOURCES = ['台文華文線頂辭典', '臺灣閩南語常用詞辭典'];
const LATIN = /\p{Script=Latin}/u;
const HAN_OR_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

// Characters a font or keyboard slipped in, with what they stand for in Tâi-lô.
const fixText = (text) => text.replaceAll('ı', 'i').replaceAll('‑', '-').replaceAll('ⁿ', 'nn').replaceAll('​', '');

// The export rows whose 羅馬字 held no A–Z letter (dropped by the snapshot's old filter), mended
// per the maintainer's decisions (2026-11-28): accented-only Tâi-lô kept, swapped fields swapped
// back, a Tâi-lô after a full-width space in the Hanji field split out, Mandarin → Taiwanese Hanji
// rows kept as written; rows with no reading at all stay out. → [hanji, tl, [], [name]]
function recoveredRows(exportJson) {
  const rows = [];
  for (const row of JSON.parse(exportJson)['資料']) {
    const name = (row['來源'] ?? '').trim().normalize('NFC');
    if (IMPORTED_SOURCES.includes(name)) continue;
    let hanji = (row['漢字'] ?? '').trim().normalize('NFC');
    let tl = (row['羅馬字'] ?? '').replaceAll('　', ' ').replace(/ {2,}/g, ' ').trim().normalize('NFC');
    if (/[A-Za-z]/.test(tl)) continue;
    if (tl === '') {
      const [head, ...rest] = hanji.split('　');
      if (rest.length === 0 || !LATIN.test(rest.join(' '))) continue;
      [hanji, tl] = [head.trim(), rest.join(' ').trim()];
    } else if (!LATIN.test(tl) && LATIN.test(hanji) && HAN_OR_KANA.test(tl)) {
      [hanji, tl] = [tl, hanji];
    }
    rows.push([hanji, tl, [], [name]]);
  }
  return rows;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { export: { type: 'string' } } });
const exportJson = values.export
  ? readFileSync(values.export, 'utf8')
  : await fetch(ITAIGI_URL).then((res) => {
      if (!res.ok) throw new Error(`itaigi export: HTTP ${res.status} from ${ITAIGI_URL}; pass --export <file>`);
      return res.text();
    });
const snapshot = JSON.parse(readFileSync(join(root, 'data', 'itaigi.json'), 'utf8'));
const recovered = recoveredRows(exportJson);

// merged by key: the first spelling, tags and names in first-seen order
const byKey = new Map();
for (const [rawHanji, rawTl, tags, names] of [...snapshot, ...recovered]) {
  const hanji = fixText(rawHanji);
  const tl = fixText(rawTl);
  const key = await entryKey(hanji, tl);
  const merged = byKey.get(key) ?? { hanji, tl, tags: [], names: [] };
  merged.tags = [...new Set([...merged.tags, ...tags])];
  merged.names = [...new Set([...merged.names, ...names])];
  byKey.set(key, merged);
}

const dir = join(root, 'entries', ACCOUNT.login);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const leftOut = [];
let written = 0;
for (const [key, { hanji, tl, tags, names }] of byKey) {
  const { entry, issues } = prepareEntry({
    hanji, tl, accents: [], tags, place: '', meaning: '', examples: [], note: '',
    contributor: ACCOUNT.login, contributor_id: ACCOUNT.id, submitted: SUBMITTED, editors: [], itaigi_contributors: names,
  });
  if (issues.length > 0) {
    leftOut.push(`${hanji} | ${tl} | ${names.join(', ')} | ${issues.map(issueText).join('; ')}`);
    continue;
  }
  writeFileSync(join(root, entryPath(ACCOUNT.login, key)), serializeEntry(entry));
  written += 1;
}

console.log(`migrate-itaigi: ${snapshot.length} snapshot + ${recovered.length} recovered rows → ${byKey.size} keys → ${written} entries, ${leftOut.length} left out`);
for (const line of leftOut) console.log(`  left out: ${line}`);
if (written !== EXPECTED.written || leftOut.length !== EXPECTED.leftOut) {
  console.error(`migrate-itaigi: expected ${EXPECTED.written} entries and ${EXPECTED.leftOut} left out; check the inputs before committing`);
  process.exitCode = 1;
}

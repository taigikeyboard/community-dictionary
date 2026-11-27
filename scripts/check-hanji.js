#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

// Checks the site's Taiwanese UI text against the Ministry of Education dictionary (教典,
// https://sutian.moe.edu.tw/zh-hant/): every Hanji must occur in a 教典 headword, and each run of
// Hanji should split into 教典 headwords. Reads the official ODS export
// (https://sutian.moe.edu.tw/media/senn/ods/kautian.ods), which is CC BY-ND and not committed.
//
//   node scripts/check-hanji.js <kautian.ods>
//
// Exit 1 when a character is missing; a run that does not split into headwords is only listed,
// since names (台語齒盤) and set phrases are judged by the maintainer.

// Words the maintainer keeps although 教典 lists them otherwise: 台語 (教典 writes 臺語;
// maintainer 2026-11-27).
const ACCEPTED = Object.freeze(['台語']);

const HAN = /\p{Script=Han}/u;
const HAN_RUN = /\p{Script=Han}+/gu;

// The 漢字 column (third) of the 詞目 sheet; a cell may hold variants split by 、 or /.
export function readHeadwords(odsPath) {
  const xml = execFileSync('unzip', ['-p', odsPath, 'content.xml'], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
  const sheet = xml.slice(xml.indexOf('<table:table table:name="詞目"'), xml.indexOf('</table:table>'));
  const headwords = new Set();
  for (const row of sheet.split('<table:table-row').slice(2)) {
    const cells = row.split('<table:table-cell').slice(1);
    const text = cells[2]?.match(/<text:p>([^<]*)<\/text:p>/)?.[1] ?? '';
    for (const word of text.split(/[、/]/)) if (word) headwords.add(word.replace(/【.*?】/g, ''));
  }
  return headwords;
}

// Greedy longest match against the headwords, by character (a 𨑨 is one, not two UTF-16 units).
export function splitRun(run, headwords, longest = 12) {
  const chars = [...run];
  const parts = [];
  for (let i = 0; i < chars.length; ) {
    let size = Math.min(longest, chars.length - i);
    while (size > 1 && !headwords.has(chars.slice(i, i + size).join(''))) size -= 1;
    parts.push(chars.slice(i, i + size).join(''));
    i += size;
  }
  return parts;
}

// Nearly every character is a one-character headword, so a run is suspect when two single
// characters stand side by side: a compound such as 提交 that 教典 does not list.
const hasLoosePair = (parts) => parts.some((part, i) => i > 0 && [...part].length === 1 && [...parts[i - 1]].length === 1);

// texts: { key: Taiwanese string }. Returns missing characters and runs to review.
export function checkTexts(texts, headwords) {
  const chars = new Set([...headwords].flatMap((word) => [...word]));
  const missing = new Map();
  const unsplit = [];
  for (const [key, text] of Object.entries(texts)) {
    for (const ch of text) if (HAN.test(ch) && !chars.has(ch)) missing.set(ch, [...(missing.get(ch) ?? []), key]);
    for (const [run] of text.matchAll(HAN_RUN)) {
      const parts = splitRun(run, headwords);
      if (hasLoosePair(parts)) unsplit.push({ key, run, parts });
    }
  }
  return { missing, unsplit };
}

if (import.meta.main) {
  const [odsPath] = process.argv.slice(2);
  if (!odsPath) {
    console.error('usage: node scripts/check-hanji.js <kautian.ods> (download: https://sutian.moe.edu.tw/media/senn/ods/kautian.ods)');
    process.exit(2);
  }
  const { STRINGS } = await import('../site/strings.js');
  const headwords = new Set([...readHeadwords(odsPath), ...ACCEPTED]);
  const { missing, unsplit } = checkTexts(STRINGS.nan, headwords);
  for (const { key, run, parts } of unsplit) console.log(`check-hanji: ${key}: 「${run}」 → ${parts.join(' ')}`);
  for (const [ch, keys] of missing) console.error(`check-hanji: 「${ch}」 is in no 教典 headword (${keys.join(', ')})`);
  console.log(`check-hanji: ${headwords.size} headwords, ${Object.keys(STRINGS.nan).length} strings, ${missing.size} missing characters, ${unsplit.length} runs to review`);
  if (missing.size > 0) process.exitCode = 1;
}

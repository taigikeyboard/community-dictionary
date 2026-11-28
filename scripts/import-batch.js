#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { entryKey, entryPath, issueText, prepareEntry, serializeEntry } from '../lib/entry.js';

// Maintainer tool: turns a contributor's CSV (filed through the 大批提交 issue form,
// .github/ISSUE_TEMPLATE/batch.yml) into entry files under entries/<login>/, credited to the
// issue's author. Writes nothing when any row fails, so the reply to the issue can list every
// problem at once. The maintainer then commits on a branch and opens a pull request (member mode
// in scripts/validate.js), with "Closes #<issue>" in its body.
//
//   node scripts/import-batch.js --issue 12               # CSV pasted or attached on issue #12
//   node scripts/import-batch.js --csv words.csv --login octocat
//
// The CSV layout is site/batch-template.csv: one word per row; accents and tags split by ";".

export const COLUMNS = Object.freeze(['hanji', 'tl', 'accents', 'tags', 'place', 'meaning', 'example_hanji', 'example_tl', 'note']);
const LIST_SEPARATOR = /[;；]/;
// the issue form's CSV field (batch.yml `id: csv`), as GitHub renders it in the issue body
const CSV_HEADING = /^### CSV\b.*$/m;
const ATTACHMENT_RE = /https:\/\/github\.com\/user-attachments\/files\/\d+\/[^\s)]+\.csv/i;

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks; a BOM and blank lines are dropped.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const splitList = (value) => value.split(LIST_SEPARATOR).map((v) => v.trim()).filter(Boolean);

// CSV rows → { entries: [{ entry, key, line }], errors: [string] }; `line` counts the header as 1.
export async function rowsToEntries(rows, identity) {
  const errors = [];
  const [header = [], ...body] = rows;
  const names = header.map((h) => h.trim().toLowerCase());
  const unknown = names.filter((n) => !COLUMNS.includes(n));
  if (unknown.length > 0) errors.push(`header: unknown column ${unknown.join(', ')} (expected ${COLUMNS.join(',')})`);
  if (!names.includes('tl')) errors.push('header: missing column tl');
  if (errors.length > 0) return { entries: [], errors };

  const entries = [];
  const seen = new Map();
  for (const [i, cells] of body.entries()) {
    const line = i + 2;
    const v = Object.fromEntries(COLUMNS.map((c) => [c, cells[names.indexOf(c)] ?? '']));
    const { entry, issues } = prepareEntry({
      hanji: v.hanji,
      tl: v.tl,
      accents: splitList(v.accents),
      tags: splitList(v.tags),
      place: v.place,
      meaning: v.meaning,
      examples: [{ hanji: v.example_hanji, tl: v.example_tl }],
      note: v.note,
      ...identity,
    });
    for (const found of issues) errors.push(`line ${line}: ${issueText(found)}`);
    if (issues.length > 0) continue;
    const key = await entryKey(entry.hanji, entry.tl);
    if (seen.has(key)) errors.push(`line ${line}: same word as line ${seen.get(key)}`);
    else seen.set(key, line), entries.push({ entry, key, line });
  }
  if (entries.length === 0 && errors.length === 0) errors.push('no word rows');
  return { entries, errors };
}

// The CSV of a 大批提交 issue: an attached .csv file, else the text pasted under the CSV heading.
export function csvSource(body) {
  const start = body.search(CSV_HEADING);
  if (start < 0) return null;
  const rest = body.slice(start).replace(CSV_HEADING, '');
  const section = rest.split(/^### /m)[0];
  const attachment = section.match(ATTACHMENT_RE)?.[0];
  if (attachment) return { url: attachment };
  const text = section.replace(/^\s*```\w*\s*$/gm, '').trim();
  return text && text !== '_No response_' ? { text } : null;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

const taiwanDate = (now = new Date()) => new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

async function main() {
  const { values } = parseArgs({ options: { issue: { type: 'string' }, csv: { type: 'string' }, login: { type: 'string' } } });
  let text;
  let login = values.login;
  if (values.issue) {
    const issue = JSON.parse(gh(['issue', 'view', values.issue, '--json', 'author,body']));
    login = issue.author.login;
    const source = csvSource(issue.body);
    if (!source) throw new Error(`issue #${values.issue}: no CSV pasted or attached`);
    if (source.url) {
      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`${source.url}: HTTP ${res.status}`);
      text = await res.text();
    } else text = source.text;
  } else if (values.csv && values.login) {
    text = readFileSync(values.csv, 'utf8');
  } else {
    throw new Error('usage: import-batch.js --issue <number> | --csv <file> --login <github login>');
  }
  const id = Number(gh(['api', `users/${login}`, '--jq', '.id']));
  const identity = { contributor: login, contributor_id: id, submitted: taiwanDate(), editors: [] };

  const root = fileURLToPath(new URL('..', import.meta.url));
  const { entries, errors } = await rowsToEntries(parseCsv(text), identity);
  for (const { key, line } of entries) {
    if (existsSync(join(root, entryPath(login, key)))) errors.push(`line ${line}: ${login} already submitted this word (${entryPath(login, key)})`);
  }
  if (errors.length > 0) {
    console.error(`import-batch: nothing written, ${errors.length} problem(s):\n${errors.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(join(root, 'entries', login), { recursive: true });
  for (const { entry, key } of entries) writeFileSync(join(root, entryPath(login, key)), serializeEntry(entry));
  console.log(`import-batch: ${entries.length} word(s) → entries/${login}/ (contributor ${login}, id ${id})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

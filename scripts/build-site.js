#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.js';
import { buildSearchRows } from './itaigi.js';
import { romanize } from './romanize.js';
import { ITAIGI_CONTRIBUTOR, rankContributors } from '../site/logic.js';

// Builds the static site into dist/: the pages, the shared lib/ (native ES modules, no bundler)
// and the data: compiled community entries plus iTaigi from the committed snapshot
// data/itaigi.json (no download at deploy). dist/ mirrors the repo layout so site/*.js can import ../lib/entry.js.

// repo root from this file's location, so the build works from any working directory
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'site'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg']) cpSync(join(root, 'site', file), join(dist, file));
for (const file of ['app.js', 'logic.js', 'config.js', 'icons.js', 'settings.js', 'sidebar.js', 'tags.js']) cpSync(join(root, 'site', file), join(dist, 'site', file));
cpSync(join(root, 'lib'), join(dist, 'lib'), { recursive: true });

const itaigi = buildSearchRows(JSON.parse(readFileSync(join(root, 'data', 'itaigi.json'), 'utf8')));
writeFileSync(join(dist, 'itaigi.json'), JSON.stringify(itaigi));
console.log(`build-site: ${itaigi.length} iTaigi rows → dist/itaigi.json`);

if (!(await compile(root, { romanize }))) process.exitCode = 1;
else {
  // the homepage's contributor chips: community and iTaigi contributors, most words first
  const community = JSON.parse(readFileSync(join(dist, 'search.json'), 'utf8')).map((row) => row.attestations.map((a) => a.contributor));
  const contributors = rankContributors([...community, ...itaigi.map(() => [ITAIGI_CONTRIBUTOR])]);
  writeFileSync(join(dist, 'contributors.json'), JSON.stringify(contributors));
  console.log(`build-site: ${contributors.length} contributors → dist/contributors.json`);
  console.log('build-site: dist/ ready');
}

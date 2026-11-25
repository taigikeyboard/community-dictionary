#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.js';
import { buildSearchRows } from './itaigi.js';
import { romanize } from './romanize.js';
import { buildStats } from './stats.js';
import { buildTagMap } from './tag-map.js';

// Builds the static site into dist/: the pages, the shared lib/ (native ES modules, no bundler)
// and the data: compiled community entries plus iTaigi from the committed snapshot
// data/itaigi.json (no download at deploy). dist/ mirrors the repo layout so site/*.js can import ../lib/entry.js.

// repo root from this file's location, so the build works from any working directory
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const D3_MODULES = ['d3-color', 'd3-dispatch', 'd3-ease', 'd3-force', 'd3-hierarchy', 'd3-interpolate', 'd3-quadtree', 'd3-timer'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'site'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg']) cpSync(join(root, 'site', file), join(dist, file));
for (const file of ['app.js', 'config.js', 'dom.js', 'icons.js', 'logic.js', 'settings.js', 'sidebar.js', 'story.js', 'tag-map.js', 'tags.js']) cpSync(join(root, 'site', file), join(dist, 'site', file));
// the D3 modules the homepage's tag bubbles load (ES module builds, npm dependencies), by the
// names index.html's import map gives them
mkdirSync(join(dist, 'vendor'));
for (const name of D3_MODULES) cpSync(join(root, 'node_modules', name, 'dist', `${name}.min.mjs`), join(dist, 'vendor', `${name}.min.mjs`));
cpSync(join(root, 'lib'), join(dist, 'lib'), { recursive: true });

const itaigi = buildSearchRows(JSON.parse(readFileSync(join(root, 'data', 'itaigi.json'), 'utf8')));
writeFileSync(join(dist, 'itaigi.json'), JSON.stringify(itaigi));
console.log(`build-site: ${itaigi.length} iTaigi rows → dist/itaigi.json`);

if (!(await compile(root, { romanize }))) process.exitCode = 1;
else {
  // the homepage's tag bubbles: word counts and sample words per site tag
  const tagMap = buildTagMap(JSON.parse(readFileSync(join(dist, 'search.json'), 'utf8')), itaigi);
  writeFileSync(join(dist, 'tag-map.json'), JSON.stringify(tagMap));
  console.log(`build-site: ${tagMap.length} tags → dist/tag-map.json`);
  // the homepage's statistics, from the same rows
  const stats = buildStats(JSON.parse(readFileSync(join(dist, 'search.json'), 'utf8')), itaigi, tagMap);
  writeFileSync(join(dist, 'stats.json'), JSON.stringify(stats));
  console.log(`build-site: ${stats.words} words, ${stats.contributors} contributors → dist/stats.json`);
  console.log('build-site: dist/ ready');
}

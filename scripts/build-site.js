#!/usr/bin/env node
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// the D3 packages are the npm dependencies (package.json), each shipped as its ES module build
const D3_MODULES = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies).filter((name) => name.startsWith('d3-'));
const SITE_MODULES = readdirSync(join(root, 'site')).filter((name) => name.endsWith('.js'));
const LIB_MODULES = readdirSync(join(root, 'lib')).filter((name) => name.endsWith('.js'));

// The block index.html holds at <!-- build-site:modules -->: the import map and the preload list.
function moduleTags() {
  const imports = Object.fromEntries(D3_MODULES.map((name) => [name, `./vendor/${name}.min.mjs`]));
  const preload = [...LIB_MODULES.map((name) => `lib/${name}`), ...SITE_MODULES.map((name) => `site/${name}`), ...D3_MODULES.map((name) => `vendor/${name}.min.mjs`)];
  return [`  <script type="importmap">${JSON.stringify({ imports })}</script>`, ...preload.map((href) => `  <link rel="modulepreload" href="${href}">`)].join('\n');
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'site'), { recursive: true });
for (const file of ['styles.css', 'favicon.svg', 'batch-template.csv']) cpSync(join(root, 'site', file), join(dist, file));
const page = readFileSync(join(root, 'site', 'index.html'), 'utf8');
if (!page.includes('<!-- build-site:modules -->')) throw new Error('build-site: site/index.html lost its <!-- build-site:modules --> marker');
writeFileSync(join(dist, 'index.html'), page.replace('  <!-- build-site:modules -->', moduleTags()));
// every site module, so a new one needs no edit anywhere
for (const file of SITE_MODULES) cpSync(join(root, 'site', file), join(dist, 'site', file));
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
  // the sitemap the site root's robots.txt points to (taigikeyboard.github.io): the homepage only, since the
  // card pages are hash routes, which search engines read as the homepage
  const siteUrl = /<link rel="canonical" href="([^"]+)">/.exec(page)?.[1];
  if (!siteUrl) throw new Error('build-site: site/index.html has no canonical link for the sitemap');
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${siteUrl}</loc></url>\n</urlset>\n`);
  console.log('build-site: dist/ ready');
}

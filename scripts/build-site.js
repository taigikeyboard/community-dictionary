#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from './compile.js';
import { romanize } from './romanize.js';

// Builds the static site into dist/: the pages, the shared lib/ (native ES modules, no bundler)
// and the compiled data. dist/ mirrors the repo layout so site/*.js can import ../lib/entry.js.

// repo root from this file's location, so the build works from any working directory
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'site'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg']) cpSync(join(root, 'site', file), join(dist, file));
for (const file of ['app.js', 'logic.js', 'config.js', 'icons.js', 'settings.js', 'sidebar.js', 'tags.js']) cpSync(join(root, 'site', file), join(dist, 'site', file));
cpSync(join(root, 'lib'), join(dist, 'lib'), { recursive: true });

if (!(await compile(root, { romanize }))) process.exitCode = 1;
else console.log('build-site: dist/ ready');

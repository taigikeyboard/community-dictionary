import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { checkEntryFile, duplicatePairErrors, ENTRIES_DIR } from '../lib/entry.js';

// Reads and checks every file under <root>/entries; the one tree gate for validate and compile.
export async function checkTree(root) {
  const dir = join(root, ENTRIES_DIR);
  let dirents;
  try {
    dirents = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { checked: [], errors: [], count: 0 };
    throw err;
  }
  const relativePath = (d) => relative(root, join(d.parentPath, d.name)).split(sep).join('/');
  const odd = dirents.filter((d) => !d.isFile() && !d.isDirectory());
  const files = dirents.filter((d) => d.isFile()).map(relativePath).sort();

  const results = await Promise.all(
    files.map(async (path) => ({ path, ...(await checkEntryFile(path, await readFile(join(root, path), 'utf8'))) })),
  );
  const checked = results.filter((r) => r.errors.length === 0);
  const errors = [
    ...odd.map((d) => `${relativePath(d)}: not a regular file`),
    ...results.flatMap((r) => r.errors),
    ...duplicatePairErrors(checked),
  ];
  return { checked, errors, count: files.length + odd.length };
}

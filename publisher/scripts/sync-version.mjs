#!/usr/bin/env node
// After a successful publish, copy dist/data/meta.json's version into the root package.json
// so the repo keeps pace with the live badge.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const meta = JSON.parse(await readFile(join(here, '../dist/data/meta.json'), 'utf8'));
if (!meta.version) {
  console.log('No version in dist meta; leaving package.json unchanged');
  process.exit(0);
}
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
if (pkg.version === meta.version) {
  console.log(`package.json already at ${meta.version}`);
  process.exit(0);
}
const previous = pkg.version;
pkg.version = meta.version;
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`package.json ${previous} → ${meta.version}`);

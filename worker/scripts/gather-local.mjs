#!/usr/bin/env node
// Runs the exact Worker pipeline in plain Node (no Wrangler needed) and writes the snapshot to
// ../data/snapshot.json so the publisher can build from it. KV is emulated with a JSON file.
//
//   node scripts/gather-local.mjs [--out ../data/snapshot.json]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gather } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const out = resolve(outArg > 0 ? process.argv[outArg + 1] : join(here, '../../data/snapshot.json'));
const kvFile = join(dirname(out), '.local-kv.json');

async function fileKv() {
  let store = {};
  try {
    store = JSON.parse(await readFile(kvFile, 'utf8'));
  } catch {}
  return {
    async get(key, type) {
      const v = store[key];
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store[key] = value;
      await writeFile(kvFile, JSON.stringify(store));
    },
  };
}

await mkdir(dirname(out), { recursive: true });
const env = {
  SENTINEL_KV: await fileKv(),
  BSKY_APPVIEW: process.env.BSKY_APPVIEW || 'https://api.bsky.app',
  BSKY_HANDLE: process.env.BSKY_HANDLE,
  BSKY_APP_PASSWORD: process.env.BSKY_APP_PASSWORD,
  // Optional: paraphrase via Workers AI REST (token needs Workers AI permission).
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
};

const started = Date.now();
const { snapshot } = await gather(env);
await writeFile(out, JSON.stringify(snapshot, null, 1));

const s = snapshot.stats;
console.log(`\nSnapshot written to ${out} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`Sources online: ${s.sourcesOnline}/${s.sourcesTotal}`);
for (const src of snapshot.sources) {
  console.log(`  ${src.ok ? '✓' : '✗'} ${src.name.padEnd(32)} ${String(src.items).padStart(3)} items${src.error ? '  — ' + src.error : ''}`);
}
console.log(`Reports scanned: ${s.reportsScanned} · incident reports: ${s.incidentReports} · incidents: ${s.incidents} · suspected terrorism: ${s.terrorism}`);
if (s.paraphrased != null) {
  console.log(
    `Paraphrase: ${s.paraphrased} rewritten · cache hits ${s.paraphraseCacheHits || 0} · AI calls ${s.paraphraseCalls || 0} · errors ${s.paraphraseErrors || 0} · skipped ${s.paraphraseSkipped || 0}`,
  );
}
console.log('Regional threat index:');
for (const r of snapshot.regions) {
  console.log(`  ${r.level.toUpperCase().padEnd(6)} ${String(r.index).padStart(3)}  ${r.name.padEnd(28)} score ${r.score} · ${r.incidents} incidents`);
}
const breaking = snapshot.incidents.find((i) => i.id === snapshot.breakingId);
console.log(`Breaking: ${breaking ? breaking.title : '(none)'}`);

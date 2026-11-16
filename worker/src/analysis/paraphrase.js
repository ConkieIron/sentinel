// Rewrite headlines and standfirsts with Cloudflare Workers AI so the public snapshot
// does not ship publisher wording. Classification / clustering already ran on the originals.
//
// Cache key: para:{sha256(kind|title|summary).slice(0,24)} in SENTINEL_KV (private).
// Worker path uses env.AI; Node / Actions can use the Workers AI REST API.

import { CATEGORIES } from './classify.js';
import { truncate } from '../lib/text.js';

export const PARA_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const MAX_NEW_CALLS = 40;
const CONCURRENCY = 5;
const TITLE_MAX = 110;
const SUMMARY_MAX = 220;
const AI_TIMEOUT_MS = 20000;

const SYSTEM = `You rewrite news headlines and standfirsts for SENTINEL, a public incident briefing.
Rules:
- Keep the same facts only. Do not invent places, numbers, names, or outcomes.
- Use plain briefing English. Do not copy distinctive phrases from the input.
- Headline: one line, max ${TITLE_MAX} characters.
- Summary: at most two short sentences, max ${SUMMARY_MAX} characters. If the input summary is empty, return an empty summary.
- No quotation marks around the whole headline. No hashtags. No "BREAKING".
- Reply with JSON only: {"title":"...","summary":"..."}`;

async function shaKey(kind, title, summary) {
  const raw = `${kind}|${String(title || '')}|${String(summary || '')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `para:${hex.slice(0, 24)}`;
}

function cleanText(s, max) {
  return truncate(
    String(s || '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    max,
  );
}

function parseModelJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const title = cleanText(obj.title, TITLE_MAX);
    if (!title) return null;
    return { title, summary: cleanText(obj.summary, SUMMARY_MAX) };
  } catch {
    return null;
  }
}

/** Neutral copy when AI is unavailable — never reuse the publisher summary. */
export function templateParaphrase(item) {
  const cat = CATEGORIES[item.category] || 'Incident';
  const place = item.location?.place || item.location?.country || 'Location unclear';
  const title = cleanText(`${cat} in ${place}`, TITLE_MAX);
  const sev = Number.isFinite(item.severity) ? ` Severity ${item.severity}/5.` : '';
  const summary = cleanText(`${cat} reported in ${place}.${sev}`, SUMMARY_MAX);
  return { title, summary };
}

function templateForUpdate(item) {
  const place = item.location?.place || item.location?.country;
  const title = cleanText(place ? `Update from ${item.source || 'outlet'} · ${place}` : `Update from ${item.source || 'outlet'}`, TITLE_MAX);
  return { title, summary: '' };
}

async function readCache(env, key) {
  if (!env?.SENTINEL_KV) return null;
  try {
    const v = await env.SENTINEL_KV.get(key, 'json');
    if (v?.title) return { title: cleanText(v.title, TITLE_MAX), summary: cleanText(v.summary, SUMMARY_MAX) };
  } catch {}
  return null;
}

async function writeCache(env, key, value) {
  if (!env?.SENTINEL_KV || !value?.title) return;
  try {
    await env.SENTINEL_KV.put(key, JSON.stringify(value), { expirationTtl: 60 * 60 * 24 * 14 });
  } catch {}
}

function extractAiText(result) {
  if (!result) return '';
  if (typeof result.response === 'string') return result.response;
  if (typeof result.result?.response === 'string') return result.result.response;
  if (Array.isArray(result)) {
    return result.map((p) => p?.response || p?.text || '').join('');
  }
  return '';
}

async function runWorkersAi(env, messages) {
  if (env?.AI?.run) {
    const result = await Promise.race([
      env.AI.run(PARA_MODEL, { messages, max_tokens: 220 }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout')), AI_TIMEOUT_MS)),
    ]);
    return extractAiText(result);
  }

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) return null;

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${PARA_MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages, max_tokens: 220 }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
  const body = await res.json();
  if (body?.success === false) throw new Error(body?.errors?.[0]?.message || 'AI request failed');
  return extractAiText(body?.result) || extractAiText(body);
}

async function callParaphrase(env, { title, summary }) {
  const user = `Headline:\n${String(title || '').slice(0, 300)}\n\nStandfirst:\n${String(summary || '').slice(0, 500)}`;
  const text = await runWorkersAi(env, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]);
  if (text == null) return null; // no AI configured
  return parseModelJson(text);
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function collectJobs(snapshot) {
  const jobs = [];
  for (const inc of snapshot.incidents || []) {
    jobs.push({
      kind: 'incident',
      target: inc,
      title: inc.title,
      summary: inc.summary || '',
      fallback: () => templateParaphrase(inc),
    });
  }
  for (const story of snapshot.live || []) {
    jobs.push({
      kind: 'live',
      target: story,
      title: story.title,
      summary: story.summary || '',
      fallback: () =>
        templateParaphrase({
          category: story.category,
          severity: story.severity,
          location: story.location,
        }),
    });
    for (const u of story.updates || []) {
      jobs.push({
        kind: 'update',
        target: u,
        title: u.title,
        summary: u.summary || '',
        fallback: () => templateForUpdate({ ...u, location: story.location }),
      });
    }
  }
  return jobs;
}

/**
 * Overwrite title/summary on incidents and live stories/updates with paraphrases.
 * Mutates snapshot in place and returns paraphrase stats.
 */
export async function paraphraseSnapshot(snapshot, env = {}) {
  const stats = { paraphrased: 0, paraphraseCacheHits: 0, paraphraseErrors: 0, paraphraseSkipped: 0 };
  const jobs = collectJobs(snapshot);
  if (!jobs.length) return stats;

  const hasAi = Boolean(env?.AI?.run || (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN));
  let newCalls = 0;

  // Resolve cache first (sequential KV reads are fine; then AI in a small pool).
  const prepared = [];
  for (const job of jobs) {
    const key = await shaKey(job.kind, job.title, job.summary);
    const cached = await readCache(env, key);
    if (cached) {
      job.target.title = cached.title;
      job.target.summary = cached.summary;
      stats.paraphrased++;
      stats.paraphraseCacheHits++;
      continue;
    }
    prepared.push({ ...job, key });
  }

  if (!prepared.length) return stats;

  if (!hasAi) {
    // Do not cache templates here — once AI is configured, the next gather should rewrite.
    for (const job of prepared) {
      const fb = job.fallback();
      job.target.title = fb.title;
      job.target.summary = fb.summary;
      stats.paraphrased++;
      stats.paraphraseSkipped++;
    }
    return stats;
  }

  const toCall = prepared.slice(0, MAX_NEW_CALLS);
  const deferred = prepared.slice(MAX_NEW_CALLS);

  await mapPool(toCall, CONCURRENCY, async (job) => {
    try {
      newCalls++;
      const rewritten = await callParaphrase(env, job);
      if (rewritten?.title) {
        job.target.title = rewritten.title;
        job.target.summary = rewritten.summary;
        stats.paraphrased++;
        await writeCache(env, job.key, rewritten);
        return;
      }
      throw new Error('empty paraphrase');
    } catch {
      stats.paraphraseErrors++;
      const fb = job.fallback();
      job.target.title = fb.title;
      job.target.summary = fb.summary;
      stats.paraphrased++;
      await writeCache(env, job.key, fb);
    }
  });

  // Over the per-gather AI budget: template now, AI can fill the cache on a later run.
  for (const job of deferred) {
    const fb = job.fallback();
    job.target.title = fb.title;
    job.target.summary = fb.summary;
    stats.paraphrased++;
    stats.paraphraseSkipped++;
  }

  stats.paraphraseCalls = newCalls;
  return stats;
}

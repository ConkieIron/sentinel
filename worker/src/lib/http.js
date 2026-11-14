import { USER_AGENT } from '../config.js';

// Workers allow 6 simultaneous outbound connections per invocation; extra requests queue.
// Gate requests ourselves so each timeout only starts once its request is actually running.
const MAX_CONCURRENT = 6;
let active = 0;
const waiting = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

export async function fetchWithTimeout(url, { timeoutMs = 12000, headers = {}, ...init } = {}) {
  await acquire();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      res.body?.cancel();
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    // Buffer the body inside the slot so the connection is released when we return.
    const body = await res.arrayBuffer();
    return new Response(body, { status: res.status, headers: res.headers });
  } finally {
    clearTimeout(timer);
    release();
  }
}

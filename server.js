// Slouch Catcher prototype server.
// Serves the static front-end from ./public and exposes POST /api/analyze,
// which sends the photo to a vision AI and returns a posture verdict + product pick.
// Photos are only held in memory for the duration of the request; nothing is written to disk.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PRODUCTS, byId } = require('./products');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 8 * 1024 * 1024; // the browser downsizes photos to ~1024px first, so this is generous

// Provider: "gemini" (default), "openai" (any OpenAI-compatible API: OpenRouter, Groq, OpenAI...) or "demo".
const PROVIDER = (process.env.AI_PROVIDER ||
  (process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'demo')).toLowerCase();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-flash-lite-latest'; // set empty to disable
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'google/gemma-4-31b-it:free';

// ---------- prompt ----------

const PRODUCT_IDS = PRODUCTS.map(p => p.id);

const PROMPT = `You are a friendly physiotherapist-style posture assessor for "Slouch Catcher", a fun posture-awareness app by betterhood (an Indian back & joint care brand).

Look at the photo and assess the posture of the main person in it.

Judge against these cues:
- Head: ears roughly over shoulders, not jutting forward or tilted down at a phone ("tech neck").
- Shoulders: relaxed and back, not rounded or hunched up to the ears.
- Upper back: not excessively rounded.
- Lower back: natural curve; not slumped/C-shaped when sitting, not over-arched when standing.
- Pelvis/hips: sitting on the sit bones, not sliding forward on the tailbone.
- For sitting: back supported, feet on the floor, screen near eye level.

Rules:
- verdict "good" if posture is mostly neutral (minor issues ok), "bad" if there is clear slouching, hunching, forward head, or other poor alignment.
- verdict "unclear" if there is no person, the body is not visible enough to judge (e.g. only a close-up face), or the image is not a real photo of a person. Do not guess.
- summary: exactly 2-3 short sentences, second person ("you"/"your"), warm and lightly playful, never insulting about body shape, weight, age, clothing or appearance. Mention what you actually see. If bad, include one quick fix they can do right now.
- issues: up to 3 very short labels of what is wrong (e.g. "Forward head", "Rounded shoulders"). Empty for good/unclear.
- score: 0-100 posture score (100 = textbook). Use the full range honestly.
- setting: where the person is: "desk_chair", "sofa_or_bed", "car", "standing", "floor", or "other".
- product_id: if verdict is "bad", choose the ONE betterhood product below that best fixes the main problem in this setting. Otherwise "none".
- product_reason: one sentence on why that product helps this specific person. Empty string if product_id is "none".

Products:
${PRODUCTS.map(p => `- ${p.id}: ${p.name}. Best for: ${p.fits}`).join('\n')}

Respond with JSON only.`;

const RESULT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['good', 'bad', 'unclear'] },
    score: { type: 'INTEGER' },
    summary: { type: 'STRING' },
    issues: { type: 'ARRAY', items: { type: 'STRING' } },
    setting: { type: 'STRING', enum: ['desk_chair', 'sofa_or_bed', 'car', 'standing', 'floor', 'other'] },
    product_id: { type: 'STRING', enum: [...PRODUCT_IDS, 'none'] },
    product_reason: { type: 'STRING' },
  },
  required: ['verdict', 'score', 'summary', 'issues', 'setting', 'product_id', 'product_reason'],
  propertyOrdering: ['verdict', 'score', 'summary', 'issues', 'setting', 'product_id', 'product_reason'],
};

// ---------- providers ----------

// Free-tier Gemini often answers 500/503 ("model overloaded") for a few seconds at a time,
// so retry briefly and then fall back to a second model before giving up.
async function analyzeWithGemini(mime, base64) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(500, 'GEMINI_API_KEY is not set on the server.');
  const models = [...new Set([GEMINI_MODEL, GEMINI_FALLBACK_MODEL].filter(Boolean))];
  let lastErr;
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await callGemini(key, model, mime, base64);
      } catch (err) {
        lastErr = err;
        console.error(`[ai] ${model} attempt ${attempt} failed: ${err.detail || err.message}`);
        if (!err.retryable) break; // e.g. safety block or bad JSON: try the next model instead
        if (attempt < 2) await new Promise(r => setTimeout(r, 1200));
      }
    }
  }
  throw lastErr;
}

async function callGemini(key, model, mime, base64) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESULT_SCHEMA },
      }),
      signal: AbortSignal.timeout(45000),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = providerError(res.status, data?.error?.message);
    err.retryable = res.status >= 500;
    throw err;
  }
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
  if (!text) {
    const why = data?.promptFeedback?.blockReason || cand?.finishReason || 'no candidates';
    const err = new HttpError(502, why === 'SAFETY' || data?.promptFeedback?.blockReason
      ? "The AI couldn't process this photo. Please try a different one."
      : 'The AI returned no answer. Please try again.');
    err.detail = `empty response (${why})`;
    throw err;
  }
  return parseJson(text);
}

async function analyzeWithOpenAICompatible(mime, base64) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new HttpError(500, 'OPENAI_API_KEY is not set on the server.');
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://betterhood.in/slouch-catcher/', // used by OpenRouter for attribution
      'X-Title': 'Slouch Catcher',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT + `\n\nReturn a single JSON object with keys: ${RESULT_SCHEMA.required.join(', ')}. product_id must be one of: ${[...PRODUCT_IDS, 'none'].join(', ')}.` },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError(res.status, data?.error?.message);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new HttpError(502, 'The AI returned no answer.');
  return parseJson(text);
}

function analyzeDemo() {
  // No API key configured: return a canned result so the UI can be tried out.
  return {
    verdict: 'bad', score: 42,
    summary: "Caught you! Your head is drifting a good few inches ahead of your shoulders and your lower back has melted into a C-shape. Scoot your hips right to the back of the chair and pull your chin gently back, like you're making a double chin.",
    issues: ['Forward head', 'Slumped lower back', 'Rounded shoulders'],
    setting: 'desk_chair', product_id: 'chair-lumbar',
    product_reason: 'A lumbar cushion fills the gap behind your lower back so sitting upright stops being an effort.',
    demo: true,
  };
}

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function providerError(status, message) {
  const err = status === 429
    ? new HttpError(429, 'Our posture AI is a bit busy right now. Please try again in a minute.')
    : new HttpError(502, 'The posture AI could not analyse this photo. Please try again.');
  err.detail = `provider HTTP ${status}: ${message}`;
  return err;
}

function parseJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/); // tolerate ```json fences from non-schema providers
  try { return JSON.parse(match ? match[0] : text); }
  catch {
    const err = new HttpError(502, 'The AI answer could not be read. Please try again.');
    err.detail = `unparseable JSON: ${String(text).slice(0, 300)}`;
    throw err;
  }
}

function normalise(raw) {
  const verdict = ['good', 'bad', 'unclear'].includes(raw.verdict) ? raw.verdict : 'unclear';
  const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0)));
  let product = null;
  if (verdict === 'bad') {
    // Fall back to the most broadly useful product if the model picked something invalid.
    const p = byId[raw.product_id] || byId['chair-lumbar'];
    product = { ...p, reason: String(raw.product_reason || '').trim() };
    delete product.fits;
  }
  return {
    verdict,
    score: verdict === 'unclear' ? null : score,
    summary: String(raw.summary || '').trim(),
    issues: verdict === 'bad' && Array.isArray(raw.issues) ? raw.issues.slice(0, 3).map(String) : [],
    setting: raw.setting || 'other',
    product,
    demo: !!raw.demo,
  };
}

// Tiny in-memory rate limit so one visitor can't drain the free quota.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), windowMs = 60_000, max = Number(process.env.RATE_LIMIT_PER_MIN) || 6;
  const list = (hits.get(ip) || []).filter(t => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'That photo is too large. Please use a smaller image.')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- routes ----------

async function handleAnalyze(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  if (rateLimited(ip)) throw new HttpError(429, 'Easy there, posture police! Please wait a minute before the next photo.');

  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, 'Bad request.'); }
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body?.image || '');
  if (!m) throw new HttpError(400, 'Please upload a JPG, PNG or WebP photo.');

  const started = Date.now();
  const raw = PROVIDER === 'gemini' ? await analyzeWithGemini(m[1], m[2])
    : PROVIDER === 'openai' ? await analyzeWithOpenAICompatible(m[1], m[2])
    : analyzeDemo();
  const result = normalise(raw);
  console.log(`[ai] ${PROVIDER} -> ${result.verdict} (${result.score}) in ${Date.now() - started}ms`);
  sendJson(res, 200, result);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/analyze') return await handleAnalyze(req, res);
    if (req.method === 'GET' && req.url === '/api/health') return sendJson(res, 200, { ok: true, provider: PROVIDER });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    const status = err instanceof HttpError ? err.status : err.name === 'TimeoutError' ? 504 : 500;
    const msg = err instanceof HttpError ? err.message
      : status === 504 ? 'The posture AI took too long. Please try again.' : 'Something went wrong. Please try again.';
    if (err.detail) console.error(`[ai] giving up: ${err.detail}`);
    const debug = process.env.NODE_ENV !== 'production' ? { detail: err.detail || err.message } : {};
    if (!res.headersSent) sendJson(res, status, { error: msg, ...debug });
  }
});

server.listen(PORT, () => {
  const model = PROVIDER === 'gemini' ? GEMINI_MODEL : PROVIDER === 'openai' ? `${OPENAI_MODEL} @ ${OPENAI_BASE_URL}` : 'canned demo result';
  console.log(`Slouch Catcher running at http://localhost:${PORT}  (AI: ${PROVIDER}, ${model})`);
});

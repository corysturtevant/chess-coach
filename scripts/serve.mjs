import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTurn } from './engine.mjs';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';
const apiKey = (process.env.LLM_API_KEY || '').trim();
const model = process.env.LLM_MODEL || 'Qwen/Qwen3.8-27B';
const quickModel = process.env.LLM_MODEL_QUICK || model;
const deepModel = process.env.LLM_MODEL_DEEP || model;
const endpoint = process.env.AKASHML_API_URL || 'https://api.akashml.com/anthropic/v1/messages';
const maiaEndpoint = process.env.MAIA_API_URL || '';
const maiaLevels = {
  beginner: { elo: 800, temperature: 1.15, topP: 0.95 },
  improving: { elo: 1200, temperature: 1.0, topP: 0.95 },
  club: { elo: 1600, temperature: 0.85, topP: 0.9 }
};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json; charset=utf-8' };
let activeCoachRequests = 0;
let activeEngineRequests = 0;

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 64_000) throw Object.assign(new Error('Request too large'), { status: 413 });
  }
  try { return JSON.parse(text || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function parseModelJson(text) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean);
}

async function coach(req, res) {
  if (!apiKey) return json(res, 503, { error: 'not_configured', detail: 'AkashML is not configured.' });
  if (activeCoachRequests >= 2) return json(res, 429, { error: 'rate_limited', detail: 'The coach is already handling other requests.' });
  let body;
  try { body = await readJson(req); }
  catch (error) { return json(res, error.status || 400, { error: 'invalid_request', detail: error.message }); }
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 40_000) {
    return json(res, 422, { error: 'invalid_request', detail: 'Provide a prompt up to 40,000 characters.' });
  }
  const tier = ['quick', 'default', 'deep'].includes(body.tier) ? body.tier : 'default';
  const purpose = ['move', 'hint', 'review', 'question'].includes(body.purpose) ? body.purpose : 'question';
  const deepRequest = tier === 'deep' && (purpose === 'review' || purpose === 'question');
  const selectedModel = tier === 'quick' ? quickModel : deepRequest ? deepModel : model;
  const maxTokens = deepRequest ? 1800 : body.json ? (tier === 'quick' ? 600 : 900) : (tier === 'quick' ? 700 : 1100);
  activeCoachRequests++;
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: maxTokens,
        temperature: body.json ? 0.1 : 0.35,
        system: 'You are Chess Coach, a warm and accurate chess teacher. Follow the requested response format exactly. Never claim a move is legal unless it appears in the supplied legal-move list.',
        messages: [{ role: 'user', content: body.prompt }]
      }),
      signal: AbortSignal.timeout(deepRequest ? 60_000 : 30_000)
    });
    if (!upstream.ok) {
      console.error(`AkashML request failed with HTTP ${upstream.status}`);
      const authFailed = upstream.status === 401 || upstream.status === 403;
      const error = upstream.status === 429 ? 'rate_limited' : authFailed ? 'not_granted' : 'upstream_error';
      return json(res, upstream.status === 429 ? 429 : authFailed ? 503 : 502, { error, detail: authFailed ? 'The AkashML credential was rejected.' : 'The AI coach is temporarily unavailable.' });
    }
    const data = await upstream.json();
    const text = Array.isArray(data.content) ? data.content.filter(block => block && block.type === 'text').map(block => block.text || '').join('') : '';
    if (!text.trim()) return json(res, 502, { error: 'empty_response', detail: 'The AI coach returned an empty response.' });
    if (body.json) {
      try { return json(res, 200, { json: parseModelJson(text) }); }
      catch { return json(res, 502, { error: 'invalid_response', detail: 'The AI coach returned invalid structured data.' }); }
    }
    return json(res, 200, { text });
  } catch (error) {
    console.error(`AkashML request error: ${error && error.name ? error.name : 'unknown'}`);
    return json(res, 502, { error: 'upstream_error', detail: 'The AI coach is temporarily unavailable.' });
  } finally {
    activeCoachRequests--;
  }
}

async function analyze(req, res) {
  if (activeEngineRequests >= 2) return json(res, 429, { error: 'rate_limited', detail: 'The chess engine is already analyzing other positions.' });
  let body;
  try { body = await readJson(req); }
  catch (error) { return json(res, error.status || 400, { error: 'invalid_request', detail: error.message }); }
  const fenOk = typeof body.fen === 'string' && body.fen.length <= 120;
  const beforeOk = body.beforeFen == null || (typeof body.beforeFen === 'string' && body.beforeFen.length <= 120);
  const moveOk = body.studentMove == null || (typeof body.studentMove === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(body.studentMove));
  const engineOk = body.opponentEngine == null || ['stockfish', 'maia'].includes(body.opponentEngine);
  const baseFenOk = body.baseFen == null || (typeof body.baseFen === 'string' && body.baseFen.length <= 120);
  const historyOk = body.moves == null || (Array.isArray(body.moves) && body.moves.length <= 400 && body.moves.every(move => typeof move === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)));
  if (!fenOk || !beforeOk || !moveOk || !engineOk || !baseFenOk || !historyOk || !['beginner', 'improving', 'club'].includes(body.level)) {
    return json(res, 422, { error: 'invalid_request', detail: 'Provide valid chess positions, move, and difficulty.' });
  }
  activeEngineRequests++;
  try {
    const stockfishPromise = analyzeTurn(body);
    if (body.opponentEngine !== 'maia') {
      const result = await stockfishPromise;
      result.opponentEngine = 'stockfish';
      return json(res, 200, result);
    }
    const profile = maiaLevels[body.level];
    const maiaPromise = maiaEndpoint ? fetch(maiaEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fen: body.fen, baseFen: body.baseFen, moves: body.moves, ...profile }),
      signal: AbortSignal.timeout(20_000)
    }).then(async response => {
      if (!response.ok) throw new Error(`Maia HTTP ${response.status}`);
      return response.json();
    }) : Promise.reject(new Error('Maia is not configured'));
    const [stockfish, maia] = await Promise.allSettled([stockfishPromise, maiaPromise]);
    if (stockfish.status === 'rejected') throw stockfish.reason;
    const result = stockfish.value;
    if (maia.status === 'fulfilled' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(maia.value.move || '')) {
      result.coachMove = maia.value.move;
      result.coachMoveRank = maia.value.rank ?? null;
      result.opponentEngine = 'maia';
      result.maiaElo = maia.value.elo;
      result.maiaModel = maia.value.model;
    } else {
      console.error(`Maia move failed; using Stockfish fallback: ${maia.reason && maia.reason.message ? maia.reason.message : 'invalid response'}`);
      result.opponentEngine = 'stockfish';
      result.requestedEngine = 'maia';
      result.engineFallback = true;
    }
    return json(res, 200, result);
  }
  catch (error) {
    console.error(`Chess analysis error: ${error && error.message ? error.message : 'unknown'}`);
    return json(res, 502, { error: 'engine_error', detail: 'The chess engine could not analyze this position.' });
  } finally { activeEngineRequests--; }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { status: 'ok', coach: apiKey ? 'akashml' : 'local', model_configured: Boolean(apiKey) });
  }
  if (url.pathname === '/api/coach') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    return coach(req, res);
  }
  if (url.pathname === '/api/analyze') {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    return analyze(req, res);
  }
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw Object.assign(new Error('Method not allowed'), { status: 405 });
    const pathname = decodeURIComponent(url.pathname);
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = resolve(root, requested);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Invalid path');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    res.writeHead(error.status || 404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(error.status === 405 ? 'Method not allowed' : 'Not found');
  }
}).listen(port, host, () => {
  console.log(`Chess Coach is running at http://${host}:${port} (${apiKey ? 'AkashML coaching enabled' : 'local coaching mode'})`);
});

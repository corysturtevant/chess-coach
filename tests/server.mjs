import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { strict as assert } from 'node:assert';
import { LEVELS, STUDENT_GRADE_DEPTH } from '../scripts/engine.mjs';

assert.deepEqual(LEVELS.beginner, { depth: 6, multiPv: 12, maxMoveLossCp: 450 });
assert.equal(STUDENT_GRADE_DEPTH, 12);

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

let received;
const upstream = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  received = { authorization: req.headers.authorization, body: JSON.parse(text) };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'text', text: '```json\n{"move":"Nf3","plan":["Develop"]}\n```' }] }));
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const upstreamPort = upstream.address().port;
let maiaReceived;
const maiaUpstream = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  maiaReceived = JSON.parse(text);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ move: 'e8e7', rank: 3, elo: maiaReceived.elo, model: 'maia3-5m' }));
});
maiaUpstream.listen(0, '127.0.0.1');
await once(maiaUpstream, 'listening');
const maiaPort = maiaUpstream.address().port;
const appPort = await freePort();
const app = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(appPort), LLM_API_KEY: 'akml-test-only', LLM_MODEL: 'fixture-model', LLM_MODEL_QUICK: 'fixture-quick', LLM_MODEL_DEEP: 'fixture-deep', AKASHML_API_URL: `http://127.0.0.1:${upstreamPort}/messages`, MAIA_API_URL: `http://127.0.0.1:${maiaPort}/move` },
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  await Promise.race([
    new Promise((resolve, reject) => {
      app.stdout.on('data', chunk => { if (String(chunk).includes('AkashML coaching enabled')) resolve(); });
      app.once('exit', code => reject(new Error(`App server exited early (${code})`)));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('App server startup timed out')), 5000))
  ]);
  const health = await fetch(`http://127.0.0.1:${appPort}/api/health`).then(r => r.json());
  assert.deepEqual(health, { status: 'ok', coach: 'akashml', model_configured: true });
  const analysisResponse = await fetch(`http://127.0.0.1:${appPort}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'club', beforeFen: '1r2k3/8/8/8/8/8/4K3/Q7 w - - 0 1', studentMove: 'a1b1', fen: '1r2k3/8/8/8/8/8/4K3/1Q6 b - - 1 1' })
  });
  assert.equal(analysisResponse.status, 200);
  const analysis = await analysisResponse.json();
  assert.equal(analysis.assessment, 'blunder');
  assert.equal(analysis.coachMove, 'b8b1');
  assert.equal(analysis.coachMoveRank, 1);
  assert.equal(analysis.difficulty, 'club');
  assert.equal(analysis.maxMoveLossCp, 20);
  assert.equal(analysis.gradingDepth, 12);
  assert.equal(analysis.opponentEngine, 'stockfish');
  const maiaResponse = await fetch(`http://127.0.0.1:${appPort}/api/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'beginner', opponentEngine: 'maia', baseFen: '1r2k3/8/8/8/8/8/4K3/Q7 w - - 0 1', moves: ['a1b1'], beforeFen: '1r2k3/8/8/8/8/8/4K3/Q7 w - - 0 1', studentMove: 'a1b1', fen: '1r2k3/8/8/8/8/8/4K3/1Q6 b - - 1 1' })
  });
  assert.equal(maiaResponse.status, 200);
  const maiaAnalysis = await maiaResponse.json();
  assert.equal(maiaAnalysis.coachMove, 'e8e7');
  assert.equal(maiaAnalysis.opponentEngine, 'maia');
  assert.equal(maiaAnalysis.maiaElo, 800);
  assert.equal(maiaAnalysis.assessment, 'blunder');
  assert.equal(maiaReceived.temperature, 1.15);
  const response = await fetch(`http://127.0.0.1:${appPort}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Reply with only JSON', json: true }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).json, { move: 'Nf3', plan: ['Develop'] });
  assert.equal(received.authorization, 'Bearer akml-test-only');
  assert.equal(received.body.model, 'fixture-model');
  assert.equal(received.body.messages[0].content, 'Reply with only JSON');
  const quickResponse = await fetch(`http://127.0.0.1:${appPort}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Quick move', tier: 'quick', purpose: 'move', json: true }) });
  assert.equal(quickResponse.status, 200);
  assert.equal(received.body.model, 'fixture-quick');
  assert.equal(received.body.max_tokens, 600);
  const deepResponse = await fetch(`http://127.0.0.1:${appPort}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Review this game', tier: 'deep', purpose: 'review' }) });
  assert.equal(deepResponse.status, 200);
  assert.equal(received.body.model, 'fixture-deep');
  assert.equal(received.body.max_tokens, 1800);
  const deepMoveResponse = await fetch(`http://127.0.0.1:${appPort}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Choose the engine move', tier: 'deep', purpose: 'move', json: true }) });
  assert.equal(deepMoveResponse.status, 200);
  assert.equal(received.body.model, 'fixture-model');
  console.log('ok   server: Stockfish analysis plus AkashML proxy and structured response');
} finally {
  app.kill('SIGTERM');
  await new Promise(resolve => upstream.close(resolve));
  await new Promise(resolve => maiaUpstream.close(resolve));
}

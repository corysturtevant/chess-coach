// Verifies the lesson solutions and handicap start positions inside src/chess-coach.html.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Chess } = require('chess.js');

const html = readFileSync(new URL('../src/chess-coach.html', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-preview.mjs', import.meta.url), 'utf8');
const serverScript = readFileSync(new URL('../scripts/serve.mjs', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../src/manifest.webmanifest', import.meta.url), 'utf8'));
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const grab = re => { const m = js.match(re); if (!m) throw new Error('Could not find ' + re); return m[0]; };

const FILES = 'abcdefgh';
const LESSONS = eval('(' + grab(/\[\s*\{id:'backrank'[\s\S]*?\n\];/).replace(/;$/, '') + ')');
const ODDS = eval('(' + grab(/\{\s*none:\{label[\s\S]*?\n\};/).replace(/;$/, '') + ')');
const startFen = eval('(' + grab(/function startFen\([\s\S]*?\n\}/) + ')');

let failures = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures++; };

check(LESSONS.length === 24, `curriculum has 24 lessons (found ${LESSONS.length})`);
check(new Set(LESSONS.map(l => l.id)).size === LESSONS.length, 'lesson ids are unique');
check(js.includes('Position before the student move (FEN)'), 'coach receives the pre-move position');
check(js.includes('Do not use a negative label merely because another move is stronger'), 'coach uses consequence-based grading');
check(js.includes('If you cannot identify concrete harm from the supplied positions and legal moves, choose "good"'), 'coach defaults uncertain assessments to good');
check(js.includes("+' has already selected it for the chosen difficulty; do not substitute another move.'"), 'server coach obeys the engine-selected move');
check(js.includes('engine&&engine.assessment?engine.assessment'), 'engine assessment overrides the LLM label');
check(js.includes('analyzer=server.analyze'), 'Stockfish remains available without an LLM');
check(js.includes('engineStudentFeedback(engine,bestStudent)'), 'engine feedback has a deterministic fallback');
check(js.includes("Coach played ") && js.includes('coachAnimating'), 'coach move has a persistent notice and reveal state');
check(js.includes('setTimeout(()=>{coachRevealTimer=null;coachAnimating=false;busy=false;render()'), 'board stays locked during coach move reveal');
check(html.includes('<option value="deep">Deep review</option>'), 'coach offers Fast, Thorough, and Deep Review');
check(js.includes("purpose:'move'") && js.includes("'review'"), 'coach routes move and review purposes separately');
check(js.includes("--coach-dx") && html.includes('coach-slide'), 'coach piece slides from its origin square');
check(compose.includes('LLM_MODEL_DEEP: ${LLM_MODEL_DEEP:-}'), 'Compose passes the Deep Review model into the container');
check(html.includes('<option value="maia">Maia 3 · human-like</option>'), 'coach offers Maia 3 as an opponent engine');
check(compose.includes('dockerfile: Dockerfile.maia') && compose.includes('MAIA_API_URL: http://maia:8001/move'), 'Compose includes the internal Maia sidecar');
check(js.includes("opponentEngine,baseFen:startFen") && js.includes("engine.opponentEngine==='maia'"), 'client sends move history and identifies Maia replies');
check(manifest.name === 'Chess Coach' && manifest.icons.some(icon => icon.sizes === '512x512'), 'home-screen manifest names the app and includes a 512px icon');
check(buildScript.includes('apple-touch-icon') && buildScript.includes('apple-mobile-web-app-capable'), 'build adds iPad home-screen metadata');
check(html.includes('data-theme-choice="system"') && html.includes('data-theme-choice="light"') && html.includes('data-theme-choice="dark"'), 'settings offer System, Light, and Dark appearance modes');
check(js.includes("localStorage.getItem('chesscoach.theme')") && js.includes("localStorage.setItem('chesscoach.theme',t)"), 'theme preference persists locally');
for (const style of ['classic', 'aether', 'neon', 'wildwood', 'spell']) {
  check(html.includes(`data-board-choice="${style}"`), `settings offer the ${style} board style`);
}
check(js.includes("localStorage.getItem('chesscoach.boardStyle')") && js.includes("localStorage.setItem('chesscoach.boardStyle',s)"), 'board style persists locally');
check(js.includes("document.documentElement.setAttribute('data-board-style',boardStyle)"), 'selected board style is applied to the document');
check(js.includes("className='pc '+p.color+' '+(boardStyle==='classic'?'glyph':'sprite')"), 'custom themes render illustrated piece sprites');
check(html.includes('data-coach-prompt="What is the threat?"'), 'coach includes suggested question chips');
check(html.includes('id="coachOpening"') && html.includes('id="coachWatchBlock"'), 'coach card includes opening and watch-for context');
check(js.includes('moveGrades.push({ply,assessment:moveGrade.assessment})') && html.includes('sheet-grade'), 'scoresheet records move grades');
check(html.includes('--paper:#fbf9f6') && html.includes('--paper:#14171c'), 'redesign defines light and dark design tokens');
check(html.includes('id="gradeSpectrum"') && js.includes("GRADE_ORDER=['blunder','mistake','inaccuracy','good','great']"), 'move-strength spectrum renders every grade');
check(html.includes('id="settingsDrawer"') && js.includes("e.key==='Escape'"), 'settings drawer supports keyboard dismissal');
check(html.includes('id="moveArrow"') && js.includes('function renderMoveArrow()'), 'coach move arrow is rendered from board coordinates');
check(html.includes('data:image/png;base64,'), 'header embeds the Coach Knight mark for Artifact compatibility');
for (const icon of ['apple-touch-icon.png', 'favicon-32.png', 'icon-192.png', 'icon-512.png']) {
  check(existsSync(new URL(`../src/icons/${icon}`, import.meta.url)), `home-screen asset ${icon} exists`);
}
for (const asset of ['aether-board.webp','aether-pieces.webp','neon-board.webp','neon-pieces.webp','wildwood-board.webp','wildwood-pieces.webp','spell-board.webp','spell-pieces.webp']) {
  check(existsSync(new URL(`../src/board-styles/${asset}`, import.meta.url)), `redesign asset ${asset} exists`);
}
check(buildScript.includes("writeFileSync(new URL('../dist/artifact.html'") && buildScript.includes("'data:image/webp;base64,'"), 'build emits self-contained Artifact source');
check(serverScript.includes("'.webp': 'image/webp'"), 'server sends board artwork with the WebP content type');
for (const l of LESSONS) {
  check(typeof l.unit === 'string' && l.unit.length > 0, `lesson ${l.id}: unit is set`);
  check(Number.isInteger(l.difficulty) && l.difficulty >= 1 && l.difficulty <= 3, `lesson ${l.id}: difficulty is 1–3`);
  const g = new Chess();
  check(g.load(l.fen), `lesson ${l.id}: FEN loads`);
  const mv = g.move(l.sol);
  check(!!mv, `lesson ${l.id}: solution ${l.sol} is legal`);
  if (l.sol.endsWith('#')) check(g.in_checkmate(), `lesson ${l.id}: ${l.sol} is checkmate`);
  else if (l.sol.endsWith('+')) check(g.in_check(), `lesson ${l.id}: ${l.sol} gives check`);
}

for (const key of Object.keys(ODDS)) {
  for (const coach of ['w', 'b']) {
    const fen = startFen(key, coach);
    const g = new Chess();
    check(g.load(fen) && g.validate_fen(fen).valid, `odds ${key} (coach ${coach}): ${fen}`);
  }
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');

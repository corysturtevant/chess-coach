import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const enginePath = process.env.STOCKFISH_PATH || resolve(fileURLToPath(new URL('../node_modules/stockfish/bin/stockfish-19-lite-single.js', import.meta.url)));

export const LEVELS = {
  beginner: { depth: 6, multiPv: 12, maxMoveLossCp: 450 },
  improving: { depth: 12, multiPv: 4, maxMoveLossCp: 85 },
  club: { depth: 15, multiPv: 2, maxMoveLossCp: 20 }
};

export const STUDENT_GRADE_DEPTH = 12;

function numericScore(kind, value) {
  const n = Number(value);
  if (kind === 'cp') return n;
  return n > 0 ? 100_000 - Math.min(n, 999) * 100 : -100_000 - Math.max(n, -999) * 100;
}

export function analyzePosition(fen, { depth = 12, multiPv = 1, timeoutMs = 12_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [enginePath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = new Map();
    let buffer = '', stderr = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      error ? reject(error) : resolvePromise(value);
    };
    const timer = setTimeout(() => finish(new Error('Stockfish analysis timed out')), timeoutMs);
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 1000); });
    child.once('error', finish);
    child.once('exit', code => {
      if (!settled) finish(new Error(`Stockfish exited early (${code}): ${stderr}`));
    });
    child.stdout.on('data', chunk => {
      buffer += String(chunk);
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || '';
      for (const line of parts) {
        const info = line.match(/\bdepth (\d+).*\bmultipv (\d+).*\bscore (cp|mate) (-?\d+).*\bpv (\S+)/);
        if (info) lines.set(Number(info[2]), { depth: Number(info[1]), scoreCp: numericScore(info[3], info[4]), move: info[5], mate: info[3] === 'mate' ? Number(info[4]) : null });
        const best = line.match(/^bestmove (\S+)/);
        if (best) {
          const variations = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([rank, value]) => ({ rank, ...value }));
          if (!variations.length) return finish(new Error('Stockfish returned no evaluation'));
          finish(null, { bestMove: best[1], variations });
        }
      }
    });
    child.stdin.write(`uci\nsetoption name MultiPV value ${multiPv}\nisready\nposition fen ${fen}\ngo depth ${depth}\n`);
  });
}

export function classifyLoss(lossCp, playedBest) {
  if (playedBest && lossCp <= 15) return 'great';
  if (lossCp <= 60) return 'good';
  if (lossCp <= 150) return 'inaccuracy';
  if (lossCp <= 350) return 'mistake';
  return 'blunder';
}

function chooseCoachMove(variations, profile) {
  const best = variations[0];
  const eligible = variations.filter(v => best.scoreCp - v.scoreCp <= profile.maxMoveLossCp);
  if (eligible.length === 1) return best;
  if (profile.maxMoveLossCp <= 20) return best;
  if (profile.maxMoveLossCp <= 85) return eligible[Math.floor(Math.pow(Math.random(), 1.8) * eligible.length)];
  return eligible[Math.floor(Math.random() * eligible.length)];
}

export async function analyzeTurn({ fen, beforeFen, studentMove, level = 'beginner' }) {
  const profile = LEVELS[level] || LEVELS.beginner;
  const currentPromise = analyzePosition(fen, { depth: profile.depth, multiPv: profile.multiPv });
  const beforePromise = beforeFen && studentMove
    ? analyzePosition(beforeFen, { depth: STUDENT_GRADE_DEPTH, multiPv: 1 })
    : null;
  const afterPromise = beforeFen && studentMove && profile.depth !== STUDENT_GRADE_DEPTH
    ? analyzePosition(fen, { depth: STUDENT_GRADE_DEPTH, multiPv: 1 })
    : null;
  const current = await currentPromise;
  const chosen = chooseCoachMove(current.variations, profile);
  const result = {
    coachMove: chosen.move,
    coachMoveRank: chosen.rank,
    difficulty: level,
    depth: profile.depth,
    maxMoveLossCp: profile.maxMoveLossCp
  };
  if (beforeFen && studentMove) {
    const before = await beforePromise;
    const after = afterPromise ? await afterPromise : current;
    const beforeScore = before.variations[0].scoreCp;
    const afterStudentScore = -after.variations[0].scoreCp;
    const lossCp = Math.max(0, beforeScore - afterStudentScore);
    result.assessment = classifyLoss(lossCp, before.bestMove === studentMove);
    result.lossCp = lossCp;
    result.bestStudentMove = before.bestMove;
    result.beforeScoreCp = beforeScore;
    result.afterScoreCp = afterStudentScore;
    result.gradingDepth = STUDENT_GRADE_DEPTH;
  }
  return result;
}

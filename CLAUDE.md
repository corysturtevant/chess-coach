# Chess Coach

A single-page chess trainer that runs both as a claude.ai Artifact and as a standalone local app. The player plays a teaching game with Stockfish-backed AkashML coaching, Claude coaching, or deterministic local coaching, works through a 24-lesson curriculum, and can use material odds to even out the game.

Deployment-specific hostnames, addresses, credentials, and private Artifact URLs belong in private
operations notes, not in this repository.

## Layout

```
src/chess-coach.html      The whole app: markup, CSS and JS in one readable source file
src/board-styles/         Board frames, original sprite exports, and cleaned `*-pieces-v2.png` production sheets
src/manifest.webmanifest  Standalone/PWA name, colors, and 192/512px icon declarations
src/icons/                Coach Knight master art plus Apple, PWA, and favicon sizes
scripts/build-preview.mjs Builds the standalone app and self-contained dist/artifact.html
scripts/import-redesign-assets.mjs Re-extracts optimized art from the exported redesign HTML
scripts/serve.mjs         Static server + server-side AkashML proxy
scripts/engine.mjs        Stockfish analysis, grading, and strength profiles
scripts/maia_service.py   Internal HTTP/UCI wrapper for the Maia-3 CPU sidecar
tests/verify.mjs          Checks lesson solutions and handicap start positions with chess.js
tests/server.mjs          Stockfish endpoint + mocked AkashML proxy integration test
tests/ui.mjs              Chrome regression checks for responsive layout and game interactions
Dockerfile                Reproducible non-root production image
Dockerfile.maia           Pinned Maia-3/PyTorch CPU image with embedded checkpoint
compose.yaml              Configurable-bind home-lab deployment
deploy/traefik/           Traefik dynamic config for the LAN HTTPS name
package.json              npm scripts: test, preview
```

## Commands

- `npm install` installs chess.js 0.10.3 (dev only, for tests) and Stockfish 19
- `npm test` runs lesson/handicap verification and server integration tests
- `npm run test:ui` builds and runs Chrome UI regressions, including long games, lesson browsing, appearance, and pending-analysis resets
- `npm run build` creates a standalone app in `dist/` with a local copy of chess.js
- `npm start` builds and serves the app at `http://127.0.0.1:4173` (override with `PORT`)
- `npm run preview` is kept as an alias for the standalone build
- `docker compose up --build -d` keeps port 9123 on loopback and adds a configurable second private bind; set `CHESS_COACH_LAN_BIND` for a trusted reverse proxy (the safe default is `127.0.0.2`)

## Artifact contract (do not break)

`src/chess-coach.html` remains compatible with the claude.ai Artifact publisher after the build
inlines its board artwork. Publish `dist/artifact.html`, not the raw source file. Its constraints are:

- **No `<!doctype>`, `<html>`, `<head>` or `<body>` tags.** The publisher wraps the file in its own skeleton. The file starts with `<title>`, then `<link>` and `<style>`.
- **External scripts only from the allowlisted CDNs** (cdnjs, cdn.jsdelivr.net/npm, unpkg, cdn.tailwindcss.com, code.jquery.com). Fonts only from Google Fonts. Everything else must be inlined. chess.js loads from `cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.js`; the build converts the WebP board assets to data URLs.
- **No `alert`/`confirm`/`prompt`, no `window.print`, no download links.** Build confirmations into the page.
- **Theme tokens.** All colors are CSS custom properties defined on bare `:root` (light), redefined under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`. Never use a literal color that only works in one theme. The board squares and piece colors are intentionally fixed.
- **Phone width.** It must work at ~400px with no horizontal page scroll.
- **localStorage is a convenience only.** Wrap every access in try/catch. The page must work when storage is empty or throws.

## Standalone home-screen identity

The standalone build injects Apple mobile-web-app metadata, an Apple touch icon, favicon, theme
color, and `manifest.webmanifest`; the Artifact source intentionally remains head-fragment compatible.
The original generated artwork is `src/icons/chess-coach-master.png`. Preserve the icon's square
canvas and generous crop-safe margin when replacing it. iPadOS may cache an installed icon, so remove
and re-add an existing shortcut when verifying an icon change.

## Claude coach (the `sample` capability)

The artifact declares `capabilities: {sample: {}}`. At runtime the page gets Claude with:

```js
sample = window.claude && window.claude.use ? await window.claude.use('sample') : null
```

`null` means Claude is unavailable (local server, signed-out viewer, declined consent). Every Claude feature must degrade gracefully. Local mode uses `localMove()` for the opponent, `basicPlan()` for the plan card, and deterministic fallbacks for move feedback, hints, game review, and common chess questions.

On the standalone server, the browser checks `/api/health`, uses `/api/analyze` for local Stockfish analysis, and uses `/api/coach` when `LLM_API_KEY` is configured. `scripts/serve.mjs` keeps that key server-side and calls AkashML's Anthropic-compatible Messages endpoint. Never put the key in `src/chess-coach.html` or `dist/`.

The live model routing is `Qwen/Qwen3.6-35B-A3B` for Fast, `Qwen/Qwen3.8-27B` for Thorough, and `zai-org/GLM-5.3` for Deep Review questions. Deep Review ordinary moves, hints, and game reviews stay on Qwen 3.8 so play remains responsive. No language model controls chess logic: Stockfish 19 grades each student move by centipawn loss, while the selected opponent engine—Stockfish or Maia-3—chooses the coach's legal reply. The move prompt includes those authoritative results and client code overrides any conflicting model label or move.

The browser sends `purpose: move | hint | review | question` with each `/api/coach` call. Deep questions use GLM with 4,096 tokens and a 60-second timeout. Reviews use Qwen (the quick model for Fast, the standard model otherwise), 4,096 tokens, and 60 seconds: GLM exhausted even an 8,192-token budget on reasoning without returning text in completed-game testing. Other requests use 600–1,100 tokens and 30 seconds. Prose responses that hit max_tokens without text retry once on the standard model with at least 4,096 tokens (same per-request timeout); never expose thinking blocks as an answer. Failed or empty reviews show a labeled local summary; cancellation still stops the request. Log only response metadata for empty answers, never provider reasoning or credentials.

Strength profiles are defined in `scripts/engine.mjs`: Beginner searches depth 6 and may choose among twelve moves within 450 cp of best; Improving searches depth 12 and favors one of four candidates within 85 cp; Club searches depth 15 and always uses the best move. Student grading is separately fixed at depth 12 so the Beginner setting weakens the opponent without degrading feedback. Keep these distinctions objective—do not move strength control back into prose prompts.

Maia-3 is an optional opponent, not an evaluator. `Dockerfile.maia` pins the official CSSLab source
and 5M checkpoint; `compose.yaml` gives its internal-only sidecar one CPU and 1 GB RAM. UI strength
maps to Maia Elo 800/1200/1600 for Beginner/Improving/Club. The client sends the base FEN and UCI
history, the Node server requests a Maia move concurrently with Stockfish grading, and Stockfish is
the automatic reply fallback. Never use Maia's compatibility centipawn or WDL values to grade the
student—they predict human outcomes rather than searched chess evaluation.

Calls in the page:

| Function | Call | Purpose |
|---|---|---|
| `coachReply(studentMove)` | `sample.json(prompt, {modelTier: tier, cache: false, signal})` | Judges the student's move, picks the coach's reply, gives a plan |
| `streamCoach(prompt)` | `sample(prompt, {onText, ...})` | Hint, game review, free-form questions (streamed into the log) |

The JSON contract `coachReply` expects:

```json
{"assessment":"good","feedback":"...","move":"Nf6","why":"...","plan":["...","..."]}
```

- `assessment` is one of `great | good | inaccuracy | mistake | blunder`, or null for the coach's opening move. In standalone mode, the Stockfish result overrides this field.
- `move` is validated against the legal move list with `tryMove()`. In standalone mode, the Stockfish move overrides this field; otherwise an illegal or missing move falls back to `localMove()`.
- `plan` holds 2–3 goals for the student's next few moves. It's stored with `ply` = history length after the coach's move, and is only shown while `game.history().length === plan.ply`.

Error handling branches on `e.code` (never `e.message`). Permanent codes (`not_granted`, `sampling_disabled`, …) set `sample = null`. Never retry from code.

## App state (top of the main IIFE)

- `game`: chess.js instance. **chess.js 0.10.3 uses snake_case** (`in_check`, `game_over`, `load_pgn`, `in_checkmate`), not the 1.x camelCase API.
- `mode`: `'play' | 'together' | 'lesson'`. `snapshot()` / `useSnapshot()` preserve separate coach and two-player games during mode switches. `chesscoach.together` stores the latter plus names/orientation/coaching; `chesscoach.mode` resumes the active two-player game.
- `player` (`'w'|'b'`), `level` (`beginner|improving|club`), `tier` (`default|quick`)
- `odds` (selected for the next game) and `gameOdds` (what the current game started with). Keys are in `ODDS`.
- `plan`, `logItems`, `solved` (lesson ids), `busy`, `ctl` (AbortController for the in-flight Claude call)
- Persisted to localStorage key `chesscoach.v1`: `{pgn, player, level, tier, opponentEngine, odds, gameOdds, solved, plan, moveGrades, resigned}`. Odds games survive reloads because chess.js writes `[SetUp]`/`[FEN]` headers into the PGN.
- `themePreference`: `'system' | 'light' | 'dark'`, stored separately as `chesscoach.theme`; System removes the root `data-theme` attribute and follows `prefers-color-scheme`.
- `boardStyle`: `'classic' | 'aether' | 'neon' | 'wildwood' | 'spell' | 'chalkboard'`, stored separately as `chesscoach.boardStyle`. Chalkboard is the default; saved choices take precedence.
- `layoutPreference`: coach panel or board-only layout, stored as `chesscoach.layout`.

## Features and where they live

- **Board**: `renderBoard()`. A CSS grid with 8 fixed `minmax(0,1fr)` rows and columns and `aspect-ratio: 1` squares, so empty ranks never collapse (this was a bug; keep both row and column templates). Classic uses Unicode pieces; the five illustrated styles use 6×2 sprite sheets over themed frames. Chalkboard uses a slate texture beneath an exact CSS grid. Keep board `isolation:isolate` so arrows remain above every rank. Click-to-move plus HTML5 drag. Promotion is always to a queen.
- **Coach move reveal**: `playCoachMove()` keeps `busy=true` for 700 ms after applying the move. `boardPoint()` converts the move's origin/destination into orientation-aware grid deltas; `--coach-dx`/`--coach-dy` animate the actual piece across its path. `coachAnimating`, `lastByCoach`, and `coachNotice` also drive stronger move-square highlights, the persistent notice, and input lock. Reset the reveal timer when starting/undoing a game or switching modes.
- **Move analysis UI**: `renderMoveGrade()` places the engine assessment on the five-step spectrum and records it in the scoresheet; `renderCoachCard()` and `renderMoveArrow()` make the reply, opening name, explanation, next concern, path, replay action, and follow-up action persistent and visible.
- **Settings and appearance**: the drawer is outside `playPanel` so it remains usable from Lessons. `applyTheme()` and `setTheme()` implement System/Light/Dark, while `setBoardStyle()` selects the board family without coupling appearance to game state.
- **Responsive layout**: above 1400px, fit the square board to both viewport dimensions and scroll long coaching inside the panel. Keep the ask box accessible. Board-only lessons have a Lesson details button that reopens the drawer.
- **New game**: the header starts a game immediately using pending settings; Done closes settings. Ignore stale engine/coaching results after a reset.
- **Lesson browser**: Choose lesson opens a separate dialog with wrapping filters and one scrolling catalog; keep exercise controls in the coach panel.
- **Play together**: both sides use `userMove()` with a grade-only Stockfish request, never an engine reply. `rateTogetherMove()` labels the grade with the moving player; `gradeMove()` compares the best root search with a search constrained to the played move, both at depth 12, including terminal moves. Ignore results from replaced games and restore the preceding grade on undo. Orientation is fixed White by default or follows `game.turn()`. Hints use the active player’s color; shared reviews cover both names. Undo is one ply after an agreement dialog. Keep solo state isolated and never trigger `coachReply()` in this mode.
- **Handicap**: `ODDS` + `startFen(key, coachColor)` remove pieces from the coach's side and fix castling rights. `oddsLine()` tells Claude about the handicap. `endGame()` suggests the next odds level up or down.
- **Plan card**: `renderPlan()`. Coach plan when fresh, else `basicPlan()` (pieces under attack via `attackedBy()`, undeveloped minors, castling, center, then follow-on goals). Current cards and the plan precede questions; older coaching is collapsed under Earlier coaching. Feed children must not shrink as history grows.
- **Lessons**: `LESSONS` array with `{id, unit, difficulty, title, concept, fen, sol, task, hint, explain}`. `sol` is SAN. A match ignores `+`/`#`. Hints and explanations are static (no Claude cost).
- **Scoresheet / PGN**: `renderSheet()`, `pgnBtn` (clipboard with a selectable-text fallback).

## Publishing changes

Run `npm run build`, then publish `dist/artifact.html`. Update the existing private Artifact rather
than creating a new public link. Omit `capabilities` on a redeploy to preserve `sample`, omit `icon`,
and keep the `<title>` as "Chess Coach". Store the private Artifact URL outside this repository.

## Ideas not built yet

- Promotion piece picker (currently auto-queen)
- Evaluation bar using the existing server-side Stockfish analysis
- More lessons (endgames: opposition, Lucena, Philidor)
- Importing a PGN from Chess.com/Lichess for review

## Profile storage invariants

- `scripts/profiles.mjs` serializes atomic JSON writes in one Node process. Keep `DATA_DIR` persistent; Docker mounts `/data` owned by UID 10001. Never commit profile data.
- Profile PUT uses revision compare-and-swap; return 409 on stale writes. Keep offline dirty state and block destructive profile switches until synced.
- Profile state owns separate solo/together snapshots, solved lessons, stable game IDs, saved review text and move ratings. Shared history references registered participants; guests are names only.
- Profiles are not authentication. Keep the deployment private. Do not claim a family profile picker enforces identity.
- Run `npm test` and `npm run test:ui`; profile tests use temporary data directories and independent browser contexts.

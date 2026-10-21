# Chess Coach
<img width="1300" height="1021" alt="image" src="https://github.com/user-attachments/assets/04f7bb3c-7504-4f81-88f3-7c47ff3d6290" />

A responsive chess trainer with teaching games, a 24-lesson curriculum, objective Stockfish analysis, and optional AI-written coaching. It runs locally without an AI provider and automatically enables richer explanations when AkashML is configured.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
cp .env.example .env
npm start
```

Open <http://127.0.0.1:4173>.

For AkashML coaching, put your AkashML credential in `.env`:

```dotenv
LLM_API_KEY=<your AkashML credential>
LLM_PROVIDER=akashml
LLM_MODEL=Qwen/Qwen3.8-27B
LLM_MODEL_QUICK=Qwen/Qwen3.6-35B-A3B
LLM_MODEL_DEEP=zai-org/GLM-5.3
```

The credential stays on the server. The browser calls the same-origin `/api/coach` endpoint, and the server authenticates to AkashML's Anthropic-compatible Messages API. Stockfish—not Qwen—grades the student's move and chooses the coach's reply. Qwen turns that analysis into concise teaching feedback. If the key is absent or AkashML is unavailable, the app continues with deterministic local coaching.

Coach strength now changes actual engine behavior:

| Setting | Search | Move selection |
|---|---:|---|
| Beginner | depth 6, 12 candidates | May choose a candidate within 4.5 pawns of the best move |
| Improving | depth 12, 4 candidates | Usually favors the best candidates and stays within 0.85 pawns |
| Club | depth 15 | Always plays Stockfish's best move |

`POST /api/analyze` is the local analysis endpoint. It accepts the current FEN plus the optional pre-move FEN and student UCI move, then returns the selected coach move, engine grade, centipawn loss, and best student alternative.

Difficulty affects the coach's move selection, not the quality of student feedback. Student moves are
graded with a separate depth-12 search even when the Beginner opponent searches only to depth 6.

### Opponent engines

The game offers two move engines while retaining Stockfish for objective student grading:

| Engine | Purpose | Strength mapping |
|---|---|---|
| Stockfish 19 | Calculated engine play | Existing depth/candidate profiles above |
| Maia-3 5M | Human-like sampled play conditioned on rating | Beginner 800, Improving 1200, Club 1600 Elo |

Maia runs on CPU in the internal-only `maia` Compose sidecar. Its port is not published. The image
pins both the upstream source commit and model revision, embeds a SHA-256-verified checkpoint, and
caps the sidecar at one CPU and 1 GB RAM. The browser sends reconstructed UCI move history so Maia
can use its eight-position history. If Maia is unavailable, the Node server automatically uses the
already-computed Stockfish move and tells the player about the fallback.

Maia's human-outcome scores are not used for grading. Its upstream documentation explicitly
distinguishes those predictions from a searched engine evaluation, so Stockfish remains authoritative
for assessment labels, centipawn loss, and the suggested better move. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for source revisions and licensing.

After every coach move, the board stays locked for a 700 ms reveal: the piece visibly travels from its origin to its destination, the move squares receive a strong highlight, and a persistent `Coach played …` notice remains until the student moves.

Coach modes split work by purpose:

| Mode | Normal moves | Hints | Questions and game review |
|---|---|---|---|
| Fast | Qwen 3.6 A3B | Qwen 3.6 A3B | Qwen 3.6 A3B |
| Thorough | Qwen 3.8 | Qwen 3.8 | Qwen 3.8 |
| Deep review | Qwen 3.8 | Qwen 3.8 | GLM 5.3 |

Deep Review deliberately keeps ordinary moves on Qwen 3.8 because Stockfish already supplies the chess calculation and GLM can take 20–30 seconds while reasoning. GLM requests receive a 1,800-token budget and 60-second timeout. Confirm configured model aliases against AkashML's current model catalog before deployment.

## Commands

```sh
npm test       # lesson, handicap, Stockfish, and mocked AkashML proxy tests
npm run build  # standalone output in dist/
npm start      # build and serve locally
```

The server binds to `127.0.0.1` by default. Keep it behind a trusted LAN, VPN, or authenticated
reverse proxy. Do not expose it directly to the public internet: `/api/coach` uses the server's API
allowance and the app does not include user authentication or request-rate controls.

## Add to Home Screen

The standalone build includes a PWA manifest plus Apple home-screen metadata. On an iPad or iPhone,
open either HTTPS address in Safari, use **Share → Add to Home Screen**, and Chess Coach installs with
the green “Coach Knight” mascot. The source artwork and generated 180, 192, and 512 px icons live in
`src/icons/`; `npm run build` copies the production sizes and `src/manifest.webmanifest` into `dist/`.
If an older shortcut already exists, remove it and add it again because iPadOS caches home-screen icons.

## Docker and Proxmox deployment

The container is stateless: lesson progress and the current game remain in each browser's local storage. No host data volume is required. The image runs as UID/GID `10001`, uses a read-only filesystem, drops all Linux capabilities, and includes an HTTP health check.

On the Proxmox app container or VM:

```sh
sudo install -d -m 750 /opt/apps/chess-coach
cd /opt/apps/chess-coach
# Copy this project here, then:
cp .env.example .env
chmod 600 .env
```

Set `LLM_API_KEY` in `.env`, verify that host port `9123` is unused, and start it:

```sh
docker compose config
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:9123/api/health
```

Compose binds only to `127.0.0.1:9123`. Publish that loopback service with a new, unused Tailscale Serve HTTPS port, preserving the server's existing Serve configuration. Do not use Funnel: this app has no user authentication and is intended to remain Tailnet-only.

To update it later:

```sh
docker compose build --pull
docker compose up -d
docker image prune -f
```

Before every deployment, recheck the host and proxy ports rather than assuming the example values
are free. `deploy/traefik/chess-coach.yml` is a template: replace its example hostname, certificate
resolver, and private backend address for your network.

## API-key safety

- `.env` and common credential-file formats are ignored by Git; `.env.example` contains no value.
- `LLM_API_KEY` is read only by the Node server and is never embedded in `dist/` or returned by
  `/api/health`.
- Browser requests use same-origin `/api/coach`; the server adds the upstream authorization header.
- Anyone who can administer the Docker host can inspect container environment variables. Restrict
  host access and file permissions, rotate exposed credentials immediately, and never commit `.env`.
- Before publishing a fork, inspect staged files with `git diff --cached` and run a secret scanner.

## License

Released under the [MIT License](LICENSE). Third-party engine and model components retain their own
licenses; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

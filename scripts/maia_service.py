"""Tiny internal HTTP wrapper around the official Maia-3 UCI engine."""

import json
import os
import re
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import chess


MODEL = os.environ.get("MAIA_MODEL", "maia3-5m")
PORT = int(os.environ.get("MAIA_PORT", "8001"))
MOVE_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")


class MaiaEngine:
    def __init__(self):
        self.lock = threading.Lock()
        self.process = subprocess.Popen(
            [
                "maia3-uci", "--model", MODEL, "--checkpoint-path", "/models/maia3-5m.pt",
                "--device", "cpu", "--no-use-amp", "--use-uci-history",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self._drain_stderr, daemon=True).start()
        self._command("uci", "uciok")
        self._command("isready", "readyok")

    def _drain_stderr(self):
        for line in self.process.stderr:
            print(f"maia3: {line.rstrip()}", flush=True)

    def _command(self, command, terminal):
        if self.process.poll() is not None:
            raise RuntimeError("Maia-3 process exited")
        self.process.stdin.write(command + "\n")
        self.process.stdin.flush()
        lines = []
        for line in self.process.stdout:
            line = line.strip()
            lines.append(line)
            if line.startswith(terminal):
                return lines
        raise RuntimeError("Maia-3 stopped responding")

    def move(self, base_fen, moves, elo, temperature, top_p):
        with self.lock:
            for command in (
                f"setoption name Elo value {elo}",
                f"setoption name Temperature value {temperature}",
                f"setoption name TopP value {top_p}",
                "setoption name MultiPV value 5",
                "ucinewgame",
                "position fen " + base_fen + (" moves " + " ".join(moves) if moves else ""),
            ):
                self.process.stdin.write(command + "\n")
            self.process.stdin.flush()
            lines = self._command("go nodes 1", "bestmove")
        best = next((line.split()[1] for line in reversed(lines) if line.startswith("bestmove ")), None)
        candidates = []
        for line in lines:
            match = re.search(r"multipv (\d+).*?score cp (-?\d+).*?pv (\S+)", line)
            if match:
                candidates.append({"rank": int(match.group(1)), "score": int(match.group(2)), "move": match.group(3)})
        if not best or best == "0000" or not MOVE_RE.fullmatch(best):
            raise RuntimeError("Maia-3 returned no legal move")
        rank = next((item["rank"] for item in candidates if item["move"] == best), None)
        return {"move": best, "rank": rank, "elo": elo, "model": MODEL, "candidates": candidates}


engine = MaiaEngine()


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, value):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"status": "ok", "engine": "maia3", "model": MODEL})
        return self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/move":
            return self._json(404, {"error": "not_found"})
        try:
            size = int(self.headers.get("content-length", "0"))
            if size < 1 or size > 32_000:
                raise ValueError("invalid request size")
            body = json.loads(self.rfile.read(size))
            current_fen = body.get("fen", "")
            base_fen = body.get("baseFen") or current_fen
            moves = body.get("moves") or []
            if not isinstance(moves, list) or len(moves) > 400 or any(not isinstance(move, str) or not MOVE_RE.fullmatch(move) for move in moves):
                raise ValueError("invalid move history")
            board = chess.Board(base_fen)
            for uci in moves:
                move = chess.Move.from_uci(uci)
                if move not in board.legal_moves:
                    raise ValueError("illegal move history")
                board.push(move)
            expected = chess.Board(current_fen)
            if board.board_fen() != expected.board_fen() or board.turn != expected.turn:
                raise ValueError("history does not match current position")
            elo = max(400, min(2400, int(body.get("elo", 1200))))
            temperature = max(0.0, min(2.0, float(body.get("temperature", 1.0))))
            top_p = max(0.1, min(1.0, float(body.get("topP", 1.0))))
            return self._json(200, engine.move(base_fen, moves, elo, temperature, top_p))
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            return self._json(422, {"error": "invalid_request", "detail": str(error)})
        except Exception as error:
            print(f"Maia request failed: {error}", flush=True)
            return self._json(502, {"error": "engine_error", "detail": "Maia-3 could not choose a move."})

    def log_message(self, format_string, *args):
        print(f"http: {format_string % args}", flush=True)


ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

#!/usr/bin/env bash
# Run backend + frontend together from the HealthTracker root with one command:
#   ./start.sh
#
# Backend  -> http://localhost:5000  (Express API, `npm run dev` in backend/)
# Frontend -> http://localhost:5173  (Vite dev server, `npm run dev` in frontend/)
# Press Ctrl+C to stop both.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# --- sanity checks -----------------------------------------------------------
command -v npm >/dev/null 2>&1 || { echo "Error: npm is not installed." >&2; exit 1; }

if [ ! -d "$BACKEND_DIR" ]; then echo "Error: backend/ directory not found." >&2; exit 1; fi
if [ ! -d "$FRONTEND_DIR" ]; then echo "Error: frontend/ directory not found." >&2; exit 1; fi

if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "Warning: backend/.env not found. Backend will fall back to defaults (PORT=5000)."
fi

# Auto-install dependencies on first run (or when node_modules is missing).
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "Installing backend dependencies..."
  npm install --prefix "$BACKEND_DIR"
fi
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install --prefix "$FRONTEND_DIR"
fi

# --- launch both servers -----------------------------------------------------
echo "Starting backend (http://localhost:5000) and frontend (http://localhost:5173)..."
echo "Press Ctrl+C to stop both."
echo ""

npm run dev --prefix "$BACKEND_DIR" &
BACKEND_PID=$!

npm run dev --prefix "$FRONTEND_DIR" &
FRONTEND_PID=$!

cleanup() {
  echo ""
  echo "Stopping servers..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "Stopped."
}

trap cleanup INT TERM

wait

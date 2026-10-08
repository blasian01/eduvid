#!/usr/bin/env bash
# One-time setup: Python/ManimGL, trusted Remotion templates, and the React app.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=""
for cand in python3.12 python3.11 python3.13 python3; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
[ -n "$PY" ] || { echo "Python 3.11+ is required"; exit 1; }

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. On macOS: brew install ffmpeg"; exit 1
fi

echo "→ Creating Python venv with $PY"
[ -d server/.venv ] || "$PY" -m venv server/.venv
server/.venv/bin/pip install --upgrade pip -q
server/.venv/bin/pip install -r server/requirements.txt

echo "→ Installing web dependencies"
npm --prefix web install

echo "→ Installing Remotion renderer and its headless browser"
npm --prefix remotion install
npm --prefix remotion run browser

if ! command -v latex >/dev/null 2>&1; then
  echo
  echo "Note: LaTeX isn't installed, so equations are drawn with unicode text."
  echo "      For real LaTeX equations: brew install --cask mactex-no-gui"
fi
echo
echo "✓ Setup complete. Start the app with:  npm run dev   → http://localhost:5173"

#!/usr/bin/env bash
# Open a job's animation in ManimGL's interactive window (or pass extra manimgl flags).
#   scripts/preview.sh <job-id>            # live preview window
#   scripts/preview.sh <job-id> -w --hd    # render to server/jobs/<job-id>/videos
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: scripts/preview.sh <job-id> [manimgl flags]"; ls server/jobs 2>/dev/null; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JOB="$ROOT/server/jobs/$1"; shift
[ -f "$JOB/scene.py" ] || { echo "No scene.py in $JOB"; exit 1; }
BEATS=$(python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1]))['slots']))" "$JOB/job.json")
cd "$JOB"
PYTHONPATH="$ROOT/server/app/manim_runtime" EDUVID_BEATS="$BEATS" \
  "$ROOT/server/.venv/bin/manimgl" scene.py ExplainerVideo --config_file manim_config.yml "$@"

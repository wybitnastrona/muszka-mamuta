#!/usr/bin/env bash
# Convert a VP9/WebM reel to H.264 MP4 (yuv420p, 30 fps, faststart).
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo "usage: $0 input.webm [output.mp4]" >&2
  exit 1
fi
in=$1
out=${2:-${in%.webm}.mp4}
exec ffmpeg -y -i "$in" -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart "$out"
